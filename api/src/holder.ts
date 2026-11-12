// $FORGE holder discount. Off until FORGE_TOKEN is a valid address (the token is not launched yet).
// balanceOf(owner) is read on chain through RPC_URL (public RPC as fallback for eth_call) and cached 10 minutes in KV.
// A failed read is "not a holder": normal price, never a guess and never a failed call.
import type { Env, KVLike } from "./env.ts";
import { isAddress } from "./x402.ts";

export const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const HOLDER_CACHE_SECONDS = 600;
export type HolderConfig = { token: string; min: bigint; discountPct: number };

export function holderConfig(env: Pick<Env, "FORGE_TOKEN" | "HOLDER_MIN" | "HOLDER_DISCOUNT_PCT">): HolderConfig | null {
  const token = env.FORGE_TOKEN?.trim() ?? "";
  const min = env.HOLDER_MIN?.trim() ?? "";
  const pct = Number(env.HOLDER_DISCOUNT_PCT);
  if (!isAddress(token) || !/^[1-9]\d{0,77}$/.test(min) || !Number.isInteger(pct) || pct < 1 || pct > 100) return null;
  return { token: token.toLowerCase(), min: BigInt(min), discountPct: pct };
}

// balanceOf(address): selector 0x70a08231 + the address left-padded to 32 bytes.
export const balanceOfData = (address: string): string => "0x70a08231" + address.toLowerCase().slice(2).padStart(64, "0");

export async function readBalance(cfg: HolderConfig, address: string, rpcUrl: string, f: typeof fetch): Promise<bigint | null> {
  try {
    const res = await f(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: cfg.token, data: balanceOfData(address) }, "latest"] }),
      signal: AbortSignal.timeout(5_000),
    });
    const r = (await res.json()) as { result?: unknown };
    return typeof r.result === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(r.result) ? BigInt(r.result) : null;
  } catch {
    return null;
  }
}

// Is this wallet a holder right now (10 minute cache). Only successful reads are cached.
export async function isHolder(env: Env, address: string, f: typeof fetch = (i, init) => fetch(i, init)): Promise<boolean> {
  const cfg = holderConfig(env);
  if (!cfg) return false;
  const kv: KVLike | undefined = env.CACHE;
  const key = `holder:${cfg.token}:${address.toLowerCase()}`;
  try {
    const hit = await kv?.get(key);
    if (hit === "1" || hit === "0") return hit === "1";
  } catch {
    /* cache failure: read the chain */
  }
  const balance = await readBalance(cfg, address, env.RPC_URL || PUBLIC_RPC, f);
  if (balance === null) return false;
  const yes = balance >= cfg.min;
  try {
    await kv?.put(key, yes ? "1" : "0", { expirationTtl: HOLDER_CACHE_SECONDS });
  } catch {
    /* fail open */
  }
  return yes;
}

export async function discountPct(env: Env, owner: string | null, f?: typeof fetch): Promise<number> {
  const cfg = holderConfig(env);
  if (!cfg || !owner) return 0;
  return (await isHolder(env, owner, f)) ? cfg.discountPct : 0;
}
