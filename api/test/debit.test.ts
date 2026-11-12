import { describe, expect, test } from "vitest";
import { fundedKey, harness } from "./helpers.ts";

describe("race-safe debits", () => {
  test("N parallel debits on a small balance never go negative", async () => {
    const h = harness();
    const { id } = await fundedKey(h, 1000);
    const results = await Promise.all(Array.from({ length: 50 }, () => h.repo.debit(id, 100)));
    expect(results.filter(Boolean)).toHaveLength(10); // 1000 / 100
    expect((await h.repo.keyById(id))!.balance_micro).toBe(0);
  });
  test("parallel chat calls on a key that covers only some of them", async () => {
    // The model answers slowly, so every call has reserved its ceiling before any call has finished.
    const h = harness({}, () => new Promise((r) => setTimeout(() => r({ response: "ok", usage: { prompt_tokens: 10, completion_tokens: 5 } }), 30)));
    const { key } = await fundedKey(h, 300);
    // ceiling for max_tokens 1000 on granite is about 150 micro, so roughly two fit
    const call = () => h.call("/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}` }, json: { model: "granite-4.0-micro", messages: [{ role: "user", content: "hi" }], max_tokens: 1000 } });
    const res = await Promise.all(Array.from({ length: 12 }, call));
    const ok = res.filter((r) => r.status === 200).length;
    const refused = res.filter((r) => r.status === 402).length;
    expect(ok + refused).toBe(12);
    expect(ok).toBe(2);
    expect(refused).toBe(10);
    const row = (await h.repo.keyByHash(await (await import("../src/keys.ts")).sha256Hex(key)))!;
    expect(row.balance_micro).toBeGreaterThanOrEqual(0);
    expect(row.balance_micro + row.spent_micro).toBe(300); // money is conserved
    expect(row.calls).toBe(ok);
  });
  test("a closed key cannot be debited", async () => {
    const h = harness();
    const { id } = await fundedKey(h, 1000);
    await h.repo.closeKey(id, 1);
    expect(await h.repo.debit(id, 1)).toBe(false);
  });
  test("closing books the remaining balance as a refund, once", async () => {
    const h = harness();
    const { id } = await fundedKey(h, 700);
    expect(await h.repo.closeKey(id, 1)).toBe(700);
    expect(await h.repo.closeKey(id, 2)).toBeNull();
    expect(await h.repo.refundsOwed("0x1111111111111111111111111111111111111111")).toBe(700);
  });
  test("free daily slots: parallel takes stop exactly at the limit", async () => {
    const h = harness();
    const r = await Promise.all(Array.from({ length: 20 }, () => h.repo.takeDaily("s", "2026-11-12", 5)));
    expect(r.filter(Boolean)).toHaveLength(5);
    await h.repo.giveBackDaily("s", "2026-11-12");
    expect(await h.repo.takeDaily("s", "2026-11-12", 5)).toBe(true);
  });
});
