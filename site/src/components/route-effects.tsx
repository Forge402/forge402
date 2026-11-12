import { useEffect } from 'react'
import { useLocation } from 'react-router'

// On every route change: jump to the #anchor if the URL has one, else to the top of the page.
export function RouteEffects() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)))
      if (el) {
        el.scrollIntoView()
        return
      }
    }
    window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}
