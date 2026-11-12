import { lazy, Suspense, type ComponentType } from 'react'
import { useDocumentTitle, HOME_TITLE } from '@/lib/use-document-title'
import { HomeHero } from '@/sections/home-hero'
import { HomeMeter } from '@/sections/home-meter'
import { HomeScan } from '@/sections/home-scan'
import { HomeCatalog } from '@/sections/home-catalog'
import { HomeDropIn } from '@/sections/home-dropin'
import { HomeToken, CtaBand } from '@/sections/home-token-cta'

const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, k: K) =>
  lazy(() => load().then((m) => ({ default: m[k] })))
const HomeStrike = named(() => import('@/sections/home-strike'), 'HomeStrike')
const HomeRing = named(() => import('@/sections/home-ring'), 'HomeRing')
const HomeBench = named(() => import('@/sections/home-bench'), 'HomeBench')
const HomeArch = named(() => import('@/sections/home-arch'), 'HomeArch')
const HomeFaq = named(() => import('@/sections/home-faq'), 'HomeFaq')

const hold = <div className="min-h-[480px]" aria-hidden />

export default function HomePage() {
  useDocumentTitle(HOME_TITLE)
  return (
    <>
      <HomeHero />
      <HomeMeter />
      <Suspense fallback={hold}>
        <HomeStrike />
      </Suspense>
      <HomeToken />
      <Suspense fallback={hold}>
        <HomeRing />
        <HomeBench />
      </Suspense>
      <HomeCatalog />
      <Suspense fallback={hold}>
        <HomeArch />
      </Suspense>
      <HomeDropIn />
      <HomeScan />
      <Suspense fallback={hold}>
        <HomeFaq />
      </Suspense>
      <CtaBand />
    </>
  )
}
