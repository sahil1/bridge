import { Fragment, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import CopyButton from '../CopyButton.jsx'
import { api, viaRelay } from '../../api.js'
import Relay, { KeepAwake, takeWay } from './Relay.jsx'
import { MachinesSettings } from '../Machines.jsx'
import { where } from './search.js'
import { t, tn } from '../../i18n/index.js'
import { Advanced, More } from './Advanced.jsx'

// Settings › Devices & Access, its Phone and Computers tabs (Settings.jsx; tab: the one showing; the
// Remote Access tab is remote/Settings.jsx, Share Links Sharing.jsx). Phone: open Bridge AI on your
// phone (through your own relay, or through Tailscale, as a Home Screen app). Computers: link your
// other computers (through each one's relay: the same sign-in, so it's one section). All optional;
// Bridge AI works on this computer without any of it. focus: 'machines' starts at your devices.
// Under the Phone tab's Advanced: Tailscale (until it's the way picked, or on). What you're notified
// about, and where, is Settings › Notifications (Notifications.jsx).
export default function Phone({ tab = 'phone', focus = null }) {
  // With Bridge AI's relay offered, Relay starts with a choice of three ways; Tailscale's section
  // shows when it's the one picked (or already on). (One picked on the Account tab comes with it.)
  const [way, setWay] = useState(() => takeWay())
  const [offer, setOffer] = useState(false)
  return (
    <div className="st-sections">
      {tab === 'phone' && <Relay way={way} setWay={setWay} onOffer={setOffer} />}
      {tab === 'phone' && <PhoneAccess quiet={offer && way !== 'tailscale'} picked={offer && way === 'tailscale'} />}
      {tab === 'machines' && <MachinesSettings embedded focus={focus === 'machines'} />}
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
  // The code holds a link that lets one phone in (apiauth.js), once, within two minutes: a new one
  // every minute while it shows.
  const [code, setCode] = useState(null) // { url, qr }
  useEffect(() => {
    if (!st?.enabled) return
    let live = true
    const make = () => api('/phone/link', { method: 'POST' }).then((l) => live && setCode(l), (e) => live && setErr(e.message))
    make()
    const tm = setInterval(make, 60000)
    return () => { live = false; clearInterval(tm) }
  }, [st?.enabled])
  const link = err?.match(/https:\/\/\S+/)?.[0]
  if (quiet && !st?.enabled) return null
  // Not the way picked, and not on: under Advanced.
  const Where = picked || st?.enabled ? Fragment : Advanced

  return (
    <Where {...(Where === Advanced ? { order: 10 } : {})}>
    <section className="st-sec" data-setting="tailscale">
      <h4>{picked ? t('Through Tailscale') : t('Or through Tailscale')}</h4>
      <p className="muted small">{tn('If you use {tailscale}, your phone can reach Bridge AI over it instead. Nothing is opened to the internet.', { tailscale: <a href="https://tailscale.com" target="_blank" rel="noreferrer">Tailscale</a> })} <More>{t('If you already use Tailscale, a free private network between your own devices, your phone can open Bridge AI through it instead. Nothing is opened to the internet, and only devices signed in to your Tailscale account can reach it. Tailscale has to be connected on both the phone and this computer.')}</More></p>
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
            {code ? <div className="ph-qr" aria-label={t('QR code for {url}', { url: st.url })} dangerouslySetInnerHTML={{ __html: code.qr }} /> : <div className="ph-qr skeleton-rows"><div /></div>}
            <div className="ph-pair-text">
              <ol className="ph-steps">
                <li>{tn('{install} and sign in with the same account as this computer.', { install: <b>{t('Install Tailscale on your phone')}</b> })}</li>
                <li>{tn('{scan} with the phone\'s camera. It opens {address} and lets that phone in; each code works once, and a new one shows here every minute.', { scan: <b>{t('Scan this code')}</b>, address: <code>{st.url}</code> })}</li>
                <li>{tn('{add} so it opens like an app. iPhone: Share › Add to Home Screen. Android: ⋮ › Install app.', { add: <b>{t('Add it to your Home Screen')}</b> })}</li>
                <li>{tn('{open} and turn on notifications ({place}, on the phone).', { open: <b>{t('Open it from the Home Screen')}</b>, place: where('notifications') })}</li>
              </ol>
              <div className="st-row">
                {code && <CopyButton text={code.url} label={t('Copy link')} />}
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
