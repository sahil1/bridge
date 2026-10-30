// GitHub Copilot cloud agent (formerly "coding agent"), through the GitHub REST API:
// https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api
// Start: an issue with the task, assigned to copilot-swe-agent[bot] (agent_assignment says the
// base branch). Copilot opens a draft pull request linked to the issue, works there, and asks you
// for a review when it's done. Follow-ups are PR comments that mention @copilot.
// There's no API to stop it ("Stop session" is on GitHub), and the docs name no Copilot-specific
// timeline events, so its state is read from the documented ones: the PR opening, review
// requests, your @copilot comments, merged and closed.
import { makeCall, CloudError, oneLine, repoName, authHeader } from './http.js'

export const info = {
  id: 'copilot',
  name: 'GitHub Copilot',
  description: 'Copilot cloud agent works on an issue in your GitHub repo and opens a draft pull request.',
  keyUrl: 'https://github.com/settings/personal-access-tokens/new',
  keyLabel: 'GitHub token',
  keyHint: 'GitHub › Settings › Developer settings › Personal access tokens',
  cost: 'Uses your GitHub Copilot plan (premium requests).',
  permissions: [
    'Repository access: the repos you want Copilot to work on',
    'Metadata: Read',
    'Actions, Contents, Issues and Pull requests: Read and write',
    'A classic token needs the repo scope instead',
  ],
  base: 'https://api.github.com',
  auth: { header: 'Authorization', scheme: 'Bearer' },
  hosts: 'GitHub',
  repoPlaceholder: 'owner/repo',
  ghLogin: true, // can use the GitHub CLI's sign-in
  poll: { working: 20_000, blocked: 60_000 },
}

const BOT = 'copilot-swe-agent[bot]'
const isCopilot = (u) => /copilot/i.test(u?.login || '')
const HOUR = 3600 * 1000

// "owner~repo~123": a repo can't have "~" in its name, and it's safe in a URL.
export const taskId = (repo, number) => `${repo.replace('/', '~')}~${number}`
const parse = (id) => {
  const m = String(id).match(/^([\w.-]+)~([\w.-]+)~(\d+)$/)
  if (!m) throw new CloudError('Not a Copilot task')
  return { repo: `${m[1]}/${m[2]}`, number: Number(m[3]) }
}
const at = (s) => Date.parse(s || 0) || 0

// The pull request state, plus what its timeline says, -> Bridge AI's status.
export function status({ issue, pr, events = [], me = null, now = Date.now() }) {
  if (!pr) {
    if (issue?.state === 'closed') return { status: 'idle', state: 'issue closed' }
    if (issue && !(issue.assignees || []).length && now - at(issue.created_at) > 2 * 60_000) return { status: 'failed', state: 'not assigned' }
    return { status: 'working', state: 'starting' }
  }
  if (pr.merged || pr.merged_at) return { status: 'done', state: 'merged' }
  if (pr.state === 'closed') return { status: 'idle', state: 'closed' }
  let start = at(pr.created_at)
  let end = 0
  let fail = 0
  for (const e of events) {
    const t = at(e.created_at)
    if (e.event === 'copilot_work_started' || (e.event === 'commented' && /@copilot\b/i.test(e.body || '') && !isCopilot(e.actor || e.user) && (!me || (e.actor || e.user)?.login === me))) start = Math.max(start, t)
    else if (e.event === 'copilot_work_finished' || e.event === 'ready_for_review' || (e.event === 'review_requested' && isCopilot(e.review_requester || e.actor))) end = Math.max(end, t)
    else if (e.event === 'copilot_work_finished_failure') fail = Math.max(fail, t)
  }
  if (fail && fail >= start && fail >= end) return { status: 'failed', state: 'failed' }
  if (end && end >= start) return { status: 'done', state: pr.draft ? 'review requested (draft)' : 'review requested' }
  // Sessions time out after an hour: nothing since then means it stopped without saying so.
  if (now - Math.max(start, at(pr.updated_at)) > 75 * 60_000) return { status: 'idle', state: 'quiet for over an hour' }
  return { status: 'working', state: pr.draft ? 'draft pull request' : 'pull request open' }
}

export function create({ key, fetch, base = info.base, memo = null }) {
  const etags = new Map()
  const call = makeCall({ fetch, base, name: 'GitHub', secrets: [key], etags, headers: { ...authHeader(info.auth, key), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
  const prs = new Map() // task id -> PR number, once found
  const repoInfo = new Map() // "owner/repo" -> { defaultBranch }
  const path = (repo) => repo.split('/').map(encodeURIComponent).join('/')
  let me = memo?.get('copilot:login') || null
  const whoami = async () => {
    if (me) return me
    const u = await call('GET', '/user')
    me = u?.login || null
    memo?.set('copilot:login', me)
    return me
  }

  async function timeline(repo, number) {
    const out = []
    for (let page = 1; page <= 5; page++) {
      const r = await call('GET', `/repos/${path(repo)}/issues/${number}/timeline`, { query: { per_page: 100, page } })
      out.push(...(r || []))
      if (!r || r.length < 100) break
    }
    return out
  }
  // The pull request Copilot opened for the issue: the newest PR that mentions it (Copilot's first).
  async function findPr(id, repo, number, events) {
    if (prs.has(id)) return prs.get(id)
    const refs = (events || await timeline(repo, number)).filter((e) => e.event === 'cross-referenced' && e.source?.issue?.pull_request)
    const pick = refs.filter((e) => isCopilot(e.source.issue.user)).at(-1) || refs.at(-1)
    if (!pick) return null
    const n = pick.source.issue.number
    const r = repoName(pick.source.issue.repository?.full_name || '') || repo
    prs.set(id, { repo: r, number: n })
    return prs.get(id)
  }

  async function read(id, { messages }) {
    const { repo, number } = parse(id)
    const issue = await call('GET', `/repos/${path(repo)}/issues/${number}`)
    const issueEvents = prs.has(id) && !messages ? null : await timeline(repo, number)
    const ref = await findPr(id, repo, number, issueEvents)
    const pr = ref ? await call('GET', `/repos/${path(ref.repo)}/pulls/${ref.number}`) : null
    const prEvents = ref ? await timeline(ref.repo, ref.number) : []
    const s = status({ issue, pr, events: prEvents, me: await whoami().catch(() => null) })
    const out = {
      id,
      title: issue.title || '',
      status: s.status,
      state: s.state,
      repo,
      branch: pr?.head?.ref || null,
      base: pr?.base?.ref || null,
      url: issue.html_url || null,
      urlLabel: 'Open issue',
      prUrl: pr?.html_url || null,
      createdAt: issue.created_at || null,
      updatedAt: pr?.updated_at || issue.updated_at || null,
      summary: '',
      ask: null,
    }
    if (!messages) return out
    const list = [{ id: `${id}:issue`, role: 'user', text: issue.body || issue.title || '', ts: issue.created_at }]
    list.push({ id: `${id}:assigned`, role: 'event', status: (issue.assignees || []).length ? 'info' : 'failed', text: (issue.assignees || []).length ? `Issue #${number} assigned to Copilot` : `Issue #${number} has no assignee: Copilot may not be on for this repo, or the token can't assign it`, ts: issue.created_at })
    if (pr) {
      list.push({ id: `pr:${pr.number}`, role: 'event', status: 'info', text: `${pr.draft ? 'Draft pull request' : 'Pull request'} #${pr.number} opened`, ts: pr.created_at })
      if (pr.body) list.push({ id: `pr:${pr.number}:body`, role: 'assistant', text: pr.body, ts: pr.updated_at })
      for (const e of prEvents) {
        const who = e.actor || e.user
        if (e.event === 'commented') list.push({ id: `c:${e.id}`, role: isCopilot(who) ? 'assistant' : 'user', text: e.body || '', ts: e.created_at })
        else if (e.event === 'review_requested' && isCopilot(e.review_requester || who)) list.push({ id: `rr:${e.id || e.created_at}`, role: 'event', status: 'completed', text: `Copilot asked ${e.requested_reviewer?.login || 'you'} for a review`, ts: e.created_at })
        else if (e.event === 'merged') list.push({ id: `m:${e.id || e.created_at}`, role: 'event', status: 'completed', text: 'Merged', ts: e.created_at })
        else if (e.event === 'closed') list.push({ id: `x:${e.id || e.created_at}`, role: 'event', status: '', text: 'Pull request closed', ts: e.created_at })
        else if (e.event === 'copilot_work_finished_failure') list.push({ id: `f:${e.id || e.created_at}`, role: 'event', status: 'failed', text: 'Copilot stopped with an error', ts: e.created_at })
      }
    }
    list.sort((a, b) => at(a.ts) - at(b.ts))
    const last = [...list].reverse().find((m) => m.role === 'assistant')
    if (last) out.summary = oneLine(last.text)
    return { ...out, messages: list.filter((m) => m.text) }
  }

  return {
    info,
    async check() {
      const u = await call('GET', '/user')
      me = u?.login || null
      memo?.set('copilot:login', me)
      return { ok: true, account: u?.login ? `@${u.login}` : null }
    },
    // Repos you can push to (Copilot only takes work from people with write access).
    async repos() {
      const out = []
      for (let page = 1; page <= 3; page++) {
        const r = await call('GET', '/user/repos', { query: { per_page: 100, page, sort: 'pushed' } })
        out.push(...(r || []))
        if (!r || r.length < 100) break
      }
      const list = out.filter((x) => !x.archived && x.permissions?.push !== false)
      for (const x of list) repoInfo.set(x.full_name, { defaultBranch: x.default_branch })
      return list.map((x) => ({ name: x.full_name, url: x.html_url, defaultBranch: x.default_branch || null, private: !!x.private }))
    },
    async branches(repo) {
      const name = repoName(repo)
      if (!name) return []
      const r = await call('GET', `/repos/${path(name)}/branches`, { query: { per_page: 100 } })
      const all = (r || []).map((b) => b.name)
      const def = repoInfo.get(name)?.defaultBranch
      return def && all.includes(def) ? [def, ...all.filter((b) => b !== def)] : all
    },
    async launch({ repo, branch, prompt }) {
      const text = String(prompt || '').trim()
      if (!text) throw new CloudError('Write what Copilot should do')
      const name = repoName(repo)
      if (!name) throw new CloudError('Pick a GitHub repository (owner/repo)')
      const title = oneLine(text.split('\n')[0], 100) || 'Task for Copilot'
      const issue = await call('POST', `/repos/${path(name)}/issues`, { body: {
        title,
        body: text,
        assignees: [BOT],
        agent_assignment: { target_repo: name, ...(branch ? { base_branch: branch } : {}), custom_instructions: '', custom_agent: '', model: '' },
      } })
      const id = taskId(name, issue.number)
      return { id, title: issue.title || title, status: 'working', state: 'starting', repo: name, base: branch || null, branch: null, url: issue.html_url || null, urlLabel: 'Open issue', prUrl: null, createdAt: issue.created_at || new Date().toISOString(), updatedAt: issue.updated_at || null }
    },
    // Issues assigned to Copilot that you opened, newest first.
    async list() {
      const login = await whoami()
      const r = await call('GET', '/search/issues', { query: { q: `is:issue author:${login} assignee:${BOT}`, sort: 'created', per_page: 30 } })
      return (r?.items || []).map((x) => {
        const repo = repoName(x.repository_url?.replace(/^.*\/repos\//, '') || '')
        return { id: repo ? taskId(repo, x.number) : String(x.id), title: x.title, status: x.state === 'closed' ? 'idle' : 'working', state: x.state, repo, url: x.html_url, createdAt: x.created_at, updatedAt: x.updated_at }
      })
    },
    get: (id, { messages = true } = {}) => read(id, { messages }),
    // A comment on Copilot's pull request that mentions @copilot. Before the PR exists there's
    // nowhere to send it (Copilot ignores new comments on the issue), so it waits.
    async send(id, text) {
      const t = String(text || '').trim()
      if (!t) throw new CloudError('Empty message')
      const { repo, number } = parse(id)
      const ref = await findPr(id, repo, number)
      if (!ref) throw Object.assign(new CloudError("Copilot hasn't opened its pull request yet"), { busy: true })
      await call('POST', `/repos/${path(ref.repo)}/issues/${ref.number}/comments`, { body: { body: /@copilot\b/i.test(t) ? t : `@copilot ${t}` } })
      return { ok: true }
    },
  }
}
