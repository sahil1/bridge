import { useState } from 'react'
import Icon from '../components/Icon.jsx'
import { api } from '../api.js'
import { t } from '../i18n/index.js'
import { wordsChanged } from './controller.js'
import './dictation.css'

// Offered once you've put a name right in what you said (on the dictation window's card, or in
// Dictations; shared/dictation/corrected.js finds it): kept in meeting memory if you say so, so it's
// written that way from then on wherever it's heard as it was, in dictation and in meetings, and
// listened for (server/dictation.js remember). Nothing is kept until you click Remember; Undo takes
// it back, and Meetings › Memory has it to change or remove later. fix: { heard, term }; onKept:
// remembered; onClose: Not now, or undone.
export default function Remember({ fix, onKept, onClose, className = '' }) {
  const [kept, setKept] = useState(null) // the server's answer, which Undo needs
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const go = async (path, body, then) => {
    setBusy(true)
    setErr(null)
    try { then(await api(path, { method: 'POST', body })); wordsChanged() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const yes = () => go('/dictation/remember', fix, (r) => { setKept(r); onKept?.() })
  const undo = () => go('/dictation/remember/undo', { id: kept.id, created: kept.created, was: kept.was }, () => onClose?.())
  return (
    <div className={`remember ${className}`} role="group" aria-label={t('Remember "{term}"?', fix)}>
      {kept ? (
        <>
          <p className="remember-q" role="status"><Icon name="check" size={12} /> <span>{t('Remembered. "{heard}" is written "{term}" from now on.', fix)}</span></p>
          <span className="remember-acts"><button type="button" className="link-btn" onClick={undo} disabled={busy}>{t('Undo')}</button></span>
        </>
      ) : (
        <>
          <p className="remember-q"><span><b>{t('Remember "{term}"?', fix)}</b> {t('Heard as "{heard}", it\'s written "{term}" from now on, in dictation and meetings. You can change it in Meetings › Memory.', fix)}</span></p>
          <span className="remember-acts">
            <button type="button" className="comp-text-btn" onClick={onClose} disabled={busy}>{t('Not now')}</button>
            <button type="button" className="btn small primary" onClick={yes} disabled={busy}>{t('Remember')}</button>
          </span>
        </>
      )}
      {err && <p className="error-text small">{err}</p>}
    </div>
  )
}
