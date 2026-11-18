// On the computer being seen (Remote Screen and Preview, a Beta Feature): that it's being seen,
// always, with Stop; Allow or Deny for each session when Ask Here First is on; and afterwards who
// looked (or was turned away), when and for how long, until you've seen it.
//   Badge       the desktop app's small window over everything while anyone sees this screen or
//               asks to (?remote=badge, desktop/remote.js)
//   RemoteHere  the same in Bridge AI's own window here (a browser here too), and the notice after
//   Sessions    Settings' record of every session and every one turned away (Machines.jsx shows it)
import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { onThisComputer } from '../../api.js'
import { useTrial } from '../../trials.js'
import { t, locale } from '../../i18n/index.js'
import { useRemote, remoteDo } from './remote.js'
import { onFor } from '../Machines.jsx'
import './remote.css'

// Who: a device, and the one it was for when it came through another of your computers.
export const whoOf = (s) => (s.for ? t('{name} (for {device})', { name: s.by?.name || t('A device'), device: s.for }) : s.by?.name || t('A device'))
const since = (iso) => Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
const timeOf = (iso) => new Date(iso).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const clockOf = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
const watching = (list) => (list || []).filter((s) => s.kind === 'screen')
const left = (iso) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000))
// Turned away: a lockout, a no here, nobody answering, a wrong password, a device not allowed.
const REFUSED = new Set(['locked', 'denied', 'unanswered', 'password', 'device'])
export const refused = (e) => REFUSED.has(e?.end) && !e.source
function refusedText(e, when = timeOf(e.ended || e.started)) {
  const who = whoOf(e)
  if (e.end === 'locked') return t('{who} was locked out for {n} minutes after {tries} wrong passwords, at {when}.', { who, n: Math.max(1, Math.round((new Date(e.until).getTime() - new Date(e.ended).getTime()) / 60000)), tries: e.tries || 5, when })
  if (e.end === 'denied') return t('{who} asked to see this screen at {when}, and was told no here.', { who, when })
  if (e.end === 'unanswered') return t('{who} asked to see this screen at {when}. Nobody answered, so it wasn\'t allowed.', { who, when })
  if (e.end === 'password') return e.tries === 1 ? t('{who} typed a wrong password at {when}.', { who, when }) : t('{who} typed {n} wrong passwords at {when}.', { who, n: e.tries || 2, when })
  return t('{who} tried to connect at {when}, but isn\'t allowed to.', { who, when })
}
const askText = (a) => (a.control ? t('{who} asks to see and control this screen', { who: whoOf(a) }) : t('{who} asks to see this screen', { who: whoOf(a) }))

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
          <span>{s.controlled ? t('{who} is controlling this screen ({source}), for {time} now.', { who: whoOf(s), source: s.source?.name || t('a screen'), time: onFor(since(s.started)) }) : t('{who} is viewing this screen ({source}), for {time} now.', { who: whoOf(s), source: s.source?.name || t('a screen'), time: onFor(since(s.started)) })}</span>
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

// Settings' record: who connected to this computer, from which device, at what, when, for how long,
// whether they controlled it and how it came; and each one turned away, and why.
export function Sessions({ log, here }) {
  if (!log?.length) return <p className="muted small">{t('Nobody has viewed this computer\'s screen yet.')}</p>
  const how = (e) => (e.end === 'here' ? t('stopped here') : e.end === 'device' ? t('stopped: not allowed any more') : e.end === 'error' || e.end === 'lost' ? t('ended with an error') : null)
  return (
    <ul className="rs-log" aria-label={t('Screen Activity')}>
      {log.slice(0, 30).map((e) => (refused(e) ? (
        <li key={e.id} className="rs-log-refused">
          <Icon name={e.end === 'locked' ? 'lock' : 'ban'} size={12} />
          <span className="rs-log-who"><b>{whoOf(e)}</b> <span className="muted">{e.by?.kind === 'computer' ? t('computer') : t('phone')}</span></span>
          <span className="rs-log-what">{refusedText(e, clockOf(e.ended || e.started))}</span>
          <span className="rs-log-when muted">{timeOf(e.started)}</span>
        </li>
      ) : (
        <li key={e.id}>
          <Icon name={e.kind === 'page' ? 'play' : e.controlled ? 'keyboard' : 'eye'} size={12} />
          <span className="rs-log-who"><b>{whoOf(e)}</b> <span className="muted">{e.by?.kind === 'computer' ? t('computer') : t('phone')}</span></span>
          <span className="rs-log-what">{e.kind === 'page' ? t('the app on port {port}', { port: e.source?.port }) : [e.source?.name || t('a screen'), ...(e.also || [])].join(', ')} · {e.kind === 'page' ? t('used') : e.controlled ? t('controlled') : e.control ? t('could control, only viewed') : t('viewed only')}</span>
          <span className="rs-log-when muted">{timeOf(e.started)} · {e.ended ? onFor(e.seconds || 1) : t('now')}{e.via ? ` · ${e.via === 'p2p' ? t('direct') : t('through the relay')}` : ''}{how(e) ? ` · ${how(e)}` : ''}{e.error ? ` · ${e.error}` : ''}</span>
        </li>
      )))}
      {here && log.some((e) => !e.seen) && <li className="rs-log-seen"><button type="button" className="ghost-btn small" onClick={() => remoteDo('', '/seen').then(() => window.dispatchEvent(new Event('bridge-remote')), () => {})}>{t('Mark all as seen')}</button></li>}
    </ul>
  )
}
