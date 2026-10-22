// Pull requests on GitHub, through the gh CLI you're already signed in to: the branch's pull request
// and how its checks are doing, a title and description drafted from the branch's commits, and
// opening one. gh goes over the network, so its answers are cached and the Changes tab asks rarely.
import { execFile } from 'node:child_process'
import { loginPath, which } from './agents.js'
import * as consult from './consult.js'
import { safePath, push } from './files.js'
import { IS_WIN } from './paths.js'
import { gitReady } from './gitready.js'

// A program run in the repo goes through a shell that enters the folder once it has started: on
// macOS the server waits while a new program enters its folder, so a folder macOS is still asking
// about (your Desktop, say) would freeze everything, not just this call.
const inFolder = (cwd, bin, args) => (cwd && !IS_WIN ? ['/bin/sh', ['-c', 'cd -- "$1" && shift && exec "$@"', 'sh', cwd, bin, ...args], undefined] : [bin, args, cwd])
const run = (bin, args, { cwd, input = '', env, timeout = 30000 } = {}) => new Promise((resolve) => {
  const [file, argv, dir] = inFolder(cwd, bin, args)
  const p = execFile(file, argv, { cwd: dir, env, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err?.message || '').trim() }))
  p.stdin?.end(input)
})
const git = async (cwd, args) => { if (!(await gitReady())) return null; const r = await run('git', args, { cwd, timeout: 15000 }); return r.ok ? r.out : null }
const ghPath = async () => which('gh', await loginPath())
async function gh(cwd, args, input = '') {
  const bin = await ghPath()
  if (!bin) throw new Error("GitHub's gh isn't installed")
  return run(bin, args, { cwd, input, env: { ...process.env, PATH: await loginPath(), GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' } })
}

// The repo, branch and remote a pull request would come from (the branch's upstream, else origin).
async function repoInfo(root) {
  const { realRoot } = await safePath(root, '')
  const top = await git(realRoot, ['rev-parse', '--show-toplevel'])
  if (!top) return null
  const branch = await git(top, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const remotes = (await git(top, ['remote']) || '').split('\n').filter(Boolean)
  const up = branch && await git(top, ['config', '--get', `branch.${branch}.remote`])
  const remote = remotes.includes(up) ? up : remotes.includes('origin') ? 'origin' : remotes[0] || null
  const url = remote ? await git(top, ['remote', 'get-url', remote]) : null
  const host = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)/i.exec(url || '')?.[1] || ''
  return { top, branch, remote, github: /github/i.test(host) }
}

// The branch pull requests go into: what the remote calls its default (known locally after a
// clone), else what GitHub says, else main or master.
const bases = new Map() // repo folder -> { at, base }
async function defaultBase(r) {
  const hit = bases.get(r.top)
  if (hit && Date.now() - hit.at < 3600_000) return hit.base
  let base = (await git(r.top, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${r.remote}/HEAD`]))?.slice(r.remote.length + 1) || null
  if (!base && r.github && await ghPath()) {
    const x = await gh(r.top, ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'])
    if (x.ok && x.out) base = x.out
  }
  if (!base) for (const b of ['main', 'master']) if (await baseRef(r, b)) { base = b; break }
  base ||= 'main'
  bases.set(r.top, { at: Date.now(), base })
  return base
}
// The base branch as the remote has it if we know, else the local one.
async function baseRef(r, base) {
  for (const ref of [`refs/remotes/${r.remote}/${base}`, `refs/heads/${base}`]) if (await git(r.top, ['rev-parse', '--verify', '--quiet', ref])) return ref
  return null
}

// Passed, failed and still running, from gh's statusCheckRollup (check runs and commit statuses).
function checks(list) {
  const c = { pass: 0, fail: 0, pending: 0 }
  for (const x of list || []) {
    const s = String(x.conclusion || x.state || '').toUpperCase()
    if ((x.status && x.status !== 'COMPLETED') || !s || /PENDING|EXPECTED|QUEUED|IN_PROGRESS|WAITING/.test(s)) c.pending++
    else if (/SUCCESS|NEUTRAL|SKIPPED/.test(s)) c.pass++
    else c.fail++
  }
  return c
}

// The pull request for the branch you're on. A minute's cache while it's open (checks move),
// a few minutes otherwise; opening one from here clears it.
const prs = new Map() // `${repo}\n${branch}` -> { at, ttl, data }
const inflight = new Map()
export async function status(root, { refresh = false } = {}) {
  const r = await repoInfo(root)
  if (!r?.branch || !r.remote) return { github: false, gh: false }
  const bin = await ghPath()
  if (!r.github || !bin) return { github: r.github, gh: !!bin }
  const key = `${r.top}\n${r.branch}`
  const hit = prs.get(key)
  if (!refresh && hit && Date.now() - hit.at < hit.ttl) return hit.data
  if (inflight.has(key)) return inflight.get(key)
  const p = (async () => {
    const base = await defaultBase(r)
    // On the base branch itself there's no pull request to look for.
    const x = r.branch === base ? { ok: false, err: 'no pull requests found' } : await gh(r.top, ['pr', 'view', r.branch, '--json', 'number,state,url,title,isDraft,statusCheckRollup'])
    let pr = null
    let error = null
    if (x.ok) {
      try { const j = JSON.parse(x.out); pr = { number: j.number, state: j.state, url: j.url, title: j.title, draft: !!j.isDraft, checks: checks(j.statusCheckRollup) } } catch { error = "Couldn't read gh's answer" }
    } else if (!/no (open )?pull requests? found/i.test(x.err)) error = ghError(x.err)
    // signIn: gh needs signing in to GitHub (the app offers it in a terminal tab).
    const data = { github: true, gh: true, branch: r.branch, base, pr, error, signIn: !x.ok && AUTH.test(x.err) }
    prs.set(key, { at: Date.now(), ttl: pr?.state === 'OPEN' ? 60_000 : 180_000, data })
    return data
  })().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

const AUTH = /gh auth login|not logged in|authentication|HTTP 401/i
function ghError(err) {
  if (AUTH.test(err)) return "gh isn't signed in to GitHub"
  return err.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300) || 'gh failed'
}

// Tool credits and co-author lines never go in: not from a model, not from an agent's commits.
const CREDIT = /^\s*(?:🤖\s*)?generated (?:with|by)\b|^\s*co-authored-by:|claude\.(?:ai|com)\/(?:code|claude-code)/i
const uncredit = (s) => String(s || '').split('\n').filter((l) => !CREDIT.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim()

// Title and body without a model: the commit itself when there's one, else the branch name and
// a list of the commits, oldest first.
function fromCommits(branch, commits) {
  if (commits.length === 1) return { title: commits[0].subject, body: uncredit(commits[0].body) }
  const name = branch.split('/').pop().replace(/[-_]+/g, ' ').trim()
  return { title: name.charAt(0).toUpperCase() + name.slice(1), body: commits.map((c) => `- ${c.subject}`).reverse().join('\n') }
}

// The cheapest model you can reach: an agent CLI on your own subscription (small model where it
// takes one), or a local Ollama model. Never an API key that bills per token.
const WRITERS = [['claude', 'haiku'], ['gemini'], ['gpt'], ['cursor'], ['copilot'], ['opencode'], ['qwen'], ['grok'], ['local']]
const PROMPT = `Write the title and description for a GitHub pull request from the commits and diff below.
Reply with only the title on the first line (under 70 characters, no period at the end), then a blank line, then the description in GitHub Markdown: a sentence or two on what changed and why, then a short bullet list of the notable changes if there are several. Plain and specific. No preamble, no sign-off, no mention of AI or of any tool, and no "Generated with" or "Co-authored-by" lines.`

export async function draft(root, { base } = {}) {
  const r = await repoInfo(root)
  if (!r) throw new Error("This folder isn't a git repository")
  if (!r.branch) throw new Error("You're not on a branch")
  const b = String(base || '').trim() || await defaultBase(r)
  const ref = await baseRef(r, b)
  if (!ref) throw new Error(`There's no branch called ${b} to compare with`)
  const log = await git(r.top, ['log', '--no-merges', '-n', '60', '--format=%s%x1f%b%x1e', `${ref}..HEAD`])
  const commits = (log || '').split('\x1e').map((s) => s.trim()).filter(Boolean).map((s) => { const [subject, body = ''] = s.split('\x1f'); return { subject: subject.trim(), body: body.trim() } })
  if (!commits.length) throw new Error(`${r.branch} has no commits that aren't on ${b}`)
  const plain = { ...fromCommits(r.branch, commits), base: b, commits: commits.length, via: null }
  const avail = await consult.options().catch(() => [])
  const pick = WRITERS.find(([id]) => avail.some((o) => o.id === id && o.available && (o.via === 'cli' || id === 'local')))
  if (!pick) return plain
  const stat = await git(r.top, ['diff', '--stat', `${ref}...HEAD`]) || ''
  const diff = (await git(r.top, ['diff', '--no-color', '-U2', `${ref}...HEAD`]) || '').slice(0, 30000)
  const list = commits.map((c) => `- ${c.subject}${c.body ? `\n  ${uncredit(c.body).replace(/\n/g, '\n  ')}` : ''}`).join('\n')
  const prompt = `${PROMPT}\n\nBranch ${r.branch} into ${b}.\n\nCommits (newest first):\n${list}\n\nFiles:\n${stat}\n\nDiff:\n${diff}`
  const label = `${avail.find((o) => o.id === pick[0])?.label || pick[0]}${pick[1] ? ` (${pick[1]})` : ''}`
  try {
    const a = await consult.ask({ who: pick[0], prompt, model: pick[1], via: pick[0] === 'local' ? 'api' : 'cli' })
    const lines = String(a.text || '').trim().replace(/^```\w*\n([\s\S]*?)\n```$/, '$1').split('\n')
    const title = uncredit(lines.shift().replace(/^#+\s*|^title:\s*/i, '').replace(/^["'*`]+|["'*`]+$/g, '')).slice(0, 200)
    if (!title) throw new Error('it came back empty')
    return { ...plain, title, body: uncredit(lines.join('\n').replace(/^\s*(description|body):\s*/i, '')), via: label }
  } catch (e) {
    return { ...plain, note: `${label} couldn't write it (${e.message.slice(0, 120)}), so this is from your commits` }
  }
}

// Open the pull request: push the branch first (GitHub needs its commits), then gh pr create.
export async function create(root, { title, body = '', base, draft: asDraft = false } = {}) {
  const t = String(title || '').trim()
  if (!t) throw new Error('Give the pull request a title')
  const r = await repoInfo(root)
  if (!r?.branch) throw new Error("You're not on a branch")
  if (!r.github) throw new Error("This repository's remote isn't on GitHub")
  const b = String(base || '').trim() || await defaultBase(r)
  if (b === r.branch) throw new Error(`You're on ${b} itself. Put these changes on their own branch first`)
  await push(root)
  // --flag=value, so a title that starts with "-" stays a title.
  const x = await gh(r.top, ['pr', 'create', `--title=${t}`, '--body-file=-', `--base=${b}`, `--head=${r.branch}`, ...(asDraft ? ['--draft'] : [])], String(body))
  prs.delete(`${r.top}\n${r.branch}`)
  if (!x.ok) {
    const there = /already exists:?\s*(\S+)/i.exec(x.err)?.[1]
    throw new Error(there ? `This branch already has a pull request: ${there}` : ghError(x.err))
  }
  const url = x.out.split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l)).pop() || null
  return { ok: true, url, number: Number(url?.match(/\/pull\/(\d+)/)?.[1]) || null }
}
