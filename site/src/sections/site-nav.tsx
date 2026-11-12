import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { Menu, X } from 'lucide-react'
import { AnvilGlyph } from '@/components/anvil-glyph'

export const navLinks = [
  { to: '/models', label: 'Models' },
  { to: '/stats', label: 'Stats' },
  { to: '/playground', label: 'Playground' },
  { to: '/scan', label: 'Scan' },
  { to: '/radar', label: 'Radar' },
  { to: '/token', label: '$FORGE' },
  { to: '/docs', label: 'Docs' },
]

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${dark ? 'text-white' : 'text-ink'}`}>
      <AnvilGlyph className="h-6 w-6" />
      <span className="text-[19px] font-semibold leading-none tracking-[-0.04em]">
        forge<span className="text-ember">402</span>
      </span>
    </span>
  )
}

export const XIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `label rounded-full px-3 py-2 !text-body transition-colors hover:!text-ink ${isActive ? '!text-ink bg-ink/[0.06]' : ''}`

export function SiteNav() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => setOpen(false), [pathname])

  return (
    <header className="pointer-events-none sticky top-[14px] z-50 h-0 px-3">
      <a href="#main" className="label pointer-events-auto absolute left-3 top-[-80px] z-50 rounded-full bg-ink px-4 py-3 !text-white focus:top-0">
        Skip to content
      </a>
      <div className="glass-light pointer-events-auto mx-auto flex h-14 w-fit max-w-full items-center gap-2 rounded-full py-2 pl-5 pr-2">
        <Link to="/" aria-label="Forge402 home" className="mr-2 rounded-full"><Logo /></Link>
        <nav aria-label="Main" className="hidden items-center lg:flex">
          {navLinks.map((l) => (
            <NavLink key={l.to} to={l.to} className={linkCls}>{l.label}</NavLink>
          ))}
        </nav>
        <a href="https://x.com/forge402" target="_blank" rel="noreferrer" aria-label="Forge402 on X" className="ml-1 hidden h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-ink/[0.06] lg:flex">
          <XIcon />
        </a>
        <Link to="/dashboard" className="btn btn-primary !px-5 !py-2.5 !text-[12px]">Console →</Link>
        <button
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-ink/[0.06] lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
        </button>
      </div>
      {open && (
        <nav id="mobile-menu" aria-label="Mobile" className="glass-light pointer-events-auto mx-auto mt-2 max-w-[420px] rounded-3xl p-3 lg:hidden">
          <ul className="m-0 list-none p-0">
            {navLinks.map((l) => (
              <li key={l.to}>
                <NavLink to={l.to} className={(a) => `${linkCls(a)} block !rounded-2xl !px-4 !py-3.5 !text-[13px]`}>{l.label}</NavLink>
              </li>
            ))}
            <li>
              <a href="https://x.com/forge402" target="_blank" rel="noreferrer" className="label flex items-center gap-2 rounded-2xl px-4 py-3.5 text-[13px]"><XIcon /> on X</a>
            </li>
          </ul>
        </nav>
      )}
    </header>
  )
}
