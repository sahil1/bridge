import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, apiUrl, viaRelay, onThisComputer } from '../../api.js'
import { download, toPhone, canDownload } from '../../download.js'
import { t } from '../../i18n/index.js'
import { SendDialog } from '../Transfers.jsx'
import './botfiles.css'

// The files a bot's runs made and sent back (server/botfiles.js), kept beside its record for as long
// as it is. Each with Open (in its app, on the computer it's on; from your phone or another
// computer's window, to the device you're on) and Send to… another of your computers, the dialog
// Files has (Transfers.jsx). In its Activity: the latest, and each conversation's in its timeline.
const sizeOf = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)
const enc = encodeURIComponent
// What opens in its app on this computer: what can't run anything as it opens (server/botfiles.js
// OPENS, which the server holds to as well). Anything else is shown in Finder instead.
const OPENS = /\.(png|jpe?g|gif|webp|pdf|csv|tsv|md|txt|json|ya?ml|xlsx|docx|pptx)$/i
const revealLabel = () => (/Mac/.test(navigator.userAgent) ? t('Show in Finder') : /Windows/.test(navigator.userAgent) ? t('Show in Explorer') : t('Show in file manager'))

function FileRow({ bot, f }) {
  const [sending, setSending] = useState(false)
  const [st, setSt] = useState(null)
  const pane = `botfiles:${bot}`
  const raw = apiUrl(`/agents/${enc(pane)}/raw?path=${enc(f.path)}&download=1`)
  const open = async () => {
    setSt({ busy: true })
    try {
      if (onThisComputer()) { await api(`/agents/${enc(pane)}/fileop`, { method: 'POST', body: { op: OPENS.test(f.name) ? 'open' : 'reveal', path: f.path } }); setSt(null); return }
      if (viaRelay) { setSt({ ok: await toPhone(raw, f.name) }); return }
      const r = await fetch(raw)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      download(await r.arrayBuffer(), f.name, r.headers.get('content-type') || 'application/octet-stream')
      setSt(null)
    } catch (e) { setSt({ error: e.message }) }
  }
  return (
    <li className="bf-file" data-file={f.name}>
      <Icon name="file" size={12} />
      <span className="bf-name">{f.name}</span>
      <span className="muted small">{sizeOf(f.size)}</span>
      {(onThisComputer() || canDownload) && <button type="button" className="link-btn small" disabled={!!st?.busy} onClick={open}>{onThisComputer() && !OPENS.test(f.name) ? revealLabel() : t('Open')}</button>}
      <button type="button" className="link-btn small" onClick={() => setSending(true)}>{t('Send to…')}</button>
      {st?.ok && <span className="muted small" role="status">{st.ok}</span>}
      {st?.error && <span className="error-text small" role="alert">{st.error}</span>}
      {sending && <SendDialog src={{ pane, path: f.path, name: f.name, size: f.size }} onClose={() => setSending(false)} />}
    </li>
  )
}

// One run's files, in a conversation's timeline (its files.made event): those kept, and those that
// weren't sent, with why.
export function MadeFiles({ bot, e }) {
  const kept = (e.files || []).filter((f) => f.kept)
  if (!kept.length && !e.refused?.length) return null
  return (
    <div className="bf-made">
      {kept.length > 0 && <ul className="bf-list">{kept.map((f) => <FileRow key={f.kept} bot={bot} f={{ name: f.name, size: f.size, path: f.kept }} />)}</ul>}
      {e.refused?.length > 0 && <p className="muted small">{t('Not sent: {list}', { list: e.refused.map((r) => `${r.name} (${r.why})`).join('; ') })}</p>}
    </div>
  )
}

// The latest files it made, newest first.
export default function BotFiles({ d }) {
  const [files, setFiles] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let live = true
    const load = () => api(`/bots/${d.id}/files`).then((r) => { if (live) { setFiles(r.files); setErr(null) } }, (e) => live && setErr(e.message))
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, 10000)
    return () => { live = false; clearInterval(id) }
  }, [d.id])
  if (err) return <p className="error-text small">{err}</p>
  if (!files?.length) return null
  return (
    <details className="sb-ctx bf-all" data-setting="bots-files" open>
      <summary><Icon name="chevron" size={11} />{t('Files It Made ({n})', { n: files.length })}</summary>
      <ul className="bf-list">{files.slice(0, 20).map((f) => <FileRow key={f.path} bot={d.id} f={f} />)}</ul>
    </details>
  )
}
