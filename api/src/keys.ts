// Key material. A key is "forge_sk_" + 32 random bytes in base62. Only its sha256 is stored.
export const KEY_PREFIX = "forge_sk_";
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function base62(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(43, "0"); // 32 bytes need at most 43 base62 digits
}

export const randomHex = (n: number): string => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

export function newKey(): { key: string; id: string } {
  return { key: KEY_PREFIX + base62(crypto.getRandomValues(new Uint8Array(32))), id: "fk_" + randomHex(6) };
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const looksLikeKey = (v: string): boolean => /^forge_sk_[0-9A-Za-z]{43}$/.test(v);
