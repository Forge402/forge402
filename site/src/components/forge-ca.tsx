import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { EXPLORER_ADDRESS, FORGE_CA, isLaunched } from '@/data/token'

// The single $FORGE contract address block, built for the dark token stage.
// Before launch it says so instead of showing a fake address; the address comes only from src/data/token.ts.
export function ForgeCa() {
  const live = isLaunched()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(FORGE_CA)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked: the address is still selectable on screen */
    }
  }

  return (
    <div className="w-full max-w-[760px] rounded-[20px] border border-white/14 bg-white/[0.05] p-5 text-left backdrop-blur md:p-7">
      <p className="label">CONTRACT ADDRESS · ROBINHOOD CHAIN</p>
      <div className="mt-4 rounded-[14px] border border-white/10 bg-black/40 px-4 py-4 md:px-5">
        {live ? (
          <p className="select-all break-all font-mono text-[15px] text-white md:text-[18px]">{FORGE_CA}</p>
        ) : (
          <p className="font-mono text-[15px] text-white/60 md:text-[18px]">0x · posted here at launch</p>
        )}
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[14px] text-white/60">
          {live ? 'One CA. If you see another address, it is not ours.' : 'One CA, one launch. Only this page and @forge402 will post it.'}
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={copy} disabled={!live} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-40">
            {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            {copied ? 'Copied' : 'Copy CA'}
          </button>
          {live && (
            <a href={`${EXPLORER_ADDRESS}${FORGE_CA}`} target="_blank" rel="noreferrer" className="btn btn-ghost">
              Explorer <ExternalLink size={14} aria-hidden />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
