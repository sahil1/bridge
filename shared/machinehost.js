// Another of your computers' pages, as this one shows them on this computer (its desktop app, or a
// browser here): each at an address of its own, m-<its id in hex>.localhost on this computer's port.
// Browsers take any name under localhost for this computer and for another site than this computer's
// own page (127.0.0.1), so such a page can't reach into this one's page, the desktop app's powers
// there, or this computer's API (server/machinepages.js says what it may ask of it). Its path stays
// /m/<id>/..., as everywhere else: through a phone, Tailscale or another name for this computer there
// are no such addresses, and it's shown at /m/<id>/ beside this computer's page as before.
// In hex because a name is the same in any capitals and ids aren't (desktop/senders.js has a copy).
export const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const ID = /^[A-Za-z0-9_-]{1,20}$/
const hex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
export const machineHost = (id) => (ID.test(String(id)) ? `m-${hex(String(id))}.localhost` : null)
// The id a host (with or without its port) is the address of, or null.
export function machineOfHost(host) {
  const m = /^m-((?:[0-9a-f]{2}){1,20})\.localhost(?::\d+)?$/i.exec(String(host || ''))
  if (!m) return null
  const id = m[1].toLowerCase().match(/../g).map((h) => String.fromCharCode(parseInt(h, 16))).join('')
  return ID.test(id) ? id : null
}
export const machineOrigin = (id, port) => `http://${machineHost(id)}${port ? `:${port}` : ''}`
// A page at one of this computer's own addresses, its own or another computer's: the window is on the
// computer in front of you (Show in Finder, "this computer", Preview at localhost).
export const atThisComputer = (hostname) => LOOPBACK.has(hostname) || !!machineOfHost(hostname)
// This computer's own page, from one of those (the address the app and `npm start` give it).
export const hostOrigin = (port) => `http://127.0.0.1${port ? `:${port}` : ''}`
