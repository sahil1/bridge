// "A new version is available": checks GitHub for the latest release now and then, and updates
// the desktop app on request by running the same one-line installer people install with.
// Running from source, it says how to update instead (git pull), since that's your clone.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, IN_APP, IS_WIN, IS_MAC, cacheFile, ensureDir } from './paths.js'

const REPO = 'sahil1/bridge'
const EVERY = 6 * 60 * 60 * 1000
const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

// 1.24.0 < 1.24.1 < 2.0.0; pre-release suffixes are ignored.
const parts = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0)
const newer = (a, b) => { const x = parts(a); const y = parts(b); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i] } return false }

let last = { at: 0, latest: null, url: null, notes: null, error: null }
async function check(force = false) {
  if (!force && Date.now() - last.at < EVERY) return last
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'bridge-ai' }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`)
    const j = await r.json()
    last = { at: Date.now(), latest: String(j.tag_name || '').replace(/^v/, ''), url: j.html_url, notes: String(j.body || '').slice(0, 4000), error: null }
  } catch (e) {
    last = { ...last, at: Date.now(), error: e.message }
  }
  return last
}

// How this copy was installed decides how it updates. The Docker image sets BRIDGE_DOCKER.
const how = () => (IN_APP ? (IS_MAC || IS_WIN ? 'app' : 'app-linux') : process.env.BRIDGE_DOCKER ? 'docker' : 'source')
const COMMAND = { source: 'git pull && npm start', 'app-linux': `curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh`, docker: 'docker compose pull && docker compose up -d' }

export async function status({ force = false, disabled = false } = {}) {
  if (disabled) return { current, disabled: true }
  const s = await check(force)
  return {
    current,
    latest: s.latest,
    available: !!(s.latest && newer(s.latest, current)),
    url: s.url,
    notes: s.notes,
    checkedAt: s.at ? new Date(s.at).toISOString() : null,
    error: s.error,
    how: how(),
    // Shown when the app can't update itself: from source, Linux (the .deb asks for a password),
    // or Docker (on the device running it, in the folder with docker-compose.yml).
    command: COMMAND[how()] || null,
  }
}

// Desktop app on macOS or Windows: run the installer on its own, outside this server, because it
// closes the app and stops this server, then installs and reopens the new version.
// The installer comes from the release it installs (its tag, not main), and the folder goes to it in
// its environment, never in the command.
export async function install() {
  if (how() !== 'app') throw new Error('This copy updates from a terminal; see the command shown.')
  const { latest } = await check(true)
  if (!/^\d+\.\d+\.\d+$/.test(latest || '')) throw new Error('Couldn\'t find the newest version on GitHub; try again in a minute.')
  const tag = `v${latest}`
  const at = `https://raw.githubusercontent.com/${REPO}/${tag}`
  const log = path.join(ensureDir(cacheFile('update')), 'update.log')
  const out = fs.openSync(log, 'w')
  const dir = appDir()
  const env = { ...process.env, BRIDGE_VERSION: tag, ...(dir ? { BRIDGE_APP_DIR: dir } : {}) }
  const child = IS_WIN
    ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${at}/install.ps1 | iex`], { detached: true, stdio: ['ignore', out, out], windowsHide: true, env })
    : spawn('/bin/sh', ['-c', `curl --proto '=https' -fsSL ${at}/install.sh | sh`], { detached: true, stdio: ['ignore', out, out], env })
  child.unref()
  return { started: true, log }
}

// The folder this app is installed in (so an update replaces it where it is, not in a new place).
// The outermost .app: the server runs on the Helper inside it (desktop/main.js). Opened straight
// from the .dmg, or copied there other than with Finder, macOS runs it from a read-only copy of its
// own (App Translocation), which can't be replaced: then none, and the installer puts the update in
// Applications as for a new install.
function appDir() {
  const m = process.execPath.match(/^(.*?)\/[^/]+\.app\/Contents\//)
  return m && !m[1].includes('/AppTranslocation/') ? m[1] : null
}
