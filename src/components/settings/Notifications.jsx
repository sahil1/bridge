import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, refetch, usePoll, relayComputers } from '../../api.js'
import { useSettings, SaveNote } from './General.jsx'
import { pushSupport, pushState, enablePush, disablePush, isIOS } from '../../pwa.js'
import { ScreenNotify } from '../remote/Settings.jsx'
import { where } from './search.js'
import { locale, t, tn } from '../../i18n/index.js'
import { Advanced, More } from './Advanced.jsx'

// Settings › Notifications: where you're told (this device, and every device that gets them), what
// about (an agent needing you or finishing, usage running low), with a sound or without (the top
// bar's speaker too: alertSounds, kept on the computer, which tells your phones), and when one of
// your devices views this screen (Screen Sharing Notifications, greyed while Remote Screen and
// Preview is off). Under Advanced: answer buttons, your phone while you're at the computer, and the
// agents you muted.
export default function Notifications() {
  return (
    <div className="st-sections">
      <ThisDevice />
      <WhatToSend />
      <Sounds />
      <Devices />
      <ScreenNotify />
    </div>
  )
}

// Notification sounds: on unless turned off (/api/alerts/sound; the top bar's speaker says the same).
function Sounds() {
  const { data: conf, refresh } = usePoll('/config', 10 * 60 * 1000)
  const [mine, setMine] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => setMine(null), [conf?.alertSounds])
  if (!conf) return null
  const on = mine ?? conf.alertSounds !== false
  const flip = async (v) => {
    setMine(v); setErr(null)
    try { await api('/alerts/sound', { method: 'POST', body: { on: v } }); refetch('/config'); refresh() } catch (e) { setMine(null); setErr(e.message) }
  }
  return (
    <section className="st-sec" data-setting="notify-sounds">
      <label className="st-check">
        <input type="checkbox" checked={on} onChange={(e) => flip(e.target.checked)} />
        <span><b>{t('Notification sounds')}</b> <span className="muted small">{t('Off: they still come, without a sound, on all your devices.')}</span></span>
      </label>
      {err && <p className="st-note bad"><Icon name="alert" size={13} /> {err}</p>}
    </section>
  )
}

function ThisDevice() {
  const support = pushSupport()
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => { pushState().then(setSt).catch(() => setSt({ on: false })) }, [])
  const run = async (fn, ok) => {
    setBusy(true); setMsg(null)
    try { await fn(); setSt(await pushState()); if (ok) setMsg({ ok }) } catch (e) { setMsg({ error: e.message }) }
    setBusy(false)
  }
  const test = () => run(() => api('/push/test', { method: 'POST' }), t('Sent. It shows up in a few seconds (not while Bridge AI is in front).'))

  return (
    <section className="st-sec" data-setting="this-device">
      <h4>{t('Notifications on this device')}</h4>
      {relayComputers ? <p className="muted small">{t('Notifications aren\'t in the Bridge AI app yet. To get them today, open your relay\'s address in {browser}, pair it with a new code, and add it to your Home Screen.', { browser: isIOS() ? 'Safari' : 'Chrome' })}</p>
        : support.why === 'desktop' ? <DesktopNotes onMsg={setMsg} />
        : support.why === 'ios-home-screen' ? <p className="muted small">{isIOS() ? t('On iPhone and iPad, notifications work in the Home Screen app: tap Share › Add to Home Screen, open Bridge AI from there, and turn them on here.') : t('On this device, notifications work in the Home Screen app: tap Share › Add to Home Screen, open Bridge AI from there, and turn them on here.')}</p>
        : support.why === 'insecure' ? <p className="muted small">{tn('Notifications need a secure connection. Open Bridge AI through its phone link ({place}), or on this computer at {address}.', { address: <code>http://127.0.0.1</code>, place: where('phone') })}</p>
        : support.why === 'unsupported' ? <p className="muted small">{t('This browser can\'t receive notifications.')}</p>
        : (
          <>
            <p className="muted small">{t('Get a notification here when an agent needs you or finishes, even when Bridge AI is closed.')}</p>
            <div className="st-row">
              {st?.on
                ? <><span className="st-chip good"><Icon name="check" size={11} /> {t('On for this device')}</span>
                  <button type="button" className="ghost-btn" disabled={busy} onClick={test}>{t('Send a test')}</button>
                  <button type="button" className="ghost-btn" disabled={busy} onClick={() => run(disablePush)}>{t('Turn off')}</button></>
                : <button type="button" className="btn primary" disabled={busy || !st} onClick={() => run(enablePush, t('Notifications are on for this device.'))}><Icon name="bell" size={14} /> {t('Turn on notifications')}</button>}
            </div>
          </>
        )}
      {msg?.error && <p className="st-note bad"><Icon name="alert" size={13} /> {msg.error}</p>}
      {msg?.ok && <p className="st-note ok"><Icon name="check" size={13} /> {msg.ok}</p>}
    </section>
  )
}

// The desktop app's own notifications. macOS doesn't tell an app when you've turned them off, so:
// send a test, and if it doesn't show, one click opens Bridge AI's page in System Settings ›
// Notifications.
function DesktopNotes({ onMsg }) {
  const [sent, setSent] = useState(false)
  const test = async () => {
    onMsg(null)
    try { setSent(!!(await window.bridgeApp?.testNotification?.())) } catch (e) { onMsg({ error: e.message }) }
  }
  const open = async () => {
    onMsg(null)
    try { await api('/fix/settings', { method: 'POST', body: { pane: 'notifications' } }) } catch (e) { onMsg({ error: e.message }) }
  }
  return (
    <>
      <p className="muted small">{t('The desktop app notifies you itself when an agent needs you or finishes, while its window isn\'t in front.')}</p>
      {window.bridgeApp?.testNotification && (
        <div className="st-row">
          <button type="button" className="ghost-btn" onClick={test}><Icon name="bell" size={12} /> {t('Send a test')}</button>
          {sent && <span className="muted small">{t('Didn\'t see it?')}</span>}
          {sent && <button type="button" className="btn small primary" onClick={open}><Icon name="external" size={12} /> {t('Turn on in System Settings')}</button>}
        </div>
      )}
    </>
  )
}

function WhatToSend() {
  const { s, save, note } = useSettings()
  const fleet = usePoll('/fleet', 15000)
  const [err, setErr] = useState(null) // why Unmute didn't take
  if (!s) return null
  const n = s.effective.notify || {}
  const set = (k, v) => save({ notify: { ...n, [k]: v } })
  const below = n.quotaBelow ?? 15
  const muted = (fleet.data?.agents || []).filter((a) => a.muted)
  const unmute = async (a) => { setErr(null); await api(`/agents/${encodeURIComponent(a.paneId)}/mute`, { method: 'POST', body: { muted: false } }).catch((e) => setErr(e.message)); fleet.refresh() }
  return (
    <section className="st-sec" data-setting="notify">
      <h4>{t('What to notify about')}</h4>
      <label className="ph-check"><input type="checkbox" checked={n.needsYou !== false} onChange={(e) => set('needsYou', e.target.checked)} /> {t('An agent needs you (a question, a permission)')}</label>
      <label className="ph-check"><input type="checkbox" checked={n.finished !== false} onChange={(e) => set('finished', e.target.checked)} /> {t('An agent finished')}</label>
      <label className="ph-check">{t('Usage running low:')}
        <select className="st-input ph-select" value={below} onChange={(e) => set('quotaBelow', Number(e.target.value))}>
          <option value={0}>{t('Don\'t tell me')}</option>
          {[5, 10, 15, 25].map((p) => <option key={p} value={p}>{t('{n}% or less left', { n: p })}</option>)}
        </select>
      </label>
      <SaveNote note={note} />
      <Advanced order={30}>
        <section className="st-sec" data-setting="notify-more">
          <h4>{t('Your Phone and Muted Agents')}</h4>
          <label className="ph-check" title={t('Where the phone shows them: Android and Chrome on a computer, not iPhone. A button only answers if the agent is still asking the same thing; otherwise Bridge AI opens.')}><input type="checkbox" checked={n.actions !== false} onChange={(e) => set('actions', e.target.checked)} /> {t('Answer buttons for simple questions (yes or no, or two short choices)')}</label>
          <label className="ph-check" title={t('Otherwise your phone stays quiet while Bridge AI is in front on this computer, or you typed or clicked in it in the last 2 minutes. This computer\'s own notifications don\'t change.')}><input type="checkbox" checked={!!n.phoneAtComputer} onChange={(e) => set('phoneAtComputer', e.target.checked)} /> {t('Notify my phone even when I\'m at the computer')}</label>
          {muted.length > 0 && (
            <>
              <p className="muted small">{t('Muted (an agent\'s ⋯ menu): no notifications from these until you unmute them.')}</p>
              <ul className="ph-devices">
                {muted.map((a) => (
                  <li key={a.paneId}>
                    <Icon name="bell-off" size={14} /><span>{a.chief ? t('Chief of Staff') : a.title || a.tab || a.workspace}</span>
                    <span className="muted small">{a.workspace}</span>
                    <button type="button" className="ghost-btn" onClick={() => unmute(a)}>{t('Unmute')}</button>
                  </li>
                ))}
              </ul>
              {err && <p className="st-note bad"><Icon name="alert" size={13} /> {err}</p>}
            </>
          )}
        </section>
      </Advanced>
    </section>
  )
}

function Devices() {
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null) // why Remove didn't take
  const load = () => api('/push/devices').then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])
  if (!list?.length) return null
  const remove = async (id) => { setErr(null); await api('/push/unsubscribe', { method: 'POST', body: { id } }).catch((e) => setErr(e.message)); load() }
  return (
    <section className="st-sec" data-setting="notify-devices">
      <h4>{t('Devices getting notifications')}</h4>
      <ul className="ph-devices">
        {list.map((d) => (
          <li key={d.id}>
            <Icon name={d.here ? 'laptop' : 'phone'} size={14} /><span>{d.here ? t('{name} (this computer)', { name: d.label }) : d.label}</span>
            <span className="muted small">{d.lastOk ? t('added {date}, last sent {when}', { date: new Date(d.addedAt).toLocaleDateString(locale()), when: new Date(d.lastOk).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }) : t('added {date}', { date: new Date(d.addedAt).toLocaleDateString(locale()) })}</span>
            <button type="button" className="ghost-btn" onClick={() => remove(d.id)}>{t('Remove')}</button>
          </li>
        ))}
      </ul>
      {err && <p className="st-note bad"><Icon name="alert" size={13} /> {err}</p>}
    </section>
  )
}
