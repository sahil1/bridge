// Whether git can run. On a Mac without Apple's command line developer tools, /usr/bin/git is a
// stand-in that pops up macOS's "install the developer tools?" dialog each time it's run, and Bridge
// AI runs git often (each agent's branch, the Changes tab). So it's asked here first, without
// running git: the developer folder has a real git, or another git comes first on the PATH
// (Homebrew's). A "no" is asked again after 15 seconds, so installing the tools is picked up
// without a restart.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { IS_MAC } from './paths.js'

export const NO_GIT = 'Git needs Apple\'s command line developer tools, which aren\'t on this Mac yet.'

let memo = { at: 0, ok: null, pending: null }
const exists = (p) => fs.promises.access(p, fs.constants.X_OK).then(() => true, () => false)

async function look() {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir || dir === '/usr/bin') continue
    if (await exists(path.join(dir, 'git'))) return true
  }
  const dev = await new Promise((resolve) => execFile('xcode-select', ['-p'], { timeout: 5000 }, (err, out) => resolve(err ? null : String(out).trim())))
  return !!dev && exists(path.join(dev, 'usr', 'bin', 'git'))
}

export function gitReady() {
  if (!IS_MAC) return Promise.resolve(true)
  if (memo.ok || (memo.ok === false && Date.now() - memo.at < 15_000)) return Promise.resolve(memo.ok)
  memo.pending ||= look().then((ok) => { memo = { at: Date.now(), ok, pending: null }; return ok }, () => { memo.pending = null; return true })
  return memo.pending
}
