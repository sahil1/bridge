import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { PaneHeader, usePersisted, useMedia } from '../layout.jsx'
import { api, apiUrl, usePoll, refetch, fmtRelative, onThisComputer } from '../../api.js'
import { t } from '../../i18n/index.js'
import Canvas, { useDarkMode } from './Canvas.jsx'
import DrawPanel, { KINDS, useBoardModels } from './DrawPanel.jsx'
import ShapePanel, { DRAG_TYPE } from './ShapePanel.jsx'
import BoardSettings from './BoardSettings.jsx'
import { loadExcalidraw } from './excalidraw.js'
import { fromText, fromPending, kindOfFile, placeBeside } from './convert.js'
import { layoutBoard, reroute } from './layout.js'
import { restyle, lookOfElements, solidBackground, fontsReady, remeasure } from './look.js'
import { makeItem } from './shapes/make.js'
import { nameOf, laneName } from './shapes/library.js'
import { snapshot, observe, tellServer } from './learn.js'
import { holderOf, contents } from './holders.js'
import { ITEMS } from '../../../shared/whiteboard/catalog.js'
import { openBoard, openBoards } from './links.js'
import { NameDialog } from '../FileExtras.jsx'
import { useBusy } from '../../busy.js'
import './whiteboard.css'

// Whiteboards: the list (WhiteboardsHome), one board (WhiteboardPage), and a diagram file in an
// agent's Files tab drawn as a board (FileDrawing). The boards are files in ~/.bridge-ai/boards
// (server/boards.js); a board saves itself a moment after each change. Around the drawing (Canvas,
// Excalidraw in Bridge AI's look) are Bridge AI's own parts: the Shapes panel, Draw this with
// Refine, Auto-layout, Export (PNG, SVG, PDF) and the whiteboard's settings.

const enc = encodeURIComponent
const fileOp = (pane, op, path, name) => api(`/agents/${enc(pane)}/fileop`, { method: 'POST', body: { op, path, name } })

// A small menu under a button: a click outside or Escape closes it. title: a line above the
// items; foot: options below them.
function Menu({ items, onClose, title, foot }) {
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
      {title && <div className="menu-title muted small">{title}</div>}
      {items.filter(Boolean).map((it, i) => it === '-' ? <div key={i} className="menu-sep" /> : (
        <button type="button" key={it.label} role="menuitem" className={`menu-item ${it.danger ? 'danger' : ''}`} onClick={() => { onClose(); it.run() }}><Icon name={it.icon} size={13} /> {it.label}</button>
      ))}
      {foot && <><div className="menu-sep" />{foot}</>}
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
const previewOf = async (X, elements, appState, files) => toDataUrl(await X.exportToBlob({ elements, appState: { ...solidBackground(appState), exportBackground: true, exportWithDarkMode: false }, files, mimeType: 'image/png', maxWidthOrHeight: 480, exportPadding: 16 }))

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
// The board, or what's selected (with what's inside a selected container), as a picture: PNG at
// twice the size, for sharp text; SVG with its fonts in it; or PDF (pdf.js), lines and words kept
// as they are. Light or dark.
async function exportBoard(X, ex, { kind, name, dark, only }) {
  let elements = ex.getSceneElements()
  if (only) {
    const picked = new Set(Object.entries(ex.getAppState().selectedElementIds || {}).filter(([, on]) => on).map(([id]) => id))
    for (const e of elements) if (picked.has(e.id) && holderOf(e)) contents(e, elements).forEach((c) => picked.add(c.id))
    elements = elements.filter((e) => picked.has(e.id) || picked.has(e.containerId))
  }
  if (!elements.length) throw new Error(t('Nothing on the board to export yet'))
  const o = { elements, appState: { ...solidBackground(ex.getAppState()), exportBackground: true, exportWithDarkMode: dark }, files: ex.getFiles(), exportPadding: 24 }
  const png = () => X.exportToBlob({ ...o, mimeType: 'image/png', getDimensions: (w, h) => ({ width: w * 2, height: h * 2, scale: 2 }) })
  let blob
  if (kind === 'svg') blob = new Blob([(await X.exportToSvg(o)).outerHTML], { type: 'image/svg+xml' })
  else if (kind === 'pdf') {
    const { svgToPdf } = await import('./pdf.js')
    // The PDF writes its words in its own fonts (pdf.js), so the SVG needn't carry the board's.
    blob = await svgToPdf(await X.exportToSvg({ ...o, appState: { ...o.appState, exportWithDarkMode: false }, skipInliningFonts: true }), { dark, name, png })
  } else blob = await png()
  download(blob, `${name}.${kind}`)
}

// What an agent or the chief of staff handed over, drawn in: in place of what's there, or beside it.
async function withPending(X, b, look) {
  if (!b.pending) return { elements: b.elements, files: b.files, changed: false }
  const got = await fromPending(X, b.pending, look)
  const keep = (b.elements || []).filter((e) => !e.isDeleted)
  const elements = b.pending.mode === 'add' ? [...keep, ...placeBeside(X, got.elements, keep)] : got.elements
  return { elements, files: { ...(b.files || {}), ...(got.files || {}) }, changed: true }
}

// A drawing on screen and the file behind it. It loads, saves a moment after each change (save),
// and, with stat, picks up a newer file written by something else (an agent, the chief of staff,
// another window): straight in when nothing here is unsaved, else asking which to keep.
// look: the look for a board with nothing on it yet (what the user prefers).
function useDrawing(key, store, look = null) {
  const [ready, setReady] = useState(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('saved') // saved | unsaved | saving | { failed }
  const [conflict, setConflict] = useState(false)
  const [board, setBoard] = useState({ X: null, api: null })
  const st = useRef({})
  const storeRef = useRef(store)
  storeRef.current = store
  const lookRef = useRef(look)
  lookRef.current = look

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
        s.saves++
        if (s.again) { s.again = false; if (s.dirty) flush() }
      }
    })()
    return s.busy
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let gone = false
    const s0 = { mtime: null, sig: null, dirty: false, saves: 0, store: storeRef.current }
    st.current = s0
    setReady(null); setError(null); setConflict(false); setStatus('saved'); setBoard({ X: null, api: null })
    ;(async () => {
      const X = await loadExcalidraw()
      const b = await s0.store.load(X)
      const was = lookOfElements(b.elements || []) || lookRef.current || 'clean'
      const got = await withPending(X, b, was)
      if (gone) return
      // A diagram handed over and drawn in: its elbow arrows are routed once it's on the board.
      Object.assign(s0, { X, mtime: b.mtime, dirty: got.changed, route: got.changed })
      setReady({ look: was, initial: { elements: got.elements, appState: b.appState || {}, files: got.files, scrollToContent: true } })
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
    const got = await withPending(s.X, b, lookOfElements(s.api.getSceneElements()) || lookRef.current || 'clean')
    if (Object.keys(got.files || {}).length) s.api.addFiles(Object.values(got.files))
    s.mtime = b.mtime
    s.sig = null
    s.dirty = got.changed
    setConflict(false)
    s.api.updateScene({ elements: got.elements, captureUpdate: s.X.CaptureUpdateAction.IMMEDIATELY })
    if (got.changed) { reroute(s.X, s.api); remeasure(s.X, s.api).catch(() => {}) }
  }, [])

  useEffect(() => {
    if (!ready || !store.stat) return
    const tick = async () => {
      const s = st.current
      if (document.hidden || s.busy || !s.api) return
      const n = s.saves
      const now = await s.store.stat?.().catch(() => null)
      // Saved here meanwhile: what this look saw may be that save, not someone else's. The next looks again.
      if (s.busy || s.saves !== n) return
      if (!now || s.mtime == null || Math.abs(now.mtime - s.mtime) <= 1) return
      if (s.dirty) setConflict(true)
      else takeTheirs().catch(() => {})
    }
    const id = setInterval(tick, 2500)
    return () => clearInterval(id)
  }, [ready, key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Unsaved when the window closes: saved, and the browser asked to wait. Meanwhile the desktop app
  // doesn't update by itself (busy.js).
  useEffect(() => {
    const warn = (e) => { if (st.current.dirty) { flush(); e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [flush])
  useBusy('board', status !== 'saved')

  const onApi = useCallback((a, X) => {
    st.current.api = a
    if (st.current.route) { st.current.route = false; setTimeout(() => { reroute(X, a); remeasure(X, a, null, lookRef.current || 'clean').catch(() => {}) }, 0) }
    setBoard((b) => (b.api === a ? b : { X, api: a }))
  }, [])
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
// What a model last drew on each board (learn.js), kept while Bridge AI is open, so what's changed
// after coming back to a board's tab still teaches.
const drawnOn = new Map()

// A name you click to change: a board's, in its header and in the list. Enter or leaving the box
// keeps it, Escape doesn't.
function EditableName({ name, onRename, label, editNow = 0 }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(name)
  const [err, setErr] = useState(null)
  // Rename… in a menu opens the box.
  useEffect(() => { if (editNow) { setV(name); setEditing(true) } }, [editNow]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = async (keep) => {
    const next = v.trim()
    if (!keep || !next || next === name) { setEditing(false); setErr(null); return }
    try { await onRename(next); setEditing(false); setErr(null) } catch (e) { setErr(e.message) }
  }
  if (!editing) return <button type="button" className="wb-name" onClick={(e) => { e.stopPropagation(); setV(name); setEditing(true) }} title={t('Click to rename')}><span>{name}</span><Icon name="edit" size={11} /></button>
  return (
    <span className="wb-name-edit">
      <input className="wb-name-input" value={v} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)} aria-label={label || t('Name')} spellCheck={false}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); done(true) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false) } }} onBlur={() => done(true)} />
      {err && <span className="error-text small" role="alert">{err}</span>}
    </span>
  )
}

// The whiteboard's preferences (BoardSettings.jsx), loaded once for the page.
function usePrefs() {
  const [p, setP] = useState(null)
  useEffect(() => { api('/boards/preferences').then(setP).catch(() => setP({ on: true, prefs: {}, notes: '' })) }, [])
  return [p, setP]
}

// A shape from the Shapes panel on the board: where you're looking, or where it was dropped.
// Containers go behind what's there, so what's dropped on them stays on top.
async function addShape(X, ex, item, { at, look, scheme }) {
  await fontsReady(look)
  const { width, height, scrollX, scrollY, zoom } = ex.getAppState()
  const p = at || { x: -scrollX + width / 2 / zoom.value, y: -scrollY + height / 2 / zoom.value }
  const label = nameOf(item)
  const got = makeItem(X, item.kind === 'lanes' ? { ...item, laneName: laneName() } : item, { x: p.x, y: p.y, label, look, scheme })
  if (Object.keys(got.files).length) ex.addFiles(Object.values(got.files))
  const all = ex.getSceneElementsIncludingDeleted()
  const behind = item.kind === 'container' || item.kind === 'lanes'
  const main = got.elements.find((e) => e.customData?.bridge?.holder && e.customData.bridge.holder !== 'lane') || got.elements.find((e) => !e.containerId)
  ex.updateScene({ elements: behind ? [...got.elements, ...all] : [...all, ...got.elements], appState: { selectedElementIds: main ? { [main.id]: true } : {} }, captureUpdate: X.CaptureUpdateAction.IMMEDIATELY })
}

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
  const [prefs, setPrefs] = usePrefs()
  const d = useDrawing(id, store, prefs?.prefs?.look?.value)
  // Drawn once, as the board first opens; the panel opened again later starts empty.
  const [start, setStart] = useState(() => { const s = startOn.get(id); startOn.delete(id); return s || null })
  const wide = useMedia('(min-width: 700px)')
  const [panel, setPanel] = useState(start ? 'draw' : null) // draw | settings
  // The Shapes panel: open beside the board on a computer (as you left it); on a phone, where it
  // covers the board, only when asked for.
  const [shapesWide, setShapesWide] = usePersisted('cc-board-shapes', true)
  const [shapesNarrow, setShapesNarrow] = useState(false)
  const shapes = wide ? shapesWide : shapesNarrow
  const setShapes = (on) => (wide ? setShapesWide(on) : setShapesNarrow(on))
  const [menu, setMenu] = useState(null)
  const [err, setErr] = useState(null)
  const [look, setLook] = useState(null)
  const dark = useDarkMode()
  // Whether this computer can show the folder (not in Docker, or on Linux with no desktop).
  const canOpen = !!usePoll('/boards', 10 * 60 * 1000).data?.canOpen
  const boardLook = look || d.ready?.look || 'clean'
  const scheme = prefs?.on ? prefs.prefs?.colours?.value || 'soft' : 'soft'
  // How much is on the board and selected, for the empty board's hint and the menus.
  const [count, setCount] = useState({ n: 0, sel: 0 })
  useEffect(() => d.board.api?.onChange((els, st) => {
    const n = els.filter((e) => !e.isDeleted).length, sel = Object.values(st.selectedElementIds || {}).filter(Boolean).length
    setCount((c) => (c.n === n && c.sel === sel ? c : { n, sel }))
  }), [d.board.api])
  useEffect(() => { const ex = d.board.api; if (ex) setCount({ n: ex.getSceneElements().length, sel: 0 }) }, [d.board.api])

  // Learning: what a model drew, then what the user changes in it (learn.js).
  const snap = useMemo(() => ({ get current() { return drawnOn.get(id) || null }, set current(v) { drawnOn.set(id, v) } }), [id])
  useEffect(() => {
    const ex = d.board.api
    if (!ex) return
    let timer = null
    const off = ex.onChange(() => {
      if (!snap.current) return
      clearTimeout(timer)
      timer = setTimeout(() => { const found = observe(snap.current, ex.getSceneElementsIncludingDeleted()); if (found.length) tellServer(found, id).then((r) => { const last = r.filter(Boolean).at(-1); if (last) setPrefs(last) }) }, 3000)
    })
    return () => { off?.(); clearTimeout(timer) }
  }, [d.board.api, id]) // eslint-disable-line react-hooks/exhaustive-deps
  const drawn = ({ ids, direction }) => { const ex = d.board.api; if (ex) setTimeout(() => { snap.current = snapshot(ex.getSceneElementsIncludingDeleted(), ids, { direction, board: id }) }, 0) }

  const rename = async (title) => {
    if (!title?.trim() || title.trim() === id) return
    await d.flush()
    const r = await api(`/boards/${enc(id)}`, { method: 'PATCH', body: { title } })
    refetch('/boards')
    if (r.id !== id && drawnOn.has(id)) { drawnOn.set(r.id, { ...drawnOn.get(id), board: r.id }); drawnOn.delete(id) }
    if (r.id !== id) openBoard(r.id, { replace: `view:whiteboard:${id}` })
  }
  const remove = async () => {
    if (!window.confirm(t('Delete the whiteboard "{name}"? It goes to the .trash folder beside your boards.', { name: id }))) return
    await api(`/boards/${enc(id)}`, { method: 'DELETE' })
    refetch('/boards')
    openBoards({ replace: `view:whiteboard:${id}` })
  }
  const [naming, setNaming] = useState(false)
  const [only, setOnly] = useState(false)
  const [exportDark, setExportDark] = useState(null)
  const exp = (kind) => exportBoard(d.board.X, d.board.api, { kind, name: id, dark: exportDark ?? dark, only: only && count.sel > 0 }).catch((e) => setErr(e.message))
  const layout = (dir) => {
    const { X, api: ex } = d.board
    const moved = layoutBoard(X, ex, { dir, spacing: prefs?.on ? prefs.prefs?.spacing?.value || 'normal' : 'normal' })
    if (!moved) { setErr(t('Nothing to lay out: it needs two shapes or more.')); return }
    // Laid out the other way from a model's drawing: that's a preference.
    if (snap.current?.direction && snap.current.direction !== dir) tellServer([{ key: 'direction', value: dir, from: snap.current.direction }], id).then((r) => r[0] && setPrefs(r[0]))
    if (snap.current) snap.current.direction = dir
  }
  const pickLook = (next) => {
    const { X, api: ex } = d.board
    if (ex && next !== boardLook) ex.updateScene({ elements: restyle(X, ex.getSceneElementsIncludingDeleted(), next), captureUpdate: X.CaptureUpdateAction.IMMEDIATELY })
    setLook(next)
    api('/boards/preferences', { method: 'PUT', body: { set: { look: next } } }).then(setPrefs).catch(() => {})
  }
  const add = (item, set) => {
    const { X, api: ex } = d.board
    if (!ex) return
    addShape(X, ex, item, { look: boardLook, scheme })
    if (['aws', 'azure', 'gcp'].includes(set) || (set === 'network' && snap.current)) tellServer([{ key: 'iconSet', value: set }], id).then((r) => r[0] && setPrefs(r[0]))
  }
  // A shape dragged in from the panel.
  const drop = (e) => {
    const raw = e.dataTransfer?.getData(DRAG_TYPE)
    if (!raw) return
    e.preventDefault(); e.stopPropagation()
    const { X, api: ex } = d.board
    let o = null
    try { o = JSON.parse(raw) } catch { return }
    const item = ITEMS.get(o.id)
    if (!item || !ex) return
    const at = X.viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, ex.getAppState())
    addShape(X, ex, item, { at, look: boardLook, scheme })
    if (['aws', 'azure', 'gcp'].includes(o.set)) tellServer([{ key: 'iconSet', value: o.set }], id).then((r) => r[0] && setPrefs(r[0]))
  }
  const help = () => d.board.api?.updateScene({ appState: { openDialog: { name: 'help' } } })
  // There from the start (not once the board is up), so the board is centred in the room it keeps.
  const showShapes = shapes && !d.error
  const sel = count.sel > 0

  return (
    <div className="wb-view">
      <PaneHeader icon="shapes" title={<EditableName name={id} onRename={rename} label={t('Name this whiteboard')} />} subtitle={<SaveState status={d.status} />}
        leading={onBack ? <button type="button" className="win-btn" onClick={onBack} aria-label={t('All whiteboards')} title={t('All whiteboards')}><Icon name="back" size={15} /></button> : null}>
        <button type="button" className={`btn small${shapes ? ' on' : ''}`} onClick={() => setShapes(!shapes)} aria-pressed={!!shapes} disabled={!d.board.api} title={t('Shapes')}><Icon name="shapes" size={12} /> {wide ? t('Shapes') : ''}</button>
        <button type="button" className={`btn small${panel === 'draw' ? '' : ' primary'}`} onClick={() => setPanel(panel === 'draw' ? null : 'draw')} aria-pressed={panel === 'draw'} disabled={!d.board.api} aria-label={t('Draw this')} title={t('Draw this')}><Icon name="sparkle" size={12} /> {wide ? t('Draw this') : ''}</button>
        {/* On a phone, Auto-layout and Export are in the More menu, so the header fits. */}
        {wide && <span className="menu-anchor">
          <button type="button" className="win-btn" onClick={() => setMenu(menu === 'layout' ? null : 'layout')} aria-label={t('Auto-layout')} title={t('Auto-layout')} disabled={!d.board.api}><Icon name="grid" size={14} /></button>
          {menu === 'layout' && <Menu onClose={() => setMenu(null)} title={sel ? t('Lay out the selection') : t('Lay out the whole board')} items={[
            { label: t('Left to right'), icon: 'split', run: () => layout('LR') },
            { label: t('Top to bottom'), icon: 'layers', run: () => layout('TB') },
          ]} />}
        </span>}
        {wide && <span className="menu-anchor">
          <button type="button" className="win-btn" onClick={() => setMenu(menu === 'export' ? null : 'export')} aria-label={t('Export')} title={t('Export')} disabled={!d.board.api}><Icon name="download" size={14} /></button>
          {menu === 'export' && <Menu onClose={() => setMenu(null)} items={[
            { label: t('Export as PNG'), icon: 'image', run: () => exp('png') },
            { label: t('Export as SVG'), icon: 'image', run: () => exp('svg') },
            { label: t('Export as PDF'), icon: 'doc', run: () => exp('pdf') },
          ]} foot={(
            <div className="wb-export-opts">
              <label className="small"><input type="checkbox" checked={only && sel} disabled={!sel} onChange={(e) => setOnly(e.target.checked)} /> {t('Only what’s selected')}</label>
              <div className="seg small-seg" role="radiogroup" aria-label={t('Background')}>
                <button type="button" role="radio" aria-checked={!(exportDark ?? dark)} className={!(exportDark ?? dark) ? 'on' : ''} onClick={() => setExportDark(false)}>{t('Light')}</button>
                <button type="button" role="radio" aria-checked={!!(exportDark ?? dark)} className={(exportDark ?? dark) ? 'on' : ''} onClick={() => setExportDark(true)}>{t('Dark')}</button>
              </div>
            </div>
          )} />}
        </span>}
        <button type="button" className={`win-btn${panel === 'settings' ? ' on' : ''}`} onClick={() => setPanel(panel === 'settings' ? null : 'settings')} aria-label={t('Whiteboard Settings')} title={t('Whiteboard Settings')} aria-pressed={panel === 'settings'}><Icon name="settings" size={14} /></button>
        <span className="menu-anchor">
          <button type="button" className="win-btn" onClick={() => setMenu(menu === 'more' ? null : 'more')} aria-label={t('More')} title={t('More')}><Icon name="more" size={14} /></button>
          {menu === 'more' && <Menu onClose={() => setMenu(null)} items={[
            { label: t('Rename…'), icon: 'edit', run: () => setNaming(true) },
            !wide && d.board.api && { label: t('Lay out left to right'), icon: 'split', run: () => layout('LR') },
            !wide && d.board.api && { label: t('Lay out top to bottom'), icon: 'layers', run: () => layout('TB') },
            !wide && d.board.api && { label: t('Export as PNG'), icon: 'image', run: () => exp('png') },
            !wide && d.board.api && { label: t('Export as PDF'), icon: 'doc', run: () => exp('pdf') },
            onThisComputer() && canOpen && { label: t('Show the boards folder'), icon: 'folder', run: () => api('/boards/folder', { method: 'POST' }).catch((e) => setErr(e.message)) },
            d.board.api && { label: t('Keyboard shortcuts'), icon: 'keyboard', run: help },
            '-',
            { label: t('Delete'), icon: 'trash', danger: true, run: () => remove().catch((e) => setErr(e.message)) },
          ]} />}
        </span>
      </PaneHeader>
      {naming && <NameDialog title={t('Name this whiteboard')} initial={id} action={t('Rename')} onSubmit={rename} onClose={() => setNaming(false)} />}
      {d.conflict && <Conflict onTheirs={() => d.takeTheirs().catch((e) => setErr(e.message))} onMine={() => d.flush(true)} />}
      {err && <p className="error-text small wb-err" role="alert">{err} <button type="button" className="link-btn" onClick={() => setErr(null)}>{t('OK')}</button></p>}
      <div className={`wb-body${showShapes && wide ? ' with-shapes' : ''}`}>
        {showShapes && <div className="wb-shapes-wrap"><ShapePanel onAdd={add} onClose={() => setShapes(false)} /></div>}
        <div className="wb-stage" onDragOver={(e) => { if (e.dataTransfer?.types?.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }} onDropCapture={drop}>
          {d.error ? <div className="wb-wait"><p className="error-text small" role="alert">{d.error}</p></div>
            : d.ready ? <Canvas key={id} initial={d.ready.initial} onApi={d.onApi} onChange={d.onChange} onSave={() => d.flush(true)} name={id} look={boardLook} />
              : <div className="wb-wait" aria-busy="true"><span className="muted small">{t('Opening the whiteboard…')}</span></div>}
          {d.board.api && !count.n && !panel && (
            <div className="wb-empty-board">
              <p>{t('An empty whiteboard')}</p>
              <p className="muted small">{t('Draw with the tools above, add shapes from the panel, or describe a diagram and let a model draw it.')}</p>
              <div className="wb-ask-row">
                {!shapes && <button type="button" className="btn small" onClick={() => setShapes(true)}><Icon name="shapes" size={12} /> {t('Shapes')}</button>}
                <button type="button" className="btn small primary" onClick={() => setPanel('draw')}><Icon name="sparkle" size={12} /> {t('Draw this')}</button>
              </div>
            </div>
          )}
          {panel === 'draw' && d.board.api && <div className="wb-draw-wrap"><DrawPanel board={d.board} start={start} onStarted={() => setStart(null)} onClose={() => setPanel(null)} compact={!wide} boardId={id} look={boardLook} prefs={prefs} onDrawn={drawn} /></div>}
          {panel === 'settings' && <div className="wb-draw-wrap"><BoardSettings look={boardLook} onLook={pickLook} prefs={prefs} onPrefs={setPrefs} onClose={() => setPanel(null)} /></div>}
        </div>
      </div>
    </div>
  )
}

// ---------- The list ----------
// title: the first words of what was asked for, as a board's name.
const titleFor = (s) => String(s || '').replace(/^(draw|make|show|create)\s+(me\s+)?(a|an|the)?\s*/i, '').split(/\s+/).slice(0, 7).join(' ').replace(/[.,;:!?]+$/, '').replace(/^./, (c) => c.toUpperCase())

function BoardCard({ b, onOpen, onError, refresh }) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(0)
  const rename = async (title) => {
    const r = await api(`/boards/${enc(b.id)}`, { method: 'PATCH', body: { title } })
    // An open board's tab takes the new name too.
    if (r.id !== b.id) window.dispatchEvent(new CustomEvent('bridge-open-board', { detail: { renamed: { from: b.id, to: r.id } } }))
    refresh()
  }
  const remove = async () => {
    if (!window.confirm(t('Delete the whiteboard "{name}"? It goes to the .trash folder beside your boards.', { name: b.id }))) return
    await api(`/boards/${enc(b.id)}`, { method: 'DELETE' })
    refresh()
  }
  return (
    <li className="wb-card">
      <button type="button" className="wb-thumb" onClick={() => onOpen?.(b.id)} aria-label={t('Open {name}', { name: b.title })}>{b.preview ? <img src={apiUrl(`/boards/${enc(b.id)}/preview?v=${Math.round(b.preview)}`)} alt="" loading="lazy" /> : <Icon name="shapes" size={22} />}</button>
      <div className="wb-card-row">
        <span className="wb-card-title"><EditableName editNow={renaming} name={b.title} onRename={rename} label={t('Name this whiteboard')} /></span>
        <span className="menu-anchor">
          <button type="button" className="win-btn" onClick={() => setMenu(!menu)} aria-label={t('More')} title={t('More')}><Icon name="more" size={13} /></button>
          {menu && <Menu onClose={() => setMenu(false)} items={[
            { label: t('Open'), icon: 'popout', run: () => onOpen?.(b.id) },
            { label: t('Rename…'), icon: 'edit', run: () => setRenaming((n) => n + 1) },
            '-',
            { label: t('Delete'), icon: 'trash', danger: true, run: () => remove().catch((e) => onError(e.message)) },
          ]} />}
        </span>
      </div>
      <span className="muted small">{t('Edited {when}', { when: fmtRelative(new Date(b.mtime).toISOString()) })}</span>
    </li>
  )
}

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

  const [refine] = usePersisted('cc-board-refine', 2)
  const create = async (o = {}) => {
    setBusy(true); setErr(null)
    try {
      const b = await api('/boards', { method: 'POST', body: { title: o.title || t('Untitled') } })
      if (o.prompt) startOn.set(b.id, { prompt: o.prompt, kind, model: m.id || undefined, refine })
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
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Describe a flowchart, an architecture or network, a sequence or an org chart. It comes out as shapes and icons you can move and edit.')}
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
            {boards.map((b) => <BoardCard key={b.id} b={b} onOpen={onOpen} onError={setErr} refresh={refresh} />)}
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
          : d.ready ? <Canvas key={version} initial={d.ready.initial} onApi={d.onApi} onChange={d.onChange} onSave={() => d.flush(true)} name={base} look={d.ready.look} />
            : <div className="wb-wait" aria-busy="true"><span className="muted small">{t('Opening the whiteboard…')}</span></div>}
        {panel && d.board.api && <div className="wb-draw-wrap"><DrawPanel board={d.board} onClose={() => setPanel(false)} compact look={d.ready?.look} /></div>}
      </div>
    </div>
  )
}
