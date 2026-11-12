import { useEffect, useRef, useState } from 'react'
import { animate, useInView, useReducedMotion } from 'motion/react'

// Counts up once when scrolled into view. Only feed it real numbers.
export function Ticker({ value, decimals = 0, prefix = '' }: { value: number; decimals?: number; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const reduce = useReducedMotion()
  const [v, setV] = useState(reduce ? value : 0)
  useEffect(() => {
    if (!inView || reduce) { setV(value); return }
    const c = animate(0, value, { duration: 1.1, ease: 'easeOut', onUpdate: setV })
    // Throttled/background tabs can stall animation frames; never leave a wrong number on screen.
    const t = setTimeout(() => setV(value), 1500)
    return () => { c.stop(); clearTimeout(t) }
  }, [inView, value, reduce])
  return <span ref={ref} className="tnum">{prefix}{v.toFixed(decimals)}</span>
}
