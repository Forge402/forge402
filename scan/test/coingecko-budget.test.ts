// CoinGecko daily call budget: scans get the whole day, radar and watch at most a third each.
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { Store } from "../src/store.ts";
import { readMarket, discoverYoungPools } from "../src/market.ts";

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
const TOKEN = "0x" + "a".repeat(40);
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const dexPair = [{ chainId: "robinhood", baseToken: { address: TOKEN, symbol: "T", name: "T" }, pairAddress: "0x" + "1".repeat(40), dexId: "d", liquidity: { usd: 5 }, txns: { h24: { buys: 1, sells: 1 } }, priceUsd: "1", fdv: 1, pairCreatedAt: NOW }];

// Counts requests per host. CoinGecko answers with `cg` (status), DexScreener with a pair.
function feeds(cg = 503) {
  const log = { cg: 0, dex: 0 };
  const fetch = async (u: string) => {
    if (u.includes("coingecko")) { log.cg++; return res({}, cg); }
    if (u.includes("dexscreener")) { log.dex++; return u.includes("/token-pairs/") ? res(dexPair) : res([]); }
    return res({}, 503);
  };
  return { log, fetch };
}
const deps = (f: ReturnType<typeof feeds>, gate?: () => Promise<boolean>) => ({ fetch: f.fetch, sleep: async () => {}, now: () => NOW, coingeckoKey: "k", cgGate: gate });
const day = new Date(NOW).toISOString().slice(0, 10);
const used = async (s: Store, caller: string) => (await (s as any).db.prepare("SELECT COALESCE(SUM(n),0) AS n FROM cg_usage WHERE day = ? AND caller = ?").bind(day, caller).first()).n;

describe("CoinGecko daily budget", () => {
  it("budget spent: no CoinGecko fetch, DexScreener answers", async () => {
    const s = new Store(fakeD1()), f = feeds();
    const gate = s.cgGate("scan", 2, () => NOW);
    await readMarket(TOKEN, deps(f, gate)); await readMarket(TOKEN, deps(f, gate));
    expect(f.log.cg).toBe(2);
    const r = await readMarket(TOKEN, deps(f, gate));
    expect(f.log.cg).toBe(2); // third call never reached CoinGecko
    expect(r.market?.source).toBe("dexscreener");
  });

  it("failed calls count too, and a spent budget with DexScreener down is unavailable", async () => {
    const s = new Store(fakeD1()), f = feeds(503);
    const gate = s.cgGate("scan", 5, () => NOW);
    await readMarket(TOKEN, deps(f, gate));
    expect(await used(s, "scan")).toBe(1); // CoinGecko answered 503, still counted
    const down = { fetch: async () => res({}, 503), sleep: async () => {}, now: () => NOW, coingeckoKey: "k", cgGate: s.cgGate("scan", 1, () => NOW) };
    expect(await readMarket(TOKEN, down)).toEqual({ market: null, unavailable: true });
  });

  it("radar and watch stop at a third; scans use the rest", async () => {
    const s = new Store(fakeD1());
    const radar = s.cgGate("radar", 30, () => NOW)!, watch = s.cgGate("watch", 30, () => NOW)!, scan = s.cgGate("scan", 30, () => NOW)!;
    let r = 0, w = 0, sc = 0;
    for (let i = 0; i < 30; i++) if (await radar()) r++;
    for (let i = 0; i < 30; i++) if (await watch()) w++;
    for (let i = 0; i < 30; i++) if (await scan()) sc++;
    expect([r, w, sc]).toEqual([10, 10, 10]); // scans got what is left of the 30, not their own third
    expect(await scan()).toBe(false); // day total used up
    expect(await used(s, "radar") + await used(s, "watch") + await used(s, "scan")).toBe(30);
  });

  it("a scan can use the whole day when radar and watch used nothing", async () => {
    const s = new Store(fakeD1()), scan = s.cgGate("scan", 9, () => NOW)!;
    let n = 0;
    for (let i = 0; i < 12; i++) if (await scan()) n++;
    expect(n).toBe(9);
  });

  it("the next UTC day starts fresh", async () => {
    const s = new Store(fakeD1());
    expect(await s.cgReserve("2026-11-12", "scan", 1, 1)).toBe(true);
    expect(await s.cgReserve("2026-11-12", "scan", 1, 1)).toBe(false);
    expect(await s.cgReserve("2026-11-13", "scan", 1, 1)).toBe(true);
  });

  it('"0" means no cap: no gate, no D1 writes', async () => {
    const s = new Store(fakeD1()), f = feeds();
    expect(s.cgGate("radar", 0, () => NOW)).toBeUndefined();
    for (let i = 0; i < 5; i++) await readMarket(TOKEN, deps(f, s.cgGate("scan", 0, () => NOW)));
    expect(f.log.cg).toBe(5);
    expect(await used(s, "scan")).toBe(0);
  });

  it("radar discovery skips CoinGecko new_pools when its share is spent", async () => {
    const s = new Store(fakeD1()), f = feeds();
    const gate = s.cgGate("radar", 3, () => NOW); // share = 1
    await discoverYoungPools(deps(f, gate), { maxAgeH: 72, minLiq: 1 });
    expect(f.log.cg).toBe(1);
    await discoverYoungPools(deps(f, gate), { maxAgeH: 72, minLiq: 1 });
    expect(f.log.cg).toBe(1);
  });
});
