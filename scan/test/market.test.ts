import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classifyOutcome } from "../src/radar.ts";
import { parseDexPairs, parseGeckoPools, readMarket } from "../src/market.ts";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const WALLET = "0x0339f5459FC690aC85F1782e15782A151b4A9E1b";
const NOW = 1794457800000 + 3600_000; // fixture era: pair created 1783645324000

describe("DexScreener parsing (real response)", () => {
  const m = parseDexPairs(fx("dexscreener-token-pairs.json"), WALLET, NOW)!;
  it("reads the market", () => {
    expect(m.source).toBe("dexscreener");
    expect(m.symbol).toBe("WALLET");
    expect(m.dex).toBe("uniswap");
    expect(m.liquidity_usd).toBeGreaterThan(1_000_000);
    expect(m.txns_24h!.buys).toBeGreaterThan(0);
    expect(m.pool_age_hours).toBeGreaterThan(24);
  });
  it("ignores pairs where the token is not the base, and non-arrays", () => {
    expect(parseDexPairs(fx("dexscreener-token-pairs.json"), "0x" + "9".repeat(40), NOW)).toBeNull();
    expect(parseDexPairs({ pairs: null }, WALLET, NOW)).toBeNull();
  });
});

describe("GeckoTerminal parsing (real response)", () => {
  it("reads the market", () => {
    const m = parseGeckoPools(fx("gecko-token-pools.json"), WALLET, NOW)!;
    expect(m.source).toBe("geckoterminal");
    expect(m.liquidity_usd).toBeGreaterThan(0);
    expect(m.pool_age_hours).toBeGreaterThan(24);
    expect(m.dex).toBe("uniswap-v3-robinhood");
  });
  it("garbage gives null", () => expect(parseGeckoPools({ data: [{ attributes: 1 }] }, WALLET, NOW)).toBeNull());
});

describe("readMarket fallback", () => {
  const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const deps = (f: (u: string) => Response) => ({ fetch: async (u: string) => f(u), sleep: async () => {}, now: () => NOW });
  it("falls back to Gecko when DexScreener has no pool", async () => {
    const r = await readMarket(WALLET, deps((u) => (u.includes("dexscreener") ? res([]) : res(fx("gecko-token-pools.json")))));
    expect(r.market?.source).toBe("geckoterminal");
  });
  it("says unavailable when both sources fail", async () => {
    const r = await readMarket(WALLET, deps(() => res({}, 503)));
    expect(r).toEqual({ market: null, unavailable: true });
  });
  it("no pool anywhere is not unavailable", async () => {
    const r = await readMarket(WALLET, deps((u) => (u.includes("dexscreener") ? res([]) : res({ data: [] }))));
    expect(r).toEqual({ market: null, unavailable: false });
  });
});

describe("radar outcome", () => {
  it.each([[10000, 9000, "held"], [10000, 13000, "up"], [10000, 7000, "down"], [10000, 900, "drained"], [10000, 400, "drained"], [300, 100, "drained"], [10000, null, null]] as const)(
    "%s -> %s is %s", (a, b, o) => expect(classifyOutcome(a, b)).toBe(o));
});
