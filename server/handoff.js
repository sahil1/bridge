// Hand off to another agent: move the work from one agent CLI to another (Claude Code to Codex,
// say) from the message box. Agent CLIs can't open each other's conversations, so this is a
// handover: the new agent starts in the same folder (so on the same branch, or in the same
// worktree), on the account and model you pick, in the old one's space and place, with a summary
// of where things stand as its first message. The old agent goes to Closed agents, from where it
// reopens as it was, unless you keep it open too.
//
// The handover is built here, in a moment and with no model call, from the old agent's transcript
// and the folder: your first messages (the goal), its own summary if it compacted, what changed
// (its edits, git status and diff --stat, commits since it began), the recent exchanges, where it
// stopped, and what's still open (its to-do list, messages you'd queued for it). An agent whose
// transcript Bridge AI can't read gives its screen instead. Or, when the old agent is idle and you
// ask, it writes the summary itself first.
//
// It goes in inline, as the new agent's first message, the way any opening prompt does (on the
// command line for CLIs that take one, typed in for the rest). A file was the other way, and it
// needs somewhere to live: in the project it shows in git status (and could get committed), and
// outside it Claude Code and Codex stop to ask before reading it. The first message needs no
// permission, leaves nothing behind, and stays in the new conversation, so a resume keeps it and
// Chat shows it as one "Handed over from …" line (transcripts.js HANDOVER).
//
// The chief of staff hands off the same way: its kind (cfg.chief.kind) changes, and the new chief
// reads its playbook, ledger and task list as usual, with a short handover of the recent talk.
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { AGENTS, adapter, caps, installed } from './agents.js'
import { transcript, opening, planOf } from './transcripts.js'
import { subscriptions } from './providers.js'
import * as accounts from './accounts.js'
import * as worktrees from './worktrees.js'
import * as queue from './queue.js'
import { question } from './notify.js'
import { promptSafe } from './promptsafe.js'
import { gitReady } from './gitready.js'
import { validModel, remember } from './models.js'

const HOME = os.homedir()
const MAX = 9000 // the whole handover, in characters (about 2,000 tokens)
const ASK = '[Bridge AI: handover request]'

const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s }
const oneLine = (s, n) => clip(String(s || '').replace(/\s+/g, ' '), n)
const tilde = (p) => (p && (p === HOME || p.startsWith(HOME + path.sep)) ? `~${p.slice(HOME.length)}` : p || '')
const quote = (s) => s.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')
// eslint-disable-next-line no-control-regex
const plain = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '').replace(/\r/g, '')
const nameOf = (a) => (a.tab && !/^\d+$/.test(a.tab) ? a.tab : a.title || '').replace(/^[^\p{L}\p{N}]+/u, '').trim()
const git = (cwd, args) => new Promise((resolve) => {
  execFile('git', ['-C', cwd, ...args], { timeout: 5000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, out) => resolve(err ? null : String(out)))
})

// The folder's git state: branch, what's changed, and the commits made since `since` (or, on a
// branch of its own, since its base).
async function gitState(cwd, since) {
  if (!cwd || !(await gitReady())) return null
  if (!(await git(cwd, ['rev-parse', '--show-toplevel']))) return null
  const tree = worktrees.describe(cwd)
  const [branch, status, stat, log] = await Promise.all([
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['status', '--porcelain=v1', '--untracked-files=normal']),
    git(cwd, ['diff', 'HEAD', '--stat=100,70']).then((s) => s ?? git(cwd, ['diff', '--cached', '--stat=100,70'])),
    tree?.base ? git(cwd, ['log', '--format=%h %s', '-n', '10', `${tree.base}..HEAD`]) : since ? git(cwd, ['log', `--since=${since}`, '--format=%h %s', '-n', '8']) : null,
  ])
  const lines = (s) => String(s || '').split('\n').filter((l) => l.trim())
  return { branch: branch?.trim() || null, tree, status: lines(status), stat: lines(stat), log: lines(log) }
}

// Where a path is, for someone working in `cwd`: relative inside it, else from your home folder.
const where = (p, cwd) => {
  if (!p) return ''
  const abs = path.isAbsolute(p) ? p : path.resolve(cwd || '', p)
  const rel = cwd ? path.relative(cwd, abs) : null
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : tilde(abs)
}
// A step it took, in a few words: the files an edit changed (the hint is cut short), else its hint.
const toolLine = (m, cwd) => `${m.tool}${m.changes?.length ? ` ${m.changes.map((c) => where(c.path, cwd)).join(', ')}` : m.hint ? ` ${oneLine(m.hint.startsWith('/') ? where(m.hint, cwd) : m.hint, 60)}` : ''}`

export function makeHandoff({ rt, cfg, chiefDir, findAgent: findRaw, launchAgent, archiveWhere, pushFleet, setChiefKind }) {
  // The runtime's view of an agent, and whether it's the chief of staff (its folder says so).
  const findAgent = async (paneId) => {
    const a = await findRaw(paneId)
    return { ...a, chief: !!chiefDir && path.resolve(a.cwd || '') === path.resolve(chiefDir) }
  }
  const asks = new Map() // paneId -> { to, at, state: asking|ready|failed, text, error }: "ask it to write the handover"
  const handed = new Map() // new paneId -> { from, label, at }: so its message box can say where it came from
  const you = () => String(cfg.name || '').trim() || 'the user'

  // ---------- The handover ----------
  // to: the kind taking over; note: your next message for it; own: the old agent's own summary;
  // closing: the old agent closes (so messages queued for it carry over).
  async function build(a, { to, note, own, closing = true } = {}) {
    const from = adapter(a.kind).label
    const toLabel = adapter(to).label
    const cwd = a.cwd
    const parts = { goal: false, messages: 0, files: 0, branch: null, todo: 0, queued: 0, screen: false, own: !!own, compacted: false }
    let msgs = []
    let first = []
    if (caps(a.kind).chat && a.sessionId) {
      try { msgs = transcript(a).messages || [] } catch { /* none readable */ }
      try { first = opening(a) } catch { /* none */ }
    }
    const since = (first.find((m) => m.ts) || msgs.find((m) => m.ts))?.ts || null
    const g = a.chief ? null : await gitState(cwd, since).catch(() => null)
    const out = {}

    // Who's who, and the ground rules.
    out.head = a.chief
      ? `[Bridge AI handover from ${from}]\nYou're taking over as ${you()}'s chief of staff from ${from}, which ran in this folder until now. ${you() === 'the user' ? 'The user' : you()} switched it to you with Bridge AI. Your instructions, playbook, ledger and task list are in this folder as usual: read them first and carry on as they say. You can't see the earlier conversation; this sums up its recent part.`
      : `[Bridge AI handover from ${from}]\nYou're taking over from ${from}, another coding agent, which was working in this folder until now. The user moved the work to you with Bridge AI. You can't see that conversation; this sums it up, from its transcript and the folder's git state. Pick up where it stopped rather than starting over, and where this and the files disagree, trust the files.`
    if (!a.chief) {
      const at = [`Folder: ${tilde(cwd)}`]
      if (g?.tree) at.push(`Git: on its own branch ${g.tree.branch} (from ${g.tree.base}), in a worktree of ${tilde(g.tree.repo)}. Stay on this branch.`)
      else if (g) at.push(`Git: branch ${g.branch || 'unknown'}`)
      else at.push('Not a git repository.')
      out.where = at.join('\n')
      parts.branch = g?.tree?.branch || g?.branch || null
    }

    // The goal: your first messages (or, after an earlier hand-off, the goal it carried).
    const key = (m) => `${m.ts}|${String(m.text || '').slice(0, 80)}`
    const goalKeys = new Set()
    if (!a.chief && first.length) {
      const prior = first.find((m) => m.role === 'event' && m.handover)
      const carried = prior && /(?:^|\n)## The goal\n([\s\S]*?)(?=\n## |$)/.exec(prior.summary || '')?.[1]?.replace(/\n\(If later messages[^\n]*\)\s*$/, '').trim()
      // What you said before its first reply (most often one message, sometimes a few in a row).
      const reply = first.findIndex((m) => m.role === 'assistant')
      const yours = (reply < 0 ? first : first.slice(0, reply)).filter((m) => m.role === 'user' && !/^\//.test(m.text) && !m.text.startsWith(ASK)).slice(0, 3)
      for (const m of yours) goalKeys.add(key(m))
      const text = [carried && clip(carried, 1200), carried && yours.length && 'Then from the user:', ...yours.map((m) => quote(clip(m.text, carried ? 600 : 1000)))].filter(Boolean).join('\n\n')
      if (text) {
        out.goal = `## The goal\n${carried ? 'Carried over from an earlier hand-off:' : `In the user's first message${yours.length > 1 ? 's' : ''}:`}\n${clip(text, 1800)}\n(If later messages changed it, the conversation below says so.)`
        parts.goal = true
      }
    }

    // Its own summary of earlier turns, if it compacted.
    const compact = [...msgs].reverse().find((m) => m.role === 'event' && m.summary && !m.handover)
    if (compact && !own) { out.compact = `## Earlier, in ${from}'s own summary\n${clip(compact.summary, 1500)}`; parts.compacted = true }

    // What changed.
    if (!a.chief) {
      const edited = new Map()
      for (const m of msgs) for (const c of m.changes || []) {
        const p = where(c.path, cwd)
        const e = edited.get(p) || { add: 0, del: 0 }
        e.add += c.add || 0
        e.del += c.del || 0
        edited.set(p, e)
      }
      const ch = []
      if (edited.size) ch.push(`Files it edited (from its tool calls): ${[...edited].slice(0, 20).map(([p, e]) => `${p} (+${e.add} -${e.del})`).join(', ')}${edited.size > 20 ? `, and ${edited.size - 20} others` : ''}.`)
      if (g) {
        ch.push(g.status.length ? `git status --porcelain:\n${g.status.slice(0, 25).join('\n')}${g.status.length > 25 ? `\n(${g.status.length - 25} more lines)` : ''}` : 'git status: clean (nothing uncommitted).')
        if (g.stat.length) ch.push(`git diff --stat HEAD:\n${[...g.stat.slice(0, -1).slice(0, 20), ...(g.stat.length > 21 ? [`(${g.stat.length - 21} more files)`] : []), g.stat.at(-1)].join('\n')}`)
        if (g.log.length) ch.push(`${g.tree ? `Commits on ${g.tree.branch} since ${g.tree.base}` : 'Commits since this conversation began'}:\n${g.log.join('\n')}`)
      }
      parts.files = new Set([...edited.keys(), ...(g?.status || []).map((l) => l.slice(3))]).size
      if (ch.length) out.changes = `## Changes so far\n${ch.join('\n\n')}`
    }

    // Where it stopped.
    const texts = msgs.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.text.startsWith(ASK))
    const last = msgs.filter((m) => m.role !== 'event').at(-1)
    const lastText = texts.at(-1)
    const stop = []
    if (!own) {
      if (lastText?.role === 'assistant') stop.push(`Its last reply:\n${quote(clip(lastText.text, 1500))}`)
      else if (lastText?.role === 'user') stop.push(`The user's last message, which it hadn't finished answering:\n${quote(clip(lastText.text, 1000))}`)
      if (last?.role === 'tool') stop.push(`It was in the middle of a step: ${toolLine(last, cwd)}`)
    }
    if (!msgs.length && caps(a.kind).chat) stop.push('It had no conversation yet: nothing was asked of it, or it hadn\'t saved anything.')
    if (a.status === 'working') stop.push('It was still working when this was written, and the user kept it open, so it may still be changing files here.')
    if (a.status === 'blocked') {
      let q = null
      try { q = question(await rt.read(a.paneId, 60))?.text } catch { /* unreadable */ }
      stop.push(`It was waiting on the user to answer${q ? `: ${oneLine(q, 240)}` : ' a question'}.`)
    }
    if (stop.length) { out.stopped = `## Where it stopped\n${stop.join('\n\n')}`; parts.stopped = true }

    // Its own handover, written on request.
    if (own) out.own = `## ${from}'s own handover (written just now, at the user's request)\n${clip(own, 4500)}`

    // What's still open.
    const open = []
    const plan = (() => { try { return planOf(a) } catch { return null } })()
    if (plan?.length) {
      const order = { in_progress: 0, pending: 1, completed: 2 }
      const items = [...plan].sort((x, y) => (order[x.status] ?? 1) - (order[y.status] ?? 1)).slice(0, 15)
      open.push(`Its to-do list:\n${items.map((x) => `- [${x.status === 'completed' ? 'done' : x.status === 'in_progress' ? 'in progress' : 'to do'}] ${oneLine(x.text, 160)}`).join('\n')}`)
      parts.todo = plan.filter((x) => x.status !== 'completed').length
    }
    const queued = closing ? queue.all()[a.paneId] || [] : []
    if (queued.length) {
      open.push(`Messages the user queued for ${from} that it never got (they're for you now):\n${queued.slice(0, 5).map((x) => quote(clip(x.text, 400))).join('\n\n')}`)
      parts.queued = queued.length
    }
    if (open.length) out.open = `## Still open\n${open.join('\n\n')}`

    // An agent whose conversation Bridge AI can't read: its screen.
    if (!msgs.length && !caps(a.kind).chat) {
      let screen = ''
      try { screen = plain(await rt.read(a.paneId, 150)) } catch { /* unreadable */ }
      const lines = screen.split('\n').map((l) => l.trimEnd()).filter((l, i, all) => l.trim() || (all[i - 1] || '').trim())
      const tail = clip(lines.slice(-60).join('\n').trim(), 3000)
      if (tail) { out.screen = `## Its screen when you took over (last lines)\n\`\`\`\n${tail}\n\`\`\``; parts.screen = true }
    }

    // What to do now.
    const n = String(note || '').trim()
    out.next = a.chief
      ? `## Next\n${n ? `Read your instructions and state files, then answer ${you()}'s next message:\n${clip(n, 2000)}` : `Read your instructions and state files, then tell ${you()} in a line that you've taken over as chief of staff, and wait for their next request.`}`
      : `## Next\n${n ? `Check the files above first. Then, from the user:\n${clip(n, 2000)}` : `Check the files above first. Then tell the user in a few lines where things stand and what you'd do next, and wait for their reply before changing anything.`}`

    // The recent conversation, with what's left of the budget (newest kept first).
    if (!own) {
      const fixed = Object.values(out).join('\n\n').length
      const budget = Math.max(800, Math.min(a.chief ? 2600 : 3600, MAX - fixed - 200))
      const lines = []
      let used = 0
      let tools = []
      const flush = () => {
        if (!tools.length) return
        const named = [...new Set(tools.map((m) => toolLine(m, cwd)))]
        lines.push(`  (${named.slice(0, 5).join(' · ')}${named.length > 5 ? ` · ${named.length - 5} other steps` : ''})`)
        tools = []
      }
      const recent = []
      let kept = 0
      const upto = lastText?.role === 'assistant' ? msgs.lastIndexOf(lastText) : msgs.length
      for (let i = upto - 1; i >= 0 && kept < (a.chief ? 8 : 12); i--) {
        const m = msgs[i]
        if (m.role === 'event' || (m.role === 'user' && (goalKeys.has(key(m)) || m.text.startsWith(ASK)))) continue
        if (m.role === 'tool') { recent.push(m); continue }
        const t = `${m.role === 'user' ? 'User' : from}: ${clip(m.text, m.role === 'user' ? 600 : 900)}`
        if (used + t.length > budget && kept) break
        used += t.length
        kept++
        recent.push({ ...m, line: t })
      }
      while (recent.length && recent.at(-1).role === 'tool') recent.pop() // tools before the oldest message kept
      for (const m of recent.reverse()) {
        if (m.role === 'tool') { tools.push(m); continue }
        flush()
        lines.push(m.line)
      }
      flush()
      parts.messages = kept
      if (parts.messages) out.recent = `## Recent conversation (oldest first)\n${lines.join('\n')}`
    }

    const order = ['head', 'where', 'goal', 'compact', 'changes', 'own', 'recent', 'stopped', 'open', 'screen', 'next']
    let text = order.map((k) => out[k]).filter(Boolean).join('\n\n')
    if (text.length > MAX) text = `${text.slice(0, MAX - out.next.length - 40).trimEnd()}\n(cut to fit)\n\n${out.next}`
    return { text, chars: text.length, parts, from, to: toLabel }
  }

  // ---------- Which agents can take over ----------
  async function targets(a) {
    const list = (await installed()).filter((k) => k.kind !== a.kind && k.kind !== 'shell')
    const [subs, groups] = await Promise.all([subscriptions().catch(() => []), accounts.list().catch(() => [])])
    return list.map((k) => {
      const ad = adapter(k.kind)
      const g = accounts.supports(k.kind) ? groups.find((x) => x.kind === k.kind) : null
      const s = subs.find((x) => x.kind === k.kind)
      // Signed in: any of its accounts, where it has them; else what its sign-in check says (null:
      // there's no telling, which counts as usable).
      const signedIn = g ? (g.accounts.some((x) => x.signedIn) ? true : g.accounts.every((x) => x.signedIn === false) ? false : null) : s?.signedIn ?? null
      return {
        kind: k.kind, label: ad.label, signedIn, hint: s?.hint || null, chat: !!caps(k.kind).chat, resumable: !!ad.resume,
        accounts: g && g.accounts.length > 1 ? g.accounts.map((x) => ({ id: x.id, label: x.label, signedIn: x.signedIn, active: x.active, isDefault: !!x.isDefault })) : null,
        setting: g?.setting || null, modelFlag: !!ad.model, models: ad.models || [],
      }
    })
  }

  // Why it can't hand off and close now (it can still hand off and stay open), or null.
  const busyOf = (a) => (a.status === 'working' ? 'working' : a.status === 'blocked' ? 'blocked' : null)
  const tabMates = async (a) => ((await rt.fleet()).panes || []).some((p) => p.tabId === a.tabId && p.paneId !== a.paneId)

  async function view(paneId, { lite = false } = {}) {
    const a = await findAgent(paneId)
    const h = handed.get(paneId) || null
    if (lite) return { handedFrom: h }
    const s = asks.get(paneId)
    return {
      from: { kind: a.kind, label: adapter(a.kind).label, chief: !!a.chief, resumable: !!(a.sessionId && adapter(a.kind).resume), chat: !!caps(a.kind).chat },
      busy: busyOf(a), tabMates: await tabMates(a),
      canAsk: !!(caps(a.kind).chat && a.sessionId && !busyOf(a)),
      asked: s ? { to: s.to, state: s.state, at: new Date(s.at).toISOString(), error: s.error || null } : null,
      handedFrom: h,
      targets: await targets(a),
    }
  }

  async function preview(paneId, q = {}) {
    const a = await findAgent(paneId)
    const to = String(q.to || '')
    if (!AGENTS.some((x) => x.kind === to)) throw new Error('Pick an agent to hand off to')
    const s = asks.get(paneId)
    return build(a, { to, note: String(q.note || '').slice(0, 2000), own: q.summary === '1' && s?.state === 'ready' && s.to === to ? s.text : null, closing: q.keep !== '1' })
  }

  // ---------- Ask the agent to write it ----------
  async function ask(paneId, to) {
    const a = await findAgent(paneId)
    const from = adapter(a.kind).label
    if (!AGENTS.some((x) => x.kind === to) || to === a.kind) throw new Error('Pick another agent to hand off to')
    if (!caps(a.kind).chat || !a.sessionId) throw new Error(`Bridge AI can't read ${from}'s replies, so it can't write the handover itself. The usual one is built from its screen.`)
    if (busyOf(a)) throw new Error(a.status === 'working' ? `${from} is working. Ask once it's done.` : `${from} is waiting on you. Answer it first.`)
    const text = `${ASK} The user is handing this work over to ${adapter(to).label}, another coding agent, which can't see this conversation. Write the handover it will start from: the goal, what's done and how you checked it, the files you changed, decisions made and why, what's left, and anything to watch out for. Plain text, under 500 words, as your whole reply. Don't change any files or run anything for this.`
    await promptSafe(rt, paneId, text, a)
    const s = { to, at: Date.now(), state: 'asking', text: null, error: null }
    asks.set(paneId, s)
    for (const ms of [150, 700, 1600]) setTimeout(pushFleet, ms)
    // Its reply is in once it has said something after the request and has stopped working.
    let quiet = 0
    const tick = async () => {
      if (asks.get(paneId) !== s || s.state !== 'asking') return
      if (Date.now() - s.at > 6 * 60000) { s.state = 'failed'; s.error = 'No reply after 6 minutes'; return }
      const cur = await findAgent(paneId).catch(() => null)
      if (!cur) { s.state = 'failed'; s.error = `${from} closed`; return }
      let reply = null
      try {
        const msgs = transcript(cur).messages || []
        const i = msgs.findLastIndex((m) => m.role === 'user' && m.text.startsWith(ASK))
        if (i >= 0) reply = msgs.slice(i + 1).filter((m) => m.role === 'assistant').map((m) => m.text).join('\n\n').trim() || null
      } catch { /* not readable yet */ }
      quiet = reply && cur.status !== 'working' ? quiet + 1 : 0
      if (quiet >= 2) { s.state = 'ready'; s.text = reply; return }
      setTimeout(tick, 1500)
    }
    setTimeout(tick, 2000)
    return { ok: true, state: 'asking' }
  }

  // ---------- Hand off ----------
  // A name for the new tab: the old one's, or with the new agent's in brackets when both stay open.
  const LABELS = AGENTS.map((x) => x.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  function nameFor(a, to, keep) {
    if (a.chief) return 'Chief of staff'
    const base = nameOf(a).replace(new RegExp(`\\s*\\((${LABELS.join('|')})\\)$`), '').trim() || path.basename(a.cwd || '') || adapter(to).label
    return (keep ? `${base} (${adapter(to).label})` : base).slice(0, 60)
  }

  async function go(paneId, body = {}) {
    const a = await findAgent(paneId)
    const from = adapter(a.kind).label
    const to = String(body.to || '')
    if (!AGENTS.some((x) => x.kind === to) || to === a.kind) throw new Error('Pick another agent to hand off to')
    if (!(await installed()).some((k) => k.kind === to)) throw new Error(`${adapter(to).label} isn't installed`)
    const keep = !!body.keep && !a.chief
    if (!keep && busyOf(a)) throw new Error(a.status === 'working' ? `${from} is working. Hand off once it's done (or press Stop), or keep it open too.` : `${from} is waiting on you. Answer it first, or keep it open too.`)
    if (!keep && await tabMates(a)) throw new Error('This tab has other panes. Close them first, or keep it open too.')
    const model = String(body.model || '').trim()
    if (model && model !== 'default' && !validModel(model)) throw new Error('That isn\'t a model name')
    const account = body.account ? String(body.account) : undefined
    if (account && account !== 'auto' && !accounts.has(to, account)) throw new Error('No such account')
    const s = asks.get(paneId)
    if (body.summary && !(s?.state === 'ready' && s.to === to)) throw new Error(`${from}'s handover isn't in yet`)
    const { text } = await build(a, { to, note: String(body.note || '').slice(0, 2000), own: body.summary ? s.text : null, closing: !keep })

    // In its space, next to it for now.
    const f = await rt.fleet()
    const at = (f.tabs || []).filter((t) => t.workspaceId === a.workspaceId).findIndex((t) => t.tabId === a.tabId)
    const out = await launchAgent({ kind: to, cwd: a.cwd, label: nameFor(a, to, keep), workspaceId: a.workspaceId, prompt: text, account, model: model || undefined, pinModel: !!model && model !== 'default' })
    handed.set(out.paneId, { from: a.kind, label: from, at: new Date().toISOString() })
    if (model) remember({ kind: to, paneId: out.paneId }, model)
    if (a.chief) await setChiefKind(to)
    asks.delete(paneId)

    // The old one to Closed agents (when it can be reopened from there), and the new one in its place.
    const archived = !keep && !!(a.sessionId && adapter(a.kind).resume)
    if (!keep) {
      await archiveWhere((x) => x.paneId === a.paneId).catch(() => {})
      await rt.closeTab(a.tabId)
    }
    if (at >= 0) {
      try {
        const tab = ((await rt.fleet()).panes || []).find((p) => p.paneId === out.paneId)?.tabId
        if (tab) await rt.moveTab(tab, keep ? at + 1 : at)
      } catch { /* left at the end of the space */ }
    }
    pushFleet()
    return { paneId: out.paneId, closed: !keep, archived, chars: text.length, ...(out.setupError ? { setupError: out.setupError } : {}) }
  }

  function routes(app, wrap) {
    app.get('/api/agents/:pane/handoff', wrap((req) => view(req.params.pane, { lite: req.query.lite === '1' })))
    app.get('/api/agents/:pane/handoff/preview', wrap((req) => preview(req.params.pane, req.query)))
    app.post('/api/agents/:pane/handoff/ask', wrap((req) => ask(req.params.pane, String(req.body?.to || ''))))
    app.post('/api/agents/:pane/handoff', wrap((req) => go(req.params.pane, req.body || {})))
  }
  return { routes, build, view, go, ask }
}

