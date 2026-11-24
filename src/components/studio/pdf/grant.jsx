import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from '../../../api.js'
import { t } from '../../../i18n/index.js'

// Asking that it's you, for what Ask Before Signing covers (server/signauth.js): a grant for one
// purpose: 'sign' (a document), 'change' (your saved signatures, while it's on), 'settings' (it
// and the PIN) or 'export' (your signatures into a backup or a move). The server asks: Touch ID or
// the Mac's password on a Mac (macOS's own prompt), Windows Hello, or the signing PIN, which is
// typed here, in a small box over the page. null when nothing needs asking.
export async function grantFor(purpose, { ask = null, root = null, path = null } = {}) {
  const st = ask || await api('/studio/sign/ask')
  if ((purpose === 'change' || purpose === 'sign') && !st?.on) return null
  let pin = null
  if (st?.way === 'pin' && (st.pin || purpose !== 'export')) {
    pin = await askPin()
    if (pin == null) throw Object.assign(new Error(t('Cancelled: nothing changed.')), { code: 'cancelled' })
  }
  const r = await api('/studio/sign/ask', { method: 'POST', body: { purpose, ...(root != null ? { root, path } : {}), ...(pin != null ? { pin } : {}) } })
  return r.grant || null
}

// The signing PIN, typed: the PIN, or null when cancelled.
export function askPin() {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = (v) => { root.unmount(); host.remove(); resolve(v) }
    root.render(<PinBox onDone={done} />)
  })
}
function PinBox({ onDone }) {
  const [pin, setPin] = useState('')
  const box = useRef(null)
  useEffect(() => { box.current?.focus() }, [])
  return (
    <div className="sd-pinbox-back" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onDone(null) }}>
      <form className="sd-pinbox" role="dialog" aria-modal="true" aria-label={t('Your signing PIN')} onSubmit={(e) => { e.preventDefault(); if (pin.length >= 4) onDone(pin) }} onKeyDown={(e) => { if (e.key === 'Escape') onDone(null) }}>
        <b>{t('Your signing PIN')}</b>
        <span className="muted small">{t('Ask Before Signing is on: type your signing PIN to go on.')}</span>
        <input ref={box} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))} aria-label={t('Signing PIN')} />
        <span className="sd-pinbox-acts">
          <button type="button" className="ghost-btn" onClick={() => onDone(null)}>{t('Cancel')}</button>
          <button type="submit" className="btn small primary" disabled={pin.length < 4}>{t('Confirm')}</button>
        </span>
      </form>
    </div>
  )
}
