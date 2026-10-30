// The server's side of the terminal host (ptyhost.js): find the one running for this data folder,
// or start it, and drive its terminals. Each terminal here looks like a node-pty one (write,
// resize, kill, onData, onExit), so the built-in runtime treats both the same.
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DATA, NODE, IS_WIN } from '../paths.js'
import { PROTOCOL } from './screen.js'

const HOST_JS = fileURLToPath(new URL('./ptyhost.js', import.meta.url))
// host.json (the host's pid, socket and token), its log, and the socket itself when the path is
// short enough. Only you can open the folder.
export const DIR = path.join(DATA, 'host')
const INFO = path.join(DIR, 'host.json')
const LOG = path.join(DIR, 'host.log')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const running = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

// A folder that's yours alone: made 0700, and refused if someone else owns it or it's a link.
function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (IS_WIN) return dir
  const st = fs.lstatSync(dir)
  if (!st.isDirectory() || st.uid !== process.getuid()) throw new Error(`${dir} isn't a folder of yours`)
  if (st.mode & 0o077) fs.chmodSync(dir, 0o700)
  return dir
}

// In the data folder, unless that path is too long for a Unix socket (about 100 bytes): then in a
// private folder in your temp folder. On Windows, a named pipe with a random name, which only
// host.json (in your data folder) gives away.
function socketPath() {
  if (IS_WIN) return `\\\\.\\pipe\\bridge-ai-host-${crypto.randomBytes(16).toString('hex')}`
  const p = path.join(DIR, 'sock')
  if (Buffer.byteLength(p) <= 100) return p
  const tag = crypto.createHash('sha256').update(DIR).digest('hex').slice(0, 12)
  return path.join(privateDir(path.join(os.tmpdir(), `bridge-ai-${process.getuid()}-${tag}`)), 'sock')
}

function readInfo() {
  try {
    if (!IS_WIN && fs.statSync(INFO).uid !== process.getuid()) return null
    const i = JSON.parse(fs.readFileSync(INFO, 'utf8'))
    return typeof i?.sock === 'string' && typeof i?.token === 'string' ? i : null
  } catch { return null }
}

// One of the host's terminals, shaped like node-pty's: what it prints before anyone listens is
// held, so nothing is lost between picking it up and wiring it to a screen.
class Term {
  constructor(link, id) { Object.assign(this, { link, id, pid: null, held: [], dataFns: [], exitFns: [], ended: null }) }
  onData(fn) { this.dataFns.push(fn); for (const d of this.held.splice(0)) fn(d) }
  onExit(fn) { this.exitFns.push(fn); if (this.ended) fn(this.ended) }
  data(d) { if (this.dataFns.length) for (const fn of this.dataFns) fn(d); else this.held.push(d) }
  exit(code, signal) { this.ended = { exitCode: code, signal }; for (const fn of this.exitFns) fn(this.ended) }
  write(data) { this.link.send({ t: 'write', id: this.id, data }) }
  resize(cols, rows) { this.link.send({ t: 'resize', id: this.id, cols, rows }) }
  kill(signal) { this.link.send({ t: 'kill', id: this.id, signal }) }
}

class Link {
  constructor(sock) {
    Object.assign(this, { sock, n: 0, waiting: new Map(), terms: new Map(), closed: false, leaving: false, onLost: null, onEnding: null, info: null })
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('data', (chunk) => {
      let from = buf.length
      buf += chunk
      let i
      while ((i = buf.indexOf('\n', from)) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        from = 0
        try { this.message(JSON.parse(line)) } catch { /* a bad line */ }
      }
    })
    sock.on('error', () => {})
    sock.on('close', () => {
      this.closed = true
      for (const w of this.waiting.values()) w(Object.assign(new Error('The terminal host went away'), { code: 'gone' }))
      this.waiting.clear()
      if (!this.leaving) this.onLost?.()
    })
  }
  send(m) { if (!this.closed) this.sock.write(`${JSON.stringify(m)}\n`) }
  request(m, ms = 15000) {
    const n = ++this.n
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiting.delete(n); reject(new Error('The terminal host didn\'t answer')) }, ms)
      this.waiting.set(n, (r) => { clearTimeout(t); if (r instanceof Error) reject(r); else if (r.error) reject(Object.assign(new Error(r.error), { code: r.error, reply: r })); else resolve(r) })
      this.send({ ...m, n })
    })
  }
  message(m) {
    if (m.re) { const w = this.waiting.get(m.re); this.waiting.delete(m.re); return w?.(m) }
    if (m.ev === 'ending') return this.onEnding?.()
    const t = this.terms.get(m.id)
    if (m.ev === 'data') t?.data(m.d)
    else if (m.ev === 'exit') { this.terms.delete(m.id); t?.exit(m.code, m.signal) }
  }
  get pid() { return this.info?.pid }
  async spawn(id, opts) {
    const t = new Term(this, id)
    this.terms.set(id, t)
    try { t.pid = (await this.request({ t: 'spawn', id, ...opts })).pid } catch (e) { this.terms.delete(id); throw e }
    return t
  }
  // A terminal that's already running there: its screen and scrollback now, then its output.
  async attach(id) {
    const t = new Term(this, id)
    this.terms.set(id, t)
    try {
      const r = await this.request({ t: 'attach', id }, 60000)
      return { term: t, screen: r.screen, cols: r.cols, rows: r.rows }
    } catch (e) { this.terms.delete(id); throw e }
  }
  async list() { return (await this.request({ t: 'list' })).terms || [] }
  setKeep(on) { this.send({ t: 'keep', on: !!on }) }
  // Let go: the host keeps its terminals if keep is on, and ends them if not.
  detach(keep) { this.leaving = true; this.setKeep(keep); this.sock.end() }
  // End every terminal and the host.
  quit() { this.leaving = true; this.send({ t: 'quit' }); this.sock.end() }
}

// Connect and say hello. Resolves the link, or null when nothing answers there.
async function connect(info, { control, keep }) {
  if (!info) return null
  const sock = net.connect(info.sock)
  const ok = await new Promise((resolve) => {
    const t = setTimeout(() => { sock.destroy(); resolve(false) }, 2000)
    sock.once('connect', () => { clearTimeout(t); resolve(true) })
    sock.once('error', () => { clearTimeout(t); resolve(false) })
  })
  if (!ok) return null
  const link = new Link(sock)
  link.leaving = true // not lost until it's ours
  try {
    const r = await link.request({ t: 'hello', token: info.token, protocol: PROTOCOL, control, keep }, 5000)
    link.info = { ...info, pid: r.pid, version: r.version, protocol: r.protocol }
  } catch (e) {
    if (e.code === 'busy') { sock.destroy(); return { busy: true, pid: e.reply?.pid } }
    sock.destroy()
    return null
  }
  link.leaving = false
  return link
}

// A host from another version of Bridge AI that speaks another protocol: ask it to end its
// terminals and exit (the one message every version understands), make sure it's gone, and let
// the caller start them again, resuming their sessions.
async function retire(link) {
  const pid = link.pid
  console.log(`Terminal host ${pid} (Bridge AI ${link.info.version || '?'}, protocol ${link.info.protocol}) doesn't match this version (protocol ${PROTOCOL}); stopping it`)
  link.quit()
  for (let i = 0; i < 50 && running(pid); i++) await sleep(100)
  if (running(pid)) { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } await sleep(1500) }
  if (running(pid)) try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
}

function launch() {
  privateDir(DIR)
  const sock = socketPath()
  // A fresh log once it gets long.
  try { if (fs.statSync(LOG).size > 1024 * 1024) fs.rmSync(LOG) } catch { /* none yet */ }
  const out = fs.openSync(LOG, 'a', 0o600)
  try {
    const child = spawn(NODE.bin, [HOST_JS, DIR, sock], { cwd: DIR, detached: true, stdio: ['ignore', out, out], windowsHide: true, env: { ...process.env, ...NODE.env } })
    child.on('error', () => {})
    child.unref()
  } finally { fs.closeSync(out) }
}

// The host for this data folder, as this server's: the one running, or a new one. Null when it
// can't be had (the caller then runs terminals itself); { busy } when another server has it.
export async function open({ keep = true } = {}) {
  let link = await connect(readInfo(), { control: true, keep })
  if (link && !link.busy && link.info.protocol !== PROTOCOL) { await retire(link); link = null }
  // Another server has it: likely one that's still on its way out. Give it a moment.
  for (let i = 0; i < 30 && link?.busy; i++) { await sleep(100); link = await connect(readInfo(), { control: true, keep }) }
  if (link) return link
  launch()
  for (let i = 0; i < 100; i++) {
    await sleep(i < 20 ? 50 : 100)
    link = await connect(readInfo(), { control: true, keep })
    if (link?.busy || link?.info?.protocol === PROTOCOL) return link
  }
  return null
}

// Stop the host from outside a server (npm run stop -- agents, or the herdr runtime taking over):
// its terminals end. True if there was one.
export async function stopHost() {
  const link = await connect(readInfo(), { control: false })
  if (!link || link.busy) return false
  const pid = link.pid
  link.quit()
  for (let i = 0; i < 50 && running(pid); i++) await sleep(100)
  return true
}
