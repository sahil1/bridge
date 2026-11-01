import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from '../components/Icon.jsx'
import { VoiceSetup, MicFix } from '../components/Composer.jsx'
import { api, settingsChanged } from '../api.js'
import { useRecheck } from '../permissions.js'
import { store } from '../components/layout.jsx'
import { keyLabel } from '../../shared/dictation/keys.js'
import { useDictation, configure, press, release, finish, cancel, dismiss, retry, keysPlatform, dictationKey, amend, forget } from './controller.js'
import { Morph, Listening, Working, Done } from './Pill.jsx'
import { t } from '../i18n/index.js'
import './dictation.css'

// The desktop app's dictation window (?dictate=1, desktop/dictation.js): it shows over whatever app
// you're in when you press the dictation key there, without taking the keyboard from it, as a small
// pill just under the menu bar (Pill.jsx): the level, how long, and where the words go. Then
// "Transcribing…", and with "Where I'm typing" picked in Settings › Voice, "Pasted into Slack" for a
// moment, and it's gone. Otherwise the pill grows into a card with the words, to Send to the agent
// (the one you last looked at in Bridge AI, or the chief of staff: Settings › Voice), to another (To
// ▾), to Copy, or to finish in Bridge AI. When pasting can't be done (no Accessibility yet on a Mac,
// a password field, another app in front by then) the words stay there to copy or send, with one
// line saying why. No Accessibility yet: Allow it asks macOS from there, and once it's on (noticed by
// itself), Paste pastes what's waiting where you were typing. After a Copy, it asks once whether to
// paste for you next time. Each dictation is kept with the app it was said in, and amended with what
// became of it (controller.js keep). Edit by voice (Settings › Voice, a Mac): with text selected where
// you were typing, what you said is how to change it; the model picked for it rewrites the text and
// it's pasted in its place.
// The desktop app tells it when the key goes down and up (bridge-dictate-key events, as in the main
// window); a press from before it was ready comes from hudReady(). The window keeps its width and
// top, and grows down to fit (hudSize); on a Mac and Windows, clicks go through it except on the
// pill (hudPointer).
const app = () => window.bridgeApp || {}
const WIDTH = 420
const nameOf = (a) => (a.chief ? t('Chief of Staff') : a.title || a.tab || a.workspace || a.paneId)
const pasteKey = () => (keysPlatform() === 'darwin' ? '⌘V' : 'Ctrl+V')
// Why it wasn't pasted (desktop/dictation.js's answers).
const WHY = {
  accessibility: () => t('Pasting needs Accessibility.'),
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
  const [shown, setShown] = useState(0) // each press, so the pill comes in afresh
  const [leaving, setLeaving] = useState(false)
  const [room, setRoom] = useState(48) // the card's height at most, while it eases
  const menu = useRef(null)
  const [allowed, setAllowed] = useState(false) // Accessibility turned on while the words waited here
  const [editing, setEditing] = useState(false) // edit by voice: the selection being read and rewritten
  const [edited, setEdited] = useState(null) // ...and what it was rewritten as
  const timer = useRef(null)
  const going = useRef(null)
  // This press's words, straight from the key: not after a download or Try again, when you've long
  // moved on and pasting would land wherever you are now.
  const fresh = useRef(false)
  const pasted = useRef(0) // the result last pasted (its time), so it's pasted once
  // Each press: what an earlier one was still doing (a Send on its way) doesn't touch this one.
  const press0 = useRef(0)

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
  // The key, from the desktop app (or a test). app, bundle: the app in front, when the desktop app
  // knows it.
  useEffect(() => {
    const begin = (at, name, bundle) => {
      clearTimeout(timer.current); clearTimeout(going.current); setLeaving(false)
      setDone(null); setErr(null); setPicking(false); setWhy(null); setOffer(false); setPasting(false); setAllowed(false); setEditing(false); setEdited(null)
      setInto(name || null)
      setShown((n) => n + 1)
      press0.current++
      fresh.current = true
      press({ kind: 'hud', app: name || bundle ? { name: name || '', bundle: bundle || '' } : null }, at); pickTarget(); loadStatus()
    }
    const on = (e) => {
      const d = e.detail || {}
      if (d.type === 'down') begin(d.at, d.app, d.bundle)
      else if (d.type === 'up') release(d.at)
      else if (d.type === 'cancel') { cancel(); hide() }
    }
    window.addEventListener('bridge-dictate-key', on)
    app().hudReady?.().then((p) => { if (p?.down) { begin(p.down, p.app, p.bundle); if (p.up) release(p.up) } }).catch(() => {})
    return () => window.removeEventListener('bridge-dictate-key', on)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s.setup || s.note) fresh.current = false }, [s.setup, s.note])
  // The desktop app holds Esc for us while we listen (and lets it go after).
  const phase = s.phase !== 'idle' ? s.phase : s.result ? 'result' : s.note || s.setup ? 'note' : 'idle'
  useEffect(() => { app().hudPhase?.(phase) }, [phase])
  // The window fits the pill: its width stays, it grows down from its top, so nothing in it moves;
  // ahead of the pill as it grows, after it as it shrinks (room: the most it takes meanwhile).
  useLayoutEffect(() => {
    app().hudSize?.(WIDTH, Math.ceil(12 + room + (picking && menu.current ? 6 + menu.current.offsetHeight : 0) + 16))
  }, [room, picking, agents.length])
  // Clicks go through the window except on the pill (and the agents' list): the desktop app is told
  // when the pointer comes onto it and leaves (on a Mac and Windows; elsewhere the window is the pill).
  useEffect(() => {
    if (!app().hudPointer) return
    let over = false
    const say = (v) => { if (v !== over) { over = v; app().hudPointer(v) } }
    const move = (e) => say(!!e.target?.closest?.('.hud, .hud-menu'))
    const out = () => say(false)
    document.addEventListener('mousemove', move)
    document.documentElement.addEventListener('mouseleave', out)
    return () => { document.removeEventListener('mousemove', move); document.documentElement.removeEventListener('mouseleave', out) }
  }, [])

  // Gone: it fades, then the window hides.
  const hide = () => {
    clearTimeout(going.current)
    setLeaving(true)
    going.current = setTimeout(() => { setPicking(false); setOffer(false); setLeaving(false); dismiss(); app().hudHide?.() }, 140)
  }
  const later = (ms) => { clearTimeout(timer.current); timer.current = setTimeout(() => { setDone(null); hide() }, ms) }
  const target = agents.find((a) => a.paneId === to) || null
  const text = edited ?? (s.result?.text || '')
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
    if (now && st?.edit?.on && app().hudSelection) { setEditing(true); editOr(r); return }
    if (!pasteOn || !now) return
    if (!st.paste.allowed) { setWhy('accessibility'); return }
    pasteIt(r)
  }, [s.result?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  // Edit by voice: what was selected when the key was let go (the desktop app read it), rewritten as
  // you said and pasted in its place. Nothing selected: your words, as they'd have gone.
  async function editOr(r) {
    const g = press0.current
    const sel = await app().hudSelection().catch(() => null)
    if (g !== press0.current) return
    if (!sel?.text?.trim()) {
      setEditing(false)
      if (pasteOn) { if (!st.paste.allowed) setWhy('accessibility'); else pasteIt(r) }
      return
    }
    try {
      const x = await api('/dictation/edit', { method: 'POST', body: { text: sel.text, instruction: r.text } })
      if (g !== press0.current) return
      setEdited(x.text)
      setEditing(false)
      pasteIt({ ...r, text: x.text }, true)
    } catch (e) { if (g === press0.current) { setEditing(false); setErr(e.message) } }
  }
  function pasteIt(r, change = false) {
    setPasting(true)
    setWhy(null)
    const g = press0.current
    app().hudPaste(r.text).then((x) => {
      if (x?.pasted) amend(r, { how: 'pasted' })
      // Said into a password field, most likely: not kept.
      else if (x?.error === 'secure') forget(r)
      if (g !== press0.current) return
      setPasting(false)
      if (x?.pasted) {
        // Nothing took it (no text field there): it's on the clipboard to paste by hand.
        if (x.read === false) { setDone(t('Nothing took it there, so it\'s on the clipboard: press {key} to paste it.', { key: pasteKey() })); later(3500) }
        else if (change) { setDone(into ? t('Changed in {app}', { app: into }) : t('Changed')); later(1200) }
        else { setDone(into ? t('Pasted into {app}', { app: into }) : t('Pasted')); later(900) }
      } else setWhy(WHY[x?.error] ? x.error : x?.error === 'off' ? null : 'failed')
    }, () => { if (g === press0.current) { setPasting(false); setWhy('failed') } })
  }
  // Waiting for Accessibility: Allow it asks macOS (its question, then System Settings with the tile:
  // desktop/permissions.js), and it's looked at every few seconds, so what you said is pasted once
  // you're back where you were typing.
  const askAccess = () => (app().permission?.ask ? app().permission.ask('accessibility') : app().pasteAsk?.())?.catch?.(() => null)
  useRecheck(async () => {
    if ((await app().pasteAccess?.().catch(() => null)) !== 'ok') return
    setWhy(null)
    setAllowed(true)
    loadStatus()
  }, 2500, why === 'accessibility')
  const agentOf = (a) => ({ id: a.paneId, name: nameOf(a), ...(a.chief ? { chief: true } : {}) })
  const send = async () => {
    if (!target || !text) return
    setErr(null)
    const g = press0.current
    try {
      const pid = encodeURIComponent(target.paneId)
      // As the message box does: a working agent that can't take a message now gets it when it's free.
      const r = s.result
      await api(`/agents/${pid}/${target.status === 'working' && !target.caps?.typeAhead ? 'queue' : 'prompt'}`, { method: 'POST', body: { text } })
      amend(r, { how: 'sent', agent: agentOf(target) })
      if (g !== press0.current) return
      setDone(t('Sent to {name}', { name: nameOf(target) }))
      later(1200)
    } catch (e) { if (g === press0.current) setErr(e.message) }
  }
  const copy = async () => {
    const g = press0.current
    const r = s.result
    try {
      if (app().hudCopy) await app().hudCopy(text)
      else await navigator.clipboard.writeText(text)
      amend(r, { how: 'copied' })
      if (g !== press0.current) return
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
      await askAccess()
      setDone(t('Turn on Bridge AI under Accessibility when macOS asks, and it pastes from next time.'))
      later(6000)
    } else { setDone(t('From next time, it\'s pasted where you\'re typing.')); later(2500) }
  }
  const edit = () => { if (target) amend(s.result, { how: 'typed', agent: agentOf(target) }); app().hudOpen?.({ paneId: target?.paneId, text }); hide() }
  const label = keyLabel(dictationKey(conf), keysPlatform())
  // Pasting where you're typing, allowed: no agent to pick while it listens.
  const intoApp = pasteOn && st?.paste?.allowed && !why

  const toChip = intoApp ? (
    <span className="dp-to hud-into" title={t('Pasted where you\'re typing')}>{into ? t('Into {app}', { app: into }) : t('Where you\'re typing')}</span>
  ) : (
    <button type="button" className="dp-to hud-to-btn" data-pane={target?.paneId || ''} onClick={() => setPicking((v) => !v)} aria-haspopup="menu" aria-expanded={picking}>
      <span>{target ? t('To {name}', { name: nameOf(target) }) : t('Pick an agent')}</span> <Icon name="down" size={11} />
    </button>
  )
  // What shows: the pill while it listens, transcribes, pastes, or says what became of the words;
  // the card for the words to send or copy, a note, or the speech model to download.
  const listening = s.phase === 'opening' || s.phase === 'listening'
  const autoPaste = !!s.result && (pasteOn || edited != null) && !!st?.paste?.allowed && !why && (pasting || (fresh.current && pasted.current !== s.result.at))
  const view = listening ? 'listening' : s.phase === 'working' ? 'working' : s.result && (editing || (autoPaste && !done)) ? 'pasting'
    : done && !offer && !err ? 'done' : s.result ? 'card' : s.note || s.setup ? 'note' : 'idle'
  const card = view === 'card' || view === 'note'
  const hint = s.mode === 'free' ? t('Listening… press {key} again when you\'re done', { key: label }) : t('Let go to finish · Esc cancels')
  return (
    // Between presses there's nothing to show: the window is hidden, and when it's shown for the
    // next press, nothing from the last one flashes up first.
    <div className={`hud-root${leaving || view === 'idle' ? ' leaving' : ''}`}>
      <Morph key={shown} className={`hud${card ? ' card' : ''}`} role="dialog" aria-label={t('Dictation')} onSize={(z) => setRoom(z.h)}>
        {view === 'listening' && <Listening s={s} to={toChip} hint={hint} onCancel={() => { cancel(); hide() }} onStop={finish} />}
        {view === 'working' && <Working s={s} />}
        {view === 'pasting' && <Working s={s} text={editing ? t('Changing what you selected…') : into ? t('Pasting into {app}…', { app: into }) : t('Pasting…')} />}
        {view === 'done' && <Done text={done} />}
        {view === 'card' && (
          <div className="dp-card">
            <div className="hud-row">{toChip}<span className="grow" /><button type="button" className="dp-x" onClick={hide} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={12} /></button></div>
            <p className="hud-text">{text}</p>
            {err && <p className="error-text small">{err}</p>}
            {why && <p className="hud-why small" role="status"><Icon name="info" size={12} /> {WHY[why]()}{why === 'accessibility' && (app().permission || app().pasteAsk) ? <> <button type="button" className="link-btn" onClick={askAccess}>{t('Allow it')}</button></> : null}</p>}
            {allowed && !done && <p className="hud-why small" role="status"><Icon name="check" size={12} /> {t('Accessibility is on. Click where you were typing, then Paste.')}</p>}
            {done ? <p className="hud-done" role="status"><Icon name="check" size={12} /> {done}</p> : (
              <div className="hud-actions">
                {app().hudOpen && <button type="button" className="btn small" onClick={edit} disabled={!target}>{t('Edit in Bridge AI')}</button>}
                <button type="button" className="btn small" onClick={copy}>{t('Copy')}</button>
                {allowed
                  ? <button type="button" className="btn small primary" onClick={() => { setAllowed(false); pasteIt(s.result) }}>{t('Paste')}</button>
                  : <button type="button" className="btn small primary" onClick={send} disabled={!target}>{t('Send')}</button>}
              </div>
            )}
            {offer && (
              <div className="hud-row hud-offer" role="group" aria-label={t('Paste it for you next time?')}>
                <span className="hud-note">{t('Paste it for you next time?')}{st?.paste?.asks === 'accessibility' && !st.paste.allowed ? ` ${t('macOS asks once to allow it.')}` : ''}</span>
                <button type="button" className="comp-text-btn" onClick={() => answer(false)}>{t('Not now')}</button>
                <button type="button" className="btn small primary" onClick={() => answer(true)}>{t('Paste it')}</button>
              </div>
            )}
          </div>
        )}
        {view === 'note' && (
          <div className="dp-card">
            {s.setup ? (
              <div className="hud-setup">
                {/* The first time: the speech model to download, with what you said kept and turned
                    into text here once it's in (Composer.jsx's panel, as in the message box). */}
                {s.setup.mic ? <MicFix stale={s.setup.stale} onClose={hide} /> : <VoiceSetup initial={s.setup} onReady={retry} onClose={hide} />}
              </div>
            ) : (
              <div className="hud-row">
                <span className="hud-note">{s.note}</span>
                {s.retry && <button type="button" className="btn small" onClick={retry}>{t('Try again')}</button>}
                <button type="button" className="dp-x" onClick={hide} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={12} /></button>
              </div>
            )}
          </div>
        )}
        {view === 'idle' && <div className="dp-row"><span className="dp-what">{t('Hold {key} in any app and talk.', { key: label })}</span></div>}
      </Morph>
      {picking && !intoApp && (
        <div className="hud-menu" role="menu" ref={menu}>
          {agents.map((a) => (
            <button key={a.paneId} type="button" role="menuitem" data-pane={a.paneId} className={a.paneId === to ? 'on' : ''} onClick={() => { setTo(a.paneId); setPicking(false) }}>
              {a.chief ? <Icon name="helm" size={12} /> : <StatusDot status={a.status} size={7} />} <span>{nameOf(a)}</span>
            </button>
          ))}
          {!agents.length && <p className="muted small">{t('No agents are running.')}</p>}
        </div>
      )}
    </div>
  )
}
