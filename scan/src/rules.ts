// The published scoring rules. A scan starts at 100 and loses the points of every rule that fires. These weights are
// the ONLY place points live: GET /v1/scan/rules serves this table and evaluate() reads it, so the docs cannot drift.
import type { Check, ContractFacts, Market, Verdict } from "./types.ts";

export const RULES_VERSION = "2026-11-12.2";
export const START_SCORE = 100;
export const VERDICTS = { clean: 80, caution: 60 } as const; // >= 80 clean, 60-79 caution, below 60 risky

export const RULES = [
  { id: "no_code", points: 100, label: "No contract at this address", reads: "eth_getCode" },
  { id: "not_token", points: 40, label: "Code does not look like an ERC-20", reads: "transfer / balanceOf selectors" },
  { id: "upgradeable", points: 25, label: "Upgradeable proxy (EIP-1967 implementation slot set)", reads: "storage slot 0x3608..2bbc" },
  { id: "mint_live_owner", points: 30, label: "Mint function and the owner has not renounced", reads: "mint selectors + owner()" },
  { id: "mint_unknown_owner", points: 12, label: "Mint function, who controls it is unknown", reads: "mint selectors" },
  { id: "owner_active", points: 10, label: "Owner address still set (not renounced)", reads: "owner()" },
  { id: "blacklist", points: 20, label: "Blacklist or blocklist functions", reads: "blacklist selectors" },
  { id: "fee_setter", points: 15, label: "Changeable fees or taxes", reads: "setFee / setTax selectors" },
  { id: "pause", points: 15, label: "Transfers can be paused", reads: "pause selectors" },
  { id: "limits", points: 8, label: "Transaction or wallet limits can be changed", reads: "setMaxTx / setMaxWallet selectors" },
  { id: "trading_toggle", points: 10, label: "Trading can be switched on or off", reads: "enableTrading / setTradingEnabled selectors" },
  { id: "owner_holds_5", points: 15, label: "Owner wallet holds 5% or more of supply", reads: "balanceOf(owner)" },
  { id: "owner_holds_20", points: 30, label: "Owner wallet holds 20% or more of supply (replaces the 5% rule)", reads: "balanceOf(owner)" },
  { id: "no_pool", points: 25, label: "No pool found on Robinhood Chain", reads: "DexScreener, then GeckoTerminal" },
  { id: "liquidity_low", points: 15, label: "Liquidity under $5,000", reads: "pool liquidity in USD" },
  { id: "liquidity_tiny", points: 25, label: "Liquidity under $1,000 (replaces the $5,000 rule)", reads: "pool liquidity in USD" },
  { id: "one_sided_flow", points: 40, label: "20 or more buys and zero sells in 24 hours", reads: "24h transaction counts" },
  { id: "pool_age_1h", points: 10, label: "Pool is under 1 hour old", reads: "pool creation time" },
  { id: "pool_age_24h", points: 5, label: "Pool is under 24 hours old (replaces the 1 hour rule)", reads: "pool creation time" },
  { id: "ticker_reused_1", points: 15, label: "Same ticker scanned on another address in the last 7 days", reads: "Forge Scan's own history" },
  { id: "ticker_reused_3", points: 25, label: "Same ticker scanned on 3 or more other addresses in the last 7 days (replaces the rule above)", reads: "Forge Scan's own history" },
] as const;

type RuleId = (typeof RULES)[number]["id"];
const W = Object.fromEntries(RULES.map((r) => [r.id, r.points])) as Record<RuleId, number>;

export const verdictFor = (score: number): Verdict => (score >= VERDICTS.clean ? "clean" : score >= VERDICTS.caution ? "caution" : "risky");

export type EvalInput = {
  facts: ContractFacts;
  market: Market | null;
  marketUnavailable: boolean;
  tickerOthers: number; // other addresses with the same ticker seen in our scans in the last 7 days
};
export type Evaluation = { score: number; verdict: Verdict; checks: Check[]; fired: RuleId[] };

const c = (id: string, label: string, value: Check["value"], status: Check["status"], detail: string): Check => ({ id, label, value, status, detail });

export function evaluate(i: EvalInput): Evaluation {
  const { facts: f, market: m } = i;
  const fired: RuleId[] = [];
  const hit = (id: RuleId) => { fired.push(id); };

  if (!f.isContract) {
    hit("no_code");
    return { score: 0, verdict: "risky", checks: [c("bytecode", "Contract code", false, "flag", "No contract code at this address. It is a plain wallet or does not exist on Robinhood Chain.")], fired };
  }
  const checks: Check[] = [];
  checks.push(c("bytecode", "Contract code", f.codeSize, "pass", f.isClone ? `Minimal proxy (EIP-1167 clone) of ${f.cloneTarget}; the implementation was scanned.` : f.implSlot ? `Proxy contract; implementation ${f.implSlot} was scanned.` : `${f.codeSize} bytes of code.`));

  const tokenKnown = f.looksLikeToken === true;
  if (f.looksLikeToken === false) hit("not_token");
  checks.push(c("token_shape", "Looks like an ERC-20", f.looksLikeToken, f.looksLikeToken === false ? "flag" : tokenKnown ? "pass" : "unknown", f.looksLikeToken === false ? "No transfer or balanceOf function found, so the power checks below are not meaningful." : tokenKnown ? "transfer and balanceOf selectors present." : "Could not read the implementation code."));

  // proxy
  if (f.implSlot) hit("upgradeable");
  checks.push(c("proxy", "Upgradeable proxy", f.implSlot ? "upgradeable" : f.isClone ? "clone" : "none", f.implSlot ? "flag" : "pass", f.implSlot ? `The implementation at ${f.implSlot} can be swapped by whoever controls the proxy.` : f.isClone ? "EIP-1167 clones are fixed: the target cannot change." : "No EIP-1967 implementation set."));

  // owner
  if (f.hasOwnerFunction && f.ownerRenounced === false) hit("owner_active");
  checks.push(c("owner", "Owner renounced", f.ownerRenounced, f.ownerRenounced === true ? "pass" : f.ownerRenounced === false ? "flag" : "unknown",
    f.ownerRenounced === true ? "owner() returns the zero address." : f.ownerRenounced === false ? `owner() is ${f.owner}.` : f.hasOwnerFunction === false ? "No owner() function. Control, if any, sits behind roles that are not read here." : "owner() could not be read."));

  // powers
  const power = (id: string, label: string, has: boolean | null, rule: RuleId | null, yes: string, no: string) => {
    if (has && rule) hit(rule);
    checks.push(c(id, label, has, has === null ? "unknown" : has ? "flag" : "pass", has === null ? "Code could not be read as a token." : has ? yes : no));
  };
  // A renounced owner means nobody can call an onlyOwner mint, so a mint function then costs nothing.
  if (f.hasMint && f.ownerRenounced === false) hit("mint_live_owner");
  else if (f.hasMint && f.ownerRenounced === null) hit("mint_unknown_owner");
  checks.push(c("mint", "Mint function", f.hasMint, f.hasMint === null ? "unknown" : f.hasMint && f.ownerRenounced !== true ? "flag" : "pass",
    f.hasMint === null ? "Code could not be read as a token." : !f.hasMint ? "No common mint selector in the code." : f.ownerRenounced === true ? "A mint function exists but the owner is renounced." : f.ownerRenounced === false ? "A mint function exists and the owner can still call it." : "A mint function exists; who can call it is not known."));
  power("blacklist", "Blacklist functions", f.hasBlacklist, "blacklist", "Addresses can be blocked from trading.", "No common blacklist selector in the code.");
  power("fees", "Changeable fees or tax", f.hasFeeSetter, "fee_setter", "Fee or tax setters exist.", "No common fee setter in the code.");
  power("pause", "Pausable transfers", f.hasPause, "pause", "Transfers can be paused.", "No pause function in the code.");
  power("limits", "Transaction limits", f.hasLimits, "limits", "Max transaction or wallet limits can be changed.", "No limit setters in the code.");
  power("trading_toggle", "Trading switch", f.hasTradingToggle, "trading_toggle", "Trading can be switched on or off.", "No trading switch in the code.");

  // owner share of supply (one balanceOf read, only when the owner is a live address)
  let share: number | null = null;
  if (f.ownerBalance !== null && f.totalSupply !== null && BigInt(f.totalSupply) > 0n) share = Number((BigInt(f.ownerBalance) * 10000n) / BigInt(f.totalSupply)) / 100;
  if (share !== null && share >= 20) hit("owner_holds_20");
  else if (share !== null && share >= 5) hit("owner_holds_5");
  checks.push(c("owner_holding", "Owner's share of supply", share, share === null ? "unknown" : share >= 5 ? "flag" : "pass",
    share === null ? "Not read (no live owner address)." : `The owner address holds ${share}% of total supply.`));

  // market
  if (!m) {
    if (i.marketUnavailable) {
      // The source could not be reached: say so, never score it as "no pool".
      const why = "Market data unavailable right now (source rate-limited); not scored.";
      checks.push(c("liquidity", "Liquidity", null, "unknown", why));
      checks.push(c("flow_24h", "24h buys and sells", null, "unknown", why));
      checks.push(c("pool_age", "Pool age", null, "unknown", why));
    } else {
      hit("no_pool");
      checks.push(c("liquidity", "Liquidity", null, "flag", "No pool found for this token on Robinhood Chain."));
      checks.push(c("flow_24h", "24h buys and sells", null, "unknown", "No pool data."));
      checks.push(c("pool_age", "Pool age", null, "unknown", "No pool data."));
    }
  } else {
    const liq = m.liquidity_usd;
    if (liq !== null && liq < 1000) hit("liquidity_tiny"); else if (liq !== null && liq < 5000) hit("liquidity_low");
    checks.push(c("liquidity", "Liquidity", liq, liq === null ? "unknown" : liq < 5000 ? "flag" : "pass", liq === null ? "The source did not report liquidity." : `$${Math.round(liq).toLocaleString("en-US")} of liquidity across its pools (source: ${m.source}).`));
    const t = m.txns_24h;
    const oneSided = t !== null && t.buys >= 20 && t.sells === 0;
    if (oneSided) hit("one_sided_flow");
    checks.push(c("flow_24h", "24h buys and sells", t ? `${t.buys}/${t.sells}` : null, t === null ? "unknown" : oneSided ? "flag" : "pass", t === null ? "No transaction counts reported." : oneSided ? `${t.buys} buys and no sells in 24 hours. Nobody could sell, or nobody wanted to.` : `${t.buys} buys, ${t.sells} sells in 24 hours.`));
    const age = m.pool_age_hours;
    if (age !== null && age < 1) hit("pool_age_1h"); else if (age !== null && age < 24) hit("pool_age_24h");
    checks.push(c("pool_age", "Pool age", age, age === null ? "unknown" : age < 24 ? "flag" : "pass", age === null ? "Pool creation time not reported." : age < 24 ? `Oldest pool is ${age} hours old: very little trading history yet, and early liquidity is the easiest to pull.` : `Oldest pool is ${age} hours old.`));
  }

  // ticker reuse (own history)
  if (i.tickerOthers >= 3) hit("ticker_reused_3"); else if (i.tickerOthers >= 1) hit("ticker_reused_1");
  checks.push(c("ticker_reuse", "Ticker reused this week", i.tickerOthers, i.tickerOthers > 0 ? "flag" : "pass", i.tickerOthers > 0 ? `${i.tickerOthers} other address(es) with the same ticker were scanned in the last 7 days.` : "No other address with this ticker in our scans this week."));

  const score = Math.max(0, START_SCORE - fired.reduce((s, id) => s + W[id], 0));
  return { score, verdict: verdictFor(score), checks, fired };
}

// The public rules document served at GET /v1/scan/rules.
export function rulesDocument() {
  return {
    rules_version: RULES_VERSION,
    start: START_SCORE,
    verdicts: { clean: `score >= ${VERDICTS.clean}`, caution: `${VERDICTS.caution} <= score < ${VERDICTS.clean}`, risky: `score < ${VERDICTS.caution}` },
    note: "Each rule that fires subtracts its points from 100; the score never goes below 0. Powers are found by looking for common function selectors in the bytecode, so an unusual function name is not seen. A clean score means none of these switches were found. It is not proof of safety.",
    rules: RULES.map((r) => ({ id: r.id, label: r.label, points: -r.points, reads: r.reads })),
  };
}
