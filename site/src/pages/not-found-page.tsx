import { Link } from 'react-router'
import { PageStub } from '@/components/page-stub'

export default function NotFoundPage() {
  return (
    <PageStub fig="404" name="Not found" title={<>No such <em className="fraunces-italic-gradient">page.</em></>} note="That route does not exist.">
      <Link to="/" className="btn btn-primary">Back home →</Link>
    </PageStub>
  )
}
