import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

export const isEvmAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v)

export function ScanForm({ id = 'ca', dark = false }: { id?: string; dark?: boolean }) {
  const [ca, setCa] = useState('')
  const [err, setErr] = useState('')
  const nav = useNavigate()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = ca.trim()
    if (!isEvmAddress(v)) { setErr('That is not a token address. It should start with 0x and be 42 characters long.'); return }
    setErr('')
    nav(`/scan/${v}`)
  }
  return (
    <div>
      <form onSubmit={submit} className={`flex flex-col gap-2 rounded-[28px] p-2 sm:flex-row sm:rounded-full ${dark ? 'glass' : 'panel'}`}>
        <label htmlFor={id} className="sr-only">Token contract address</label>
        <input
          id={id}
          value={ca}
          onChange={(e) => { setCa(e.target.value); setErr('') }}
          placeholder="0x… token contract address"
          autoComplete="off" spellCheck={false}
          aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined}
          className={`min-w-0 flex-1 rounded-full bg-transparent px-5 py-3.5 font-mono text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ember ${dark ? 'text-white placeholder:text-white/50' : 'text-ink placeholder:text-muted'}`}
        />
        <button type="submit" className="btn btn-primary">Scan</button>
      </form>
      {err && <p id={`${id}-err`} role="alert" className={`mt-2 px-3 text-[13.5px] ${dark ? '!text-hot' : 'text-ember-ink'}`}>{err}</p>}
    </div>
  )
}
