// The model an agent is on, and switching it from the message box.
//
// Agents with their own switch command (Claude Code's /model) switch in place: the command goes
// in like any message, so it waits its turn when the agent is busy, and what the agent says back
// confirms it. Agents without one (Codex: its /model only opens a picker) restart on the new
// model, resuming the same conversation, the way Continue on another account does.
//
// What you pick is kept per conversation in the data folder (models.json), so a restart, a
// resume from Closed agents, or Continue on another account keeps it.
import fs from 'node:fs'
import { adapter, caps } from './agents.js'
import { modelOf } from './transcripts.js'
import { dataFile, ensureDir, DATA } from './paths.js'
import { promptSafe } from './promptsafe.js'
import * as queue from './queue.js'
import * as chatModels from './chatmodels.js'

const FILE = dataFile('models.json')
let picked = {} // `${kind}:${sessionId}` or `pane:${paneId}` -> { model, at }
try { picked = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {} } catch { picked = {} }
function save() {
  // The newest few hundred are plenty: older conversations fall back to your default.
  const keys = Object.keys(picked)
  if (keys.length > 400) for (const k of keys.sort((a, b) => (picked[a].at || '').localeCompare(picked[b].at || '')).slice(0, keys.length - 400)) delete picked[k]
  try { ensureDir(DATA); fs.writeFileSync(FILE, JSON.stringify(picked, null, 2)) } catch { /* read-only disk: keep going */ }
}
const keysOf = (a) => [a.sessionId && `${a.kind}:${a.sessionId}`, a.paneId && `pane:${a.paneId}`].filter(Boolean)

// What you picked for this agent's conversation: a model name, 'default', or null (nothing yet).
export function chosen(a) {
  for (const k of keysOf(a)) if (picked[k]) return picked[k].model
  return null
}
// For a launch: the model to start with ('default' starts without one), or undefined.
export const forLaunch = (kind, sessionId) => (sessionId && picked[`${kind}:${sessionId}`]?.model) || undefined
export function remember(a, model) {
  const at = new Date().toISOString()
  for (const k of keysOf(a)) picked[k] = { model, at }
  save()
}
// Models picked before for this kind of agent, newest first (the menu offers them again).
const recent = (kind) => [...new Set(Object.entries(picked).filter(([k, v]) => k.startsWith(`${kind}:`) && v.model !== 'default')
  .sort((x, y) => (y[1].at || '').localeCompare(x[1].at || '')).map(([, v]) => v.model))].slice(0, 6)

// A model name as a CLI takes it: "opus", "sonnet[1m]", "claude-opus-5-5", "gpt-5-codex",
// "openrouter/x/y". Nothing that a shell or the agent's input could read as more than a name.
export const validModel = (m) => typeof m === 'string' && /^[A-Za-z0-9][\w.:/@[\]-]{0,99}$/.test(m)

// switch: in place; restart: restarts on it (needs a conversation to resume); fixed: set when it
// starts, shown but not changed here; null: the agent has no model setting at all.
export function modeOf(kind) {
  const a = adapter(kind)
  if (a.switchModel) return 'switch'
  if (a.model && a.resume) return 'restart'
  if (a.model) return 'fixed'
  return null
}

// eslint-disable-next-line no-control-regex
const plain = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '')
const screenLines = (ansi) => plain(ansi).split('\n').map((l) => l.trim()).filter(Boolean)
// What an agent prints when its model changes: Claude Code "Set model to …", Aider "Main model: …".
const SAID = /(set model to\b.*|kept model as\b.*|main model:\s*\S+.*)$/i

export function makeModels({ rt, cfg, findAgent, launchAgent, archiveWhere, pushFleet, archive }) {
  // A switch in progress or just finished, per pane: { model, at, state, said, queueId }.
  // state: queued (waiting for the agent to be free), sent, confirm (the agent asks you to
  // confirm), done, failed, unconfirmed (no word back).
  const switching = new Map()

  // Claude Code says how the switch went in its transcript; the screen is the fallback (a
  // conversation with no messages yet has no transcript, and other agents only print it).
  async function watch(paneId, s, before) {
    const t0 = Date.now()
    let idleSince = null
    const tick = async () => {
      if (switching.get(paneId) !== s || ['done', 'failed', 'unconfirmed'].includes(s.state)) return
      const a = await findAgent(paneId).catch(() => null)
      if (!a) { switching.delete(paneId); return }
      const waiting = s.queueId && (queue.all()[paneId] || []).some((x) => x.id === s.queueId)
      if (s.state === 'queued' && !waiting) { s.state = 'sent'; s.sentAt = Date.now() }
      let said = null
      let ok = true
      try {
        const m = modelOf(a)
        if (m?.set && m.set.at && new Date(m.set.at).getTime() >= s.at - 2000) { said = m.set.said; ok = m.set.ok }
      } catch { /* no transcript yet */ }
      if (!said && s.state !== 'queued') {
        try {
          const fresh = screenLines(await rt.read(paneId, 40)).filter((l) => !before.has(l))
          const hit = fresh.reverse().map((l) => SAID.exec(l)).find(Boolean)
          if (hit) said = hit[1].trim()
        } catch { /* screen unreadable for now */ }
      }
      if (said) {
        s.said = said
        s.state = ok && /^(set model to|main model:)/i.test(said) ? 'done' : 'failed'
        if (s.state === 'done') { remember(a, s.model); await rt.setModel?.(paneId, s.model === 'default' ? null : s.model) }
        pushFleet()
        return
      }
      if (a.status === 'blocked' && s.state !== 'queued') s.state = 'confirm'
      else if (s.state === 'confirm') s.state = 'sent'
      // Sent, the agent is free again, and still no word: say so rather than wait forever.
      idleSince = s.state === 'sent' && a.status !== 'working' ? idleSince || Date.now() : null
      if ((idleSince && Date.now() - idleSince > 20000) || Date.now() - t0 > 45 * 60000) { s.state = 'unconfirmed'; return }
      setTimeout(tick, 1000)
    }
    setTimeout(tick, 600)
  }

  // Everything the message box's model menu needs for one agent.
  async function view(paneId) {
    const a = await findAgent(paneId)
    const ad = adapter(a.kind)
    const mode = modeOf(a.kind)
    let m = null
    try { m = modelOf(a) } catch { /* no transcript */ }
    const pick = chosen(a)
    const s = switching.get(paneId) || null
    // What it's on: the newest of its latest reply's model, a /model since, and a switch or restart
    // from here since (a restarted Codex logs its model with its next turn); else what it started on.
    const replyAt = m?.reply?.at ? new Date(m.reply.at).getTime() : 0
    const setAt = m?.switched?.at ? new Date(m.switched.at).getTime() : 0
    let current = setAt > replyAt ? m.switched.model : m?.reply?.model || null
    let source = current ? 'agent' : null
    if (s?.state === 'done' && (!current || s.at > Math.max(replyAt, setAt))) { current = s.model; source = 'switch' }
    // A restart on a model always starts on it, so a pick newer than its last turn is what it's on
    // (also after Bridge AI restarts, when the switch above is forgotten).
    const pickAt = Math.max(0, ...keysOf(a).map((k) => (picked[k]?.at ? new Date(picked[k].at).getTime() : 0)))
    if (mode === 'restart' && pick && pickAt > Math.max(replyAt, setAt)) { current = pick; source = 'picked' }
    if (!current && pick) { current = pick; source = 'picked' }
    if (!current && a.model) { current = a.model; source = 'started' }
    if (!current && cfg.agents?.[a.kind]?.model) { current = cfg.agents[a.kind].model; source = 'settings' }
    // The menu's tick: what you picked here, or a /model typed in the agent itself since, or what it started on.
    let checked = pick || a.model || cfg.agents?.[a.kind]?.model || 'default'
    if (m?.switched?.arg && setAt > pickAt) checked = m.switched.arg
    // A chat with any model: every model you can reach now, by name ("gpt-5 (OpenAI)").
    const reach = a.kind === 'chat' ? await chatModels.models().catch(() => []) : null
    if (reach && current) checked = current
    return {
      kind: a.kind, label: ad.label, mode, current: current === 'default' ? null : current, source, checked: checked || 'default',
      models: reach ? reach.map((x) => x.id) : [...new Set([...(ad.models || []), ...recent(a.kind)])],
      ...(reach && { labels: Object.fromEntries(reach.map((x) => [x.id, x.via === 'sign-in' ? `${x.label} (your sign-in)` : `${x.label} (${x.provider.replace(/, on this computer$/, '')})`])) }),
      canDefault: mode === 'restart' || (mode === 'switch' && !!ad.switchModel.dflt),
      canResume: !!a.sessionId,
      switching: s && { model: s.model, state: s.state, said: s.said || null, at: new Date(s.at).toISOString() },
    }
  }

  // Switch in place: the agent's own command, sent the way a message is (queued while it's busy
  // and can't take it, or while something covers its input box).
  async function switchInPlace(a, model) {
    const ad = adapter(a.kind)
    if (model === 'default' && !ad.switchModel.dflt) throw new Error(`${ad.label} has no default to switch back to in place. Pick a model.`)
    const text = ad.switchModel.command(model)
    let before = new Set()
    try { before = new Set(screenLines(await rt.read(a.paneId, 40))) } catch { /* unreadable */ }
    const s = { model, at: Date.now(), state: 'sent' }
    let out
    if (a.status === 'working' && !caps(a.kind).typeAhead) {
      const item = queue.add(a.paneId, text)
      Object.assign(s, { state: 'queued', queueId: item.id })
      out = { ok: true, queued: true, reason: 'working' }
    } else {
      try {
        out = await promptSafe(rt, a.paneId, text, a)
        for (const ms of [150, 700, 1600]) setTimeout(pushFleet, ms)
      } catch (e) {
        if (e.code !== 'not_at_prompt') throw e
        const item = queue.add(a.paneId, text)
        Object.assign(s, { state: 'queued', queueId: item.id })
        out = { ok: true, queued: true, reason: e.reason }
      }
    }
    // Claude Code takes it while it works and switches once the turn is done (or asks first).
    if (a.status === 'working' && s.state === 'sent') s.working = true
    switching.set(a.paneId, s)
    pushFleet()
    watch(a.paneId, s, before)
    return { ...out, mode: 'switch', command: text }
  }

  // Restart on the model: the agent stops and starts again with it, resuming the same conversation.
  async function restartOn(a, model) {
    const ad = adapter(a.kind)
    if (!ad.resume || !a.sessionId) throw new Error(`${ad.label} can only restart on another model once it has a conversation to resume`)
    if (a.status === 'working') throw new Error('The agent is working. Wait for it to finish, or press Esc, then try again.')
    if (a.status === 'blocked') throw new Error('The agent is waiting on you. Answer it first, then try again.')
    if (((await rt.fleet()).panes || []).some((p) => p.tabId === a.tabId && p.paneId !== a.paneId)) throw new Error('This tab has other panes. Close them first.')
    const name = a.tab && !/^\d+$/.test(a.tab) ? a.tab : a.title || ad.label
    remember(a, model)
    // Kept in Closed agents until it's back, so a failed restart loses nothing.
    await archiveWhere((x) => x.paneId === a.paneId).catch(() => {})
    await rt.closeTab(a.tabId)
    await new Promise((r) => setTimeout(r, 800)) // let it exit before the new one opens the session
    const still = (await rt.fleet()).workspaces.some((w) => w.id === a.workspaceId)
    const out = await launchAgent({ kind: a.kind, cwd: a.cwd, label: name.slice(0, 60), workspaceId: still ? a.workspaceId : null, newSpace: still ? undefined : a.workspace, resume: a.sessionId, account: a.accountId || undefined, model, pinModel: true })
    archive.removeSession(a.sessionId)
    remember({ kind: a.kind, sessionId: a.sessionId, paneId: out.paneId }, model)
    switching.set(out.paneId, { model, at: Date.now(), state: 'done', said: null })
    pushFleet()
    return { ...out, mode: 'restart', restarted: true }
  }

  async function set(paneId, body = {}) {
    const a = await findAgent(paneId)
    const model = String(body.model || '').trim()
    if (!validModel(model)) throw new Error('That isn\'t a model name')
    const mode = modeOf(a.kind)
    if (mode === 'switch' && !body.restart) return switchInPlace(a, model)
    if (mode === 'restart' || (mode === 'switch' && body.restart)) return restartOn(a, model)
    throw new Error(mode === 'fixed' ? `${adapter(a.kind).label} picks its model when it starts. Start a new agent to use another one.` : `${adapter(a.kind).label} has no model setting`)
  }

  function routes(app, wrap) {
    app.get('/api/agents/:pane/model', wrap((req) => view(req.params.pane)))
    app.post('/api/agents/:pane/model', wrap((req) => set(req.params.pane, req.body || {})))
  }
  return { routes, view, set }
}
