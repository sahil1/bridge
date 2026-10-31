import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from '../components/Icon.jsx'
import { VoiceSetup, MicFix } from '../components/Composer.jsx'
import { api, settingsChanged } from '../api.js'
import { store } from '../components/layout.jsx'
import { keyLabel } from '../../shared/dictation/keys.js'
import { useDictation, configure, press, release, finish, cancel, dismiss, retry, keysPlatform, dictationKey } from './controller.js'
import { t } from '../i18n/index.js'
import './dictation.css'

// The desktop app's dictation window (?dictate=1, desktop/dictation.js): it shows over whatever app
// you're in when you press the dictation key there, without taking the keyboard from it. While you
// talk: the level and who it's for. Then the text, to Send to that agent (the one you last looked at
// in Bridge AI, or the chief of staff: Settings › Voice), to another (To ▾), to Copy, or to finish
// in Bridge AI. With "Where I'm typing" picked in Settings › Voice, the desktop app pastes it into the
// app you were in instead (hudPaste), and this says so; when it can't (no Accessibility yet on a Mac,
// a password field, another app in front by then), the text stays here to copy or send, with one
// line saying why. After a Copy, it asks once whether to paste for you next time.
// The desktop app tells it when the key goes down and up (bridge-dictate-key events, as in the main
// window); a press from before it was ready comes from hudReady().
const app = () => window.bridgeApp || {}
const nameOf = (a) => (a.chief ? t('Chief of Staff') : a.title || a.tab || a.workspace || a.paneId)
const pasteKey = () => (keysPlatform() === 'darwin' ? '⌘V' : 'Ctrl+V')
// Why it wasn't pasted (desktop/dictation.js's answers).
const WHY = {
  accessibility: () => t('Pasting needs Accessibility: turn it on in Settings › Voice.'),
  // macOS's Secure Input: a password field has the keyboard, or an app turned it on for itself
  // (Terminal's Secure Keyboard Entry), which covers every app while it's on.
  secure: () => t('Secure input is on (a password field, or Secure Keyboard Entry), so it wasn\'t pasted.'),
  moved: () => t('Another app is in front now, so it wasn\'t pasted.'),
  focus: () => t('Bridge AI was in front, so it wasn\'t pasted.'),
  // Windows and Linux: Ctrl+V pressed with Alt still down would be another shortcut.
  held: () => t('A key was still held down, so it wasn\'t pasted. Let go of the keys once you\'ve said it.'),
  failed: () => t('Couldn\'t paste it there.'),
}

export default function Hud() {
  const s = useDictation()
  const [conf, setConf] = useState(null)
  const [st, setSt] = useState(null) // the desktop app's status: { paste: { can, allowed, asks, … } }
  const [agents, setAgents] = useState([])
  const [to, setTo] = useState(undefined) // a pane id, or null for "pick one"
  const [picking, setPicking] = useState(false)
  const [done, setDone] = useState(null) // what was done with the text, said for a moment
  const [err, setErr] = useState(null)
  const [into, setInto] = useState(null) // the app it's pasted into, by name (a Mac)
  const [pasting, setPasting] = useState(false)
  const [why, setWhy] = useState(null) // why it wasn't pasted
  const [offer, setOffer] = useState(false) // paste it next time?
  const card = useRef(null)
  const timer = useRef(null)
  // This press's words, straight from the key: not after a download or Try again, when you've long
  // moved on and pasting would land wherever you are now.
  const fresh = useRef(false)
  const pasted = useRef(0) // the result last pasted (its time), so it's pasted once

  const loadStatus = () => app().dictateStatus?.().then((x) => { if (x) setSt(x) }, () => {})
  // Who it's for when it opens: the setting's choice (read again each time: it may have changed in
  // Settings since this window opened), among the agents running now.
  const pickTarget = async () => {
    const [f, c] = await Promise.all([api('/fleet').catch(() => null), api('/config').catch(() => null)])
    const d = c?.dictation || conf || {}
    if (c) { setConf(d); configure(d) }
    const list = f ? f.agents || [] : agents
    setAgents(list)
    const chief = list.find((a) => a.chief && a.thread?.main) || list.find((a) => a.chief)
    const looked = list.find((a) => a.paneId === store.get('cc-ws', {})?.active)
    setTo(d.to === 'ask' ? null : d.to === 'chief' ? (chief || looked)?.paneId ?? null : (looked || chief)?.paneId ?? null)
  }
  useEffect(() => {
    document.title = t('Dictation')
    api('/config').then((c) => { const d = c.dictation || {}; setConf(d); configure(d) }).catch(() => setConf({}))
    loadStatus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // The key, from the desktop app (or a test). app: the app in front, when the desktop app knows it.
  useEffect(() => {
    const begin = (at, name) => {
      clearTimeout(timer.current); setDone(null); setErr(null); setPicking(false); setWhy(null); setOffer(false); setPasting(false)
      setInto(name || null)
      fresh.current = true
      press({ kind: 'hud' }, at); pickTarget(); loadStatus()
    }
    const on = (e) => {
      const d = e.detail || {}
      if (d.type === 'down') begin(d.at, d.app)
      else if (d.type === 'up') release(d.at)
      else if (d.type === 'cancel') { cancel(); hide() }
    }
    window.addEventListener('bridge-dictate-key', on)
    app().hudReady?.().then((p) => { if (p?.down) { begin(p.down, p.app); if (p.up) release(p.up) } }).catch(() => {})
    return () => window.removeEventListener('bridge-dictate-key', on)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s.setup || s.note) fresh.current = false }, [s.setup, s.note])
  // The desktop app holds Esc for us while we listen (and lets it go after), and fits the window.
  const phase = s.phase !== 'idle' ? s.phase : s.result ? 'result' : s.note || s.setup ? 'note' : 'idle'
  useEffect(() => { app().hudPhase?.(phase) }, [phase])
  useLayoutEffect(() => {
    const el = card.current
    if (!el || !app().hudSize) return
    const fit = () => { const r = el.getBoundingClientRect(); app().hudSize(Math.ceil(r.width) + 24, Math.ceil(r.height) + 24) }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hide = () => { setPicking(false); setOffer(false); dismiss(); app().hudHide?.() }
  const later = (ms) => { clearTimeout(timer.current); timer.current = setTimeout(() => { setDone(null); hide() }, ms) }
  const target = agents.find((a) => a.paneId === to) || null
  const text = s.result?.text || ''
  const canPaste = !!st?.paste?.can && !!app().hudPaste
  const pasteOn = conf?.to === 'paste' && canPaste
  // Where I'm typing: the text, as soon as it's here, pasted by the desktop app. Decided once, when
  // it arrives (picking "Paste it" afterwards doesn't paste what's already here).
  useEffect(() => {
    const r = s.result
    if (!r?.text || pasted.current === r.at) return
    pasted.current = r.at
    const now = fresh.current
    fresh.current = false
    if (!pasteOn || !now) return
    if (!st.paste.allowed) { setWhy('accessibility'); return }
    setPasting(true)
    app().hudPaste(r.text).then((x) => {
      setPasting(false)
      if (x?.pasted) {
        // Nothing took it (no text field there): it's on the clipboard to paste by hand.
        if (x.read === false) { setDone(t('Nothing took it there, so it\'s on the clipboard: press {key} to paste it.', { key: pasteKey() })); later(3500) }
        else { setDone(into ? t('Pasted into {app}', { app: into }) : t('Pasted')); later(900) }
      } else setWhy(WHY[x?.error] ? x.error : x?.error === 'off' ? null : 'failed')
    }, () => { setPasting(false); setWhy('failed') })
  }, [s.result?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!target || !text) return
    setErr(null)
    try {
      const pid = encodeURIComponent(target.paneId)
      // As the message box does: a working agent that can't take a message now gets it when it's free.
      await api(`/agents/${pid}/${target.status === 'working' && !target.caps?.typeAhead ? 'queue' : 'prompt'}`, { method: 'POST', body: { text } })
      setDone(t('Sent to {name}', { name: nameOf(target) }))
      later(1200)
    } catch (e) { setErr(e.message) }
  }
  const copy = async () => {
    try {
      if (app().hudCopy) await app().hudCopy(text)
      else await navigator.clipboard.writeText(text)
      setDone(keysPlatform() === 'darwin' ? t('Copied. Press ⌘V to paste it.') : t('Copied. Press Ctrl+V to paste it.'))
      // Asked once: paste it for you next time? (Only where this computer can.)
      if (canPaste && conf?.to !== 'paste' && !conf?.offeredPaste) { setOffer(true); later(15000) } else later(2200)
    } catch (e) { setErr(e.message) }
  }
  const answer = async (yes) => {
    setOffer(false)
    const patch = yes ? { to: 'paste', offeredPaste: true } : { offeredPaste: true }
    const next = { ...(conf || {}), ...patch }
    setConf(next)
    configure(next)
    await api('/settings', { method: 'PATCH', body: { dictation: patch } }).then(settingsChanged, () => {})
    if (!yes) { later(400); return }
    const now = await app().dictateConfigure?.(next).catch(() => null)
    if (now) setSt(now)
    // A Mac: macOS asks now (Accessibility), with the tile beside System Settings.
    if (now?.paste?.asks === 'accessibility' && !now.paste.allowed) {
      await app().pasteAsk?.().catch(() => null)
      setDone(t('Turn on Bridge AI under Accessibility when macOS asks, and it pastes from next time.'))
      later(6000)
    } else { setDone(t('From next time, it\'s pasted where you\'re typing.')); later(2500) }
  }
  const edit = () => { app().hudOpen?.({ paneId: target?.paneId, text }); hide() }
  const label = keyLabel(dictationKey(conf), keysPlatform())
  // Pasting where you're typing, allowed: no agent to pick while it listens.
  const intoApp = pasteOn && st?.paste?.allowed && !why

  const toChip = intoApp ? (
    <span className="hud-into" title={t('Pasted where you\'re typing')}>{into ? t('Into {app}', { app: into }) : t('Where you\'re typing')}</span>
  ) : (
    <span className="hud-to">
      <button type="button" className="hud-to-btn" data-pane={target?.paneId || ''} onClick={() => setPicking((v) => !v)} aria-haspopup="menu" aria-expanded={picking}>
        {t('To:')} <b>{target ? nameOf(target) : t('pick an agent')}</b> <Icon name="down" size={11} />
      </button>
      {picking && (
        <div className="hud-menu" role="menu">
          {agents.map((a) => (
            <button key={a.paneId} type="button" role="menuitem" data-pane={a.paneId} className={a.paneId === to ? 'on' : ''} onClick={() => { setTo(a.paneId); setPicking(false) }}>
              {a.chief ? <Icon name="helm" size={12} /> : <StatusDot status={a.status} size={7} />} <span>{nameOf(a)}</span>
            </button>
          ))}
          {!agents.length && <p className="muted small">{t('No agents are running.')}</p>}
        </div>
      )}
    </span>
  )
  const listening = s.phase === 'opening' || s.phase === 'listening'
  return (
    <div className="hud-root">
    <div className="hud" ref={card} role="dialog" aria-label={t('Dictation')}>
      {listening && (
        <div className="hud-row">
          <span className="rec-dot" />
          <span className="rec-meter"><span style={{ transform: `scaleX(${0.08 + s.level * 0.92})` }} /></span>
          {toChip}
          <button type="button" className="win-btn" onClick={() => { cancel(); hide() }} aria-label={t('Cancel')} title={t('Cancel (Esc)')}><Icon name="x" size={12} /></button>
          {s.mode === 'free' && s.phase === 'listening' && <button type="button" className="send rec-stop" onClick={finish} aria-label={t('Stop and transcribe')} title={t('Stop and transcribe')}><Icon name="check" size={14} /></button>}
        </div>
      )}
      {listening && <p className="hud-hint">{s.mode === 'free' ? t('Listening… press {key} again when you\'re done', { key: label }) : t('Let go to finish · Esc cancels')}</p>}
      {s.phase === 'working' && <p className="hud-hint"><Icon name="refresh" size={12} className="spin" /> {t('Transcribing on your computer…')}</p>}
      {phase === 'result' && (
        <>
          <div className="hud-row">{toChip}<span className="grow" /><button type="button" className="win-btn" onClick={hide} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={12} /></button></div>
          <p className="hud-text">{text}</p>
          {err && <p className="error-text small">{err}</p>}
          {why && <p className="hud-why small" role="status"><Icon name="info" size={12} /> {WHY[why]()}</p>}
          {pasting ? <p className="hud-hint"><Icon name="refresh" size={12} className="spin" /> {t('Pasting…')}</p> : done ? <p className="hud-done" role="status"><Icon name="check" size={12} /> {done}</p> : (
            <div className="hud-actions">
              {app().hudOpen && <button type="button" className="btn small" onClick={edit} disabled={!target}>{t('Edit in Bridge AI')}</button>}
              <button type="button" className="btn small" onClick={copy}>{t('Copy')}</button>
              <button type="button" className="btn small primary" onClick={send} disabled={!target}>{t('Send')}</button>
            </div>
          )}
          {offer && (
            <div className="hud-row hud-offer" role="group" aria-label={t('Paste it for you next time?')}>
              <span className="hud-note">{t('Paste it for you next time?')}{st?.paste?.asks === 'accessibility' && !st.paste.allowed ? ` ${t('macOS asks once to allow it.')}` : ''}</span>
              <button type="button" className="comp-text-btn" onClick={() => answer(false)}>{t('Not now')}</button>
              <button type="button" className="btn small primary" onClick={() => answer(true)}>{t('Paste it')}</button>
            </div>
          )}
        </>
      )}
      {phase === 'note' && (
        s.setup ? (
          <div className="hud-setup">
            {/* The first time: the speech model to download, with what you said kept and turned
                into text here once it's in (Composer.jsx's panel, as in the message box). */}
            {s.setup.mic ? <MicFix onClose={hide} /> : <VoiceSetup initial={s.setup} onReady={retry} onClose={hide} />}
          </div>
        ) : (
          <div className="hud-row">
            <span className="hud-note">{s.note}</span>
            {s.retry && <button type="button" className="btn small" onClick={retry}>{t('Try again')}</button>}
            <button type="button" className="win-btn" onClick={hide} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={12} /></button>
          </div>
        )
      )}
      {phase === 'idle' && <p className="hud-hint">{t('Hold {key} in any app and talk.', { key: label })}</p>}
    </div>
    </div>
  )
}
