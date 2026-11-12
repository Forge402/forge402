import { PageStub } from '@/components/page-stub'
import { sections } from '@/features/docs/docs-content'

export default function DocsPage() {
  return (
    <PageStub fig="Docs" name="Docs" title={<>Build on <em className="fraunces-italic-gradient">Forge.</em></>} note="One OpenAI-compatible endpoint, paid with a prepaid key or per call with x402. Scan, Watch and MCP included.">
      <div className="grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Docs sections" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0 lg:flex-col lg:gap-1">
            {sections.map((s) => <li key={s.id}><a href={`#${s.id}`} className="label block rounded-full px-3 py-1.5 no-underline hover:!text-ink">{s.title}</a></li>)}
          </ul>
        </nav>
        <div className="grid min-w-0 gap-12 text-[16px]">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24" aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`} className="m-0 mb-3 text-[28px] font-semibold tracking-tight text-ink">{s.title}</h2>
              <div className="max-w-[78ch] [&_p]:my-3">{s.body}</div>
            </section>
          ))}
        </div>
      </div>
    </PageStub>
  )
}
