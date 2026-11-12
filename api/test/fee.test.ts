// The Priors settle fee and the "never lose money" rule: every x402 payment pays its own fee, deposits net it out,
// and no call is charged below our Cloudflare cost.
import { describe, expect, test } from "vitest";
import { chatBody, fundedKey, harness, PAYER, payloadFor } from "./helpers.ts";
import { fromBase64 } from "../src/x402.ts";
import { MODELS } from "../src/models.ts";
import { DEFAULT_SETTLE_FEE_MICRO, cfCostMicro, settleFeeMicro } from "../src/pricing.ts";

const FEE = DEFAULT_SETTLE_FEE_MICRO;
const x402Chat = async (h: ReturnType<typeof harness>, body = chatBody()) => {
  const q = await h.call("/v1/chat/completions", { method: "POST", json: body });
  const terms = await q.clone().json();
  const r = await h.call("/v1/chat/completions", { method: "POST", headers: { "payment-signature": payloadFor(terms) }, json: body });
  return { q, terms, r };
};

describe("settle fee config", () => {
  test("default 0.015, valid values parse, junk falls back", () => {
    expect(settleFeeMicro({})).toBe(15_000);
    expect(settleFeeMicro({ SETTLE_FEE_USD: "0.02" })).toBe(20_000);
    for (const bad of ["abc", "-1", "", "1e3", "0.0000001"]) expect(settleFeeMicro({ SETTLE_FEE_USD: bad })).toBe(15_000);
  });
});

describe("x402 per call carries the fee", () => {
  test("quote includes the fee, says so, and sets the header", async () => {
    const { q, terms } = await x402Chat(harness());
    expect(q.status).toBe(402);
    expect(q.headers.get("x-forge-settle-fee-usd")).toBe("0.015000");
    expect(terms.description).toMatch(/includes a 0\.015000 USDG settlement fee/);
    expect(Number(terms.accepts[0].amount)).toBeGreaterThan(FEE);
  });
  test("settled amount = token charge + fee; the refund is only ceiling - charge", async () => {
    const h = harness();
    const { terms, r } = await x402Chat(h);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-forge-settle-fee-usd")).toBe("0.015000");
    expect(fromBase64(r.headers.get("payment-response")!)).toMatchObject({ success: true });
    const tokenCharge = Math.round(Number(r.headers.get("x-forge-cost-usd")) * 1e6);
    const owed = await h.repo.refundsOwed(PAYER);
    expect(Number(terms.accepts[0].amount) - owed).toBe(tokenCharge + FEE);
  });
  test("embeddings carry the fee too", async () => {
    const h = harness({ AI_DAILY_NEURONS: "0" }, () => ({ data: [[0.1, 0.2]] }));
    const body = { model: "bge-m3", input: "hi" };
    const terms = await (await h.call("/v1/embeddings", { method: "POST", json: body })).json();
    expect(terms.description).toMatch(/settlement fee/);
    const r = await h.call("/v1/embeddings", { method: "POST", headers: { "payment-signature": payloadFor(terms) }, json: body });
    expect(r.status).toBe(200);
    expect(r.headers.get("x-forge-settle-fee-usd")).toBe("0.015000");
    expect(Number(terms.accepts[0].amount)).toBeGreaterThan(FEE);
  });
  test("a prepaid key call adds no fee", async () => {
    const h = harness();
    const { key, id } = await fundedKey(h, 1_000_000);
    const r = await h.call("/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}` }, json: chatBody() });
    expect(r.status).toBe(200);
    expect(r.headers.get("x-forge-settle-fee-usd")).toBeNull();
    expect(h.fac.calls).toEqual([]);
    const k = await h.repo.keyById(id);
    expect(1_000_000 - k!.balance_micro).toBe(Math.round(Number(r.headers.get("x-forge-cost-usd")) * 1e6));
  });
});

describe("deposits pay the fee out of the amount", () => {
  const dep = (h: ReturnType<typeof harness>, path: string, amount: number, headers: Record<string, string> = {}) =>
    h.call(path, { method: "POST", headers, json: { amount_usd: amount } });
  test("create: key credited amount - fee, fee_usd shown, 402 states the deduction", async () => {
    const h = harness();
    const first = await dep(h, "/v1/keys", 2);
    const terms = await first.json();
    expect(terms.accepts[0].amount).toBe("2000000"); // the payer signs the whole amount
    expect(terms.description).toMatch(/deducted from the deposit/);
    expect(first.headers.get("x-forge-settle-fee-usd")).toBe("0.015000");
    const r = await dep(h, "/v1/keys", 2, { "payment-signature": payloadFor(terms) });
    expect(await r.json()).toMatchObject({ balance_usd: "1.985000", fee_usd: "0.015000" });
  });
  test("top-up credits amount - fee", async () => {
    const h = harness();
    const { key } = await fundedKey(h, 100_000);
    const auth = { authorization: `Bearer ${key}` };
    const terms = await (await dep(h, "/v1/keys/topup", 3, auth)).json();
    const r = await dep(h, "/v1/keys/topup", 3, { ...auth, "payment-signature": payloadFor(terms) });
    expect(await r.json()).toMatchObject({ balance_usd: "3.085000", fee_usd: "0.015000" });
  });
  test("amount not above the fee is refused before any quote", async () => {
    const h = harness({ SETTLE_FEE_USD: "1" });
    const r = await dep(h, "/v1/keys", 1);
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("bad_request");
    expect(h.fac.calls).toEqual([]);
  });
});

// Every chat model, a few sizes, discount off and on. Real worker, real sqlite, fake facilitator and AI.
describe("never below cost", () => {
  const sizes: [number, number][] = [[10, 5], [500, 300], [20_000, 2_000]];
  const holder = { FORGE_TOKEN: "0x4444444444444444444444444444444444444444", HOLDER_MIN: "1000", HOLDER_DISCOUNT_PCT: "20" };
  for (const m of MODELS.filter((x) => x.type === "chat")) {
    for (const [tin, tout] of sizes) {
      for (const disc of [false, true]) {
        test(`${m.id} ${tin}/${tout} discount=${disc}`, async () => {
          const mk = () => {
            const h = harness({ AI_DAILY_NEURONS: "0", ...(disc ? holder : {}) }, () => ({ response: "x", usage: { prompt_tokens: tin, completion_tokens: tout } }));
            h.fac.balance = "0x" + (5000).toString(16);
            return h;
          };
          const body = chatBody({ model: m.id, max_tokens: tout + 10, messages: [{ role: "user", content: "x".repeat(tin * 3) }] });
          const cf = cfCostMicro(m, tin, tout);
          const hk = mk();
          const { key } = await fundedKey(hk, 50_000_000);
          const rk = await hk.call("/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}` }, json: body });
          expect(rk.status).toBe(200);
          if (disc) expect(rk.headers.get("x-forge-discount-pct")).toBe("20");
          expect(Math.round(Number(rk.headers.get("x-forge-cost-usd")) * 1e6) - cf).toBeGreaterThanOrEqual(0); // key: revenue - cf cost
          const hx = mk();
          const { terms, r } = await x402Chat(hx, body);
          expect(r.status).toBe(200);
          const settled = Number(terms.accepts[0].amount) - (await hx.repo.refundsOwed(PAYER));
          expect(settled - cf - FEE).toBeGreaterThanOrEqual(0); // x402: revenue - cf cost - fee
        });
      }
    }
  }
});
