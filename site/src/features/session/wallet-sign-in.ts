import { authNonce, authVerify } from '@/lib/api'
import { connect, signText } from '@/lib/wallet'
import { saveSession, type WalletSession } from '@/features/session/session-store'

/** connect -> nonce -> personal_sign -> token. Stores the session for this tab. */
export async function signInWithWallet(): Promise<WalletSession> {
  const address = await connect()
  const { message, nonce } = await authNonce(address)
  const signature = await signText(address, message)
  const { token } = await authVerify(address, signature, nonce)
  const s = { address, token }
  saveSession(s)
  return s
}
