import { PageStub } from '@/components/page-stub'
import { ForgeCa } from '@/components/forge-ca'

export default function TokenPage() {
  return (
    <PageStub fig="$FORGE" name="$FORGE" title={<>Hold it. <em className="fraunces-italic-gradient">Pay less.</em></>} note="One contract address, posted here at launch.">
      <div className="stage flex justify-center p-5 md:p-10">
        <ForgeCa />
      </div>
    </PageStub>
  )
}
