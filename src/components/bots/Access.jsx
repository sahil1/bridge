import Icon from '../Icon.jsx'
import { Askers, ReadsFrom, Changes, McpServers, Answerers, Limits, platName } from '../settings/Bots.jsx'
import { accessParts } from './access.js'
import { openBot } from './bots.js'
import { t } from '../../i18n/index.js'
import './bots-page.css'

// A bot's Access, a tab of its own page (BotPage.jsx, on a computer and on the phone): what this
// bot may do, as its own settings, edited here. The line that sums it up is over its tabs, and in
// Settings › Bots, which keeps the same sections in Set Up and links here. Who may ask, the folders
// it reads (it only ever reads them), what it may change, its memory, its MCP servers, what answers
// and what it falls back on, and its limits: each the section Settings has (settings/Bots.jsx),
// saved through the server's checks as any setting is, so its instructions, or a question, never
// widen them. How questions reach it on a shared connection is that connection's Routing
// (Routing.jsx), linked at the end.
export default function Access({ d, save, onTab }) {
  return (
    <div className="ba" data-setting="bots-access">
      <Askers d={d} save={save} />
      <ReadsFrom d={d} save={save} />
      <Changes d={d} save={save} />
      <MemoryAccess d={d} save={save} onTab={onTab} />
      <McpServers d={d} save={save} />
      <Answerers d={d} save={save} />
      <Limits d={d} save={save} />
      <ReachedBy d={d} />
    </div>
  )
}

// "Hiring: 3 people may ask · reads ~/Hiring · own memory · suggests changes". onOpen: it opens
// Access (on its page, the tab; in Settings, its page at that tab).
export function AccessLine({ d, onOpen = null }) {
  const body = <><Icon name="lock" size={12} /><span><b>{d.name}</b>: {accessParts(d.settings).join(' · ')}</span></>
  return onOpen
    ? <button type="button" className="ba-line" data-setting="bots-access-line" onClick={onOpen} title={t('Its Access: what it may do')}>{body}<Icon name="chevron" size={11} className="ba-go" /></button>
    : <p className="ba-line" data-setting="bots-access-line">{body}</p>
}

// Its memory, as part of what it may do: its own, apart from every other bot's, and used only in
// its answers; whether what it learns is kept once you approve, straight away, or not at all; and
// how much it holds (Memory has each item, to keep, edit or delete).
function MemoryAccess({ d, save, onTab }) {
  const mode = d.settings.memory || 'approve'
  const n = d.memoryCount || { kept: 0, proposed: 0 }
  const modes = [['approve', t('Ask me first')], ['auto', t('Keep straight away')], ['off', t('Off')]]
  return (
    <section className="st-sec" data-setting="bots-access-memory">
      <h4>{t('Memory')}</h4>
      <p className="muted small">{t('Its own: what {bot} learns is given only with its own answers, never another bot\'s.', { bot: d.name })}</p>
      <div className="st-row sb-mem-mode">
        <span className="small">{t('Learnings')}</span>
        <div className="seg" role="radiogroup" aria-label={t('Learnings')}>
          {modes.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? 'on' : ''} onClick={() => save({ memory: k })}>{l}</button>)}
        </div>
      </div>
      <div className="st-row">
        <span className="small">{mode === 'off' ? t('Off: it learns nothing new, and is given nothing it kept before.') : t('{kept} kept, {proposed} waiting for you', { kept: n.kept || 0, proposed: n.proposed || 0 })}</span>
        <button type="button" className="link-btn" onClick={() => onTab?.('memory')}>{t('See what it remembers')}</button>
      </div>
    </section>
  )
}

// How questions reach it through each platform's shared connection: that connection's Routing.
function ReachedBy({ d }) {
  const shared = Object.entries(d.connections || {}).filter(([, c]) => c?.shared)
  if (!shared.length) return null
  return (
    <section className="st-sec" data-setting="bots-access-routing">
      <h4>{t('Routing')}</h4>
      <p className="muted small">{t('On a shared connection, its Routing says which questions come to {bot}: in a channel it\'s the default bot in, with its name first, or by AI Assist\'s pick from its description. Who may then ask it is its own, above.', { bot: d.name })}</p>
      <div className="st-row">
        {shared.map(([p, c]) => (
          <button key={c.id} type="button" className="btn small" onClick={() => openBot(`routing:${c.id}`)}>
            <Icon name="branch" size={12} /> {t('{name}\'s Routing', { name: c.name })} <span className={`sb-plat p-${p}`}>{platName(p)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
