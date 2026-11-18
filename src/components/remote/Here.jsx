// On the computer being seen (Remote Screen and Preview, a Beta Feature): that it's being seen,
// always, with Stop, and afterwards who looked, when and for how long, until you've seen it.
//   Badge       the desktop app's small window over everything while anyone sees this screen
//               (?remote=badge, desktop/remote.js)
//   RemoteHere  the same in Bridge AI's own window here (a browser here too), and the notice after
//   Sessions    Settings' record of every session (Machines.jsx shows it)
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
const watching = (list) => (list || []).filter((s) => s.kind === 'screen')

function useTick(ms, on) {
  const [, set] = useState(0)
  useEffect(() => { if (!on) return; const tm = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(tm) }, [ms, on])
}

export function Badge() {
  const { data } = useRemote('', 1500)
  const list = watching(data?.sessions)
  useTick(1000, list.length > 0)
  const [err, setErr] = useState(null)
  useEffect(() => { document.documentElement.classList.add('is-badge'); document.title = 'Bridge AI is being viewed' }, [])
  const stop = async () => { setErr(null); try { await remoteDo('', '/stop') } catch (e) { setErr(e.message) } }
  if (!list.length) return <main className="rs-badge"><span className="rs-dot" /> <span>{t('Nobody is viewing this screen.')}</span></main>
  const s = list[0]
  return (
    <main className="rs-badge" role="status">
      <span className="rs-dot on" aria-hidden="true" />
      <span className="rs-badge-text">
        <b>{list.length === 1 ? (s.controlled ? t('{who} is controlling this screen', { who: whoOf(s) }) : t('{who} is viewing this screen', { who: whoOf(s) })) : t('{n} of your devices are viewing this screen', { n: list.length })}</b>
        <small>{err || onFor(since(s.started))}</small>
      </span>
      <button type="button" className="btn small danger" onClick={stop}>{t('Stop')}</button>
    </main>
  )
}

export function RemoteHere() {
  const on = useTrial('remote-screen') && onThisComputer()
  const { data, refresh } = useRemote('', 3000, on)
  const list = watching(data?.sessions)
  useTick(1000, list.length > 0)
  const [err, setErr] = useState(null)
  if (!on || !data) return null
  const unseen = data.unseen || []
  if (!list.length && !unseen.length) return null
  const act = async (path) => { setErr(null); try { await remoteDo('', path); refresh() } catch (e) { setErr(e.message) } }
  const settings = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'machines' } }))
  return (
    <div className="ask-banner rs-here" role="status">
      {list.map((s) => (
        <div key={s.id} className="ask-row">
          <Icon name="screen" size={14} />
          <span>{s.controlled ? t('{who} is controlling this screen ({source}), for {time} now.', { who: whoOf(s), source: s.source?.name || t('a screen'), time: onFor(since(s.started)) }) : t('{who} is viewing this screen ({source}), for {time} now.', { who: whoOf(s), source: s.source?.name || t('a screen'), time: onFor(since(s.started)) })}</span>
          <span className="ask-btns"><button type="button" className="btn small danger" onClick={() => act(`/sessions/${encodeURIComponent(s.id)}/stop`)}>{t('Stop')}</button></span>
        </div>
      ))}
      {!list.length && unseen.length > 0 && (
        <div className="ask-row">
          <Icon name="eye" size={14} />
          <span>{unseen[0].controlled ? t('{who} controlled this screen for {time} at {when}.', { who: whoOf(unseen[0]), time: onFor(unseen[0].seconds || 1), when: timeOf(unseen[0].started) }) : t('{who} viewed this screen for {time} at {when}.', { who: whoOf(unseen[0]), time: onFor(unseen[0].seconds || 1), when: timeOf(unseen[0].started) })}
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

// Settings' record: who looked at this computer, from which device, at what, when, for how long,
// whether they controlled it, and how it came.
export function Sessions({ log, here }) {
  if (!log?.length) return <p className="muted small">{t('Nobody has viewed this computer\'s screen yet.')}</p>
  return (
    <ul className="rs-log" aria-label={t('Screen Sessions')}>
      {log.slice(0, 30).map((e) => (
        <li key={e.id}>
          <Icon name={e.kind === 'page' ? 'play' : e.controlled ? 'keyboard' : 'eye'} size={12} />
          <span className="rs-log-who"><b>{whoOf(e)}</b> <span className="muted">{e.by?.kind === 'computer' ? t('computer') : t('phone')}</span></span>
          <span className="rs-log-what">{e.kind === 'page' ? t('the app on port {port}', { port: e.source?.port }) : e.source?.name || t('a screen')}{e.controlled ? ` · ${t('controlled')}` : ''}</span>
          <span className="rs-log-when muted">{timeOf(e.started)} · {e.ended ? onFor(e.seconds || 1) : t('now')}{e.via ? ` · ${e.via === 'p2p' ? t('direct') : t('through the relay')}` : ''}{e.error ? ` · ${e.error}` : ''}</span>
        </li>
      ))}
      {here && log.some((e) => !e.seen) && <li className="rs-log-seen"><button type="button" className="ghost-btn small" onClick={() => remoteDo('', '/seen').then(() => window.dispatchEvent(new Event('bridge-remote')), () => {})}>{t('Mark all as seen')}</button></li>}
    </ul>
  )
}
