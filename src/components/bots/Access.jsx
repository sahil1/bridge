import Icon from '../Icon.jsx'
import { accessParts } from './access.js'
import { t } from '../../i18n/index.js'
import './bots-page.css'

// A bot's Access, as its page shows it (BotPage.jsx): what this bot may do, in a line, on top of its
// Overview and its Settings, where each part of it is a setting (who may ask, its folders, what it
// may change, its memory, its MCP servers, what answers, its limits), saved through the server's
// checks as any setting is, so its instructions, or a question, never widen them.

// "Hiring: 3 people may ask · reads ~/Hiring · own memory · suggests changes". onOpen: it opens its
// Settings (from its Overview).
export function AccessLine({ d, onOpen = null }) {
  const body = <><Icon name="lock" size={12} /><span><b>{d.name}</b>: {accessParts(d.settings).join(' · ')}</span></>
  return onOpen
    ? <button type="button" className="ba-line" data-setting="bots-access-line" onClick={onOpen} title={t('Its settings: what it may do')}>{body}<Icon name="chevron" size={11} className="ba-go" /></button>
    : <p className="ba-line" data-setting="bots-access-line">{body}</p>
}

// Its memory, as part of what it may do: its own, apart from every other bot's, and used only in
// its answers; whether what it learns is kept once you approve, straight away, or not at all; and
// how much it holds (Memory has each item, to keep, edit or delete).
export function MemoryAccess({ d, save, onTab }) {
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
