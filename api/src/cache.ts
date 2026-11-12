// Response cache (KV). Key = sha256(tenant + canonical request body): a hit never crosses tenants.
// Fails open: any KV problem just means the request goes to the model. Only the reply is kept, 24 hours.
import type { KVLike } from "./env.ts";
import { sha256Hex } from "./keys.ts";

export const CACHE_TTL_SECONDS = 86_400;

// Everything in the body keys the cache except fields that never change the answer. Starting from "all fields"
// means a parameter we forgot about can only split the cache, never serve a wrong answer.
const NOT_KEYED = new Set(["stream", "stream_options", "user"]);

// JSON with sorted object keys, so {a,b} and {b,a} are the same request.
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export async function cacheKey(tenant: string, body: Record<string, unknown>): Promise<string> {
  const picked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (!NOT_KEYED.has(k)) picked[k] = v;
  return "chat:" + (await sha256Hex(tenant + "\n" + canonical(picked)));
}

export type Cached = { text: string | null; reasoning?: string | null; tool_calls?: unknown; finish_reason: string; tokens_in: number; tokens_out: number };

// Cache is read for temperature 0 by default; X-Forge-Cache on/off overrides. Streaming is never cached.
export function cacheMode(header: string | null, temperature: unknown, stream: boolean): "eligible" | "bypass" {
  if (stream) return "bypass";
  const h = header?.trim().toLowerCase();
  if (h === "off") return "bypass";
  if (h === "on") return "eligible";
  return temperature === 0 ? "eligible" : "bypass";
}

export async function cacheGet(kv: KVLike | undefined, key: string): Promise<Cached | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}

export async function cachePut(kv: KVLike | undefined, key: string, value: Cached): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: CACHE_TTL_SECONDS });
  } catch {
    /* fail open */
  }
}
