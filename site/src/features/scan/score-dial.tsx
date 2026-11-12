const TONE = { clean: '#16A34A', caution: '#E07A00', risky: '#D93F00' } as const

export function ScoreDial({ score, verdict }: { score: number; verdict: keyof typeof TONE }) {
  const r = 54, c = 2 * Math.PI * r
  const s = Math.max(0, Math.min(100, score))
  return (
    <figure className="m-0 flex flex-col items-center" aria-label={`Score ${s} out of 100, verdict ${verdict}`}>
      <svg viewBox="0 0 140 140" className="h-40 w-40" role="img" aria-hidden>
        <circle cx="70" cy="70" r={r} fill="none" stroke="#E2E5E9" strokeWidth="12" />
        <circle cx="70" cy="70" r={r} fill="none" stroke={TONE[verdict] ?? TONE.caution} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${(s / 100) * c} ${c}`} transform="rotate(-90 70 70)" />
        <text x="70" y="76" textAnchor="middle" className="fill-ink" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.04em' }}>{s}</text>
        <text x="70" y="96" textAnchor="middle" className="fill-muted" style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>/ 100</text>
      </svg>
      <figcaption className="mt-1 rounded-full px-4 py-1 font-mono text-[12px] uppercase tracking-wider text-white" style={{ background: TONE[verdict] ?? TONE.caution }}>{verdict}</figcaption>
    </figure>
  )
}
