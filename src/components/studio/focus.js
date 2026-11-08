import { useCallback, useEffect, useRef, useState } from 'react'
import { store } from '../layout.jsx'

// Focus: a file's page given the whole window, as Word's and Google Docs' focus modes are. The
// app's sidebar, top bar and tabs and Studio's own header fold away, leaving the editor's toolbar,
// the page in the middle and the status line (saving, a change from elsewhere and notes still
// show). ⌥⌘F (Ctrl+Alt+F; ⇧⌘F is the app's search) or the header's button; ⌘. or Esc leaves, each
// only when nothing on the page has the key for its own: ⌘. is superscript while you write in a
// Word file, and Esc closes a menu, ends a cell's editing or lets go of a shape first. Kept for
// each kind of editor, so the next document opens in Focus too, after a reload as well.
// It can make the window full screen too, kept as you leave it: the desktop app's own window
// (preload.js), on to start with; a browser's once you turn it on, where it allows it (not an
// iPhone), as there Esc is the browser's own and takes the page out of full screen. Leaving Focus
// ends a full screen Focus started, and leaving full screen another way (Esc in a browser, the
// window's own button) leaves Focus.
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const focusKey = (e) => e.altKey && !e.shiftKey && (MAC ? e.metaKey && !e.ctrlKey && e.code === 'KeyF' : e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'f')
const leaveKey = (e) => (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && e.key === '.'
// Open over the page, each with its own Esc: a menu, a dialog, a list to pick from, presenting.
const OWN_ESC = '.sd-modal, .sd-drop, .ctx-menu, .modal-backdrop, .tour, .sd-present, [role="menu"], [role="dialog"], [role="listbox"], [data-esc]:not(.sd-focus)'
const app = () => (typeof window !== 'undefined' ? window.bridgeApp : null)
const doc = typeof document !== 'undefined' ? document : null
const fsElement = () => doc?.fullscreenElement || doc?.webkitFullscreenElement || null
export const canFullScreen = () => !!app()?.fullScreen || !!(doc?.fullscreenEnabled || doc?.webkitFullscreenEnabled)
const fullToStart = () => !!app()?.fullScreen

// on: whether the page is in Focus; full: whether the window is full screen; enter, leave, toggle
// and toggleFull (which says, through onRefused, when the browser won't).
export function useFocus(kind, { onRefused } = {}) {
  const [on, setOn] = useState(false)
  const [full, setFull] = useState(() => !!fsElement())
  const made = useRef(false) // Focus made the window full screen (so leaving it ends that too)
  const seen = useRef(false) // ...and it's been seen full screen since (the desktop's goes in a moment later)
  const onRef = useRef(false)
  onRef.current = on
  useEffect(() => { setOn(!!kind && !!store.get('cc-studio-focus', {})[kind]) }, [kind])
  const keep = useCallback((v) => { if (kind) store.set('cc-studio-focus', { ...store.get('cc-studio-focus', {}), [kind]: v }) }, [kind])

  const goFull = useCallback(async (v) => {
    const a = app()
    if (a?.fullScreen) { const r = await a.fullScreen(v); setFull(r === true); return r === v }
    if (!doc) return false
    // Granted once its promise is (WebKit says so a moment before the page is full screen).
    try {
      if (v && !fsElement()) await (doc.documentElement.requestFullscreen?.() || doc.documentElement.webkitRequestFullscreen?.())
      else if (!v && fsElement()) await (doc.exitFullscreen?.() || doc.webkitExitFullscreen?.())
    } catch { return false }
    return true
  }, [])
  const endFull = useCallback(() => { if (made.current) { made.current = false; seen.current = false; goFull(false) } }, [goFull])
  const enter = useCallback(() => {
    setOn(true); keep(true)
    if (store.get('cc-studio-full', fullToStart()) && canFullScreen() && !full) { made.current = true; seen.current = false; goFull(true).then((ok) => { if (!ok) made.current = false }) }
  }, [keep, goFull, full])
  const leave = useCallback(() => { setOn(false); keep(false); endFull() }, [keep, endFull])
  const toggle = useCallback(() => (onRef.current ? leave() : enter()), [enter, leave])
  const toggleFull = useCallback(async () => {
    if (full) { made.current = false; store.set('cc-studio-full', false); await goFull(false); return }
    store.set('cc-studio-full', true)
    made.current = true; seen.current = false
    if (!(await goFull(true))) { made.current = false; onRefused?.() }
  }, [full, goFull, onRefused])
  // Out of Focus, or off the page altogether (another tab, another file's kind): a full screen
  // Focus started ends with it.
  useEffect(() => { if (!on) endFull() }, [on, endFull])
  useEffect(() => endFull, [endFull])

  // Full screen as it is now, and left another way. The desktop app's window says it isn't while
  // it's still going full screen, so there only a window seen full screen has left it; a browser
  // says so only once it's done (sure), when the two can come as one.
  useEffect(() => {
    const left = (now, sure = false) => {
      setFull(now)
      if (now) { seen.current = true; return }
      if (made.current && (seen.current || sure)) { made.current = false; seen.current = false; if (onRef.current) { setOn(false); keep(false) } }
    }
    const a = app()
    if (a?.fullScreen) {
      let id = null
      const ask = () => { clearTimeout(id); id = setTimeout(() => a.fullScreen().then((v) => left(v === true), () => {}), 250) }
      ask()
      window.addEventListener('resize', ask)
      return () => { clearTimeout(id); window.removeEventListener('resize', ask) }
    }
    const change = () => left(!!fsElement(), true)
    doc?.addEventListener('fullscreenchange', change)
    doc?.addEventListener('webkitfullscreenchange', change)
    return () => { doc?.removeEventListener('fullscreenchange', change); doc?.removeEventListener('webkitfullscreenchange', change) }
  }, [keep])

  // The keys. Esc and ⌘. are decided once the page has had them (an editor's own use of them marks
  // them used), against what was open over the page when the key was pressed (it may have closed
  // by then). A document's editor (ProseMirror) marks every Esc used, to keep the browser's own
  // away, so there only what's open over the page has it first.
  useEffect(() => {
    if (!kind) return undefined
    const key = (e) => {
      if (focusKey(e)) { e.preventDefault(); toggle(); return }
      if (!onRef.current || !(leaveKey(e) || (e.key === 'Escape' && !e.target?.closest?.('input, textarea, select')))) return
      if (doc.querySelector(OWN_ESC)) return
      const writing = e.key === 'Escape' && !!e.target?.closest?.('.ProseMirror')
      setTimeout(() => { if ((writing || !e.defaultPrevented) && onRef.current) leave() }, 0)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [kind, toggle, leave])
  return { on, full, enter, leave, toggle, toggleFull }
}
