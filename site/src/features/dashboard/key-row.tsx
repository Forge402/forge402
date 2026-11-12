import { useState } from 'react'
import type { Address } from 'viem'
import { closeWalletKey, errorText, type KeyRow, type TopupResult } from '@/lib/api'
import { loadPrepaidKey } from '@/features/session/session-store'
import { payFor, STEP_TEXT, type PayStep } from '@/features/dashboard/pay-for'

const when = (c: string | number) => { const d = new Date(typeof c === 'number' && c < 1e12 ? c * 1000 : c); return Number.isNaN(d.getTime()) ? String(c) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }

export function KeyRowItem({ k, token, owner, onChange }: { k: KeyRow; token: string; owner: Address; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState(loadPrepaidKey)
  const [amount, setAmount] = useState(5)
  const [step, setStep] = useState<PayStep | null>(null)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const topup = async () => {
    setErr(''); setNote('')
    try {
      const r = await payFor<TopupResult>({ expect: owner, path: '/v1/keys/topup', body: { amount_usd: amount }, bearer: secret, onStep: setStep })
      setNote(`New balance $${r.balance_usd.toFixed(2)}`); onChange()
    } catch (e) { setErr(errorText(e)) } finally { setStep(null) }
  }
  const close = async () => {
    if (!window.confirm(`Close ${k.label || k.id}? The key stops working and $${k.balance_usd.toFixed(2)} is booked as a refund to your wallet.`)) return
    try { await closeWalletKey(token, k.id); onChange() } catch (e) { setErr(errorText(e)) }
  }

  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 truncate font-medium text-ink">{k.label || 'Untitled key'} {k.revoked && <span className="tag ml-1 !bg-[#FFE9DF] !text-ember-ink">closed</span>}</p>
          <p className="label mt-1 !text-[10.5px]">{k.id} · created {when(k.created)}</p>
        </div>
        <dl className="m-0 flex gap-6 font-mono text-[13px]">
          <div><dt className="label !text-[10px]">Balance</dt><dd className="m-0 text-ink">${k.balance_usd.toFixed(4)}</dd></div>
          <div><dt className="label !text-[10px]">Spent</dt><dd className="m-0 text-ink">${k.spent_usd.toFixed(4)}</dd></div>
        </dl>
        {!k.revoked && (
          <div className="flex gap-2">
            <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="btn btn-light !px-4 !py-2 !text-[12px]">Top up</button>
            <button onClick={close} className="btn btn-light !px-4 !py-2 !text-[12px]">Close</button>
          </div>
        )}
      </div>
      {open && (
        <form onSubmit={(e) => { e.preventDefault(); void topup() }} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_120px_auto] sm:items-end">
          <div>
            <label htmlFor={`k-${k.id}`} className="label">Paste this key (needed to credit it)</label>
            <input id={`k-${k.id}`} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value.trim())} placeholder="forge_sk_…" className="field mt-1.5" />
          </div>
          <div>
            <label htmlFor={`a-${k.id}`} className="label">USDG</label>
            <input id={`a-${k.id}`} type="number" min={1} max={1000} value={amount} onChange={(e) => setAmount(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))} className="field mt-1.5" />
          </div>
          <button type="submit" disabled={step !== null || !secret.startsWith('forge_sk_')} className="btn btn-primary">{step ? 'Working…' : 'Pay'}</button>
          <p className="m-0 text-[13px] text-body sm:col-span-3" aria-live="polite">{step ? STEP_TEXT[step] : note}</p>
        </form>
      )}
      {err && <p role="alert" className="mt-3 text-[14px] text-ember-ink">{err}</p>}
    </li>
  )
}
