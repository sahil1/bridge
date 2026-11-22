import Icon from '../Icon.jsx'
import { useBots, STATUS, needsCount, isBotsPlace, botsView, firstTab } from './bots.js'
import { t } from '../../i18n/index.js'
import './bots-page.css'

// Bots in the sidebar (a beta feature, there only while Bots is on): one row, Bots, with how many of
// its answers, changes and questions wait for you; it opens Bots (BotsHome.jsx) at its tabs,
// Connections, Bots and Sessions. + makes a new bot from three questions.
export function BotDot({ status, size = 8 }) {
  return <span className={`bt-dot bt-${status}`} style={{ '--d': `${size}px` }} role="img" aria-label={t(STATUS[status])} title={t(STATUS[status])} />
}

export default function RailBots({ selected, onOpen }) {
  const { on, list } = useBots()
  if (!on) return null
  const needs = needsCount(list)
  const here = isBotsPlace(selected)
  return (
    <div className="rail-nav rail-bots" data-setting="rail-bots">
      <div className="rail-nav-row">
        <button type="button" className={`rail-nav-btn ${here ? 'on' : ''}`} onClick={() => onOpen(botsView(firstTab(list)))} title={t('Your bots, their connections and every conversation they\'re having')}>
          <Icon name="bot" size={14} /> {t('Bots')}
          {needs > 0 && <span className="mc-needs" aria-label={needs === 1 ? t('{n} needs you', { n: needs }) : t('{n} need you', { n: needs })}>{needs}</span>}
        </button>
        <span className="rail-tools">
          <button type="button" className="rail-tool" onClick={() => onOpen(botsView('new'))} aria-label={t('New bot')} title={t('New bot: what it\'s for, its folder, where it answers')}><Icon name="plus" size={14} /></button>
        </span>
      </div>
    </div>
  )
}

// The closed sidebar: Bots as one button, with a dot when something waits for you; it opens Bots.
export function MiniBots({ selected, onOpen }) {
  const { on, list } = useBots()
  if (!on) return null
  const needs = needsCount(list) > 0
  return (
    <button type="button" className={`mini-nav ${isBotsPlace(selected) ? 'on' : ''}`} onClick={() => onOpen(botsView(firstTab(list)))} aria-label={needs ? t('Bots (one needs you)') : t('Bots')} title={t('Bots')}>
      <Icon name="bot" size={15} />{needs && <span className="mini-needs" />}
    </button>
  )
}
