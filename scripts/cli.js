#!/usr/bin/env node
// bridge-ai: Bridge AI from your terminal. Run `npm link` once in the repo to put it on your PATH.
//   bridge-ai start [dev|phone]     start the server (same as npm start)
//   bridge-ai stop [agents]         stop it (agents keep running; with "agents", them too)
//   bridge-ai open                  open the app in your browser
//   bridge-ai list                  every agent and shell, numbered
//   bridge-ai attach [target]       work in an agent from this terminal; Ctrl+] to detach.
//                                   target: a number from `list`, a pane id (w1:p3), or a tab name.
//                                   No target: pick from a list.
// For a machine with no screen (a server, a Raspberry Pi, the Docker image), the phone setup too.
// These ask the running server, which does the work (server/relay.js), exactly as Settings does:
//   bridge-ai status                is it running, which agents, the relay and paired phones
//   bridge-ai relay setup           put your relay on Cloudflare with an API token
//                                   (--hosted: Bridge AI's relay instead, once it exists: server/hosted.js)
//   bridge-ai relay [update|forget] update the relay, or stop using it
//   bridge-ai pair                  pair a phone: QR code, link and code
//   bridge-ai phones [remove <name>]  paired phones, or remove one
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { loadConfig, IS_WIN, IS_MAC } from '../server/paths.js'
import { hostedBase } from '../server/hosted.js'

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

// ---------- status, relay and phones (for a machine with no screen) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const flag = (args, name) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (i < 0) return null
  return args[i].includes('=') ? args[i].split('=').slice(1).join('=') : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true)
}
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return !iso ? 'never' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
const row = (label, text) => console.log(`  ${label.padEnd(8)}  ${text}`)

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ans = await new Promise((r) => rl.question(q, r))
  rl.close()
  return ans.trim()
}
// A secret typed without showing it, or piped in: printenv CLOUDFLARE_API_TOKEN | bridge-ai relay setup
async function secret(q) {
  if (!process.stdin.isTTY) {
    let s = ''
    for await (const chunk of process.stdin) s += chunk
    return s.trim()
  }
  process.stdout.write(q)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  let s = ''
  return new Promise((resolve) => {
    const done = (v) => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', on); process.stdout.write('\n'); resolve(v) }
    const on = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return done(s.trim())
        if (ch === '\x03') { process.stdout.write('\n'); process.exit(130) }
        if (ch === '\x7f' || ch === '\b') s = s.slice(0, -1)
        else if (ch >= ' ') s += ch
      }
    }
    process.stdin.on('data', on)
  })
}

function relayLine(r) {
  if (r.busy) return r.busy
  if (!r.configured) return 'not set up. Set it up with: bridge-ai relay setup'
  const update = r.needsUpdate ? DIM(' (an update is ready: bridge-ai relay update)') : r.hosted ? DIM(' (Bridge AI\'s relay)') : ''
  const limit = r.limit ? `\n            ${r.limit.why === 'day' ? `Today's allowance is used up; phones can connect again after ${new Date(r.limit.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : r.limit.text}` : ''
  return (r.online ? `online at ${r.url}${update}` : `offline${r.error ? `: ${r.error}` : ', connecting'} (${r.url})`) + limit
}
const phoneLine = (d) => `${d.name}  ${DIM(d.connected ? 'connected now' : `last seen ${ago(d.lastSeen)}`)}`

async function statusCmd() {
  const v = await api('/version')
  const [d, r, f] = await Promise.all([api('/diagnostics').catch(() => null), api('/relay').catch(() => null), api('/fleet').catch(() => null)])
  console.log(`Bridge AI ${v.version} is running at ${BASE}`)
  if (d) {
    row('Runs on', `${d.install}, ${d.system}, ${d.runtime} runtime, up ${d.uptimeMinutes} min`)
    row('Agents', d.agents.length ? d.agents.join(', ') : 'none installed yet. Install one in Settings › Agents, or: npm install -g @anthropic-ai/claude-code')
  }
  if (f) {
    const c = f.counts || {}
    const bits = [c.working && `${c.working} working`, c.blocked && `${c.blocked} need you`, c.done && `${c.done} done`, c.idle && `${c.idle} idle`].filter(Boolean)
    row('Running', f.agents.length ? `${f.agents.length} agent${f.agents.length === 1 ? '' : 's'}${bits.length ? ` (${bits.join(', ')})` : ''}` : 'no agents')
  }
  if (r) {
    row('Relay', relayLine(r))
    if (r.configured) row('Phones', r.devices.length ? r.devices.map(phoneLine).join('\n            ') : 'none paired yet. Pair one with: bridge-ai pair')
  }
}

const TOKEN_HELP = `Bridge AI puts a small relay on your own Cloudflare account (the free plan is plenty), so your
phone can reach this machine from anywhere. It needs a Cloudflare API token to do that:

  1. Open https://dash.cloudflare.com/profile/api-tokens and click Create Token.
  2. Use the "Edit Cloudflare Workers" template, or a custom token with only these two:
       Account › Workers Scripts › Edit
       Account › Account Settings › Read
     Under Account Resources, pick your account.
  3. Create it, copy it and paste it below.

Bridge AI keeps the token in its data folder (relay.json, readable only by you) to update the
relay after Bridge AI updates.
`

// Another relay is another address, and phones pair per address: say so, and ask first.
async function switching(before, to, args) {
  console.log(`This computer uses ${before.hosted ? 'Bridge AI\'s relay' : 'its own relay'} now (${before.url}). Moving to ${to} means pairing your phones again.`)
  if (flag(args, 'yes')) return
  if (!process.stdin.isTTY) throw new Error('Run it again with --yes to go ahead.')
  if (!/^y/i.test(await ask('Go ahead? (y/N) '))) process.exit(0)
}

// Bridge AI's relay: nothing to sign in to; the server gets this computer an address on it.
async function hostedSetup(args) {
  const before = await api('/relay')
  if (before.busy) throw new Error(`Bridge AI is busy with the relay: ${before.busy}`)
  if (!before.hostedAvailable) throw new Error('Bridge AI\'s relay isn\'t available. Put a relay on your own Cloudflare account instead: bridge-ai relay setup')
  if (before.configured && before.hosted) return console.log(`Relay: ${relayLine(before)}`)
  if (before.configured) await switching(before, 'Bridge AI\'s relay', args)
  console.log(DIM('Setting up Bridge AI\'s relay...'))
  await api('/relay/deploy', { method: 'POST', body: { method: 'hosted' } })
  let s = await api('/relay')
  for (let i = 0; i < 15 && !s.online; i++) { await sleep(1000); s = await api('/relay') }
  console.log(`\nRelay: ${relayLine(s)}`)
  console.log(DIM('Bridge AI\'s relay passes your phone\'s connection on, end-to-end encrypted: it can\'t read it, but sees IP addresses, and when and how much. It has a daily allowance per computer.'))
  if (s.online) console.log('Next, pair your phone: bridge-ai pair')
}

// Deploy (or redeploy) the relay with an API token, showing what the server is doing meanwhile.
async function relaySetup(args) {
  if (flag(args, 'hosted')) return hostedSetup(args)
  const before = await api('/relay')
  if (before.busy) throw new Error(`Bridge AI is busy with the relay: ${before.busy}`)
  if (before.configured && before.hosted) await switching(before, 'a relay on your own Cloudflare account', args)
  else if (before.configured) console.log(`Your relay is set up already (${before.url}). Deploying it again with this token.\n`)
  let token = typeof flag(args, 'token') === 'string' ? flag(args, 'token') : process.env.CLOUDFLARE_API_TOKEN || ''
  if (!token) {
    if (process.stdin.isTTY) console.log(TOKEN_HELP + (before.hostedAvailable && !before.hosted ? `\nNo Cloudflare account? ${DIM('bridge-ai relay setup --hosted')} uses Bridge AI's relay instead.\n` : ''))
    token = await secret('Cloudflare API token: ')
  }
  if (!token) throw new Error('No token given.')
  let account = typeof flag(args, 'account') === 'string' ? flag(args, 'account') : undefined
  for (;;) {
    let last = null
    const watch = setInterval(() => api('/relay').then((s) => { if (s.busy && s.busy !== last) console.log(DIM((last = s.busy))) }).catch(() => {}), 1000)
    let r
    try {
      r = await api('/relay/deploy', { method: 'POST', body: { method: 'token', token, account } })
    } catch (e) {
      // Cloudflare's own words can be terse ("Invalid request headers" for a token cut short).
      if (/^Cloudflare said no/.test(e.message) && !/permissions/.test(e.message)) e.message += '\nCheck that you copied the whole token, and that it has Account › Workers Scripts › Edit and Account › Account Settings › Read.'
      throw e
    } finally { clearInterval(watch) }
    if (!r.chooseAccount) break
    console.log('\nThis token can reach more than one Cloudflare account. Which one should the relay go on?')
    r.chooseAccount.forEach((a, i) => console.log(`${String(i + 1).padStart(3)}  ${a.name}  ${DIM(a.id)}`))
    if (!process.stdin.isTTY) throw new Error('Run it again with --account <id>.')
    const ans = await ask('\nAccount: ')
    account = (r.chooseAccount[Number(ans) - 1] || r.chooseAccount.find((a) => a.id === ans || a.name === ans))?.id
    if (!account) throw new Error('Nothing picked.')
  }
  let s = await api('/relay')
  for (let i = 0; i < 15 && !s.online; i++) { await sleep(1000); s = await api('/relay') }
  console.log(`\nRelay: ${relayLine(s)}`)
  if (s.online) console.log('Next, pair your phone: bridge-ai pair')
}

async function relayCmd(args) {
  const [sub = '', ...rest] = args
  if (sub === 'setup' || sub === 'deploy') return relaySetup(rest)
  if (sub === 'update') {
    console.log(DIM('Updating your relay...'))
    const r = await api('/relay/update', { method: 'POST' })
    return console.log(`Relay: ${relayLine(r)}`)
  }
  if (sub === 'forget') {
    if (!flag(rest, 'yes')) {
      if (!process.stdin.isTTY) throw new Error('This forgets your relay and every paired phone. Run it again with --yes to go ahead.')
      if (!/^y/i.test(await ask('Stop using the relay here and forget every paired phone? (y/N) '))) return
    }
    const was = await api('/relay')
    await api('/relay/forget', { method: 'POST' })
    return console.log(was.hosted ? 'Done. This computer\'s address on Bridge AI\'s relay is removed, and paired phones are forgotten.' : 'Done. The relay stays on your Cloudflare account (delete it there if you like); paired phones are forgotten.')
  }
  if (sub && sub !== 'status') throw new Error(`Unknown: bridge-ai relay ${sub}. Try: setup, update, forget`)
  const r = await api('/relay')
  console.log(`Relay: ${relayLine(r)}`)
  if (r.configured) console.log(`Phones: ${r.devices.length ? r.devices.map((d) => d.name).join(', ') : 'none paired yet (bridge-ai pair)'}`)
}

async function pairCmd(args) {
  if (flag(args, 'stop')) {
    await api('/relay/pair', { method: 'POST', body: { stop: true } })
    return console.log('Stopped pairing. The code no longer works.')
  }
  const r0 = await api('/relay')
  if (!r0.configured) throw new Error('Set up the relay first: bridge-ai relay setup')
  if (!r0.online) console.log(`The relay isn't connected right now (${r0.error || 'connecting'}). The phone can pair once it is.\n`)
  const known = new Set(r0.devices.map((d) => d.id))
  const r = await api('/relay/pair', { method: 'POST' })
  const p = r.pairing
  const { default: QRCode } = await import('qrcode')
  const until = new Date(p.expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  console.log(`Scan this with your phone's camera:\n\n${await QRCode.toString(p.link, { type: 'terminal', small: true })}`)
  console.log(`Or open ${r.url} on your phone and type the code: ${p.code}`)
  console.log(DIM(`Link: ${p.link}`))
  console.log(DIM(`The code works until ${until}.`))
  if (flag(args, 'no-wait')) return
  console.log(`\nWaiting for your phone... ${DIM('(Ctrl+C stops waiting; the code keeps working)')}`)
  for (;;) {
    await sleep(2000)
    const s = await api('/relay')
    const added = s.devices.filter((d) => !known.has(d.id))
    if (added.length) {
      for (const d of added) console.log(`Paired: ${d.name}.`)
      console.log(`\nOn the phone, add it to the Home Screen (iPhone: Share › Add to Home Screen; Android: ⋮ › Install app),
open it from there and type the code again if it asks. Then turn on notifications in its
Settings › Devices.`)
      return
    }
    if (!s.pairing) throw new Error('The code expired or was used up. Run bridge-ai pair again.')
  }
}

async function phonesCmd(args) {
  const [sub, ...rest] = args
  const r = await api('/relay')
  if (sub === 'remove' || sub === 'rm') {
    const q = rest.join(' ').trim().toLowerCase()
    if (!q) throw new Error('Which one? bridge-ai phones remove <name>')
    const hits = r.devices.filter((d) => d.id.toLowerCase() === q || d.name.toLowerCase() === q)
    const d = hits.length ? hits : r.devices.filter((x) => x.name.toLowerCase().includes(q))
    if (d.length !== 1) throw new Error(d.length ? `More than one phone matches "${q}": ${d.map((x) => `${x.name} (${x.id})`).join(', ')}. Use its id.` : `No paired phone matches "${q}".`)
    await api(`/relay/devices/${encodeURIComponent(d[0].id)}`, { method: 'DELETE' })
    return console.log(`Removed ${d[0].name}. It can't reach this machine any more.`)
  }
  if (sub) throw new Error(`Unknown: bridge-ai phones ${sub}. Try: bridge-ai phones remove <name>`)
  if (!r.devices.length) return console.log(r.configured ? 'No phones paired yet. Pair one with: bridge-ai pair' : 'No relay yet. Set it up with: bridge-ai relay setup')
  for (const d of r.devices) console.log(`${phoneLine(d)}  ${DIM(d.id)}`)
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
  status: () => statusCmd(),
  relay: () => relayCmd(args),
  pair: () => pairCmd(args),
  phones: () => phonesCmd(args),
  help: () => console.log(`bridge-ai: Bridge AI from your terminal

  bridge-ai start [dev|phone]   start the server
  bridge-ai stop [agents]       stop it; agents keep running unless you add "agents"
  bridge-ai open                open the app in your browser (${BASE})
  bridge-ai list                every agent and shell, numbered
  bridge-ai attach [target]     work in an agent from this terminal (Ctrl+] detaches)
                                target: a number from list, a pane id like w1:p3, or a tab name

  bridge-ai status              is it running, which agents, the relay and paired phones
  bridge-ai relay setup         put your phone relay on Cloudflare with an API token
                                (asks for it, or reads CLOUDFLARE_API_TOKEN or stdin)${hostedBase() ? `
  bridge-ai relay setup --hosted  use Bridge AI's relay instead: no account needed` : ''}
  bridge-ai relay [update|forget]  update the relay, or stop using it
  bridge-ai pair [--stop]       pair a phone: shows a QR code, the link and the code
  bridge-ai phones [remove <name>]  paired phones, or remove one`),
}
const fn = run[cmd]
if (!fn) { console.error(`Unknown command: ${cmd}`); run.help(); process.exit(2) }
Promise.resolve().then(fn).catch((e) => { console.error(e.message); process.exit(1) })
