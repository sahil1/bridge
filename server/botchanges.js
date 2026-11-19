// A bot's changes (Bots, a beta feature: frontdesk.js, with changes set to suggest or pr): what
// someone asks it to change is made by its agent in a git worktree of the repository, its own copy
// on a branch of its own (bot/<bot>/<thread>), in the data folder, never in your checkout. The agent
// can only edit there (agents.js access 'change': no shell, no network, edits outside it refused).
// Bridge AI, not the agent, then commits what it changed, pushes the branch, and opens a draft pull
// request with your own gh: suggest waits for you to approve the diff first, pr opens it at once.
// It never merges, never pushes anything but a bot/ branch, and never writes the default branch.
//
// The worktree is the agent's to write in, so nothing in it is trusted when Bridge AI runs git on
// it: git is pointed at the worktree's own folder in your repository (--git-dir, never the .git file
// in the worktree, which has to be exactly the one git wrote), with no hooks, no file-system monitor
// and no attributes file of yours beyond the repository's; a .gitattributes the agent added or changed
// (which could name a filter or diff program) means nothing is taken. gh runs in your checkout.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { gitReady, gitNothing, NO_GIT } from './gitready.js'
import { loginPath, which } from './agents.js'
import { launch } from './consult.js'

// (raw: what it said as it said it, for a -z list, whose first line can start with a space.)
const run = (bin, args, { cwd, input = '', env, timeout = 60000, raw = false } = {}) => new Promise((resolve) => {
  const p = (bin === 'git' ? execFile : launch)(bin, args, { cwd, env, timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: raw ? String(stdout || '') : String(stdout || '').trim(), err: String(stderr || err?.message || '').trim() }))
  p.stdin?.on('error', () => {})
  p.stdin?.end(input)
})
// (Whatever git is run on: none of the repository's hooks (an empty folder of Bridge AI's own as its
// hooks folder), no file-system monitor, no attributes but the repository's own (an empty file as
// yours, none of the system's). gitNothing throws when they can't be made: then git isn't run.)
const SAFE = () => { const none = gitNothing(); return ['-c', `core.hooksPath=${none.hooks}`, '-c', 'core.fsmonitor=false', '-c', `core.attributesFile=${none.attributes}`] }
const ENV = () => ({ ...process.env, GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' })
const safely = async (args, o) => {
  if (!(await gitReady())) return { ok: false, out: '', err: NO_GIT }
  let safe
  try { safe = SAFE() } catch (e) { return { ok: false, out: '', err: e.message } }
  return run('git', [...safe, ...args], { env: ENV(), ...o })
}
const git = (dir, args, o = {}) => safely(['-C', dir, ...args], o)
// git on the agent's worktree: its own folder in your repository named outright, so a .git file the
// agent wrote is never followed. c: { dir, admin } (adminOf).
const wt = (c, args, o = {}) => safely([`--git-dir=${c.admin}`, `--work-tree=${c.dir}`, '-C', c.dir, ...args], o)
// (Two paths to the same place, as the file system says: each by its real path, so a drive letter's
// case, an 8.3 short name or / for \ on Windows, or a link on the way, is the same place. One that
// isn't there is no place.)
const realOf = (p) => { try { return fs.realpathSync.native(p) } catch { return null } }
const samePlace = (a, b) => { const x = realOf(a); return !!x && x === realOf(b) }
// The worktree's own folder in the repository it's a worktree of (<repository>/.git/worktrees/<name>),
// found from the repository's side: the one whose gitdir names this worktree. null when there's none.
export async function adminOf(top, dir) {
  const common = await git(top, ['rev-parse', '--git-common-dir'])
  if (!common.ok) return null
  const root = path.resolve(top, common.out)
  const want = path.resolve(dir, '.git')
  for (const name of fs.existsSync(path.join(root, 'worktrees')) ? fs.readdirSync(path.join(root, 'worktrees')) : []) {
    const admin = path.join(root, 'worktrees', name)
    try { if (samePlace(path.resolve(admin, fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim()), want)) return admin } catch { /* not this one */ }
  }
  return null
}
// Before git touches what the agent changed: its .git as git wrote it (a file naming that folder,
// nothing else), and no .gitattributes it added or changed. Throws, saying why.
async function trusted(c) {
  const fail = (why) => { throw Object.assign(new Error(`Its copy's git files were changed, so nothing was taken: ${why}`), { step: 'commit' }) }
  if (!c.admin) fail('its worktree isn\'t known to the repository any more')
  const st = fs.lstatSync(path.join(c.dir, '.git'), { throwIfNoEntry: false })
  if (!st?.isFile()) fail('.git isn\'t the file git made')
  const said = /^gitdir:\s*(.+)$/.exec(fs.readFileSync(path.join(c.dir, '.git'), 'utf8').trim())?.[1]
  if (!said || !samePlace(path.resolve(c.dir, said), c.admin)) fail('.git points somewhere else')
  const found = []
  const look = (d, depth = 0) => {
    if (depth > 30) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.toLowerCase() === '.git' || e.isSymbolicLink()) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) look(p, depth + 1)
      else if (e.name.toLowerCase() === '.gitattributes') found.push(path.relative(c.dir, p).split(path.sep).join('/'))
    }
  }
  look(c.dir)
  // (Its lines' ends aside: git on Windows checks a file out with \r\n where the repository has \n
  // (core.autocrlf), and reads a \r before a line's end as nothing, so those alone aren't a change.
  // Any other \r is.)
  const lines = (s) => String(s).replace(/\r\n/g, '\n').trim()
  for (const rel of found) {
    const was = await wt(c, ['cat-file', 'blob', `HEAD:${rel}`])
    if (!was.ok || lines(was.out) !== lines(fs.readFileSync(path.join(c.dir, ...rel.split('/')), 'utf8'))) fail(`${rel} was added or changed`)
  }
}
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
  const admin = await adminOf(r.top, dir)
  const start = (await wt({ dir, admin }, ['rev-parse', 'HEAD'])).out
  return { dir, branch, base: r.base, from, remote: r.remote, top: r.top, admin, start, again: has }
}

// What the agent changed in its copy, committed by Bridge AI with your git name (the asker named in
// the message): { changed, files, stat, diff }. Nothing changed: nothing committed. checked(kind,
// path): whether the run's hook let that file be written (botwrite.js guardCheck); one it never saw
// means nothing is taken.
export async function collect(c0, { message, checked = null }) {
  const c = { ...c0, admin: c0.admin || await adminOf(c0.top, c0.dir) }
  await trusted(c)
  const st = await wt(c, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], { raw: true })
  if (!st.ok) throw Object.assign(new Error(`Couldn't read what it changed: ${firstLine(st.err)}`), { step: 'commit' })
  if (checked) {
    const real = fs.realpathSync.native(c.dir)
    const unseen = st.out.split('\0').filter(Boolean).filter((l) => !l.slice(0, 2).includes('D')).map((l) => l.slice(3)).filter((rel) => !checked('w', path.join(real, ...rel.split('/'))))
    if (unseen.length) throw Object.assign(new Error(`It changed ${unseen.slice(0, 3).join(', ')} without going through the checks every change goes through, so nothing was taken`), { step: 'commit' })
  }
  if (st.out) {
    await wt(c, ['add', '-A'])
    const done = await wt(c, ['commit', '--no-verify', '-q', '-F', '-'], { input: message })
    if (!done.ok) throw Object.assign(new Error(/tell me who you are|user\.email/i.test(done.err) ? 'git doesn\'t know your name and email: set them with git config --global user.name and user.email' : `Couldn't commit it: ${firstLine(done.err)}`), { step: 'commit' })
  }
  const head = (await wt(c, ['rev-parse', 'HEAD'])).out
  if (!st.out && head === c.start) return { changed: false, files: [], stat: '', diff: '' }
  const range = `${c.from}...HEAD`
  const files = (await wt(c, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', range])).out.split('\n').filter(Boolean)
  const stat = (await wt(c, ['diff', '--no-ext-diff', '--no-textconv', '--shortstat', range])).out
  const diff = (await wt(c, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', range])).out.slice(0, DIFF_MAX)
  return { changed: files.length > 0, files, stat, diff, head }
}

// The branch pushed (that branch only, never forced) and a draft pull request opened with your gh,
// or the one this branch has already: { url, number, again }.
export async function publish(c, { title, body }) {
  if (!c.branch.startsWith('bot/') || c.branch === c.base) throw Object.assign(new Error(`Won't push ${c.branch}`), { step: 'push' })
  if (!c.remote) throw Object.assign(new Error('The repository has no remote to push the branch to'), { step: 'push' })
  // (Pushed from your repository, which has the branch: nothing in the worktree is read for it.)
  const pushed = await git(c.top, ['push', '--quiet', '-u', c.remote, `refs/heads/${c.branch}:refs/heads/${c.branch}`], { timeout: 120000 })
  if (!pushed.ok) throw Object.assign(new Error(`Couldn't push ${c.branch}: ${firstLine(pushed.err)}`), { step: 'push' })
  const PATH = await loginPath()
  const gh = await which('gh', PATH)
  if (!gh) throw Object.assign(new Error('GitHub\'s gh isn\'t installed, so the pull request couldn\'t be opened (the branch is pushed)'), { step: 'pr' })
  const env = { ...process.env, PATH, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' }
  // (gh in your checkout, which it reads the repository from; never in the agent's worktree.)
  const x = await run(gh, ['pr', 'create', '--draft', `--title=${String(title).slice(0, 200)}`, '--body-file=-', `--base=${c.base}`, `--head=${c.branch}`], { cwd: c.top, input: String(body || ''), env, timeout: 120000 })
  const urlIn = (s) => String(s || '').split(/\s+/).find((w) => /^https?:\/\/\S+\/pull\/\d+/.test(w)) || null
  let url = x.ok ? urlIn(x.out) : /already exists/i.test(x.err) ? urlIn(x.err) : null
  if (!url && /already exists/i.test(x.err)) { const v = await run(gh, ['pr', 'view', c.branch, '--json', 'url', '-q', '.url'], { cwd: c.top, env }); url = v.ok ? urlIn(v.out) : null }
  if (!url) throw Object.assign(new Error(/gh auth login|not logged in|authentication|HTTP 401/i.test(x.err) ? 'gh isn\'t signed in to GitHub, so the pull request couldn\'t be opened (the branch is pushed)' : `Couldn't open the pull request: ${firstLine(x.err || x.out)}`), { step: 'pr' })
  return { url, number: Number(/\/pull\/(\d+)/.exec(url)?.[1]) || null, again: !x.ok }
}

// Its copy gone (the branch stays, for a follow-up and for its pull request).
// Never fails: a folder still in use (on Windows, while its agent's tab is still open) is tried
// again in a minute, and git forgets a worktree whose folder has gone (prune, from your repository:
// nothing in the worktree is read for it).
export async function tidy(c, again = 2) {
  if (!c?.dir) return
  try { fs.rmSync(c.dir, { recursive: true, force: true }) } catch {
    if (again > 0) setTimeout(() => { tidy(c, again - 1).catch(() => {}) }, 60000).unref?.()
  }
  if (c.top) await git(c.top, ['worktree', 'prune'])
}
// Whether gh is there, for Settings.
export const hasGh = async () => !!(await which('gh', await loginPath()))
