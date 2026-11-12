import { MotionConfig } from 'motion/react'
import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { SiteNav } from '@/sections/site-nav'
import { SiteFooter } from '@/sections/site-footer'
import { RouteEffects } from '@/components/route-effects'
import HomePage from '@/pages/home-page'
import ModelsPage from '@/pages/models-page'
const PlaygroundPage = lazy(() => import('@/pages/playground-page'))
import ScanPage from '@/pages/scan-page'
import ScanResultPage from '@/pages/scan-result-page'
import RadarPage from '@/pages/radar-page'
import WatchPage from '@/pages/watch-page'
import StatsPage from '@/pages/stats-page'
import TokenPage from '@/pages/token-page'
import DocsPage from '@/pages/docs-page'
const DashboardPage = lazy(() => import('@/pages/dashboard-page'))
import NotFoundPage from '@/pages/not-found-page'

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <RouteEffects />
      <SiteNav />
      <main id="main" tabIndex={-1} className="outline-none">
        <Suspense fallback={<p className="wrap py-32" role="status">Loading…</p>}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/scan/:ca" element={<ScanResultPage />} />
          <Route path="/radar" element={<RadarPage />} />
          <Route path="/watch" element={<WatchPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/token" element={<TokenPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
      </main>
      <SiteFooter />
    </MotionConfig>
  )
}
