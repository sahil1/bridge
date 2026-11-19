// First: what the page that opened this one passed it, before anything reads what's saved.
import './passed.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Solo from './components/Solo.jsx'
import FloatCard from './components/meetings/FloatCard.jsx'
import Hud from './dictation/Hud.jsx'
import Capture from './components/remote/Capture.jsx'
import { Badge } from './components/remote/Here.jsx'
import ScreenView from './components/remote/ScreenView.jsx'
import NotLetIn from './components/remote/NotLetIn.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './styles.css'
import { apply } from './appearance.js'
import { loadLang } from './i18n/index.js'
import { registerServiceWorker, reportPresence } from './pwa.js'
import { countActiveTime } from './activeTime.js'
import { answerBusy } from './busy.js'
import { resume as resumeSending } from './sendbox.js'
import { watchScrolling } from './scrolling.js'

apply()
// A scroll bar's thumb while you scroll that area from the keys too, not only while you're over it.
watchScrolling()
// ?window=<pane>: one agent in a window of its own. ?float=1: the desktop app's floating card.
// ?dictate=1: its dictation window (dictation/Hud.jsx). ?remote=capture and ?remote=badge: Remote
// Screen and Preview's window that takes the screen (never shown) and its badge, while this screen is
// seen from another of your devices; ?remote=view&machine=<id>&name=<name>: another computer's
// screen in a window of its own (desktop/remote.js).
const solo = new URLSearchParams(location.search).get('window')
const float = new URLSearchParams(location.search).get('float') === '1'
const hud = new URLSearchParams(location.search).get('dictate') === '1'
const remoteWin = /^(capture|badge|view)$/.exec(new URLSearchParams(location.search).get('remote') || '')?.[1] || null
const viewOf = () => { const q = new URLSearchParams(location.search); return { machine: q.get('machine') || null, name: q.get('name') || '' } }
if (float) document.documentElement.classList.add('is-float')
if (hud) document.documentElement.classList.add('is-hud')
registerServiceWorker()
if (!float && !hud && !remoteWin) { reportPresence(); countActiveTime() }
// Messages the last page left on their way to an agent go now (sendbox.js).
if (!float && !hud && !remoteWin) resumeSending()
// Every window of the desktop app says what an update would lose in it (busy.js).
answerBusy()

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
    <ErrorBoundary name="Bridge AI" full={!float && !hud && !remoteWin}>
      <TestCrash />
      {/* A device the computer it shows hasn't let in: one card for the whole window (NotLetIn.jsx). */}
      <NotLetIn>
        {remoteWin === 'capture' ? <Capture /> : remoteWin === 'badge' ? <Badge /> : remoteWin === 'view' ? <ScreenView {...viewOf()} windowed onClose={() => window.close()} /> : float ? <FloatCard /> : hud ? <Hud /> : solo ? <Solo paneId={solo} /> : <App />}
      </NotLetIn>
    </ErrorBoundary>
  </StrictMode>,
))
