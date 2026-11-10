// Which page something comes from, for the app to decide what it may do (main.js, dictation.js):
//   own      this computer's own page, at the app's address (not another computer's pages, nor a
//            page an agent made at /api/...);
//   machine  another of your computers' page, shown through this one at its own port on this
//            computer (server/machinepages.js, which keeps the ports in machines.json), at /m/<id>/;
//   null     anything else (a data: page, a site, a project's app).
// A message to the app counts only from the main frame of one of its windows: its preload is only
// there, so one from a frame in it (another computer's agent in a tab, a project's app in Preview)
// comes from a page that got past its own. Each channel takes this computer's own page, and the few
// a window showing another computer needs take that too (guard).
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

// What a window showing another computer needs of the app: windows (an agent in one of its own, this
// computer's main one, a device in one of its own), saying what an update would lose in it, and the
// agent it has on screen (for the dictation window). And the Allow access tile's own two, a data:
// page, which check it's the tile.
const MACHINE = ['bridge:popout', 'bridge:focus-main', 'bridge:focus-popout', 'bridge:open-machine', 'bridge:busy-said', 'bridge:looking']
const SELF = ['bridge:tile-drag', 'bridge:tile-close']
// Links out of the app open in their own apps, but only web, mail and Mail's message links: file:,
// smb: and other schemes can mount a network share or start a program.
const OUTSIDE = new Set(['http:', 'https:', 'mailto:', 'message:'])

// port: the app's page's. ports(): each linked computer's, by its id ({ id: port }).
function create(port, { ports = () => ({}) } = {}) {
  const parse = (u) => { try { const x = new URL(u); return x.protocol === 'http:' && LOOPBACK.has(x.hostname) ? x : null } catch { return null } }
  const machineAt = (p) => Object.entries(ports()).find(([, q]) => q === p)?.[0] || null
  // What a page at u is: { kind: 'own' | 'machine', machine } or null.
  const of = (u) => {
    const x = parse(u)
    if (!x) return null
    const p = Number(x.port)
    if (p === port) return /^\/(m|api)\//.test(x.pathname) ? null : { kind: 'own', machine: null }
    const id = machineAt(p)
    return id && x.pathname.startsWith(`/m/${id}/`) ? { kind: 'machine', machine: id } : null
  }
  // Anything this app's server serves, at its port or a computer's: where links and the app's own
  // navigation may go, and copying may come from.
  const local = (u) => { const x = parse(u); return !!x && (Number(x.port) === port || !!machineAt(Number(x.port))) }
  // Where a link a page opens in a new window goes (a target=_blank link, window.open): 'outside',
  // the web, mail and Mail's, each in its own app; 'browser', a file the app's server serves (a
  // picture, a PDF or a page in Files, a chat's attachment), as the app has no window to show it in;
  // null, the app's own pages (its windows open their own way: bridgeApp) and anything else (file:,
  // smb: and other schemes can mount a network share or start a program). at: the page the window
  // shows. This computer's own pages may open any of its files (at /api/... or a computer's
  // /m/<id>/api/...); another computer's window only that computer's, as it reaches nothing else
  // of this one's.
  const opens = (u, at) => {
    let x
    try { x = new URL(u) } catch { return null }
    if (!local(u)) return OUTSIDE.has(x.protocol) ? 'outside' : null
    const file = /^(?:\/m\/([A-Za-z0-9_-]{1,20}))?\/api\//.exec(x.pathname)
    const page = of(at)
    if (!file || !page) return null
    if (page.kind === 'own') return 'browser'
    const p = Number(x.port)
    return file[1] === page.machine && (p === port || machineAt(p) === page.machine) ? 'browser' : null
  }
  // The page an IPC message came from, if it's the main frame of its window.
  const from = (e) => { const f = e?.senderFrame; return f && !f.parent ? of(f.url) : null }
  const own = (e) => from(e)?.kind === 'own'
  // ipcMain as main.js and dictation.js use it: every message checked first. machine: the channels a
  // window showing another computer may use too (MACHINE); self: ones that check their sender
  // themselves (SELF). A message refused is answered with nothing.
  function guard(ipcMain, { machine = MACHINE, self = SELF, refused = () => {} } = {}) {
    const ok = (ch, e) => self.includes(ch) || own(e) || (machine.includes(ch) && from(e)?.kind === 'machine')
    const wrap = (ch, fn) => (e, ...a) => { if (ok(ch, e)) return fn(e, ...a); refused(ch, e); return null }
    return {
      handle: (ch, fn) => ipcMain.handle(ch, wrap(ch, fn)),
      on: (ch, fn) => ipcMain.on(ch, wrap(ch, fn)),
    }
  }
  // Electron's permission requests: the microphone, a screen, notifications, where you are and
  // reading the clipboard only for this computer's own page in a window's main frame (not a frame in
  // it: a project's app in Preview, another computer's agent in a tab, nor a window showing another
  // computer, whose permissions are that computer's). Copying, for any page of the app's server.
  const ASK = new Set(['media', 'display-capture', 'notifications', 'geolocation', 'clipboard-read'])
  const permits = (perm, { url, mainFrame = true } = {}) => (perm === 'clipboard-sanitized-write' ? local(url) : ASK.has(perm) && mainFrame !== false && of(url)?.kind === 'own')
  // Another computer's page, for a window: asked of the app's address, which sends it to its port.
  const machineUrl = (id, rest = '/') => `http://127.0.0.1:${port}/m/${id}${rest}`
  return { of, local, opens, from, own, guard, permits, machineUrl }
}

module.exports = { create, MACHINE, SELF, OUTSIDE }
