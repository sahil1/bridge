// Whether git can run. On a Mac without Apple's command line developer tools, /usr/bin/git is a
// stand-in that pops up macOS's "install the developer tools?" dialog each time it's run, and Bridge
// AI runs git often (each agent's branch, the Changes tab). So it's asked here first, without
// running git: the developer folder has a real git, or another git comes first on the PATH
// (Homebrew's). A "no" is asked again after 15 seconds, so installing the tools is picked up
// without a restart.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { IS_MAC, IS_WIN, dataFile } from './paths.js'

export const NO_GIT = 'Git needs Apple\'s command line developer tools, which aren\'t on this Mac yet.'

let memo = { at: 0, ok: null, pending: null }
const exists = (p) => fs.promises.access(p, fs.constants.X_OK).then(() => true, () => false)

// Apple's developer tools themselves: xcode-select only says where they are (it never offers to
// install them, unlike the programs they bring), and that folder has a real git.
async function tools() {
  const dev = await new Promise((resolve) => execFile('xcode-select', ['-p'], { timeout: 5000 }, (err, out) => resolve(err ? null : String(out).trim())))
  return !!dev && exists(path.join(dev, 'usr', 'bin', 'git'))
}

async function look() {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir || dir === '/usr/bin') continue
    if (await exists(path.join(dir, 'git'))) return true
  }
  return tools()
}

export function gitReady() {
  if (!IS_MAC) return Promise.resolve(true)
  if (memo.ok || (memo.ok === false && Date.now() - memo.at < 15_000)) return Promise.resolve(memo.ok)
  memo.pending ||= look().then((ok) => { memo = { at: Date.now(), ok, pending: null }; return ok }, () => { memo.pending = null; return true })
  return memo.pending
}

// Whether this Mac has Apple's command line developer tools (setup's Everything offers them when it
// hasn't), whatever other git it has: they also bring what agents build with (clang, make), whose
// stand-ins pop up the same dialog. Elsewhere there's nothing to install. A "no" is asked again
// after 5 seconds, so setup sees them arrive.
let toolsMemo = { at: 0, ok: null, pending: null }
export function devTools() {
  if (!IS_MAC) return Promise.resolve(true)
  if (toolsMemo.ok || (toolsMemo.ok === false && Date.now() - toolsMemo.at < 5_000)) return Promise.resolve(toolsMemo.ok)
  toolsMemo.pending ||= tools().then((ok) => {
    toolsMemo = { at: Date.now(), ok, pending: null }
    if (ok && memo.ok === false) memo = { at: 0, ok: null, pending: null } // git can run now too
    return ok
  }, () => { toolsMemo.pending = null; return true })
  return toolsMemo.pending
}

// What git is pointed at where it must run none of a repository's hooks and read no attributes file
// of yours (a bot's copy of your folders and of your repository: botwrite.js, botchanges.js): a folder
// with nothing in it and a file with nothing in it, Bridge AI's own (git/none/ in its data folder,
// yours alone). The same on every system: /dev/null isn't a path Git for Windows takes for these
// (one starting with / is read as in its own install folder, or on the drive git runs from, where
// anyone could make that folder). Each is checked before it's given (a folder that isn't a link and
// has nothing in it, a file that isn't a link and is empty) and made again when it isn't, so git
// finds nothing there. { hooks, attributes }, as git takes them (/ between their parts on Windows
// too); throws when they can't be made.
const NONE = dataFile('git', 'none')
export function gitNothing() {
  const hooks = path.join(NONE, 'hooks')
  const attributes = path.join(NONE, 'attributes')
  const ok = () => {
    const h = fs.lstatSync(hooks, { throwIfNoEntry: false })
    const a = fs.lstatSync(attributes, { throwIfNoEntry: false })
    return !!h && h.isDirectory() && !h.isSymbolicLink() && fs.readdirSync(hooks).length === 0 && !!a && a.isFile() && !a.isSymbolicLink() && a.size === 0
  }
  if (!ok()) {
    fs.rmSync(NONE, { recursive: true, force: true })
    fs.mkdirSync(hooks, { recursive: true, mode: 0o700 })
    fs.writeFileSync(attributes, '', { mode: 0o600, flag: 'wx' })
    if (!ok()) throw new Error('Bridge AI couldn\'t make the empty folder it runs git with')
  }
  const said = (p) => (IS_WIN ? p.split(path.sep).join('/') : p)
  return { hooks: said(hooks), attributes: said(attributes) }
}
