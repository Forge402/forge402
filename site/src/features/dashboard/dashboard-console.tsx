import { useCallback, useEffect, useState } from 'react'
import { ApiError, errorText, getWallet, type WalletInfo } from '@/lib/api'
import { CHAIN_ID, currentChainId, ensureChain, getProvider, shortAddr, EXPLORER } from '@/lib/wallet'
import { loadSession, saveSession, type WalletSession } from '@/features/session/session-store'
import { signInWithWallet } from '@/features/session/wallet-sign-in'
import { KeyMintForm } from '@/features/dashboard/key-mint-form'
import { KeyRowItem } from '@/features/dashboard/key-row'
import type { Address } from 'viem'

const Stat = ({ k, v, sub }: { k: string; v: string; sub?: string }) => (
  <div className="panel px-5 py-5"><p className="label">{k}</p><p className="display mt-2 text-[32px] leading-none">{v}</p>{sub && <p className="mt-2 text-[12.5px] text-muted">{sub}</p>}</div>
)

export function DashboardConsole() {
  const [session, setSession] = useState<WalletSession | null>(loadSession)
  const [info, setInfo] = useState<WalletInfo | null>(null)
  const [chain, setChain] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [loadErr, setLoadErr] = useState('')
  const hasWallet = !!getProvider()

  const refresh = useCallback(async () => {
    if (!session) return
    setLoadErr('')
    try { setInfo(await getWallet(session.token)) } catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_key') { saveSession(null); setSession(null); setInfo(null); setErr('Your sign-in expired. Sign in again.') }
      else setLoadErr(errorText(e))
    }
  }, [session])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    void currentChainId().then(setChain)
    const p = getProvider()
    const on = (c: unknown) => setChain(Number(c))
    const accounts = () => { saveSession(null); setSession(null); setInfo(null) }
    p?.on?.('chainChanged', on as never)
    p?.on?.('accountsChanged', accounts as never)
    return () => { p?.removeListener?.('chainChanged', on as never); p?.removeListener?.('accountsChanged', accounts as never) }
  }, [])

  const signIn = async () => {
    setBusy(true); setErr('')
    try { setSession(await signInWithWallet()); setChain(await currentChainId()) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  const switchChain = async () => { setErr(''); try { await ensureChain(); setChain(await currentChainId()) } catch (e) { setErr(errorText(e)) } }
  const signOut = () => { saveSession(null); setSession(null); setInfo(null) }

  if (!session) {
    return (
      <div className="panel max-w-[640px] p-6">
        <h2 className="m-0 text-[22px] font-semibold tracking-tight text-ink">Sign in with your wallet</h2>
        <p className="mt-2 text-[15px]">Connect a browser wallet and sign one message. No transaction, no gas. The site never touches a private key.</p>
        {!hasWallet && <p role="alert" className="mt-3 text-[14px] text-ember-ink">No browser wallet found. Install MetaMask or Rabby, then reload.</p>}
        <button onClick={signIn} disabled={busy || !hasWallet} className="btn btn-primary mt-5">{busy ? 'Check your wallet…' : 'Connect and sign in'}</button>
        {err && <p role="alert" className="mt-3 text-[14px] text-ember-ink">{err}</p>}
      </div>
    )
  }

  const owner = session.address as Address
  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 font-mono text-[14px] text-ink">{shortAddr(session.address)} <a className="ml-2 text-[12px] text-muted underline" href={`${EXPLORER}/address/${session.address}`} target="_blank" rel="noreferrer">explorer</a></p>
        <div className="flex items-center gap-3">
          {chain === CHAIN_ID
            ? <span className="tag !bg-[#DFF7E8] !text-emerald-800">Robinhood Chain</span>
            : <button onClick={switchChain} className="btn btn-light !px-4 !py-2 !text-[12px]">Switch to Robinhood Chain</button>}
          <button onClick={signOut} className="cursor-pointer text-[13px] underline">Sign out</button>
        </div>
      </div>
      {err && <p role="alert" className="m-0 text-[14px] text-ember-ink">{err}</p>}
      {loadErr && <p role="alert" className="m-0 rounded-xl border border-line bg-white p-4 text-[14px] text-ember-ink">Could not load your account: {loadErr}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat k="Refunds owed" v={info ? `$${info.refunds_owed_usd.toFixed(4)}` : '—'} sub="Paid out in USDG once it reaches $0.05" />
        <Stat k="Holder discount" v={info ? `${info.discount_pct}%` : '—'} sub={info && info.discount_pct === 0 ? 'None active' : undefined} />
        <Stat k="Free messages left" v={info ? String(info.free_messages_left) : '—'} sub="Playground, today" />
      </div>

      <section aria-labelledby="mint-h">
        <h2 id="mint-h" className="m-0 text-[24px] font-semibold tracking-tight text-ink">Mint a key</h2>
        <p className="mb-5 mt-1 max-w-[60ch] text-[15px]">A prepaid <span className="font-mono">forge_sk_</span> key works with any OpenAI SDK. Pick an amount, sign, done.</p>
        <div className="panel p-5 md:p-6"><KeyMintForm owner={owner} onDone={refresh} /></div>
      </section>

      <section aria-labelledby="keys-h">
        <h2 id="keys-h" className="m-0 text-[24px] font-semibold tracking-tight text-ink">Your keys</h2>
        {!info ? <p className="mt-3 text-[15px]">{loadErr ? '' : 'Loading…'}</p>
          : info.keys.length === 0 ? <p className="panel mt-3 p-5 text-[15px]">No keys yet. Mint your first one above.</p>
          : <ul className="m-0 mt-4 grid list-none gap-3 p-0">{info.keys.map((k) => <KeyRowItem key={k.id} k={k} token={session.token} owner={owner} onChange={refresh} />)}</ul>}
      </section>
    </div>
  )
}
