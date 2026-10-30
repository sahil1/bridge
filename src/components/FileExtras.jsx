// The file browser's extras: Word, PowerPoint and Excel files in the viewer, and the right-click
// menu on files and folders (show in Finder, open in its app, copy path, duplicate, rename, new
// file or folder, move to Trash, mention it to the agent).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { api, BASE } from '../api.js'

const enc = encodeURIComponent
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/
// Show in Finder and Open act on the computer running Bridge AI, so they're only offered there.
export const onComputer = typeof location !== 'undefined' && LOOPBACK.test(location.hostname)
const platform = typeof navigator !== 'undefined' ? navigator.userAgent : ''
export const REVEAL = /Mac/.test(platform) ? 'Reveal in Finder' : /Windows/.test(platform) ? 'Show in Explorer' : 'Show in file manager'
const OPENABLE = /\.(pdf|docx?|odt|rtf|pptx?|odp|key|xlsx|xlsm|xls|ods|numbers|pages|csv|tsv|txt|md|png|jpe?g|gif|webp|svg|heic|tiff?|bmp|mp4|mov|m4v|webm|mp3|m4a|wav|aac|flac|zip|epub)$/i
const APP = { document: 'Word', slides: 'PowerPoint', sheet: 'Excel' }

export const fileOp = (pane, op, path, name) => api(`/agents/${enc(pane)}/fileop`, { method: 'POST', body: { op, path, name } })

// ---------- Office files ----------
export function OfficeView({ pane, f }) {
  return f.office === 'sheet' ? <SheetView pane={pane} f={f} /> : <DocView pane={pane} f={f} />
}

// A document or deck: laid out as a PDF by LibreOffice; without it, the text in the file.
function DocView({ pane, f }) {
  const url = `${BASE}/api/agents/${enc(pane)}/office/pdf?path=${enc(f.path)}&v=${f.mtime}`
  const [st, setSt] = useState({ busy: true })
  useEffect(() => {
    let live = true
    setSt({ busy: true })
    fetch(url).then(async (r) => {
      if (!live) return
      if (r.ok) return setSt({ pdf: true })
      const d = await r.json().catch(() => ({}))
      setSt({ needs: d.needs, error: d.error || `HTTP ${r.status}` })
    }).catch((e) => live && setSt({ error: e.message }))
    return () => { live = false }
  }, [url])
  if (st.busy) return <div className="viewer-empty"><Icon name="refresh" size={20} className="spin" /><p className="muted small">Getting {f.name} ready…</p></div>
  if (st.pdf) return <iframe className="pdf-view" src={url} title={f.name} />
  return <Outline pane={pane} f={f} note={st.needs === 'libreoffice'
    ? <>This is the text in the file. To see it laid out as in {APP[f.office]}, install <a href="https://www.libreoffice.org/download/download/" target="_blank" rel="noreferrer">LibreOffice</a> (free); Bridge AI uses it in the background.</>
    : <>Couldn't lay this file out ({st.error}). Here's the text in it.</>} />
}

function Outline({ pane, f, note }) {
  const [d, setD] = useState(null)
  useEffect(() => { api(`/agents/${enc(pane)}/office/outline?path=${enc(f.path)}`).then(setD).catch((e) => setD({ error: e.message })) }, [pane, f.path, f.mtime])
  return (
    <div className="office-outline">
      <p className="office-note small"><Icon name="info" size={12} /> <span>{note}</span></p>
      {d?.error && <p className="error-text">{d.error}</p>}
      {(d?.sections || []).map((s, i) => (
        <section key={i} className={s.title ? 'slide-card' : 'doc-page'}>
          {s.title && <div className="slide-no muted small">{s.title}</div>}
          {s.blocks.map((b, k) => (s.title && k === 0 ? <h3 key={k}>{b.text}</h3>
            : b.level ? <div key={k} className={`doc-h doc-h${b.level}`}>{b.text}</div>
            : <p key={k} className={b.list ? 'doc-li' : ''}>{b.text}</p>))}
          {s.notes && <div className="slide-notes small"><b>Notes</b> {s.notes}</div>}
        </section>
      ))}
    </div>
  )
}

// A spreadsheet or CSV as a table: a tab per sheet, column letters and row numbers.
const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s }
const NUM = /^-?[\d,.]+%?$/
function SheetView({ pane, f }) {
  const [d, setD] = useState(null)
  const [at, setAt] = useState(0)
  useEffect(() => { setD(null); api(`/agents/${enc(pane)}/office/sheet?path=${enc(f.path)}`).then(setD).catch((e) => setD({ error: e.message })) }, [pane, f.path, f.mtime])
  if (!d) return <div className="viewer-empty"><Icon name="refresh" size={20} className="spin" /><p className="muted small">Reading {f.name}…</p></div>
  if (d.error) return <div className="viewer-empty"><Icon name="alert" size={22} /><p>{d.error}</p></div>
  const s = d.sheets[Math.min(at, d.sheets.length - 1)]
  return (
    <div className="sheet-view">
      <div className="sheet-scroll">
        {!s?.rows.length ? <p className="muted pad">This sheet is empty.</p> : (
          <table className="sheet">
            <thead><tr><th className="corner" />{Array.from({ length: s.cols }, (_, i) => <th key={i}>{colName(i)}</th>)}</tr></thead>
            <tbody>
              {s.rows.map((r, y) => (
                <tr key={y}><th>{y + 1}</th>{r.map((v, x) => <td key={x} className={NUM.test(v) ? 'num' : ''} title={v.length > 40 ? v : undefined}>{v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        )}
        {s?.truncated && <p className="muted small pad">Showing the first 2,000 rows and 80 columns.</p>}
      </div>
      {d.sheets.length > 1 && (
        <div className="sheet-tabs" role="tablist">
          {d.sheets.map((x, i) => <button key={i} role="tab" aria-selected={i === at} className={i === at ? 'on' : ''} onClick={() => setAt(i)}>{x.name}</button>)}
        </div>
      )}
    </div>
  )
}

// ---------- menu ----------
// items: [{ label, icon, run, danger, hint }] or 'sep'.
export function Menu({ x, y, items, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) })
  }, [x, y])
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    ref.current?.querySelector('button')?.focus()
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', onClose); window.removeEventListener('resize', onClose) }
  }, [onClose])
  const onKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const bs = [...ref.current.querySelectorAll('button')]
    const i = bs.indexOf(document.activeElement)
    bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus()
  }
  return createPortal(
    <div className="ctx-menu" ref={ref} role="menu" style={pos} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {items.filter(Boolean).map((it, i) => (it === 'sep' ? <div key={i} className="ctx-sep" role="separator" />
        : <button key={i} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { onClose(); it.run() }}>
            <Icon name={it.icon || 'dot'} size={13} /><span>{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
          </button>))}
    </div>,
    document.body,
  )
}

// What the menu offers for a file or folder. `act(op, entry)` does it.
export function menuItems(entry, act, { onMention } = {}) {
  const dir = !!entry.dir
  const root = entry.path === ''
  return [
    dir && { label: 'New file…', icon: 'file', run: () => act('newFile', entry) },
    dir && { label: 'New folder…', icon: 'folder', run: () => act('newFolder', entry) },
    dir && 'sep',
    !dir && onComputer && OPENABLE.test(entry.name) && { label: 'Open in its app', icon: 'external', run: () => act('open', entry) },
    onComputer && { label: REVEAL, icon: 'folder-open', run: () => act('reveal', entry) },
    onMention && !root && { label: 'Mention to the agent', icon: 'chat', run: () => onMention(entry.path) },
    'sep',
    { label: 'Copy path', icon: 'copy', run: () => act('copyPath', entry) },
    !root && { label: 'Copy relative path', icon: 'copy', run: () => act('copyRel', entry) },
    !root && 'sep',
    !root && { label: 'Duplicate', icon: 'layers', run: () => act('duplicate', entry) },
    !root && { label: 'Rename…', icon: 'edit', run: () => act('rename', entry) },
    !root && { label: 'Move to Trash', icon: 'trash', danger: true, run: () => act('trash', entry) },
  ].filter(Boolean).filter((it, i, a) => it !== 'sep' || (i > 0 && a[i - 1] !== 'sep' && i < a.length - 1))
}

// Asks for a name (Electron has no window.prompt). Renaming selects the name without its extension.
export function NameDialog({ title, initial = '', action, onSubmit, onClose }) {
  const [v, setV] = useState(initial)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = initial.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial])
  const submit = async (e) => {
    e.preventDefault()
    if (!v.trim()) return
    setBusy(true); setErr(null)
    try { await onSubmit(v.trim()); onClose() } catch (x) { setErr(x.message); setBusy(false) }
  }
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="modal name-dialog" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
        <header className="modal-head"><h3>{title}</h3></header>
        <input ref={ref} className="input" value={v} onChange={(e) => setV(e.target.value)} spellCheck={false} aria-label="Name" />
        {err && <p className="error-text small">{err}</p>}
        <div className="modal-foot">
          <button type="button" className="btn small" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn small primary" disabled={busy || !v.trim()}>{action}</button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
