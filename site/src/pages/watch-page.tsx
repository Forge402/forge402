import { PageStub } from '@/components/page-stub'
import { TG_BOT } from '@/lib/api'

const commands: [string, string][] = [
  ['/start', 'Say hello and see what the bot does.'],
  ['/scan 0x…', 'Scan a token address once and get the score back in chat.'],
  ['/watch 0x…', 'Start watching a token. You only get a message when something changes.'],
  ['/watching', 'List what this chat is watching.'],
  ['/unwatch 0x…', 'Stop watching a token.'],
]
const triggers = ['The owner changes', 'The proxy points at a new implementation', 'Liquidity drops by more than 30%', 'The score drops']

export default function WatchPage() {
  return (
    <PageStub fig="Forge Watch" name="Watch" title={<>Watch it, <em className="fraunces-italic-gradient">quietly.</em></>} note="A Telegram bot that re-reads your tokens every 5 minutes and only speaks up when something changes.">
      <div className="grid gap-8 lg:grid-cols-2">
        <section className="panel p-6" aria-labelledby="w-start">
          <h2 id="w-start" className="m-0 text-[22px] font-semibold tracking-tight text-ink">Start</h2>
          <ol className="mb-0 mt-3 list-decimal space-y-2 pl-6 text-[16px] marker:font-mono marker:text-muted">
            <li>Open <a className="font-mono text-ink underline" href={`https://t.me/${TG_BOT}`} target="_blank" rel="noreferrer">@{TG_BOT}</a> in Telegram and press Start.</li>
            <li>Send <span className="font-mono text-ink">/watch 0x…</span> with the token address.</li>
            <li>Leave it. You hear nothing until a trigger fires.</li>
          </ol>
          <h3 className="mb-0 mt-6 text-[17px] font-semibold text-ink">You get a message when</h3>
          <ul className="m-0 mt-2 list-disc space-y-1 pl-6 text-[16px]">{triggers.map((t) => <li key={t}>{t}</li>)}</ul>
          <h3 className="mb-0 mt-6 text-[17px] font-semibold text-ink">Limits</h3>
          <p className="m-0 mt-2 text-[16px]">One watched token per chat for free. Linked holders get 10 later. If the bot does not answer, it is not switched on yet.</p>
        </section>
        <section className="panel p-6" aria-labelledby="w-cmd">
          <h2 id="w-cmd" className="m-0 text-[22px] font-semibold tracking-tight text-ink">Commands</h2>
          <dl className="m-0 mt-3 grid gap-3">
            {commands.map(([c, d]) => <div key={c} className="border-b border-line pb-3 last:border-0"><dt className="font-mono text-[14px] text-ink">{c}</dt><dd className="m-0 mt-1 text-[15px]">{d}</dd></div>)}
          </dl>
        </section>
      </div>
    </PageStub>
  )
}
