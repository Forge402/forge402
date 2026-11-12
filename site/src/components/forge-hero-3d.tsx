import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { models, type Model } from '@/data/models'
import { providerLogoOnDark } from '@/data/provider-logos'

// Lazy three.js hero "The Strike". The three.js scene lives in src/three/scene.ts and is a separate chunk.

/**
 * Pick up to 8 chat models from the catalog: the providers with the most models,
 * each represented by its priciest model that is not being retired. Long ids go to
 * the outer beam slots (shortest horizontal reach), short ids to the middle.
 */
function pickChipModels(): Model[] {
  const best = new Map<string, { count: number; top: Model }>()
  for (const m of models) {
    if (m.type !== 'chat') continue
    const e = best.get(m.provider) ?? { count: 0, top: m }
    e.count++
    if (!m.deprecates && (e.top.deprecates || m.outN > e.top.outN)) e.top = m
    best.set(m.provider, e)
  }
  const top = [...best.values()]
    .filter((e) => !e.top.deprecates)
    .sort((a, b) => b.count - a.count || b.top.outN - a.top.outN)
    .slice(0, 8)
    .map((e) => e.top)
    .sort((a, b) => b.id.length - a.id.length)
  const slots: Model[] = []
  top.forEach((m, i) => {
    const edge = Math.floor(i / 2)
    slots[i % 2 === 0 ? edge : top.length - 1 - edge] = m
  })
  return slots.filter(Boolean)
}

const chipStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 11px 5px 6px',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.18)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  color: 'rgba(255,255,255,0.94)',
  fontFamily: "'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  lineHeight: '16px',
  whiteSpace: 'nowrap',
  opacity: 0,
  transition: 'opacity .35s ease',
  boxShadow: '0 0 calc(var(--hit, 0) * 22px) rgba(255,110,40,calc(var(--hit, 0) * 0.55))',
  willChange: 'transform',
}

function ChipLogo({ provider }: { provider: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <span
      aria-hidden
      style={{
        width: 22,
        height: 22,
        borderRadius: 7,
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
        color: 'rgba(255,255,255,0.9)',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {failed ? (
        provider.charAt(0)
      ) : (
        <img src={providerLogoOnDark(provider)} alt="" width={16} height={16} style={{ display: 'block' }} onError={() => setFailed(true)} />
      )}
    </span>
  )
}

const rowStyle: CSSProperties = {
  ...chipStyle,
  position: 'relative',
  flex: 'none',
  opacity: 1,
  transition: 'none',
  boxShadow: 'none',
  willChange: 'auto',
}

function ChipLabel({ m }: { m: Model }) {
  return (
    <>
      <ChipLogo provider={m.provider} />
      <span>{m.id}</span>
    </>
  )
}

export default function ForgeHero3D({ onLive }: { onLive?: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const chipRefs = useRef<(HTMLDivElement | null)[]>([])
  const chipsLive = useRef<HTMLElement[]>([]) // array handed to the scene; emptied when chips move to the row
  const [ready, setReady] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const picks = useMemo(pickChipModels, [])

  // narrow (phones / portrait): chips leave the canvas and become a scrolling row below it
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => setNarrow(root.clientWidth < 560 || root.clientWidth / Math.max(1, root.clientHeight) < 0.9)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    chipsLive.current.length = 0
    if (!narrow) chipsLive.current.push(...chipRefs.current.filter((c): c is HTMLDivElement => !!c))
  }, [narrow])

  // layout effect: start before first paint instead of waiting for the passive-effect flush
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let dispose: (() => void) | undefined
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // dev/preview only: ?forgeT=1.3 freezes the timeline for screenshots
    const staticTime = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('forgeT')) || undefined : undefined
    import('@/three/scene')
      .then(({ createForgeScene }) => {
        if (disposed) return
        try {
          const s = createForgeScene(host, { chips: chipsLive.current, reducedMotion, staticTime, onReady: () => !disposed && (setReady(true), onLive?.()) })
          dispose = s.dispose
        } catch (err) {
          // no WebGL: leave the stage card as is
          console.warn('forge hero 3d disabled', err)
        }
      })
      .catch((err) => console.warn('forge hero 3d chunk failed', err))
    return () => {
      disposed = true
      dispose?.()
    }
  }, [])

  return (
    <div ref={rootRef} aria-hidden className="relative flex h-full w-full flex-col overflow-hidden" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div ref={hostRef} style={{ position: 'relative', flex: narrow ? '0 0 70%' : '1 1 100%', minHeight: 0, overflow: 'hidden' }}>
        {!narrow && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {picks.map((m, i) => (
              <div
                key={m.id}
                ref={(el) => {
                  chipRefs.current[i] = el
                }}
                style={{ ...chipStyle, opacity: ready ? 1 : 0 }}
              >
                <ChipLabel m={m} />
              </div>
            ))}
          </div>
        )}
      </div>
      {narrow && (
        <div
          style={{ flex: '1 1 0', minHeight: 0, display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', padding: '0 16px', scrollbarWidth: 'none', opacity: ready ? 1 : 0, transition: 'opacity .35s ease' }}
        >
          {picks.map((m) => (
            <div key={m.id} style={rowStyle}>
              <ChipLabel m={m} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
