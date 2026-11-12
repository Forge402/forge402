import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/telegram.ts";
import { detectChanges } from "../src/watch.ts";
import type { WatchState } from "../src/store.ts";
import { checkPayload, paymentNonce, paymentRequired, requirementsFor, SCAN_PRICE_AMOUNT, USDG, toBase64, fromBase64 } from "../src/x402.ts";
import { cleanModelText, contradictsChecks, fallbackSummary, writeSummary } from "../src/summary.ts";

const A = "0x143185685456e50b88412D6cFC3a6f8D4Fd18afa";

describe("telegram commands", () => {
  it("parses commands with address", () => {
    expect(parseCommand(`/scan ${A}`)).toEqual({ cmd: "scan", address: A.toLowerCase() });
    expect(parseCommand(`/watch@ForgeBot ${A}`)).toEqual({ cmd: "watch", address: A.toLowerCase() });
    expect(parseCommand(`/UNWATCH   ${A}`)).toEqual({ cmd: "unwatch", address: A.toLowerCase() });
  });
  it("no-arg commands", () => { expect(parseCommand("/start")).toEqual({ cmd: "start" }); expect(parseCommand("/help")).toEqual({ cmd: "help" }); expect(parseCommand("/watching")).toEqual({ cmd: "watching" }); });
  it("bad or missing address is flagged", () => { expect(parseCommand("/scan 0x123")).toEqual({ cmd: "scan", badArg: true }); expect(parseCommand("/watch")).toEqual({ cmd: "watch", badArg: true }); });
  it("a bare address means scan; chatter and unknown commands are ignored", () => {
    expect(parseCommand(A)).toEqual({ cmd: "scan", address: A.toLowerCase() });
    expect(parseCommand("gm")).toBeNull();
    expect(parseCommand("/nope")).toBeNull();
    expect(parseCommand(42)).toBeNull();
  });
});

describe("watch change detection", () => {
  const base: WatchState = { owner: "0x" + "a".repeat(40), impl: null, liquidity_usd: 10_000, score: 80, supply: "1000" };
  it("stays quiet when nothing meaningful moved", () => expect(detectChanges(base, { ...base, liquidity_usd: 8000, score: 75, supply: "1005" })).toEqual([]));
  it("owner change and renounce", () => {
    expect(detectChanges(base, { ...base, owner: "0x" + "b".repeat(40) })[0]).toMatch(/owner changed/);
    expect(detectChanges(base, { ...base, owner: "0x" + "0".repeat(40) })[0]).toMatch(/renounced/);
  });
  it("new proxy implementation", () => expect(detectChanges(base, { ...base, impl: "0x" + "c".repeat(40) })[0]).toMatch(/implementation/));
  it("liquidity drop over 30%, not at 29%", () => {
    expect(detectChanges(base, { ...base, liquidity_usd: 6900 })[0]).toMatch(/Liquidity fell 31%/);
    expect(detectChanges(base, { ...base, liquidity_usd: 7100 })).toEqual([]);
  });
  it("score drop of 10 points", () => expect(detectChanges(base, { ...base, score: 70 })[0]).toMatch(/score dropped/));
  it("supply growth of 1% or more", () => expect(detectChanges(base, { ...base, supply: "1010" })[0]).toMatch(/minted/));
  it("unknown owner or liquidity does not alert", () => expect(detectChanges(base, { ...base, owner: null, liquidity_usd: null })).toEqual([]));
});

describe("x402 fixed price", () => {
  const ours = requirementsFor("0x" + "d".repeat(40));
  it("quotes 20000 atomic USDG on eip155:4663", () => {
    expect(ours).toMatchObject({ scheme: "exact", network: "eip155:4663", asset: USDG, amount: "20000", maxTimeoutSeconds: 300, extra: { name: "Global Dollar", version: "1" } });
    expect(SCAN_PRICE_AMOUNT).toBe("20000");
    const body = paymentRequired("https://x/v1/scan", ours, "d");
    expect(body.x402Version).toBe(2);
    expect(fromBase64(toBase64(body))).toEqual(body);
  });
  it("accepts only an unchanged offer", () => {
    expect(checkPayload({ x402Version: 2, accepted: ours }, ours)).toBeNull();
    expect(checkPayload({ x402Version: 2, accepted: { ...ours, amount: "1" } }, ours)).toBe("wrong amount");
    expect(checkPayload({ x402Version: 2, accepted: { ...ours, payTo: "0x" + "e".repeat(40) } }, ours)).toBe("wrong payTo");
    expect(checkPayload({ x402Version: 1, accepted: ours }, ours)).toMatch(/version 2/);
  });
  it("reads the replay nonce", () => {
    const n = "0x" + "ab".repeat(32);
    expect(paymentNonce({ payload: { authorization: { nonce: n } } })).toBe(n);
    expect(paymentNonce({})).toBeUndefined();
  });
});

describe("summary", () => {
  it("rejects model text with links or one sentence, keeps a plain one", () => {
    expect(cleanModelText("Visit https://scam.example now. Buy buy buy this token today.")).toBeNull();
    expect(cleanModelText("Just one sentence that is long enough to pass the length floor ok.")).toBeNull();
    expect(cleanModelText("The token looks mostly fine. Liquidity is thin though. Be careful with size.")).toMatch(/thin/);
  });
  it("drops AI text that names a power the scan did not flag (live bug 2026-11-12)", async () => {
    const checks = [
      { id: "mint", label: "Mint function", value: false, status: "pass" as const, detail: "No common mint selector in the code." },
      { id: "pause", label: "Pausable transfers", value: true, status: "flag" as const, detail: "Owner can pause transfers." },
    ];
    const lie = "The token has a mint function and can be paused. It looks well designed. Liquidity is unknown.";
    expect(contradictsChecks(lie, checks)).toBe(true);
    expect(contradictsChecks("Transfers can be paused by the owner. Other checks look fine. Liquidity is unknown.", checks)).toBe(false);
    let prompt = "";
    const ai = { run: async (_m: string, input: any) => ((prompt = input.messages[1].content), { response: lie }) };
    expect(await writeSummary(ai, 80, "caution", checks)).toBe(fallbackSummary(80, "caution", checks));
    expect(prompt).toContain("WARNING: Owner can pause transfers.");
    expect(prompt).toContain("1 other checks found nothing wrong.");
    expect(prompt).not.toMatch(/mint|: pass/i); // passed checks never reach the model
  });
  it("drops a supply-share claim when owner_holding passed (USDG live, owner holds 0%)", () => {
    const checks = [{ id: "owner_holding", label: "Owner share", value: 0, status: "pass" as const, detail: "The owner address holds 0% of total supply." }];
    expect(contradictsChecks("The owner address holds a significant portion of the total supply. Be careful. Market data is unknown.", checks)).toBe(true);
  });
  it("fallback is three sentences", () => expect(fallbackSummary(70, "caution", [{ id: "a", label: "Pausable transfers", value: true, status: "flag", detail: "" }]).split(/(?<=\.)\s/)).toHaveLength(3));
});
