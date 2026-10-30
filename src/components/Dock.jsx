import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { PaneHeader, store, useShared } from './layout.jsx'
import { Brief, Quota, Weather } from './Trackers.jsx'
import { Routines, Insights, Ideas } from './Routines.jsx'
import { Agenda } from './Agenda.jsx'
import { Inbox } from './Inbox.jsx'
import { CalendarView, UsageStats } from '../lazy.jsx'
import MailView, { useMail } from './MailView.jsx'
import MarketsView from './MarketsView.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { openToday } from './today.js'
import { t, tx } from '../i18n/index.js'

// Today has four tabs: an overview of cards, a full calendar, mail triage, and markets & news.
export const TABS = [
  ['overview', 'today', tx('Today')],
  ['calendar', 'calendar', tx('Calendar')],
  ['mail', 'mail', tx('Mail')],
  ['markets', 'trend', tx('Markets')],
  ['usage', 'gauge', tx('Usage')],
]
const CARDS = [
  ['calendar', tx('Schedule')],
  ['mail', tx('Inbox')],
  ['today', tx('Brief')],
  ['repeat', tx('Routines')],
  ['bulb', tx('Ideas')],
  ['gauge', tx('Quota')],
  ['sparkle', tx('Insights')],
  ['sun', tx('Weather')],
]

export { openToday }

export function showCard(id) {
  store.set(`cc-card-${id}`, true)
  openToday('overview')
  setTimeout(() => document.getElementById(`card-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80)
}

export function TodayTabs({ tab, setTab, compact }) {
  const mail = useMail()
  const needs = mail.data?.available ? mail.data.messages.filter((m) => m.bucket === 'needs' && !m.read).length : 0
  return (
    <nav className={`today-tabs ${compact ? 'compact' : ''}`} role="tablist" aria-label={t('Today sections')}>
      {TABS.map(([id, icon, label]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
          <Icon name={icon} size={13} /> <span>{id === 'markets' && !compact ? t('Markets & News') : t(label)}</span>
          {id === 'mail' && needs > 0 && <span className="tab-badge">{needs}</span>}
        </button>
      ))}
    </nav>
  )
}

// The tab bodies, shared by the desktop panel and the phone's Today tab.
export function TodayBody({ wide, onOpenAgent, tab, setTab, stackClass = 'dock-scroll' }) {
  const [mailId, setMailId] = useState(null)
  const [date, setDate] = useState(null)
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {}
      if (d.tab) setTab(d.tab)
      if (d.mailId) setMailId(d.mailId)
      if (d.date) setDate(d.date)
    }
    window.addEventListener('cc-today', on)
    return () => window.removeEventListener('cc-today', on)
  }, [setTab])
  if (tab === 'calendar') return <CalendarView onOpenAgent={onOpenAgent} focusDate={date} />
  if (tab === 'mail') return <MailView onOpenAgent={onOpenAgent} openId={mailId} />
  if (tab === 'markets') return <MarketsView />
  if (tab === 'usage') return <UsageStats />
  return (
    <div className={`${stackClass} ${wide ? 'wide' : ''}`}>
      <Agenda onOpenAgent={onOpenAgent} />
      <Inbox />
      <Brief onOpenAgent={onOpenAgent} onShowCard={showCard} />
      <Routines onOpenAgent={onOpenAgent} />
      <Ideas />
      <Quota />
      <Insights />
      <Weather />
    </div>
  )
}

export default function Dock({ minimized, simple, maximized, onMinimize, onMaximize, onOpenAgent }) {
  const [tab, setTab] = useShared('cc-today-tab', 'overview')
  // The simple layout: one button, and the panel opens on its overview.
  if (minimized && simple) {
    return (
      <aside className="dock is-min" aria-label={t('Today')}>
        <button className="strip-btn" onClick={() => { setTab('overview'); onMinimize() }} title={t('Today: your schedule, mail, usage, routines and more')} aria-label={t('Show Today panel')}><Icon name="today" size={17} /></button>
      </aside>
    )
  }
  if (minimized) {
    // Icon strip: tabs first, then the overview cards. Clicking one restores the panel there.
    const go = (t, card) => {
      onMinimize()
      if (card) setTimeout(() => showCard(card), 40)
      else setTimeout(() => openToday(t), 40)
    }
    return (
      <aside className="dock is-min" aria-label={t('Today')}>
        <button className="win-btn" onClick={onMinimize} title={t('Show Today panel')} aria-label={t('Show Today panel')}><Icon name="panel-right" size={16} /></button>
        {TABS.slice(1).map(([id, icon, label]) => (
          <button key={id} className="strip-btn" onClick={() => go(id)} title={t(label)} aria-label={t(label)}><Icon name={icon} size={17} /></button>
        ))}
        <span className="strip-sep" />
        {CARDS.map(([id, label]) => (
          <button key={id} className="strip-btn" onClick={() => go('overview', id)} title={t(label)} aria-label={t(label)}><Icon name={id} size={17} /></button>
        ))}
      </aside>
    )
  }
  return (
    <aside className={`pane dock tab-${tab}`} aria-label={t('Today')}>
      <PaneHeader icon="today" title={t('Today')} minimized={false} maximized={maximized} onMinimize={onMinimize} onMaximize={onMaximize}>
        {maximized && <TodayTabs tab={tab} setTab={setTab} />}
      </PaneHeader>
      {!maximized && <TodayTabs tab={tab} setTab={setTab} compact />}
      <div className="dock-body">
        <ErrorBoundary name="Today" resetKey={tab}><TodayBody wide={maximized} onOpenAgent={onOpenAgent} tab={tab} setTab={setTab} /></ErrorBoundary>
      </div>
    </aside>
  )
}
