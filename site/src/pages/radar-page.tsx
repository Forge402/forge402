import { Link } from 'react-router'
import { PageStub } from '@/components/page-stub'
import { getRadar, type RadarItem } from '@/lib/api'
import { useAsync } from '@/lib/use-async'
import { shortAddr } from '@/lib/wallet'
import { fmtInt } from '@/features/playground/format'

const usd = (n?: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`)
const OUT = { held: 'bg-[#E8F0FF] text-blue-900', up: 'bg-[#DFF7E8] text-emerald-800', down: 'bg-[#FFF1D6] text-amber-900', drained: 'bg-[#FFE9DF] text-ember-ink' } as const
const flagCount = (f: RadarItem['flags']) => (Array.isArray(f) ? f.length : typeof f === 'number' ? f : null)

const Cell = ({ k, v }: { k: string; v: string }) => <div className="panel px-5 py-6"><p className="label">{k}</p><p className="display mt-2 text-[40px] leading-none">{v}</p></div>
const NOTE = 'Not live yet or not reachable.'

export default function RadarPage() {
  const st = useAsync(getRadar, 0)
  return (
    <PageStub fig="Radar" name="Radar" title={<>Young tokens, <em className="fraunces-italic-gradient">scanned.</em></>} note="Trending new pools (under 3 days old, at least $10K liquidity) get scanned on first sight and checked again after 24 hours. The record below is what actually happened.">
      {st.s === 'loading' && <p role="status" className="panel p-6">Loading…</p>}
      {st.s === 'err' && <p role="alert" className="panel p-6 text-ember-ink">Radar unavailable: {st.msg} {NOTE}</p>}
      {st.s === 'ok' && (() => {
        const d = st.data
        const o = d.outcomes ?? { held: 0, up: 0, down: 0, drained: 0 }
        return (
          <div className="grid gap-8">
            <div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                <Cell k="Scanned" v={fmtInt(d.scanned)} />
                <Cell k="Rechecked" v={fmtInt(d.rechecked)} />
                <Cell k="Held" v={fmtInt(o.held)} />
                <Cell k="Up" v={fmtInt(o.up)} />
                <Cell k="Down" v={fmtInt(o.down)} />
                <Cell k="Drained" v={fmtInt(o.drained)} />
              </div>
              <p className="label mt-3">{d.since ? `Tracking since ${new Date(d.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Tracking start not reported'} · drained = 10% or less of liquidity left, or under $500</p>
            </div>
            <section aria-labelledby="latest-h">
              <h2 id="latest-h" className="m-0 text-[24px] font-semibold tracking-tight text-ink">Latest</h2>
              {(d.latest?.length ?? 0) === 0 ? <p className="panel mt-4 p-5">No tokens tracked yet.</p> : (
                <div className="panel mt-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-[14px] text-ink">
                    <caption className="sr-only">Latest scanned launches</caption>
                    <thead><tr className="border-b border-line">{['Token', 'Score', 'Flags', 'Liquidity', '24h outcome'].map((h, i) => <th key={h} scope="col" className={`label px-4 py-3 font-normal ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
                    <tbody>
                      {d.latest.map((r) => (
                        <tr key={r.address} className="border-b border-line last:border-b-0">
                          <th scope="row" className="px-4 py-3 text-left font-normal"><Link to={`/scan/${r.address}`} className="text-ink no-underline hover:underline"><span className="font-medium">{r.symbol || r.name || 'Unknown'}</span> <span className="font-mono text-[12px] text-muted">{shortAddr(r.address)}</span></Link></th>
                          <td className="px-4 py-3 text-right font-mono">{r.score ?? '—'}</td>
                          <td className="px-4 py-3 text-right font-mono">{flagCount(r.flags) ?? '—'}</td>
                          <td className="px-4 py-3 text-right font-mono">{usd(r.liquidity_usd)}</td>
                          <td className="px-4 py-3 text-right">{r.outcome && r.outcome in OUT ? <span className={`rounded-full px-2.5 py-[3px] font-mono text-[10.5px] uppercase tracking-wider ${OUT[r.outcome as keyof typeof OUT]}`}>{r.outcome}</span> : <span className="font-mono text-[12px] text-muted">pending</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <p className="m-0 text-[15px]">Want a ping when something you hold changes? <Link to="/watch" className="underline">Use Forge Watch on Telegram</Link>.</p>
          </div>
        )
      })()}
    </PageStub>
  )
}
