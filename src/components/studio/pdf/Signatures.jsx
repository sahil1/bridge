import { useCallback, useEffect, useState } from 'react'
import Icon from '../../Icon.jsx'
import { api, BASE } from '../../../api.js'
import { t, tx, locale } from '../../../i18n/index.js'
import SignPad from './SignPad.jsx'

// Your signature and initials for Signature Assist: drawn once, kept only on this computer, in
// Bridge AI's data folder (server/signing.js), and removed whenever you like. Studio's home shows
// them; a PDF's Signature Assist asks for one when it needs it.
export const KEPT = tx('Kept only on this computer, in Bridge AI\'s data folder. It\'s never sent to a model or anywhere else.')
export const sigUrl = (which, at) => `${BASE}/api/studio/signature/${which}?v=${encodeURIComponent(at || '')}`

// What Signature Assist has to go on: { signature, initials, model, readsScans }, null until it's
// come (asked once on is true).
export function useSignSetup(on = true) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const refresh = useCallback(() => api('/studio/sign/setup').then((d) => { setData(d); setErr(null); return d }, (e) => { setErr(e.message); return null }), [])
  useEffect(() => { if (on && !data) refresh() }, [on, data, refresh])
  const keep = async (which, png) => { const d = await api(`/studio/signature/${which}`, { method: 'PUT', body: { png } }); setData((x) => ({ ...x, ...d })); return d }
  const remove = async (which) => { const d = await api(`/studio/signature/${which}`, { method: 'DELETE' }); setData((x) => ({ ...x, ...d })); return d }
  return { data, err, refresh, keep, remove }
}

// One of the two: its picture, or a pad to draw it on. Drawing again replaces it.
export function SignatureCard({ which, setup, compact = false, onKept }) {
  const meta = setup.data?.[which]
  const [drawing, setDrawing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const name = which === 'initials' ? t('Your initials') : t('Your signature')
  const save = async ({ png }) => {
    setBusy(true); setErr(null)
    try { await setup.keep(which, png); setDrawing(false); onKept?.() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(which === 'initials' ? t('Remove your initials from this computer?') : t('Remove your signature from this computer?'))) return
    setBusy(true); setErr(null)
    try { await setup.remove(which) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  // Until it's known whether there's one, neither "not drawn yet" nor a pad: a card waiting.
  if (!setup.data && !drawing) {
    return (
      <div className={`sd-sigcard${compact ? ' compact' : ''} waiting`} aria-busy="true">
        <span className="sd-sigcard-pic" />
        <span className="sd-sigcard-name"><b>{name}</b></span>
      </div>
    )
  }
  if (drawing || (!meta && compact)) {
    return (
      <div className="sd-sigcard drawing">
        <b className="sd-sigcard-name">{which === 'initials' ? t('Draw your initials') : t('Draw your signature')}</b>
        <SignPad what={which} busy={busy} onSave={save} onCancel={meta || !compact ? () => setDrawing(false) : null} />
        <p className="muted small sd-kept"><Icon name="info" size={11} /> {t(KEPT)}</p>
        {err && <p className="error-text small" role="alert">{t("Couldn't keep it: {error}", { error: err })}</p>}
      </div>
    )
  }
  return (
    <div className={`sd-sigcard${compact ? ' compact' : ''}`}>
      <span className="sd-sigcard-pic">{meta ? <img src={sigUrl(which, meta.at)} alt={name} /> : <span className="muted small">{t('Not drawn yet')}</span>}</span>
      <span className="sd-sigcard-name"><b>{name}</b>{!compact && <small className="muted">{meta ? t('Drawn {when}', { when: new Date(meta.at).toLocaleDateString(locale()) }) : which === 'initials' ? t('For pages that ask for your initials') : t('For the places you sign')}</small>}</span>
      <span className="sd-sigcard-acts">
        <button type="button" className="btn small" onClick={() => setDrawing(true)} disabled={busy || !setup.data}><Icon name="edit" size={12} /> {meta ? t('Draw again') : t('Draw it')}</button>
        {meta && <button type="button" className="ghost-btn" onClick={remove} disabled={busy} title={t('Remove it from this computer')} aria-label={which === 'initials' ? t('Remove your initials') : t('Remove your signature')}><Icon name="trash" size={12} /></button>}
      </span>
      {err && <p className="error-text small" role="alert">{err}</p>}
    </div>
  )
}

// On Studio's home: both, with what they're for and where they're kept.
export default function SignatureHome() {
  const setup = useSignSetup()
  return (
    <section className="sd-sec sd-sign-home" aria-busy={!setup.data && !setup.err}>
      <h3>{t('Signature Assist')}</h3>
      <p className="muted small">{t('Draw your signature and initials once. Then open a PDF you\'re asked to sign and press Sign: it says what you\'re signing in plain words, finds where your signature goes, and saves a signed copy in a _signed folder beside it.')}</p>
      {setup.err && !setup.data
        ? <p className="error-text small" role="alert">{setup.err} <button type="button" className="link-btn" onClick={setup.refresh}>{t('Try again')}</button></p>
        : (
          <div className="sd-sigcards">
            <SignatureCard which="signature" setup={setup} />
            <SignatureCard which="initials" setup={setup} />
          </div>
        )}
      <p className="muted small sd-kept"><Icon name="info" size={11} /> {t(KEPT)}</p>
    </section>
  )
}
