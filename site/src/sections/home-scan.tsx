import { Reveal } from '@/components/reveal'
import { ScanForm } from '@/components/scan-form'
import { EmberField } from '@/components/ember-field'
import { Link } from 'react-router'
import { useEffect, useState } from 'react'
import { getRecentScans, type RecentScan } from '@/lib/api'
import { shortAddr } from '@/lib/wallet'

const rows: [string, string, boolean][] = [
  ['Bytecode', 'verified source', true],
  ['Owner', 'renounced', true],
  ['Mint · blacklist · fees', 'no mint · no blacklist · 0% tax', true],
  ['Proxy slot', 'upgradeable proxy found', false],
  ['Liquidity', 'locked 90 days', true],
  ['24h txns', '1,204', true],
]

function SampleCard() {
  return (
    <div className="tilt glass rounded-[24px] p-1 shadow-[0_40px_90px_rgba(0,0,0,0.5)]" aria-label="Sample scan result, illustration only">
      <div className="overflow-hidden rounded-[20px] bg-black/40">
        <div className="label flex items-center justify-between border-b border-white/10 px-5 py-3">
          <span>Inspection sheet</span>
          <span className="rounded-full bg-ember/20 px-2.5 py-1 !text-hot">SAMPLE</span>
        </div>
        <ul className="m-0 list-none p-0 font-mono text-[13px] text-white">
          {rows.map(([k, v, pass]) => (
            <li key={k} className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-b border-white/[0.07] px-5 py-3 sm:grid-cols-[150px_1fr_auto]">
              <span className="label">{k}</span>
              <span className="order-3 col-span-2 text-white/85 sm:order-none sm:col-span-1">{v}</span>
              <span className={`rounded-full px-2.5 py-[3px] text-[10.5px] tracking-wider ${pass ? 'bg-emerald-400/15 text-emerald-300' : 'bg-ember/20 text-hot'}`}>{pass ? 'PASS' : 'FLAG'}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-end justify-between px-5 pb-3 pt-5">
          <span className="label">Score</span>
          <p className="m-0 text-[64px] font-semibold leading-none tracking-[-0.05em] text-white">92 <span className="font-mono text-[16px] font-normal text-white/55">/100</span></p>
        </div>
        <div className="mx-4 mb-4 rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <p className="label !text-hot">AI summary · sample</p>
          <p className="mt-2 text-[13.5px] leading-snug text-white/75">Clean token, no mint or blacklist. One upgradeable proxy slot, so ownership of the proxy admin is worth checking before you size up.</p>
        </div>
      </div>
    </div>
  )
}

function RecentStrip() {
  const [rows, setRows] = useState<RecentScan[]>([])
  useEffect(() => { let dead = false; getRecentScans().then((r) => { if (!dead) setRows(r.slice(0, 4)) }).catch(() => {}); return () => { dead = true } }, [])
  if (rows.length === 0) return null
  return (
    <div className="mt-6">
      <p className="label">Recently scanned</p>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
        {rows.map((r) => <li key={r.address}><Link to={`/scan/${r.address}`} className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[12px] text-white no-underline hover:bg-white/10">{r.symbol || shortAddr(r.address)}{typeof r.score === 'number' && <b className="text-hot">{r.score}</b>}</Link></li>)}
      </ul>
    </div>
  )
}

export function HomeScan() {
  return (
    <section className="stage stage-wrap" aria-labelledby="scan-h">
      <EmberField />
      <div className="wrap grid grid-cols-1 items-center gap-14 py-16 md:py-24 lg:grid-cols-[1fr_1fr]">
        <Reveal>
          <p className="chip"><span className="chip-dot" />Forge Scan</p>
          <h2 id="scan-h" className="display display-section mt-5">Read the contract <em className="fraunces-italic-gradient">before the chart.</em></h2>
          <p className="mb-8 mt-6 max-w-[32em] text-[17px] text-white/72 md:text-[19px]">Paste a token address. Forge reads the contract straight from the chain and scores it out of 100.</p>
          <ScanForm id="home-ca" dark />
          <p className="label mt-4">Free on the web · $0.02 per agent call</p>
          <RecentStrip />
        </Reveal>
        <Reveal delay={0.1} className="lg:pl-6"><SampleCard /></Reveal>
      </div>
    </section>
  )
}
