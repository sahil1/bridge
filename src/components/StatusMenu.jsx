import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import AccountMenu, { listed, setDefault, lapsed, asList, nameOf as accountName, AcctDot, limitsOf, limitWords, statusText } from './AccountMenu.jsx'
import { addAccount } from './AddAccount.jsx'
import { AgentIcon } from './settings/ProviderIcon.jsx'
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

// The default provider's usage: the account new agents start on (with several, and whether Auto
// picked it), its 5-hour window and its week (a plan with no 5-hour window shows its week once, one
// with neither its first window), and the limit that matters most now (tight): the plan's own with
// the least left, or a model's own (Claude's Fable week) once that's the one about to run out. It
// only stops agents on that model, so until it's low (under 30% left) and lower than the plan's,
// it's in the menu and on hover, not in the bar. tight is the bar's one figure and the ring's.
export function usageOf(quota, primary) {
  const groups = quota?.accounts || []
  const g = groups.find((x) => x.kind === primary)
  const act = asList(g) ? g.accounts.find((a) => a.active) : null
  const auto = !!act && g.setting === 'auto'
  const name = NAMES[primary] || primary
  if (quota?.off) return { off: true, groups, act, auto, name }
  const p = act || quota?.providers?.find((x) => x.provider === primary)
  if (!p) return groups.length ? { groups, act, auto, name } : null
  const limits = limitsOf(p)
  const own = limits.filter((l) => !l.model)
  const week = own.find((l) => l.kind === 'weekly')
  const sess = own.find((l) => l.kind === 'session') || own.find((l) => l.kind !== 'weekly')
  const lowest = (list) => list.reduce((m, l) => (!m || l.pct < m.pct ? l : m), null)
  const plan = lowest(own), model = lowest(limits.filter((l) => l.model))
  const tight = model && (!plan || (model.pct < 30 && model.pct < plan.pct)) ? model : plan
  return { groups, act, auto, p, limits, week, sess, tight, ring: tight, name }
}

// Why there's no figure to show, in a word: macOS's Allow, a sign-in, a reading on its way.
const noFigure = (p) => (p.allow ? t('allow') : lapsed(p) || p.status === 'auth_required' || p.notSetUp || p.signedIn === false ? t('sign in') : p.status === 'pending' ? '…' : t('no data'))
// Usage said in full, a line each (the chip's and the row's hover, the chip's name): where new
// agents start, the limit that matters most and when it starts again, then every other limit, or
// why there are none.
function usageSays(u) {
  const who = !u.act ? t('{name} usage', { name: u.name })
    : u.auto ? t('Auto: new {agent} agents start on the account with the most left, now {name}', { agent: u.name, name: accountName(u.act) })
      : t('New {agent} agents start on {name}', { agent: u.name, name: accountName(u.act) })
  if (u.off) return [who, t('Plan usage is off · click to see it or turn it on')]
  const { p, tight } = u
  if (!p) return [who, t('No reading of its usage yet')]
  if (!p.usable) return [who, `${t('Usage: {state}', { state: statusText(p) })}${p.error ? ` (${p.error})` : ''}`]
  if (!tight) return [who, t('Its plan says nothing about limits')]
  return [who, limitWords(tight), ...u.limits.filter((l) => l !== tight).map(limitWords)]
}
// What a click does, for the end of the hover.
const clickSays = (menu) => (menu ? t('Click to switch account or see each limit') : t('Click for usage details'))
const Ring = ({ u }) => (u.off || !u.p ? <Icon name="gauge" size={14} /> : <span className={`mini-ring r-${level(u.ring?.pct)}`} style={{ '--p': u.ring?.pct ?? 0 }} />)
// A limit's figure, colored once it's low (styles.css keeps the colors readable on the chip).
const Pct = ({ l }) => <b className={level(l.pct) === 'good' ? 'u-pct' : `u-pct t-${level(l.pct)}`}>{l.pct}%</b>
// The 5-hour window's and the week's figures, and a model's own once it's the one running out, or
// why there are none.
function Figs({ u }) {
  const { p, sess, week, tight } = u
  if (u.off) return <span className="muted">{t('usage off')}</span>
  if (!p) return null
  if (!p.usable) return <span className="muted">{noFigure(p)}</span>
  const figs = [sess, week, tight?.model && tight].filter(Boolean)
  if (!figs.length) return <span className="muted">{t('no data')}</span>
  return (
    <span className="status-row-figs">
      {figs.map((l, i) => <span key={i} className={i ? 'chip-sep' : undefined}><Pct l={l} /><small> {l.short}</small></span>)}
    </span>
  )
}

// Usage's row: who new agents start with and how much is left. With accounts listed it opens the
// account menu (switch, Add another account, Usage details); otherwise Today's Usage card.
function UsageRow({ u, onClick }) {
  const menu = u.groups.length > 0
  return (
    <button type="button" className="status-row usage-chip" onClick={onClick} aria-haspopup={menu ? 'menu' : undefined} title={[...usageSays(u), clickSays(menu)].join('\n')}>
      <Ring u={u} />
      <span className="status-row-text">
        <b className="usage-name">{u.name}</b>
        {u.act && <span className="usage-new">{t('new agents start on')}</span>}
        {u.act && <AcctDot a={u.act} />}
        {u.act && <b className="usage-acct">{accountName(u.act)}</b>}
        {u.auto && <span className="best-tag" title={t('Auto starts new agents here now: it has the most left')}>{t('auto')}</span>}
        <Figs u={u} />
      </span>
      <Icon name="chevron" size={13} className="status-go" />
    </button>
  )
}

// The bar's one figure: what's left of the limit that matters most (tight), colored as it runs low,
// and which limit it is (pin-long, the first to go when the bar has no room). Or why there's none,
// which stays: it's what the chip has to say.
function Tight({ u }) {
  const { p, tight } = u
  if (u.off) return <span className="muted">{t('usage off')}</span>
  if (!p) return <span className="muted">{t('no data')}</span>
  if (!p.usable) return <span className="muted">{noFigure(p)}</span>
  if (!tight) return <span className="muted">{t('no data')}</span>
  return <span className="usage-tight"><Pct l={tight} /><small className="pin-long">{tight.short}</small></span>
}

// Usage pinned to the bar, kept small: the provider's mark, the account new agents start on and the
// one figure that matters most (Tight). Every limit, when each resets and the other accounts are in
// the menu it opens (or Today's Usage card, with one account) and on hover. As the bar gives way
// (useFit in App.jsx) the account's name goes first (pin-word, its color stays), then which limit
// the figure is (pin-long).
export function UsageChip({ quota, primary, onUsage, onAddAccount }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const u = usageOf(quota, primary)
  if (!u) return null
  const menu = u.groups.length > 0
  const shown = menu ? listed(u.groups, primary) : []
  const says = usageSays(u)
  return (
    <div className="acct-wrap" ref={wrap}>
      <button type="button" className="top-chip usage-chip usage-pin" onClick={menu ? () => setOpen((o) => !o) : onUsage} aria-haspopup={menu ? 'menu' : undefined} aria-expanded={menu ? open : undefined}
        title={[...says, clickSays(menu)].join('\n')} aria-label={says.join('. ')}>
        {u.off ? <Icon name="gauge" size={14} /> : <AgentIcon kind={primary} size={16} name={u.name} />}
        {u.act && <AcctDot a={u.act} />}
        {u.act && <b className="usage-acct pin-word">{accountName(u.act)}</b>}
        <Tight u={u} />
        {menu && <Icon name="down" size={11} className="usage-caret" />}
      </button>
      {open && (
        <AccountMenu groups={shown.length ? shown : u.groups.slice(0, 1)} anchor={wrap} className="top" off={!!quota?.off} onClose={() => setOpen(false)} onPick={(kind, id) => setDefault(u.groups, kind, id)}
          onAdd={onAddAccount} extra={[{ icon: 'gauge', label: t('Usage details'), run: onUsage }]} />
      )}
    </div>
  )
}

// Usage at a glance, as the chip is with the least room: the account's color and the one figure,
// or why there's none. The phone's More has it on Usage's row.
export function UsageGlance({ quota, primary }) {
  const u = usageOf(quota, primary)
  if (!u) return null
  return <span className="usage-glance">{u.act && <AcctDot a={u.act} />}<Tight u={u} /></span>
}

// Usage on a phone, at the top of its Usage view: the phone's top bar keeps to what needs you now,
// and a phone has no hover, so what the chip shows and says on hover is said here. Where new agents
// start (the provider's mark, the account in its color, Auto's pick), the one figure, that limit in
// words with when it starts again, then every other limit, or why there are none. With accounts
// listed it opens the chip's account menu under it, in the page (each account's windows and its
// models' limits, where new agents start, Sign in, Add another account). Plan usage off says so;
// Usage's card under it says why, with Turn on.
export function PhoneUsage() {
  const { data: quota } = usePoll('/quota', 5 * 60 * 1000)
  const [primary] = useShared('cc-primary', 'claude')
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const u = usageOf(quota, primary)
  if (!u) return null
  const menu = u.groups.length > 0
  const shown = menu ? listed(u.groups, primary) : []
  const says = u.off ? [] : usageSays(u).slice(1)
  const head = (
    <>
      {u.off ? <Icon name="gauge" size={18} /> : <AgentIcon kind={primary} size={24} name={u.name} />}
      <span className="usage-now-who">
        <small>{u.act ? t('New {agent} agents start on', { agent: u.name }) : t('{name} usage', { name: u.name })}</small>
        {u.act && (
          <span className="usage-now-acct">
            <AcctDot a={u.act} /><b>{accountName(u.act)}</b>
            {u.auto && <span className="best-tag">{t('auto')}</span>}
          </span>
        )}
        {menu && <span className="usage-now-go">{t('Switch account or see each limit')}</span>}
      </span>
      <Tight u={u} />
    </>
  )
  return (
    <section className="usage-now" ref={wrap} aria-label={t('Usage now')}>
      {menu
        ? <button type="button" className="usage-now-head" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>{head}<Icon name="down" size={13} className="caret" /></button>
        : <div className="usage-now-head">{head}</div>}
      {u.auto && <p className="usage-now-says">{t('Auto starts new agents here now: it has the most left')}</p>}
      {says.length > 0 && <ul className="usage-now-says">{says.map((line) => <li key={line}>{line}</li>)}</ul>}
      {open && (
        <AccountMenu groups={shown.length ? shown : u.groups.slice(0, 1)} anchor={wrap} className="inline" off={!!quota?.off} onClose={() => setOpen(false)} onPick={(kind, id) => setDefault(u.groups, kind, id)}
          onAdd={addAccount} />
      )}
    </section>
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
// The weather, and when there's none to show, why (none): no city picked yet (the Weather card a
// click opens has the city picker), or it couldn't be fetched. Said in the bar and in Status alike,
// so a pinned weather is never an empty space; until the first answer there's nothing to say.
function useWeather() {
  const { data, error, errorCode } = usePoll('/weather', 15 * 60 * 1000)
  const [unit, setUnit] = useShared('cc-unit', 'f')
  const c = unit === 'c'
  const temp = data?.current ? Math.round(c ? (data.current.temp - 32) * 5 / 9 : data.current.temp) : null
  const none = temp != null || !error ? null
    : errorCode === 'noLocation' ? { word: t('Pick your city'), why: t('No city picked yet: click to pick one for the weather') }
      : { word: '—', why: t("The weather couldn't be fetched: {why}", { why: error }) }
  return { data, c, temp, setUnit, none }
}
// The clock, and the weather with °F or °C picked as two plain buttons, each with its pin at the
// end of its line, as the rows under them have.
function Now({ onWeather }) {
  const now = useNow()
  const { data, c, temp, setUnit, none } = useWeather()
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
      {none && (
        <>
          <div className="status-wx">
            <button type="button" className="status-wx-open" onClick={onWeather} title={none.why}>
              <Icon name="cloud" size={16} /><span className="muted small">{none.word === '—' ? none.why : none.word}</span>
            </button>
          </div>
          <PinButton id="weather" />
        </>
      )}
    </div>
  )
}
// The weather and the clock pinned to the bar. The sky's icon and the temperature, with the place
// and the sky on hover, and the forecast (Today's Weather card) at a click, as from Status. With
// none to show it says why: its word stays while the chip is in the bar (it's what the chip has to
// say, not a label to drop), and the reason in full is on hover. The time, with the date on hover.
export function WeatherChip({ onClick }) {
  const { data, c, temp, none } = useWeather()
  if (none) return (
    <button type="button" className="top-chip wx-chip" onClick={onClick} title={none.why} aria-label={none.why}>
      <Icon name="cloud" size={14} /><span>{none.word}</span>
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
        {u?.p && !u.off ? <span className={`mini-ring r-${level(u.ring?.pct)}`} style={{ '--p': u.ring?.pct ?? 0 }} /> : <Icon name="gauge" size={14} />}
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
