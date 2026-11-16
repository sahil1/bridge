import { useEffect } from 'react'
import { api, viaRelay, machineId, cloudOnly, relayComputers } from './api.js'

// Your computer moved to another relay (Bridge AI's, or your own Cloudflare's) while this phone was
// away, and the phone reached it at the address it left: the computer stays connected there for two
// weeks after a move, and tells each phone that comes, sealed, where it is now. A phone page from
// before that word doesn't know it (the phone apps bring their own copy of the page), so Bridge AI,
// which comes from the computer, moves the phone itself, at the next quiet moment: it asks the
// computer where it is now (/api/relay/move: only for this phone, over the encrypted link) and has
// the page follow it (bridgeRelay.move), or, where the page can't, does what the page would: the
// iPhone app takes its pairing to the new address, key and all; the Android app and a browser keep a
// key per address, so they pair there again, as the same device, with a code made for this phone
// alone (one tap). Once there, the app lets go of the address it left (left).
const origin = (u) => { try { return new URL(u).origin } catch { return null } }
// Nothing under way that moving would cut short: a field being typed in, a dialog, a recording.
const busy = () => {
  const el = document.activeElement
  const typing = !!el && el !== document.body && (el.isContentEditable || (/^(TEXTAREA|INPUT)$/.test(el.tagName) && !!el.value))
  return typing || !!document.querySelector('[role="dialog"], [aria-modal="true"], .rec-pill')
}

// The relay the phone page reaches this computer through.
function pageRelay() {
  try {
    const p = window.parent
    if (typeof p.bridgeRelay?.relay === 'function') return p.bridgeRelay.relay()
    return p.bridgeNative?.relay || p.location.origin
  } catch { return null }
}

function follow(m, from) {
  const p = window.parent
  if (typeof p.bridgeRelay?.move === 'function') return p.bridgeRelay.move(m)
  const native = p.bridgeNative?.post ? p.bridgeNative : null
  if (native) {
    // As the iPhone app's own page does: its pairing kept under the new address, the old one let
    // go, and the app opened there.
    const keep = native.pairing
    native.post({ type: 'relay', url: m.url })
    if (keep) native.post({ type: 'keep', pairing: keep })
    if (m.name) native.post({ type: 'name', name: m.name })
    native.post({ type: 'forget', url: from })
    native.post({ type: 'switch', url: m.url })
    return
  }
  if (!m.link) return
  if (typeof p.bridgeAndroid?.pair === 'function') return p.bridgeAndroid.pair(m.link)
  window.top.location.href = m.link
}

let going = false
let asking = null
export function checkMoved() {
  if (!viaRelay || machineId || cloudOnly || going) return
  if (document.documentElement.classList.contains('bridge-saved')) return // what the phone kept: not the computer's word
  return (asking ||= ask().finally(() => { asking = null }))
}
async function ask() {
  const st = await api('/relay').catch(() => null)
  if (!st) return
  // Moved here from an address the app still lists: it lets go of that one.
  if (st.left && relayComputers) {
    try { if (relayComputers.list().some((c) => c.relay === st.left && !c.current)) await relayComputers.forget(st.left) } catch { /* next time */ }
  }
  const from = origin(pageRelay())
  const to = st.url ? origin(st.url) : null
  if (!from || !to || from === to || busy()) return
  going = true
  try {
    follow(await api('/relay/move', { method: 'POST' }), from)
  } catch { going = false }
}

// Asked soon after Bridge AI opens, when it's back on the screen or the link is (bridge-settings,
// and the phone page's bridgeFresh.check: src/fresh.js), and every few minutes.
export function useRelayMove() {
  useEffect(() => {
    if (!viaRelay || machineId || cloudOnly) return
    const check = () => { if (!document.hidden) checkMoved() }
    const first = setTimeout(check, 3000)
    const every = setInterval(check, 3 * 60 * 1000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('bridge-settings', check)
    window.addEventListener('online', check)
    return () => {
      clearTimeout(first); clearInterval(every)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('bridge-settings', check)
      window.removeEventListener('online', check)
    }
  }, [])
}
