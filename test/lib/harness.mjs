// What every test here shares: a Bridge AI server of its own (its own data folder and home, only
// the stand-ins and the system's own folders on PATH, so no real agent, model or account is ever
// reached), the stand-in model, a browser, and small helpers for checks.
//
// A suite is a script that exports run({ ok, kit, browser, ... }); test/run.mjs starts it with a
// port and collects what it says. Nothing here is Mac-only unless it says so.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const TEST = path.join(ROOT, 'test')
export const OUT = path.join(TEST, '.out')
export const IS_WIN = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// fn's value once it's truthy, or null after ms.
export async function until(fn, ms = 15000, step = 300) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await Promise.resolve().then(fn).catch(() => null)
    if (v) return v
    await sleep(step)
  }
  return null
}

// Checks: ok(condition, what it means, what was there instead). skip(what, why) for a check that
// doesn't apply on this platform, so the report says what wasn't tried.
export function checks(name) {
  const st = { pass: 0, fail: 0, skip: 0, failed: [] }
  const ok = (c, what, got) => {
    if (c) { st.pass++; return true }
    st.fail++
    const g = got === undefined ? '' : ` ${typeof got === 'string' ? got : JSON.stringify(got)}`.slice(0, 900)
    st.failed.push(what)
    console.log(`FAIL ${what}${g}`)
    return false
  }
  const skip = (what, why) => { st.skip++; console.log(`SKIP ${what}: ${why}`) }
  const done = () => { console.log(`${name}: ${st.pass} passed, ${st.fail} failed${st.skip ? `, ${st.skip} skipped` : ''}`); return st }
  return { ok, skip, done, st }
}

// The folders a test's server may find programs in: the stand-ins first, then the system's own.
// Never Homebrew, nvm or the user's own folders, where real agents live.
function systemPath() {
  if (IS_WIN) {
    const sr = process.env.SystemRoot || 'C:\\Windows'
    return [path.join(sr, 'System32'), sr, path.join(sr, 'System32', 'Wbem'), path.join(sr, 'System32', 'WindowsPowerShell', 'v1.0')]
  }
  return ['/usr/bin', '/bin', '/usr/sbin', '/sbin']
}

// The desktop app's Electron, which the app runs its server on (as Node, ELECTRON_RUN_AS_NODE):
// BRIDGE_TEST_ELECTRON, or the one in desktop/node_modules. null when neither is there.
export function electronBin() {
  if (process.env.BRIDGE_TEST_ELECTRON) return process.env.BRIDGE_TEST_ELECTRON
  try { const p = createRequire(path.join(ROOT, 'desktop', 'package.json'))('electron'); return typeof p === 'string' && fs.existsSync(p) ? p : null } catch { return null }
}

// A free port: asked of the system, so lanes running at once never collide.
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer()
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
    s.on('error', reject)
  })
}

// Stops a process and everything it started.
export function stopTree(pid) {
  if (!pid) return
  if (IS_WIN) { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); return }
  const kids = (p) => { const r = spawnSync('pgrep', ['-P', String(p)], { encoding: 'utf8' }); return (r.stdout || '').split('\n').filter(Boolean).map(Number) }
  const all = []
  const walk = (p) => { all.push(p); for (const k of kids(p)) walk(k) }
  walk(pid)
  for (const p of all.reverse()) { try { process.kill(p, 'SIGTERM') } catch { /* gone */ } }
}

// A server of its own. name: for its folder under test/.out. env: more settings for the server, or
// a function of the kit's folders ({ bin, data, home, PATH }) giving them. config: written to its
// config.json before it starts. node: what runs it, when not this Node.js (the app itself, as Node:
// electronBin()).
export async function startKit(name, { env = {}, config = {}, node = process.execPath } = {}) {
  const port = await freePort()
  const dir = path.join(OUT, 'kits', `${name}-${port}`)
  fs.rmSync(dir, { recursive: true, force: true })
  const home = path.join(dir, 'home')
  const data = path.join(dir, '.bridge-ai') // a dot folder, as ~/.bridge-ai is
  const bin = path.join(dir, 'bin')
  for (const d of [home, data, bin]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ keepAgents: false, ...config }))
  // A program on the server's PATH: a Node script, with a .cmd beside it on Windows. Its path.
  const program = (n, source) => {
    const js = path.join(bin, `${n}.cjs`)
    fs.writeFileSync(js, source)
    if (IS_WIN) { fs.writeFileSync(path.join(bin, `${n}.cmd`), `@"${process.execPath}" "${js}" %*\r\n`); return path.join(bin, `${n}.cmd`) }
    fs.writeFileSync(path.join(bin, n), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 })
    return path.join(bin, n)
  }
  const PATH = [bin, ...systemPath()].join(path.delimiter)
  const base = {
    PATH, BRIDGE_PATH: PATH, HOME: home, BRIDGE_HOME: data, BRIDGE_PORT: String(port), BRIDGE_RUNTIME: 'builtin',
    BRIDGE_FIX_DRYRUN: '1', LANG: 'en_US.UTF-8', TMPDIR: os.tmpdir(), USER: os.userInfo().username,
    BRIDGE_SUMMARY_RETRY_MS: '4000', BRIDGE_MODEL_RETRY_MS: '200',
    // No test ever runs a real installer or downloads Node.js: a stand-in installer runs instead
    // (stand-ins/installer.cjs, its commands in bin/installs.log), and nodejs.org is nowhere unless
    // a test gives a stand-in of its own.
    BRIDGE_INSTALL_STANDIN: program('installer', fs.readFileSync(path.join(TEST, 'stand-ins', 'installer.cjs'), 'utf8')),
    BRIDGE_NODE_DIST: 'http://127.0.0.1:9',
    // Nor a speech model (huggingface.co): downloads go nowhere, and fail at once. And what runs
    // Parakeet is a stand-in for sherpa-onnx's addon (stand-ins/sherpa.cjs), so no test loads one.
    BRIDGE_MODELS_URL: 'http://127.0.0.1:9',
    BRIDGE_SHERPA: path.join(TEST, 'stand-ins', 'sherpa.cjs'),
  }
  // Nor the Mac's own call's-sound recorder (native/calltap, in a checkout that built it): a
  // stand-in instead (stand-ins/calltap.cjs, its loudness in bin/calltap.json). Only on a Mac, as
  // in the app: elsewhere a meeting records the mic only.
  if (process.platform === 'darwin') base.BRIDGE_CALLTAP = program('calltap', fs.readFileSync(path.join(TEST, 'stand-ins', 'calltap.cjs'), 'utf8'))
  if (IS_WIN) Object.assign(base, { USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT, TEMP: os.tmpdir(), TMP: os.tmpdir() })
  else base.BRIDGE_SHELL = base.SHELL = '/bin/sh'
  const log = fs.openSync(path.join(dir, 'server.log'), 'w')
  const more = typeof env === 'function' ? env({ bin, data, home, PATH }) : env
  const url = `http://127.0.0.1:${port}`
  let server = null
  const run = async () => {
    server = spawn(node, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env: { ...base, ...more }, stdio: ['ignore', log, log] })
    const up = await until(async () => (await fetch(`${url}/api/config`)).ok, 60000, 250)
    if (!up) { stopTree(server.pid); throw new Error(`the server didn't start on ${port}: ${fs.readFileSync(path.join(dir, 'server.log'), 'utf8').slice(-1500)}`) }
  }
  await run()
  // Bridge AI quit and opened again, on the same folders (what it kept, it keeps).
  const restart = async () => {
    const was = server
    const gone = new Promise((r) => (was.exitCode != null ? r() : was.once('exit', r)))
    stopTree(was.pid)
    await gone
    await until(async () => !(await fetch(`${url}/api/config`).then(() => true, () => false)), 10000, 100)
    await run()
  }
  // api(path, body, method): the JSON back; a refusal throws with the server's own words.
  const api = async (p, body, method) => {
    const r = await fetch(`${url}/api${p}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, j })
    return j
  }
  return { port, url, dir, home, data, bin, api, program, restart, stop: () => stopTree(server.pid), log: () => fs.readFileSync(path.join(dir, 'server.log'), 'utf8') }
}

// A Mac with or without Apple's command line developer tools, whatever this one has: a stand-in
// xcode-select (stand-ins/xcode-select.cjs) in a kit's bin folder, put there before its server
// starts (startKit's env function), as the server asks it once and keeps a yes. installDevTools: they
// arrive (a folder with a git, where the stand-in says they are).
export function installDevTools(bin) {
  const dev = path.join(bin, 'devtools')
  fs.mkdirSync(path.join(dev, 'usr', 'bin'), { recursive: true })
  fs.writeFileSync(path.join(dev, 'usr', 'bin', 'git'), '#!/bin/sh\n', { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'devtools.txt'), dev)
}
export function devToolsStandIn(bin, { tools = false } = {}) {
  const js = path.join(bin, 'xcode-select.cjs')
  fs.copyFileSync(path.join(TEST, 'stand-ins', 'xcode-select.cjs'), js)
  fs.writeFileSync(path.join(bin, 'xcode-select'), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 })
  if (tools) installDevTools(bin)
}

// A relay on this computer (stand-ins/relay.mjs: the real relay, run in Node), for pairing and
// linking devices with nothing leaving the machine. relayFile: what a kit's relay.json needs to use
// it. freeze/thaw/drop: what a sleeping Mac or a changed network does to its connections.
export async function startRelay(name) {
  const port = await freePort()
  const token = `test-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  const log = path.join(OUT, 'kits', `${name}-relay-${port}.log`)
  fs.mkdirSync(path.dirname(log), { recursive: true })
  const out = fs.openSync(log, 'w')
  const p = spawn(process.execPath, [path.join(TEST, 'stand-ins', 'relay.mjs'), String(port), token], { stdio: ['ignore', out, out] })
  const url = `http://127.0.0.1:${port}`
  if (!await until(async () => (await fetch(`${url}/_relay/health`)).ok, 15000, 150)) throw new Error(`the relay stand-in didn't start: ${fs.readFileSync(log, 'utf8').slice(-800)}`)
  const ctl = (what) => fetch(`${url}/_test/${what}`, { method: what === 'state' ? 'GET' : 'POST' }).then((r) => r.json())
  return {
    url, port, token,
    relayFile: { url, token },
    freeze: () => ctl('freeze'), thaw: () => ctl('thaw'), drop: () => ctl('drop'), state: () => ctl('state'),
    stop: () => stopTree(p.pid),
  }
}

// The stand-in model provider (stand-ins/model.mjs) on a port of its own, with its log.
export async function startModel(name) {
  const port = await freePort()
  const log = path.join(OUT, 'kits', `${name}-model-${port}.log`)
  fs.mkdirSync(path.dirname(log), { recursive: true })
  fs.rmSync(log, { force: true })
  const p = spawn(process.execPath, [path.join(TEST, 'stand-ins', 'model.mjs'), String(port), log], { stdio: 'ignore' })
  const url = `http://127.0.0.1:${port}`
  if (!await until(async () => (await fetch(`${url}/v1/models`)).ok, 15000, 200)) throw new Error('the stand-in model didn\'t start')
  // What was asked of it: the user's words in each chat request, oldest first.
  const asked = (re) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter((x) => x?.messages)
    .map((x) => x.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')).filter((t) => !re || re.test(t))
  // What it was sent to transcribe: { stt: n, bytes, prompt } each, oldest first.
  const heard = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter((x) => x?.stt)
  return { port, url, asked, heard, stop: () => stopTree(p.pid) }
}

// The browser (Playwright's Chromium unless BRIDGE_TEST_BROWSER says webkit), with a fake mic.
export async function browser() {
  const pw = await import('playwright-core')
  const which = process.env.BRIDGE_TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium'
  const b = await pw[which].launch(which === 'chromium' ? { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } : {})
  return { b, which }
}
// A page with Bridge AI's tour done and a look picked: { mode, theme }; phone: a phone's screen and
// touch. store: more of the page's saved state, there before it opens (a reload to change it would
// cut off its requests, which WebKit reports as page errors). before(ctx): routes of the test's own,
// in place before it opens (WebKit doesn't apply ones added after). Calls that would reach the
// internet (news, markets, weather, mail) are turned away.
export async function page(b, url, { mode = 'light', theme = 'sky', width = 1440, height = 900, phone = false, mic = true, store = {}, before, locale } = {}) {
  const ctx = await b.newContext({ viewport: phone ? { width: 390, height: 844 } : { width, height }, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}), colorScheme: mode, ...(locale ? { locale } : {}), ...(mic && b.browserType().name() === 'chromium' ? { permissions: ['microphone'] } : {}) })
  await ctx.addInitScript(({ look, more }) => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-appearance', JSON.stringify({ ...look, text: 'm' })); for (const [k, v] of Object.entries(more)) localStorage.setItem(k, JSON.stringify(v)) } catch { /* no storage */ } }, { look: { mode, theme }, more: store })
  // Playwright's own WebKit build freezes the whole page on pushManager.getSubscription() (Settings ›
  // Devices asks it, for "Notifications on this device"), so there it answers "not
  // subscribed" itself. Real Safari isn't covered by this.
  if (b.browserType().name() === 'webkit') await ctx.addInitScript(() => { if (window.PushManager) PushManager.prototype.getSubscription = async () => null })
  await ctx.route(/\/api\/(mail|brief|market|macro|news|mortgage|weather)(\/|\?|$)/, (r) => r.abort())
  if (before) await before(ctx)
  const p = await ctx.newPage()
  const errors = []
  // A ResizeObserver that couldn't hand over every change in one frame is reported as a page error
  // (by WebKit, now and then). It's the browser's notice, not a fault in the page.
  p.on('pageerror', (e) => { if (e.message !== 'ResizeObserver loop completed with undelivered notifications.') errors.push(e.message) })
  await p.goto(url)
  return { ctx, p, errors }
}
// No service worker, as in the desktop app: WebKit's test build doesn't route what a page fetches
// through one, so a test that stands in for an API with ctx.route needs this (in its before).
export const noServiceWorker = (ctx) => ctx.addInitScript(() => { try { delete Navigator.prototype.serviceWorker } catch { /* none */ } })
export const shot = (p, name, o = {}) => { fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true }); return p.screenshot({ path: path.join(OUT, 'shots', `${name}.png`), ...o }) }
// A menu or pop-up is solid (not see-through over a coloured sidebar), once it's done fading in.
// Opaque and fully shown. A menu fades in (.1s), which can start late on a busy machine (a CI Mac
// running three lanes), so it's given up to 2 s to get there rather than one look at 250 ms.
export const solid = async (p, sel) => {
  for (let waited = 0; waited <= 2000; waited += 100) {
    if (await p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const c = getComputedStyle(e); return c.opacity === '1' && /^rgb\(/.test(c.backgroundColor) }, sel)) return true
    await p.waitForTimeout(100)
  }
  return false
}

// Speech models from this computer instead of Hugging Face: a small fake model's files (for
// Parakeet and Parakeet English, and one file for Whisper base, English), served with ranges, and
// the file (BRIDGE_SPEECH_MODELS) that gives the server their sizes and checksums. Whisper's has
// the wrong checksum, so its download is thrown away. env: what a kit needs to use them (with no Mac speech standing in,
// and the stand-in engine's log in the kit's folder: sherpa.log). cut: the next encoder download
// stops after that many bytes, as a dropped connection would. slow: ms between pieces, so progress
// shows. asked: each request, { model, name, range }.
export async function startSpeechModels(name) {
  const fake = (n, seed) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed * 7) & 255; return b }
  const files = { 'tokens.txt': Buffer.from('<unk> 0\n▁the 1\n▁work 2\n'), 'decoder.int8.onnx': fake(40_000, 1), 'joiner.int8.onnx': fake(30_000, 2), 'encoder.int8.onnx': fake(1_500_000, 3) }
  const whisper = fake(300_000, 4)
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
  const sherpa = Object.entries(files).map(([n, b]) => ({ name: n, bytes: b.length, sha256: sha(b) }))
  const catalog = path.join(OUT, 'kits', `${name}-speech-models.json`)
  fs.mkdirSync(path.dirname(catalog), { recursive: true })
  fs.writeFileSync(catalog, JSON.stringify({ 'parakeet-v3': { files: sherpa }, 'parakeet-en': { files: sherpa }, 'base.en-q5_1': { files: [{ name: 'ggml-base.en-q5_1.bin', bytes: whisper.length, sha256: '0'.repeat(64) }] } }))
  const me = { asked: [], cut: 0, slow: 0, files, sha }
  const srv = http.createServer(async (req, res) => {
    const [, model, file] = req.url.split('/')
    const body = files[file] || (file === 'ggml-base.en-q5_1.bin' ? whisper : null)
    me.asked.push({ model, name: file, range: req.headers.range || null })
    if (!body) { res.writeHead(404); res.end(); return }
    const m = /bytes=(\d+)-/.exec(req.headers.range || '')
    const from = m ? Number(m[1]) : 0
    const part = body.subarray(from)
    res.writeHead(m ? 206 : 200, { 'content-length': part.length, ...(m ? { 'content-range': `bytes ${from}-${body.length - 1}/${body.length}` } : {}) })
    const cut = file === 'encoder.int8.onnx' && me.cut ? me.cut : 0
    if (cut) me.cut = 0
    for (let o = 0; o < part.length; o += 100_000) {
      if (cut && o >= cut) { res.destroy(); return }
      res.write(part.subarray(o, Math.min(part.length, o + 100_000)))
      if (me.slow) await sleep(me.slow)
    }
    res.end()
  })
  const port = await freePort()
  await new Promise((r) => srv.listen(port, '127.0.0.1', r))
  me.url = `http://127.0.0.1:${port}`
  me.env = (more = {}) => ({ bin }) => ({ BRIDGE_MODELS_URL: me.url, BRIDGE_SPEECH_MODELS: catalog, BRIDGE_SPEECH: path.join(OUT, 'no-such-bridgespeech'), BRIDGE_SHERPA_LOG: path.join(path.dirname(bin), 'sherpa.log'), ...more })
  me.stop = () => srv.close()
  return me
}
