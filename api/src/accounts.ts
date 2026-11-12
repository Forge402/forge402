// Prepaid keys and wallet sign-in: the business rules behind /v1/keys*, /v1/auth/*, /v1/wallet*.
import type { Env } from "./env.ts";
import { ApiError, notConfigured } from "./errors.ts";
import { discountPct, holderConfig, isHolder } from "./holder.ts";
import { looksLikeKey, newKey, randomHex, sha256Hex } from "./keys.ts";
import { jsonRes, x402Begin, type PayDeps } from "./pay.ts";
import { microOfUsd, refundMinMicro, settleFeeMicro, usd } from "./pricing.ts";
import type { KeyRow } from "./repo.ts";
import { NONCE_TTL_MS, TOKEN_PREFIX, readSession, signInMessage, signSession, signatureMatches } from "./session.ts";
import { isAddress } from "./x402.ts";

export const MIN_DEPOSIT_USD = 1;
export const MAX_DEPOSIT_USD = 1000;
export const HOLDER_FREE_PER_DAY = 25;
export const GUEST_FREE_PER_DAY = 5;
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const bearer = (req: Request): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1] : null;
};

// The live key behind `Authorization: Bearer forge_sk_...`; 401 invalid_key for anything else.
export async function keyFromRequest(req: Request, d: PayDeps): Promise<KeyRow> {
  const token = bearer(req);
  const bad = new ApiError(401, "invalid_key", "Unknown, closed or malformed API key.");
  if (!token || !looksLikeKey(token)) throw bad;
  const row = await d.repo.keyByHash(await sha256Hex(token));
  if (!row || row.revoked) throw bad;
  return row;
}

// The wallet behind a session token; 401 invalid_key when missing, tampered or expired.
export async function walletFromRequest(req: Request, env: Env, d: PayDeps): Promise<string> {
  if (!env.SESSION_SECRET) throw notConfigured("Wallet sign-in (SESSION_SECRET)");
  const token = bearer(req);
  const addr = token?.startsWith(TOKEN_PREFIX) ? await readSession(token, env.SESSION_SECRET, d.now()) : null;
  if (!addr) throw new ApiError(401, "invalid_key", "Sign in again: the session is missing, tampered with or expired.");
  return addr;
}

function parseDeposit(body: unknown): { amount: number; label: string | null } {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const v = b.amount_usd;
  if (typeof v !== "number" || !Number.isFinite(v) || v < MIN_DEPOSIT_USD || v > MAX_DEPOSIT_USD) {
    throw new ApiError(400, "bad_request", `amount_usd must be a number from ${MIN_DEPOSIT_USD} to ${MAX_DEPOSIT_USD}.`);
  }
  const label = b.label === undefined || b.label === null ? null : typeof b.label === "string" && b.label.length <= 64 ? b.label : undefined;
  if (label === undefined) throw new ApiError(400, "bad_request", "label must be a string of at most 64 characters.");
  return { amount: microOfUsd(v), label };
}

// POST /v1/keys: x402 deposit, then a new key. The deposit is settled BEFORE the key exists; if the key cannot be
// saved after the money moved, the amount is booked as a refund so it is never lost.
// A deposit pays the facilitator's settle fee out of the amount: the key is credited amount - fee.
const depositCredit = (amount: number, d: PayDeps): number => {
  const fee = settleFeeMicro(d.env);
  if (amount <= fee) throw new ApiError(400, "bad_request", `amount_usd must be more than the ${usd(fee)} USDG settlement fee.`);
  return amount - fee;
};

export async function createKeyRoute(req: Request, body: unknown, d: PayDeps): Promise<Response> {
  const { amount, label } = parseDeposit(body);
  const credit = depositCredit(amount, d);
  const r = await x402Begin(req, amount, `Forge402 prepaid key: ${usd(amount)} USDG deposit`, d, false);
  if (r instanceof Response) return r;
  const s = await r.settle();
  if (!s.ok) return s.res;
  const { key, id } = newKey();
  try {
    await d.repo.createKey({ id, hash: await sha256Hex(key), owner: r.payer, label, amount: credit, now: d.now() });
  } catch {
    await d.repo.addRefund(d.now(), r.payer, credit, "failed_deposit", r.nonce);
    throw new ApiError(500, "internal_error", "The deposit was received but the key could not be saved. It is booked as a refund to your wallet.");
  }
  return jsonRes(200, { key, id, balance_usd: usd(credit), fee_usd: usd(r.fee), owner: r.payer, label }, { "payment-response": s.header, "x-forge-settle-fee-usd": usd(r.fee) });
}

// POST /v1/keys/topup: Bearer key plus an x402 deposit adds to its balance.
export async function topupRoute(req: Request, body: unknown, d: PayDeps): Promise<Response> {
  const key = await keyFromRequest(req, d);
  const { amount } = parseDeposit(body);
  const credit = depositCredit(amount, d);
  const r = await x402Begin(req, amount, `Forge402 key top-up: ${usd(amount)} USDG`, d, false);
  if (r instanceof Response) return r;
  const s = await r.settle();
  if (!s.ok) return s.res;
  if (!(await d.repo.credit(key.id, credit))) {
    await d.repo.addRefund(d.now(), r.payer, credit, "failed_deposit", r.nonce); // the key was closed while the payment ran
    throw new ApiError(409, "invalid_key", "The key was closed during the top-up. The deposit is booked as a refund to your wallet.");
  }
  const fresh = await d.repo.keyById(key.id);
  return jsonRes(200, { id: key.id, balance_usd: usd(fresh?.balance_micro ?? key.balance_micro + credit), fee_usd: usd(r.fee) }, { "payment-response": s.header, "x-forge-settle-fee-usd": usd(r.fee) });
}

export async function keyMe(req: Request, d: PayDeps): Promise<Response> {
  const k = await keyFromRequest(req, d);
  const recent = await d.repo.recent(k.id, 20);
  return jsonRes(200, {
    id: k.id, owner: k.owner, label: k.label, balance_usd: usd(k.balance_micro), spent_usd: usd(k.spent_micro), calls: k.calls,
    recent: recent.map((r) => ({ ts: new Date(r.ts).toISOString(), model: r.model, tokens_in: r.tokens_in, tokens_out: r.tokens_out, cost_usd: r.cost_usd, cache: r.cache })),
  });
}

export async function closeKeyById(id: string, d: PayDeps): Promise<Response> {
  const refunded = await d.repo.closeKey(id, d.now());
  if (refunded === null) throw new ApiError(401, "invalid_key", "The key is already closed.");
  return jsonRes(200, { closed: true, id, refunded_usd: usd(refunded) });
}

export async function deleteKeyMe(req: Request, d: PayDeps): Promise<Response> {
  return closeKeyById((await keyFromRequest(req, d)).id, d);
}

// ---- wallet sign-in ----

const addressOf = (body: unknown): string => {
  const a = (body as { address?: unknown } | null)?.address;
  if (!isAddress(a)) throw new ApiError(400, "bad_request", "address must be a 0x wallet address (40 hex characters).");
  return a;
};

export async function authNonce(req: Request, env: Env, body: unknown, d: PayDeps): Promise<Response> {
  if (!env.SESSION_SECRET) throw notConfigured("Wallet sign-in (SESSION_SECRET)");
  const address = addressOf(body);
  const nonce = randomHex(16);
  const message = signInMessage(address, nonce, new Date(d.now()).toISOString(), new URL(req.url).hostname);
  await d.repo.sweepNonces(d.now());
  await d.repo.claimNonce(nonce, "auth", d.now() + NONCE_TTL_MS, address.toLowerCase(), message);
  return jsonRes(200, { message, nonce });
}

export async function authVerify(env: Env, body: unknown, d: PayDeps): Promise<Response> {
  if (!env.SESSION_SECRET) throw notConfigured("Wallet sign-in (SESSION_SECRET)");
  const address = addressOf(body);
  const { signature, nonce } = (body ?? {}) as { signature?: unknown; nonce?: unknown };
  if (typeof signature !== "string" || typeof nonce !== "string") throw new ApiError(400, "bad_request", "Send address, signature and nonce.");
  const message = await d.repo.takeAuthNonce(nonce, address, d.now()); // single use: a replayed signature finds nothing
  if (!message) throw new ApiError(401, "invalid_key", "The nonce is unknown, used or expired. Ask for a new one.");
  if (!(await signatureMatches(address, message, signature))) throw new ApiError(401, "invalid_key", "The signature does not match this wallet.");
  return jsonRes(200, { token: await signSession(address, env.SESSION_SECRET, d.now()), address: address.toLowerCase() });
}

export async function walletInfo(req: Request, env: Env, d: PayDeps): Promise<Response> {
  const address = await walletFromRequest(req, env, d);
  const [keys, owed, discount, holder] = await Promise.all([
    d.repo.keysOfOwner(address), d.repo.refundsOwed(address), discountPct(env, address, d.fetch), isHolder(env, address, d.fetch),
  ]);
  const used = await d.repo.usedDaily(`wallet:${address}`, utcDay(d.now()));
  return jsonRes(200, {
    address,
    keys: keys.map((k) => ({ id: k.id, label: k.label, balance_usd: usd(k.balance_micro), spent_usd: usd(k.spent_micro), created: new Date(k.created).toISOString(), revoked: !!k.revoked })),
    refunds_owed_usd: usd(owed), // total owed; the owner pays it out once it reaches refund_min_usd
    refund_min_usd: usd(refundMinMicro(env)),
    discount_pct: discount,
    free_messages_left: holder && holderConfig(env) ? Math.max(0, HOLDER_FREE_PER_DAY - used) : 0,
  });
}

export async function walletCloseKey(req: Request, env: Env, id: string, d: PayDeps): Promise<Response> {
  const address = await walletFromRequest(req, env, d);
  const key = await d.repo.keyById(id);
  // Someone else's key looks the same as a missing one.
  if (!key || key.owner !== address) throw new ApiError(404, "invalid_key", "No such key on this wallet.");
  return closeKeyById(id, d);
}
