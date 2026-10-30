import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Solo from './components/Solo.jsx'
import FloatCard from './components/meetings/FloatCard.jsx'
import Hud from './dictation/Hud.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './styles.css'
import { apply } from './appearance.js'
import { loadLang } from './i18n/index.js'
import { registerServiceWorker, reportPresence } from './pwa.js'

apply()
// ?window=<pane>: one agent in a window of its own. ?float=1: the desktop app's floating card.
// ?dictate=1: its dictation window (dictation/Hud.jsx).
const solo = new URLSearchParams(location.search).get('window')
const float = new URLSearchParams(location.search).get('float') === '1'
const hud = new URLSearchParams(location.search).get('dictate') === '1'
if (float) document.documentElement.classList.add('is-float')
if (hud) document.documentElement.classList.add('is-hud')
registerServiceWorker()
if (!float && !hud) reportPresence()

// A crash on cue, for the tests of the crash screen: a saved value no version of the app writes.
// "brief": only in the window's first 2.5 seconds, as when its server is still starting.
function TestCrash() {
  let v = null
  try { v = localStorage.getItem('cc-test-crash') } catch { /* no storage */ }
  if (v && !(v === 'brief' && performance.now() > 2500)) throw new Error('A crash made by a test')
  return null
}

// Drawn once its language's words are in (Settings › Appearance › Language).
loadLang().finally(() => createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary name="Bridge AI" full={!float && !hud}>
      <TestCrash />
      {float ? <FloatCard /> : hud ? <Hud /> : solo ? <Solo paneId={solo} /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
))
