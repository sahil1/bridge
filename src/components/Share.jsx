// Share Links (server/shares.js): a link for people outside your own devices, to a file, a folder
// (a site, read-only), a Studio document (always its latest) or an agent's app (usable, buttons
// included), through your relay, end-to-end encrypted. ShareDialog makes one (from Files, Studio and
// the Preview tab); SharesList is every link, as Settings › Sharing and Studio's Shared show them,
// with who opened each and Stop Sharing.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import CopyButton from './CopyButton.jsx'
import { api, usePoll, fmtRelative } from '../api.js'
import { t, tx } from '../i18n/index.js'
import { LASTS, LAST_DEFAULT } from '../../shared/shares.js'
import './share.css'

const LASTS_LABEL = { hour: tx('1 Hour'), day: tx('1 Day'), week: tx('7 Days') }
const KIND = { file: { icon: 'file', label: tx('File') }, folder: { icon: 'folder', label: tx('Folder') }, doc: { icon: 'doc', label: tx('Studio document') }, app: { icon: 'play', label: tx('App') } }
const when = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
const region = (c) => { try { return new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'region' }).of(c) || c } catch { return c } }
// What each open was, said.
const WHAT = { opened: tx('opened it'), 'wrong password': tx('typed a wrong password'), locked: tx('locked it (too many wrong passwords)'), 'code asked': tx('asked for a code'), 'wrong code': tx('typed a wrong code'), 'not on the list': tx('asked with an email it doesn\'t name') }

// The limits, said where a link is made and in Settings › Sharing.
export function limitsText(l) {
  if (!l) return ''
  return t('Up to {shares} links at once, each open on {viewers} devices at once. A file up to {size} GB. A password locks the link for {minutes} minutes after {tries} wrong tries; a code lasts {codeMinutes} minutes.', { shares: l.shares, viewers: l.viewers, size: l.fileMB / 1024, minutes: l.password.lockMinutes, tries: l.password.tries, codeMinutes: l.code.minutes })
}

// what: { kind: 'file' | 'folder' | 'doc' | 'app', root, path, name, port, pane }, on the computer this
// page is (another of yours shown here: its link goes through its own relay).
export function ShareDialog({ what, onClose }) {
  const call = api
  const [info, setInfo] = useState(null) // { can, limits, email }
  const [who, setWho] = useState('link')
  const [password, setPassword] = useState('')
  const [emails, setEmails] = useState('')
  const [lasts, setLasts] = useState(LAST_DEFAULT)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [made, setMade] = useState(null)
  useEffect(() => { call('/shares').then(setInfo, (e) => setErr(e.message)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  }, [onClose])
  const create = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const r = await call('/shares', { method: 'POST', body: { kind: what.kind, root: what.root, path: what.path, port: what.port, pane: what.pane, title: what.name, who, password: who === 'link' ? password : '', emails: who === 'people' ? emails : '', lasts } })
      setMade(r.share)
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const stop = async () => {
    setBusy(true)
    try { await call(`/shares/${encodeURIComponent(made.id)}/stop`, { method: 'POST' }); onClose() } catch (x) { setErr(x.message); setBusy(false) }
  }
  const html = what.kind === 'file' && /\.html?$/i.test(what.name || '')
  const about = what.kind === 'app' ? null
    : what.kind === 'folder' ? t('Its files are shared read-only, as a site: its index.html opens first, or a list of what\'s in it. Hidden files (names starting with a dot) aren\'t shared.')
      : what.kind === 'doc' ? t('View-only, and always its latest version: what you change shows on their screen as you save.')
        : html ? t('Only this file is shared, not what it links to. To share the pictures and pages it links to as well, share its folder.')
          : t('Only this file is shared, read-only.')
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal share-dialog" role="dialog" aria-label={t('Share {name}', { name: what.name })}>
        <header className="modal-head"><h3><Icon name="link" size={15} /> {t('Share {name}', { name: what.name })}</h3></header>
        {!made && info && !info.can.ok && (
          <div className="share-body">
            <p className="st-note warn" role="alert"><Icon name="alert" size={13} /> {info.can.text}</p>
            <div className="modal-foot">
              {info.can.why !== 'full' && <button type="button" className="btn small" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'phone' } })) }}>{t('Open Settings › Devices')}</button>}
              <button type="button" className="btn small primary" onClick={onClose}>{t('Close')}</button>
            </div>
          </div>
        )}
        {!made && (!info || info.can.ok) && (
          <form className="share-body" onSubmit={create}>
            <p className="muted small">{t('A link for people outside your devices. It goes through your relay, end-to-end encrypted, and works while this computer is on.')}</p>
            {about && <p className="muted small">{about}</p>}
            {what.kind === 'app' && <p className="st-note warn"><Icon name="alert" size={13} /> {t('Whoever opens it can use the app as you could here, buttons included: what it does, it does for real. Its logins and cookies aren\'t passed on.')}</p>}
            <fieldset className="share-who">
              <legend>{t('Who can open it')}</legend>
              <label className="share-pick"><input type="radio" name="who" checked={who === 'link'} onChange={() => setWho('link')} /> <b>{t('Anyone With the Link')}</b></label>
              {who === 'link' && (
                <div className="share-sub">
                  <input className="st-input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('Password (optional)')} aria-label={t('Password (optional)')} />
                  <span className="muted small">{info ? t('At least {n} characters. Tell them it yourself, not with the link.', { n: info.limits.password.min }) : ''}</span>
                </div>
              )}
              <label className="share-pick"><input type="radio" name="who" checked={who === 'people'} onChange={() => setWho('people')} /> <b>{t('Only These People')}</b></label>
              {who === 'people' && (
                <div className="share-sub">
                  <textarea className="st-input" rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={t('Their emails, separated by commas')} aria-label={t('Their emails, separated by commas')} spellCheck={false} />
                  <span className="muted small">{info?.email ? t('Each gets a 6-digit code by email before anything shows, sent by Bold Bridge from your account.') : t('Each asks for a 6-digit code before anything shows. This computer isn\'t signed in to Bold Bridge, so your devices get each code to pass on.')}</span>
                </div>
              )}
            </fieldset>
            <fieldset className="share-lasts">
              <legend>{t('How long it lasts')}</legend>
              <div className="seg" role="radiogroup" aria-label={t('How long it lasts')}>
                {LASTS.map((l) => <button key={l.id} type="button" role="radio" aria-checked={lasts === l.id} className={lasts === l.id ? 'on' : ''} onClick={() => setLasts(l.id)}>{t(LASTS_LABEL[l.id])}</button>)}
              </div>
            </fieldset>
            {info && <p className="muted small">{limitsText(info.limits)}</p>}
            {err && <p className="error-text small" role="alert">{err}</p>}
            <div className="modal-foot">
              <button type="button" className="btn small" onClick={onClose}>{t('Cancel')}</button>
              <button type="submit" className="btn small primary" disabled={busy || !info}>{busy ? t('Making it…') : t('Create Link')}</button>
            </div>
          </form>
        )}
        {made && (
          <div className="share-body">
            <p>{made.who === 'people' ? t('Only {people} can open it, each with a code sent to their email.', { people: made.emails.join(', ') }) : made.password ? t('Anyone with the link and the password can open it.') : t('Anyone with the link can open it.')} {t('It ends {when}.', { when: when(made.ends) })}</p>
            <div className="share-made">
              {made.qr && <div className="ph-qr share-qr" aria-label={t('QR code for the link')} dangerouslySetInnerHTML={{ __html: made.qr }} />}
              <div className="share-link">
                <input className="st-input mono" readOnly value={made.link} aria-label={t('The link')} onFocus={(e) => e.target.select()} />
                <div className="st-row"><CopyButton text={made.link} label={t('Copy Link')} className="btn small primary" /></div>
                <p className="muted small">{t('Anyone you pass it to can open it. You see each open in Settings › Sharing, and your devices hear of the first.')}</p>
              </div>
            </div>
            {err && <p className="error-text small" role="alert">{err}</p>}
            <div className="modal-foot">
              <button type="button" className="btn small share-stop" onClick={stop} disabled={busy}>{t('Stop Sharing')}</button>
              <button type="button" className="btn small primary" onClick={onClose}>{t('Done')}</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// Every link: what it shows, who may open it, when it ends, who has it open, its last opens, and
// Stop Sharing (which ends their pages at once).
export function SharesList() {
  const { data, error, refresh } = usePoll('/shares', 4000)
  const [err, setErr] = useState(null)
  const [qr, setQr] = useState(null) // the link whose QR code shows
  const act = async (fn) => { setErr(null); try { await fn(); refresh() } catch (x) { setErr(x.message) } }
  if (error && !data) return <p className="st-note bad"><Icon name="alert" size={13} /> {error}</p>
  if (!data) return <div className="skeleton-rows"><div /><div /></div>
  const list = data.shares || []
  const on = list.filter((s) => !s.ended)
  const done = list.filter((s) => s.ended)
  const row = (s) => {
    const k = KIND[s.kind] || KIND.file
    return (
      <li key={s.id} className={`share-row${s.ended ? ' ended' : ''}`} data-share={s.id}>
        <div className="share-row-head">
          <Icon name={k.icon} size={15} />
          <b className="share-title">{s.title}</b>
          <span className="muted small">{t(k.label)}{s.what ? ` · ${s.what}` : ''}</span>
        </div>
        <div className="muted small share-meta">
          {s.who === 'people' ? t('Only {people}', { people: s.emails.join(', ') }) : s.password ? t('Anyone with the link and its password') : t('Anyone with the link')}
          {' · '}
          {s.ended ? (s.ended === 'expired' ? t('Ended {when}', { when: when(s.endedAt || s.ends) }) : t('Stopped {when}', { when: when(s.endedAt) })) : t('Ends {when}', { when: when(s.ends) })}
          {!s.ended && s.open > 0 && <> · <b>{s.open === 1 ? t('Open on 1 device now') : t('Open on {n} devices now', { n: s.open })}</b></>}
          {s.locked && <> · {t('Locked until {when} after wrong passwords', { when: when(s.locked) })}</>}
          {s.by && <> · {t('Made on {device}', { device: s.by })}</>}
        </div>
        {s.link && (
          <div className="st-row share-row-link">
            <input className="st-input mono" readOnly value={s.link} aria-label={t('The link')} onFocus={(e) => e.target.select()} />
            <CopyButton text={s.link} label={t('Copy Link')} />
            <button type="button" className="ghost-btn" onClick={() => setQr(qr === s.id ? null : s.id)} aria-pressed={qr === s.id}>{t('QR Code')}</button>
            <button type="button" className="ghost-btn share-stop" onClick={() => act(() => api(`/shares/${encodeURIComponent(s.id)}/stop`, { method: 'POST' }))}>{t('Stop Sharing')}</button>
          </div>
        )}
        {qr === s.id && s.qr && <div className="ph-qr share-qr" aria-label={t('QR code for the link')} dangerouslySetInnerHTML={{ __html: s.qr }} />}
        {s.opens.length > 0 ? (
          <details className="share-opens">
            <summary className="small">{t('Opens and tries ({n})', { n: s.opens.length })}</summary>
            <ul>
              {s.opens.map((o, i) => <li key={i} className="small"><span className="muted">{fmtRelative(new Date(o.at).toISOString())}</span> {o.email || t('Someone')} {t(WHAT[o.what] || o.what)}{o.country ? ` · ${region(o.country)}` : ''}</li>)}
            </ul>
          </details>
        ) : !s.ended && <p className="muted small">{t('Nobody has opened it yet.')}</p>}
        {s.ended && <div><button type="button" className="ghost-btn" onClick={() => act(() => api(`/shares/${encodeURIComponent(s.id)}`, { method: 'DELETE' }))}>{t('Remove from the List')}</button></div>}
      </li>
    )
  }
  return (
    <div className="shares">
      {!data.can.ok && data.can.why !== 'full' && <p className="st-note warn"><Icon name="alert" size={13} /> {data.can.text}</p>}
      {err && <p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {err}</p>}
      {on.length ? <ul className="share-list">{on.map(row)}</ul> : <p className="muted small">{t('Nothing is shared now. Share a file or a folder from Files, a document from Studio, or an agent\'s app from its Preview tab.')}</p>}
      {done.length > 0 && (
        <details className="share-ended">
          <summary className="small">{t('Ended ({n})', { n: done.length })}</summary>
          <ul className="share-list">{done.map(row)}</ul>
        </details>
      )}
      <p className="muted small">{limitsText(data.limits)}</p>
    </div>
  )
}
