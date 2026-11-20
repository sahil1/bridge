import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import CopyButton from './CopyButton.jsx'
import { api } from '../api.js'
import { appVersion, newer } from '../permissions.js'
import { t, locale } from '../i18n/index.js'

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
// What kind of build a version is: a nightly build of main, a beta, or (null) a release.
export const channelTag = (v) => (/-nightly\./.test(v || '') ? t('Nightly build') : /-(alpha|beta|rc)\./.test(v || '') ? t('Beta') : null)

// A version as people read it, never the whole string: 3.22.0, 3.22.0 Beta 2, and a nightly by the
// run that built it (3.21.1-nightly.20261119.16 is Nightly 16; each run's number is higher than the
// last). title: the card's first line, with what a nightly is of (Bridge AI 3.21.1 · Nightly 16).
const NIGHTLY = /^v?(\d+\.\d+\.\d+)-nightly\.(\d{4})(\d{2})(\d{2})\.(\d+)$/
const PRE = /^v?(\d+\.\d+\.\d+)-([a-z]+)\.(\d+)$/i
const kindOf = (v) => {
  const s = String(v || '').trim()
  const n = s.match(NIGHTLY)
  if (n) return { core: n[1], kind: t('Nightly {n}', { n: n[5] }), nightly: true }
  const p = s.match(PRE)
  if (p) return { core: p[1], kind: p[2].toLowerCase() === 'beta' ? t('Beta {n}', { n: p[3] }) : `${p[2].toUpperCase()} ${p[3]}` }
  return { core: s.replace(/^v/, ''), kind: null }
}
export const versionName = (v) => { const k = kindOf(v); return k.nightly ? k.kind : k.kind ? `${k.core} ${k.kind}` : k.core }
export const versionTitle = (v) => { const k = kindOf(v); return `Bridge AI ${k.core}${k.kind ? ` · ${k.kind}` : ''}` }
// The day it came out, short (19 Nov, in the language picked): GitHub's date, else a nightly's own.
const dayOf = (u) => {
  const n = String(u.latest || '').match(NIGHTLY)
  const at = u.publishedAt ? new Date(u.publishedAt) : n ? new Date(Date.UTC(+n[2], +n[3] - 1, +n[4], 12)) : null
  return at && !Number.isNaN(at.getTime()) ? at.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : null
}

// What the release's notes say first, for the card: its highlights, the top-level lines ("- **Bots:**
// …", or "- Bots: …"), each its label and first sentence, at most `max`; and its first paragraph, for
// notes without any. Lines about the tests, CI or the docs are left out (older nightlies listed
// every commit), and so is Install, which is for new computers, not an update.
const QUIET = /^(tests?|ci|docs?)\b/i
export function highlights(notes, max = 4) {
  const lines = String(notes || '').replace(/\r\n/g, '\n').split(/^#+ Install\b/m)[0].split('\n')
  const items = []
  for (const l of lines) {
    if (items.length >= max) break
    if (!/^[-*] \S/.test(l)) continue // a point under another is part of it
    const s = l.slice(2).trim()
    const m = s.match(/^\*\*(.+?)\*\*(?:\s*\([^)]*\))?:?\s*(.*)$/) || s.match(/^([^:*`]{2,48}):\s+(.+)$/)
    const name = m?.[1].replace(/:$/, '').trim() || ''
    const label = name.split(/\s+/).length <= 6 ? name : '' // a few words, or it's a sentence
    const text = (label ? m[2] : s).replace(/[`*]/g, '').trim()
    // A heading of points under it ("- **Studio's files as Finder has them**:"): its name alone.
    if (QUIET.test(label || text) || (!text && !label)) continue
    items.push({ label, text: text.split(/(?<=[.!?])\s/)[0] })
  }
  const summary = lines.map((l) => l.trim()).find((l) => l && !/^([-*] |#|<!--)/.test(l) && !/checksums/i.test(l)) || ''
  return { items, summary: summary.split(/(?<=[.!?])\s/)[0] }
}

// Out a few days and still not installed: said more plainly, with the version on the chip.
const DAYS = 3
export const overdue = (u) => !!u?.available && !!u.publishedAt && Date.now() - Date.parse(u.publishedAt) > DAYS * 24 * 60 * 60 * 1000
// Update now: the whole app, or (forApp) the desktop app around a server run from your clone.
export const installUpdate = (u) => api('/updates/install', { method: 'POST', body: u?.forApp ? { app: true } : {} })

// The card's first lines: the version, short, and under it when it came out, the channel when it's
// Early Access (a nightly's name says it already), and the version you have.
function Head({ u }) {
  const meta = [dayOf(u), u.channel === 'early' ? t('Early Access') : null, t('you have {version}', { version: versionName(u.current) })].filter(Boolean)
  return (
    <div className="update-head">
      <b className="update-title" title={`Bridge AI ${u.latest}`}>{versionTitle(u.latest)}</b>
      <span className="update-meta" title={t('you have {version}', { version: u.current })}>{meta.join(' · ')}</span>
    </div>
  )
}
const News = ({ u }) => u.url ? <a className="small" href={u.url} target="_blank" rel="noreferrer">{t("What's new")}</a> : null

// The top bar's Update button: what's new and Update now, without going to Settings. A version this
// Mac's macOS can't open (u.held) is said once instead, until OK. row: a row of the Status menu
// (StatusMenu.jsx), its details opening under it.
export default function UpdateChip({ u, onDetails, onDone, row = false }) {
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
  const name = versionName(u.latest)
  if (u.held) return (
    <div className="update-wrap" ref={ref}>
      {row
        ? <button type="button" className="status-row" onClick={() => setOpen((o) => !o)} aria-expanded={open}><Icon name="info" size={14} /><span className="status-row-text">{t('Bridge AI {version} needs macOS {macos}', { version: name, macos: u.held.macos })}</span><Icon name="chevron" size={13} className="status-go" /></button>
        : <button className="top-chip" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('Bridge AI {version} needs macOS {macos}', { version: u.latest, macos: u.held.macos })}>
          <Icon name="info" size={13} /><span className="pin-word">{t('Newer version')}</span>
        </button>}
      {open && (
        <div className="update-pop" role="dialog" aria-label={t('Newer version')}>
          <Head u={u} />
          <p className="small update-why">{t('It needs macOS {macos} or later, and this Mac has macOS {have}. Bridge AI {current} keeps working as it is; update macOS to get newer versions.', { macos: u.held.macos, have: u.held.have, current: versionName(u.current) })}</p>
          <div className="update-acts"><button type="button" className="btn small primary" onClick={() => { setOpen(false); onDone?.() }}>{t('OK')}</button><News u={u} /></div>
        </div>
      )}
    </div>
  )
  const { items, summary } = highlights(u.notes)
  return (
    <div className="update-wrap" ref={ref}>
      {row
        ? <button type="button" className="status-row update-row" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('Bridge AI {latest} is available (you have {current})', { latest: u.latest, current: u.current })}><Icon name="download" size={14} /><span className="status-row-text">{t('Bridge AI {version} is available', { version: name })}</span><Icon name="chevron" size={13} className="status-go" /></button>
        : <button className={`top-chip update-chip${loud ? ' loud' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('Bridge AI {latest} is available (you have {current})', { latest: u.latest, current: u.current })}>
          <Icon name="download" size={13} /><span className={loud ? 'pin-long' : 'pin-word'}>{loud ? t('Update to {version}', { version: name }) : t('Update')}</span>
        </button>}
      {open && (
        <div className="update-pop" role="dialog" aria-label={t('Update Bridge AI')}>
          <Head u={u} />
          {u.forApp && <p className="small update-why">{t('This is the desktop app\'s update: Bridge AI runs from your clone here, and the app around it is {version}.', { version: versionName(u.current) })}</p>}
          {u.failed && !state && <p className="error-text small">{t('The last update didn\'t go through: {why}', { why: u.failed.line || t('the installer stopped') })}</p>}
          {items.length > 0
            ? <ul className="update-list">{items.map((it, i) => <li key={i} title={[it.label, it.text].filter(Boolean).join(': ')}>{it.label && <b>{it.text ? `${it.label}:` : it.label}</b>}{it.label && it.text ? ' ' : ''}{it.text}</li>)}</ul>
            : summary && <p className="small update-summary">{summary}</p>}
          {state === 'installing'
            ? <p className="st-note ok small"><Icon name="refresh" size={12} className="spin" /> {t('Updating. Bridge AI closes and reopens by itself in a few seconds; your agents carry on.')}</p>
            : u.how === 'app' || u.forApp
              ? <div className="update-acts"><button type="button" className="btn small primary" onClick={install}><Icon name="download" size={12} /> {u.failed ? t('Try again') : t('Update now')}</button><News u={u} /></div>
              : <div className="update-acts col"><p className="muted small">{u.how === 'source' ? t('Update your clone in a terminal:') : t('Update from a terminal:')}</p><code className="small">{u.command}</code><div className="update-acts"><CopyButton text={u.command} /><News u={u} /></div></div>}
          {state?.error && <p className="error-text small">{state.error}</p>}
          <div className="update-foot"><button type="button" className="link-btn small" onClick={() => { setOpen(false); onDetails() }}>{t('Update settings')}</button></div>
        </div>
      )}
    </div>
  )
}
