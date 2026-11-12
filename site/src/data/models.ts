import catalog from '../../../data/models.json'

export type Model = {
  id: string
  provider: string
  context: string
  inPerM: string
  outPerM: string
  /** raw numbers (USDG per 1M tokens, tokens) for math and sorting */
  inN: number
  outN: number
  ctxN: number
  tags: string[]
  type: 'chat' | 'embeddings'
  description?: string
  /** display text such as "20 Nov", only when the catalog says the model is being retired */
  deprecates?: string
  status?: string
  /** guest-free flag when the catalog or the live API sets it */
  free?: boolean
}

type RawModel = {
  id: string
  provider: string
  context: number
  inPerM: number
  outPerM: number
  tags: string[]
  type?: 'chat' | 'embeddings'
  description?: string
  deprecates?: string
  status?: string
  free?: boolean
  /** Cloudflare serves it only on the Workers Paid plan */
  paidPlan?: boolean
}

// Mirrors the API: paid-plan-only models stay hidden until the account upgrades (set VITE_CF_PAID_PLAN=1 then).
const onPaidPlan = import.meta.env.VITE_CF_PAID_PLAN === '1'

export const fmtContext = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 104857.6) / 10}M` : `${Math.round(n / 1000)}K`)
export const fmtPrice = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`

// ISO date -> "20 Nov"; anything else is shown as the catalog wrote it.
function fmtDeprecates(raw?: string) {
  if (!raw) return undefined
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

// Real Cloudflare Workers AI catalog (forge402/data/models.json) with our markup applied.
// Router is not live yet, so pages label these as planned prices.
export const models: Model[] = (catalog.models as RawModel[]).filter((m) => onPaidPlan || !m.paidPlan).map((m) => {
  const type = m.type ?? 'chat'
  return {
    id: m.id,
    provider: m.provider,
    context: fmtContext(m.context),
    inPerM: fmtPrice(m.inPerM),
    outPerM: fmtPrice(m.outPerM),
    inN: m.inPerM,
    outN: m.outPerM,
    ctxN: m.context,
    tags: type === 'embeddings' && !m.tags.includes('embeddings') ? [...m.tags, 'embeddings'] : m.tags,
    type,
    description: m.description,
    deprecates: fmtDeprecates(m.deprecates),
    status: m.status,
    free: m.free,
  }
})

export const providerCount = new Set(models.map((m) => m.provider)).size
export const cheapestIn = models.reduce((a, b) => (b.inN < a.inN ? b : a), models[0])
