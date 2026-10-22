// Own branch: an agent can work in its own git worktree, on a new branch, so several agents can
// change one repo at once without editing the same checkout. Worktrees live in the data folder,
// <data>/worktrees/<repo>-<hash>/<name>, never inside the repo, so they can't be committed by
// accident. <data>/worktrees.json remembers the ones Bridge AI made (to tidy up when their agent
// closes and bring back on resume) and, per repo, whether you use an own branch there and the
// setup command to run in a new one (kept here, never in the repo).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { DATA, dataFile, ensureDir } from './paths.js'

const FILE = dataFile('worktrees.json')
// Read once and kept: the fleet asks which agents are in one every few seconds.
let memo = null
const load = () => {
  if (memo) return memo
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); memo = { repos: d.repos || {}, trees: d.trees || {} } } catch { memo = { repos: {}, trees: {} } }
  return memo
}
const save = (d) => { memo = d; ensureDir(DATA); fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', { mode: 0o600 }) }

// git, resolving { ok, out } (its output, or what went wrong) instead of throwing. It enters the
// folder itself (-C), so a folder macOS is still asking about holds only git, not the server.
const git = (cwd, args, input = '') => new Promise((resolve) => {
  const p = execFile('git', cwd ? ['-C', cwd, ...args] : args, { timeout: 60000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: err ? String(stderr || err.message).trim() : stdout }))
  p.stdin.end(input)
})
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9._-]+/g, '-').replace(/[-.]{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 40) || 'agent'
// Repos are in your folders, which macOS can hold a look into until you answer its permission
// prompt: those are only ever checked without blocking. Worktrees are in the data folder.
const real = (p) => fs.promises.realpath(p).catch(() => path.resolve(p))
const exists = (p) => fs.promises.access(p).then(() => true, () => false)
const hasBranch = async (cwd, name) => (await git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])).ok
const wantOf = (branch, label) => String(branch || '').trim() || `bridge/${slug(label)}`

// The repo a folder is in: the top of its checkout, the main checkout (every worktree shares it),
// and the branch it's on. null outside git.
async function repoOf(dir) {
  const r = await git(dir, ['rev-parse', '--show-toplevel', '--path-format=absolute', '--git-common-dir'])
  if (!r.ok) return null
  const [top, common] = r.out.trim().split('\n').map((p) => path.resolve(p))
  const branch = (await git(dir, ['symbolic-ref', '--short', '-q', 'HEAD'])).out.trim() || null
  return { top, main: path.basename(common) === '.git' ? path.dirname(common) : common, branch }
}

// `want`, or the first of want-2, want-3... that isn't a branch yet. null if git won't take the name.
async function freeBranch(cwd, want) {
  if (!(await git(cwd, ['check-ref-format', '--branch', want])).ok) return null
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? want : `${want}-${i}`
    if (!(await hasBranch(cwd, name))) return name
  }
  return null
}

// What the new agent dialog needs for a folder: null outside git; otherwise the repo, its
// branches, what you chose there last time, and the branch name a launch would use.
export async function info(dir, { branch, label } = {}) {
  const repo = await repoOf(dir)
  if (!repo) return { repo: null }
  const prefs = load().repos[repo.main] || {}
  const heads = await git(repo.top, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'])
  const branches = heads.ok ? heads.out.split('\n').filter(Boolean).slice(0, 100) : []
  return {
    repo: repo.main, name: path.basename(repo.main), current: repo.branch, branches,
    own: !!prefs.own, setup: prefs.setup || '', include: await exists(path.join(repo.top, '.worktreeinclude')),
    branch: await freeBranch(repo.top, wantOf(branch, label)),
  }
}

// The dialog's choices for this repo, for next time.
export async function remember(dir, { own, setup }) {
  const repo = await repoOf(dir)
  if (!repo) return
  const d = load()
  d.repos[repo.main] = { ...d.repos[repo.main], own: !!own, ...(setup != null ? { setup: String(setup).trim().slice(0, 500) } : {}) }
  save(d)
}
// The repo's setup command, to run at the top of a new worktree: { command, cwd }, or null.
const setupFor = (main, folder) => (load().repos[main]?.setup ? { command: load().repos[main].setup, cwd: folder } : null)

// Ignored files the repo lists in .worktreeinclude (gitignore patterns, the convention Claude
// Code uses), such as .env: git leaves them out of a new checkout, so they're copied in. A file
// has to match a pattern and be ignored by git, so nothing tracked is ever overwritten.
async function copyIncluded(from, to) {
  const list = path.join(from, '.worktreeinclude')
  if (!(await exists(list))) return 0
  const match = await git(from, ['ls-files', '--others', '--ignored', `--exclude-from=${list}`, '-z'])
  if (!match.ok || !match.out) return 0
  const ignored = await git(from, ['check-ignore', '--stdin', '-z'], match.out)
  let n = 0
  for (const rel of (ignored.ok ? ignored.out : '').split('\0').filter(Boolean)) {
    try {
      await fs.promises.mkdir(path.dirname(path.join(to, rel)), { recursive: true })
      await fs.promises.cp(path.join(from, rel), path.join(to, rel), { force: false, errorOnExist: false, verbatimSymlinks: true })
      n++
    } catch { /* unreadable: skip it */ }
  }
  return n
}

// A new worktree on a new branch (`branch`, or bridge/<label>; a number is added if it's taken)
// from `base` (default: the folder's current branch). Returns where the agent starts: the same
// subfolder of the new checkout as `dir` is of its own.
export async function create(dir, { branch, base, label } = {}) {
  const repo = await repoOf(dir)
  if (!repo) throw new Error("Own branch needs a folder in a git repository")
  const want = wantOf(branch, label)
  const name = await freeBranch(repo.top, want)
  if (!name) throw new Error(`"${want}" can't be a branch name`)
  // From the branch you picked, else the current one, else (detached) the current commit.
  const from = String(base || '').trim() || repo.branch || (await git(repo.top, ['rev-parse', '--verify', '-q', 'HEAD'])).out.trim()
  if (!from || from.startsWith('-') || /\s/.test(from) || !(await git(repo.top, ['rev-parse', '--verify', '-q', `${from}^{commit}`])).ok) throw new Error(`There's no commit to start from${from && !/\s/.test(from) ? ` on ${from}` : ''}`)
  const parent = ensureDir(path.join(await real(ensureDir(path.join(DATA, 'worktrees'))), `${slug(path.basename(repo.main))}-${crypto.createHash('sha1').update(repo.main).digest('hex').slice(0, 6)}`))
  let folder = path.join(parent, slug(name.replace(/^bridge\//, '')))
  for (let i = 2; fs.existsSync(folder); i++) folder = path.join(parent, `${slug(name.replace(/^bridge\//, ''))}-${i}`)
  const r = await git(repo.top, ['worktree', 'add', '-b', name, folder, from])
  if (!r.ok) {
    try { fs.rmdirSync(parent) } catch { /* it has other worktrees */ }
    throw new Error(`git couldn't make the worktree: ${r.out.split('\n').pop()}`)
  }
  const copied = await copyIncluded(repo.top, folder)
  const d = load()
  d.trees[folder] = { repo: repo.main, from: repo.top, branch: name, base: from, createdAt: new Date().toISOString() }
  save(d)
  const sub = path.join(folder, path.relative(repo.top, await real(dir)))
  return { cwd: fs.existsSync(sub) ? sub : folder, folder, branch: name, base: from, copied, setup: setupFor(repo.main, folder) }
}

// The Bridge-made worktree a folder is in (the folder itself or one inside it), or null.
export function folderOf(cwd) {
  if (!cwd) return null
  const p = path.resolve(cwd)
  return Object.keys(load().trees).find((f) => p === f || p.startsWith(f + path.sep)) || null
}
// Branch, base and repo for each agent folder that's in one, for the sidebar and the chief.
export function describe(cwd) {
  const f = folderOf(cwd)
  const t = f && load().trees[f]
  return t ? { folder: f, repo: t.repo, branch: t.branch, base: t.base } : null
}

// After its agent closes: remove the worktree when nothing would be lost, that is no uncommitted
// changes and no commits that aren't on a remote or its base branch. The branch stays either way.
export async function tidy(folder) {
  const t = load().trees[folder]
  if (!t || !fs.existsSync(folder)) return null
  const keep = (why) => ({ folder, branch: t.branch, kept: why })
  const st = await git(folder, ['status', '--porcelain'])
  if (!st.ok) return keep("git couldn't check it")
  const changed = st.out.split('\n').filter(Boolean).length
  if (changed) return keep(`${changed} uncommitted change${changed === 1 ? '' : 's'}`)
  const ahead = await git(folder, ['rev-list', '--count', 'HEAD', '--not', '--remotes', t.base, '--'])
  if (!ahead.ok) return keep("git couldn't check it")
  const n = Number(ahead.out.trim())
  if (n) return keep(`${n} commit${n === 1 ? '' : 's'} not pushed or on ${t.base}`)
  const r = await git(t.repo, ['worktree', 'remove', folder])
  if (!r.ok) return keep(r.out.split('\n').pop())
  try { fs.rmdirSync(path.dirname(folder)) } catch { /* other worktrees of this repo are still there */ }
  return { folder, branch: t.branch, removed: true }
}

// Resuming an agent whose worktree was removed when it closed: check its branch out again at the
// same folder (agents file their conversations by folder path), with the same files copied in.
// Returns the repo's setup command when it did, so the agent's terminal runs that first.
export async function restore(cwd) {
  const folder = folderOf(cwd)
  if (!folder || fs.existsSync(folder)) return null
  const t = load().trees[folder]
  if (!(await exists(t.repo))) throw new Error(`Its repository is gone: ${t.repo}`)
  await git(t.repo, ['worktree', 'prune'])
  if (!(await hasBranch(t.repo, t.branch))) throw new Error(`Its branch ${t.branch} is gone`)
  const r = await git(t.repo, ['worktree', 'add', folder, t.branch])
  if (!r.ok) throw new Error(`git couldn't bring back its worktree: ${r.out.split('\n').pop()}`)
  await copyIncluded((await exists(t.from)) ? t.from : t.repo, folder)
  return { folder, branch: t.branch, setup: setupFor(t.repo, folder) }
}
