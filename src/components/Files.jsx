import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import markdown from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import ini from 'highlight.js/lib/languages/ini'
import diffLang from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import Icon from './Icon.jsx'
import { Handle, usePersisted, useWidth } from './layout.jsx'
import { api, usePoll } from '../api.js'
import { OfficeView, Menu, menuItems, NameDialog, fileOp, onComputer } from './FileExtras.jsx'

Object.entries({ javascript, typescript, python, json, bash, css, xml, markdown, yaml, sql, go, rust, java, ini, diff: diffLang, dockerfile })
  .forEach(([n, l]) => hljs.registerLanguage(n, l))

const LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', json: 'json', sh: 'bash', zsh: 'bash', bash: 'bash', css: 'css', html: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  md: 'markdown', yml: 'yaml', yaml: 'yaml', sql: 'sql', go: 'go', rs: 'rust', java: 'java', toml: 'ini', ini: 'ini', cfg: 'ini',
  env: 'bash', diff: 'diff', patch: 'diff', dockerfile: 'dockerfile',
}

const enc = encodeURIComponent
const parentOf = (p) => p.split('/').slice(0, -1).join('/')
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)

const FILE_ICON = { md: 'doc', json: 'braces', js: 'code', jsx: 'code', ts: 'code', tsx: 'code', py: 'code', css: 'code', html: 'code', sh: 'terminal', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', pdf: 'doc', docx: 'doc', doc: 'doc', odt: 'doc', rtf: 'doc', pptx: 'layers', ppt: 'layers', key: 'layers', xlsx: 'grid', xls: 'grid', xlsm: 'grid', csv: 'grid', tsv: 'grid' }
const iconFor = (name) => FILE_ICON[name.split('.').pop().toLowerCase()] || 'file'

// ---------- tree ----------
function TreeNode({ pane, entry, depth, selected, onOpen, expanded, toggle, showHidden, ver, onMenu }) {
  const open = expanded.has(entry.path)
  const { data } = usePoll(entry.dir && open ? `/agents/${enc(pane)}/files?path=${enc(entry.path)}${showHidden ? '&hidden=1' : ''}&v=${ver}` : null, 15000)
  return (
    <>
      <button className={`tree-row ${selected === entry.path ? 'on' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (entry.dir ? toggle(entry.path) : onOpen(entry.path))} title={entry.path}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(entry, e) }}>
        {entry.dir
          ? <Icon name="chevron" size={11} className={`tree-caret ${open ? 'rot90' : ''}`} />
          : <span className="tree-caret-sp" />}
        <Icon name={entry.dir ? (open ? 'folder-open' : 'folder') : iconFor(entry.name)} size={14} className={entry.dir ? 'ico-dir' : 'ico-file'} />
        <span className="tree-name">{entry.name}</span>
      </button>
      {entry.dir && open && (data?.entries || []).map((e) => (
        <TreeNode key={e.path} pane={pane} entry={e} depth={depth + 1} selected={selected} onOpen={onOpen} expanded={expanded} toggle={toggle} showHidden={showHidden} ver={ver} onMenu={onMenu} />
      ))}
    </>
  )
}

// ---------- quick open (⌘P) ----------
function QuickOpen({ pane, onPick, onClose }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!q.trim()) { setRes([]); return }
    const t = setTimeout(() => api(`/agents/${enc(pane)}/find?q=${enc(q.trim())}`).then((r) => { setRes(r.files); setI(0) }).catch(() => setRes([])), 120)
    return () => clearTimeout(t)
  }, [q, pane])
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(res.length - 1, x + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
    if (e.key === 'Enter' && res[i]) { onPick(res[i]); onClose() }
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
  }
  return (
    <div className="quick-open" onKeyDown={onKey}>
      <div className="qo-input"><Icon name="search" size={14} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Go to file…" aria-label="Go to file" /></div>
      {res.length > 0 && (
        <ul className="qo-list" role="listbox">
          {res.map((f, k) => (
            <li key={f} role="option" aria-selected={k === i}>
              <button className={k === i ? 'on' : ''} onMouseEnter={() => setI(k)} onClick={() => { onPick(f); onClose() }}>
                <Icon name={iconFor(f)} size={13} /><span className="qo-name">{f.split('/').pop()}</span><span className="qo-dir">{parentOf(f)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q && !res.length && <p className="qo-empty">No matching files</p>}
    </div>
  )
}

// ---------- viewers ----------
function Code({ text, ext }) {
  const html = useMemo(() => {
    const lang = LANG[ext]
    try {
      return lang ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
        : text.length < 200000 ? hljs.highlightAuto(text).value : null
    } catch { return null }
  }, [text, ext])
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return (
    <div className="code-view">
      <pre className="gutter" aria-hidden="true">{lines.map((_, i) => i + 1).join('\n')}</pre>
      {html != null
        ? <pre className="hl"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
        : <pre className="hl"><code>{text}</code></pre>}
    </div>
  )
}

function Markdown({ text, pane, filePath, onOpenPath }) {
  const ref = useRef(null)
  const html = useMemo(() => {
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, '') // hide YAML frontmatter
    return DOMPurify.sanitize(marked.parse(body, { gfm: true, breaks: false }))
  }, [text])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const dir = parentOf(filePath)
    el.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || ''
      if (src && !/^(https?:|data:|\/api\/)/.test(src)) img.src = `/api/agents/${enc(pane)}/raw?path=${enc(normalize(`${dir}/${src}`))}`
    })
    el.querySelectorAll('a').forEach((a) => { if (/^https?:/.test(a.getAttribute('href') || '')) { a.target = '_blank'; a.rel = 'noreferrer' } })
  }, [html, pane, filePath])
  const onClick = (e) => {
    const a = e.target.closest('a')
    const href = a?.getAttribute('href')
    if (href && !/^(https?:|mailto:|#)/.test(href)) { e.preventDefault(); onOpenPath(normalize(`${parentOf(filePath)}/${decodeURIComponent(href)}`)) }
  }
  return <article className="md-view" ref={ref} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}

function normalize(p) {
  const out = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

// The page itself, sandboxed: its scripts run, but it can't reach this app (an opaque origin,
// which the server refuses for any API call). From disk, or from the text you're editing.
const SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals'
const siteUrl = (pane, p) => `/api/agents/${enc(pane)}/site/${p.split('/').map(enc).join('/')}`
function HtmlView({ pane, filePath, text, reload = 0 }) {
  // While editing, show the draft (after a short pause in typing). A <base> makes its relative
  // links (styles, scripts, images) load from the file's folder, as they would from disk.
  const [doc, setDoc] = useState(text)
  useEffect(() => { if (text == null) return; const t = setTimeout(() => setDoc(text), 300); return () => clearTimeout(t) }, [text])
  if (text == null) return <iframe key={reload} className="html-view" src={siteUrl(pane, filePath)} title={filePath} sandbox={SANDBOX} />
  const dir = parentOf(filePath)
  const base = `<base href="${siteUrl(pane, dir ? `${dir}/` : '')}">`
  const html = /<head[^>]*>/i.test(doc || '') ? doc.replace(/<head[^>]*>/i, (m) => m + base) : base + (doc || '')
  return <iframe className="html-view" srcDoc={html} title={filePath} sandbox={SANDBOX} />
}

// Edits you haven't saved, kept while you look at other files (until the page reloads).
const drafts = new Map()

function Editor({ value, onChange, onSave }) {
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); onSave() }
    // Tab indents instead of leaving the editor.
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      const el = e.target
      const { selectionStart: a, selectionEnd: b } = el
      const next = `${value.slice(0, a)}  ${value.slice(b)}`
      onChange(next)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2 })
    }
  }
  return <textarea className="file-editor" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} spellCheck={false} autoFocus aria-label="File text" />
}

function Viewer({ pane, filePath, onOpenPath, onBack, onMenu, ver }) {
  const [state, setState] = useState({ loading: true })
  const [mode, setMode] = usePersisted('cc-md-mode', 'preview')
  const [copied, setCopied] = useState(false)
  const key = `${pane}\n${filePath}`
  const [draft, setDraftState] = useState(() => drafts.get(key) ?? null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [frameKey, setFrameKey] = useState(0)
  const [boxRef, boxW] = useWidth()
  const setDraft = useCallback((t) => { if (t == null) drafts.delete(key); else drafts.set(key, t); setDraftState(t) }, [key])
  const load = useCallback(() => {
    api(`/agents/${enc(pane)}/file?path=${enc(filePath)}`).then((f) => setState({ f })).catch((e) => setState({ error: e.message }))
  }, [pane, filePath])
  useEffect(() => { setState({ loading: true }); load() }, [load])
  useEffect(() => { if (ver) load() }, [ver]) // eslint-disable-line react-hooks/exhaustive-deps
  const f = state.f
  const raw = `/api/agents/${enc(pane)}/raw?path=${enc(filePath)}`
  const isMd = f?.kind === 'text' && f.ext === '.md'
  const isHtml = f?.kind === 'text' && /^\.html?$/.test(f.ext)
  const canEdit = f?.kind === 'text' && !f.truncated
  const dirty = draft != null && f?.kind === 'text' && draft !== f.text
  // Preview or Source is remembered for every file; Edit only for this one (with a draft, it
  // reopens in Edit).
  const [editOn, setEditOn] = useState(() => drafts.has(key))
  const editing = canEdit && editOn
  const shown = editing ? 'edit' : (isMd || isHtml) ? (mode === 'edit' ? 'preview' : mode) : 'source'
  // Preview and Source show your unsaved edits too, so on a narrow screen you can flip to check them.
  const text = dirty ? draft : f?.text
  const site = siteUrl(pane, filePath)
  const crumbs = filePath.split('/')
  // An app's index.html is often only a shell that its dev server fills in (a blank page here):
  // point to the running app, or to starting it, in the Preview tab.
  const devInfo = usePoll(isHtml && /^index\.html?$/i.test(f?.name || '') ? `/agents/${enc(pane)}/servers` : null, 15000).data
  const devHint = devInfo && (devInfo.servers?.length
    ? { text: `Your app is running on port ${devInfo.servers[0].port}${devInfo.servers.length > 1 ? ` (and ${devInfo.servers.length - 1} more)` : ''}. This file alone may show a blank page.`, act: 'Show the app' }
    : devInfo.commands?.some((c) => c.label !== 'Serve this folder') ? { text: 'If this page comes out blank, it probably needs the project\'s dev server.', act: 'Start it in Preview' } : null)

  const save = useCallback(async (force = false) => {
    if (!f || draft == null) return
    setSaving(true); setSaveMsg(null)
    try {
      const res = await fetch(`/api/agents/${enc(pane)}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: filePath, text: draft, mtime: f.mtime, force }) })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) { setSaveMsg({ conflict: true, text: data.error }); return }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setState({ f: data }); setDraft(null); setSaveMsg({ ok: true, text: 'Saved' }); setFrameKey((k) => k + 1)
      setTimeout(() => setSaveMsg((m) => (m?.ok ? null : m)), 1500)
    } catch (e) { setSaveMsg({ text: e.message }) } finally { setSaving(false) }
  }, [f, draft, pane, filePath, setDraft])
  const startEdit = () => { if (draft == null && f) setDraft(f.text); setEditOn(true) }
  const discard = () => { setDraft(null); setSaveMsg(null); load() }
  // Leaving Edit with unsaved changes keeps them until you save or revert.
  const pick = (m) => {
    if (m === 'edit') return startEdit()
    if (!dirty) setDraft(null)
    setEditOn(false)
    setMode(m)
  }
  // Unsaved edits: ask before the page closes.
  useEffect(() => {
    if (!dirty) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Editing Markdown or HTML: the text on the left and how it looks on the right, when there's room.
  const split = editing && (isMd || isHtml) && boxW > 640
  return (
    <div className="viewer" ref={boxRef}>
      <div className="viewer-head">
        {onBack && <button className="win-btn narrow-back" onClick={onBack} aria-label="Back to files"><Icon name="chevron" size={15} className="flip" /></button>}
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={i} className="crumb">
              {i > 0 && <Icon name="chevron" size={10} />}
              {i < crumbs.length - 1
                ? <button onClick={() => onOpenPath(crumbs.slice(0, i + 1).join('/'), true)}>{c}</button>
                : <b>{c}{dirty && <span className="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes" />}</b>}
            </span>
          ))}
        </div>
        <div className="viewer-tools">
          {saveMsg && !saveMsg.conflict && <span className={`small save-msg ${saveMsg.ok ? 'ok' : 'bad'}`} role="status">{saveMsg.text}</span>}
          {f && !editing && !dirty && <span className="muted small file-meta">{fmtSize(f.size)} · {new Date(f.mtime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
          {canEdit && (
            <div className="seg small-seg">
              {(isMd || isHtml) && <button className={shown === 'preview' ? 'on' : ''} onClick={() => pick('preview')}>Preview</button>}
              <button className={shown === 'source' ? 'on' : ''} onClick={() => pick('source')}>{isMd || isHtml ? 'Source' : 'View'}</button>
              <button className={shown === 'edit' ? 'on' : ''} onClick={() => pick('edit')}>Edit</button>
            </div>
          )}
          {!canEdit && (isMd || isHtml) && (
            <div className="seg small-seg">
              <button className={shown === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>Preview</button>
              <button className={shown === 'source' ? 'on' : ''} onClick={() => setMode('source')}>Source</button>
            </div>
          )}
          {(editing || dirty) && <>
            <button className="btn small" onClick={discard} disabled={saving || !dirty} title="Throw away your changes">Revert</button>
            <button className="btn small primary" onClick={() => save()} disabled={saving || !dirty} title="Save (⌘S)">{saving ? 'Saving…' : 'Save'}</button>
          </>}
          <button className="win-btn" title="Copy path" aria-label="Copy path" onClick={() => { navigator.clipboard?.writeText(filePath); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>
            <Icon name={copied ? 'check' : 'copy'} size={13} />
          </button>
          {!dirty && <button className="win-btn" title="Reload" aria-label="Reload" onClick={() => { load(); setFrameKey((k) => k + 1) }}><Icon name="refresh" size={13} /></button>}
          {(f?.kind === 'image' || f?.kind === 'pdf' || isHtml) && <a className="win-btn" href={isHtml ? site : raw} target="_blank" rel="noreferrer" title="Open in new tab" aria-label="Open in new tab"><Icon name="external" size={13} /></a>}
          {f?.kind === 'office' && onComputer && <button className="btn small" onClick={() => fileOp(pane, 'open', filePath).catch((e) => setSaveMsg({ text: e.message }))} title="Open it in the app that usually opens it"><Icon name="external" size={12} /> Open in app</button>}
          {onMenu && <button className="win-btn" title="More" aria-label="More actions for this file" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu({ path: filePath, name: crumbs.at(-1), dir: false }, { clientX: r.right - 200, clientY: r.bottom + 4 }) }}><Icon name="more" size={14} /></button>}
        </div>
      </div>
      {devHint && shown === 'preview' && (
        <div className="dev-hint" role="note">
          <Icon name="play" size={12} /><span>{devHint.text}</span>
          <button className="link-btn" onClick={() => window.dispatchEvent(new CustomEvent('cc-set-view', { detail: { paneId: pane, view: 'preview' } }))}>{devHint.act}</button>
        </div>
      )}
      {saveMsg?.conflict && (
        <div className="save-conflict" role="alert">
          <Icon name="alert" size={13} /><span>{saveMsg.text}, probably by an agent.</span>
          <button className="btn small" onClick={discard}>Discard mine, load theirs</button>
          <button className="btn small" onClick={() => save(true)}>Overwrite with mine</button>
        </div>
      )}
      <div className={`viewer-body ${editing ? 'editing' : ''} ${split ? 'split' : ''}`}>
        {state.loading && <div className="pad"><div className="skeleton-rows"><div /><div /><div /></div></div>}
        {state.error && <div className="viewer-empty"><Icon name="alert" size={22} /><p>{state.error}</p></div>}
        {f?.kind === 'text' && (shown === 'edit'
          ? <>
              <Editor value={draft ?? f.text} onChange={setDraft} onSave={() => save()} />
              {split && <div className="edit-preview">{isMd
                ? <Markdown text={draft ?? f.text} pane={pane} filePath={f.path} onOpenPath={onOpenPath} />
                : <HtmlView pane={pane} filePath={f.path} text={draft ?? f.text} />}</div>}
            </>
          : shown === 'preview' && isMd
          ? <Markdown text={text} pane={pane} filePath={f.path} onOpenPath={onOpenPath} />
          : shown === 'preview' && isHtml
          ? <HtmlView pane={pane} filePath={f.path} text={dirty ? draft : undefined} reload={frameKey} />
          : <Code text={text} ext={f.ext.slice(1) || f.name.toLowerCase()} />)}
        {f?.truncated && <p className="muted small pad">Showing the first 1 MB, so this file can't be edited here.</p>}
        {f?.kind === 'image' && <div className="img-view"><img src={raw} alt={f.name} /></div>}
        {f?.kind === 'pdf' && <iframe className="pdf-view" src={raw} title={f.name} />}
        {f?.kind === 'office' && <OfficeView pane={pane} f={f} />}
        {f?.kind === 'binary' && <div className="viewer-empty"><Icon name="file" size={22} /><p>Binary file, {fmtSize(f.size)}</p></div>}
      </div>
    </div>
  )
}

// ---------- Files view ----------
export function FilesView({ agent, openPath, onConsumed, onMention }) {
  const pane = agent.paneId
  const [treeW, setTreeW] = usePersisted('cc-tree-w', 250)
  const [showHidden, setShowHidden] = usePersisted('cc-show-hidden', false)
  const [selected, setSelected] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [quick, setQuick] = useState(false)
  const [ver, setVer] = useState(0)
  const root = usePoll(`/agents/${enc(pane)}/files?v=${ver}${showHidden ? '&hidden=1' : ''}`, 15000)
  const rootName = agent.cwd.split(/[\\/]/).pop()
  const [menu, setMenu] = useState(null) // { x, y, entry }
  const [dialog, setDialog] = useState(null)
  const [toast, setToast] = useState(null)
  const say = (text) => { setToast(text); setTimeout(() => setToast((t) => (t === text ? null : t)), 2200) }
  const onMenu = useCallback((entry, e) => setMenu({ x: e.clientX, y: e.clientY, entry }), [])
  const closeMenu = useCallback(() => setMenu(null), [])
  // Phones and narrow panes: one column. The tree fills it; a file opens full width with a back button.
  const [boxRef, boxW] = useWidth()
  const narrow = boxW > 0 && boxW < 640

  const revealDirs = (p) => setExpanded((s) => {
    const n = new Set(s)
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) n.add(parts.slice(0, i).join('/'))
    return n
  })
  const open = useCallback((p, isDir = false) => {
    if (isDir) { revealDirs(`${p}/x`); return }
    setSelected(p)
    revealDirs(p)
  }, [])
  const toggle = (p) => setExpanded((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n })

  useEffect(() => { setSelected(null); setExpanded(new Set()) }, [pane])

  // The menu's actions. Paths are relative to the agent's folder ('' is the folder itself).
  const sep = agent.cwd.includes('\\') && !agent.cwd.includes('/') ? '\\' : '/'
  const act = async (op, e) => {
    const refresh = () => setVer((v) => v + 1)
    const moved = (from, to) => setSelected((s) => (s === from ? to : s?.startsWith(`${from}/`) ? (to ? to + s.slice(from.length) : null) : s))
    try {
      if (op === 'copyPath' || op === 'copyRel') {
        const text = op === 'copyRel' ? e.path : e.path ? `${agent.cwd}${sep}${e.path.split('/').join(sep)}` : agent.cwd
        await navigator.clipboard.writeText(text)
        return say('Path copied')
      }
      if (op === 'newFile' || op === 'newFolder') {
        return setDialog({ title: `New ${op === 'newFile' ? 'file' : 'folder'} in ${e.path || rootName}`, action: 'Create', initial: '', submit: async (name) => {
          const r = await fileOp(pane, op, e.path, name)
          if (e.path) setExpanded((x) => new Set(x).add(e.path))
          refresh()
          if (op === 'newFile') open(r.path)
        } })
      }
      if (op === 'rename') {
        return setDialog({ title: `Rename ${e.name}`, action: 'Rename', initial: e.name, submit: async (name) => { const r = await fileOp(pane, 'rename', e.path, name); moved(e.path, r.path); refresh() } })
      }
      if (op === 'trash') {
        if (!window.confirm(`Move ${e.name} to the Trash?${e.dir ? ' Everything in the folder goes with it.' : ''}`)) return
        await fileOp(pane, 'trash', e.path)
        moved(e.path, null); refresh()
        return say(`${e.name} moved to the Trash`)
      }
      if (op === 'duplicate') {
        const r = await fileOp(pane, 'duplicate', e.path)
        refresh()
        if (!e.dir) open(r.path)
        return say(`Made ${r.path.split('/').pop()}`)
      }
      await fileOp(pane, op, e.path) // reveal, open
    } catch (x) { say(x.message) }
  }
  useEffect(() => { if (openPath) { open(openPath); onConsumed?.() } }, [openPath]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); setQuick(true) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`files-view ${narrow ? 'narrow' : ''}`} ref={boxRef}>
      <aside className="tree" style={narrow ? undefined : { width: treeW }} hidden={narrow && !!selected}>
        <div className="tree-head">
          <span className="tree-root" title={agent.cwd}><Icon name="folder" size={13} /> {rootName}</span>
          <button className="win-btn" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu({ path: '', name: rootName, dir: true }, { clientX: r.left, clientY: r.bottom + 4 }) }} title="New file or folder" aria-label="New file or folder"><Icon name="plus" size={13} /></button>
          <button className="win-btn" onClick={() => setQuick(true)} title="Go to file (⌘P)" aria-label="Go to file"><Icon name="search" size={13} /></button>
          <button className={`win-btn ${showHidden ? 'on' : ''}`} onClick={() => setShowHidden(!showHidden)} title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'} aria-label="Toggle hidden files"><Icon name={showHidden ? 'eye' : 'eye-off'} size={13} /></button>
          <button className="win-btn" onClick={() => setExpanded(new Set())} title="Collapse all" aria-label="Collapse all"><Icon name="shrink" size={13} /></button>
        </div>
        <div className="tree-scroll" onContextMenu={(e) => { e.preventDefault(); onMenu({ path: '', name: rootName, dir: true }, e) }}>
          {root.error && <p className="error-text pad">{root.error}</p>}
          {(root.data?.entries || []).map((e) => (
            <TreeNode key={e.path} pane={pane} entry={e} depth={0} selected={selected} onOpen={open} expanded={expanded} toggle={toggle} showHidden={showHidden} ver={ver} onMenu={onMenu} />
          ))}
        </div>
        {toast && <div className="tree-toast" role="status">{toast}</div>}
      </aside>
      {!narrow && <Handle axis="x" size={treeW} min={160} max={520} onSize={setTreeW} label="Resize file tree" />}
      <section className="viewer-wrap" hidden={narrow && !selected}>
        {selected
          ? <Viewer key={selected} pane={pane} filePath={selected} onOpenPath={open} onBack={narrow ? () => setSelected(null) : undefined} onMenu={onMenu} ver={ver} />
          : (
            <div className="viewer-empty">
              <Icon name="folder-open" size={26} />
              <p>Pick a file, or press <kbd>⌘</kbd> <kbd>P</kbd> to jump to one.</p>
              <p className="muted small mono">{agent.cwd.replace(/^\/Users\/[^/]+/, '~')}</p>
            </div>
          )}
      </section>
      {menu && <Menu x={menu.x} y={menu.y} items={menuItems(menu.entry, act, { onMention })} onClose={closeMenu} />}
      {dialog && <NameDialog title={dialog.title} initial={dialog.initial} action={dialog.action} onSubmit={dialog.submit} onClose={() => setDialog(null)} />}
      {quick && <div className="qo-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setQuick(false) }}><QuickOpen pane={pane} onPick={open} onClose={() => setQuick(false)} /></div>}
    </div>
  )
}

// ---------- Changes view ----------
const STATUS = { modified: ['M', 'mod'], added: ['A', 'add'], deleted: ['D', 'del'], untracked: ['U', 'add'], renamed: ['R', 'mod'] }

function DiffView({ pane, filePath, onChanged }) {
  const { data, error, refresh } = usePoll(`/agents/${enc(pane)}/diff?path=${enc(filePath)}`, 10000)
  const [busy, setBusy] = useState(null)
  const undoHunk = async (hunk) => {
    if (!window.confirm('Undo this change? The lines go back to how they were at the last commit.')) return
    setBusy(hunk)
    try { await api(`/agents/${enc(pane)}/discard`, { method: 'POST', body: { path: filePath, hunk } }); refresh(); onChanged?.() } catch (e) { window.alert(e.message) } finally { setBusy(null) }
  }
  let hunkNo = -1
  if (error) return <div className="viewer-empty"><p>{error}</p></div>
  if (!data) return <div className="pad"><div className="skeleton-rows"><div /><div /></div></div>
  if (!data.diff && data.note === 'image file') return <div className="img-view"><img src={`/api/agents/${enc(pane)}/raw?path=${enc(filePath)}`} alt={filePath} /></div>
  if (!data.diff) return <div className="viewer-empty"><p>{data.note || 'No textual changes'}</p></div>
  return (
    <pre className="diff-view">
      {data.diff.split('\n').map((l, i) => {
        const cls = l.startsWith('@@') ? 'hunk' : l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') ? 'meta' : l.startsWith('+') ? 'plus' : l.startsWith('-') ? 'minus' : ''
        // Each change (hunk) can be undone on its own, except in a new file (undo the file instead).
        if (cls === 'hunk' && !data.untracked) {
          const n = ++hunkNo
          return <div key={i} className="dl hunk hunk-row"><span>{l}</span><button className="hunk-undo" onClick={() => undoHunk(n)} disabled={busy != null}>{busy === n ? 'Undoing…' : 'Undo this change'}</button></div>
        }
        return <div key={i} className={`dl ${cls}`}>{l || ' '}</div>
      })}
    </pre>
  )
}

export function ChangesView({ agent, onOpenFile }) {
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [note, setNote] = useState(null)
  const pane = agent.paneId
  const { data, error, refresh } = usePoll(`/agents/${enc(pane)}/git`, 8000)
  const undoFile = async (f) => {
    const what = f.status === 'untracked' || f.status === 'added' ? `Delete the new file ${f.path}?` : `Undo every change to ${f.path}? It goes back to how it was at the last commit.`
    if (!window.confirm(what)) return
    try { await api(`/agents/${enc(pane)}/discard`, { method: 'POST', body: { path: f.path } }); if (sel === f.path) setSel(null); refresh() } catch (e) { window.alert(e.message) }
  }
  const commit = async (paths) => {
    setCommitting(true); setNote(null)
    try {
      const r = await api(`/agents/${enc(pane)}/commit`, { method: 'POST', body: { message, paths } })
      setMessage(''); setSel(null); setNote({ ok: true, text: `Committed ${r.hash}` }); refresh()
    } catch (e) { setNote({ text: e.message }) } finally { setCommitting(false) }
  }
  const [sel, setSel] = useState(null)
  const [listW, setListW] = usePersisted('cc-changes-w', 280)
  const [boxRef, boxW] = useWidth()
  const narrow = boxW > 0 && boxW < 640
  useEffect(() => { setSel(null) }, [pane])
  useEffect(() => { if (!sel && !narrow && boxW && data?.files?.length) setSel(data.files[0].path) }, [data, sel, narrow, boxW])
  if (error) return <div className="viewer-empty"><p>{error}</p></div>
  if (!data) return <div className="pad"><div className="skeleton-rows"><div /><div /></div></div>
  if (!data.repo) return <div className="viewer-empty"><Icon name="branch" size={24} /><p>This folder isn't a git repository.</p></div>
  const adds = data.files.reduce((s, f) => s + (f.add || 0), 0)
  const dels = data.files.reduce((s, f) => s + (f.del || 0), 0)
  return (
    <div className={`files-view ${narrow ? 'narrow' : ''}`} ref={boxRef}>
      <aside className="tree" style={narrow ? undefined : { width: listW }} hidden={narrow && !!sel}>
        <div className="tree-head changes-head">
          <span className="tree-root"><Icon name="branch" size={13} /> {data.branch}</span>
          {(data.ahead > 0 || data.behind > 0) && <span className="muted small">↑{data.ahead} ↓{data.behind}</span>}
          <span className="chg-count"><span className="plus">+{adds}</span> <span className="minus">−{dels}</span></span>
        </div>
        <div className="tree-scroll">
          {data.files.length === 0 && <p className="muted pad small">No uncommitted changes.{data.lastCommit ? ` Last commit ${data.lastCommit.hash}: ${data.lastCommit.subject} (${data.lastCommit.when}).` : ''}</p>}
          {data.files.map((f) => (
            <button key={f.path} className={`tree-row chg-row ${sel === f.path ? 'on' : ''}`} onClick={() => setSel(f.path)} title={f.path}>
              <span className={`chg-badge s-${STATUS[f.status]?.[1]}`}>{STATUS[f.status]?.[0] || '?'}</span>
              <span className="tree-name">{f.path.split('/').pop()}</span>
              <span className="chg-dir">{parentOf(f.path)}</span>
              {(f.add || f.del) ? <span className="chg-n"><span className="plus">+{f.add}</span><span className="minus">−{f.del}</span></span> : null}
              <span role="button" tabIndex={0} className="chg-undo" title={f.status === 'untracked' ? 'Delete this new file' : 'Undo every change to this file'} aria-label={`Undo changes to ${f.path}`}
                onClick={(e) => { e.stopPropagation(); undoFile(f) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); undoFile(f) } }}><Icon name="x" size={11} /></span>
            </button>
          ))}
        </div>
        {data.files.length > 0 && (
          <form className="commit-box" onSubmit={(e) => { e.preventDefault(); commit(null) }}>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Commit message" rows={2} aria-label="Commit message"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(null) } }} />
            <div className="commit-acts">
              {sel && <button type="button" className="btn small" disabled={!message.trim() || committing} onClick={() => commit([sel])} title={`Commit only ${sel}`}>This file</button>}
              <button type="submit" className="btn small primary" disabled={!message.trim() || committing}>{committing ? 'Committing…' : `Commit all ${data.files.length}`}</button>
            </div>
            {note && <p className={`small ${note.ok ? 'ok-text' : 'error-text'}`}>{note.text}</p>}
          </form>
        )}
        {data.lastCommit && data.files.length > 0 && <div className="tree-foot muted small">HEAD {data.lastCommit.hash} · {data.lastCommit.when}</div>}
      </aside>
      {!narrow && <Handle axis="x" size={listW} min={180} max={520} onSize={setListW} label="Resize changes list" />}
      <section className="viewer-wrap" hidden={narrow && !sel}>
        {sel ? (
          <div className="viewer">
            <div className="viewer-head">
              {narrow && <button className="win-btn narrow-back" onClick={() => setSel(null)} aria-label="Back to changes"><Icon name="chevron" size={15} className="flip" /></button>}
              <div className="crumbs"><b>{sel}</b></div>
              <div className="viewer-tools">
                <button className="ghost-btn" onClick={() => onOpenFile(sel)}><Icon name="file" size={12} /> Open file</button>
              </div>
            </div>
            <div className="viewer-body"><DiffView pane={pane} filePath={sel} onChanged={refresh} /></div>
          </div>
        ) : <div className="viewer-empty"><p>Select a changed file</p></div>}
      </section>
    </div>
  )
}
