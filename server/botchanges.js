// A bot's changes (Bots, a beta feature: frontdesk.js, with changes set to suggest or pr): what
// someone asks it to change is made by its agent in a git worktree of the repository, its own copy
// on a branch of its own (bot/<bot>/<thread>), in the data folder, never in your checkout. The agent
// can only edit there (agents.js access 'change': no shell, no network, edits outside it refused).
// Bridge AI, not the agent, then commits what it changed, pushes the branch, and opens a draft pull
// request with your own gh: suggest waits for you to approve the diff first, pr opens it at once.
// It never merges, never pushes anything but a bot/ branch, and never writes the default branch.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { gitReady, NO_GIT } from './gitready.js'
import { loginPath, which } from './agents.js'
import { launch } from './consult.js'

const run = (bin, args, { cwd, input = '', env, timeout = 60000 } = {}) => new Promise((resolve) => {
  const p = (bin === 'git' ? execFile : launch)(bin, args, { cwd, env, timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err?.message || '').trim() }))
  p.stdin?.on('error', () => {})
  p.stdin?.end(input)
})
const git = async (dir, args, o = {}) => (!(await gitReady()) ? { ok: false, out: '', err: NO_GIT } : run('git', ['-C', dir, ...args], o))
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'bot'
const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-2).join(' ').slice(0, 300)
export const DIFF_MAX = 200000 // a diff kept beside the record, in characters
export const branchOf = (botName, thread) => `bot/${slug(botName)}/${slug(String(thread).replace(/\./g, '-'))}`

// The repository a folder is in: its top, the remote to push to, and the branch pull requests go
// into (what the remote calls its default, else main or master, else what's checked out). null
// when it isn't one, with why.
export async function repoOf(dir) {
  const top = await git(dir, ['rev-parse', '--show-toplevel'])
  if (!top.ok) return { problem: top.err === NO_GIT ? NO_GIT : 'isn\'t a git repository' }
  const t = path.resolve(top.out)
  const remotes = (await git(t, ['remote'])).out.split('\n').filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0] || null
  let base = remote ? (await git(t, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`])).out.replace(`${remote}/`, '') : ''
  if (!base) for (const b of ['main', 'master']) if ((await git(t, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`])).ok || (remote && (await git(t, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${b}`])).ok)) { base = b; break }
  if (!base) base = (await git(t, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).out || 'main'
  return { top: t, remote, base, problem: remote ? null : 'has no remote to push a branch to' }
}

// Where a folder's files are on GitHub, for an answer to link them: the address of the folder on
// the default branch (a file's path and #L<line> after it), or null when its remote isn't GitHub.
export async function githubOf(dir) {
  const r = await repoOf(dir)
  if (!r.top || !r.remote) return null
  const url = (await git(r.top, ['remote', 'get-url', r.remote])).out
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url)
  if (!m) return null
  const rel = path.relative(r.top, path.resolve(dir)).split(path.sep).filter(Boolean).map(encodeURIComponent).join('/')
  return `https://github.com/${m[1]}/${m[2]}/blob/${encodeURIComponent(r.base)}/${rel ? `${rel}/` : ''}`
}

// Its own copy for one conversation: a worktree at `dir`, on its branch, made from the default
// branch as the remote has it (or as it's here), or, when this conversation made the branch
// already, on that branch again, so a follow-up adds to the same pull request.
export async function prepare({ repo, dir, branch }) {
  const r = await repoOf(repo)
  if (!r.top) throw Object.assign(new Error(`${repo} ${r.problem}`), { step: 'worktree' })
  if (!branch.startsWith('bot/') || branch === r.base) throw Object.assign(new Error(`Won't work on ${branch}`), { step: 'worktree' })
  if (r.remote) await git(r.top, ['fetch', '--quiet', r.remote, r.base], { timeout: 30000 }) // (offline: what's here)
  const has = (await git(r.top, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])).ok
  const from = r.remote && (await git(r.top, ['rev-parse', '--verify', '--quiet', `refs/remotes/${r.remote}/${r.base}`])).ok ? `${r.remote}/${r.base}` : r.base
  fs.rmSync(dir, { recursive: true, force: true })
  await git(r.top, ['worktree', 'prune'])
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  const made = has ? await git(r.top, ['worktree', 'add', dir, branch]) : await git(r.top, ['worktree', 'add', '-b', branch, dir, from])
  if (!made.ok) throw Object.assign(new Error(`Couldn't make its copy of the repository: ${firstLine(made.err)}`), { step: 'worktree' })
  const start = (await git(dir, ['rev-parse', 'HEAD'])).out
  return { dir, branch, base: r.base, from, remote: r.remote, top: r.top, start, again: has }
}

// What the agent changed in its copy, committed by Bridge AI with your git name (the asker named in
// the message): { changed, files, stat, diff }. Nothing changed: nothing committed.
export async function collect(c, { message }) {
  const st = await git(c.dir, ['status', '--porcelain'])
  if (!st.ok) throw Object.assign(new Error(`Couldn't read what it changed: ${firstLine(st.err)}`), { step: 'commit' })
  if (st.out) {
    await git(c.dir, ['add', '-A'])
    const done = await git(c.dir, ['commit', '--no-verify', '-q', '-F', '-'], { input: message })
    if (!done.ok) throw Object.assign(new Error(/tell me who you are|user\.email/i.test(done.err) ? 'git doesn\'t know your name and email: set them with git config --global user.name and user.email' : `Couldn't commit it: ${firstLine(done.err)}`), { step: 'commit' })
  }
  const head = (await git(c.dir, ['rev-parse', 'HEAD'])).out
  if (!st.out && head === c.start) return { changed: false, files: [], stat: '', diff: '' }
  const range = `${c.from}...HEAD`
  const files = (await git(c.dir, ['diff', '--name-only', range])).out.split('\n').filter(Boolean)
  const stat = (await git(c.dir, ['diff', '--shortstat', range])).out
  const diff = (await git(c.dir, ['diff', '--no-color', range])).out.slice(0, DIFF_MAX)
  return { changed: files.length > 0, files, stat, diff, head }
}

// The branch pushed (that branch only, never forced) and a draft pull request opened with your gh,
// or the one this branch has already: { url, number, again }.
export async function publish(c, { title, body }) {
  if (!c.branch.startsWith('bot/') || c.branch === c.base) throw Object.assign(new Error(`Won't push ${c.branch}`), { step: 'push' })
  if (!c.remote) throw Object.assign(new Error('The repository has no remote to push the branch to'), { step: 'push' })
  const pushed = await git(c.dir, ['push', '--quiet', '-u', c.remote, `refs/heads/${c.branch}:refs/heads/${c.branch}`], { timeout: 120000 })
  if (!pushed.ok) throw Object.assign(new Error(`Couldn't push ${c.branch}: ${firstLine(pushed.err)}`), { step: 'push' })
  const PATH = await loginPath()
  const gh = await which('gh', PATH)
  if (!gh) throw Object.assign(new Error('GitHub\'s gh isn\'t installed, so the pull request couldn\'t be opened (the branch is pushed)'), { step: 'pr' })
  const env = { ...process.env, PATH, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' }
  const x = await run(gh, ['pr', 'create', '--draft', `--title=${String(title).slice(0, 200)}`, '--body-file=-', `--base=${c.base}`, `--head=${c.branch}`], { cwd: c.dir, input: String(body || ''), env, timeout: 120000 })
  const urlIn = (s) => String(s || '').split(/\s+/).find((w) => /^https?:\/\/\S+\/pull\/\d+/.test(w)) || null
  let url = x.ok ? urlIn(x.out) : /already exists/i.test(x.err) ? urlIn(x.err) : null
  if (!url && /already exists/i.test(x.err)) { const v = await run(gh, ['pr', 'view', c.branch, '--json', 'url', '-q', '.url'], { cwd: c.dir, env }); url = v.ok ? urlIn(v.out) : null }
  if (!url) throw Object.assign(new Error(/gh auth login|not logged in|authentication|HTTP 401/i.test(x.err) ? 'gh isn\'t signed in to GitHub, so the pull request couldn\'t be opened (the branch is pushed)' : `Couldn't open the pull request: ${firstLine(x.err || x.out)}`), { step: 'pr' })
  return { url, number: Number(/\/pull\/(\d+)/.exec(url)?.[1]) || null, again: !x.ok }
}

// Its copy gone (the branch stays, for a follow-up and for its pull request).
// Never fails: a folder still in use (on Windows, while its agent's tab is still open) is tried
// again in a minute, and git forgets a worktree whose folder has gone.
export async function tidy(c, again = 2) {
  if (!c?.dir) return
  if (c.top) await git(c.top, ['worktree', 'remove', '--force', c.dir])
  try { fs.rmSync(c.dir, { recursive: true, force: true }) } catch {
    if (again > 0) setTimeout(() => { tidy(c, again - 1).catch(() => {}) }, 60000).unref?.()
  }
  if (c.top) await git(c.top, ['worktree', 'prune'])
}
// Whether gh is there, for Settings.
export const hasGh = async () => !!(await which('gh', await loginPath()))
