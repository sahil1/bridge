import { useEffect, useRef, useState } from 'react'
import { useAppearance, isDark } from '../../appearance.js'
import { useMedia } from '../layout.jsx'
import { currentLang, t } from '../../i18n/index.js'
import { loadExcalidraw } from './excalidraw.js'

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

// The drawing area. initial: what to draw first ({ elements, appState, files }, or a promise of it).
// onApi(api, X): Excalidraw's handle and module, once it's up. onSave: ⌘S, as the board saves by
// itself anyway. welcome: the line on an empty board.
export default function Canvas({ initial, onApi, onChange, onSave, viewOnly = false, name, welcome, children }) {
  const [X, setX] = useState(null)
  const [err, setErr] = useState(null)
  const dark = useDarkMode()
  const box = useRef(null)
  const save = useRef(onSave)
  save.current = onSave
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
  if (err) return <div className="wb-canvas wb-wait" role="alert"><p className="error-text small">{t("The whiteboard couldn't load: {error}", { error: err })}</p></div>
  if (!X) return <div className="wb-canvas wb-wait" aria-busy="true"><span className="muted small">{t('Opening the whiteboard…')}</span></div>
  const { Excalidraw, MainMenu, WelcomeScreen } = X
  return (
    <div className="wb-canvas" ref={box}>
      <Excalidraw
        initialData={initial}
        excalidrawAPI={(api) => onApi?.(api, X)}
        onChange={onChange}
        theme={dark ? 'dark' : 'light'}
        langCode={LANG[currentLang()] || 'en'}
        viewModeEnabled={viewOnly}
        name={name}
        aiEnabled={false}
        handleKeyboardGlobally={false}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: null, export: { saveFileToDisk: true }, saveAsImage: true, clearCanvas: !viewOnly, changeViewBackgroundColor: !viewOnly } }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Export />
          {!viewOnly && <MainMenu.DefaultItems.ClearCanvas />}
          <MainMenu.Separator />
          {!viewOnly && <MainMenu.DefaultItems.ChangeCanvasBackground />}
          <MainMenu.DefaultItems.Help />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Hints.HelpHint />
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>{welcome || t('Draw with the tools above, or describe a diagram with Draw this.')}</WelcomeScreen.Center.Heading>
          </WelcomeScreen.Center>
        </WelcomeScreen>
        {children}
      </Excalidraw>
    </div>
  )
}
