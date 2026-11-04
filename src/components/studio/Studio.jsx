import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll, useFleet } from '../../api.js'
import { PaneHeader } from '../layout.jsx'
import { t, tx, locale } from '../../i18n/index.js'
import { openFile, bytesOf, rawUrl, versionUrl, saveFile, changedSince, restoreVersion, base64, extOf } from './files.js'
import { useDesignPacks, PacksSection } from './packs.jsx'
import { lineDiff, textFor, comparable } from './diff.js'
import './studio.css'

// Studio: documents, sheets, decks, PDFs and pages, like Meetings and Whiteboards a place of its own.
// Any of them from Files or an agent's folder (on this computer, or another of yours through its
// window) opens here, is edited and saved where it is, and keeps every version (server/studio.js).
// Ask an agent sends a change to one of your agents, and Studio shows it once the agent saves.
// Each kind's editor loads only when a file of that kind opens.
const EDITORS = {
  doc: lazy(() => import('./editors/DocEditor.jsx')),
  sheet: lazy(() => import('./editors/SheetEditor.jsx')),
  deck: lazy(() => import('./editors/DeckEditor.jsx')),
  page: lazy(() => import('./editors/PageEditor.jsx')),
  pdf: lazy(() => import('./editors/PageEditor.jsx').then((m) => ({ default: m.PdfView }))),
}
const ICON = { doc: 'doc', sheet: 'grid', deck: 'screen', pdf: 'file', page: 'code' }
const KIND_LABEL = { doc: tx('Document'), sheet: tx('Sheet'), deck: tx('Deck'), pdf: tx('PDF'), page: tx('Page') }
export const openStudio = (f) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: f }))
const when = (iso) => new Date(iso).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const sizeOf = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)

// ---------- Home ----------
// New (a document, sheet, deck or page in a folder you pick), what you opened lately, and your
// design packs.
const NEW = [
  { kind: 'doc', ext: '.docx', label: tx('Document'), hint: tx('A Word file') },
  { kind: 'doc', ext: '.md', label: tx('Markdown'), hint: tx('A Markdown file') },
  { kind: 'sheet', ext: '.xlsx', label: tx('Sheet'), hint: tx('An Excel file') },
  { kind: 'deck', ext: '.md', deck: true, label: tx('Deck'), hint: tx('Slides in Markdown, to present or send as PowerPoint') },
  { kind: 'page', ext: '.html', label: tx('Page'), hint: tx('An HTML page, like an artifact') },
]
async function startOf(n, title) {
  if (n.deck) return { text: (await import('./pptx.js')).blankDeck(title) }
  if (n.ext === '.md') return { text: `# ${title}\n\n` }
  if (n.ext === '.html') return { text: `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title}</title>\n<style>\n  body { font: 16px/1.5 system-ui, sans-serif; max-width: 760px; margin: 3rem auto; padding: 0 1rem; }\n</style>\n</head>\n<body>\n<h1>${title}</h1>\n</body>\n</html>\n` }
  if (n.ext === '.docx') return { data: base64(await (await import('./docx.js')).docxOf({ content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }, { type: 'paragraph' }] })) }
  if (n.ext === '.xlsx') { const x = await import('./xlsx.js'); return { data: base64(await x.bytesOf(x.blankWorkbook(title).data, '.xlsx')) } }
  return { text: '' }
}

// Where a new file can go: the folders your agents work in, and the places you added to Files.
function useFolders() {
  const { fleet } = useFleet()
  const { data: pl } = usePoll('/places', 60_000)
  return useMemo(() => {
    const seen = new Set()
    const out = []
    for (const a of fleet?.agents || []) {
      if (!a.cwd || a.chief || a.plainChat || a.cloudOnly || seen.has(a.cwd)) continue
      seen.add(a.cwd)
      out.push({ root: a.paneId, label: `${a.workspace}${a.tab && !/^\d+$/.test(a.tab) ? ` › ${a.tab}` : ''}`, path: a.cwd })
    }
    for (const p of pl?.places || []) out.push({ root: `place:${p.id}`, label: p.name, path: p.path })
    // Studio's own folder, on this computer, for a file with nowhere else to go.
    out.push({ root: 'studio', label: t("Studio's own folder"), path: '~/.bridge-ai/studio/files' })
    return out
  }, [fleet, pl])
}

export function StudioHome({ onOpen }) {
  const { data, refresh } = usePoll('/studio/recent', 15_000)
  const folders = useFolders()
  const packs = useDesignPacks()
  const [making, setMaking] = useState(null) // the New kind being named
  const [name, setName] = useState('')
  const [where, setWhere] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!where && folders[0]) setWhere(folders[0].root) }, [folders, where])
  const make = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const n = making
      const title = name.trim() || t(n.label)
      const file = `${title}${n.deck ? '.md' : n.ext}`
      const r = await api('/studio/new', { method: 'POST', body: { root: where, dir: '', name: file, ...(await startOf(n, title)) } })
      setMaking(null); setName('')
      onOpen({ root: where, path: r.path })
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const files = data?.files || []
  return (
    <div className="sd-home">
      <div className="sd-home-head">
        <h2><Icon name="layers" size={18} /> {t('Studio')}</h2>
        <p className="muted small">{t('Documents, sheets, decks, PDFs and pages from any of your folders and computers, edited here or by your agents, with every version kept. Open one from Files, or start one.')}</p>
      </div>
      <section className="sd-sec">
        <h3>{t('New')}</h3>
        <div className="sd-new">
          {NEW.map((n) => (
            <button key={n.label} type="button" className={`sd-new-btn${making === n ? ' on' : ''}`} onClick={() => { setMaking(n); setErr(null) }} disabled={!folders.length} title={t(n.hint)}>
              <Icon name={ICON[n.kind]} size={18} /><b>{t(n.label)}</b><small className="muted">{t(n.hint)}</small>
            </button>
          ))}
        </div>
        {folders.length === 1 && <p className="muted small">{t('Start an agent in a folder, or add a place in Files, to make a file there; until then, they go in Studio\'s own folder.')}</p>}
        {making && (
          <form className="sd-new-form" onSubmit={make}>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t(making.label)} aria-label={t('Name')} maxLength={100} />
            <select value={where} onChange={(e) => setWhere(e.target.value)} aria-label={t('Where')}>
              {folders.map((f) => <option key={f.root} value={f.root}>{f.label} · {f.path}</option>)}
            </select>
            <button type="submit" className="btn small primary" disabled={busy}>{t('Make it')}</button>
            <button type="button" className="ghost-btn" onClick={() => setMaking(null)}>{t('Cancel')}</button>
            {err && <span className="error-text small">{err}</span>}
          </form>
        )}
      </section>
      <section className="sd-sec">
        <h3>{t('Recent')}</h3>
        {!files.length && <p className="muted small">{t('Files you open in Studio show here.')}</p>}
        <ul className="sd-recent">
          {files.map((f) => (
            <li key={`${f.root}\n${f.path}`}>
              <button type="button" className="sd-recent-open" onClick={() => onOpen({ root: f.root, path: f.path })}>
                <Icon name={ICON[f.kind] || 'file'} size={15} />
                <span className="sd-recent-name"><b>{f.name}</b><small className="muted">{f.where ? `${f.where} · ` : ''}{f.path}</small></span>
                <small className="muted">{when(f.at)}</small>
              </button>
              <button type="button" className="ghost-btn sd-recent-x" aria-label={t('Take {name} off the list', { name: f.name })} title={t('Take it off the list (the file stays)')} onClick={() => api(`/studio/recent?root=${encodeURIComponent(f.root)}&path=${encodeURIComponent(f.path)}`, { method: 'DELETE' }).then(refresh)}><Icon name="x" size={12} /></button>
            </li>
          ))}
        </ul>
      </section>
      <PacksSection packs={packs} />
    </div>
  )
}

// ---------- One file ----------
// Saved with ⌘S or Save, only over the version you loaded; a change from an agent or another app
// while it's open is shown at once when you've changed nothing, and offered when you have.
const WHO = { you: tx('You'), agent: tx('An agent'), outside: tx('Changed outside Studio'), restored: tx('Put back'), opened: tx('When it was first opened here') }
const RISKY = { '.docx': tx('Saving here keeps its text, headings, lists, tables and pictures. Word\'s own layout (headers, footers, comments, tracked changes, page setup) isn\'t kept; the file as it was stays in its versions, and Ask an agent changes it in place.'), '.xlsx': tx('Saving here keeps its values, formulas, formats, merged cells and every sheet. Charts, pivot tables and comments aren\'t kept; the file as it was stays in its versions, and Ask an agent changes it in place.') }

export function StudioPage({ root, path: rel, onBack, onOpen }) {
  const f = useMemo(() => ({ root, path: rel }), [root, rel])
  const [meta, setMeta] = useState(null)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(null) // { text, error }
  const [conflict, setConflict] = useState(null) // { by, name } changed on disk while yours is unsaved
  const [panel, setPanel] = useState(null) // 'versions'
  const [ask, setAsk] = useState(null) // { selection }
  const [warn, setWarn] = useState(null) // the first save of a Word or Excel file, to say what's kept
  const [gen, setGen] = useState(0) // a new load (not a save): the editor starts again from it
  const handle = useRef(null)
  const metaRef = useRef(null)
  const dirtyRef = useRef(false)
  useEffect(() => { metaRef.current = meta }, [meta])
  useEffect(() => { dirtyRef.current = dirty }, [dirty])
  const packs = useDesignPacks()
  const load = useCallback(async () => {
    const m = await openFile(f)
    const buf = await bytesOf(rawUrl(f))
    setMeta({ ...m, root: f.root })
    setData(buf)
    setGen((g) => g + 1)
    setDirty(false)
    setConflict(null)
    return m
  }, [f])
  useEffect(() => { setMeta(null); setData(null); setErr(null); load().catch((e) => setErr(e.message)) }, [load])
  // Changed on disk (an agent asked, another app): looked at every few seconds while it's in view.
  useEffect(() => {
    const id = setInterval(async () => {
      const m = metaRef.current
      if (!m || document.hidden) return
      const r = await changedSince(f, m.mtime).catch(() => null)
      if (!r?.changed) return
      const who = r.by === 'agent' ? (r.name || t('An agent')) : t('Another app')
      if (!dirtyRef.current) { await load().catch(() => {}); setNote({ text: t('{who} changed it: this is its new version.', { who }) }) } else { setMeta((x) => ({ ...x, versions: r.versions })); setConflict({ who, mtime: r.mtime }) }
    }, 2500)
    return () => clearInterval(id)
  }, [f, load])
  const save = useCallback(async ({ force = false, ok = false } = {}) => {
    if (!handle.current || !meta) return
    if (RISKY[meta.ext] && !ok) { try { if (!localStorage.getItem(`cc-studio-said${meta.ext}`)) { setWarn(meta.ext); return } } catch { /* say it again next time */ } }
    setSaving(true); setNote(null)
    try {
      const bytes = await handle.current.save()
      const r = await saveFile(f, bytes, { mtime: meta.mtime, force })
      setMeta((m) => ({ ...m, mtime: r.mtime, size: r.size, versions: r.versions }))
      setDirty(false); setConflict(null)
      setNote({ text: t('Saved.') })
    } catch (e) {
      if (e.conflict) setConflict({ who: t('Something else'), mtime: null })
      else setNote({ text: e.message, error: true })
    } finally { setSaving(false) }
  }, [f, meta])
  useEffect(() => {
    const key = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [save])
  // Leaving with unsaved changes asks first (the browser's own question).
  useEffect(() => { if (!dirty) return; const q = (e) => { e.preventDefault(); e.returnValue = '' }; window.addEventListener('beforeunload', q); return () => window.removeEventListener('beforeunload', q) }, [dirty])
  const restore = async (id) => { if (dirty && !window.confirm(t('Put this version back? Your unsaved changes here are lost (what\'s in the file now is kept as a version).'))) return; await restoreVersion(f, id); await load(); setNote({ text: t('Put back. What was there is kept as a version too.') }) }

  if (err) return <div className="sd-file"><PaneHeader icon="layers" title={rel.split('/').pop()} leading={onBack && <BackBtn onBack={onBack} />} /><p className="error-text sd-err">{err}</p></div>
  const kind = meta?.kind
  const Editor = kind ? EDITORS[kind] : null
  return (
    <div className="sd-file">
      <PaneHeader icon={ICON[kind] || 'layers'} title={meta?.name || rel.split('/').pop()} leading={onBack && <BackBtn onBack={onBack} />}
        subtitle={<><span className="sub-where">{t(KIND_LABEL[kind] || 'Studio')}{meta ? ` · ${sizeOf(meta.size)}` : ''}</span><span className="path-chip" title={rel}><Icon name="folder" size={10} /> <span>{rel}</span></span></>}>
        {kind && kind !== 'pdf' && <button type="button" className={`btn small${dirty ? ' primary' : ''}`} onClick={() => save()} disabled={saving || !dirty} title={t('Save (⌘S)')}><Icon name="check" size={12} /> {saving ? t('Saving…') : dirty ? t('Save') : t('Saved')}</button>}
        <button type="button" className="btn small" onClick={() => setAsk({ selection: handle.current?.selection?.() || null })} disabled={!meta} title={t('Have one of your agents change it: pick the part first, or describe it')}><Icon name="sparkle" size={12} /> {t('Ask an agent')}</button>
        <button type="button" className={`win-btn${panel === 'versions' ? ' on' : ''}`} onClick={() => setPanel(panel === 'versions' ? null : 'versions')} aria-pressed={panel === 'versions'} title={t('Versions: yours, your agents\' and changes from outside')} aria-label={t('Versions')}><Icon name="clock" size={14} /></button>
        <a className="win-btn" href={rawUrl(f)} download={meta?.name} title={t('Download')} aria-label={t('Download')}><Icon name="download" size={14} /></a>
      </PaneHeader>
      {note && <p className={`sd-bar small${note.error ? ' error-text' : ''}`} role="status">{note.text}</p>}
      {conflict && (
        <div className="sd-bar sd-conflict" role="alert">
          <span><b>{t('{who} changed this file', { who: conflict.who })}</b> {t('while you were editing it. Your changes aren\'t saved yet.')}</span>
          <button type="button" className="btn small" onClick={() => { setConflict(null); load() }}>{t('Show theirs')}</button>
          <button type="button" className="btn small" onClick={() => save({ force: true, ok: true })}>{t('Save mine over it')}</button>
        </div>
      )}
      {warn && (
        <div className="sd-bar sd-conflict" role="alertdialog">
          <span>{t(RISKY[warn])}</span>
          <button type="button" className="btn small primary" onClick={() => { try { localStorage.setItem(`cc-studio-said${warn}`, '1') } catch { /* asks again next time */ } setWarn(null); save({ ok: true }) }}>{t('Save')}</button>
          <button type="button" className="ghost-btn" onClick={() => setWarn(null)}>{t('Not now')}</button>
        </div>
      )}
      <div className={`sd-body${panel ? ' with-panel' : ''}`}>
        <div className="sd-editor">
          {!meta || !data ? <p className="muted small sd-loading">{t('Opening…')}</p>
            : <Suspense fallback={<p className="muted small sd-loading">{t('Opening…')}</p>}><Editor key={gen} file={{ ...meta, root, path: rel }} data={data} onDirty={setDirty} handle={handle} packs={packs.list} onOpen={onOpen} /></Suspense>}
        </div>
        {panel === 'versions' && meta && <Versions f={f} ext={meta.ext} versions={meta.versions} onRestore={restore} onClose={() => setPanel(null)} />}
      </div>
      {ask && <AskAgent f={f} meta={meta} selection={ask.selection} onClose={() => setAsk(null)} onSent={(name) => { setAsk(null); setNote({ text: t('Sent to {name}. Studio shows the change once it saves the file.', { name }) }) }} />}
    </div>
  )
}
const BackBtn = ({ onBack }) => <><button type="button" className="win-btn back" onClick={onBack} aria-label={t('Studio')} title={t('Studio')}><Icon name="chevron" size={16} className="flip" /></button><span className="pane-icon"><Icon name="layers" size={15} /></span></>

function Versions({ f, ext, versions, onRestore, onClose }) {
  const [compare, setCompare] = useState(null) // the version compared with the file as it is
  return (<>
    <aside className="sd-panel" aria-label={t('Versions')}>
      <div className="sd-panel-head"><b>{t('Versions')}</b><span className="muted small">{t('{n} kept', { n: versions.length })}</span><span className="sd-grow" /><button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={13} /></button></div>
      <ol className="sd-versions">
        {versions.map((v, i) => (
          <li key={v.id} className={i === 0 ? 'now' : ''}>
            <span className="sd-v-who"><b>{v.by === 'agent' && v.name ? v.name : t(WHO[v.by] || v.by)}</b><small className="muted">{when(v.at)} · {sizeOf(v.size)}</small></span>
            {i === 0 ? <small className="muted">{t('Now')}</small> : <span className="sd-v-acts">
              {comparable(ext) && <button type="button" className="link-btn" onClick={() => setCompare(v)}>{t('Compare')}</button>}
              <a className="link-btn" href={versionUrl(f, v.id)} target="_blank" rel="noreferrer">{t('Open')}</a>
              <button type="button" className="link-btn" onClick={() => onRestore(v.id)}>{t('Put back')}</button>
            </span>}
          </li>
        ))}
      </ol>
    </aside>
    {compare && <Compare f={f} ext={ext} v={compare} onClose={() => setCompare(null)} />}
  </>)
}

// What changed from a version to the file as it is now, line by line (a Word file by its text):
// what's gone in red, what's new in green, long stretches the same folded away.
function Compare({ f, ext, v, onClose }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let on = true
    Promise.all([bytesOf(versionUrl(f, v.id)), bytesOf(rawUrl(f))]).then(([a, b]) => Promise.all([textFor(ext, a), textFor(ext, b)]))
      .then(([a, b]) => on && setRows(lineDiff(a, b)), (e) => on && setErr(e.message))
    return () => { on = false }
  }, [f, ext, v.id])
  const shown = []
  if (rows) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].t !== ' ') { shown.push(rows[i]); continue }
      let j = i
      while (j < rows.length && rows[j].t === ' ') j++
      const run = rows.slice(i, j)
      if (run.length > 6) shown.push(...(i ? run.slice(0, 2) : []), { fold: run.length - (i ? 2 : 0) - (j < rows.length ? 2 : 0) }, ...(j < rows.length ? run.slice(-2) : []))
      else shown.push(...run)
      i = j - 1
    }
  }
  const changes = rows ? rows.filter((r) => r.t !== ' ').length : 0
  return (
    <div className="sd-modal" role="dialog" aria-label={t('Compare')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sd-compare">
        <div className="sd-panel-head"><b>{t('From {when} to now', { when: when(v.at) })}</b><span className="muted small">{rows ? (changes ? t('{n} lines changed', { n: changes }) : t('No changes')) : ''}</span><span className="sd-grow" /><button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={13} /></button></div>
        {err && <p className="error-text small sd-err">{err}</p>}
        {!rows && !err && <p className="muted small sd-loading">{t('Opening…')}</p>}
        {rows && <pre className="sd-diff">{shown.map((r, i) => (r.fold ? <span key={i} className="fold">{t('… {n} lines the same', { n: r.fold })}{'\n'}</span> : <span key={i} className={r.t === '-' ? 'del' : r.t === '+' ? 'add' : ''}>{r.t === ' ' ? '  ' : `${r.t} `}{r.line}{'\n'}</span>))}</pre>}
      </div>
    </div>
  )
}

// Ask an agent: what to change (and the part you picked), to the agent working in that folder, any
// other there, or a new one started there.
function AskAgent({ f, meta, selection, onClose, onSent }) {
  const { fleet } = useFleet()
  const here = fleet?.agents?.find((a) => a.paneId === f.root)
  const agents = (fleet?.agents || []).filter((a) => !a.chief && !a.plainChat && !a.cloudOnly && a.kind !== 'chat' && (!here || a.cwd === here.cwd))
  const [to, setTo] = useState(here && here.kind !== 'chat' ? here.paneId : agents[0]?.paneId || 'new')
  const [text, setText] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const send = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const r = await api('/studio/ask', { method: 'POST', body: { ...f, kind: meta?.kind, instruction: text, selection: selection?.text || null, where: selection?.where || null, ...(to !== 'new' ? { pane: to } : {}) } })
      onSent(r.name)
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <div className="sd-modal" role="dialog" aria-label={t('Ask an agent')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="sd-ask" onSubmit={send}>
        <b>{t('Ask an agent to change {name}', { name: meta?.name || '' })}</b>
        {selection?.text && <blockquote className="sd-ask-sel"><small className="muted">{selection.where ? t('The part you picked, {where}', { where: selection.where }) : t('The part you picked')}</small><pre>{selection.text.slice(0, 600)}{selection.text.length > 600 ? '…' : ''}</pre></blockquote>}
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t('What to change: "make this shorter", "add a column for Q4 totals", "a slide on pricing after this one"')} rows={4} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e) }} />
        <label className="sd-ask-to">{t('To')}
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {agents.map((a) => <option key={a.paneId} value={a.paneId}>{a.title || a.kindLabel} · {a.kindLabel}{a.status === 'working' ? ` (${t('working')})` : ''}</option>)}
            <option value="new">{t('A new agent in this folder')}</option>
          </select>
        </label>
        {err && <p className="error-text small">{err}</p>}
        <div className="sd-ask-acts"><button type="submit" className="btn small primary" disabled={busy || !text.trim()}><Icon name="send" size={12} /> {busy ? t('Sending…') : t('Send')}</button><button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button></div>
      </form>
    </div>
  )
}
export { extOf }
