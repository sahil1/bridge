import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { VoiceSetup, MicFix } from '../components/Composer.jsx'
import { parseKey, keyLabel, isKeyDown, isKeyUp } from '../../shared/dictation/keys.js'
import { useDictation, getState, configure, setOnScreen, press, release, finish, cancel, dismiss, retry, showSetup, targetFromFocus, isPaused, box, keysPlatform, dictationKey, listeningHint } from './controller.js'
import { t } from '../i18n/index.js'
import './dictation.css'

// The dictation key inside Bridge AI (App.jsx and an agent's own window): held, it listens until
// let go; tapped, until it's pressed again or Enter. Plain key events in the page, so it asks for
// nothing and works in the desktop app, a browser and Docker alike. The desktop app hears the key in
// other apps too (desktop/dictation.js), and while one of Bridge AI's windows is in front it hands
// the key to the page as bridge-dictate-key events instead. The key never reaches the field or
// terminal it's pressed in (no non-breaking space, no Meta-Space to an agent).
//
// While it listens: the message box it's for shows its own bar (Composer.jsx); anywhere else, a
// small bar at the bottom of the window. conf: /api/config's dictation; onScreen: the agent shown.
export default function Dictation({ conf, onScreen }) {
  const s = useDictation()
  const seen = useRef(onScreen)
  seen.current = onScreen
  useEffect(() => { setOnScreen(() => seen.current?.() || null) }, [])
  useEffect(() => { configure(conf) }, [conf])
  const off = conf?.on === false
  const key = dictationKey(conf)
  useEffect(() => {
    if (off) return
    const k = parseKey(key, keysPlatform())
    const down = (e) => {
      if (isKeyDown(e, k)) {
        e.preventDefault(); e.stopPropagation()
        if (!e.repeat && !isPaused()) press(targetFromFocus())
        return
      }
      const now = getState()
      if (now.phase === 'idle') return
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel() }
      else if (e.key === 'Enter' && now.mode === 'free' && now.phase === 'listening') { e.preventDefault(); e.stopPropagation(); finish() }
    }
    const up = (e) => { if (getState().phase !== 'idle' && isKeyUp(e, k)) { e.preventDefault(); release() } }
    // Let go while in another window: as if let go here.
    const blur = () => release()
    // From the desktop app (its key, heard while this window is in front), or a test.
    const fromApp = (e) => { const d = e.detail || {}; if (d.type === 'down') press(targetFromFocus(), d.at); else if (d.type === 'up') release(d.at); else if (d.type === 'cancel') cancel() }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    window.addEventListener('bridge-dictate-key', fromApp)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('bridge-dictate-key', fromApp)
    }
  }, [off, key])
  // From the floating window: Edit in Bridge (the agent's tab, the text in its box), and Set up.
  useEffect(() => {
    const edit = (e) => {
      const { paneId, text } = e.detail || {}
      if (!paneId || !text) return
      window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } }))
      const end = Date.now() + 4000
      const put = () => { const b = box(paneId); if (b?.visible()) b.insert(text); else if (Date.now() < end) setTimeout(put, 150) }
      setTimeout(put, 100)
    }
    window.addEventListener('bridge-dictate-text', edit)
    window.addEventListener('bridge-voice-setup', showSetup)
    return () => { window.removeEventListener('bridge-dictate-text', edit); window.removeEventListener('bridge-voice-setup', showSetup) }
  }, [])
  // A line said for a moment, then gone.
  useEffect(() => { if (!s.note || s.setup || s.retry) return; const id = setTimeout(dismiss, 6000); return () => clearTimeout(id) }, [s.note, s.setup, s.retry])

  // The message box shows its own.
  const mine = s.target?.kind === 'composer' && box(s.target.id)
  if (mine || (s.phase === 'idle' && !s.note && !s.setup)) return null
  return <Bar s={s} label={keyLabel(key, keysPlatform())} />
}

function Clock({ since }) {
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(id) }, [])
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000))
  return <span className="rec-time">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
}
function Bar({ s, label }) {
  const listening = s.phase === 'opening' || s.phase === 'listening'
  return (
    <div className="dict-bar" role="status" aria-live="polite">
      {s.setup ? (s.setup.mic ? <MicFix onClose={dismiss} /> : <VoiceSetup initial={s.setup} onClose={dismiss} />) : (
        <div className="dict-row">
          {listening && <>
            <span className="rec-dot" />
            <Clock since={s.since} />
            <span className="rec-meter"><span style={{ transform: `scaleX(${0.08 + s.level * 0.92})` }} /></span>
            <span className="dict-hint">{listeningHint(s.mode, label)}</span>
            <button className="comp-text-btn" onClick={cancel}>{t('Cancel')}</button>
            <button className="send rec-stop" onClick={finish} aria-label={t('Stop and transcribe')} title={t('Stop and transcribe')}><Icon name="check" size={15} /></button>
          </>}
          {s.phase === 'working' && <span className="dict-hint"><Icon name="refresh" size={13} className="spin" /> {t('Transcribing on your computer…')}</span>}
          {s.phase === 'idle' && s.note && <>
            <span className="dict-hint">{s.note}</span>
            {s.retry && <button className="btn small" onClick={retry}>{t('Try again')}</button>}
            <button className="win-btn" onClick={dismiss} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={12} /></button>
          </>}
        </div>
      )}
    </div>
  )
}
