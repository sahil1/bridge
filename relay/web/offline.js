// What this phone keeps for when your computer is offline (shell.js uses it):
//
// - A saved copy of what it last showed: Bridge AI's page and files, and the latest answers for its
//   main views (your agents, the chats you opened lately, usage, the brief), kept as they come over
//   the link. With your computer offline, Bridge AI opens from it, read-only, with a banner saying so.
//   Up to 24 MB, the least used going first. Deleted when you forget the computer, or it forgets
//   this phone.
// - The outbox: messages you send an agent (and answers to its questions) while your computer is
//   offline. Each is sealed for your computer (notes, in link.js) and left in your relay, which keeps
//   it until the computer is back, even if this phone is closed by then; a receipt comes back the
//   same way. An older relay can't keep them: then they wait here and go over the link once both are
//   online. Your computer acts on each once, however many times it gets it.
//
// Kept in IndexedDB (Safari, Chrome and the Android app, where each relay is its own site, so each
// computer has its own), or in the iPhone app's own files, a folder per computer (its "store").
import { sealNote, openNote, boxId, rawPublic, unb64u, NOTE_DAYS } from './link.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const DAY = 24 * 3600 * 1000
const MAX_BYTES = 24 * 1024 * 1024
const MAX_ONE = 4 * 1024 * 1024
const MAX_NOTE = 40 * 1024

let ctx = null // { relay(), pairing(), send(obj) (to the relay; false if it can't keep notes), call(m, u, body) (over the link) }
let store = null
export function use(c) {
  ctx = c
  store = makeStore(c.relay)
}

// ---------- where it's kept ----------
function makeStore(relay) {
  const ios = window.bridgeNative && window.webkit?.messageHandlers?.store
  if (ios) {
    const call = (op, key, value) => ios.postMessage({ op, relay: relay(), key, value })
    return {
      get: async (k) => { const s = await call('get', k); return s == null ? null : JSON.parse(s) },
      set: (k, v) => call('set', k, JSON.stringify(v)),
      del: (k) => call('del', k),
      clear: () => call('clear'),
    }
  }
  // Next to the pairing, under keys of its own.
  let dbp
  const db = () => (dbp ||= new Promise((ok, no) => {
    const r = indexedDB.open('bridge-relay', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => ok(r.result)
    r.onerror = () => no(r.error)
  }))
  const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const t = d.transaction('kv', mode); const r = fn(t.objectStore('kv')); t.oncomplete = () => ok(r?.result); t.onerror = () => no(t.error) }) }
  return {
    get: (k) => tx('readonly', (s) => s.get(`offline:${k}`)),
    set: (k, v) => tx('readwrite', (s) => s.put(v, `offline:${k}`)),
    del: (k) => tx('readwrite', (s) => s.delete(`offline:${k}`)),
    clear: () => tx('readwrite', (s) => s.delete(IDBKeyRange.bound('offline:', 'offline:\uffff'))),
  }
}

// Forget everything kept for this computer.
export async function clear() {
  index = {}
  items = []
  fresh = []
  clearTimeout(indexTimer)
  for (const p of pending.values()) clearTimeout(p.timer)
  pending.clear()
  await store?.clear().catch(() => {})
  // And the app's files the service worker keeps (sw.js), where there is one.
  try { await globalThis.caches?.delete('bridge-relay-assets-v1') } catch { /* none here */ }
  changed()
}

// ---------- the saved copy ----------
// What's kept: the app's page and files, and the answers its main views need.
const KEEP = [
  /^\/assets\//,
  /^\/api\/(fleet|config|settings|quota|previews|places|weather|version|relay|routines|ideas|insights|runtime-theme|agent-kinds|panes|updates|brief)$/,
  /^\/api\/usage\/[\w-]+(\/stats)?$/,
  /^\/api\/agents\/[^/]+\/(transcript|subagents|screen)$/,
]
// Live answers (server-sent events) are kept as the plain answer each stands for.
const LIVE = [
  [/^\/api\/events$/, 'fleet', () => '/api/fleet'],
  [/^\/api\/agents\/([^/]+)\/transcript\/live$/, 'message', (m) => `/api/agents/${m[1]}/transcript`],
]
// Only so many of a kind (the chats of the agents you opened most lately).
const FEW = [[/\/transcript$/, 12], [/\/screen\?/, 8], [/\/usage\//, 8]]

function keyOf(u) {
  const [path, query = ''] = String(u).split('?')
  if (path === '/' || path === '/index.html') return '/'
  if (!KEEP.some((re) => re.test(path))) return null
  if (path.startsWith('/assets/')) return path
  const q = new URLSearchParams(query)
  q.delete('refresh')
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

let index = null // key -> [size, last used]
const loadIndex = async () => (index ||= (await store.get('index').catch(() => null)) || {})
let indexTimer = null
const saveIndex = () => { clearTimeout(indexTimer); indexTimer = setTimeout(() => store.set('index', index).catch(() => {}), 1000) }
const header = (h, name) => (h || []).find(([k]) => k.toLowerCase() === name)?.[1] || ''
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) }

// Writes of one answer at most every few seconds (a chat that's streaming, a polled screen): the
// latest wins.
const pending = new Map() // key -> { head, bytes, timer }
const lastWrite = new Map()
function keep(key, head, bytes) {
  const wait = 4000 - (Date.now() - (lastWrite.get(key) || 0))
  const p = pending.get(key)
  if (p) { p.head = head; p.bytes = bytes; return }
  if (wait <= 0) return write(key, head, bytes)
  const q = { head, bytes }
  q.timer = setTimeout(() => { pending.delete(key); write(key, q.head, q.bytes) }, wait)
  pending.set(key, q)
}
async function write(key, head, bytes) {
  if (!store || !ctx.pairing()?.hostKey || bytes.byteLength > MAX_ONE) return
  lastWrite.set(key, Date.now())
  const type = header(head.h, 'content-type')
  const text = /json|text|javascript|css|svg|xml/.test(type)
  try {
    await store.set(`saved:${key}`, { s: head.s, h: type ? [['content-type', type]] : [], at: Date.now(), ...(text ? { t: dec.decode(bytes) } : { b: b64(bytes) }) })
    await loadIndex()
    index[key] = [bytes.byteLength, Date.now()]
    await trim()
    saveIndex()
  } catch { /* full: it's only a copy */ }
}
async function trim() {
  const drop = []
  const byUse = Object.entries(index).sort((a, b) => a[1][1] - b[1][1])
  for (const [re, n] of FEW) { const these = byUse.filter(([k]) => re.test(k)); drop.push(...these.slice(0, Math.max(0, these.length - n)).map(([k]) => k)) }
  let total = byUse.filter(([k]) => !drop.includes(k)).reduce((n, [, [size]]) => n + size, 0)
  for (const [k, [size]] of byUse) { if (total <= MAX_BYTES) break; if (!drop.includes(k) && k !== '/') { drop.push(k); total -= size } }
  for (const k of drop) { delete index[k]; await store.del(`saved:${k}`).catch(() => {}) }
}

// Keep a request's answer as it comes in: { chunk(bytes), end() }, or null if it isn't one to keep.
// `assets`: also the app's own files (the service worker keeps those itself where there is one).
export function tap(u, head, { assets }) {
  if (head?.s !== 200) return null
  const path = String(u).split('?')[0]
  if (/event-stream/.test(header(head.h, 'content-type'))) {
    const live = LIVE.find(([re]) => re.test(path))
    if (!live) return null
    const key = live[2](live[0].exec(path))
    const d = new TextDecoder()
    let buf = ''
    return {
      chunk: (c) => {
        buf += d.decode(c, { stream: true })
        for (let i; (i = buf.indexOf('\n\n')) >= 0; buf = buf.slice(i + 2)) {
          let name = 'message'
          const data = []
          for (const line of buf.slice(0, i).split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim()
            else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
          }
          if (name === live[1] && data.length) keep(key, { s: 200, h: [['content-type', 'application/json']] }, enc.encode(data.join('\n')))
        }
      },
      end: () => {},
    }
  }
  const key = keyOf(u)
  if (!key || (!assets && key.startsWith('/assets/'))) return null
  const parts = []
  let n = 0
  return {
    chunk: (c) => { n += c.byteLength; if (n <= MAX_ONE) parts.push(c.slice()) },
    end: () => {
      if (n > MAX_ONE) return
      const all = new Uint8Array(n)
      let o = 0
      for (const p of parts) { all.set(p, o); o += p.byteLength }
      keep(key, head, all)
    },
  }
}

// The saved answer for a request: { s, h, body, at } or null.
export async function saved(u) {
  const key = keyOf(u)
  if (!key || !store) return null
  const e = await store.get(`saved:${key}`).catch(() => null)
  if (!e) return null
  await loadIndex()
  if (index[key]) { index[key][1] = Date.now(); saveIndex() }
  return { s: e.s, h: e.h, at: e.at, body: e.t != null ? enc.encode(e.t) : Uint8Array.from(atob(e.b), (c) => c.charCodeAt(0)) }
}
export const hasCopy = async () => !!store && !!(await store.get('saved:/').catch(() => null))

// ---------- the outbox ----------
const TTL = NOTE_DAYS * DAY
const SAY = /^\/api\/agents\/([^/]+)\/(prompt|queue)$/
const ANSWER = /^\/api\/panes\/([^/]+)\/input$/
let items = null // [{ id, at, kind, pane, text, req, note, on: 'phone'|'relay', state, why, whyText, held, done }]
const load = async () => (items ||= ((await store.get('outbox').catch(() => null)) || []))
const persist = () => store.set('outbox', items).catch(() => {})

// What can wait for your computer: a message to an agent, or an answer to its question (Question.jsx
// says which question it answers). { error } when it can't; null when it's something else, which
// needs your computer.
export function queueable(m, u, body) {
  if (m !== 'POST' || !body) return null
  const path = String(u).split('?')[0]
  let b
  try { b = JSON.parse(dec.decode(body)) } catch { return null }
  let x = SAY.exec(path)
  let q = null
  if (x) {
    const text = String(b?.text || '').trim()
    // A side question's answer only shows while you wait for it.
    if (text && !/^\/btw\s/.test(text)) q = { kind: 'say', pane: decodeURIComponent(x[1]), text, req: { m, u: path, b: { text } } }
  } else if ((x = ANSWER.exec(path)) && b?.expect && Array.isArray(b.steps)) {
    q = { kind: 'answer', pane: decodeURIComponent(x[1]), text: String(b.label || 'Answer').slice(0, 200), req: { m, u: path, b: { steps: b.steps, expect: b.expect } } }
  }
  if (q && JSON.stringify(q.req).length > MAX_NOTE) return { error: 'That\'s too long to keep for your computer. Send it once it\'s back.' }
  return q
}

const me = async () => { const p = ctx.pairing(); return { privateKey: p.device.privateKey, public: await rawPublic(p.device) } }

export async function add(q) {
  await load()
  const p = ctx.pairing()
  const note = await sealNote(await me(), unb64u(p.hostKey), JSON.stringify(q.req), 'up')
  const it = { id: note.id, at: note.at, kind: q.kind, pane: q.pane, text: q.text, req: q.req, note, on: 'phone', state: 'waiting' }
  items.push(it)
  await persist()
  changed()
  upload()
  return it
}

// Leave the notes that are only here in the relay, if it keeps them.
function upload() {
  for (const it of items || []) if (it.state === 'waiting' && it.on === 'phone' && !it.putting) { if (ctx.send({ t: 'put', note: it.note })) it.putting = true }
}

// The relay keeps notes: say which phone this is (it answers with what's waiting and the receipts).
export async function relayReady() {
  if (!ctx.pairing()?.hostKey) return
  await load()
  for (const it of items) delete it.putting
  ctx.send({ t: 'box', box: await boxId(await rawPublic(ctx.pairing().device)) })
}

export async function fromRelay(m) {
  if (!ctx.pairing()?.hostKey) return
  await load()
  if (m.t === 'box') {
    await receipts(m.receipts || [])
    // Not in the relay any more and no receipt yet (it expired there, or went missing): leave it
    // again. If your computer already had it, it says so rather than send it twice.
    const there = new Set(m.waiting || [])
    for (const it of items) if (it.state === 'waiting' && it.on === 'relay' && !there.has(it.id)) it.on = 'phone'
    expire()
    upload()
  } else if (m.t === 'put') {
    const it = items.find((x) => x.id === m.id)
    if (!it) return
    delete it.putting
    if (m.ok) it.on = 'relay'
    else if (m.why === 'not-paired') settle(it, { ok: false, why: 'not-paired', text: 'this phone isn\'t paired with your computer anymore' })
    // Full: it stays here, and goes over the link once both are online.
  } else if (m.t === 'receipt') await receipts([m.note])
  await persist()
  changed()
}

async function receipts(list) {
  if (!list.length) return
  const k = await me()
  const H = unb64u(ctx.pairing().hostKey)
  for (const n of list) {
    const it = items.find((x) => x.id === n?.id)
    if (!it || it.state !== 'waiting') continue
    try { settle(it, JSON.parse(dec.decode(await openNote(k, H, n, 'down')))) } catch { /* not from your computer */ }
  }
  ctx.send({ t: 'got', ids: list.map((n) => n?.id).filter(Boolean) })
}

function settle(it, r, { quiet } = {}) {
  it.state = r.ok ? 'delivered' : 'failed'
  it.held = !!r.held
  it.why = r.why || null
  it.whyText = r.text || null
  it.done = Date.now()
  delete it.req // sent, or never will be: no need to keep it any more
  if (!quiet) fresh.push(it)
}

// Your computer is online, over the link: what's still waiting goes this way too (it acts on each
// once, so one it already had from the relay just gets its receipt).
let busy = false
export async function online() {
  if (busy || !ctx.pairing()?.hostKey) return
  busy = true
  try {
    await load()
    expire()
    const waiting = items.filter((it) => it.state === 'waiting')
    if (!waiting.length) return
    const r = await ctx.call('POST', '/api/relay/inbox', { notes: waiting.map((it) => it.note) }).catch(() => null)
    if (r?.status === 404) await older(waiting)
    else for (const x of r?.json?.results || []) {
      const it = items.find((i) => i.id === x.id)
      if (it?.state !== 'waiting') continue
      if (x.why === 'bad') settle(it, { ok: false, why: 'bad', text: 'your computer couldn\'t read it' })
      else settle(it, x)
    }
    await persist()
    changed()
  } finally { busy = false }
}

// An older Bridge AI on your computer, which can't take notes: what's only on this phone is sent as
// a plain request, once (an answer isn't: it can't check the question is still the same). What's in
// the relay waits there until Bridge AI on your computer is updated.
async function older(waiting) {
  for (const it of waiting) {
    if (it.on === 'relay') { it.update = true; continue }
    if (it.kind !== 'say' || it.tried) { settle(it, { ok: false, why: 'older', text: it.kind === 'say' ? 'it may not have gone through. Check the agent' : 'answer it again now that your computer is back' }); continue }
    it.tried = true
    await persist()
    const r = await ctx.call(it.req.m, it.req.u, it.req.b).catch(() => null)
    settle(it, r && r.status < 300 ? { ok: true, held: !!r.json?.queued } : { ok: false, why: 'error', text: r?.json?.error || 'it may not have gone through. Check the agent' })
  }
}

// After 7 days the relay and your computer let a note go; so does the phone.
function expire() {
  const now = Date.now()
  const old = items.filter((it) => it.state === 'waiting' && now - it.at > TTL)
  for (const it of old) { settle(it, { ok: false, why: 'expired', text: 'your computer wasn\'t back within 7 days' }); takeBack(it) }
  dropTaken()
  // Delivered ones go after 2 days, the rest after 7.
  items = items.filter((it) => it.state === 'waiting' || now - it.done < (it.state === 'delivered' ? 2 : 7) * DAY)
}
// Notes this phone took back (expired, or cancelled) also go from the relay, as soon as it's reachable.
function takeBack(it) { if (it.on === 'relay') it.drop = true }
function dropTaken() {
  const ids = items.filter((it) => it.drop).map((it) => it.id)
  if (ids.length && ctx.send({ t: 'drop', ids })) for (const it of items) delete it.drop
}
export async function tidy() { if (!store) return; await load(); expire(); await persist(); changed() }

// ---------- for the app, and the shell ----------
const listeners = new Set()
let fresh = [] // settled since the last change was told
function changed() {
  const done = fresh
  fresh = []
  for (const fn of [...listeners]) try { fn(done) } catch { listeners.delete(fn) } // a closed frame's
}
export function subscribe(fn) {
  listeners.add(fn)
  load().then(() => fn([]), () => {})
  return () => listeners.delete(fn)
}

const STATUS = (it) => it.state === 'delivered' ? (it.held ? 'Delivered, held until the agent is free' : 'Delivered')
  : it.state === 'failed' ? `Not delivered: ${it.whyText || 'something went wrong'}`
  : it.update ? 'Waiting for Bridge AI on your computer to be updated'
  : it.on === 'phone' && !it.putting ? 'Waiting for your computer, on this phone' // the relay can't keep it
  : 'Waiting for your computer'
// For the app: what this phone sent while the computer was away, with how each one is doing.
export function list(pane) {
  return (items || []).filter((it) => (!pane || it.pane === pane) && !it.dismissed)
    .map((it) => ({ id: it.id, at: it.at, kind: it.kind, pane: it.pane, text: it.text, state: it.state, done: it.done || null, status: STATUS(it) }))
}
export async function dismiss(id) {
  await load()
  const it = items.find((x) => x.id === id)
  if (!it) return
  // Still waiting: take it back (from the relay too).
  if (it.state === 'waiting') { settle(it, { ok: false, why: 'cancelled', text: 'you cancelled it' }, { quiet: true }); takeBack(it); dropTaken() }
  it.dismissed = true
  await persist()
  changed()
}
