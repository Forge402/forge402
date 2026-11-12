// x402 v2 pieces: the quote, a check of the buyer's payload, replay nonce, and a small hand-written client for the
// Priors facilitator (verify, settle). Adapted from the Reinkeep gate. No SDK: only fetch, so tests can hand in a fake.
// Wire shapes follow @x402/core v2: POST {x402Version, paymentPayload, paymentRequirements} to /verify and /settle;
// verify answers { isValid, invalidReason?, payer? }, settle answers { success, errorReason?, transaction, network, payer? }.

export const X402_VERSION = 2;
export const NETWORK = "eip155:4663";
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const DEFAULT_FACILITATOR = "https://facilitator.priors.trade";
export const MAX_TIMEOUT_SECONDS = 300;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const isAddress = (v: unknown): v is string => typeof v === "string" && ADDRESS.test(v);

export type Requirements = {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};

export type VerifyResult = { isValid: boolean; invalidReason?: string; payer?: string };
export type SettleResult = { success: boolean; errorReason?: string; transaction?: string; network?: string; payer?: string };

export interface Facilitator {
  verify(paymentPayload: unknown, requirements: Requirements): Promise<VerifyResult>;
  settle(paymentPayload: unknown, requirements: Requirements): Promise<SettleResult>;
}

// Thrown when the facilitator cannot be reached or answers something we do not understand. Carries no upstream text.
export class FacilitatorUnavailable extends Error {}

export function requirementsFor(payTo: string, amount: string): Requirements {
  return { scheme: "exact", network: NETWORK, amount, asset: USDG, payTo, maxTimeoutSeconds: MAX_TIMEOUT_SECONDS, extra: { name: "Global Dollar", version: "1" } };
}

export const toBase64 = (value: unknown): string => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));

export function fromBase64(text: string): unknown {
  try {
    const bin = atob(text.trim());
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

// The 402 body: the x402 challenge, plus the API's own { error: { code, message } } when a payment was refused.
export function paymentRequired(url: string, requirements: Requirements | null, description: string, error?: { code: string; message: string }) {
  return {
    x402Version: X402_VERSION,
    ...(error ? { error } : {}),
    resource: { url, description, mimeType: "application/json" },
    accepts: requirements ? [requirements] : [],
    description,
  };
}

// The payload the buyer signed names the requirements it accepted. They must be exactly ours.
// Returns null when fine, else a short reason.
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

type Auth = { from?: unknown; nonce?: unknown };
const authorization = (payload: unknown): Auth | undefined => (payload as { payload?: { authorization?: Auth } } | undefined)?.payload?.authorization;

// The EIP-3009 authorization nonce (32 bytes hex). It is single-use on chain; we also keep it to refuse replays early.
export function nonceOf(payload: unknown): string | null {
  const n = authorization(payload)?.nonce;
  return typeof n === "string" && /^0x[0-9a-fA-F]{64}$/.test(n) ? n.toLowerCase() : null;
}

// Who paid: the facilitator's word first, else the `from` of the signed authorization.
export function payerOf(payload: unknown, verifiedPayer?: string): string | null {
  if (isAddress(verifiedPayer)) return verifiedPayer.toLowerCase();
  const from = authorization(payload)?.from;
  return isAddress(from) ? from.toLowerCase() : null;
}

export function createFacilitator(opts: { url: string; apiKey?: string; fetch: typeof fetch; timeoutMs?: number }): Facilitator {
  const base = opts.url.replace(/\/+$/, "");
  async function call(path: "/verify" | "/settle", paymentPayload: unknown, requirements: Requirements, marker: "isValid" | "success"): Promise<any> {
    let data: unknown;
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
      const res = await opts.fetch(base + path, {
        method: "POST",
        headers,
        body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload, paymentRequirements: requirements }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
      data = await res.json();
    } catch {
      throw new FacilitatorUnavailable("facilitator unreachable");
    }
    // A refusal can come with a 4xx status but the normal body; anything without the marker field is an outage.
    if (typeof data !== "object" || data === null || !(marker in data)) throw new FacilitatorUnavailable("facilitator answered unexpectedly");
    return data;
  }
  return {
    verify: (p, r) => call("/verify", p, r, "isValid"),
    settle: (p, r) => call("/settle", p, r, "success"),
  };
}

const PENDING_WAITS = [1000, 2000, 2000]; // ms between /settle retries

// "settlement_pending" is not a failure: the transaction is out but not confirmed. Ask again with the SAME payload,
// a few short waits, about 5 s in total. Returns the last answer.
export async function settleWithRetry(f: Facilitator, payload: unknown, req: Requirements, sleep: (ms: number) => Promise<void>): Promise<SettleResult> {
  let settled = await f.settle(payload, req);
  for (const wait of PENDING_WAITS) {
    if (settled.success || settled.errorReason !== "settlement_pending") break;
    await sleep(wait);
    settled = await f.settle(payload, req);
  }
  return settled;
}
