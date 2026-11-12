import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Check, Copy } from 'lucide-react'
import { ApiError, getScan, SCAN_RULES_URL, type ScanResult, type ScanCheck } from '@/lib/api'
import { ScoreDial } from '@/features/scan/score-dial'
import { EXPLORER } from '@/lib/wallet'

const usd = (n?: number | null) => (n === null || n === undefined ? 'unknown' : n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n < 1 ? n.toPrecision(3) : n.toFixed(2)}`)
const BADGE = { pass: 'bg-[#DFF7E8] text-emerald-800', flag: 'bg-[#FFE9DF] text-ember-ink', unknown: 'bg-[#F1F3F5] text-body' } as const

const checkValue = (v: ScanCheck['value']) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v))

export type ScanState = { s: 'loading' } | { s: 'ok'; r: ScanResult } | { s: 'err'; code: string; msg: string }

export function useScan(address: string) {
  const [state, setState] = useState<ScanState>({ s: 'loading' })
  useEffect(() => {
    let dead = false
    setState({ s: 'loading' })
    getScan(address)
      .then((r) => { if (!dead) setState({ s: 'ok', r }) })
      .catch((e) => { if (!dead) setState({ s: 'err', code: e instanceof ApiError ? e.code : 'unknown', msg: e instanceof Error ? e.message : 'Scan failed.' }) })
    return () => { dead = true }
  }, [address])
  return state
}

export function ScanReport({ r }: { r: ScanResult }) {
  const [copied, setCopied] = useState(false)
  const share = typeof window !== 'undefined' ? `${window.location.origin}/scan/${r.address}` : ''
  const m = r.market
  const checks = r.checks ?? []
  const when = new Date(r.scanned_at)
  return (
    <div className="grid gap-6">
      <div className="panel grid gap-6 p-5 md:grid-cols-[auto_1fr] md:p-8">
        <ScoreDial score={r.score} verdict={r.verdict} />
        <div className="min-w-0">
          <h2 className="m-0 text-[28px] font-semibold tracking-tight text-ink">{r.symbol || 'Unknown'} {r.name && <span className="font-normal text-muted">· {r.name}</span>}</h2>
          <p className="mt-1 break-all font-mono text-[13px]"><a className="underline" href={`${EXPLORER}/token/${r.address}`} target="_blank" rel="noreferrer">{r.address}</a></p>
          {r.summary && <div className="mt-4 rounded-xl border border-line bg-page p-4"><p className="label !text-ember-ink">Summary</p><p className="m-0 mt-1.5 text-[15px] leading-snug text-ink">{r.summary}</p></div>}
          <p className="mt-3 text-[13px] text-muted">Scanned <time dateTime={r.scanned_at}>{Number.isNaN(when.getTime()) ? r.scanned_at : when.toLocaleString()}</time> · <a className="underline" href={SCAN_RULES_URL} target="_blank" rel="noreferrer">scoring rules{r.rules_version ? ` v${r.rules_version}` : ''}</a></p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={async () => { try { await navigator.clipboard.writeText(share); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* blocked */ } }} className="btn btn-light !px-4 !py-2.5 !text-[12px]">
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}<span aria-live="polite">{copied ? 'Link copied' : 'Copy share link'}</span>
            </button>
            <Link to="/scan" className="btn btn-light !px-4 !py-2.5 !text-[12px]">Scan another</Link>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[14px] text-ink">
            <caption className="sr-only">Contract checks</caption>
            <thead><tr className="border-b border-line"><th scope="col" className="label px-4 py-3 text-left font-normal">Check</th><th scope="col" className="label px-4 py-3 text-left font-normal">Finding</th><th scope="col" className="label px-4 py-3 text-right font-normal">Result</th></tr></thead>
            <tbody>
              {checks.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-muted">The scanner returned no checks.</td></tr>}
              {checks.map((c) => (
                <tr key={c.id} className="border-b border-line align-top last:border-b-0">
                  <th scope="row" className="px-4 py-3 text-left font-medium">{c.label}</th>
                  <td className="px-4 py-3"><span className="font-mono text-[13px]">{checkValue(c.value)}</span>{c.detail && <span className="mt-0.5 block text-[13px] text-body">{c.detail}</span>}</td>
                  <td className="px-4 py-3 text-right"><span className={`rounded-full px-2.5 py-[3px] font-mono text-[10.5px] uppercase tracking-wider ${BADGE[c.status] ?? BADGE.unknown}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="panel p-5" aria-label="Market">
          <p className="label">Market</p>
          {!m ? (
            <p className="mt-3 text-[14px] text-body">
              {r.market_status === 'no_pool'
                ? 'No pool found for this token on Robinhood Chain.'
                : 'Market data is unavailable right now (the data source is rate-limited). Liquidity was not scored. Try again later.'}
            </p>
          ) : (
            <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-4 font-mono text-[14px] text-ink">
              {([
                ['Liquidity', usd(m.liquidity_usd)],
                ['Price', usd(m.price_usd)],
                ['FDV', usd(m.fdv_usd)],
                ['24h buys / sells', m.txns_24h ? `${m.txns_24h.buys} / ${m.txns_24h.sells}` : 'unknown'],
                ['Pool age', m.pool_age_hours == null ? 'unknown' : m.pool_age_hours < 48 ? `${Math.round(m.pool_age_hours)} h` : `${Math.round(m.pool_age_hours / 24)} d`],
                ['DEX', m.dex ?? 'unknown'],
              ] as [string, string][]).map(([k, v]) => <div key={k}><dt className="label !text-[10px]">{k}</dt><dd className="m-0 mt-0.5 break-words">{v}</dd></div>)}
            </dl>
          )}
          {/* CoinGecko Demo plan requires attribution. */}
          <p className="mt-5 text-[12px] text-muted">
            Market data by <a className="underline" href="https://www.coingecko.com/en/api" target="_blank" rel="noreferrer">CoinGecko</a> and DexScreener.
          </p>
        </aside>
      </div>
    </div>
  )
}
