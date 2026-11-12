import { PageStub } from '@/components/page-stub'
import { ModelTable } from '@/components/model-table'
import { useLiveModels } from '@/features/models/use-live-models'

export default function ModelsPage() {
  const { list, status } = useLiveModels()
  const note = status === 'live' ? 'Live from the router, merged with the Cloudflare Workers AI catalog. Prices are what you pay.'
    : status === 'loading' ? 'Loading the live list…'
    : 'Cloudflare Workers AI catalog, checked 2026-11-12. The router did not answer, so these are the planned prices.'
  return (
    <PageStub fig="Model catalog" name="Models" title={<>Every model. <em className="fraunces-italic-gradient">One price list.</em></>} note={note}>
      <ModelTable rows={list} showTags />
      <p className="label mt-4">{status === 'live' ? 'Live prices' : 'Planned prices'} · USDG per 1M tokens</p>
    </PageStub>
  )
}
