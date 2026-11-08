import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from '../components/Icon.jsx'
import { VoiceSetup, MicFix } from '../components/Composer.jsx'
import { agentName } from '../components/Rail.jsx'
import { api, settingsChanged } from '../api.js'
import { useRecheck } from '../permissions.js'
import { store } from '../components/layout.jsx'
import { keyLabel } from '../../shared/dictation/keys.js'
import { corrections } from '../../shared/dictation/corrected.js'
import { useDictation, configure, press, release, finish, cancel, dismiss, retry, keysPlatform, dictationKey, amend, forget } from './controller.js'
import { Morph, Listening, Working, Done } from './Pill.jsx'
import { untidiedWhy, TidyNeeds } from './Tidy.jsx'
import Remember from './Remember.jsx'
import { t } from '../i18n/index.js'
import { sentTo } from '../sendbox.js'
import './dictation.css'

// The desktop app's dictation window (?dictate=1, desktop/dictation.js): it shows over whatever app
// you're in when you press the dictation key there, without taking the keyboard from it, as a small
// pill just under the menu bar (Pill.jsx): the level, how long, and where the words go. Then
// "Transcribing…", and with "Where I'm typing" picked in Settings › Voice, "Pasted into Slack" for a
// moment, and it's gone. Otherwise the pill grows into a card with the words, to Send to the agent
// (the one you last looked at in Bridge AI, or the chief of staff: Settings › Voice), to another (To
// ▾), or to Copy. The words can be edited right there first: click them (or Edit), and the window
// takes the keyboard until you're done (the desktop app gives it back to the app you were in); Esc
// stops editing, ⌘↩ (Ctrl+Enter) does what the card's main button does. A name you put right is
// offered to meeting memory once they've gone (Remember.jsx), and kept only if you say so. When
// pasting can't be done (no Accessibility yet on a Mac, a password field, another app in front by
// then) the words stay there to edit, copy or send, with one line saying why; where it can be tried
// again, Paste brings that app back and pastes them there. No Accessibility yet: Allow it asks macOS
// from there, and once it's on (noticed by itself), Paste pastes what's waiting where you were
// typing. After a Copy, it asks once whether to paste for you next time. Each dictation is kept with
// the app it was said in, and amended with what became of it, and your edit of it (controller.js
// keep). Edit by voice (Settings › Voice, a Mac): with text selected where
// you were typing, what you said is how to change it; the model picked for it rewrites the text and
// it's pasted in its place. Tidy what I say (a trial, Settings › Voice): what you said is tidied by
// a model first ("Tidying…"), and pasted tidied; when it isn't (too slow, an error, an answer that
// wasn't what you said, no model yet) it's pasted as you said it, and the pill says why for a
// moment, or with no model yet, the card offers the local model in one click. On the card, Use what
// I said swaps in the words from before tidying.
// The desktop app tells it when the key goes down and up (bridge-dictate-key events, as in the main
// window); a press from before it was ready comes from hudReady(). The window keeps its width and
// top, and grows down to fit (hudSize); on a Mac and Windows, clicks go through it except on the
// pill (hudPointer).
const app = () => window.bridgeApp || {}
const WIDTH = 420
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
  const [asSaid, setAsSaid] = useState(false) // tidied, and you picked what you said instead
  const [draft, setDraft] = useState(null) // the words as you edit them on the card (null: not editing)
  const [fixes, setFixes] = useState([]) // names you put right there, offered to meeting memory
  const area = useRef(null)
  const caret = useRef(null) // where the caret goes as editing starts: where the words were clicked
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
      setDone(null); setErr(null); setPicking(false); setWhy(null); setOffer(false); setPasting(false); setAllowed(false); setEditing(false); setEdited(null); setAsSaid(false); setDraft(null); setFixes([])
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
  const text = edited ?? (asSaid && s.result?.said ? s.result.said : s.result?.text || '')
  // What goes: your edit of the words, once you've started one (mine: it changed them).
  const words = draft ?? text
  const mine = draft != null && draft !== text
  const typing = draft != null && !done
  // Not tidied, and why (with no model yet, what's needed shows on the card).
  const untidied = edited == null ? s.result?.untidied || null : null
  const needsModel = untidied?.code === 'no-model'
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
      pasteIt({ ...r, text: x.text }, { change: true })
    } catch (e) { if (g === press0.current) { setEditing(false); setErr(e.message) } }
  }
  // change: the selection rewritten (edit by voice). back: from the card, so the app it goes into is
  // brought back to the front first. fx: names you put right in your edit of the words (kept as you
  // edited them), offered to memory once they're in, the window staying up a while for that.
  function pasteIt(r, { change = false, back = false, fx = null } = {}) {
    setPasting(true)
    setWhy(null)
    const g = press0.current
    const stay = (ms) => later(fx?.length ? 20000 : ms)
    app().hudPaste(r.text, back ? { back: true } : undefined).then((x) => {
      if (x?.pasted) amend(r, { how: 'pasted', ...(fx ? { text: r.text } : {}) })
      // Said into a password field, most likely: not kept.
      else if (x?.error === 'secure') forget(r)
      if (g !== press0.current) return
      setPasting(false)
      if (x?.pasted) {
        if (fx?.length) setFixes(fx)
        // Nothing took it (no text field there): it's on the clipboard to paste by hand.
        if (x.read === false) { setDone(t('Nothing took it there, so it\'s on the clipboard: press {key} to paste it.', { key: pasteKey() })); stay(3500) }
        else if (change) { setDone(into ? t('Changed in {app}', { app: into }) : t('Changed')); later(1200) }
        else if (r.by != null) { setDone(into ? t('Tidied and pasted into {app}', { app: into }) : t('Tidied and pasted')); later(900) }
        // As you said it: why, for long enough to read (with no model yet, the card, a while longer).
        else { setDone(into ? t('Pasted into {app}', { app: into }) : t('Pasted')); stay(r.untidied ? (r.untidied.code === 'no-model' ? 15000 : 4000) : 900) }
      } else setWhy(WHY[x?.error] ? x.error : x?.error === 'off' ? null : 'failed')
    }, () => { if (g === press0.current) { setPasting(false); setWhy('failed') } })
  }
  // Paste on the card: what's there now (your edit of it, or what you said), into the app the key was
  // pressed in, brought back to the front first.
  const pasteCard = () => {
    setAllowed(false)
    pasteIt({ ...s.result, text: words, ...(mine || asSaid ? { by: null } : {}) }, { back: true, fx: mine ? corrections(text, words) : null })
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
  const agentOf = (a) => ({ id: a.paneId, name: agentName(a), ...(a.chief ? { chief: true } : {}) })
  // What became of the words, for the history: and your edit of them, when they went edited.
  const how = (o) => ({ ...o, ...(mine ? { text: words } : {}) })
  // Done with the words: the keyboard back to the app you were in, and a name you put right offered.
  const went = () => { if (draft != null) app().hudKeyboard?.(false); const fx = mine ? corrections(text, words) : []; setFixes(fx); return fx.length > 0 }
  const send = async () => {
    if (!target || !words.trim()) return
    setErr(null)
    const g = press0.current
    try {
      const pid = encodeURIComponent(target.paneId)
      // As the message box does: your computer types it in, or holds it while the agent is busy, and
      // its answer says which.
      const r = s.result
      const got = await api(`/agents/${pid}/prompt`, { method: 'POST', body: { text: words } })
      amend(r, how({ how: got?.queued ? 'queued' : 'sent', agent: agentOf(target) }))
      if (g !== press0.current) return
      const ask = went()
      setDone(sentTo(got, agentName(target)))
      later(ask ? 20000 : 1200)
    } catch (e) { if (g === press0.current) setErr(e.message) }
  }
  const copy = async () => {
    const g = press0.current
    const r = s.result
    try {
      if (app().hudCopy) await app().hudCopy(words)
      else await navigator.clipboard.writeText(words)
      amend(r, how({ how: 'copied' }))
      if (g !== press0.current) return
      const ask = went()
      setDone(keysPlatform() === 'darwin' ? t('Copied. Press ⌘V to paste it.') : t('Copied. Press Ctrl+V to paste it.'))
      // Asked once: paste it for you next time? (Only where this computer can, and not while a name
      // you put right is being offered.)
      if (ask) later(20000)
      else if (canPaste && conf?.to !== 'paste' && !conf?.offeredPaste) { setOffer(true); later(15000) } else later(2200)
    } catch (e) { setErr(e.message) }
  }
  // Editing the words on the card: the window takes the keyboard (the desktop app lets it, for this),
  // with the caret where you clicked, or at the end. Esc stops (the words as they were), ⌘↩ or
  // Ctrl+Enter does what the card's main button does.
  const startEdit = (at = null) => {
    if (draft != null) return
    caret.current = at
    setDraft(text)
    setOffer(false)
    app().hudKeyboard?.(true)
  }
  const stopEdit = () => { setDraft(null); app().hudKeyboard?.(false) }
  const fit = (el) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px` }
  useLayoutEffect(() => {
    const el = area.current
    if (!typing || !el) return
    el.focus()
    const at = Math.min(caret.current ?? el.value.length, el.value.length)
    el.setSelectionRange(at, at)
    fit(el)
  }, [typing])
  // Where in the words a click landed (not the end of a selection being made, to copy part of them).
  const clickAt = (e) => {
    if (String(window.getSelection?.() || '')) return
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY)
    startEdit(r && e.currentTarget.contains(r.startContainer) ? r.startOffset : null)
  }
  // Kept, then the window goes, unless the key was pressed again meanwhile: the new dictation is
  // the window's now, and it isn't hidden or written over from under it.
  const answer = async (yes) => {
    const g = press0.current
    setOffer(false)
    const patch = yes ? { to: 'paste', offeredPaste: true } : { offeredPaste: true }
    const next = { ...(conf || {}), ...patch }
    setConf(next)
    configure(next)
    await api('/settings', { method: 'PATCH', body: { dictation: patch } }).then(settingsChanged, () => {})
    if (!yes) { if (g === press0.current) later(400); return }
    const now = await app().dictateConfigure?.(next).catch(() => null)
    if (now) setSt(now)
    // A Mac: macOS asks now (Accessibility), with the tile beside System Settings.
    if (now?.paste?.asks === 'accessibility' && !now.paste.allowed) {
      await askAccess()
      if (g !== press0.current) return
      setDone(t('Turn on Bridge AI under Accessibility when macOS asks, and it pastes from next time.'))
      later(6000)
    } else if (g === press0.current) { setDone(t('From next time, it\'s pasted where you\'re typing.')); later(2500) }
  }
  const label = keyLabel(dictationKey(conf), keysPlatform())
  // Pasting where you're typing, allowed: no agent to pick while it listens.
  const intoApp = pasteOn && st?.paste?.allowed && !why
  // Paste on the card: once Accessibility was turned on while the words waited, or after a paste
  // that didn't go and may now (another app was in front, a key still held, Bridge AI in front).
  const again = pasteOn && !!st?.paste?.allowed && ['moved', 'held', 'failed', 'focus'].includes(why)
  const pasteNow = allowed || again
  // With nobody to send to yet, the list of agents to pick from.
  const main = () => (pasteNow ? pasteCard() : target ? send() : setPicking(true))
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); stopEdit() } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); main() }
  }
  const enter = keysPlatform() === 'darwin' ? '⌘↩' : 'Ctrl+Enter'

  const toChip = intoApp ? (
    <span className="dp-to hud-into" title={t('Pasted where you\'re typing')}>{into ? t('Into {app}', { app: into }) : t('Where you\'re typing')}</span>
  ) : (
    <button type="button" className="dp-to hud-to-btn" data-pane={target?.paneId || ''} onClick={() => setPicking((v) => !v)} aria-haspopup="menu" aria-expanded={picking}>
      <span>{target ? t('To {name}', { name: agentName(target) }) : t('Pick an agent')}</span> <Icon name="down" size={11} />
    </button>
  )
  // What shows: the pill while it listens, transcribes, pastes, or says what became of the words;
  // the card for the words to send or copy, a note, or the speech model to download.
  const listening = s.phase === 'opening' || s.phase === 'listening'
  const autoPaste = !!s.result && (pasteOn || edited != null) && !!st?.paste?.allowed && !why && (pasting || (fresh.current && pasted.current !== s.result.at))
  const view = listening ? 'listening' : s.phase === 'working' ? 'working' : s.result && (editing || (autoPaste && !done)) ? 'pasting'
    : done && !offer && !err && !needsModel && !fixes.length ? 'done' : s.result ? 'card' : s.note || s.setup ? 'note' : 'idle'
  const card = view === 'card' || view === 'note'
  const hint = s.mode === 'free' ? t('Listening… press {key} again when you\'re done', { key: label }) : t('Let go to finish · Esc cancels')
  return (
    // Between presses there's nothing to show: the window is hidden, and when it's shown for the
    // next press, nothing from the last one flashes up first.
    <div className={`hud-root${leaving || view === 'idle' ? ' leaving' : ''}`}>
      <Morph key={shown} className={`hud${card ? ' card' : ''}`} role="dialog" aria-label={t('Dictation')} onSize={(z) => setRoom(z.h)}>
        {view === 'listening' && <Listening s={s} to={toChip} hint={hint} onCancel={() => { cancel(); hide() }} onStop={finish} />}
        {view === 'working' && <Working s={s} text={s.tidying ? t('Tidying what you said…') : undefined} />}
        {view === 'pasting' && <Working s={s} text={editing ? t('Changing what you selected…') : into ? t('Pasting into {app}…', { app: into }) : t('Pasting…')} />}
        {view === 'done' && <Done text={done} warn={!!untidied} note={untidiedWhy(untidied)} />}
        {view === 'card' && (
          <div className="dp-card">
            <div className="hud-row">{toChip}<span className="grow" /><button type="button" className="dp-x" onClick={hide} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={12} /></button></div>
            {typing
              ? <textarea ref={area} className="hud-edit" value={draft} rows={1} spellCheck aria-label={t('What you said')} onChange={(e) => { setDraft(e.target.value); fit(e.target) }} onKeyDown={onKey} onPointerDown={() => app().hudKeyboard?.(true)} />
              : <p className={`hud-text${done ? '' : ' editable'}`} onClick={done ? undefined : clickAt} title={done ? undefined : t('Click to edit')}>{words}</p>}
            {err && <p className="error-text small">{err}</p>}
            {why && <p className="hud-why small" role="status"><Icon name="info" size={12} /> {WHY[why]()}{why === 'accessibility' && (app().permission || app().pasteAsk) ? <> <button type="button" className="link-btn" onClick={askAccess}>{t('Allow it')}</button></> : null}</p>}
            {allowed && !done && <p className="hud-why small" role="status"><Icon name="check" size={12} /> {t('Accessibility is on. Click where you were typing, then Paste.')}</p>}
            {s.result?.by != null && edited == null && draft == null && (
              <p className="hud-why small hud-tidied"><Icon name="sparkle" size={12} /> {asSaid ? t('As you said it.') : s.result.by ? t('Tidied by {model}.', { model: s.result.by }) : t('Tidied.')}
                {s.result.said && <>{' '}<button type="button" className="link-btn" onClick={() => setAsSaid((v) => !v)}>{asSaid ? t('Use the tidied text') : t('Use what I said')}</button></>}</p>
            )}
            {untidied && <p className="hud-why small hud-untidied" role="status"><Icon name="info" size={12} /> {untidiedWhy(untidied)}</p>}
            {needsModel && <TidyNeeds local={untidied.local} className="hud-tidy" />}
            {done ? <p className="hud-done" role="status"><Icon name="check" size={12} /> {done}</p> : (
              <div className="hud-actions">
                {typing && <span className="hud-keys">{pasteNow ? t('{key} pastes · Esc cancels', { key: enter }) : t('{key} sends · Esc cancels', { key: enter })}</span>}
                {typing
                  ? <button type="button" className="btn small" onClick={stopEdit}>{t('Cancel')}</button>
                  : <button type="button" className="btn small" onClick={() => startEdit()}>{t('Edit')}</button>}
                <button type="button" className="btn small" onClick={copy} disabled={!words.trim()}>{t('Copy')}</button>
                {pasteNow
                  ? <button type="button" className="btn small primary" onClick={pasteCard} disabled={!words.trim()}>{into && again ? t('Paste into {app}', { app: into }) : t('Paste')}</button>
                  : <button type="button" className="btn small primary" onClick={send} disabled={!target || !words.trim()}>{t('Send')}</button>}
              </div>
            )}
            {fixes.length > 0 && (
              <div className="hud-remember">
                {fixes.map((f) => <Remember key={`${f.heard}\n${f.term}`} fix={f} onKept={() => later(8000)} onClose={() => { const left = fixes.filter((x) => x !== f); setFixes(left); if (!left.length) later(400) }} />)}
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
              {a.chief ? <Icon name="helm" size={12} /> : <StatusDot status={a.status} size={7} />} <span>{agentName(a)}</span>
            </button>
          ))}
          {!agents.length && <p className="muted small">{t('No agents are running.')}</p>}
        </div>
      )}
    </div>
  )
}
