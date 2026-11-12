import { Link, useParams } from 'react-router'
import { PageStub } from '@/components/page-stub'
import { isEvmAddress } from '@/components/scan-form'
import { ScanReport, useScan } from '@/features/scan/scan-report'

const HELP: Record<string, string> = {
  rate_limited: 'Free web scans are limited to 30 per hour per visitor. Try again later, or call the paid endpoint.',
  not_configured: 'The scanner is not configured yet. Nothing was read.',
  network_error: 'Cannot reach the scanner. It may be down or not deployed yet.',
  timeout: 'The scanner took too long. Try again in a moment.',
}

function Result({ ca }: { ca: string }) {
  const st = useScan(ca)
  if (st.s === 'loading') return <p role="status" className="panel p-6 text-[16px]">Reading the contract from the chain…</p>
  if (st.s === 'err') {
    return (
      <div role="alert" className="panel max-w-[640px] p-6">
        <p className="label !text-ember-ink">{st.code}</p>
        <p className="mt-2 text-[16px] text-ink">{HELP[st.code] ?? st.msg}</p>
        {HELP[st.code] && st.code !== 'rate_limited' && <p className="mt-1 text-[13px] text-muted">{st.msg}</p>}
        <Link to="/scan" className="btn btn-secondary btn-light mt-5">← Scan another</Link>
      </div>
    )
  }
  return <ScanReport r={st.r} />
}

export default function ScanResultPage() {
  const { ca = '' } = useParams()
  const ok = isEvmAddress(ca)
  return (
    <PageStub fig="Forge Scan" name="Scan" title={<>Inspection <em className="fraunces-italic-gradient">sheet.</em></>} note="Read straight from the chain and scored by published rules.">
      {ok ? <Result ca={ca} /> : (
        <div role="alert" className="panel max-w-[640px] p-6">
          <p className="text-[16px] text-ink">“{ca}” is not a token address. It should start with 0x and be 42 characters.</p>
          <Link to="/scan" className="btn btn-light mt-5">← Scan another</Link>
        </div>
      )}
    </PageStub>
  )
}
