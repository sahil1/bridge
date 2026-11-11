import { useSyncExternalStore } from 'react'

// Back and Forward, as a browser's or Finder's (a beta feature, on unless it's turned off in
// Settings › About & Updates › Beta Features). Each place you go in this window is a step: a view
// or an agent's tab and what it shows (Chat, Terminal, Files, Changes; Meetings' Memory; the folder
// Files is in), a section of Settings, Today full size. ‹ and › at the start of the top bar go back
// and forward through them (held or right-clicked: the places, to pick one), and so do ⌘[ and ⌘]
// on a Mac (Alt+← and Alt+→ elsewhere) while you're not typing, the mouse's back and forward
// buttons, the browser's own Back and Forward, and in the desktop app the mouse's buttons on Windows
// and a swipe on a Mac's trackpad (desktop/main.js, as bridge-nav). Each step is an entry in the
// browser's history too (pushState), so all of them go the same way, through popstate. Going back
// shows the place again as it was (the view at its scroll), runs nothing again, and passes over a
// place whose tab was closed. Only on a computer's layout: a phone has its own way around (its
// tabs), and the phone apps the system's Back.
//
// App.jsx says what's on screen (seen) and shows a place again (show); the views say where they are
// inside themselves (sayPlace).

const S = Math.random().toString(36).slice(2) // this page's own steps, not those of before a reload
const SETTLE = 250 // a place is a step once it has stayed a moment (opening one can take a few renders)
const OPENING = 1500 // what the window opens at, and what it moves to by itself as it does, is its first step
let on = false
let startedAt = 0
let touched = false // a key pressed or a click since: what changes now is yours
let hooks = {}
let steps = [] // { key, place, label, icon, scroll }
let at = -1
let headed = null // the step the browser is on its way to (history.go), until popstate says it's there
let going = null // the step being shown again, until what's on screen settles
let pending = null // what's on screen, until it has stayed a moment
let goingTimer = 0
let last = null // the last back or forward from a mouse button, the desktop app or a swipe
let mouseTimer = 0
const subs = new Set()
let version = 0
const changed = () => { version++; for (const f of subs) f() }

// ---------- where each view is, inside itself ----------
// sayPlace('view:meetings', 'memory'), sayPlace(paneId, 'terminal'), sayPlace('settings', 'about',
// 'Settings › About & Updates'): kept for the place's step, and named so in the list of places.
const inner = new Map()
const innerSubs = new Set()
let innerVersion = 0
export function sayPlace(key, value, label) {
  const was = inner.get(key)
  const v = JSON.stringify(value ?? null)
  if (was && was.v === v && was.label === label) return
  inner.set(key, { value, v, label })
  innerVersion++
  for (const f of innerSubs) f()
}
export const placeOf = (key) => inner.get(key)?.value
export const placeLabel = (key) => inner.get(key)?.label
// For App.jsx, while Back and Forward is on: drawn again when a view says where it is.
export function usePlaces(enabled) {
  return useSyncExternalStore((f) => { innerSubs.add(f); return () => innerSubs.delete(f) }, () => (enabled ? innerVersion : 0))
}
// A view shown again at a step: where it was inside itself, for it to go to (bridge-place-show), or
// to start at as it opens (takePlace, a moment after; asked twice as React checks, the same answer).
const wanted = new Map()
export function showPlaceIn(key, value) {
  wanted.set(key, { value, at: Date.now() })
  window.dispatchEvent(new CustomEvent('bridge-place-show', { detail: { key, value } }))
}
export function takePlace(key) {
  const w = wanted.get(key)
  return w && Date.now() - w.at < 3000 ? w.value : undefined
}
// In a view: fn(value) when it's shown again at a step of its own.
export function onPlaceShow(key, fn) {
  const on = (e) => { if (e.detail?.key === key) { wanted.delete(key); fn(e.detail.value) } }
  window.addEventListener('bridge-place-show', on)
  return () => window.removeEventListener('bridge-place-show', on)
}

// ---------- tabs that took another's place ----------
// A meeting opened from Meetings takes Meetings' tab (a whiteboard Whiteboards', a file Studio's, a
// thread the chief's last one): going back to Meetings shows it in that tab again, as a browser's
// tab goes back. A place's tab, or the open tab that took its place (null: closed since).
const took = new Map() // tab -> the tab that took its place
export const replacedWith = (from, to) => { if (from && to && from !== to) took.set(from, to) }
export function slotOf(id, isOpen) {
  const seen = new Set()
  for (let x = id; x && !seen.has(x); x = took.get(x)) { if (isOpen(x)) return x; seen.add(x) }
  return null
}
// A tab renamed (a whiteboard): its steps follow it.
export function renamedTab(from, to) {
  for (const st of steps) {
    if (st.place.tab !== from && st.place.side !== from) continue
    st.place = { ...st.place, ...(st.place.tab === from ? { tab: to } : {}), ...(st.place.side === from ? { side: to } : {}) }
    st.key = JSON.stringify(st.place)
  }
  if (took.has(from)) { took.set(to, took.get(from)); took.delete(from) }
  for (const [k, v] of took) if (v === from) took.set(k, to)
}

// ---------- the steps ----------
const stamp = (i) => ({ bridgeNav: { s: S, i } })
const keep = (h) => {
  try { if (h === 'push') window.history.pushState(stamp(at), ''); else window.history.replaceState({ ...(window.history.state && typeof window.history.state === 'object' ? window.history.state : {}), ...stamp(at) }, '') } catch { /* history not ours to change */ }
}
const named = (place) => { try { return hooks.describe?.(place) || {} } catch { return {} } }
const usable = (i) => i >= 0 && i < steps.length && (() => { try { return hooks.valid ? hooks.valid(steps[i].place) !== false : true } catch { return false } })()
// The nearest step in a direction that can still be shown (its tab not closed).
const nearest = (from, dir) => { for (let i = from + dir; i >= 0 && i < steps.length; i += dir) if (usable(i)) return i; return null }
const where = () => headed ?? at

// A place said before its view had said where it is inside itself (rough: its code still on the way),
// and then what it said: the same step.
const refines = (a, b) => !!a?.rough && !!a.herdr === !!b.herdr && (a.settings ? !!b.settings : !b.settings && a.tab === b.tab && a.side === b.side && a.max === b.max)

function commit() {
  if (!pending) return
  const { place, key } = pending
  clearTimeout(pending.timer)
  pending = null
  const entry = { key, place, ...named(place) }
  if (going != null && steps[going]) {
    steps[going] = { ...steps[going], ...entry }
    going = null
    clearTimeout(goingTimer)
  } else if (at >= 0 && (steps[at].key === key || refines(steps[at].place, place))) {
    steps[at] = { ...steps[at], ...entry }
  } else if (at < 0 || (at === 0 && !touched && Date.now() - startedAt < OPENING)) {
    steps = [entry]
    at = 0
    keep('replace')
  } else {
    steps = [...steps.slice(0, at + 1), entry]
    at = steps.length - 1
    keep('push')
  }
  changed()
}

// What's on screen now (App.jsx, as it changes): a step once it has stayed a moment.
export function seen(place, key) {
  if (!on) return
  if (pending) clearTimeout(pending.timer)
  else if (at >= 0 && steps[at].key === key && going == null) return
  pending = { place, key, timer: setTimeout(commit, SETTLE) }
  // The first: at once, so a click straight after is a step after it.
  if (at < 0) commit()
}

// Show step i again: the browser goes there (its history is the same steps), and popstate shows it.
export function go(i) {
  if (!on) return
  if (pending) commit()
  const from = where()
  if (i == null || i === from || !usable(i)) return
  headed = i
  try { window.history.go(i - from) } catch { headed = null }
}
export const back = () => { if (on) { if (pending) commit(); go(nearest(where(), -1)) } }
export const forward = () => { if (on) { if (pending) commit(); go(nearest(where(), 1)) } }

function arrive(e) {
  const n = e.state?.bridgeNav
  // The browser's Back after a mouse button: it went itself, so the button's own isn't needed.
  if (mouseTimer) { clearTimeout(mouseTimer); mouseTimer = 0 }
  if (!n || n.s !== S || !steps[n.i]) { headed = null; return }
  if (pending) { clearTimeout(pending.timer); pending = null }
  const i = n.i
  if (i === at) { headed = null; return }
  if (!usable(i)) {
    // A closed tab's step: on past it, the way it was going; back where it was when there's none.
    const t = nearest(i, Math.sign(i - at))
    headed = t ?? at
    try { window.history.go((t ?? at) - i) } catch { headed = null }
    return
  }
  headed = null
  const was = steps[at]
  at = i
  going = i
  clearTimeout(goingTimer)
  // Nothing changed on screen (it was there already): nothing to settle.
  goingTimer = setTimeout(() => { if (going === i) { going = null; changed() } }, 1500)
  try { hooks.show?.(steps[i].place, was?.place) } catch { /* shown as far as it could be */ }
  putScroll(steps[i].scroll)
  changed()
}

// ---------- where each place was scrolled to ----------
// The views, Today and Settings (not an agent's chat or terminal, which keep to their newest), by
// their place on the page, set again once there's that much to scroll.
const KEPT = '.app.wide .work, .app.wide .dock-slot, .modal.settings'
const NOT_KEPT = '.console, .xterm, .ws-tabs, .board, .tab-search'
const pathOf = (el) => {
  const out = []
  for (let e = el; e && e !== document.body; e = e.parentElement) out.unshift(e.parentElement ? [...e.parentElement.children].indexOf(e) : 0)
  return out.join('/')
}
const byPath = (p) => {
  let e = document.body
  for (const n of p.split('/')) { e = e?.children[Number(n)]; if (!e) return null }
  return e
}
let scrollFrame = 0
function onScroll(e) {
  const el = e.target
  if (!on || going != null || pending || at < 0 || el?.nodeType !== 1 || !el.closest(KEPT) || el.closest(NOT_KEPT)) return
  const step = steps[at]
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    if (steps[at] !== step) return
    const path = pathOf(el)
    const rest = (step.scroll || []).filter((x) => x.path !== path)
    step.scroll = el.scrollTop > 0 ? [...rest, { path, cls: el.className, top: el.scrollTop }].slice(-4) : rest
  })
}
function putScroll(list) {
  if (!list?.length) return
  const left = [...list]
  let tries = 0
  const tryNow = () => {
    for (const x of [...left]) {
      const el = byPath(x.path)
      if (el && el.className === x.cls && el.scrollHeight - el.clientHeight >= x.top - 2) { el.scrollTop = x.top; left.splice(left.indexOf(x), 1) }
    }
    if (left.length && ++tries < 8) setTimeout(tryNow, tries * 80)
  }
  requestAnimationFrame(tryNow)
}

// ---------- keys, mouse buttons, the desktop app ----------
const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '')
// Typing (a box, a document, a terminal) or drawing (a whiteboard, where ⌘[ sends a shape back).
const typing = (el) => !!el?.closest?.('textarea, select, [contenteditable]:not([contenteditable="false"]), .xterm, .excalidraw')
  || (el?.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file)$/i.test(el.type || ''))
export const keyDir = (e) => {
  if (e.shiftKey) return null
  if (MAC ? e.metaKey && !e.ctrlKey && !e.altKey : e.altKey && !e.ctrlKey && !e.metaKey) {
    if (MAC ? e.key === '[' || e.code === 'BracketLeft' : e.key === 'ArrowLeft') return 'back'
    if (MAC ? e.key === ']' || e.code === 'BracketRight' : e.key === 'ArrowRight') return 'forward'
  }
  return null
}
export const KEYS = MAC ? { back: '⌘[', forward: '⌘]' } : { back: 'Alt+←', forward: 'Alt+→' }
function onKey(e) {
  const dir = keyDir(e)
  if (!dir || e.defaultPrevented || typing(e.target)) return
  // Taken here even with nowhere to go: the browser's own would leave Bridge AI.
  e.preventDefault()
  if (dir === 'back') back(); else forward()
}
// One press of a mouse's side button can come as the button and as the desktop app's command
// (Windows): the second within a moment is the same press.
function device(dir, from) {
  const now = Date.now()
  if (last && last.dir === dir && last.from !== from && now - last.at < 350) return
  last = { dir, from, at: now }
  if (dir === 'back') back(); else forward()
}
const BUTTONS = { 3: 'back', 4: 'forward' }
function onMouse(e) {
  const dir = BUTTONS[e.button]
  if (!dir) return
  // Not the browser's own, which can't know these steps' places (and would leave Bridge AI from the first).
  e.preventDefault()
  if (e.type !== 'mouseup') return
  // A browser that goes back by itself anyway does so at once (popstate): the button's own is then
  // not needed. The desktop app's page has no Back of its own.
  if (window.bridgeApp) device(dir, 'mouse')
  else { clearTimeout(mouseTimer); mouseTimer = setTimeout(() => { mouseTimer = 0; device(dir, 'mouse') }, 200) }
}
const onApp = (e) => { if (e.detail === 'back' || e.detail === 'forward') device(e.detail, 'app') }
// A click or a key: what was on screen when you did it is a step, however short a moment it was there
// (a step shown again, that step), and what comes of it is the next.
const onTouch = () => {
  touched = true
  if (pending) commit()
  else if (going != null) { going = null; clearTimeout(goingTimer) }
}

// ---------- on and off ----------
// h: { show(place), valid(place), describe(place) → { label, icon } }, from App.jsx.
export function start(h) {
  hooks = h
  if (on) return
  on = true
  startedAt = Date.now()
  touched = false
  steps = []
  at = -1
  window.addEventListener('pointerdown', onTouch, true)
  window.addEventListener('keydown', onTouch, true)
  window.addEventListener('popstate', arrive)
  window.addEventListener('keydown', onKey)
  window.addEventListener('mousedown', onMouse, true)
  window.addEventListener('mouseup', onMouse, true)
  window.addEventListener('bridge-nav', onApp)
  document.addEventListener('scroll', onScroll, true)
  changed()
}
export function stop() {
  if (!on) return
  on = false
  window.removeEventListener('pointerdown', onTouch, true)
  window.removeEventListener('keydown', onTouch, true)
  window.removeEventListener('popstate', arrive)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('mousedown', onMouse, true)
  window.removeEventListener('mouseup', onMouse, true)
  window.removeEventListener('bridge-nav', onApp)
  document.removeEventListener('scroll', onScroll, true)
  if (pending) clearTimeout(pending.timer)
  clearTimeout(goingTimer)
  clearTimeout(mouseTimer)
  pending = null; going = null; headed = null; mouseTimer = 0
  steps = []
  at = -1
  changed()
}

// ---------- for ‹ and › ----------
// Whether there's a step to go back or forward to, and the places each way (nearest first).
const list = (dir) => {
  const out = []
  for (let i = where() + dir; i >= 0 && i < steps.length && out.length < 12; i += dir) if (usable(i)) out.push({ i, label: steps[i].label, icon: steps[i].icon })
  return out
}
let snap = null
let snapAt = -1
export function useNav() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => {
    if (snapAt !== version) { snapAt = version; snap = { on, back: on && nearest(where(), -1) != null, forward: on && nearest(where(), 1) != null } }
    return snap
  })
}
export const places = (dir) => (on ? list(dir === 'back' ? -1 : 1) : [])
// For a tab's closing, the fleet changing, or anything else that changes which steps can be shown.
export const recheck = () => { if (on) changed() }
