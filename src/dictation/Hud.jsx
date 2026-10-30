import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from '../components/Icon.jsx'
import { MicFix } from '../components/Composer.jsx'
import { api } from '../api.js'
import { store } from '../components/layout.jsx'
import { keyLabel } from '../../shared/dictation/keys.js'
import { useDictation, configure, press, release, finish, cancel, dismiss, retry, keysPlatform, dictationKey } from './controller.js'
import { t } from '../i18n/index.js'
import './dictation.css'

// The desktop app's dictation window (?dictate=1, desktop/dictation.js): it shows over whatever app
// you're in when you press the dictation key there, without taking the keyboard from it. While you
// talk: the level and who it's for. Then the text, to Send to that agent (the one you last looked at
// in Bridge AI, or the chief of staff: Settings › Voice), to another (To ▾), to Copy, or to finish
// in Bridge AI. Nothing is typed into the other app (that's for later, and needs a permission).
// The desktop app tells it when the key goes down and up (bridge-dictate-key events, as in the main
// window); a press from before it was ready comes from hudReady().
const app = () => window.bridgeApp || {}
const nameOf = (a) => (a.chief ? t('Chief of Staff') : a.title || a.tab || a.workspace || a.paneId)

export default function Hud() {
  const s = useDictation()
  const [conf, setConf] = useState(null)
  const [agents, setAgents] = useState([])
  const [to, setTo] = useState(undefined) // a pane id, or null for "pick one"
  const [picking, setPicking] = useState(false)
  const [done, setDone] = useState(null) // what was done with the text, said for a moment
  const [err, setErr] = useState(null)
  const card = useRef(null)
  const timer = useRef(null)

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
  }, [])
  // The key, from the desktop app (or a test).
  useEffect(() => {
    const begin = (at) => { clearTimeout(timer.current); setDone(null); setErr(null); setPicking(false); press({ kind: 'hud' }, at); pickTarget() }
    const on = (e) => {
      const d = e.detail || {}
      if (d.type === 'down') begin(d.at)
      else if (d.type === 'up') release(d.at)
      else if (d.type === 'cancel') { cancel(); hide() }
    }
    window.addEventListener('bridge-dictate-key', on)
    app().hudReady?.().then((p) => { if (p?.down) { begin(p.down); if (p.up) release(p.up) } }).catch(() => {})
    return () => window.removeEventListener('bridge-dictate-key', on)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
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

  const hide = () => { setPicking(false); dismiss(); app().hudHide?.() }
  const later = (ms) => { clearTimeout(timer.current); timer.current = setTimeout(() => { setDone(null); hide() }, ms) }
  const target = agents.find((a) => a.paneId === to) || null
  const text = s.result?.text || ''
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
      later(2200)
    } catch (e) { setErr(e.message) }
  }
  const edit = () => { app().hudOpen?.({ paneId: target?.paneId, text }); hide() }
  const setUp = () => { app().hudOpen?.({ setup: true }); hide() }
  const label = keyLabel(dictationKey(conf), keysPlatform())

  const toChip = (
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
          {done ? <p className="hud-done" role="status"><Icon name="check" size={12} /> {done}</p> : (
            <div className="hud-actions">
              {app().hudOpen && <button type="button" className="btn small" onClick={edit} disabled={!target}>{t('Edit in Bridge AI')}</button>}
              <button type="button" className="btn small" onClick={copy}>{t('Copy')}</button>
              <button type="button" className="btn small primary" onClick={send} disabled={!target}>{t('Send')}</button>
            </div>
          )}
        </>
      )}
      {phase === 'note' && (
        s.setup ? (
          <div className="hud-setup">
            {s.setup.mic ? <MicFix onClose={hide} /> : <>
              <p>{t('Voice notes are turned into text on your computer, so your audio never leaves it. They need a one-time setup there.')}</p>
              <div className="hud-actions"><button type="button" className="btn small" onClick={hide}>{t('Not now')}</button>{app().hudOpen && <button type="button" className="btn small primary" onClick={setUp}>{t('Set up')}</button>}</div>
            </>}
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
