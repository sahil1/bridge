// Another of your computers' pages shown on this one get nothing of this computer but what's passed
// to them, in the browser named by BRIDGE_TEST_BROWSER: two Bridge AIs, "Studio" and "Desk", on relays
// of their own (stand-ins/relay.mjs), linked, with an agent at work on Desk. Each computer's pages are
// at a port of their own on 127.0.0.1, which needs no name looked up: here no page may use a name
// under localhost at all (WebKit on macOS 15 and before can't find one).
//   The desktop app's side (desktop/senders.js, preload.js, main.js, with stand-ins): which page a
//   message or a permission request comes from (this computer's own page, another computer's at its
//   port, anything else), every message checked before it's handled (only this computer's page, in a
//   window's main frame; a window showing another computer only for windows, what an update would
//   lose and the agent on screen; never from a frame), the microphone, a screen and reading the
//   clipboard for this computer's own page only, copying for both; and what the preload gives each
//   page (another computer's: windows, nothing of this computer's).
//   Studio's server: Desk has a port of its own, kept across a restart; a page of Desk's asked for at
//   Studio's own address is sent there (not through a phone); there, Desk's own pages and API go
//   through, and of Studio's only what that page shows of Studio (your devices; copies from Desk),
//   never its agents, settings, terminals or another computer, each refused saying where to do it;
//   only Studio's page frames it; another site can't reach Desk's API through Studio.
//   In the browser, Desk's agent in a tab of Studio's window: its page is at Desk's port, and from it
//   (as a page broken into would try) Studio's page, its desktop app's powers, its saved state, its
//   windows' channel, its API (at Desk's port and at Studio's, also blind) and its terminals are all
//   out of reach; a dictation message from anything but that tab is ignored, and one from it starts
//   nothing unless you're in it; the tab still works, the words reach it and only the words. A window
//   switched to Desk: at Desk's port, with Studio's look passed to it, the devices menu and Settings ›
//   Devices from Studio (read only there, saying where to change them), and back to Studio's own
//   page; Studio's agent in a tab there offers to switch instead.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import WebSocket from 'ws'
import { ROOT, TEST, startKit, startRelay, checks, until, sleep, browser, page, shot, noServiceWorker } from '../lib/harness.mjs'

const { ok, done } = checks('device-isolation')
const require = createRequire(import.meta.url)
const senders = require('../../desktop/senders.js')

// ---------- The desktop app's side ----------
{
  const P = 7420
  const DP = 7433 // Desk's port, as the server keeps it in machines.json
  const pages = senders.create(P, { ports: () => ({ desk1: DP, other: 7434 }) })
  const m = (id, rest = '/', at = DP) => `http://127.0.0.1:${at}/m/${id}${rest}`
  const cases = [
    [`http://127.0.0.1:${P}/`, 'own'], [`http://localhost:${P}/?window=w1`, 'own'], [`http://127.0.0.1:${P}/?dictate=1`, 'own'],
    [m('desk1', '/?window=w1%3Ap2'), 'machine'], [`http://localhost:${DP}/m/desk1/`, 'machine'],
    [`http://127.0.0.1:${P}/m/desk1/`, null], [`http://127.0.0.1:${P}/api/agents/w1/site/index.html`, null], [`http://127.0.0.1:${P + 1}/`, null],
    [m('other'), null], [`http://127.0.0.1:${DP}/`, null], [m('desk1', '/', 7999), null], ['https://example.com/', null], ['data:text/html,hi', null], [`http://m-6465736b31.localhost:${P}/m/desk1/`, null],
  ]
  const kinds = cases.map(([u]) => pages.of(u)?.kind || null)
  ok(cases.every(([, want], i) => kinds[i] === want), 'this computer\'s own page, another computer\'s at its own port, and nothing else counts as either (not one at this computer\'s port or another computer\'s, a page an agent made, an unknown port, a site, a data: page, a name)', cases.map(([u], i) => `${u} ${kinds[i]}`))
  ok(pages.of(m('desk1'))?.machine === 'desk1' && pages.machineUrl('desk1', '/?window=a') === `http://127.0.0.1:${P}/m/desk1/?window=a` && pages.local(m('desk1')) && !pages.local('http://127.0.0.1:7999/'), 'which computer; a window for one asks this computer\'s address (which sends it to its port); and only these ports are the app\'s')
  // A link a page opens in a new window (Open in a new tab): a file the app's server serves goes to
  // the browser (it did nothing in the app), the web and mail to their apps, and the app's own pages
  // and other schemes nowhere. From this computer's own page.
  const OWN = `http://127.0.0.1:${P}/`
  const links = [
    [`http://127.0.0.1:${P}/api/agents/w1%3Ap3/raw?path=scan.pdf`, 'browser'], [`http://127.0.0.1:${P}/api/agents/w1/site/index.html`, 'browser'], [m('desk1', '/api/agents/p2/raw?path=a.png'), 'browser'], [`http://127.0.0.1:${P}/m/desk1/api/uploads/a.png`, 'browser'],
    ['https://example.com/', 'outside'], ['mailto:me@example.com', 'outside'], [`http://127.0.0.1:${P + 1}/`, 'outside'],
    [`http://127.0.0.1:${P}/`, null], [`http://localhost:${P}/?window=w1`, null], [m('desk1'), null], [`http://127.0.0.1:${P}/apis`, null], ['file:///etc/hosts', null], ['smb://nas/share', null], ['not a link', null],
  ]
  const went = links.map(([u]) => pages.opens(u, OWN))
  ok(links.every(([, want], i) => went[i] === want), 'a link opened in a new window: a file the app shows in the browser, the web and mail in their own apps, the app\'s own pages and other schemes nowhere', links.map(([u], i) => `${u} ${went[i]}`))
  // From another computer's window: only that computer's files (it reaches nothing else of this
  // one's), the web and mail as from any page; and from a page that's neither (one an agent made),
  // no file at all.
  const fromDesk = [
    [m('desk1', '/api/agents/p2/raw?path=a.png'), 'browser'], [`http://127.0.0.1:${P}/m/desk1/api/uploads/a.png`, 'browser'],
    [`http://127.0.0.1:${P}/api/agents/w1%3Ap3/raw?path=scan.pdf`, null], [`http://127.0.0.1:${P}/m/other/api/uploads/a.png`, null], [m('desk1', '/m/other/api/x'), null],
    ['https://example.com/', 'outside'],
  ]
  const deskWent = fromDesk.map(([u]) => pages.opens(u, m('desk1')))
  const agentPage = pages.opens(`http://127.0.0.1:${P}/api/agents/w1%3Ap3/raw?path=scan.pdf`, `http://127.0.0.1:${P}/api/agents/w1/site/index.html`)
  ok(fromDesk.every(([, want], i) => deskWent[i] === want) && agentPage === null, 'from another computer\'s window, only that computer\'s files go to the browser, not this one\'s; from a page an agent made, none', { desk: fromDesk.map(([u], i) => `${u} ${deskWent[i]}`), agentPage })

  // Every channel main.js and dictation.js answer, checked first.
  const src = (f) => fs.readFileSync(path.join(ROOT, 'desktop', f), 'utf8')
  const main = src('main.js')
  const chans = [...new Set([...main.matchAll(/\bipc\.(?:handle|on)\('([\w:-]+)'/g), ...src('dictation.js').matchAll(/\bipcMain\.(?:handle|on)\('([\w:-]+)'/g)].map((x) => x[1]))]
  ok(chans.length > 40 && !/\bipcMain\.(handle|on)\(/.test(main) && /electron: parts/.test(main) && /ipcMain: ipc\b/.test(main), 'main.js answers no message but through the check, and hands dictation.js the checked one', { chans: chans.length })
  const handlers = main.split('setWindowOpenHandler(').slice(1).map((x) => x.split(/\r?\n/)[0]) // (Windows checks out CRLF)
  ok(handlers.length >= 4 && handlers.every((h) => /^openLink\((win|w|float)\)\)$/.test(h) || h === "() => ({ action: 'deny' }))"), 'every window\'s links opened in a new window go where that says for the page it shows (or, the tile\'s, nowhere)', handlers)
  const handled = {}
  const stand = { handle: (ch, fn) => { handled[ch] = fn }, on: (ch, fn) => { handled[ch] = fn } }
  const refused = []
  const ipc = pages.guard(stand, { refused: (ch) => refused.push(ch) })
  for (const ch of chans) ipc.handle(ch, () => 'done')
  const ev = (url, sub = false) => ({ senderFrame: { url, parent: sub ? {} : null }, sender: {} })
  const from = { own: ev(`http://127.0.0.1:${P}/`), ownFrame: ev(`http://127.0.0.1:${P}/`, true), machine: ev(m('desk1', '/?window=w1')), machineFrame: ev(m('desk1'), true), atHere: ev(`http://127.0.0.1:${P}/m/desk1/`), site: ev(`http://127.0.0.1:${P}/api/agents/w1/site/a.html`), data: ev('data:text/html,tile'), gone: { senderFrame: null, sender: {} } }
  const ans = (who) => Object.fromEntries(chans.map((ch) => [ch, handled[ch](from[who]) === 'done']))
  const own = ans('own')
  ok(chans.every((ch) => own[ch]), 'this computer\'s own page, in a window\'s main frame: every message handled')
  const mach = ans('machine')
  const machOk = chans.filter((ch) => mach[ch]).sort()
  ok(JSON.stringify(machOk) === JSON.stringify([...senders.MACHINE, ...senders.SELF].filter((ch) => chans.includes(ch)).sort()) && ['bridge:capture', 'bridge:hud-paste', 'bridge:hud-selection', 'bridge:restart', 'bridge:perm', 'bridge:pick-folder', 'bridge:pick-files', 'bridge:dictate-configure', 'bridge:dictate-status', 'bridge:hud-into', 'bridge:media-ask', 'bridge:float-start', 'bridge:full-screen', 'bridge:idle'].every((ch) => chans.includes(ch) && !mach[ch]), 'a window showing another computer: only windows, what an update would lose and the agent on screen; never a picture of the screen, pasting, reading a selection, restarting, permissions, Finder, dictation\'s setup, the floating card', machOk)
  for (const who of ['ownFrame', 'machineFrame', 'atHere', 'site', 'gone']) {
    const a = ans(who)
    ok(chans.every((ch) => !a[ch] || senders.SELF.includes(ch)), `refused from ${({ ownFrame: 'a frame in this computer\'s page (another computer\'s agent in a tab, a project\'s app)', machineFrame: 'a frame in a window showing another computer', atHere: 'another computer\'s page at this computer\'s address', site: 'a page an agent made', gone: 'a frame that has gone' })[who]}`, chans.filter((ch) => a[ch]))
  }
  ok(refused.length > 0 && refused.every((ch) => chans.includes(ch)), 'and each refusal is noted')
  const data = ans('data')
  ok(chans.filter((ch) => data[ch]).sort().join() === [...senders.SELF].sort().join(), 'a data: page (the Allow access tile) only its own two, which check it\'s the tile', chans.filter((ch) => data[ch]))

  // Permissions.
  const can = (perm, url, mainFrame = true) => pages.permits(perm, { url, mainFrame })
  const own0 = `http://127.0.0.1:${P}/`
  ok(['media', 'display-capture', 'notifications', 'clipboard-read'].every((x) => can(x, own0)), 'this computer\'s own page may ask for the microphone, a screen, notifications and the clipboard')
  ok(['media', 'display-capture', 'notifications', 'clipboard-read', 'geolocation'].every((x) => !can(x, m('desk1')) && !can(x, own0, false) && !can(x, 'https://example.com/')), 'another computer\'s page may not (in a tab or a window), nor a frame in this computer\'s page, nor a site')
  ok(can('clipboard-sanitized-write', m('desk1')) && can('clipboard-sanitized-write', own0) && !can('clipboard-sanitized-write', 'https://example.com/') && !can('midi', own0), 'copying works in both; anything else isn\'t asked for')

  // What the preload gives each page.
  const preload = src('preload.js')
  const given = (url) => {
    const out = {}
    const u = new URL(url)
    const electron = { contextBridge: { exposeInMainWorld: (k, v) => { out[k] = v } }, ipcRenderer: { on() {}, send() {}, invoke: async () => null }, webUtils: {} }
    vm.runInNewContext(preload, { require: (n) => (n === 'electron' ? electron : null), location: u, process: { platform: 'darwin' }, window: { addEventListener() {} }, document: {} })
    return out.bridgeApp || {}
  }
  const full = given(own0)
  const small = given(m('desk1', '/?window=w1'))
  const SMALL = ['platform', 'desktop', 'machine', 'dictates', 'popOut', 'focusMain', 'focusPopout', 'openMachine', 'answerBusy', 'looking']
  ok(full.desktop === true && typeof full.capture === 'function' && typeof full.hudPaste === 'function' && typeof full.permission === 'object', 'this computer\'s page gets the app\'s powers', Object.keys(full).length)
  ok(Object.keys(small).sort().join() === [...SMALL].sort().join() && small.machine === 'desk1' && small.desktop === false, 'another computer\'s page: windows and the agent on screen, nothing of this computer\'s', Object.keys(small))
  ok(['http://127.0.0.1:7420/api/agents/w1/site/a.html', 'data:text/html,x', 'https://example.com/'].every((u) => !given(u).capture && given(u).desktop === false), 'nor any page that isn\'t this computer\'s own')
}

// ---------- Two computers ----------
const relays = []
const kits = []
const kitWith = async (name, rel) => {
  const k = await startKit(`device-isolation-${name.toLowerCase()}`, {
    env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, CLAUDE_STAND_IN: 'fresh' } },
  })
  kits.push(k)
  k.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await k.api('/setup', { name: 'Tester' })
  await k.api('/agents/catalog')
  return k
}
// A request to Studio's server as a browser would make it: at port (Studio's own, or a computer's
// there), the rest of the headers as given. { status, headers, body }.
const ask = (k, p, { method = 'GET', port: at = null, headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const to = at || new URL(k.url).port
  const r = http.request({ host: '127.0.0.1', port: to, path: p, method, headers: { host: `127.0.0.1:${to}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
    let s = ''
    res.on('data', (c) => { s += c })
    res.on('end', () => { let j = null; try { j = JSON.parse(s) } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, body: j, text: s }) })
  })
  // Which request it was: what failed in the server's hands has no line of the test in its stack.
  r.on('error', (e) => reject(new Error(`${method} ${p} at ${String(to) === new URL(k.url).port ? 'Studio\'s port' : 'Desk\'s port'}: ${e.message}`)))
  r.end(body ? JSON.stringify(body) : undefined)
})
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const real = (errors) => errors.filter((e) => !/\/api\/\S+ due to access control checks|WebSocket|_relay|Load failed|Failed to fetch|NetworkError/.test(e))
const said = []
// Names under localhost, which WebKit on macOS 15 and before can't look up: none is ever asked for.
const named = []
const before = async (ctx) => {
  await noServiceWorker(ctx)
  await ctx.route(/^https?:\/\/[^/]+\.localhost(:\d+)?\//i, (r) => { named.push(r.request().url()); return r.abort() })
  if (which === 'webkit') {
    await ctx.addInitScript(() => {
      const tone = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); o.connect(dest); o.start(); return dest.stream }
      Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { value: tone, configurable: true, writable: true })
    })
  }
  await ctx.route('**/api/transcribe', (r) => r.fulfill({ json: { text: said.shift() ?? 'hello there' } }))
  await ctx.route('**/api/voice', (r) => r.fulfill({ json: { ready: true, model: true, missing: [] } }))
  // Studio's page with the desktop app's powers on it, as the preload gives them to it alone (only
  // what's tried below, and not saying it's the app, so the page carries on as in a browser).
  await ctx.addInitScript(() => {
    if (!['127.0.0.1', 'localhost'].includes(location.hostname) || location.pathname.startsWith('/m/')) return
    window.__used = []
    const use = (n) => () => { window.__used.push(n); return Promise.resolve(null) }
    window.bridgeApp = { platform: 'darwin', desktop: false, capture: use('capture'), hudPaste: use('hudPaste'), hudSelection: use('hudSelection'), restart: use('restart') }
    window.__secret = 'only Studio\'s page'
  })
}
let deskPort = null
const isMachine = (u) => { try { const x = new URL(u); return x.hostname === '127.0.0.1' && x.port === String(deskPort) && x.pathname.startsWith('/m/') } catch { return false } }
const deskFrame = (pg) => pg.frames().find((f) => isMachine(f.url())) || null

try {
  const rs = await startRelay('device-isolation-studio')
  const rd = await startRelay('device-isolation-desk')
  relays.push(rs, rd)
  const studio = await kitWith('Studio', rs)
  const desk = await kitWith('Desk', rd)
  ok(!!(await until(async () => (await studio.api('/relay')).online && (await desk.api('/relay')).online, 20000)), 'each is connected to its own relay')
  const pairing = (await desk.api('/relay/pair', {})).pairing
  await studio.api('/machines', { link: `${rd.url} ${pairing.code}` })
  const deskM = await until(async () => (await studio.api('/machines')).machines.find((x) => x.name === 'Desk' && x.online), 30000, 300)
  ok(!!deskM, 'Studio is linked with Desk')
  // Linked with Desk's code, Studio reaches Desk and no other computer through it until it's kept on
  // Desk: no code of Desk's to hand on, no third computer introduced to it.
  {
    const studioOnDesk = (await desk.api('/relay')).devices.find((d) => d.kind === 'computer')
    const invite = () => ask(studio, `/m/${deskM.id}/api/machines/invite`, { method: 'POST', body: {} })
    const notYet = await invite()
    const intro = await ask(studio, `/m/${deskM.id}/api/machines`, { method: 'POST', body: { link: 'http://127.0.0.1:9/#pair=AAAA-BBBB-CCCC-DDDD-EEEE', via: 'intro' } })
    ok(studioOnDesk?.fresh && notYet.status >= 400 && /^Keep Studio in Bridge AI on Desk first/.test(notYet.body?.error || '') && intro.status >= 400 && /^Keep Studio/.test(intro.body?.error || ''), 'Studio, linked with Desk\'s code and not kept there yet: Desk gives it no code to hand on, and takes no introduction from it', [notYet.body, intro.body])
    await desk.api(`/relay/devices/${studioOnDesk.id}/keep`, {})
    const kept = await invite()
    ok(kept.status === 200 && /#pair=/.test(kept.body?.link || ''), 'kept on Desk: it can', kept.status)
  }
  const port = new URL(studio.url).port
  // Desk's port on Studio, as Studio's own page is told (and kept in Studio's machines.json).
  deskPort = await until(async () => (await studio.api('/machines')).machines.find((x) => x.id === deskM.id)?.port, 15000, 200)
  const kept = () => JSON.parse(fs.readFileSync(path.join(studio.data, 'machines.json'), 'utf8')).machines.find((x) => x.id === deskM.id)?.port
  ok(Number.isInteger(deskPort) && String(deskPort) !== port && kept() === deskPort, 'Desk has a port of its own on Studio, kept with it', { deskPort, port, kept: kept() })
  const deskOrigin = `http://127.0.0.1:${deskPort}`
  await studio.api('/chief/launch', {})
  const chief = (await until(async () => ((await studio.api('/fleet')).agents || []).find((a) => a.chief), 30000, 500))?.paneId
  const work = path.join(desk.home, 'desk-work')
  fs.mkdirSync(work, { recursive: true })
  const deskPane = (await desk.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Desk work', newSpace: 'Desk work', prompt: 'idle' })).paneId
  ok(!!chief && !!(await until(async () => ((await desk.api('/fleet')).agents || []).some((a) => a.paneId === deskPane), 30000, 500)), 'Studio\'s Chief of Staff, and Desk\'s agent')
  const studioAgents = async () => ((await studio.api('/fleet')).agents || []).length
  const agents0 = await studioAgents()

  // ---------- Studio's server ----------
  {
    const doc = { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', accept: 'text/html' }
    const to = await ask(studio, `/m/${deskM.id}/?window=w1`, { headers: doc })
    ok(to.status === 302 && to.headers.location === `${deskOrigin}/m/${deskM.id}/?window=w1`, 'a page of Desk\'s asked for at Studio\'s own address goes to Desk\'s', to.headers.location)
    const old = await ask(studio, `/m/${deskM.id}/`, { headers: { accept: 'text/html' } })
    ok(old.status === 302 && old.headers.location.startsWith(deskOrigin), 'so does one asked for by a browser that doesn\'t say what for (it wants a page)', old.status)
    const phone = await ask(studio, `/m/${deskM.id}/`, { headers: { accept: 'text/html', 'x-bridge-relay': 'a-phone' } })
    ok(phone.status !== 302 && /<html|<!doctype/i.test(phone.text), 'through a phone it stays at /m/<id>/, as a phone can\'t reach that port', phone.status)
    const viaHere = await ask(studio, `/m/${deskM.id}/api/config`, { headers: { accept: '*/*', 'sec-fetch-dest': 'empty', 'sec-fetch-site': 'same-origin' } })
    ok(viaHere.status === 200 && viaHere.body?.name !== undefined, 'Studio\'s own page still reaches Desk\'s API through Studio', viaHere.status)
    const page0 = await ask(studio, `/m/${deskM.id}/`, { port: deskPort, headers: doc })
    ok(page0.status === 200 && String(page0.headers['content-security-policy']).includes(`frame-ancestors 'self' http://127.0.0.1:${port} http://localhost:${port}`), 'at Desk\'s port, Desk\'s page, which only Studio\'s page (or itself) may put in a frame', page0.headers['content-security-policy'])
    ok((await ask(studio, `/m/${deskM.id}/api/config`, { port: deskPort })).status === 200, 'and Desk\'s API')
    // The app's own files there come from Studio when it has the very file (its name has a hash of
    // what's in it), not through Desk's relay: even with that relay stuck. Desk's page and API don't.
    const asset = /src="\.?\/assets\/([^"]+\.js)"/.exec(fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8'))?.[1]
    await rd.freeze()
    const t0 = Date.now()
    const own = asset ? await ask(studio, `/m/${deskM.id}/assets/${asset}`, { port: deskPort }) : null
    const took = Date.now() - t0
    await rd.thaw()
    // (A stuck relay drops what it's sent: the link to Desk is made again before going on.)
    await until(async () => (await ask(studio, `/m/${deskM.id}/api/config`, { port: deskPort })).status === 200, 30000, 500)
    ok(own?.status === 200 && took < 3000 && /immutable/.test(own.headers['cache-control'] || '') && own.headers['x-content-type-options'] === 'nosniff' && own.text.length > 1000, 'the app\'s own files at Desk\'s port: from Studio, with Desk\'s relay stuck', { asset, status: own?.status, took })
    const notOurs = await ask(studio, `/m/${deskM.id}/assets/not-ours-AbCd1234.js`, { port: deskPort })
    ok(notOurs.status === 200 && /text\/html/.test(notOurs.headers['content-type'] || '') && !/immutable/.test(notOurs.headers['cache-control'] || ''), 'one Studio hasn\'t got: asked of Desk (which has none either, and answers with its page)', notOurs.status)
    const refused = await ask(studio, '/api/config', { port: deskPort })
    ok(refused.status === 403 && /Switch this window to Studio to do this/.test(refused.body?.error || '') && refused.body?.code === 'machinePage', 'Studio\'s API there: refused, saying where to do it', refused.body)
    const tries = [['POST', '/api/agents/launch', { kind: 'claude', cwd: work, label: 'Nope', prompt: 'idle' }], ['PATCH', '/api/settings', { name: 'Taken' }], ['POST', `/api/panes/${encodeURIComponent(chief)}/input`, { text: 'echo hi\r' }], ['GET', '/api/files?root=home'], ['POST', '/api/machines/asks/x', { allow: true }], ['DELETE', `/api/machines/${deskM.id}`], ['POST', '/api/relay/pair', {}], ['GET', `/api/agents/${encodeURIComponent(chief)}/screen`], ['POST', '/api/transfers', { to: deskM.id, src: { pane: chief, path: 'x' }, into: { where: 'downloads' } }], ['POST', '/api/transfers', { from: 'someone', src: { pane: 'p', path: 'x' }, into: { where: 'downloads' } }], ['GET', `/api/transfers/plan?to=${deskM.id}&pane=${chief}&path=x`]]
    const got = []
    for (const [method, p, body] of tries) got.push([p, (await ask(studio, p, { method, port: deskPort, body })).status])
    ok(got.every(([, s]) => s === 403), 'its agents, settings, terminals, files, links, pairing, screen, and copies of its files: all refused there', got)
    ok(await studioAgents() === agents0 && (await studio.api('/config')).name !== 'Taken', 'and nothing happened on Studio')
    const allowed = []
    for (const p of ['/api/machines', '/api/machines/summary']) allowed.push([p, (await ask(studio, p, { port: deskPort })).status])
    ok(allowed.every(([, s]) => s === 200), 'what Desk\'s page shows of Studio: your devices', allowed)
    const other = await ask(studio, '/m/zz9/api/config', { port: deskPort })
    ok(other.status === 403 && /that computer/.test(other.body?.error || ''), 'another computer through Studio, from there: refused', other.body)
    const back = await ask(studio, '/?agent=w1', { port: deskPort, headers: doc })
    ok(back.status === 302 && back.headers.location === `http://127.0.0.1:${port}/?agent=w1`, 'Studio\'s page asked for there: at Studio\'s own address', back.headers.location)
    ok((await ask(studio, '/assets/index.js', { port: deskPort })).status === 404, 'and Studio\'s own files aren\'t there')
    const origin = await ask(studio, '/api/fleet', { headers: { origin: deskOrigin, 'sec-fetch-site': 'same-site' } })
    ok(origin.status === 403, 'Desk\'s page asking Studio\'s port: refused (its origin isn\'t Studio\'s page)', origin.body)
    ok((await ask(studio, `/m/${deskM.id}/api/config`, { headers: { origin: deskOrigin, 'sec-fetch-site': 'same-site' } })).status === 403, 'and Desk\'s API there, from Desk\'s port: refused too (another port is another site)')
    const site = await ask(studio, `/m/${deskM.id}/api/config`, { headers: { 'sec-fetch-site': 'cross-site' } })
    ok(site.status === 403, 'another site can\'t reach Desk\'s API through Studio', site.body)
    const ws = (at, p) => new Promise((resolve) => {
      const s = new WebSocket(`ws://127.0.0.1:${at}${p}`, { headers: { origin: `http://127.0.0.1:${at}` } })
      s.on('open', () => { s.close(); resolve('open') })
      s.on('unexpected-response', (_q, r) => resolve(r.statusCode))
      s.on('error', () => resolve('error'))
    })
    ok(await ws(deskPort, `/api/panes/${encodeURIComponent(chief)}/attach?cols=80&rows=24`) === 403, 'a terminal of Studio\'s from Desk\'s port: refused')
    // Studio quit and opened again: Desk at the same port, so what its pages saved there is still theirs.
    await studio.restart()
    ok(!!(await until(async () => (await studio.api('/machines')).machines.find((x) => x.id === deskM.id)?.port === deskPort, 30000, 300)) && (await ask(studio, `/m/${deskM.id}/api/config`, { port: deskPort })).status === 200, 'Studio opened again: Desk at the same port', deskPort)
  }

  // ---------- Desk's agent in a tab of Studio's window ----------
  const rid = `remote:${deskM.id}:${deskPane}`
  const remoteInfo = { [rid]: { title: 'Desk work', device: 'Desk', kind: 'claude' } }
  {
    const s = await page(b, studio.url, { before, store: { 'cc-ws': { tabs: [chief, rid], active: rid, side: null, split: false, group: 'main' }, 'cc-remote-tabs': remoteInfo } })
    const p = s.p
    const deskBox = p.frameLocator('.remote-frame').locator('textarea[data-composer]')
    await deskBox.waitFor({ timeout: 45000 })
    const src = await p.locator('.remote-frame').getAttribute('src')
    const fr = deskFrame(p)
    ok(src.startsWith(`/m/${deskM.id}/?window=${encodeURIComponent(deskPane)}#`) && !!fr && fr.url().startsWith(`${deskOrigin}/m/${deskM.id}/?window=`), 'Desk\'s agent in a tab: its page sent to Desk\'s port, another site to Studio\'s page', [src, fr?.url()])
    ok(!/#/.test(fr.url()), 'what Studio passed it is taken, and the address put back as it was', fr?.url())
    await p.evaluate(() => { localStorage.setItem('studio-only', 'yes'); const c = new BroadcastChannel('bridge-meetings'); window.__heard = []; c.onmessage = (e) => window.__heard.push(e.data) })
    // As a page broken into would try.
    const tried = await fr.evaluate(async ({ port, chief, studio }) => {
      const out = {}
      const t = async (k, f) => { try { const v = await f(); out[k] = v === undefined ? 'undefined' : typeof v === 'string' ? v : JSON.stringify(v) } catch (e) { out[k] = `refused: ${e.name}` } }
      await t('bridgeApp', () => window.parent.bridgeApp.capture({ x: 0, y: 0, width: 9, height: 9 }))
      await t('document', () => window.parent.document.title)
      await t('top', () => window.top.__secret)
      await t('storage', () => window.parent.localStorage.getItem('studio-only'))
      await t('ownStorage', () => localStorage.getItem('studio-only'))
      await t('opener', () => window.top.location.href)
      await t('api', async () => { const r = await fetch('/api/fleet'); return `${r.status} ${(await r.json()).error}` })
      await t('launch', async () => (await fetch('/api/agents/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'claude', cwd: '/tmp', label: 'Nope', prompt: 'idle' }) })).status)
      await t('studioApi', async () => (await fetch(`${studio}/api/fleet`)).status)
      await t('studioBlind', async () => { await fetch(`${studio}/api/agents/launch`, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ kind: 'claude', cwd: '/tmp', label: 'Blind', prompt: 'idle' }) }); return 'sent' })
      await t('own', async () => (await fetch(`${location.pathname.split('?')[0].replace(/\/$/, '')}/api/config`)).status)
      const sock = (u) => new Promise((resolve) => { const w = new WebSocket(u); const end = setTimeout(() => resolve('no answer'), 3000); w.onopen = () => { clearTimeout(end); w.close(); resolve('open') }; w.onclose = () => { clearTimeout(end); resolve('closed') }; w.onerror = () => {} })
      out.term = await sock(`ws://${location.host}/api/panes/${encodeURIComponent(chief)}/attach?cols=80&rows=24`)
      out.termStudio = await sock(`ws://127.0.0.1:${port}/api/panes/${encodeURIComponent(chief)}/attach?cols=80&rows=24`)
      const c = new BroadcastChannel('bridge-meetings')
      const back = []
      c.onmessage = (e) => back.push(e.data)
      c.postMessage({ type: 'hello' })
      c.postMessage({ type: 'op', op: 'watchScreen' })
      await new Promise((r) => setTimeout(r, 1500))
      out.channel = back.length ? JSON.stringify(back) : 'nobody'
      return out
    }, { port, chief, studio: studio.url })
    const blocked = (v) => /^refused: (SecurityError|TypeError|Error)$/.test(v || '')
    ok(blocked(tried.bridgeApp) && blocked(tried.document) && blocked(tried.top) && blocked(tried.storage) && blocked(tried.opener), 'from Desk\'s page: Studio\'s page, its desktop app\'s powers (a picture of the screen), its saved state and its address are out of reach', tried)
    ok(!(await p.evaluate(() => window.__used.length)), 'and nothing of the app\'s was used', await p.evaluate(() => window.__used))
    ok(tried.ownStorage === 'undefined' || tried.ownStorage === 'null', 'what Studio\'s page saves isn\'t Desk\'s page\'s to read', tried.ownStorage)
    ok(/^403 Switch this window to Studio/.test(tried.api) && tried.launch === '403', 'Studio\'s API at Desk\'s address: refused, saying where to do it', [tried.api, tried.launch])
    ok(blocked(tried.studioApi) && tried.studioBlind === 'sent', 'at Studio\'s own address: the browser won\'t let it read anything', [tried.studioApi])
    await sleep(500)
    ok(await studioAgents() === agents0, 'and nothing it sent there, blind, started anything on Studio', await studioAgents())
    ok(tried.own === '200', 'Desk\'s own API still works for it', tried.own)
    ok(tried.term !== 'open' && tried.termStudio !== 'open', 'Studio\'s terminals: refused at both addresses', [tried.term, tried.termStudio])
    ok(tried.channel === 'nobody' && !(await p.evaluate(() => window.__heard.length)), 'Studio\'s windows\' channel (a meeting\'s Watch a screen) doesn\'t hear it, nor answer', [tried.channel, await p.evaluate(() => window.__heard)])
    // Studio's page on its own channel still hears Studio's own (the check above can tell).
    const own = await s.ctx.newPage()
    await own.goto(`${studio.url}/api/config`)
    const ownBack = await own.evaluate(() => new Promise((resolve) => { const c = new BroadcastChannel('bridge-meetings'); c.onmessage = (e) => resolve(e.data?.type); c.postMessage({ type: 'hello' }); setTimeout(() => resolve('nobody'), 3000) }))
    ok(ownBack === 'hello-back', 'while a page of Studio\'s own is answered on it', ownBack)
    await own.close()

    // Dictation: a message from anything but that tab is ignored; one from it starts nothing unless
    // you're in it; and the tab still gets the words, and only the words.
    const listening = () => p.locator('.dict-dock .rec-stop, .dict-dock .dp-ok').count()
    await p.evaluate(() => window.postMessage({ 'bridge-dictation': 'press', at: Date.now(), target: true }, '*'))
    await fr.evaluate(() => { const f = document.createElement('iframe'); f.srcdoc = '<script>top.postMessage({ "bridge-dictation": "press", at: Date.now(), target: true }, "*")<\/script>'; document.body.appendChild(f) })
    await p.evaluate(() => document.activeElement?.blur())
    await fr.evaluate(() => { document.activeElement?.blur(); window.parent.postMessage({ 'bridge-dictation': 'press', at: Date.now(), target: true }, '*') })
    await sleep(800)
    // ...nor once it takes the focus itself, with no key or click of yours: a while after the last
    // (Playwright runs what a test does in a page as if you'd clicked, which a browser counts for 5 s).
    await fr.evaluate(() => setTimeout(() => { window.focus(); window.parent.postMessage({ 'bridge-dictation': 'press', at: Date.now(), target: true }, '*') }, 6500))
    await sleep(7500)
    ok(!(await listening()), 'a dictation message from Studio\'s own window or a frame Desk\'s page made: ignored; from Desk\'s tab with no key or click of yours in it (even with the focus taken): it starts nothing', await p.locator('.dict-dock').innerText().catch(() => ''))
    ok(await p.evaluate(() => typeof navigator.userActivation?.isActive === 'boolean'), 'this browser says whether you just pressed or clicked (what that rests on)')
    await fr.evaluate(() => { window.__got = []; addEventListener('message', (e) => { if (e.data && typeof e.data === 'object') window.__got.push(e.data) }) })
    await deskBox.click()
    said.push('only the words')
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: 'down', at: Date.now() } })))
    await until(listening, 6000, 50)
    await sleep(1300)
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: 'up', at: Date.now() } })))
    ok(!!(await until(async () => (await deskBox.inputValue()) === 'Only the words.', 8000)), 'the tab still works: the words go into Desk\'s box', await deskBox.inputValue())
    const got = await fr.evaluate(() => window.__got)
    const KEYS = new Set(['bridge-dictation', 'id', 'text', 'at', 'listens', 'app', 'phase', 'mode'])
    ok(got.length > 0 && got.every((d) => Object.keys(d).every((k) => KEYS.has(k)) && Object.values(d).every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))), 'and all Desk\'s page heard from Studio\'s was whether it listens, how that went, and the words', got)
    ok(got.some((d) => d['bridge-dictation'] === 'words' && d.text === 'Only the words.'), 'the words among them', got.map((d) => d['bridge-dictation']))
    await shot(p, `${tag}device-isolation-tab`)
    ok(real(s.errors).length === 0, 'no page errors', s.errors)
    await s.ctx.close()
  }

  // ---------- a window switched to Desk ----------
  {
    const s = await page(b, studio.url, { before, mode: 'light', theme: 'sky' })
    const p = s.p
    await p.waitForSelector('.mc-chip', { timeout: 30000 })
    // Studio's look, changed after the page opened: Desk's page gets it from Studio's.
    await p.evaluate(() => localStorage.setItem('cc-appearance', JSON.stringify({ mode: 'dark', theme: 'midnight', text: 'm' })))
    await p.locator('.mc-chip').click()
    // While Desk's page comes, the devices menu says it's switching to Desk: noted (in what Studio's
    // page keeps for this tab) the moment it does, and read back on Studio's page below.
    await p.evaluate(() => new MutationObserver(() => { const c = document.querySelector('.mc-chip.going'); if (c && /Desk/.test(c.textContent)) sessionStorage.setItem('test-going', String(performance.now())) }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }))
    const picked = await p.evaluate(() => performance.now())
    await p.locator('.mc-menu .mc-item', { hasText: 'Desk' }).first().click()
    await until(() => isMachine(p.url()), 20000, 100)
    await p.waitForSelector('.mc-chip', { timeout: 45000 })
    // There, what a page asks in the background waits until what's on screen has been asked.
    await sleep(2500)
    const bg = await p.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/api\/(updates|crashes|insights|ideas|routines|previews)(\?|$)/.test(e.name)).map((e) => Math.round(e.startTime)))
    ok(bg.length > 0 && bg.every((t) => t >= 1400), 'its background requests (updates, crash reports, ideas…) start after the page\'s first 1.5 s', bg)
    ok(p.url().startsWith(`${deskOrigin}/m/${deskM.id}/`) && !p.url().includes('#'), 'switched to Desk: Desk\'s page at Desk\'s port', p.url())
    ok(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'with the look Studio\'s page passed it', await p.evaluate(() => document.documentElement.getAttribute('data-theme')))
    ok(/Desk/.test(await p.locator('.mc-chip').innerText()), 'its devices menu (Studio\'s list of your devices) works there', await p.locator('.mc-chip').innerText())
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'machines' } })))
    const note = p.locator('#st-machines p.small', { hasText: 'can\'t change them' })
    await note.waitFor({ timeout: 15000 })
    ok(/These are the links of Studio/.test(await note.innerText()) && !(await p.locator('#st-machines button', { hasText: 'Unlink' }).count()) && !(await p.locator('.mch-add').count()), 'Settings › Devices there: Studio\'s links to read, saying where to change them, with nothing offered that can\'t work', await note.innerText())
    await shot(p, `${tag}device-isolation-settings`)
    await note.locator('button', { hasText: 'Go to Studio' }).click()
    ok(!!(await until(() => p.url().startsWith(`http://127.0.0.1:${port}/`), 20000, 100)), 'and Go to Studio: Studio\'s own page, at its own address', p.url())
    await p.waitForSelector('.mc-chip', { timeout: 30000 })
    const saw = Number(await p.evaluate(() => sessionStorage.getItem('test-going')))
    ok(saw > picked && saw - picked < 1000, 'Desk picked: the devices menu said it was switching to Desk, at once, while Desk\'s page came', { picked, saw })
    ok(real(s.errors).length === 0, 'no page errors', s.errors)
    await s.ctx.close()
  }

  // ---------- Studio's agent in a tab of a window showing Desk ----------
  {
    const here = `remote:here:${chief}`
    const s = await page(b, `${studio.url}/m/${deskM.id}/`, { before, store: { [`cc-ws@${deskM.id}`]: { tabs: [here], active: here, side: null, split: false, group: 'main' }, [`cc-remote-tabs@${deskM.id}`]: { [here]: { title: 'Chief of Staff', device: 'Studio', kind: 'claude' } } } })
    const p = s.p
    const away = p.locator('.remote-away')
    await away.waitFor({ timeout: 45000 })
    ok(/Chief of Staff is on Studio/.test(await away.innerText()) && !(await p.locator('.remote-frame').count()) && await away.locator('button', { hasText: 'Go to Studio' }).count() === 1, 'Studio\'s agent in a tab of a window showing Desk: no frame of Studio\'s page there, it says why and offers to switch', await away.innerText())
    await shot(p, `${tag}device-isolation-here-tab`)
    ok(real(s.errors).length === 0, 'no page errors', s.errors)
    await s.ctx.close()
    // Desk's page as a Studio from before these addresses sends it, at Studio's own address: it
    // keeps to paths there, as then (that Studio has no addresses to send it to).
    const older = await page(b, `${studio.url}/m/${deskM.id}/`, {
      store: { [`cc-ws@${deskM.id}`]: { tabs: [here], active: here, side: null, split: false, group: 'main' }, [`cc-remote-tabs@${deskM.id}`]: { [here]: { title: 'Chief of Staff', device: 'Studio', kind: 'claude' } } },
      before: async (ctx) => { await before(ctx); await ctx.route(`${studio.url}/m/${deskM.id}/**`, (r) => (r.request().isNavigationRequest() ? r.continue({ headers: { ...r.request().headers(), 'x-bridge-relay': 'an-older-studio' } }) : r.continue())) },
    })
    const tab = older.p.locator('.remote-frame')
    await tab.waitFor({ timeout: 45000 })
    ok(older.p.url().startsWith(`${studio.url}/m/${deskM.id}/`) && (await tab.getAttribute('src')).startsWith('/?window=') && !(await older.p.locator('.remote-away').count()), 'a page of Desk\'s that an older Studio sends at its own address keeps to paths there, as before', [older.p.url(), await tab.getAttribute('src')])
    await older.ctx.close()
  }
  ok(!named.length, 'no page or window asked for a name under localhost: each computer is at a port of 127.0.0.1', named)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  await b.close()
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
}
process.exit(done().fail ? 1 : 0)
