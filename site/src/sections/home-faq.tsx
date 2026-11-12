import { Reveal } from '@/components/reveal'

const faqs: [string, string][] = [
  ['What is x402?', 'A way to pay for an HTTP call inside the call. You ask, the server answers 402 Payment Required with a price, your wallet signs a payment, and you ask again with the signature attached. No account, no card.'],
  ['Which chain?', 'Robinhood Chain, network eip155:4663. Payments are in USDG.'],
  ['Do I need an account?', 'No. Your wallet is the account. If you would rather not sign every call, deposit USDG once and use a forge_sk_ key like any API key.'],
  ['What happens to unused money?', 'A pay-per-call price is a ceiling. You pay for the tokens the model actually produced, and the unused part of the ceiling is booked back to you. Prepaid keys only draw down what you use.'],
  ['Is it audited?', 'Not yet. The router is not live, and nothing here has had an outside audit. Do not deposit more than you can afford to lose until that changes.'],
]

export function HomeFaq() {
  return (
    <section className="wrap py-20 md:py-28" aria-labelledby="faq-h">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.4fr]">
        <Reveal>
          <p className="label">Questions</p>
          <h2 id="faq-h" className="display display-section mt-4">Plain <em className="fraunces-italic-gradient">answers.</em></h2>
        </Reveal>
        <Reveal delay={0.1} className="space-y-3">
          {faqs.map(([q, a]) => (
            <details key={q} className="faq panel group px-6">
              <summary className="flex items-center justify-between gap-6 py-5 focus-visible:outline-2 focus-visible:outline-ember">
                <h3 className="m-0 text-[18px] font-semibold leading-tight tracking-[-0.025em] text-ink md:text-[20px]">{q}</h3>
                <span className="faq-plus font-mono text-[26px] leading-none text-ember-ink transition-transform" aria-hidden>+</span>
              </summary>
              <p className="m-0 max-w-[40em] pb-6 pr-8 text-[16px]">{a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
