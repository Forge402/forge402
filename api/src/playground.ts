// POST /v1/playground/chat: free messages for the website. Guests get 5 a day per IP on the free models (max 512
// output tokens). A signed-in wallet holding enough $FORGE gets 25 a day on any chat model (max 2048).
// Nothing is cached here and no IP is stored: the counter key is a hash.
import { freePayer } from "./billing.ts";
import type { Env } from "./env.ts";
import { ApiError } from "./errors.ts";
import { GUEST_FREE_PER_DAY, HOLDER_FREE_PER_DAY, utcDay, walletFromRequest } from "./accounts.ts";
import { holderConfig, isHolder } from "./holder.ts";
import { sha256Hex } from "./keys.ts";
import { freeModelIds } from "./models.ts";
import { parseChat } from "./openai.ts";
import type { PayDeps } from "./pay.ts";
import { runChat, type ServiceDeps } from "./service.ts";

export const GUEST_MAX_TOKENS = 512;
export const HOLDER_MAX_TOKENS = 2048;

// IPv4: the address. IPv6: its /64, since one home gets a whole /64 and could otherwise mint a fresh free tier per request.
export function callerKey(req: Request): string {
  const raw = (req.headers.get("cf-connecting-ip") ?? "").trim().toLowerCase();
  if (!raw.includes(":")) return raw || "unknown";
  let groups = raw.split(":");
  if (raw.includes("::")) {
    const [head, tail] = raw.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    groups = [...left, ...Array(Math.max(8 - left.length - right.length, 0)).fill("0"), ...right];
  }
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

export async function playgroundChat(req: Request, env: Env, body: unknown, d: ServiceDeps): Promise<Response> {
  const day = utcDay(d.now());
  const signedIn = req.headers.get("authorization");
  let holderWallet: string | null = null;
  if (signedIn) {
    const wallet = await walletFromRequest(req, env, d as PayDeps);
    if (holderConfig(env) && (await isHolder(env, wallet, d.fetch))) holderWallet = wallet;
  }
  if (holderWallet) {
    const r = parseChat(body, { maxTokensCap: HOLDER_MAX_TOKENS });
    const payer = freePayer(d.repo, `wallet:${holderWallet}`, day, HOLDER_FREE_PER_DAY, holderWallet);
    return runChat(env, req, r, payer, d, { allowCache: false });
  }
  const r = parseChat(body, { maxTokensCap: GUEST_MAX_TOKENS });
  if (!freeModelIds().has(r.model.id)) {
    throw new ApiError(402, "payment_required", `${r.model.id} is not free in the playground. Use a free model, hold $FORGE and sign in, or use a prepaid key (POST /v1/keys).`);
  }
  const scope = "ip:" + (await sha256Hex(callerKey(req))).slice(0, 16);
  return runChat(env, req, r, freePayer(d.repo, scope, day, GUEST_FREE_PER_DAY, null), d, { allowCache: false });
}
