// Typed client for the two Forge402 workers. Contract: forge402/API.md.
// No fallbacks to fake data: every failure surfaces as an ApiError the UI can show.

export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || 'http://localhost:8787').replace(/\/+$/, '')
export const SCAN_BASE = ((import.meta.env.VITE_SCAN_BASE as string | undefined) || 'http://localhost:8788').replace(/\/+$/, '')
export const TG_BOT = (import.meta.env.VITE_TG_BOT as string | undefined) || 'forge402_bot'

export type ErrorCode =
  | 'payment_required' | 'terms_mismatch' | 'verify_invalid' | 'payment_replayed' | 'invalid_key'
  | 'insufficient_balance' | 'rate_limited' | 'model_not_found' | 'model_overloaded' | 'bad_request'
  | 'upstream_error' | 'not_configured'
  | 'network_error' | 'timeout' | 'bad_response' | 'unknown'

export class ApiError extends Error {
  code: ErrorCode
  status: number
  /** parsed 402 body when the server asked for payment */
  body?: unknown
  constructor(code: ErrorCode, message: string, status = 0, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.body = body
  }
}

export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.')

// ---- types ----------------------------------------------------------------
export type LiveModel = {
  id: string; provider?: string; type?: 'chat' | 'embeddings'; context_length?: number
  input_usd_per_mtok?: number; output_usd_per_mtok?: number; description?: string; deprecates?: string; free?: boolean
}
export type Accept = {
  scheme: 'exact'; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number
  extra: { name: string; version: string }
}
export type PaymentRequired = { x402Version: number; accepts: Accept[]; resource?: unknown; description?: string; error?: unknown }
export type KeyRow = { id: string; label?: string | null; balance_usd: number; spent_usd: number; created: string | number; revoked: boolean }
export type WalletInfo = { address: string; keys: KeyRow[]; refunds_owed_usd: number; discount_pct: number; free_messages_left: number }
export type KeyMe = {
  owner: string; label?: string | null; balance_usd: number; spent_usd: number; calls: number
  recent: { ts: string | number; model: string; tokens_in: number; tokens_out: number; cost_usd: number; cache?: string }[]
}
export type Stats = {
  tokens_in: number; tokens_out: number; calls: number; scans: number; volume_usd: number; cache_hit_rate: number
  per_model: { model: string; calls: number; tokens_in: number; tokens_out: number }[]
  daily: { day: string; calls: number }[]
}
export type ScanCheck = { id: string; label: string; value: string | number | boolean | null; status: 'pass' | 'flag' | 'unknown'; detail?: string }
export type ScanResult = {
  address: string; chain: string; symbol?: string; name?: string; score: number; verdict: 'clean' | 'caution' | 'risky'
  checks: ScanCheck[]
  market?: {
    liquidity_usd?: number | null; dex?: string | null; pool?: string | null; txns_24h?: { buys: number; sells: number } | null
    price_usd?: number | null; fdv_usd?: number | null; pool_age_hours?: number | null
  } | null
  /** ok = pool data read; no_pool = sources answered, no pool; unavailable = sources could not be reached */
  market_status?: 'ok' | 'no_pool' | 'unavailable'
  summary?: string; scanned_at: string; rules_version?: string
}
export type RecentScan = Partial<ScanResult> & { address: string }
export type RadarItem = {
  address: string; symbol?: string; name?: string; score?: number; verdict?: string; flags?: string[] | number
  liquidity_usd?: number | null; first_seen?: string; outcome?: 'held' | 'up' | 'down' | 'drained' | 'pending' | null
  liquidity_24h_usd?: number | null; [k: string]: unknown
}
export type Radar = {
  since?: string; scanned: number; rechecked: number
  outcomes: { held: number; up: number; down: number; drained: number }
  latest: RadarItem[]
}

// ---- transport ------------------------------------------------------------
type Opts = { method?: string; body?: unknown; headers?: Record<string, string>; token?: string; timeoutMs?: number; signal?: AbortSignal }

function mapStatus(status: number): ErrorCode {
  if (status === 429) return 'rate_limited'
  if (status === 401) return 'invalid_key'
  if (status === 402) return 'payment_required'
  if (status === 404) return 'model_not_found'
  if (status === 400) return 'bad_request'
  if (status === 503) return 'not_configured'
  if (status >= 500) return 'upstream_error'
  return 'unknown'
}

async function fail(res: Response): Promise<never> {
  let data: any
  try { data = await res.json() } catch { /* not json */ }
  const e = data?.error
  const code = (typeof e?.code === 'string' ? e.code : mapStatus(res.status)) as ErrorCode
  const message = typeof e?.message === 'string' ? e.message : `Request failed (HTTP ${res.status}).`
  throw new ApiError(code, message, res.status, data)
}

export async function send(base: string, path: string, o: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { ...o.headers }
  if (o.body !== undefined) headers['content-type'] = 'application/json'
  if (o.token) headers.authorization = `Bearer ${o.token}`
  const timeout = AbortSignal.timeout(o.timeoutMs ?? 15_000)
  try {
    return await fetch(base + path, {
      method: o.method ?? (o.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
    })
  } catch (err) {
    if (o.signal?.aborted) throw err
    if (timeout.aborted) throw new ApiError('timeout', 'The server took too long to answer.')
    throw new ApiError('network_error', `Cannot reach ${base}. The service may be down or not deployed yet.`)
  }
}

// The API sends money as exact 6-decimal strings ("5.000000"). Every *_usd field becomes a number here, once, so
// screens can do math and toFixed on it.
export function moneyToNumbers(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(moneyToNumbers)
  if (!v || typeof v !== 'object') return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    out[k] = k.endsWith('_usd') && typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : moneyToNumbers(x)
  }
  return out
}

async function json<T>(base: string, path: string, o: Opts = {}): Promise<T> {
  const res = await send(base, path, o)
  if (!res.ok) await fail(res)
  let data: unknown
  try { data = await res.json() } catch { throw new ApiError('bad_response', 'The server sent something that is not JSON.', res.status) }
  return moneyToNumbers(data) as T
}

const api = <T,>(path: string, o?: Opts) => json<T>(API_BASE, path, o)
const scan = <T,>(path: string, o?: Opts) => json<T>(SCAN_BASE, path, o)

// ---- api worker -----------------------------------------------------------
export const getModels = () => api<{ data: LiveModel[] }>('/v1/models').then((r) => r.data)
export const getStats = (range: '7d' | '30d' | '90d' | 'all') => api<Stats>(`/v1/stats?range=${range}`)
export const authNonce = (address: string) => api<{ message: string; nonce: string }>('/v1/auth/nonce', { body: { address } })
export const authVerify = (address: string, signature: string, nonce: string) =>
  api<{ token: string }>('/v1/auth/verify', { body: { address, signature, nonce } })
export const getWallet = (token: string) => api<WalletInfo>('/v1/wallet', { token })
export const closeWalletKey = (token: string, id: string) => api<unknown>(`/v1/wallet/keys/${encodeURIComponent(id)}/close`, { method: 'POST', token })
export const getKeyMe = (key: string) => api<KeyMe>('/v1/keys/me', { token: key })

/** POST without payment: the server answers 402 with the price. Returns that offer. */
export async function requestQuote(path: string, body: unknown, token?: string): Promise<PaymentRequired> {
  const res = await send(API_BASE, path, { body, token })
  if (res.status !== 402) {
    if (!res.ok) await fail(res)
    throw new ApiError('bad_response', 'Expected a price quote (402) but the server accepted the call without payment.', res.status)
  }
  let data: PaymentRequired | undefined
  try { data = await res.json() } catch { /* fall to header */ }
  if (!data?.accepts?.length) {
    const h = res.headers.get('PAYMENT-REQUIRED')
    if (h) { try { data = JSON.parse(atob(h)) } catch { /* ignore */ } }
  }
  if (!data?.accepts?.length) throw new ApiError('bad_response', 'The 402 answer had no payment terms.', 402)
  return data
}

/** Resend a paid call with the signed x402 payload (base64). */
export async function sendPaid<T>(path: string, body: unknown, payment: string, token?: string): Promise<T> {
  return api<T>(path, { body, token, headers: { 'PAYMENT-SIGNATURE': payment }, timeoutMs: 60_000 })
}

export type MintResult = { key: string; balance_usd: number; owner: string }
export type TopupResult = { balance_usd: number }

export const revokeKey = (key: string) => api<unknown>('/v1/keys/me', { method: 'DELETE', token: key })

// ---- chat streaming -------------------------------------------------------
export type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string }
export type ChatMeta = { model?: string; costUsd?: number; cache?: string; discountPct?: number; tokensIn?: number; tokensOut?: number }

/** Streams a chat completion (SSE, OpenAI chunk format). `onDelta` gets text pieces. Resolves with usage and headers. */
export async function streamChat(
  o: { path: '/v1/playground/chat' | '/v1/chat/completions'; token?: string; model: string; messages: ChatMsg[]; maxTokens?: number; signal?: AbortSignal; onDelta: (t: string) => void },
): Promise<ChatMeta> {
  const res = await send(API_BASE, o.path, {
    token: o.token, signal: o.signal, timeoutMs: 120_000,
    body: { model: o.model, messages: o.messages, stream: true, stream_options: { include_usage: true }, ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}) },
  })
  if (!res.ok) await fail(res)
  const num = (h: string) => { const v = res.headers.get(h); return v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v) }
  const meta: ChatMeta = {
    model: res.headers.get('X-Forge-Model') ?? undefined,
    costUsd: num('X-Forge-Cost-Usd'),
    cache: res.headers.get('X-Forge-Cache') ?? undefined,
    discountPct: num('X-Forge-Discount-Pct'),
  }
  const ct = res.headers.get('content-type') ?? ''
  if (!res.body) throw new ApiError('bad_response', 'No response body.')
  // Non-stream JSON reply (cache hit or server choice): handle as one piece.
  if (ct.includes('application/json')) {
    const d: any = await res.json()
    const text = d?.choices?.[0]?.message?.content ?? ''
    if (text) o.onDelta(text)
    applyUsage(meta, d)
    return meta
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return meta
      let chunk: any
      try { chunk = JSON.parse(data) } catch { continue }
      if (chunk?.error) throw new ApiError((chunk.error.code as ErrorCode) ?? 'upstream_error', chunk.error.message ?? 'Stream failed.')
      const t = chunk?.choices?.[0]?.delta?.content
      if (t) o.onDelta(t)
      applyUsage(meta, chunk)
    }
  }
  return meta
}

function applyUsage(meta: ChatMeta, d: any) {
  if (d?.model && !meta.model) meta.model = d.model
  const u = d?.usage
  if (!u) return
  if (typeof u.prompt_tokens === 'number') meta.tokensIn = u.prompt_tokens
  if (typeof u.completion_tokens === 'number') meta.tokensOut = u.completion_tokens
  const c = u.cost_usd ?? u.forge_cost_usd
  if (typeof c === 'number' && meta.costUsd === undefined) meta.costUsd = c
}

// ---- scan worker ----------------------------------------------------------
export const getScan = (address: string) => scan<ScanResult>(`/v1/scan/${encodeURIComponent(address)}`, { timeoutMs: 30_000 })
export const getRecentScans = () => scan<RecentScan[] | { scans: RecentScan[] }>('/v1/scan/recent').then((r) => (Array.isArray(r) ? r : r.scans ?? []))
export const getRadar = () => scan<Radar>('/v1/radar')
export const getScanRules = () => scan<unknown>('/v1/scan/rules')
export const SCAN_RULES_URL = `${SCAN_BASE}/v1/scan/rules`
