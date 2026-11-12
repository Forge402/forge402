import { PageStub } from '@/components/page-stub'
import { ForgeCa } from '@/components/forge-ca'
import { isLaunched } from '@/data/token'

export default function TokenPage() {
  const note = isLaunched() ? 'One contract address. If you see another, it is not ours.' : 'One contract address, posted here at launch.'
  return (
    <PageStub fig="$FORGE" name="$FORGE" title={<>Hold it. <em className="fraunces-italic-gradient">Pay less.</em></>} note={note}>
      <div className="stage flex justify-center p-5 md:p-10">
        <ForgeCa />
      </div>
    </PageStub>
  )
}
