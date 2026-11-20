// Test this connection (Bots, a beta feature): every check of a connection that can be made from
// this computer, in order, each { id, label, state: ok | warn | fail | skip, detail, fix }, so
// whatever stops it working end to end is said with what to do about it, never left to be found.
//   here        it runs here: not paused, nor moved to another computer (connections.js paused)
//   then the platform's own (its connector's check()): Slack's tokens, scopes, Socket Mode (and
//   another copy on the same app), you there and your direct messages, events arriving, reactions,
//   files in and out, Slack's working status, how quickly it may read a conversation, and the
//   channels it's in against those it's meant to answer or post in (slackbot.js check); Discord's
//   and Teams' tokens and you there (discordbot.js, teamsbot.js)
//   routing     "@app hello" from you, taken through connhub.js's rules dry: which bot would
//               answer, and whether it would answer you (nothing posted, nothing run)
//   bot:<id>    each bot on it: its folders there and readable, and Claude Code installed, signed
//               in and new enough (a live session needs it), else what answers instead
// The last result is kept (connections/<id>/check.json, yours only) and shown with the connection;
// one test at a time for each connection, a second asked meanwhile given the first's.
//
// Its routes, with Bots' guard (yours only, on this computer or another of your devices):
//   POST /api/connections/:cid/check          run it: { at, took, state, counts, checks }
//   GET  /api/connections/:cid/check          the last one (or { checks: [], at: null })
//   POST /api/connections/:cid/link           a code to link you there (connections.js linkCode):
//                                             { code, expiresAt, send } (send: where to send it)
//   GET  /api/connections/:cid/manifest-url   Slack's: where to paste the manifest ({ url, create,
//                                             settings, manifest, update, missing })
import fs from 'node:fs'
import { writeFileAtomic } from './paths.js'
import * as conns from './connections.js'
import { bare, platformOf, PLATFORMS } from './connector.js'
import { connectionManifest, manifest as slackManifest, commandOf } from './slackbot.js'

const ORDER = ['fail', 'warn', 'ok', 'skip']
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t }
const one = (x) => ({ id: String(x.id), label: clip(x.label, 80), state: ORDER.includes(x.state) ? x.state : 'warn', detail: x.detail ? clip(x.detail, 600) : null, fix: x.fix ? clip(x.fix, 300) : null, ...(x.channels ? { channels: x.channels.slice(0, 50) } : {}) })

// hubs: connhub.js's (connectorOf, dry, started). desk: the front desk (view: a bot's folders and
// what answers). bots(): the bots that answer (bots.js live). you(): your name. config(): Bridge
// AI's settings (your name, for a manifest).
export function makeConnCheck({ hubs, desk, bots, you = () => 'the owner', name = () => '' }) {
  const running = new Map() // connection id -> the test going on
  const fileOf = (cid) => conns.fileOf(cid, 'check.json')
  // The last test: { at, took, state, counts, checks }, or null.
  function lastOf(cid) {
    try {
      const j = JSON.parse(fs.readFileSync(fileOf(cid), 'utf8'))
      return j && Array.isArray(j.checks) ? j : null
    } catch { return null }
  }
  // The channels its bots are meant to be in there: each channel's bot (defaults), and those a bot
  // answers in without a mention (listen); as the platform has them.
  const wantOf = (c, on) => {
    const out = new Map()
    const there = (id) => platformOf(id) === c.platform
    for (const d of c.defaults) if (there(d.id)) out.set(d.id, { id: bare(d.id), name: d.name, why: `${bots().find((b) => b.id === d.bot)?.name || d.bot}'s channel` })
    for (const b of on) for (const l of b.listen || []) if (there(l.id) && !out.has(l.id)) out.set(l.id, { id: bare(l.id), name: l.name, why: `${b.name} answers there without a mention` })
    return [...out.values()]
  }
  // Each bot on it: its folders, and what answers (Claude Code, which a live session needs).
  async function botCheck(b) {
    const v = await desk.view(b.id).catch(() => null)
    const label = b.name
    if (!v) return { id: `bot:${b.id}`, label, state: 'fail', detail: 'It isn\'t running here', fix: null }
    const gone = (v.folders || []).filter((f) => !f.ok)
    const list = v.answerers?.list || []
    const claude = list.find((e) => e.id === 'agent:claude')
    const ready = list.find((e) => !e.why)
    const reads = (v.folders || []).filter((f) => f.ok).map((f) => f.shown)
    const where = reads.length ? `reads ${reads.slice(0, 3).join(', ')}${reads.length > 3 ? ` and ${reads.length - 3} more` : ''}` : 'no folders: it answers from an empty one'
    if (!ready) return { id: `bot:${b.id}`, label, state: 'fail', detail: `Nothing here can answer for it: ${(claude || list[0])?.why || 'Claude Code isn\'t installed here'}`, fix: 'Install Claude Code and sign in to it (Settings › Agents)' }
    if (gone.length) return { id: `bot:${b.id}`, label, state: 'fail', detail: `${gone.map((f) => `${f.shown}: ${f.problem || 'not there'}`).join('; ')}`, fix: 'Pick its folders again on its page' }
    if (!claude || claude.why) return { id: `bot:${b.id}`, label, state: 'warn', detail: `It ${where}; ${claude?.why || 'Claude Code isn\'t installed here'}, so ${ready.label} answers, one run for each message, with no live session`, fix: 'Install Claude Code and sign in to it (Settings › Agents)' }
    return { id: `bot:${b.id}`, label, state: 'ok', detail: `It ${where}; Claude Code answers`, fix: null }
  }

  async function run(cid) {
    if (running.has(cid)) return running.get(cid)
    const go = (async () => {
      const c = conns.get(cid)
      if (!c) throw Object.assign(new Error('No such connection'), { status: 404 })
      const at = new Date()
      const con = hubs.connectorOf(c.id)
      const on = conns.botsOn(c, bots())
      const checks = []
      // Here, not paused nor moved.
      if (c.paused) checks.push({ id: 'here', label: 'Running here', state: 'fail', detail: c.pausedWhy || `${c.name} is paused on this computer`, fix: /move|moved/i.test(String(c.pausedBy || '')) ? 'It runs on the computer it moved to: start it there, or take it back in Settings › Back Up & Move' : 'Start it in Settings › Back Up & Move' })
      else if (!hubs.started(c.id) && !on.length) checks.push({ id: 'here', label: 'Running here', state: 'warn', detail: 'No bot is on it, so it isn\'t connected', fix: 'Put a bot on it' })
      else checks.push({ id: 'here', label: 'Running here', state: 'ok', detail: `${PLATFORMS[c.platform]}, on this computer` })
      // The platform's own.
      const owner = c.owner ? { id: bare(c.owner.id), name: c.owner.name } : null
      if (con?.check) {
        try { checks.push(...await con.check({ owner, want: wantOf(c, on) })) } catch (e) { checks.push({ id: 'platform', label: PLATFORMS[c.platform], state: 'fail', detail: `The test stopped: ${e.message}`, fix: null }) }
      } else checks.push({ id: 'platform', label: PLATFORMS[c.platform], state: 'skip', detail: 'Nothing to test on this platform yet' })
      // "@app hello" from you (as your account there, once it's linked), dry.
      if (!on.length) checks.push({ id: 'routing', label: 'Who answers', state: 'skip', detail: 'No bot is on it' })
      else {
        const from = c.owner ? { id: c.owner.id, name: c.owner.name } : { you: true, id: null, name: you() }
        const r = await hubs.dry(c.id, { text: 'hello', channel: null, dm: true, from, mention: true }).catch((e) => ({ error: e.message }))
        const who = r?.bot?.name
        if (r?.error) checks.push({ id: 'routing', label: 'Who answers', state: 'fail', detail: r.error })
        else if (r?.rule === 'asked') checks.push({ id: 'routing', label: 'Who answers', state: 'warn', detail: `"hello" from you would be asked back which bot: ${r.asks.map((x) => x.name).join(', ')}`, fix: 'Make one of them its Chief, so it takes what names no bot' })
        else if (!who) checks.push({ id: 'routing', label: 'Who answers', state: 'fail', detail: `"hello" from you would go to no bot (${r?.rule || 'nothing'}${r?.detail ? `: ${r.detail}` : ''})`, fix: null })
        else if (r.then?.may) checks.push({ id: 'routing', label: 'Who answers', state: c.owner ? 'fail' : 'warn', detail: `"hello" from you would go to ${who} (${r.rule}), which ${r.then.may === 'paused' || r.then.paused ? 'is paused' : `would turn you away (${r.then.may})`}`, fix: c.owner ? null : 'Link yourself under You Here, so it knows it\'s you' })
        else checks.push({ id: 'routing', label: 'Who answers', state: 'ok', detail: `"hello" from you goes to ${who} (${r.rule === 'chief' ? 'its Chief' : r.rule}), which answers you` })
      }
      // Each bot on it.
      for (const b of on.slice(0, 20)) checks.push(await botCheck(b))
      const list = checks.map(one)
      const counts = Object.fromEntries(ORDER.map((s) => [s, list.filter((x) => x.state === s).length]))
      const out = { at: at.toISOString(), took: Date.now() - at.getTime(), state: counts.fail ? 'fail' : counts.warn ? 'warn' : 'ok', counts, checks: list }
      try { writeFileAtomic(fileOf(c.id), JSON.stringify(out, null, 2), { mode: 0o600 }) } catch { /* shown, if not kept */ }
      conns.note(c.id, { event: 'check', ok: !counts.fail, why: counts.fail || counts.warn ? list.filter((x) => x.state === 'fail' || x.state === 'warn').map((x) => `${x.label}: ${x.detail}`).slice(0, 3).join('; ').slice(0, 300) : null })
      return out
    })().finally(() => running.delete(cid))
    running.set(cid, go)
    return go
  }

  // Where to paste the manifest: the app's own App Manifest page (its id from Slack's hello), else a
  // new app made from it; and whether it needs updating (scopes the token lacks).
  function manifestUrl(c) {
    if (c.platform !== 'slack') throw Object.assign(new Error('That\'s for a Slack connection'), { status: 400 })
    const s = hubs.connectorOf(c.id)?.state() || {}
    const on = conns.botsOn(c, bots())
    const m = c.shared ? connectionManifest(c, on, name()) : slackManifest(bots().find((b) => b.id === c.bot) || { name: c.name }, name())
    const appId = /^A[A-Z0-9]{1,20}$/.test(String(s.appId || '')) ? s.appId : null
    const missing = s.scopes?.missing || []
    return {
      url: appId ? `https://api.slack.com/apps/${appId}/app-manifest` : null,
      settings: appId ? `https://api.slack.com/apps/${appId}/general` : null,
      create: `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(m))}`,
      manifest: m, update: missing.length > 0, missing, command: commandOf(c.name),
    }
  }

  function routes(app, { guard, wrap, record = () => {} }) {
    const connOf = (req) => { const c = conns.get(req.params.cid); if (!c) throw Object.assign(new Error('No such connection'), { status: 404 }); return c }
    app.post('/api/connections/:cid/check', guard, wrap(async (req) => run(connOf(req).id)))
    app.get('/api/connections/:cid/check', guard, wrap(async (req) => lastOf(connOf(req).id) || { at: null, checks: [] }))
    // A code to link you there: sent by you to the app in a direct message (connhub.js linked).
    app.post('/api/connections/:cid/link', guard, wrap(async (req) => {
      const c = connOf(req)
      const r = conns.linkCode(c.id)
      record(c, req)
      const s = hubs.connectorOf(c.id)?.state() || {}
      const app = c.platform === 'slack' ? (s.bot?.name ? `@${s.bot.name}` : c.name) : c.name
      return { ...r, send: `Send ${r.code} to ${app} in a direct message${c.platform === 'teams' ? ' (a chat of its own)' : ''}` }
    }))
    app.get('/api/connections/:cid/manifest-url', guard, wrap(async (req) => manifestUrl(connOf(req))))
  }
  return { run, lastOf, routes, manifestUrl }
}
