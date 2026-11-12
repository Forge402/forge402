import { useState } from 'react'
import { PageStub } from '@/components/page-stub'
import { getStats, type Stats } from '@/lib/api'
import { useAsync } from '@/lib/use-async'
import { fmtInt } from '@/features/playground/format'

const RANGES = ['7d', '30d', '90d', 'all'] as const
type Range = (typeof RANGES)[number]
const compact = (n: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

function DailyChart({ daily }: { daily: Stats['daily'] }) {
  const w = 720, h = 180, pad = 4
  const max = Math.max(1, ...daily.map((d) => d.calls))
  const bw = (w - pad * 2) / daily.length
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${w} ${h + 24}`} className="w-full" role="img" aria-label={`Calls per day, ${daily.length} days, peak ${fmtInt(max)}`}>
        {daily.map((d, i) => {
          const bh = Math.max(d.calls > 0 ? 2 : 0, (d.calls / max) * h)
          return <rect key={d.day} x={pad + i * bw + 1} y={h - bh} width={Math.max(1, bw - 2)} height={bh} rx={2} fill="#FF5A1F"><title>{`${d.day}: ${fmtInt(d.calls)} calls`}</title></rect>
        })}
        <line x1={0} x2={w} y1={h + 0.5} y2={h + 0.5} stroke="#E2E5E9" />
        <text x={pad} y={h + 18} fontSize="11" fontFamily="var(--font-mono)" fill="#6B717C">{daily[0].day}</text>
        <text x={w - pad} y={h + 18} fontSize="11" fontFamily="var(--font-mono)" textAnchor="end" fill="#6B717C">{daily[daily.length - 1].day}</text>
      </svg>
    </figure>
  )
}

export default function StatsPage() {
  const [range, setRange] = useState<Range>('30d')
  const st = useAsync(() => getStats(range), range)
  const d = st.s === 'ok' ? st.data : null
  const cells: [string, string][] = [
    ['Tokens served', d ? compact(d.tokens_in + d.tokens_out) : '—'],
    ['Calls', d ? fmtInt(d.calls) : '—'],
    ['Volume (USDG)', d ? `$${d.volume_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'],
    ['Cache hits', d ? `${Math.round(d.cache_hit_rate * 100)}%` : '—'],
    ['Tokens scanned', d ? fmtInt(d.scans) : '—'],
  ]
  const top = d ? [...d.per_model].sort((a, b) => b.calls - a.calls) : []
  const maxCalls = Math.max(1, ...top.map((m) => m.calls))
  return (
    <PageStub fig="Live ledger" name="Stats" title={<>Real numbers <em className="fraunces-italic-gradient">only.</em></>} note="Counts come from the ledger. They stay at zero until the first call lands.">
      <div className="grid gap-8">
        <div role="tablist" aria-label="Range" className="flex gap-2">
          {RANGES.map((r) => (
            <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}
              className={`label cursor-pointer rounded-full border px-4 py-2 ${range === r ? '!border-ink !bg-ink !text-white' : 'border-line bg-white hover:!text-ink'}`}>{r}</button>
          ))}
        </div>
        {st.s === 'err' && <p role="alert" className="panel p-5 text-ember-ink">Stats unavailable: {st.msg}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy={st.s === 'loading'}>
          {cells.map(([k, v]) => <div key={k} className="panel px-6 py-8"><p className="label">{k}</p><p className="display mt-3 text-[44px] leading-none tnum">{v}</p></div>)}
        </div>
        {d && (
          <>
            {d.calls === 0 && d.scans === 0 && <p className="m-0 text-[15px]">Nothing recorded in this range yet.</p>}
            <section className="panel p-5 md:p-6" aria-labelledby="daily-h">
              <h2 id="daily-h" className="label">Calls per day</h2>
              {d.daily.length === 0 ? <p className="mt-3 text-[15px]">No daily data.</p> : <div className="mt-3"><DailyChart daily={d.daily} /></div>}
            </section>
            <section className="panel p-5 md:p-6" aria-labelledby="pm-h">
              <h2 id="pm-h" className="label">Per model</h2>
              {top.length === 0 ? <p className="mt-3 text-[15px]">No model calls yet.</p> : (
                <ul className="m-0 mt-4 grid list-none gap-3 p-0">
                  {top.map((m) => (
                    <li key={m.model} className="grid grid-cols-[minmax(0,1fr)] gap-1 sm:grid-cols-[220px_1fr_auto] sm:items-center sm:gap-4">
                      <span className="truncate font-mono text-[13.5px] text-ink">{m.model}</span>
                      <span className="h-3 rounded-full bg-page" aria-hidden><span className="block h-full rounded-full bg-ember" style={{ width: `${(m.calls / maxCalls) * 100}%` }} /></span>
                      <span className="font-mono text-[12.5px] text-body">{fmtInt(m.calls)} calls · {compact(m.tokens_in)} in · {compact(m.tokens_out)} out</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </PageStub>
  )
}
