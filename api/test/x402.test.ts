import { describe, expect, test } from "vitest";
import { chatBody, harness, OWNER, PAYER, payloadFor } from "./helpers.ts";
import { checkPayload, fromBase64, nonceOf, payerOf, requirementsFor, toBase64 } from "../src/x402.ts";
import { ceilingMicro, DEFAULT_SETTLE_FEE_MICRO } from "../src/pricing.ts";
import { findModel } from "../src/models.ts";
import { parseChat } from "../src/openai.ts";

const quote = async (h: ReturnType<typeof harness>, body = chatBody()) => {
  const r = await h.call("/v1/chat/completions", { method: "POST", json: body });
  return { r, q: await r.clone().json() };
};
const pay = (h: ReturnType<typeof harness>, header: string, body = chatBody()) =>
  h.call("/v1/chat/completions", { method: "POST", headers: { "payment-signature": header }, json: body });

describe("x402 header parse", () => {
  test("base64 round trip, junk gives undefined", () => {
    expect(fromBase64(toBase64({ a: "é" }))).toEqual({ a: "é" });
    expect(fromBase64("%%%")).toBeUndefined();
    expect(fromBase64(btoa("not json"))).toBeUndefined();
  });
  test("checkPayload accepts our terms and names the first difference", () => {
    const ours = requirementsFor(OWNER, "1000");
    const good = { x402Version: 2, accepted: ours };
    expect(checkPayload(good, ours)).toBeNull();
    expect(checkPayload({ ...good, accepted: { ...ours, amount: "999" } }, ours)).toBe("wrong amount");
    expect(checkPayload({ ...good, accepted: { ...ours, network: "eip155:8453" } }, ours)).toBe("wrong network");
    expect(checkPayload({ ...good, accepted: { ...ours, payTo: PAYER } }, ours)).toBe("wrong payTo");
    expect(checkPayload({ x402Version: 1, accepted: ours }, ours)).toMatch(/version 2/);
    expect(checkPayload("x", ours)).toMatch(/object/);
  });
  test("nonce and payer extraction", () => {
    const p = { payload: { authorization: { from: PAYER.toUpperCase().replace("0X", "0x"), nonce: "0x" + "ab".repeat(32) } } };
    expect(nonceOf(p)).toBe("0x" + "ab".repeat(32));
    expect(nonceOf({ payload: { authorization: { nonce: "short" } } })).toBeNull();
    expect(payerOf(p)).toBe(PAYER);
    expect(payerOf(p, "0x3333333333333333333333333333333333333333")).toBe("0x3333333333333333333333333333333333333333");
  });
});

describe("402 quote", () => {
  test("header and body carry the same terms; amount is the ceiling", async () => {
    const h = harness();
    const { r, q } = await quote(h);
    expect(r.status).toBe(402);
    expect(fromBase64(r.headers.get("payment-required")!)).toEqual(q);
    const expected = ceilingMicro(findModel("granite-4.0-micro")!, parseChat(chatBody()).estIn, 100);
    expect(q).toMatchObject({
      x402Version: 2,
      accepts: [{ scheme: "exact", network: "eip155:4663", asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", amount: String(expected + DEFAULT_SETTLE_FEE_MICRO), payTo: OWNER, maxTimeoutSeconds: 300, extra: { name: "Global Dollar", version: "1" } }],
    });
    expect(q.resource.url).toBe("https://api.test/v1/chat/completions");
    expect(h.fac.calls).toEqual([]);
  });
  test("max_tokens moves the ceiling", async () => {
    const h = harness();
    const a = (await quote(h, chatBody({ max_tokens: 100 }))).q.accepts[0].amount;
    const b = (await quote(h, chatBody({ max_tokens: 1000 }))).q.accepts[0].amount;
    expect(Number(b)).toBeGreaterThan(Number(a));
  });
  test("PAY_TO missing: 503 not_configured, never a fake quote", async () => {
    const h = harness({ PAY_TO: "" });
    const { r, q } = await quote(h);
    expect(r.status).toBe(503);
    expect(q.error.code).toBe("not_configured");
    expect(r.headers.get("payment-required")).toBeNull();
  });
});

describe("x402 paid call", () => {
  test("verify -> work -> settle, refund of ceiling minus actual, ledger row for the payer", async () => {
    const h = harness();
    const { q } = await quote(h);
    const ceiling = Number(q.accepts[0].amount);
    const r = await pay(h, payloadFor(q));
    expect(r.status).toBe(200);
    expect(h.fac.calls).toEqual(["/verify", "/settle"]);
    expect(fromBase64(r.headers.get("payment-response")!)).toMatchObject({ success: true, transaction: "0xabc" });
    expect(r.headers.get("x-forge-cost-usd")).toBe("0.000001");
    expect(await h.repo.refundsOwed(PAYER)).toBe(ceiling - DEFAULT_SETTLE_FEE_MICRO - 1); // the fee is kept, never refunded
    const rows = await h.db.prepare("SELECT tenant, tokens_in, tokens_out, cost_usd FROM ledger").all();
    expect(rows.results).toEqual([{ tenant: PAYER, tokens_in: 10, tokens_out: 5, cost_usd: 0.000001 }]);
  });
  test("replay of the same authorization is a 409", async () => {
    const h = harness();
    const { q } = await quote(h);
    const header = payloadFor(q, "0x" + "cd".repeat(32));
    expect((await pay(h, header)).status).toBe(200);
    const again = await pay(h, header);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("payment_replayed");
    expect(h.fac.calls.filter((c) => c === "/settle")).toHaveLength(1);
  });
  test("parallel replays: exactly one wins", async () => {
    const h = harness();
    const { q } = await quote(h);
    const header = payloadFor(q, "0x" + "ee".repeat(32));
    const res = await Promise.all([pay(h, header), pay(h, header), pay(h, header)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });
  test("signed terms that differ from the quote: terms_mismatch, facilitator never called", async () => {
    const h = harness();
    const { q } = await quote(h);
    q.accepts[0].amount = "1";
    const r = await pay(h, payloadFor(q));
    expect(r.status).toBe(402);
    const body = await r.json();
    expect(body.error.code).toBe("terms_mismatch");
    expect(body.accepts).toHaveLength(1);
    expect(h.fac.calls).toEqual([]);
  });
  test("facilitator says invalid: verify_invalid, nothing settled", async () => {
    const h = harness();
    h.fac.verify = { isValid: false, invalidReason: "insufficient_funds" };
    const { q } = await quote(h);
    const r = await pay(h, payloadFor(q));
    expect(r.status).toBe(402);
    expect((await r.json()).error.code).toBe("verify_invalid");
    expect(h.fac.calls).toEqual(["/verify"]);
  });
  test("model fails: 502, payment never settled, same signature can be sent again", async () => {
    let fail = true;
    const h = harness({}, () => { if (fail) throw new Error("boom"); return { response: "ok", usage: { prompt_tokens: 1, completion_tokens: 1 } }; });
    const { q } = await quote(h);
    const header = payloadFor(q);
    const bad = await pay(h, header);
    expect(bad.status).toBe(502);
    expect(h.fac.calls).not.toContain("/settle");
    fail = false;
    expect((await pay(h, header)).status).toBe(200);
  });
  test("empty model reply: not charged, not settled", async () => {
    const h = harness({}, () => ({ response: "", usage: { prompt_tokens: 5, completion_tokens: 0 } }));
    const { q } = await quote(h);
    const r = await pay(h, payloadFor(q));
    expect(r.status).toBe(200);
    expect(r.headers.get("x-forge-cost-usd")).toBe("0.000000");
    expect(h.fac.calls).not.toContain("/settle");
    expect(await h.repo.refundsOwed(PAYER)).toBe(0);
  });
  test("facilitator down: 502 upstream_error, nothing charged", async () => {
    const h = harness();
    const { q } = await quote(h);
    h.fac.down = true;
    const r = await pay(h, payloadFor(q));
    expect(r.status).toBe(502);
    expect((await r.json()).error.code).toBe("upstream_error");
  });
  test("settle failure after work: 402, no answer handed out", async () => {
    const h = harness();
    h.fac.settle = { success: false, errorReason: "insufficient_balance" };
    const { q } = await quote(h);
    const r = await pay(h, payloadFor(q));
    expect(r.status).toBe(402);
    expect(await h.repo.refundsOwed(PAYER)).toBe(0);
  });
});

describe("x402 key deposit", () => {
  test("deposit mints a key, balance matches, owner is the payer, key works and closes with a refund", async () => {
    const h = harness();
    const first = await h.call("/v1/keys", { method: "POST", json: { amount_usd: 5, label: "bot" } });
    const q = await first.json();
    expect(first.status).toBe(402);
    expect(q.accepts[0].amount).toBe("5000000");
    const r = await h.call("/v1/keys", { method: "POST", headers: { "payment-signature": payloadFor(q) }, json: { amount_usd: 5, label: "bot" } });
    expect(r.status).toBe(200);
    const k = await r.json();
    expect(k).toMatchObject({ balance_usd: "4.985000", fee_usd: "0.015000", owner: PAYER, label: "bot" });
    expect(k.key).toMatch(/^forge_sk_[0-9A-Za-z]{43}$/);
    const me = await (await h.call("/v1/keys/me", { headers: { authorization: `Bearer ${k.key}` } })).json();
    expect(me).toMatchObject({ owner: PAYER, label: "bot", balance_usd: "4.985000", spent_usd: "0.000000", calls: 0, recent: [] });
    const del = await h.call("/v1/keys/me", { method: "DELETE", headers: { authorization: `Bearer ${k.key}` } });
    expect((await del.json()).refunded_usd).toBe("4.985000");
    expect(await h.repo.refundsOwed(PAYER)).toBe(4_985_000);
    expect((await h.call("/v1/keys/me", { headers: { authorization: `Bearer ${k.key}` } })).status).toBe(401);
  });
  test("amount outside 1..1000 is a 400", async () => {
    const h = harness();
    expect((await h.call("/v1/keys", { method: "POST", json: { amount_usd: 0.5 } })).status).toBe(400);
    expect((await h.call("/v1/keys", { method: "POST", json: { amount_usd: 1001 } })).status).toBe(400);
  });
});
