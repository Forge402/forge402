import { useState } from 'react'
import { Link } from 'react-router'
import { EmberField } from '@/components/ember-field'
import { Ticker } from '@/components/ticker'
import { HeroCa } from '@/components/forge-ca'
import ForgeHero3D from '@/components/forge-hero-3d'
import { cheapestIn, models, providerCount } from '@/data/models'

// ForgeHero3D itself is tiny (the scene is the heavy part). Start pulling the scene + three chunks now,
// at module load, not after mount (home only; index.html also modulepreloads them).
if (typeof location !== 'undefined' && location.pathname === '/') void import('@/three/scene')

export function HomeHero() {
  const [live, setLive] = useState(false)
  return (
    <section aria-label="Forge402" className="relative">
      <div className="stage stage-wrap flex flex-col pb-14 lg:block lg:pb-0 lg:h-[min(880px,calc(100vh-24px))] lg:min-h-[720px]">
        <EmberField />
        {/* live 3D scene: right ~60%, bleeds under the copy */}
        <div className="relative z-0 order-2 h-[340px] sm:h-[420px] lg:absolute lg:inset-y-0 lg:right-0 lg:h-auto lg:w-[64%]" aria-hidden>
          {/* baked frame of the real scene: paints with the first HTML, crossfades out when the canvas is live */}
          <div className="absolute inset-x-0 top-0 h-full max-[559px]:h-[70%]">
            <picture>
              <source media="(max-width: 559px)" srcSet="/assets/hero-poster-compact.webp" />
              <img
                data-hero-poster
                src="/assets/hero-poster.webp"
                alt=""
                width={1200}
                height={634}
                decoding="async"
                fetchPriority="high"
                className="h-full w-full object-contain transition-opacity duration-500"
                style={{ opacity: live ? 0 : 1 }}
              />
            </picture>
          </div>
          <ForgeHero3D onLive={() => setLive(true)} />
        </div>
        <div className="wrap relative z-10 order-1 pb-6 pt-28 lg:absolute lg:inset-0 lg:flex lg:max-w-none lg:flex-col lg:justify-center lg:pb-20 lg:pt-16 lg:pl-[max(40px,calc((100vw-1240px)/2+40px))] lg:pointer-events-none">
          <div className="lg:pointer-events-auto lg:max-w-[640px]">
            <p className="chip"><span className="chip-dot" />Robinhood Chain · <span className="normal-case">x402</span></p>
            <h1 className="display display-hero mt-6">
              Every model, <em className="fraunces-italic-gradient">forged</em> into one endpoint.
            </h1>
            <p className="mt-6 max-w-[34em] text-[17px] text-white/75 md:text-[19px]">
              {models.length} open models from {providerCount} providers behind one OpenAI-compatible URL. Pay per token in USDG, no signup, no card, no seat.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/docs" className="btn btn-primary">Start building →</Link>
              <a href="#strike" className="btn btn-ghost">Under the hood</a>
            </div>
            <HeroCa />
          </div>
        </div>
      </div>

      <div className="wrap relative z-10 -mt-12 lg:-mt-10">
        <div className="panel grid grid-cols-2 gap-y-6 p-5 shadow-[0_20px_50px_rgba(14,15,18,0.08)] md:p-7 lg:grid-cols-5 lg:divide-x lg:divide-line">
          <Stat k="Models online"><Ticker value={models.length} /></Stat>
          <Stat k="Providers"><Ticker value={providerCount} /></Stat>
          <Stat k="From / 1M" note="planned"><Ticker value={cheapestIn.inN} decimals={3} prefix="$" /></Stat>
          <Stat k="Cache hits"><span className="text-[26px] md:text-[30px]">cost half</span></Stat>
          <Link to="/stats" className="col-span-2 flex flex-col justify-center rounded-xl px-0 lg:col-span-1 lg:px-6">
            <span className="label !text-ember-ink">Live ledger →</span>
            <span className="mt-1 text-[14px] leading-snug text-body">Empty until the first call lands.</span>
          </Link>
        </div>
      </div>
    </section>
  )
}

function Stat({ k, note, children }: { k: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="lg:px-6 lg:first:pl-2">
      <p className="label">{k}{note && <span className="text-ember-ink"> · {note}</span>}</p>
      <p className="display mt-2 text-[34px] md:text-[40px]">{children}</p>
    </div>
  )
}
