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
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
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
  const bridge = startGate.envGiven({ BRIDGE_HOME: '/tmp/x', BRIDGE_PORT: '7999', BRIDGE_ROOT: '/tmp/clone', BRIDGE_DEV: '1', BRIDGE_FIX_DRYRUN: '1', BRIDGE_SIGNHELPER: '/bin/echo', BRIDGE_KEYS: '/bin/echo', BRIDGE_CALLWATCH: '/bin/echo', BRIDGE_SHERPA: '/x' }, 'darwin')
  const linuxProxy = startGate.envGiven({ http_proxy: 'http://p', HTTPS_PROXY: 'http://p', No_Proxy: 'x', ALL_PROXY: 'socks5://p' }, 'linux')
  const macProxy = startGate.envGiven({ HTTPS_PROXY: 'http://p', no_proxy: 'x' }, 'darwin')
  ok(bridge.join() === 'BRIDGE_CALLWATCH,BRIDGE_DEV,BRIDGE_FIX_DRYRUN,BRIDGE_KEYS,BRIDGE_ROOT,BRIDGE_SHERPA,BRIDGE_SIGNHELPER' && linuxProxy.length === 4 && !macProxy.length, 'every BRIDGE_ setting is refused but BRIDGE_HOME and BRIDGE_PORT (another copy, development mode, the tests\' stand-ins, other helpers); on Linux a proxy from the environment too, written any way', { bridge, linuxProxy, macProxy })
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
  const otherChipGone = await as(() => { fs.rmSync(path.join(r, 'node_modules', 'tool-darwin-x64'), { recursive: true }); put('server/.DS_Store', 'finder') })
  const dotGone = await as(() => fs.rmSync(path.join(r, 'node_modules', 'a', '.gitkeep')))
  put('node_modules/a/.gitkeep', '')
  let asked = null
  const unsigned = await rootlist.verify(r, list, { arch: 'arm64', programs: async (rels) => { asked = rels; return rels } })
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
  ok(same.ok && otherChipGone.ok && !dotGone.ok && dotGone.missing.includes('node_modules/a/.gitkeep') && !unsigned.ok && unsigned.changed.includes('native/bin/helper') && asked?.join() === 'native/bin/helper' && signed.ok && !changed.ok && changed.changed.includes('server/index.js') && !added.ok && added.added.includes('server/index') && !missing.ok && missing.missing.includes('node_modules/a/index.js') && !notProgram.ok && notProgram.changed.includes('native/bin/helper') && !thisChip.ok && thisChip.missing.some((f) => f.startsWith('node_modules/tool-darwin-x64/')),
    'the app\'s own copy as built: a file changed, one added beside it (that would be loaded first) or one taken away (a dot file too) is caught, a program replaced by a script, or one not signed as the app is; the other chip\'s package and Finder\'s .DS_Store aren\'t; a signed program\'s bytes aren\'t hashed; this chip\'s package taken away is', { same: same.ok, otherChipGone, dotGone: dotGone.missing, unsigned: unsigned.changed, signed: signed.ok, changed: changed.changed, added: added.added, missing: missing.missing, notProgram: notProgram.changed, thisChip: thisChip.missing })

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
    builtAlone: /const BUNDLED = app\.isPackaged\n/.test(mainJs) && /const ROOT = app\.isPackaged \? path\.join\(process\.resourcesPath, 'app-root'\)/.test(mainJs) && /const DEV = !app\.isPackaged && /.test(mainJs),
    serverStart: /BUNDLED \? serverFlags\.serverEnv\(process\.env, \{ smoke: SMOKE_BUILD \}\)/.test(mainJs) && /\[NODE_BIN, serverFlags\.serverArgs\(ROOT\)\]/.test(mainJs) && /appKeys\(\)\.forStart\(\{ code: codeReq\(\) \}\)/.test(mainJs),
    rootCode: (mainJs.match(/import\(require\('node:url'\)\.pathToFileURL\(path\.join\(ROOT/g) || []).length === 1 && /const rootImport = \(rel\) => \(rootOk \?/.test(mainJs) && (mainJs.match(/rootImport\(path\.join\('shared'/g) || []).length === 3 && /if \(rootOk\) \{\n\s+dictation\.start\(/.test(mainJs) && /bin: \(\) => \(!rootOk \? null/.test(mainJs),
    programs: /const programs = req \? \(rels\) => codesig\.failing\(/.test(mainJs),
    serverSide: /^import '\.\/lockdown\.js'\nimport \{ appKeys \} from '\.\/appkeys\.js'/m.test(fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8')) && /const bin = await trusted\(\)/.test(fs.readFileSync(path.join(ROOT, 'server', 'signhelper.js'), 'utf8')) && /trusted\(\)\.then\(\(bin\) =>/.test(fs.readFileSync(path.join(ROOT, 'server', 'signhelper.js'), 'utf8')) && /    code: typeof j\?\.code === 'string'/.test(fs.readFileSync(path.join(ROOT, 'server', 'appkeys.js'), 'utf8')),
  }
  ok(Object.values(wired).every(Boolean), 'main.js refuses switches first of all and opens no keys and starts no server unless its copy is as built; the archive is checked and the only place it loads from; DevTools only from source; no release is the smoke test\'s build', wired)
}

// ---------- The server's environment, and only its own code (desktop/serverflags.js, server/lockdown.js) ----------
{
  const flags = require(path.join(ROOT, 'desktop', 'serverflags.js'))
  const given = { PATH: '/usr/bin', HOME: '/Users/me', USER: 'me', LOGNAME: 'me', SHELL: '/bin/zsh', LANG: 'en_GB.UTF-8', LC_ALL: 'en_GB.UTF-8', TMPDIR: '/tmp/x', TERM: 'xterm', SSH_AUTH_SOCK: '/tmp/ssh', HTTPS_PROXY: 'http://p',
    ELECTRON_RUN_AS_NODE: '1', BRIDGE_WINDOW_FD: '3', BRIDGE_HOME: '/tmp/h', BRIDGE_PORT: '7999', BRIDGE_ROOT: '/tmp/clone', BRIDGE_FIX_DRYRUN: '1', BRIDGE_SIGNHELPER: '/bin/echo', BRIDGE_SHERPA: '/x', NODE_PATH: '/tmp/np', NODE_OPTIONS: '--require x', DYLD_INSERT_LIBRARIES: '/x.dylib', ELECTRON_ENABLE_LOGGING: '1', SOMETHING: 'else' }
  const mac = flags.serverEnv(given, { platform: 'darwin' })
  const smoke = flags.serverEnv(given, { platform: 'darwin', smoke: true })
  const linux = flags.serverEnv({ ...given, http_proxy: 'http://p', DISPLAY: ':0' }, { platform: 'linux' })
  const win = flags.serverEnv({ SystemRoot: 'C:\\Windows', Path: 'C:\\x', APPDATA: 'C:\\a', NODE_PATH: 'C:\\np', BRIDGE_ROOT: 'C:\\c' }, { platform: 'win32' })
  const keptMac = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'SSH_AUTH_SOCK', 'HTTPS_PROXY', 'ELECTRON_RUN_AS_NODE', 'BRIDGE_WINDOW_FD', 'BRIDGE_HOME', 'BRIDGE_PORT', 'WS_NO_BUFFER_UTIL', 'WS_NO_UTF_8_VALIDATE', 'NO_PROXY', 'no_proxy']
  ok(Object.keys(mac).sort().join() === keptMac.sort().join() && mac.WS_NO_BUFFER_UTIL === '1' && smoke.BRIDGE_FIX_DRYRUN === '1' && !smoke.NODE_PATH && !linux.http_proxy && !linux.HTTPS_PROXY && linux.DISPLAY === ':0' && win.SystemRoot && win.Path && win.APPDATA && !win.NODE_PATH && !win.BRIDGE_ROOT,
    'the built app\'s server gets only what it and what it starts need: where you are, your SSH agent and proxy, Windows\' and a Linux desktop\'s own, the app\'s pipe, data folder and port; never NODE_PATH, NODE_OPTIONS, another copy, the tests\' stand-ins or anything else (the smoke test\'s build passes its own on); ws\'s native parts off', { mac: Object.keys(mac), linux: Object.keys(linux), win: Object.keys(win) })
  // This computer's own addresses never through a proxy, with what NO_PROXY said kept.
  const noProxy = flags.serverEnv({ PATH: '/usr/bin', HTTPS_PROXY: 'http://p', NO_PROXY: 'corp.example, 10.0.0.0/8' }, { platform: 'darwin' })
  const noProxyWin = flags.serverEnv({ Path: 'C:\\x' }, { platform: 'win32' })
  ok(noProxy.NO_PROXY === 'corp.example,10.0.0.0/8,localhost,127.0.0.1,::1' && noProxy.no_proxy === noProxy.NO_PROXY && noProxyWin.NO_PROXY === 'localhost,127.0.0.1,::1', 'the server\'s NO_PROXY always has this computer\'s own addresses, with what it said kept', { mac: noProxy.NO_PROXY, win: noProxyWin.NO_PROXY })
  const args = flags.serverArgs('/Applications/Bridge AI.app/Contents/Resources/app-root')
  ok(args[0] === '--disable-sigusr1' && args[1] === '--import' && /\/server\/lockdown\.js$/.test(args[2]) && /\/server\/index\.js$/.test(args[3]), 'the server is started with lockdown.js loaded before anything of its own', args)

  // The terminal host starts on the app's Node as the server does (its flags, lockdown.js first), and
  // no process of the server's is forked or started with an empty execArgv in place of the server's
  // own (it would lose lockdown.js).
  const pathsJs = fs.readFileSync(path.join(ROOT, 'server', 'paths.js'), 'utf8')
  const hostJs = fs.readFileSync(path.join(ROOT, 'server', 'runtime', 'hostlink.js'), 'utf8')
  const serverFiles = (function list(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(path.join(d, e.name)) : /\.[cm]?js$/.test(e.name) ? [path.join(d, e.name)] : [])) })(path.join(ROOT, 'server'))
  const emptyArgv = serverFiles.filter((f) => /execArgv\s*:\s*\[\s*\]/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f))
  ok(/export const OWN_NODE_FLAGS = IN_APP \? \['--disable-sigusr1', '--import', pathToFileURL\(path\.join\(ROOT, 'server', 'lockdown\.js'\)\)\.href\] : \[\]/.test(pathsJs) && /spawn\(NODE\.bin, \[\.\.\.OWN_NODE_FLAGS, HOST_JS, DIR, sock\]/.test(hostJs) && !emptyArgv.length, 'the terminal host starts with the server\'s own flags and lockdown.js, and nothing of the server\'s is started with an empty execArgv', { emptyArgv })

  // The keys file sealed for its data folder: another folder's copy of it is taken as one that won't
  // open (moved aside, no signatures' key); one from before takes this folder's.
  const windowAuth = require(path.join(ROOT, 'desktop', 'windowauth.js'))
  const kdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-keys-profile-'))
  const store = { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(`ENC:${t}`), decryptString: (b) => { const t = b.toString(); if (!t.startsWith('ENC:')) throw new Error('not ours'); return t.slice(4) } }
  const mine = path.join(kdir, 'a', 'signing-keys')
  const made = windowAuth.keysAt(mine, store, { profile: '/Users/me/.bridge-ai' })
  const sealedFor = JSON.parse(fs.readFileSync(mine).toString().slice(4)).profile
  const again = windowAuth.keysAt(mine, store, { profile: '/Users/me/.bridge-ai' })
  const theirs = path.join(kdir, 'b', 'signing-keys')
  fs.mkdirSync(path.dirname(theirs), { recursive: true })
  fs.copyFileSync(mine, theirs)
  const copied = windowAuth.keysAt(theirs, store, { profile: '/tmp/another' })
  const older = path.join(kdir, 'c', 'signing-keys')
  fs.mkdirSync(path.dirname(older), { recursive: true })
  fs.writeFileSync(older, store.encryptString(JSON.stringify({ window: 'w'.repeat(43), key: Buffer.alloc(32).toString('base64'), launch: null, state: null })))
  const old = windowAuth.keysAt(older, store, { profile: '/Users/me/.bridge-ai' })
  const stamped = JSON.parse(fs.readFileSync(older).toString().slice(4)).profile
  const facts = { sealedFor, again: again.window === made.window && !again.unreadable, copied: copied.unreadable && !fs.existsSync(theirs) && fs.existsSync(`${theirs}.unreadable`) && copied.window !== made.window, old: !old.unreadable && old.window === 'w'.repeat(43), stamped }
  fs.rmSync(kdir, { recursive: true, force: true })
  ok(facts.sealedFor === '/Users/me/.bridge-ai' && facts.again && facts.copied && facts.old && facts.stamped === '/Users/me/.bridge-ai', 'the app\'s keys are sealed for their data folder: opened there; a copy put in another folder taken as one that won\'t open (moved aside, no signatures\' key); one from before kept, and sealed for its folder as it\'s saved', facts)

  // The signing helper: the running process, by its pid, held to the app's signature before it's told
  // anything (auth, the trackpad); the app's requirement read from the app as it runs.
  const signJs = fs.readFileSync(path.join(ROOT, 'server', 'signhelper.js'), 'utf8')
  const mainSrc = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8')
  ok(/if \(args\[0\] !== 'probe' && !\(await runningHolds\(child\)\)\) \{ await answer; return null \}\n\s+child\.stdin\.end\(/.test(signJs) && /runningHolds\(started\)\.then\(\(ok\) => \{\n\s+if \(!ok\) \{ end\(\{ cancel: 'none' \}\); return \}\n\s+try \{ started\.stdin\.write\(/.test(signJs) && /if \(await holds\(child\.pid, req\)\) return true/.test(signJs) && /codesig\.requirementOf\(String\(process\.pid\)\)/.test(mainSrc),
    'the signing helper as it runs (its pid) is held to the app\'s signature before it\'s asked for Touch ID or the trackpad; the app\'s requirement is read from the app as it runs')

  // A package planted where Node would look for one the server's copy lacks (ws's bufferutil): in a
  // home folder, NODE_PATH and a parent folder of the copy, all scratch ones (never the real home).
  // On Electron's Node, as the built app runs the server: without lockdown.js each runs; with it, none.
  const electron = electronBin()
  if (!electron) skip('another program\'s package where the server would look for one', 'Electron isn\'t installed (npm install in desktop/)')
  else {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-lockdown-'))
    const home = path.join(t, 'home')
    const mark = path.join(t, 'ran.txt')
    const trap = (dir, where) => { fs.mkdirSync(path.join(dir, 'bufferutil'), { recursive: true }); fs.writeFileSync(path.join(dir, 'bufferutil', 'index.js'), `require('fs').appendFileSync(${JSON.stringify(mark)}, ${JSON.stringify(`${where}\n`)}); module.exports = {}`) }
    trap(path.join(home, '.node_modules'), 'home')
    trap(path.join(t, 'np'), 'NODE_PATH')
    trap(path.join(t, 'node_modules'), 'parent folder')
    const copy = path.join(t, 'app-root')
    fs.mkdirSync(path.join(copy, 'server'), { recursive: true })
    fs.copyFileSync(path.join(ROOT, 'server', 'lockdown.js'), path.join(copy, 'server', 'lockdown.js'))
    fs.writeFileSync(path.join(copy, 'package.json'), '{"type":"module"}')
    fs.cpSync(path.join(ROOT, 'node_modules', 'ws'), path.join(copy, 'node_modules', 'ws'), { recursive: true })
    fs.writeFileSync(path.join(copy, 'server', 'probe.cjs'), `let direct = 'loaded'
try { require('bufferutil') } catch (e) { direct = e.code || e.message }
const ws = require('ws')
process.stdout.write(JSON.stringify({ direct, ws: typeof ws.WebSocketServer }))`)
    const run = (lock, extraEnv = {}) => {
      fs.rmSync(mark, { force: true })
      const env = { PATH: process.env.PATH, HOME: home, NODE_PATH: path.join(t, 'np'), ELECTRON_RUN_AS_NODE: '1', ...extraEnv }
      const r = spawnSync(electron, [...(lock ? ['--import', pathToFileURL(path.join(copy, 'server', 'lockdown.js')).href] : []), path.join(copy, 'server', 'probe.cjs')], { env, encoding: 'utf8', cwd: path.join(copy, 'server'), timeout: 30000 })
      let out = null
      try { out = JSON.parse(r.stdout) } catch { out = { error: r.stderr.slice(-300) } }
      return { out, ran: fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim().split('\n') : [] }
    }
    const open = run(false)
    const locked = run(true)
    const lockedWs = run(true, { WS_NO_BUFFER_UTIL: '1', WS_NO_UTF_8_VALIDATE: '1' })
    fs.rmSync(t, { recursive: true, force: true })
    ok(open.ran.length > 0 && !locked.ran.length && locked.out?.direct === 'ERR_BRIDGE_OUTSIDE' && locked.out?.ws === 'function' && !lockedWs.ran.length && lockedWs.out?.ws === 'function',
      'another program\'s package where Node would look for one the server lacks (a home folder\'s .node_modules, NODE_PATH, a parent folder): run without lockdown.js; with it, none runs, asking for it is refused, and ws still loads', { open, locked, lockedWs })
  }
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
