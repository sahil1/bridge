// Dev servers for an agent's folder, like an editor's built-in browser: which web servers are
// running from that folder (port, program, page title), and how the project starts one
// (./start.sh, npm run dev, ...), so the Preview tab can show the app or offer to start it.
//
// A server counts as the folder's when the process listening on the port was started in it
// (its working folder is the folder or inside it). macOS and Linux read that from the system;
// Windows can't tell, so there every local web server is listed.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { IS_WIN } from './paths.js'

const run = (cmd, args, ms = 4000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: ms, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout = '') => resolve(err && !stdout ? '' : stdout))
})

// Every TCP port something is listening on, with the process: [{ port, pid, host }]
async function listening() {
  const out = []
  if (IS_WIN) {
    for (const l of (await run('netstat', ['-ano', '-p', 'TCP'])).split(/\r?\n/)) {
      const m = l.trim().match(/^TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/i)
      if (m) out.push({ host: m[1], port: Number(m[2]), pid: Number(m[3]) })
    }
    return out
  }
  // lsof's field output: p<pid>, then n<address:port> per socket.
  let pid = 0
  for (const l of (await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'])).split('\n')) {
    if (l[0] === 'p') pid = Number(l.slice(1))
    else if (l[0] === 'n') {
      const m = l.slice(1).match(/^(.*):(\d+)$/)
      if (m) out.push({ host: m[1], port: Number(m[2]), pid })
    }
  }
  if (out.length || process.platform !== 'linux') return out
  // Linux without lsof: ss.
  for (const l of (await run('ss', ['-ltnpH'])).split('\n')) {
    const m = l.match(/\s(\S+):(\d+)\s+\S+\s+.*pid=(\d+)/)
    if (m) out.push({ host: m[1], port: Number(m[2]), pid: Number(m[3]) })
  }
  return out
}

// Working folder and command line of each process.
async function procInfo(pids) {
  const info = new Map(pids.map((p) => [p, { cwd: null, command: '' }]))
  if (!pids.length || IS_WIN) return info
  if (process.platform === 'linux') {
    for (const p of pids) {
      try { info.get(p).cwd = fs.readlinkSync(`/proc/${p}/cwd`) } catch { /* not ours */ }
    }
  } else {
    let pid = 0
    for (const l of (await run('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fpn'])).split('\n')) {
      if (l[0] === 'p') pid = Number(l.slice(1))
      else if (l[0] === 'n' && info.has(pid)) info.get(pid).cwd = l.slice(1)
    }
  }
  for (const l of (await run('ps', ['-o', 'pid=,command=', '-p', pids.join(',')])).split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(.*)$/)
    if (m && info.has(Number(m[1]))) info.get(Number(m[1])).command = m[2]
  }
  return info
}

// Is it a web server? A quick GET (Bridge AI only talks to this computer), and the page title.
async function probe(port) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 1200)
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: ctrl.signal, redirect: 'manual', headers: { Accept: 'text/html,*/*' } })
    const type = res.headers.get('content-type') || ''
    let title = null
    if (/html/i.test(type)) {
      const text = (await res.text()).slice(0, 64 * 1024)
      title = text.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]?.trim() || null
    } else res.body?.cancel?.()
    // A page that refuses to be shown inside another page can only open in the browser.
    const xfo = res.headers.get('x-frame-options') || ''
    const csp = res.headers.get('content-security-policy') || ''
    const framable = !/deny|sameorigin/i.test(xfo) && !/frame-ancestors\s+('none'|'self')/i.test(csp)
    return { http: true, status: res.status, title, framable }
  } catch { return { http: false } } finally { clearTimeout(t) }
}

const inside = (dir, root) => !!dir && (dir === root || dir.startsWith(root + path.sep))
// Never blocking: a folder in Desktop or Documents can be held by macOS while it asks you for access.
const realOr = (p) => fsp.realpath(p).catch(() => p)
// A short name for the program: "vite", "node server/index.js", "python3 -m http.server".
function programName(cmd) {
  const parts = String(cmd || '').split(/\s+/).filter(Boolean)
  if (!parts.length) return null
  const base = (p) => p.split(/[\\/]/).pop()
  const bin = base(parts[0])
  const script = parts.slice(1).find((p) => !p.startsWith('-'))
  if (/^(node|python\d?(\.\d+)?|ruby|php|bun|deno)$/i.test(bin) && script) return `${bin} ${script.includes('node_modules') ? base(script.replace(/[\\/]bin[\\/].*$/, '')) : script.replace(/^.*node_modules[\\/]\.bin[\\/]/, '')}`.slice(0, 60)
  return bin.slice(0, 60)
}

// The web servers running from `root`, newest port first. `exclude`: ports to leave out.
export async function serversFor(root, { exclude = [] } = {}) {
  const realRoot = await realOr(root)
  const socks = (await listening()).filter((s) => s.port >= 1024 && !exclude.includes(s.port) && s.pid !== process.pid)
  const byPort = new Map()
  for (const s of socks) if (!byPort.has(s.port)) byPort.set(s.port, s)
  const info = await procInfo([...new Set([...byPort.values()].map((s) => s.pid))])
  await Promise.all([...info.values()].map(async (i) => { i.real = await realOr(i.cwd || '') }))
  const mine = [...byPort.values()].filter((s) => IS_WIN || inside(info.get(s.pid)?.real || '', realRoot))
  const out = await Promise.all(mine.map(async (s) => {
    const p = await probe(s.port)
    if (!p.http) return null
    const i = info.get(s.pid) || {}
    return { port: s.port, pid: s.pid, program: programName(i.command), cwd: i.cwd ? path.relative(realRoot, i.real) || '.' : null, title: p.title, status: p.status, framable: p.framable, localOnly: /^(127\.|\[?::1\]?|localhost)/.test(s.host) }
  }))
  return out.filter(Boolean).sort((a, b) => a.port - b.port)
}

// Every process's parent: pid -> its parent's pid.
async function parents() {
  const out = new Map()
  const lines = IS_WIN
    ? await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'], 15000)
    : await run('ps', ['-A', '-o', 'pid=,ppid='])
  for (const l of lines.split(/\r?\n/)) {
    const m = l.trim().match(/^(\d+)\s+(\d+)$/)
    if (m) out.set(Number(m[1]), Number(m[2]))
  }
  return out
}
// Whether pid is one of tops, or started (however far down) by one of them.
const under = (pid, tops, up) => {
  for (let p = pid, n = 0; p > 1 && n < 200; p = up.get(p), n++) if (tops.has(p)) return true
  return false
}

// Whether a port is one of the agents' dev servers: what a preview from another of your devices may
// reach (devpreview.js), and nothing else on this computer. panes: the agents' terminals ({ pid,
// cwd }). A server counts when an agent's terminal started it (its process, or one under it), on
// every system. Never one started by a terminal in your home folder or above it (never), nor in
// Bridge AI's data folder, anywhere in it or above it (noneIn): setup's Install and Sign-in
// terminals open in the home folder. Terminals that don't say their process (herdr's): a server
// started in one's folder (not those), where the system says it (macOS and Linux). `exclude`: ports
// never to count (Bridge AI's own). Asked again at most every few seconds per port.
const owned = new Map() // `${port}` -> { at, p }
export function ownedBy(port, panes, { exclude = [], never = [], noneIn = [], ms = 5000 } = {}) {
  port = Number(port)
  if (!(port >= 1024 && port < 65536) || exclude.includes(port)) return Promise.resolve(false)
  const key = `${port} ${panes.map((x) => `${x.pid || ''}:${x.cwd}`).join('\0')}`
  const hit = owned.get(key)
  if (hit && Date.now() - hit.at < ms) return hit.p
  const p = (async () => {
    const socks = (await listening()).filter((s) => s.port === port && s.pid !== process.pid)
    if (!socks.length) return false
    const nots = await Promise.all(never.filter(Boolean).map(realOr))
    const nones = await Promise.all(noneIn.filter(Boolean).map(realOr))
    const fine = async (dir) => {
      if (!dir) return false
      const real = await realOr(dir)
      return !nots.some((n) => inside(n, real)) && !nones.some((n) => inside(n, real) || inside(real, n))
    }
    const ok = []
    for (const x of panes) if (await fine(x.cwd)) ok.push(x)
    let mine = false
    const tops = new Set(ok.filter((x) => x.pid).map((x) => Number(x.pid)))
    let up = new Map()
    const began = Date.now()
    if (tops.size) {
      // (Asked again once when none came: Windows' list, from PowerShell, can time out.)
      up = await parents()
      if (!up.size) up = await parents()
      mine = socks.some((s) => under(s.pid, tops, up))
    }
    const roots = ok.filter((x) => !x.pid).map((x) => x.cwd)
    if (!mine && roots.length && !IS_WIN) {
      const info = await procInfo([...new Set(socks.map((s) => s.pid))])
      for (const i of info.values()) {
        const real = await realOr(i.cwd || '')
        for (const r of roots) if (i.cwd && inside(real, await realOr(r))) mine = true
      }
    }
    // (Why one that's running isn't, in the log: what an agent's terminal started is told apart by its
    // processes, and that's what a refusal can come down to.)
    if (!mine) console.log(`Preview: port ${port} (process ${socks.map((s) => s.pid).join(', ')}) isn't from an agent's terminal: ${tops.size} terminal${tops.size === 1 ? '' : 's'} with a process, ${up.size} processes listed (${Date.now() - began} ms)`)
    return mine && (await probe(port)).http
  })().catch(() => false)
  owned.set(key, { at: Date.now(), p })
  if (owned.size > 200) owned.delete(owned.keys().next().value)
  return p
}

// How this project starts a server, best guesses first: [{ label, command }]
export async function startCommands(root) {
  const out = []
  // Every file it checks for at once, so a slow folder is one wait, not one per file.
  const names = ['start.sh', 'dev.sh', 'run.sh', 'serve.sh', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'manage.py', 'docker-compose.yml', 'compose.yaml', 'docker-compose.yaml', 'index.html']
  const read = (f) => fsp.readFile(path.join(root, f), 'utf8').catch(() => '')
  const [found, pkgText, make] = await Promise.all([Promise.all(names.map((f) => fsp.access(path.join(root, f)).then(() => f, () => null))), read('package.json'), read('Makefile')])
  const has = (f) => found.includes(f)
  for (const f of ['start.sh', 'dev.sh', 'run.sh', 'serve.sh']) if (has(f)) out.push({ label: `./${f}`, command: IS_WIN ? `bash ./${f}` : `./${f}` })
  let pkg = null
  try { pkg = JSON.parse(pkgText) } catch { /* none */ }
  if (pkg?.scripts) {
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm'
    for (const s of ['dev', 'start', 'serve', 'preview', 'develop']) {
      if (!pkg.scripts[s]) continue
      const command = pm === 'npm' ? (s === 'start' ? 'npm start' : `npm run ${s}`) : `${pm} ${s}`
      out.push({ label: command, command, detail: String(pkg.scripts[s]).slice(0, 80) })
    }
  }
  for (const t of ['dev', 'run', 'serve', 'start']) if (new RegExp(`^${t}:`, 'm').test(make)) out.push({ label: `make ${t}`, command: `make ${t}` })
  if (has('manage.py')) out.push({ label: 'python manage.py runserver', command: 'python3 manage.py runserver' })
  if (has('docker-compose.yml') || has('compose.yaml') || has('docker-compose.yaml')) out.push({ label: 'docker compose up', command: 'docker compose up' })
  if (!out.length && has('index.html')) out.push({ label: 'Serve this folder', command: 'python3 -m http.server 8000', detail: 'a plain web server for the files here' })
  return out.slice(0, 6)
}

// Stop a server that runs from `root` (checked again, so only that folder's servers).
export async function stop(root, port) {
  const s = (await serversFor(root)).find((x) => x.port === Number(port))
  if (!s) throw new Error(`Nothing from this folder is serving port ${port}`)
  process.kill(s.pid, 'SIGTERM')
  return { ok: true }
}
