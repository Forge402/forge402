// Bindings and vars of the Worker. Types are local so tests can pass fakes without Cloudflare's runtime.
export type D1Result = { meta: { changes?: number } };
export interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  run(): Promise<D1Result>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface D1Like {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<D1Result[]>;
}
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}
export interface AiLike {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export type Env = {
  AI?: AiLike;
  DB?: D1Like;
  CACHE?: KVLike;
  SCAN?: { fetch(req: Request): Promise<Response> };
  PAY_TO?: string;
  FACILITATOR_URL?: string;
  FACILITATOR_API_KEY?: string; // secret
  SESSION_SECRET?: string; // secret
  RPC_URL?: string; // secret
  ALLOWED_ORIGINS?: string;
  HOLDER_MIN?: string; // base units, integer string
  HOLDER_DISCOUNT_PCT?: string;
  FORGE_TOKEN?: string;
  SETTLE_FEE_USD?: string; // what the facilitator charges us per settled x402 payment, USD; invalid = 0.015
  REFUND_MIN_USD?: string; // refunds below this stay owed and accumulate, USD; invalid = 0.05
  AI_DAILY_NEURONS?: string; // Workers AI neurons per UTC day for this worker; "0" = no cap
  FREE_DAILY_NEURONS?: string; // share of that budget the free playground may use
};

// What the Workers runtime hands every request: only waitUntil is used.
export type Ctx = { waitUntil?: (p: Promise<unknown>) => void };
