import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { VoiceSetup, MicFix } from '../components/Composer.jsx'
import { parseKey, keyLabel, isKeyDown, isKeyUp } from '../../shared/dictation/keys.js'
import { useDictation, getState, configure, setOnScreen, press, release, finish, cancel, dismiss, retry, targetFromFocus, isPaused, box, keysPlatform, dictationKey, listeningHint, answerOffer, eventTime, take, lentTarget, lookAt, lendTo } from './controller.js'
import { embedded } from '../api.js'
import { t } from '../i18n/index.js'
import { Morph, Listening, Working, Done } from './Pill.jsx'
import './dictation.css'

// The dictation key inside Bridge AI (App.jsx and an agent's own window): held, it listens until
// let go; tapped, until it's pressed again or Enter. Plain key events in the page, so it asks for
// nothing and works in the desktop app, a browser and Docker alike. The desktop app hears the key in
// other apps too (desktop/dictation.js), and while one of Bridge AI's windows is in front it hands
// the key to the page as bridge-dictate-key events instead. The key never reaches the field or
// terminal it's pressed in (no non-breaking space, no Meta-Space to an agent).
//
// While it listens: the message box it's for shows its own bar (Composer.jsx); anywhere else (a
// terminal, a search box, a meeting's notes, another device's agent in a tab), the pill at the bottom
// of the window (Pill.jsx), as the dictation window shows over other apps. conf: /api/config's
// dictation; onScreen: the agent shown.
//
// This device's agent in a tab of another device's window (embedded: RemoteAgent.jsx there) hands
// its presses to that window's page, which listens and gives the words back (controller.js, lent);
// so do the pages in this one's tabs (lendTo, below), in messages. Another device's page in the desktop
// app (bridgeApp.dictates) leaves the key to the app, which listens for it in that window with this
// computer's key (desktop/dictation.js). looking: the agent on screen ({ machine, pane, name }),
// kept as the one you looked at last while this window has the focus, for the dictation window.
const lend = { press: (at, from) => press(from ? lentTarget(from) : targetFromFocus(), at), release, cancel, finish, state: getState }

export default function Dictation({ conf, onScreen, looking = null }) {
  const s = useDictation()
  const seen = useRef(onScreen)
  seen.current = onScreen
  useEffect(() => { setOnScreen(() => seen.current?.() || null) }, [])
  useEffect(() => { configure(conf) }, [conf])
  const off = conf?.on === false
  const key = dictationKey(conf)
  useEffect(() => {
    if (off || window.bridgeApp?.dictates) return
    const k = parseKey(key, keysPlatform())
    // A lone key (the right Alt) isn't kept from the page: it's AltGr on many keyboards, and another
    // key pressed while it's held (a character typed with it) cancels instead.
    let held = false
    const down = (e) => {
      if (isKeyDown(e, k)) {
        if (!k.lone) { e.preventDefault(); e.stopPropagation() }
        held = true
        if (!e.repeat && !isPaused()) press(targetFromFocus(), eventTime(e))
        return
      }
      if (k?.lone && held && e.code !== 'ControlLeft') { held = false; if (getState().phase !== 'idle') cancel(); return }
      const now = getState()
      if (now.phase === 'idle') return
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel() }
      else if (e.key === 'Enter' && now.mode === 'free' && now.phase === 'listening') { e.preventDefault(); e.stopPropagation(); finish() }
    }
    const up = (e) => { if (isKeyUp(e, k)) held = false; if (getState().phase !== 'idle' && isKeyUp(e, k)) { e.preventDefault(); release(eventTime(e)) } }
    // Let go while in another window: as if let go here.
    const blur = () => release()
    // From the desktop app (its key, heard while this window is in front), or a test.
    const fromApp = (e) => { const d = e.detail || {}; if (d.type === 'down') press(targetFromFocus(), d.at); else if (d.type === 'up') release(d.at); else if (d.type === 'cancel') cancel() }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    window.addEventListener('bridge-dictate-key', fromApp)
    // The pages in this one's tabs (another device's agent) hand their presses here (above).
    if (!embedded) lendTo(lend)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('bridge-dictate-key', fromApp)
      if (!embedded) lendTo(null)
    }
  }, [off, key])
  const shown = useRef(looking)
  shown.current = looking
  useEffect(() => { if (looking && document.hasFocus()) lookAt(looking) }, [looking?.machine, looking?.pane, looking?.name]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const back = () => lookAt(shown.current)
    window.addEventListener('focus', back)
    return () => window.removeEventListener('focus', back)
  }, [])
  // Words heard for this page elsewhere: by the desktop app's dictation window, for its window showing
  // this device (a page in a tab gets them in a message: controller.js). put: whether they went
  // anywhere here, or a promise of it (that one keeps them, and says so when they didn't).
  useEffect(() => {
    const heard = (e) => { if (e.detail && typeof e.detail === 'object') e.detail.put = take(e.detail.text) }
    window.addEventListener('bridge-dictated', heard)
    return () => window.removeEventListener('bridge-dictated', heard)
  }, [])
  // A line said for a moment, then gone.
  useEffect(() => { if (!s.note || s.setup || s.retry) return; const id = setTimeout(dismiss, 6000); return () => clearTimeout(id) }, [s.note, s.setup, s.retry])
  // Typed into a terminal or another box: said for a moment in the pill, then it's gone. Worked out
  // as the words arrive (not a moment after), so the pill goes straight from Transcribing… to this.
  const last = useRef(null)
  if (s.phase !== 'idle' && s.target) last.current = s.target
  const [over, setOver] = useState(0) // the words (their time) said for long enough
  useEffect(() => { const at = s.result?.at; if (!at) return; const id = setTimeout(() => setOver(at), 1300); return () => clearTimeout(id) }, [s.result?.at])
  const k = last.current?.kind
  // Another device's agent in a tab: its page puts them where you were typing there (asked out loud
  // there, it says what came of them itself).
  const frame = (k === 'composer' && box(last.current.id)?.frame) || (k === 'frame' && !last.current.ask)
  const done = s.phase === 'idle' && s.result && over !== s.result.at && !s.note && !s.setup && (k === 'terminal' || k === 'field' || frame)
    ? (k === 'terminal' ? t('Typed into the terminal') : t('Added where you were typing')) : null

  const label = keyLabel(key, keysPlatform())
  if (s.offer && s.phase === 'idle') return <Dock card><Offer s={s.offer} label={label} /></Dock>
  // The message box shows its own (another device's agent in a tab can't: the pill, with its name).
  const into = s.target?.kind === 'composer' || s.target?.kind === 'frame' ? box(s.target.id) : null
  if ((into && !into.frame) || (s.phase === 'idle' && !s.note && !s.setup && !done)) return null
  const listening = s.phase === 'opening' || s.phase === 'listening'
  const to = <span className="dp-to">{s.target?.kind === 'ask' || s.target?.ask ? t('To {name}', { name: t('Chief of Staff') }) : into?.name ? t('To {name}', { name: into.name }) : s.target?.kind === 'terminal' ? t('Into the terminal') : t('Where you\'re typing')}</span>
  if (listening) return <Dock><Listening s={s} to={to} hint={listeningHint(s.mode, label)} onCancel={cancel} onStop={finish} /></Dock>
  if (s.phase === 'working') return <Dock><Working s={s} /></Dock>
  if (done && !s.note && !s.setup) return <Dock><Done text={done} /></Dock>
  return <Dock card><Note s={s} /></Dock>
}

// At the bottom of the window, in the middle: the pill, growing up into a card when there's more.
function Dock({ card = false, children }) {
  return <div className="dict-dock"><Morph anchor="bottom" className={`dict-pill${card ? ' card' : ''}`}>{children}</Morph></div>
}
// Asked once, after the first words in Bridge AI: the key from any app too?
function Offer({ s, label }) {
  return (
    <div className="dp-card dict-offer" role="dialog" aria-label={t('Dictation from any app')}>
      <div className="dict-row">
        <Icon name="mic" size={14} />
        <span className="dict-hint">{s.mode === 'hold'
          ? t('Use {key} in any app too? Hold it anywhere and a small window shows what you said, to send to an agent or copy.', { key: label })
          : t('Use {key} in any app too? Tap it anywhere to start listening and again when you\'re done; a small window shows what you said.', { key: label })}
        {s.asks ? ` ${t('Your desktop asks once to allow the key.')}` : ''}</span>
      </div>
      <div className="dict-row dict-acts">
        <button className="comp-text-btn" onClick={() => answerOffer(false)}>{t('Not now')}</button>
        <button className="btn small primary" onClick={() => answerOffer(true)}>{t('Turn on')}</button>
      </div>
    </div>
  )
}
// Something to say (a note, Try again), or something to do first (the speech model, the mic).
function Note({ s }) {
  return (
    <div className="dp-card dict-note">
      {s.setup ? (s.setup.mic ? <MicFix stale={s.setup.stale} onClose={dismiss} /> : <VoiceSetup initial={s.setup} onReady={retry} onClose={dismiss} />) : (
        <div className="dict-row">
          <span className="dict-hint">{s.note}</span>
          {s.retry && <button className="btn small" onClick={retry}>{t('Try again')}</button>}
          <button className="dp-x" onClick={dismiss} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={12} /></button>
        </div>
      )}
    </div>
  )
}
