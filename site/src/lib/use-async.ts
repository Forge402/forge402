import { useEffect, useState } from 'react'
import { errorText } from '@/lib/api'

export type Async<T> = { s: 'loading' } | { s: 'ok'; data: T } | { s: 'err'; msg: string }

/** Runs `fn` on mount and whenever `dep` changes. Errors are kept as text, never swallowed. */
export function useAsync<T>(fn: () => Promise<T>, dep: unknown): Async<T> {
  const [st, setSt] = useState<Async<T>>({ s: 'loading' })
  useEffect(() => {
    let dead = false
    setSt({ s: 'loading' })
    fn().then((data) => { if (!dead) setSt({ s: 'ok', data }) }).catch((e) => { if (!dead) setSt({ s: 'err', msg: errorText(e) }) })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep])
  return st
}
