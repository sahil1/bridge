// Whether this page is on its way out: a link followed, a reload, the window switched to another of
// your computers. WebKit (Safari, the iPhone app) stops what the page is still fetching the moment it
// starts to go, well before it's gone, so a view whose code was still coming fails then. That's no
// crash: nothing should show it or write it down (ErrorBoundary.jsx). Such a failure waits instead
// (whenStaying): it goes with the page, or, if the page stays after all (a download, Stay on "Leave
// this page?", a navigation that never came), it's handled as any other as soon as the page is used
// again, or a little while after.
// Code still coming as the page went that nothing was waiting on (a library loading its own parts
// ahead, as Excalidraw does its file pickers when a whiteboard opens) fails the same way, as a
// rejection no one handles: not reported then, and reported as any other if the page stays.
const STAY_MS = 10000
const CUT_OFF = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS/
let leaving = false
let timer = null
let waiting = []
function stayed() {
  if (!leaving) return
  leaving = false
  clearTimeout(timer)
  const go = waiting
  waiting = []
  for (const f of go) f()
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { leaving = true; clearTimeout(timer); timer = setTimeout(stayed, STAY_MS) })
  // Back from the browser's back-forward cache: here after all.
  window.addEventListener('pageshow', (e) => { if (e.persisted) stayed() })
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, stayed, true)
  window.addEventListener('unhandledrejection', (e) => {
    if (!leaving || !CUT_OFF.test(String(e.reason?.message ?? e.reason))) return
    e.preventDefault()
    waiting.push(() => { Promise.reject(e.reason) })
  })
}
export const isLeaving = () => leaving
// fn now, or, while the page is going, once it's clear it stays (never, if it goes).
export function whenStaying(fn) {
  if (leaving) waiting.push(fn)
  else fn()
}
