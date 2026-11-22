// The built app's line between its own server and anything else that answers at its address (a
// program on 127.0.0.1:<port> once the server has gone, say). Kept apart from main.js so the tests can
// run it. In a built app, until the server has proved it's the one the app started (windowauth.js
// proves), nothing the app has goes to it or comes from it:
//   request  every request any of the app's windows makes to the server's address (its pages, their
//            scripts, its API, a reload, a new window: popouts, a device's window, the floating card,
//            the capture window, dictation's): refused while it isn't proven. A page itself (a main
//            frame: a window opening, a reload, a navigation) is held until the server proves itself
//            again, then let through or refused; refused, main.js shows the main window a page saying
//            why and closes any other.
//   feed     what the app's feed says (the fleet, Remote Screen's events, an ask to allow something):
//            acted on only while it's proven.
//   proven   for senders.js: no message from a page of that address, and no permission (the
//            microphone, a screen) for one, while it isn't.
// From source (bundled false) the server is checked another way (windowauth.js hello), and nothing
// here holds anything back.
function create({ bundled, isServer, prove }) {
  let proven = false
  let proving = null
  // One proof at a time: everything waiting on it hears the same answer.
  const check = () => (proving ||= Promise.resolve().then(prove).then((v) => { proven = !!v; return proven }, () => { proven = false; return false }).finally(() => { proving = null }))
  return {
    get proven() { return !bundled || proven },
    set(v) { proven = !!v },
    check,
    // Electron's webRequest.onBeforeRequest details ({ url, resourceType }): { cancel }.
    async request(d) {
      if (!bundled || !isServer(d.url)) return { cancel: false }
      if (d.resourceType === 'mainFrame') return { cancel: !(await check()) }
      return { cancel: !proven }
    },
    // Whether a failed page load at url was one held back here (ERR_BLOCKED_BY_CLIENT).
    blocked: (code, url) => bundled && code === -20 && isServer(url),
    feed: () => !bundled || proven,
  }
}

module.exports = { create }
