import Icon from '../Icon.jsx'
import { usePersisted } from '../layout.jsx'
import { useBots, statusOf, STATUS, botView, BOT_VIEW } from './bots.js'
import { t } from '../../i18n/index.js'
import './bots-page.css'

// Your bots in the sidebar, under Spaces' own kind of heading (a beta feature, there only while Bots
// is on): each with a dot for how it stands (answering, needs you, paused, not connected yet, or a
// draft waiting for Create) and how many of its answers wait for you; + for a new one, which opens a
// chat with AI Assist. A bot opens as a page of its own in the main area (BotPage.jsx), and so does
// Connections, the apps they're reached through (Connections.jsx). Folded like Spaces, kept on this
// computer.
export function BotDot({ status, size = 8 }) {
  return <span className={`bt-dot bt-${status}`} style={{ '--d': `${size}px` }} role="img" aria-label={t(STATUS[status])} title={t(STATUS[status])} />
}

export default function RailBots({ selected, onOpen }) {
  const { on, list } = useBots()
  const [open, setOpen] = usePersisted('cc-rail-bots', true)
  if (!on) return null
  const bots = list || []
  const needs = bots.filter((b) => statusOf(b) === 'needs').length
  return (
    <div className="rail-bots" data-setting="rail-bots">
      <div className="rail-head rail-bots-head">
        <button type="button" className="rail-sec" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? t('Collapse {name}', { name: t('Bots') }) : t('Expand {name}', { name: t('Bots') })} title={open ? t('Collapse') : t('Expand')}>
          <Icon name="chevron" size={10} className={`caret ${open ? 'rot90' : ''}`} />
          <span className="rail-label">{t('Bots')}</span>
        </button>
        {!open && bots.length > 0 && <span className="ws-count" title={needs ? (needs === 1 ? t('{n} needs you', { n: needs }) : t('{n} need you', { n: needs })) : undefined}>{needs ? <b className="needs">{needs}</b> : bots.length}</span>}
        <span className="rail-tools">
          <button type="button" className="rail-tool" onClick={() => onOpen(botView('new'))} aria-label={t('New bot')} title={t('New bot: say what it should do')}><Icon name="plus" size={14} /></button>
        </span>
      </div>
      {open && (
        <div className="rail-bot-list" aria-label={t('Your bots')}>
          {!list && <div className="skeleton-rows pad"><div /></div>}
          {list && !bots.length && (
            <button type="button" className={`rm-row bt-row bt-first${selected === botView('new') ? ' on' : ''}`} onClick={() => onOpen(botView('new'))}>
              <Icon name="plus" size={12} /><span className="rm-title">{t('Make your first bot')}</span>
            </button>
          )}
          {bots.map((b) => {
            const st = statusOf(b)
            return (
              <button key={b.id} type="button" className={`rm-row bt-row${selected === botView(b.id) ? ' on' : ''}`} onClick={() => onOpen(botView(b.id))} title={`${b.name}\n${t(STATUS[st])}`} data-bot={b.id}>
                <BotDot status={st} size={7} />
                <span className="rm-title">{b.name}</span>
                {st === 'draft' && <span className="bt-tag">{t('Draft')}</span>}
                {b.paused && <Icon name="pause" size={11} className="muted" />}
                {b.waiting > 0 && <span className="bt-count" aria-label={b.waiting === 1 ? t('{n} waits for you', { n: b.waiting }) : t('{n} wait for you', { n: b.waiting })}>{b.waiting}</span>}
              </button>
            )
          })}
          {list && bots.length > 0 && (
            <button type="button" className={`rm-row bt-row bt-conns${selected === botView('connections') ? ' on' : ''}`} onClick={() => onOpen(botView('connections'))} title={t('The apps on Slack, Discord and Teams your bots are reached through')} data-bot="connections">
              <Icon name="link" size={12} className="muted" /><span className="rm-title">{t('Connections')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// The closed sidebar: Bots as one button, with a dot when one needs you; it opens the sidebar.
export function MiniBots({ selected, onExpand }) {
  const { on, list } = useBots()
  if (!on) return null
  const needs = (list || []).some((b) => statusOf(b) === 'needs')
  return (
    <button type="button" className={`mini-nav ${String(selected || '').startsWith(BOT_VIEW) ? 'on' : ''}`} onClick={onExpand} aria-label={needs ? t('Bots (one needs you)') : t('Bots')} title={t('Bots')}>
      <Icon name="bot" size={15} />{needs && <span className="mini-needs" />}
    </button>
  )
}
