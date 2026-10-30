// The phone app's side of Cloud agents. The app keeps the keys (Android Keystore, iPhone
// Keychain) and makes every request to a provider itself, adding the key, so no key is ever in
// this page: it can save, test or remove one and learn whether one is set (and its last 4
// characters), nothing more. The app also keeps the agents you started and what the adapters
// remember, per provider, and forgets them with the key.
//
// Android: a message channel only this page's address gets (window.bridgeCloud, a WebView
// WebMessageListener). iPhone: a message handler that answers (webkit.messageHandlers.cloud).
// Tests stand one in as window.bridgeCloudStub(op, args) -> Promise.
//
//   call(op, args) -> Promise of the app's answer. Ops:
//     config                         -> { keys, state, rev, bases?, background }
//     setKey { slot, key }           -> { keys }       slot: a provider, or 'claude.github'
//     copyKey { from, to }           -> { keys }
//     removeKey { slot }             -> { keys }       a provider's key goes with its agents
//     fetch { provider, method, url, headers, body } -> { status, headers, body }
//     save { provider, state }       -> { rev }
//     load                           -> { state, rev }
//     notify { pane, title, body }   (the background check)
//     done                           (the background check is over)
const android = typeof window.bridgeCloud?.postMessage === 'function' ? window.bridgeCloud : null
const ios = window.webkit?.messageHandlers?.cloud || null

let seq = 0
const waiting = new Map()
if (android) {
  android.onmessage = (e) => {
    let m
    try { m = JSON.parse(e.data) } catch { return }
    const w = waiting.get(m.id)
    if (!w) return
    waiting.delete(m.id)
    if (m.error) w.no(new Error(m.error))
    else w.ok(m.result)
  }
}

export const inApp = () => !!(window.bridgeCloudStub || ios || android)

export function call(op, args = {}) {
  if (window.bridgeCloudStub) return window.bridgeCloudStub(op, args)
  if (ios) return ios.postMessage({ op, ...args })
  if (android) {
    return new Promise((ok, no) => {
      const id = ++seq
      waiting.set(id, { ok, no })
      android.postMessage(JSON.stringify({ id, op, ...args }))
    })
  }
  return Promise.reject(new Error('Cloud agents on this phone need the Bridge AI app'))
}

// The adapters put the key in a header (shared/cloud). Here they're given a stand-in that says
// which key it is, and this fetch hands the request to the app, which puts the real key in.
const STAND_IN = 'bridge-app-key:'
export const standIn = (slot) => `${STAND_IN}${slot}`
const AUTH = ['authorization', 'x-api-key', 'x-goog-api-key']

export function appFetch(provider) {
  return async (url, init = {}) => {
    const headers = {}
    let slot = provider
    for (const [k, v] of Object.entries(init.headers || {})) {
      const s = String(v)
      if (AUTH.includes(k.toLowerCase())) { const at = s.indexOf(STAND_IN); if (at >= 0) slot = s.slice(at + STAND_IN.length); continue }
      headers[k] = s
    }
    let r
    try {
      r = await call('fetch', { provider: slot, method: init.method || 'GET', url: String(url), headers, body: typeof init.body === 'string' ? init.body : null })
    } catch (e) { throw new TypeError(e.message || 'Network error') }
    if (!r || !r.status) throw new TypeError(r?.error || 'Network error')
    const empty = [204, 205, 304].includes(r.status)
    return new Response(empty ? null : r.body ?? '', { status: r.status, headers: r.headers || {} })
  }
}
