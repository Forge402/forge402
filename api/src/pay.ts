// x402 payment flow shared by chat, embeddings and key deposits: quote, check, verify, claim the nonce, settle.
// Order is always verify -> do the work -> settle, so failed work never moves money. Nonces make replays a 409.
import { ApiError, notConfigured } from "./errors.ts";
import type { Env } from "./env.ts";
import type { Repo } from "./repo.ts";
import { settleFeeMicro, usd } from "./pricing.ts";
import {
  DEFAULT_FACILITATOR, FacilitatorUnavailable, NETWORK, checkPayload, createFacilitator, fromBase64, isAddress, nonceOf, payerOf,
  paymentRequired, requirementsFor, settleWithRetry, toBase64, type Requirements,
} from "./x402.ts";

export type PayDeps = { env: Env; repo: Repo; fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number };

export const jsonRes = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

// 402 with the challenge in the body and, base64, in the PAYMENT-REQUIRED header.
export function challenge(url: string, requirements: Requirements | null, description: string, error?: { code: string; message: string }, feeHeader?: string): Response {
  const body = paymentRequired(url, requirements, description, error);
  return jsonRes(402, body, { "payment-required": toBase64(body), ...(feeHeader ? { "x-forge-settle-fee-usd": feeHeader } : {}) });
}

export type Paid = {
  payer: string;
  nonce: string;
  fee: number; // facilitator settle fee in micro-USD, already inside the signed amount
  requirements: Requirements;
  // Moves the money. ok=false carries the error response to hand to the caller. On a plain failure the nonce is
  // released so the same signature can be sent again; on settlement_pending it is kept and booked for reconciliation.
  settle(): Promise<{ ok: true; header: string } | { ok: false; res: Response }>;
  // The work failed or produced nothing: nothing was settled; free the nonce.
  release(): Promise<void>;
};

// Returns a Response to send back (quote, refusal, replay) or a Paid handle once the payment verified.
// addFee=true (calls): the signed amount is `amountMicro` + the settle fee. addFee=false (deposits): `amountMicro` is
// the whole signed amount and the caller deducts `fee` from what it credits.
export async function x402Begin(req: Request, amountMicro: number, description: string, d: PayDeps, addFee = true): Promise<Response | Paid> {
  const payTo = d.env.PAY_TO?.trim() ?? "";
  if (!isAddress(payTo)) throw notConfigured("Payment (PAY_TO)");
  if (!Number.isSafeInteger(amountMicro) || amountMicro < 1) throw new ApiError(400, "bad_request", "The amount is not payable.");
  const fee = settleFeeMicro(d.env);
  const feeUsd = usd(fee);
  description = description.replace(/[.\s]*$/, ".") + (addFee ? ` The amount includes a ${feeUsd} USDG settlement fee.` : ` A ${feeUsd} USDG settlement fee is deducted from the deposit.`);
  const requirements = requirementsFor(payTo, String(amountMicro + (addFee ? fee : 0)));
  const header = req.headers.get("payment-signature");
  if (!header) return challenge(req.url, requirements, description, undefined, feeUsd);

  const refuse = (code: string, message: string, status = 402) =>
    status === 402 ? challenge(req.url, requirements, description, { code, message }, feeUsd) : jsonRes(status, { error: { code, message } });
  const payload = fromBase64(header);
  const problem = checkPayload(payload, requirements);
  if (problem) return refuse("terms_mismatch", `What you signed does not match the quote: ${problem}.`);
  const nonce = nonceOf(payload);
  if (!nonce) return refuse("verify_invalid", "The payment has no authorization nonce.");
  if (await d.repo.hasNonce(nonce)) return refuse("payment_replayed", "This authorization was already used. Sign a new one.", 409);

  const facilitator = createFacilitator({ url: d.env.FACILITATOR_URL?.trim() || DEFAULT_FACILITATOR, apiKey: d.env.FACILITATOR_API_KEY, fetch: d.fetch });
  const unreachable = new ApiError(502, "upstream_error", "The payment service could not be reached. Nothing was charged.");
  let payer: string | null;
  try {
    const v = await facilitator.verify(payload, requirements);
    if (!v.isValid) return refuse("verify_invalid", `The facilitator rejected the payment: ${String(v.invalidReason ?? "unknown").slice(0, 100)}.`);
    payer = payerOf(payload, v.payer);
  } catch (e) {
    if (e instanceof FacilitatorUnavailable) throw unreachable;
    throw e;
  }
  if (!payer) return refuse("verify_invalid", "The payment does not say who paid.");
  // Two parallel requests with the same signature both verify; only one gets to keep the nonce.
  if (!(await d.repo.claimNonce(nonce, "x402", d.now() + 24 * 3600_000))) return refuse("payment_replayed", "This authorization was already used. Sign a new one.", 409);

  return {
    payer, nonce, requirements, fee,
    release: () => d.repo.releaseNonce(nonce),
    async settle() {
      try {
        const s = await settleWithRetry(facilitator, payload, requirements, d.sleep);
        if (s.success) return { ok: true as const, header: toBase64({ success: true, transaction: s.transaction, network: s.network ?? NETWORK, payer: s.payer ?? payer }) };
        if (s.errorReason === "settlement_pending") {
          // The transfer is out but unconfirmed, and it may still land. Keep the nonce (this signature is spent either
          // way) and book the whole signed amount for the owner to reconcile on chain, so a late confirmation is never
          // money taken for nothing.
          await d.repo.addRefund(d.now(), payer, Number(requirements.amount), "pending_settle", nonce);
          return {
            ok: false as const,
            res: jsonRes(409, {
              error: {
                code: "settlement_pending",
                message: "The payment is still unconfirmed on chain, so the result was withheld. Do not resend this signature. If the payment confirms, the full amount is owed back to your wallet.",
              },
            }),
          };
        }
        await d.repo.releaseNonce(nonce);
        return {
          ok: false as const,
          res: refuse("payment_required", `The payment could not be settled: ${String(s.errorReason ?? "unknown").slice(0, 100)}. Nothing moved; safe to retry.`),
        };
      } catch (e) {
        if (!(e instanceof FacilitatorUnavailable)) throw e;
        await d.repo.releaseNonce(nonce);
        return { ok: false as const, res: jsonRes(502, { error: { code: "upstream_error", message: "The payment service could not be reached. Nothing was charged." } }) };
      }
    },
  };
}
