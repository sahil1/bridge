import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { api, viaRelay } from '../api.js'
import { t } from '../i18n/index.js'
import './crashReport.css'

// Usage stats and crash reports are on unless turned off (server/counts.js, server/crashes.js): the
// first time they're on, once, a card says so, with what's sent and what never is, and turns both
// off in one click. Not through the relay (a phone shows nothing of it), and not over a crash's card.
export default function StatsNotice() {
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!viaRelay) api('/counts').then(setS, () => {}) }, [])
  if (!s?.notice) return null
  const ok = () => { setS(null); api('/counts/noticed', { method: 'POST' }).catch(() => {}) }
  const off = async () => {
    setBusy(true)
    await Promise.all([api('/counts', { method: 'POST', body: { share: false } }), api('/crashes/sending', { method: 'POST', body: { send: false } })]).catch(() => {})
    setS(null)
  }
  const more = () => { ok(); window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })) }
  return (
    <div className="stats-notice" role="status">
      <Icon name="info" size={15} />
      <div className="stats-notice-text">
        <b>{t('Bridge AI sends anonymous usage stats and crash reports')}</b>
        <span className="muted small">{t('To find bugs and see what to build: which features are on and used, how long it\'s used, its version and this computer\'s system, as ranges, and crash reports with names, folders, emails and keys taken out. Never your code, what you type or say, or anything from your agents, and no ID for you or this computer.')}</span>
      </div>
      <div className="stats-notice-acts">
        <button type="button" className="btn small" onClick={ok}>{t('OK')}</button>
        <button type="button" className="ghost-btn small" disabled={busy} onClick={off}>{t('Turn off')}</button>
        <button type="button" className="link-btn small" onClick={more}>{t('See what\'s sent')}</button>
      </div>
    </div>
  )
}
