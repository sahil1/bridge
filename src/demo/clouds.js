// Made-up Cursor, GitHub (Copilot), Jules and Claude APIs that answer in the shapes their docs
// give, so cloud agents run on the real adapters (shared/cloud) with nothing leaving the page: the
// demo's cloud agents, and the stand-in providers for testing the phone apps' Cloud agents.
// Time moves each task along its plan: it works for a while, then finishes, asks or fails. Plain
// JS (no browser or Node APIs), so a test server can serve it too.
//
//   createClouds({ pace }) -> { handle(provider, req), fetch(url, init), seed() }
//     handle: req { method, path, query (URLSearchParams), headers, body } -> { status, body, headers }
//     fetch: the same, by host (api.cursor.com, api.github.com, ...), as a Response
//     seed(): the demo's four agents, one per provider, as followed records
//   A key with "bad" in it is refused, as a wrong key would be.
const SEC = 1000
export const HOSTS = { 'api.cursor.com': 'cursor', 'api.github.com': 'copilot', 'jules.googleapis.com': 'jules', 'api.anthropic.com': 'claude' }

const REPOS = [
  { name: 'acme/shop', branches: ['main', 'develop', 'checkout-v2'], private: true },
  { name: 'acme/billing-api', branches: ['main', 'release'], private: true },
  { name: 'acme/docs-site', branches: ['main'], private: false },
]
const ME = 'sam-rivera'
const slug = (s) => String(s || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'task'
const first = (s) => String(s || '').split('\n')[0].replace(/[.!]+$/, '').trim()
const lower = (s) => { const t = first(s); return t ? t[0].toLowerCase() + t.slice(1) : 'the task' }

// What a finished task says, for tasks started on the spot (seeded ones have their own words).
const reply = (prompt, extra = '') => `Done: ${lower(prompt)}. I changed 3 files and added tests for the new paths; the suite passes (148 tests).${extra}`

export function createClouds({ pace = 1 } = {}) {
  const S = (s) => Math.round((s * SEC) / pace)
  let n = 1000
  const uid = (p) => `${p}${(++n).toString(36)}${Math.random().toString(36).slice(2, 7)}`
  const iso = (ms) => new Date(ms).toISOString()
  const now = () => Date.now()
  // Each task's plan: steps that happen at their time, the next time anyone asks.
  const run = (x) => { while (x.plan.length && x.plan[0].at <= now()) { const st = x.plan.shift(); st.fn(st.at) } }
  const later = (x, at, fn) => { x.plan.push({ at, fn }); x.plan.sort((a, b) => a.at - b.at) }
  const fail = (status, message, extra = {}) => { throw Object.assign(new Error(message), { status, extra }) }

  // ---------- Cursor (Cloud Agents API v1) ----------
  const cursor = (() => {
    const agents = new Map()
    const runOf = (a, r) => ({
      id: r.id, agentId: a.id, status: r.status, createdAt: iso(r.at), updatedAt: iso(r.updated),
      ...(r.result ? { result: r.result } : {}),
      ...(r.pr ? { git: { branches: [{ repoUrl: `github.com/${a.repo}`, branch: r.branch, prUrl: r.pr }] } } : {}),
    })
    const view = (a) => {
      run(a)
      const last = a.runs.at(-1)
      return { id: a.id, name: a.name, status: 'ACTIVE', url: `https://cursor.com/agents?id=${a.id}`, createdAt: iso(a.at), updatedAt: iso(last?.updated || a.at), latestRunId: last?.id || null, repos: [{ url: `https://github.com/${a.repo}`, startingRef: a.base }] }
    }
    const working = (r) => r.status === 'CREATING' || r.status === 'RUNNING'
    function start(a, text, { at = now(), work = 24, result, ok = true } = {}) {
      const r = { id: uid('run-'), prompt: text, status: 'CREATING', at, updated: at, result: null, branch: a.branch, pr: null }
      a.runs.push(r)
      later(a, at + S(2), (t) => { if (r.status === 'CREATING') { r.status = 'RUNNING'; r.updated = t } })
      later(a, at + S(work), (t) => {
        if (!working(r)) return
        r.status = ok ? 'FINISHED' : 'ERROR'
        r.updated = t
        r.result = ok ? result || reply(text) : null
        if (ok) r.pr = a.pr || (a.pr = `https://github.com/${a.repo}/pull/${200 + (n % 50)}`)
      })
      return r
    }
    function create({ repo, base = 'main', text, name, at, work, result }) {
      const a = { id: uid('bc-'), name: name || first(text).slice(0, 60), repo, base, branch: `cursor/${slug(text)}`, at: at ?? now(), runs: [], plan: [], pr: null }
      agents.set(a.id, a)
      const r = start(a, text, { at: a.at, work, result })
      return { a, r }
    }
    const need = (id) => agents.get(id) || fail(404, 'Agent not found')
    return {
      create, agents,
      handle({ method: m, path, body }) {
        let p
        if (m === 'GET' && path === '/v1/me') return { apiKeyName: 'Bridge AI', userEmail: 'sam@example.com', userFirstName: 'Sam', userLastName: 'Rivera' }
        if (m === 'GET' && path === '/v1/repositories') return { items: REPOS.map((r) => ({ url: `https://github.com/${r.name}` })) }
        if (m === 'GET' && path === '/v1/models') return { items: [{ id: 'composer-1', displayName: 'Composer 1' }, { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' }, { id: 'gpt-5', displayName: 'GPT-5' }] }
        if (m === 'POST' && path === '/v1/agents') {
          const text = String(body?.prompt?.text || '').trim() || fail(400, 'prompt.text is required')
          const url = body?.repos?.[0]?.url || fail(400, 'repos is required')
          const repo = url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '')
          const { a, r } = create({ repo, base: body.repos[0].startingRef || 'main', text })
          return { agent: view(a), run: runOf(a, r) }
        }
        if (m === 'GET' && path === '/v1/agents') return { items: [...agents.values()].map(view).reverse() }
        if ((p = path.match(/^\/v1\/agents\/([^/]+)$/)) && m === 'GET') return view(need(decodeURIComponent(p[1])))
        if ((p = path.match(/^\/v1\/agents\/([^/]+)\/runs$/))) {
          const a = need(decodeURIComponent(p[1]))
          run(a)
          if (m === 'GET') return { items: a.runs.map((r) => runOf(a, r)).reverse() }
          if (m === 'POST') {
            if (a.runs.some(working)) fail(409, 'Agent is busy with a run', { code: 'agent_busy' })
            const text = String(body?.prompt?.text || '').trim() || fail(400, 'prompt.text is required')
            return { run: runOf(a, start(a, text, { work: 14 })) }
          }
        }
        if ((p = path.match(/^\/v1\/agents\/([^/]+)\/runs\/([^/]+)(\/cancel)?$/))) {
          const a = need(decodeURIComponent(p[1]))
          run(a)
          const r = a.runs.find((x) => x.id === decodeURIComponent(p[2])) || fail(404, 'Run not found')
          if (m === 'GET' && !p[3]) return runOf(a, r)
          if (m === 'POST' && p[3]) {
            if (!working(r)) fail(409, 'Run is not active', { code: 'run_not_active' })
            r.status = 'CANCELLED'
            r.updated = now()
            return { id: r.id, status: r.status }
          }
        }
        return fail(404, 'Not found')
      },
    }
  })()

  // ---------- GitHub (Copilot cloud agent, through issues and pull requests) ----------
  const github = (() => {
    const issues = new Map() // "owner/repo#n" -> issue
    const prs = new Map() // "owner/repo#n" -> pull request
    let num = 40
    const k = (repo, number) => `${repo}#${number}`
    const COPILOT = { login: 'Copilot', type: 'Bot' }
    const BOT = { login: 'copilot-swe-agent[bot]', type: 'Bot' }
    const human = { login: ME, type: 'User' }
    const ev = (x, e) => { x.events.push({ id: ++num * 7, ...e }); x.updated = Date.parse(e.created_at) }
    // Copilot works on its pull request, then asks you to review it.
    function work(issue, pr, at, { secs = 26, say } = {}) {
      later(issue, at + S(2), (t) => ev(pr, { event: 'copilot_work_started', created_at: iso(t), actor: COPILOT }))
      later(issue, at + S(secs), (t) => {
        if (say) ev(pr, { event: 'commented', created_at: iso(t), actor: COPILOT, user: COPILOT, body: say })
        ev(pr, { event: 'copilot_work_finished', created_at: iso(t), actor: COPILOT })
        ev(pr, { event: 'review_requested', created_at: iso(t), actor: COPILOT, review_requester: COPILOT, requested_reviewer: human })
      })
    }
    function create({ repo, base = 'main', text, title, at = now(), secs, body: prBody, say }) {
      const number = ++num
      const issue = { repo, number, title: title || first(text).slice(0, 100), body: text, at, updated: at, plan: [], events: [] }
      issues.set(k(repo, number), issue)
      const prNumber = ++num
      later(issue, at + S(5), (t) => {
        const pr = { repo, number: prNumber, title: `[WIP] ${issue.title}`, at: t, updated: t, draft: true, head: `copilot/${slug(issue.title)}`, base, body: prBody || `Working on #${number}: ${issue.title}\n\n- [x] Read the code around it\n- [ ] Make the change\n- [ ] Add tests`, events: [], issue }
        prs.set(k(repo, prNumber), pr)
        issue.pr = pr
        issue.events.push({ event: 'cross-referenced', created_at: iso(t), actor: COPILOT, source: { type: 'issue', issue: { number: prNumber, title: pr.title, pull_request: { url: `https://api.github.com/repos/${repo}/pulls/${prNumber}` }, user: COPILOT, repository: { full_name: repo } } } })
        work(issue, pr, t, { secs, say: say ?? `Done: ${lower(text)}. I made the change, added tests, and the checks pass. Ready for your review.` })
        later(issue, t + S(secs || 26), () => { pr.title = issue.title; pr.body = pr.body.replace(/- \[ \]/g, '- [x]') })
      })
      return issue
    }
    const issueView = (x) => ({ number: x.number, title: x.title, body: x.body, state: 'open', html_url: `https://github.com/${x.repo}/issues/${x.number}`, created_at: iso(x.at), updated_at: iso(x.updated), assignees: [BOT], user: human, repository_url: `https://api.github.com/repos/${x.repo}` })
    const prView = (p) => ({ number: p.number, title: p.title, body: p.body, state: 'open', draft: p.draft, merged: false, merged_at: null, html_url: `https://github.com/${p.repo}/pull/${p.number}`, created_at: iso(p.at), updated_at: iso(p.updated), head: { ref: p.head }, base: { ref: p.base }, user: COPILOT })
    const page = (list, query) => { const per = Number(query.get('per_page')) || 30; const pg = Number(query.get('page')) || 1; return list.slice((pg - 1) * per, pg * per) }
    return {
      create,
      handle({ method: m, path, query, body }) {
        for (const x of issues.values()) run(x)
        let p
        if (m === 'GET' && path === '/user') return { login: ME, id: 4242, type: 'User' }
        if (m === 'GET' && path === '/user/repos') return page(REPOS.map((r) => ({ full_name: r.name, html_url: `https://github.com/${r.name}`, default_branch: 'main', private: r.private, archived: false, permissions: { push: true } })), query)
        if (m === 'GET' && path === '/search/issues') return { total_count: issues.size, items: [...issues.values()].map(issueView).reverse() }
        if ((p = path.match(/^\/repos\/([\w.-]+\/[\w.-]+)\/branches$/)) && m === 'GET') return (REPOS.find((r) => r.name === p[1]) || fail(404, 'Not Found')).branches.map((name) => ({ name }))
        if ((p = path.match(/^\/repos\/([\w.-]+\/[\w.-]+)\/issues$/)) && m === 'POST') {
          if (!REPOS.some((r) => r.name === p[1])) fail(404, 'Not Found')
          const x = create({ repo: p[1], base: body?.agent_assignment?.base_branch || 'main', text: String(body?.body || ''), title: body?.title })
          return issueView(x)
        }
        if ((p = path.match(/^\/repos\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)(\/timeline|\/comments)?$/))) {
          const key = k(p[1], p[2])
          const issue = issues.get(key)
          const pr = prs.get(key)
          if (!issue && !pr) fail(404, 'Not Found')
          if (m === 'GET' && !p[3]) return issue ? issueView(issue) : { ...prView(pr), pull_request: {} }
          if (m === 'GET' && p[3] === '/timeline') return page((issue || pr).events, query)
          if (m === 'POST' && p[3] === '/comments') {
            const text = String(body?.body || '')
            const x = pr || issue
            const t = now()
            ev(x, { event: 'commented', created_at: iso(t), actor: human, user: human, body: text })
            if (pr && /@copilot\b/i.test(text)) work(pr.issue, pr, t, { secs: 16, say: `Done: ${lower(text.replace(/@copilot\s*/i, ''))}. Pushed to this branch.` })
            return { id: num, body: text, user: human, created_at: iso(t) }
          }
        }
        if ((p = path.match(/^\/repos\/([\w.-]+\/[\w.-]+)\/pulls\/(\d+)$/)) && m === 'GET') return prView(prs.get(k(p[1], p[2])) || fail(404, 'Not Found'))
        return fail(404, 'Not Found')
      },
    }
  })()

  // ---------- Jules (API v1alpha) ----------
  const jules = (() => {
    const sessions = new Map()
    const source = (r) => {
      const [owner, repo] = r.name.split('/')
      return { name: `sources/github/${r.name}`, id: `github/${r.name}`, githubRepo: { owner, repo, isPrivate: r.private, defaultBranch: { displayName: 'main' }, branches: r.branches.map((b) => ({ displayName: b })) } }
    }
    const act = (s, at, what) => { s.acts.push({ name: `sessions/${s.id}/activities/${uid('a')}`, id: uid('a'), createTime: iso(at), originator: what.userMessaged ? 'user' : 'agent', ...what }); s.updated = at }
    const go = (s, state, t) => { s.state = state; s.updated = t }
    // Jules works through its plan, then opens a pull request.
    function build(s, at, { secs = 22, say } = {}) {
      later(s, at, (t) => go(s, 'IN_PROGRESS', t))
      later(s, at + S(secs * 0.3), (t) => act(s, t, { progressUpdated: { title: 'Ran the tests', description: 'npm test: 3 failing before the change' } }))
      later(s, at + S(secs * 0.6), (t) => act(s, t, { progressUpdated: { title: 'Updated the code', description: 'Changed 2 files' } }))
      later(s, at + S(secs), (t) => {
        act(s, t, { agentMessaged: { agentMessage: say || `Done: ${lower(s.prompt)}. Tests pass; the pull request is up for review.` } })
        s.outputs = [{ pullRequest: { url: `https://github.com/${s.repo}/pull/${300 + (n % 40)}`, title: s.title, description: '', headRef: `jules/${slug(s.title)}` } }]
        act(s, t, { sessionCompleted: {} })
        go(s, 'COMPLETED', t)
      })
    }
    function create({ repo, base = 'main', text, title, plan = false, at = now(), steps, say, secs }) {
      const id = String(Math.floor(1e15 + Math.random() * 8e15))
      const s = { id, repo, base, prompt: text, title: title || first(text).slice(0, 80), state: 'QUEUED', at, updated: at, acts: [], plan: [], outputs: [], approval: plan, say, secs }
      sessions.set(id, s)
      later(s, at + S(2), (t) => go(s, 'PLANNING', t))
      later(s, at + S(6), (t) => {
        act(s, t, { planGenerated: { plan: { id: uid('p'), steps: (steps || ['Find where this lives in the code', 'Make the change', 'Add tests and run them']).map((title, index) => ({ id: uid('s'), index, title })) } } })
        if (s.approval) go(s, 'AWAITING_PLAN_APPROVAL', t)
        else { act(s, t, { planApproved: {} }); build(s, t, { say, secs }) }
      })
      return s
    }
    const view = (s) => {
      run(s)
      return { name: `sessions/${s.id}`, id: s.id, title: s.title, prompt: s.prompt, state: s.state, url: `https://jules.google.com/session/${s.id}`, createTime: iso(s.at), updateTime: iso(s.updated), sourceContext: { source: `sources/github/${s.repo}`, githubRepoContext: { startingBranch: s.base } }, ...(s.outputs.length ? { outputs: s.outputs } : {}) }
    }
    const need = (id) => sessions.get(id) || fail(404, 'Requested entity was not found.')
    return {
      create,
      handle({ method: m, path, query, body }) {
        let p
        if (m === 'GET' && path === '/v1alpha/sources') return { sources: REPOS.map(source).slice(0, Number(query.get('pageSize')) || 100) }
        if ((p = path.match(/^\/v1alpha\/sources\/github\/([\w.-]+\/[\w.-]+)$/)) && m === 'GET') return source(REPOS.find((r) => r.name === p[1]) || fail(404, 'Requested entity was not found.'))
        if (m === 'POST' && path === '/v1alpha/sessions') {
          const repo = String(body?.sourceContext?.source || '').replace(/^sources\/github\//, '')
          if (!REPOS.some((r) => r.name === repo)) fail(400, 'Unknown source')
          return view(create({ repo, base: body.sourceContext.githubRepoContext?.startingBranch || 'main', text: String(body.prompt || ''), plan: !!body.requirePlanApproval }))
        }
        if (m === 'GET' && path === '/v1alpha/sessions') return { sessions: [...sessions.values()].map(view).reverse() }
        if ((p = path.match(/^\/v1alpha\/sessions\/([^/:]+)$/)) && m === 'GET') return view(need(decodeURIComponent(p[1])))
        if ((p = path.match(/^\/v1alpha\/sessions\/([^/:]+)\/activities$/)) && m === 'GET') {
          const s = need(decodeURIComponent(p[1]))
          run(s)
          const from = query.get('createTime')
          return { activities: s.acts.filter((a) => !from || a.createTime >= from) }
        }
        if ((p = path.match(/^\/v1alpha\/sessions\/([^/:]+):(sendMessage|approvePlan)$/)) && m === 'POST') {
          const s = need(decodeURIComponent(p[1]))
          run(s)
          const t = now()
          if (p[2] === 'approvePlan') {
            if (s.state !== 'AWAITING_PLAN_APPROVAL') fail(400, 'The session is not waiting for plan approval')
            act(s, t, { planApproved: {} })
            go(s, 'IN_PROGRESS', t)
            build(s, t, { say: s.say, secs: s.secs })
          } else {
            const text = String(body?.prompt || '').trim()
            act(s, t, { userMessaged: { userMessage: text } })
            go(s, 'IN_PROGRESS', t)
            build(s, t, { secs: 14, say: `Done: ${lower(text)}. I pushed it to the same pull request.` })
          }
          return {}
        }
        return fail(404, 'Requested entity was not found.')
      },
    }
  })()

  // ---------- Claude Managed Agents (beta) ----------
  const claude = (() => {
    const sessions = new Map()
    const text = (t) => [{ type: 'text', text: t }]
    const add = (s, at, e) => { const x = { id: uid('sevt_'), processed_at: iso(at), ...e }; s.events.push(x); s.updated = at; return x }
    const idle = (s, at, stop) => { add(s, at, { type: 'session.status_idle', stop_reason: stop }); s.status = 'idle' }
    // One turn: it reads, runs a command, says what it did. ask: it wants to run something first.
    function turn(s, at, { secs = 20, say, ask, fails } = {}) {
      s.status = 'running'
      later(s, at + S(2), (t) => add(s, t, { type: 'agent.message', content: text("I'll start by reading the code around this and running the tests.") }))
      later(s, at + S(secs * 0.3), (t) => add(s, t, { type: 'agent.tool_use', name: 'bash', input: { command: 'npm test' } }))
      if (ask) {
        later(s, at + S(secs * 0.5), (t) => {
          const use = add(s, t, { type: 'agent.tool_use', name: 'bash', input: { command: ask } })
          idle(s, t, { type: 'requires_action', event_ids: [use.id] })
          s.waiting = { use: use.id, secs, say }
        })
        return
      }
      if (fails) {
        later(s, at + S(secs * 0.6), (t) => add(s, t, { type: 'session.error', error: { message: `${fails}, retrying`, retry_status: { type: 'retrying' } } }))
        later(s, at + S(secs), (t) => { add(s, t, { type: 'session.error', error: { message: fails, retry_status: { type: 'exhausted' } } }); idle(s, t, { type: 'retries_exhausted' }) })
        return
      }
      later(s, at + S(secs * 0.6), (t) => add(s, t, { type: 'agent.tool_use', name: 'edit', input: { file_path: '/workspace/repo/src/index.ts' } }))
      later(s, at + S(secs), (t) => {
        add(s, t, { type: 'agent.message', content: text(say || `${reply(s.prompt)}\n\nBranch: claude/${slug(s.title)}`) })
        idle(s, t, { type: 'end_turn' })
      })
    }
    function create({ repo, base = null, text: prompt, title, at = now(), ...how }) {
      const s = { id: uid('sesn_'), repo, base, prompt, title: title || first(prompt).slice(0, 80), status: 'running', at, updated: at, events: [], plan: [] }
      sessions.set(s.id, s)
      add(s, at, { type: 'user.message', content: text(prompt) })
      turn(s, at, how)
      return s
    }
    const view = (s) => {
      run(s)
      return { id: s.id, type: 'session', title: s.title, status: s.status, archived_at: null, created_at: iso(s.at), updated_at: iso(s.updated), resources: [{ type: 'github_repository', url: `https://github.com/${s.repo}`, mount_path: '/workspace/repo', ...(s.base ? { checkout: { type: 'branch', name: s.base } } : {}) }] }
    }
    const need = (id) => sessions.get(id) || fail(404, 'Session not found')
    return {
      create,
      handle({ method: m, path, query, body }) {
        let p
        if (m === 'POST' && path === '/v1/agents') return { id: uid('agent_'), type: 'agent', name: body?.name, model: body?.model }
        if (m === 'POST' && path === '/v1/environments') return { id: uid('env_'), type: 'environment', name: body?.name }
        if (m === 'GET' && path === '/v1/models') return { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }], has_more: false }
        if (m === 'GET' && path === '/v1/sessions') return { data: [...sessions.values()].map(view).reverse().slice(0, Number(query.get('limit')) || 50), next_page: null }
        if (m === 'POST' && path === '/v1/sessions') {
          const r = (body?.resources || []).find((x) => x.type === 'github_repository')
          const repo = String(r?.url || '').replace(/^https:\/\/github\.com\//, '')
          if (!REPOS.some((x) => x.name === repo)) fail(400, `Could not clone ${r?.url || 'the repository'}`)
          const prompt = (body.initial_events || []).flatMap((e) => e.content || []).map((c) => c.text).join('\n')
          return view(create({ repo, base: r.checkout?.name || null, text: prompt, title: body.title }))
        }
        if ((p = path.match(/^\/v1\/sessions\/([^/]+)$/)) && m === 'GET') return view(need(decodeURIComponent(p[1])))
        if ((p = path.match(/^\/v1\/sessions\/([^/]+)\/events$/))) {
          const s = need(decodeURIComponent(p[1]))
          run(s)
          if (m === 'GET') {
            const types = query.getAll('types[]')
            let list = s.events.filter((e) => !types.length || types.includes(e.type))
            if (query.get('order') === 'desc') list = list.slice().reverse()
            return { data: list.slice(0, Number(query.get('limit')) || 200), next_page: null }
          }
          if (m === 'POST') {
            const t = now()
            for (const e of body?.events || []) {
              if (e.type === 'user.message') {
                add(s, t, { type: 'user.message', content: e.content })
                s.plan = []
                s.waiting = null
                turn(s, t, { secs: 14, say: `Done: ${lower(texts(e.content))}.\n\nBranch: claude/${slug(s.title)}` })
              } else if (e.type === 'user.interrupt') {
                s.plan = []
                if (s.status === 'running') idle(s, t, { type: 'end_turn' })
              } else if (e.type === 'user.tool_confirmation') {
                if (!s.waiting || s.waiting.use !== e.tool_use_id) fail(400, 'No tool call is waiting for confirmation')
                const w = s.waiting
                s.waiting = null
                s.status = 'running'
                add(s, t, { type: 'user.tool_confirmation', tool_use_id: e.tool_use_id, result: e.result })
                later(s, t + S(3), (at) => add(s, at, { type: 'agent.message', content: text('That worked. Now making the change.') }))
                later(s, t + S(w.secs * 0.5), (at) => {
                  add(s, at, { type: 'agent.message', content: text(w.say || `${reply(s.prompt)}\n\nBranch: claude/${slug(s.title)}`) })
                  idle(s, at, { type: 'end_turn' })
                })
              }
            }
            return { data: [] }
          }
        }
        return fail(404, 'Not found')
      },
    }
  })()
  const texts = (content) => (content || []).filter((c) => c?.type === 'text').map((c) => c.text).join('\n')

  // ---------- Requests ----------
  const apis = { cursor, copilot: github, jules, claude }
  const AUTH = { cursor: 'authorization', copilot: 'authorization', jules: 'x-goog-api-key', claude: 'x-api-key' }
  const refused = { cursor: { error: { code: 'unauthorized', message: 'Invalid API key' } }, copilot: { message: 'Bad credentials', status: '401' }, jules: { error: { code: 401, message: 'API key not valid. Please pass a valid API key.', status: 'UNAUTHENTICATED' } }, claude: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }
  function handle(provider, { method = 'GET', path, query = new URLSearchParams(), headers = {}, body = null }) {
    const api = apis[provider]
    if (!api) return { status: 404, body: { message: 'Not Found' } }
    const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]))
    const key = (h[AUTH[provider]] || '').replace(/^Bearer\s+/i, '')
    if (!key || /bad/i.test(key)) return { status: 401, body: refused[provider] }
    try {
      return { status: 200, body: api.handle({ method: method.toUpperCase(), path, query, body }) ?? {} }
    } catch (e) {
      if (!e.status) throw e
      const said = provider === 'copilot' ? { message: e.message } : provider === 'claude' ? { type: 'error', error: { type: e.status === 404 ? 'not_found_error' : 'invalid_request_error', message: e.message } } : provider === 'jules' ? { error: { code: e.status, message: e.message } } : { error: { code: e.extra?.code || 'error', message: e.message } }
      return { status: e.status, body: said }
    }
  }
  async function fetch(url, init = {}) {
    const u = new URL(url)
    const provider = HOSTS[u.host]
    const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers || {}
    let body = init.body ?? null
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { /* as is */ } }
    const r = provider ? handle(provider, { method: init.method || 'GET', path: u.pathname, query: u.searchParams, headers, body }) : { status: 404, body: { message: 'Not Found' } }
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  }

  // The demo's agents: one per provider, each at a different point.
  function seed() {
    const t = now()
    const min = 60 * SEC
    const c = cursor.create({ repo: 'acme/shop', base: 'main', at: t - 30 * SEC, work: 75, text: 'Add a Saved for later list to the cart page, with tests', result: 'Done. The cart page has a **Saved for later** list under the cart: items move there and back with one click, and the list is kept with the cart.\n\n- `src/cart/SavedList.tsx` (new)\n- `src/cart/Cart.tsx`, `src/cart/store.ts`\n- 9 new tests, all passing\n\nI opened a pull request with screenshots.' })
    const g = github.create({ repo: 'acme/docs-site', at: t - 42 * min, secs: 30, text: 'Fix the broken links in the API reference and add a link checker to CI', body: 'Fixes #41.\n\n- Fixed 14 broken links in `docs/api/` (renamed pages, old anchors)\n- Added a link check to the CI workflow, so new ones fail the build\n\nAll pages build and the link check passes.', say: 'Done. I fixed 14 broken links across the API reference (most pointed at pages renamed in the v3 docs) and added a link check job to CI so new ones fail the build. Ready for your review.' })
    const j = jules.create({ repo: 'acme/billing-api', base: 'main', at: t - 8 * min, plan: true, text: 'Upgrade the Stripe SDK to v18 and fix whatever breaks', steps: ['Upgrade stripe from v14 to v18 in package.json', 'Move webhook handling to the new event types', 'Update the 6 call sites that use the removed charges API', 'Run the test suite and fix failures'], say: 'Done. Stripe is on v18: webhooks use the new event types, and the six call sites moved from charges to payment intents. All 212 tests pass.' })
    const k = claude.create({ repo: 'acme/shop', base: 'main', at: t - 18 * min, secs: 60, title: 'Speed up the product search query', text: 'Speed up the product search query: it takes over 2s on large catalogs', fails: 'npm install failed: the registry timed out (ETIMEDOUT)' })
    return [
      { provider: 'cursor', id: c.a.id, title: c.a.name, repo: 'acme/shop', base: 'main', createdAt: iso(t - 30 * SEC), status: 'working', seq: 1, seen: false },
      { provider: 'copilot', id: `acme~docs-site~${g.number}`, title: g.title, repo: 'acme/docs-site', createdAt: iso(t - 42 * min), status: 'working', seq: 1, seen: false },
      { provider: 'jules', id: j.id, title: j.title, repo: 'acme/billing-api', base: 'main', createdAt: iso(t - 8 * min), status: 'working', seq: 1, seen: false },
      { provider: 'claude', id: k.id, title: k.title, repo: 'acme/shop', base: 'main', createdAt: iso(t - 18 * min), status: 'working', seq: 1, seen: false },
    ]
  }

  return { handle, fetch, seed }
}
