// Your herdr sessions (https://herdr.dev/docs/persistence-remote/#named-sessions): list them,
// start one in the background, stop one, or open one in your terminal app. Only commands herdr
// documents: `session list --json`, `session stop <name> --json`, `session attach <name>`,
// `--session <name>` and `server` (herdr's headless server, for setups like this one).
import net from 'node:net'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { run, herdrBin, sessionName, picked, socketOf, validName } from './herdr-cli.js'
import { call } from './herdr-socket.js'

const NAME_RULE = "A session name can have letters, numbers, '.', '_' and '-', up to 64 characters"
const checkName = (name) => { if (!validName(name)) throw Object.assign(new Error(NAME_RULE), { code: 'bad_name' }) }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Does a session's server answer on its socket? Quick, and never starts anything.
export function answers(sock, timeout = 600) {
  return new Promise((resolve) => {
    if (!sock) return resolve(false)
    const s = net.connect(sock)
    const done = (ok) => { clearTimeout(t); s.destroy(); resolve(ok) }
    const t = setTimeout(() => done(false), timeout)
    s.on('connect', () => done(true))
    s.on('error', () => done(false))
  })
}

// What a running session's agents are doing, from its own socket (one request, no CLI):
// { needsYou, working }, or null when it can't be read.
export async function busyOf(sock, timeout = 1500) {
  try {
    const r = await call('session.snapshot', {}, timeout, sock)
    const agents = (r?.snapshot || r)?.agents || []
    const count = (st) => agents.filter((a) => a.agent_status === st).length
    return { needsYou: count('blocked'), working: count('working') }
  } catch { return null }
}

// Every session herdr knows (running or not), which one is in view, and, with needs, how many
// agents in each running session wait on you. Read on demand only, never in the fleet poll.
let needsCache = { at: 0, by: {} }
export async function list({ needs = false } = {}) {
  const res = await run(['session', 'list', '--json'])
  const current = sessionName()
  const sessions = (res?.sessions || []).filter((s) => validName(s.name)).map((s) => ({
    name: s.name, running: !!s.running, current: s.name === current, ...(s.default ? { default: true } : {}), sock: s.socket_path || socketOf(s.name),
  }))
  if (needs) {
    if (Date.now() - needsCache.at > 3000) {
      const by = {}
      await Promise.all(sessions.filter((s) => s.running).map(async (s) => { by[s.name] = await busyOf(s.sock) }))
      needsCache = { at: Date.now(), by }
    }
    for (const s of sessions) if (s.running && needsCache.by[s.name]) Object.assign(s, needsCache.by[s.name])
  }
  for (const s of sessions) delete s.sock
  return { picked: picked(), current, sessions }
}

// herdr refuses to start inside herdr, and a socket inherited from where Bridge AI started
// would point it at the wrong session.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('HERDR_') && k !== 'TMUX'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Start a session in the background: herdr's headless server (`herdr --session <name> server`).
// A new name makes a new session; a stopped one comes back with its saved layout. It keeps
// running after Bridge AI quits, like any herdr session.
export async function start(name) {
  checkName(name)
  const sock = socketOf(name)
  if (await answers(sock)) return { name, already: true }
  const bin = await herdrBin()
  let ended = null
  const child = spawn(bin, ['--session', name, 'server'], { detached: true, stdio: 'ignore', cwd: os.homedir(), env: cleanEnv() })
  child.on('error', (e) => { ended = e.message })
  child.on('exit', (code) => { ended = ended || `exit code ${code}` })
  child.unref()
  for (const until = Date.now() + 12000; Date.now() < until;) {
    if (await answers(sock)) { needsCache.at = 0; return { name, started: true } }
    if (ended) break
    await sleep(250)
  }
  if (!ended) { try { child.kill() } catch { /* gone */ } }
  throw Object.assign(new Error(`herdr didn't start the session ${name} in the background${ended ? ` (${ended})` : ''}.`), { code: 'not_started' })
}

// Stop a session and everything running in it (`herdr session stop`). Refused while any of its
// agents is working or waiting on you, or when that can't be checked.
export async function stop(name) {
  checkName(name)
  const sock = socketOf(name)
  if (!(await answers(sock))) throw new Error(`The session ${name} isn't running`)
  const busy = await busyOf(sock)
  if (!busy) throw new Error(`Couldn't check what's running in ${name}, so it wasn't stopped. Stop it in your terminal: herdr session stop ${name}`)
  if (busy.working || busy.needsYou) {
    const what = [busy.working && `${plural(busy.working, 'agent is', 'agents are')} working`, busy.needsYou && `${plural(busy.needsYou, 'agent waits', 'agents wait')} on you`].filter(Boolean).join(' and ')
    throw Object.assign(new Error(`Not stopped: in ${name}, ${what}. Let them finish, or close them first.`), { code: 'busy' })
  }
  await run(['session', 'stop', name, '--json'], { timeout: 20000 })
  needsCache.at = 0
  return { name, stopped: true }
}

// The command that opens a session in a terminal: attach to it, or (create) make it there.
export async function attachCommand(name, { create = false } = {}) {
  checkName(name)
  return [await herdrBin(), ...(create ? ['--session', name] : ['session', 'attach', name])]
}
