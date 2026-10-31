import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { PaneHeader, usePersisted, useMedia } from '../layout.jsx'
import { api, apiUrl, usePoll, refetch, fmtRelative, onThisComputer } from '../../api.js'
import { t } from '../../i18n/index.js'
import Canvas, { useDarkMode } from './Canvas.jsx'
import DrawPanel, { KINDS, useBoardModels } from './DrawPanel.jsx'
import { loadExcalidraw } from './excalidraw.js'
import { fromText, fromPending, kindOfFile, placeBeside } from './convert.js'
import { openBoard, openBoards } from './links.js'
import { NameDialog } from '../FileExtras.jsx'
import './whiteboard.css'

// Whiteboards: the list (WhiteboardsHome), one board (WhiteboardPage), and a diagram file in an
// agent's Files tab drawn as a board (FileDrawing). The boards are files in ~/.bridge-ai/boards
// (server/boards.js); a board saves itself a moment after each change.

const enc = encodeURIComponent
const fileOp = (pane, op, path, name) => api(`/agents/${enc(pane)}/fileop`, { method: 'POST', body: { op, path, name } })

// A small menu under a button: a click outside or Escape closes it.
function Menu({ items, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    ref.current?.querySelector('button')?.focus()
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [onClose])
  return (
    <div className="menu right" ref={ref} role="menu">
      {items.filter(Boolean).map((it, i) => it === '-' ? <div key={i} className="menu-sep" /> : (
        <button type="button" key={it.label} role="menuitem" className={`menu-item ${it.danger ? 'danger' : ''}`} onClick={() => { onClose(); it.run() }}><Icon name={it.icon} size={13} /> {it.label}</button>
      ))}
    </div>
  )
}
// A request whose refusal says why, and whether it's because the file changed meanwhile (409).
async function send(path, body, method = 'POST') {
  const res = await fetch(apiUrl(path), { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { conflict: res.status === 409 || !!j.conflict })
  return j
}
const toDataUrl = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob) })
// The small picture the list shows: light, whatever the theme (the list darkens it to match).
const previewOf = async (X, elements, appState, files) => toDataUrl(await X.exportToBlob({ elements, appState: { ...appState, exportBackground: true, exportWithDarkMode: false }, files, mimeType: 'image/png', maxWidthOrHeight: 480, exportPadding: 16 }))

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
// A picture of the board: PNG at twice the size, for sharp text, or SVG with its fonts in it.
async function exportAs(X, ex, kind, name, dark) {
  const elements = ex.getSceneElements()
  if (!elements.length) throw new Error(t('Nothing on the board to export yet'))
  const o = { elements, appState: { ...ex.getAppState(), exportBackground: true, exportWithDarkMode: dark }, files: ex.getFiles(), exportPadding: 24 }
  const blob = kind === 'svg'
    ? new Blob([(await X.exportToSvg(o)).outerHTML], { type: 'image/svg+xml' })
    : await X.exportToBlob({ ...o, mimeType: 'image/png', getDimensions: (w, h) => ({ width: w * 2, height: h * 2, scale: 2 }) })
  download(blob, `${name}.${kind}`)
}

// What an agent or the chief of staff handed over, drawn in: in place of what's there, or beside it.
async function withPending(X, b) {
  if (!b.pending) return { elements: b.elements, files: b.files, changed: false }
  const got = await fromPending(X, b.pending)
  const keep = (b.elements || []).filter((e) => !e.isDeleted)
  const elements = b.pending.mode === 'add' ? [...keep, ...placeBeside(X, got.elements, keep)] : got.elements
  return { elements, files: { ...(b.files || {}), ...(got.files || {}) }, changed: true }
}

// A drawing on screen and the file behind it. It loads, saves a moment after each change (save),
// and, with stat, picks up a newer file written by something else (an agent, the chief of staff,
// another window): straight in when nothing here is unsaved, else asking which to keep.
function useDrawing(key, store) {
  const [ready, setReady] = useState(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('saved') // saved | unsaved | saving | { failed }
  const [conflict, setConflict] = useState(false)
  const [board, setBoard] = useState({ X: null, api: null })
  const st = useRef({})
  const storeRef = useRef(store)
  storeRef.current = store

  // A drawing saves with the store it was loaded from (kept in st), never the one on screen next.
  const flush = useCallback(async (force = false) => {
    const s = st.current
    const save = s.store?.save
    clearTimeout(s.timer)
    if (!save || !s.X || !s.last) return
    if (s.busy) { s.again = true; return s.busy }
    if (!s.dirty && !force) return
    s.dirty = false
    setStatus('saving')
    const { elements, appState, files } = s.last
    s.busy = (async () => {
      try {
        const r = await save({ X: s.X, elements, appState, files, mtime: s.mtime, force })
        s.mtime = r.mtime
        setConflict(false)
        setStatus(s.dirty ? 'unsaved' : 'saved')
      } catch (e) {
        s.dirty = true
        if (e.conflict) { setConflict(true); setStatus('unsaved') } else setStatus({ failed: e.message })
      } finally {
        s.busy = null
        if (s.again) { s.again = false; if (s.dirty) flush() }
      }
    })()
    return s.busy
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let gone = false
    const s0 = { mtime: null, sig: null, dirty: false, store: storeRef.current }
    st.current = s0
    setReady(null); setError(null); setConflict(false); setStatus('saved'); setBoard({ X: null, api: null })
    ;(async () => {
      const X = await loadExcalidraw()
      const b = await s0.store.load(X)
      const got = await withPending(X, b)
      if (gone) return
      Object.assign(s0, { X, mtime: b.mtime, dirty: got.changed })
      setReady({ initial: { elements: got.elements, appState: b.appState || {}, files: got.files, scrollToContent: true } })
    })().catch((e) => { if (!gone) setError(e.message) })
    return () => { gone = true; if (s0.dirty) flush() }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = useCallback((elements, appState, files) => {
    const s = st.current
    if (!s.X) return
    s.last = { elements: elements.filter((e) => !e.isDeleted), appState, files }
    const sig = `${s.X.getSceneVersion(elements)}:${Object.keys(files || {}).length}:${appState.viewBackgroundColor || ''}`
    // The first look is what was loaded, unless it needs saving (a hand-over drawn in).
    if (s.sig == null) { s.sig = sig; if (!s.dirty) return } else if (sig === s.sig) return
    s.sig = sig
    s.dirty = true
    setStatus('unsaved')
    clearTimeout(s.timer)
    s.timer = setTimeout(() => flush(), 700)
  }, [flush])

  // A newer file from somewhere else, drawn in (⌘Z takes it back).
  const takeTheirs = useCallback(async () => {
    const s = st.current
    if (!s.X || !s.api) return
    const b = await s.store.load(s.X)
    const got = await withPending(s.X, b)
    if (Object.keys(got.files || {}).length) s.api.addFiles(Object.values(got.files))
    s.mtime = b.mtime
    s.sig = null
    s.dirty = got.changed
    setConflict(false)
    s.api.updateScene({ elements: got.elements, captureUpdate: s.X.CaptureUpdateAction.IMMEDIATELY })
  }, [])

  useEffect(() => {
    if (!ready || !store.stat) return
    const tick = async () => {
      const s = st.current
      if (document.hidden || s.busy || !s.api) return
      const now = await s.store.stat?.().catch(() => null)
      if (!now || s.mtime == null || Math.abs(now.mtime - s.mtime) <= 1) return
      if (s.dirty) setConflict(true)
      else takeTheirs().catch(() => {})
    }
    const id = setInterval(tick, 2500)
    return () => clearInterval(id)
  }, [ready, key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Unsaved when the window closes: saved, and the browser asked to wait.
  useEffect(() => {
    const warn = (e) => { if (st.current.dirty) { flush(); e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [flush])

  const onApi = useCallback((a, X) => { st.current.api = a; setBoard((b) => (b.api === a ? b : { X, api: a })) }, [])
  return { ready, error, status, conflict, board, onChange, onApi, flush, takeTheirs }
}

function SaveState({ status }) {
  if (status?.failed) return <span className="small wb-state bad" role="alert" title={status.failed}><Icon name="alert" size={11} /> {t("Couldn't save: {error}", { error: status.failed })}</span>
  return <span className="muted small wb-state" role="status">{status === 'saving' ? t('Saving…') : status === 'unsaved' ? t('Edited') : t('Saved')}</span>
}

function Conflict({ onTheirs, onMine }) {
  return (
    <div className="wb-conflict" role="alert">
      <Icon name="alert" size={13} /><span>{t('This drawing was changed somewhere else (an agent, perhaps) since you opened it.')}</span>
      <button type="button" className="btn small" onClick={onTheirs}>{t('Load that one')}</button>
      <button type="button" className="btn small" onClick={onMine}>{t('Keep mine')}</button>
    </div>
  )
}

// Asked for in the list before a board opened: what to draw on it.
const startOn = new Map()

// ---------- One board ----------
export function WhiteboardPage({ id, onBack }) {
  const store = useMemo(() => ({
    load: async () => { const b = await api(`/boards/${enc(id)}`); return { mtime: b.mtime, elements: b.data.elements || [], appState: b.data.appState || {}, files: b.data.files || {}, pending: b.data.bridge?.pending || null } },
    save: async ({ X, elements, appState, files, mtime, force }) => {
      const text = X.serializeAsJSON(elements, appState, files, 'local')
      const preview = elements.length ? await previewOf(X, elements, appState, files).catch(() => null) : null
      return send(`/boards/${enc(id)}`, { text, mtime, force, preview }, 'PUT')
    },
    stat: () => api(`/boards/${enc(id)}/stat`),
  }), [id])
  const d = useDrawing(id, store)
  const [start] = useState(() => { const s = startOn.get(id); startOn.delete(id); return s || null })
  const [panel, setPanel] = useState(!!start)
  const [menu, setMenu] = useState(null)
  const [err, setErr] = useState(null)
  const dark = useDarkMode()
  const wide = useMedia('(min-width: 700px)')
  // Whether this computer can show the folder (not in Docker, or on Linux with no desktop).
  const canOpen = !!usePoll('/boards', 10 * 60 * 1000).data?.canOpen

  const rename = async (title) => {
    if (!title?.trim() || title.trim() === id) return
    await d.flush()
    const r = await api(`/boards/${enc(id)}`, { method: 'PATCH', body: { title } })
    refetch('/boards')
    if (r.id !== id) openBoard(r.id, { replace: `view:whiteboard:${id}` })
  }
  const remove = async () => {
    if (!window.confirm(t('Delete the whiteboard "{name}"? It goes to the .trash folder beside your boards.', { name: id }))) return
    await api(`/boards/${enc(id)}`, { method: 'DELETE' })
    refetch('/boards')
    openBoards({ replace: `view:whiteboard:${id}` })
  }
  const exp = (kind) => exportAs(d.board.X, d.board.api, kind, id, dark).catch((e) => setErr(e.message))
  const [naming, setNaming] = useState(false)

  return (
    <div className="wb-view">
      <PaneHeader icon="shapes" title={id} subtitle={<SaveState status={d.status} />}
        leading={onBack ? <button type="button" className="win-btn" onClick={onBack} aria-label={t('All whiteboards')} title={t('All whiteboards')}><Icon name="back" size={15} /></button> : null}>
        <button type="button" className={`btn small${panel ? '' : ' primary'}`} onClick={() => setPanel(!panel)} aria-pressed={panel} disabled={!d.board.api}><Icon name="sparkle" size={12} /> {wide ? t('Draw this') : ''}</button>
        <span className="menu-anchor">
          <button type="button" className="win-btn" onClick={() => setMenu(menu === 'export' ? null : 'export')} aria-label={t('Export')} title={t('Export')} disabled={!d.board.api}><Icon name="download" size={14} /></button>
          {menu === 'export' && <Menu onClose={() => setMenu(null)} items={[
            { label: t('Export as PNG'), icon: 'image', run: () => exp('png') },
            { label: t('Export as SVG'), icon: 'image', run: () => exp('svg') },
          ]} />}
        </span>
        <span className="menu-anchor">
          <button type="button" className="win-btn" onClick={() => setMenu(menu === 'more' ? null : 'more')} aria-label={t('More')} title={t('More')}><Icon name="more" size={14} /></button>
          {menu === 'more' && <Menu onClose={() => setMenu(null)} items={[
            { label: t('Rename…'), icon: 'edit', run: () => setNaming(true) },
            onThisComputer() && canOpen && { label: t('Show the boards folder'), icon: 'folder', run: () => api('/boards/folder', { method: 'POST' }).catch((e) => setErr(e.message)) },
            '-',
            { label: t('Delete'), icon: 'trash', danger: true, run: () => remove().catch((e) => setErr(e.message)) },
          ]} />}
        </span>
      </PaneHeader>
      {naming && <NameDialog title={t('Name this whiteboard')} initial={id} action={t('Rename')} onSubmit={rename} onClose={() => setNaming(false)} />}
      {d.conflict && <Conflict onTheirs={() => d.takeTheirs().catch((e) => setErr(e.message))} onMine={() => d.flush(true)} />}
      {err && <p className="error-text small wb-err" role="alert">{err} <button type="button" className="link-btn" onClick={() => setErr(null)}>{t('OK')}</button></p>}
      <div className="wb-body">
        {d.error ? <div className="wb-wait"><p className="error-text small" role="alert">{d.error}</p></div>
          : d.ready ? <Canvas key={id} initial={d.ready.initial} onApi={d.onApi} onChange={d.onChange} onSave={() => d.flush(true)} name={id} />
            : <div className="wb-wait" aria-busy="true"><span className="muted small">{t('Opening the whiteboard…')}</span></div>}
        {panel && d.board.api && <div className="wb-draw-wrap"><DrawPanel board={d.board} start={start} onClose={() => setPanel(false)} compact={!wide} /></div>}
      </div>
    </div>
  )
}

// ---------- The list ----------
// title: the first words of what was asked for, as a board's name.
const titleFor = (s) => String(s || '').replace(/^(draw|make|show|create)\s+(me\s+)?(a|an|the)?\s*/i, '').split(/\s+/).slice(0, 7).join(' ').replace(/[.,;:!?]+$/, '').replace(/^./, (c) => c.toUpperCase())

export function WhiteboardsHome({ onOpen }) {
  const { data, error, refresh } = usePoll('/boards', 15000)
  const boards = data?.boards || []
  const [text, setText] = useState('')
  const [kind, setKind] = usePersisted('cc-board-kind', 'auto')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const m = useBoardModels()
  const dark = useDarkMode()
  useEffect(() => { loadExcalidraw().catch(() => {}) }, []) // ready by the time a board opens

  const create = async (o = {}) => {
    setBusy(true); setErr(null)
    try {
      const b = await api('/boards', { method: 'POST', body: { title: o.title || t('Untitled') } })
      if (o.prompt) startOn.set(b.id, { prompt: o.prompt, kind, model: m.id || undefined })
      refresh()
      onOpen?.(b.id)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const draw = (e) => { e?.preventDefault(); const p = text.trim(); if (p && !busy) create({ title: titleFor(p), prompt: p }).then(() => setText('')) }
  const n = boards.length
  return (
    <div className="wb-view">
      <PaneHeader icon="shapes" title={t('Whiteboards')} subtitle={(
        <>
          <span className="sub-where">{data ? (n === 1 ? t('{n} whiteboard', { n }) : t('{n} whiteboards', { n })) : ''}</span>
          {data?.folder && <button type="button" className="path-chip" onClick={() => onThisComputer() && data.canOpen && api('/boards/folder', { method: 'POST' }).catch((x) => setErr(x.message))} title={t('Where whiteboards are saved: {path}', { path: data.folder })}><Icon name="folder" size={10} /> <span>{data.folder.replace(/^(\/Users\/|\/home\/|C:\\Users\\)[^/\\]+/, '~')}</span></button>}
        </>
      )}>
        <button type="button" className="btn small primary" onClick={() => create()} disabled={busy}><Icon name="plus" size={13} /> {t('New whiteboard')}</button>
      </PaneHeader>
      <div className="wb-home">
        <form className="wb-ask" onSubmit={draw}>
          <h1>{t('What should we draw?')}</h1>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Describe a flowchart, an architecture, a sequence or an org chart. It comes out as shapes you can move and edit.')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) draw(e) }} aria-label={t('What to draw')} />
          <div className="wb-ask-row">
            <div className="wb-kinds" role="radiogroup" aria-label={t('Kind of diagram')}>
              {KINDS.map(([id, label]) => <button type="button" key={id} role="radio" aria-checked={kind === id} className={`chip${kind === id ? ' on' : ''}`} onClick={() => setKind(id)}>{t(label)}</button>)}
            </div>
            <span className="wb-grow" />
            <button type="submit" className="btn small primary" disabled={busy || !text.trim() || (m.loaded && !m.models.length)}><Icon name="sparkle" size={12} /> {t('Draw')}</button>
          </div>
          {m.loaded && !m.models.length
            ? <p className="small muted">{t('No model to draw with yet: sign in to an agent (Claude Code, Codex…) or add a key in Settings › Model Providers. You can still draw by hand.')}</p>
            : m.model && <p className="small muted">{m.model.via === 'local' ? t('Drawn by {model}, on this computer.', { model: m.model.label }) : t('Drawn by {model}: your words go to {provider}.', { model: m.model.label, provider: m.model.provider || m.model.label })} {t("To draw from a meeting, a project or an agent's work, use Draw this on a board.")}</p>}
        </form>
        {(err || (error && !data)) && <p className="error-text small" role="alert">{err || error}</p>}
        {data && !n && (
          <div className="wb-empty">
            <Icon name="shapes" size={22} />
            <p>{t('No whiteboards yet.')}</p>
            <p className="muted small">{t('Draw by hand, paste pictures in, or ask for a diagram above. Agents and the Chief of Staff can make boards too, and diagram files in your projects (.excalidraw, Mermaid, draw.io) open as boards from Files.')}</p>
          </div>
        )}
        {n > 0 && (
          <ul className={`wb-grid${dark ? ' dark' : ''}`} aria-label={t('Whiteboards')}>
            {boards.map((b) => (
              <li key={b.id}>
                <button type="button" className="wb-card" onClick={() => onOpen?.(b.id)}>
                  <span className="wb-thumb">{b.preview ? <img src={apiUrl(`/boards/${enc(b.id)}/preview?v=${Math.round(b.preview)}`)} alt="" loading="lazy" /> : <Icon name="shapes" size={22} />}</span>
                  <span className="wb-card-title">{b.title}</span>
                  <span className="muted small">{t('Edited {when}', { when: fmtRelative(new Date(b.mtime).toISOString()) })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ---------- A diagram file in an agent's Files tab ----------
// .excalidraw: drawn, and saved back into the file. Mermaid and draw.io: drawn as shapes to move and
// edit; the file stays as it is, and the drawing can be saved beside it as .excalidraw or added to
// your whiteboards. f: the file as the viewer has it; onSaved(file): after saving into it;
// onOpenPath: to the copy saved beside it.
export function FileDrawing({ pane, f, onSaved, onOpenPath }) {
  const kind = kindOfFile(f.name)
  const own = kind === 'excalidraw'
  // A save of ours changes the file's time; only someone else's change draws it again.
  const ours = useRef(new Set())
  const [version, setVersion] = useState(f.mtime)
  useEffect(() => { if (!ours.current.has(f.mtime)) setVersion(f.mtime) }, [f.mtime])
  const fRef = useRef(f)
  fRef.current = f
  const savedRef = useRef(onSaved)
  savedRef.current = onSaved
  const store = useMemo(() => {
    const file = f.path
    return {
      load: async () => {
        const cur = fRef.current.path === file ? fRef.current : null
        const text = !cur || cur.truncated ? await (await fetch(apiUrl(`/agents/${enc(pane)}/raw?path=${enc(file)}`))).text() : cur.text
        const X = await loadExcalidraw()
        const got = await fromText(X, text, kind)
        return { mtime: cur?.mtime ?? null, elements: got.elements, appState: got.appState || {}, files: got.files || {} }
      },
      save: own ? async ({ X, elements, appState, files, mtime, force }) => {
        const r = await send(`/agents/${enc(pane)}/file`, { path: file, text: X.serializeAsJSON(elements, appState, files, 'local'), mtime, force }, 'PUT')
        ours.current.add(r.mtime)
        if (fRef.current.path === file) savedRef.current?.(r)
        return r
      } : null,
    }
  }, [pane, f.path, kind, own])
  const d = useDrawing(`${pane}\n${f.path}\n${version}`, store)
  const [panel, setPanel] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)
  const base = f.name.replace(/\.(excalidraw|mmd|mermaid|drawio|dio)(\.(json|xml))?$/i, '')

  const json = () => { const { X, api: ex } = d.board; return X.serializeAsJSON(ex.getSceneElements(), ex.getAppState(), ex.getFiles(), 'local') }
  const saveBeside = async () => {
    setErr(null)
    try {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
      const made = await fileOp(pane, 'newFile', dir, `${base}.excalidraw`)
      await send(`/agents/${enc(pane)}/file`, { path: made.path, text: json() }, 'PUT')
      onOpenPath?.(made.path)
    } catch (e) { setErr(e.message) }
  }
  const toBoards = async () => {
    setErr(null)
    try {
      const b = await api('/boards', { method: 'POST', body: { title: base, source: { kind: 'excalidraw', text: json() } } })
      refetch('/boards')
      setDone(b.id)
    } catch (e) { setErr(e.message) }
  }
  return (
    <div className="wb-file">
      <div className="wb-file-bar">
        {own ? <SaveState status={d.status} /> : <span className="muted small">{kind === 'drawio' ? t('Drawn from this draw.io file, which stays as it is.') : t('Drawn from this Mermaid, which stays as it is.')}</span>}
        <span className="wb-grow" />
        {!own && <button type="button" className="btn small" onClick={saveBeside} disabled={!d.board.api} title={t('Saves the drawing as {name} next to this file', { name: `${base}.excalidraw` })}>{t('Save as .excalidraw')}</button>}
        <button type="button" className="btn small" onClick={done ? () => openBoard(done) : toBoards} disabled={!d.board.api}><Icon name="shapes" size={12} /> {done ? t('Open in Whiteboards') : t('Add to Whiteboards')}</button>
        <button type="button" className={`btn small${panel ? ' on' : ''}`} onClick={() => setPanel(!panel)} disabled={!d.board.api} aria-pressed={panel}><Icon name="sparkle" size={12} /> {t('Draw this')}</button>
      </div>
      {d.conflict && <Conflict onTheirs={() => d.takeTheirs().catch((e) => setErr(e.message))} onMine={() => d.flush(true)} />}
      {err && <p className="error-text small wb-err" role="alert">{err}</p>}
      <div className="wb-body">
        {d.error ? <div className="wb-wait"><p className="error-text small" role="alert">{d.error}</p></div>
          : d.ready ? <Canvas key={version} initial={d.ready.initial} onApi={d.onApi} onChange={d.onChange} onSave={() => d.flush(true)} name={base} />
            : <div className="wb-wait" aria-busy="true"><span className="muted small">{t('Opening the whiteboard…')}</span></div>}
        {panel && d.board.api && <div className="wb-draw-wrap"><DrawPanel board={d.board} onClose={() => setPanel(false)} compact /></div>}
      </div>
    </div>
  )
}
