export const fmtUsd = (n: number) => (n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`)
export const fmtInt = (n: number) => n.toLocaleString('en-US')
export const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)
