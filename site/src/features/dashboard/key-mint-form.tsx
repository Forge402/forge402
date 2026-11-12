import { useState } from 'react'
import { Check, Copy, TriangleAlert } from 'lucide-react'
import type { Address } from 'viem'
import { errorText, type MintResult } from '@/lib/api'
import { payFor, STEP_TEXT, type PayStep } from '@/features/dashboard/pay-for'
import { savePrepaidKey } from '@/features/session/session-store'

const PRESETS = [1, 5, 20, 50]

function Copyable({ value }: { value: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button onClick={async () => { try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1500) } catch { /* blocked */ } }} className="btn btn-dark !px-4 !py-2.5">
      {ok ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{ok ? 'Copied' : 'Copy key'}
    </button>
  )
}

export function KeyMintForm({ owner, onDone }: { owner: Address; onDone: () => void }) {
  const [amount, setAmount] = useState(5)
  const [label, setLabel] = useState('')
  const [step, setStep] = useState<PayStep | null>(null)
  const [err, setErr] = useState('')
  const [minted, setMinted] = useState<MintResult | null>(null)
  const [saved, setSaved] = useState(false)

  const mint = async () => {
    setErr('')
    try {
      const r = await payFor<MintResult>({ expect: owner, path: '/v1/keys', body: { amount_usd: amount, ...(label.trim() ? { label: label.trim() } : {}) }, onStep: setStep })
      setMinted(r); onDone()
    } catch (e) { setErr(errorText(e)) } finally { setStep(null) }
  }

  if (minted) {
    return (
      <div className="rounded-2xl border border-ember/40 bg-[#FFF4EE] p-5" role="status">
        <p className="m-0 flex items-start gap-2 text-[14.5px] font-medium text-ember-ink"><TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden />Copy this key now. It is shown once and stored only as a hash. We cannot show it again.</p>
        <p className="mt-3 break-all rounded-xl bg-ink p-4 font-mono text-[14px] text-white select-all">{minted.key}</p>
        <p className="mt-2 font-mono text-[12.5px] text-body">Balance ${minted.balance_usd.toFixed(2)} · owner {minted.owner}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Copyable value={minted.key} />
          <button onClick={() => { savePrepaidKey(minted.key); setSaved(true) }} className="btn btn-light !px-4 !py-2.5">{saved ? 'Saved for this tab' : 'Use in playground (this tab only)'}</button>
          <button onClick={() => { setMinted(null); setSaved(false) }} className="btn btn-light !px-4 !py-2.5">I copied it, close</button>
        </div>
      </div>
    )
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void mint() }} className="grid gap-4">
      <fieldset className="m-0 border-0 p-0">
        <legend className="label">Amount in USDG</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p} type="button" aria-pressed={amount === p} onClick={() => setAmount(p)}
              className={`cursor-pointer rounded-full border px-5 py-2.5 font-mono text-[14px] ${amount === p ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink'}`}>${p}</button>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="key-label" className="label">Label (optional)</label>
        <input id="key-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="my-agent" className="field mt-1.5 max-w-[360px]" />
      </div>
      <div>
        <button type="submit" disabled={step !== null} className="btn btn-primary">{step ? 'Working…' : `Mint key · $${amount}`}</button>
        <p className="mt-2 text-[13px] text-body" aria-live="polite">{step ? STEP_TEXT[step] : 'Your wallet signs a USDG transfer authorization. No gas, and the site never sees your private key.'}</p>
        {err && <p role="alert" className="mt-2 text-[14px] text-ember-ink">{err}</p>}
      </div>
    </form>
  )
}
