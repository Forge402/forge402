import { useEffect, useState } from 'react'
import { Reveal } from '@/components/reveal'
import { models } from '@/data/models'
import { PICK_EVENT } from '@/sections/home-ring'

const usd = (n: number) => (n >= 100 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(2) : n.toFixed(n < 0.01 ? 6 : 4))

function Slider({ id, label, value, set, min, max, step }: { id: string; label: string; value: number; set: (n: number) => void; min: number; max: number; step: number }) {
  return (
    <div>
      <label htmlFor={id} className="label flex justify-between"><span>{label}</span></label>
      <div className="mt-2 grid grid-cols-[1fr_110px] items-center gap-4">
        <input aria-label={`${label} slider`} className="range" type="range" min={min} max={max} step={step} value={Math.min(value, max)} onChange={(e) => set(+e.target.value)} />
        <input id={id} className="field !px-3 !py-2 text-right" type="number" min={0} value={value} onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))} />
      </div>
    </div>
  )
}

export function HomeBench() {
  const [id, setId] = useState(models.find((m) => m.type === 'chat')?.id ?? models[0].id)
  const [tin, setTin] = useState(2000)
  const [tout, setTout] = useState(500)
  const [calls, setCalls] = useState(1000)

  useEffect(() => {
    const on = (e: Event) => { const v = (e as CustomEvent<string>).detail; if (models.some((m) => m.id === v)) setId(v) }
    window.addEventListener(PICK_EVENT, on)
    return () => window.removeEventListener(PICK_EVENT, on)
  }, [])

  const m = models.find((x) => x.id === id) ?? models[0]
  const perCall = (tin / 1e6) * m.inN + (tout / 1e6) * m.outN
  const rows: [string, number][] = [['PER CALL', perCall], ['PER DAY', perCall * calls], ['PER MONTH · 30 D', perCall * calls * 30]]

  return (
    <section id="bench" className="wrap scroll-mt-4">
      <div className="grid grid-cols-1 gap-12 pb-20 md:pb-28 lg:grid-cols-[1fr_1.1fr]">
        <Reveal>
          <p className="label">Cost bench · estimate</p>
          <h2 className="display display-section mt-4">Price a workload <em className="fraunces-italic-gradient">before you run it.</em></h2>
          <p className="mt-6 max-w-[30em] text-[18px]">Math runs in your browser from the planned catalog prices. No call is made, nothing is stored.</p>
          <div className="mt-8 space-y-6">
            <div>
              <label htmlFor="bench-model" className="label">Model</label>
              <select id="bench-model" className="field mt-2" value={id} onChange={(e) => setId(e.target.value)}>
                {models.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.provider}</option>)}
              </select>
            </div>
            <Slider id="bench-in" label="INPUT TOKENS / CALL" value={tin} set={setTin} min={0} max={200000} step={500} />
            <Slider id="bench-out" label="OUTPUT TOKENS / CALL" value={tout} set={setTout} min={0} max={50000} step={100} />
            <Slider id="bench-calls" label="CALLS / DAY" value={calls} set={setCalls} min={1} max={100000} step={100} />
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="panel overflow-hidden" aria-live="polite">
            <div className="label flex justify-between border-b border-line px-5 py-3">
              <span>{m.id}</span>
              <span>{m.inPerM} IN · {m.outPerM} OUT</span>
            </div>
            <table className="w-full border-collapse font-mono text-ink">
              <caption className="sr-only">Estimated cost in USDG</caption>
              <thead>
                <tr className="label border-b border-line">
                  <th scope="col" className="px-5 py-3 text-left font-normal">USDG</th>
                  <th scope="col" className="px-5 py-3 text-right font-normal">LIST</th>
                  <th scope="col" className="px-5 py-3 text-right font-normal !text-ember-ink">CACHE HIT · ½</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k} className="border-b border-line last:border-b-0">
                    <th scope="row" className="label px-5 py-5 text-left font-normal">{k}</th>
                    <td className="tnum px-5 py-5 text-right text-[20px] md:text-[26px]">{usd(v)}</td>
                    <td className="tnum px-5 py-5 text-right text-[20px] text-ember-ink md:text-[26px]">{usd(v / 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="label border-t border-line px-5 py-3">ESTIMATE · PLANNED PRICES · CACHE HIT = SAME CALL REPEATED EXACTLY</p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
