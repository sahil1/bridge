import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, BASE, onThisComputer } from '../../api.js'
import PermissionFix from '../PermissionFix.jsx'
import { clock } from './recording.jsx'
import { t, locale } from '../../i18n/index.js'

// A meeting's Files tab: the files, links and emails that go with it (the deck linked in the
// invite, the SOW on your computer, the follow-up email with its files), and the pictures of the
// screen. Each file is linked where it is, not copied, and read when the notes are written
// (server meetings.js). Add more: a link or a file's path, files picked or dropped on the meeting,
// or what Mail has about it.

const app = () => window.bridgeApp || {}
// On the computer the meetings are on (the desktop app, or a page on it): files open there.
const here = onThisComputer
const ICON = { file: 'file', url: 'link', mail: 'mail' }
const when = (iso) => (iso ? new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) : '')

// Files from a drop or a picker: linked where they are in the desktop app (it knows the path);
// from a browser, which doesn't say where a file is, a copy is kept with the meeting.
export async function linkFiles(id, files) {
  let n = 0
  for (const f of files) {
    const p = app().pathOf?.(f)
    if (p) await api(`/meetings/${encodeURIComponent(id)}/links`, { method: 'POST', body: { path: p } })
    else {
      const r = await fetch(`${BASE}/api/meetings/${encodeURIComponent(id)}/files?name=${encodeURIComponent(f.name || 'File')}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || t("Couldn't add {name}", { name: f.name }))
    }
    n++
  }
  return n
}

function Row({ id, l, onChange, onMsg }) {
  const base = `/meetings/${encodeURIComponent(id)}/links/${l.id}`
  const gone = l.kind === 'file' && l.exists === false
  const open = async (reveal = false) => {
    if (l.kind === 'url') return window.open(l.url, '_blank', 'noopener')
    if (l.kind === 'file' && !here()) { window.open(`/api${base}/file`, '_blank', 'noopener'); return }
    try { await api(`${base}/open`, { method: 'POST', body: { reveal } }) } catch (e) { onMsg({ error: true, text: e.message }) }
  }
  const remove = async () => { try { await api(base, { method: 'DELETE' }); onChange() } catch (e) { onMsg({ error: true, text: e.message }) } }
  const from = l.from === 'invite' ? t('From the invite') : l.from === 'mail' || l.mail ? (l.mail?.from ? t("From {name}'s email", { name: l.mail.from }) : t('From an email')) : ''
  const tip = [l.kind === 'file' ? l.path : l.kind === 'url' ? l.url : `${l.mail?.from ? t('Email from {name}', { name: l.mail.from }) : t('Email')}${l.mail?.received ? `, ${when(l.mail.received)}` : ''}`, from, gone ? t("It isn't where it was: move it back, or remove it here.") : l.kind === 'file' && l.readable === false ? t("Its words can't be read for the notes, but it's linked.") : ''].filter(Boolean).join('\n')
  const where = l.kind === 'file' ? l.path.replace(/^\/Users\/[^/]+/, '~') : l.kind === 'url' ? l.url : `${l.mail?.from ? t('From {name}', { name: l.mail.from }) : t('An email')}${l.mail?.received ? `, ${when(l.mail.received)}` : ''}${l.mail?.files?.length ? ` · ${l.mail.files.join(', ')}` : ''}`
  return (
    <div className={`mt-file ${l.kind}${gone ? ' gone' : ''}`}>
      <span className="mt-file-icon"><Icon name={ICON[l.kind] || 'file'} size={14} /></span>
      <button type="button" className="mt-file-main" onClick={() => open()} title={tip}>
        <span className="mt-file-name">{l.name}{l.from === 'invite' && <small>{t('invite')}</small>}{(l.from === 'mail' || l.kind === 'mail') && <small>{t('email')}</small>}</span>
        <span className="mt-file-where">{gone ? t('Not where it was. Move it back, or remove it here.') : where}</span>
      </button>
      {l.kind === 'file' && here() && !gone && <button type="button" className="win-btn" onClick={() => open(true)} aria-label={t('Show {name} in Finder', { name: l.name })} title={t('Show it in Finder')}><Icon name="folder-open" size={13} /></button>}
      <button type="button" className="win-btn" onClick={remove} aria-label={t('Remove {name}', { name: l.name })} title={t('Remove from this meeting (the file stays where it is)')}><Icon name="x" size={13} /></button>
    </div>
  )
}

// Attach: a link or a file's path, files from a picker, and what Mail has about the meeting.
function Attach({ id, onChange, onMsg }) {
  const [text, setText] = useState('')
  const [sug, setSug] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const load = () => api(`/meetings/${encodeURIComponent(id)}/suggest`).then(setSug).catch(() => setSug({ mail: [] }))
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn, said) => {
    setBusy(true); setErr(null)
    try { await fn(); onChange(); if (said) onMsg({ text: said }); load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const add = (e) => {
    e.preventDefault()
    const v = text.trim()
    if (!v) return
    setText('')
    run(async () => { try { await api(`/meetings/${encodeURIComponent(id)}/links`, { method: 'POST', body: /^https?:\/\//i.test(v) ? { url: v } : { path: v } }) } catch (err) { setText((cur) => cur || v); throw err } })
  }
  const pick = () => run(async () => {
    const paths = await app().pickFiles?.()
    for (const p of paths || []) await api(`/meetings/${encodeURIComponent(id)}/links`, { method: 'POST', body: { path: p } })
  })
  const upload = (e) => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) run(() => linkFiles(id, files), files.length === 1 ? t('Added {n} file.', { n: files.length }) : t('Added {n} files.', { n: files.length })) }
  const mail = sug?.mail || []
  return (
    <div className="mt-attach" aria-label={t('Add files, links or emails')}>
      <form className="mt-attach-row" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Paste a link, or a file's path")} aria-label={t("A link or a file's path")} autoFocus />
        <button type="submit" className="btn small" disabled={busy || !text.trim()}>{t('Add')}</button>
      </form>
      <div className="mt-attach-row">
        {app().pickFiles
          ? <button type="button" className="btn small" onClick={pick} disabled={busy}><Icon name="folder-open" size={12} /> {t('Choose files…')}</button>
          : <label className="btn small"><Icon name="paperclip" size={12} /> {t('Add files')}<input type="file" multiple hidden onChange={upload} /></label>}
        <span className="muted small">{app().pickFiles ? t('Linked where they are, and read when the notes are written. Or drop them on the meeting.') : t('A copy is kept with the meeting. Or drop them on it.')}</span>
      </div>
      {mail.length > 0 && (
        <div className="mt-attach-mail">
          <b className="small">{t('From Mail')}</b>
          {mail.map((e) => (
            <div key={e.id} className="mt-mail">
              <div className="mt-mail-head">
                <Icon name="mail" size={12} />
                <span className="mt-mail-subj" title={e.subject}>{e.subject}</span>
                <span className="muted small">{e.from}{e.received ? `, ${when(e.received)}` : ''}</span>
                <button type="button" className="link-btn small" disabled={busy || e.linked} onClick={() => run(() => api(`/meetings/${encodeURIComponent(id)}/links`, { method: 'POST', body: { from: 'mail', mail: { id: e.id, subject: e.subject, from: e.from, mid: e.mid, received: e.received, files: e.files } } }))}>{e.linked ? t('Linked') : t('Link the email')}</button>
              </div>
              {e.files.map((f) => (
                <div key={f.name} className="mt-mail-file">
                  <Icon name="paperclip" size={11} />
                  <span>{f.name}</span>
                  {f.have
                    ? <button type="button" className="link-btn small" disabled={busy || f.linked} onClick={() => run(() => api(`/meetings/${encodeURIComponent(id)}/links`, { method: 'POST', body: { path: f.path, from: 'mail', mail: { subject: e.subject, from: e.from } } }))}>{f.linked ? t('Linked') : t('Link it')}</button>
                    : <span className="muted small" title={t('Open the email in Mail and download the attachment, then it can be linked')}>{t('Not downloaded in Mail yet')}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {sug && !mail.length && sug.mailReason === 'noAccess' && <PermissionFix pane="full-disk" onCheck={load}><p className="small">{t('To find emails about this meeting and the files that came with them, Bridge AI needs to read Mail on this Mac.')}</p></PermissionFix>}
      {err && <p className="error-text small">{err}</p>}
    </div>
  )
}

// The Files tab: what goes with the meeting, adding more, and every picture of the screen.
export function FilesPane({ id, data, onChange, onMsg, shots = [], pictureUrl, onOpenPic }) {
  const links = data.links || []
  return (
    <div className="mt-files">
      <div className="mt-phead"><span className="muted small">{!links.length ? t('Nothing linked yet.') : links.length === 1 ? t('{n} file, link and emails.', { n: links.length }) : t('{n} files, links and emails.', { n: links.length })} {t('Read when the notes are written, from where they are.')}</span></div>
      {links.length > 0 && <div className="mt-file-list">{links.map((l) => <Row key={l.id} id={id} l={l} onChange={onChange} onMsg={onMsg} />)}</div>}
      <Attach id={id} onChange={onChange} onMsg={onMsg} />
      {shots.length > 0 && (
        <div className="mt-gallery" aria-label={t('Pictures of the screen')}>
          <b className="mt-gallery-head">{shots.length === 1 ? t('The screen, {n} picture', { n: shots.length }) : t('The screen, {n} pictures', { n: shots.length })}</b>
          {shots.map((c) => <button key={c.id} type="button" className="mt-thumb" onClick={() => onOpenPic(c)} title={c.note || ''}><img src={pictureUrl(id, c)} alt="" loading="lazy" /><small>{clock(c.t)}{c.note ? ` · ${c.note}` : ''}</small></button>)}
        </div>
      )}
    </div>
  )
}
