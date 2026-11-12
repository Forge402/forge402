import { useState } from 'react'
import { Link } from 'react-router'
import { Reveal } from '@/components/reveal'
import { ForgeCa } from '@/components/forge-ca'
import { EmberField } from '@/components/ember-field'

export function ForgeCoin({ size = 240 }: { size?: number }) {
  const [failed, setFailed] = useState(false)
  const [spinFailed, setSpinFailed] = useState(false)
  const [spinReady, setSpinReady] = useState(false)
  const [still] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  if (failed) {
    return (
      <div
        className="coin-glow flex items-center justify-center rounded-full font-mono text-[22px] font-semibold tracking-wider text-[#0A0807]"
        style={{ width: size, height: size, background: 'radial-gradient(circle at 35% 30%, #FFD58A, #FF5A1F 55%, #7A1E05)' }}
        role="img" aria-label="$FORGE coin"
      >
        $FORGE
      </div>
    )
  }
  // The spin is an animated WebP with alpha, not a VP9 video: phones (iOS Safari, many Android GPUs) play VP9 but drop
  // its alpha, which drew a black square. The still webp sits underneath, so there is never an empty box while the
  // animation loads (it is hidden once the spin is up, or it would show through the edge-on frames), and it is all
  // that shows for reduced motion.
  const spinning = !still && !spinFailed
  return (
    <div className="coin-glow" style={{ width: size, height: size }}>
      {!(spinning && spinReady) && (
        <img src="/assets/forge-coin.webp" alt={spinning ? '' : '$FORGE coin'} width={size} height={size} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-contain" />
      )}
      {spinning && (
        <img
          src="/assets/forge-coin-spin.webp" alt="$FORGE coin" width={size} height={size} decoding="async"
          onLoad={() => setSpinReady(true)} onError={() => setSpinFailed(true)}
          className="absolute inset-0 h-full w-full object-contain" style={{ opacity: spinReady ? 1 : 0 }}
        />
      )}
    </div>
  )
}

export function HomeToken() {
  return (
    <section className="stage stage-wrap" aria-labelledby="token-h">
      <EmberField />
      <div className="wrap flex flex-col items-center py-16 text-center md:py-24">
        <ForgeCoin size={220} />
        <h2 id="token-h" className="display display-section mt-8">$FORGE: <em className="fraunces-italic-gradient">hold it, pay less.</em></h2>
        <p className="mt-5 max-w-[40em] text-[17px] text-white/72 md:text-[19px]">
          Hold $FORGE in the wallet that pays and every call costs less. Calls are still paid in USDG, so you never need the token to use the router.
        </p>
        <Reveal className="mt-10 flex w-full justify-center"><ForgeCa /></Reveal>
        <Link to="/token" className="btn btn-ghost mt-8">About $FORGE →</Link>
      </div>
    </section>
  )
}

export function CtaBand() {
  return (
    <section className="wrap py-10 md:py-16" aria-label="Get started">
      <div className="panel flex flex-col items-start justify-between gap-8 p-8 md:flex-row md:items-center md:p-12">
        <h2 className="display m-0 max-w-[18ch] text-[clamp(34px,5vw,54px)]">Strike your first call, <em className="fraunces-italic-gradient">today.</em></h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link to="/docs" className="btn btn-primary">Start building →</Link>
          <Link to="/scan" className="btn btn-light">Scan a token</Link>
        </div>
      </div>
    </section>
  )
}
