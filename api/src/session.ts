// Wallet sign-in: a one-time nonce, an EIP-191 personal_sign check, then a 24h HMAC session token.
import { verifyMessage } from "viem";
import { ApiError } from "./errors.ts";

export const SESSION_TTL_MS = 24 * 3600_000;
export const NONCE_TTL_MS = 10 * 60_000;
export const TOKEN_PREFIX = "fs1.";

// EIP-4361 style text. The domain is the site the owner serves it from; it is shown to the wallet user.
export function signInMessage(address: string, nonce: string, issuedAt: string, domain = "forge402.com"): string {
  return [
    `${domain} wants you to sign in with your wallet:`,
    address,
    "",
    "Sign in to Forge402. This is a free signature, not a transaction, and it moves no funds.",
    "",
    `URI: https://${domain}`,
    "Version: 1",
    "Chain ID: 4663",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

const b64url = (b: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hmacKey = (secret: string, usage: ("sign" | "verify")[]) => crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);

export async function signSession(address: string, secret: string, now: number): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify({ a: address.toLowerCase(), exp: now + SESSION_TTL_MS })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), new TextEncoder().encode(body));
  return `${TOKEN_PREFIX}${body}.${b64url(sig)}`;
}

// The wallet address in a valid, unexpired token; null for anything else (tampered, expired, wrong secret, junk).
export async function readSession(token: string, secret: string, now: number): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [body, sig, ...rest] = token.slice(TOKEN_PREFIX.length).split(".");
  if (!body || !sig || rest.length) return null;
  try {
    // subtle.verify compares in constant time.
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), unb64url(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64url(body))) as { a?: unknown; exp?: unknown };
    return typeof p.a === "string" && typeof p.exp === "number" && p.exp > now ? p.a : null;
  } catch {
    return null;
  }
}

export async function signatureMatches(address: string, message: string, signature: string): Promise<boolean> {
  try {
    return await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` });
  } catch {
    throw new ApiError(400, "bad_request", "The signature is not valid hex.");
  }
}
