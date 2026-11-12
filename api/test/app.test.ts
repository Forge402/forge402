import { describe, expect, test } from "vitest";
import { chatBody, fundedKey, harness, OWNER } from "./helpers.ts";
import { fromBase64 } from "../src/x402.ts";

const auth = (key: string) => ({ authorization: `Bearer ${key}` });
const chat = (h: ReturnType<typeof harness>, key: string, body = chatBody(), headers: Record<string, string> = {}) =>
  h.call("/v1/chat/completions", { method: "POST", headers: { ...auth(key), ...headers }, json: body });

describe("prepaid key billing", () => {
  test("reserves the ceiling, keeps the real cost, returns the rest", async () => {
    const h = harness();
    const { key, id } = await fundedKey(h, 1_000_000);
    const r = await chat(h, key);
    expect(r.status).toBe(200);
    const row = (await h.repo.keyById(id))!;
    expect(row.spent_micro).toBe(1);
    expect(row.balance_micro).toBe(999_999);
    const me = await (await h.call("/v1/keys/me", { headers: auth(key) })).json();
    expect(me.calls).toBe(1);
    expect(me.recent[0]).toMatchObject({ model: "granite-4.0-micro", tokens_in: 10, tokens_out: 5, cache: "BYPASS" });
  });
  test("balance below the ceiling: 402 insufficient_balance, no model call", async () => {
    const h = harness();
    const { key } = await fundedKey(h, 5);
    const r = await chat(h, key, chatBody({ max_tokens: 1000 }));
    expect(r.status).toBe(402);
    expect((await r.json()).error.code).toBe("insufficient_balance");
    expect(h.aiCalls).toHaveLength(0);
  });
  test("unknown or malformed key: 401 invalid_key", async () => {
    const h = harness();
    for (const k of ["forge_sk_nope", "Bearer", "x".repeat(60)]) expect((await chat(h, k)).status).toBe(401);
  });
  test("model error: 502 and the reservation comes back", async () => {
    const h = harness({}, () => { throw new Error("upstream blew up"); });
    const { key, id } = await fundedKey(h, 1000);
    const r = await chat(h, key);
    expect(r.status).toBe(502);
    expect((await h.repo.keyById(id))!.balance_micro).toBe(1000);
  });
  test("busy model is a 429 model_overloaded", async () => {
    const h = harness({}, () => { throw new Error("3040: Capacity temporarily exceeded"); });
    const { key } = await fundedKey(h, 1000);
    const r = await chat(h, key);
    expect(r.status).toBe(429);
    expect((await r.json()).error.code).toBe("model_overloaded");
  });
  test("empty reply is free", async () => {
    const h = harness({}, () => ({ response: "   ", usage: { prompt_tokens: 20, completion_tokens: 0 } }));
    const { key, id } = await fundedKey(h, 1000);
    const r = await chat(h, key);
    expect(r.headers.get("x-forge-cost-usd")).toBe("0.000000");
    const row = (await h.repo.keyById(id))!;
    expect(row).toMatchObject({ balance_micro: 1000, spent_micro: 0, calls: 0 });
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM ledger").first<{ n: number }>())!.n).toBe(0);
  });
  test("a key closed mid-call: the unused reservation goes to the owner's refunds", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = harness({}, async () => { await gate; return { response: "ok", usage: { prompt_tokens: 1, completion_tokens: 1 } }; });
    const { key, id } = await fundedKey(h, 10_000);
    const pending = chat(h, key, chatBody({ max_tokens: 1000 }));
    while (h.aiCalls.length === 0) await new Promise((r) => setTimeout(r, 2)); // wait until the model call is in flight
    await h.repo.closeKey(id, 1);
    release();
    expect((await pending).status).toBe(200);
    const row = (await h.repo.keyById(id))!;
    expect(row.balance_micro).toBe(0);
    // refunds: what the close saw (balance minus reservation) + the reservation's unused part = everything but the cost
    expect(await h.repo.refundsOwed(OWNER)).toBe(10_000 - 1);
  });
});

describe("response cache", () => {
  test("temperature 0: MISS then HIT at 50%, model called once", async () => {
    const h = harness({}, () => ({ response: "x".repeat(400), usage: { prompt_tokens: 1000, completion_tokens: 1000 } }));
    const { key, id } = await fundedKey(h, 1_000_000);
    const body = chatBody({ temperature: 0, max_tokens: 2000 });
    const a = await chat(h, key, body);
    const b = await chat(h, key, body);
    expect(a.headers.get("x-forge-cache")).toBe("MISS");
    expect(b.headers.get("x-forge-cache")).toBe("HIT");
    const full = Number(a.headers.get("x-forge-cost-usd")) * 1e6;
    expect(Number(b.headers.get("x-forge-cost-usd")) * 1e6).toBe(Math.ceil(full / 2));
    expect(h.aiCalls).toHaveLength(1);
    expect((await (await b.json()).choices[0].message.content)).toBe("x".repeat(400));
    expect((await h.repo.keyById(id))!.calls).toBe(2);
  });
  test("another tenant never hits it", async () => {
    const h = harness();
    const k1 = await fundedKey(h, 100_000);
    const k2 = await fundedKey(h, 100_000);
    const body = chatBody({ temperature: 0 });
    await chat(h, k1.key, body);
    const other = await chat(h, k2.key, body);
    expect(other.headers.get("x-forge-cache")).toBe("MISS");
    expect(h.aiCalls).toHaveLength(2);
  });
  test("X-Forge-Cache on/off overrides, streaming bypasses", async () => {
    const h = harness();
    const { key } = await fundedKey(h, 100_000);
    expect((await chat(h, key, chatBody({ temperature: 0.7 }), { "x-forge-cache": "on" })).headers.get("x-forge-cache")).toBe("MISS");
    expect((await chat(h, key, chatBody({ temperature: 0.7 }), { "x-forge-cache": "on" })).headers.get("x-forge-cache")).toBe("HIT");
    expect((await chat(h, key, chatBody({ temperature: 0 }), { "x-forge-cache": "off" })).headers.get("x-forge-cache")).toBe("BYPASS");
  });
  test("KV broken: the call still works", async () => {
    const h = harness();
    h.env.CACHE = { get: async () => { throw new Error("down"); }, put: async () => { throw new Error("down"); } };
    const { key } = await fundedKey(h, 100_000);
    expect((await chat(h, key, chatBody({ temperature: 0 }))).status).toBe(200);
  });
});

describe("holder discount", () => {
  const token = "0x4444444444444444444444444444444444444444";
  test("off while FORGE_TOKEN is unset: no chain read, 0%", async () => {
    const h = harness();
    const { key } = await fundedKey(h, 100_000);
    const r = await chat(h, key);
    expect(r.headers.get("x-forge-discount-pct")).toBe("0");
    expect(h.fac.rpcCalls).toBe(0);
  });
  test("holder gets the percent off, read once then cached", async () => {
    const h = harness({ FORGE_TOKEN: token, HOLDER_MIN: "1000", HOLDER_DISCOUNT_PCT: "20" }, () => ({ response: "ok", usage: { prompt_tokens: 100_000, completion_tokens: 0 } }));
    h.fac.balance = "0x" + (5000).toString(16);
    const { key } = await fundedKey(h, 10_000_000);
    const long = chatBody({ messages: [{ role: "user", content: "x".repeat(300_000) }] });
    const a = await chat(h, key, long);
    const list = 2100; // 100000 * 0.021
    expect(a.headers.get("x-forge-discount-pct")).toBe("20");
    expect(Number(a.headers.get("x-forge-cost-usd")) * 1e6).toBe(1700); // 80% of list is 1680, but Cloudflare cost is 100000 * 0.017 = 1700: the break-even floor wins
    await chat(h, key, long);
    expect(h.fac.rpcCalls).toBe(1);
  });
  test("below the minimum, or an unreadable chain: full price", async () => {
    const h = harness({ FORGE_TOKEN: token, HOLDER_MIN: "1000", HOLDER_DISCOUNT_PCT: "20" });
    h.fac.balance = "0x5";
    const { key } = await fundedKey(h, 100_000);
    expect((await chat(h, key)).headers.get("x-forge-discount-pct")).toBe("0");
    const h2 = harness({ FORGE_TOKEN: token, HOLDER_MIN: "1000", HOLDER_DISCOUNT_PCT: "20" });
    h2.fac.balance = undefined as never;
    const k2 = await fundedKey(h2, 100_000);
    expect((await chat(h2, k2.key)).headers.get("x-forge-discount-pct")).toBe("0");
  });
});

describe("playground", () => {
  const pg = (h: ReturnType<typeof harness>, body: unknown, ip = "1.2.3.4") =>
    h.call("/v1/playground/chat", { method: "POST", headers: { "cf-connecting-ip": ip }, json: body });
  test("guest: 5 a day per IP on a free model, 512 token cap, nothing charged", async () => {
    const h = harness();
    const { freeModelIds } = await import("../src/models.ts");
    const model = [...freeModelIds()][0];
    for (let i = 0; i < 5; i++) expect((await pg(h, chatBody({ model, max_tokens: 4000 }))).status).toBe(200);
    expect(h.aiCalls[0].input.max_tokens).toBe(512);
    const sixth = await pg(h, chatBody({ model }));
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.code).toBe("rate_limited");
    expect((await pg(h, chatBody({ model }), "9.9.9.9")).status).toBe(200); // a different IP has its own five
    const rows = await h.db.prepare("SELECT DISTINCT cost_usd, tenant FROM ledger").all();
    expect(rows.results).toEqual([{ cost_usd: 0, tenant: "playground" }]);
  });
  test("guest asking for a paid model: 402 payment_required", async () => {
    const h = harness();
    const r = await pg(h, chatBody({ model: "kimi-k2.6" }));
    expect(r.status).toBe(402);
    expect((await r.json()).error.code).toBe("payment_required");
  });
  test("a failed model call gives the free slot back", async () => {
    const h = harness({}, () => { throw new Error("x"); });
    const { freeModelIds } = await import("../src/models.ts");
    const model = [...freeModelIds()][0];
    for (let i = 0; i < 7; i++) expect((await pg(h, chatBody({ model }))).status).toBe(502);
  });
  test("no IP is stored", async () => {
    const h = harness();
    const { freeModelIds } = await import("../src/models.ts");
    await pg(h, chatBody({ model: [...freeModelIds()][0] }), "203.0.113.77");
    const all = JSON.stringify((await h.db.prepare("SELECT * FROM daily_use").all()).results);
    expect(all).not.toContain("203.0.113.77");
  });
});

describe("stats", () => {
  const add = (h: ReturnType<typeof harness>, over: object) =>
    h.repo.addLedger({ ts: h.clock.now(), tenant: "t", model: "a", tokens_in: 10, tokens_out: 5, cost_micro: 100, cache: "MISS", discount_pct: 0, ...over } as never);
  test("empty ledger: zeros, nothing seeded", async () => {
    const h = harness();
    expect(await (await h.call("/v1/stats")).json()).toEqual({ range: "7d", tokens_in: 0, tokens_out: 0, calls: 0, scans: 0, volume_usd: 0, cache_hit_rate: 0, per_model: [], daily: [], capacity: { day: "2027-01-15", neurons_used: 0, neurons_limit: 7500, free_neurons_used: 0, free_neurons_limit: 2000 } });
  });
  test("sums, per model, daily, hit rate, scans, range cutoff", async () => {
    const h = harness();
    const day = 86_400_000;
    await add(h, {});
    await add(h, { cache: "HIT", cost_micro: 50 });
    await add(h, { model: "b", cache: "BYPASS", tokens_in: 1, tokens_out: 1, cost_micro: 1 });
    await add(h, { kind: "scan", model: "scan", tokens_in: 0, tokens_out: 0, cost_micro: 2000, cache: "BYPASS" });
    await add(h, { ts: h.clock.now() - 40 * day, tokens_in: 1000, tokens_out: 1000 });
    const s = await (await h.call("/v1/stats?range=7d")).json();
    expect(s).toMatchObject({ tokens_in: 21, tokens_out: 11, calls: 3, scans: 1, cache_hit_rate: 0.5 });
    expect(s.volume_usd).toBeCloseTo(0.002151, 6);
    expect(s.per_model).toEqual([{ model: "a", calls: 2, tokens_in: 20, tokens_out: 10 }, { model: "b", calls: 1, tokens_in: 1, tokens_out: 1 }]);
    expect(s.daily).toEqual([{ day: "2027-01-15", calls: 3 }]);
    const all = await (await h.call("/v1/stats?range=all")).json();
    expect(all.calls).toBe(4);
    expect((await h.call("/v1/stats?range=2d")).status).toBe(400);
  });
});

describe("public surface", () => {
  test("models: OpenAI list shape with Forge fields and a free flag", async () => {
    const h = harness();
    const j = await (await h.call("/v1/models")).json();
    expect(j.object).toBe("list");
    // Workers Free plan (default): the 8 paid-plan-only models are hidden.
    expect(j.data.length).toBe(24);
    expect(j.data.find((m: any) => m.id === "kimi-k2.6")).toBeUndefined();
    expect(j.data.find((m: any) => m.id === "gpt-oss-120b")).toMatchObject({ object: "model", provider: "OpenAI", type: "chat", context_length: 128000, input_usd_per_mtok: 0.438, output_usd_per_mtok: 0.938, free: false });
    // Paid plan (AI_DAILY_NEURONS "0"): all 32 are served.
    const paid = await (await harness({ AI_DAILY_NEURONS: "0" }).call("/v1/models")).json();
    expect(paid.data.length).toBe(32);
    expect(paid.data.find((m: any) => m.id === "kimi-k2.6").deprecates).toBe("2026-11-20");
    expect(j.data.filter((m: any) => m.free)).toHaveLength(3);
  });
  test("discovery documents", async () => {
    const h = harness();
    expect((await (await h.call("/openapi.json")).json()).openapi).toBe("3.1.0");
    const wk = await (await h.call("/.well-known/x402")).json();
    expect(wk).toMatchObject({ x402Version: 2, payTo: OWNER, networks: [{ network: "eip155:4663" }] });
    const llms = await (await h.call("/llms.txt")).text();
    expect(llms).toContain("https://api.test/v1");
  });
  test("CORS: allowed origin echoed with expose and allow headers, others get none, preflight 204", async () => {
    const h = harness();
    const ok = await h.call("/v1/models", { headers: { origin: "https://forge402.example" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://forge402.example");
    expect(ok.headers.get("access-control-expose-headers")).toContain("X-Forge-Cost-Usd");
    expect(ok.headers.get("access-control-expose-headers")).toContain("PAYMENT-REQUIRED");
    const no = await h.call("/v1/models", { headers: { origin: "https://evil.example" } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await h.call("/v1/chat/completions", { method: "OPTIONS", headers: { origin: "https://forge402.example" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("PAYMENT-SIGNATURE");
  });
  test("402 is readable cross-origin", async () => {
    const h = harness();
    const r = await h.call("/v1/chat/completions", { method: "POST", headers: { origin: "https://forge402.example" }, json: chatBody() });
    expect(r.status).toBe(402);
    expect(r.headers.get("access-control-expose-headers")).toContain("PAYMENT-REQUIRED");
    expect(fromBase64(r.headers.get("payment-required")!)).toBeTruthy();
  });
  test("missing DB or AI: 503 not_configured", async () => {
    const noDb = harness({ DB: undefined });
    const r = await noDb.call("/v1/chat/completions", { method: "POST", json: chatBody() });
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("not_configured");
    const noAi = harness({ AI: undefined });
    const { key } = await fundedKey(noAi, 1000);
    expect((await chat(noAi, key)).status).toBe(503);
  });
  test("MCP: initialize, tools/list, list_models, scan without binding = not_configured, chat without key", async () => {
    const h = harness();
    const rpc = async (method: string, params?: unknown) => (await (await h.call("/mcp", { method: "POST", json: { jsonrpc: "2.0", id: 1, method, params } })).json()).result;
    expect((await rpc("initialize", { protocolVersion: "2025-06-18" })).protocolVersion).toBe("2025-06-18");
    expect((await rpc("tools/list")).tools.map((t: any) => t.name)).toEqual(["list_models", "chat", "scan"]);
    expect((await rpc("tools/call", { name: "list_models" })).structuredContent.data).toHaveLength(24);
    const scan = await rpc("tools/call", { name: "scan", arguments: { address: OWNER } });
    expect(scan.isError).toBe(true);
    expect(scan.structuredContent.error.code).toBe("not_configured");
    const c = await rpc("tools/call", { name: "chat", arguments: { model: "granite-4.0-micro", prompt: "hi" } });
    expect(c.isError).toBe(true);
    expect(c.content[0].text).toContain("Payment needed");
  });
  test("stats count scans from the scan worker, ledger when it fails (live 2026-11-12: web scans showed 0)", async () => {
    const seen: string[] = [];
    const ok = harness({ SCAN: { fetch: async (r: Request) => (seen.push(new URL(r.url).pathname), new Response(JSON.stringify({ count: 7 }))) } });
    expect((await (await ok.call("/v1/stats")).json()).scans).toBe(7);
    expect(seen).toEqual(["/v1/scan/count"]);
    const down = harness({ SCAN: { fetch: async () => new Response("no", { status: 500 }) } });
    expect((await (await down.call("/v1/stats")).json()).scans).toBe(0);
  });
  test("MCP scan goes through the SCAN binding when present", async () => {
    const seen: string[] = [];
    const h = harness({ SCAN: { fetch: async (r: Request) => (seen.push(new URL(r.url).pathname), new Response(JSON.stringify({ score: 90 }))) } });
    const r = await (await h.call("/mcp", { method: "POST", json: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "scan", arguments: { address: OWNER } } } })).json();
    expect(seen).toEqual([`/v1/scan/${OWNER}`]);
    expect(r.result.structuredContent).toEqual({ score: 90 });
  });
  test("wallet: lists keys (ids, never secrets) and closes one", async () => {
    const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
    const h = harness();
    const acct = privateKeyToAccount(generatePrivateKey());
    const { key, id } = await fundedKey(h, 2_000_000, acct.address);
    const n = await (await h.call("/v1/auth/nonce", { method: "POST", json: { address: acct.address } })).json();
    const { token } = await (await h.call("/v1/auth/verify", { method: "POST", json: { address: acct.address, nonce: n.nonce, signature: await acct.signMessage({ message: n.message }) } })).json();
    const w = await (await h.call("/v1/wallet", { headers: auth(token) })).json();
    expect(w.keys).toHaveLength(1);
    expect(w.keys[0]).toMatchObject({ id, balance_usd: "2.000000", spent_usd: "0.000000", revoked: false });
    expect(JSON.stringify(w)).not.toContain(key);
    const closed = await h.call(`/v1/wallet/keys/${id}/close`, { method: "POST", headers: auth(token) });
    expect((await closed.json()).refunded_usd).toBe("2.000000");
    expect((await (await h.call("/v1/wallet", { headers: auth(token) })).json()).refunds_owed_usd).toBe("2.000000");
    // someone else's key
    const other = await fundedKey(h, 1000);
    expect((await h.call(`/v1/wallet/keys/${other.id}/close`, { method: "POST", headers: auth(token) })).status).toBe(404);
  });
});
