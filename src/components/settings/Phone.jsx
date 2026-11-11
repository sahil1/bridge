import { Fragment, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import CopyButton from '../CopyButton.jsx'
import { api, usePoll, viaRelay, relayComputers } from '../../api.js'
import Relay, { KeepAwake } from './Relay.jsx'
import { MachinesSettings } from '../Machines.jsx'
import { useSettings, SaveNote } from './General.jsx'
import { pushSupport, pushState, enablePush, disablePush, isIOS } from '../../pwa.js'
import { locale, t, tn } from '../../i18n/index.js'
import { Advanced } from './Advanced.jsx'

// Settings › Devices: open Bridge AI on your phone (through your own relay, or through
// Tailscale, as a Home Screen app), link your other computers (through each one's relay: the same
// sign-in, so it's one place), and choose what you get notified about, on which devices. All
// optional; Bridge AI works on this computer without any of it. focus: 'machines' starts there.
// Under Advanced: Tailscale (until it's the way picked, or on), keeping this computer awake, the
// rest of what to notify about, and the devices that get notifications.
export default function Phone({ focus = null }) {
  // With Bridge AI's relay offered, Relay starts with a choice of three ways; Tailscale's section
  // shows when it's the one picked (or already on).
  const [way, setWay] = useState(null)
  const [offer, setOffer] = useState(false)
  return (
    <div className="st-sections">
      <Relay way={way} setWay={setWay} onOffer={setOffer} />
      <PhoneAccess quiet={offer && way !== 'tailscale'} picked={offer && way === 'tailscale'} />
      <MachinesSettings embedded focus={focus === 'machines'} />
      <ThisDevice />
      <WhatToSend />
      <Devices />
    </div>
  )
}

function PhoneAccess({ quiet, picked }) {
  if (viaRelay) return null
  // Opened through the phone link already: nothing to set up from here.
  if (location.hostname.endsWith('.ts.net')) {
    return (
      <section className="st-sec" data-setting="tailscale">
        <h4>{t('Use on your phone')}</h4>
        <p className="muted small"><Icon name="check" size={12} /> {t('You\'re connected to your computer through Tailscale. If you haven\'t yet, add Bridge AI to your Home Screen so it opens like an app: iPhone, Share › Add to Home Screen; Android, ⋮ › Install app.')}</p>
      </section>
    )
  }
  return <PhoneSetup quiet={quiet} picked={picked} />
}

// quiet: only if it's on already (Bridge AI's relay is offered, and Tailscale isn't the way picked).
function PhoneSetup({ quiet, picked }) {
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const load = () => { setErr(null); return api('/phone').then(setSt).catch((e) => setErr(e.message)) }
  useEffect(() => { load() }, [])
  const toggle = async (enabled) => {
    setBusy(true); setErr(null)
    try { setSt(await api('/phone', { method: 'POST', body: { enabled } })) } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const link = err?.match(/https:\/\/\S+/)?.[0]
  if (quiet && !st?.enabled) return null
  // Not the way picked, and not on: under Advanced.
  const Where = picked || st?.enabled ? Fragment : Advanced

  return (
    <Where {...(Where === Advanced ? { order: 10 } : {})}>
    <section className="st-sec" data-setting="tailscale">
      <h4>{picked ? t('Through Tailscale') : t('Or through Tailscale')}</h4>
      <p className="muted small" title={t('If you already use Tailscale, a free private network between your own devices, your phone can open Bridge AI through it instead. Nothing is opened to the internet, and only devices signed in to your Tailscale account can reach it. Tailscale has to be connected on both the phone and this computer.')}>{tn('If you use {tailscale}, your phone can reach Bridge AI over it instead. Nothing is opened to the internet.', { tailscale: <a href="https://tailscale.com" target="_blank" rel="noreferrer">Tailscale</a> })}</p>
      {!st ? <div className="skeleton-rows"><div /></div>
        : !st.installed ? (
          <ol className="ph-steps">
            <li>{tn('{install} and sign in.', { install: <b>{t('Install Tailscale on this computer')}</b> })} <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">{t('Download Tailscale')}</a></li>
            <li>{tn('Come back here and press {check}.', { check: <b>{t('Check again')}</b> })}</li>
          </ol>
        ) : !st.running ? (
          <p className="st-note warn"><Icon name="alert" size={13} /> {st.state === 'NeedsLogin' ? t('Tailscale is installed but not signed in. Open Tailscale and sign in, then check again.') : t('Tailscale is installed but not connected. Open Tailscale and connect, then check again.')}</p>
        ) : !st.enabled ? (
          <div className="st-row">
            <button type="button" className="btn primary" disabled={busy} onClick={() => toggle(true)}><Icon name="phone" size={14} /> {busy ? t('Turning on…') : t('Turn on phone access')}</button>
            <span className="muted small">{tn('Publishes Bridge AI as {address} to your devices.', { address: <code>https://{st.name}</code> })}</span>
          </div>
        ) : (
          <div className="ph-pair">
            <div className="ph-qr" aria-label={t('QR code for {url}', { url: st.url })} dangerouslySetInnerHTML={{ __html: st.qr }} />
            <div className="ph-pair-text">
              <ol className="ph-steps">
                <li>{tn('{install} and sign in with the same account as this computer.', { install: <b>{t('Install Tailscale on your phone')}</b> })}</li>
                <li>{tn('{scan} with the phone\'s camera, or open {link}.', { scan: <b>{t('Scan this code')}</b>, link: <a href={st.url} target="_blank" rel="noreferrer"><code>{st.url}</code></a> })}</li>
                <li>{tn('{add} so it opens like an app. iPhone: Share › Add to Home Screen. Android: ⋮ › Install app.', { add: <b>{t('Add it to your Home Screen')}</b> })}</li>
                <li>{tn('{open} and turn on notifications below (Settings › Devices, on the phone).', { open: <b>{t('Open it from the Home Screen')}</b> })}</li>
              </ol>
              <div className="st-row">
                <CopyButton text={st.url} label={t('Copy link')} />
                <button type="button" className="ghost-btn" disabled={busy} onClick={() => toggle(false)}>{t('Turn off phone access')}</button>
              </div>
              <KeepAwake />
            </div>
          </div>
        )}
      {err && <p className="st-note bad"><Icon name="alert" size={13} /> {link ? <span>{tn('Tailscale needs HTTPS switched on for your account first (once). {turnOn}, then try again.', { turnOn: <a href={link} target="_blank" rel="noreferrer">{t('Turn it on')}</a> })}</span> : err}</p>}
      {st && !st.enabled && <div><button type="button" className="ghost-btn" onClick={load}><Icon name="refresh" size={12} /> {t('Check again')}</button></div>}
    </section>
    </Where>
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
        : support.why === 'insecure' ? <p className="muted small">{tn('Notifications need a secure connection. Open Bridge AI through its phone link (above), or on this computer at {address}.', { address: <code>http://127.0.0.1</code> })}</p>
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
          <h4>{t('Notifications')}</h4>
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
    <Advanced order={40}>
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
    </Advanced>
  )
}
