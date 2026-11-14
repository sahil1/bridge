// The Chief of Staff's helpers: work it hands off rather than doing itself, each to an agent of its
// own (a helper) with a role it picks (marketing, research, engineer), working in the task's own
// folder (work/<task>/ in the chief's folder) or a folder it names. Each one is a task on its list
// with the helper's role and pane on it, so the Tasks board shows who has what and what each is
// doing. At most chief.helpers.max work at once (3 unless set); more wait as queued and start, in
// the order they came, as one finishes.
//
// Bridge AI watches each helper rather than the chief having to (`bridge wait` needs a background
// command, which not every CLI has). When one stops, finished, failed to start or closed before it
// finished, its task is marked (done, or waiting with why), what it said last is kept as the outcome
// with the files it made in its folder, and the chief that handed it out hears it once, in its own
// thread: now if it's free, after what it's doing if not (the queue, as for anything sent to it).
// A follow-up the chief sends the helper starts the watch again, for one more report.
//
// Kept in chief-helpers.json in the data folder. The request is general on purpose: what to do, a
// role, and optionally a folder, an agent, a thread to report to and read-only, so something other
// than the chief's `bridge delegate` can hand a question to a helper the same way.
import fs from 'node:fs'
import path from 'node:path'
import { dataFile, writeFileAtomic } from './paths.js'

const FILE = dataFile('chief-helpers.json')
const MAX_DEFAULT = 3
const KEEP = 80 // helpers remembered, newest first; the ones still going are always kept
// A helper missing from the fleet this long was closed; one idle this long since it started, having
// done and said nothing, never got going (its CLI ended at once, say). A test makes both shorter.
const GONE_MS = Number(process.env.BRIDGE_HELPER_GONE_MS) || 90 * 1000
const STALL_MS = Number(process.env.BRIDGE_HELPER_STALL_MS) || 3 * 60 * 1000
const RETRY_MS = 30 * 1000 // a report that couldn't go (no chief running) is tried again
const AGAIN_MS = 24 * 3600 * 1000 // a follow-up within a day of its report is watched again
const NOT_HELPERS = new Set(['shell', 'chat']) // a terminal or a plain chat can't take a brief
const clip = (s, n) => { const t = String(s || '').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t }
const oneLine = (s, n) => clip(String(s || '').replace(/\s+/g, ' '), n)

// A role is a plain word or two the chief picks; kept as one lowercase word on the task's line.
const roleOf = (r) => String(r || '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'helper'
// A folder name from a task's title: launch-deck for "Draft the launch deck".
const slugOf = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
// The brief's first line, as the task's title when none is given.
const titleOf = (brief) => {
  const first = String(brief).split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) || ''
  return first.length > 80 ? `${first.slice(0, 80).replace(/\s+\S*$/, '')}…` : first
}

// tasks: the chief's task list (chieftasks.js). resolve(dir): a folder named by the chief, checked
// (places.resolveDir). launch(o): starts the helper's agent, { paneId, session } back. link(thread,
// paneId): shows it under that thread. tell(text, thread): a message to that thread's chief, or
// Main's ({ sent, queued } back). said(h): what it said last ({ text, from: 'chat'|'screen' }).
// replied(agent, since): it has said something since then (its conversation's last message is its
// own). held(paneId): how many messages wait in the queue for it. changed(): the board has news.
export function makeDelegate({ cfg, dir, tasks, you = () => 'the user', resolve, launch, link, tell, said, replied = () => false, held = () => 0, changed = () => {} }) {
  let data = { next: 1, helpers: [] }
  try { data = { ...data, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) } } catch { /* none yet */ }
  // Starting when the server stopped: it goes again (its launch may not have happened). A report
  // that was going out then goes again too.
  for (const h of data.helpers) {
    if (h.state === 'starting' && !h.paneId) h.state = 'queued'
    if (h.report === 'sending') h.report = 'pending'
    delete h.inRequest
  }
  const save = () => {
    const going = data.helpers.filter((h) => h.state !== 'ended' || h.report === 'due' || h.report === 'pending')
    const rest = data.helpers.filter((h) => !going.includes(h)).slice(0, Math.max(0, KEEP - going.length))
    data.helpers = data.helpers.filter((h) => going.includes(h) || rest.includes(h))
    try { writeFileAtomic(FILE, JSON.stringify(data, null, 2)) } catch { /* read-only disk */ }
  }
  const max = () => Math.max(1, Math.min(10, Math.round(Number(cfg.chief?.helpers?.max)) || MAX_DEFAULT))
  const active = () => data.helpers.filter((h) => h.state === 'starting' || h.state === 'working').length
  const waiting = () => data.helpers.filter((h) => h.state === 'queued').sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const edits = () => cfg.chief?.helpers?.editOwnFolder === true
  const rel = (p) => path.relative(dir, p).split(path.sep).join('/')

  // The task's own folder: work/<title as a name>, or with its number when that's taken.
  async function workFolder(title, id) {
    const base = slugOf(title) || `task-${id}`
    let p = path.join(dir, 'work', base)
    if (await fs.promises.access(p).then(() => true, () => false)) p = path.join(dir, 'work', `${base}-${id}`)
    await fs.promises.mkdir(p, { recursive: true })
    return p
  }

  // What the helper is told before the brief: who it works for, where its work goes, and to end
  // with what it made and where, which is what the chief hears back.
  function promptOf(h) {
    const who = you()
    const where = h.own ? `Work in this folder, ${h.cwd}: it's this task's own folder, so put what you make there.` : `Work in ${h.cwd}.`
    return [
      `You're helping ${who}'s Chief of Staff in Bridge AI as its ${h.role} helper, on task ${h.task}: "${h.title}". ${where}${h.readOnly ? " Only read and answer: don't create, change or delete any file." : ''}`,
      `When you've finished, end with a short summary of what you made or found and where it is (the file paths). The Chief of Staff reads it and reports back to ${who}. If you need ${who}'s decision on something, ask it plainly and stop there.`,
      '',
      h.brief,
    ].join('\n')
  }
  const tabName = (h) => clip(`${h.role[0].toUpperCase()}${h.role.slice(1)}: ${h.title}`, 48)

  // Its agent started, in its own folder with edits allowed when you said helpers may, else asking
  // as any agent does. Couldn't: the task says why, and so does its card.
  async function start(h) {
    const access = h.own && !h.readOnly && edits() ? 'edits' : undefined
    try {
      const out = await launch({ kind: h.kind, cwd: h.cwd, own: h.own, label: tabName(h), space: h.space, prompt: promptOf(h), access })
      Object.assign(h, { state: 'working', paneId: out.paneId, session: out.session || '', startedAt: new Date().toISOString(), access: access || null, worked: false, again: false, againAt: null, armedAt: null })
      try { tasks.update(h.task, { status: 'doing', pane: out.paneId }) } catch { /* the task is gone */ }
      save()
      await Promise.resolve(link(h.thread, out.paneId)).catch(() => {})
    } catch (e) {
      await end(h, 'failed', { error: e.message || String(e) })
    }
    changed()
  }

  // Start what's waiting while there's room: one pass at a time, so two delegations at once can't
  // both take the last place; one that comes in meanwhile is looked at before the pass ends.
  let filling = null
  let again = false
  function fill() {
    if (filling) { again = true; return filling }
    filling = (async () => {
      do {
        again = false
        for (let next = waiting()[0]; next && active() < max(); next = waiting()[0]) {
          next.state = 'starting'
          save()
          await start(next)
        }
      } while (again)
    })().finally(() => { filling = null })
    return filling
  }

  // The files it wrote in its own folder since it started, newest first (work/<task>/...).
  async function made(h) {
    const since = Date.parse(h.startedAt || h.at) - 5000
    const out = []
    const walk = async (d, depth) => {
      let ents = []
      try { ents = await fs.promises.readdir(d, { withFileTypes: true }) } catch { return }
      for (const e of ents) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || out.length > 200) continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (depth < 3) await walk(p, depth + 1); continue }
        if (!e.isFile()) continue
        const st = await fs.promises.stat(p).catch(() => null)
        if (st && st.mtimeMs >= since) out.push({ p, at: st.mtimeMs })
      }
    }
    await walk(h.cwd, 0)
    return out.sort((a, b) => b.at - a.at).slice(0, 8).map((x) => rel(x.p))
  }

  // The outcome on its task: the last paragraph of what it said, where it was asked to sum up.
  const outcomeOf = (s) => {
    if (!s?.text) return null
    if (s.from === 'screen') return `Finished. Its screen ends: ${oneLine(s.text.split('\n').filter((l) => l.trim()).slice(-2).join(' '), 300)}`
    const paras = s.text.split(/\n\s*\n/).map((p) => p.replace(/[*_`#>]/g, '').trim()).filter(Boolean)
    return oneLine(paras.at(-1), 400)
  }

  // It stopped: finished, failed (to start) or stopped (closed before it finished). Its state
  // first, so a second look meanwhile can't end it twice; then the task, and the report is due.
  // quiet: back as it was, with nothing to report (a follow-up that never got going).
  async function end(h, how, { error = null, agent = null, quiet = false } = {}) {
    Object.assign(h, { state: 'ended', end: how, endedAt: new Date().toISOString(), error })
    delete h.blocked; delete h.missing
    if (how !== 'failed') {
      try { h.said = (await said({ ...h, ...(agent ? { paneId: agent.paneId, sessionId: agent.sessionId || h.sessionId } : {}) })) || null } catch { h.said = null }
      h.files = h.own ? await made(h) : []
    }
    const patch = how === 'finished'
      ? { status: 'done', outcome: outcomeOf(h.said) || 'Finished, with nothing to read from it here', link: h.files?.length === 1 ? h.files[0] : h.files?.length ? `${rel(h.cwd)}/` : null }
      : how === 'failed'
        ? { status: 'waiting', needs: `Its ${h.role} helper couldn't start: ${oneLine(error, 200)}` }
        : { status: 'waiting', needs: `Its ${h.role} helper was closed before it finished. Start it again, or drop it?` }
    try { tasks.update(h.task, patch) } catch { /* the task is gone */ }
    // Couldn't start while it was being asked for: whoever asked hears it in the answer instead.
    h.report = quiet || (how === 'failed' && h.inRequest) ? 'none' : 'due'
    save()
    setTimeout(() => { flush().catch(() => {}) }, 0)
    fill()
    changed()
  }

  // What the chief hears when a helper stops, in its own words to act on.
  function reportOf(h) {
    const who = you()
    const head = `Report from your ${h.role} helper${h.paneId ? ` (${h.paneId})` : ''} on task ${h.task}, "${h.title}"`
    if (h.end === 'failed') return `${head}: it couldn't start. ${String(h.error || '').replace(/^./, (c) => c.toUpperCase())}\n\nThe task waits on ${who}. Tell them why; once that's sorted, delegate it again (or they can press Try again on its card in Bridge AI).`
    const words = h.said?.text
      ? `\n\n${h.said.from === 'screen' ? 'The end of its screen' : 'Its last message'}:\n${clip(h.said.text, 2500)}`
      : `\n\nIts last words couldn't be read here: run \`node bin/bridge screen ${h.paneId}\`.`
    const files = h.files?.length ? `\n\nFiles it made: ${h.files.join(', ')}` : ''
    if (h.end === 'stopped') return `${head}: its agent was closed before it finished.${words}${files}\n\nThe task waits on ${who}: tell them, and ask whether to start it again.`
    return `${head}: it finished.${words}${files}\n\nCheck it against the brief (\`node bin/bridge show ${h.paneId}\` for more), then tell ${who} what came of it. The task is marked done. If it fell short, send the helper one clear follow-up with \`node bin/bridge send ${h.paneId} "..."\`: the task goes back to doing, and you hear back when it stops again.`
  }

  // Reports that are due, each sent once. With no chief running, one waits and is tried again.
  let flushing = false
  async function flush() {
    if (flushing) return
    flushing = true
    try {
      for (const h of data.helpers.filter((x) => x.report === 'due' || (x.report === 'pending' && Date.now() - (x.tried || 0) > RETRY_MS))) {
        h.report = 'sending'
        h.tried = Date.now()
        const r = await Promise.resolve(tell(reportOf(h), h.thread)).catch((e) => ({ sent: false, error: e.message }))
        h.report = r?.sent ? (r.queued ? 'queued' : 'sent') : 'pending'
        if (!r?.sent && r?.error) console.log(`Couldn't tell the Chief of Staff about task ${h.task}: ${r.error}`)
        save()
      }
    } finally { flushing = false }
  }

  // The fleet as it goes by: each helper at work, whether it's working, waiting on you, or has
  // stopped. Finished is done or idle, with nothing queued for it, once it has worked or said
  // something since it started (a quick one can be over between two looks). A follow-up's done is
  // only taken then too: the last one's done can still be showing.
  let looking = false
  async function observe(f) {
    if (looking || !f || f.down) return
    looking = true
    try {
      let dirty = false
      const now = Date.now()
      for (const h of data.helpers.filter((x) => x.state === 'working' && (x.session || '') === (f.session || ''))) {
        const a = f.agents.find((x) => x.paneId === h.paneId) || (h.sessionId && f.agents.find((x) => x.sessionId === h.sessionId && x.kind === h.kind))
        if (!a) {
          if (!h.missing) { h.missing = now; dirty = true } else if (now - h.missing > GONE_MS) await end(h, 'stopped')
          continue
        }
        if (h.missing) { delete h.missing; dirty = true }
        if (a.paneId !== h.paneId) { h.paneId = a.paneId; try { tasks.update(h.task, { pane: a.paneId }) } catch { /* gone */ } dirty = true }
        if (a.sessionId && a.sessionId !== h.sessionId) { h.sessionId = a.sessionId; dirty = true }
        const asking = a.status === 'blocked' || !!a.asking
        if (asking !== !!h.blocked) { if (asking) h.blocked = true; else delete h.blocked; dirty = true; changed() }
        if (a.status === 'working' && !h.worked) { h.worked = true; dirty = true }
        if (asking || held(a.paneId) || (a.status !== 'done' && a.status !== 'idle')) continue
        const since = h.againAt || h.startedAt
        if (h.worked || (a.status === 'done' && !h.again) || replied(a, since)) await end(h, 'finished', { agent: a })
        else if (now - Date.parse(h.armedAt || h.startedAt) > STALL_MS) {
          if (h.again) await end(h, 'finished', { agent: a, quiet: true })
          else await end(h, 'failed', { error: 'it stopped before doing anything; its terminal may say why' })
        }
      }
      if (dirty) save()
      if (waiting().length) await fill()
      await flush()
    } finally { looking = false }
  }

  // The helper's card on the board: its state, and what its agent is doing now (the agent map's
  // look, agentmap.js) when it's at work.
  function helperView(h, agents, map) {
    const a = h.paneId && h.state !== 'queued' ? agents.find((x) => x.paneId === h.paneId) : null
    const m = a && map.find((x) => x.paneId === a.paneId)
    const line = waiting()
    return {
      id: h.id, role: h.role, state: h.state, end: h.end || null, error: h.error || null, kind: h.kind, cwd: h.cwd, own: !!h.own, readOnly: !!h.readOnly,
      paneId: a ? a.paneId : h.paneId || null, live: !!a, status: a?.status || null, asking: m?.asking || (a?.asking?.title ? oneLine(a.asking.title, 140) : null),
      doing: m?.doing || null, worked: !!h.worked, edits: h.access === 'edits',
      at: h.at, startedAt: h.startedAt || null, endedAt: h.endedAt || null, statusSince: m?.statusSince || null,
      files: h.files || [], position: h.state === 'queued' ? line.indexOf(h) + 1 : null,
    }
  }

  return {
    max,
    // Anything to keep an eye on: a helper at work or waiting its turn, or a report about to go. (One
    // that waits for a chief to be running is tried again as the fleet is looked at anyway.)
    watching: () => data.helpers.some((h) => h.state !== 'ended' || h.report === 'due'),
    observe,
    flush,

    // A helper for this: its task on the list and its folder made, then started now, or queued
    // behind the ones at work. b: { brief, role, title, cwd, kind, thread, readOnly, space, from }.
    async add(b = {}) {
      const brief = String(b.brief || '').trim()
      if (!brief) throw new Error('Say what the helper should do')
      if (brief.length > 20000) throw new Error('The brief is too long: keep it under 20,000 characters and point to files for the rest')
      const kind = String(b.kind || cfg.defaultAgent || 'claude')
      if (NOT_HELPERS.has(kind)) throw new Error(`A helper needs an agent that works on its own: ${kind} can't take a brief`)
      const role = roleOf(b.role)
      const title = oneLine(b.title, 200) || titleOf(brief) || `${role} work`
      // A folder named: checked before anything is made, so a wrong one is said at once.
      const named = b.cwd ? await resolve(String(b.cwd)) : null
      const item = tasks.add(title, { status: 'open', role })
      const cwd = named || await workFolder(item.title, item.id)
      const h = {
        id: `h${data.next++}`, task: item.id, role, title: item.title, brief, kind, cwd, own: !named, readOnly: b.readOnly === true,
        thread: b.thread ? oneLine(b.thread, 20) : null, space: oneLine(b.space, 40) || 'Helpers', from: oneLine(b.from, 20) || 'chief',
        state: 'queued', at: new Date().toISOString(), paneId: null, report: null, inRequest: true,
      }
      data.helpers.unshift(h)
      save()
      changed()
      try { await fill() } finally { delete h.inRequest; save() }
      return { task: tasks.list().items.find((x) => x.id === item.id) || item, helper: helperView(h, [], []), helpers: { max: max(), working: active(), queued: waiting().length } }
    },

    // Try again: a helper that couldn't start, or was closed before it finished, back in line.
    async retry(taskId) {
      const h = data.helpers.find((x) => x.task === String(taskId))
      if (!h) throw new Error(`Task ${taskId} has no helper`)
      if (h.state !== 'ended' || h.end === 'finished') throw new Error(h.state === 'ended' ? 'Its helper finished; send it a follow-up instead' : 'Its helper is already on it')
      Object.assign(h, { state: 'queued', at: new Date().toISOString(), paneId: null, end: null, error: null, said: null, files: [], report: null, worked: false, again: false, againAt: null, startedAt: null, endedAt: null, inRequest: true })
      try { tasks.update(h.task, { status: 'open', pane: null }) } catch { /* gone */ }
      save()
      changed()
      try { await fill() } finally { delete h.inRequest; save() }
      return { task: tasks.list().items.find((x) => x.id === h.task) || null, helper: helperView(h, [], []) }
    },

    // The chief sent a helper that had reported a follow-up (`bridge send`): watched again, for
    // one more report when it stops.
    again(paneId) {
      const h = data.helpers.find((x) => x.paneId === paneId)
      if (!h || h.state !== 'ended' || h.end === 'failed' || Date.now() - Date.parse(h.endedAt || 0) > AGAIN_MS) return false
      Object.assign(h, { state: 'working', worked: false, again: true, againAt: h.endedAt, armedAt: new Date().toISOString(), end: null, report: null })
      delete h.missing
      try { tasks.update(h.task, { status: 'doing' }) } catch { /* gone */ }
      save()
      changed()
      return true
    },

    // Agents that are helpers say so (a.helper: { task, role }), for the sidebar and the board.
    decorate(f) {
      for (const a of f?.agents || []) {
        const h = !a.chief && data.helpers.find((x) => x.paneId === a.paneId && x.state !== 'queued')
        if (h) a.helper = { task: h.task, role: h.role }
      }
    },

    // The task list with each delegated task's helper, for the Tasks tray and board: agents, the
    // fleet's; map, the agent map's view of them (what each is doing).
    board(list, { agents = [], map = [] } = {}) {
      const latest = new Map()
      for (const h of data.helpers) if (!latest.has(h.task)) latest.set(h.task, h)
      return {
        ...list,
        items: list.items.map((it) => (latest.has(it.id) ? { ...it, helper: helperView(latest.get(it.id), agents, map) } : it)),
        helpers: { max: max(), working: active(), queued: waiting().length, edits: edits() },
      }
    },
  }
}
