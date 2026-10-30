import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api } from '../api.js'
import { t } from '../i18n/index.js'

// The top bar's Update button: what's new and Update now, without going to Settings.
export default function UpdateChip({ u, onDetails }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState(null) // installing | { error }
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const down = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key) }
  }, [open])
  const install = async () => {
    setState('installing')
    try { await api('/updates/install', { method: 'POST' }) } catch (e) { setState({ error: e.message }) }
  }
  // The release notes' first lines: the summary and the first few changes, each its label and
  // first sentence. Install is for new computers, not an update, so the notes stop there.
  const lines = String(u.notes || '').split(/^#+ Install\b/m)[0].split('\n').map((l) => l.trim()).filter((l) => l && !/^#/.test(l) && !/checksums/i.test(l))
  const summary = lines.find((l) => !l.startsWith('-')) || ''
  const items = lines.filter((l) => l.startsWith('- ')).slice(0, 4).map((l) => {
    const [, label = '', text = l.slice(2)] = l.slice(2).match(/^\*\*(.+?):?\*\*:?\s*(.*)$/) || []
    return { label, text: text.replace(/[`*]/g, '').split(/(?<=\.)\s/)[0] }
  })
  return (
    <div className="update-wrap" ref={ref}>
      <button className="top-chip update-chip" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('Bridge AI {latest} is available (you have {current})', { latest: u.latest, current: u.current })}>
        <Icon name="download" size={13} /><span className="hide-sm">{t('Update')}</span>
      </button>
      {open && (
        <div className="update-pop" role="dialog" aria-label={t('Update Bridge AI')}>
          <div className="update-head"><b>Bridge AI {u.latest}</b><span className="muted small">{t('you have {version}', { version: u.current })}</span></div>
          {summary && <p className="small">{summary}</p>}
          {items.length > 0 && <ul className="update-list small">{items.map((it, i) => <li key={i}>{it.label && <b>{it.label}: </b>}{it.text}</li>)}</ul>}
          {state === 'installing'
            ? <p className="st-note ok small"><Icon name="refresh" size={12} className="spin" /> {t('Updating. Bridge AI closes and reopens by itself in a few seconds; your agents carry on.')}</p>
            : u.how === 'app'
              ? <div className="update-acts"><button type="button" className="btn small primary" onClick={install}><Icon name="download" size={12} /> {t('Update now')}</button><a className="small" href={u.url} target="_blank" rel="noreferrer">{t("What's new")}</a></div>
              : <div className="update-acts col"><p className="muted small">{u.how === 'source' ? t('Update your clone in a terminal:') : t('Update from a terminal:')}</p><code className="small">{u.command}</code><div className="update-acts"><button type="button" className="ghost-btn" onClick={() => navigator.clipboard?.writeText(u.command).catch(() => {})}><Icon name="copy" size={12} /> {t('Copy')}</button><a className="small" href={u.url} target="_blank" rel="noreferrer">{t("What's new")}</a></div></div>}
          {state?.error && <p className="error-text small">{state.error}</p>}
          <button type="button" className="link-btn small" onClick={() => { setOpen(false); onDetails() }}>{t('Update settings')}</button>
        </div>
      )}
    </div>
  )
}
