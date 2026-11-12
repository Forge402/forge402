// Free plan limits: Workers AI daily neuron budget and the 50-subrequest ceiling per invocation.
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fallbackSummary, neuronsFor, writeSummary, type AiBudget } from "../src/summary.ts";
import { Store } from "../src/store.ts";
import { createRpcClient } from "../src/rpc.ts";
import { scanToken, type ScanDeps } from "../src/scan.ts";
import { RADAR, runRadar } from "../src/radar.ts";
import { runWatchCron, WATCH, type BotDeps } from "../src/watch.ts";
import type { Check } from "../src/types.ts";

// A D1 stand-in over node:sqlite, running the real migrations, so the SQL itself is exercised.
function fakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync("migrations").sort()) db.exec(readFileSync(`migrations/${f}`, "utf8"));
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as any[])).changes) } }),
    first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (list: any[]) => { for (const s of list) await s.run(); return []; } } as unknown as D1Database;
}

const NOW = 1_800_000_000_000;
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const checks: Check[] = [{ id: "x", label: "Owner can mint", value: true, status: "flag", detail: "mint found" }];
const AI_TEXT = "This token has an owner who can mint more supply. Liquidity looks thin for its age. Treat it with caution and size small.";

describe("AI budget", () => {
  const budget = (used: number, cap = 1000) => { const adds: number[] = []; const b: AiBudget = { cap, used: async () => used, add: async (n) => { adds.push(n); } }; return { b, adds }; };
  const ai = () => { const calls: unknown[] = []; return { calls, run: async (_m: string, i: unknown) => { calls.push(i); return { response: AI_TEXT, usage: { prompt_tokens: 200, completion_tokens: 60 } }; } }; };

  it("over budget: zero AI calls, rule-written summary", async () => {
    const a = ai(), { b, adds } = budget(1000);
    expect(await writeSummary(a, 40, "caution", checks, 7000, b)).toBe(fallbackSummary(40, "caution", checks));
    expect(a.calls.length).toBe(0);
    expect(adds.length).toBe(0);
  });
  it("under budget: calls AI and adds the neurons from usage", async () => {
    const a = ai(), { b, adds } = budget(10);
    expect(await writeSummary(a, 40, "caution", checks, 7000, b)).toBe(AI_TEXT);
    expect(a.calls.length).toBe(1);
    expect(adds).toEqual([neuronsFor(200, 60)]);
  });
  it("cap 0 means no cap", async () => {
    const a = ai(), { b } = budget(999_999, 0);
    await writeSummary(a, 40, "caution", checks, 7000, b);
    expect(a.calls.length).toBe(1);
  });
  it("no usage in the response: estimated from text length", async () => {
    const { b, adds } = budget(0);
    await writeSummary({ run: async () => ({ response: AI_TEXT }) }, 40, "caution", checks, 7000, b);
    expect(adds[0]).toBeGreaterThan(0);
  });
  it("D1 counter adds per UTC day", async () => {
    const s = new Store(fakeD1());
    expect(await s.aiUsed("2026-11-12")).toBe(0);
    await s.aiAdd("2026-11-12", 4.5);
    expect(await s.aiAdd("2026-11-12", 5)).toBe(9.5);
    expect(await s.aiUsed("2026-11-12")).toBe(9.5);
    expect(await s.aiUsed("2026-11-13")).toBe(0);
  });
});

// A counting fetch that answers the RPC node and the market feeds.
function world(opts: { pools?: string[]; rpcFailsFirst?: boolean; marketDown?: boolean } = {}) {
  const log: string[] = [];
  const seenRpc = new Set<number>();
  const pools = opts.pools ?? [];
  const code = readFileSync("test/fixtures/token-code.hex", "utf8").trim();
  const fetch = async (u: string, init?: RequestInit) => {
    log.push(u);
    if (u.startsWith("https://rpc.test")) {
      const calls = JSON.parse(String(init?.body)) as { id: number; method: string; params: any[] }[];
      const key = calls.length * 100 + calls[0].params.length; // a batch shape; each shape fails once when asked to
      if (opts.rpcFailsFirst && !seenRpc.has(key)) { seenRpc.add(key); return res({}, 503); }
      return res(calls.map((c) => ({ jsonrpc: "2.0", id: c.id, result: c.method === "eth_getCode" ? (opts.rpcFailsFirst ? code : "0x") : c.method === "eth_getStorageAt" ? "0x" + "0".repeat(64) : c.params[0]?.data?.startsWith("0x8da5cb5b") ? "0x" + "0".repeat(63) + "1" : "0x" })));
    }
    if (opts.marketDown && u.includes("api.")) return res({}, 503);
    if (u.includes("/token-profiles/")) return res(pools.map((t) => ({ chainId: "robinhood", tokenAddress: t })));
    if (u.includes("/tokens/v1/robinhood/")) return res(pools.map((t, i) => ({ chainId: "robinhood", baseToken: { address: t, symbol: "T" + i, name: "T" }, pairAddress: "0x" + String(i + 1).padStart(40, "0"), dexId: "d", liquidity: { usd: 50_000 }, txns: { h24: { buys: 1, sells: 1 } }, priceUsd: "1", fdv: 1, pairCreatedAt: NOW - 3 * 3_600_000, volume: { h24: 1000 - i } })));
    if (u.includes("new_pools")) return res({}, 503);
    if (u.includes("dexscreener") || u.includes("geckoterminal")) return res([]);
    return res({ ok: true });
  };
  const deps = (): ScanDeps => ({ rpc: createRpcClient({ url: "https://rpc.test", fetch, sleep: async () => {} }), fetch, sleep: async () => {}, now: () => NOW, tickerOthers: async () => 0 });
  return { log, fetch, deps };
}

const addr = (n: number) => "0x" + n.toString(16).padStart(40, "a");

describe("subrequest ceilings (Free plan: 50)", () => {
  it("one scan stays under 10 fetches even when each RPC batch fails once and the market is down", async () => {
    const w = world({ rpcFailsFirst: true, marketDown: true });
    await scanToken(addr(1), w.deps());
    expect(w.log.length).toBeLessThanOrEqual(10);
    expect(w.log.filter((u) => u.startsWith("https://rpc.test")).length).toBe(4); // two batches, two tries each
  });

  it("radar scans at most newPerRun new pools per run and carries the rest to the next run", async () => {
    const pools = [1, 2, 3, 4, 5].map(addr);
    const w = world({ pools });
    const store = new Store(fakeD1());
    const d = w.deps();
    const a = await runRadar(store, d, d);
    expect(a.scanned).toBe(RADAR.newPerRun);
    const b = await runRadar(store, d, d);
    expect(b.scanned).toBe(RADAR.newPerRun);
    const c = await runRadar(store, d, d);
    expect(c.scanned).toBe(1);
    expect((await store.radarSeen(pools)).size).toBe(5);
  });

  it("watch re-reads at most perRun tokens, oldest checked first, and rotates", async () => {
    const w = world();
    const store = new Store(fakeD1());
    const state = { owner: null, impl: null, liquidity_usd: null, score: 0, supply: null };
    // chat c1..c6, checked at NOW-6000 ... NOW-1000: c1 is the oldest.
    for (let i = 1; i <= 6; i++) await store.watchUpsert("c" + i, addr(i), "T", state, NOW - (7 - i) * 1000);
    const bot: BotDeps = { store, scan: w.deps(), fetch: w.fetch as typeof fetch, botToken: "t", now: () => NOW };
    const first = await runWatchCron(bot);
    expect(first.checked).toBe(WATCH.perRun);
    const left = (await store.watchOldestChecked(10)).map((r) => r.chat_id);
    expect(left.slice(0, 2)).toEqual(["c5", "c6"]); // the two never re-read are now the oldest
    const second = await runWatchCron(bot);
    expect(second.checked).toBe(WATCH.perRun);
    expect((await store.watchOldestChecked(10)).every((r) => r.last_checked_ms === NOW)).toBe(true); // all six covered in two runs
  });
});

describe("scan count for /v1/stats", () => {
  it("counts every saved scan since the given time, any source (live 2026-11-12: stats showed 0 scans)", async () => {
    const worker = (await import("../src/worker.ts")).default;
    const DB = fakeD1();
    const store = new Store(DB);
    const r = { address: "0x" + "1".repeat(40), score: 90, verdict: "clean" } as any;
    await store.saveScan(r, null, "web", 1000);
    await store.saveScan(r, null, "telegram", 2000);
    await store.saveScan(r, null, "radar", 3000);
    const count = async (q: string) => (await (await worker.fetch(new Request("https://s/v1/scan/count" + q), { DB } as any, { waitUntil() {} } as any)).json() as any).count;
    expect(await count("")).toBe(3);
    expect(await count("?since=1500")).toBe(2);
    expect(await count("?since=abc")).toBe(3);
  });
});

describe("free scan limit key and transport (live review 2026-11-12)", () => {
  it("IPv6 callers share one /64 bucket, IPv4 stays per address", async () => {
    const { callerKey } = await import("../src/worker.ts");
    const k = (ip: string) => callerKey(new Request("https://s/", { headers: { "cf-connecting-ip": ip } }));
    expect(k("2001:db8:1:2:aaaa::1")).toBe(k("2001:0db8:0001:0002:ffff:1:2:3"));
    expect(k("2001:db8:1:2::1")).not.toBe(k("2001:db8:1:3::1"));
    expect(k("1.2.3.4")).toBe("1.2.3.4");
  });
  it("plain http is refused; https answers carry HSTS and nosniff", async () => {
    const worker = (await import("../src/worker.ts")).default;
    const DB = fakeD1();
    const ctx = { waitUntil() {} } as any;
    const r = await worker.fetch(new Request("http://scan.forge402.pro/v1/scan/rules"), { DB } as any, ctx);
    expect(r.status).toBe(400);
    const ok = await worker.fetch(new Request("https://scan.forge402.pro/v1/scan/rules"), { DB } as any, ctx);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
