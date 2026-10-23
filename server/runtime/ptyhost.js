// The terminal host: a small process that owns the built-in runtime's terminals (node-pty, with a
// headless xterm keeping each screen), so agents keep running while Bridge AI's server quits,
// restarts or updates, the way a tmux or herdr server does. The server starts it (detached, on
// the same Node or Electron binary it runs on) and drives it over a local socket in a folder only
// you can open (a named pipe with a random name on Windows). Nothing listens on the network, and
// every connection must first give the random token the host wrote next to the socket.
//
//   node ptyhost.js <folder> <socket>
//
// The protocol: one JSON object per line, kept small so the host rarely changes. A server works
// with a host only when their PROTOCOL (screen.js) matches. These two never change, so any
// server can stop any host it finds:
//   { t: 'hello', n, token, protocol, control, keep } -> { re: n, ok, protocol, pid, version }
//   { t: 'quit' }   end every terminal, then exit
// The rest, after a hello with the same protocol (control: true makes that connection the
// server's; there's one at a time):
//   spawn { n, id, file, args, cwd, env, cols, rows, meta } -> { re: n, ok, pid }
//   write { id, data } · resize { id, cols, rows } · kill { id, signal }
//   list { n } -> { re: n, terms: [{ id, pid, cols, rows, title, startedAt, lastOutput, meta, exited }] }
//   attach { n, id } -> { re: n, ok, screen, cols, rows } (its screen and scrollback), then its output
//   keep { on }     whether terminals outlive the server (Settings › Keep agents running)
// Events: { ev: 'data', id, d } · { ev: 'exit', id, code, signal }
// It exits by itself once it has no terminals and no server, and ends its terminals when the
// server goes away with keep off.
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pty from 'node-pty'
import headless from '@xterm/headless'
import { PROTOCOL, SCROLLBACK, snapshot } from './screen.js'

const { Terminal } = headless
const IS_WIN = process.platform === 'win32'
const [DIR, SOCK] = process.argv.slice(2)
if (!DIR || !SOCK) { console.error('usage: ptyhost.js <folder> <socket>'); process.exit(2) }
// How it shows in ps and Activity Monitor, instead of the app's own path: so it's clear what it
// is, and so updating the app (which stops whatever runs from inside it) leaves it running.
process.title = 'Bridge AI terminal host'

const INFO = path.join(DIR, 'host.json')
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')).version } catch { return null } })()
const TOKEN = crypto.randomBytes(32).toString('hex')
const startedAt = Date.now()
const terms = new Map() // id -> { id, p, term, pid, title, startedAt, lastOutput, meta, exited }
let ctl = null // the server's connection
let keep = true
let idleTimer = null
let ending = false

const log = (...a) => console.log(new Date().toISOString(), ...a)
process.on('uncaughtException', (e) => log('error:', e?.stack || e)) // one bad terminal mustn't end the others
process.on('SIGHUP', () => {})
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => end(sig))

const send = (c, m) => {
  if (c.sock.destroyed) return
  // A server that stopped reading (paused, hung) would make this grow without end: let it go;
  // it reconnects and picks the terminals up again.
  if (c.sock.writableLength > 64 * 1024 * 1024) { log('server not reading; dropping it'); return c.sock.destroy() }
  c.sock.write(`${JSON.stringify(m)}\n`)
}
const alive = () => [...terms.values()].filter((t) => !t.exited)

// Nothing left to keep and nobody to keep it for: exit (after a moment, in case a server is on its way).
function idle(ms = 3000) {
  clearTimeout(idleTimer)
  if (ctl || alive().length) return
  idleTimer = setTimeout(() => { if (!ctl && !alive().length) end('idle') }, ms)
}

// End every terminal (a hangup, as when a terminal window closes; then a kill for any that stay),
// tidy up and exit.
async function end(why) {
  if (ending) return
  ending = true
  log(`ending (${why}): ${alive().length} terminal(s)`)
  const group = (t, sig) => { try { process.kill(-t.pid, sig) } catch { /* gone, or no group */ } }
  for (const t of alive()) {
    try { t.p.kill() } catch { /* gone */ }
    if (!IS_WIN) group(t, 'SIGHUP')
  }
  for (let i = 0; i < 30 && alive().length; i++) await new Promise((r) => setTimeout(r, 50))
  if (!IS_WIN) for (const t of alive()) group(t, 'SIGKILL')
  try { if (JSON.parse(fs.readFileSync(INFO, 'utf8')).pid === process.pid) fs.rmSync(INFO) } catch { /* not ours */ }
  if (!IS_WIN) try { fs.rmSync(SOCK) } catch { /* gone */ }
  process.exit(0)
}

const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) | 0))
const str = (v) => (typeof v === 'string' ? v : '')

function spawnTerm(c, m) {
  const id = str(m.id)
  if (!id || id.length > 200) throw new Error('bad id')
  if (terms.has(id)) throw new Error(`${id} is already running`)
  const cols = int(m.cols, 2, 1000)
  const rows = int(m.rows, 2, 1000)
  const env = Object.fromEntries(Object.entries(m.env || {}).filter(([, v]) => typeof v === 'string'))
  const p = pty.spawn(str(m.file), Array.isArray(m.args) ? m.args.map(String) : [], { name: 'xterm-256color', cols, rows, cwd: str(m.cwd) || undefined, env })
  const t = { id, p, term: new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true }), pid: p.pid, title: '', startedAt: Date.now(), lastOutput: 0, meta: m.meta ?? null, exited: null }
  t.term.onTitleChange((s) => { t.title = s })
  p.onData((d) => {
    t.lastOutput = Date.now()
    t.term.write(d)
    const s = ctl?.subs.get(id)
    if (s === undefined) return
    if (s) s.push(d) // waiting for its screen to be sent first
    else send(ctl, { ev: 'data', id, d })
  })
  p.onExit(({ exitCode, signal }) => {
    t.exited = { code: exitCode, signal: signal || null }
    // After anything already on its way (a screen being sent), so the server sees it in order.
    t.term.write('', () => {
      if (ctl?.subs.has(id)) { send(ctl, { ev: 'exit', id, code: exitCode, signal: signal || null }); forget(t) }
      // Nobody to tell: kept, as ended, until a server asks (list).
      idle()
    })
  })
  terms.set(id, t)
  c.subs.set(id, null)
  log(`started ${id} (pid ${t.pid})`)
  return { pid: t.pid }
}
function forget(t) {
  terms.delete(t.id)
  ctl?.subs.delete(t.id)
  try { t.term.dispose() } catch { /* fine */ }
}

// The terminal's screen and scrollback as they are now, then everything it prints after, in order.
function attachTerm(c, m, reply) {
  const t = terms.get(str(m.id))
  if (!t || t.exited) return reply({ error: 'gone' })
  c.subs.set(t.id, [])
  t.term.write('', () => {
    const held = c.subs.get(t.id)
    if (!Array.isArray(held) || c !== ctl) return
    reply({ ok: true, screen: snapshot(t.term, t.title), cols: t.term.cols, rows: t.term.rows })
    for (const d of held) send(c, { ev: 'data', id: t.id, d })
    c.subs.set(t.id, null)
  })
}

function list(told) {
  const out = [...terms.values()].map((t) => ({ id: t.id, pid: t.pid, cols: t.term.cols, rows: t.term.rows, title: t.title, startedAt: t.startedAt, lastOutput: t.lastOutput, meta: t.meta, exited: t.exited }))
  if (told) for (const t of [...terms.values()]) if (t.exited) forget(t) // the server knows now
  return out
}

function onMessage(c, m) {
  const reply = (r) => { if (m.n) send(c, { re: m.n, ...r }) }
  if (!c.authed) {
    const given = Buffer.from(str(m.token))
    const want = Buffer.from(TOKEN)
    if (m.t !== 'hello' || given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      reply({ error: 'token' })
      return c.sock.end()
    }
    c.authed = true
    c.same = m.protocol === PROTOCOL
    const about = { protocol: PROTOCOL, pid: process.pid, version: VERSION, startedAt }
    if (c.same && m.control) {
      if (ctl && !ctl.sock.destroyed) return reply({ error: 'busy', ...about })
      ctl = c
      keep = m.keep !== false
      clearTimeout(idleTimer)
    }
    return reply({ ok: true, ...about })
  }
  if (m.t === 'quit') return end('asked')
  if (!c.same) return reply({ error: 'protocol' })
  const t = terms.get(str(m.id))
  try {
    switch (m.t) {
      case 'write': if (t && !t.exited) t.p.write(str(m.data)); break
      case 'resize': if (t && !t.exited) { const cols = int(m.cols, 2, 1000); const rows = int(m.rows, 2, 1000); t.p.resize(cols, rows); t.term.resize(cols, rows) } break
      case 'kill': if (t && !t.exited) t.p.kill(IS_WIN ? undefined : str(m.signal) || undefined); break
      case 'keep': if (c === ctl) keep = !!m.on; break
      case 'list': reply({ ok: true, terms: list(c === ctl) }); break
      case 'spawn': if (c !== ctl) throw new Error('not the server'); reply({ ok: true, ...spawnTerm(c, m) }); break
      case 'attach': if (c !== ctl) throw new Error('not the server'); attachTerm(c, m, reply); break
      default: reply({ error: `unknown: ${str(m.t).slice(0, 40)}` })
    }
  } catch (e) { reply({ error: e.message }) }
}

function onConnection(sock) {
  const c = { sock, authed: false, same: false, subs: new Map() }
  let buf = ''
  sock.setEncoding('utf8')
  // A connection that doesn't say hello soon isn't Bridge AI.
  const shy = setTimeout(() => { if (!c.authed) sock.destroy() }, 5000)
  sock.on('data', (chunk) => {
    let from = buf.length
    buf += chunk
    let i
    while ((i = buf.indexOf('\n', from)) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      from = 0
      let m
      try { m = JSON.parse(line) } catch { continue }
      if (m && typeof m === 'object') onMessage(c, m)
      if (sock.destroyed) return
    }
    if (buf.length > 64 * 1024 * 1024) sock.destroy()
  })
  sock.on('error', () => {})
  sock.on('close', () => {
    clearTimeout(shy)
    if (c !== ctl) return
    ctl = null
    if (ending) return
    if (!keep) return end('server gone, Keep agents running is off')
    log(`server gone; keeping ${alive().length} terminal(s)`)
    idle()
  })
}

// Already one here (two servers starting at once)? Then leave it be. A socket file nobody answers
// on is left over from a host that's gone.
if (!IS_WIN && fs.existsSync(SOCK)) {
  const answered = await new Promise((resolve) => {
    const s = net.connect(SOCK)
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', () => resolve(false))
  })
  if (answered) { log('another host is already running here'); process.exit(0) }
  fs.rmSync(SOCK, { force: true })
}
const server = net.createServer(onConnection)
server.on('error', (e) => { log(`can't listen on ${SOCK}: ${e.message}`); process.exit(1) })
server.listen(SOCK, () => {
  if (!IS_WIN) fs.chmodSync(SOCK, 0o600)
  const tmp = `${INFO}.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, protocol: PROTOCOL, version: VERSION, sock: SOCK, token: TOKEN, startedAt }), { mode: 0o600 })
  fs.renameSync(tmp, INFO)
  log(`listening (protocol ${PROTOCOL}, Bridge AI ${VERSION}, pid ${process.pid}, ${process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`})`)
  // Started for a server that never came: don't linger.
  idle(30000)
})
