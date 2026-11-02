import { useEffect, useRef, useState } from 'react'
import { useAppearance, isDark } from '../../appearance.js'
import { useMedia } from '../layout.jsx'
import { currentLang, t } from '../../i18n/index.js'
import { loadExcalidraw } from './excalidraw.js'
import { toolDefaults, clearBackground } from './look.js'
import { holdTogether } from './holders.js'

// Excalidraw's own languages, for the ones Bridge AI is in.
const LANG = { de: 'de-DE', es: 'es-ES', fr: 'fr-FR', hi: 'hi-IN', ja: 'ja-JP', 'pt-BR': 'pt-BR', 'zh-CN': 'zh-CN' }

// Bridge AI's own keys (⌘K, ⌘, ⌘⇧F, ⌥1 ⌥2) keep doing what they do everywhere else. The app's
// handlers have already run (on the window, first); stopping the key here keeps Excalidraw from
// also acting on it (⌘K would add a link as well).
const bridgeKey = (e) => {
  const cmd = e.metaKey || e.ctrlKey
  return (cmd && !e.altKey && ['k', ','].includes(e.key.toLowerCase())) || (cmd && e.shiftKey && e.key.toLowerCase() === 'f') || (e.altKey && !cmd && (e.code === 'Digit1' || e.code === 'Digit2'))
}
export const useDarkMode = () => {
  const [look] = useAppearance()
  const system = useMedia('(prefers-color-scheme: dark)')
  return look.mode === 'system' ? system : isDark(look.mode)
}

// The drawing area: Excalidraw (MIT) in Bridge AI's look. Its tools stay (the toolbar, the shape's
// colours, zoom and undo); its menu, welcome screen and library are Bridge AI's instead (the
// header's menus, the empty board's own hint, the Shapes panel), its colours and font are the
// app's, and its own links and Mermaid importer are left out (whiteboard.css). Excalidraw is
// credited in the whiteboard's settings, in Settings › About & Updates and in NOTICE.
//   Web pages embedded in a board (validateEmbeddable) are turned off: a YouTube or Figma link
// pasted in stays a link, so a board never loads anything from the internet.
//   initial: what to draw first ({ elements, appState, files }). look: 'clean' or 'sketch', what
//   shapes drawn by hand start as. onApi(api, X): Excalidraw's handle and module, once it's up.
//   onSave: ⌘S, as the board saves by itself anyway.
export default function Canvas({ initial, onApi, onChange, onSave, viewOnly = false, name, look = 'clean', children }) {
  const [X, setX] = useState(null)
  const [err, setErr] = useState(null)
  const dark = useDarkMode()
  const box = useRef(null)
  const save = useRef(onSave)
  save.current = onSave
  const [api, setApi] = useState(null)
  useEffect(() => { loadExcalidraw().then(setX, (e) => setErr(e.message)) }, [])
  useEffect(() => {
    const el = box.current
    if (!el) return
    const on = (e) => {
      if (bridgeKey(e)) { e.stopPropagation(); return }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); save.current?.() }
    }
    el.addEventListener('keydown', on, true)
    return () => el.removeEventListener('keydown', on, true)
  }, [X])
  // Containers and icons carry what's in them.
  useEffect(() => (api && !viewOnly ? holdTogether(api) : undefined), [api, viewOnly])
  // A new look picked: what's drawn next starts in it.
  useEffect(() => { if (api) api.updateScene({ appState: toolDefaults(look) }) }, [api, look])
  if (err) return <div className="wb-canvas wb-wait" role="alert"><p className="error-text small">{t("The whiteboard couldn't load: {error}", { error: err })}</p></div>
  if (!X) return <div className="wb-canvas wb-wait" aria-busy="true"><span className="muted small">{t('Opening the whiteboard…')}</span></div>
  const { Excalidraw, MainMenu } = X
  const start = initial ? { ...initial, appState: { ...toolDefaults(look), objectsSnapModeEnabled: true, ...clearBackground(initial.appState) } } : initial
  return (
    <div className={`wb-canvas look-${look}`} ref={box}>
      <Excalidraw
        initialData={start}
        excalidrawAPI={(a) => { setApi(a); onApi?.(a, X) }}
        onChange={onChange}
        theme={dark ? 'dark' : 'light'}
        langCode={LANG[currentLang()] || 'en'}
        viewModeEnabled={viewOnly}
        name={name}
        aiEnabled={false}
        validateEmbeddable={false}
        handleKeyboardGlobally={false}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: null, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false }, tools: { image: true } }}
      >
        {/* Its menu's few useful parts are in the header's menus; this keeps its own out. */}
        <MainMenu><MainMenu.DefaultItems.Help /></MainMenu>
        {children}
      </Excalidraw>
    </div>
  )
}
