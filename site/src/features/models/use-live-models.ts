import { useEffect, useState } from 'react'
import { fmtContext, fmtPrice, models as catalog, type Model } from '@/data/models'
import { getModels, type LiveModel } from '@/lib/api'

export type LiveState = 'loading' | 'live' | 'offline'

function fromLive(l: LiveModel, base?: Model): Model {
  const inN = l.input_usd_per_mtok ?? base?.inN ?? 0
  const outN = l.output_usd_per_mtok ?? base?.outN ?? 0
  const ctxN = l.context_length ?? base?.ctxN ?? 0
  const type = l.type ?? base?.type ?? 'chat'
  return {
    id: l.id,
    provider: l.provider ?? base?.provider ?? 'unknown',
    context: ctxN ? fmtContext(ctxN) : '—',
    inPerM: fmtPrice(inN), outPerM: fmtPrice(outN), inN, outN, ctxN,
    tags: base?.tags ?? (type === 'embeddings' ? ['embeddings'] : []),
    type,
    description: l.description ?? base?.description,
    deprecates: l.deprecates ?? base?.deprecates,
    status: base?.status,
    free: l.free ?? base?.free,
  }
}

/** Live router list merged over the build-time catalog. Without the API you get the catalog and state 'offline'. */
export function mergeModels(live: LiveModel[]): Model[] {
  const byId = new Map(catalog.map((m) => [m.id, m]))
  const out = live.map((l) => fromLive(l, byId.get(l.id)))
  return out.length ? out : catalog
}

/** Guests get the cheapest chat models when nothing is flagged free explicitly. */
export function withGuestFlags(list: Model[]): Model[] {
  if (list.some((m) => m.free)) return list
  const cheap = new Set(list.filter((m) => m.type === 'chat').sort((a, b) => a.inN + a.outN - (b.inN + b.outN)).slice(0, 3).map((m) => m.id))
  return list.map((m) => ({ ...m, free: cheap.has(m.id) }))
}

export function useLiveModels() {
  const [state, setState] = useState<{ list: Model[]; status: LiveState }>({ list: catalog, status: 'loading' })
  useEffect(() => {
    let dead = false
    getModels()
      .then((l) => { if (!dead) setState({ list: mergeModels(l), status: 'live' }) })
      .catch(() => { if (!dead) setState({ list: catalog, status: 'offline' }) })
    return () => { dead = true }
  }, [])
  return state
}
