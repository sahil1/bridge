// Notifications: when an agent starts waiting on you, finishes, or a usage quota runs low, tell
// you on every channel you've set up (phone and browser push today; chat apps can plug in the same
// way). Each channel is { name, ready(), send(note) }.
//
// A note is { kind: 'needs-you' | 'finished' | 'quota' | 'test', title, body, paneId?, url, tag,
// actions?, onlyHere? }. actions are answer buttons ({ action, title, token }); onlyHere means
// you're at the computer, so only its own devices get it.
// Settings: "notify": { "needsYou": true, "finished": true, "quotaBelow": 15 (percent left; 0 = off),
// "phoneAtComputer": false, "actions": true }.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { cacheFile, writeFileAtomic } from './paths.js'
import { paneKey, inView, paneOfKey, adopt } from './scope.js'
import { parseScreen } from '../src/components/questionParse.js'

const channels = new Set()
export const use = (channel) => { channels.add(channel); return channel }
export const active = () => [...channels].some((c) => c.ready())
let rt = null // the runtime, to read an agent's screen and answer it
export const useRuntime = (r) => { rt = r }
// A video or a sound a finished agent's last words name, in its folder (index.js): its notification
// opens it in Files, where it plays.
let lastFile = () => null
export const useLastFile = (fn) => { lastFile = fn }

export async function send(note) {
  const ready = [...channels].filter((c) => c.ready())
  const results = await Promise.all(ready.map((c) => Promise.resolve().then(() => c.send(note)).then((r) => ({ channel: c.name, ...r }), (e) => ({ channel: c.name, error: e.message }))))
  return results
}

// ---------- You at the computer ----------
// Bridge AI on this computer says when its window is in front (in the desktop app, only while
// you've touched the computer lately) and when you type or click in it. Meanwhile your phone stays
// quiet: you'd see it here anyway. The computer's own notifications aren't affected.
const AWAY = 2 * 60 * 1000
const fronts = new Map() // window id -> when it last said it's in front
let lastInput = 0
export function presence({ id, focused, input, idle }) {
  const now = Date.now()
  if (input) lastInput = now
  for (const [k, t] of fronts) if (now - t > 75000) fronts.delete(k)
  if (focused && !(idle >= AWAY / 1000)) fronts.set(String(id), now)
  else fronts.delete(String(id))
}
export const atComputer = () => Date.now() - lastInput < AWAY || [...fronts.values()].some((t) => Date.now() - t < 75000)
const reach = (cfg) => (cfg.notify?.phoneAtComputer || !atComputer() ? {} : { onlyHere: true })

// ---------- Muted agents ----------
// Muted from an agent's ⋯ menu, by pane (filed per herdr session, see scope.js), until you unmute it.
const MUTED = cacheFile('muted.json')
let muted = new Set((() => { try { return JSON.parse(fs.readFileSync(MUTED, 'utf8')) } catch { return [] } })())
const saveMuted = () => { fs.mkdirSync(path.dirname(MUTED), { recursive: true }); writeFileAtomic(MUTED, JSON.stringify([...muted])) }
function mutedNow() {
  const byKey = Object.fromEntries([...muted].map((k) => [k, true]))
  if (adopt(byKey)) { muted = new Set(Object.keys(byKey)); saveMuted() }
  return muted
}
export const isMuted = (paneId) => mutedNow().has(paneKey(paneId))
export function mute(paneId, on, live = []) {
  const key = paneKey(paneId)
  if (on) mutedNow().add(key)
  else mutedNow().delete(key)
  // Agents that are gone don't need remembering (another session's are only out of view).
  muted = new Set([...muted].filter((k) => k === key || !inView(k) || live.includes(paneOfKey(k))))
  saveMuted()
}

// ---------- What an agent is asking ----------
// Read from its screen the way its question card is: the question in a line or two, and, when
// it's simple (yes or no, or two short choices, all on one screen), the answers a notification
// button can give. Anything else gets no buttons, and the notification opens the app.
const tidy = (s) => String(s || '').replace(/^[☐☒✔●❯›>\s]+/, '').replace(/\s+/g, ' ').trim()
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const yesNo = (label) => tidy(label).split(/[,(]/)[0].trim() // "No, and tell Claude what to do differently (esc)": No
const arrowSteps = (q, o) => { const d = o.i - Math.max(0, q.at); return [...(d ? [{ keys: Array(Math.abs(d)).fill(d > 0 ? 'down' : 'up') }] : []), { keys: ['enter'] }] }
export function question(ansi) {
  const q = parseScreen(ansi)
  if (!q) {
    // No menu: a plain "Continue? (y/n)" and the like. Say it; answering is for the app.
    // eslint-disable-next-line no-control-regex
    const line = String(ansi || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/).map(tidy).filter(Boolean).slice(-8).findLast((l) => l.includes('?'))
    return line ? { text: clip(line, 160), simple: null } : null
  }
  const lines = (q.kind === 'menu' ? q.ask : [q.title]).map(tidy).filter(Boolean)
  const ask = lines.findLast((l) => l.includes('?')) || lines.at(-1) || (q.kind === 'review' ? 'Review your answers' : '')
  // What it's about: the command or file under a heading like "Bash command".
  const about = lines.filter((l, i) => l !== ask && !(i === 0 && lines.length > 1 && /^[\w ]{1,30}$/.test(l)))[0]
  const text = [clip(ask, 140), about && clip(about, 100)].filter(Boolean).join('\n')
  let simple = null
  if (q.kind !== 'review' && !q.multi && !q.tabs.length) {
    const yes = q.options[0] && /^yes\b/i.test(q.options[0].label) ? q.options[0] : null
    const no = q.options.find((o) => /^no\b/i.test(o.label))
    const picks = yes && no ? [[yes, yesNo(yes.label)], [no, yesNo(no.label)]]
      : q.options.length === 2 && q.options.every((o) => o.label.length <= 24) ? q.options.map((o) => [o, tidy(o.label)]) : null
    // A menu without numbers is answered with its arrows and Enter.
    simple = picks?.map(([o, title]) => (q.arrows ? { n: `@${o.i}`, title, steps: arrowSteps(q, o) } : { n: o.n, title })) || null
  }
  const id = crypto.createHash('sha256').update(JSON.stringify([q.kind, q.title, q.ask, q.tabs.map((t) => t.label), q.options.map((o) => [o.n, o.label, o.desc]), !!q.other, !!q.chat])).digest('base64url').slice(0, 22)
  return { text, id, simple }
}
// A cloud agent (cloud.js) has no screen: it says what it's waiting for itself. Nor does a
// question Codex asked while working (asks.js): it's in its log, and it's answered in the app.
const asking = (a) => (a.cloud ? Promise.resolve(a.cloud.ask ? { text: a.cloud.ask, simple: null } : null)
  : a.asking ? Promise.resolve({ text: clip(a.asking.title, 160), simple: null })
  : rt ? rt.read(a.paneId, 60).then(question, () => null) : Promise.resolve(null))

// ---------- Answer buttons ----------
// Each button carries a token signed with a key that lasts only as long as this server, bound to
// the agent, the question on its screen and that moment (the agent's state counter). It works
// once, for 10 minutes, and only while the same question is still there; otherwise the app opens.
const KEY = crypto.randomBytes(32)
const TOKEN_MS = 10 * 60 * 1000
const used = new Map() // token id -> when it expires
const sign = (s) => crypto.createHmac('sha256', KEY).update(s).digest('base64url')
const token = (claims) => { const body = Buffer.from(JSON.stringify(claims)).toString('base64url'); return `${body}.${sign(body)}` }
function claimsOf(t) {
  const [body, mac] = String(t || '').split('.')
  if (!body || !mac) return null
  const want = Buffer.from(sign(body))
  const got = Buffer.from(mac)
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return null }
}
function buttons(a, q) {
  if (!q?.simple) return []
  const claims = { p: a.paneId, s: a.seq, h: q.id, i: crypto.randomBytes(9).toString('base64url'), x: Date.now() + TOKEN_MS }
  return q.simple.map((o, j) => ({ action: `a${j}`, title: o.title, token: token({ ...claims, k: o.n }) }))
}
// The app opens its needs-you inbox at that agent's question (older apps open the agent).
export const linkTo = (paneId) => `/?agent=${encodeURIComponent(paneId)}&ask=1&inbox=1`
// What else waits on you, under a needs-you notification's question.
export function alsoWaiting(agents, a) {
  const more = (agents || []).filter((x) => x !== a && x.paneId !== a.paneId && x.status === 'blocked' && !isMuted(x.paneId)).length
  return more ? `\n${more === 1 ? '1 more waits on you' : `${more} more wait on you`}` : ''
}

// A button was pressed: type that answer if the same question is still waiting, else say why
// (and where to open the app instead).
export async function answer(t) {
  const c = claimsOf(t)
  if (!c || !rt) return { ok: false, why: 'not-valid', url: c ? linkTo(c.p) : '/' }
  const url = linkTo(c.p)
  const now = Date.now()
  for (const [k, x] of used) if (x < now) used.delete(k)
  if (c.x < now) return { ok: false, why: 'expired', url }
  if (used.has(c.i)) return { ok: false, why: 'used', url }
  used.set(c.i, c.x)
  return { ...(await pick(c.p, { seq: c.s, qid: c.h, n: c.k })), url }
}

// Type one of a question's simple answers (n), if the agent is still waiting on that same question
// (qid, and seq: the wait it was asked in). The needs-you inbox answers this way too (needsyou.js).
export async function pick(paneId, { seq, qid, n }) {
  if (!rt) return { ok: false, why: 'changed' }
  const a = (await rt.fleet()).agents.find((x) => x.paneId === paneId)
  if (!a || a.status !== 'blocked' || (seq != null && a.seq !== seq)) return { ok: false, why: 'changed' }
  const q = question(await rt.read(paneId, 60))
  const o = q?.id === qid && q.simple?.find((x) => x.n === n)
  if (!o) return { ok: false, why: 'changed' }
  await rt.input(paneId, o.steps || [{ keys: [n] }])
  // Still asking the same thing a moment later: the keys didn't take. Over to the app.
  await new Promise((r) => setTimeout(r, 800))
  if (question(await rt.read(paneId, 60))?.id === qid) return { ok: false, why: 'not-taken' }
  return { ok: true, answered: o.title }
}

// ---------- Agents ----------
const seen = new Map() // paneId -> { status, seq }
let primed = false
// Another herdr session in view: its agents are new to us, not news, and the last session's
// agents only left the view (they didn't finish). Called before the first fleet of that session.
export function forget() { seen.clear(); primed = false }
export function onFleet(fleet, cfg = {}) {
  const want = cfg.notify || {}
  for (const a of fleet.agents || []) {
    const before = seen.get(a.paneId)
    seen.set(a.paneId, { status: a.status, seq: a.seq })
    // A change to "needs you" or "finished", or a new agent that shows up already there (after
    // the first look, so a restart doesn't announce everything again).
    const changed = before ? before.status !== a.status || before.seq !== a.seq : primed
    if (!changed || isMuted(a.paneId)) continue
    const label = a.chief ? (a.thread && !a.thread.main ? `Chief of Staff · ${a.thread.name}` : 'Chief of Staff') : a.title || a.tab || a.workspace || 'An agent'
    const where = a.cloud ? [`${a.cloud.label} cloud`, a.cloud.repo].filter(Boolean).join(' · ') : [a.workspace, a.tab && a.tab !== label ? a.tab : null].filter(Boolean).join(' › ')
    if (a.status === 'blocked' && want.needsYou !== false) {
      // Say what it's asking, so you know whether it can wait, and what else waits (the inbox it
      // opens has them all).
      const also = alsoWaiting(fleet.agents, a)
      asking(a).then((q) => send({ kind: 'needs-you', title: `${label} needs you`, body: `${q?.text || where || 'Open Bridge AI to answer'}${also}`, paneId: a.paneId, url: linkTo(a.paneId), tag: `agent-${a.paneId}`, actions: want.actions === false ? [] : buttons(a, q), ...reach(cfg) })).catch(() => {})
    } else if (a.status === 'done' && want.finished !== false) {
      const file = a.cloud ? null : lastFile(a)
      send({ kind: 'finished', title: `${label} ${a.cloud?.failed ? 'failed' : 'finished'}`, body: file ? `${where ? `${where} · ` : ''}${path.basename(file)}, ready to watch` : where || 'Open Bridge AI to see the result', paneId: a.paneId, url: `/?agent=${encodeURIComponent(a.paneId)}${file ? `&file=${encodeURIComponent(file)}` : ''}`, tag: `agent-${a.paneId}`, ...reach(cfg) })
    }
  }
  primed = true
}

// ---------- Usage quotas ----------
// Once per quota window: "Claude: 12% left in this 5-hour window".
const warned = new Set()
export function onQuota(quota, cfg = {}) {
  const below = cfg.notify?.quotaBelow ?? 15
  if (!below || !quota?.providers) return
  const NAMES = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', copilot: 'Copilot', cursor: 'Cursor', grok: 'Grok', zai: 'Z.ai', kimi: 'Kimi', amp: 'Amp' }
  for (const p of quota.providers) {
    if (!p.usable) continue
    for (const w of p.windows || []) {
      if (w.percentRemaining == null || w.percentRemaining > below) continue
      const key = `${p.provider}:${w.id || w.label}:${w.resetsAt || ''}`
      if (warned.has(key)) continue
      warned.add(key)
      const name = NAMES[p.provider] || p.provider
      const resets = w.resetsAt ? ` Resets ${new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''
      send({ kind: 'quota', title: `${name}: ${w.percentRemaining}% left`, body: `Running low${w.label ? ` (${w.label})` : ''}.${resets}`, url: '/?card=gauge', tag: `quota-${p.provider}-${w.id || w.label}`, ...reach(cfg) })
    }
  }
}
