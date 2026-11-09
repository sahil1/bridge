// What a page of Bridge AI's passes to one it opens at another address. Another of your devices' pages
// are each at one of their own on this computer (shared/machinehost.js), which shares nothing with
// this computer's page, not even what's saved in the browser, so the address carries it after its #,
// which never leaves the browser:
//   to another device's page, the look you picked, °F or °C, the top bar's pins and the language, the
//     same in every device's window as before (layout.jsx SHARED);
//   to any page, that this window switched to open something there, for the line saying so with the
//     way back (Machines.jsx).
// Taken here, before anything reads them (main.jsx imports this first), and the # put back as it was.
import { machineOfHost } from '../shared/machinehost.js'

const PREFS = ['cc-appearance', 'cc-theme', 'cc-unit', 'cc-pins', 'cc-lang']
const BACK = 'cc-switched'
// The # for such an address: prefs for another device's page; back, the switch (Machines.jsx).
export function passOn({ prefs = false, back = null } = {}) {
  const q = new URLSearchParams()
  if (prefs) {
    const o = {}
    for (const k of PREFS) { try { const v = localStorage.getItem(k); if (v != null) o[k] = v } catch { /* no storage */ } }
    q.set('bridge-prefs', JSON.stringify(o))
  }
  if (back) q.set('bridge-back', JSON.stringify(back))
  return q.size ? `#${q}` : ''
}

if (typeof location !== 'undefined' && /bridge-(prefs|back)=/.test(location.hash)) {
  const q = new URLSearchParams(location.hash.slice(1))
  const json = (k) => { try { const v = JSON.parse(q.get(k) || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null } catch { return null } }
  // Only another device's page takes the look: this computer's keeps its own.
  const prefs = machineOfHost(location.host) ? json('bridge-prefs') : null
  for (const k of PREFS) {
    if (typeof prefs?.[k] === 'string' && prefs[k].length < 4000) { try { localStorage.setItem(k, prefs[k]) } catch { /* no storage */ } }
  }
  const b = json('bridge-back')
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null)
  if (b && Number.isFinite(b.at)) { try { sessionStorage.setItem(BACK, JSON.stringify({ from: s(b.from, 20), name: s(b.name, 80), to: s(b.to, 20), what: s(b.what, 120), at: b.at })) } catch { /* no storage */ } }
  q.delete('bridge-prefs')
  q.delete('bridge-back')
  try { history.replaceState(history.state, '', `${location.pathname}${location.search}${q.size ? `#${q}` : ''}`) } catch { /* kept as it was */ }
}
