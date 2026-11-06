import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll, useFleet } from '../../api.js'
import { PaneHeader } from '../layout.jsx'
import { t, tx, locale } from '../../i18n/index.js'
import { openFile, bytesOf, rawUrl, versionUrl, saveFile, changedSince, restoreVersion, base64, extOf } from './files.js'
import { useDesignPacks, PacksSection, packFor } from './packs.jsx'
import { lineDiff, textFor, comparable } from './diff.js'
import { fontCss, lookOfPack } from './look.js'
import { withKeys } from './keys.js'
import { useBusy } from '../../busy.js'
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
// What a file is, in words, by its extension ("Word document"); a Markdown file that's a deck says so.
const KIND_OF = { '.docx': tx('Word document'), '.md': tx('Markdown'), '.markdown': tx('Markdown'), '.txt': tx('Plain text'), '.xlsx': tx('Excel workbook'), '.xlsm': tx('Excel workbook'), '.csv': tx('CSV'), '.tsv': tx('TSV'), '.pptx': tx('PowerPoint'), '.pdf': tx('PDF'), '.html': tx('HTML page'), '.htm': tx('HTML page') }
const kindName = (kind, ext) => (kind === 'deck' && ext !== '.pptx' ? t('Markdown deck') : t(KIND_OF[ext] || KIND_LABEL[kind] || 'Studio'))
const READ_ONLY = (kind, ext) => kind === 'pdf' || ext === '.pptx'
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
// A new file starts in your default design pack's look, where it has one: a Word file's fonts and
// colours, a page's (as CSS variables an agent keeps using, and its logo). A deck follows the
// pack by itself.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
async function startOf(n, title, pack) {
  if (n.deck) return { text: (await import('./pptx.js')).blankDeck(title) }
  if (n.ext === '.md') return { text: `# ${title}\n\n` }
  if (n.ext === '.html') return { text: pageOf(title, pack) }
  if (n.ext === '.docx') {
    const { docxOf } = await import('./docx.js')
    return { data: base64(await docxOf({ content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }, { type: 'paragraph' }] }, lookOfPack(pack))) }
  }
  if (n.ext === '.xlsx') { const x = await import('./xlsx.js'); return { data: base64(await x.bytesOf(x.blankWorkbook(title).data, '.xlsx')) } }
  return { text: '' }
}
function pageOf(title, pack) {
  const c = pack?.colors || {}, f = pack?.fonts || {}
  const vars = pack ? `  :root { --bg: ${c.background || '#ffffff'}; --text: ${c.text || '#1f2328'}; --accent: ${c.accent || '#2a78d6'}; }\n` : ''
  const body = pack ? `font: 16px/1.5 ${f.body ? fontCss(f.body, 'system-ui, sans-serif') : 'system-ui, sans-serif'}; background: var(--bg); color: var(--text);` : 'font: 16px/1.5 system-ui, sans-serif;'
  const heads = pack ? `  h1, h2, h3 {${f.heading ? ` font-family: ${fontCss(f.heading)};` : ''} color: var(--accent); }\n  .logo { height: 36px; }\n` : ''
  const logo = pack?.logo ? `<img class="logo" src="${pack.logo}" alt="">\n` : ''
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>\n${vars}  body { ${body} max-width: 760px; margin: 3rem auto; padding: 0 1rem; }\n${heads}</style>\n</head>\n<body>\n${logo}<h1>${esc(title)}</h1>\n</body>\n</html>\n`
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
// Where a file is, for its header and Recent: the folder's path (home as ~), and its name in Bridge
// AI (the agent's workspace, the place). Null when its folder isn't one open here now.
const home = (p) => p.replace(/^(\/Users\/|\/home\/|[A-Z]:\\Users\\)[^/\\]+/, '~')
function whereOf(folders, root, rel) {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  const f = folders.find((x) => x.root === root)
  if (!f) return null
  const at = dir ? `${f.path.replace(/\/$/, '')}/${dir}` : f.path
  return { label: f.label, path: home(at), full: at }
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
      const r = await api('/studio/new', { method: 'POST', body: { root: where, dir: '', name: file, ...(await startOf(n, title, packFor(packs.list))) } })
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
            <button key={n.label} type="button" className={`sd-new-btn${making === n ? ' on' : ''}`} onClick={() => { setMaking(n); setErr(null) }} disabled={!folders.length} aria-pressed={making === n}>
              <span className="sd-new-ic"><Icon name={ICON[n.kind]} size={16} /></span><b>{t(n.label)}</b><small className="muted">{t(n.hint)}</small>
            </button>
          ))}
        </div>
        {folders.length === 1 && <p className="muted small">{t('Start an agent in a folder, or add a place in Files, to make a file there; until then, they go in Studio\'s own folder.')}</p>}
        {making && (
          <form className="sd-new-form" onSubmit={make}>
            <label className="sd-field"><span className="muted small">{t('Name')}</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t(making.label)} maxLength={100} />
            </label>
            <label className="sd-field wide"><span className="muted small">{t('Where')}</span>
              <select value={where} onChange={(e) => setWhere(e.target.value)}>
                {folders.map((f) => <option key={f.root} value={f.root}>{f.label} · {home(f.path)}</option>)}
              </select>
            </label>
            <span className="sd-new-acts">
              <button type="submit" className="btn small primary" disabled={busy}>{busy ? t('Making it…') : t('Make it')}</button>
              <button type="button" className="ghost-btn" onClick={() => setMaking(null)}>{t('Cancel')}</button>
            </span>
            {err && <p className="error-text small sd-new-err" role="alert">{t("Couldn't make it: {error}", { error: err })}</p>}
          </form>
        )}
      </section>
      <section className="sd-sec">
        <h3>{t('Recent')}</h3>
        {!data && <p className="muted small">{t('Opening…')}</p>}
        {data && !files.length && <p className="muted small sd-none">{t('Nothing yet. A file you open here (from Files, with Open in Studio, or one you start above) shows here, to come back to.')}</p>}
        <ul className="sd-recent">
          {files.map((f) => {
            const at = whereOf(folders, f.root, f.path)
            const ext = extOf(f.name)
            return (
              <li key={`${f.root}\n${f.path}`}>
                <button type="button" className="sd-recent-open" onClick={() => onOpen({ root: f.root, path: f.path })} title={at ? `${at.label} · ${at.full}` : f.path}>
                  <span className={`sd-recent-ic ${f.kind || ''}`}><Icon name={ICON[f.kind] || 'file'} size={15} /></span>
                  <span className="sd-recent-name"><b>{f.name}</b><small className="muted">{kindName(f.kind, ext)}{at ? ` · ${at.path}` : f.where ? ` · ${f.where}` : ''}</small></span>
                  <small className="muted sd-recent-when">{when(f.at)}</small>
                </button>
                <button type="button" className="ghost-btn sd-recent-x" aria-label={t('Take {name} off the list', { name: f.name })} title={t('Take it off the list (the file stays)')} onClick={() => api(`/studio/recent?root=${encodeURIComponent(f.root)}&path=${encodeURIComponent(f.path)}`, { method: 'DELETE' }).then(refresh)}><Icon name="x" size={12} /></button>
              </li>
            )
          })}
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
const RISKY = { '.docx': tx('Saving here keeps its text, headings, lists, tables, links, quotes, pictures, fonts and colours. Word\'s own layout (headers, footers, comments, tracked changes, page setup) isn\'t kept; the file as it was stays in its versions, and Ask an agent changes it in place.'), '.xlsx': tx('Saving here keeps its values, formulas, formats, merged cells and every sheet. Charts, pivot tables and comments aren\'t kept; the file as it was stays in its versions, and Ask an agent changes it in place.') }
// What saving keeps, in each kind of file: said under the file (its kind, in the status line), and
// before the first save of a Word or Excel file. The editors offer only what's kept.
const KEEPS = {
  '.docx': RISKY['.docx'], '.xlsx': RISKY['.xlsx'], '.xlsm': RISKY['.xlsx'],
  '.md': tx('Saved as Markdown, as written: headings, bold, italic, strikethrough, code, lists, quotes, links, tables and pictures. Markdown has no underline or colours, so they aren\'t offered.'),
  '.txt': tx('Saved as plain text, as it is.'),
  '.csv': tx('Saved as a {kind} file: the first sheet\'s values. Formulas, formats and other sheets aren\'t part of a {kind} file, so they aren\'t kept.'),
  deck: tx('Saved as a Markdown deck, as written: slides between lines of ---. PowerPoint and PDF make a copy beside it.'),
  '.pptx': tx('Shown here, not edited: Ask an agent changes the PowerPoint itself, and Edit as a Markdown deck makes a copy to edit here.'),
  '.pdf': tx('Shown here, not edited: Ask an agent to change it, or the file it was made from.'),
  '.html': tx('Saved as it\'s written: one HTML file that works on its own.'),
}
const keepsOf = (kind, ext) => {
  if (kind === 'deck' && ext !== '.pptx') return t(KEEPS.deck)
  if (ext === '.csv' || ext === '.tsv') return t(KEEPS['.csv'], { kind: ext.slice(1).toUpperCase() })
  return t(KEEPS[{ '.markdown': '.md', '.htm': '.html' }[ext] || ext] || KEEPS['.txt'])
}

export function StudioPage({ root, path: rel, onBack, onOpen }) {
  const f = useMemo(() => ({ root, path: rel }), [root, rel])
  const [meta, setMeta] = useState(null)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(null) // { text, error, info, brief }
  const [conflict, setConflict] = useState(null) // { by, name } changed on disk while yours is unsaved
  const [panel, setPanel] = useState(null) // 'versions'
  const [ask, setAsk] = useState(null) // { selection }
  const [warn, setWarn] = useState(null) // the first save of a Word or Excel file, to say what's kept
  const [gen, setGen] = useState(0) // a new load (not a save): the editor starts again from it
  const [stats, setStats] = useState(null) // what the editor counts (words, slides), for the status line
  const handle = useRef(null)
  const metaRef = useRef(null)
  const dirtyRef = useRef(false)
  useEffect(() => { metaRef.current = meta }, [meta])
  useEffect(() => { dirtyRef.current = dirty }, [dirty])
  const packs = useDesignPacks()
  const folders = useFolders()
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
  const open = useCallback(() => { setMeta(null); setData(null); setErr(null); setStats(null); load().catch((e) => setErr(e.message)) }, [load])
  useEffect(open, [open])
  // "Saved." goes by itself after a few seconds (the status line still says it); what needs reading stays.
  useEffect(() => { if (!note?.brief) return undefined; const id = setTimeout(() => setNote(null), 4000); return () => clearTimeout(id) }, [note])
  // Changed on disk (an agent asked, another app): looked at while it's in view, every few seconds
  // while an agent's working on it (asked, or it changed it in the last two minutes), else every
  // ten, and at once when you come back to the window (from editing it in Word, say).
  const quick = useRef(0) // until when
  const lastLook = useRef(0)
  useEffect(() => {
    const look = async () => {
      const m = metaRef.current
      if (!m || document.hidden) return
      if (Date.now() > quick.current && Date.now() - lastLook.current < 10_000) return
      lastLook.current = Date.now()
      const r = await changedSince(f, m.mtime).catch(() => null)
      if (!r?.changed) return
      if (r.by === 'agent') quick.current = Math.max(quick.current, Date.now() + 120_000)
      const who = r.by === 'agent' ? (r.name || t('An agent')) : t('Another app')
      if (!dirtyRef.current) { await load().catch(() => {}); setNote({ text: t('{who} changed it: this is its new version.', { who }) }) } else { setMeta((x) => ({ ...x, versions: r.versions })); setConflict({ who, mtime: r.mtime }) }
    }
    const back = () => { lastLook.current = 0; look() }
    const id = setInterval(look, 2500)
    window.addEventListener('focus', back)
    return () => { clearInterval(id); window.removeEventListener('focus', back) }
  }, [f, load])
  const save = useCallback(async ({ force = false, ok = false } = {}) => {
    if (!handle.current || !meta || READ_ONLY(meta.kind, meta.ext)) return
    if (RISKY[meta.ext] && !ok) { try { if (!localStorage.getItem(`cc-studio-said${meta.ext}`)) { setWarn(meta.ext); return } } catch { /* say it again next time */ } }
    setSaving(true); setNote(null)
    try {
      const bytes = await handle.current.save()
      const r = await saveFile(f, bytes, { mtime: meta.mtime, force })
      setMeta((m) => ({ ...m, mtime: r.mtime, size: r.size, versions: r.versions }))
      setDirty(false); setConflict(null)
      setNote({ text: t('Saved.'), brief: true })
    } catch (e) {
      if (e.conflict) setConflict({ who: t('Something else'), mtime: null })
      else setNote({ text: t("Couldn't save it: {error}", { error: e.message }), error: true })
    } finally { setSaving(false) }
  }, [f, meta])
  useEffect(() => {
    const key = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [save])
  // Leaving with unsaved changes asks first (the browser's own question), and the desktop app
  // doesn't update by itself meanwhile (busy.js).
  useEffect(() => { if (!dirty) return; const q = (e) => { e.preventDefault(); e.returnValue = '' }; window.addEventListener('beforeunload', q); return () => window.removeEventListener('beforeunload', q) }, [dirty])
  useBusy('studio', dirty)
  const restore = async (id) => { if (dirty && !window.confirm(t('Put this version back? Your unsaved changes here are lost (what\'s in the file now is kept as a version).'))) return; await restoreVersion(f, id); await load(); setNote({ text: t('Put back. What was there is kept as a version too.') }) }

  const name = meta?.name || rel.split('/').pop()
  const kind = meta?.kind
  const at = whereOf(folders, root, rel)
  if (err) {
    return (
      <div className="sd-file">
        <PaneHeader icon="layers" title={name} leading={onBack && <BackBtn onBack={onBack} icon="layers" />} />
        <div className="sd-empty" role="alert">
          <Icon name="alert" size={20} />
          <b>{t("Couldn't open {name}", { name })}</b>
          <span className="muted small">{err}</span>
          <span className="sd-empty-acts"><button type="button" className="btn small" onClick={open}><Icon name="refresh" size={12} /> {t('Try again')}</button>{onBack && <button type="button" className="ghost-btn" onClick={onBack}>{t('Back to Studio')}</button>}</span>
        </div>
      </div>
    )
  }
  const Editor = kind ? EDITORS[kind] : null
  const readOnly = !!meta && READ_ONLY(meta.kind, meta.ext)
  const opening = <div className="sd-empty sd-loading" role="status"><Icon name="refresh" size={16} className="spin" /><span className="muted">{t('Opening {name}…', { name })}</span></div>
  const versions = meta?.versions?.length || 0
  const state = saving ? { text: t('Saving…'), cls: 'busy' } : note?.error ? { text: t("Couldn't save"), cls: 'bad' } : conflict ? { text: t('Changed elsewhere'), cls: 'bad' } : dirty ? { text: t('Unsaved changes'), cls: 'dirty' } : readOnly ? { text: t('Read only'), cls: '' } : { text: t('Saved'), cls: 'ok' }
  return (
    <div className="sd-file">
      <PaneHeader icon={ICON[kind] || 'layers'} title={name} leading={onBack && <BackBtn onBack={onBack} icon={ICON[kind] || 'layers'} />}
        subtitle={<>
          <span className="sd-sub-kind">{meta ? `${kindName(kind, meta.ext)} · ${sizeOf(meta.size)}` : t('Opening…')}</span>
          {at && <span className="path-chip sd-sub-where" title={`${at.label} · ${at.full}`}><Icon name="folder" size={10} /> <span>{at.path}</span></span>}
        </>}>
        {kind && !readOnly && <button type="button" className={`btn small sd-head-btn${dirty ? ' primary' : ''}`} onClick={() => save()} disabled={saving || !dirty} title={withKeys(dirty ? t('Save') : t('Saved: nothing new to save'), 'mod', 's')} aria-label={saving ? t('Saving…') : dirty ? t('Save') : t('Saved')}><Icon name="check" size={12} /> <span className="sd-btn-label">{saving ? t('Saving…') : dirty ? t('Save') : t('Saved')}</span></button>}
        <button type="button" className="btn small sd-head-btn" onClick={() => setAsk({ selection: handle.current?.selection?.() || null })} disabled={!meta} title={t('Have one of your agents change it: pick the part first, or describe it')} aria-label={t('Ask an agent')}><Icon name="sparkle" size={12} /> <span className="sd-btn-label">{t('Ask an agent')}</span></button>
        <button type="button" className={`win-btn${panel === 'versions' ? ' on' : ''}`} onClick={() => setPanel(panel === 'versions' ? null : 'versions')} aria-pressed={panel === 'versions'} title={t('Versions: yours, your agents\' and changes from outside')} aria-label={t('Versions')} disabled={!meta}><Icon name="clock" size={14} /></button>
        <a className="win-btn" href={rawUrl(f)} download={name} title={t('Download {name}', { name })} aria-label={t('Download')}><Icon name="download" size={14} /></a>
      </PaneHeader>
      {note && (
        <div className={`sd-bar sd-note-bar${note.error ? ' bad' : ''}`} role={note.error ? 'alert' : 'status'}>
          {note.info && <Icon name="info" size={13} />}
          {note.error && <Icon name="alert" size={13} />}
          <span>{note.text}</span>
          <button type="button" className="win-btn" onClick={() => setNote(null)} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={12} /></button>
        </div>
      )}
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
          {!meta || !data ? opening
            : <Suspense fallback={opening}><Editor key={gen} file={{ ...meta, root, path: rel }} data={data} onDirty={setDirty} onStats={setStats} handle={handle} packs={packs.list} onOpen={onOpen} /></Suspense>}
        </div>
        {panel === 'versions' && meta && <Versions f={f} ext={meta.ext} versions={meta.versions} onRestore={restore} onClose={() => setPanel(null)} />}
      </div>
      {/* The status line: what the editor counts, what kind of file it is (tapped: what saving keeps),
          how many versions are kept, and whether it's saved. */}
      {meta && (
        <footer className="sd-status">
          {stats && <span className="sd-stat" title={stats.title || undefined}>{stats.text}</span>}
          <button type="button" className={`sd-status-btn${note?.info ? ' on' : ''}`} onClick={() => setNote(note?.info ? null : { text: keepsOf(kind, meta.ext), info: true })} aria-pressed={!!note?.info} title={t('What saving keeps')}><Icon name="info" size={12} /> {kindName(kind, meta.ext)}</button>
          <button type="button" className="sd-status-btn vers" onClick={() => setPanel(panel === 'versions' ? null : 'versions')} title={t('Versions: yours, your agents\' and changes from outside')}><Icon name="clock" size={12} /> {versions === 1 ? t('1 version') : t('{n} versions', { n: versions })}</button>
          <span className="sd-grow" />
          <span className={`sd-state ${state.cls}`} title={meta.mtime ? t('The file last changed {when}', { when: when(meta.mtime) }) : undefined}><i aria-hidden="true" />{state.text}</span>
        </footer>
      )}
      {ask && <AskAgent f={f} meta={meta} selection={ask.selection} onClose={() => setAsk(null)} onSent={(r) => { setAsk(null); quick.current = Date.now() + 15 * 60_000; setNote({ text: r.queued ? t('Queued for {name}. Studio shows the change once it saves the file.', { name: r.name }) : t('Sent to {name}. Studio shows the change once it saves the file.', { name: r.name }) }) }} />}
    </div>
  )
}
const BackBtn = ({ onBack, icon }) => <><button type="button" className="win-btn back" onClick={onBack} aria-label={t('Back to Studio')} title={t('Back to Studio')}><Icon name="chevron" size={16} className="flip" /></button><span className="pane-icon"><Icon name={icon} size={15} /></span></>

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
  // Who it goes to: the one you pick, else the file's own agent, else the first (once they've come).
  const [pick, setTo] = useState(null)
  const to = pick ?? (here && here.kind !== 'chat' ? here.paneId : agents[0]?.paneId || 'new')
  const [text, setText] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const send = async (e) => {
    e.preventDefault()
    if (!fleet || busy || !text.trim()) return // who's there hasn't come yet: not sent to a new agent by mistake
    setBusy(true); setErr(null)
    try {
      const r = await api('/studio/ask', { method: 'POST', body: { ...f, kind: meta?.kind, instruction: text, selection: selection?.text || null, where: selection?.where || null, ...(to !== 'new' ? { pane: to } : {}) } })
      onSent(r)
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
        <div className="sd-ask-acts"><button type="submit" className="btn small primary" disabled={busy || !text.trim() || !fleet}><Icon name="send" size={12} /> {busy ? t('Sending…') : t('Send')}</button><button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button></div>
      </form>
    </div>
  )
}
export { extOf }
