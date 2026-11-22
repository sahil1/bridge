// The built app's line between its own server and anything else that answers at its address (a
// program on 127.0.0.1:<port> once the server has gone, say). Kept apart from main.js so the tests can
// run it. In a built app, until the server has proved it's the one the app started (windowauth.js
// proof), nothing the app has goes to it or comes from it:
//   request  every request any of the app's windows makes to the server's address, its port or a
//            computer's at its own (its pages, their scripts, its API, a WebSocket: a terminal, a
//            reload, a new window: popouts, a device's window, the floating card, the capture
//            window, dictation's): refused while it isn't proven. A page itself (a main frame: a
//            window opening, a reload, a navigation) is held until the server proves itself again,
//            then let through or refused; refused, main.js shows the main window a page saying why
//            and opens any other again once the server has proved itself.
//   alias    another name for this computer at one of those ports (localhost, [::1], 0.0.0.0, …):
//            refused outright, from source too. The app's server is only ever at 127.0.0.1, and
//            another program can listen at the others while it does.
//   feed     what the app's feed says (the fleet, Remote Screen's events, an ask to allow something):
//            acted on only while it's proven.
//   proven   for senders.js: no message from a page of that address, and no permission (the
//            microphone, a screen) for one, while it isn't.
// A proof that gets no answer in time (a busy start, a Mac waking up, a server held up) says nothing
// either way: it's tried again for a while (patience) before the server counts as not proven, and
// even then it isn't taken for another program's (wrong: only an answer without the secret is).
// From source (bundled false) the server is checked another way (windowauth.js hello), and nothing
// here holds anything back but the aliases.
const VERDICTS = new Set(['ok', 'wrong', 'slow', 'down'])
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

// What's at the app's address, by any way a window reaches it (a page, its API, a WebSocket): ports()
// lists its server's ports and each linked computer's (machines.json). isServer: 127.0.0.1 at one of
// them. isAlias: another name for this computer at one of them (localhost or a name under it, [::1]
// or any IPv6 address, 0.0.0.0, the rest of 127.x), which is never the app's.
const REACH = new Set(['http:', 'https:', 'ws:', 'wss:'])
function addresses(ports) {
  const at = (u) => {
    try {
      const x = new URL(String(u))
      if (!REACH.has(x.protocol)) return null
      const port = Number(x.port || (x.protocol === 'https:' || x.protocol === 'wss:' ? 443 : 80))
      return ports().includes(port) ? x.hostname.toLowerCase() : null
    } catch { return null }
  }
  const alias = (h) => h !== '127.0.0.1' && (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h.startsWith('[') || /^127\.\d+\.\d+\.\d+$/.test(h))
  return {
    isServer: (u) => at(u) === '127.0.0.1',
    isAlias: (u) => { const h = at(u); return !!h && alias(h) },
  }
}
// The address patterns a session's requests are all seen through (any host, any port), each decided
// by request(): the rest go on as they are.
const ALL = ['http', 'https', 'ws', 'wss'].map((s) => `${s}://*/*`)
// A navigation of a window's page started by a frame in it (a project's app in Preview, another
// computer's agent: Electron's will-navigate details, initiator), or by one gone since (no initiator):
// never let through (as main.js's windows have it).
const byFrame = (e) => { try { return !e?.initiator || !!e.initiator.parent } catch { return true } }

// isServer(url), isAlias(url): what's at the server's address, and at another name for it. prove():
// one proof, 'ok' | 'wrong' | 'slow' | 'down' (true and false for 'ok' and 'wrong'). patience: the
// waits between proofs that weren't answered in time (each waits 3 s for its answer: about 15 s).
function create({ bundled, isServer, isAlias = () => false, prove, patience = [500, 1000, 2000], wait = pause }) {
  let proven = false
  let last = null
  let proving = null
  const back = new Set()
  const once = () => Promise.resolve().then(prove).then((v) => (v === true ? 'ok' : VERDICTS.has(v) ? v : 'wrong'), () => 'down')
  // One proof at a time: everything waiting on it hears the same answer.
  const check = () => (proving ||= (async () => {
    let v = await once()
    for (const ms of patience) {
      if (v !== 'slow') break
      await wait(ms)
      v = await once()
    }
    const was = proven
    last = v
    proven = v === 'ok'
    if (proven && !was) for (const fn of back) { try { fn() } catch { /* the next one still hears */ } }
    return proven
  })().finally(() => { proving = null }))
  return {
    get proven() { return !bundled || proven },
    set(v) { proven = !!v },
    check,
    // How the last proof went (null before the first): 'wrong' is the only one that's another program's.
    get last() { return last },
    wrong: () => last === 'wrong',
    // fn() each time the server has proved itself after it hadn't (main.js opens held windows again).
    onProven(fn) { back.add(fn) },
    // Electron's webRequest.onBeforeRequest details ({ url, resourceType }): { cancel }.
    async request(d) {
      try {
        if (isAlias(d.url)) return { cancel: true }
        if (!bundled || !isServer(d.url)) return { cancel: false }
        if (d.resourceType === 'mainFrame') return { cancel: !(await check()) }
        return { cancel: !proven }
      } catch { return { cancel: bundled } }
    },
    // Whether a failed page load at url was one held back here (ERR_BLOCKED_BY_CLIENT).
    blocked: (code, url) => code === -20 && (isAlias(url) || (bundled && isServer(url))),
    feed: () => !bundled || proven,
  }
}

// The gate in Electron, as main.js has it (and the tests, the same way): every request the session's
// windows make through request() (then after(details, answer), before it goes); a frame never sends
// its window anywhere; and a page held back, said to blocked(webContents, url).
function wire(gate, { session, app, after = () => {}, blocked = () => {} }) {
  session.webRequest.onBeforeRequest({ urls: ALL }, (d, cb) => {
    gate.request(d).then((r) => { try { after(d, r) } catch { /* it still goes as decided */ } cb(r) })
  })
  app.on('web-contents-created', (_e, wc) => {
    if (wc.session === session) wc.on('will-navigate', (e) => { if (byFrame(e)) e.preventDefault() })
    wc.on('did-fail-load', (_ev, code, _desc, url, isMain) => { if (isMain && gate.blocked(code, url)) blocked(wc, url) })
  })
}

module.exports = { create, addresses, wire, byFrame, ALL }
