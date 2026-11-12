import { describe, expect, it } from "vitest";
import { evaluate, RULES, rulesDocument, verdictFor, type EvalInput } from "../src/rules.ts";
import type { ContractFacts, Market } from "../src/types.ts";

const facts = (o: Partial<ContractFacts> = {}): ContractFacts => ({
  token: "0x" + "1".repeat(40), isContract: true, codeSize: 5000, looksLikeToken: true, isClone: false, cloneTarget: null, implSlot: null, scanned: "self",
  hasOwnerFunction: true, owner: "0x" + "0".repeat(40), ownerRenounced: true, hasMint: false, hasBlacklist: false, hasFeeSetter: false, hasPause: false,
  hasLimits: false, hasTradingToggle: false, hasUpgrade: false, totalSupply: "1000", decimals: 18, symbol: "AAA", name: "Aaa", ownerBalance: null, ...o,
});
const market = (o: Partial<Market> = {}): Market => ({ liquidity_usd: 50_000, dex: "uniswap", pool: "0xp", txns_24h: { buys: 30, sells: 25 }, price_usd: 1, fdv_usd: 1e6, pool_age_hours: 200, source: "dexscreener", symbol: "AAA", name: "Aaa", ...o });
const run = (f: Partial<ContractFacts> = {}, m: Market | null = market(), o: Partial<EvalInput> = {}) => evaluate({ facts: facts(f), market: m, marketUnavailable: false, tickerOthers: 0, ...o });

describe("scoring", () => {
  it("a clean token scores 100 / clean", () => { const e = run(); expect(e.score).toBe(100); expect(e.verdict).toBe("clean"); expect(e.fired).toEqual([]); });
  it("no code is 0 / risky", () => { const e = run({ isContract: false }); expect(e.score).toBe(0); expect(e.verdict).toBe("risky"); });
  it("mint with a live owner costs 30 plus 10 for the owner", () => expect(run({ hasMint: true, ownerRenounced: false, owner: "0x" + "a".repeat(40) }).score).toBe(60));
  it("mint with a renounced owner costs nothing", () => expect(run({ hasMint: true }).score).toBe(100));
  it("mint with unknown owner costs 12", () => expect(run({ hasMint: true, ownerRenounced: null, hasOwnerFunction: false, owner: null }).score).toBe(88));
  it("upgradeable proxy costs 25", () => expect(run({ implSlot: "0x" + "b".repeat(40) }).score).toBe(75));
  it("stacks blacklist, fee, pause", () => expect(run({ hasBlacklist: true, hasFeeSetter: true, hasPause: true }).score).toBe(50));
  it("liquidity tiers replace each other", () => {
    expect(run({}, market({ liquidity_usd: 4000 })).score).toBe(85);
    expect(run({}, market({ liquidity_usd: 800 })).score).toBe(75);
  });
  it("20 buys and no sells costs 40", () => expect(run({}, market({ txns_24h: { buys: 20, sells: 0 } })).score).toBe(60));
  it("19 buys and no sells is fine", () => expect(run({}, market({ txns_24h: { buys: 19, sells: 0 } })).score).toBe(100));
  it("no pool costs 25, unreadable market costs nothing", () => {
    expect(run({}, null).score).toBe(75);
    expect(run({}, null, { marketUnavailable: true }).score).toBe(100);
  });
  it("pool age tiers", () => {
    expect(run({}, market({ pool_age_hours: 0.5 })).score).toBe(90);
    expect(run({}, market({ pool_age_hours: 5 })).score).toBe(95);
  });
  it("young pool detail says what the risk is, so the AI summary has no gap to fill (TEAK live 2026-11-12)", () => {
    const d = run({}, market({ pool_age_hours: 17.1 })).checks.find((c) => c.id === "pool_age")!.detail;
    expect(d).toMatch(/trading history/);
    expect(d).toMatch(/liquidity/);
  });
  it("ticker reuse tiers", () => {
    expect(run({}, market(), { tickerOthers: 1 }).score).toBe(85);
    expect(run({}, market(), { tickerOthers: 3 }).score).toBe(75);
  });
  it("owner share tiers use balance over supply", () => {
    expect(run({ ownerRenounced: false, owner: "0x" + "a".repeat(40), ownerBalance: "60" }).score).toBe(75); // 6%: -10 owner, -15
    expect(run({ ownerRenounced: false, owner: "0x" + "a".repeat(40), ownerBalance: "300" }).score).toBe(60); // 30%: -10, -30
  });
  it("not an ERC-20 costs 40 and leaves powers unknown", () => {
    const e = run({ looksLikeToken: false, hasMint: null, hasBlacklist: null, hasFeeSetter: null, hasPause: null, hasLimits: null, hasTradingToggle: null, hasUpgrade: null });
    expect(e.score).toBe(60);
    expect(e.checks.find((c) => c.id === "mint")!.status).toBe("unknown");
  });
  it("never drops below 0", () => expect(run({ hasMint: true, ownerRenounced: false, implSlot: "0x" + "b".repeat(40), hasBlacklist: true, hasPause: true, hasFeeSetter: true }, null, { tickerOthers: 5 }).score).toBe(0));
  it("verdict thresholds", () => { expect(verdictFor(80)).toBe("clean"); expect(verdictFor(79)).toBe("caution"); expect(verdictFor(60)).toBe("caution"); expect(verdictFor(59)).toBe("risky"); });
});

describe("published rules", () => {
  it("serve every weight the scorer uses", () => {
    const doc = rulesDocument();
    expect(doc.rules).toHaveLength(RULES.length);
    expect(doc.rules.every((r) => r.points < 0 && r.label && r.reads)).toBe(true);
  });
  it("checks carry only the contract fields", () => {
    for (const c of run().checks) expect(Object.keys(c).sort()).toEqual(["detail", "id", "label", "status", "value"]);
  });
});
