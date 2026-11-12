import { Link } from 'react-router'
import { Logo, XIcon } from './site-nav'
import { EmberField } from '@/components/ember-field'

const cols = [
  { title: 'Platform', links: [['/models', 'Models'], ['/playground', 'Playground'], ['/scan', 'Scan'], ['/radar', 'Radar'], ['/watch', 'Watch'], ['/stats', 'Stats']] },
  { title: 'Network', links: [['/token', '$FORGE'], ['/docs', 'Docs'], ['/dashboard', 'Console']] },
]

export function SiteFooter() {
  return (
    <footer className="stage stage-wrap mb-3 mt-6">
      <EmberField />
      <div className="wrap pb-8 pt-16 md:pt-24">
        <p className="display text-[clamp(40px,7vw,84px)] leading-[0.98]">
          One request in.<br /><em className="fraunces-italic-gradient">Every model out.</em>
        </p>
        <div className="mt-14 grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <Link to="/" aria-label="Forge402 home" className="inline-block rounded-full"><Logo dark /></Link>
            <p className="mt-4 max-w-[32ch] text-[15.5px] text-white/65">One endpoint for open models, billed per token in USDG.</p>
            <a href="https://x.com/forge402" target="_blank" rel="noreferrer" className="btn btn-ghost mt-5 !px-4 !py-2.5"><XIcon /> @forge402</a>
          </div>
          {cols.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <h2 className="label">{c.title}</h2>
              <ul className="m-0 mt-4 list-none space-y-3 p-0">
                {c.links.map(([to, label]) => (
                  <li key={label}><Link to={to} className="text-[15.5px] text-white/80 hover:text-white hover:underline">{label}</Link></li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-14 flex flex-col justify-between gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
          <span className="label">© 2026 Forge402</span>
          <span className="chip"><span className="chip-dot" />USDG on Robinhood Chain</span>
        </div>
      </div>
    </footer>
  )
}
