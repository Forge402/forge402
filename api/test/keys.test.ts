import { describe, expect, test } from "vitest";
import { KEY_PREFIX, base62, looksLikeKey, newKey, sha256Hex } from "../src/keys.ts";
import { fundedKey, harness } from "./helpers.ts";

describe("keys", () => {
  test("format: forge_sk_ + 43 base62 chars; unique", () => {
    const a = newKey();
    expect(a.key.startsWith(KEY_PREFIX)).toBe(true);
    expect(looksLikeKey(a.key)).toBe(true);
    expect(newKey().key).not.toBe(a.key);
    expect(base62(new Uint8Array(32).fill(255))).toHaveLength(43);
    expect(looksLikeKey("forge_sk_short")).toBe(false);
  });
  test("sha256 is the known digest", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  test("only the hash is stored, never the key", async () => {
    const h = harness();
    const { key, id } = await fundedKey(h, 5_000_000);
    const row = await h.repo.keyById(id);
    expect(row!.hash).toBe(await sha256Hex(key));
    expect(JSON.stringify(row)).not.toContain(key);
    expect(await h.repo.keyByHash(await sha256Hex(key))).not.toBeNull();
  });
});
