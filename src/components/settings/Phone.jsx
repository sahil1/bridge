import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, viaRelay, relayComputers } from '../../api.js'
import Relay from './Relay.jsx'
import { useSettings, SaveNote } from './General.jsx'
import { pushSupport, pushState, enablePush, disablePush, isIOS } from '../../pwa.js'

// Settings › Phone & notifications: open Bridge AI on your phone (through your own relay, or
// through Tailscale, as a Home Screen app), and choose what you get notified about, on which
// devices. Both are optional; Bridge AI works on this computer without either.
export default function Phone() {
  return (
    <div className="st-sections">
      <Relay />
      <PhoneAccess />
      <ThisDevice />
      <WhatToSend />
      <Devices />
    </div>
  )
}

function PhoneAccess() {
  if (viaRelay) return null
  // Opened through the phone link already: nothing to set up from here.
  if (location.hostname.endsWith('.ts.net')) {
    return (
      <section className="st-sec">
        <h4>Use on your phone</h4>
        <p className="muted small"><Icon name="check" size={12} /> You're connected to your computer through Tailscale. If you haven't yet, add Bridge AI to your Home Screen so it opens like an app: iPhone, Share › Add to Home Screen; Android, ⋮ › Install app.</p>
      </section>
    )
  }
  return <PhoneSetup />
}

function PhoneSetup() {
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

  return (
    <section className="st-sec">
      <h4>Or through Tailscale</h4>
      <p className="muted small">If you already use <a href="https://tailscale.com" target="_blank" rel="noreferrer">Tailscale</a>, a free private network between your own devices, your phone can open Bridge AI through it instead. Nothing is opened to the internet, and only devices signed in to your Tailscale account can reach it. Tailscale has to be connected on both the phone and this computer.</p>
      {!st ? <div className="skeleton-rows"><div /></div>
        : !st.installed ? (
          <ol className="ph-steps">
            <li><b>Install Tailscale on this computer</b> and sign in. <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Download Tailscale</a></li>
            <li>Come back here and press <b>Check again</b>.</li>
          </ol>
        ) : !st.running ? (
          <p className="st-note warn"><Icon name="alert" size={13} /> Tailscale is installed but {st.state === 'NeedsLogin' ? 'not signed in' : 'not connected'}. Open Tailscale and {st.state === 'NeedsLogin' ? 'sign in' : 'connect'}, then check again.</p>
        ) : !st.enabled ? (
          <div className="st-row">
            <button type="button" className="btn primary" disabled={busy} onClick={() => toggle(true)}><Icon name="phone" size={14} /> {busy ? 'Turning on…' : 'Turn on phone access'}</button>
            <span className="muted small">Publishes Bridge AI as <code>https://{st.name}</code> to your devices.</span>
          </div>
        ) : (
          <div className="ph-pair">
            <div className="ph-qr" aria-label={`QR code for ${st.url}`} dangerouslySetInnerHTML={{ __html: st.qr }} />
            <div className="ph-pair-text">
              <ol className="ph-steps">
                <li><b>Install Tailscale on your phone</b> and sign in with the same account as this computer.</li>
                <li><b>Scan this code</b> with the phone's camera, or open <a href={st.url} target="_blank" rel="noreferrer"><code>{st.url}</code></a>.</li>
                <li><b>Add it to your Home Screen</b> so it opens like an app. iPhone: Share › Add to Home Screen. Android: ⋮ › Install app.</li>
                <li><b>Open it from the Home Screen</b> and turn on notifications below (Settings › Phone & notifications, on the phone).</li>
              </ol>
              <div className="st-row">
                <button type="button" className="ghost-btn" onClick={() => navigator.clipboard?.writeText(st.url).catch(() => {})}><Icon name="copy" size={12} /> Copy link</button>
                <button type="button" className="ghost-btn" disabled={busy} onClick={() => toggle(false)}>Turn off phone access</button>
              </div>
            </div>
          </div>
        )}
      {err && <p className="st-note bad"><Icon name="alert" size={13} /> {link ? <>Tailscale needs HTTPS switched on for your account first (once). <a href={link} target="_blank" rel="noreferrer">Turn it on</a>, then try again.</> : err}</p>}
      {st && !st.enabled && <div><button type="button" className="ghost-btn" onClick={load}><Icon name="refresh" size={12} /> Check again</button></div>}
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
  const test = () => run(() => api('/push/test', { method: 'POST' }), 'Sent. It shows up in a few seconds (not while Bridge AI is in front).')

  return (
    <section className="st-sec">
      <h4>Notifications on this device</h4>
      {relayComputers ? <p className="muted small">Notifications aren't in the Bridge AI app yet. To get them today, open your relay's address in {isIOS() ? 'Safari' : 'Chrome'}, pair it with a new code, and add it to your Home Screen.</p>
        : support.why === 'desktop' ? <p className="muted small">The desktop app notifies you itself when an agent needs you or finishes, while its window isn't in front.</p>
        : support.why === 'ios-home-screen' ? <p className="muted small">On {isIOS() ? 'iPhone and iPad' : 'this device'}, notifications work in the Home Screen app: tap Share › Add to Home Screen, open Bridge AI from there, and turn them on here.</p>
        : support.why === 'insecure' ? <p className="muted small">Notifications need a secure connection. Open Bridge AI through its phone link (above), or on this computer at <code>http://127.0.0.1</code>.</p>
        : support.why === 'unsupported' ? <p className="muted small">This browser can't receive notifications.</p>
        : (
          <>
            <p className="muted small">Get a notification here when an agent needs you or finishes, even when Bridge AI is closed.</p>
            <div className="st-row">
              {st?.on
                ? <><span className="st-chip good"><Icon name="check" size={11} /> On for this device</span>
                  <button type="button" className="ghost-btn" disabled={busy} onClick={test}>Send a test</button>
                  <button type="button" className="ghost-btn" disabled={busy} onClick={() => run(disablePush)}>Turn off</button></>
                : <button type="button" className="btn primary" disabled={busy || !st} onClick={() => run(enablePush, 'Notifications are on for this device.')}><Icon name="bell" size={14} /> Turn on notifications</button>}
            </div>
          </>
        )}
      {msg?.error && <p className="st-note bad"><Icon name="alert" size={13} /> {msg.error}</p>}
      {msg?.ok && <p className="st-note ok"><Icon name="check" size={13} /> {msg.ok}</p>}
    </section>
  )
}

function WhatToSend() {
  const { s, save, note } = useSettings()
  if (!s) return null
  const n = s.effective.notify || {}
  const set = (k, v) => save({ notify: { ...n, [k]: v } })
  const below = n.quotaBelow ?? 15
  return (
    <section className="st-sec">
      <h4>What to notify about</h4>
      <label className="ph-check"><input type="checkbox" checked={n.needsYou !== false} onChange={(e) => set('needsYou', e.target.checked)} /> An agent needs you (a question, a permission)</label>
      <label className="ph-check"><input type="checkbox" checked={n.finished !== false} onChange={(e) => set('finished', e.target.checked)} /> An agent finished</label>
      <label className="ph-check">Usage running low:
        <select className="st-input ph-select" value={below} onChange={(e) => set('quotaBelow', Number(e.target.value))}>
          <option value={0}>Don't tell me</option>
          {[5, 10, 15, 25].map((p) => <option key={p} value={p}>{p}% or less left</option>)}
        </select>
      </label>
      <SaveNote note={note} />
    </section>
  )
}

function Devices() {
  const [list, setList] = useState(null)
  const load = () => api('/push/devices').then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])
  if (!list?.length) return null
  const remove = async (id) => { await api('/push/unsubscribe', { method: 'POST', body: { id } }).catch(() => {}); load() }
  return (
    <section className="st-sec">
      <h4>Devices getting notifications</h4>
      <ul className="ph-devices">
        {list.map((d) => (
          <li key={d.id}>
            <Icon name="phone" size={14} /><span>{d.label}</span>
            <span className="muted small">added {new Date(d.addedAt).toLocaleDateString()}{d.lastOk ? `, last sent ${new Date(d.lastOk).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</span>
            <button type="button" className="ghost-btn" onClick={() => remove(d.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
