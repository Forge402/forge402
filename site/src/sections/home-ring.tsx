import { useMemo, useState } from 'react'
import { Reveal } from '@/components/reveal'
import { Ticker } from '@/components/ticker'
import { ModelCard } from '@/components/model-card'
import { models } from '@/data/models'

type Sort = 'catalog' | 'cheap' | 'dear' | 'context'
const tagOrder = ['reasoning', 'vision', 'code', 'tools', 'embeddings']
const tags = ['all', ...tagOrder.filter((t) => models.some((m) => m.tags.includes(t))), ...[...new Set(models.flatMap((m) => m.tags))].filter((t) => !tagOrder.includes(t))]
const total = (m: (typeof models)[number]) => m.inN + m.outN

export const PICK_EVENT = 'forge:pick-model'

export function HomeRing() {
  const [tag, setTag] = useState('all')
  const [sort, setSort] = useState<Sort>('catalog')

  const rows = useMemo(() => {
    const r = models.filter((m) => tag === 'all' || m.tags.includes(tag))
    if (sort === 'cheap') r.sort((a, b) => total(a) - total(b))
    if (sort === 'dear') r.sort((a, b) => total(b) - total(a))
    if (sort === 'context') r.sort((a, b) => b.ctxN - a.ctxN)
    return r
  }, [tag, sort])

  const pick = (id: string) => {
    window.dispatchEvent(new CustomEvent(PICK_EVENT, { detail: id }))
    document.getElementById('bench')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section id="ring" className="wrap scroll-mt-4 py-20 md:py-28">
      <Reveal>
        <p className="label">The ring · planned prices, not live yet</p>
        <h2 className="display display-section mt-4"><Ticker value={models.length} /> models. <em className="fraunces-italic-gradient">One address.</em></h2>
      </Reveal>

      <div className="mt-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div role="group" aria-label="Filter by tag" className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => setTag(t)}
              aria-pressed={tag === t}
              className={`label cursor-pointer rounded-full border px-4 py-2 ${tag === t ? '!border-ink !bg-ink !text-white' : 'border-line bg-white hover:!text-ink'}`}
            >
              {t} {t === 'all' ? models.length : models.filter((m) => m.tags.includes(t)).length}
            </button>
          ))}
        </div>
        <label className="label flex items-center gap-3">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="field !w-auto !rounded-full !px-4 !py-2 !text-[13px] uppercase">
            <option value="catalog">catalog order</option>
            <option value="cheap">price, low to high</option>
            <option value="dear">price, high to low</option>
            <option value="context">context, longest</option>
          </select>
        </label>
      </div>

      <p className="label mt-6" aria-live="polite">Showing {rows.length} of {models.length} · tap a card to price it</p>
      <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((m) => <li key={m.id}><ModelCard m={m} onPick={pick} /></li>)}
      </ul>
      <p className="label mt-4">USDG per 1M tokens · Cloudflare Workers AI catalog + Forge markup</p>
    </section>
  )
}
