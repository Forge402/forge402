import type { Model } from '@/data/models'
import { ProviderLogo } from '@/components/provider-logo'

export function ModelCard({ m, onPick }: { m: Model; onPick?: (id: string) => void }) {
  const body = (
    <>
      <span className="flex items-start gap-3">
        <ProviderLogo provider={m.provider} />
        <span className="min-w-0 flex-1">
          <span className="block break-words font-mono text-[14.5px] font-medium leading-tight text-ink">{m.id}</span>
          <span className="label mt-1 block">{m.provider} · {m.context}{m.type === 'embeddings' ? ' · embeddings' : ''}</span>
        </span>
      </span>
      {m.description && <span className="mt-3 line-clamp-2 block text-[13.5px] leading-snug text-body">{m.description}</span>}
      {(m.tags.length > 0 || m.deprecates) && (
        <span className="mt-3 flex flex-wrap gap-1.5">
          {m.tags.map((t) => <span key={t} className="tag">{t}</span>)}
          {m.deprecates && <span className="rounded-full bg-[#FFE9DF] px-2 py-[3px] font-mono text-[10.5px] uppercase tracking-wider text-ember-ink">deprecates {m.deprecates}</span>}
        </span>
      )}
      <span className="mt-auto grid grid-cols-2 gap-2 border-t border-line pt-3 font-mono text-[13px] text-ink">
        <span><span className="label block !text-[10px]">IN / 1M</span>{m.inPerM}</span>
        <span><span className="label block !text-[10px]">OUT / 1M</span>{m.type === 'embeddings' && m.outN === 0 ? '—' : m.outPerM}</span>
      </span>
    </>
  )
  const cls = 'panel flex h-full w-full flex-col gap-0 p-4 text-left transition-[transform,box-shadow] duration-200'
  if (!onPick) return <div className={cls}>{body}</div>
  return (
    <button onClick={() => onPick(m.id)} className={`${cls} cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(14,15,18,0.08)]`}>
      {body}
    </button>
  )
}
