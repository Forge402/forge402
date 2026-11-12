import { Reveal } from '@/components/reveal'
import { CodeTabs } from '@/components/code-tabs'

const steps = [
  ['01', 'Bring a wallet', 'Any wallet that holds USDG on Robinhood Chain.'],
  ['02', 'Deposit USDG, mint a key', 'One deposit, one forge_sk_ key. Or skip it and pay per call.'],
  ['03', 'Swap one URL', 'Change base_url in your OpenAI SDK. Nothing else moves.'],
]

export function HomeDropIn() {
  return (
    <section className="wrap py-20 md:py-28" aria-labelledby="drop-h">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.3fr]">
        <Reveal>
          <p className="label">Drop-in</p>
          <h2 id="drop-h" className="display display-section mt-4">Swap <em className="fraunces-italic-gradient">one URL.</em></h2>
          <ol className="m-0 mt-10 list-none space-y-3 p-0">
            {steps.map(([n, t, d]) => (
              <li key={n} className="panel grid grid-cols-[48px_1fr] items-start p-5">
                <span className="label !text-ember-ink">{n}</span>
                <div>
                  <h3 className="m-0 text-[20px] font-semibold leading-tight tracking-[-0.03em] text-ink">{t}</h3>
                  <p className="mt-1 text-[15.5px]">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>
        <Reveal delay={0.1}><CodeTabs /></Reveal>
      </div>
    </section>
  )
}
