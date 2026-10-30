// "Use on your phone": publish Bridge AI over HTTPS to your own devices with Tailscale (free), so
// your phone can open it, add it to the Home Screen as an app, and get notifications. Only devices
// signed in to your tailnet can reach it, and Bridge AI answers only you (guard.js checks who
// Tailscale says is asking); nothing is opened to the internet.
//
// Bridge AI asks Tailscale to serve https://<this-computer>.<tailnet>.ts.net:<port> from the local
// server. The port is the first free one from 8443 up, so another app already published there (an
// older Bridge, say) keeps working.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import QRCode from 'qrcode'
import { IS_MAC, IS_WIN } from './paths.js'
import { loginPath } from './agents.js'

const CANDIDATES = IS_MAC
  ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale']
  : IS_WIN ? ['C:\\Program Files\\Tailscale\\tailscale.exe'] : []

async function bin() {
  const PATH = await loginPath()
  for (const dir of PATH.split(IS_WIN ? ';' : ':')) {
    const p = `${dir}${IS_WIN ? '\\' : '/'}tailscale${IS_WIN ? '.exe' : ''}`
    if (dir && fs.existsSync(p)) return p
  }
  return CANDIDATES.find((p) => fs.existsSync(p)) || null
}

const run = (b, args, ms = 15000) => new Promise((resolve) => {
  execFile(b, args, { timeout: ms, windowsHide: true }, (err, stdout = '', stderr = '') => resolve({ ok: !err, out: String(stdout), err: String(stderr || err?.message || '') }))
})
const json = (s) => { try { return JSON.parse(s) } catch { return null } }

// Which https ports Tailscale already serves, and where each goes.
async function served(b) {
  const r = await run(b, ['serve', 'status', '--json'])
  const web = json(r.out)?.Web || {}
  const map = {}
  for (const [hostPort, cfg] of Object.entries(web)) {
    const port = Number(hostPort.split(':').pop())
    map[port] = cfg?.Handlers?.['/']?.Proxy || 'other'
  }
  return map
}

// Who this computer belongs to on Tailscale (its login, like you@example.com), for the guard: only
// you, signed in on your phone, get in through Tailscale, not someone else on the tailnet. Looked up
// once in a while. BRIDGE_TAILNET_OWNER: tests, which have no Tailscale.
let owner = { at: 0, login: null }
export async function tailnetOwner() {
  if (process.env.BRIDGE_TAILNET_OWNER) return process.env.BRIDGE_TAILNET_OWNER
  if (Date.now() - owner.at < (owner.login ? 10 : 1) * 60000) return owner.login
  const b = await bin().catch(() => null)
  const st = b ? json((await run(b, ['status', '--json'])).out) : null
  owner = { at: Date.now(), login: st?.User?.[st?.Self?.UserID]?.LoginName || null }
  return owner.login
}

export async function status(localPort) {
  const b = await bin()
  if (!b) return { installed: false }
  const st = json((await run(b, ['status', '--json'])).out)
  const state = st?.BackendState || 'Unknown' // Running, Stopped, NeedsLogin, NoState
  const name = String(st?.Self?.DNSName || '').replace(/\.$/, '')
  const base = { installed: true, state, running: state === 'Running', name }
  if (state !== 'Running' || !name) return base
  const map = await served(b)
  const mine = Object.entries(map).find(([, to]) => new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${localPort}/?$`).test(to))
  if (!mine) return { ...base, enabled: false }
  const url = `https://${name}${mine[0] === '443' ? '' : `:${mine[0]}`}/`
  return { ...base, enabled: true, port: Number(mine[0]), url, qr: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) }
}

export async function enable(localPort) {
  const b = await bin()
  if (!b) throw new Error('Tailscale isn\'t installed on this computer')
  const now = await status(localPort)
  if (!now.running) throw new Error(now.state === 'NeedsLogin' ? 'Sign in to Tailscale first' : 'Open Tailscale and connect first')
  if (now.enabled) return now
  const map = await served(b)
  let port = 8443
  while (map[port] && port < 8500) port++
  const r = await run(b, ['serve', '--bg', `--https=${port}`, `http://127.0.0.1:${localPort}`], 30000)
  if (!r.ok) {
    // Tailscale asks you to switch HTTPS on for your tailnet the first time; pass its link along.
    const link = (r.err + r.out).match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0]
    throw new Error(link ? `Turn on HTTPS for your tailnet first: ${link}` : `Tailscale couldn't publish it: ${(r.err || r.out).trim().split('\n').pop()}`)
  }
  return status(localPort)
}

export async function disable(localPort) {
  const b = await bin()
  const now = await status(localPort)
  if (b && now.enabled) await run(b, ['serve', `--https=${now.port}`, 'off'])
  return status(localPort)
}
