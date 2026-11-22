// The desktop app's line between its own server and anything else that answers at its address, in
// real Electron (desktop/servergate.js wired as desktop/main.js wires it: test/stand-ins/
// gate-windows.cjs). While the server hasn't proved it's the one the app started: a page there is
// held back, and its API and a terminal's WebSocket refused; once it has, they go, and a WebSocket
// opened again after it's lost is refused until it proves itself again. Another program at another
// name for this computer at the same port ([::1], localhost) gets nothing, the server proven or not.
// A frame in the app's page (a project's app, as Preview shows it) can't send the page anywhere, not
// even to the app's own address; the page itself still can. And the gate's own decisions: a proof
// that isn't answered in time is tried again and never taken for another program's; addresses.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { createRequire } from 'node:module'
import { checks, electronBin, until, sleep, ROOT, TEST } from '../lib/harness.mjs'

const { ok, skip, done } = checks('app-gate')
const require = createRequire(import.meta.url)
const servergate = require(path.join(ROOT, 'desktop', 'servergate.js'))
const windowAuth = require(path.join(ROOT, 'desktop', 'windowauth.js'))

// ---------- The gate's decisions (no Electron) ----------
{
  const { isServer, isAlias } = servergate.addresses(() => [7999, 7433])
  const server = ['http://127.0.0.1:7999/', 'ws://127.0.0.1:7999/api/agents/w1%3Ap1/tty', 'wss://127.0.0.1:7999/', 'http://127.0.0.1:7433/m/desk1/']
  const alias = ['http://[::1]:7999/', 'http://localhost:7999/', 'ws://localhost:7999/api/agents/x/tty', 'http://m-1.localhost:7999/', 'http://0.0.0.0:7999/', 'http://127.0.0.2:7999/', 'http://[::ffff:127.0.0.1]:7999/', 'http://LOCALHOST:7433/']
  const neither = ['http://localhost:5173/', 'http://127.0.0.1:5173/', 'https://example.com/', 'data:text/html,hi', 'file:///etc/hosts']
  ok(server.every(isServer) && !server.some(isAlias) && alias.every(isAlias) && !alias.some(isServer) && !neither.some((u) => isServer(u) || isAlias(u)), 'the app\'s address: 127.0.0.1 at its server\'s port or a linked computer\'s, a page or a WebSocket; another name for this computer at one of them is an alias; a project\'s app at another port neither', { server: server.map(isServer), alias: alias.map(isAlias), neither: neither.map((u) => isServer(u) || isAlias(u)) })

  // Slow, then answered: tried again (no answer isn't another program's), and once proven, held windows hear.
  let said = ['slow', 'slow', 'ok']
  let proofs = 0
  let back = 0
  const g = servergate.create({ bundled: true, isServer, isAlias, prove: async () => { proofs++; return said.shift() ?? 'slow' }, patience: [1, 1, 1], wait: async () => {} })
  g.onProven(() => { back++ })
  const first = await g.check()
  ok(first === true && proofs === 3 && g.last === 'ok' && back === 1, 'a proof not answered in time is tried again: answered, the server is proven, and windows held back are told', { first, proofs, last: g.last, back })
  g.set(false)
  said = []
  proofs = 0
  const slow = await g.check()
  ok(slow === false && proofs === 4 && g.last === 'slow' && !g.wrong(), 'never answered in time (about 15 s): not proven, and not taken for another program\'s', { slow, proofs, last: g.last })
  said = ['wrong']
  proofs = 0
  const wrong = await g.check()
  ok(wrong === false && proofs === 1 && g.wrong(), 'a wrong answer: another program\'s, at once', { wrong, proofs })
  said = ['ok']
  await g.check()
  const aliasProven = await g.request({ url: 'http://[::1]:7999/', resourceType: 'mainFrame' })
  const dev = servergate.create({ bundled: false, isServer, isAlias, prove: async () => false })
  const aliasDev = await dev.request({ url: 'http://localhost:7999/api/config', resourceType: 'xhr' })
  const projectDev = await dev.request({ url: 'http://localhost:5173/', resourceType: 'subFrame' })
  ok(aliasProven.cancel && aliasDev.cancel && !projectDev.cancel && g.blocked(-20, 'http://localhost:7999/') && dev.blocked(-20, 'http://[::1]:7999/') && !dev.blocked(-20, 'http://127.0.0.1:7999/'), 'an alias is refused with the server proven, and from source too; a project\'s app at its own port isn\'t', { aliasProven, aliasDev, projectDev })

  // The proof itself (windowauth.js): nothing there, no answer in time, an answer without the secret.
  const closed = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
  const silent = net.createServer(() => {}).listen(0, '127.0.0.1')
  const other = http.createServer((_q, s) => { s.setHeader('content-type', 'application/json'); s.end('{"mac":"not-it"}') }).listen(0, '127.0.0.1')
  await sleep(100)
  const launch = 'a'.repeat(43)
  const v = {
    down: await windowAuth.proof({ port: closed, launch }),
    slow: await windowAuth.proof({ port: silent.address().port, launch, timeout: 300 }),
    wrong: await windowAuth.proof({ port: other.address().port, launch }),
  }
  silent.close(); other.close()
  ok(v.down === 'down' && v.slow === 'slow' && v.wrong === 'wrong', 'the proof says which: nothing there, no answer in time, or an answer without the secret', v)
}

// ---------- Started only as it was built (desktop/startgate.js, desktop/rootlist.js) ----------
{
  const startGate = require(path.join(ROOT, 'desktop', 'startgate.js'))
  // Every switch is refused but what macOS adds itself: DevTools', a proxy, a proxy script, a log of
  // what's sent, other name lookups, another profile, the stand-in keychain, Node's inspector, one
  // nobody has heard of; written --x, -x, and /x on Windows.
  const refused = ['--remote-debugging-port=9222', '-remote-debugging-port=0', '--remote-debugging-pipe', '--remote-allow-origins=*', '--use-mock-keychain', '--inspect', '--INSPECT-PORT=0',
    '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--proxy-pac-url=file:///p.pac', '--log-net-log=/tmp/n.json', '--net-log-capture-mode=Everything', '--host-resolver-rules=MAP * 1.2.3.4', '--user-data-dir=/tmp/p', '--no-sandbox', '--a-new-one']
  const fine = [['-psn_0_12345'], ['-NSDocumentRevisionsDebugMode', 'YES'], ['-AppleLanguages', '(en)'], ['/Users/me/a file.txt'], ['bridge-ai://open'], []]
  const each = refused.map((a) => startGate.given({ argv: [a], platform: 'darwin' }).length === 1)
  const winSlash = startGate.given({ argv: ['/remote-debugging-port=1'], platform: 'win32' })
  const winPsn = startGate.given({ argv: ['-psn_0_1'], platform: 'win32' })
  const env = startGate.envGiven({ ELECTRON_ENABLE_LOGGING: '1', ELECTRON_LOG_FILE: '/tmp/e.log', NODE_USE_ENV_PROXY: '1', BRIDGE_HOME: '/tmp/x' })
  ok(each.every(Boolean) && fine.every((a) => !startGate.given({ argv: a, platform: 'darwin' }).length) && winSlash.length === 1 && winPsn.length === 1 && env.join() === 'ELECTRON_ENABLE_LOGGING,ELECTRON_LOG_FILE,NODE_USE_ENV_PROXY' && !startGate.envGiven({ ELECTRON_ENABLE_LOGGING: '' }).length, 'a built app refuses every switch (a proxy, a net log, other name lookups, another profile, DevTools, the stand-in keychain, Node\'s inspector, one nobody has heard of) but what macOS adds, and Electron\'s logging or Node\'s proxy from the environment', { each, winSlash, winPsn, env })
  // Only the smoke test's own Mac build (its bundle id, in its signed Info.plist) is let through.
  const res = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-gate-plist-'))
  fs.mkdirSync(path.join(res, 'Resources'))
  const plist = (id) => fs.writeFileSync(path.join(res, 'Info.plist'), `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key>\n<string>${id}</string></dict></plist>`)
  plist('dev.bridge-ai.smoke')
  const smokeId = startGate.bundleId({ resources: path.join(res, 'Resources'), platform: 'darwin' })
  plist('dev.bridge-ai.app')
  const appId = startGate.bundleId({ resources: path.join(res, 'Resources'), platform: 'darwin' })
  fs.rmSync(res, { recursive: true, force: true })
  ok(startGate.smokeBuild(smokeId) && !startGate.smokeBuild(appId) && !startGate.smokeBuild(null) && startGate.bundleId({ resources: res, platform: 'win32' }) === null, 'only the smoke test\'s own Mac build (dev.bridge-ai.smoke) is let start with switches', { smokeId, appId })

  // The app's own copy, as built (rootlist.js): changed, added or taken away is caught; the other
  // chip's packages and dot files may be missing; Finder's .DS_Store files are ignored; programs are
  // listed, not hashed.
  const rootlist = require(path.join(ROOT, 'desktop', 'rootlist.js'))
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-root-'))
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true }); fs.writeFileSync(path.join(r, rel), body) }
  put('server/index.js', 'export const x = 1\n')
  put('node_modules/a/index.js', 'module.exports = 1\n')
  put('node_modules/a/.gitkeep', '')
  put('node_modules/tool-darwin-x64/package.json', JSON.stringify({ name: 'tool-darwin-x64', os: ['darwin'], cpu: ['x64'] }))
  put('node_modules/tool-darwin-x64/bin', 'x64 bits')
  put('native/bin/helper', Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3]))
  fs.symlinkSync('../a/index.js', path.join(r, 'node_modules', 'a', 'link.js'))
  const list = await rootlist.make(r)
  const as = async (fn) => { fn?.(); return rootlist.verify(r, list, { arch: 'arm64' }) }
  const same = await as()
  const otherChipGone = await as(() => { fs.rmSync(path.join(r, 'node_modules', 'tool-darwin-x64'), { recursive: true }); fs.rmSync(path.join(r, 'node_modules', 'a', '.gitkeep')); put('server/.DS_Store', 'finder') })
  const signed = await as(() => put('native/bin/helper', Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 9, 9, 9, 9])))
  const changed = await as(() => put('server/index.js', 'export const x = 2\n'))
  put('server/index.js', 'export const x = 1\n')
  const added = await as(() => put('server/index', 'shadow'))
  fs.rmSync(path.join(r, 'server', 'index'))
  const missing = await as(() => fs.rmSync(path.join(r, 'node_modules', 'a', 'index.js')))
  put('node_modules/a/index.js', 'module.exports = 1\n')
  const notProgram = await as(() => put('native/bin/helper', '#!/bin/sh\necho hi\n'))
  const thisChip = await rootlist.verify(r, list, { arch: 'x64' })
  fs.rmSync(r, { recursive: true, force: true })
  ok(same.ok && otherChipGone.ok && signed.ok && !changed.ok && changed.changed.includes('server/index.js') && !added.ok && added.added.includes('server/index') && !missing.ok && missing.missing.includes('node_modules/a/index.js') && !notProgram.ok && notProgram.changed.includes('native/bin/helper') && !thisChip.ok && thisChip.missing.some((f) => f.startsWith('node_modules/tool-darwin-x64/')),
    'the app\'s own copy as built: a file changed, one added beside it (that would be loaded first) or one taken away is caught, and a program replaced by a script; the other chip\'s package, a dot file and Finder\'s .DS_Store aren\'t; a signed program\'s bytes aren\'t hashed; this chip\'s package taken away is', { same: same.ok, otherChipGone, signed: signed.ok, changed: changed.changed, added: added.added, missing: missing.missing, notProgram: notProgram.changed, thisChip: thisChip.missing })

  // main.js checks the switches first of all; the keys never open and no server starts while the
  // copy isn't as built; the archive is checked by Electron and the only place the app loads from;
  // the list goes in the archive; DevTools aren't in a built app's menu; no release is the smoke
  // test's build.
  const mainJs = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8')
  const firstRequire = /require\('\.\/([\w]+)\.js'\)/.exec(mainJs)?.[1]
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'))
  const workflows = fs.readdirSync(path.join(ROOT, '.github', 'workflows')).map((f) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8')).join('\n')
  const stage = fs.readFileSync(path.join(ROOT, 'desktop', 'stage.js'), 'utf8')
  const wired = {
    first: firstRequire === 'startgate' && /require\('\.\/startgate\.js'\)\.check\(\{\n\s+app,/.test(mainJs),
    keys: /const appKeys = \(\) => \{\n\s+if \(!rootOk\) throw/.test(mainJs) && /let rootOk = !BUNDLED/.test(mainJs),
    server: /async function startServer\(\) \{\n\s+if \(BUNDLED && \(!rootOk \|\| Date\.now\(\) - rootAt > 10000\) && !\(await checkRoot\(\)\)\) \{/.test(mainJs),
    atStart: /await checkRoot\(\)\n\s+windowsSendSecret\(\)\n\s+createWindow\(\)/.test(mainJs),
    connect: /async function connect\(\) \{\n[^]*?if \(BUNDLED && !rootOk && !\(await checkRoot\(\)\)\) return win\.loadURL\(splash\(CHANGED\(\)\)\)\n[^]*?replaceStale/.test(mainJs),
    fuses: pkg.build.electronFuses.enableEmbeddedAsarIntegrityValidation === true && pkg.build.electronFuses.onlyLoadAppFromAsar === true,
    packed: ['startgate.js', 'rootlist.js', 'app-root.list'].every((f) => pkg.build.files.includes(f)) && /require\('\.\/rootlist\.js'\)\.make\(OUT\)/.test(stage),
    devTools: /\.\.\.\(app\.isPackaged \? \[\] : \[\{ role: 'toggleDevTools' \}\]\)/.test(mainJs) && (mainJs.match(/toggleDevTools|openDevTools/g) || []).length === 1,
    release: pkg.build.appId === 'dev.bridge-ai.app' && !/dev\.bridge-ai\.smoke/.test(workflows),
  }
  ok(Object.values(wired).every(Boolean), 'main.js refuses switches first of all and opens no keys and starts no server unless its copy is as built; the archive is checked and the only place it loads from; DevTools only from source; no release is the smoke test\'s build', wired)
}

// ---------- In Electron ----------
const electron = electronBin()
if (!electron || (process.platform === 'linux' && !process.env.DISPLAY)) skip('the gate in Electron', !electron ? 'Electron isn\'t installed (npm install in desktop/)' : 'no screen')
else {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-app-gate-'))
  let el = null
  try {
    const { _electron } = await import('playwright-core')
    const env = { ...process.env, GATE_DATA: data }
    delete env.ELECTRON_RUN_AS_NODE
    el = await _electron.launch({ executablePath: electron, args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), path.join(TEST, 'stand-ins', 'gate-windows.cjs')], env, timeout: 60000 })
    await until(() => el.evaluate(() => !!globalThis.ready), 20000, 200)
    const ports = await el.evaluate(() => globalThis.ports)
    const A = `http://127.0.0.1:${ports.app}`
    const run = (fn, arg) => el.evaluate(fn, arg)
    const seen = () => run(() => globalThis.seen.slice())
    const clear = () => run(() => { globalThis.seen.length = 0; globalThis.blocked.length = 0 })
    const load = (url) => run(async (_e, u) => { await globalThis.win.loadURL(u).catch(() => {}); return globalThis.win.webContents.getURL() }, url)
    const title = () => run(() => globalThis.win.webContents.executeJavaScript('document.title').catch(() => ''))
    // From the page in the window: its API, and a terminal's WebSocket, each at an address.
    const tries = (api, ws) => run((_e, [a, w]) => globalThis.win.webContents.executeJavaScript(`new Promise((res) => {
      const out = {}
      fetch(${JSON.stringify(a)}).then((r) => { out.api = r.status }, () => { out.api = 'refused' })
      const s = new WebSocket(${JSON.stringify(w)})
      s.onopen = () => { out.ws = 'open'; s.close() }
      s.onerror = () => { out.ws = 'refused' }
      setTimeout(() => res(out), 1500)
    })`), [api, ws])

    // Not proven (another program's answer): the page held back, and from a page elsewhere, the API
    // and a terminal's WebSocket refused; the server hears nothing.
    await clear()
    await load(`${A}/`)
    await sleep(300)
    const heldBlocked = await run(() => globalThis.blocked.slice())
    await load('data:text/html,<title>elsewhere</title>')
    const before = await tries(`${A}/api/config`, `ws://127.0.0.1:${ports.app}/api/agents/w1%3Ap1/tty`)
    const heardBefore = (await seen()).filter((s) => s.startsWith('S '))
    ok(heldBlocked.includes(`${A}/`) && before.api === 'refused' && before.ws === 'refused' && !heardBefore.length, 'not proven: its page held back, and its API and a terminal\'s WebSocket refused; it hears nothing', { heldBlocked, before, heardBefore })

    // Proven: the page, its API and the WebSocket go.
    await run(() => { globalThis.proveAs = 'ok' })
    await clear()
    const at = await load(`${A}/`)
    const t1 = await title()
    const after = await tries(`${A}/api/config`, `ws://127.0.0.1:${ports.app}/api/agents/w1%3Ap1/tty`)
    ok(at === `${A}/` && t1 === 'APP' && after.api === 200 && after.ws === 'open' && (await seen()).some((s) => s.startsWith('S ws ')), 'proven: its page, its API and a terminal\'s WebSocket', { at, t1, after, heard: await seen() })

    // Its feed gone (main.js serverGone): a terminal reconnecting is refused until it proves itself again.
    await run(() => { globalThis.gate.set(false); globalThis.proveAs = 'wrong' })
    await clear()
    const again = await tries(`${A}/api/config`, `ws://127.0.0.1:${ports.app}/api/agents/w1%3Ap1/tty`)
    ok(again.api === 'refused' && again.ws === 'refused' && !(await seen()).some((s) => s.startsWith('S ws ')), 'its feed gone: a terminal reconnecting is refused, and so is its API, until it proves itself again', again)
    await run(() => { globalThis.proveAs = 'ok' })
    await load(`${A}/`)

    // Another name for this computer at the same port, the server proven: refused, as a page, its API
    // or a WebSocket, and that program hears nothing.
    if (!ports.other) skip('another program at [::1]', 'this computer has no IPv6 loopback')
    else {
      await clear()
      const aliasTries = await tries(`http://[::1]:${ports.app}/api/config`, `ws://localhost:${ports.app}/api/agents/w1%3Ap1/tty`)
      const aliasAt = await load(`http://[::1]:${ports.app}/`)
      const aliasTitle = await title()
      const heard = (await seen()).filter((s) => s.startsWith('OTHER'))
      ok(aliasTries.api === 'refused' && aliasTries.ws === 'refused' && aliasTitle !== 'OTHER' && !heard.length, 'another program at [::1] (or localhost) at the app\'s port, the server proven: its page, its API and a WebSocket refused, and it hears nothing', { aliasTries, aliasAt, aliasTitle, heard })
      await load(`${A}/`)
    }

    // A page of the app's address that answers with a redirect (as a linked computer's page can): out
    // of the app (a project's app at another port, a site), refused and opened in its own app instead;
    // within it, followed.
    const P = `http://127.0.0.1:${ports.project}`
    const redirected = {}
    for (const [name, to] of [['project', `${P}/landed`], ['site', 'https://example.invalid/'], ['own', `${A}/?landed=1`]]) {
      await load(`${A}/`)
      await clear()
      await run(() => { globalThis.opened.length = 0 })
      const at = await load(`${A}/go?to=${encodeURIComponent(to)}`)
      redirected[name] = { at, opened: await run(() => globalThis.opened.slice()), heard: (await seen()).filter((s) => s.startsWith('P ')) }
    }
    ok(redirected.project.at === `${A}/` && redirected.project.opened[0] === `${P}/landed` && !redirected.project.heard.length && redirected.site.at === `${A}/` && redirected.site.opened[0] === 'https://example.invalid/' && redirected.own.at === `${A}/?landed=1` && !redirected.own.opened.length, 'a redirect out of the app (a project\'s app, a site): refused, and opened in its own app instead; one within it followed', redirected)

    // A frame in the app's page (a project's app, as Preview shows it, sandboxed or not) sending the
    // page elsewhere when clicked: to another program's address, or even the app's own: refused.
    const frameTries = {}
    for (const [name, to] of [['other', `http://[::1]:${ports.app}/evil`], ['own', `${A}/?from-frame=1`], ['site', 'http://localhost:5173/']]) {
      await load(`${A}/?frame=${encodeURIComponent(`${P}/frame?to=${encodeURIComponent(to)}`)}`)
      await until(() => run(() => globalThis.win.webContents.mainFrame.frames.length > 0), 5000, 100)
      await sleep(300)
      await clear()
      await run(() => {
        globalThis.win.webContents.sendInputEvent({ type: 'mouseDown', x: 100, y: 100, button: 'left', clickCount: 1 })
        globalThis.win.webContents.sendInputEvent({ type: 'mouseUp', x: 100, y: 100, button: 'left', clickCount: 1 })
      })
      await sleep(1200)
      frameTries[name] = { at: await run(() => globalThis.win.webContents.getURL()), heard: await seen() }
    }
    const stayed = Object.values(frameTries).every((f) => f.at.startsWith(`${A}/?frame=`) && !f.heard.some((s) => s.startsWith('OTHER') || s.includes('from-frame')))
    // ...while the page itself still goes where it goes.
    await run(() => globalThis.win.webContents.executeJavaScript(`location.href = '/?moved=1'`).catch(() => {}))
    await sleep(800)
    const moved = await run(() => globalThis.win.webContents.getURL())
    ok(stayed && moved === `${A}/?moved=1`, 'a frame in the app\'s page can\'t send it anywhere, not to another program at [::1], the app\'s own address or a site; the page itself still can', { frameTries, moved })
  } catch (e) {
    ok(false, `crashed: ${e.message}`)
    console.log(e.stack)
  } finally {
    await el?.close().catch(() => {})
    fs.rmSync(data, { recursive: true, force: true })
  }
}

process.exit(done().fail ? 1 : 0)
