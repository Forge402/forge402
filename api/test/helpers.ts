// Test fakes: a real SQLite behind the D1 interface (so the migration and every query run for real), a fake KV,
// a fake Workers AI and a fake facilitator. No network.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { D1Like, D1Stmt, Env, KVLike } from "../src/env.ts";
import { makeWorker } from "../src/worker.ts";
import { createRepo } from "../src/repo.ts";
import { toBase64, USDG } from "../src/x402.ts";

export function fakeD1(): D1Like {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): D1Stmt => ({
    bind: (...v) => stmt(sql, v),
    async run() {
      const r = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: Number(r.changes) } };
    },
    async first<T>() {
      return (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null;
    },
    async all<T>() {
      return { results: db.prepare(sql).all(...(args as never[])) as T[] };
    },
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of list) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

export function fakeKV(): KVLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: async (k) => map.get(k) ?? null, put: async (k, v) => void map.set(k, v) };
}

export const OWNER = "0x1111111111111111111111111111111111111111";
export const PAYER = "0x2222222222222222222222222222222222222222";

// Response with a loosely typed json(), so tests can read fields without casts.
export type Res = Omit<Response, "json" | "clone"> & { json(): Promise<any>; clone(): Res };

export type Harness = ReturnType<typeof harness>;

export function harness(over: Partial<Env> = {}, ai?: (model: string, input: any) => unknown) {
  const db = fakeD1();
  const kv = fakeKV();
  const aiCalls: { model: string; input: any }[] = [];
  const fac = { verify: { isValid: true, payer: PAYER } as any, settle: { success: true, transaction: "0xabc", network: "eip155:4663", payer: PAYER } as any, calls: [] as string[], down: false, rpcCalls: 0, balance: "0x0" };
  const facilitator = (async (url: string) => {
    if (url.includes("rpc")) return (fac.rpcCalls++, new Response(JSON.stringify({ result: fac.balance })));
    const path = new URL(url).pathname;
    fac.calls.push(path);
    if (fac.down) throw new Error("ECONNREFUSED");
    return new Response(JSON.stringify(path === "/verify" ? fac.verify : fac.settle));
  }) as unknown as typeof fetch;
  const env: Env = {
    DB: db,
    CACHE: kv,
    AI: { run: async (model, input) => (aiCalls.push({ model, input }), ai ? ai(model, input) : { response: "hello there", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) },
    PAY_TO: OWNER,
    SESSION_SECRET: "test-secret",
    ALLOWED_ORIGINS: "https://forge402.example",
    ...over,
  };
  let t = 1_800_000_000_000;
  const clock = { now: () => t, advance: (ms: number) => void (t += ms) };
  const worker = makeWorker(facilitator, async () => {}, clock.now);
  const call = (path: string, init: RequestInit & { json?: unknown } = {}): Promise<Res> =>
    worker.fetch(new Request("https://api.test" + path, { ...init, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, headers: { "content-type": "application/json", ...(init.headers as object) } }), env);
  return { db, kv, env, fac, aiCalls, call, repo: createRepo(db), clock };
}

export const chatBody = (over: Record<string, unknown> = {}) => ({ model: "granite-4.0-micro", messages: [{ role: "user", content: "hi" }], max_tokens: 100, ...over });

let n = 0;
// An x402 payload whose `accepted` echoes the quote from a 402 response.
export function payloadFor(quote: any, nonce?: string, from = PAYER) {
  const accepted = quote.accepts[0];
  const nn = nonce ?? "0x" + (++n).toString(16).padStart(64, "0");
  return toBase64({ x402Version: 2, accepted, payload: { signature: "0xsig", authorization: { from, nonce: nn } } });
}
export { USDG };

// Mint a funded key straight in the DB (the x402 deposit path has its own test).
export async function fundedKey(h: Harness, micro: number, owner = OWNER) {
  const { newKey, sha256Hex } = await import("../src/keys.ts");
  const { key, id } = newKey();
  await h.repo.createKey({ id, hash: await sha256Hex(key), owner, label: null, amount: micro, now: h.clock.now() });
  return { key, id };
}
