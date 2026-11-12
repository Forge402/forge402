import type { Address } from 'viem'
import { requestQuote, sendPaid, type Accept } from '@/lib/api'
import { connect, ensureChain, signPayment, currentChainId, CHAIN_ID, WalletError, microToUsd } from '@/lib/wallet'

export type PayStep = 'quote' | 'chain' | 'sign' | 'send'
export const STEP_TEXT: Record<PayStep, string> = {
  quote: 'Asking the router for the price…',
  chain: 'Switching your wallet to Robinhood Chain…',
  sign: 'Sign the USDG transfer in your wallet…',
  send: 'Paying and creating…',
}

/** x402 round trip: POST without payment -> 402 quote -> EIP-3009 signature -> POST with PAYMENT-SIGNATURE. */
export async function payFor<T>(o: {
  expect: Address; path: string; body: unknown; bearer?: string; onStep: (s: PayStep) => void; confirm?: (a: Accept) => void
}): Promise<T> {
  o.onStep('quote')
  const offer = await requestQuote(o.path, o.body, o.bearer)
  const accept = offer.accepts[0]
  const want = Number((o.body as { amount_usd?: number }).amount_usd)
  // Refuse a price that differs from what the user picked (a server bug or a hostile response must not drain more).
  if (Number.isFinite(want) && Math.abs(microToUsd(accept.amount) - want) > 1e-6) {
    throw new WalletError(`The router asked for $${microToUsd(accept.amount)} but you picked $${want}. Nothing was signed.`)
  }
  o.onStep('chain')
  if ((await currentChainId()) !== CHAIN_ID) await ensureChain()
  const acct = await connect()
  if (acct.toLowerCase() !== o.expect.toLowerCase()) throw new WalletError('Your wallet switched accounts. Select the account you signed in with and try again.')
  o.onStep('sign')
  const sig = await signPayment(acct, offer, accept)
  o.onStep('send')
  return sendPaid<T>(o.path, o.body, sig, o.bearer)
}
