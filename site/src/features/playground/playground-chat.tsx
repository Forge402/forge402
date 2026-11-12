import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { KeyRound, Send, Square, Wallet, UserRound } from 'lucide-react'
import { Link } from 'react-router'
import { ApiError, errorText, streamChat, type ChatMeta, type ChatMsg } from '@/lib/api'
import { useLiveModels, withGuestFlags } from '@/features/models/use-live-models'
import { loadPrepaidKey, loadSession, savePrepaidKey, saveSession, type WalletSession } from '@/features/session/session-store'
import { signInWithWallet } from '@/features/session/wallet-sign-in'
import { fmtInt, fmtMs, fmtUsd } from '@/features/playground/format'
import { shortAddr } from '@/lib/wallet'

type Mode = 'guest' | 'key' | 'holder'
type Reply = { role: 'assistant'; content: string; model: string; meta?: ChatMeta; ms?: number; error?: { code: string; text: string }; est?: number }
type Turn = { role: 'user'; content: string } | Reply

const PROMPTS = [
  'Explain x402 payments in three sentences.',
  'Write a Solidity function that checks an ERC-20 allowance safely.',
  'Summarize the risks of buying a token with an upgradeable proxy.',
  'Give me a regex for EVM addresses and explain it.',
]
const MODES: { id: Mode; label: string; icon: typeof KeyRound; hint: string }[] = [
  { id: 'guest', label: 'Guest', icon: UserRound, hint: '5 free messages a day, free models only.' },
  { id: 'key', label: 'Prepaid key', icon: KeyRound, hint: 'Paste a forge_sk_ key. Exact cost is taken from its balance. Kept in this tab only.' },
  { id: 'holder', label: 'Holder', icon: Wallet, hint: 'Sign in with a wallet that holds $FORGE: 25 messages a day, any chat model.' },
]

const ERR_HELP: Record<string, string> = {
  rate_limited: 'Daily limit reached for this mode. Switch to a prepaid key or come back tomorrow.',
  insufficient_balance: 'The key balance is too low for this call. Top it up in the console.',
  not_configured: 'The router is not fully set up yet (payments or models are not configured). Nothing was charged.',
  invalid_key: 'That key or session was not accepted. Check the key, or sign in again.',
  payment_required: 'This mode cannot run this model. Use a prepaid key.',
  network_error: 'Cannot reach the router. It is probably not deployed yet.',
}

export function PlaygroundChat() {
  const { list, status } = useLiveModels()
  const models = useMemo(() => withGuestFlags(list.filter((m) => m.type === 'chat')), [list])
  const [mode, setMode] = useState<Mode>('guest')
  const [modelId, setModelId] = useState('')
  const [key, setKey] = useState(loadPrepaidKey)
  const [session, setSession] = useState<WalletSession | null>(loadSession)
  const [signing, setSigning] = useState(false)
  const [authErr, setAuthErr] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const guest = mode === 'guest'
  const pickable = guest ? models.filter((m) => m.free) : models
  const model = models.find((m) => m.id === modelId && (!guest || m.free)) ?? pickable[0]
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [turns])
  useEffect(() => () => abort.current?.abort(), [])

  const ready = mode === 'guest' || (mode === 'key' && key.startsWith('forge_sk_')) || (mode === 'holder' && !!session)

  const signIn = async () => {
    setSigning(true); setAuthErr('')
    try { setSession(await signInWithWallet()) } catch (e) { setAuthErr(errorText(e)) } finally { setSigning(false) }
  }
  const signOut = () => { saveSession(null); setSession(null) }

  const send = async (text: string) => {
    if (!model || !text.trim() || busy || !ready) return
    const history: ChatMsg[] = turns.filter((t) => !('error' in t && t.error)).map((t) => ({ role: t.role, content: t.content }))
    const messages = [...history, { role: 'user' as const, content: text.trim() }]
    setTurns((t) => [...t, { role: 'user', content: text.trim() }, { role: 'assistant', content: '', model: model.id }])
    setInput(''); setBusy(true)
    const ac = new AbortController(); abort.current = ac
    const t0 = performance.now()
    const patch = (p: Partial<Reply>) => setTurns((t) => { const c = t.slice(); const last = c[c.length - 1]; if (last?.role === 'assistant') c[c.length - 1] = { ...last, ...p }; return c })
    let acc = ''
    try {
      const meta = await streamChat({
        path: mode === 'key' ? '/v1/chat/completions' : '/v1/playground/chat',
        token: mode === 'key' ? key : mode === 'holder' ? session?.token : undefined,
        model: model.id, messages, signal: ac.signal,
        onDelta: (d) => { acc += d; patch({ content: acc }) },
      })
      const est = meta.costUsd === undefined && meta.tokensIn !== undefined && meta.tokensOut !== undefined
        ? (meta.tokensIn / 1e6) * model.inN + (meta.tokensOut / 1e6) * model.outN : undefined
      patch({ meta, ms: performance.now() - t0, est })
    } catch (e) {
      if (ac.signal.aborted) patch({ ms: performance.now() - t0, ...(acc ? {} : { error: { code: 'stopped', text: 'Stopped before the model answered.' } }) })
      else {
        const code = e instanceof ApiError ? e.code : 'unknown'
        patch({ error: { code, text: ERR_HELP[code] ? `${ERR_HELP[code]} (${errorText(e)})` : errorText(e) } })
        if (code === 'invalid_key' && mode === 'holder') signOut()
      }
    } finally { setBusy(false); abort.current = null }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void send(input) }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="panel flex flex-col gap-5 p-5 lg:self-start">
        <div>
          <p className="label" id="pay-label">Pay with</p>
          <div role="radiogroup" aria-labelledby="pay-label" className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-page p-1">
            {MODES.map((m) => (
              <button key={m.id} role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}
                className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-full px-2 py-2 font-mono text-[11.5px] uppercase tracking-wider ${mode === m.id ? 'bg-ink text-white' : 'text-body hover:text-ink'}`}>
                <m.icon size={13} aria-hidden />{m.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[13.5px] leading-snug text-body">{MODES.find((m) => m.id === mode)?.hint}</p>
        </div>

        {mode === 'key' && (
          <div>
            <label htmlFor="pg-key" className="label">Key</label>
            <input id="pg-key" type="password" autoComplete="off" spellCheck={false} placeholder="forge_sk_…" value={key}
              onChange={(e) => { setKey(e.target.value.trim()); savePrepaidKey(e.target.value.trim()) }} className="field mt-1.5" />
            <p className="mt-1.5 text-[12.5px] text-muted">No key yet? <Link to="/dashboard" className="underline">Mint one</Link>.</p>
          </div>
        )}
        {mode === 'holder' && (
          <div>
            {session ? (
              <p className="m-0 text-[13.5px]">Signed in as <span className="font-mono text-ink">{shortAddr(session.address)}</span>{' '}
                <button onClick={signOut} className="cursor-pointer underline">sign out</button></p>
            ) : (
              <button onClick={signIn} disabled={signing} className="btn btn-dark w-full">{signing ? 'Check your wallet…' : 'Sign in with wallet'}</button>
            )}
            {authErr && <p role="alert" className="mt-2 text-[13px] text-ember-ink">{authErr}</p>}
          </div>
        )}

        <div>
          <label htmlFor="pg-model" className="label">Model</label>
          <select id="pg-model" value={model?.id ?? ''} onChange={(e) => setModelId(e.target.value)} className="field mt-1.5 !text-[13.5px]">
            {pickable.map((m) => <option key={m.id} value={m.id}>{m.id}{m.free ? ' · FREE' : ''}</option>)}
          </select>
          {model && (
            <p className="mt-2 font-mono text-[12.5px] text-body">
              {model.free && <span className="tag mr-2 !bg-[#DFF7E8] !text-emerald-800">free for guests</span>}
              in {model.inPerM} · out {model.outPerM} per 1M
            </p>
          )}
          <p className="label mt-3 !text-[10.5px]">{status === 'live' ? 'Live list from the router' : status === 'loading' ? 'Loading list…' : 'Router offline: showing the build-time catalog'}</p>
        </div>
      </aside>

      <section className="panel flex min-h-[520px] flex-col" aria-label="Chat">
        <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6" role="log" aria-live="polite" aria-relevant="additions text">
          {turns.length === 0 && (
            <div>
              <p className="label">Try one</p>
              <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
                {PROMPTS.map((p) => (
                  <li key={p}><button onClick={() => void send(p)} disabled={!ready || !model} className="cursor-pointer rounded-2xl border border-line bg-white px-4 py-2.5 text-left text-[14px] text-ink hover:border-ink disabled:cursor-not-allowed disabled:opacity-50">{p}</button></li>
                ))}
              </ul>
              {!ready && <p className="mt-4 text-[14px] text-body">{mode === 'key' ? 'Paste a forge_sk_ key to start.' : 'Sign in with your wallet to start.'}</p>}
            </div>
          )}
          {turns.map((t, i) => t.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-3 text-[15px] text-white"><p className="m-0 whitespace-pre-wrap break-words">{t.content}</p></div>
          ) : (
            <div key={i} className="max-w-[92%]">
              <div className="rounded-2xl rounded-bl-md bg-page px-4 py-3 text-[15px] text-ink">
                <p className="m-0 whitespace-pre-wrap break-words">{t.content}{busy && i === turns.length - 1 && !t.error && <span className="cursor" aria-hidden />}</p>
                {t.error && <p role="alert" className="m-0 mt-1 text-[14px] text-ember-ink"><span className="font-mono text-[12px] uppercase">{t.error.code}</span> {t.error.text}</p>}
              </div>
              {t.meta && <ReplyMeta r={t} />}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form onSubmit={submit} className="flex items-end gap-2 border-t border-line p-3">
          <label htmlFor="pg-input" className="sr-only">Message</label>
          <textarea id="pg-input" rows={2} value={input} onChange={(e) => setInput(e.target.value)} placeholder={ready ? 'Ask something…' : 'Pick a way to pay first'} disabled={!ready}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input) } }}
            className="field flex-1 resize-none !rounded-2xl !font-sans !text-[15px]" />
          {busy
            ? <button type="button" onClick={() => abort.current?.abort()} className="btn btn-light !px-4" aria-label="Stop"><Square size={16} aria-hidden /></button>
            : <button type="submit" disabled={!ready || !input.trim() || !model} className="btn btn-primary !px-4" aria-label="Send"><Send size={16} aria-hidden /></button>}
        </form>
      </section>
    </div>
  )
}

function ReplyMeta({ r }: { r: Reply }) {
  const m = r.meta!
  const cost = m.costUsd !== undefined ? `${fmtUsd(m.costUsd)} USDG` : r.est !== undefined ? `≈ ${fmtUsd(r.est)} USDG (list price)` : 'not reported'
  const cells: [string, string][] = [
    ['model', m.model ?? r.model],
    ['tokens in / out', `${m.tokensIn !== undefined ? fmtInt(m.tokensIn) : '—'} / ${m.tokensOut !== undefined ? fmtInt(m.tokensOut) : '—'}`],
    ['latency', r.ms !== undefined ? fmtMs(r.ms) : '—'],
    ['charge', cost],
    ['cache', m.cache ?? 'not reported'],
  ]
  return (
    <dl className="m-0 mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11.5px] text-muted">
      {cells.map(([k, v]) => <div key={k} className="flex gap-1.5"><dt className="uppercase tracking-wider">{k}</dt><dd className="m-0 text-ink">{v}</dd></div>)}
      {m.discountPct ? <div className="flex gap-1.5"><dt className="uppercase tracking-wider">holder discount</dt><dd className="m-0 text-ink">{m.discountPct}%</dd></div> : null}
    </dl>
  )
}
