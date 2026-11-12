import { useState } from 'react'
import { providerLogo, providerLogoOnDark } from '@/data/provider-logos'

// Real logo from /logos/ai/<slug>.svg, mono monogram tile when it is missing.
export function ProviderLogo({ provider, size = 36, dark = false }: { provider: string; size?: number; dark?: boolean }) {
  const [failed, setFailed] = useState(false)
  const box = { width: size, height: size }
  const tone = dark ? 'bg-white/10 border-white/15 text-white' : 'bg-[#F4F5F7] border-line text-ink'
  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] border ${tone}`} style={box} aria-hidden>
      {failed ? (
        <span className="font-mono text-[12px] font-medium uppercase">{provider.slice(0, 2)}</span>
      ) : (
        <img src={dark ? providerLogoOnDark(provider) : providerLogo(provider)} alt="" width={size * 0.62} height={size * 0.62} loading="lazy" onError={() => setFailed(true)} className="object-contain" />
      )}
    </span>
  )
}
