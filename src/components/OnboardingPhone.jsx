import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api, viaRelay } from '../api.js'
import { PairCode, HostedFull } from './settings/Relay.jsx'
import { t } from '../i18n/index.js'

// First-run setup (Onboarding.jsx): "Use Bridge AI on your phone", through Bridge AI's relay
// (server/relay.js), on unless you turn it off. Offered only once that relay exists (server/hosted.js)
// and nothing is set up yet; otherwise none of this shows.
export function usePhoneOffer() {
  const [offer, setOffer] = useState(false)
  const [use, setUse] = useState(true)
  useEffect(() => { if (!viaRelay) api('/relay').then((r) => setOffer(!!r.hostedAvailable && !r.configured)).catch(() => {}) }, [])
  return { offer, use, setUse }
}

// The choice, a tick like the wizard's others.
export function PhonePick({ phone }) {
  return (
    <label className="wiz-awake wiz-phone">
      <input type="checkbox" checked={phone.use} onChange={(e) => phone.setUse(e.target.checked)} />
      <b>{t('Use Bridge AI on your phone')}</b>
      <small>{t('Through Bridge AI\'s relay: no account, end-to-end encrypted. A code to pair your phone shows next.')}</small>
    </label>
  )
}

// After setup's first step: the relay is put to use, and a code to pair the phone appears. If it
// can't (full for now, no internet), it says why, and setup carries on.
export function PhoneDone() {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState(null)
  const [full, setFull] = useState(false)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        let s = await api('/relay/deploy', { method: 'POST', body: { method: 'hosted' } })
        for (let i = 0; i < 20 && !s.online; i++) { await new Promise((r) => setTimeout(r, 1000)); s = await api('/relay') }
        if (!s.online) throw new Error(s.error || t('The relay didn\'t connect'))
        setSt(await api('/relay/pair', { method: 'POST' }))
      } catch (e) { if (e.code === 'hostedFull') setFull(true); else setErr(e.message) }
    })()
  }, [])
  return (
    <div className="onb-box onb-phone">
      <h3><Icon name="phone" size={14} /> {t('Use Bridge AI on your phone')}</h3>
      {full ? <HostedFull />
        : err ? <p className="muted small">{t('Couldn\'t set it up just now: {err}. Try again any time in Settings › Devices.', { err })}</p>
        : st?.done ? <p className="muted small"><Icon name="check" size={12} /> {t('Pair more phones any time in Settings › Devices.')}</p>
        : !st?.pairing ? <p className="muted small"><Icon name="refresh" size={12} className="spin" /> {t('Setting up Bridge AI\'s relay…')}</p>
        : <>
          <PairCode p={st.pairing} forPhone onStop={() => { api('/relay/pair', { method: 'POST', body: { stop: true } }).catch(() => {}); setSt({ ...st, pairing: null, done: true }) }} />
          <p className="muted small">{t('Through Bridge AI\'s relay, end-to-end encrypted: it passes the connection on without being able to read it. Change this any time in Settings › Devices.')}</p>
        </>}
    </div>
  )
}
