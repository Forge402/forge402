// Rising-ember particles for dark stage cards. Pure CSS, hidden under reduced motion.
const sparks = Array.from({ length: 16 }, (_, i) => ({
  left: `${(i * 37 + 11) % 100}%`,
  delay: `${-((i * 1.7) % 9)}s`,
  dur: `${7 + ((i * 5) % 6)}s`,
  s: 2 + (i % 3),
}))

export function EmberField() {
  return (
    <div className="embers" aria-hidden>
      {sparks.map((p, i) => (
        <i key={i} style={{ left: p.left, animationDelay: p.delay, animationDuration: p.dur, width: p.s, height: p.s }} />
      ))}
    </div>
  )
}
