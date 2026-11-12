import { describe, expect, test } from "vitest";
import { cacheGet, cacheKey, cacheMode, cachePut } from "../src/cache.ts";
import { fakeKV } from "./helpers.ts";

const body = { model: "granite-4.0-micro", messages: [{ role: "user", content: "hi" }], temperature: 0 };

describe("cache", () => {
  test("key ignores property order and stream flags", async () => {
    const a = await cacheKey("fk_a", body);
    const b = await cacheKey("fk_a", { temperature: 0, messages: [{ content: "hi", role: "user" }], model: "granite-4.0-micro", stream: false, user: "u1" });
    expect(a).toBe(b);
  });
  test("tenants never share a key", async () => {
    expect(await cacheKey("fk_a", body)).not.toBe(await cacheKey("fk_b", body));
    expect(await cacheKey("0xaaa", body)).not.toBe(await cacheKey("0xaab", body));
  });
  test("a changed prompt or parameter changes the key", async () => {
    const k = await cacheKey("t", body);
    expect(await cacheKey("t", { ...body, messages: [{ role: "user", content: "hi!" }] })).not.toBe(k);
    expect(await cacheKey("t", { ...body, max_tokens: 5 })).not.toBe(k);
  });
  test("mode: temperature 0 by default, header overrides, stream never", () => {
    expect(cacheMode(null, 0, false)).toBe("eligible");
    expect(cacheMode(null, 0.7, false)).toBe("bypass");
    expect(cacheMode(null, undefined, false)).toBe("bypass");
    expect(cacheMode("on", 0.7, false)).toBe("eligible");
    expect(cacheMode("off", 0, false)).toBe("bypass");
    expect(cacheMode("on", 0, true)).toBe("bypass");
  });
  test("fails open when KV throws", async () => {
    const broken = { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); } };
    expect(await cacheGet(broken, "k")).toBeNull();
    await expect(cachePut(broken, "k", { text: "x", finish_reason: "stop", tokens_in: 1, tokens_out: 1 })).resolves.toBeUndefined();
  });
  test("round trip", async () => {
    const kv = fakeKV();
    await cachePut(kv, "k", { text: "x", finish_reason: "stop", tokens_in: 1, tokens_out: 2 });
    expect((await cacheGet(kv, "k"))?.tokens_out).toBe(2);
  });
});
