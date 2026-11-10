// Dictation in the page: one recording at a time, whoever starts it (the dictation key, the message
// box's mic button, the desktop app's key from another app). Hold to talk and let go to get the text;
// a tap (let go within 300 ms, or before the mic was even on) keeps listening hands-free until the
// key again, Enter or ✓. Esc or Cancel throws it away.
//
// The sound is 16 kHz PCM from the page (src/audio/pcm.js), sent once as a WAV to /api/transcribe,
// which turns it into text on the computer (server/voice.js); from a phone it goes there over the
// relay's end-to-end encrypted link like every other request. The text is tidied
// (shared/dictation/clean.js, with the names the computer knows) and put where you were: the message
// box (at its cursor), a terminal tab (typed, without Enter), any other field; with nothing focused,
// the message box of the agent on screen. Another device's agent in a tab here (RemoteAgent.jsx):
// handed to its page, which puts them where they'd have gone had they been said there (take), never
// in a box of this device's. The desktop app's floating window (Hud.jsx) shows it instead, to edit,
// send or copy.
//
// This device's page in a tab of another device's window doesn't listen itself: that window's page
// does, and gives the words back (lent, below). The two pages are different sites, so that's only
// in messages (Between a tab's page and this one, below). Another device's page in the desktop app
// with no such page around it can't use this computer's microphone at all, and says so (noMic).
import { useSyncExternalStore } from 'react'
import { api, apiUrl, settingsChanged, viaRelay, embedded, machineId } from '../api.js'
import { store } from '../components/layout.jsx'
import { startPcm, microphone, wav, RATE, micRefused, micBlocked } from '../audio/pcm.js'
import { clean, makeNames } from '../../shared/dictation/clean.js'
import { defaultKey, keyLabel } from '../../shared/dictation/keys.js'
import { t } from '../i18n/index.js'

export const HOLD_MS = 300
// The most it waits for the mic's first sound before listening all the same.
const SOUND_MS = 3000

// phase: idle | opening (till the mic's sound comes) | listening | working (turning it into text).
// mode: hold | free (hands-free). level: how loud now (0 to 1); levels: the last few, oldest first,
// for the pill's moving bars (Pill.jsx). live: what's been heard so far, while it listens and until
// the text is in (live words, below). note: a line to show. setup: what /voice says is missing, or
// { mic: true }. result: { text } the last text (for the floating window). offer: the desktop app's
// key status, while asking whether the key should work from any app too. tidying: the words are
// with the model being tidied (Tidy what I say, below); result.by is then the model that tidied
// them, result.said what you said when that changed it, and result.untidied why they weren't
// ({ code, error, local }). early: pressed again before those words were in, which is said till
// they are (press, below).
export const LEVELS = 18
const QUIET = Array(LEVELS).fill(0)
let st = { phase: 'idle', mode: null, target: null, level: 0, levels: QUIET, live: '', since: 0, note: null, setup: null, result: null, retry: false, offer: null, tidying: false, early: false }
const subs = new Set()
// Done with listening (the text is in, or it isn't coming): its live words go with it.
const set = (p) => { st = { ...st, ...p, ...(p.phase === 'idle' ? { live: '', tidying: false, early: false } : {}) }; for (const f of subs) f() }
// ...or, while the window this page is in listens for a press made here, that one's (lent).
export const getState = () => hosted()?.state() || st
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f) }
// select: what a component needs of it, so one that isn't recording isn't drawn again ten times a
// second for the level (it must give back the same value while nothing it needs has changed).
export const useDictation = (select = (x) => x) => useSyncExternalStore(subscribe, () => select(st))
export const active = () => st.phase !== 'idle'

// The platform the keys are pressed on: the desktop app's, else this browser's.
export const keysPlatform = () => window.bridgeApp?.platform || (/Mac|iPhone|iPad/.test(navigator.platform) ? 'darwin' : /Win/.test(navigator.platform) ? 'win32' : 'linux')
// Fn never reaches a page: only the desktop app on a Mac hears it (with the key from other apps on),
// and tells the page. Anywhere else the usual key works instead.
const fnHeard = (c) => !!window.bridgeApp?.desktop && keysPlatform() === 'darwin' && c.background === true
export const dictationKey = (c) => (c?.key && (c.key !== 'Fn' || fnHeard(c)) ? c.key : defaultKey(keysPlatform()))
// What a bar says while it listens, held or hands-free.
export const listeningHint = (mode, label) => (mode === 'free' ? t("Listening… press {key} or Enter when you're done", { key: label }) : t('Talking… let go to add it · Esc cancels'))

// Settings › Voice › Dictation, from /api/config: { on, key, cleanup, atFiles, to, background,
// history, keepFor, keepAudio, liveWords, tidy }.
let cfg = {}
export const configure = (c) => { cfg = c || {} }
export const settings = () => cfg
// Picking a new key (Settings): the key does nothing meanwhile.
let paused = false
export const pause = (on) => { paused = !!on }
export const isPaused = () => paused

// ---------- Where the text goes ----------
// Message boxes say they're there (Composer.jsx): { insert(text, caret), visible() }. So does
// another device's agent in a tab (RemoteAgent.jsx): { frame: true, name, origin, el(), win(),
// insert(text), visible() }, its insert a promise of whether its page took them (origin null while
// its page's address isn't known here: nothing goes to that page, nor is heard from it).
const boxes = new Map()
let lastBox = null
let onScreen = () => null // the agent on screen (App.jsx)
export function registerBox(id, box) {
  boxes.set(id, box)
  // Another device's page in a tab: told this page is here, in case it said hello before its address
  // was known here (Between a tab's page and this one, below).
  if (box.frame) setTimeout(() => toTab(box, 'host', hostSays()))
  return () => { if (boxes.get(id) === box) boxes.delete(id) }
}
export const noteBoxFocus = (id) => { lastBox = id }
export const setOnScreen = (fn) => { onScreen = fn || (() => null) }
export const box = (id) => boxes.get(id) || null
// Asking the Chief of Staff out loud (voice/AskOutLoud.jsx): its own way to take the words.
const asks = new Map()
export function registerAsk(id, fn) { asks.set(id, fn); return () => { if (asks.get(id) === fn) asks.delete(id) } }
function fallbackBox() {
  const a = onScreen()
  if (a && boxes.get(a)?.visible()) return a
  if (lastBox && boxes.get(lastBox)?.visible()) return lastBox
  for (const [id, b] of boxes) if (b.visible()) return id
  return null
}
const TEXTY = /^(text|search|url|email|tel|)$/
const editable = (el) => !!el && !el.disabled && !el.readOnly && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXTY.test(el.type || '')) || el.isContentEditable)
// Where the focus is now, as a target: { kind: composer | terminal | field | password, ... }.
export function targetFromFocus() {
  const el = document.activeElement
  if (el?.classList?.contains('xterm-helper-textarea')) {
    const host = el.closest('.terminal-host')
    if (host) return { kind: 'terminal', el: host, sentence: false }
  }
  const id = el?.getAttribute?.('data-composer')
  if (id && boxes.has(id)) return { kind: 'composer', id, caret: [el.selectionStart, el.selectionEnd] }
  if (el?.tagName === 'INPUT' && el.type === 'password') return { kind: 'password' }
  if (editable(el)) return { kind: 'field', el, sel: typeof el.selectionStart === 'number' ? [el.selectionStart, el.selectionEnd] : null, sentence: el.tagName === 'TEXTAREA' || el.isContentEditable }
  const b = fallbackBox()
  return b ? { kind: 'composer', id: b } : null
}

// Typed into a field at its cursor, as if you had: React and undo both see it.
function typeInto(el, text, sel) {
  el.focus()
  if (sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]) } catch { /* not a text input */ } }
  const before = el.isContentEditable ? '' : String(el.value || '').slice(0, el.selectionStart ?? 0)
  const ins = `${before && !/\s$/.test(before) ? ' ' : ''}${text}`
  if (document.execCommand?.('insertText', false, ins)) return
  const v = String(el.value || '')
  const a = el.selectionStart ?? v.length, b = el.selectionEnd ?? v.length
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
  if (setter) setter.call(el, v.slice(0, a) + ins + v.slice(b)); else el.value = v.slice(0, a) + ins + v.slice(b)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
// at: the words' time, by which they're kept (amend), for Ask out loud to say what came of them.
// Whether they went in: for a tab's page here (another device's), a promise of what it said.
const went = (r) => (typeof r?.then === 'function' ? r.then((x) => x !== false, () => false) : r !== false)
function deliver(target, text, at) {
  if (!target || target.kind === 'hud') return true
  if (target.kind === 'ask') { const f = asks.get(target.id); if (f) f(text, { at }); return !!f }
  // Listened for the page in a tab here: given back to it, to put where it would have.
  if (target.kind === 'frame') { try { return went(target.give(text, at)) } catch { return false } }
  if (target.kind === 'composer' && boxes.get(target.id)) return went(boxes.get(target.id).insert(text, target.caret))
  // Typed into the terminal, without Enter (Terminal.jsx and LiveShell.jsx listen for this).
  if (target.kind === 'terminal' && target.el?.isConnected) { target.el.dispatchEvent(new CustomEvent('bridge-type', { detail: text })); return true }
  if (target.kind === 'field' && target.el?.isConnected) { typeInto(target.el, text, target.sel); return true }
  // What you were in has gone: the message box on screen.
  const b = fallbackBox()
  if (b) return went(boxes.get(b).insert(text))
  return false
}
// Words heard for this page by another: the page of a window showing this device's agent in a tab
// (handOver), or the desktop app's dictation window, for its window showing this device
// (desktop/dictation.js). Put where they'd have gone had they been heard here. Whether they were
// (a promise, when that's another device's page in a tab here).
export function take(text) {
  const target = typeof text === 'string' && text.trim() ? targetFromFocus() : null
  return !!target && target.kind !== 'password' && deliver(target, text)
}

// ---------- Between a tab's page and this one ----------
// Another device's agent in a tab here is that device's page, at a port of its own (api.js
// machineUrl): another site, which can't reach into this page, nor this one into it. So the two only
// talk in messages, each checked for the window and the address it came from, of these kinds, and
// nothing else of either page goes to the other:
//   the tab's page says it's there (hello), its presses (press, release, cancel, finish: it doesn't
//     listen itself, whatever starts it there: the key, its mic button, Ask out loud), and whether
//     it put the words it was given (given, took);
//   this page says whether it listens for it (host), how that's going (state), and the words: heard
//     for a press there (give), or heard here with the focus in it or it on screen (words).
const MSG = 'bridge-dictation'
const FROM_TAB = new Set(['hello', 'press', 'release', 'cancel', 'finish', 'given', 'took'])
const FROM_HOST = new Set(['host', 'state', 'give', 'words'])
const PHASES = new Set(['idle', 'opening', 'listening', 'working'])
const ANSWER_MS = 3000

// This page, with tabs of other devices' pages: lending is its dictation while it listens for them
// (Dictation.jsx lendTo); spoke, the tabs' windows whose page said it's there.
let lending = null
const spoke = new WeakSet()
const answers = new Map() // a message's id -> what its answer settles
let asked = 0
const tabOf = (e) => [...boxes.values()].find((b) => b.frame && b.win?.() === e.source && e.origin === b.origin) || null
const toTab = (b, type, more = {}) => { if (!b.origin) return; try { b.win()?.postMessage({ [MSG]: type, ...more }, b.origin) } catch { /* gone */ } }
const hostSays = () => ({ listens: !!lending, app: !!window.bridgeApp?.desktop })
// The words, to a tab's page: whether it put them, or false after a while (it went, or it's a Bridge
// AI from before this, which never answers).
function askTab(b, type, text, at) {
  const w = b.win?.()
  if (!w || !spoke.has(w)) return Promise.resolve(false)
  return new Promise((resolve) => {
    const id = ++asked
    const timer = setTimeout(() => { answers.delete(id); resolve(false) }, ANSWER_MS)
    answers.set(id, (put) => { clearTimeout(timer); answers.delete(id); resolve(put === true) })
    toTab(b, type, { id, text, ...(Number.isFinite(at) ? { at } : {}) })
  })
}
// ...heard here for it (RemoteAgent.jsx's insert).
export const handOver = (b, text) => askTab(b, 'words', text)
export function lendTo(l) {
  lending = l
  for (const b of boxes.values()) if (b.frame && spoke.has(b.win?.())) toTab(b, 'host', hostSays())
}
let told = null // the tab last told how it's going, and what
function tellTab() {
  const b = st.target?.kind === 'frame' ? boxes.get(st.target.id) : told?.b
  if (!b) return
  const now = `${st.phase}:${st.mode}`
  if (told?.b !== b || told.now !== now) toTab(b, 'state', { phase: st.phase, mode: st.mode })
  told = st.phase === 'idle' ? null : { b, now }
}
function fromTab(e) {
  const d = e.data
  if (!d || typeof d !== 'object' || !FROM_TAB.has(d[MSG])) return
  const b = tabOf(e)
  if (!b) return
  const type = d[MSG]
  if (type === 'hello') { spoke.add(e.source); toTab(b, 'host', hostSays()); return }
  if (type === 'given' || type === 'took') { answers.get(d.id)?.(d.put); return }
  if (!lending) return
  // A press only from you, in it: just after a key or a click in this window (one in its frame counts
  // here too), with the focus in its frame (which its page takes as it hands a press over, and can
  // only with a key or click of its own). The rest only for the listening that's for it. So it can't
  // start this computer's microphone by itself, nor stop what's listening for this page.
  const inIt = document.hasFocus() && document.activeElement === b.el?.() && navigator.userActivation?.isActive !== false
  const forIt = () => st.target?.kind === 'frame' && boxes.get(st.target.id) === b
  const at = Number.isFinite(d.at) ? d.at : Date.now()
  if (type === 'press' && inIt) lending.press(at, d.target ? { from: e.source, ask: d.ask === true, sentence: d.sentence !== false, give: (text, when) => askTab(b, 'give', text, when) } : null)
  else if (type === 'release' && forIt()) lending.release(at)
  else if (type === 'cancel' && forIt()) lending.cancel()
  else if (type === 'finish' && forIt()) lending.finish()
  // What came of it, even when nothing changed (a press it couldn't take): only its own listening,
  // never whether this page is listening for something else.
  toTab(b, 'state', forIt() ? { phase: st.phase, mode: st.mode } : { phase: 'idle', mode: null })
}
if (typeof window !== 'undefined' && !embedded) {
  window.addEventListener('message', fromTab)
  subs.add(tellTab)
}

// ---------- In a tab of another device's window ----------
// This device's page in a tab of another device's window (embedded: RemoteAgent.jsx there) doesn't
// listen itself, whatever starts it here (the key, the mic button, Ask out loud): that window's page
// does, as it does for the desktop app's key (in the desktop app only the app's own pages may use
// the microphone), and the words come back here, to go where this page would have put them (give).
// That window's page is the computer's showing this device, at its own address there (127.0.0.1 or
// localhost, at another port: only it may frame this page); they talk in messages (above). host: its dictation, once it says it listens for this page; lent:
// the one listening for a press made here, which then has the key's let go, Esc, Enter and the state.
let around = null // { origin, listens, app }: that window's page, once it says it's there
let mirror = { phase: 'idle', mode: null } // how its listening for this page is going
let pending = null // what this page's press was for: { ask, sentence, give }
let pressed = 0
let stated = 0
const aroundAt = (o) => { try { const u = new URL(o); return u.origin === location.origin || (u.protocol === 'http:' && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)) } catch { return false } }
const toHost = (type, more = {}) => { try { window.parent.postMessage({ [MSG]: type, ...more }, around?.origin || '*') } catch { /* gone */ } }
const relayed = {
  press: (at, from) => {
    if (from) pending = from
    mirror = { phase: 'opening', mode: 'hold' }
    const n = ++pressed
    // Nothing back from it (it went): this page isn't left thinking it listens.
    setTimeout(() => { if (pressed === n && stated < n) mirror = { phase: 'idle', mode: null } }, ANSWER_MS)
    // The focus in this tab, which that page asks of a press (a button held here may not move it).
    try { window.focus() } catch { /* it stays where it was */ }
    toHost('press', { at, ...(from ? { target: true, ask: !!from.ask, sentence: from.sentence !== false } : {}) })
  },
  release: (at) => toHost('release', { at }),
  cancel: () => toHost('cancel'),
  finish: () => toHost('finish'),
  state: () => mirror,
}
function fromHost(e) {
  const d = e.data
  if (e.source !== window.parent || !d || typeof d !== 'object' || !FROM_HOST.has(d[MSG]) || !aroundAt(e.origin)) return
  const type = d[MSG]
  // The first time: hello again, in case the first was before that page knew where this one is.
  if (type === 'host') { const first = !around; around = { origin: e.origin, listens: d.listens === true, app: d.app === true }; if (first) toHost('hello'); return }
  if (e.origin !== around?.origin) return
  if (type === 'state') { stated = pressed; mirror = { phase: PHASES.has(d.phase) ? d.phase : 'idle', mode: d.mode === 'free' || d.mode === 'hold' ? d.mode : null }; return }
  const text = typeof d.text === 'string' ? d.text.slice(0, 200_000) : ''
  const put = type === 'give' ? (pending && text ? pending.give(text, Number.isFinite(d.at) ? d.at : Date.now()) : false) : take(text)
  Promise.resolve(put).then((x) => x === true, () => false).then((x) => toHost(type === 'give' ? 'given' : 'took', { id: d.id, put: x }))
}
if (typeof window !== 'undefined' && embedded) {
  window.addEventListener('message', fromHost)
  toHost('hello')
}
const host = () => (around?.listens ? relayed : null)
let lent = null
const hosted = () => (lent && lent.state().phase !== 'idle' ? lent : null)
// ...and there, a press from such a page (its window): for its tab, the words given back to it.
export function lentTarget({ from, give, ask, sentence }) {
  const id = [...boxes].find(([, b]) => b.frame && b.win?.() === from)?.[0] || null
  return { kind: 'frame', id, give, ask: !!ask, sentence: sentence !== false }
}
// Another device's page in the desktop app with nothing around it to listen for it (a window showing
// that device, or a tab of one whose page doesn't listen: dictation off there): the app lets only its
// own pages use this computer's microphone, so it isn't asked. In a window showing that device the
// dictation key works all the same: the app listens for it there (desktop/dictation.js).
const noMic = () => !!machineId && (!!window.bridgeApp?.machine || !!around?.app)

// ---------- Names to spell right (server/dictation.js), kept a minute ----------
let wordsAt = 0
let wordsP = null
function words() {
  if (!wordsP || Date.now() - wordsAt > 60_000) {
    wordsAt = Date.now()
    wordsP = api('/dictation/words').then((w) => ({ names: makeNames(w.terms), heard: w.heard || [] }), () => { wordsAt = 0; return null })
  }
  return wordsP
}
// A name just kept in meeting memory, or taken out (Remember.jsx): asked for again next time.
export const wordsChanged = () => { wordsAt = 0 }

// ---------- Recording ----------
let seq = 0
let rec = null // { pcm, id }
let pressAt = 0
let voiceOk = 0 // when /voice last said voice notes are ready
let lastAudio = null // { blob, target }, to try again

// When a key or pointer event happened, on Date.now()'s clock, not when it's handled: on a busy page
// that can be long after (WebKit holds a key's let go till the page is free), making a tap a hold.
export const eventTime = (e) => Date.now() - Math.max(0, performance.now() - (e?.timeStamp ?? performance.now()))

// The key (or the mic button) going down: starts listening, or ends hands-free listening.
export async function press(target, at = Date.now()) {
  if (paused) return
  // In a tab of another device's window: that window's page listens (above).
  const h = host()
  if (h && (h.state().phase !== 'idle' || (target && target.kind !== 'password'))) {
    lent = h
    h.press(at, target ? { ask: target.kind === 'ask', sentence: target.sentence, give: (text, when) => deliver(target, text, when) } : null)
    return
  }
  lent = null
  if (st.phase === 'listening' || st.phase === 'opening') { if (st.mode === 'free') finish(); return }
  // The last words still being turned into text (or tidied): it says so, rather than a press that
  // does nothing, and the next press once they're in listens as ever.
  if (st.phase === 'working') { if (!st.early) set({ early: true }); return }
  if (!target) { set({ note: t('Click where the words should go, or open an agent, then try again.'), target: null }); return }
  if (target.kind === 'password') { set({ note: t("Can't dictate into a password field."), target: null }); return }
  if (noMic()) {
    set({ target, note: target.kind === 'ask'
      ? t("Another computer's window can't use this computer's microphone, so Ask out loud can't listen here. Hold the dictation key to say it in the message box instead.")
      : t("Another computer's window can't use this computer's microphone. Hold the dictation key instead: the words go where you're typing here.") })
    return
  }
  const id = ++seq
  pressAt = at
  set({ phase: 'opening', mode: 'hold', target, level: 0, levels: QUIET, live: '', since: Date.now(), note: null, setup: null, result: null, retry: false, offer: null })
  words()
  // The model that tidies it, loaded while you talk rather than after.
  if (tidyFor(target)) api('/dictation/tidy/warm', { method: 'POST' }).catch(() => {})
  // Something to install first (whisper.cpp, for a Whisper model)? Then the mic isn't opened: nothing
  // could turn it into text. The speech model only to download is different: you talk now, and
  // what you said is kept and turned into text once it's here (transcribe, below). Asked once in a
  // while, not on every press.
  if (Date.now() - voiceOk > 10 * 60_000) {
    const v = await api('/voice').catch(() => null)
    if (seq !== id) return
    if (v && !v.ready && v.needs !== 'model') { set({ phase: 'idle', setup: v }); return }
    if (v?.ready) voiceOk = Date.now()
  }
  if (!navigator.mediaDevices?.getUserMedia) { set({ phase: 'idle', note: t('Microphone needs HTTPS (open the Tailscale address)') }); return }
  const liveP = liveOk()
  try {
    const stream = await microphone()
    if (seq !== id) { stream.getTracks().forEach((x) => x.stop()); return }
    const live = (await liveP) ? liveSender(id) : null
    const pcm = await startPcm(stream, { onLevel: (level) => { if (seq === id) set({ level, levels: [...st.levels.slice(1 - LEVELS), level] }) }, onPcm: live?.push, every: live ? LIVE_MS : 0 })
    if (seq !== id) { pcm.cancel(); live?.end(); return }
    rec = { pcm, id, live }
    // Listening once the sound comes, not before: till then nothing is recorded, so a let go meanwhile
    // is one before the mic was on (release), and its time starts then. One that never comes is
    // listened to all the same after a while, and says it was too short.
    await Promise.race([pcm.sounding, new Promise((r) => setTimeout(r, SOUND_MS))])
    if (seq !== id) return
    set({ phase: 'listening', since: Date.now() })
    navigator.vibrate?.(15)
  } catch (e) {
    if (seq !== id) return
    // In the desktop app on a Mac: what macOS says, with the way to allow it (or reset it) there.
    const fix = await micRefused(e)
    if (seq !== id) return
    if (fix) { set({ phase: 'idle', setup: fix }); return }
    set({ phase: 'idle', note: e.name === 'NotAllowedError' ? micBlocked() : e.message })
  }
}

// The key let go: held long enough, that's the end; a tap (or let go before the mic was on) keeps
// listening.
export function release(at = Date.now()) {
  const h = hosted()
  if (h) { h.release(at); return }
  if (st.mode !== 'hold' || (st.phase !== 'opening' && st.phase !== 'listening')) return
  if (st.phase === 'opening' || at - pressAt < HOLD_MS) set({ mode: 'free' })
  else finish()
}

export function cancel() {
  const h = hosted()
  if (h) { h.cancel(); return }
  seq++
  rec?.pcm.cancel()
  rec?.live?.end()
  rec = null
  set({ phase: 'idle', mode: null, level: 0, note: null, setup: null })
}
export const dismiss = () => set({ note: null, setup: null, retry: false, result: null })

// Stop listening, turn it into text, put it where it goes.
export async function finish() {
  const h = hosted()
  if (h) { await h.finish(); return }
  if (st.phase === 'opening') { cancel(); return }
  if (st.phase !== 'listening' || !rec) return
  const { pcm, id, live } = rec
  rec = null
  const target = st.target
  set({ phase: 'working', level: 0 })
  navigator.vibrate?.(10)
  // No more live words: what was heard so far stays up while the whole of it is turned into text.
  live?.end()
  const samples = await pcm.stop()
  if (seq !== id) return
  if (samples.length < RATE * 0.3) { set({ phase: 'idle', note: t('Recording too short') }); return }
  lastAudio = { blob: wav(samples), target }
  await transcribe(id)
}
// The last recording again: after the computer couldn't turn it into text, or once the speech model
// it needed is here (the setup panel's onReady).
export async function retry() {
  if (!lastAudio || st.phase !== 'idle') return
  const id = ++seq
  set({ phase: 'working', target: lastAudio.target, note: null, retry: false, setup: null })
  await transcribe(id)
}
async function transcribe(id) {
  const { blob, target } = lastAudio
  try {
    const res = await fetch(apiUrl('/transcribe'), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob })
    const data = await res.json().catch(() => ({}))
    if (seq !== id) return
    // Not set up yet (the speech model to download, or whisper.cpp to install): the setup panel, in
    // the server's words, and what you said kept for when it's ready.
    if (res.status === 409 && /^needs-/.test(data.code || '')) {
      const v = await api('/voice').catch(() => ({}))
      if (seq !== id) return
      set({ phase: 'idle', mode: null, setup: { ...v, ask: data.error, audio: true } })
      return
    }
    if (!res.ok) throw Object.assign(new Error(data.error || t('Transcription failed')), { said: data.error })
    const w = await words()
    const text = clean(data.text, { cleanup: cfg.cleanup !== false, atFiles: cfg.atFiles !== false, sentence: target?.sentence !== false, names: w?.names, heard: w?.heard })
    if (seq !== id) return
    if (!text) { set({ phase: 'idle', note: t('No speech detected') }); return }
    const tidy = tidyFor(target) ? await tidyWords(text, target) : null
    if (seq !== id) return
    const out = tidy?.text || text
    // by: what tidied it; said: what you said, when tidying changed it.
    const said = tidy?.text && tidy.text !== text ? text : null
    const tidied = tidy?.text ? { by: tidy.by || '', ...(said ? { said } : {}) } : tidy ? { untidied: tidy } : {}
    lastAudio = null
    const at = Date.now()
    set({ phase: 'idle', mode: null, result: { text: out, at, ...tidied } })
    const put = await deliver(target, out, at)
    keep(at, target, put, { text: out, raw: data.text, ...(said ? { said, tidiedBy: tidy.by } : {}), ms: Math.round(((blob.size - 44) / 2 / RATE) * 1000) }, blob)
    // (A tab's page answers in a moment: by then you may be saying the next thing.)
    if (seq !== id) return
    if (!put) set({ note: t('Nowhere to put it, so here it is: {text}', { text: out }) })
    else if (target?.kind !== 'hud') offerAnyApp()
  } catch (e) {
    if (seq !== id) return
    voiceOk = 0
    const v = await api('/voice').catch(() => null)
    if (seq !== id) return
    // What the computer said, as it said it (a speech model to download first, say).
    set({ phase: 'idle', mode: null, setup: v && !v.ready ? v : null, retry: true, note: e.said || t("Couldn't transcribe: {error}", { error: e.message }) })
  }
}

// ---------- Tidy what I say (a trial: dictation-cleanup) ----------
// From another app (the dictation window; not for a window of Bridge AI's it listens for, which is
// as if said in Bridge AI), with it on in Settings › Voice › Dictation: the words go to the computer
// to be tidied by a model before they're pasted or sent (server/dictation.js tidy).
// The server gives it a few seconds; this waits a little longer for the answer, then stops waiting
// too. Nothing is lost either way: { text, by } tidied, or { code, error, local } and the words go
// as you said them, the dictation window saying why (Tidy.jsx). null: not tidied, nothing to say
// (the trial was turned off meanwhile).
const TIDY_WAIT = 12_000
export const tidyFor = (target) => cfg.tidy === true && target?.kind === 'hud' && !target.window
async function tidyWords(text, target) {
  set({ tidying: true })
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), TIDY_WAIT)
  try {
    const r = await fetch(apiUrl('/dictation/tidy'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, app: target.app?.name || null }), signal: stop.signal })
    const j = await r.json().catch(() => ({}))
    if (r.ok && j.text) return { text: j.text, by: j.by || null }
    if (r.status === 404 && j.trial) return null
    return { code: j.code || 'failed', error: j.error || `HTTP ${r.status}`, local: j.local || null }
  } catch (e) {
    return stop.signal.aborted ? { code: 'slow', error: null } : { code: 'failed', error: e.message }
  } finally { clearTimeout(timer) }
}

// ---------- Live words while you talk (server/livewords.js) ----------
// Where they can work (a sherpa-onnx model downloaded, this computer quick enough, not turned off in
// Settings), the sound goes to the computer as it comes, half a second at a time, and what it's
// heard so far comes back, shown while it listens (the pill, the message box's recording bar). One
// piece at a time, the next with whatever came meanwhile. The finished text is still the whole
// recording, heard once you let go (transcribe, above).
// Through the relay (a phone), a second at a time: half as many messages against its allowance.
const LIVE_MS = viaRelay ? 1000 : 500
let liveAt = 0
let liveCan = false
export async function liveOk() {
  if (cfg.liveWords === false) return false
  if (Date.now() - liveAt > 60_000) {
    liveAt = Date.now()
    liveCan = await api('/dictation/live').then((r) => !!r.can, () => false)
  }
  return liveCan
}
let known = null // the names to spell right, once words() has them
function liveSender(id) {
  const sid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  let queue = []
  let sending = false
  let stopped = false
  words()?.then((w) => { known = w })
  const send = async () => {
    if (sending || stopped || !queue.length) return
    sending = true
    const n = queue.reduce((a, c) => a + c.length, 0)
    const body = new Int16Array(n)
    let o = 0
    for (const c of queue) { body.set(c, o); o += c.length }
    queue = []
    try {
      const r = await fetch(apiUrl(`/dictation/live/${sid}`), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: body.buffer })
      const j = await r.json().catch(() => ({}))
      if (stopped || seq !== id) return
      // Can't keep up here (or can't any more): the words come when you let go, as before.
      if (!r.ok || j.live === false) { stopped = true; if (j.why === 'slow') { liveCan = false; liveAt = Date.now() } set({ live: '' }); return }
      if (j.text && (st.phase === 'listening' || st.phase === 'opening')) set({ live: clean(j.text, { cleanup: cfg.cleanup !== false, atFiles: false, sentence: false, names: known?.names, heard: known?.heard }) })
    } catch { stopped = true } finally { sending = false }
    if (queue.length) send()
  }
  return {
    push: (c) => { if (!stopped && seq === id) { queue.push(c); send() } },
    end: () => { if (stopped && !sending) return; stopped = true; fetch(apiUrl(`/dictation/live/${sid}`), { method: 'DELETE' }).catch(() => {}) },
  }
}

// ---------- Kept (Settings › Voice › Dictation History; server/dictations.js) ----------
// Each dictation, with where it went: typed into a message box (its agent), a terminal or another
// box in Bridge AI. The dictation window's are kept as soon as they're heard, with the app they
// were said in, and amended once pasted, sent or copied (amend). With history off, nothing's sent
// to be kept; the recording only with "Keep the recordings too".
const kept = new Map() // the words' time (result.at) -> its id, once kept (a promise)
function keep(at, target, put, said, blob) {
  if (cfg.history === false) return
  const body = { ...said, how: null }
  const tab = target?.id ? boxes.get(target.id) : null
  if (target?.kind === 'ask' || (target?.kind === 'frame' && target.ask)) { if (put) { body.how = 'sent'; body.agent = { id: target.id, chief: true } } } else if (target?.kind === 'hud') { if (target.app) body.app = target.app } else {
    // Put nowhere (what it was for had gone): kept all the same, as said in Bridge AI.
    if (put) body.how = 'typed'
    // Another device's agent: by the name its tab has here (this device doesn't know it).
    if (put && (target.kind === 'composer' || (target.kind === 'frame' && tab))) body.agent = { id: target.id, ...(tab?.name ? { name: tab.name } : {}) }
    else body.place = target?.kind === 'terminal' ? 'terminal' : 'field'
  }
  const p = api('/dictations', { method: 'POST', body }).then(async (r) => {
    if (!r?.kept) return null
    if (cfg.keepAudio === true && blob) await fetch(apiUrl(`/dictations/${encodeURIComponent(r.id)}/audio`), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob }).catch(() => {})
    return r.id
  }, () => null)
  kept.set(at, p)
  for (const k of kept.keys()) if (kept.size > 8) kept.delete(k)
}
// What became of the words (result: s.result): { how, agent }, and text when you edited them on the
// dictation window's card before they went.
export async function amend(result, patch) {
  const id = await kept.get(result?.at)
  if (id) await api(`/dictations/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }).catch(() => {})
}
// Not kept after all: what was said into a password field.
export async function forget(result) {
  const id = await kept.get(result?.at)
  kept.delete(result?.at)
  if (id) await api(`/dictations/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
}

// ---------- The agent you looked at last ----------
// For the dictation window's "the agent I looked at last" (Hud.jsx), from whichever window it was in:
// this device's, one showing another device (/m/<id>/), or another device's agent in a tab here.
// Each window says which is on screen while it has the focus (Dictation.jsx). { machine: that
// device's id on this one (null: this one), pane, name, at }. A window of the desktop app showing
// another device is that device's page, at its own port, whose saved state the dictation window
// can't read: it tells the app too, which says which device it is (desktop/dictation.js), and the
// dictation window takes whichever was looked at last (latest).
export const lookAt = (l) => {
  if (!l?.pane) return
  store.set('cc-looked', { machine: l.machine || null, pane: l.pane, name: l.name || '', at: Date.now() })
  window.bridgeApp?.looking?.({ pane: l.pane, name: l.name || '' })
}
export const lookedAt = () => store.get('cc-looked', null)
export const latest = (...ls) => ls.filter((l) => l?.pane && Number.isFinite(l.at)).sort((a, b) => b.at - a.at)[0] || null

// ---------- The key from any app ----------
// Off until you say yes (shared/dictation/platform.js). In the desktop app, where this computer lets
// it be heard from other apps, the first words that land in Bridge AI ask once; either answer is
// kept, and Settings › Voice changes it.
let offered = false
async function offerAnyApp() {
  const app = window.bridgeApp
  if (offered || cfg.background != null || !app?.dictateStatus) return
  offered = true
  const s = await app.dictateStatus().catch(() => null)
  if (!s?.mode || st.phase !== 'idle' || st.note || st.setup) return
  set({ offer: s })
}
export async function answerOffer(yes) {
  const was = st.offer
  set({ offer: null })
  cfg = { ...cfg, background: yes }
  await api('/settings', { method: 'PATCH', body: { dictation: { background: yes } } }).then(settingsChanged, () => {})
  if (!yes || !was) return
  const s = await window.bridgeApp?.dictateConfigure?.(cfg).catch(() => null)
  if (s?.taken) set({ note: t('{key} is taken by another app. Pick another key in Settings › Voice.', { key: keyLabel(s.key, keysPlatform()) }) })
}
