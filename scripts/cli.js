#!/usr/bin/env node
// bridge-ai: Bridge AI from your terminal. Run `npm link` once in the repo to put it on your PATH.
//   bridge-ai start [dev|phone]     start the server (same as npm start)
//   bridge-ai stop                  stop it
//   bridge-ai open                  open the app in your browser
//   bridge-ai list                  every agent and shell, numbered
//   bridge-ai attach [target]       work in an agent from this terminal; Ctrl+] to detach.
//                                   target: a number from `list`, a pane id (w1:p3), or a tab name.
//                                   No target: pick from a list.
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { loadConfig, IS_WIN, IS_MAC } from '../server/paths.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const cfg = loadConfig()
const BASE = process.env.BRIDGE_URL || `http://127.0.0.1:${cfg.port || 7420}`
const DIM = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s)

async function api(p, opts = {}) {
  let res
  try {
    res = await fetch(`${BASE}/api${p}`, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined })
  } catch { throw new Error(`Bridge AI isn't running at ${BASE}. Start it with: bridge-ai start`) }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// Agents and plain shells, numbered the same way every time (by space, then tab).
async function targets() {
  const f = await api('/fleet')
  const panes = (await api('/panes')).panes || []
  const agentOf = new Map(f.agents.map((a) => [a.paneId, a]))
  return panes.map((p) => ({ ...p, a: agentOf.get(p.paneId) })).sort((x, y) => x.number - y.number)
    .map((p, i) => ({ n: i + 1, paneId: p.paneId, label: `${p.workspace} › ${p.a?.title || p.tab || 'shell'}`, kind: p.agent || 'shell', status: p.status || '', cwd: p.cwd, runtime: f.runtime }))
}
const status = (s) => ({ working: 'working', blocked: 'needs you', done: 'done', idle: 'idle' }[s] || '')

function printList(list) {
  if (!list.length) { console.log('Nothing running. Start an agent in the app, or: bridge-ai open'); return }
  for (const t of list) console.log(`${String(t.n).padStart(3)}  ${t.label}  ${DIM(`${t.kind}${t.status ? ` · ${status(t.status)}` : ''} · ${t.paneId}`)}`)
}

async function pick(list) {
  printList(list)
  if (!list.length) process.exit(0)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ans = await new Promise((r) => rl.question('\nAttach to which? ', r))
  rl.close()
  return find(list, ans.trim())
}
function find(list, q) {
  if (!q) return null
  const n = Number(q)
  if (Number.isInteger(n) && list[n - 1]) return list[n - 1]
  const low = q.toLowerCase()
  return list.find((t) => t.paneId === q) || list.find((t) => t.label.toLowerCase().endsWith(low)) || list.find((t) => t.label.toLowerCase().includes(low)) || null
}

async function attach(q) {
  const list = await targets()
  const t = q ? find(list, q) : await pick(list)
  if (!t) throw new Error(q ? `No agent or shell matches "${q}". Run: bridge-ai list` : 'Nothing picked.')
  const { runtime } = await api('/config')

  // herdr owns these panes: focus this one and open herdr itself, in the session Bridge AI uses.
  if (runtime?.name === 'herdr') {
    await api(`/agents/${encodeURIComponent(t.paneId)}/focus`, { method: 'POST' }).catch(() => {})
    const r = spawnSync('herdr', runtime.session ? ['session', 'attach', runtime.session] : [], { stdio: 'inherit' })
    process.exit(r.status ?? 0)
  }

  const { default: WebSocket } = await import('ws')
  const cols = process.stdout.columns || 120
  const rows = process.stdout.rows || 40
  const url = `${BASE.replace(/^http/, 'ws')}/api/panes/${encodeURIComponent(t.paneId)}/attach?cols=${cols}&rows=${rows}`
  console.log(DIM(`Attaching to ${t.label}. Ctrl+] to detach; the agent keeps running in Bridge AI.`))
  const ws = new WebSocket(url)
  let done = false
  const finish = (msg) => {
    if (done) return
    done = true
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    // Leave the terminal clean: main screen, cursor on, mouse and paste modes off.
    process.stdout.write('\x1b[0m\x1b[?1049l\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1l\r\n')
    console.log(msg)
    process.exit(0)
  }
  ws.on('open', () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', (buf) => {
      if (buf.includes(0x1d)) return finish(DIM(`Detached from ${t.label}.`)) // Ctrl+]
      ws.send(buf.toString('utf8'))
    })
    process.stdout.on('resize', () => ws.send(JSON.stringify({ type: 'resize', cols: process.stdout.columns, rows: process.stdout.rows })))
  })
  ws.on('message', (data) => {
    const s = data.toString('utf8')
    if (s.startsWith('{"type":')) {
      try {
        const m = JSON.parse(s)
        if (m.type === 'exit') return finish(DIM(`${t.label} ended.`))
        if (m.type === 'error') return finish(`Couldn't attach: ${m.message}`)
      } catch { /* program output that happens to look like JSON */ }
    }
    process.stdout.write(s)
  })
  ws.on('close', () => finish(DIM('Connection closed.')))
  ws.on('error', (e) => finish(`Couldn't attach: ${e.message}`))
}

function openUrl(url) {
  const [cmd, args] = IS_MAC ? ['open', [url]] : IS_WIN ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
}

const [cmd = 'help', ...args] = process.argv.slice(2)
const run = {
  start: () => { spawn(process.execPath, [path.join(HERE, 'start.js'), ...args], { stdio: 'inherit' }).on('exit', (c) => process.exit(c ?? 0)) },
  stop: () => { spawn(process.execPath, [path.join(HERE, 'stop.js'), ...args], { stdio: 'inherit' }).on('exit', (c) => process.exit(c ?? 0)) },
  open: () => openUrl(BASE),
  list: async () => printList(await targets()),
  ls: async () => printList(await targets()),
  attach: () => attach(args.join(' ').trim()),
  a: () => attach(args.join(' ').trim()),
  help: () => console.log(`bridge-ai: Bridge AI from your terminal

  bridge-ai start [dev|phone]   start the server
  bridge-ai stop                stop it
  bridge-ai open                open the app in your browser (${BASE})
  bridge-ai list                every agent and shell, numbered
  bridge-ai attach [target]     work in an agent from this terminal (Ctrl+] detaches)
                                target: a number from list, a pane id like w1:p3, or a tab name`),
}
const fn = run[cmd]
if (!fn) { console.error(`Unknown command: ${cmd}`); run.help(); process.exit(2) }
Promise.resolve().then(fn).catch((e) => { console.error(e.message); process.exit(1) })
