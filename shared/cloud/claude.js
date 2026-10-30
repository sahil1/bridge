// Claude Managed Agents (beta managed-agents-2026-04-01): https://platform.claude.com/docs/en/managed-agents/
// Anthropic's hosted agent sandbox, with an API key from the Claude Console. Billed per use on
// that API account (tokens, plus session runtime), never on a Claude Pro or Max plan; Bridge AI
// never uses Claude Code's own sign-in for this.
// One agent and one environment are made the first time and remembered (memo); each task is a
// session with your GitHub repo mounted. A GitHub token lets it clone private repos and push its
// branch; it opens no pull request itself, so the link is GitHub's compare page for that branch.
import { makeCall, CloudError, oneLine, repoName, authHeader } from './http.js'
import { create as githubClient } from './github.js'

export const info = {
  id: 'claude',
  name: 'Claude',
  description: 'Claude Managed Agents run Claude Code-style agents in Anthropic\'s cloud on a GitHub repo, and push a branch.',
  keyUrl: 'https://platform.claude.com/settings/keys',
  keyLabel: 'Claude Console API key',
  keyHint: 'Claude Console › Settings › API keys',
  cost: 'Billed to your Claude Console account: tokens, plus $0.08 per session-hour while it runs. A Claude Pro or Max plan doesn\'t cover it.',
  perUse: true,
  base: 'https://api.anthropic.com',
  auth: { header: 'x-api-key' },
  hosts: 'GitHub',
  repoPlaceholder: 'owner/repo',
  github: true, // takes an optional GitHub token, for private repos and pushing
  models: true,
  defaultModel: 'claude-opus-5-5',
  poll: { working: 10_000, blocked: 30_000 },
}

const BETA = 'managed-agents-2026-04-01'
const SYSTEM = [
  'You are a coding agent working on the GitHub repository mounted at /workspace/repo.',
  'Do the task you are given there. When the work is ready, create a new branch named claude/<a short slug for the task>, commit with a clear message, and push the branch to origin.',
  'Never push to the starting branch. If you can\'t push, say why.',
  'End your final message with a line of the form "Branch: <branch name>".',
].join(' ')

const texts = (content) => (content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim()

// Session status (plus why it went idle) -> Bridge AI's.
export function status(s, stop) {
  if (s?.archived_at) return 'idle'
  if (s?.status === 'running' || s?.status === 'rescheduling') return 'working'
  if (s?.status === 'terminated') return 'failed'
  if (s?.status === 'idle') {
    const why = stop?.type
    if (why === 'requires_action') return 'blocked'
    if (why === 'retries_exhausted' || why === 'budget_reached' || why === 'refusal') return 'failed'
    return 'done'
  }
  return 'working'
}

export function create({ key, fetch, base = info.base, memo = null, github = null, githubBase }) {
  const call = makeCall({ fetch, base, name: 'Claude', secrets: [key, github], headers: { ...authHeader(info.auth, key), 'anthropic-version': '2023-06-01', 'anthropic-beta': BETA } })
  const gh = github ? githubClient({ key: github, fetch, base: githubBase }) : null
  const sid = (id) => encodeURIComponent(id)

  // The agent (per model) and the environment, made once.
  async function agentFor(model) {
    const m = model || info.defaultModel
    const k = `claude:agent:${m}`
    if (memo?.get(k)) return memo.get(k)
    const a = await call('POST', '/v1/agents', { body: { name: 'Bridge AI coding agent', model: m, system: SYSTEM, tools: [{ type: 'agent_toolset_20260401' }] } })
    memo?.set(k, a.id)
    return a.id
  }
  async function environment() {
    if (memo?.get('claude:env')) return memo.get('claude:env')
    // Package managers and the code hosts (github.com) only; the mounted repo is always there.
    const e = await call('POST', '/v1/environments', { body: { name: 'bridge-ai', config: { type: 'cloud', networking: { type: 'limited', allow_package_managers: true } } } })
    memo?.set('claude:env', e.id)
    return e.id
  }
  const repoOf = (s) => {
    const r = (s?.resources || []).find((x) => x.type === 'github_repository')
    return r ? { name: repoName(r.url), base: r.checkout?.type === 'branch' ? r.checkout.name : null } : { name: null, base: null }
  }
  // Why it last went idle: the newest session.status_idle event.
  async function stopReason(id) {
    const r = await call('GET', `/v1/sessions/${sid(id)}/events`, { query: { order: 'desc', limit: 1, 'types[]': 'session.status_idle' } })
    return r?.data?.[0]?.stop_reason || null
  }
  async function events(id) {
    const out = []
    let page
    for (let i = 0; i < 10; i++) {
      const r = await call('GET', `/v1/sessions/${sid(id)}/events`, { query: { limit: 200, page } })
      out.push(...(r?.data || []))
      page = r?.next_page
      if (!page) break
    }
    return out
  }

  const task = (s, stop) => {
    const { name, base: from } = repoOf(s)
    const st = status(s, stop)
    return {
      id: s.id,
      title: s.title || '',
      status: st,
      state: s.archived_at ? 'archived' : s.status === 'idle' && stop?.type ? `idle: ${stop.type}` : s.status || '',
      repo: name,
      branch: null,
      base: from,
      url: null,
      urlLabel: null,
      prUrl: null,
      createdAt: s.created_at || null,
      updatedAt: s.updated_at || null,
      summary: '',
      ask: st === 'blocked' ? 'Claude is waiting for you to allow a tool call' : null,
      approveLabel: st === 'blocked' ? 'Allow' : null,
      pending: stop?.type === 'requires_action' ? stop.event_ids || [] : [],
    }
  }

  // The branch it says it pushed, and a pull request link if one turned up in what it said.
  function linksFrom(out, msgs) {
    const said = msgs.filter((m) => m.role === 'assistant').map((m) => m.text).join('\n')
    const pr = said.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/)
    const br = [...said.matchAll(/^\s*\**Branch:?\**\s*`?([\w./-]+)`?\s*$/gim)].at(-1)
    if (pr) out.prUrl = pr[0]
    if (br) out.branch = br[1]
    if (!out.prUrl && out.branch && out.repo) { out.url = `https://github.com/${out.repo}/compare/${encodeURIComponent(out.base || 'main')}...${encodeURIComponent(out.branch)}?expand=1`; out.urlLabel = 'Compare on GitHub' }
    else if (out.repo && !out.prUrl) { out.url = `https://github.com/${out.repo}`; out.urlLabel = 'Open repo on GitHub' }
    return out
  }

  return {
    info,
    async check() {
      await call('GET', '/v1/sessions', { query: { limit: 1 } })
      return { ok: true, account: null }
    },
    // Your GitHub repos, when there's a GitHub token to list them with.
    async repos() { return gh ? gh.repos() : [] },
    async branches(repo) { return gh ? gh.branches(repo) : [] },
    async models() {
      const r = await call('GET', '/v1/models', { query: { limit: 50 } }).catch(() => null)
      return (r?.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id }))
    },
    async launch({ repo, branch, prompt, model }) {
      const text = String(prompt || '').trim()
      if (!text) throw new CloudError('Write what Claude should do')
      const name = repoName(repo)
      if (!name) throw new CloudError('Pick a GitHub repository (owner/repo)')
      const resource = { type: 'github_repository', url: `https://github.com/${name}`, mount_path: '/workspace/repo', ...(branch ? { checkout: { type: 'branch', name: branch } } : {}), ...(github ? { authorization_token: github } : {}) }
      const body = async () => ({ agent: await agentFor(model), environment_id: await environment(), title: oneLine(text, 80), resources: [resource], initial_events: [{ type: 'user.message', content: [{ type: 'text', text }] }] })
      let s
      try { s = await call('POST', '/v1/sessions', { body: await body() }) } catch (e) {
        // The agent or environment it remembered is gone (deleted in the Console): make new ones.
        if (e.status !== 404 && e.status !== 400) throw e
        memo?.set(`claude:agent:${model || info.defaultModel}`, null)
        memo?.set('claude:env', null)
        s = await call('POST', '/v1/sessions', { body: await body() })
      }
      return { ...task(s, null), repo: name, base: branch || null, status: s.status === 'idle' ? 'working' : status(s, null) }
    },
    async list() {
      const r = await call('GET', '/v1/sessions', { query: { limit: 50 } })
      return (r?.data || []).map((s) => task(s, null))
    },
    async get(id, { messages = true } = {}) {
      const s = await call('GET', `/v1/sessions/${sid(id)}`)
      const stop = s.status === 'idle' ? await stopReason(id).catch(() => null) : null
      const out = task(s, stop)
      if (!messages) return out
      const list = []
      const tools = new Map()
      for (const e of await events(id)) {
        const ts = e.processed_at || null
        if (e.type === 'user.message') list.push({ id: e.id, role: 'user', text: texts(e.content), ts })
        else if (e.type === 'agent.message') list.push({ id: e.id, role: 'assistant', text: texts(e.content), ts })
        else if (e.type === 'agent.tool_use' || e.type === 'agent.mcp_tool_use' || e.type === 'agent.custom_tool_use') {
          const inp = e.input || {}
          const hint = inp.command || inp.file_path || inp.path || inp.pattern || inp.url || inp.query || ''
          tools.set(e.id, e.name)
          list.push({ id: e.id, role: 'tool', tool: e.mcp_server_name ? `${e.mcp_server_name}: ${e.name}` : e.name, hint: oneLine(hint, 160), ts })
        } else if (e.type === 'session.error') list.push({ id: e.id, role: 'event', status: e.error?.retry_status?.type === 'retrying' ? '' : 'failed', text: oneLine(e.error?.message || 'Something went wrong', 240), ts })
        else if (e.type === 'session.status_terminated') list.push({ id: e.id, role: 'event', status: 'failed', text: 'The session ended', ts })
        else if (e.type === 'session.status_idle' && e.stop_reason?.type && e.stop_reason.type !== 'end_turn') {
          const why = { requires_action: 'Waiting for you to allow a tool call', retries_exhausted: 'Stopped after too many errors', budget_reached: 'Stopped: the session reached its budget', refusal: 'Claude declined to continue' }[e.stop_reason.type] || e.stop_reason.type
          list.push({ id: e.id, role: 'event', status: e.stop_reason.type === 'requires_action' ? '' : 'failed', text: why, ts })
        }
      }
      if (out.status === 'blocked' && out.pending.length) {
        const names = out.pending.map((x) => tools.get(x)).filter(Boolean)
        if (names.length) out.ask = `Claude wants to use ${[...new Set(names)].join(', ')}`
      }
      return { ...linksFrom(out, list), messages: list.filter((m) => m.text || m.tool) }
    },
    async send(id, text) {
      const t = String(text || '').trim()
      if (!t) throw new CloudError('Empty message')
      await call('POST', `/v1/sessions/${sid(id)}/events`, { body: { events: [{ type: 'user.message', content: [{ type: 'text', text: t }] }] } })
      return { ok: true }
    },
    async stop(id) {
      await call('POST', `/v1/sessions/${sid(id)}/events`, { body: { events: [{ type: 'user.interrupt' }] } })
      return { ok: true }
    },
    // Allow the tool calls it's waiting on.
    async approve(id) {
      const stop = await stopReason(id)
      const ids = stop?.type === 'requires_action' ? stop.event_ids || [] : []
      if (!ids.length) throw new CloudError("It isn't waiting on a tool call")
      await call('POST', `/v1/sessions/${sid(id)}/events`, { body: { events: ids.map((x) => ({ type: 'user.tool_confirmation', tool_use_id: x, result: 'allow' })) } })
      return { ok: true }
    },
  }
}
