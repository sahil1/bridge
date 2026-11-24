import { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { t, locale } from '../../i18n/index.js'
import { More } from './Advanced.jsx'
import SignatureHome from '../studio/pdf/Signatures.jsx'

// Settings › Studio: your saved signatures and initials (as Studio's home lists them: add, rename,
// make one the default, remove), and Ask Before Signing (server/signauth.js): off until you turn it
// on; then a signed copy is made only once you've said it's you, once per document, by the way
// the device you sign on can be asked: Touch ID or the Mac's password on a Mac, Windows Hello on
// Windows where it's set up, your signing PIN anywhere else (your phone, another computer, Linux).
// Once it's on, turning it off or changing the PIN is asked for the same way first.
export default function StudioSettings() {
  return (
    <div className="st-sections">
      <section className="st-sec" data-setting="signatures">
        <h4>{t('Your Signatures')}</h4>
        <SignatureHome settings />
      </section>
      <AskBeforeSigning />
    </div>
  )
}

function AskBeforeSigning() {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [pinFor, setPinFor] = useState(null) // null | 'on' | 'set' (a new PIN to type)
  const [pins, setPins] = useState({ a: '', b: '' })
  const [current, setCurrent] = useState('') // the PIN now, when that's how this device is asked
  const [confirming, setConfirming] = useState(null) // what's waiting on the current PIN: 'off' | 'set' | 'remove'
  const load = useCallback(() => api('/studio/sign/ask').then(setSt, (e) => setErr(e.message)), [])
  useEffect(() => { load() }, [load])
  if (!st && !err) return <section className="st-sec" data-setting="ask-before-signing" aria-busy="true"><h4>{t('Ask Before Signing')}</h4></section>
  const way = st?.way
  const sayErr = (e) => (e.code === 'pin-wrong' ? t('That PIN isn\'t right ({n} tries left).', { n: e.data?.left ?? 0 })
    : e.code === 'pin-locked' ? t('The signing PIN was wrong too many times, so it\'s locked until {time}.', { time: new Date(e.data?.until || Date.now()).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) })
      : e.code === 'cancelled' ? t('Cancelled: nothing changed.')
        : e.code === 'need-pin' ? t('This computer can only ask for a signing PIN: set one to turn this on.')
          : e.message)
  // Each change the server says needs asking (turning it off, any PIN: server/signauth.js) is asked
  // for first, then tried again: Touch ID here, or the current PIN where that's the way.
  const setting = (body) => api('/studio/sign/ask/setting', { method: 'POST', body })
  const run = async (what, body, pin) => {
    setBusy(what); setErr(null)
    try {
      try { setSt(await setting(body)) } catch (e) {
        if (e.code !== 'ask') throw e
        if (way === 'pin' && pin == null && st.pin) { setConfirming(what); return }
        const g = (await api('/studio/sign/ask', { method: 'POST', body: { purpose: 'settings', ...(pin != null ? { pin } : {}) } })).grant
        setSt(await setting({ ...body, grant: g }))
      }
      setPinFor(null); setPins({ a: '', b: '' }); setCurrent(''); setConfirming(null)
    } catch (e) { setErr(sayErr(e)) } finally { setBusy(null) }
  }
  // A change that waits for the current PIN, when that's how this device is asked and one's set.
  const ask = (what, body) => {
    if (way === 'pin' && st.pin && current.length < 4) { setConfirming(what); setErr(null); return }
    run(what, body, way === 'pin' && st.pin ? current : null)
  }
  const flip = (on) => {
    if (on && !st.pin && way === 'pin') { setPinFor('on'); return }
    ask(on ? 'on' : 'off', { on })
  }
  const newPin = () => {
    if (pins.a !== pins.b) { setErr(t('The two PINs aren\'t the same')); return }
    const body = { pin: pins.a, ...(pinFor === 'on' ? { on: true } : {}) }
    ask('set', body)
  }
  const hereHow = st?.deviceAuth ? (st.touchID ? t('On this Mac: Touch ID, or its password.') : t('On this Mac: its password.')) : st?.hello ? t('On this computer: Windows Hello.') : t('On this computer: your signing PIN.')
  const pending = confirming === 'off' ? { on: false } : confirming === 'remove' ? { removePin: true } : confirming === 'set' ? { pin: pins.a } : null
  // (From a browser tab: shown as it is, changed only in the app or on your phone, as Your Signatures says.)
  const mine = st?.canSign !== false
  return (
    <section className="st-sec" data-setting="ask-before-signing">
      <h4>{t('Ask Before Signing')}</h4>
      {st && (
        <>
          <label className="st-check">
            <input type="checkbox" checked={!!st.on} disabled={!!busy || !mine} onChange={(e) => flip(e.target.checked)} />
            <span><b>{t('Ask that it\'s you before a document is signed')}</b> <span className="muted small">{t('Once per document, however many places it signs.')} {way === 'pin' && !st.deviceAuth && !st.hello ? t('Here and from your phone: your signing PIN.') : `${hereHow} ${t('From your phone or another device: your signing PIN.')}`}</span></span>
          </label>
          <More>{t('Off, Sign this makes a signed copy when you press Sign. On, Bridge AI asks first, itself: Touch ID or the Mac\'s password through macOS, Windows Hello through Windows, or the signing PIN, checked on the computer (its hash is kept sealed with your signatures, and it locks for a while after 5 wrong tries). Only then is the copy made, so nothing can sign for you by calling Bridge AI directly. Turning it off or changing the PIN is asked for the same way.')}</More>
          <div className="st-row sd-pin-row">
            <span className="muted small">{st.pin ? t('Signing PIN: set') : t('Signing PIN: none yet')}</span>
            {mine && !pinFor && <button type="button" className="ghost-btn" onClick={() => { setPinFor('set'); setErr(null) }} disabled={!!busy}>{st.pin ? t('Change PIN') : t('Set a PIN')}</button>}
            {mine && st.pin && !pinFor && <button type="button" className="ghost-btn" onClick={() => ask('remove', { removePin: true })} disabled={!!busy}>{t('Remove PIN')}</button>}
          </div>
          {pinFor && (
            <div className="st-row sd-pin-new">
              <input type="password" inputMode="numeric" autoComplete="new-password" className="st-input" value={pins.a} onChange={(e) => setPins((p) => ({ ...p, a: e.target.value.replace(/\D/g, '').slice(0, 12) }))} placeholder={t('4 to 12 digits')} aria-label={t('A new signing PIN')} />
              <input type="password" inputMode="numeric" autoComplete="new-password" className="st-input" value={pins.b} onChange={(e) => setPins((p) => ({ ...p, b: e.target.value.replace(/\D/g, '').slice(0, 12) }))} placeholder={t('The same again')} aria-label={t('The new PIN again')} />
              <button type="button" className="btn small primary" onClick={newPin} disabled={!!busy || pins.a.length < 4 || !pins.b}>{pinFor === 'on' ? t('Set it and turn on') : t('Save PIN')}</button>
              <button type="button" className="ghost-btn" onClick={() => { setPinFor(null); setPins({ a: '', b: '' }) }} disabled={!!busy}>{t('Cancel')}</button>
            </div>
          )}
          {confirming && (
            <div className="st-row sd-pin-now">
              <input type="password" inputMode="numeric" autoComplete="off" className="st-input" autoFocus value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder={t('Your signing PIN now')} aria-label={t('Your signing PIN now')} onKeyDown={(e) => { if (e.key === 'Enter' && current.length >= 4) run(confirming, pending, current) }} />
              <button type="button" className="btn small primary" onClick={() => run(confirming, pending, current)} disabled={!!busy || current.length < 4}>{t('Confirm')}</button>
              <button type="button" className="ghost-btn" onClick={() => { setConfirming(null); setCurrent('') }}>{t('Cancel')}</button>
            </div>
          )}
          {busy && st.on && way !== 'pin' && <p className="muted small" role="status"><Icon name="fingerprint" size={12} /> {way === 'hello' ? t('Windows Hello, on this computer…') : st.touchID ? t('Touch ID, or your Mac\'s password, on this Mac…') : t('Your Mac\'s password, on this Mac…')}</p>}
        </>
      )}
      {err && <p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {err}</p>}
    </section>
  )
}
