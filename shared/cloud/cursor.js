// Cursor Cloud Agents, API v1 (public beta): https://cursor.com/docs/cloud-agent/api/endpoints
// An agent is durable; each prompt (the first one and every follow-up) is a "run" on it. The
// run carries the status, the final reply (result) and the pushed branch and pull request.
// v1 has no conversation endpoint, so the chat is your prompts (kept in memo) and each run's result.
import { makeCall, CloudError, oneLine, repoName, authHeader } from './http.js'

export const info = {
  id: 'cursor',
  name: 'Cursor',
  description: 'Cursor Cloud Agents work on your repo in Cursor\'s cloud and push a branch or open a pull request.',
  keyUrl: 'https://cursor.com/dashboard/api',
  keyLabel: 'API key',
  keyHint: 'Cursor dashboard › Integrations › API keys',
  cost: 'Uses your Cursor plan.',
  base: 'https://api.cursor.com',
  auth: { header: 'Authorization', scheme: 'Bearer' },
  hosts: 'GitHub, GitLab, Bitbucket and Azure DevOps',
  repoPlaceholder: 'https://github.com/owner/repo',
  models: true,
  // Listing your repos is limited to once a minute (30 an hour); type a URL any time.
  reposEvery: 60 * 60 * 1000,
  poll: { working: 10_000, blocked: 30_000 },
  // A follow-up while a run is going is refused (409 agent_busy): hold it until the run ends.
  holdWhileWorking: true,
}

// Run status -> Bridge AI's. There's no "waiting on you" state in the REST API.
const RUN = { CREATING: 'working', RUNNING: 'working', FINISHED: 'done', ERROR: 'failed', CANCELLED: 'idle', EXPIRED: 'idle' }
export const status = (run, agent) => (agent?.status === 'ARCHIVED' ? 'idle' : RUN[run?.status] || (agent?.status === 'ACTIVE' ? 'working' : 'idle'))

const repoUrl = (r) => {
  const s = String(r || '').trim()
  if (/^https?:\/\//.test(s)) return s.replace(/\.git$/, '').replace(/\/+$/, '')
  return repoName(s) ? `https://github.com/${repoName(s)}` : s
}

export function create({ key, fetch, base = info.base, memo = null }) {
  const call = makeCall({ fetch, base, name: 'Cursor', secrets: [key], headers: authHeader(info.auth, key) })
  const prompts = (id) => (memo?.get(`cursor:prompts:${id}`) || [])
  const note = (id, text, runId) => memo?.set(`cursor:prompts:${id}`, [...prompts(id), { text, ts: new Date().toISOString(), runId }].slice(-200))

  const task = (agent, run) => {
    const b = run?.git?.branches?.[0] || null
    const repo = agent?.repos?.[0]
    return {
      id: agent.id,
      title: agent.name || '',
      status: status(run, agent),
      state: run?.status || agent.status || '',
      repo: repo ? repoName(repo.url) || repo.url : (b?.repoUrl ? repoName(`https://${b.repoUrl}`) : null),
      branch: b?.branch || repo?.startingRef || null,
      base: repo?.startingRef || null,
      url: agent.url || null,
      prUrl: b?.prUrl || null,
      createdAt: agent.createdAt || null,
      updatedAt: run?.updatedAt || agent.updatedAt || null,
      summary: run?.result ? oneLine(run.result) : '',
      ask: null,
      runId: run?.id || agent.latestRunId || null,
    }
  }

  return {
    info,
    async check() {
      const me = await call('GET', '/v1/me')
      return { ok: true, account: [me?.userFirstName, me?.userLastName].filter(Boolean).join(' ') || me?.apiKeyName || null }
    },
    async repos() {
      const r = await call('GET', '/v1/repositories')
      return (r?.items || []).map((x) => ({ name: repoName(x.url) || x.url, url: x.url, defaultBranch: null }))
    },
    async branches() { return [] },
    async models() {
      const r = await call('GET', '/v1/models')
      return (r?.items || []).map((m) => ({ id: m.id, label: m.displayName || m.id }))
    },
    async launch({ repo, branch, prompt, model }) {
      const text = String(prompt || '').trim()
      if (!text) throw new CloudError('Write what the agent should do')
      const body = { prompt: { text }, autoCreatePR: true }
      if (repo) body.repos = [{ url: repoUrl(repo), ...(branch ? { startingRef: branch } : {}) }]
      if (model) body.model = { id: model }
      const r = await call('POST', '/v1/agents', { body })
      note(r.agent.id, text, r.run?.id)
      return task(r.agent, r.run)
    },
    async list() {
      const r = await call('GET', '/v1/agents', { query: { limit: 50, includeArchived: false } })
      return (r?.items || []).map((a) => ({ id: a.id, title: a.name || '', status: a.status === 'ACTIVE' ? 'working' : 'idle', state: a.status, url: a.url, createdAt: a.createdAt, updatedAt: a.updatedAt }))
    },
    // known: the last answer for this agent. While its run is going, the run alone says enough (one
    // request instead of two, as the default limit is about 20 a minute).
    async get(id, { messages = true, known = null } = {}) {
      const runOf = (rid) => call('GET', `/v1/agents/${encodeURIComponent(id)}/runs/${encodeURIComponent(rid)}`)
      if (!messages && known?.runId && known._agent && RUN[known.state] === 'working') {
        const run = await runOf(known.runId)
        if (RUN[run?.status] === 'working') return { ...task(known._agent, run), _agent: known._agent }
      }
      const agent = await call('GET', `/v1/agents/${encodeURIComponent(id)}`)
      const run = agent.latestRunId ? await runOf(agent.latestRunId) : null
      const out = { ...task(agent, run), _agent: agent }
      if (!messages) return out
      // Oldest first: each prompt you sent, then that run's reply once it has one.
      const runs = (await call('GET', `/v1/agents/${encodeURIComponent(id)}/runs`, { query: { limit: 50 } }))?.items || []
      const sent = prompts(id)
      const list = []
      runs.slice().reverse().forEach((r, i) => {
        const p = sent.find((x) => x.runId === r.id) || (sent.length === runs.length ? sent[i] : null)
        if (p) list.push({ id: `${r.id}:u`, role: 'user', text: p.text, ts: p.ts || r.createdAt })
        if (r.result) list.push({ id: `${r.id}:a`, role: 'assistant', text: r.result, ts: r.updatedAt })
        if (r.status === 'ERROR' || r.status === 'CANCELLED' || r.status === 'EXPIRED') list.push({ id: `${r.id}:e`, role: 'event', status: r.status === 'ERROR' ? 'failed' : '', text: { ERROR: 'The run failed', CANCELLED: 'Stopped', EXPIRED: 'The run expired' }[r.status], ts: r.updatedAt })
      })
      for (const b of run?.git?.branches || []) if (b.prUrl) list.push({ id: `pr:${b.prUrl}`, role: 'event', status: 'completed', text: `Pull request: ${b.prUrl}`, ts: run.updatedAt })
      return { ...out, messages: list }
    },
    async send(id, text) {
      const t = String(text || '').trim()
      if (!t) throw new CloudError('Empty message')
      try {
        const r = await call('POST', `/v1/agents/${encodeURIComponent(id)}/runs`, { body: { prompt: { text: t } } })
        note(id, t, r?.run?.id)
        return { ok: true }
      } catch (e) {
        if (e.status === 409) e.busy = true
        throw e
      }
    },
    async stop(id) {
      const agent = await call('GET', `/v1/agents/${encodeURIComponent(id)}`)
      if (!agent.latestRunId) return { ok: true }
      try { await call('POST', `/v1/agents/${encodeURIComponent(id)}/runs/${encodeURIComponent(agent.latestRunId)}/cancel`) } catch (e) { if (e.status !== 409) throw e } // already over
      return { ok: true }
    },
  }
}
