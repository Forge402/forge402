import { PageStub } from '@/components/page-stub'
import { ScanForm } from '@/components/scan-form'
import { RecentScans } from '@/features/scan/recent-scans'

export default function ScanPage() {
  return (
    <PageStub fig="Forge Scan" name="Scan" title={<>Read the contract <em className="fraunces-italic-gradient">first.</em></>} note="Paste a token address on Robinhood Chain. Free on the web, $0.02 per agent call.">
      <div className="max-w-[720px]"><ScanForm /></div>
      <RecentScans />
    </PageStub>
  )
}
