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

const FILE_ICON = { md: 'doc', json: 'braces', js: 'code', jsx: 'code', ts: 'code', tsx: 'code', py: 'code', css: 'code', html: 'code', sh: 'terminal', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', pdf: 'doc' }
const iconFor = (name) => FILE_ICON[name.split('.').pop().toLowerCase()] || 'file'

// ---------- tree ----------
function TreeNode({ pane, entry, depth, selected, onOpen, expanded, toggle, showHidden }) {
  const open = expanded.has(entry.path)
  const { data } = usePoll(entry.dir && open ? `/agents/${enc(pane)}/files?path=${enc(entry.path)}${showHidden ? '&hidden=1' : ''}` : null, 15000)
  return (
    <>
      <button className={`tree-row ${selected === entry.path ? 'on' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (entry.dir ? toggle(entry.path) : onOpen(entry.path))} title={entry.path}>
        {entry.dir
          ? <Icon name="chevron" size={11} className={`tree-caret ${open ? 'rot90' : ''}`} />
          : <span className="tree-caret-sp" />}
        <Icon name={entry.dir ? (open ? 'folder-open' : 'folder') : iconFor(entry.name)} size={14} className={entry.dir ? 'ico-dir' : 'ico-file'} />
        <span className="tree-name">{entry.name}</span>
      </button>
      {entry.dir && open && (data?.entries || []).map((e) => (
        <TreeNode key={e.path} pane={pane} entry={e} depth={depth + 1} selected={selected} onOpen={onOpen} expanded={expanded} toggle={toggle} showHidden={showHidden} />
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

function Viewer({ pane, filePath, onOpenPath, onBack }) {
  const [state, setState] = useState({ loading: true })
  const [mode, setMode] = usePersisted('cc-md-mode', 'preview')
  const [copied, setCopied] = useState(false)
  const load = useCallback(() => {
    api(`/agents/${enc(pane)}/file?path=${enc(filePath)}`).then((f) => setState({ f })).catch((e) => setState({ error: e.message }))
  }, [pane, filePath])
  useEffect(() => { setState({ loading: true }); load() }, [load])
  const f = state.f
  const raw = `/api/agents/${enc(pane)}/raw?path=${enc(filePath)}`
  const crumbs = filePath.split('/')
  return (
    <div className="viewer">
      <div className="viewer-head">
        {onBack && <button className="win-btn narrow-back" onClick={onBack} aria-label="Back to files"><Icon name="chevron" size={15} className="flip" /></button>}
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={i} className="crumb">
              {i > 0 && <Icon name="chevron" size={10} />}
              {i < crumbs.length - 1
                ? <button onClick={() => onOpenPath(crumbs.slice(0, i + 1).join('/'), true)}>{c}</button>
                : <b>{c}</b>}
            </span>
          ))}
        </div>
        <div className="viewer-tools">
          {f && <span className="muted small file-meta">{fmtSize(f.size)} · {new Date(f.mtime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
          {f?.ext === '.md' && (
            <div className="seg small-seg">
              <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>Preview</button>
              <button className={mode === 'source' ? 'on' : ''} onClick={() => setMode('source')}>Source</button>
            </div>
          )}
          <button className="win-btn" title="Copy path" aria-label="Copy path" onClick={() => { navigator.clipboard?.writeText(filePath); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>
            <Icon name={copied ? 'check' : 'copy'} size={13} />
          </button>
          <button className="win-btn" title="Reload" aria-label="Reload" onClick={load}><Icon name="refresh" size={13} /></button>
          {(f?.kind === 'image' || f?.kind === 'pdf') && <a className="win-btn" href={raw} target="_blank" rel="noreferrer" title="Open in new tab" aria-label="Open in new tab"><Icon name="external" size={13} /></a>}
        </div>
      </div>
      <div className="viewer-body">
        {state.loading && <div className="pad"><div className="skeleton-rows"><div /><div /><div /></div></div>}
        {state.error && <div className="viewer-empty"><Icon name="alert" size={22} /><p>{state.error}</p></div>}
        {f?.kind === 'text' && (f.ext === '.md' && mode === 'preview'
          ? <Markdown text={f.text} pane={pane} filePath={f.path} onOpenPath={onOpenPath} />
          : <Code text={f.text} ext={f.ext.slice(1) || f.name.toLowerCase()} />)}
        {f?.truncated && <p className="muted small pad">Showing the first 1 MB.</p>}
        {f?.kind === 'image' && <div className="img-view"><img src={raw} alt={f.name} /></div>}
        {f?.kind === 'pdf' && <iframe className="pdf-view" src={raw} title={f.name} />}
        {f?.kind === 'binary' && <div className="viewer-empty"><Icon name="file" size={22} /><p>Binary file, {fmtSize(f.size)}</p></div>}
      </div>
    </div>
  )
}

// ---------- Files view ----------
export function FilesView({ agent, openPath, onConsumed }) {
  const pane = agent.paneId
  const [treeW, setTreeW] = usePersisted('cc-tree-w', 250)
  const [showHidden, setShowHidden] = usePersisted('cc-show-hidden', false)
  const [selected, setSelected] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [quick, setQuick] = useState(false)
  const root = usePoll(`/agents/${enc(pane)}/files${showHidden ? '?hidden=1' : ''}`, 15000)
  const rootName = agent.cwd.split('/').pop()
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
          <button className="win-btn" onClick={() => setQuick(true)} title="Go to file (⌘P)" aria-label="Go to file"><Icon name="search" size={13} /></button>
          <button className={`win-btn ${showHidden ? 'on' : ''}`} onClick={() => setShowHidden(!showHidden)} title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'} aria-label="Toggle hidden files"><Icon name={showHidden ? 'eye' : 'eye-off'} size={13} /></button>
          <button className="win-btn" onClick={() => setExpanded(new Set())} title="Collapse all" aria-label="Collapse all"><Icon name="shrink" size={13} /></button>
        </div>
        <div className="tree-scroll">
          {root.error && <p className="error-text pad">{root.error}</p>}
          {(root.data?.entries || []).map((e) => (
            <TreeNode key={e.path} pane={pane} entry={e} depth={0} selected={selected} onOpen={open} expanded={expanded} toggle={toggle} showHidden={showHidden} />
          ))}
        </div>
      </aside>
      {!narrow && <Handle axis="x" size={treeW} min={160} max={520} onSize={setTreeW} label="Resize file tree" />}
      <section className="viewer-wrap" hidden={narrow && !selected}>
        {selected
          ? <Viewer key={selected} pane={pane} filePath={selected} onOpenPath={open} onBack={narrow ? () => setSelected(null) : undefined} />
          : (
            <div className="viewer-empty">
              <Icon name="folder-open" size={26} />
              <p>Pick a file, or press <kbd>⌘</kbd> <kbd>P</kbd> to jump to one.</p>
              <p className="muted small mono">{agent.cwd.replace(/^\/Users\/[^/]+/, '~')}</p>
            </div>
          )}
      </section>
      {quick && <div className="qo-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setQuick(false) }}><QuickOpen pane={pane} onPick={open} onClose={() => setQuick(false)} /></div>}
    </div>
  )
}

// ---------- Changes view ----------
const STATUS = { modified: ['M', 'mod'], added: ['A', 'add'], deleted: ['D', 'del'], untracked: ['U', 'add'], renamed: ['R', 'mod'] }

function DiffView({ pane, filePath }) {
  const { data, error } = usePoll(`/agents/${enc(pane)}/diff?path=${enc(filePath)}`, 10000)
  if (error) return <div className="viewer-empty"><p>{error}</p></div>
  if (!data) return <div className="pad"><div className="skeleton-rows"><div /><div /></div></div>
  if (!data.diff && data.note === 'image file') return <div className="img-view"><img src={`/api/agents/${enc(pane)}/raw?path=${enc(filePath)}`} alt={filePath} /></div>
  if (!data.diff) return <div className="viewer-empty"><p>{data.note || 'No textual changes'}</p></div>
  return (
    <pre className="diff-view">
      {data.diff.split('\n').map((l, i) => {
        const cls = l.startsWith('@@') ? 'hunk' : l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') ? 'meta' : l.startsWith('+') ? 'plus' : l.startsWith('-') ? 'minus' : ''
        return <div key={i} className={`dl ${cls}`}>{l || ' '}</div>
      })}
    </pre>
  )
}

export function ChangesView({ agent, onOpenFile }) {
  const pane = agent.paneId
  const { data, error } = usePoll(`/agents/${enc(pane)}/git`, 8000)
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
            </button>
          ))}
        </div>
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
            <div className="viewer-body"><DiffView pane={pane} filePath={sel} /></div>
          </div>
        ) : <div className="viewer-empty"><p>Select a changed file</p></div>}
      </section>
    </div>
  )
}
