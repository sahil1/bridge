// A link to Bridge AI with ?early=<code>, sent to a tester: the code is kept here and taken off the
// address (so a reload or a bookmark doesn't carry it), and Settings › About & Updates opens with
// it filled in, for the tester to Join (settings/About.jsx). The desktop app has no address bar;
// there it's pasted.
let held = null
export function takeEarlyLink() {
  const q = new URLSearchParams(location.search)
  const code = q.get('early')
  if (!code) return false
  held = code.trim()
  q.delete('early')
  try { history.replaceState(history.state, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`) } catch { /* kept as it was */ }
  return true
}
// The code from the link, once.
export const earlyFromLink = () => { const c = held; held = null; return c }
