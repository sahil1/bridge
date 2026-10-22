import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api } from '../api.js'
import { PairCode } from './settings/Relay.jsx'

// First-run setup: "Use Bridge AI on your phone", through Bridge AI's relay (server/relay.js), on
// unless you turn it off. Offered only once that relay exists (server/hosted.js) and nothing is set
// up yet; otherwise none of this shows.
export function usePhoneOffer() {
  const [offer, setOffer] = useState(false)
  const [use, setUse] = useState(true)
  useEffect(() => { api('/relay').then((r) => setOffer(!!r.hostedAvailable && !r.configured)).catch(() => {}) }, [])
  return { offer, use, setUse }
}

// The choice, in the summary's row or the longer form.
export function PhonePick({ phone, onDone }) {
  return (
    <select className="st-input" autoFocus={!!onDone} value={phone.use ? 'hosted' : ''} onChange={(e) => { phone.setUse(!!e.target.value); onDone?.() }} aria-label="Use Bridge AI on your phone">
      <option value="hosted">Through Bridge AI's relay (easiest, no account)</option>
      <option value="">Not now (set it up later in Settings)</option>
    </select>
  )
}

// After setup: the relay is put to use, and a code to pair the phone appears.
export function PhoneDone() {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState(null)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        let s = await api('/relay/deploy', { method: 'POST', body: { method: 'hosted' } })
        for (let i = 0; i < 20 && !s.online; i++) { await new Promise((r) => setTimeout(r, 1000)); s = await api('/relay') }
        if (!s.online) throw new Error(s.error || 'The relay didn\'t connect')
        setSt(await api('/relay/pair', { method: 'POST' }))
      } catch (e) { setErr(e.message) }
    })()
  }, [])
  return (
    <div className="onb-box onb-phone">
      <h3><Icon name="phone" size={14} /> Use Bridge AI on your phone</h3>
      {err ? <p className="muted small">Couldn't set it up just now: {err}. Try again any time in Settings › Phone &amp; notifications.</p>
        : st?.done ? <p className="muted small"><Icon name="check" size={12} /> Pair more phones any time in Settings › Phone &amp; notifications.</p>
        : !st?.pairing ? <p className="muted small"><Icon name="refresh" size={12} className="spin" /> Setting up Bridge AI's relay…</p>
        : <>
          <PairCode p={st.pairing} onStop={() => { api('/relay/pair', { method: 'POST', body: { stop: true } }).catch(() => {}); setSt({ ...st, pairing: null, done: true }) }} />
          <p className="muted small">Through Bridge AI's relay, end-to-end encrypted: it passes the connection on without being able to read it. Change this any time in Settings › Phone &amp; notifications.</p>
        </>}
    </div>
  )
}
