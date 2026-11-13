import { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, apiUrl, fmtRelative } from '../../api.js'
import { t } from '../../i18n/index.js'

// A board's versions (server/boards.js): the board as you left it before a break, as it was before
// each AI Assist change (named for it), before an agent's change, and before a version was put
// back. Each looked at as the picture it had (a click shows it larger), and put back with a click;
// what's there now is kept as a version first, so that can be undone too. onRestore(v): puts it
// back and draws it. dark: the pictures darkened to match, as the list's are.
const enc = encodeURIComponent
const who = (v) => (v.by === 'ai' ? (v.label ? t('Before AI Assist: {what}', { what: v.label }) : t('Before an AI Assist change'))
  : v.by === 'agent' ? t('Before an agent\'s change') : v.by === 'restored' ? t('Before a version was put back') : t('As you left it'))

export default function BoardVersions({ id, onRestore, onClose, dark = false }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [open, setOpen] = useState(null) // the version shown larger
  const load = useCallback(() => api(`/boards/${enc(id)}/versions`).then((r) => setList(r.versions || []), (e) => setErr(e.message)), [id])
  useEffect(() => { load() }, [load])
  const put = async (v) => {
    setBusy(v.id); setErr(null)
    try { await onRestore(v); await load() } catch (e) { setErr(t("Couldn't put it back: {error}", { error: e.message })) } finally { setBusy(null) }
  }
  return (
    <section className={`wb-settings wb-vers${dark ? ' dark' : ''}`} aria-label={t('Versions')}>
      <div className="wb-draw-head">
        <b>{t('Versions')}</b>
        <span className="muted small">{list ? (list.length === 1 ? t('1 kept') : t('{n} kept', { n: list.length })) : ''}</span>
        <span className="wb-grow" />
        <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={13} /></button>
      </div>
      <p className="muted small">{t('Kept when you come back to the board after a break, before each AI Assist change, and before one is put back. The newest first.')}</p>
      {list && !list.length && <p className="small wb-vers-none">{t('No versions yet: the first is kept the next time one of those happens.')}</p>}
      {!list && !err && <p className="muted small">{t('Loading…')}</p>}
      {list?.length > 0 && (
        <ol className="wb-vers-list">
          {list.map((v) => (
            <li key={v.id} className={open === v.id ? 'open' : ''}>
              <button type="button" className="wb-vers-pic" onClick={() => setOpen(open === v.id ? null : v.id)} aria-label={open === v.id ? t('Show it smaller') : t('Show it larger')} title={open === v.id ? t('Show it smaller') : t('Show it larger')} disabled={!v.picture}>
                {v.picture ? <img src={apiUrl(`/boards/${enc(id)}/versions/${enc(v.id)}/picture`)} alt="" loading="lazy" /> : <Icon name="shapes" size={16} />}
              </button>
              <span className="wb-vers-who"><b>{who(v)}</b><small className="muted">{fmtRelative(v.at)}</small></span>
              <button type="button" className="btn small" onClick={() => put(v)} disabled={!!busy}>{busy === v.id ? t('Putting back…') : t('Put back')}</button>
            </li>
          ))}
        </ol>
      )}
      {err && <p className="error-text small" role="alert">{err}</p>}
    </section>
  )
}
