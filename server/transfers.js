// Files and folders between your computers, and from your phone to one of them. A copy goes over
// the same end-to-end encrypted link as everything else (machines.js, relay.js), carries on where it
// stopped when the connection drops or Bridge AI restarts, and is checked where it lands (its size,
// and each file's SHA-256 against the one where it came from) before it takes its name.
//
// Each copy is run by one of the two computers:
//   pull: this one copies from another of yours (Copy to this computer, or a file dragged in here
//     from another device's Files). It reads the file through the link in parts (Range), no more
//     than PULL_WINDOW of it on the way at once (the flow control a video has), and writes it as it
//     comes;
//   push: this one sends to another of yours (Send to). It hands the file over PIECE at a time, each
//     written there before the next goes, so nothing piles up on either side;
//   in: the other end of a push, and a phone sending a photo or a video (the same pieces, from the
//     page, each with its own SHA-256).
// What lands is written where it goes under a hidden name (".final.mp4.ab12cd.part") and takes its
// own name only once it's whole and checked. A name that's taken gets a number ("final 2.mp4"), so
// nothing is ever replaced.
//
// It goes where you pick on the computer it lands on: its Downloads (not in Docker, where nobody
// would find it), an agent's folder there, or one of its Places. On a Mac, macOS asks before
// anything is put in Downloads the first time; a copy from elsewhere (nobody may be at that Mac to
// answer) doesn't go there until Bridge AI has been let in (projects.mayLook), and says so instead.
//
// Never a blocking call on your folders (fs.promises throughout), and the hashing runs off the
// server's main thread (files.hashFile). Kept in ~/.bridge-ai/transfers.json.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { dataFile, ensureDir, writeFileAtomic, HOME, IS_MAC, IS_WIN } from './paths.js'
import * as files from './files.js'
import * as machines from './machines.js'
import { placeOf, inPicked, pickedPlaces } from './places.js'
import { mayLook, noteAsked } from './projects.js'
import { thisName } from './relay.js'

const FILE = dataFile('transfers.json')
export const PIECE = 4 * 1024 * 1024 // a push's piece, and the most one request may carry
const PULL_WINDOW = 4 * 1024 * 1024 // how much of a pulled file may be on its way at once
const MARGIN = 64 * 1024 * 1024 // kept free on the disk it lands on
const KEEP_DONE = 24 * 3600e3 // finished copies stay in the list this long
const STALE_IN = 7 * 24 * 3600e3 // a copy coming in that nobody carried on with: let go
const RUNNING = 2 // copies run at once; the rest wait their turn
const DOCKER = !!process.env.BRIDGE_DOCKER || fs.existsSync('/.dockerenv')
const DRYRUN = process.env.BRIDGE_FIX_DRYRUN === '1'
const enc = encodeURIComponent

const read = () => { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { jobs: Array.isArray(d.jobs) ? d.jobs : [], incoming: Array.isArray(d.incoming) ? d.incoming : [] } } catch { return { jobs: [], incoming: [] } } }
const st = read()
let saveTimer = null
const saveNow = () => { clearTimeout(saveTimer); saveTimer = null; try { ensureDir(path.dirname(FILE)); writeFileAtomic(FILE, JSON.stringify(st, (k, v) => (k.startsWith('_') ? undefined : v)), { mode: 0o600 }) } catch (e) { console.error('transfers: couldn\'t save:', e.message) } }
// Progress is saved every few seconds, not with every piece.
const saveSoon = () => { if (!saveTimer) { saveTimer = setTimeout(saveNow, 3000); saveTimer.unref?.() } }

// What this server's index.js knows: an agent's folder by its pane, and the agents here.
let rootOf = async () => { throw new Error('Not ready') }
let agentsHere = async () => []
export function use(o) { if (o.rootOf) rootOf = o.rootOf; if (o.agents) agentsHere = o.agents }

const fail = (message, { status = 400, code } = {}) => Object.assign(new Error(message), { status, code, fatal: true })
const tilde = (p) => (p === HOME || p.startsWith(HOME + path.sep) ? `~${p.slice(HOME.length)}` : p)
const exists = (p) => fsp.access(p).then(() => true, () => false)
const newId = () => randomBytes(6).toString('base64url')
const sum = (fs_) => fs_.reduce((n, f) => n + (f.have ?? 0), 0)
export const fmtSize = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`)

// ---------- where it can go, on this computer ----------
let dl = null
async function downloads() {
  if (dl) return dl
  let d = path.join(HOME, 'Downloads')
  // Linux: where the desktop says Downloads is (XDG), when it says.
  if (process.platform === 'linux') {
    const t = await fsp.readFile(path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'user-dirs.dirs'), 'utf8').catch(() => '')
    const m = /^XDG_DOWNLOAD_DIR="([^"]+)"/m.exec(t)
    const v = m && m[1].replace(/^\$HOME/, HOME)
    if (v && path.isAbsolute(v) && v !== HOME) d = v
  }
  return (dl = d)
}
// Bridge AI may put files there without macOS asking first: not a folder macOS guards, one it has
// already let Bridge AI into, or one you picked (a Place).
const noQuestion = (dir) => mayLook(dir) || inPicked(dir)

async function freeSpace(dir) {
  const s = await fsp.statfs(dir).catch(() => null)
  return s ? Number(s.bavail) * Number(s.bsize) : null
}

// The folders a copy can go to here, for the dialog on whichever device you're using. asks: macOS
// asks before Bridge AI can put files there the first time, so someone has to be at this computer.
export async function destinations() {
  const dlDir = DOCKER ? null : await downloads()
  const agents = []
  const seen = new Set()
  for (const a of await agentsHere().catch(() => [])) {
    if (!a.cwd || seen.has(a.cwd)) continue
    seen.add(a.cwd)
    agents.push({ pane: a.paneId, label: a.title || path.basename(a.cwd), folder: path.basename(a.cwd), path: tilde(a.cwd) })
  }
  return {
    device: thisName(),
    os: IS_MAC ? 'mac' : IS_WIN ? 'windows' : 'linux',
    downloads: dlDir ? { path: tilde(dlDir), asks: !noQuestion(dlDir) } : null,
    agents: agents.slice(0, 30),
    places: pickedPlaces(),
    // The home folder's disk (never a look into Downloads before you send something there).
    free: await freeSpace(HOME),
  }
}

// to: { where: 'downloads' } | { where: 'pane', pane, dir } | { where: 'place', place, dir }. here:
// asked from this computer (someone is here to answer macOS).
async function resolveDest(to = {}, { here = false } = {}) {
  const where = to.where || 'downloads'
  if (where === 'downloads') {
    if (DOCKER) throw fail('Downloads isn\'t somewhere you can get to in Docker. Pick an agent\'s folder instead.')
    const d = await downloads()
    if (!noQuestion(d) && !here) throw fail(`macOS hasn't let Bridge AI put files in Downloads on ${thisName()} yet, and asks the first time, so someone has to be at ${thisName()}. Pick an agent's folder there instead, or copy into Downloads from ${thisName()} once.`, { status: 409, code: 'ask' })
    return { dir: d, label: 'Downloads', protectedRoot: !mayLook(d) }
  }
  if (where === 'pane' || where === 'place') {
    let root
    if (where === 'place') { const p = placeOf(String(to.place || '')); if (!p) throw fail('That place isn\'t in Files any more', { status: 404 }); root = p.path } else root = await rootOf(String(to.pane || '')).catch(() => { throw fail('That agent isn\'t there any more', { status: 404 }) })
    const { real } = await files.safePath(root, String(to.dir || '')).catch((e) => { throw fail(e.message, { status: 404 }) })
    if (!(await fsp.stat(real)).isDirectory()) throw fail('That isn\'t a folder')
    return { dir: real, label: path.basename(real) }
  }
  throw fail('Where should it go?')
}

// ---------- a copy coming in ----------
// A name from the other end, one part of a path: nothing that climbs out or means something here.
function cleanName(n) {
  n = String(n ?? '').trim()
  if (!n || n === '.' || n === '..' || n.length > 255 || /[/\\\0]/.test(n) || (IS_WIN && /[<>:"|?*]/.test(n))) throw fail(`"${String(n).slice(0, 60)}" can't be a name here`)
  return n
}
const cleanRel = (rel) => String(rel).split('/').map(cleanName).join('/')
const partOf = (inc, i) => (inc.dir ? path.join(inc.stage, ...inc.files[i].rel.split('/')) : inc.stage)

// In memory only: each copy's open file and the order its pieces are written in.
const open = new Map() // incoming id -> { i, fh, q, idle }
function slot(inc) {
  let s = open.get(inc.id)
  if (!s) { s = { i: -1, fh: null, q: Promise.resolve() }; open.set(inc.id, s) }
  return s
}
async function closeFile(inc) {
  const s = open.get(inc.id)
  if (s?.fh) { const fh = s.fh; s.fh = null; s.i = -1; await fh.close().catch(() => {}) }
}
const serial = (inc, fn) => { const s = slot(inc); const p = s.q.then(fn); s.q = p.catch(() => {}); return p }

const fromOf = (who) => ({ kind: who?.kind || 'here', name: who?.name || null, id: who?.id || 'here' })

// A copy starts (or, with the same key from the same sender, carries on): how much of each file is
// here already. { key, name, dir, files: [{ rel, size }], dirs, to }.
export async function begin(body = {}, who = {}) {
  const from = fromOf(who)
  const key = String(body.key || '').slice(0, 80)
  if (!key) throw fail('Which copy is this?')
  const had = st.incoming.find((x) => x.key === key && x.from.id === from.id && x.state !== 'failed')
  if (had && (had.state === 'done' || await settle(had))) return { id: had.id, have: had.files.map((f) => f.have), where: had.where }
  const name = cleanName(body.name)
  const dir = !!body.dir
  const list = Array.isArray(body.files) ? body.files : []
  if (list.length > files.MAX_COPY) throw fail(`More than ${files.MAX_COPY} files at once`, { status: 413 })
  const items = list.map((f) => {
    const size = Number(f?.size)
    if (!Number.isSafeInteger(size) || size < 0) throw fail('A file\'s size is missing')
    return { rel: dir ? cleanRel(f.rel) : '', size, have: 0, done: false }
  })
  if (!dir && items.length !== 1) throw fail('One file at a time')
  const dirs = dir ? (Array.isArray(body.dirs) ? body.dirs : []).slice(0, files.MAX_COPY).map(cleanRel) : []
  const total = items.reduce((n, f) => n + f.size, 0)
  const dest = await resolveDest(body.to, { here: who.here })
  // Room for it, with some to spare. (Downloads not asked about yet: the disk of the home folder.)
  const free = await freeSpace(dest.protectedRoot ? HOME : dest.dir)
  if (free != null && total + MARGIN > free) throw fail(`There isn't room for ${name} on ${thisName()}: it needs ${fmtSize(total)}, and ${fmtSize(Math.max(0, free - MARGIN))} is free.`, { status: 507, code: 'space' })
  const id = newId()
  const stage = path.join(dest.dir, `.${name.slice(0, 200)}.${id.slice(0, 6)}.part`)
  try {
    if (dir) {
      await fsp.mkdir(stage)
      for (const d of dirs) await fsp.mkdir(path.join(stage, ...d.split('/')), { recursive: true })
      for (const f of items) await fsp.mkdir(path.dirname(path.join(stage, ...f.rel.split('/'))), { recursive: true })
      for (const [i, f] of items.entries()) await fsp.writeFile(partOf({ dir, stage, files: items }, i), '', { flag: 'wx' })
    } else await fsp.writeFile(stage, '', { flag: 'wx' })
  } catch (e) {
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {})
    if (e.code === 'EPERM' || e.code === 'EACCES') throw fail(`Bridge AI isn't allowed to put files in ${tilde(dest.dir)} on ${thisName()}`, { status: 403, code: 'EPERM' })
    if (e.code === 'ENOSPC') throw fail(`${thisName()}'s disk is full`, { status: 507, code: 'space' })
    throw e
  }
  if (dest.protectedRoot) noteAsked(dest.dir) // macOS let it in (it asked, and you said yes)
  const inc = { id, key, name, dir, files: items, dirs, dest: dest.dir, where: dest.label, stage, total, from, here: !!who.here, at: Date.now(), touched: Date.now(), state: 'coming' }
  st.incoming.push(inc)
  saveNow()
  return { id, have: items.map(() => 0), where: dest.label }
}

const incOf = (id) => {
  const inc = st.incoming.find((x) => x.id === id)
  if (!inc) throw fail('That copy isn\'t here any more. Start it again.', { status: 404, code: 'gone' })
  return inc
}

// A copy carrying on (after a dropped connection, or a restart): how much of each file is really
// on disk, in case a save was missed. Looked at only now, never as Bridge AI starts. False: what
// came so far isn't there any more (moved or deleted), so it's let go and starts again.
async function settle(inc) {
  if (inc.state !== 'coming') return true
  return serial(inc, async () => {
    await closeFile(inc)
    for (const [i, f] of inc.files.entries()) {
      const s = await fsp.stat(partOf(inc, i)).catch(() => null)
      if (!s) { inc.state = 'failed'; await fsp.rm(inc.stage, { recursive: true, force: true }).catch(() => {}); st.incoming = st.incoming.filter((x) => x !== inc); saveNow(); return false }
      if (!f.done && s.size < f.have) f.have = s.size
    }
    return true
  })
}

// A piece of file i at `at`, written where it goes. sha: the piece's SHA-256 (a phone's), checked
// first. The answer: how much of that file is here now (a piece at the wrong place is turned away
// with that, so the sender carries on from there).
export async function piece(id, i, at, buf, sha = null) {
  const inc = incOf(id)
  if (inc.state !== 'coming') throw fail('That copy is finished', { status: 409 })
  const f = inc.files[Number(i)]
  if (!f) throw fail('No such file in that copy', { status: 404 })
  if (sha && createHash('sha256').update(buf).digest('hex') !== String(sha).toLowerCase()) throw fail('A piece came through damaged. It\'s sent again.', { status: 422, code: 'damaged' })
  return serial(inc, () => writeAt(inc, Number(i), Number(at), buf))
}
async function writeAt(inc, i, at, buf) {
  const f = inc.files[i]
  if (at !== f.have) return { have: f.have, moved: true }
  if (at + buf.byteLength > f.size) throw fail(`More came than ${f.rel || inc.name} has`, { status: 422 })
  const s = slot(inc)
  try {
    if (s.i !== i || !s.fh) { await closeFile(inc); s.fh = await fsp.open(partOf(inc, i), 'r+'); s.i = i }
    // Room for it as it comes too (something else may be filling the disk).
    if (buf.byteLength && at % (64 * 1024 * 1024) < buf.byteLength) {
      const free = await freeSpace(inc.dest)
      if (free != null && free < buf.byteLength + 16 * 1024 * 1024) throw Object.assign(new Error('full'), { code: 'ENOSPC' })
    }
    await s.fh.write(buf, 0, buf.byteLength, at)
  } catch (e) {
    await closeFile(inc)
    if (e.code === 'ENOSPC') throw fail(`${thisName()}'s disk is full. Make room there, then Try again.`, { status: 507, code: 'space' })
    if (e.code === 'ENOENT') { inc.state = 'failed'; saveSoon(); throw fail('The copy\'s file there was moved or deleted. Start it again.', { status: 404, code: 'gone' }) }
    throw e
  }
  clearTimeout(s.idle)
  s.idle = setTimeout(() => closeFile(inc), 30000)
  s.idle.unref?.()
  f.have += buf.byteLength
  inc.touched = Date.now()
  saveSoon()
  return { have: f.have }
}

// File i is all here: checked against its SHA-256 from where it came (when that's known), then
// it's done. Not the same: it starts again from nothing (turned away with have: 0).
export async function fileDone(id, i, sha = null) {
  const inc = incOf(id)
  const f = inc.files[Number(i)]
  if (!f) throw fail('No such file in that copy', { status: 404 })
  return serial(inc, async () => {
    if (f.done) return { sha256: f.sha }
    if (f.have !== f.size) return { have: f.have, moved: true }
    await closeFile(inc)
    const got = await files.hashFile(partOf(inc, Number(i)))
    if (sha && got !== String(sha).toLowerCase()) {
      await fsp.truncate(partOf(inc, Number(i)), 0).catch(() => {})
      f.have = 0
      saveNow()
      throw fail(`${f.rel || inc.name} came through different from the original. It's sent again.`, { status: 409, code: 'hash' })
    }
    Object.assign(f, { done: true, sha: got, checked: sha ? 'sha256' : 'size' })
    saveSoon()
    return { sha256: got }
  })
}

// "final.mp4", or "final 2.mp4" when that's taken (a folder: "renders 2").
async function freeName(dir, name, isDir) {
  const ext = isDir ? '' : path.extname(name)
  const stem = ext && ext !== name ? name.slice(0, -ext.length) : name
  for (let n = 1; n < 1000; n++) {
    const cand = n === 1 ? name : `${stem} ${n}${ext && ext !== name ? ext : ''}`
    if (!(await exists(path.join(dir, cand)))) return cand
  }
  throw fail('Too many files with that name there')
}

// Everything is here and checked: it takes its name, where it goes.
export async function finish(id) {
  const inc = incOf(id)
  return serial(inc, async () => {
    if (inc.state === 'done') return landed(inc)
    const left = inc.files.filter((f) => !f.done)
    if (left.length) throw fail(`${left.length === 1 ? `${left[0].rel || inc.name} isn't` : `${left.length} files aren't`} all here yet`, { status: 409 })
    await closeFile(inc)
    for (;;) {
      const name = await freeName(inc.dest, inc.name, inc.dir)
      const to = path.join(inc.dest, name)
      try {
        // A file: linked under its name, which fails if something took that name meanwhile (a rename
        // would replace it). A folder, or a disk that has no links (FAT): renamed.
        if (!inc.dir) {
          try { await fsp.link(inc.stage, to); await fsp.unlink(inc.stage) } catch (e) { if (e.code === 'EEXIST') throw e; if (await exists(to)) throw Object.assign(new Error('taken'), { code: 'EEXIST' }); await fsp.rename(inc.stage, to) }
        } else await fsp.rename(inc.stage, to)
        Object.assign(inc, { state: 'done', final: to, renamed: name !== inc.name, endedAt: Date.now() })
        break
      } catch (e) { if (e.code !== 'EEXIST' && e.code !== 'ENOTEMPTY') throw e }
    }
    open.delete(inc.id)
    saveNow()
    return landed(inc)
  })
}
const landed = (inc) => ({ path: tilde(inc.final), name: path.basename(inc.final), folder: tilde(inc.dest), where: inc.where, renamed: !!inc.renamed, checked: inc.files.every((f) => f.checked === 'sha256') ? 'sha256' : 'size' })

// Stopped at the other end: what came so far is thrown away.
export async function drop(id, who = {}) {
  const inc = st.incoming.find((x) => x.id === id)
  if (!inc) return { ok: true }
  if (inc.from.id !== fromOf(who).id && fromOf(who).id !== 'here') throw fail('Only whoever sent it can stop it', { status: 403 })
  await closeFile(inc)
  open.delete(inc.id)
  if (inc.state !== 'done') await fsp.rm(inc.stage, { recursive: true, force: true }).catch(() => {})
  st.incoming = st.incoming.filter((x) => x !== inc)
  saveNow()
  return { ok: true }
}

// ---------- copies this computer runs ----------
const running = new Map() // job id -> { stop, wake }
const jobOf = (id) => st.jobs.find((j) => j.id === id) || null
const sleep = (ms, ctl) => new Promise((r) => { const t = setTimeout(r, ms); if (ctl) ctl.wake = () => { clearTimeout(t); r() } })
// p, or an error once ms go by with nothing from it.
const within = (p, ms, why) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error(why)), ms) })]).finally(() => clearTimeout(t)) }
// The connection dropped, the other device is asleep or restarting: worth waiting for. Anything
// else (it isn't there, no room, not allowed) is said and stops the copy.
const passing = (e) => !e.fatal && e.status !== 404

// Start a copy. pull: { from: machine id, src: { pane, path }, to } here; push: { to: machine id,
// src: { pane, path } here, into: where there }. move: put the original in the Trash once it's in.
export async function start(body = {}, { here = false } = {}) {
  const pull = !!body.from
  const machine = String(pull ? body.from : body.to || '')
  const m = machines.list().find((x) => x.id === machine)
  if (!m || m.state !== 'linked') throw fail('That device isn\'t linked to this one', { status: 404 })
  const src = { pane: String(body.src?.pane || ''), path: String(body.src?.path ?? '') }
  if (!src.pane) throw fail('Which file?')
  const job = {
    id: newId(), kind: pull ? 'pull' : 'push', machine, device: m.name, here,
    src, to: pull ? (body.into || { where: 'downloads' }) : (body.into || { where: 'downloads' }),
    move: !!body.move, name: (src.path.split('/').filter(Boolean).pop()) || null,
    state: 'going', got: 0, total: null, at: Date.now(), resumes: 0,
  }
  // A whole folder of an agent (path ''): named after it.
  if (!job.name) job.name = pull ? null : path.basename(await rootOf(src.pane))
  st.jobs.unshift(job)
  st.jobs = st.jobs.filter((j, i) => i < 40 || j.state === 'going' || j.state === 'waiting')
  saveNow()
  kick()
  return shownJob(job)
}

function kick() {
  const going = st.jobs.filter((j) => j.state === 'going' || j.state === 'waiting' || j.state === 'queued')
  let n = running.size
  for (const j of going.reverse()) { // oldest first
    if (running.has(j.id)) continue
    if (n >= RUNNING) { if (j.state !== 'waiting') j.state = 'queued'; continue }
    n++
    run(j)
  }
}

async function run(job) {
  const ctl = { stopped: false, wake: null, cancel: null }
  running.set(job.id, ctl)
  job.state = 'going'
  let wait = 2000
  try {
    for (;;) {
      try {
        if (job.kind === 'pull') await pull(job, ctl); else await push(job, ctl)
        job.state = 'done'
        job.endedAt = Date.now()
        job.error = null
        break
      } catch (e) {
        if (ctl.stopped) { job.state = 'stopped'; job.error = null; break }
        if (!passing(e)) { job.state = 'failed'; job.error = e.message; job.code = e.code || null; break }
        // Waiting for the other device: tried again by itself, less and less often, from where it got to.
        job.state = 'waiting'
        job.error = e.message
        saveSoon()
        await sleep(wait, ctl)
        wait = Math.min(wait * 2, 30000)
        if (ctl.stopped) { job.state = 'stopped'; job.error = null; break }
        job.state = 'going'
        job.resumes++
        job.resumedAt = job.got
      }
    }
  } finally {
    running.delete(job.id)
    saveNow()
    kick()
  }
}

// A request to the other device, its answer as JSON; a refusal there is thrown with its words (and
// a 4xx stops the copy: it won't go better by itself).
async function ask(job, method, u, body, ms = 30000) {
  const r = await machines.exchange(job.machine, { method, u, headers: [['content-type', body && !Buffer.isBuffer(body) ? 'application/json' : 'application/octet-stream']], body: body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)), ms })
  const j = await r.json()
  if (r.status >= 400) {
    // Its answer to an address it doesn't have: a Bridge AI from before copies.
    if (r.status === 404 && j?.error === 'Not found' && !j.missing) throw fail(`Update Bridge AI on ${job.device} to copy files with it.`, { status: 404, code: 'update' })
    throw Object.assign(new Error(j?.error || `${job.device} answered ${r.status}`), { status: r.status, code: j?.code, fatal: r.status < 500 && r.status !== 408 && r.status !== 429, j })
  }
  return j
}

const srcPath = (job, f) => (f.rel ? [job.src.path, f.rel].filter(Boolean).join('/') : job.src.path)

// This computer copies from the other: the list of what's there, then each file in parts.
async function pull(job, ctl) {
  const q = (p) => `/api/agents/${enc(job.src.pane)}/${p}`
  if (job.inc && !(await settle(incOf(job.inc)).catch(() => false))) delete job.inc
  if (!job.inc) {
    const list = await ask(job, 'GET', q(`tree?path=${enc(job.src.path)}`))
    job.name ||= list.name
    const out = await begin({ key: job.key || job.id, name: list.name, dir: list.dir, files: list.files, dirs: list.dirs, to: job.to }, { here: job.here, kind: 'machine', id: `pull:${job.machine}`, name: job.device })
    Object.assign(job, { inc: out.id, total: list.total, dir: list.dir, count: list.files.length, links: list.links || 0, mtimes: list.files.map((f) => f.mtime) })
    saveNow()
  }
  const inc = incOf(job.inc)
  for (const [i, f] of inc.files.entries()) {
    if (f.done) continue
    // Its SHA-256 there, worked out while it comes (null from a Bridge AI too old to say).
    const want = ask(job, 'GET', q(`hash?path=${enc(srcPath(job, f))}`), undefined, 15 * 60000).catch((e) => (e.code === 'update' ? null : Promise.reject(e)))
    want.catch(() => {})
    for (let again = 0; ; again++) {
      if (f.have < f.size) await pullFile(job, inc, i, ctl)
      const there = await want
      if (there && (there.size !== f.size || (job.mtimes?.[i] && Math.abs(there.mtime - job.mtimes[i]) > 1))) throw fail(`${f.rel || job.name} changed on ${job.device} while it was being copied. Try again once it's finished there.`, { code: 'changed' })
      try { await fileDone(inc.id, i, there?.sha256 || null); break } catch (e) { if (e.code !== 'hash' || again) throw e }
    }
    job.got = sum(inc.files)
  }
  job.result = await finish(inc.id)
  job.checked = job.result.checked
  if (job.move) await ask(job, 'POST', q('fileop'), { op: 'trash', path: job.src.path }).then(() => { job.moved = true }, (e) => { job.note = `Copied. The original couldn't go to the Trash on ${job.device}: ${e.message}` })
}

async function pullFile(job, inc, i, ctl) {
  const f = inc.files[i]
  const from = f.have
  const r = await machines.exchange(job.machine, { u: `/api/agents/${enc(job.src.pane)}/raw?path=${enc(srcPath(job, f))}`, headers: from ? [['range', `bytes=${from}-`]] : [], window: PULL_WINDOW, ms: 30000 })
  ctl.cancel = () => r.cancel()
  try {
    if (r.status === 404) throw fail(`${f.rel || job.name} isn't on ${job.device} any more`, { status: 404 })
    if (r.status === 416 || (r.status !== 200 && r.status !== 206)) throw fail(`${job.device} answered ${r.status}`, { status: r.status })
    const len = r.status === 206 ? Number(/\/(\d+)$/.exec(r.header('content-range') || '')?.[1]) : Number(r.header('content-length'))
    if (Number.isFinite(len) && len !== f.size) throw fail(`${f.rel || job.name} changed on ${job.device} while it was being copied. Try again once it's finished there.`, { code: 'changed' })
    // The whole file, though part of it was asked for: it starts again from the top.
    if (from && r.status === 200) { await serial(inc, async () => { await closeFile(inc); await fsp.truncate(partOf(inc, i), 0); f.have = 0 }) }
    let at = f.have
    for (;;) {
      const c = await within(r.next(), 60000, `${job.device} stopped sending`)
      if (!c) break
      if (ctl.stopped) throw new Error('stopped')
      const w = await serial(inc, () => writeAt(inc, i, at, c))
      if (w.moved) throw new Error('out of step')
      at += c.byteLength
      r.took(c.byteLength)
      job.got = sum(inc.files)
    }
    if (at !== f.size) throw new Error(`The connection to ${job.device} dropped`)
  } catch (e) { r.cancel(); throw e } finally { ctl.cancel = null }
}

// This computer sends to the other: where it goes there says how much it has, then each file goes
// PIECE at a time from there, each one written there before the next.
async function push(job, ctl) {
  const root = await rootOf(job.src.pane).catch(() => { throw fail('That agent isn\'t here any more', { status: 404 }) })
  if (!job.list) {
    const list = await files.copyList(root, job.src.path).catch((e) => { throw fail(e.message, { status: e.status || 404 }) })
    Object.assign(job, { list, total: list.total, dir: list.dir, count: list.files.length, links: list.links || 0 })
    job.name ||= list.name
    saveNow()
  }
  const { list } = job
  const out = await ask(job, 'POST', '/api/transfers/in', { key: job.key || job.id, name: job.name, dir: list.dir, files: list.files.map(({ rel, size }) => ({ rel, size })), dirs: list.dirs, to: job.to })
  job.remote = out.id
  const have = out.have.slice()
  const base = `/api/transfers/in/${enc(out.id)}`
  const top = (await files.safePath(root, job.src.path)).real
  for (const [i, f] of list.files.entries()) {
    const file = path.join(top, ...(f.rel ? f.rel.split('/') : []))
    const now = await fsp.stat(file).catch(() => null)
    if (!now) throw fail(`${f.rel || job.name} isn't here any more`, { status: 404 })
    if (now.size !== f.size || Math.abs(now.mtimeMs - f.mtime) > 1) throw fail(`${f.rel || job.name} changed while it was being copied. Try again once it's finished.`, { code: 'changed' })
    const sha = files.hashFile(file)
    sha.catch(() => {})
    for (let again = 0; ; again++) {
      if (have[i] < f.size) await pushFile(job, ctl, file, i, f, have, base)
      try {
        const d = await ask(job, 'POST', `${base}/${i}/done`, { sha256: await sha }, 15 * 60000)
        if (!d.moved) break
        have[i] = d.have // it has less than it was sent (its disk lost the end): from there
      } catch (e) { if (e.code === 'hash' && !again) { have[i] = 0; continue } throw e }
    }
    have[i] = f.size
    job.got = list.files.reduce((n, x, k) => n + (k <= i ? x.size : have[k] || 0), 0)
  }
  job.result = await ask(job, 'POST', `${base}/done`, {})
  job.checked = job.result.checked
  if (job.move) await files.trash(root, job.src.path).then(() => { job.moved = true }, (e) => { job.note = `Copied. The original couldn't go to the Trash: ${e.message}` })
}

async function pushFile(job, ctl, file, i, f, have, base) {
  const fh = await fsp.open(file, 'r')
  try {
    let next = null
    const readAt = async (at) => { const n = Math.min(PIECE, f.size - at); const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, at); return b.subarray(0, bytesRead) }
    while (have[i] < f.size) {
      if (ctl.stopped) throw new Error('stopped')
      const at = have[i]
      const buf = await (next?.at === at ? next.p : readAt(at))
      // The next piece is read from disk while this one goes.
      next = at + buf.byteLength < f.size ? { at: at + buf.byteLength, p: readAt(at + buf.byteLength) } : null
      const r = await ask(job, 'PUT', `${base}/${i}?at=${at}`, buf, 120000)
      have[i] = r.have
      job.got = job.list.files.reduce((n, x, k) => n + (k < i ? x.size : k === i ? have[i] : 0), 0)
    }
  } finally { await fh.close().catch(() => {}) }
}

// ---------- what the app shows ----------
function shownJob(j) {
  return {
    id: j.id, kind: j.kind, name: j.name, dir: !!j.dir, count: j.count ?? null, device: j.device, state: j.state,
    got: j.got || 0, total: j.total, error: j.error || null, code: j.code || null, note: j.note || null,
    into: j.result?.where || null, result: j.result || null, checked: j.checked || null, moved: !!j.moved, move: !!j.move,
    links: j.links || 0, at: j.at, endedAt: j.endedAt || null, resumes: j.resumes || 0, resumedAt: j.resumedAt ?? null,
    // Show in Finder: where it landed, when that's this computer.
    here: j.kind === 'pull',
  }
}
const shownIn = (x) => ({
  id: x.id, kind: 'in', name: x.name, dir: x.dir, count: x.files.length, from: x.from.name || (x.from.kind === 'here' ? null : x.from.kind), fromKind: x.from.kind,
  state: x.state, got: sum(x.files), total: x.total, into: x.where, result: x.state === 'done' ? landed(x) : null, at: x.at, endedAt: x.endedAt || null, here: true,
})
export function list() {
  const now = Date.now()
  return {
    jobs: st.jobs.filter((j) => !j.endedAt || now - j.endedAt < KEEP_DONE || j.state === 'failed').map(shownJob),
    // Copies others are making to this computer (a pull of this one's is its own job, above).
    incoming: st.incoming.filter((x) => !x.from.id.startsWith('pull:') && (x.state === 'coming' || now - (x.endedAt || 0) < KEEP_DONE)).map(shownIn),
  }
}

export function stop(id) {
  const j = jobOf(id)
  if (!j) throw fail('No such copy', { status: 404 })
  const ctl = running.get(id)
  if (ctl) { ctl.stopped = true; ctl.cancel?.(); ctl.wake?.() } else if (['going', 'waiting', 'queued'].includes(j.state)) j.state = 'stopped'
  // What came so far is thrown away, there or here.
  if (j.kind === 'push' && j.remote) machines.exchange(j.machine, { method: 'DELETE', u: `/api/transfers/in/${enc(j.remote)}`, ms: 8000 }).then((r) => r.json()).catch(() => {})
  if (j.kind === 'pull' && j.inc) { const inc = j.inc; setTimeout(() => drop(inc, { id: 'here' }).catch(() => {}), 200) }
  for (const k of ['inc', 'remote', 'list', 'mtimes']) delete j[k]
  Object.assign(j, { got: 0, key: newId() })
  saveNow()
  return shownJob(j)
}
export function retry(id) {
  const j = jobOf(id)
  if (!j) throw fail('No such copy', { status: 404 })
  if (running.has(id) || j.state === 'done') return shownJob(j)
  // It changed where it was, or was stopped: from the top, as a new copy (what came of the old
  // one is let go). Otherwise from where it got to.
  if (j.code === 'changed' || j.state === 'stopped' || j.code === 'gone') {
    if (j.kind === 'push' && j.remote) machines.exchange(j.machine, { method: 'DELETE', u: `/api/transfers/in/${enc(j.remote)}`, ms: 8000 }).then((r) => r.json()).catch(() => {})
    if (j.kind === 'pull' && j.inc) drop(j.inc, { id: 'here' }).catch(() => {})
    for (const k of ['inc', 'remote', 'list', 'mtimes']) delete j[k]
    Object.assign(j, { key: newId(), got: 0 })
  }
  Object.assign(j, { state: 'going', error: null, code: null, endedAt: null })
  saveNow()
  kick()
  return shownJob(j)
}
// Finished ones out of the list.
export function clear() {
  st.jobs = st.jobs.filter((j) => !['done', 'failed', 'stopped'].includes(j.state))
  st.incoming = st.incoming.filter((x) => x.state === 'coming')
  saveNow()
  return list()
}

// Where it landed, shown in Finder (Explorer, the file manager), on this computer.
export async function reveal(id) {
  const j = jobOf(id)
  const x = j ? (j.inc && st.incoming.find((y) => y.id === j.inc)) : st.incoming.find((y) => y.id === id)
  const p = x?.final
  if (!p) throw fail('It isn\'t on this computer', { status: 404 })
  const [bin, args] = IS_MAC ? ['open', ['-R', p]] : IS_WIN ? ['explorer.exe', [`/select,${p}`]] : ['xdg-open', [x.dir ? p : path.dirname(p)]]
  if (DRYRUN) return { ok: true, dry: [bin, ...args] } // tests: nothing opens
  await new Promise((resolve) => execFile(bin, args, { timeout: 10000, windowsHide: true }, () => resolve()))
  return { ok: true }
}

// ---------- start ----------
// Copies that were going when Bridge AI stopped carry on; a copy coming in that nobody carried on
// with for a week is let go, with what came of it.
export function resume() {
  const now = Date.now()
  for (const x of st.incoming.filter((y) => y.state !== 'done' && now - (y.touched || y.at) > STALE_IN)) fsp.rm(x.stage, { recursive: true, force: true }).catch(() => {})
  st.incoming = st.incoming.filter((y) => (y.state === 'done' ? now - (y.endedAt || 0) < KEEP_DONE : now - (y.touched || y.at) <= STALE_IN))
  for (const j of st.jobs) if (j.state === 'queued') j.state = 'going'
  setTimeout(kick, 3000).unref?.()
}
