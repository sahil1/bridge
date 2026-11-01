// The demo's backend, in the page: answers everything the UI asks the server, from made-up agents
// that work, ask, finish and reply on a script (world.js), in made-up repos (repos.js). Plugged in
// at src/standalone/serve.js; nothing leaves the page.
import { version } from '../../package.json'
import { HOME, CHIEF_DIR, makeRepos } from './repos.js'
import { SPACES, AGENTS, SHELLS, TAB_ORDER, FRESH, finishedNote, reply, chiefReply } from './world.js'
import * as F from './feeds.js'
import { screenOf, shell as shellScreen, COLS, ROWS } from './screens.js'
import { editLines, gitDiff, count, undoHunk } from './diff.js'
import { createClouds } from './clouds.js'
import { ADAPTERS } from '../../shared/cloud/index.js'
import { follow } from '../../shared/cloud/follow.js'
import { cloudApi, NOT_CLOUD } from '../standalone/cloud.js'

// What only a real computer can do. Said calmly, in one line.
// Made-up month for the Insights card: every agent and account, and a write-up.
function demoInsights() {
  const daily = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.now() - (29 - i) * 864e5).toLocaleDateString('en-CA'), hours: [0, 6].includes(new Date(Date.now() - (29 - i) * 864e5).getDay()) ? (i % 3 ? 0 : 0.8) : Math.round((2 + ((i * 7) % 5) + (i % 4) * 0.6) * 10) / 10 }))
  const agents = [['claude', 'Claude Code', 64, 51.5, 820], ['codex', 'Codex', 29, 18.2, 260], ['gemini', 'Gemini CLI', 9, 3.4, 41]].map(([kind, label, sessions, hours, messages]) => ({ kind, label, sessions, hours, messages, fromBridge: kind === 'gemini' }))
  return {
    stats: {
      days: 30, from: daily[0].date, to: daily[29].date, generatedAt: iso(),
      totals: { sessions: 102, hours: 73.1, messages: 1121, files: 388, projects: 5, agents: 3, waitingHours: 6.5 },
      agents,
      accounts: [{ kind: 'claude', agent: 'Claude Code', account: 'Work', sessions: 48, hours: 40.3 }, { kind: 'claude', agent: 'Claude Code', account: 'Personal', sessions: 16, hours: 11.2 }, { kind: 'codex', agent: 'Codex', account: 'Your usual login', sessions: 29, hours: 18.2 }],
      projects: [{ name: 'acme-shop', sessions: 41, hours: 33.6, agents: ['Claude Code', 'Codex'] }, { name: 'billing-api', sessions: 27, hours: 21.9, agents: ['Claude Code', 'Codex'] }, { name: 'docs-site', sessions: 14, hours: 8.1, agents: ['Gemini CLI', 'Claude Code'] }, { name: 'Chief of Staff', sessions: 12, hours: 6.2, agents: ['Claude Code'] }, { name: 'Home folder', sessions: 8, hours: 3.3, agents: ['Codex'] }],
      daily,
    },
    report: {
      generatedAt: iso(Date.now() - 2 * 864e5), by: 'Claude Code (Work)', who: 'claude',
      summary: 'A busy month on acme-shop and billing-api. Claude Code did most of the building, Codex handled reviews and quick fixes, and agents waited on you about six and a half hours in total.',
      working: [
        { title: 'Codex reviews catch real bugs', detail: 'On billing-api, sending Claude Code\'s changes to Codex for review found two refund bugs before they shipped. Keep that pairing for anything touching payments.' },
        { title: 'Short, specific asks finish fast', detail: 'Sessions that opened with one clear task (fix the cart total, add a webhook test) finished in under 30 minutes on average.' },
      ],
      friction: [
        { title: 'Agents waiting on you overnight', detail: 'Most of the 6.5 hours of waiting was overnight questions on acme-shop. Answer from your phone, or tell the agent which choices it can make itself.' },
        { title: 'Long sessions on the checkout page', detail: 'Three sessions on the checkout page ran over two hours and you stopped them several times. Splitting it into smaller tasks would help.' },
      ],
      tryNext: [
        { title: 'Give docs-site to Gemini', detail: 'Gemini CLI did well on the docs pages in its 9 sessions. Hand it the release notes too, and keep Claude Code on the shop.' },
        { title: 'Use Personal for side projects', detail: 'Your Work account hit its weekly limit twice. Starting home-folder experiments on Personal keeps Work free for the shop.' },
      ],
      agents: [
        { agent: 'Claude Code', note: 'Your main builder on acme-shop and billing-api; most files changed came from it.' },
        { agent: 'Codex', note: 'Reviews and quick fixes; short sessions, few interruptions.' },
        { agent: 'Gemini CLI', note: 'Docs pages; seen through Bridge AI, so only time and prompts are counted.' },
      ],
    },
    running: null, error: null,
    writers: [{ id: 'claude', label: 'Claude Code (Work)', via: 'cli' }, { id: 'gpt', label: 'Codex (Default)', via: 'cli' }, { id: 'gemini', label: 'Gemini CLI', via: 'cli' }],
    claudeReport: null,
  }
}
const needs = (what, verb = 'needs') => { throw Object.assign(new Error(`${what} ${verb} Bridge AI on your computer.`), { status: 501 }) }
const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const iso = (ms = Date.now()) => new Date(ms).toISOString()
const tilde = (p) => String(p || '').replace(HOME, '~')
const untilde = (p) => String(p || '').replace(/^~(?=\/|$)/, HOME).replace(/\/$/, '') || HOME

// everything: the Studio Mac's busy day (every agent, meetings, cloud agents, routines). Without it,
// a brand-new install: the chief of staff and one agent (world.js FRESH).
export function createDemo({ everything = true } = {}) {
  const all = everything
  // ---------- State ----------
  const S = {
    spaces: SPACES.filter((w) => all || FRESH.spaces.includes(w.id)).map((w) => ({ ...w })),
    tabs: [],
    agents: new Map(),
    shells: new Map(),
    repos: makeRepos(),
    calls: new Map(), // edit call id -> { path, before, after, root }
    queue: {}, // paneId -> [{ id, text, at }]
    accts: F.makeAccounts(),
    routines: all ? F.makeRoutines() : [],
    ideas: all ? F.makeIdeas() : [],
    chiefTasks: all ? F.makeChiefTasks() : [],
    meetings: all ? F.makeMeetings() : [],
    prompts: all ? [{ id: 'pr1', name: 'Review before commit', text: 'Review your changes as a senior engineer would: bugs first, then naming and tests. Fix what you find.', used: 3, createdAt: iso() }] : [],
    archive: all ? F.archive().items : [],
    cfg: { ...F.CONFIG, simple: !all }, // a new install starts on the simple layout
    seq: 100,
    next: 100,
  }
  const uid = () => `e${++S.next}`
  const tabOf = (id) => S.tabs.find((t) => t.tabId === id)
  const spaceOf = (id) => S.spaces.find((w) => w.id === id)
  const repoOf = (cwd) => S.repos[cwd] || null
  const agent = (pane) => S.agents.get(pane) || fail(`No agent in pane ${pane}`, 404)

  // ---------- Live updates ----------
  const subs = { fleet: new Set(), transcript: new Map() } // transcript: paneId -> Set of { send, last }
  let pending = false
  const bump = () => {
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      const f = fleet()
      for (const send of subs.fleet) send(f, 'fleet')
      for (const [pane, set] of subs.transcript) {
        const a = S.agents.get(pane)
        if (!a) continue
        const out = JSON.stringify(transcript(a))
        for (const s of set) if (s.last !== out) { s.last = out; s.send(out) }
      }
    }, 30)
  }
  const setStatus = (a, status) => { if (a.status !== status) { a.status = status; a.seq = ++S.seq } bump() }

  // ---------- Cloud agents ----------
  // One per provider, on made-up provider APIs (clouds.js) and the real adapters, followed the
  // way Bridge AI follows them (shared/cloud/follow.js). Every provider has a (made-up) key.
  const clouds = createClouds()
  const memo = new Map()
  const clients = {}
  const client = (id) => (clients[id] ||= ADAPTERS[id].create({ key: 'demo-key', fetch: clouds.fetch, memo: { get: (k) => memo.get(k), set: (k, v) => memo.set(k, v) }, github: id === 'claude' ? 'demo-token' : null }))
  const cloud = follow({ tasks: all ? clouds.seed() : [], client, saved: () => ({ set: true, last4: '' }) })
  cloud.on({ change: () => bump() })
  const cloudReq = cloudApi(cloud, {
    keys: { put: () => needs('Saving a key'), remove: () => needs('Removing a key') },
    mute: (t, on) => { t.muted = on; bump(); return { ok: true, muted: on } },
  })
  const cloudMuted = (pane) => !!cloud.find(pane)?.muted

  // ---------- Conversations ----------
  const push = (a, m, ts = Date.now()) => { a.log.push({ id: `${uid()}:0`, ts: iso(ts), ...m }); bump() }

  // One step of a script (world.js), done now.
  function effect(a, st, ts) {
    if (st.you != null) push(a, { role: 'user', text: st.you }, ts)
    if (st.say != null) push(a, { role: 'assistant', text: st.say }, ts)
    if (st.event != null) push(a, { role: 'event', status: st.status || 'completed', text: st.event }, ts)
    if (st.tool) push(a, { role: 'tool', tool: st.tool, hint: st.hint || '' }, ts)
    if (st.run) push(a, { role: 'tool', tool: a.kind === 'claude' ? 'Bash' : a.kind === 'gemini' ? 'run_shell_command' : 'shell', hint: st.run, out: st.out }, ts)
    if (st.edit) edit(a, st.edit, st.with, ts)
    if (st.commit) commit(a, ts)
    if (st.ask) { a.question = st.ask; a.onAnswer = st.then; a.qtyping = null }
    if (st.fx) st.fx()
  }

  function edit(a, rel, fn, ts) {
    const repo = repoOf(a.cwd)
    const before = repo?.work[rel] ?? null
    const after = fn(before ?? '')
    if (repo) repo.work[rel] = after
    const path = `${a.cwd}/${rel}`
    const call = `call_${uid()}`
    const { add, del } = editLines(before, after)
    S.calls.set(call, { path, rel, before, after, cwd: a.cwd })
    const tool = a.kind === 'claude' ? (before == null ? 'Write' : 'Edit') : a.kind === 'codex' ? 'apply_patch' : 'edit'
    push(a, { role: 'tool', tool, hint: a.kind === 'claude' ? path : rel, call, changes: [{ path, add, del }] }, ts)
  }

  function commit(a, ts) {
    const repo = repoOf(a.cwd)
    const files = repo ? changes(repo) : []
    if (!files.length) { push(a, { role: 'assistant', text: 'Nothing to commit: the working tree is clean.' }, ts); return }
    const subject = tabOf(a.tabId)?.label || 'Changes'
    const hash = Math.random().toString(16).slice(2, 9)
    push(a, { role: 'tool', tool: a.kind === 'claude' ? 'Bash' : 'shell', hint: `git add -A && git commit -m "${subject}"` }, ts)
    repo.head = { ...repo.work }
    repo.lastCommit = { hash, subject, when: 'just now' }
    repo.ahead++
    push(a, { role: 'assistant', text: `Committed ${files.length} file${files.length === 1 ? '' : 's'} as \`${hash}\`: ${subject}. Not pushed yet.` }, ts)
  }

  // Play a script out loud: the agent works, steps land one by one, then it's done.
  const pace = (st) => st.wait ?? (st.say ? Math.min(3200, 900 + st.say.length * 6) : st.run ? 1700 : st.edit ? 1300 : st.tool ? 1000 : 300)
  function play(a, steps, { then } = {}) {
    const gen = a.gen
    a.chain = a.chain.then(async () => {
      if (a.gen !== gen) return
      if (a.status !== 'working') { a.since = Date.now(); a.doing = null }
      setStatus(a, 'working')
      for (const st of steps) {
        if (st.doing) { a.doing = st.doing; bump() }
        await sleep(pace(st))
        if (a.gen !== gen) return
        effect(a, st, Date.now())
        if (st.ask) { a.doing = null; setStatus(a, 'blocked'); return }
      }
      a.doing = null
      setStatus(a, 'done')
      then?.()
      if (a.reportTo) { const c = S.agents.get(a.reportTo); a.reportTo = null; if (c) report(c, a) }
      // What waited for it to be free goes next.
      const q = S.queue[a.paneId]
      if (q?.length) { const item = q.shift(); bump(); prompt(a, item.text) }
    })
    return a.chain
  }

  // The chief of staff says when an agent it's minding finishes.
  function report(chief, a) {
    const last = [...a.log].reverse().find((m) => m.role === 'assistant')
    const text = finishedNote[a.paneId] || `**${tabOf(a.tabId)?.label}** finished: ${String(last?.text || 'done').split('\n')[0]}`
    play(chief, [{ doing: 'Checking', wait: 900 }, { say: text, wait: 600 }])
  }

  // A message to an agent: it shows in its chat (or on its screen), and it answers.
  function prompt(a, text) {
    a.draft = ''
    if (a.question) fail('agent_blocked')
    if (a.kind === 'claude' && /^\/model\s+\S/.test(text)) return switchModel(a, text.split(/\s+/)[1])
    push(a, { role: 'user', text })
    if (/^\/clear\b/.test(text)) { a.log = []; bump(); return }
    if (/^\/compact\b/.test(text)) return play(a, [{ doing: 'Compacting', wait: 1600 }, { event: 'Conversation compacted' }])
    // A task from the Tasks panel: the chief does it itself and ticks it off.
    const task = a.chief && /^Task (\d+) from my Tasks panel: (.+)/.exec(text)
    if (task) {
      const [, id, title] = task
      const file = `work/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `task-${id}`}/draft.md`
      const outcome = 'A first draft is ready for your edits.'
      return play(a, [
        { run: `node bin/bridge task doing ${id}`, doing: 'Starting', fx: () => setTask(id, { status: 'doing' }) },
        { edit: file, with: () => `# ${title}\n\nA first draft. Change anything that doesn't sound like you.\n`, doing: 'Writing' },
        { run: `node bin/bridge task done ${id} "…" --file ${file}`, fx: () => setTask(id, { status: 'done', outcome, link: file }) },
        { say: `Done: a first draft of "${title}" is in \`${file}\`. Task ${id} is ticked off.` },
      ])
    }
    if (a.chief) {
      const r = chiefReply(text, fleet().agents)
      return play(a, r.steps, {
        then: () => {
          if (r.to) { const t = S.agents.get(r.to); if (t) { t.reportTo = a.paneId; if (t.question) return; prompt(t, text) } }
          if (r.launch) { const t = launch({ kind: 'claude', cwd: `${HOME}/code/acme-shop`, workspaceId: r.launch.space, label: r.launch.name, prompt: text }); t.reportTo = a.paneId }
        },
      })
    }
    return play(a, reply(a, text, a.replies++))
  }

  // Claude Code's /model: it takes it after the step it's on, then says so in the chat.
  function switchModel(a, model) {
    a.switching = { model, at: iso(), state: 'sent', said: null }
    bump()
    a.chain = a.chain.then(async () => {
      await sleep(900)
      const id = F.MODEL_IDS[model] || model
      const said = model === 'default' ? `Set model to Default (${F.modelName(id)})` : `Set model to ${F.modelName(id)}${id !== model ? ` (${id})` : ''}`
      a.model = model === 'default' ? F.MODEL_ON.claude : id
      a.switching = { ...a.switching, state: 'done', said }
      push(a, { role: 'event', status: 'completed', text: said })
    })
    return a.chain
  }

  function interrupt(a) {
    if (a.status !== 'working') return
    a.gen++
    a.chain = Promise.resolve()
    a.doing = null
    push(a, { role: 'user', text: '[Request interrupted by user]' })
    setStatus(a, 'idle')
  }

  // The question card's answers arrive as the keys you'd press in the terminal.
  function answer(a, k, text) {
    const q = a.question
    const n = q.options.length
    if (text != null) { if (a.qtyping != null) a.qtyping += text; return }
    if (k === 'enter' && a.qtyping != null) return resolve(a, { custom: a.qtyping.trim() || 'Your call' })
    if (k === 'enter') return resolve(a, q.options[0])
    if (k === 'esc') {
      a.question = null
      push(a, { role: 'tool', tool: 'AskUserQuestion', hint: 'You declined to answer' })
      push(a, { role: 'assistant', text: "Okay, I'll leave it there. The test I wrote still fails until we decide; tell me when you want to pick it up." })
      setStatus(a, 'idle')
      return
    }
    const i = Number(k)
    if (!(i >= 1)) return
    if (i <= n) return resolve(a, q.options[i - 1])
    if (i === n + 1) { a.qtyping = ''; return }
    if (i === n + 2) {
      a.question = null
      push(a, { role: 'tool', tool: 'AskUserQuestion', hint: 'You chose to talk it over' })
      push(a, { role: 'assistant', text: "Sure. It only matters when someone opens the sign-in page directly, with no page to go back to. What would you like them to see first?" })
      setStatus(a, 'idle')
    }
  }
  function resolve(a, choice) {
    const then = a.onAnswer
    a.question = null
    a.onAnswer = null
    push(a, { role: 'tool', tool: 'AskUserQuestion', hint: `You chose: ${choice.custom || choice.label}` })
    play(a, then ? then(choice) : [{ say: 'Thanks, carrying on.' }])
  }

  // Typing in an agent's terminal (or its message box mirrored there).
  function type(a, steps) {
    for (const st of steps) {
      if (st.text != null) { if (a.question) answer(a, null, st.text); else a.draft += st.text }
      for (const k of st.keys || []) {
        if (a.question) { answer(a, k); continue }
        if (k === 'enter') { const t = a.draft.trim(); a.draft = ''; if (t) prompt(a, t) } else if (k === 'shift+enter') a.draft += '\n'
        else if (k === 'backspace') a.draft = a.draft.slice(0, -1)
        else if (k === 'esc' || k === 'ctrl+c') { if (a.status === 'working') interrupt(a); else a.draft = '' } else if (k === 'space') a.draft += ' '
        else if (k.length === 1) a.draft += k
      }
    }
    bump()
  }

  // ---------- Agents and tabs ----------
  function addAgent(def, { replay = true } = {}) {
    const a = {
      paneId: def.paneId, tabId: def.tabId, workspaceId: def.workspaceId, kind: def.kind, cwd: def.cwd, chief: !!def.chief,
      status: 'idle', seq: ++S.seq, account: def.account || (F.CAPS[def.kind] && S.accts[def.kind] ? `${def.kind}-default` : null), sessionId: def.sessionId || `demo-${def.paneId.replace(':', '-')}`,
      muted: false, worktree: def.worktree || null, log: [], question: null, onAnswer: null, qtyping: null, doing: null, since: Date.now(), draft: '',
      chain: Promise.resolve(), gen: 0, replies: 0, reportTo: null, model: F.MODEL_ON[def.kind] || null, switching: null,
    }
    S.agents.set(a.paneId, a)
    if (replay) {
      // The past, as it happened: times from each `at`, a little apart.
      let t = Date.now()
      for (const st of def.script || []) {
        if (st.at != null) { t = Date.now() - st.at * 6e4; continue }
        effect(a, st, t)
        if (st.doing) a.doing = st.doing
        t += 25e3
      }
      a.status = def.status || 'idle'
      a.since = Date.now() - 40e3
    }
    return a
  }

  function addTab(workspaceId, label) {
    const tabId = `t${++S.next}`
    const t = { tabId, workspaceId, label }
    // After the space's last tab.
    const last = S.tabs.findLastIndex((x) => x.workspaceId === workspaceId)
    S.tabs.splice(last < 0 ? S.tabs.length : last + 1, 0, t)
    return t
  }

  function launch({ kind = 'claude', cwd, label, prompt: text, workspaceId, newSpace, account, ownBranch, branch }) {
    let dir = untilde(cwd || '~/code/acme-shop')
    let ws = workspaceId && spaceOf(workspaceId)
    if (!ws) { ws = { id: `w${++S.next}`, label: String(newSpace || label || 'New space').slice(0, 60) }; S.spaces.push(ws) }
    const name = String(label || dir.split('/').pop() || 'agent').slice(0, 60)
    let worktree = null
    const repo = repoOf(dir)
    if (ownBranch && repo && !repo.notGit) {
      const b = branch || `bridge/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
      const folder = `${HOME}/.bridge-ai/worktrees/${dir.split('/').pop()}-${b.split('/').pop()}`
      S.repos[folder] = { ...repo, root: folder, head: { ...repo.head }, work: { ...repo.head }, branch: b, upstream: null, ahead: 0, worktreeOf: dir }
      worktree = { folder, repo: dir, branch: b, base: repo.branch }
      dir = folder
    }
    const t = addTab(ws.id, name)
    const a = addAgent({ paneId: `${ws.id}:p${++S.next}`, tabId: t.tabId, workspaceId: ws.id, kind, cwd: dir, worktree, account: account && account !== 'auto' ? account : null }, { replay: false })
    bump()
    if (text?.trim()) setTimeout(() => prompt(a, text.trim()), 900)
    return a
  }

  function closeTab(tabId) {
    for (const [id, a] of S.agents) {
      if (a.tabId !== tabId) continue
      a.gen++
      S.archive.unshift({ id: uid(), sessionId: a.sessionId, kind: a.kind, label: tabOf(tabId)?.label, workspace: spaceOf(a.workspaceId)?.label, cwd: tilde(a.cwd), fullCwd: a.cwd, closedAt: iso(), preview: String([...a.log].reverse().find((m) => m.role === 'assistant')?.text || '').slice(0, 160), paneId: null, log: a.log })
      S.agents.delete(id)
    }
    for (const [id, s] of S.shells) if (s.tabId === tabId) S.shells.delete(id)
    const t = tabOf(tabId)
    S.tabs = S.tabs.filter((x) => x.tabId !== tabId)
    if (t && !S.tabs.some((x) => x.workspaceId === t.workspaceId)) S.spaces = S.spaces.filter((w) => w.id !== t.workspaceId)
    bump()
  }

  // ---------- What the server would say ----------
  const kindLabel = (k) => F.LABELS[k] || k
  const accountLabel = (a) => (a.account && !a.account.endsWith('-default') ? S.accts[a.kind]?.accounts.find((x) => x.id === a.account)?.label || null : null)
  const viewAgent = (a) => {
    const t = tabOf(a.tabId)
    const tabs = S.tabs.filter((x) => x.workspaceId === a.workspaceId)
    return {
      paneId: a.paneId, tabId: a.tabId, workspaceId: a.workspaceId, workspace: spaceOf(a.workspaceId)?.label || '', tab: t?.label || '',
      kind: a.kind, status: a.status, title: a.chief ? 'Chief of Staff' : t?.label || kindLabel(a.kind), cwd: a.cwd, account: accountLabel(a), accountId: a.account,
      sessionId: a.sessionId, focused: false, seq: a.seq, chief: a.chief, ...(a.chief ? { thread: { id: 'main', name: 'Main', main: true } } : {}), caps: F.CAPS[a.kind] || {}, kindLabel: kindLabel(a.kind), tabNumber: tabs.indexOf(t) + 1,
      worktree: a.worktree, muted: a.muted,
    }
  }
  const rect = { x: 0, y: 0, width: COLS, height: ROWS }
  function fleet() {
    const rank = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 }
    const inCloud = cloud.fleetAgents({ isMuted: cloudMuted })
    const agents = [...[...S.agents.values()].map(viewAgent), ...inCloud].sort((x, y) => (y.chief - x.chief) || (rank[x.status] ?? 9) - (rank[y.status] ?? 9) || y.seq - x.seq)
    const order = (id) => S.spaces.findIndex((w) => w.id === id)
    const tabs = S.tabs.map((t) => ({
      tabId: t.tabId, workspaceId: t.workspaceId, workspace: spaceOf(t.workspaceId)?.label || '', label: t.label,
      number: S.tabs.filter((x) => x.workspaceId === t.workspaceId).indexOf(t) + 1, area: rect, zoomed: false,
      panes: [...[...S.agents.values()].filter((a) => a.tabId === t.tabId).map((a) => ({ paneId: a.paneId, agent: true, cwd: a.cwd, title: t.label, rect, worktree: a.worktree })),
        ...[...S.shells.values()].filter((s) => s.tabId === t.tabId).map((s) => ({ paneId: s.paneId, agent: false, cwd: s.cwd, title: 'zsh', rect, worktree: null }))],
    })).sort((a, b) => order(a.workspaceId) - order(b.workspaceId))
    const workspaces = S.spaces.map((w) => {
      const st = agents.filter((a) => a.workspaceId === w.id).map((a) => a.status)
      return { id: w.id, label: w.label, status: ['blocked', 'working', 'done', 'idle'].find((s) => st.includes(s)) || 'idle' }
    })
    if (inCloud.length) workspaces.push(cloud.space(inCloud))
    return { agents, tabs, workspaces, counts: agents.reduce((c, a) => ({ ...c, [a.status]: (c[a.status] || 0) + 1 }), {}), queue: S.queue }
  }
  function panes() {
    const f = fleet()
    const n = (ws) => S.spaces.findIndex((w) => w.id === ws) + 1
    return f.tabs.flatMap((t) => t.panes.map((p) => {
      const a = S.agents.get(p.paneId)
      return { paneId: p.paneId, workspaceId: t.workspaceId, tabId: t.tabId, workspace: t.workspace, number: n(t.workspaceId), tab: t.label, agent: a ? a.kind : null, status: a ? a.status : null, title: a ? t.label : 'zsh', cwd: p.cwd, cols: COLS, rows: ROWS }
    }))
  }
  const transcript = (a) => ({ supported: !!F.CAPS[a.kind]?.chat, messages: a.log.map(({ out, ...m }) => m), more: null })
  function preview(a) {
    const last = [...a.log].reverse().find((m) => m.role === 'assistant' || m.role === 'user')
    const tool = a.log.at(-1)?.role === 'tool' ? a.log.at(-1) : null
    if (!last && !tool) return null
    return { text: last ? last.text.replace(/[*`#>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220) : '', role: last?.role || null, tool: tool ? `${tool.tool}: ${tool.hint}` : null, ts: a.log.at(-1)?.ts || null }
  }
  function screen(pane, lines) {
    const a = S.agents.get(pane)
    if (a) return { ansi: screenOf(a, lines), cols: COLS }
    const s = S.shells.get(pane) || S.shells.get(tabPane(pane))
    if (s) return { ansi: shellScreen(s), cols: COLS }
    fail(`No pane ${pane}`, 404)
  }
  const tabPane = (id) => [...S.shells.values()].find((s) => `tab:${s.tabId}` === id)?.paneId

  // ---------- Git, in the made-up repos ----------
  function changes(repo) {
    const paths = [...new Set([...Object.keys(repo.head), ...Object.keys(repo.work)])].sort()
    return paths.filter((p) => (repo.head[p] ?? null) !== (repo.work[p] ?? null)).map((p) => {
      const before = repo.head[p] ?? null
      const after = repo.work[p] ?? null
      const status = before == null ? 'untracked' : after == null ? 'deleted' : 'modified'
      return { path: p, status, staged: false, ...(status === 'untracked' ? {} : count(gitDiff(p, before, after).diff.split('\n').filter((l) => /^[+-](?![+-]{2} )/.test(l)))) }
    })
  }
  function git(cwd) {
    const repo = repoOf(cwd)
    if (!repo || repo.notGit) return { repo: false }
    return { repo: true, branch: repo.branch, ahead: repo.ahead, behind: 0, upstream: repo.upstream, remote: repo.remote, detached: false, files: changes(repo), lastCommit: repo.lastCommit }
  }
  const places = () => Object.fromEntries([...new Set([...S.agents.values(), ...S.shells.values()].map((x) => x.cwd))].map((cwd) => {
    const r = repoOf(cwd)
    return [cwd, r && !r.notGit ? { branch: r.branch, dirty: changes(r).length, root: r.worktreeOf || r.root } : null]
  }))

  // Files: the repo's files on disk now, as folders and files.
  function listDir(cwd, rel = '') {
    const repo = repoOf(cwd)
    const all = repo ? Object.keys(repo.work).filter((p) => repo.work[p] != null) : []
    const prefix = rel ? `${rel.replace(/\/$/, '')}/` : ''
    const seen = new Map()
    for (const p of all) {
      if (!p.startsWith(prefix)) continue
      const [first, ...rest] = p.slice(prefix.length).split('/')
      const path = prefix + first
      if (!seen.has(path)) seen.set(path, { name: first, path, dir: rest.length > 0, size: rest.length ? 0 : repo.work[p].length, mtime: Date.now() - 36e5 })
    }
    return { path: rel, entries: [...seen.values()].sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name)) }
  }
  function readFile(cwd, rel) {
    const repo = repoOf(cwd)
    const text = repo?.work[rel]
    if (text == null) fail(`No such file: ${rel}`, 404)
    const name = rel.split('/').pop()
    const ext = name.includes('.') ? `.${name.split('.').pop().toLowerCase()}` : ''
    return { path: rel, name, ext, size: text.length, mtime: Date.now() - 36e5, kind: 'text', text, truncated: false }
  }

  // ---------- The chief's own tasks ----------
  const setTask = (id, patch) => {
    const it = S.chiefTasks.find((x) => x.id === String(id).replace(/^#/, '')) || fail(`No task ${id} on the list`)
    if (patch.status && patch.status !== 'done') Object.assign(it, { done: null, outcome: null })
    if (patch.status && patch.status !== 'waiting') it.needs = null
    if (patch.status === 'done' && it.status !== 'done') it.done = new Date().toLocaleDateString('en-CA')
    Object.assign(it, patch)
    return it
  }
  const RANK = { waiting: 0, doing: 1, open: 2 }
  const chiefTasks = () => [
    ...S.chiefTasks.filter((x) => x.status !== 'done').sort((a, b) => RANK[a.status] - RANK[b.status] || b.id - a.id),
    ...S.chiefTasks.filter((x) => x.status === 'done').sort((a, b) => String(b.done).localeCompare(String(a.done)) || b.id - a.id),
  ]

  // ---------- The brief ----------
  function brief(primary = 'claude') {
    const f = fleet()
    const by = (s) => f.agents.filter((a) => a.status === s)
    const cal = F.calendar().today.filter((e) => new Date(e.end) > Date.now())
    const next = cal.find((e) => new Date(e.start) > Date.now())
    const t = (s) => new Date(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const q = F.quota(S.accts)
    const p = q.providers.find((x) => x.provider === primary) || q.providers[0]
    const w = F.weather()
    const due = S.routines.filter((r) => ['due', 'overdue', 'never'].includes(r.state))
    const hour = new Date().getHours()
    const mail = F.mail().messages.filter((m) => m.bucket === 'needs' && !m.read)
    return {
      greeting: `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${S.cfg.name ? `, ${S.cfg.name}` : ''}`,
      date: iso(),
      lines: [
        { key: 'calendar', text: `${cal.length} meeting${cal.length === 1 ? '' : 's'} still ahead today.${next ? ` Next: ${next.title} at ${t(next.start)}.` : ''}` },
        { key: 'email', text: `${mail.length} unread need${mail.length === 1 ? 's' : ''} you, from ${[...new Set(mail.map((m) => m.from))].join(', ')}.` },
        { key: 'agents', text: `${by('working').length} working, ${by('blocked').length} waiting on you, ${by('done').length} finished and unread.`, items: [...by('blocked'), ...by('done')].slice(0, 5).map((a) => ({ paneId: a.paneId, status: a.status, label: a.title })) },
        ...(() => {
          const open = chiefTasks().filter((x) => x.status !== 'done')
          const wait = open.filter((x) => x.status === 'waiting').length
          const head = `${open.length} open task${open.length === 1 ? '' : 's'}${wait ? `, ${wait} waiting on you` : ''}`
          return open.length ? [{ key: 'chief', text: open.length <= 3 ? `${head}: ${open.map((x) => x.title).join(', ')}.` : `${head}. First up: ${open.slice(0, 2).map((x) => x.title).join(', ')}.` }] : []
        })(),
        { key: 'routines', text: due.length ? `${due.length} due: ${due.map((r) => r.name).join(', ')}.` : 'All routines are up to date.', routines: due.map((r) => ({ id: r.id, name: r.name, state: r.state })) },
        { key: 'quota', text: `${p.provider === 'claude' ? 'Claude' : 'Codex'}: ${p.windows[0].percentRemaining}% of the 5h window and ${p.windows[1].percentRemaining}% of the week left.` },
        { key: 'weather', text: `${w.location}: ${w.current.temp}°F and ${w.current.summary.toLowerCase()} now, high ${w.daily[0].hi}°F, low ${w.daily[0].lo}°F.` },
      ],
    }
  }

  // ---------- Requests ----------
  const ok = { ok: true }
  const routes = []
  const on = (method, pattern, fn) => routes.push([method, new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn])

  on('GET', '/fleet', () => fleet())
  on('GET', '/config', () => ({ version, name: S.cfg.name || '', location: S.cfg.location?.label || null, hasMortgage: false, runtime: { name: 'builtin', liveView: false, reorder: true, splits: false }, platform: 'darwin', mail: true, calendar: true, defaultAgent: S.cfg.defaultAgent || 'claude', chiefKind: S.cfg.chief?.kind || 'claude', setupDone: true, simple: !!S.cfg.simple }))
  on('GET', '/runtime-theme', () => ({}))
  on('GET', '/version', () => ({ version, build: 'demo', bundled: false }))
  on('GET', '/previews', () => ({ ...Object.fromEntries([...S.agents.values()].map((a) => [a.paneId, preview(a)])), ...cloud.previews() }))
  on('GET', '/places', () => places())
  on('GET', '/panes', () => ({ panes: panes() }))
  on('GET', '/agent-kinds', () => F.kinds())
  on('GET', '/agents/catalog', () => F.catalog())
  on('GET', '/dirs', ({ query }) => {
    const q = query.get('q') || '~/'
    const full = untilde(q)
    const known = [...new Set([`${HOME}/code`, ...Object.keys(S.repos).filter((p) => p.startsWith(`${HOME}/code/`))])]
    const exists = full === HOME || known.includes(full)
    const base = q.endsWith('/') ? full : full.split('/').slice(0, -1).join('/')
    const dirs = [`${HOME}/code`, ...known].filter((p) => p.startsWith(`${base}/`) && !p.slice(base.length + 1).includes('/') && p.startsWith(full.replace(/\/$/, '')))
    return { exists, path: tilde(full), dirs: [...new Set(dirs)].map((p) => `${tilde(p)}/`) }
  })
  on('GET', '/repo', ({ query }) => {
    const dir = untilde(query.get('dir'))
    const r = repoOf(dir)
    if (!r || r.notGit || r.worktreeOf) return { repo: null }
    const label = (query.get('branch') || query.get('label') || 'agent').toLowerCase().replace(/[^a-z0-9/]+/g, '-').replace(/^-|-$/g, '')
    return { repo: dir, name: dir.split('/').pop(), current: r.branch, branches: [r.branch], own: false, setup: '', include: false, branch: label.startsWith('bridge/') ? label : `bridge/${label}` }
  })

  // Home's projects: the three made-up repos, the busiest first.
  const projects = [['acme-shop', 41, { claude: 30, codex: 11 }], ['billing-api', 27, { claude: 15, codex: 12 }], ['docs-site', 14, { gemini: 9, claude: 5 }]]
    .map(([name, count, kinds], i) => ({ path: `${HOME}/code/${name}`, name, short: `~/code/${name}`, git: true, count, kinds, last: Date.now() - (i + 1) * 3_600_000 }))
  on('GET', '/projects', ({ query }) => ({ projects, ...(query.get('scan') ? { found: projects.map((x) => ({ ...x, suggested: true })) } : {}) }))
  on('POST', '/projects', () => ({ projects }))

  // Meetings: two made-up ones, read only.
  on('GET', '/meetings', () => ({ meetings: S.meetings.map(({ transcript: _t, notes: _n, summary, ...m }) => ({ ...m, hasSummary: !!summary })), kinds: F.MEETING_KINDS }))
  on('GET', '/meetings/search', ({ query }) => {
    const ws = String(query.get('q') || '').toLowerCase().match(/[\p{L}\p{N}']+/gu) || []
    const has = (s) => ws.some((w) => String(s).toLowerCase().includes(w))
    return {
      terms: ws,
      results: ws.length ? S.meetings.filter((m) => ws.every((w) => [m.title, m.summary, m.notes, ...m.transcript.map((l) => l.text)].join('\n').toLowerCase().includes(w))).map((m) => {
        if (has(m.title)) return { id: m.id, where: 'title' }
        const l = m.transcript.find((x) => has(x.text))
        return l ? { id: m.id, where: 'transcript', who: l.src === 'them' ? 'Them' : 'You', t: `${Math.floor(l.t0 / 60)}:${String(Math.round(l.t0) % 60).padStart(2, '0')}`, snippet: l.text } : { id: m.id, where: 'summary', snippet: m.summary.split('\n').find(has)?.replace(/^[-#*\s[\]]+/, '') || '' }
      }) : [],
    }
  })
  on('POST', '/meetings/ask', () => needs('Asking about your meetings'))
  // Meeting memory and saving: made up, and read only.
  on('GET', '/meetings/memory', () => ({ terms: [
    { id: 'm1', term: 'Acme', heard: ['Ack me'], note: 'our company', source: 'you', seen: 6, meetings: [], updatedAt: null },
    { id: 'm2', term: 'Priya', heard: [], note: 'checkout lead', source: 'learned', seen: 3, meetings: [], updatedAt: null },
    { id: 'm3', term: 'billing-api', heard: ['billing API'], note: '', source: 'learned', seen: 2, meetings: [], updatedAt: null },
  ] }))
  on('POST', '/meetings/memory', () => needs('Changing meeting memory'))
  on('PATCH', '/meetings/memory/:tid', () => needs('Changing meeting memory'))
  on('DELETE', '/meetings/memory/:tid', () => needs('Changing meeting memory'))
  on('GET', '/meetings/saving', () => ({ folder: `${HOME}/Documents/Meeting notes`, noteSub: '{year}/{month}/{day}', noteName: '{title}-summary', transcriptFolder: `${HOME}/Documents/Meeting notes`, transcriptSub: '{year}/{month}/{day}', transcriptName: '{title}-transcript', what: 'both', frontmatter: true, you: 'You', them: 'Them', keep: true, example: [`${HOME}/Documents/Meeting notes/2026/10/26/Weekly sync-summary.md`, `${HOME}/Documents/Meeting notes/2026/10/26/Weekly sync-transcript.md`], misplaced: 0 }))
  on('POST', '/meetings/move-saved', () => needs('Moving saved notes'))
  on('POST', '/meetings/:id/note', () => needs('Adding to a meeting\'s notes'))
  on('PATCH', '/meetings/:id/lines', () => needs('Editing a transcript'))
  on('POST', '/meetings/:id/replace', () => needs('Fixing a word'))
  on('POST', '/meetings/:id/transcribe', () => needs('Transcribing again'))
  on('GET', '/meetings/:id/suggest', () => ({ mail: [], mailReason: null }))
  on('POST', '/meetings/:id/links', () => needs('Linking files to a meeting'))
  on('POST', '/meetings/:id/files', () => needs('Linking files to a meeting'))
  on('DELETE', '/meetings/:id/links/:lid', () => needs('Changing a meeting\'s files'))
  on('POST', '/meetings/:id/links/:lid/open', () => needs('Opening a file on your computer'))
  on('POST', '/meetings/:id/captures', () => needs('Keeping pictures with a meeting'))
  on('PATCH', '/meetings/:id/captures/:cid', () => needs('Changing a picture'))
  on('DELETE', '/meetings/:id/captures/:cid', () => needs('Changing a picture'))
  on('POST', '/meetings/bulk', ({ body }) => {
    const ids = [].concat(body?.ids || [])
    // Folders and the archive work in the demo, in this tab.
    if (['archive', 'unarchive', 'folder'].includes(body?.action)) {
      for (const m of S.meetings.filter((x) => ids.includes(x.id))) { if (body.action === 'folder') m.folder = String(body.folder || '').trim().slice(0, 60) || null; else m.archived = body.action === 'archive' }
      return { action: body.action, done: ids, failed: [] }
    }
    if (body?.action !== 'delete') needs(body?.action === 'save' ? 'Saving to your notes folder' : body?.action === 'chief' ? 'Sending action items to the chief of staff' : body?.action === 'transcribe' ? 'Transcribing again' : 'Writing a summary')
    S.meetings = S.meetings.filter((m) => !ids.includes(m.id))
    return { action: 'delete', done: ids, failed: [] }
  })
  // A meeting's action items, none handed on yet: starting an agent or ticking one needs a computer.
  on('GET', '/meetings/since', () => ({ last: null }))
  on('GET', '/meetings/:id/since', () => ({ last: null }))
  on('GET', '/meetings/:id/work', ({ p }) => {
    const m = S.meetings.find((x) => x.id === p.id) || fail('No such meeting', 404)
    const part = String(m.summary || '').split(/\n(?=##\s)/).find((x) => /^\s*##\s*Action items/i.test(x)) || ''
    const items = [...part.matchAll(/^\s*[-*]\s*\[([ xX])\]\s*(.+)$/gm)].map((x, n) => ({ key: `demo${n}`, text: x[2].trim(), who: null, yours: /^you:/i.test(x[2].trim()), ticked: x[1] !== ' ', done: null, agent: null, chief: null, state: x[1] !== ' ' ? 'done' : 'open' }))
    return { items, counts: { all: items.length, done: items.filter((x) => x.ticked).length, needs: 0, working: 0, review: 0, open: items.filter((x) => !x.ticked).length, prs: 0, agents: 0, chief: 0 } }
  })
  on('GET', '/meetings/:id/work/:key', () => needs('Starting an agent from a meeting'))
  on('POST', '/meetings/:id/work/:key/agent', () => needs('Starting an agent from a meeting'))
  on('POST', '/meetings/:id/work/:key/done', () => needs('Ticking an action item'))
  on('GET', '/meetings/:id', ({ p }) => S.meetings.find((m) => m.id === p.id) || fail('No such meeting', 404))
  on('POST', '/meetings', () => needs('Recording a meeting'))
  on('PUT', '/meetings/:id/notes', () => ok)
  on('PATCH', '/meetings/:id', ({ p, body }) => {
    const m = S.meetings.find((x) => x.id === p.id)
    if (m && body?.title) m.title = String(body.title).slice(0, 120)
    if (m && body?.archived != null) m.archived = !!body.archived
    if (m && body?.folder !== undefined) m.folder = String(body.folder || '').trim().slice(0, 60) || null
    return ok
  })
  on('POST', '/meetings/:id/section', () => needs('Recording a meeting'))
  on('PATCH', '/meetings/:id/sections/:i', () => needs('Changing a meeting\'s sections'))
  on('DELETE', '/meetings/:id/sections/:i', () => needs('Changing a meeting\'s sections'))
  on('PATCH', '/meetings/:id/speakers', () => needs('Naming who said it'))
  on('POST', '/meetings/:id/speakers', () => needs('Working out who said what'))
  on('GET', '/meetings/:id/events', () => ({ events: [] }))
  on('POST', '/meetings/:id/event', () => needs('Taking people from your calendar'))
  on('DELETE', '/meetings/:id', ({ p }) => { S.meetings = S.meetings.filter((m) => m.id !== p.id); return ok })
  on('POST', '/meetings/:id/ask', () => needs('Asking about a meeting'))
  on('POST', '/meetings/:id/summary', () => needs('Writing a summary'))
  on('POST', '/meetings/:id/chief', () => needs('Sending action items to the chief of staff'))
  on('POST', '/meetings/:id/save', () => needs('Saving to your notes folder'))
  on('GET', '/speech', () => F.speech())
  on('POST', '/speech/models/:id', () => needs('Downloading a speech model'))
  on('POST', '/speech/install', () => needs('Installing whisper.cpp'))

  // An agent
  on('GET', '/agents/:pane/transcript', ({ p }) => transcript(agent(p.pane)))
  on('GET', '/agents/:pane/transcript/earlier', () => ({ messages: [], more: null }))
  on('GET', '/agents/:pane/transcript/diffs', ({ query }) => {
    const files = new Map()
    for (const id of (query.get('calls') || '').split(',')) {
      const c = S.calls.get(id)
      if (!c) continue
      const e = editLines(c.before, c.after)
      const f = files.get(c.path) || files.set(c.path, { path: c.path, add: 0, del: 0, lines: [], cut: 0 }).get(c.path)
      f.add += e.add
      f.del += e.del
      f.lines.push(...e.lines)
    }
    return { files: [...files.values()] }
  })
  on('GET', '/agents/:pane/screen', ({ p, query }) => screen(p.pane, Number(query.get('lines')) || ROWS))
  on('GET', '/agents/:pane/question', ({ p }) => ({ text: S.agents.get(p.pane)?.question?.text || null }))
  on('GET', '/agents/:pane/subagents', ({ p }) => ({ items: p.pane === 'w3:p5' ? [{
    id: 'sa1', description: 'Find every place tax is rounded', status: 'done', tools: 6, startedAt: iso(Date.now() - 80 * 6e4), updatedAt: iso(Date.now() - 78 * 6e4),
    steps: [{ kind: 'tool', tool: 'Grep', hint: 'quantize', ts: iso(Date.now() - 80 * 6e4) }, { kind: 'tool', tool: 'Read', hint: 'billing/invoices.py', ts: iso(Date.now() - 79 * 6e4) }, { kind: 'say', text: 'Only tax() rounds; it uses the default, half to even.', ts: iso(Date.now() - 78 * 6e4) }],
    result: 'Only `tax()` in `billing/invoices.py` rounds money. It calls `quantize()` without a rounding mode, so it rounds half to even.', brief: 'Find every place the billing code rounds money, and say how.',
  }] : [], tasks: p.pane === 'w3:p5' ? [{
    id: 'b1', kind: 'shell', description: 'Run the billing tests', command: 'pytest billing -q', status: 'done', startedAt: iso(Date.now() - 77 * 6e4), updatedAt: iso(Date.now() - 76 * 6e4),
    summary: 'Background command "Run the billing tests" completed (exit code 0)', output: ['............', '12 passed in 3.41s'],
  }] : [] }))
  on('GET', '/agents/:pane/commands', ({ p }) => ({ kind: agent(p.pane).kind, commands: [
    { name: 'compact', description: 'Summarize the conversation to free context', mode: 'fill', source: 'built-in' },
    { name: 'clear', description: 'Start a fresh conversation (clears context)', mode: 'fill', source: 'built-in' },
    { name: 'review', description: 'Review the changes on this branch', mode: 'fill', source: 'built-in' },
    { name: 'btw', description: 'Ask a side question without interrupting', mode: 'fill', source: 'built-in' },
  ] }))
  on('GET', '/agents/:pane/mentions', ({ p, query }) => {
    const a = agent(p.pane)
    const repo = repoOf(a.cwd)
    const q = (query.get('q') || '').toLowerCase()
    const files = repo ? Object.keys(repo.work).filter((f) => repo.work[f] != null) : []
    const dirs = [...new Set(files.flatMap((f) => f.split('/').slice(0, -1).map((_, i, all) => `${all.slice(0, i + 1).join('/')}/`)))]
    const items = [...dirs.map((d) => ({ path: d, dir: true })), ...files.map((f) => ({ path: f, dir: false }))].filter((e) => !q || e.path.toLowerCase().includes(q))
    return { cwd: a.cwd, items: (q ? items : items.filter((e) => !e.path.replace(/\/$/, '').includes('/'))).slice(0, 50), total: items.length }
  })
  on('POST', '/agents/:pane/prompt', async ({ p, body }) => {
    const a = agent(p.pane)
    const text = String(body?.text || '').trim()
    if (!text) fail('Empty prompt')
    if (a.question) fail('agent_blocked')
    if (/^\/btw\s/.test(text) && F.CAPS[a.kind]?.btw) {
      await sleep(1800)
      return { ok: true, btw: "Quick answer, without stopping its work: yes. Nothing in this folder depends on that, so it's safe to change later. It didn't change any files to answer." }
    }
    prompt(a, text)
    return ok
  })
  on('POST', '/agents/:pane/queue', ({ p, body }) => {
    agent(p.pane)
    const item = { id: uid(), text: String(body?.text || '').trim(), at: iso() }
    ;(S.queue[p.pane] ||= []).push(item)
    bump()
    return item
  })
  on('DELETE', '/agents/:pane/queue/:id', ({ p }) => { S.queue[p.pane] = (S.queue[p.pane] || []).filter((x) => x.id !== p.id); bump(); return ok })
  on('POST', '/agents/:pane/steer', ({ p, body }) => {
    const a = agent(p.pane)
    interrupt(a)
    setTimeout(() => prompt(a, String(body?.text || '').trim()), 600)
    return { ...ok, steered: true }
  })
  on('POST', '/agents/:pane/keys', ({ p, body }) => { type(agent(p.pane), [{ keys: (body?.keys || []).map(String) }]); return ok })
  on('POST', '/panes/:pane/input', ({ p, body }) => {
    const a = S.agents.get(p.pane)
    if (!a) return ok
    if (body?.atPrompt && a.question) return { ok: false, notAtPrompt: true }
    type(a, Array.isArray(body?.steps) ? body.steps : [])
    return ok
  })
  on('POST', '/panes/:pane/keys', ({ p, body }) => {
    const a = S.agents.get(p.pane)
    if (a) type(a, [{ keys: (body?.keys || []).map(String) }])
    else shellKeys(p.pane, body?.keys || [])
    return ok
  })
  on('POST', '/panes/:pane/text', ({ p, body }) => {
    const a = S.agents.get(p.pane)
    const steps = [{ text: String(body?.text || '') }, ...(body?.enter ? [{ keys: ['enter'] }] : [])]
    if (a) type(a, steps)
    else shellType(p.pane, steps)
    return ok
  })
  on('POST', '/agents/:pane/rewind', ({ p, body }) => {
    const a = agent(p.pane)
    const back = Number(body?.back) || 1
    const users = a.log.map((m, i) => (m.role === 'user' && !/^\[Request interrupted/.test(m.text) ? i : -1)).filter((i) => i >= 0)
    const at = users[users.length - back]
    if (at == null) fail("Couldn't find that message")
    a.gen++
    a.chain = Promise.resolve()
    a.log = a.log.slice(0, at)
    a.question = null
    prompt(a, String(body?.text || '').trim())
    return ok
  })
  on('POST', '/agents/:pane/undo', ({ p, body }) => {
    const a = agent(p.pane)
    if (a.status === 'working' || a.status === 'blocked') fail('The agent is busy. Undo once it has finished.')
    const at = a.log.findIndex((m) => m.id === body?.id)
    if (at < 0) fail("Couldn't find that message")
    const gone = a.log.slice(at)
    const repo = repoOf(a.cwd)
    let files = false
    for (const m of [...gone].reverse()) {
      const c = m.call && S.calls.get(m.call)
      if (!c || !repo) continue
      if (c.before == null) delete repo.work[c.rel]
      else repo.work[c.rel] = c.before
      files = true
    }
    a.log = a.log.slice(0, at)
    setStatus(a, 'idle')
    return { ok: true, files }
  })
  on('POST', '/agents/:pane/fork', ({ p }) => {
    const a = agent(p.pane)
    const t = addTab(a.workspaceId, `${tabOf(a.tabId)?.label} (fork)`.slice(0, 60))
    const b = addAgent({ paneId: `${a.workspaceId}:p${++S.next}`, tabId: t.tabId, workspaceId: a.workspaceId, kind: a.kind, cwd: a.cwd, worktree: a.worktree, account: a.account }, { replay: false })
    b.log = a.log.map((m) => ({ ...m }))
    bump()
    return { paneId: b.paneId }
  })
  // The message box's model chip: Claude switches in place, Codex restarts on the model.
  on('GET', '/agents/:pane/model', ({ p }) => {
    const a = agent(p.pane)
    const mode = a.kind === 'claude' ? 'switch' : a.kind === 'codex' ? 'restart' : null
    return { kind: a.kind, label: kindLabel(a.kind), mode, current: a.model, source: a.model ? 'agent' : null, checked: a.picked || 'default', models: F.MODELS[a.kind] || [], canDefault: !!mode, canResume: true, switching: a.switching }
  })
  on('POST', '/agents/:pane/model', ({ p, body }) => {
    const a = agent(p.pane)
    const model = String(body?.model || '').trim()
    if (!/^[A-Za-z0-9][\w.:/@[\]-]{0,99}$/.test(model)) fail("That isn't a model name")
    a.picked = model
    if (a.kind === 'claude') {
      const command = `/model ${model}`
      if (a.question) { (S.queue[a.paneId] ||= []).push({ id: uid(), text: command, at: iso() }); a.switching = { model, at: iso(), state: 'queued', said: null }; bump(); return { ok: true, queued: true, reason: 'a question is waiting for your answer', mode: 'switch', command } }
      switchModel(a, model)
      return { ok: true, mode: 'switch', command }
    }
    if (a.kind !== 'codex') fail(`${kindLabel(a.kind)} picks its model when it starts`)
    if (a.status === 'working') fail('The agent is working. Wait for it to finish, or press Esc, then try again.')
    a.model = model === 'default' ? F.MODEL_ON.codex : model
    a.switching = { model, at: iso(), state: 'done', said: null }
    push(a, { role: 'event', status: 'completed', text: `Restarted on ${model === 'default' ? 'its default model' : model}, same conversation` })
    return { paneId: a.paneId, mode: 'restart', restarted: true }
  })
  on('POST', '/agents/:pane/continue', ({ p, body }) => {
    const a = agent(p.pane)
    if (a.status === 'working') fail('The agent is working. Wait for it to finish, or press Esc, then try again.')
    a.account = String(body?.account || a.account)
    push(a, { role: 'event', status: 'completed', text: `Continued on ${accountLabel(a) || S.accts[a.kind]?.accounts.find((x) => x.isDefault)?.label || 'your usual login'}` })
    return { paneId: a.paneId }
  })
  // Hand off to another agent (the model chip's menu): a new agent of that kind in the old one's
  // place, starting from a handover built from its chat (as server/handoff.js does), which then
  // says where things stand. The old one goes to Closed agents unless you keep it open.
  const handed = new Map() // new paneId -> { from, label, at }
  const asks = new Map() // paneId -> { to, state, at, text }
  const ASK = '[Bridge AI: handover request]'
  const clipTo = (t, n) => { t = String(t || '').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t }
  const quoted = (t) => String(t).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')
  const porcelain = (files) => files.map((f) => `${f.status === 'untracked' ? '??' : ' M'} ${f.path}`).join('\n')
  function handover(a, { note, own } = {}) {
    const from = kindLabel(a.kind)
    const said = a.log.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.text.startsWith(ASK))
    const goal = a.chief ? null : said.find((m) => m.role === 'user')
    const last = said.at(-1)
    const repo = repoOf(a.cwd)
    const files = repo && !repo.notGit ? changes(repo) : []
    const recent = said.filter((m) => m !== goal && m !== last).slice(-6)
    const steps = a.log.filter((m) => m.role === 'tool').slice(-4).map((m) => `${m.tool}${m.hint ? ` ${clipTo(m.hint, 50)}` : ''}`)
    const out = [a.chief
      ? `[Bridge AI handover from ${from}]\nYou're taking over as the user's chief of staff from ${from}, which ran in this folder until now. Your instructions, playbook, ledger and task list are in this folder as usual: read them first and carry on as they say. You can't see the earlier conversation; this sums up its recent part.`
      : `[Bridge AI handover from ${from}]\nYou're taking over from ${from}, another coding agent, which was working in this folder until now. The user moved the work to you with Bridge AI. You can't see that conversation; this sums it up, from its transcript and the folder's git state. Pick up where it stopped rather than starting over, and where this and the files disagree, trust the files.`]
    if (!a.chief) out.push(`Folder: ${tilde(a.cwd)}\n${a.worktree ? `Git: on its own branch ${a.worktree.branch} (from ${a.worktree.base}), in a worktree of ${tilde(a.worktree.repo)}. Stay on this branch.` : repo && !repo.notGit ? `Git: branch ${repo.branch}` : 'Not a git repository.'}`)
    if (goal) out.push(`## The goal\nIn the user's first message:\n${quoted(clipTo(goal.text, 1000))}\n(If later messages changed it, the conversation below says so.)`)
    if (files.length) out.push(`## Changes so far\ngit status --porcelain:\n${porcelain(files)}`)
    if (own) out.push(`## ${from}'s own handover (written just now, at the user's request)\n${own}`)
    else {
      if (recent.length) out.push(`## Recent conversation (oldest first)\n${recent.map((m) => `${m.role === 'user' ? 'User' : from}: ${clipTo(m.text, m.role === 'user' ? 600 : 900)}`).join('\n')}${steps.length ? `\n  (${steps.join(' · ')})` : ''}`)
      if (last) out.push(`## Where it stopped\n${last.role === 'assistant' ? 'Its last reply' : "The user's last message, which it hadn't finished answering"}:\n${quoted(clipTo(last.text, 1500))}`)
    }
    if (a.question) out.push(`It was waiting on the user to answer: ${a.question.text}`)
    const n = String(note || '').trim()
    out.push(a.chief ? `## Next\n${n ? `Read your instructions and state files, then answer the user's next message:\n${n}` : "Read your instructions and state files, then tell the user in a line that you've taken over as chief of staff, and wait for their next request."}`
      : `## Next\n${n ? `Check the files above first. Then, from the user:\n${n}` : "Check the files above first. Then tell the user in a few lines where things stand and what you'd do next, and wait for their reply before changing anything."}`)
    const text = out.join('\n\n')
    return { text, chars: text.length, parts: { goal: !!goal, messages: own ? 0 : recent.length, files: files.length, branch: a.worktree?.branch || (repo && !repo.notGit ? repo.branch : null), todo: 0, queued: 0, screen: false, own: !!own, compacted: false }, from, to: null }
  }
  on('GET', '/agents/:pane/handoff', ({ p, query }) => {
    const a = agent(p.pane)
    if (query.get('lite') === '1') return { handedFrom: handed.get(a.paneId) || null }
    const groups = F.groups(S.accts)
    const busy = a.status === 'working' ? 'working' : a.status === 'blocked' || a.question ? 'blocked' : null
    const s = asks.get(a.paneId)
    return {
      from: { kind: a.kind, label: kindLabel(a.kind), chief: a.chief, resumable: true, chat: !!F.CAPS[a.kind]?.chat },
      busy, tabMates: false, canAsk: !!F.CAPS[a.kind]?.chat && !busy, handedFrom: handed.get(a.paneId) || null,
      asked: s ? { to: s.to, state: s.state, at: s.at, error: null } : null,
      targets: Object.keys(F.CAPS).filter((k) => k !== a.kind).map((kind) => {
        const g = groups.find((x) => x.kind === kind)
        return {
          kind, label: kindLabel(kind), signedIn: true, hint: null, chat: !!F.CAPS[kind].chat, resumable: kind === 'claude' || kind === 'codex',
          accounts: g && g.accounts.length > 1 ? g.accounts.map((x) => ({ id: x.id, label: x.label, named: x.named, signedIn: true, active: x.active, isDefault: !!x.isDefault })) : null,
          setting: g?.setting || null, modelFlag: kind !== 'gemini', models: F.MODELS[kind] || [],
        }
      }),
    }
  })
  on('GET', '/agents/:pane/handoff/preview', ({ p, query }) => {
    const a = agent(p.pane)
    const s = asks.get(a.paneId)
    return handover(a, { note: query.get('note') || '', own: query.get('summary') === '1' && s?.state === 'ready' && s.to === query.get('to') ? s.text : null })
  })
  on('POST', '/agents/:pane/handoff/ask', ({ p, body }) => {
    const a = agent(p.pane)
    const to = String(body?.to || '')
    if (a.status === 'working' || a.question) fail(`${kindLabel(a.kind)} is busy. Ask once it's done.`)
    const s = { to, state: 'asking', at: iso(), text: null }
    asks.set(a.paneId, s)
    push(a, { role: 'user', text: `${ASK} The user is handing this work over to ${kindLabel(to)}, another coding agent, which can't see this conversation. Write the handover it will start from.` })
    const goal = a.log.find((m) => m.role === 'user' && !m.text.startsWith(ASK))
    const repo = repoOf(a.cwd)
    const files = repo && !repo.notGit ? changes(repo) : []
    const summary = `Goal: ${clipTo(goal?.text || 'see the conversation', 200)}\nDone: ${files.length ? `changes in ${files.map((f) => f.path).join(', ')}` : 'nothing changed in the folder yet'}.\nLeft: ${a.chief ? 'the open hand-offs in the ledger' : 'finish the change and run the tests'}.\nWatch out: nothing is committed yet.`
    play(a, [{ doing: 'Writing the handover', wait: 1800 }, { say: summary }], { then: () => { s.state = 'ready'; s.text = summary } })
    return { ok: true, state: 'asking' }
  })
  on('POST', '/agents/:pane/handoff', ({ p, body }) => {
    const a = agent(p.pane)
    const to = String(body?.to || '')
    const from = kindLabel(a.kind)
    if (!F.CAPS[to] || to === a.kind) fail('Pick another agent to hand off to')
    const keep = !!body?.keep && !a.chief
    if (!keep && a.status === 'working') fail(`${from} is working. Hand off once it's done (or press Stop), or keep it open too.`)
    if (!keep && (a.status === 'blocked' || a.question)) fail(`${from} is waiting on you. Answer it first, or keep it open too.`)
    const s = asks.get(a.paneId)
    if (body?.summary && s?.state !== 'ready') fail(`${from}'s handover isn't in yet`)
    const { text } = handover(a, { note: body?.note, own: body?.summary ? s.text : null })
    const base = a.chief ? 'Chief of Staff' : String(tabOf(a.tabId)?.label || kindLabel(to)).replace(/\s*\((Claude Code|Codex|Gemini CLI|OpenCode)\)$/, '')
    const t = addTab(a.workspaceId, keep ? `${base} (${kindLabel(to)})` : base)
    S.tabs = S.tabs.filter((x) => x !== t)
    S.tabs.splice(S.tabs.findIndex((x) => x.tabId === a.tabId) + 1, 0, t) // right after it, then in its place
    const b = addAgent({ paneId: `${a.workspaceId}:p${++S.next}`, tabId: t.tabId, workspaceId: a.workspaceId, kind: to, cwd: a.cwd, worktree: a.worktree, chief: a.chief, account: body?.account && body.account !== 'auto' ? body.account : null }, { replay: false })
    if (body?.model && body.model !== 'default') { b.model = F.MODEL_IDS[body.model] || body.model; b.picked = body.model }
    push(b, { role: 'event', status: 'completed', text: `Handed over from ${from}`, summary: text })
    handed.set(b.paneId, { from: a.kind, label: from, at: iso() })
    if (a.chief) S.cfg.chief = { ...(S.cfg.chief || {}), kind: to }
    asks.delete(a.paneId)
    if (!keep) closeTab(a.tabId)
    const repo = repoOf(a.cwd)
    const files = repo && !repo.notGit ? changes(repo) : []
    const note = String(body?.note || '').trim()
    setTimeout(() => play(b, a.chief
      ? [{ doing: 'Reading', wait: 900 }, { tool: 'Read', hint: 'state/ledger.md' }, { say: note ? `I've taken over as chief of staff, on ${kindLabel(to)}. On it: ${note}` : `I've taken over as chief of staff, on ${kindLabel(to)}. I've read the playbook, the ledger and the task list. What's next?` }]
      : [{ doing: 'Reading the handover', wait: 1200 }, { run: 'git status --short', out: porcelain(files) || '(clean)' },
        { say: `Picked up from ${from}. ${files.length ? `So far: changes in ${files.slice(0, 3).map((f) => `\`${f.path}\``).join(', ')}${files.length > 3 ? ' and more' : ''}, not committed.` : 'Nothing has changed in the folder yet.'} ${note ? `Next, as you asked: ${note}` : 'Tell me when to carry on, or what to change first.'}` }]), 700)
    bump()
    return { paneId: b.paneId, closed: !keep, archived: !keep, chars: text.length }
  })
  on('POST', '/agents/:pane/mute', ({ p, body }) => { agent(p.pane).muted = !!body?.muted; bump(); return { ok: true, muted: !!body?.muted } })
  on('POST', '/agents/:pane/focus', () => ok)
  on('POST', '/tabs/:tab/focus', () => ok)
  on('POST', '/panes/:pane/terminal', () => needs('Opening your terminal app'))

  // Files and changes
  const cwdOf = (pane) => (S.agents.get(pane) || S.shells.get(pane) || S.shells.get(tabPane(pane)) || fail(`No pane ${pane}`, 404)).cwd
  on('GET', '/agents/:pane/files', ({ p, query }) => listDir(cwdOf(p.pane), query.get('path') || ''))
  on('GET', '/agents/:pane/file', ({ p, query }) => readFile(cwdOf(p.pane), query.get('path') || ''))
  on('PUT', '/agents/:pane/file', ({ p, body }) => {
    const repo = repoOf(cwdOf(p.pane)) || fail('No such folder')
    repo.work[body.path] = String(body.text ?? '')
    bump()
    return { ok: true, mtime: Date.now(), size: repo.work[body.path].length }
  })
  on('GET', '/agents/:pane/find', ({ p, query }) => {
    const repo = repoOf(cwdOf(p.pane))
    const q = (query.get('q') || '').toLowerCase()
    return { files: repo ? Object.keys(repo.work).filter((f) => repo.work[f] != null && f.toLowerCase().includes(q)).slice(0, 60) : [] }
  })
  on('POST', '/agents/:pane/fileop', ({ p, body }) => {
    const repo = repoOf(cwdOf(p.pane)) || fail('No such folder')
    const { op, path, name } = body || {}
    const dir = path?.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
    if (op === 'duplicate') { const to = path.replace(/(\.[^./]+)?$/, ' copy$1'); repo.work[to] = repo.work[path]; bump(); return { path: to } }
    if (op === 'rename') { const to = dir ? `${dir}/${name}` : name; repo.work[to] = repo.work[path]; repo.work[path] = null; bump(); return { path: to } }
    if (op === 'create' || op === 'newFile' || op === 'file') { const to = path ? `${path}/${name}` : name; repo.work[to] = ''; bump(); return { path: to } }
    if (op === 'trash') { for (const f of Object.keys(repo.work)) if (f === path || f.startsWith(`${path}/`)) repo.work[f] = null; bump(); return ok }
    needs('That')
  })
  on('GET', '/agents/:pane/git', ({ p }) => git(cwdOf(p.pane)))
  on('GET', '/agents/:pane/diff', ({ p, query }) => {
    const repo = repoOf(cwdOf(p.pane)) || fail('Not a git repository')
    const path = query.get('path') || ''
    return gitDiff(path, repo.head[path] ?? null, repo.work[path] ?? null)
  })
  on('POST', '/agents/:pane/discard', ({ p, body }) => {
    const repo = repoOf(cwdOf(p.pane)) || fail('Not a git repository')
    if (body?.hunk != null) repo.work[body.path] = undoHunk(repo.head[body.path] ?? null, repo.work[body.path] ?? '', Number(body.hunk))
    else if (repo.head[body.path] == null) delete repo.work[body.path]
    else repo.work[body.path] = repo.head[body.path]
    bump()
    return ok
  })
  on('POST', '/agents/:pane/commit', ({ p, body }) => {
    const repo = repoOf(cwdOf(p.pane)) || fail('Not a git repository')
    const message = String(body?.message || '').trim() || fail('Write a commit message first')
    const paths = body?.paths || changes(repo).map((f) => f.path)
    for (const f of paths) { if (repo.work[f] == null) delete repo.head[f]; else repo.head[f] = repo.work[f] }
    const hash = Math.random().toString(16).slice(2, 9)
    repo.lastCommit = { hash, subject: message.split('\n')[0], when: 'just now' }
    repo.ahead++
    bump()
    return { ok: true, hash, output: `[${repo.branch} ${hash}] ${message.split('\n')[0]}` }
  })
  on('POST', '/agents/:pane/push', ({ p }) => {
    const repo = repoOf(cwdOf(p.pane)) || fail('Not a git repository')
    const upstream = !repo.upstream
    repo.upstream = repo.upstream || `origin/${repo.branch}`
    repo.ahead = 0
    bump()
    return { ok: true, branch: repo.branch, remote: 'origin', upstream, output: '' }
  })
  on('GET', '/agents/:pane/pr', ({ p }) => {
    const repo = repoOf(cwdOf(p.pane))
    return { github: true, gh: true, base: 'main', pr: repo?.pr || null }
  })
  on('POST', '/agents/:pane/pr/draft', async ({ p }) => {
    await sleep(1200)
    const a = S.agents.get(p.pane)
    const label = a ? tabOf(a.tabId)?.label : 'These changes'
    return { title: label, body: `${label}.\n\nMade by an agent in Bridge AI. Tests pass.`, base: 'main' }
  })
  on('POST', '/agents/:pane/pr', () => needs('Opening a pull request'))
  on('GET', '/agents/:pane/servers', ({ p }) => {
    const cwd = cwdOf(p.pane)
    const pkg = repoOf(cwd)?.work['package.json']
    return { servers: [], commands: pkg && /"dev"/.test(pkg) ? [{ label: 'npm run dev', command: 'npm run dev', detail: cwd.includes('docs') ? 'astro dev' : 'vite' }] : [] }
  })
  on('POST', '/agents/:pane/servers/start', () => needs('Running a dev server'))

  // Spaces and tabs
  on('POST', '/chief/launch', () => ({ paneId: [...S.agents.values()].find((a) => a.chief)?.paneId || needs('Starting the chief of staff'), existing: true }))
  on('POST', '/agents/launch', ({ body }) => {
    if (!F.CAPS[body?.kind || 'claude']) fail(`${F.LABELS[body?.kind] || body?.kind} isn't installed`)
    const a = launch(body || {})
    let alsoPaneId
    if (body?.alsoKind && body.alsoKind !== a.kind && F.CAPS[body.alsoKind] && body.prompt?.trim()) {
      alsoPaneId = launch({ ...body, kind: body.alsoKind, workspaceId: a.workspaceId, newSpace: null, label: `${body.label || 'agent'} (${F.LABELS[body.alsoKind]})` }).paneId
    }
    return { paneId: a.paneId, ...(alsoPaneId ? { alsoPaneId } : {}) }
  })
  on('POST', '/chats', ({ body }) => {
    let ws = S.spaces.find((w) => w.label === 'Chats')
    const a = launch({ kind: body?.kind || 'claude', cwd: '~', label: body?.title || 'Chat', prompt: body?.prompt, workspaceId: ws?.id, newSpace: 'Chats' })
    return { paneId: a.paneId }
  })
  on('POST', '/tabs/:tab/rename', ({ p, body }) => { const t = tabOf(p.tab); if (t && body?.label) t.label = String(body.label).slice(0, 60); bump(); return ok })
  on('POST', '/workspaces/:ws/rename', ({ p, body }) => { const w = spaceOf(p.ws); if (w && body?.label) w.label = String(body.label).slice(0, 60); bump(); return ok })
  on('POST', '/tabs/:tab/close', ({ p }) => { closeTab(p.tab); return { ok: true, worktrees: [] } })
  on('POST', '/workspaces/:ws/close', ({ p }) => { for (const t of S.tabs.filter((x) => x.workspaceId === p.ws)) closeTab(t.tabId); S.spaces = S.spaces.filter((w) => w.id !== p.ws); bump(); return { ok: true, worktrees: [] } })
  on('POST', '/workspaces', ({ body }) => { const w = { id: `w${++S.next}`, label: String(body?.label || 'New space').slice(0, 60) }; S.spaces.push(w); bump(); return { id: w.id } })
  on('POST', '/workspaces/:ws/move', ({ p, body }) => {
    const w = spaceOf(p.ws)
    S.spaces = S.spaces.filter((x) => x !== w)
    S.spaces.splice(Math.max(0, Math.min(S.spaces.length, Number(body?.index) || 0)), 0, w)
    bump()
    return ok
  })
  on('POST', '/tabs/:tab/move', ({ p, body }) => {
    const t = tabOf(p.tab) || fail('No such tab')
    if (body?.newSpace) { const w = { id: `w${++S.next}`, label: String(body.newSpace).slice(0, 60) }; S.spaces.push(w); body.workspaceId = w.id }
    if (body?.workspaceId && body.workspaceId !== t.workspaceId) {
      const from = t.workspaceId
      t.workspaceId = body.workspaceId
      for (const a of S.agents.values()) if (a.tabId === t.tabId) a.workspaceId = t.workspaceId
      for (const s of S.shells.values()) if (s.tabId === t.tabId) s.workspaceId = t.workspaceId
      if (!S.tabs.some((x) => x.workspaceId === from)) S.spaces = S.spaces.filter((w) => w.id !== from)
    }
    const rest = S.tabs.filter((x) => x !== t)
    const mine = rest.filter((x) => x.workspaceId === t.workspaceId)
    const anchor = mine[Math.max(0, Math.min(mine.length, Number(body?.index) || 0))]
    rest.splice(anchor ? rest.indexOf(anchor) : rest.length, 0, t)
    S.tabs = rest
    bump()
    return ok
  })

  // History
  on('GET', '/archive', () => ({ items: S.archive.map(({ log, ...x }) => x) }))
  on('DELETE', '/archive/:id', ({ p }) => { S.archive = S.archive.filter((x) => x.id !== p.id); return ok })
  on('GET', '/search', ({ query }) => {
    const q = (query.get('q') || '').trim().toLowerCase()
    if (q.length < 2) return { results: [] }
    const results = [...S.agents.values()].map((a) => {
      const hits = a.log.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.toLowerCase().includes(q)).slice(-3).map((m) => ({ role: m.role, text: m.text.slice(0, 300) }))
      return hits.length && { sessionId: a.sessionId, kind: a.kind, title: tabOf(a.tabId)?.label, cwd: tilde(a.cwd), fullCwd: a.cwd, last: a.log.at(-1)?.ts, hits, paneId: a.paneId, label: a.chief ? 'Chief of Staff' : tabOf(a.tabId)?.label, workspace: spaceOf(a.workspaceId)?.label }
    }).filter(Boolean)
    results.push(...cloud.search(q))
    return { results, total: results.length }
  })
  on('POST', '/sessions/resume', ({ body }) => {
    const x = S.archive.find((y) => y.sessionId === body?.sessionId) || fail("That conversation can't be resumed")
    const ws = S.spaces.find((w) => w.label === x.workspace)
    const a = launch({ kind: x.kind, cwd: x.fullCwd, label: x.label, workspaceId: ws?.id, newSpace: ws ? null : x.workspace || 'Resumed' })
    a.log = x.log || [{ id: `${uid()}:0`, role: 'assistant', text: x.preview, ts: x.closedAt }]
    S.archive = S.archive.filter((y) => y !== x)
    bump()
    return { paneId: a.paneId }
  })

  // Saved prompts
  on('GET', '/prompts', () => ({ prompts: S.prompts }))
  on('POST', '/prompts', ({ body }) => { const x = { id: uid(), name: String(body?.name || 'Prompt'), text: String(body?.text || ''), used: 0, createdAt: iso() }; S.prompts.unshift(x); return x })
  on('PATCH', '/prompts/:id', ({ p, body }) => { const x = S.prompts.find((y) => y.id === p.id); if (x) Object.assign(x, body); return x || ok })
  on('POST', '/prompts/:id/used', ({ p }) => { const x = S.prompts.find((y) => y.id === p.id); if (x) x.used++; return ok })
  on('DELETE', '/prompts/:id', ({ p }) => { S.prompts = S.prompts.filter((y) => y.id !== p.id); return ok })

  // Today
  on('GET', '/brief', ({ query }) => brief(query.get('primary') || 'claude'))
  on('GET', '/quota', () => F.quota(S.accts))
  on('POST', '/quota/allow/:id', () => F.quota(S.accts))
  on('GET', '/usage/:provider/stats', ({ p }) => F.usageStats(p.provider))
  on('GET', '/usage/:provider', ({ p }) => (p.provider === 'claude' || p.provider === 'codex' ? F.usage(p.provider) : { supported: false }))
  on('GET', '/weather', () => F.weather())
  on('GET', '/calendar', () => F.calendar())
  on('GET', '/calendar/range', ({ query }) => F.calendarRange(query.get('from'), query.get('to')))
  on('POST', '/calendar/prep', () => needs('Preparing for a meeting with your real calendar'))
  on('GET', '/mail', () => F.mail())
  on('GET', '/mail/message/:id', ({ p }) => F.mailMessage(p.id))
  on('POST', '/mail/rules', () => ok)
  on('POST', '/mail/triage', () => needs('Mail triage'))
  on('POST', '/mail/:id/agent', () => needs('Working on your mail'))
  for (const feed of ['/market', '/macro', '/news', '/mortgage', '/market/history', '/market/news', '/market/search']) on('GET', feed, () => needs('Markets and news', 'need'))
  on('POST', '/market/watchlist', () => needs('Markets and news', 'need'))
  on('GET', '/routines', () => ({ routines: S.routines, week: 43, fetchedAt: iso() }))
  on('POST', '/routines', ({ body }) => { const r = { id: uid(), name: body?.name, command: body?.command, cwd: body?.cwd || '~/', every: body?.every || 'week', workspace: body?.workspace || '', state: 'never', note: null, last: null, lastLaunch: null, link: null }; S.routines.push(r); return r })
  on('PATCH', '/routines/:id', ({ p, body }) => { const r = S.routines.find((x) => x.id === p.id); if (r) Object.assign(r, body); return r || ok })
  on('DELETE', '/routines/:id', ({ p }) => { S.routines = S.routines.filter((x) => x.id !== p.id); return ok })
  on('POST', '/routines/:id/done', ({ p }) => { const r = S.routines.find((x) => x.id === p.id); if (r) Object.assign(r, { state: 'ok', note: null, last: { at: iso(), source: 'you' } }); return ok })
  on('POST', '/routines/:id/run', ({ p }) => {
    const r = S.routines.find((x) => x.id === p.id) || fail('No such routine')
    const ws = S.spaces.find((w) => w.label === r.workspace)
    const a = launch({ kind: 'claude', cwd: r.cwd, label: r.name, prompt: r.command, workspaceId: ws?.id, newSpace: r.workspace || r.name })
    Object.assign(r, { state: 'ok', note: null, lastLaunch: { at: iso(), paneId: a.paneId } })
    return { paneId: a.paneId }
  })
  on('POST', '/insights/run', () => needs('Writing insights'))
  on('GET', '/insights', () => demoInsights())
  on('POST', '/chief/threads', () => needs('Starting a thread with the chief of staff'))
  on('GET', '/chief/tasks', () => ({ items: chiefTasks(), file: `${CHIEF_DIR}/state/tasks.md`, dir: CHIEF_DIR }))
  on('POST', '/chief/tasks', ({ body }) => {
    const title = String(body?.title || '').replace(/\s+/g, ' ').trim().slice(0, 200) || fail('Say what the task is')
    const item = { id: String(Math.max(0, ...S.chiefTasks.map((x) => Number(x.id))) + 1), title, status: body?.status === 'doing' ? 'doing' : 'open', added: new Date().toLocaleDateString('en-CA'), from: body?.send ? 'you' : null }
    S.chiefTasks.push(item)
    if (!body?.send) return { item }
    const chief = [...S.agents.values()].find((a) => a.chief)
    if (!chief || chief.question) return { item, sent: false }
    const queued = chief.status === 'working'
    prompt(chief, `Task ${item.id} from my Tasks panel: ${item.title}`)
    return { item, sent: true, queued }
  })
  on('PATCH', '/chief/tasks/:id', ({ p, body }) => ({ item: setTask(p.id, Object.fromEntries(['status', 'outcome', 'link', 'needs', 'title'].filter((k) => body?.[k] !== undefined).map((k) => [k, body[k]]))) }))
  on('GET', '/ideas', () => ({ items: S.ideas, file: '~/.bridge-ai/ideas.md' }))
  on('POST', '/ideas', ({ body }) => {
    const raw = String(body?.text || '').trim() || fail('Write the idea first')
    const it = { id: uid(), raw, text: raw.replace(/#\w+/g, '').trim(), tags: [...raw.matchAll(/#(\w+)/g)].map((m) => m[1]), done: false, sent: null }
    S.ideas.unshift(it)
    return it
  })
  on('PATCH', '/ideas/:id', ({ p, body }) => {
    const it = S.ideas.find((x) => x.id === p.id) || fail('No such idea')
    if (body?.text != null) Object.assign(it, { raw: body.text, text: body.text.replace(/#\w+/g, '').trim(), tags: [...body.text.matchAll(/#(\w+)/g)].map((m) => m[1]) })
    if (body?.done != null) it.done = !!body.done
    return it
  })
  on('DELETE', '/ideas/:id', ({ p }) => { S.ideas = S.ideas.filter((x) => x.id !== p.id); return ok })
  on('POST', '/ideas/:id/send', ({ p }) => {
    const it = S.ideas.find((x) => x.id === p.id) || fail('No such idea')
    const chief = [...S.agents.values()].find((a) => a.chief)
    if (chief && !chief.question) prompt(chief, `Plan this idea and check with me before starting: ${it.text}`)
    it.sent = iso().slice(0, 10)
    return ok
  })

  // Your other devices. This one (MacBook Pro) is a new install; the Studio Mac (?m=studio) is the
  // busy day; the Linux workstation and the Windows PC are offline. Each one's agents, for the
  // sidebar and the switcher, are the ones its own page shows.
  const KIND = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'OpenCode' }
  const summaryOf = (tabs) => {
    const agents = AGENTS.filter((d) => !tabs || tabs.includes(d.tabId)).map((d) => ({ paneId: d.paneId, title: d.chief ? 'Chief of Staff' : d.tab, status: d.status, kind: d.kind, kindLabel: KIND[d.kind] || d.kind, chief: !!d.chief }))
    return { counts: agents.reduce((c, a) => ({ ...c, [a.status]: (c[a.status] || 0) + 1 }), {}), agents }
  }
  const machine = (id, name, os, ago, tabs) => ({
    id, name, os, version, relay: `https://bridge-${id}.example.workers.dev`, state: 'linked', online: tabs !== null, lastSeen: iso(Date.now() - ago), addedAt: iso(Date.now() - 9 * 864e5), code: null, error: null,
    ...(tabs === null ? { counts: null, agents: [] } : summaryOf(tabs)),
  })
  const MACHINES = [machine('studio', 'Studio Mac', 'mac', 6e4, undefined), machine('linux', 'Linux workstation', 'linux', 20 * 6e4, null), machine('win', 'Windows PC', 'windows', 3 * 36e5, null)]
  const HERE = { name: 'MacBook Pro', os: 'mac', version, relay: 'https://bridge-macbook.example.workers.dev' }
  on('GET', '/machines', () => ({ here: HERE, machines: MACHINES, asks: [], canBeLinked: true }))
  on('GET', '/machines/summary', () => ({ ...HERE, ...summaryOf(FRESH.tabs) }))
  on('POST', '/machines', () => needs('Linking a device'))
  on('POST', '/machines/ask', () => needs('Linking a device'))
  on('POST', '/machines/invite', () => needs('A link for another device'))
  on('DELETE', '/machines/:id', () => needs('Unlinking a device'))

  // Accounts, settings and the rest
  on('GET', '/accounts', () => F.groups(S.accts))
  on('POST', '/accounts', () => needs('Adding an account'))
  on('PATCH', '/accounts/:id', ({ p, body }) => {
    for (const g of Object.values(S.accts)) {
      for (const a of g.accounts) {
        if (a.id !== p.id) continue
        const name = String(body?.label || '').trim().slice(0, 40)
        if (a.isDefault) Object.assign(a, name ? { label: name, named: true } : { label: 'Your usual login', named: false })
        else if (name) a.label = name
      }
    }
    bump()
    return ok
  })
  on('DELETE', '/accounts/:id', () => needs('Removing an account'))
  on('POST', '/accounts/:id/login', () => needs('Signing in'))
  on('POST', '/accounts/:id/logout', () => needs('Signing out'))
  on('POST', '/accounts/show/:kind', () => ok)
  on('POST', '/accounts/active/:kind', ({ p, body }) => { const g = S.accts[p.kind] || fail('No such agent'); g.setting = String(body?.id || 'auto'); bump(); return ok })
  on('GET', '/subscriptions', () => F.subscriptions())
  on('GET', '/providers', () => F.providers())
  on('PUT', '/providers/:id', () => needs('Saving a key'))
  on('DELETE', '/providers/:id', () => needs('Removing a key'))
  on('POST', '/providers/:id/test', () => needs('Testing a key'))
  on('GET', '/consult', () => F.consult())
  on('GET', '/mcp', () => F.mcp())
  on('POST', '/mcp', () => needs('Adding an MCP server'))
  on('DELETE', '/mcp/:name', () => needs('Removing an MCP server'))
  on('GET', '/settings', () => F.settingsView(S.cfg))
  on('PATCH', '/settings', ({ body }) => {
    const changed = Object.keys(body || {})
    Object.assign(S.cfg, body)
    return { ok: true, changed, restart: [], settings: F.settingsView(S.cfg) }
  })
  on('PUT', '/settings/raw', ({ body }) => {
    let next
    try { next = JSON.parse(String(body?.text || '')) } catch (e) { fail(`That isn't valid JSON: ${e.message}`) }
    S.cfg = next
    return { ok: true, changed: Object.keys(next), restart: [], settings: F.settingsView(S.cfg) }
  })
  on('GET', '/settings/geocode', () => needs('Looking up places'))
  on('GET', '/herdr/sessions', () => ({ installed: false, sessions: [] }))
  on('GET', '/terminals', () => ({ found: [{ id: 'terminal', name: 'Terminal' }, { id: 'ghostty', name: 'Ghostty' }], app: 'auto' }))
  on('POST', '/setup/install/:kind', () => needs('Installing an agent'))
  on('GET', '/setup', () => ({ done: true, runtime: 'builtin', platform: 'darwin', dataDir: '~/.bridge-ai', suggested: {}, agents: F.catalog(), usable: F.catalog().filter((a) => a.installed), mail: true, calendar: true }))
  on('POST', '/setup', () => ok)
  on('GET', '/voice', () => ({ ready: true, engine: 'local', standIn: null, needs: null, model: F.speechModels()[0], apple: { available: false }, fellBack: null, modelMB: 670, missing: [], installCommand: null, downloading: null, error: null }))
  on('POST', '/voice/setup', () => needs('Voice notes', 'need'))
  on('POST', '/transcribe', () => needs('Voice notes', 'need'))
  on('POST', '/upload', () => needs('Attaching files'))
  on('GET', '/push/key', () => needs('Notifications', 'need'))
  on('GET', '/push/devices', () => [])
  on('POST', '/push/subscribe', () => needs('Notifications', 'need'))
  on('POST', '/push/unsubscribe', () => ok)
  on('POST', '/push/test', () => needs('Notifications', 'need'))
  on('POST', '/presence', () => ok)
  on('GET', '/phone', () => ({ installed: false, state: null, running: false, name: null }))
  on('POST', '/phone', () => needs('Phone access'))
  on('GET', '/relay', () => ({ configured: false, computer: 'Studio Mac', url: null, online: false, error: null, busy: null, loginUrl: null, method: null, account: null, needsUpdate: false, devices: [], pairing: null, awake: false, canAwake: false, here: null }))
  for (const what of ['deploy', 'update', 'pair', 'awake', 'forget']) on('POST', `/relay/${what}`, () => needs('Pairing a phone'))
  on('DELETE', '/relay/devices/:id', () => needs('Pairing a phone'))
  on('GET', '/updates', () => ({ current: version, latest: version, available: false, url: 'https://github.com/sahil1/bridge/releases', notes: '', checkedAt: iso(), error: null, how: null, command: null }))
  on('POST', '/updates/install', () => needs('Updating'))
  on('GET', '/diagnostics', () => ({ bridgeAi: version, install: 'the demo, in your browser', system: navigator.platform || 'browser', runtime: 'demo', agents: Object.keys(F.CAPS), phone: 'not set up', pushDevices: 0, setupDone: true, uptimeMinutes: Math.round(performance.now() / 6e4) }))

  // ---------- The plain terminal tab ----------
  function shellType(pane, steps) {
    const s = S.shells.get(pane) || S.shells.get(tabPane(pane))
    if (!s) return
    for (const st of steps) {
      if (st.text != null) s.draft += st.text
      for (const k of st.keys || []) shellKey(s, k)
    }
    bump()
  }
  const shellKeys = (pane, keys) => shellType(pane, [{ keys }])
  function shellKey(s, k) {
    if (k === 'enter') { s.lines.push('', s.draft ? `  ${s.draft}: this terminal is part of the demo. Bridge AI on your computer runs real ones.` : ''); s.draft = '' } else if (k === 'backspace') s.draft = s.draft.slice(0, -1)
    else if (k === 'ctrl+c' || k === 'esc') s.draft = ''
    else if (k === 'space') s.draft += ' '
    else if (k.length === 1) s.draft += k
  }

  // ---------- Start ----------
  // A new install's chief only started the one agent, a few minutes ago.
  const fresh = (def) => (all || !def ? def : def.chief ? { ...def, script: FRESH.chief } : { ...def, script: def.script.map((st) => (st.at > 5 ? { at: FRESH.since } : st)) })
  for (const id of TAB_ORDER.filter((t) => all || FRESH.tabs.includes(t))) {
    const def = fresh(AGENTS.find((x) => x.tabId === id))
    const sh = SHELLS.find((x) => x.tabId === id)
    const d = def || sh
    S.tabs.push({ tabId: id, workspaceId: d.workspaceId, label: d.tab })
    if (def) addAgent(def)
    if (sh) S.shells.set(sh.paneId, { ...sh, lines: [`  ${new Date().toLocaleTimeString()} [vite] page reload src/pages/Orders.tsx`], draft: '' })
  }
  // What the agents still have to do plays out while you watch.
  cloud.start()
  setTimeout(() => {
    const chief = [...S.agents.values()].find((a) => a.chief)
    for (const def of AGENTS) {
      if (!def.next || !S.agents.has(def.paneId)) continue
      const a = S.agents.get(def.paneId)
      a.chain = Promise.resolve()
      a.reportTo = chief?.paneId || null
      play(a, def.next)
    }
  }, 1500)

  return {
    async request({ method, path, query, body }) {
      const route = path.replace(/\/$/, '') || '/'
      const fromCloud = await cloudReq(method, route, query, body)
      if (fromCloud !== NOT_CLOUD) return fromCloud
      for (const [m, re, fn] of routes) {
        if (m !== method) continue
        const hit = re.exec(route)
        if (!hit) continue
        const p = Object.fromEntries(Object.entries(hit.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]))
        return fn({ p, query, body })
      }
      if (method === 'GET') fail(`Not in the demo: ${route}`, 404)
      return needs('That')
    },
    stream(path, send) {
      const route = path.split('?')[0]
      if (route === '/events') {
        subs.fleet.add(send)
        send(fleet(), 'fleet')
        return () => subs.fleet.delete(send)
      }
      const m = /^\/agents\/([^/]+)\/transcript\/live$/.exec(route)
      if (m) {
        const pane = decodeURIComponent(m[1])
        const a = S.agents.get(pane)
        if (!a) return null
        const sub = { send, last: JSON.stringify(transcript(a)) }
        send(sub.last)
        const set = subs.transcript.get(pane) || subs.transcript.set(pane, new Set()).get(pane)
        set.add(sub)
        return () => set.delete(sub)
      }
      return null
    },
    microphone() { needs('Voice notes', 'need') },
  }
}
