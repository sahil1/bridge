// Your saved signatures and initials (Studio's Sign this), as Preview keeps them: as many as you
// like, each named, one of each kind the default. Kept only on this computer, in
// <data>/studio/signatures, encrypted (AES-256-GCM) with a key that isn't in the data folder where
// the computer has somewhere safer for it:
//   a Mac       its Keychain (native/bridgesign key: a login-keychain item only that helper reads
//               without asking; never synced to iCloud Keychain)
//   Windows     DPAPI: the key is in the folder, sealed to your Windows account
//   elsewhere   a key file beside them, readable by you alone (Linux, Docker: no keychain to ask)
// Nothing in the folder is a picture anyone can open: each image and the list are sealed files
// (BSIG1), each bound to its own name so one can't be swapped for another. They're never synced,
// never sent to a model, a bot, MCP, a Share Link or a crash report; only Back Up & Move carries
// them, inside its own sealed file (backup.js), and only when you pick them.
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { DATA, IS_MAC, IS_WIN, writeFileAtomic } from './paths.js'
import { signBin } from './signhelper.js'

export const DIR = path.join(DATA, 'studio', 'signatures')
const STORE = path.join(DIR, 'store.bin')
const KEYFILE = path.join(DIR, 'key')
const DPAPI = path.join(DIR, 'key.dpapi')
export const KINDS = ['signature', 'initials']
export const MAX_PNG = 1.5 * 1024 * 1024
const MAX_EACH = 20 // of each kind
const MAGIC = Buffer.from('BSIG1')
const err = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })

// ---------- The key ----------
let keyP = null
let where = null // 'keychain' | 'dpapi' | 'file'
export const sealedWith = () => where
const run = (bin, args, o = {}) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true, ...o }, (e, out, errOut) => (e ? reject(Object.assign(e, { out: String(out || ''), errOut: String(errOut || '') })) : resolve(String(out || ''))))
})
const lastJson = (out) => { try { return JSON.parse(String(out).trim().split('\n').pop()) } catch { return null } }

async function keychainKey(bin) {
  const out = lastJson(await run(bin, ['key']).catch((e) => e.out))
  const k = out?.key ? Buffer.from(out.key, 'base64') : null
  if (k?.length === 32) return k
  throw err(`This Mac's Keychain didn't give the key your signatures are kept with${out?.error ? `: ${out.error}` : ''}. Unlock the Keychain (it opens with your Mac's password) and try again.`, 503, 'keychain')
}
// Windows: a key sealed to your account by DPAPI (as Electron's safeStorage does there).
const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
async function dpapi(how, b64) {
  const script = `Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String('${b64}'); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${how}($b, $null, 'CurrentUser'))`
  const out = await run(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')])
  return Buffer.from(out.trim(), 'base64')
}
async function dpapiKey() {
  try {
    const k = await dpapi('Unprotect', (await fsp.readFile(DPAPI, 'utf8')).trim())
    if (k.length === 32) return k
  } catch (e) { if (e.code !== 'ENOENT') throw err(`Windows couldn't open the key your signatures are kept with: ${e.message}`, 503, 'dpapi') }
  const k = crypto.randomBytes(32)
  const sealed = await dpapi('Protect', k.toString('base64'))
  writeFileAtomic(DPAPI, sealed.toString('base64'), { mode: 0o600 })
  return k
}
const readFileKey = async () => { try { const k = Buffer.from((await fsp.readFile(KEYFILE, 'utf8')).trim(), 'base64'); return k.length === 32 ? k : null } catch { return null } }
async function fileKey() {
  const have = await readFileKey()
  if (have) return have
  // None yet, and signatures sealed already: by the Keychain's or Windows' key, which this copy of
  // Bridge AI can't reach (run from a clone that didn't build the helper). Said, and nothing made
  // over them, so they open again once it can.
  if (fs.existsSync(STORE)) throw err(IS_MAC ? 'Your signatures are sealed with this Mac\'s Keychain by Bridge AI\'s signing helper, which isn\'t in this copy of Bridge AI (build it with npm run calltap, or use the app)' : 'Your signatures are sealed with a key this copy of Bridge AI can\'t reach', 503, 'no-key')
  const k = crypto.randomBytes(32)
  writeFileAtomic(KEYFILE, k.toString('base64'), { mode: 0o600 })
  return k
}
// Sealed with a key file before the Keychain (or DPAPI) could be used: each file sealed again with
// the better key, then the key file overwritten and taken away. One that won't open with the old
// key is left as it is.
async function rekey(old, k) {
  for (const f of (await fsp.readdir(DIR)).filter((x) => x.endsWith('.bin'))) {
    const name = f === 'store.bin' ? 'store' : f.slice(0, -4)
    const at = path.join(DIR, f)
    try { writeFileAtomic(at, sealWith(k, name, openWith(old, name, await fsp.readFile(at))), { mode: 0o600 }) } catch { /* not the old key's */ }
  }
  await wipe(KEYFILE)
}
async function loadKey() {
  await fsp.mkdir(DIR, { recursive: true, mode: 0o700 })
  await fsp.chmod(DIR, 0o700).catch(() => {})
  const bin = IS_MAC || process.env.BRIDGE_SIGNHELPER ? signBin() : null
  let k = null
  if (bin) { k = await keychainKey(bin); where = 'keychain' } else if (IS_WIN && !process.env.BRIDGE_FIX_DRYRUN) {
    try { k = await dpapiKey(); where = 'dpapi' } catch (e) { if (fs.existsSync(DPAPI)) throw e }
  }
  if (k) {
    const old = await readFileKey()
    if (old) await rekey(old, k)
    return k
  }
  k = await fileKey()
  where = 'file'
  return k
}
const key = () => (keyP ||= loadKey().catch((e) => { keyP = null; throw e }))

// ---------- Sealed files ----------
export const seal = async (name, buf) => sealWith(await key(), name, buf)
export const open = async (name, sealed) => openWith(await key(), name, sealed)
function sealWith(k, name, buf) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', k, iv)
  c.setAAD(Buffer.from(name))
  const body = Buffer.concat([c.update(buf), c.final()])
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body])
}
function openWith(k, name, sealed) {
  if (sealed.length < MAGIC.length + 28 || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) throw err('Not a sealed signature file', 500)
  const iv = sealed.subarray(5, 17), tag = sealed.subarray(17, 33)
  const d = crypto.createDecipheriv('aes-256-gcm', k, iv)
  d.setAAD(Buffer.from(name))
  d.setAuthTag(tag)
  try { return Buffer.concat([d.update(sealed.subarray(33)), d.final()]) } catch { throw err('A saved signature couldn\'t be opened with this computer\'s key (it was made on another computer, or changed)', 500, 'sealed') }
}
const fileOf = (id) => path.join(DIR, `${id}.bin`)
const okId = (id) => /^[a-z0-9]{8,32}$/.test(String(id || ''))

// ---------- The list ----------
// { list: [{ id, kind, name, at, width, height }], defaults: { signature: id, initials: id } }
let cache = null
let chain = Promise.resolve()
const one = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p }

// Read once (two asking at once wait for the same read, so one kept open before is sealed once).
let reading = null
const readStore = () => (cache ? Promise.resolve(cache) : (reading ||= loadStore().finally(() => { reading = null })))
async function loadStore() {
  await key() // (first: a file sealed again with a better key is read after, not before)
  let s = { list: [], defaults: {} }
  try { s = JSON.parse((await open('store', await fsp.readFile(STORE))).toString('utf8')) } catch (e) {
    if (e.code === 'sealed') s = { list: [], defaults: {}, setAside: await setAside() }
    else if (e.code !== 'ENOENT') throw e
  }
  s.list = Array.isArray(s.list) ? s.list.filter((x) => okId(x?.id) && KINDS.includes(x.kind)) : []
  s.defaults = s.defaults && typeof s.defaults === 'object' ? s.defaults : {}
  await migrate(s)
  if (s.setAside) await writeStore(s)
  cache = s
  return s
}
// Sealed with a key this computer doesn't have (the folder came from another computer, or the
// Keychain's item was deleted): they can't be opened here, so they're moved aside, into a folder of
// their own beside them (never deleted: with the old key they'd open again), and the list starts
// empty, saying so once. { at, n }
async function setAside() {
  const to = path.join(DIR, `set-aside-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await fsp.mkdir(to, { recursive: true, mode: 0o700 })
  const files = (await fsp.readdir(DIR)).filter((f) => f.endsWith('.bin'))
  for (const f of files) await fsp.rename(path.join(DIR, f), path.join(to, f)).catch(() => {})
  return { at: new Date().toISOString(), n: Math.max(0, files.length - 1) }
}
// Said until a new one is drawn: the list's set-aside note.
export const setAsideNote = () => one(async () => (await readStore()).setAside || null)
async function writeStore(s) {
  for (const k of KINDS) if (!s.list.some((x) => x.id === s.defaults[k] && x.kind === k)) s.defaults[k] = s.list.find((x) => x.kind === k)?.id || null
  writeFileAtomic(STORE, await seal('store', Buffer.from(JSON.stringify(s))), { mode: 0o600 })
  cache = s
}

// Before 3.22, the two were PNGs in this folder, in the open: sealed the first time they're read,
// and the open ones overwritten and taken away.
async function migrate(s) {
  const idx = path.join(DIR, 'index.json')
  let old
  try { old = JSON.parse(await fsp.readFile(idx, 'utf8')) } catch { return }
  for (const kind of KINDS) {
    const f = path.join(DIR, `${kind}.png`)
    let buf
    try { buf = await fsp.readFile(f) } catch { continue }
    if (!isPng(buf)) continue
    const id = newId()
    await fsp.writeFile(fileOf(id), await seal(id, buf), { mode: 0o600 })
    s.list.push({ id, kind, name: kind === 'initials' ? 'Initials' : 'Signature', at: old?.[kind]?.at || new Date().toISOString(), width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) })
    s.defaults[kind] ||= id
  }
  await writeStore(s)
  for (const kind of KINDS) await wipe(path.join(DIR, `${kind}.png`))
  await fsp.rm(idx, { force: true })
}
// Overwritten before it's taken away, so the picture isn't left whole in the file's old blocks
// (as far as a file system that writes in place allows).
async function wipe(f) {
  try { const st = await fsp.stat(f); await fsp.writeFile(f, crypto.randomBytes(Math.min(st.size, MAX_PNG * 2))) } catch { return }
  await fsp.rm(f, { force: true })
}

const newId = () => crypto.randomBytes(8).toString('hex')
const isPng = (buf) => buf && buf.length >= 33 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR'
const pub = (s) => s.list.map((x) => ({ id: x.id, kind: x.kind, name: x.name, at: x.at, width: x.width, height: x.height, default: s.defaults[x.kind] === x.id }))
const cleanName = (n, kind) => String(n ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || (kind === 'initials' ? 'Initials' : 'Signature')

// What's saved, without the pictures: [{ id, kind, name, at, width, height, default }].
export const list = () => one(async () => pub(await readStore()))
// The one to use: by id, else the default of its kind. null when there's none.
export async function pick(kind, id) {
  const s = await readStore()
  return s.list.find((x) => x.id === id && x.kind === kind) || s.list.find((x) => x.id === s.defaults[kind]) || null
}
// A PNG the page drew (data:image/png;base64,...), its size read from its own header.
export function pngOf(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''))
  const buf = m ? Buffer.from(m[1], 'base64') : null
  if (!isPng(buf)) throw err('Expected a drawing, as a PNG')
  if (buf.length > MAX_PNG) throw err('That drawing is too big to keep')
  return buf
}
export const add = ({ kind, name, png, makeDefault = false, replace = null }) => one(async () => {
  if (!KINDS.includes(kind)) throw err('Only a signature or initials')
  const buf = Buffer.isBuffer(png) ? png : pngOf(png)
  if (!isPng(buf) || buf.length > MAX_PNG) throw err('Expected a drawing, as a PNG')
  const s = await readStore()
  const old = replace ? s.list.find((x) => x.id === replace && x.kind === kind) : null
  if (!old && s.list.filter((x) => x.kind === kind).length >= MAX_EACH) throw err(kind === 'initials' ? `There are ${MAX_EACH} initials saved already: remove one first` : `There are ${MAX_EACH} signatures saved already: remove one first`)
  const id = newId()
  await fsp.writeFile(fileOf(id), await seal(id, buf), { mode: 0o600 })
  const n = s.list.filter((x) => x.kind === kind).length
  const entry = { id, kind, name: name ? cleanName(name, kind) : old?.name || cleanName(n ? `${kind === 'initials' ? 'Initials' : 'Signature'} ${n + 1}` : '', kind), at: new Date().toISOString(), width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  if (old) {
    s.list = s.list.map((x) => (x.id === old.id ? entry : x))
    if (s.defaults[kind] === old.id) s.defaults[kind] = id
  } else s.list.push(entry)
  if (makeDefault || !s.defaults[kind]) s.defaults[kind] = id
  delete s.setAside
  await writeStore(s)
  if (old) await wipe(fileOf(old.id))
  return { id, list: pub(s) }
})
export const change = (id, { name, makeDefault }) => one(async () => {
  const s = await readStore()
  const x = s.list.find((e) => e.id === id)
  if (!x) throw err('No saved signature by that id', 404)
  if (name != null) x.name = cleanName(name, x.kind)
  if (makeDefault) s.defaults[x.kind] = x.id
  await writeStore(s)
  return pub(s)
})
export const remove = (id) => one(async () => {
  const s = await readStore()
  if (!s.list.some((e) => e.id === id)) throw err('No saved signature by that id', 404)
  s.list = s.list.filter((e) => e.id !== id)
  await writeStore(s)
  await wipe(fileOf(id))
  return pub(s)
})
// A picture, opened: the PNG's bytes. For the page that shows it to you and for the signed copy.
export async function image(id) {
  const s = await readStore()
  const x = s.list.find((e) => e.id === id)
  if (!x) throw err('No saved signature by that id', 404)
  return open(x.id, await fsp.readFile(fileOf(x.id)))
}

// ---------- Back Up & Move (backup.js) ----------
// Every one, opened, for a backup's own sealed file; and put back on another computer, sealed with
// its key. Never anywhere else.
export async function exportAll() {
  const s = await readStore()
  const out = []
  for (const x of s.list) out.push({ kind: x.kind, name: x.name, at: x.at, default: s.defaults[x.kind] === x.id, png: (await image(x.id)).toString('base64') })
  return out
}
export async function importAll(items) {
  let n = 0
  for (const x of Array.isArray(items) ? items.slice(0, MAX_EACH * 2) : []) {
    try {
      const buf = Buffer.from(String(x?.png || ''), 'base64')
      const have = await list()
      if (have.some((h) => h.kind === x.kind && h.name === cleanName(x.name, x.kind) && h.width === buf.readUInt32BE(16) && h.height === buf.readUInt32BE(20))) continue
      await add({ kind: x.kind, name: x.name, png: buf, makeDefault: !!x.default })
      n++
    } catch { /* one that can't be read is left out */ }
  }
  return n
}
// ---------- Ask Before Signing (signauth.js) ----------
// Kept in the same sealed list, not in config.json: nothing that can only write files or call the
// settings API can turn it off or change its PIN; only signauth.js does, after asking.
// { on, pin: { salt, hash } | null, fails, lockUntil, locks }
export const askOf = () => one(async () => ({ on: false, pin: null, fails: 0, lockUntil: 0, locks: 0, ...((await readStore()).ask || {}) }))
export const setAsk = (fn) => one(async () => {
  const s = await readStore()
  s.ask = { on: false, pin: null, fails: 0, lockUntil: 0, locks: 0, ...(s.ask || {}), ...fn({ on: false, pin: null, fails: 0, lockUntil: 0, locks: 0, ...(s.ask || {}) }) }
  await writeStore(s)
  return s.ask
})

// For the tests and a reset: the key forgotten in memory (read again next time).
export const forgetKey = () => { keyP = null; cache = null }
