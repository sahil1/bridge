import { useSyncExternalStore } from 'react'
import { store } from './components/layout.jsx'
import { tx } from './i18n/index.js'

// What's pinned to the desktop's top bar (App.jsx), beside its three places that are always there
// (which computer, search, what's happening now). Each of these is in the Status menu always
// (StatusMenu.jsx), and in the bar too while it's pinned: a pin on its row there, or Settings ›
// Appearance › In the Top Bar, changes it. Updates covers both an update to install and Updated,
// this window to reload after one.
//
// Kept as the look you picked is (appearance.js): in this browser or the app, on this computer, the
// same in every device's window (SHARED in layout.jsx). Not on the computer's settings, as
// notification sounds are (alertSounds, so your phones hear of it): what fits in your top bar is a
// choice for this screen, not for your other devices. Only what you changed is saved, so anyone who
// hasn't chosen gets the defaults as they are now.
export const KEY = 'cc-pins'
export const PINS = [
  { id: 'weather', label: tx('Weather'), hint: tx('The temperature now; °F or °C as picked in Status') },
  { id: 'clock', label: tx('Clock'), hint: tx('The time, with the date on hover') },
  { id: 'usage', label: tx('Usage'), hint: tx('How much of your plan is left, and the account new agents start on') },
  { id: 'update', label: tx('Updates'), hint: tx('A new version to install, and Reload after one') },
  { id: 'restart', label: tx('Restart to apply'), hint: tx('Something you allowed that needs a restart') },
  { id: 'setup', label: tx('Setup'), hint: tx('How far setup is, and when it needs you') },
  { id: 'sounds', label: tx('Notification sounds'), hint: tx('The speaker, to silence notifications or turn them back on') },
]
// As the bar was before the Status menu (3.9), less the speaker: a switch set once and left.
export const DEFAULTS = { weather: true, clock: true, usage: true, update: true, restart: true, setup: true, sounds: false }

const saved = () => { const s = store.get(KEY, {}); return s && typeof s === 'object' && !Array.isArray(s) ? s : {} }
let current = null
const subs = new Set()
export const getPins = () => current || (current = { ...DEFAULTS, ...saved() })
export function setPin(id, on) {
  store.set(KEY, { ...saved(), [id]: !!on })
  current = null
  subs.forEach((fn) => fn())
}
export const usePins = () => useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn) }, getPins)
// Changed in another window of the app: here too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return
    current = null
    subs.forEach((fn) => fn())
  })
}
