import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, settingsChanged } from '../../api.js'
import { SaveNote } from './General.jsx'
import { useBusy } from '../../busy.js'
import { Advanced } from './Advanced.jsx'
import { t } from '../../i18n/index.js'

// Settings › Config file: your config.json as text, checked before it's saved; under Advanced, the
// full effective settings (defaults merged with yours) and the defaults, for reference.
export default function ConfigFile() {
  const [s, setS] = useState(null)
  const [text, setText] = useState('')
  const [note, setNote] = useState(null)
  const [view, setView] = useState(null) // 'effective' | 'defaults'
  useEffect(() => { api('/settings').then((r) => { setS(r); setText(r.raw) }).catch((e) => setNote({ error: e.message })) }, [])
  // Changed and not saved: the desktop app doesn't update by itself meanwhile (busy.js).
  useBusy('file', !!s && text !== s.raw)
  if (!s) return <div className="skeleton-rows"><div /><div /><div /></div>

  let parseError = null
  try { const o = JSON.parse(text); if (!o || typeof o !== 'object' || Array.isArray(o)) parseError = 'The file must hold a JSON object ({ ... })' } catch (e) { parseError = e.message }
  const dirty = text !== s.raw
  const save = async () => {
    try { const r = await api('/settings/raw', { method: 'PUT', body: { text } }); setS(r.settings); setText(r.settings.raw); settingsChanged(); setNote(r.restart.length ? { restart: r.restart } : { saved: true }) } catch (e) { setNote({ error: e.message }) }
  }

  return (
    <div className="st-sections" data-setting="config-file">
      <div className="st-row between">
        <code className="st-path" title={s.file}>{s.file}</code>
        <button type="button" className="ghost-btn" onClick={() => navigator.clipboard?.writeText(s.file).catch(() => {})}><Icon name="copy" size={12} /> Copy path</button>
      </div>
      <p className="muted small" title={t('Only what you set goes here; everything else comes from the defaults. Most changes apply right away; {keys} apply after a restart.', { keys: s.restartKeys.join(', ') })}>{t("Only what you set; the rest comes from the defaults. API keys don't belong here: add them under Model Providers.")}</p>
      <textarea className="st-code" value={text} onChange={(e) => { setText(e.target.value); setNote(null) }} spellCheck={false} rows={16} aria-label="config.json" />
      <div className="st-row between">
        <span className={parseError ? 'error-text' : 'muted small'}>{parseError ? `Not valid yet: ${parseError}` : dirty ? 'Valid JSON, not saved' : 'Saved'}</span>
        <span className="st-row">
          {dirty && <button type="button" className="ghost-btn" onClick={() => { setText(s.raw); setNote(null) }}>Discard changes</button>}
          <button type="button" className="btn primary" disabled={!dirty || !!parseError} onClick={save}>Save</button>
        </span>
      </div>
      <SaveNote note={note} />
      <Advanced order={10}>
        <section className="st-sec" data-setting="config-effective">
          <h4>{t('Effective Settings and Defaults')}</h4>
          <div className="seg ap-seg">
            <button type="button" className={view === 'effective' ? 'on' : ''} onClick={() => setView(view === 'effective' ? null : 'effective')}>Effective settings</button>
            <button type="button" className={view === 'defaults' ? 'on' : ''} onClick={() => setView(view === 'defaults' ? null : 'defaults')}>Defaults</button>
          </div>
          {view && <pre className="st-code ro">{JSON.stringify(view === 'effective' ? s.effective : s.defaults, null, 2)}</pre>}
        </section>
      </Advanced>
    </div>
  )
}
