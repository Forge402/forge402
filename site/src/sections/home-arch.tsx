import { Reveal } from '@/components/reveal'
import { models } from '@/data/models'
import { EmberField } from '@/components/ember-field'

const W = '#fff'
const mono = { fontFamily: 'Geist Mono Variable, ui-monospace, monospace' } as const

function Box({ x, y, w, h, title, sub, hot }: { x: number; y: number; w: number; h: number; title: string; sub: string[]; hot?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="12" fill="rgba(255,255,255,0.04)" stroke={hot ? '#FF5A1F' : 'rgba(255,255,255,0.22)'} strokeWidth={hot ? 1.5 : 1} />
      <text x={x + 12} y={y + 22} fontSize="12" letterSpacing="1" fill={hot ? '#FF5A1F' : W} style={mono}>{title}</text>
      {sub.map((s, i) => (
        <text key={s} x={x + 12} y={y + 42 + i * 16} fontSize="11" fill="#9AA3B0" style={mono}>{s}</text>
      ))}
    </g>
  )
}

function Flow({ d, slow }: { d: string; slow?: boolean }) {
  return (
    <g fill="none">
      <path d={d} stroke="#fff" strokeOpacity="0.25" strokeWidth="1" />
      <path d={d} stroke="#FF5A1F" strokeWidth="1.5" className={slow ? 'flow-slow' : 'flow'} />
    </g>
  )
}

export function HomeArch() {
  return (
    <section className="stage stage-wrap" aria-labelledby="arch-h">
      <EmberField />
      <div className="wrap py-16 md:py-24">
        <Reveal>
          <p className="chip"><span className="chip-dot" />Architecture · planned build</p>
          <h2 id="arch-h" className="display display-section mt-5 max-w-[18ch]">What sits between the agent and <em className="fraunces-italic-gradient">the model.</em></h2>
        </Reveal>

        <Reveal delay={0.1} className="mt-12">
          <div className="glass overflow-x-auto rounded-2xl bg-black/30" tabIndex={0} aria-label="Architecture diagram, scrolls sideways on small screens">
            <svg viewBox="0 0 960 500" role="img" className="block h-auto w-full min-w-[820px]" aria-labelledby="arch-t">
              <title id="arch-t">
                Block diagram. The agent sends requests to the Forge402 edge on Cloudflare. The edge calls the model pool, the x402 facilitator on Robinhood Chain,
                a prepaid key ledger, a response cache and the Forge Scan RPC.
              </title>
              <Box x={30} y={200} w={150} h={80} title="AGENT" sub={['any OpenAI SDK', 'wallet or forge_sk_']} />
              <Box x={300} y={140} w={240} h={200} title="FORGE402 EDGE" sub={['Cloudflare Worker', '', '01 x402 gate', '02 router + meter', '03 cache lookup', '04 refund ledger']} hot />
              <Box x={780} y={200} w={150} h={80} title="MODEL POOL" sub={['Workers AI', `${models.length} models`]} />

              <Box x={300} y={20} w={240} h={70} title="X402 FACILITATOR" sub={['settles USDG on', 'Robinhood Chain · eip155:4663']} />
              <Box x={170} y={400} w={160} h={74} title="PREPAID LEDGER" sub={['D1 + Durable Object', 'balance per key']} />
              <Box x={340} y={400} w={160} h={74} title="RESPONSE CACHE" sub={['KV', 'repeat call = ½ price']} />
              <Box x={510} y={400} w={160} h={74} title="FORGE SCAN RPC" sub={['reads contracts', 'straight from chain']} />

              <Flow d="M180 240 H300" />
              <Flow d="M540 240 H780" />
              <Flow d="M420 140 V90" slow />
              <Flow d="M330 340 V370 H250 V400" slow />
              <Flow d="M420 340 V400" slow />
              <Flow d="M510 340 V370 H590 V400" slow />

              <text x="190" y="230" fontSize="11" fill="#9AA3B0" style={mono}>402 · SIGN</text>
              <text x="190" y="258" fontSize="11" fill="#9AA3B0" style={mono}>RETRY</text>
              <text x="565" y="230" fontSize="11" fill="#9AA3B0" style={mono}>AI BINDING</text>
              <text x="432" y="120" fontSize="11" fill="#9AA3B0" style={mono}>VERIFY + SETTLE</text>
              <g fill="#FF5A1F"><rect x="296" y="236" width="8" height="8" /><rect x="776" y="236" width="8" height="8" /></g>
            </svg>
          </div>
          <p className="label mt-4 flex flex-col gap-1 sm:flex-row sm:justify-between">
            <span>DASHED LINES = DIRECTION OF TRAFFIC</span>
            <span>BLOCK DIAGRAM OF THE PLANNED BUILD, NOT LIVE YET</span>
          </p>
        </Reveal>
      </div>
    </section>
  )
}
