import { PageStub } from '@/components/page-stub'
import { PlaygroundChat } from '@/features/playground/playground-chat'

export default function PlaygroundPage() {
  return (
    <PageStub fig="Playground" name="Playground" title={<>Try a <em className="fraunces-italic-gradient">model.</em></>} note="Chat with any model, see tokens in and out, latency and the exact charge on every reply.">
      <PlaygroundChat />
    </PageStub>
  )
}
