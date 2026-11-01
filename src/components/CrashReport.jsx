import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { api } from '../api.js'
import { t } from '../i18n/index.js'
import { reportText, scrub, issueLink } from '../../shared/crashreport.js'
import './crashReport.css'

// Report a crash on GitHub: the issue Bridge AI would file, shown in full to read and change, then
// opened on GitHub's new-issue page for the person to send there, or not. Bridge AI sends nothing.
// The server writes the text, with names, folders, emails and keys taken out (server/crashes.js);
// when the server can't answer, the page writes it from what it has, taking out what it can.
// crash: { kind: 'ui', where, message, stack } from the crash screen, or { kind: 'last' } for the
// crash the server kept (its own, or the desktop app's window).
export default function CrashReport({ crash, onClose, onSent }) {
  const [r, setR] = useState(null) // { title, what, details }
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    api('/crashes/report', { method: 'POST', body: { ...crash, language: navigator.language } })
      .then((x) => setR({ title: x.title, what: x.what, details: x.details }))
      .catch(() => {
        const x = reportText({ ...crash, kind: crash.kind === 'last' ? 'server' : crash.kind, at: new Date().toISOString() }, { about: { version: crash.version, system: navigator.userAgent, language: navigator.language } })
        setR({ title: scrub(x.title), what: scrub(x.what), details: scrub(x.details) })
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const link = r ? issueLink(r) : null
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }, () => {})
  const set = (k) => (e) => setR((x) => ({ ...x, [k]: e.target.value }))
  return (
    <div className="modal-backdrop crash-report-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal crash-report" role="dialog" aria-modal="true" aria-labelledby="cr-title">
        <header className="modal-head">
          <Icon name="flag" size={15} />
          <h3 id="cr-title">{t('Report on GitHub')}</h3>
          <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={14} /></button>
        </header>
        <p className="muted small">{t('This is the issue that opens on GitHub, all of it. Read it and change anything you like: nothing is sent until you send it there yourself. Names, folders, emails and keys are taken out.')}</p>
        {!r ? <div className="skeleton-rows"><div /><div /><div /></div> : (
          <>
            <label className="cr-field"><span>{t('Title')}</span><input value={r.title} onChange={set('title')} /></label>
            <label className="cr-field"><span>{t('What happened')}</span><textarea rows={3} value={r.what} onChange={set('what')} /></label>
            <label className="cr-field"><span>{t('Details')}</span><textarea className="cr-details" rows={10} value={r.details} onChange={set('details')} spellCheck={false} /></label>
            {!link.fits && <p className="cr-long"><Icon name="info" size={13} /><span>{t('This is too long for a link to GitHub, so Open on GitHub copies the details first: paste them into Details there.')}</span></p>}
          </>
        )}
        <footer className="modal-foot">
          <button type="button" className="ghost-btn" disabled={!r} onClick={() => copy(`${r.title}\n\n${r.what}\n\n${r.details}`)}><Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? t('Copied') : t('Copy')}</button>
          <button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button>
          {r && <a className="btn primary cr-open" href={link.url} target="_blank" rel="noreferrer" onClick={() => { if (!link.fits) navigator.clipboard?.writeText(r.details).catch(() => {}); onSent?.() }}><Icon name="external" size={13} /> {t('Open on GitHub')}</a>}
        </footer>
      </div>
    </div>
  )
}

// The button beside Copy details, on the crash screen and a view that broke.
export function ReportButton({ where, error, stack, version }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="ghost-btn" onClick={() => setOpen(true)}><Icon name="flag" size={12} /> {t('Report on GitHub')}</button>
      {open && <CrashReport crash={{ kind: 'ui', where: where || 'view', message: String(error?.message || error), stack: stack || String(error?.stack || ''), version }} onClose={() => setOpen(false)} />}
    </>
  )
}

const SAID = {
  server: () => t("Bridge AI's server stopped unexpectedly and started again"),
  window: () => t('This window stopped unexpectedly and was opened again'),
  gpu: () => t("The desktop app's graphics stopped unexpectedly"),
}
// After a crash Bridge AI came back from (its server, or the desktop app's window or graphics):
// once, a card offering to report it, until it's reported or put away.
export function CrashNotice() {
  const [c, setC] = useState(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { api('/crashes').then((x) => setC(x?.crash || null), () => {}) }, [])
  if (!c || !SAID[c.kind]) return null
  const dismiss = () => { setC(null); setOpen(false); api('/crashes/dismiss', { method: 'POST' }).catch(() => {}) }
  return (
    <>
      {!open && (
        <div className="crash-notice" role="status">
          <Icon name="alert" size={15} />
          <div className="crash-notice-text">
            <b>{SAID[c.kind]()}</b>
            <span className="muted small">{t('Reporting it on GitHub helps get it fixed. You see the whole report first, and nothing is sent by itself.')}</span>
          </div>
          <div className="crash-notice-acts">
            <button type="button" className="btn small" onClick={() => setOpen(true)}><Icon name="flag" size={12} /> {t('Report on GitHub')}</button>
            <button type="button" className="ghost-btn small" onClick={dismiss}>{t('Not now')}</button>
          </div>
        </div>
      )}
      {open && <CrashReport crash={{ kind: 'last', version: c.version }} onClose={() => setOpen(false)} onSent={dismiss} />}
    </>
  )
}
