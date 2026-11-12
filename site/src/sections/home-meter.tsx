import { Coins, KeyRound, Layers, Undo2 } from 'lucide-react'
import { Reveal } from '@/components/reveal'

const ways = [
  { Icon: Coins, t: 'Pay per call', d: 'x402. Ask, get a 402 with the price, sign the USDG payment, get the answer.' },
  { Icon: KeyRound, t: 'Prepaid keys', d: 'Deposit USDG once, get a forge_sk_ key that works in any OpenAI SDK. Your wallet is the account.' },
  { Icon: Layers, t: 'Response cache', d: 'Send the exact same call again and it costs half.' },
  { Icon: Undo2, t: 'Change comes back', d: 'A call price is a ceiling. The part you did not use is booked back to you.' },
]

export function HomeMeter() {
  return (
    <section className="wrap py-20 md:py-28" aria-labelledby="meter-h">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <Reveal>
          <p className="label">The meter</p>
          <h2 id="meter-h" className="display display-section mt-4">
            Pay for tokens, <em className="fraunces-italic-gradient">not for seats.</em>
          </h2>
          <p className="mt-6 max-w-[32em] text-[18px]">No plans, no minimums, no monthly invoice. You pay for the tokens a model produced, in USDG, and nothing else.</p>
          <div className="mt-10 flex items-end gap-4">
            <p className="display text-[clamp(84px,14vw,148px)] leading-[0.85]">50<span className="fraunces-italic-gradient">%</span></p>
            <p className="label mb-3 max-w-[16ch] !text-body">off when the same call hits the cache</p>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {ways.map(({ Icon, t, d }, i) => (
            <Reveal key={t} delay={i * 0.06} className="panel p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-white"><Icon size={20} aria-hidden /></span>
              <h3 className="mt-8 text-[21px] font-semibold tracking-[-0.03em] text-ink">{t}</h3>
              <p className="mt-2 text-[15.5px] leading-snug">{d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
