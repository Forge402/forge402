import type { ReactNode } from 'react'
import { useDocumentTitle, pageTitle } from '@/lib/use-document-title'
import { EmberField } from '@/components/ember-field'

type Props = { fig: string; name: string; title: ReactNode; note: string; children?: ReactNode }

// Shared page shell: compact dark stage header card, light content below.
export function PageStub({ fig, name, title, note, children }: Props) {
  useDocumentTitle(pageTitle(name))
  return (
    <>
      <section className="stage stage-wrap" aria-label={name}>
        <EmberField />
        <div className="wrap pb-14 pt-28 md:pb-20 md:pt-32">
          <p className="chip"><span className="chip-dot" />{fig}</p>
          <h1 className="display display-page mt-6 max-w-[16ch]">{title}</h1>
          <p className="mt-6 max-w-[56ch] text-[17px] text-white/70 md:text-[19px]">{note}</p>
        </div>
      </section>
      {children && <div className="wrap py-12 md:py-16">{children}</div>}
    </>
  )
}
