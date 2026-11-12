import { useEffect, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { EmberField } from '@/components/ember-field'

// DEMO TRACE: amounts and headers are illustrative, not a captured call.
const steps: { t: string; d: string; lines: string[] }[] = [
  {
    t: 'Agent sends the request',
    d: 'A plain OpenAI-style call. No key, no account.',
    lines: ['> POST /v1/chat/completions HTTP/1.1', '> Host: api.forge402.pro', '> Content-Type: application/json', '', '> {"model":"llama-3.3-70b-instruct","messages":[{"role":"user","content":"Ping"}]}'],
  },
  {
    t: 'Server answers 402 + price',
    d: 'The price for the ceiling of this call, in USDG.',
    lines: ['< HTTP/1.1 402 Payment Required', '< PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Miwi…', '<   scheme: exact · asset: USDG · ceiling: 0.004000', '<   network: eip155:4663'],
  },
  {
    t: 'Agent signs a USDG authorization',
    d: 'One signature from the agent wallet. No gas, no approval step.',
    lines: ['> POST /v1/chat/completions HTTP/1.1', '> PAYMENT-SIGNATURE: eyJzaWduYXR1cmUiOiIweDkx…', '>   from: 0xA9…c4E1 · value: 0.004000'],
  },
  {
    t: 'Facilitator settles on Robinhood Chain',
    d: 'The facilitator verifies the signature and moves the USDG.',
    lines: ['* facilitator.verify  ok', '* facilitator.settle  tx 0x5e1f…92ab', '* chain eip155:4663 · status confirmed'],
  },
  {
    t: 'Model streams tokens',
    d: 'Workers AI runs the model and the answer streams back.',
    lines: ['< HTTP/1.1 200 OK', '< Content-Type: text/event-stream', '', '< data: {"choices":[{"delta":{"content":"Pong"}}]}', '< data: {"choices":[{"delta":{"content":"."}}]}', '< data: [DONE]'],
  },
  {
    t: 'Unused ceiling booked back',
    d: 'You pay for the tokens used. The rest goes on your credit.',
    lines: ['< PAYMENT-RESPONSE: settled', '<   used: 0.000812 · ceiling: 0.004000', '<   credit booked: 0.003188 USDG'],
  },
]

const STEP_PAUSE = 1100

export function HomeStrike() {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { amount: 0.35 })
  const reduce = useReducedMotion()
  const [step, setStep] = useState(0)
  const [chars, setChars] = useState(0)
  const [manual, setManual] = useState(false)

  const typed = reduce || manual
  const text = steps[step].lines.join('\n')

  // type the current step's lines, then move on
  useEffect(() => {
    if (typed || !inView) return
    if (chars < text.length) {
      const id = setTimeout(() => setChars((c) => Math.min(text.length, c + 3)), 16)
      return () => clearTimeout(id)
    }
    const id = setTimeout(() => {
      setStep((s) => (s + 1) % steps.length)
      setChars(0)
    }, step === steps.length - 1 ? STEP_PAUSE * 2.5 : STEP_PAUSE)
    return () => clearTimeout(id)
  }, [typed, inView, chars, text, step])

  const pick = (i: number) => { setManual(true); setStep(i) }
  const done = steps.slice(0, step)
  const current = typed ? text : text.slice(0, chars)

  return (
    <section ref={ref} id="strike" className="stage stage-wrap scroll-mt-4" aria-labelledby="strike-h">
      <EmberField />
      <div className="wrap grid grid-cols-1 gap-10 py-16 md:py-24 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <p className="chip"><span className="chip-dot" />The strike · demo trace</p>
          <h2 id="strike-h" className="display display-section mt-5">One paid call, <em className="fraunces-italic-gradient">start to finish.</em></h2>
          <ol className="m-0 mt-10 list-none border-t border-white/15 p-0">
            {steps.map((s, i) => {
              const on = i === step
              return (
                <li key={s.t} className="border-b border-white/10">
                  <button
                    onClick={() => pick(i)}
                    aria-current={on ? 'step' : undefined}
                    className={`grid w-full cursor-pointer grid-cols-[44px_1fr] gap-y-1 py-4 pr-2 text-left ${on ? '' : 'opacity-55 hover:opacity-100'}`}
                  >
                    <span className={`label ${on ? '!text-ember' : ''}`}>0{i + 1}</span>
                    <span className="text-[20px] font-semibold leading-tight tracking-[-0.03em] text-white md:text-[22px]">{s.t}</span>
                    {on && <span className="col-start-2 text-[15.5px] leading-snug text-white/70">{s.d}</span>}
                  </button>
                </li>
              )
            })}
          </ol>
        </div>

        <div className="glass self-start overflow-hidden rounded-2xl lg:sticky lg:top-24">
          <div className="label flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-white/20" /><i className="h-2.5 w-2.5 rounded-full bg-white/20" /><i className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="ml-2">Terminal · step 0{step + 1}/06</span></span>
            <span className="!text-ember">Demo trace</span>
          </div>
          <pre
            tabIndex={0}
            aria-label="Demo HTTP trace for the selected step"
            className="m-0 h-[340px] overflow-auto whitespace-pre-wrap break-all bg-black/30 p-4 font-mono text-[12.5px] leading-6 text-white/75 md:h-[380px] md:text-[13.5px]"
          >
            {(typed ? [] : done).map((s) => (
              <span key={s.t} className="block text-white/40">{s.lines.join('\n') + '\n'}</span>
            ))}
            <span className="text-white">{current}</span>
            <span className="cursor" aria-hidden />
          </pre>
          <p className="label border-t border-white/10 px-4 py-3">Amounts and hashes are illustrative. Not a captured call.</p>
        </div>
      </div>
    </section>
  )
}
