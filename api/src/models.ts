import catalog from "./models.json" with { type: "json" };
import type { Env } from "./env.ts";

export type Model = {
  id: string;
  cfModel: string;
  provider: string;
  type: "chat" | "embeddings";
  description: string;
  context: number;
  cfInPerM: number; // Cloudflare list price, USD per 1M tokens
  cfOutPerM: number;
  inPerM: number; // USD per 1M input tokens, posted (Cloudflare x 1.25)
  outPerM: number;
  tags: string[];
  free: boolean;
  deprecates?: string;
  paidPlan?: boolean; // Cloudflare serves it only on the Workers Paid plan
};

export const MODELS: Model[] = catalog.models as Model[];
const BY_ID = new Map(MODELS.map((m) => [m.id, m]));
export const findModel = (id: unknown): Model | undefined => (typeof id === "string" ? BY_ID.get(id) : undefined);

// Playground guests may only use these. The catalog flag wins; with no flag set, the three cheapest chat models
// (input + output price, ties by id) are used. Deprecated ones are skipped so a free model does not vanish next week.
// Reasoning models are skipped too: they spend the 512-token guest budget thinking and return no answer.
// Vision models are skipped: the guest playground is text only, and llama-3.2-11b-vision needs a one-time license
// "agree" call on the account first (Workers AI error 5016, seen 2026-11-12).
export function freeModelIds(models: Model[] = MODELS): Set<string> {
  models = models.filter((m) => !m.paidPlan);
  const flagged = models.filter((m) => m.free && m.type === "chat");
  if (flagged.length) return new Set(flagged.map((m) => m.id));
  return new Set(
    models
      .filter((m) => m.type === "chat" && !m.deprecates && !m.tags.includes("reasoning") && !m.tags.includes("vision"))
      .sort((a, b) => a.inPerM + a.outPerM - (b.inPerM + b.outPerM) || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((m) => m.id),
  );
}

// GET /v1/models entry: OpenAI list shape plus the Forge fields.
export function modelEntry(m: Model, free: Set<string> = freeModelIds()) {
  return {
    id: m.id,
    object: "model",
    created: 0,
    owned_by: m.provider,
    provider: m.provider,
    type: m.type,
    context_length: m.context,
    input_usd_per_mtok: m.inPerM,
    output_usd_per_mtok: m.outPerM,
    description: m.description,
    free: free.has(m.id), // usable by playground guests
    ...(m.deprecates ? { deprecates: m.deprecates } : {}),
  };
}

// AI_DAILY_NEURONS "0" means the account is on the Workers Paid plan (see capacity.ts); otherwise paid-plan models are hidden.
export const onPaidPlan = (env: Env): boolean => env.AI_DAILY_NEURONS?.trim() === "0";
export const servedModels = (env: Env): Model[] => (onPaidPlan(env) ? MODELS : MODELS.filter((m) => !m.paidPlan));
export const modelList = (env: Env) => ({ object: "list", data: servedModels(env).map((m) => modelEntry(m, freeModelIds())) });
