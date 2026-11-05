import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import AccountMenu, { listed, setDefault, lapsed, asList, nameOf as accountName } from './AccountMenu.jsx'
import UpdateChip from './UpdateChip.jsx'
import RestartChip from './RestartChip.jsx'
import SetupChip from './SetupChip.jsx'
import SoundButton from './SoundButton.jsx'
import { FreshChip } from './TopNotes.jsx'
import { NextMeetingChip } from './Agenda.jsx'
import { Quiet } from './ErrorBoundary.jsx'
import { useShared } from './layout.jsx'
import { usePoll } from '../api.js'
import { t, locale } from '../i18n/index.js'
import './status.css'

// The top bar's Status menu (decided with the app's layout): what used to be a row of chips that
// squeezed each other on a smaller window, in one place with room for all of it. Usage (the account
// new agents start on, and its menu), setup carrying on, an update, a restart to apply, this page
// being out of date, the next meeting, notification sounds, the weather and the clock. Its button
// shows usage's ring, and a count when something that wants you (an update, setup, a restart) had
// to leave the bar for want of room; on a wide window those also show in the bar itself.

const NAMES = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', grok: 'Grok' }
const level = (v) => (v == null ? 'unknown' : v < 10 ? 'critical' : v < 30 ? 'warning' : 'good')

// The default provider's usage: the account new agents start on (with several), its 5-hour window
// and its week (a plan with no 5-hour window shows its week once, one with neither its first
// window), and the lower of the two for the ring.
export function usageOf(quota, primary) {
  const groups = quota?.accounts || []
  const g = groups.find((x) => x.kind === primary)
  const act = asList(g) ? g.accounts.find((a) => a.active) : null
  const name = NAMES[primary] || primary
  if (quota?.off) return { off: true, groups, act, name }
  const p = act || quota?.providers?.find((x) => x.provider === primary)
  if (!p) return groups.length ? { groups, act, name } : null
  const week = p.windows.find((w) => w.kind === 'weekly')
  const sess = p.windows.find((w) => w.kind === 'session') || p.windows.find((w) => w.kind !== 'weekly' && w.kind !== 'credits') || (week ? null : p.windows[0])
  const ring = [sess, week].filter((w) => w?.percentRemaining != null).reduce((m, w) => (!m || w.percentRemaining < m.percentRemaining ? w : m), null)
  return { groups, act, p, week, sess, ring, name }
}

// Usage's row: who new agents start with and how much is left. With accounts listed it opens the
// account menu (switch, Add another account, Usage details); otherwise Today's Usage card.
function UsageRow({ u, onClick }) {
  const { p, act, sess, week } = u
  const name = act ? t('{agent} ({name}, where new agents start)', { agent: u.name, name: accountName(act) }) : u.name
  const title = u.off ? t('Plan usage is off · click to see it or turn it on')
    : `${t('{name} usage', { name })}${sess ? ` · ${sess.kind === 'session' ? t('{n}% left this 5-hour window', { n: sess.percentRemaining }) : t('{n}% left this {window}', { n: sess.percentRemaining, window: sess.label })}` : ''}${week ? ` · ${t('{n}% left this week', { n: week.percentRemaining })}` : ''}`
  return (
    <button type="button" className="status-row usage-chip" onClick={onClick} aria-haspopup={u.groups.length ? 'menu' : undefined} title={title}>
      {u.off || !p ? <Icon name="gauge" size={14} /> : <span className={`mini-ring r-${level(u.ring?.percentRemaining)}`} style={{ '--p': u.ring?.percentRemaining ?? 0 }} />}
      <span className="status-row-text">
        <b className="usage-name">{u.off ? t('Usage') : u.name}</b>
        {act && <span className="usage-new">{t('New:')}</span>}
        {act && <b className="usage-acct">{accountName(act)}</b>}
        {u.off ? <span className="muted">{t('off')}</span>
          : !p ? null
            : p.usable ? (
              <span className="status-row-figs">
                {sess && <span>{sess.percentRemaining}%<small> {sess.kind === 'session' ? t('5h') : sess.label}</small></span>}
                {week && <span className={sess ? 'chip-sep' : undefined}>{week.percentRemaining}%<small> {t('wk')}</small></span>}
              </span>
            ) : <span className="muted">{p.allow ? t('allow') : lapsed(p) || p.status === 'auth_required' || p.notSetUp || p.signedIn === false ? t('sign in') : p.status === 'pending' ? '…' : t('no data')}</span>}
      </span>
      <Icon name="chevron" size={13} className="status-go" />
    </button>
  )
}

const WX_ICON = (code) => (code <= 1 ? 'sun' : code >= 51 ? 'rain' : 'cloud')
// The clock, and the weather with °F or °C picked as two plain buttons.
function Now({ onWeather }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  const { data } = usePoll('/weather', 15 * 60 * 1000)
  const [unit, setUnit] = useShared('cc-unit', 'f')
  const c = unit === 'c'
  const temp = data?.current ? Math.round(c ? (data.current.temp - 32) * 5 / 9 : data.current.temp) : null
  return (
    <div className="status-now">
      <div className="status-clock">
        <b className="clock">{now.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}</b>
        <span className="muted small">{now.toLocaleDateString(locale(), { weekday: 'long', month: 'short', day: 'numeric' })}</span>
      </div>
      {temp != null && (
        <div className="status-wx">
          <button type="button" className="status-wx-open" onClick={onWeather} title={`${data.location}: ${data.current.summary}`}>
            <Icon name={WX_ICON(data.current.code)} size={16} /><b>{temp}°</b><span className="muted small">{data.location}</span>
          </button>
          <div className="status-unit" role="group" aria-label={t('Temperature unit')}>
            <button type="button" aria-pressed={!c} onClick={() => setUnit('f')}>°F</button>
            <button type="button" aria-pressed={c} onClick={() => setUnit('c')}>°C</button>
          </div>
        </div>
      )}
    </div>
  )
}

// folded: how many of the bar's own news chips (Updated, setup, the update, a restart) are out of
// it for want of room. restartFolded: Restart to apply asked for (Settings) while its chip is out of
// the bar opens it here instead.
export default function StatusMenu({ quota, primary, update, upNote, fresh, fleet, conf, folded = 0, restartFolded = false, onUsage, onAddAccount, onWeather, onCalendar, onUpdateDetails, recording = null }) {
  const [open, setOpen] = useState(null) // null | 'menu' | 'accounts'
  const [ask, setAsk] = useState(null) // a row to open with the menu: 'restart'
  const wrap = useRef(null)
  const u = usageOf(quota, primary)
  const foldedRef = useRef(restartFolded)
  foldedRef.current = restartFolded
  useEffect(() => {
    const on = () => { if (foldedRef.current) { setAsk('restart'); setOpen('menu') } }
    window.addEventListener('bridge-restart', on)
    return () => window.removeEventListener('bridge-restart', on)
  }, [])
  useEffect(() => {
    if (open !== 'menu') return
    const down = (e) => { if (!wrap.current?.contains(e.target)) setOpen(null) }
    const key = (e) => { if (e.key === 'Escape') { setOpen(null); wrap.current?.querySelector('.status-btn')?.focus() } }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key) }
  }, [open])
  useEffect(() => { if (!open) setAsk(null) }, [open])
  const close = (fn) => () => { setOpen(null); fn?.() }
  const shown = u ? listed(u.groups, primary) : []
  const label = folded ? (folded === 1 ? t('Status: {n} thing wants you', { n: folded }) : t('Status: {n} things want you', { n: folded })) : t('Status')
  const showUpdate = update?.available || (update?.held && upNote?.line)
  return (
    <div className="status-wrap" ref={wrap}>
      <button type="button" className="top-chip status-btn" data-tour="usage" onClick={() => setOpen(open === 'menu' ? null : 'menu')} aria-haspopup="dialog" aria-expanded={open === 'menu'} aria-label={label}
        title={t('Usage, updates, setup, sounds, the weather and the time')}>
        {u?.p && !u.off ? <span className={`mini-ring r-${level(u.ring?.percentRemaining)}`} style={{ '--p': u.ring?.percentRemaining ?? 0 }} /> : <Icon name="gauge" size={14} />}
        <span className="status-word">{t('Status')}</span>
        <Icon name="down" size={11} className="usage-caret" />
        {folded > 0 && <span className="status-count" aria-hidden="true">{folded}</span>}
      </button>
      {open === 'menu' && (
        <div className="status-pop" role="dialog" aria-label={t('Status')}>
          <Now onWeather={close(onWeather)} />
          <div className="status-list">
            <Quiet name="Updated"><FreshChip fresh={fresh} row /></Quiet>
            <Quiet name="Setting up"><SetupChip line /></Quiet>
            {showUpdate && <Quiet name="Update"><UpdateChip u={update} row onDetails={close(onUpdateDetails)} onDone={upNote?.hide} /></Quiet>}
            <Quiet name="Restart"><RestartChip line startOpen={ask === 'restart'} fleet={fleet} runtime={conf?.runtime?.name} keep={!!conf?.runtime?.keep} /></Quiet>
            <Quiet name="Next meeting"><NextMeetingChip row onClick={close(onCalendar)} recording={recording} /></Quiet>
            {u && <UsageRow u={u} onClick={u.groups.length ? () => setOpen('accounts') : close(onUsage)} />}
            {conf && <SoundButton conf={conf} row />}
          </div>
        </div>
      )}
      {open === 'accounts' && (
        <AccountMenu groups={shown.length ? shown : u.groups.slice(0, 1)} anchor={wrap} className="top" off={!!quota?.off} onClose={() => setOpen(null)} onPick={(kind, id) => setDefault(u.groups, kind, id)}
          onAdd={onAddAccount} extra={[{ icon: 'gauge', label: t('Usage details'), run: onUsage }]} />
      )}
    </div>
  )
}
