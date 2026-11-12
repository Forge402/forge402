import { describe, expect, test } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SESSION_TTL_MS, readSession, signSession } from "../src/session.ts";
import { harness } from "./helpers.ts";

const NOW = 1_800_000_000_000;
describe("session token", () => {
  test("round trip", async () => {
    const t = await signSession("0xABCDEF0000000000000000000000000000000001", "s3cret", NOW);
    expect(await readSession(t, "s3cret", NOW + 1000)).toBe("0xabcdef0000000000000000000000000000000001");
  });
  test("tampered payload is rejected", async () => {
    const t = await signSession("0x1111111111111111111111111111111111111111", "s3cret", NOW);
    const [body, sig] = t.slice(4).split(".");
    const forged = btoa(JSON.stringify({ a: "0x9999999999999999999999999999999999999999", exp: NOW + 1e12 })).replace(/=+$/, "");
    expect(await readSession(`fs1.${forged}.${sig}`, "s3cret", NOW)).toBeNull();
    expect(await readSession(`fs1.${body}.${sig.slice(0, -2)}AA`, "s3cret", NOW)).toBeNull();
  });
  test("wrong secret, expired, junk", async () => {
    const t = await signSession("0x1111111111111111111111111111111111111111", "s3cret", NOW);
    expect(await readSession(t, "other", NOW)).toBeNull();
    expect(await readSession(t, "s3cret", NOW + SESSION_TTL_MS + 1)).toBeNull();
    expect(await readSession("fs1.x", "s3cret", NOW)).toBeNull();
    expect(await readSession("garbage", "s3cret", NOW)).toBeNull();
  });
});

describe("wallet sign-in", () => {
  test("nonce -> personal_sign -> token -> /v1/wallet; nonce is single use", async () => {
    const h = harness();
    const acct = privateKeyToAccount(generatePrivateKey());
    const n = await (await h.call("/v1/auth/nonce", { method: "POST", json: { address: acct.address } })).json();
    expect(n.message).toContain(acct.address);
    expect(n.message).toContain(n.nonce);
    const signature = await acct.signMessage({ message: n.message });
    const v = await h.call("/v1/auth/verify", { method: "POST", json: { address: acct.address, signature, nonce: n.nonce } });
    expect(v.status).toBe(200);
    const { token } = await v.json();
    const w = await (await h.call("/v1/wallet", { headers: { authorization: `Bearer ${token}` } })).json();
    expect(w).toMatchObject({ address: acct.address.toLowerCase(), keys: [], refunds_owed_usd: "0.000000", refund_min_usd: "0.050000", discount_pct: 0, free_messages_left: 0 });
    const again = await h.call("/v1/auth/verify", { method: "POST", json: { address: acct.address, signature, nonce: n.nonce } });
    expect(again.status).toBe(401);
  });
  test("a signature from another wallet is refused", async () => {
    const h = harness();
    const a = privateKeyToAccount(generatePrivateKey());
    const b = privateKeyToAccount(generatePrivateKey());
    const n = await (await h.call("/v1/auth/nonce", { method: "POST", json: { address: a.address } })).json();
    const signature = await b.signMessage({ message: n.message });
    expect((await h.call("/v1/auth/verify", { method: "POST", json: { address: a.address, signature, nonce: n.nonce } })).status).toBe(401);
  });
  test("without SESSION_SECRET: 503 not_configured", async () => {
    const h = harness({ SESSION_SECRET: undefined });
    const r = await h.call("/v1/auth/nonce", { method: "POST", json: { address: "0x1111111111111111111111111111111111111111" } });
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("not_configured");
  });
});
