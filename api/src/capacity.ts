// Daily budget for the Cloudflare Workers Free plan: Workers AI neurons (shared by the whole account, resets 00:00 UTC)
// and KV writes. Counters live in the daily_use table (scopes neurons:all, neurons:free, kv:writes).
import type { Env } from "./env.ts";
import { ApiError } from "./errors.ts";
import { onPaidPlan, type Model } from "./models.ts";
import type { Repo } from "./repo.ts";

export const DEFAULT_AI_DAILY_NEURONS = 7500;
export const DEFAULT_FREE_DAILY_NEURONS = 2000;
export const KV_WRITES_PER_DAY = 900; // KV free plan allows 1,000 writes a day
export const NEURON_USD = 0.000011; // Cloudflare list price of one neuron

const SCOPE_ALL = "neurons:all";
const SCOPE_FREE = "neurons:free";
const SCOPE_KV = "kv:writes";

const whole = (v: string | undefined): number | null => (v !== undefined && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null);

// AI_DAILY_NEURONS: unset or invalid -> 7500, "0" -> no cap (paid plan). FREE_DAILY_NEURONS: unset, invalid or 0 -> 2000.
export function budgets(env: Env): { all: number; free: number } {
  const all = whole(env.AI_DAILY_NEURONS);
  const free = whole(env.FREE_DAILY_NEURONS);
  return { all: all ?? DEFAULT_AI_DAILY_NEURONS, free: free && free > 0 ? free : DEFAULT_FREE_DAILY_NEURONS };
}

// Neurons one call burns, rounded up. Uses the Cloudflare prices (not our x1.25 prices).
export const neuronsFor = (m: Pick<Model, "cfInPerM" | "cfOutPerM">, tokensIn: number, tokensOut: number): number =>
  Math.max(0, Math.ceil((tokensIn * m.cfInPerM + tokensOut * m.cfOutPerM) / 1e6 / NEURON_USD - 1e-9));

export const capacityReached = () => new ApiError(503, "capacity_reached", "Today's model capacity is used up. It resets at 00:00 UTC. You were not charged.");

// Call BEFORE taking payment or reserving. ponytail: soft budget, calls already in flight when the limit is crossed
// still finish, so the day can overshoot by the cost of the in-flight calls. Hard cap needs reserve-then-settle neurons.
export async function gateAi(repo: Repo, env: Env, day: string, free: boolean, m: Pick<Model, "id" | "paidPlan">): Promise<void> {
  if (m.paidPlan && !onPaidPlan(env)) {
    throw new ApiError(404, "model_not_found", `${m.id} is not available yet. Pick another model from GET /v1/models. You were not charged.`);
  }
  const b = budgets(env);
  if (b.all > 0 && (await repo.usedDaily(SCOPE_ALL, day)) >= b.all) throw capacityReached();
  if (free && (await repo.usedDaily(SCOPE_FREE, day)) >= b.free) {
    throw new ApiError(429, "rate_limited", "Free playground messages are used up for today. They reset at 00:00 UTC. Use a prepaid key to keep going.");
  }
}

// Book the neurons of a real model call. Never throws: the call already happened.
export async function addNeurons(repo: Repo, day: string, n: number, free: boolean): Promise<void> {
  if (n <= 0) return;
  try {
    await repo.addDaily(SCOPE_ALL, day, n);
    if (free) await repo.addDaily(SCOPE_FREE, day, n);
  } catch (e) {
    console.error("neuron count failed", e instanceof Error ? e.message : "unknown");
  }
}

// Cloudflare's own daily-limit error from env.AI.run. The exact wording is unverified, so match loosely.
export const isCfDailyLimit = (e: unknown): boolean => /neurons|daily free allocation|\b3036\b/i.test(e instanceof Error ? e.message : String(e ?? ""));

// One KV write slot for today; false = used up (or the counter failed): skip the put.
export async function kvWriteSlot(repo: Repo, day: string): Promise<boolean> {
  try {
    return await repo.takeDaily(SCOPE_KV, day, KV_WRITES_PER_DAY);
  } catch {
    return false;
  }
}

export async function capacityNow(repo: Repo, env: Env, day: string) {
  const b = budgets(env);
  return {
    day,
    neurons_used: await repo.usedDaily(SCOPE_ALL, day),
    neurons_limit: b.all > 0 ? b.all : null,
    free_neurons_used: await repo.usedDaily(SCOPE_FREE, day),
    free_neurons_limit: b.free,
  };
}
