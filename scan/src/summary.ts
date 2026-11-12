// Three plain sentences about a scan. Workers AI writes them; a rule-written version is the fallback when the model is
// missing, slow or says something we do not trust.
import type { Check, Verdict } from "./types.ts";

export const SUMMARY_MODEL = "@cf/meta/llama-3.2-3b-instruct"; // llama-3.2-3b in forge402/data/models.json

type AiLike = { run(model: string, input: unknown): Promise<unknown> };

// Free plan: 10,000 neurons/day for the whole account. cap 0 = no cap. used()/add() are backed by D1 (see Store.aiUsed/aiAdd).
export type AiBudget = { cap: number; used(): Promise<number>; add(neurons: number): Promise<void> };

// llama-3.2-3b cfInPerM / cfOutPerM from forge402/data/models.json, dollars per million tokens. 1 neuron = $0.000011.
const CF_IN_PER_M = 0.0509, CF_OUT_PER_M = 0.335, USD_PER_NEURON = 0.000011;
export const neuronsFor = (tokensIn: number, tokensOut: number) => ((tokensIn * CF_IN_PER_M + tokensOut * CF_OUT_PER_M) / 1e6) / USD_PER_NEURON;
const tokensOfText = (chars: number) => Math.ceil(chars / 4); // rough: 4 characters per token

const VERDICT_WORDS: Record<Verdict, string> = { clean: "a clean surface", caution: "some warning signs", risky: "serious warning signs" };

export function fallbackSummary(score: number, verdict: Verdict, checks: Check[]): string {
  const flags = checks.filter((c) => c.status === "flag");
  const unknown = checks.filter((c) => c.status === "unknown").length;
  const first = `Forge Scan scored this token ${score} out of 100: ${VERDICT_WORDS[verdict]}.`;
  const second = flags.length
    ? `What tripped the rules: ${flags.slice(0, 3).map((c) => c.label.toLowerCase()).join(", ")}${flags.length > 3 ? ` and ${flags.length - 3} more` : ""}.`
    : "None of the checked switches were found in the contract or the market data.";
  const third = unknown ? `${unknown} check${unknown > 1 ? "s" : ""} could not be read, and a clean surface is never proof of safety.` : "A clean surface is never proof of safety, so size positions accordingly.";
  return `${first} ${second} ${third}`;
}

// A small model reads "Mint function: pass" as "has a mint function". Any power the text names whose check did not
// flag means the text contradicts the scan, so it is dropped for the rule-written summary (seen live 2026-11-12).
const POWER_WORDS: [RegExp, string][] = [
  [/\bmint/i, "mint"], [/blacklist|blocklist/i, "blacklist"], [/\bpaus/i, "pause"], [/\bfees?\b|\btax/i, "fees"],
  [/proxy|upgrad/i, "proxy"], [/\blimits?\b/i, "limits"], [/trading (switch|toggle)|enable trading/i, "trading_toggle"],
  [/portion|share of (the )?(total )?supply|holds? .{0,30}supply/i, "owner_holding"],
];
export function contradictsChecks(text: string, checks: Check[]): boolean {
  const flagged = new Set(checks.filter((c) => c.status === "flag").map((c) => c.id));
  const known = new Set(checks.map((c) => c.id));
  return POWER_WORDS.some(([re, id]) => known.has(id) && !flagged.has(id) && re.test(text));
}

// Keep the model's text only if it is short, plain and three-ish sentences with no links or addresses.
export function cleanModelText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  if (text.length < 40 || text.length > 600) return null;
  if (/https?:|www\.|0x[0-9a-fA-F]{8,}|```/.test(text)) return null;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return null;
  return sentences.slice(0, 3).join(" ");
}

export async function writeSummary(ai: AiLike | undefined, score: number, verdict: Verdict, checks: Check[], timeoutMs = 7000, budget?: AiBudget): Promise<string> {
  const fallback = fallbackSummary(score, verdict, checks);
  if (!ai) return fallback;
  // Over the day's neuron budget (or the counter is unreadable): no AI call, rule-written summary. Scans never fail on this.
  if (budget && budget.cap > 0) {
    const used = await budget.used().catch(() => Infinity);
    if (used >= budget.cap) return fallback;
  }
  // Token names and symbols are chosen by whoever deployed the token, so they never go into the prompt.
  // Only the warnings and unknowns go in as plain sentences; passed checks become one count line. The 3B model misread
  // "Mint function: pass" and even "OK: owner holds 0%" as risks (live 2026-11-12), so it never sees them.
  const scrub = (s: string) => s.replace(/0x[0-9a-fA-F]{8,}/g, "an address");
  const passed = checks.filter((c) => c.status === "pass").length;
  const facts = [
    ...checks.filter((c) => c.status === "flag").map((c) => `WARNING: ${scrub(c.detail)}`),
    ...checks.filter((c) => c.status === "unknown").map((c) => `UNKNOWN: ${scrub(c.detail)}`),
    `${passed} other checks found nothing wrong.`,
  ].join("\n");
  const input = {
    max_tokens: 170,
    temperature: 0.2,
    messages: [
      { role: "system", content: "You write short risk notes about a crypto token for a trader. Reply with exactly 3 plain sentences. No lists, no markdown, no links, no addresses, no investment advice. Use only the facts given. Only call something a risk if its line is marked WARNING. Do not mention anything that is not in the lines, and do not add causes or consequences of your own: explain a WARNING only with the words its line gives." },
      { role: "user", content: `Score ${score} out of 100, verdict ${verdict}.\n${facts}` },
    ],
  };
  const estIn = tokensOfText(input.messages.reduce((n, m) => n + m.content.length, 0));
  let spent = neuronsFor(estIn, 0); // a failed or timed-out call may still have run: count at least the prompt
  try {
    const out = await Promise.race([
      ai.run(SUMMARY_MODEL, input),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ai timeout")), timeoutMs)),
    ]);
    const usage = (out as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } })?.usage;
    const response = (out as { response?: unknown })?.response;
    const tin = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : estIn;
    const tout = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : tokensOfText(typeof response === "string" ? response.length : 0);
    spent = neuronsFor(tin, tout);
    const text = cleanModelText(response);
    return text && !contradictsChecks(text, checks) ? text : fallback;
  } catch {
    return fallback;
  } finally {
    if (budget) await budget.add(spent).catch(() => {});
  }
}
