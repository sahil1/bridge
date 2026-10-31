import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, settingsChanged } from '../../api.js'
import { SaveNote } from './General.jsx'

// Settings › Config file: your config.json as text, checked before it's saved, plus the full
// effective settings (defaults merged with yours) and the defaults, for reference.
export default function ConfigFile() {
  const [s, setS] = useState(null)
  const [text, setText] = useState('')
  const [note, setNote] = useState(null)
  const [view, setView] = useState(null) // 'effective' | 'defaults'
  useEffect(() => { api('/settings').then((r) => { setS(r); setText(r.raw) }).catch((e) => setNote({ error: e.message })) }, [])
  if (!s) return <div className="skeleton-rows"><div /><div /><div /></div>

  let parseError = null
  try { const o = JSON.parse(text); if (!o || typeof o !== 'object' || Array.isArray(o)) parseError = 'The file must hold a JSON object ({ ... })' } catch (e) { parseError = e.message }
  const dirty = text !== s.raw
  const save = async () => {
    try { const r = await api('/settings/raw', { method: 'PUT', body: { text } }); setS(r.settings); setText(r.settings.raw); settingsChanged(); setNote(r.restart.length ? { restart: r.restart } : { saved: true }) } catch (e) { setNote({ error: e.message }) }
  }

  return (
    <div className="st-sections">
      <div className="st-row between">
        <code className="st-path" title={s.file}>{s.file}</code>
        <button type="button" className="ghost-btn" onClick={() => navigator.clipboard?.writeText(s.file).catch(() => {})}><Icon name="copy" size={12} /> Copy path</button>
      </div>
      <p className="muted small">Only what you set goes here; everything else comes from the defaults. Most changes apply right away; {s.restartKeys.join(', ')} apply after a restart. API keys don't belong here: add them under Model Providers.</p>
      <textarea className="st-code" value={text} onChange={(e) => { setText(e.target.value); setNote(null) }} spellCheck={false} rows={16} aria-label="config.json" />
      <div className="st-row between">
        <span className={parseError ? 'error-text' : 'muted small'}>{parseError ? `Not valid yet: ${parseError}` : dirty ? 'Valid JSON, not saved' : 'Saved'}</span>
        <span className="st-row">
          {dirty && <button type="button" className="ghost-btn" onClick={() => { setText(s.raw); setNote(null) }}>Discard changes</button>}
          <button type="button" className="btn primary" disabled={!dirty || !!parseError} onClick={save}>Save</button>
        </span>
      </div>
      <SaveNote note={note} />
      <div className="seg ap-seg">
        <button type="button" className={view === 'effective' ? 'on' : ''} onClick={() => setView(view === 'effective' ? null : 'effective')}>Effective settings</button>
        <button type="button" className={view === 'defaults' ? 'on' : ''} onClick={() => setView(view === 'defaults' ? null : 'defaults')}>Defaults</button>
      </div>
      {view && <pre className="st-code ro">{JSON.stringify(view === 'effective' ? s.effective : s.defaults, null, 2)}</pre>}
    </div>
  )
}
