import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api } from '../api.js'
import { appVersion, newer } from '../permissions.js'
import { t } from '../i18n/index.js'

// What /api/updates says, with the desktop app this window is in counted too: it can be behind the
// server it shows (one run from your clone is as new as the clone, and the app around it only
// updates when asked). forApp: the update is the desktop app's, installed by that server
// (server/updates.js install({ app: true })). A newest release this Mac's macOS can't open (u.below)
// isn't offered to the app either: it's said once, as for the server's own (u.held).
export function withApp(u) {
  const v = appVersion()
  if (!u || u.available || u.held || !u.latest || !v || !newer(u.latest, v)) return u
  if (u.below) return { ...u, held: u.below, current: v, forApp: true }
  if (!u.appUpdate) return u
  return { ...u, available: true, current: v, forApp: true }
}
// Out a few days and still not installed: said more plainly, with the version on the chip.
const DAYS = 3
export const overdue = (u) => !!u?.available && !!u.publishedAt && Date.now() - Date.parse(u.publishedAt) > DAYS * 24 * 60 * 60 * 1000
// Update now: the whole app, or (forApp) the desktop app around a server run from your clone.
export const installUpdate = (u) => api('/updates/install', { method: 'POST', body: u?.forApp ? { app: true } : {} })

// The top bar's Update button: what's new and Update now, without going to Settings. A version this
// Mac's macOS can't open (u.held) is said once instead, until OK.
export default function UpdateChip({ u, onDetails, onDone }) {
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
    try { await installUpdate(u) } catch (e) { setState({ error: e.message }) }
  }
  const loud = overdue(u)
  // The release notes' first lines: the summary and the first few changes, each its label and
  // first sentence. Install is for new computers, not an update, so the notes stop there.
  const lines = String(u.notes || '').split(/^#+ Install\b/m)[0].split('\n').map((l) => l.trim()).filter((l) => l && !/^#/.test(l) && !/checksums/i.test(l))
  const summary = lines.find((l) => !l.startsWith('-')) || ''
  const items = lines.filter((l) => l.startsWith('- ')).slice(0, 4).map((l) => {
    const [, label = '', text = l.slice(2)] = l.slice(2).match(/^\*\*(.+?):?\*\*:?\s*(.*)$/) || []
    return { label, text: text.replace(/[`*]/g, '').split(/(?<=\.)\s/)[0] }
  })
  if (u.held) return (
    <div className="update-wrap" ref={ref}>
      <button className="top-chip" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('Bridge AI {version} needs macOS {macos}', { version: u.latest, macos: u.held.macos })}>
        <Icon name="info" size={13} /><span className="hide-sm">{t('Newer version')}</span>
      </button>
      {open && (
        <div className="update-pop" role="dialog" aria-label={t('Newer version')}>
          <div className="update-head"><b>Bridge AI {u.latest}</b><span className="muted small">{t('you have {version}', { version: u.current })}</span></div>
          <p className="small">{t('It needs macOS {macos} or later, and this Mac has macOS {have}. Bridge AI {current} keeps working as it is; update macOS to get newer versions.', { macos: u.held.macos, have: u.held.have, current: u.current })}</p>
          <div className="update-acts"><button type="button" className="btn small primary" onClick={() => { setOpen(false); onDone?.() }}>{t('OK')}</button><a className="small" href={u.url} target="_blank" rel="noreferrer">{t("What's new")}</a></div>
        </div>
      )}
    </div>
  )
  return (
    <div className="update-wrap" ref={ref}>
      <button className={`top-chip update-chip${loud ? ' loud' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('Bridge AI {latest} is available (you have {current})', { latest: u.latest, current: u.current })}>
        <Icon name="download" size={13} /><span className={loud ? '' : 'hide-sm'}>{loud ? t('Update to {version}', { version: u.latest }) : t('Update')}</span>
      </button>
      {open && (
        <div className="update-pop" role="dialog" aria-label={t('Update Bridge AI')}>
          <div className="update-head"><b>Bridge AI {u.latest}</b><span className="muted small">{t('you have {version}', { version: u.current })}</span></div>
          {u.forApp && <p className="small">{t('This is the desktop app\'s update: Bridge AI runs from your clone here, and the app around it is {version}.', { version: u.current })}</p>}
          {u.failed && !state && <p className="error-text small">{t('The last update didn\'t go through: {why}', { why: u.failed.line || t('the installer stopped') })}</p>}
          {summary && <p className="small">{summary}</p>}
          {items.length > 0 && <ul className="update-list small">{items.map((it, i) => <li key={i}>{it.label && <b>{it.label}: </b>}{it.text}</li>)}</ul>}
          {state === 'installing'
            ? <p className="st-note ok small"><Icon name="refresh" size={12} className="spin" /> {t('Updating. Bridge AI closes and reopens by itself in a few seconds; your agents carry on.')}</p>
            : u.how === 'app' || u.forApp
              ? <div className="update-acts"><button type="button" className="btn small primary" onClick={install}><Icon name="download" size={12} /> {u.failed ? t('Try again') : t('Update now')}</button><a className="small" href={u.url} target="_blank" rel="noreferrer">{t("What's new")}</a></div>
              : <div className="update-acts col"><p className="muted small">{u.how === 'source' ? t('Update your clone in a terminal:') : t('Update from a terminal:')}</p><code className="small">{u.command}</code><div className="update-acts"><button type="button" className="ghost-btn" onClick={() => navigator.clipboard?.writeText(u.command).catch(() => {})}><Icon name="copy" size={12} /> {t('Copy')}</button><a className="small" href={u.url} target="_blank" rel="noreferrer">{t("What's new")}</a></div></div>}
          {state?.error && <p className="error-text small">{state.error}</p>}
          <button type="button" className="link-btn small" onClick={() => { setOpen(false); onDetails() }}>{t('Update settings')}</button>
        </div>
      )}
    </div>
  )
}
