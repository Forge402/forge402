// Injected wallet (EIP-1193) helpers on viem. The site never sees a private key: the wallet signs.
import { createWalletClient, custom, defineChain, getAddress, toHex, type Address, type EIP1193Provider, type Hex } from 'viem'
import type { Accept, PaymentRequired } from '@/lib/api'

export const CHAIN_ID = 4663
export const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'
export const EXPLORER = 'https://robinhoodchain.blockscout.com'

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER } },
})

type Injected = EIP1193Provider & { request: (a: { method: string; params?: unknown }) => Promise<unknown> }
export const getProvider = (): Injected | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { ethereum?: Injected }).ethereum)

export class WalletError extends Error {}

function wrap(e: unknown): WalletError {
  const err = e as { code?: number; message?: string }
  if (err?.code === 4001) return new WalletError('You rejected the request in your wallet.')
  if (err?.code === -32002) return new WalletError('Your wallet already has a pending request. Open it and finish or cancel.')
  return new WalletError(err?.message?.split('\n')[0] || 'Wallet error.')
}

function client() {
  const p = getProvider()
  if (!p) throw new WalletError('No browser wallet found. Install MetaMask, Rabby or another EIP-1193 wallet.')
  return createWalletClient({ chain: robinhoodChain, transport: custom(p) })
}

export async function connect(): Promise<Address> {
  try {
    const [a] = await client().requestAddresses()
    if (!a) throw new WalletError('Wallet returned no account.')
    return getAddress(a)
  } catch (e) { throw e instanceof WalletError ? e : wrap(e) }
}

export async function currentChainId(): Promise<number | undefined> {
  const p = getProvider()
  if (!p) return undefined
  try { return Number(await p.request({ method: 'eth_chainId' })) } catch { return undefined }
}

export async function ensureChain(): Promise<void> {
  const c = client()
  try {
    await c.switchChain({ id: CHAIN_ID })
  } catch (e) {
    const code = (e as { code?: number })?.code
    // 4902 = chain unknown to the wallet: add it, which also switches.
    if (code === 4902 || /unrecognized chain|not added/i.test((e as Error)?.message ?? '')) {
      try { await c.addChain({ chain: robinhoodChain }) } catch (e2) { throw wrap(e2) }
    } else throw wrap(e)
  }
}

export async function signText(address: Address, message: string): Promise<Hex> {
  try { return await client().signMessage({ account: address, message }) } catch (e) { throw wrap(e) }
}

const randomNonce = (): Hex => toHex(crypto.getRandomValues(new Uint8Array(32)))

const TRANSFER_AUTH = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ],
} as const

const b64 = (v: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))))

/** Sign the EIP-3009 authorization for one 402 offer and return the base64 PAYMENT-SIGNATURE value. */
export async function signPayment(address: Address, offer: PaymentRequired, accept: Accept = offer.accepts[0]): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const authorization = {
    from: address,
    to: getAddress(accept.payTo),
    value: BigInt(accept.amount),
    validAfter: BigInt(now - 60),
    validBefore: BigInt(now + accept.maxTimeoutSeconds),
    nonce: randomNonce(),
  }
  let signature: Hex
  try {
    signature = await client().signTypedData({
      account: address,
      domain: { name: accept.extra.name, version: accept.extra.version, chainId: CHAIN_ID, verifyingContract: getAddress(accept.asset) },
      types: TRANSFER_AUTH,
      primaryType: 'TransferWithAuthorization',
      message: authorization,
    })
  } catch (e) { throw wrap(e) }
  return b64({
    x402Version: 2,
    resource: offer.resource,
    accepted: accept,
    payload: {
      signature,
      authorization: {
        from: authorization.from, to: authorization.to, value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(), validBefore: authorization.validBefore.toString(), nonce: authorization.nonce,
      },
    },
  })
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
export const microToUsd = (amount: string) => Number(amount) / 1e6
