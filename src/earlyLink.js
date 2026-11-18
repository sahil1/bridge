// A link to Bridge AI with ?early= (sent to testers, once with a code in it, which is no longer
// needed): taken off the address, so a reload or a bookmark doesn't carry it, and Settings opens at
// About & Updates' Update Channel, where Early Access is picked with no code (App.jsx). The desktop
// app has no address bar.
export function takeEarlyLink() {
  const q = new URLSearchParams(location.search)
  if (!q.has('early')) return false
  q.delete('early')
  try { history.replaceState(history.state, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`) } catch { /* kept as it was */ }
  return true
}
