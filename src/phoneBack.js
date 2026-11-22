// Back on a phone: each place the phone's layout shows (its tab, and in it the view More shows, the
// agent the Agents tab has open, the meeting Meetings has open, Home or Everything) is an entry in
// the browser's history, so the system's Back (the Android app's, the browser's, an iPhone's swipe
// in the app) shows the place before, and leaves Bridge AI only from the first. A computer's layout
// has its own Back and Forward (backForward.js), which this leaves alone.
//
// App.jsx says what's on screen (seen) and shows a place again (show). A place that stays a moment
// is a step. What the window opens at, and what moves by itself as it opens or as a place is shown
// again (a tab that redirects), with nothing pressed since, is the step it's on, not a new one. The
// page's own ways back (‹ Bots, ‹ More) say so first (backward), and going to the place just before
// is then going back to it, as Back would, so Back afterwards doesn't show what was left.

const KEY = 'bridgePhone'
const OPENING = 1500 // what the window opens at, and what it moves to by itself as it does
const SETTLE = 200 // a place is a step once it has stayed a moment (opening one can take a few renders)
const AFTER = 700 // a place shown again by Back: what it moves to by itself is that step
const BACKWARD = 1500 // how long a way back in the page counts for the change it makes
let on = false
let hooks = {}
let startedAt = 0
let shownAt = 0
let inputAt = 0 // the last press or key: what changes after it is someone's doing, not by itself
let backAt = 0 // the last way back pressed in the page
let timer = 0
let steps = [] // each step's key, by its place in this page's history (n)
let at = 0
const mine = (s) => (s && typeof s === 'object' && s[KEY] && typeof s[KEY].key === 'string' ? s[KEY] : null)
const onInput = () => { inputAt = Date.now() }

function put(how, place, key) {
  try {
    if (how === 'push') {
      window.history.pushState({ [KEY]: { place, key, n: at + 1 } }, '')
      at += 1
      steps = steps.slice(0, at)
    } else {
      const was = window.history.state && typeof window.history.state === 'object' ? window.history.state : {}
      window.history.replaceState({ ...was, [KEY]: { place, key, n: at } }, '')
    }
    steps[at] = key
  } catch { /* history not ours to change */ }
}

function arrive(e) {
  const s = mine(e.state)
  if (!s) return
  clearTimeout(timer)
  shownAt = Date.now()
  at = Number.isInteger(s.n) ? s.n : at
  steps[at] = s.key
  hooks.show?.(s.place)
}

export function start(h) {
  hooks = h
  if (on) return
  on = true
  startedAt = Date.now()
  const s = mine(window.history.state)
  at = s && Number.isInteger(s.n) ? s.n : 0
  steps = []
  if (s) steps[at] = s.key
  window.addEventListener('popstate', arrive)
  window.addEventListener('pointerdown', onInput, true)
  window.addEventListener('keydown', onInput, true)
}

export function stop() {
  if (!on) return
  on = false
  clearTimeout(timer)
  window.removeEventListener('popstate', arrive)
  window.removeEventListener('pointerdown', onInput, true)
  window.removeEventListener('keydown', onInput, true)
}

// A way back in the page pressed (‹ Bots, ‹ More): the change it makes goes back to the place
// before, when that's where it leads.
export function backward() { backAt = Date.now() }

// What's on screen now: place (what show is given back), key (it as a string).
export function seen(place, key) {
  if (!on || !key || key === steps[at]) return
  clearTimeout(timer)
  const now = Date.now()
  const opening = now - startedAt < OPENING && inputAt < startedAt
  const redirect = now - shownAt < AFTER && inputAt < shownAt
  if (!mine(window.history.state) || opening || redirect) { put('replace', place, key); return }
  timer = setTimeout(() => {
    if (!on || key === steps[at]) return
    if (Date.now() - backAt < BACKWARD && at > 0 && steps[at - 1] === key) {
      backAt = 0
      try { window.history.back(); return } catch { /* push it instead */ }
    }
    put('push', place, key)
  }, SETTLE)
}
