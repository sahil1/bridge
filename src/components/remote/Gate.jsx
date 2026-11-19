// What a computer asks before it shows one of its apps (Remote Screen and Preview; server/remote.js
// gate): its Remote Access Password, or someone there to allow it. gate: { t: 'password', wrong,
// left, lockMinutes } | { t: 'asking', until }. onPassword(p) sends it; onCancel closes.
import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { t } from '../../i18n/index.js'
import './remote.css'

export default function Gate({ gate, name, onPassword, onCancel }) {
  const [pw, setPw] = useState('')
  const [checking, setChecking] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => { setChecking(false) }, [gate])
  useEffect(() => { if (gate.t !== 'asking') return; const tm = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(tm) }, [gate.t])
  if (gate.t === 'password') {
    const send = (e) => { e.preventDefault(); if (!pw) return; onPassword(pw); setPw(''); setChecking(true) }
    return (
      <form className="rs-card c-password" onSubmit={send}>
        <Icon name="lock" size={22} />
        <h3>{t('Remote Access Password')}</h3>
        <p>{t('{name} asks for its password before it shows its apps.', { name })}</p>
        <input className="st-input" type="password" name="bridge-remote-access" autoComplete="off" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} disabled={checking} aria-label={t('Remote Access Password')} placeholder={t('Password')} />
        {gate.wrong && !checking && <p className="rs-card-bad" role="alert">{gate.left === 1 ? t('Wrong password. One more wrong try locks this device out for {m} minutes.', { m: gate.lockMinutes }) : t('Wrong password. {n} more wrong tries lock this device out for {m} minutes.', { n: gate.left, m: gate.lockMinutes })}</p>}
        <div className="rs-card-btns">
          <button type="button" className="btn" onClick={onCancel}>{t('Cancel')}</button>
          <button type="submit" className="btn primary" disabled={!pw || checking}>{checking ? t('Checking…') : t('Connect')}</button>
        </div>
      </form>
    )
  }
  const left = Math.max(0, Math.round((new Date(gate.until).getTime() - Date.now()) / 1000))
  return (
    <div className="rs-card c-asking" role="status">
      <Icon name="refresh" size={20} className="spin" />
      <p>{t('Waiting for someone at {name} to allow this…', { name })}</p>
      <small className="muted">{t('{n} seconds left. No answer is a no.', { n: left })}</small>
      <div className="rs-card-btns"><button type="button" className="btn" onClick={onCancel}>{t('Cancel')}</button></div>
    </div>
  )
}

// The gate from a session's messages: { t: 'password' | 'asking', ... } as Gate shows it, else null.
export const gateOf = (m) => (m.t === 'password' ? { t: 'password', wrong: !!m.wrong, left: Number(m.left) || 0, lockMinutes: Number(m.lockMinutes) || 15 }
  : m.t === 'asking' ? { t: 'asking', until: m.until || new Date(Date.now() + (Number(m.ms) || 30000)).toISOString() } : null)
