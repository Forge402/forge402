// sessionStorage only: wiped when the tab closes. Nothing here is ever written to localStorage.
const SESSION = 'forge402.session'
const KEY = 'forge402.key'

export type WalletSession = { address: string; token: string }

const read = (k: string) => { try { return sessionStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v) } catch { /* storage blocked */ } }

export function loadSession(): WalletSession | null {
  try {
    const s = JSON.parse(read(SESSION) ?? 'null') as WalletSession | null
    return s && typeof s.token === 'string' && typeof s.address === 'string' ? s : null
  } catch { return null }
}
export const saveSession = (s: WalletSession | null) => write(SESSION, s ? JSON.stringify(s) : null)
export const loadPrepaidKey = () => read(KEY) ?? ''
export const savePrepaidKey = (k: string) => write(KEY, k || null)
