// Crashes, so one can be reported on GitHub (shared/crashreport.js), by the person, from text they
// read first: nothing here sends anything anywhere.
//   The server's own: an error nothing caught, written down as the server stops (watch).
//   The desktop app's window or graphics process going away: the app says so (POST /api/crashes).
//   The server ending some other way while the desktop app ran it: the app writes that down itself
//   (desktop/crashes.js), with what the server printed in logs/server.log.
// The last one waits in cache/crash.json, so the window can offer to report it once the server is
// back, until it's reported or put away.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DATA, ROOT, cacheFile, ensureDir } from './paths.js'
import { machine } from './machine.js'
import { reportText, scrub } from '../shared/crashreport.js'

const FILE = cacheFile('crash.json')
const KINDS = new Set(['server', 'window', 'gpu'])
const clip = (s, n) => String(s ?? '').slice(0, n)

// An error nothing caught ends the server, as it would anyway, once it's written down. Synchronous:
// it's the last thing the server does, and the file is in Bridge AI's own folder.
export function watch(version) {
  process.on('uncaughtException', (err, origin) => {
    try {
      ensureDir(path.dirname(FILE))
      fs.writeFileSync(FILE, JSON.stringify({ kind: 'server', at: new Date().toISOString(), version, message: clip(err?.message || err, 500), stack: clip(err?.stack, 6000), origin }))
    } catch { /* couldn't write it down; it still stops */ }
    console.error(origin === 'unhandledRejection' ? 'Bridge AI: a promise failed and nothing caught it:' : 'Bridge AI: an error nothing caught:', err)
    process.exit(1)
  })
}

let last // undefined: not read yet; null: none
async function read() {
  if (last === undefined) last = await fs.promises.readFile(FILE, 'utf8').then((t) => JSON.parse(t), () => null).catch(() => null)
  return last
}
// The crash waiting to be reported, if any: { kind, at, version, message?, reason? }.
export async function pending() {
  const c = await read()
  return { crash: c && KINDS.has(c.kind) ? { kind: c.kind, at: c.at, version: c.version, message: c.message ? clip(c.message, 300) : null, reason: c.reason || null } : null }
}
// The desktop app's window or graphics process went away (a crash, or macOS or Windows ending it).
export async function record(b = {}, version) {
  if (!['window', 'gpu'].includes(b.kind)) throw Object.assign(new Error('Not a crash this records'), { status: 400 })
  last = { kind: b.kind, at: new Date().toISOString(), version, reason: clip(b.reason, 40) || null, exitCode: Number.isFinite(b.exitCode) ? b.exitCode : null }
  await fs.promises.mkdir(path.dirname(FILE), { recursive: true })
  await fs.promises.writeFile(FILE, JSON.stringify(last))
  return pending()
}
// Reported, or put away.
export async function dismiss() {
  last = null
  await fs.promises.rm(FILE, { force: true })
  return { crash: null }
}

// The last lines of a log in the data folder (at most the last 256 KB of it is read).
async function tail(file, n) {
  try {
    const h = await fs.promises.open(file, 'r')
    try {
      const { size } = await h.stat()
      const len = Math.min(size, 256 * 1024)
      const buf = Buffer.alloc(len)
      await h.read(buf, 0, len, size - len)
      return buf.toString('utf8').split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-n)
    } finally { await h.close() }
  } catch { return [] }
}

// The issue's text for a crash, with what's personal taken out: { title, what, details }.
// b: { kind: 'ui', where, message, stack, language } from the window's crash screen, or
// { kind: 'last' } for the crash waiting in cache/crash.json. ctx: { version, settings, names }.
export async function report(b = {}, { version, settings = {}, names = [] } = {}) {
  const c = b.kind === 'last' ? await read() : { kind: 'ui', where: clip(b.where, 60), message: clip(b.message, 500), stack: clip(b.stack, 6000), at: new Date().toISOString() }
  if (!c) throw Object.assign(new Error('There\'s no crash to report'), { status: 404 })
  const m = await machine().catch(() => ({}))
  const install = process.versions.electron ? `desktop app, Electron ${process.versions.electron}` : process.env.BRIDGE_DOCKER ? `Docker image, Node ${process.versions.node}` : `from source, Node ${process.versions.node}`
  const system = `${m.platform || process.platform}${m.os ? ` ${m.os}` : ''} ${m.arch || process.arch}${m.rosetta ? ' (under Rosetta)' : ''}${m.emulated ? ' (emulated)' : ''}${m.docker ? ' (in Docker)' : ''}`
  // A crash in the window: the errors before it, a line each. Otherwise what the server printed
  // last (the desktop app keeps it).
  const log = c.kind === 'ui'
    ? { name: 'ui-errors.log', lines: (await tail(path.join(DATA, 'logs', 'ui-errors.log'), 400)).filter((l) => /^\d{4}-\d\d-\d\dT/.test(l)).slice(-8) }
    : { name: 'server.log', lines: await tail(path.join(DATA, 'logs', 'server.log'), 30) }
  const text = reportText(c, { about: { version: c.version || version, install, system, language: clip(b.language, 20) || null }, settings, log })
  const opts = { home: os.homedir(), app: ROOT, names }
  return { kind: c.kind, title: scrub(text.title, opts), what: scrub(text.what, opts), details: scrub(text.details, opts) }
}
