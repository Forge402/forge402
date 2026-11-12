import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getRecentScans, errorText, type RecentScan } from '@/lib/api'
import { shortAddr } from '@/lib/wallet'

export function RecentScans({ dark = false }: { dark?: boolean }) {
  const [rows, setRows] = useState<RecentScan[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let dead = false
    getRecentScans().then((r) => { if (!dead) setRows(r) }).catch((e) => { if (!dead) setErr(errorText(e)) })
    return () => { dead = true }
  }, [])
  const mute = dark ? 'text-white/60' : 'text-muted'
  return (
    <section aria-labelledby="recent-h" className="mt-10">
      <h2 id="recent-h" className="label">Recently scanned</h2>
      {err ? <p className={`mt-3 text-[14px] ${mute}`}>Recent scans unavailable: {err}</p>
        : rows === null ? <p className={`mt-3 text-[14px] ${mute}`}>Loading…</p>
        : rows.length === 0 ? <p className={`mt-3 text-[14px] ${mute}`}>Nothing scanned yet.</p>
        : (
          <ul className="m-0 mt-3 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <li key={r.address}>
                <Link to={`/scan/${r.address}`} className="panel flex items-center justify-between gap-3 px-4 py-3 text-ink no-underline hover:border-ink">
                  <span className="min-w-0"><span className="block truncate font-medium">{r.symbol || r.name || 'Unknown token'}</span><span className="label block !text-[10.5px]">{shortAddr(r.address)}</span></span>
                  {typeof r.score === 'number' && <span className="font-mono text-[18px] font-semibold">{r.score}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
