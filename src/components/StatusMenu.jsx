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
import { PINS, usePins, setPin } from '../pins.js'
import { t, locale } from '../i18n/index.js'
import './status.css'

// The top bar's Status menu (decided with the app's layout): what used to be a row of chips that
// squeezed each other on a smaller window, in one place with room for all of it. Usage (the account
// new agents start on, and its menu), setup carrying on, an update, a restart to apply, this page
// being out of date, the next meeting, notification sounds, the weather and the clock. Each but the
// next meeting (always in the bar) has a pin: pinned (src/pins.js), it shows in the bar too, as a
// small chip, while there's room. Its button shows usage's ring, and a count when something pinned
// that wants you (an update, setup, a restart) had to leave the bar for want of room.

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

// Who new agents start with and how much is left, said in full (the row's and the chip's hover).
function usageTitle(u) {
  const { act, sess, week } = u
  const name = act ? t('{agent} ({name}, where new agents start)', { agent: u.name, name: accountName(act) }) : u.name
  return u.off ? t('Plan usage is off · click to see it or turn it on')
    : `${t('{name} usage', { name })}${sess ? ` · ${sess.kind === 'session' ? t('{n}% left this 5-hour window', { n: sess.percentRemaining }) : t('{n}% left this {window}', { n: sess.percentRemaining, window: sess.label })}` : ''}${week ? ` · ${t('{n}% left this week', { n: week.percentRemaining })}` : ''}`
}
const Ring = ({ u }) => (u.off || !u.p ? <Icon name="gauge" size={14} /> : <span className={`mini-ring r-${level(u.ring?.percentRemaining)}`} style={{ '--p': u.ring?.percentRemaining ?? 0 }} />)
// The 5-hour window's and the week's figures, or why there are none.
function Figs({ u, className = '' }) {
  const { p, sess, week } = u
  if (u.off) return <span className={`muted ${className}`}>{t('off')}</span>
  if (!p) return null
  if (!p.usable) return <span className={`muted ${className}`}>{p.allow ? t('allow') : lapsed(p) || p.status === 'auth_required' || p.notSetUp || p.signedIn === false ? t('sign in') : p.status === 'pending' ? '…' : t('no data')}</span>
  return (
    <span className={`status-row-figs ${className}`}>
      {sess && <span>{sess.percentRemaining}%<small> {sess.kind === 'session' ? t('5h') : sess.label}</small></span>}
      {week && <span className={sess ? 'chip-sep' : undefined}>{week.percentRemaining}%<small> {t('wk')}</small></span>}
    </span>
  )
}

// Usage's row: who new agents start with and how much is left. With accounts listed it opens the
// account menu (switch, Add another account, Usage details); otherwise Today's Usage card.
function UsageRow({ u, onClick }) {
  return (
    <button type="button" className="status-row usage-chip" onClick={onClick} aria-haspopup={u.groups.length ? 'menu' : undefined} title={usageTitle(u)}>
      <Ring u={u} />
      <span className="status-row-text">
        <b className="usage-name">{u.off ? t('Usage') : u.name}</b>
        {u.act && <span className="usage-new">{t('New:')}</span>}
        {u.act && <b className="usage-acct">{accountName(u.act)}</b>}
        <Figs u={u} />
      </span>
      <Icon name="chevron" size={13} className="status-go" />
    </button>
  )
}

// Usage pinned to the bar: its row as a chip, opening what the row opens. As the bar gives way
// (useFit in App.jsx) the names go first (pin-word), then the two figures become the ring's own
// (pin-long, pin-short); all of it is there on hover.
export function UsageChip({ quota, primary, onUsage, onAddAccount }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const u = usageOf(quota, primary)
  if (!u) return null
  const menu = u.groups.length > 0
  const shown = menu ? listed(u.groups, primary) : []
  const title = usageTitle(u)
  return (
    <div className="acct-wrap" ref={wrap}>
      <button type="button" className="top-chip usage-chip" onClick={menu ? () => setOpen((o) => !o) : onUsage} aria-haspopup={menu ? 'menu' : undefined} aria-expanded={menu ? open : undefined} title={title} aria-label={title}>
        <Ring u={u} />
        <b className="usage-name pin-word">{u.off ? t('Usage') : u.name}</b>
        {u.act && <span className="usage-new pin-word">{t('New:')}</span>}
        {u.act && <b className="usage-acct pin-word">{accountName(u.act)}</b>}
        <Figs u={u} className="pin-long" />
        {!u.off && u.p?.usable && u.ring && <span className="pin-short">{u.ring.percentRemaining}%</span>}
        {menu && <Icon name="down" size={11} className="usage-caret" />}
      </button>
      {open && (
        <AccountMenu groups={shown.length ? shown : u.groups.slice(0, 1)} anchor={wrap} className="top" off={!!quota?.off} onClose={() => setOpen(false)} onPick={(kind, id) => setDefault(u.groups, kind, id)}
          onAdd={onAddAccount} extra={[{ icon: 'gauge', label: t('Usage details'), run: onUsage }]} />
      )}
    </div>
  )
}

// A Status item's pin: in the top bar too, or only here. Pressed while it's pinned.
export function PinButton({ id }) {
  const on = !!usePins()[id]
  const item = PINS.find((x) => x.id === id)
  return (
    <button type="button" className="pin-btn" aria-pressed={on} aria-label={t('Pin to the bar: {name}', { name: t(item.label) })} title={on ? t('Unpin from the bar') : t('Pin to the bar')} onClick={() => setPin(id, !on)}>
      <Icon name="pin" size={14} />
    </button>
  )
}
// A row of the menu with its pin beside it. A row with nothing to say (no update, setup done) is
// left out, and its pin with it (status.css).
const Pinned = ({ id, children }) => <div className="status-item">{children}<PinButton id={id} /></div>

const WX_ICON = (code) => (code <= 1 ? 'sun' : code >= 51 ? 'rain' : 'cloud')
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  return now
}
const timeOf = (d) => d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
const dayOf = (d) => d.toLocaleDateString(locale(), { weekday: 'long', month: 'short', day: 'numeric' })
function useWeather() {
  const { data, errorCode } = usePoll('/weather', 15 * 60 * 1000)
  const [unit, setUnit] = useShared('cc-unit', 'f')
  const c = unit === 'c'
  const temp = data?.current ? Math.round(c ? (data.current.temp - 32) * 5 / 9 : data.current.temp) : null
  return { data, c, temp, setUnit, noCity: !data && errorCode === 'noLocation' }
}
// The clock, and the weather with °F or °C picked as two plain buttons, each with its pin at the
// end of its line, as the rows under them have.
function Now({ onWeather }) {
  const now = useNow()
  const { data, c, temp, setUnit } = useWeather()
  return (
    <div className="status-now">
      <div className="status-clock">
        <b className="clock">{timeOf(now)}</b>
        <span className="muted small">{dayOf(now)}</span>
      </div>
      <PinButton id="clock" />
      {temp != null && (
        <>
          <div className="status-wx">
            <button type="button" className="status-wx-open" onClick={onWeather} title={`${data.location}: ${data.current.summary}`}>
              <Icon name={WX_ICON(data.current.code)} size={16} /><b>{temp}°</b><span className="muted small">{data.location}</span>
            </button>
            <div className="status-unit" role="group" aria-label={t('Temperature unit')}>
              <button type="button" aria-pressed={!c} onClick={() => setUnit('f')}>°F</button>
              <button type="button" aria-pressed={c} onClick={() => setUnit('c')}>°C</button>
            </div>
          </div>
          <PinButton id="weather" />
        </>
      )}
    </div>
  )
}
// The weather and the clock pinned to the bar. The sky's icon and the temperature, with the place
// and the sky on hover, and the forecast (Today's Weather card) at a click, as from Status; with no
// city picked yet it says so, and the card it opens has the city picker. The time, with the date on
// hover.
export function WeatherChip({ onClick }) {
  const { data, c, temp, noCity } = useWeather()
  if (noCity) return (
    <button type="button" className="top-chip wx-chip" onClick={onClick} title={t('No city picked yet: click to pick one for the weather')} aria-label={t('Pick your city')}>
      <Icon name="sun" size={14} /><span className="pin-word">{t('Pick your city')}</span>
    </button>
  )
  if (temp == null) return null
  const say = `${data.location}: ${data.current.summary}, ${temp}°${c ? 'C' : 'F'}`
  return (
    <button type="button" className="top-chip wx-chip" onClick={onClick} title={say} aria-label={say}>
      <Icon name={WX_ICON(data.current.code)} size={14} /><b>{temp}°</b>
    </button>
  )
}
export function ClockChip() {
  const now = useNow()
  return <time className="clock" dateTime={now.toISOString()} title={dayOf(now)}>{timeOf(now)}</time>
}

// folded: how many of the bar's pinned news chips (Updated, setup, the update, a restart) are out
// of it for want of room. restartFolded: Restart to apply asked for (Settings) while its chip isn't
// in the bar (unpinned, or no room) opens it here instead. onPins: Settings › Appearance's list.
export default function StatusMenu({ quota, primary, update, upNote, fresh, fleet, conf, folded = 0, restartFolded = false, onUsage, onAddAccount, onWeather, onCalendar, onUpdateDetails, onPins, recording = null }) {
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
            <Pinned id="update"><Quiet name="Updated"><FreshChip fresh={fresh} row /></Quiet></Pinned>
            <Pinned id="setup"><Quiet name="Setting up"><SetupChip line /></Quiet></Pinned>
            {showUpdate && <Pinned id="update"><Quiet name="Update"><UpdateChip u={update} row onDetails={close(onUpdateDetails)} onDone={upNote?.hide} /></Quiet></Pinned>}
            <Pinned id="restart"><Quiet name="Restart"><RestartChip line startOpen={ask === 'restart'} fleet={fleet} runtime={conf?.runtime?.name} keep={!!conf?.runtime?.keep} /></Quiet></Pinned>
            <Quiet name="Next meeting"><NextMeetingChip row onClick={close(onCalendar)} recording={recording} /></Quiet>
            {u && <Pinned id="usage"><UsageRow u={u} onClick={u.groups.length ? () => setOpen('accounts') : close(onUsage)} /></Pinned>}
            {conf && <Pinned id="sounds"><SoundButton conf={conf} row /></Pinned>}
          </div>
          {/* How to change what's in the bar, said where the pins are. */}
          <p className="status-foot">
            <Icon name="pin" size={12} />
            <span>{t('Pin any of these to see it in the top bar too.')} {onPins && <button type="button" className="link-btn" onClick={close(onPins)}>{t('Settings › Appearance')}</button>}</span>
          </p>
        </div>
      )}
      {open === 'accounts' && (
        <AccountMenu groups={shown.length ? shown : u.groups.slice(0, 1)} anchor={wrap} className="top" off={!!quota?.off} onClose={() => setOpen(null)} onPick={(kind, id) => setDefault(u.groups, kind, id)}
          onAdd={onAddAccount} extra={[{ icon: 'gauge', label: t('Usage details'), run: onUsage }]} />
      )}
    </div>
  )
}
