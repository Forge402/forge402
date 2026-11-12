export type Status = "pass" | "flag" | "unknown";
export type Verdict = "clean" | "caution" | "risky";
export type MarketStatus = "ok" | "no_pool" | "unavailable";
export type Check = { id: string; label: string; value: string | number | boolean | null; status: Status; detail: string };

export type Market = {
  liquidity_usd: number | null;
  dex: string | null;
  pool: string | null;
  txns_24h: { buys: number; sells: number } | null;
  price_usd: number | null;
  fdv_usd: number | null;
  pool_age_hours: number | null;
  source: "dexscreener" | "geckoterminal";
  symbol: string | null;
  name: string | null;
};

// What the chain says. null = could not tell, never a guess.
export type ContractFacts = {
  token: string;
  isContract: boolean;
  codeSize: number;
  looksLikeToken: boolean | null;
  isClone: boolean;
  cloneTarget: string | null;
  implSlot: string | null; // EIP-1967 implementation address, when set
  scanned: "self" | "implementation";
  hasOwnerFunction: boolean | null;
  owner: string | null;
  ownerRenounced: boolean | null;
  hasMint: boolean | null;
  hasBlacklist: boolean | null;
  hasFeeSetter: boolean | null;
  hasPause: boolean | null;
  hasLimits: boolean | null;
  hasTradingToggle: boolean | null;
  hasUpgrade: boolean | null;
  totalSupply: string | null;
  decimals: number | null;
  symbol: string | null;
  name: string | null;
  ownerBalance: string | null;
};

export type ScanResult = {
  address: string;
  chain: "robinhood";
  symbol: string | null;
  name: string | null;
  score: number;
  verdict: Verdict;
  checks: Check[];
  market: {
    liquidity_usd: number | null; dex: string | null; pool: string | null;
    txns_24h: { buys: number; sells: number } | null;
    price_usd: number | null; fdv_usd: number | null; pool_age_hours: number | null;
  } | null;
  market_status: MarketStatus;
  summary: string;
  scanned_at: string;
  rules_version: string;
};
