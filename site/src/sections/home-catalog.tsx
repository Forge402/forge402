import { Link } from 'react-router'
import { Reveal } from '@/components/reveal'
import { ModelCard } from '@/components/model-card'
import { models } from '@/data/models'

// Featured: one model per provider, reasoning/vision first, first four.
const featured = (() => {
  const seen = new Set<string>()
  return [...models]
    .sort((a, b) => b.tags.length - a.tags.length)
    .filter((m) => m.type === 'chat' && !m.deprecates && !seen.has(m.provider) && seen.add(m.provider))
    .slice(0, 4)
})()

export function HomeCatalog() {
  return (
    <section className="wrap pb-20 md:pb-28" aria-labelledby="cat-h">
      <Reveal className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="label">Catalog · planned prices</p>
          <h2 id="cat-h" className="display display-section mt-4">Fresh off <em className="fraunces-italic-gradient">the anvil.</em></h2>
        </div>
        <Link to="/models" className="btn btn-dark self-start">Browse all {models.length} models →</Link>
      </Reveal>
      <ul className="m-0 mt-10 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {featured.map((m) => <li key={m.id}><ModelCard m={m} /></li>)}
      </ul>
    </section>
  )
}
