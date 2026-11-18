// On the computer being seen (Remote Screen and Preview, a Beta Feature): that it's being seen,
// always, with Stop; Allow or Deny for each session when Ask Here First is on; and afterwards who
// looked (or was turned away), when and for how long, until you've seen it.
//   Badge       the desktop app's small window over everything while anyone sees this screen or
//               asks to (?remote=badge, desktop/remote.js)
//   RemoteHere  the same in Bridge AI's own window here (a browser here too), and the notice after
//   Sessions    Settings' record of every session and every one turned away (Machines.jsx shows it)
// And on every other window, on a computer or a phone (ScreenLive): a card while one of your screens
// is being viewed, or asked to be, with Stop and Block This Device (server/screentell.js).
import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { BASE, onThisComputer, screensLive } from '../../api.js'
import { useTrial } from '../../trials.js'
import { t, locale } from '../../i18n/index.js'
import { useRemote, remoteDo, viewing } from './remote.js'
import { onFor } from '../Machines.jsx'
import { plainName } from '../../../shared/remote.js'
import './remote.css'

// Who: a device, and the one it was for when it came through another of your computers. Names as
// they're shown nowhere else either: nothing in them that turns text around or hides.
const nameOf = (s) => plainName(s?.by?.name) || t('A device')
export const whoOf = (s) => (s.for ? t('{name} (for {device})', { name: nameOf(s), device: plainName(s.for) || t('A device') }) : nameOf(s))
// In an ask, what kind of device too, and how it came: straight here, or through which computer.
const askerOf = (a) => (a.for ? t('{device} (a phone, through {name})', { device: plainName(a.for) || t('A device'), name: nameOf(a) })
  : a.by?.kind === 'computer' ? t('{name} (a computer, connected directly)', { name: nameOf(a) }) : t('{name} (a phone, connected directly)', { name: nameOf(a) }))
// The same, said from the device's side, with its kind and how it came: "iPhone (phone) · through Laptop".
const kindWord = (k) => (k === 'computer' ? t('computer') : t('phone'))
const fromWho = (s) => (s.for ? t('{device} ({kind}) · through {name}', { device: plainName(s.for) || t('A device'), kind: kindWord(s.forKind), name: nameOf(s) }) : t('{name} ({kind})', { name: nameOf(s), kind: kindWord(s.by?.kind) }))
// The one Block This Device unticks: the device itself, on the computer it came through when it did.
const blockText = (x) => (x.for ? t('{device} can\'t connect through {name} any more. It\'s let back in at {name} itself.', { device: plainName(x.for), name: nameOf(x) }) : t('{who} can\'t connect to {computer} any more. It\'s let back in at {computer} itself.', { who: nameOf(x), computer: plainName(x.computer) }))
const since = (iso) => Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
const timeOf = (iso) => new Date(iso).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const clockOf = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
const watching = (list) => (list || []).filter((s) => s.kind === 'screen')
const left = (iso) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000))
// Turned away: a lockout, a no here, nobody answering, a wrong password, a device not allowed, and
// an ask stopped (or its device blocked) from another of your devices.
const REFUSED = new Set(['locked', 'denied', 'unanswered', 'password', 'device', 'stopped', 'blocked'])
export const refused = (e) => REFUSED.has(e?.end) && !e.source
function refusedText(e, when = timeOf(e.ended || e.started)) {
  const who = whoOf(e)
  if (e.end === 'locked') return t('{who} was locked out for {n} minutes after {tries} wrong passwords, at {when}.', { who, n: Math.max(1, Math.round((new Date(e.until).getTime() - new Date(e.ended).getTime()) / 60000)), tries: e.tries || 5, when })
  if (e.end === 'denied') return t('{who} asked to see this screen at {when}, and was told no here.', { who, when })
  if (e.end === 'unanswered') return t('{who} asked to see this screen at {when}. Nobody answered, so it wasn\'t allowed.', { who, when })
  if (e.end === 'password') return e.tries === 1 ? t('{who} typed a wrong password at {when}.', { who, when }) : t('{who} typed {n} wrong passwords at {when}.', { who, n: e.tries || 2, when })
  if (e.end === 'stopped') return t('{who} asked to see this screen at {when}, and it was stopped from {device}.', { who, when, device: e.stoppedBy || t('another of your devices') })
  if (e.end === 'blocked') return t('{who} asked to see this screen at {when}, and was blocked from {device}.', { who, when, device: e.stoppedBy || t('another of your devices') })
  return t('{who} tried to connect at {when}, but isn\'t allowed to.', { who, when })
}
const askText = (a) => (a.port ? t('{who} asks to see the app on port {port}', { who: askerOf(a), port: a.port }) : a.control ? t('{who} asks to see and control this screen', { who: askerOf(a) }) : t('{who} asks to see this screen', { who: askerOf(a) }))
// The same turned away again soon after, counted on one line.
const again = (e) => (e.count > 2 ? ` ${t('(and {n} times before)', { n: e.count - 1 })}` : e.count === 2 ? ` ${t('(and once before)')}` : '')

function useTick(ms, on) {
  const [, set] = useState(0)
  useEffect(() => { if (!on) return; const tm = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(tm) }, [ms, on])
}

export function Badge() {
  const { data, refresh } = useRemote('', 1000)
  const list = watching(data?.sessions)
  const asks = data?.asks || []
  useTick(1000, list.length > 0 || asks.length > 0)
  const [err, setErr] = useState(null)
  useEffect(() => { document.documentElement.classList.add('is-badge'); document.title = 'Bridge AI is being viewed' }, [])
  const act = async (path, body) => { setErr(null); try { await remoteDo('', path, body); refresh() } catch (e) { setErr(e.message) } }
  // Ask Here First: the first ask, Allow or Deny, before anything else.
  if (asks.length) {
    const a = asks[0]
    return (
      <main className="rs-badge ask" role="alertdialog" aria-label={askText(a)}>
        <span className="rs-dot ask" aria-hidden="true" />
        <span className="rs-badge-text">
          <b>{askText(a)}</b>
          <small>{err || t('No answer in {n} seconds is a no.', { n: left(a.until) })}</small>
        </span>
        <button type="button" className="btn small" onClick={() => act(`/asks/${encodeURIComponent(a.id)}`, { allow: false })}>{t('Deny')}</button>
        <button type="button" className="btn small primary" onClick={() => act(`/asks/${encodeURIComponent(a.id)}`, { allow: true })}>{t('Allow')}</button>
      </main>
    )
  }
  if (!list.length) return <main className="rs-badge"><span className="rs-dot" /> <span>{t('Nobody is viewing this screen.')}</span></main>
  const s = list[0]
  return (
    <main className="rs-badge" role="status">
      <span className="rs-dot on" aria-hidden="true" />
      <span className="rs-badge-text">
        <b>{list.length === 1 ? (s.controlled ? t('{who} is controlling this screen', { who: whoOf(s) }) : t('{who} is viewing this screen', { who: whoOf(s) })) : t('{n} of your devices are viewing this screen', { n: list.length })}</b>
        <small>{err || onFor(since(s.started))}</small>
      </span>
      <button type="button" className="btn small danger" onClick={() => act('/stop')}>{t('Stop')}</button>
    </main>
  )
}

export function RemoteHere() {
  const on = useTrial('remote-screen') && onThisComputer()
  const { data, refresh } = useRemote('', 3000, on)
  const list = watching(data?.sessions)
  const asks = data?.asks || []
  useTick(1000, list.length > 0 || asks.length > 0)
  const [err, setErr] = useState(null)
  if (!on || !data) return null
  const unseen = data.unseen || []
  if (!list.length && !unseen.length && !asks.length) return null
  const act = async (path, body) => { setErr(null); try { await remoteDo('', path, body); refresh() } catch (e) { setErr(e.message) } }
  const settings = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'machines' } }))
  const notifications = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'notifications' } }))
  const u = unseen[0]
  return (
    <div className="ask-banner rs-here" role="status">
      {asks.map((a) => (
        <div key={a.id} className="ask-row rs-ask">
          <Icon name="screen" size={14} />
          <span>{askText(a)} <span className="muted">{t('No answer in {n} seconds is a no.', { n: left(a.until) })}</span></span>
          <span className="ask-btns">
            <button type="button" className="btn small" onClick={() => act(`/asks/${encodeURIComponent(a.id)}`, { allow: false })}>{t('Deny')}</button>
            <button type="button" className="btn small primary" onClick={() => act(`/asks/${encodeURIComponent(a.id)}`, { allow: true })}>{t('Allow')}</button>
          </span>
        </div>
      ))}
      {list.map((s) => (
        <div key={s.id} className="ask-row">
          <Icon name="screen" size={14} />
          <span>{s.controlled ? t('{who} is controlling this screen ({source}), for {time} now.', { who: whoOf(s), source: s.source?.name || t('a screen'), time: onFor(since(s.started)) }) : t('{who} is viewing this screen ({source}), for {time} now.', { who: whoOf(s), source: s.source?.name || t('a screen'), time: onFor(since(s.started)) })}
            {untold(s.told) && <span className="rs-untold"> {t('Your other devices weren\'t told: no notification channel is set up.')} <button type="button" className="link-btn" onClick={notifications}>{t('Set Up Notifications')}</button></span>}</span>
          <span className="ask-btns"><button type="button" className="btn small danger" onClick={() => act(`/sessions/${encodeURIComponent(s.id)}/stop`)}>{t('Stop')}</button></span>
        </div>
      ))}
      {!list.length && !asks.length && u && (
        <div className="ask-row">
          <Icon name={refused(u) ? 'ban' : 'eye'} size={14} />
          <span>{refused(u) ? refusedText(u) : u.controlled ? t('{who} controlled this screen for {time} at {when}.', { who: whoOf(u), time: onFor(u.seconds || 1), when: timeOf(u.started) }) : t('{who} viewed this screen for {time} at {when}.', { who: whoOf(u), time: onFor(u.seconds || 1), when: timeOf(u.started) })}
            {unseen.length > 1 && <span className="muted"> {unseen.length === 2 ? t('(and once before)') : t('(and {n} times before)', { n: unseen.length - 1 })}</span>}</span>
          <span className="ask-btns">
            <button type="button" className="btn small" onClick={settings}>{t('See all')}</button>
            <button type="button" className="btn small primary" onClick={() => act('/seen')}>{t('Got it')}</button>
          </span>
        </div>
      )}
      {err && <p className="error-text small">{err}</p>}
    </div>
  )
}

// Your other devices told of it (remote.js announce): for each notification, how many it reached,
// here and through each of your computers; or that none went out, and why.
const reached = (x) => (Number(x?.sent) || 0) + (x?.computers || []).reduce((n, c) => n + (Number(c.sent) || 0), 0)
// Every notification of a session done, and none reached anyone (the notice says so: never silent).
const untold = (told) => Array.isArray(told) && told.length > 0 && told.every((x) => !x.off && ('sent' in x || x.error) && !reached(x))
function Told({ told }) {
  if (!Array.isArray(told) || !told.length) return null
  const what = { view: t('Viewing'), control: t('Control'), ask: t('The ask') }
  return told.map((x, i) => {
    const away = (x.computers || []).filter((c) => c.error)
    const text = x.off ? t('No notification: they\'re off for screen sharing on this computer.')
      : !('sent' in x) && !x.error ? t('Telling your other devices…')
        : reached(x) ? (reached(x) === 1 ? t('Notified 1 of your devices.') : t('Notified {n} of your devices.', { n: reached(x) }))
          : t('No notification went out: no notification channel is set up.')
    const off = away.map((c) => (c.error === 'offline' ? t('{name} was offline.', { name: c.name }) : c.error === 'old' ? t('{name} needs a newer Bridge AI to pass it on.', { name: c.name }) : t('{name} couldn\'t be told.', { name: c.name }))).join(' ')
    return <span key={i} className={`rs-log-told${!x.off && 'sent' in x && !reached(x) ? ' none' : ''}`}><Icon name={reached(x) ? 'bell' : 'alert'} size={11} /> {what[x.what] || ''}: {text}{off ? ` ${off}` : ''}</span>
  })
}

// Every other window, on a computer or a phone: who's viewing one of your screens now, here or on
// another of your computers, or asking to, from the event feed (api.js screensLive), with Stop (Deny
// for an ask) and Block This Device, each carried out by the computer being viewed. Not on that
// computer's own windows (RemoteHere says it there), nor for a session this window is viewing.
export function ScreenLive() {
  const [list, setList] = useState(() => screensLive.get())
  const [, seen] = useState(0)
  useEffect(() => screensLive.subscribe(setList), [])
  useEffect(() => { const f = () => seen((n) => n + 1); window.addEventListener('bridge-viewing', f); return () => window.removeEventListener('bridge-viewing', f) }, [])
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null) // { text, bad }
  const here = onThisComputer()
  const shown = list.filter((x) => !viewing.has(x.id) && !(here && x.machine == null) && !(x.ask && x.until && new Date(x.until).getTime() < Date.now()))
  useTick(1000, shown.length > 0)
  useEffect(() => { if (!msg || msg.bad) return; const tm = setTimeout(() => setMsg(null), 6000); return () => clearTimeout(tm) }, [msg])
  if (!shown.length && !msg) return null
  const act = async (x, block) => {
    setBusy(`${x.machine}:${x.id}`)
    setMsg(null)
    try {
      await remoteDo(BASE, '/live/end', { machine: x.machine, id: x.id, block })
      setMsg({ text: block ? blockText(x) : x.ask ? t('Denied.') : t('Stopped.') })
    } catch (e) { setMsg({ text: e.message, bad: true }) } finally { setBusy(null) }
  }
  return (
    <div className="ask-banner rs-live" role="status">
      {shown.map((x) => {
        const k = `${x.machine}:${x.id}`
        const who = fromWho(x)
        const computer = plainName(x.computer)
        const text = x.ask ? (x.control ? t('{who} asks to see and control {computer}\'s screen', { who, computer }) : t('{who} asks to see {computer}\'s screen', { who, computer }))
          : x.controlled ? t('{computer} is being controlled from {who}', { computer, who }) : t('{computer}\'s screen is being viewed from {who}', { computer, who })
        return (
          <div key={k} className="ask-row">
            <i className="rs-dot on" aria-hidden="true" />
            <span><b>{text}</b> <span className="muted">· {x.ask ? t('{n} seconds left', { n: left(x.until) }) : onFor(since(x.started))}</span></span>
            <span className="ask-btns">
              <button type="button" className="btn small danger" disabled={busy === k} onClick={() => act(x, false)}>{x.ask ? t('Deny') : t('Stop')}</button>
              <button type="button" className="btn small" disabled={busy === k} onClick={() => act(x, true)} title={x.for ? t('{device} can\'t connect through {name} until it\'s let back in at {name} itself.', { device: plainName(x.for), name: nameOf(x) }) : t('{who} can\'t connect to {computer} until it\'s let back in at {computer} itself.', { who: nameOf(x), computer })}><Icon name="ban" size={12} /> {t('Block This Device')}</button>
            </span>
          </div>
        )
      })}
      {msg && <p className={`small ${msg.bad ? 'error-text' : 'muted'}`} role={msg.bad ? 'alert' : undefined}>{msg.text}</p>}
    </div>
  )
}

// Settings' record: who connected to this computer, from which device, at what, when, for how long,
// whether they controlled it and how it came; and each one turned away, and why.
export function Sessions({ log, here }) {
  if (!log?.length) return <p className="muted small">{t('Nobody has viewed this computer\'s screen yet.')}</p>
  const how = (e) => (e.end === 'here' ? t('stopped here') : e.end === 'device' ? t('stopped: not allowed any more')
    : e.end === 'stopped' ? t('stopped from {device}', { device: e.stoppedBy || t('another of your devices') }) : e.end === 'blocked' ? t('blocked from {device}', { device: e.stoppedBy || t('another of your devices') })
      : e.end === 'error' || e.end === 'lost' ? t('ended with an error') : null)
  // The sessions, and apart from them a few of the latest turned away (each line counting repeats).
  const shown = [...log.filter((e) => !refused(e)).slice(0, 30), ...log.filter(refused).slice(0, 10)].sort((a, b) => log.indexOf(a) - log.indexOf(b))
  return (
    <ul className="rs-log" aria-label={t('Screen Activity')}>
      {shown.map((e) => (refused(e) ? (
        <li key={e.id} className="rs-log-refused">
          <Icon name={e.end === 'locked' ? 'lock' : 'ban'} size={12} />
          <span className="rs-log-who"><b>{whoOf(e)}</b> <span className="muted">{e.by?.kind === 'computer' ? t('computer') : t('phone')}</span></span>
          <span className="rs-log-what">{refusedText(e, clockOf(e.ended || e.started))}{again(e)}</span>
          <span className="rs-log-when muted">{timeOf(e.started)}</span>
          <Told told={e.told} />
        </li>
      ) : (
        <li key={e.id}>
          <Icon name={e.kind === 'page' ? 'play' : e.controlled ? 'keyboard' : 'eye'} size={12} />
          <span className="rs-log-who"><b>{whoOf(e)}</b> <span className="muted">{e.by?.kind === 'computer' ? t('computer') : t('phone')}</span></span>
          <span className="rs-log-what">{e.kind === 'page' ? t('the app on port {port}', { port: e.source?.port }) : [e.source?.name || t('a screen'), ...(e.also || [])].join(', ')} · {e.kind === 'page' ? t('used') : e.controlled ? t('controlled') : e.control ? t('could control, only viewed') : t('viewed only')}</span>
          <span className="rs-log-when muted">{timeOf(e.started)} · {e.ended ? onFor(e.seconds || 1) : t('now')}{e.via ? ` · ${e.via === 'p2p' ? t('direct') : t('through the relay')}` : ''}{how(e) ? ` · ${how(e)}` : ''}{e.error ? ` · ${e.error}` : ''}</span>
          <Told told={e.told} />
        </li>
      )))}
      {here && log.some((e) => !e.seen) && <li className="rs-log-seen"><button type="button" className="ghost-btn small" onClick={() => remoteDo('', '/seen').then(() => window.dispatchEvent(new Event('bridge-remote')), () => {})}>{t('Mark all as seen')}</button></li>}
    </ul>
  )
}
