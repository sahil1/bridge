// herdr sessions each number their panes from the start (every session has a w1:p1), so what
// Bridge AI keeps per pane (queued messages, muted agents, which account) is filed under the
// session the pane is in: "@work/w1:p1". The built-in runtime and cloud agents have one set of
// panes, filed as they are.
let sessionOf = () => null
// Set by the herdr runtime: the session in view, looked up on each call.
export const useSessions = (fn) => { sessionOf = fn }
const prefix = () => { const s = sessionOf(); return s ? `@${s}/` : '' }
const everywhere = (paneId) => String(paneId).startsWith('cloud:')

export const paneKey = (paneId) => (everywhere(paneId) ? paneId : prefix() + paneId)
// A key of a pane in view: the session in view's own, or one that's the same in every session.
export function inView(k) {
  if (!k.startsWith('@')) return true
  const p = prefix()
  return !!p && k.startsWith(p)
}
export const paneOfKey = (k) => (k.startsWith('@') ? k.slice(k.indexOf('/') + 1) : k)

// Kept from before sessions were told apart: filed under the session in view now, once there is
// one. Returns whether anything moved (so the caller saves).
export function adopt(obj) {
  const p = prefix()
  if (!p) return false
  let moved = false
  for (const k of Object.keys(obj)) {
    if (k.startsWith('@') || everywhere(k)) continue
    obj[p + k] = obj[k]
    delete obj[k]
    moved = true
  }
  return moved
}
