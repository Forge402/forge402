import { PageStub } from '@/components/page-stub'
import { DashboardConsole } from '@/features/dashboard/dashboard-console'

export default function DashboardPage() {
  return (
    <PageStub fig="Console" name="Console" title={<>Your <em className="fraunces-italic-gradient">keys.</em></>} note="Sign in with your wallet to mint prepaid keys, top them up, close them and see refunds.">
      <DashboardConsole />
    </PageStub>
  )
}
