// x402 v2 for the paid scan. Adapted from reinkeep/api/src/x402.ts: same wire shapes, same Priors facilitator, USDG on
// Robinhood Chain. Price comes from SCAN_PRICE_USD (default $0.02 = 20000 atomic). fetch is passed in, so tests hand in a fake.
export const X402_VERSION = 2;
export const NETWORK = "eip155:4663";
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const SCAN_PRICE_AMOUNT = "20000"; // default $0.02
export const SETTLE_FEE_MARGIN_ATOMIC = 2000; // the price must clear the facilitator's per-settlement fee by at least $0.002

const usdToAtomic = (v: string | undefined, dflt: string): number | null => {
  const t = (v ?? dflt).trim();
  if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(t)) return null;
  return Math.round(Number(t) * 1e6);
};
// Atomic USDG price for a paid scan, or null when invalid or below fee + margin (a loss-making payment must not be sold).
export function scanPriceAtomic(priceUsd?: string, settleFeeUsd?: string): string | null {
  const price = usdToAtomic(priceUsd, "0.02"), fee = usdToAtomic(settleFeeUsd, "0.015");
  if (price === null || fee === null || price < fee + SETTLE_FEE_MARGIN_ATOMIC) return null;
  return String(price);
}
export const DEFAULT_FACILITATOR = "https://facilitator.priors.trade";

export type Requirements = {
  scheme: "exact"; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};
export type VerifyResult = { isValid: boolean; invalidReason?: string; payer?: string };
export type SettleResult = { success: boolean; errorReason?: string; transaction?: string; network?: string; payer?: string };
export interface Facilitator {
  verify(paymentPayload: unknown, requirements: Requirements): Promise<VerifyResult>;
  settle(paymentPayload: unknown, requirements: Requirements): Promise<SettleResult>;
}
export class FacilitatorUnavailable extends Error {}

export const requirementsFor = (payTo: string, amount: string = SCAN_PRICE_AMOUNT): Requirements => ({
  scheme: "exact", network: NETWORK, amount, asset: USDG, payTo, maxTimeoutSeconds: 300, extra: { name: "Global Dollar", version: "1" },
});

export const toBase64 = (value: unknown): string => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
export function fromBase64(text: string): unknown {
  try {
    const bin = atob(text.trim());
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

// The 402 answer: { x402Version, accepts:[...], resource, description } (forge402/API.md).
export function paymentRequired(url: string, requirements: Requirements, description: string, error?: string) {
  return { x402Version: X402_VERSION, ...(error ? { error } : {}), accepts: [requirements], resource: url, description };
}

// The buyer's payload names the requirements it accepted. They must be exactly ours. null = fine, else a short reason.
export function checkPayload(payload: unknown, ours: Requirements): string | null {
  if (typeof payload !== "object" || payload === null) return "payment payload is not an object";
  const p = payload as { x402Version?: unknown; accepted?: unknown };
  if (p.x402Version !== X402_VERSION) return "payment payload is not x402 version 2";
  const a = p.accepted as Record<string, unknown> | undefined;
  if (typeof a !== "object" || a === null) return "payment payload has no accepted requirements";
  const same = (x: unknown, y: string) => typeof x === "string" && x.toLowerCase() === y.toLowerCase();
  if (a.scheme !== ours.scheme) return "wrong scheme";
  if (a.network !== ours.network) return "wrong network";
  if (!same(a.asset, ours.asset)) return "wrong asset";
  if (a.amount !== ours.amount) return "wrong amount";
  if (!same(a.payTo, ours.payTo)) return "wrong payTo";
  const extra = a.extra as { name?: unknown; version?: unknown } | undefined;
  if (a.maxTimeoutSeconds !== ours.maxTimeoutSeconds || extra?.name !== ours.extra.name || extra?.version !== ours.extra.version) return "accepted terms differ from the offer";
  return null;
}

// The EIP-3009 authorization nonce, the replay-guard key. undefined when the payload does not carry one.
export function paymentNonce(payload: unknown): string | undefined {
  const n = (payload as any)?.payload?.authorization?.nonce;
  return typeof n === "string" && /^0x[0-9a-fA-F]{64}$/.test(n) ? n.toLowerCase() : undefined;
}

export function createFacilitator(opts: { url: string; apiKey?: string; fetch: typeof fetch; timeoutMs?: number }): Facilitator {
  const base = opts.url.replace(/\/+$/, "");
  async function call(path: "/verify" | "/settle", paymentPayload: unknown, requirements: Requirements, marker: "isValid" | "success"): Promise<any> {
    let data: unknown;
    try {
      const res = await opts.fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json", ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
        body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload, paymentRequirements: requirements }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
      data = await res.json();
    } catch {
      throw new FacilitatorUnavailable("facilitator unreachable");
    }
    // A refusal can carry a 4xx status with the normal body; anything without the marker field is an outage.
    if (typeof data !== "object" || data === null || !(marker in data)) throw new FacilitatorUnavailable("facilitator answered unexpectedly");
    return data;
  }
  return { verify: (p, r) => call("/verify", p, r, "isValid"), settle: (p, r) => call("/settle", p, r, "success") };
}
