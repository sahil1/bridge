// A tripwire for Bridge AI's hosted relay (relay/HOSTED.md). A phone in a browser runs the page the
// relay serves (relay/web), and everything past the handshake is encrypted by that page's code, so a
// relay that served a changed page could read it all. The iPhone and Android apps carry their own
// copy; this watches the one browsers get.
//
// While this computer is on Bridge AI's relay, once a day and when Settings › Devices opens, it
// fetches the page's files from its own address there, as a phone would, and compares them with
// Bridge AI's own for the version the relay says it runs (/_relay/health). The relay may run a newer
// release than this computer, or an older one for a while, so: this computer's own copy when that's
// its version; otherwise that release's files from GitHub (the public repo, at its tag), which the
// relay can't change. A file that differs, or a version that was never released, and Settings ›
// Devices says so, with what to do. Nothing is sent but those requests, and nothing waits on them.
//
// What it catches: the page changed for everyone, by whoever runs the relay or took it over. What it
// can't: a page changed only for some phones (the relay can tell this computer's requests from a
// phone's). That's why the apps carry their own, and why a browser on the relay says so.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { ROOT } from './paths.js'
import * as relay from './relay.js'
import { TEXT, linkSw, pageFiles } from '../relay/build.js'
import { RELEASE_VERSION } from '../shared/version.js'

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
// Where a release's files are, by its tag. BRIDGE_RELAY_SOURCE stands in for it in tests.
const SOURCE = () => (process.env.BRIDGE_RELAY_SOURCE ?? 'https://raw.githubusercontent.com/sahil1/bridge').replace(/\/+$/, '')
// The code a phone runs (the icons are pictures), by the address the relay serves each at.
export const PAGE = [...TEXT, 'link-sw.js']
const pathOf = (name) => (name === 'index.html' ? '/' : `/${name}`)
const DAY = 24 * 3600 * 1000
const AGAIN = 10 * 60 * 1000 // Settings opening checks again only after this long
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

// The last check: { on, checking, at, version, own, ok, differs: [file], why, error }. on: this
// computer is on Bridge AI's relay; ok: the page is that version's; why, when it isn't: 'differs'
// (files differ from that version's), 'unreleased' (a version that was never released).
let last = { on: false }
let running = null
let timer = null

// One GET, its body as bytes. A relay at <name>.localhost (Bridge AI's relay tried on this computer,
// HOSTED.md) is reached on this computer, as server/relay.js does, whatever the system's resolver says.
const loopback = (host, opts, cb) => (opts?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4))
function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const local = /\.localhost$/i.test(u.hostname)
    const req = (u.protocol === 'https:' ? https : http).get(u, { headers: { 'User-Agent': 'bridge-ai', 'Cache-Control': 'no-cache' }, timeout: 10000, ...(local ? { lookup: loopback } : {}) }, (res) => {
      const parts = []
      res.on('data', (c) => parts.push(c))
      res.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(parts)) : reject(Object.assign(new Error(`${u.host} answered ${res.statusCode}`), { status: res.statusCode }))))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error(`${u.host} didn't answer`)))
    req.on('error', reject)
  })
}

// What each file of a version should be, by its SHA-256: this computer's own, or a release's.
let own = null
const ownPage = () => (own ||= Object.fromEntries(PAGE.map((n) => [n, sha(Buffer.from(pageFiles()[n].text, 'utf8'))])))
const releases = new Map() // version -> its files' hashes (a release's never change)
async function released(version) {
  if (releases.has(version)) return releases.get(version)
  const at = `${SOURCE()}/v${version}/relay/web`
  const text = Object.fromEntries(await Promise.all(TEXT.map(async (n) => [n, await get(`${at}/${n}`)])))
  const out = Object.fromEntries(TEXT.map((n) => [n, sha(text[n])]))
  out['link-sw.js'] = sha(Buffer.from(linkSw(text['link.js'].toString('utf8')), 'utf8'))
  releases.set(version, out)
  return out
}

// One check, now: the relay's page against the version it says it runs.
export async function check() {
  const st = relay.status()
  const base = st.hosted ? relay.relayUrl() : null
  if (!base) { last = { on: false }; return last }
  if (running) return running
  last = { ...last, on: true, checking: true }
  running = (async () => {
    try {
      const health = JSON.parse((await get(`${base}/_relay/health`)).toString('utf8'))
      const version = typeof health?.version === 'string' ? health.version.slice(0, 40) : null
      const served = Object.fromEntries(await Promise.all(PAGE.map(async (n) => [n, sha(await get(`${base}${pathOf(n)}`))])))
      let want = null
      let why = null
      // No version said (a relay from before it did): it's this computer's own, or it's changed.
      if (!version || version === VERSION) want = ownPage()
      else if (!RELEASE_VERSION.test(version)) why = 'unreleased'
      else {
        want = await released(version).catch((e) => {
          if (e.status === 404) { why = 'unreleased'; return null } // no such tag on GitHub
          throw e
        })
      }
      const differs = want ? PAGE.filter((n) => served[n] !== want[n]) : []
      if (differs.length) why = 'differs'
      last = { on: true, at: Date.now(), version: version || VERSION, own: VERSION, ok: !why, differs, why, error: null }
    } catch (e) {
      // Couldn't check (no network, the relay or GitHub not answering): said, but it isn't a finding.
      last = { ...last, on: true, checking: false, at: Date.now(), error: e.message || String(e) }
    } finally {
      running = null
    }
    return last
  })()
  return running
}

// What Settings › Devices shows. Opening it checks again when the last check is a while old (now:
// at once, its Check again); the answer is what's known now, and the page asks again while one is
// under way.
export function ask({ now = false } = {}) {
  if (!relay.status().hosted) { last = { on: false }; return last }
  if (!running && (now || !(last.at > Date.now() - AGAIN))) check().catch(() => {})
  return { ...last, checking: !!running }
}

export const state = () => ({ ...last, checking: !!running })

// Once a day while Bridge AI runs (the first a few minutes after it starts, once its relay is up).
export function start() {
  clearTimeout(timer)
  const next = (ms) => { timer = setTimeout(() => { check().catch(() => {}).finally(() => next(DAY)) }, ms); timer.unref?.() }
  next(5 * 60 * 1000)
}
