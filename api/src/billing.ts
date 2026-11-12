// Who pays for a call, and how money moves around it. Three payers share one shape:
//   reserve(ceiling)  -> take the money (or the free slot) BEFORE the model runs; a Response means "stop, send this"
//   finish(actual)    -> after the work: keep `actual`, give the rest back
// A prepaid key reserves with one conditional UPDATE, so parallel calls can never overspend it.
import { ApiError } from "./errors.ts";
import type { KeyRow, Repo } from "./repo.ts";
import { jsonRes, x402Begin, type Paid, type PayDeps } from "./pay.ts";
import { refundMicro, usd } from "./pricing.ts";

export type Finish = { headers: Record<string, string> } | { fail: Response };

export interface Payer {
  tenant: string; // cache scope and ledger tenant
  owner: string | null; // wallet whose $FORGE balance sets the discount; known after reserve()
  free: boolean;
  // ceiling is the token ceiling; an x402 payer adds the settle fee on top for the quote and keeps it when settling.
  reserve(ceiling: number): Promise<Response | null>;
  finish(actual: number, produced: boolean): Promise<Finish>;
}

export function keyPayer(repo: Repo, key: KeyRow, now: () => number): Payer {
  let held = 0;
  return {
    tenant: key.id, owner: key.owner, free: false,
    async reserve(ceiling) {
      if (!(await repo.debit(key.id, ceiling))) {
        throw new ApiError(402, "insufficient_balance", "The key does not have enough balance for this call's ceiling. Top up with POST /v1/keys/topup, or lower max_tokens.");
      }
      held = ceiling;
      return null;
    },
    async finish(actual, produced) {
      const back = refundMicro(held, actual);
      // false = the key was closed while the call ran: its change goes to the owner's refunds instead.
      if (!(await repo.settleKey(key.id, back, actual, produced))) await repo.addRefund(now(), key.owner, back, "change", key.id);
      return { headers: {} };
    },
  };
}

export function x402Payer(req: Request, description: string, d: PayDeps): Payer {
  let paid: Paid | undefined;
  let held = 0;
  const p: Payer = {
    tenant: "", owner: null, free: false,
    async reserve(ceiling) {
      const r = await x402Begin(req, ceiling, description, d);
      if (r instanceof Response) return r;
      paid = r;
      held = ceiling;
      p.tenant = r.payer;
      p.owner = r.payer;
      return null;
    },
    async finish(actual, produced): Promise<Finish> {
      if (!paid) return { headers: {} };
      // No answer produced: nothing was settled, the caller's USDG never moved.
      if (!produced) {
        await paid.release();
        return { headers: {} };
      }
      const s = await paid.settle();
      if (!s.ok) return { fail: s.res };
      // The signed ceiling (tokens + fee) was settled; ceiling - actual is owed back, the fee is never refunded.
      await d.repo.addRefund(d.now(), paid.payer, refundMicro(held, actual), "change", paid.nonce);
      return { headers: { "payment-response": s.header, "x-forge-settle-fee-usd": usd(paid.fee) } };
    },
  };
  return p;
}

// Playground: no money, a daily counter slot instead. `day` is the UTC date.
export function freePayer(repo: Repo, scope: string, day: string, limit: number, owner: string | null, tenant = "playground"): Payer {
  return {
    tenant, owner, free: true,
    async reserve() {
      if (!(await repo.takeDaily(scope, day, limit))) {
        throw new ApiError(429, "rate_limited", `The ${limit} free messages for today are used up. They reset at 00:00 UTC. Use a prepaid key to keep going.`);
      }
      return null;
    },
    async finish(_actual, produced) {
      if (!produced) await repo.giveBackDaily(scope, day);
      return { headers: {} };
    },
  };
}

export { jsonRes };
