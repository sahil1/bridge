// Usage stats: which of Bridge AI's features are on and get used, how long it's used, the computer
// it runs on, and whether it crashed, as numbers in ranges, sent to the project to see what to build
// and fix. On unless you turn it off (Settings › About & Updates, Share anonymous usage stats), and
// said once, in a card, the first time it's on. DO_NOT_TRACK=1 or BRIDGE_TELEMETRY=0 keeps it off,
// and with no endpoint set it isn't offered. Turning it off stops it at once and forgets what wasn't
// sent yet.
//
// Two reports, each only the names and values on the public list (shared/telemetry-schema.json):
// - a week's (<data>/telemetry/<week>.json), sent once the week is over: the install (version, its
//   update channel and rollout bucket, and on Early Access who the code is for; system and its
//   version, chip, memory, cores, how it's installed, other computers linked and phones paired, as
//   counts), the features it has on, the agents installed, the counts of what was
//   used, days used, and time in use and running (a window of it in front, with someone typing,
//   clicking or touching it in the last two minutes: the window says so once a minute; and how long
//   it ran at all), each as a range ("1-5 hours"), never minutes or times of day. Among the counts,
//   the models behind Bridge AI's own answers (a chat, AI Assist, meeting notes, dictation…) and
//   the ones agents start on, each as its family on the list ("claude-sonnet", "gpt-5"), never its
//   name; how each answer was reached (a sign-in, a key, a cloud, this computer); and which part of
//   Bridge AI asked.
// - a day's (<data>/telemetry/days/<day>.json), sent the next day: the version that day (and the
//   one before it, the day it updated), its channel, bucket and tester as the week's has them, the
//   OS and how it's installed, how many times it started, whether it crashed, and how long it was
//   in use (a range: "15-30 minutes"), so each version's adoption and crash-free days, and the
//   minutes a day it's used, can be seen, on each channel and at each step of a rollout.
// - a first one (telemetry/sent/first.json), once: a couple of minutes after Bridge AI first runs on
//   a computer, that there's a new install, the day it was installed, and its version, channel,
//   system, chip and how it's installed, so a new install is counted the day it happens (a day's
//   report only goes the day after, and only if Bridge AI runs again).
// A copy of each report sent stays in telemetry/sent. Neither ever has a name (an early-access
// code's is the one the project gave its tester), a path, a repo or branch, a prompt, a transcript,
// what an agent wrote, an email, a host, an account, an exact time, or an ID for you or this
// computer: each report's nonce is new. The rollout bucket is one of a hundred, shared with about
// one computer in a hundred.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA, ROOT, dataFile } from './paths.js'

export const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'telemetry-schema.json'), 'utf8'))
const NAMES = new Set(Object.keys(SCHEMA.counters))
const DIR = dataFile('telemetry')
const SENT = path.join(DIR, 'sent')
// Where usage stats and crash reports go: one setting, for a fork or a company that runs the counts
// server (counts/) on its own Cloudflare (counts/README.md, CONTRIBUTING.md › Running your own). The
// first there is of:
//   BRIDGE_STATS_URL in the environment;
//   "stats": { "url": "https://…" } in the settings (config.json; in config.example.json, a build's own);
//   the public list's endpoints (shared/telemetry-schema.json): the project's server.
// It's the counts server's address: a week's report goes to <url>/v1/week, a day's to <url>/v1/day,
// and crash reports to <url>/v1/report, or at a counts. name, to the same server's crashes. name
// (as counts/wrangler.toml puts them). Empty: nothing goes anywhere, and neither is offered. https
// only, but for this computer. However it's set, Settings › About & Updates says where they go, and
// turning them off is one click. BRIDGE_COUNTS_URL and BRIDGE_CRASHES_URL (the tests) set one
// report's address each, over all of it.
export function where(c = cfg) {
  const fromEnv = process.env.BRIDGE_STATS_URL
  const [from, raw] = fromEnv != null ? ['BRIDGE_STATS_URL', fromEnv] : typeof c?.stats?.url === 'string' ? ['The stats.url setting', c.stats.url] : [null, null]
  let week = SCHEMA.endpoint || ''
  let crashes = SCHEMA.crashReports?.endpoint || ''
  let problem = null
  if (from) {
    const base = raw.trim().replace(/\/+$/, '').replace(/\/v1\/(week|day|report)$/, '')
    let u = null
    try { u = base ? new URL(base) : null } catch { /* not a link */ }
    week = crashes = ''
    if (base && !(u?.protocol === 'https:' || (u?.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)))) problem = `${from} isn't an https address (${raw.trim().slice(0, 80)}), so usage stats and crash reports go nowhere.`
    else if (base) {
      week = `${base}/v1/week`
      crashes = u.hostname.startsWith('counts.') ? `${u.protocol}//crashes.${u.host.slice('counts.'.length)}${u.pathname.replace(/\/$/, '')}/v1/report` : `${base}/v1/report`
    }
  }
  if (process.env.BRIDGE_COUNTS_URL != null) week = process.env.BRIDGE_COUNTS_URL.trim()
  if (process.env.BRIDGE_CRASHES_URL != null) crashes = process.env.BRIDGE_CRASHES_URL.trim()
  return { week, crashes, from: from || 'build', problem }
}
const endpoint = () => where().week
// Someone who said no to all of it, for every program on this computer.
const refused = () => (process.env.DO_NOT_TRACK === '1' || process.env.BRIDGE_TELEMETRY === '0' ? (process.env.DO_NOT_TRACK === '1' ? 'DO_NOT_TRACK' : 'BRIDGE_TELEMETRY=0') : null)

// "1-5 hours": how a week's minutes are sent.
export function timeRange(min) {
  const h = (min || 0) / 60
  return !(min > 0) ? '0' : h < 1 ? 'under 1 hour' : h < 5 ? '1-5 hours' : h < 10 ? '5-10 hours' : h < 20 ? '10-20 hours' : h < 40 ? '20-40 hours' : '40+ hours'
}
// "15-30 minutes": how a day's minutes in use are sent.
export function minuteRange(min) {
  return !(min > 0) ? '0' : min < 5 ? 'under 5 minutes' : min < 15 ? '5-15 minutes' : min < 30 ? '15-30 minutes' : min < 60 ? '30-60 minutes' : min < 120 ? '1-2 hours' : min < 240 ? '2-4 hours' : min < 480 ? '4-8 hours' : '8+ hours'
}
// "2-5": how a count is sent.
export function bucket(n) {
  if (!(n > 0)) return '0'
  if (n === 1) return '1'
  return n <= 5 ? '2-5' : n <= 20 ? '6-20' : n <= 100 ? '21-100' : '100+'
}
// The ISO week a moment is in, on this computer's calendar: '2026-W44'. BRIDGE_COUNTS_NOW (tests)
// stands in for now.
export const now = () => (process.env.BRIDGE_COUNTS_NOW ? new Date(process.env.BRIDGE_COUNTS_NOW) : new Date())
export function weekOf(d = now()) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (t.getDay() + 6) % 7 // Monday 0
  t.setDate(t.getDate() - day + 3) // that week's Thursday decides the year
  const first = new Date(t.getFullYear(), 0, 4)
  const n = 1 + Math.round(((t - first) / 864e5 - 3 + ((first.getDay() + 6) % 7)) / 7)
  return `${t.getFullYear()}-W${String(n).padStart(2, '0')}`
}

let cfg = null // the server's settings: counts.share (on unless false), counts.stopped
let context = async () => ({}) // what the report says about this install (index.js)
let saveSettings = () => {} // (patch) => saved
export function configure(c, { about, save } = {}) { cfg = c; if (about) context = about; if (save) saveSettings = save }
const sharing = () => !!(cfg && cfg.counts?.share !== false && endpoint() && !refused())

// This week's counts, in memory and written down a few seconds after they change.
let week = null // { week, counts: { name: n }, days: [1..7], active, open (minutes), nonce, installAge, about }
let writing = null
const fileOf = (w) => path.join(DIR, `${w}.json`)
let loading = null // two counts at once wait for the same week
function current() {
  const w = weekOf()
  if (week?.week === w) return Promise.resolve(week)
  loading ||= (async () => {
    if (week) await flush()
    const kept = await fs.promises.readFile(fileOf(w), 'utf8').then(JSON.parse, () => null)
    week = kept?.week === w ? kept : await fresh(w)
    return week
  })().finally(() => { loading = null })
  return loading
}
// A week with nothing counted yet. What it says about this install is taken when it starts and
// with each count, so the report sent after the week is the one shown during it.
const fresh = async (w) => ({ week: w, counts: {}, days: [], active: 0, open: 0, nonce: crypto.randomBytes(12).toString('hex'), installAge: await installAge(), about: await context() })
// A week with nothing in it isn't written down. One that was only open, never used, is kept while
// the week goes on (it may be used yet) but isn't sent (send()).
const used = (w) => !!(Object.keys(w.counts).length || w.active > 0)
async function flush() {
  if (!week || !(used(week) || week.open > 0)) return
  await fs.promises.mkdir(DIR, { recursive: true })
  await fs.promises.writeFile(fileOf(week.week), JSON.stringify(week))
}
const later = () => { clearTimeout(writing); writing = setTimeout(() => flush().catch(() => {}), Number(process.env.BRIDGE_COUNTS_WRITE_MS || 5000)); writing.unref?.() }
function today(w) { const d = ((now().getDay() + 6) % 7) + 1; if (!w.days.includes(d)) w.days.push(d) }

// One more of a feature used (name: on the list). While sharing is off, nothing at all.
export async function add(name, by = 1) { return addAll([name], by) }
// Several at once (an answer's model, route and feature), with one look at this install.
async function addAll(names, by = 1) {
  const list = names.filter((n) => NAMES.has(n))
  if (!sharing() || !list.length) return
  const w = await current()
  for (const name of list) w.counts[name] = (w.counts[name] || 0) + by
  w.about = await context()
  today(w)
  later()
}
// The most of something at once this week (agents.peak).
export async function most(name, n) {
  if (!sharing() || !NAMES.has(name) || !(n > (week?.counts[name] || 0))) return
  const w = await current()
  if (n > (w.counts[name] || 0)) { w.counts[name] = n; later() }
}
// The kind of agent started, as the list names it.
export const started = (kind) => add(NAMES.has(`agents.started.${kind}`) ? `agents.started.${kind}` : 'agents.started.other')
// A model's family, as the list names it (modelFamilies): the first whose pattern fits, else
// other. Never the name, which can be anything a provider or a model server calls it.
const FAMILIES = Object.entries(SCHEMA.modelFamilies || {}).filter(([k]) => k !== 'about').map(([k, re]) => [k, new RegExp(re, 'i')])
export const familyOf = (model) => FAMILIES.find(([, re]) => re.test(String(model || '')))?.[0] || 'other'
// An agent started on a model, or switched to one: its family, or default when none was picked.
export const agentModel = (model) => add(model ? `agents.model.${familyOf(model)}` : 'agents.model.default')
// An answer Bridge AI asked a model for itself (chatmodels.js reply()): the model's family (the one
// the provider says answered, when it says), how it was reached, and the part of Bridge AI that
// asked (usagelog.js FEATURES).
const VIA = (route) => (route === 'cli' ? 'signin' : route === 'bridge' ? 'builtin' : /^(ollama|lmstudio)$/.test(route) ? 'local' : /^(azure|bedrock|vertex)$/.test(route) ? 'cloud' : 'key')
export async function answered(id, feature, said) {
  const [route, ...rest] = String(id || '').split(':')
  await addAll([`models.${familyOf(said || rest.join(':') || route)}`, `models.via.${VIA(route)}`, NAMES.has(`ai.${feature}`) ? `ai.${feature}` : 'ai.other'])
}

// How long Bridge AI has been on this computer, from when its data folder was made.
async function installAge() {
  const st = await fs.promises.stat(DATA).catch(() => null)
  const born = st && (st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs)
  if (!born) return null
  const weeks = (now() - born) / (7 * 864e5)
  return weeks < 1 ? 'week 1' : weeks < 4 ? '2-4 weeks' : weeks < 12 ? '5-12 weeks' : '13+ weeks'
}
// A week's report, exactly as it's sent.
export function report(w) {
  const c = w.about || {}
  return {
    schema: SCHEMA.schema,
    week: w.week,
    app: c.app, ...channelOf(c), os: c.os, osVersion: c.osVersion, arch: c.arch, chip: c.chip, memory: c.memory, cores: c.cores,
    install: c.install, layout: c.layout, runtime: c.runtime, phone: c.phone, phones: c.phones, computers: c.computers,
    installAge: w.installAge || null,
    daysActive: w.days.length,
    activeTime: timeRange(w.active),
    openTime: timeRange(w.open),
    features: features({ ...(c.features || {}), ...(w.window || {}) }),
    agents: (c.agents || []).filter((k) => AGENT_KINDS.has(k)).sort(),
    counts: Object.fromEntries(Object.entries(w.counts).filter(([k, n]) => NAMES.has(k) && n > 0).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => [k, bucket(n)])),
    nonce: w.nonce,
  }
}
// The update channel (stable or early), for Early Access who the code is for (a name the project
// picked for its tester), and the staged rollout's bucket (0-99, random): each version's counts and
// crashes, told apart by channel and by how soon it reached a computer.
const channelOf = (c) => ({ channel: c.channel === 'early' ? 'early' : 'stable', tester: c.channel === 'early' && c.tester ? String(c.tester).slice(0, 32) : null, rollout: Number.isInteger(c.rollout) ? c.rollout : null })
// Only the features on the public list, each with one of its values.
const FEATURES = SCHEMA.features || {}
const AGENT_KINDS = new Set(SCHEMA.agents || [])
const features = (f) => Object.fromEntries(Object.keys(FEATURES).sort().filter((k) => FEATURES[k].values.includes(f[k])).map((k) => [k, f[k]]))
// What a window of Bridge AI says about itself, once as it opens: its language and its look.
export async function windowSaid(b = {}) {
  if (!sharing()) return { counted: false }
  const w = await current()
  w.window = features({ language: b.language, appearance: b.appearance, theme: b.theme })
  later()
  return { counted: true }
}
// What Settings shows: whether sharing is offered here and on, where reports go, what can be
// counted, and the reports sent.
export async function status() {
  const sent = await fs.promises.readdir(SENT).then((f) => f.filter((x) => /^\d{4}-W\d\d\.json$/.test(x)).map((x) => x.slice(0, -5)).sort().reverse(), () => [])
  let to = null
  try { to = endpoint() ? new URL(endpoint()).host : null } catch { /* not a link */ }
  return {
    available: !!to && !refused(),
    refused: refused(),
    problem: refused() ? null : where().problem, // the address set for them isn't one
    share: sharing(),
    to,
    stopped: cfg?.counts?.stopped || null,
    counters: SCHEMA.counters,
    sent,
  }
}
// The next report, exactly as it would go: a week that's over and waiting first, else this week so
// far (it goes once the week is over). While sharing is off nothing is counted, so it's a week with
// no counts: what a report says about this install, and nothing else.
export async function preview() {
  if (!sharing()) return { share: false, week: weekOf(), report: report({ ...(await fresh(weekOf())), nonce: '(new for each report)' }) }
  const waiting = (await pending())[0]
  const w = waiting ? JSON.parse(await fs.promises.readFile(fileOf(waiting), 'utf8')) : await current()
  return { share: true, week: w.week, report: report(w), goes: waiting ? 'next' : 'after this week', empty: !used(w) }
}
export async function sentReport(w) {
  if (!/^\d{4}-W\d\d$/.test(String(w))) throw new Error('No such week')
  return JSON.parse(await fs.promises.readFile(path.join(SENT, `${w}.json`), 'utf8'))
}

// Turned on, or off. Off forgets what was counted and not sent yet.
export async function setShare(on) {
  if (on && (!endpoint() || refused())) throw new Error(refused() ? `Usage counts are off on this computer (${refused()})` : 'There\'s nowhere to send usage counts yet')
  saveSettings({ counts: { share: !!on, stopped: null } })
  if (!on) {
    clearTimeout(writing)
    week = null
    day = null
    for (const f of await fs.promises.readdir(DIR).catch(() => [])) if (/^\d{4}-W\d\d\.json$/.test(f)) await fs.promises.rm(path.join(DIR, f), { force: true })
    await fs.promises.rm(DAYS, { recursive: true, force: true })
    await fs.promises.rm(LAST, { force: true })
  }
  return status()
}

// Weeks that are over and not sent yet, oldest first.
async function pending() {
  const w = weekOf()
  return (await fs.promises.readdir(DIR).catch(() => [])).filter((f) => /^\d{4}-W\d\d\.json$/.test(f)).map((f) => f.slice(0, -5)).filter((x) => x < w).sort()
}
// Each week that's over goes, once, while sharing is on. The endpoint can say stop (the project
// stops collecting): sharing turns off and Settings says why. A week that can't go stays for the
// next try, and is forgotten after eight weeks.
export async function send() {
  if (!sharing()) return { sent: [] }
  if (week && week.week !== weekOf()) { await flush(); week = null }
  const out = []
  for (const w of await pending()) {
    const file = fileOf(w)
    const kept = await fs.promises.readFile(file, 'utf8').then(JSON.parse, () => null)
    if (!kept || !used({ counts: {}, ...kept })) { await fs.promises.rm(file, { force: true }); continue }
    const body = report(kept)
    let r
    try {
      r = await fetch(endpoint(), { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bridge-ai' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) })
    } catch { break }
    const said = await r.json().catch(() => ({}))
    if (said?.stop) { saveSettings({ counts: { share: false, stopped: String(said.why || 'The project stopped collecting usage counts.').slice(0, 300) } }); await setShareOffQuietly(); break }
    if (!r.ok) { if (w < weekOf(new Date(now() - 8 * 7 * 864e5))) await fs.promises.rm(file, { force: true }); break }
    await fs.promises.mkdir(SENT, { recursive: true })
    await fs.promises.writeFile(path.join(SENT, `${w}.json`), JSON.stringify(body, null, 2))
    await fs.promises.rm(file, { force: true })
    out.push(w)
  }
  return { sent: out, days: sharing() ? await sendDays() : [] }
}
async function setShareOffQuietly() {
  week = null
  day = null
  for (const f of await fs.promises.readdir(DIR).catch(() => [])) if (/^\d{4}-W\d\d\.json$/.test(f)) await fs.promises.rm(path.join(DIR, f), { force: true })
  await fs.promises.rm(DAYS, { recursive: true, force: true })
}

// ---------- A day's report ----------
const DAYS = path.join(DIR, 'days')
const LAST = path.join(DIR, 'version.json') // the version this computer ran last, to tell an update
// The day a moment is in, on this computer's calendar: '2026-11-04'.
export const dayOf = (d = now()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
let day = null // { day, app, from, starts, crashed, active (minutes in use), nonce, about }
const sys = (c) => ({ os: c.os, arch: c.arch, install: c.install, ...channelOf(c) })
async function currentDay() {
  const d = dayOf()
  if (day?.day !== d) {
    const kept = await fs.promises.readFile(path.join(DAYS, `${d}.json`), 'utf8').then(JSON.parse, () => null)
    if (kept?.day === d) day = kept
    else {
      const last = await fs.promises.readFile(LAST, 'utf8').then(JSON.parse, () => null)
      day = { day: d, app: last?.app || null, from: null, starts: 0, crashed: false, active: 0, nonce: crypto.randomBytes(12).toString('hex'), about: {} }
    }
  }
  // The version now; an update during the day keeps the one it came from.
  const about = await context()
  if (about.app && about.app !== day.app) { if (day.app) day.from ||= day.app; day.app = about.app }
  day.about = sys(about)
  return day
}
async function writeDay() {
  if (!day) return
  await fs.promises.mkdir(DAYS, { recursive: true })
  await fs.promises.writeFile(path.join(DAYS, `${day.day}.json`), JSON.stringify(day))
  if (day.app) await fs.promises.writeFile(LAST, JSON.stringify({ app: day.app }))
}
// Bridge AI started, or crashed: written down on today's.
export async function launched() { if (!sharing()) return; const d = await currentDay(); d.starts++; await writeDay() }
export async function crashed() { if (!sharing()) return; const d = await currentDay(); d.crashed = true; await writeDay() }
// A day's report, exactly as it's sent.
export function dayReport(d) {
  const c = d.about || {}
  return { schema: SCHEMA.schema, day: d.day, app: d.app, from: d.from || null, ...channelOf(c), os: c.os, arch: c.arch, install: c.install, starts: bucket(d.starts), crashed: !!d.crashed, activeTime: minuteRange(d.active), nonce: d.nonce }
}
const dayEndpoint = () => { const w = endpoint(); try { return /\/v1\/week$/.test(w) ? w.replace(/\/v1\/week$/, '/v1/day') : new URL('/v1/day', w).href } catch { return null } }
// Each day that's over goes, once; one that can't is tried again, and forgotten after two weeks.
async function sendDays() {
  const today = dayOf()
  const out = []
  for (const f of (await fs.promises.readdir(DAYS).catch(() => [])).filter((x) => /^\d{4}-\d\d-\d\d\.json$/.test(x)).sort()) {
    const d = f.slice(0, -5)
    if (d >= today) continue
    const file = path.join(DAYS, f)
    const kept = await fs.promises.readFile(file, 'utf8').then(JSON.parse, () => null)
    if (!kept?.app) { await fs.promises.rm(file, { force: true }); continue }
    const body = dayReport(kept)
    let r
    try { r = await fetch(dayEndpoint(), { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bridge-ai' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }) } catch { break }
    const said = await r.json().catch(() => ({}))
    if (said?.stop) { saveSettings({ counts: { share: false, stopped: String(said.why || 'The project stopped collecting usage stats.').slice(0, 300) } }); await setShareOffQuietly(); break }
    if (!r.ok) { if (d < dayOf(new Date(now() - 14 * 864e5))) await fs.promises.rm(file, { force: true }); break }
    await fs.promises.mkdir(path.join(SENT, 'days'), { recursive: true })
    await fs.promises.writeFile(path.join(SENT, 'days', f), JSON.stringify(body, null, 2))
    await fs.promises.rm(file, { force: true })
    out.push(d)
  }
  return out
}

// The first report: once for an install, while it's in its first week (one that's older was here
// before there was such a report, and isn't new). It can't go (offline, the server down): tried
// again each time a week's is looked for, until the week is out.
const FIRST = path.join(SENT, 'first.json')
const firstEndpoint = () => { const w = endpoint(); try { return /\/v1\/week$/.test(w) ? w.replace(/\/v1\/week$/, '/v1/first') : new URL('/v1/first', w).href } catch { return null } }
// A first report, exactly as it's sent.
export function firstReport(born, c = {}) {
  return { schema: SCHEMA.schema, day: dayOf(new Date(born)), app: c.app || null, channel: channelOf(c).channel, os: c.os, arch: c.arch, install: c.install, nonce: crypto.randomBytes(12).toString('hex') }
}
export async function sendFirst() {
  if (!sharing() || !firstEndpoint()) return { sent: false }
  if (await fs.promises.access(FIRST).then(() => true, () => false)) return { sent: false }
  const keep = (what) => fs.promises.mkdir(SENT, { recursive: true }).then(() => fs.promises.writeFile(FIRST, JSON.stringify(what, null, 2)))
  const st = await fs.promises.stat(DATA).catch(() => null)
  const born = st && (st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs)
  if (!born || now() - born > 7 * 864e5) { await keep({ sent: false, why: 'Bridge AI was on this computer before first reports began, or for more than a week.' }); return { sent: false } }
  const body = firstReport(born, await context())
  let r
  try { r = await fetch(firstEndpoint(), { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bridge-ai' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }) } catch { return { sent: false } }
  const said = await r.json().catch(() => ({}))
  if (said?.stop) { saveSettings({ counts: { share: false, stopped: String(said.why || 'The project stopped collecting usage stats.').slice(0, 300) } }); await setShareOffQuietly(); return { sent: false } }
  // A server from before first reports (a fork's, not updated) says 404: there's nobody to tell.
  if (!r.ok && r.status !== 404) return { sent: false }
  await keep(r.ok ? body : { sent: false, why: 'The usage stats server takes no first reports.' })
  return { sent: r.ok }
}

// A minute of Bridge AI in use, said by a window of it (POST /api/counts/active): counted once a
// minute, however many windows and phones say so.
let lastActive = -1
export async function activity() {
  if (!sharing()) return { counted: false }
  const minute = Math.floor(now() / 60000)
  if (minute === lastActive) return { counted: false }
  lastActive = minute
  const w = await current()
  w.active = (w.active || 0) + 1
  today(w)
  later()
  // And on the day's: written down every five minutes in use, and as the server stops.
  const d = await currentDay()
  d.active = (d.active || 0) + 1
  if (d.active % 5 === 1) await writeDay()
  return { counted: true }
}
// A minute of Bridge AI running, once a minute (BRIDGE_COUNTS_MINUTE_MS: the tests' minute). A
// computer asleep doesn't run the timer, so the time it slept isn't counted.
const MINUTE_MS = Number(process.env.BRIDGE_COUNTS_MINUTE_MS || 60000)
let ticks = 0
async function running() {
  if (!sharing()) return
  const w = await current()
  w.open = (w.open || 0) + 1
  if (++ticks % 10 === 0) later() // written down every ten minutes, and as the server stops
  // A server that runs past midnight has a day's report for each day it ran.
  if (day?.day !== dayOf()) { await currentDay(); await writeDay() }
}

// Looks for a week to send two minutes after the server starts (and sends an install's first
// report then), then every six hours; and counts the minutes it runs.
export function start() {
  launched().catch(() => {})
  const tick = () => send().catch(() => {}).then(() => sendFirst().catch(() => {}))
  setTimeout(tick, Number(process.env.BRIDGE_COUNTS_FIRST_MS || 120000)).unref?.()
  setInterval(tick, 6 * 3600 * 1000).unref?.()
  setInterval(() => running().catch(() => {}), MINUTE_MS).unref?.()
}
// Stopping: this week's counts and today's are written down first (the server's last moment, so at once).
process.on('exit', () => {
  if (week && sharing() && (used(week) || week.open > 0)) try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(fileOf(week.week), JSON.stringify(week)) } catch { /* next time */ }
  if (day && sharing() && day.app) try { fs.mkdirSync(DAYS, { recursive: true }); fs.writeFileSync(path.join(DAYS, `${day.day}.json`), JSON.stringify(day)) } catch { /* next time */ }
})
