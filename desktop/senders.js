// Which page something comes from, for the app to decide what it may do (main.js, dictation.js):
//   own      this computer's own page, at the app's address (not another computer's pages, nor a
//            page an agent made at /api/...);
//   machine  another of your computers' page, shown through this one at an address of its own
//            (m-<id in hex>.localhost, as shared/machinehost.js, which this copies), at /m/<id>/;
//   null     anything else (a data: page, a site, a project's app).
// A message to the app counts only from the main frame of one of its windows: its preload is only
// there, so one from a frame in it (another computer's agent in a tab, a project's app in Preview)
// comes from a page that got past its own. Each channel takes this computer's own page, and the few
// a window showing another computer needs take that too (guard).
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const ID = /^[A-Za-z0-9_-]{1,20}$/
const hex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
const machineHost = (id) => (ID.test(String(id)) ? `m-${hex(String(id))}.localhost` : null)
function machineOfHost(host) {
  const m = /^m-((?:[0-9a-f]{2}){1,20})\.localhost$/i.exec(String(host || ''))
  if (!m) return null
  const id = m[1].toLowerCase().match(/../g).map((h) => String.fromCharCode(parseInt(h, 16))).join('')
  return ID.test(id) ? id : null
}

// What a window showing another computer needs of the app: windows (an agent in one of its own, this
// computer's main one, a device in one of its own), saying what an update would lose in it, and the
// agent it has on screen (for the dictation window). And the Allow access tile's own two, a data:
// page, which check it's the tile.
const MACHINE = ['bridge:popout', 'bridge:focus-main', 'bridge:focus-popout', 'bridge:open-machine', 'bridge:busy-said', 'bridge:looking']
const SELF = ['bridge:tile-drag', 'bridge:tile-close']

function create(port) {
  const parse = (u) => { try { const x = new URL(u); return Number(x.port) === port && x.protocol === 'http:' ? x : null } catch { return null } }
  // What a page at u is: { kind: 'own' | 'machine', machine } or null.
  const of = (u) => {
    const x = parse(u)
    if (!x) return null
    if (LOOPBACK.has(x.hostname)) return /^\/(m|api)\//.test(x.pathname) ? null : { kind: 'own', machine: null }
    const id = machineOfHost(x.hostname)
    return id && x.pathname.startsWith(`/m/${id}/`) ? { kind: 'machine', machine: id } : null
  }
  // Anything this app's server serves, at either kind of address: where links and the app's own
  // navigation may go, and copying may come from.
  const local = (u) => { const x = parse(u); return !!x && (LOOPBACK.has(x.hostname) || !!machineOfHost(x.hostname)) }
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
  // Another computer's page, at its address here: rest is its path there ("/?window=…").
  const machineUrl = (id, rest = '/') => `http://${machineHost(id)}:${port}/m/${id}${rest}`
  return { of, local, from, own, guard, permits, machineUrl }
}

module.exports = { create, machineHost, machineOfHost, MACHINE, SELF }
