import { useId, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { samples } from '@/lib/code-samples'

export function CodeTabs() {
  const [active, setActive] = useState(samples[0].id)
  const [copied, setCopied] = useState(false)
  const uid = useId()
  const current = samples.find((s) => s.id === active) ?? samples[0]

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked: leave the button as is */
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0A0807] shadow-[0_24px_60px_rgba(14,15,18,0.25)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] pl-4 pr-2">
        <span className="mr-2 hidden items-center gap-1.5 sm:flex" aria-hidden><i className="h-2.5 w-2.5 rounded-full bg-white/20" /><i className="h-2.5 w-2.5 rounded-full bg-white/20" /><i className="h-2.5 w-2.5 rounded-full bg-white/20" /></span>
        <div role="tablist" aria-label="Code examples" className="flex flex-1 overflow-x-auto">
          {samples.map((s) => (
            <button
              key={s.id}
              role="tab"
              id={`${uid}-${s.id}`}
              aria-selected={s.id === active}
              aria-controls={`${uid}-panel`}
              onClick={() => setActive(s.id)}
              className={`label cursor-pointer whitespace-nowrap border-b-2 px-3 py-3.5 ${s.id === active ? 'border-ember !text-white' : 'border-transparent hover:!text-white'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button onClick={copy} className="label flex cursor-pointer items-center gap-2 rounded-full px-3 py-2 hover:bg-white/10 hover:!text-white" aria-label="Copy code">
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre
        role="tabpanel"
        id={`${uid}-panel`}
        aria-labelledby={`${uid}-${active}`}
        tabIndex={0}
        className="m-0 overflow-x-auto p-5 font-mono text-[13px] leading-6 text-white/85 md:text-[14px]"
      >
        <code>{current.code}</code>
      </pre>
    </div>
  )
}
