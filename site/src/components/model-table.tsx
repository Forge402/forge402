import type { Model } from '@/data/models'
import { ProviderLogo } from '@/components/provider-logo'

export function ModelTable({ rows, showTags = false }: { rows: Model[]; showTags?: boolean }) {
  const th = 'label px-4 py-3 text-left font-normal'
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse font-mono text-[14px] text-ink">
        <caption className="sr-only">Model prices in USDG per 1M tokens</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={th}>Model</th>
            <th scope="col" className={th}>Context</th>
            <th scope="col" className={`${th} text-right`}>In / 1M</th>
            <th scope="col" className={`${th} text-right`}>Out / 1M</th>
            {showTags && <th scope="col" className={th}>Tags</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className="border-b border-line last:border-b-0">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <span className="flex items-center gap-3">
                  <ProviderLogo provider={m.provider} size={30} />
                  <span><span className="block">{m.id}</span><span className="label block !text-[10px]">{m.provider}</span></span>
                  {m.deprecates && <span className="rounded-full bg-[#FFE9DF] px-2 py-[3px] text-[10.5px] uppercase tracking-wider text-ember-ink">deprecates {m.deprecates}</span>}
                </span>
              </th>
              <td className="px-4 py-3 text-muted">{m.context}</td>
              <td className="px-4 py-3 text-right">{m.inPerM}</td>
              <td className="px-4 py-3 text-right">{m.type === 'embeddings' && m.outN === 0 ? '—' : m.outPerM}</td>
              {showTags && <td className="px-4 py-3"><span className="flex flex-wrap gap-1.5">{m.tags.map((t) => <span key={t} className="tag">{t}</span>)}</span></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
