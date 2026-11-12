// All money here is integer micro-USD (6 decimals, equal to USDG atomic units). Rates are posted with up to 3
// decimals per 1M tokens, so they are turned into integer "per 1000 micro" first: float math would turn
// 1000 * 0.021 into 21.000000000000004 and round a whole micro-dollar the wrong way.
import type { Model } from "./models.ts";

export const DEFAULT_MAX_TOKENS = 1024;
export const CACHE_HIT_PCT = 50;

const milli = (usdPerM: number): number => Math.round(usdPerM * 1000);

// Cost of tokens at the posted rate, rounded up to a whole micro-USD (never rounds a real charge down to nothing).
export function costMicro(m: Pick<Model, "inPerM" | "outPerM">, tokensIn: number, tokensOut: number): number {
  const thousandths = tokensIn * milli(m.inPerM) + tokensOut * milli(m.outPerM);
  return Math.ceil(thousandths / 1000);
}

// What the caller is billed: list cost, halved on a cache hit, then the holder discount. Rounded up.
export function billMicro(listMicro: number, opts: { hit?: boolean; discountPct?: number } = {}): number {
  if (listMicro <= 0) return 0;
  const pct = opts.hit ? CACHE_HIT_PCT : 100;
  const off = 100 - Math.min(100, Math.max(0, opts.discountPct ?? 0));
  return Math.ceil((listMicro * pct * off) / 10_000);
}

const bytes = (s: string): number => new TextEncoder().encode(s).length;

// Generous input estimate for the ceiling: 3 bytes per token plus framing per message. Real tokenizers average
// 3.5 to 4.5 bytes per token on prose, so this overshoots and the difference comes back as a refund.
export function estimateInputTokens(messagesAndTools: unknown, messageCount: number): number {
  return Math.ceil(bytes(JSON.stringify(messagesAndTools)) / 3) + 8 * messageCount + 16;
}

// Honest estimate for when the upstream gives no usage numbers: 4 bytes per token.
export const estimateTokens = (text: string): number => Math.ceil(bytes(text) / 4);

// Chat ceiling at the posted rate: the whole estimated input plus every token the caller allows as output.
export function ceilingMicro(m: Pick<Model, "inPerM" | "outPerM">, estIn: number, maxTokens: number): number {
  return Math.max(1, costMicro(m, estIn, maxTokens));
}

// Money out of the ceiling that the caller gets back: ceiling minus what the call really cost (never negative).
export const refundMicro = (ceiling: number, actual: number): number => Math.max(0, ceiling - actual);

export const usd = (micro: number): string => (micro / 1_000_000).toFixed(6);
export const microOfUsd = (v: number): number => Math.round(v * 1_000_000);

// Priors charges the merchant this much per settled x402 payment (USDG). Env value is USD; invalid -> default.
export const DEFAULT_SETTLE_FEE_MICRO = 15_000;
export const DEFAULT_REFUND_MIN_MICRO = 50_000;
function envMicro(v: string | undefined, fallback: number): number {
  const t = v?.trim() ?? "";
  if (!/^\d{1,3}(\.\d{1,6})?$/.test(t)) return fallback;
  return microOfUsd(Number(t));
}
export const settleFeeMicro = (env: { SETTLE_FEE_USD?: string }): number => envMicro(env.SETTLE_FEE_USD, DEFAULT_SETTLE_FEE_MICRO);
export const refundMinMicro = (env: { REFUND_MIN_USD?: string }): number => envMicro(env.REFUND_MIN_USD, DEFAULT_REFUND_MIN_MICRO);

// Our Cloudflare cost for these tokens, rounded up. The break-even floor for any call where the model ran.
// ponytail: catalog list price stands in for the real neuron bill; recheck if Cloudflare changes the unit.
export const cfCostMicro = (m: Pick<Model, "cfInPerM" | "cfOutPerM">, tokensIn: number, tokensOut: number): number =>
  costMicro({ inPerM: m.cfInPerM, outPerM: m.cfOutPerM }, tokensIn, tokensOut);
