// The scan itself: read the chain and the market in parallel, apply the published rules, write a summary.
import type { Fetcher, Sleep } from "./http-json.ts";
import { readContractFacts } from "./contract.ts";
import { readMarket } from "./market.ts";
import type { RpcClient } from "./rpc.ts";
import { evaluate, RULES_VERSION } from "./rules.ts";
import { writeSummary, type AiBudget } from "./summary.ts";
import { normalizeTicker } from "./ticker.ts";
import type { ContractFacts, Market, MarketStatus, ScanResult } from "./types.ts";

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type ScanDeps = {
  rpc: RpcClient;
  fetch: Fetcher;
  sleep: Sleep;
  now: () => number;
  // How many OTHER addresses carried this normalized ticker in our scans in the last 7 days.
  tickerOthers: (tickerNorm: string, address: string) => Promise<number>;
  ai?: { run(model: string, input: unknown): Promise<unknown> };
  aiBudget?: AiBudget;
  coingeckoKey?: string; // optional CoinGecko demo key (see market.ts)
  cgGate?: () => Promise<boolean>; // daily CoinGecko call budget (see Store.cgGate)
};

export type ScanDetail = { result: ScanResult; marketStatus: MarketStatus; facts: ContractFacts; market: Market | null; tickerNorm: string | null; fired: string[] };

export async function scanToken(addressInput: string, d: ScanDeps, opts: { summary?: boolean } = {}): Promise<ScanDetail> {
  const address = addressInput.toLowerCase();
  const [facts, mk] = await Promise.all([readContractFacts(d.rpc, address), readMarket(address, d)]);
  const symbol = facts.symbol ?? mk.market?.symbol ?? null;
  const name = facts.name ?? mk.market?.name ?? null;
  const tickerNorm = symbol ? normalizeTicker(symbol) : null;
  const tickerOthers = tickerNorm ? await d.tickerOthers(tickerNorm, address).catch(() => 0) : 0;
  const ev = evaluate({ facts, market: mk.market, marketUnavailable: mk.unavailable, tickerOthers });
  const m = mk.market;
  const marketStatus: MarketStatus = m ? "ok" : mk.unavailable ? "unavailable" : "no_pool";
  const result: ScanResult = {
    address,
    chain: "robinhood",
    symbol,
    name,
    score: ev.score,
    verdict: ev.verdict,
    checks: ev.checks,
    market: m ? { liquidity_usd: m.liquidity_usd, dex: m.dex, pool: m.pool, txns_24h: m.txns_24h, price_usd: m.price_usd, fdv_usd: m.fdv_usd, pool_age_hours: m.pool_age_hours } : null,
    market_status: marketStatus,
    summary: "",
    scanned_at: new Date(d.now()).toISOString(),
    rules_version: RULES_VERSION,
  };
  result.summary = await writeSummary(opts.summary === false ? undefined : d.ai, ev.score, ev.verdict, ev.checks, undefined, d.aiBudget);
  return { result, marketStatus, facts, market: m, tickerNorm, fired: ev.fired };
}
