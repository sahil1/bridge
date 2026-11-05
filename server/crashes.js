// Crashes, so one can be reported on GitHub (shared/crashreport.js), by the person, from text they
// read first; and sent to the project's crash server as that same text, by itself unless Send crash
// reports is turned off, or when they click Send to Bold Bridge on one (shared/telemetry-schema.json,
// crashReports).
// Each crash is counted too, in the usage counts, when those are on.
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
import * as counts from './counts.js'

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
// The crash waiting to be reported, if any: { kind, at, version, message?, reason?, sent }.
export async function pending() {
  const c = await read()
  return { crash: c && KINDS.has(c.kind) ? { kind: c.kind, at: c.at, version: c.version, message: c.message ? clip(c.message, 300) : null, reason: c.reason || null, sent: !!c.sent } : null }
}
// The desktop app's window or graphics process went away (a crash, or macOS or Windows ending it).
export async function record(b = {}, version) {
  if (!['window', 'gpu'].includes(b.kind)) throw Object.assign(new Error('Not a crash this records'), { status: 400 })
  last = { kind: b.kind, at: new Date().toISOString(), version, reason: clip(b.reason, 40) || null, exitCode: Number.isFinite(b.exitCode) ? b.exitCode : null, counted: true }
  await fs.promises.mkdir(path.dirname(FILE), { recursive: true })
  await fs.promises.writeFile(FILE, JSON.stringify(last))
  counts.add(`crashes.${b.kind}`)
  counts.crashed().catch(() => {})
  await auto({ kind: 'last' })
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

// ---------- Sending crash reports (off unless turned on) ----------
// The crash server, from the public list; BRIDGE_CRASHES_URL (tests) stands in for it.
const SCHEMA = counts.SCHEMA.crashReports || {}
const endpoint = () => (process.env.BRIDGE_CRASHES_URL ?? SCHEMA.endpoint ?? '').trim()
const refused = () => (process.env.DO_NOT_TRACK === '1' ? 'DO_NOT_TRACK' : process.env.BRIDGE_TELEMETRY === '0' ? 'BRIDGE_TELEMETRY=0' : null)
const SENT = path.join(DATA, 'telemetry', 'crashes')
// Sent by themselves at most this many a day, and the same crash once a day.
const PER_DAY = 5
let cfg = null // the server's settings: crashReports.send, crashReports.stopped
let context = async () => ({}) // { version, settings, names } for report()
let saveSettings = () => {}
export function configure(c, { about, save } = {}) { cfg = c; if (about) context = about; if (save) saveSettings = save }
const on = () => !!(cfg && cfg.crashReports?.send !== false && endpoint() && !refused())
const hostOf = (u) => { try { return new URL(u).host } catch { return null } }

async function sentList() {
  const files = await fs.promises.readdir(SENT).catch(() => [])
  return files.filter((f) => /^[\w-]+\.json$/.test(f)).sort().reverse()
}
// What Settings shows: whether it can be turned on here, whether it is, where reports go, and the
// ones sent (newest first).
export async function sending() {
  const to = endpoint() ? hostOf(endpoint()) : null
  const sent = []
  for (const f of (await sentList()).slice(0, 20)) {
    const r = await fs.promises.readFile(path.join(SENT, f), 'utf8').then(JSON.parse, () => null)
    if (r) sent.push({ id: f.slice(0, -5), at: r.at, kind: r.report?.kind, title: r.report?.title })
  }
  return { available: !!to && !refused(), refused: refused(), send: on(), to, stopped: cfg?.crashReports?.stopped || null, sent }
}
export async function setSending(v) {
  if (v && (!endpoint() || refused())) throw Object.assign(new Error(refused() ? `Crash reports are off on this computer (${refused()})` : 'There\'s nowhere to send crash reports yet'), { status: 400 })
  saveSettings({ crashReports: { send: !!v, stopped: null } })
  return sending()
}
export async function sentReport(id) {
  if (!/^[\w-]+$/.test(String(id))) throw Object.assign(new Error('No such report'), { status: 404 })
  return JSON.parse(await fs.promises.readFile(path.join(SENT, `${id}.json`), 'utf8'))
}

// One report to the crash server: { title, what, details } as the person left them (Send to Bold
// Bridge), or as report() writes them (sent by itself). Taken out again here, in case something
// personal was typed in. A copy of what went is kept in telemetry/crashes.
export async function send(text, kind, { byItself = false } = {}) {
  if (!endpoint() || refused()) throw Object.assign(new Error(refused() ? `Crash reports are off on this computer (${refused()})` : 'There\'s nowhere to send crash reports yet'), { status: 400 })
  const ctx = await context()
  const opts = { home: os.homedir(), app: ROOT, names: ctx.names || [] }
  const m = await machine().catch(() => ({}))
  const report = {
    schema: counts.SCHEMA.schema,
    kind: ['ui', 'server', 'window', 'gpu'].includes(kind) ? kind : 'ui',
    app: ctx.version || null,
    os: { darwin: 'mac', win32: 'windows' }[process.platform] || 'linux',
    arch: m.arch || process.arch,
    install: process.versions.electron ? 'desktop' : process.env.BRIDGE_DOCKER ? 'docker' : 'source',
    title: clip(scrub(text.title, opts), 200),
    ...(text.what ? { what: clip(scrub(text.what, opts), 2000) } : {}),
    details: clip(scrub(text.details, opts), 12000),
  }
  const r = await fetch(endpoint(), { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bridge-ai' }, body: JSON.stringify(report), signal: AbortSignal.timeout(10000) })
  const said = await r.json().catch(() => ({}))
  if (said?.stop) {
    saveSettings({ crashReports: { send: false, stopped: clip(said.why || 'The project stopped collecting crash reports.', 300) } })
    throw Object.assign(new Error(said.why || 'The project stopped collecting crash reports.'), { status: 409 })
  }
  if (!r.ok) throw Object.assign(new Error(said?.error || `The crash server said ${r.status}`), { status: 502 })
  const at = new Date().toISOString()
  await fs.promises.mkdir(SENT, { recursive: true })
  const id = `${at.replace(/[:.]/g, '-')}-${report.kind}`
  await fs.promises.writeFile(path.join(SENT, `${id}.json`), JSON.stringify({ at, byItself, report }, null, 2))
  return { sent: true, id }
}

// Sent by itself, when that's on: a crash just written down ({ kind: 'last' }) or a part of the
// window that broke ({ kind: 'ui', where, message, stack }). Never more than PER_DAY a day, or the
// same crash twice in a day; a failure to send is let go (Report on GitHub still has it).
const today = () => new Date().toISOString().slice(0, 10)
// One at a time, so two crashes at once can't both pass the check for the same crash (the first
// one's copy is written before the second looks).
let autoQueue = Promise.resolve()
export function auto(b) {
  const run = autoQueue.then(() => autoNow(b))
  autoQueue = run.catch(() => {})
  return run
}
async function autoNow(b) {
  if (!on()) return { sent: false }
  try {
    const ctx = await context()
    const text = await report(b, { version: ctx.version, settings: ctx.settings || {}, names: ctx.names || [] })
    const day = today()
    const todays = []
    for (const f of await sentList()) {
      if (!f.startsWith(day)) break
      const r = await fs.promises.readFile(path.join(SENT, f), 'utf8').then(JSON.parse, () => null)
      if (r?.byItself) todays.push(r.report?.title)
    }
    if (todays.length >= PER_DAY || todays.includes(clip(text.title, 200))) return { sent: false }
    const out = await send(text, text.kind, { byItself: true })
    if (b.kind === 'last' && last) { last = { ...last, sent: true }; await fs.promises.writeFile(FILE, JSON.stringify(last)).catch(() => {}) }
    return out
  } catch { return { sent: false } }
}

// As the server starts: a crash of its own from last time is counted once, and sent if that's on.
export async function started() {
  const c = await read()
  if (!c || c.kind !== 'server' || c.counted) return
  last = { ...c, counted: true }
  await fs.promises.writeFile(FILE, JSON.stringify(last)).catch(() => {})
  counts.add('crashes.server')
  counts.crashed().catch(() => {})
  if (!c.sent) await auto({ kind: 'last' })
}
