// Jules (Google), API v1alpha: https://jules.google/docs/api/reference/
// A "source" is a GitHub repo you've connected to Jules; a "session" is one task on it. What
// happens in a session (its plan, messages, progress) is a list of "activities". There's no way
// to stop or pause a session through the API (only on jules.google.com).
import { makeCall, CloudError, oneLine, repoName, authHeader } from './http.js'

export const info = {
  id: 'jules',
  name: 'Jules',
  description: 'Google\'s coding agent works on a GitHub repo you\'ve connected to Jules and opens a pull request.',
  keyUrl: 'https://jules.google.com/settings#api',
  keyLabel: 'API key',
  keyHint: 'jules.google.com › Settings › API',
  cost: 'Uses your Jules plan and its daily task limit.',
  base: 'https://jules.googleapis.com',
  auth: { header: 'x-goog-api-key' },
  hosts: 'GitHub repos connected to Jules',
  repoPlaceholder: 'owner/repo',
  planApproval: true,
  poll: { working: 15_000, blocked: 30_000 },
}

const STATE = {
  STATE_UNSPECIFIED: 'working', QUEUED: 'working', PLANNING: 'working', IN_PROGRESS: 'working',
  AWAITING_PLAN_APPROVAL: 'blocked', AWAITING_USER_FEEDBACK: 'blocked',
  PAUSED: 'idle', FAILED: 'failed', COMPLETED: 'done',
}
export const status = (state) => STATE[state] || (state ? 'idle' : 'working')

const planText = (plan) => ['Plan:', ...(plan?.steps || []).map((s, i) => `${(s.index ?? i) + 1}. ${s.title || ''}`)].join('\n')

// One activity as a chat entry (null for ones with nothing to show).
function entry(a) {
  const ts = a.createTime || null
  const id = a.id || a.name
  if (a.userMessaged) return { id, role: 'user', text: a.userMessaged.userMessage || '', ts }
  if (a.agentMessaged) return { id, role: 'assistant', text: a.agentMessaged.agentMessage || '', ts }
  if (a.planGenerated) return { id, role: 'assistant', text: planText(a.planGenerated.plan), ts, plan: true }
  if (a.planApproved) return { id, role: 'event', status: 'completed', text: 'Plan approved', ts }
  if (a.progressUpdated) return { id, role: 'tool', tool: a.progressUpdated.title || 'Progress', hint: oneLine(a.progressUpdated.description || '', 160), ts }
  if (a.sessionCompleted) return { id, role: 'event', status: 'completed', text: 'Session completed', ts }
  if (a.sessionFailed) return { id, role: 'event', status: 'failed', text: `Failed${a.sessionFailed.reason ? `: ${a.sessionFailed.reason}` : ''}`, ts }
  return null
}

export function create({ key, fetch, base = info.base }) {
  const call = makeCall({ fetch, base, name: 'Jules', secrets: [key], headers: authHeader(info.auth, key) })
  const sources = new Map() // "owner/repo" -> source
  const acts = new Map() // session id -> { list, last } (activities never change once made)
  const sid = (id) => encodeURIComponent(String(id).replace(/^sessions\//, ''))

  // "sources/github/owner/repo" (the docs also show "sources/github-owner-repo": look that up).
  const repoOf = (src = '') => {
    if (src.startsWith('sources/github/')) return src.slice('sources/github/'.length)
    const hit = [...sources.values()].find((x) => x.name === src)
    return hit?.githubRepo ? `${hit.githubRepo.owner}/${hit.githubRepo.repo}` : null
  }
  const task = (s) => {
    const pr = (s.outputs || []).map((o) => o.pullRequest).find(Boolean)
    const repo = repoOf(s.sourceContext?.source)
    return {
      id: s.id || String(s.name || '').replace(/^sessions\//, ''),
      title: s.title || '',
      status: status(s.state),
      state: s.state || 'QUEUED',
      repo,
      branch: pr?.headRef || s.sourceContext?.githubRepoContext?.startingBranch || null,
      base: s.sourceContext?.githubRepoContext?.startingBranch || null,
      url: s.url || null,
      prUrl: pr?.url || null,
      createdAt: s.createTime || null,
      updatedAt: s.updateTime || null,
      summary: '',
      ask: s.state === 'AWAITING_PLAN_APPROVAL' ? 'Jules has a plan for you to approve' : null,
      approveLabel: s.state === 'AWAITING_PLAN_APPROVAL' ? 'Approve plan' : null,
      prompt: s.prompt || '',
    }
  }
  async function allSources() {
    const out = []
    let pageToken
    for (let i = 0; i < 5; i++) {
      const r = await call('GET', '/v1alpha/sources', { query: { pageSize: 100, pageToken } })
      out.push(...(r?.sources || []))
      pageToken = r?.nextPageToken
      if (!pageToken) break
    }
    for (const s of out) if (s.githubRepo) sources.set(`${s.githubRepo.owner}/${s.githubRepo.repo}`, s)
    return out
  }
  async function sourceOf(repo) {
    const name = repoName(repo)
    if (!name) throw new CloudError('Pick one of your repos connected to Jules')
    if (!sources.has(name)) {
      try { const s = await call('GET', `/v1alpha/sources/github/${name.split('/').map(encodeURIComponent).join('/')}`); if (s?.githubRepo) sources.set(name, s) } catch { await allSources() }
    }
    const s = sources.get(name)
    if (!s) throw new CloudError(`${name} isn't connected to Jules. Connect it at jules.google.com first.`)
    return s
  }
  async function activities(id) {
    const c = acts.get(id) || { list: [], last: null }
    let pageToken
    const fresh = []
    for (let i = 0; i < 10; i++) {
      const r = await call('GET', `/v1alpha/sessions/${sid(id)}/activities`, { query: { pageSize: 100, pageToken, createTime: c.last || undefined } })
      fresh.push(...(r?.activities || []))
      pageToken = r?.nextPageToken
      if (!pageToken) break
    }
    const have = new Set(c.list.map((a) => a.id || a.name))
    const list = [...c.list, ...fresh.filter((a) => !have.has(a.id || a.name))].sort((a, b) => String(a.createTime || '').localeCompare(String(b.createTime || '')))
    acts.set(id, { list, last: list.at(-1)?.createTime || c.last })
    return list
  }

  return {
    info,
    async check() {
      await call('GET', '/v1alpha/sources', { query: { pageSize: 1 } })
      return { ok: true, account: null }
    },
    async repos() {
      return (await allSources()).filter((s) => s.githubRepo).map((s) => ({
        name: `${s.githubRepo.owner}/${s.githubRepo.repo}`, url: `https://github.com/${s.githubRepo.owner}/${s.githubRepo.repo}`,
        defaultBranch: s.githubRepo.defaultBranch?.displayName || null, private: !!s.githubRepo.isPrivate,
      }))
    },
    async branches(repo) {
      const s = await sourceOf(repo)
      const all = (s.githubRepo?.branches || []).map((b) => b.displayName).filter(Boolean)
      const def = s.githubRepo?.defaultBranch?.displayName
      return def ? [def, ...all.filter((b) => b !== def)] : all
    },
    async launch({ repo, branch, prompt, approvePlan = false }) {
      const text = String(prompt || '').trim()
      if (!text) throw new CloudError('Write what Jules should do')
      const s = await sourceOf(repo)
      const startingBranch = branch || s.githubRepo?.defaultBranch?.displayName || 'main'
      const r = await call('POST', '/v1alpha/sessions', { body: {
        prompt: text,
        sourceContext: { source: s.name, githubRepoContext: { startingBranch } },
        automationMode: 'AUTO_CREATE_PR',
        requirePlanApproval: !!approvePlan,
      } })
      return { ...task(r), repo: repoName(repo), base: startingBranch, branch: startingBranch }
    },
    async list() {
      const r = await call('GET', '/v1alpha/sessions', { query: { pageSize: 50 } })
      return (r?.sessions || []).map(task)
    },
    async get(id, { messages = true } = {}) {
      const s = await call('GET', `/v1alpha/sessions/${sid(id)}`)
      const out = task(s)
      if (!messages) return out
      let list = []
      // Right after a session starts its activities can briefly be missing.
      try { list = await activities(out.id) } catch (e) { if (e.status !== 404) throw e }
      const msgs = [{ id: `${out.id}:prompt`, role: 'user', text: out.prompt, ts: out.createdAt }, ...list.map(entry).filter(Boolean)]
      if (out.prUrl) msgs.push({ id: `pr:${out.prUrl}`, role: 'event', status: 'completed', text: `Pull request: ${out.prUrl}`, ts: out.updatedAt })
      const lastAgent = [...msgs].reverse().find((m) => m.role === 'assistant')
      if (out.status === 'blocked' && s.state === 'AWAITING_USER_FEEDBACK' && lastAgent) out.ask = oneLine(lastAgent.text, 300)
      return { ...out, messages: msgs.filter((m) => m.text || m.tool) }
    },
    async send(id, text) {
      const t = String(text || '').trim()
      if (!t) throw new CloudError('Empty message')
      await call('POST', `/v1alpha/sessions/${sid(id)}:sendMessage`, { body: { prompt: t } })
      return { ok: true }
    },
    async approve(id) {
      await call('POST', `/v1alpha/sessions/${sid(id)}:approvePlan`, { body: {} })
      return { ok: true }
    },
  }
}
