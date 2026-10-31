// Report a crash on GitHub: the text of an issue about it, with what's personal taken out, and the
// link that opens GitHub's new-issue page with that text filled in. Bridge AI sends nothing itself:
// the person reads the text, changes what they like, and sends it from GitHub, or doesn't.
// The server writes the text (it knows the names to take out and has the logs); the page builds the
// link from the text as the person left it, and writes the text itself when the server can't.
import { SECRETS, GENERIC_USER, HOME_PATH, ALLOW_EMAIL, EMAIL, TAILNET, GENERIC_TAILNET } from './private.js'

export const REPO = 'sahil1/bridge'
// GitHub turns away a link much longer than 8 KB (414), so a report longer than this goes on the
// clipboard instead, to paste into the page the shorter link opens.
export const MAX_URL = 8000

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const all = (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
// A path: its characters, and a space only when more of the path follows it ("My Projects/acme").
const P = '[^\\s\'"`()<>\\[\\]{},;:*?|]'
const PATH_BODY = `(?:${P}| (?=${P}*[\\\\/]))+`
// Paths that are someone's: under a home folder, another disk, a temp folder or a server's own
// folders. Bridge AI's own files (<app>) and its data folder (~/.bridge-ai) stay, as they say
// where in Bridge AI it broke.
const PATHS = new RegExp(`(?<![\\w.~<>/\\\\-])(?:~(?=[\\\\/])|[A-Za-z]:(?=[\\\\/])|\\\\\\\\${P}+|(?=\\/(?:Users|home|Volumes|mnt|media|private|tmp|var|opt|srv|root|data|workspace|workspaces|Library|run)\\b))[\\\\/]${PATH_BODY}`, 'g')
// Bridge AI's data folder and the folders in it that say nothing about you (not its worktrees,
// which are named after your repos and branches).
const KEEP_PATH = /^~[\\/]\.bridge-ai(?:[\\/](?:logs|cache|models|tools|host|telemetry)(?:[\\/][\w.-]+)?)?[\\/]?$/

// text, with what's personal taken out. home: this computer's home folder; app: where Bridge AI
// itself is (its paths are kept, as <app>); names: [value, what to put instead], for the names
// that are yours (your name, this computer's, your projects').
export function scrub(text, { home = '', app = '', names = [] } = {}) {
  let s = String(text ?? '')
  for (const [, re] of SECRETS) s = s.replace(all(re), '<key>')
  s = s.replace(/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 <key>')
  s = s.replace(/([?&#](?:token|key|code|secret|password|auth|sig|signature|access_token|apikey|api_key)=)[^&#\s"')]+/gi, '$1<key>')
  // Bridge AI's own folder, then the home folder, as written on this system and as JSON writes it.
  s = s.replace(/file:\/\/(?=\/|[A-Za-z]:)/g, '')
  // The longer first: Bridge AI can be in the home folder (~/Applications), or a home in its folder.
  const variants = (p, as) => (p ? [...new Set([p, p.replace(/\\/g, '/'), p.replace(/\\/g, '\\\\'), p.replace(/\//g, '\\')])].map((v) => [v, as]) : [])
  for (const [v, as] of [...variants(app, '<app>'), ...variants(home, '~')].sort((a, b) => b[0].length - a[0].length)) s = s.replace(new RegExp(`${esc(v)}(?![\\w.-])`, 'gi'), as)
  // Any other path that's someone's, then a home folder named anywhere else (it names its user).
  s = s.replace(PATHS, (m) => (KEEP_PATH.test(m) ? m : m.startsWith('~') ? '~/<path>' : '<path>'))
  s = s.replace(all(HOME_PATH), (m, user) => (GENERIC_USER.has(user.toLowerCase()) ? m : m.slice(0, -user.length) + '<user>'))
  // Anything long and random enough to be a key nobody listed.
  s = s.replace(/(?<![\w-])[A-Za-z0-9_-]{40,}={0,2}(?![\w-])/g, '<key>')
  s = s.replace(all(EMAIL), (m) => (ALLOW_EMAIL.test(m) ? m : '<email>'))
  s = s.replace(all(TAILNET), (m) => (GENERIC_TAILNET.test(m) ? m : '<tailnet name>'))
  // A relay or a site on someone's own Cloudflare account names the account.
  s = s.replace(/\b[\w-]+(?:\.[\w-]+)*\.(workers\.dev|pages\.dev|trycloudflare\.com)\b/gi, '<host>.$1')
  // An address on a network (this computer's own, 127.0.0.1, stays).
  s = s.replace(/(?<![\w./:-])(?!127\.)(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.])/g, '<ip address>')
  // The names that are yours, longest first, as whole words; not inside Bridge AI's own paths and
  // its own address (a project called "server" leaves <app>/server/index.js as it is).
  const named = names.filter(([v]) => typeof v === 'string' && v.trim().length >= 3).map(([v, as]) => [v.trim(), as]).sort((a, b) => b[0].length - a[0].length)
  if (!named.length) return s
  const own = /<app>[^\s'"()]*|https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?[^\s'"()]*/g
  const swap = (part) => named.reduce((t, [v, as]) => t.replace(new RegExp(`(?<![A-Za-z0-9])${esc(v)}(?![A-Za-z0-9])`, 'gi'), as), part)
  let out = ''
  let at = 0
  for (const m of s.matchAll(own)) { out += swap(s.slice(at, m.index)) + m[0]; at = m.index + m[0].length }
  return out + swap(s.slice(at))
}

// The boundary around the whole window is called after the app: there, where says nothing more.
const WHOLE = new Set(['Bridge AI', 'view'])
const KINDS = {
  ui: { title: 'The window hit an error', what: (where) => `Bridge AI's window stopped drawing${where && !WHOLE.has(where) ? ` (${where})` : ''}.` },
  server: { title: 'The server stopped', what: () => 'Bridge AI\'s server stopped by itself and started again.' },
  window: { title: 'The window went away', what: () => 'The desktop app\'s window stopped (its renderer went away) and was opened again.' },
  gpu: { title: 'The graphics process went away', what: () => 'The desktop app\'s graphics process (GPU) stopped.' },
}
export const kindOf = (k) => KINDS[k] || KINDS.ui

// The issue's text, as { title, what, details }: what happened in a sentence (the person adds what
// they were doing), then the details for fixing it. c: { kind, where, message, stack, reason,
// exitCode, at }; about: { version, install, system, language }; settings: { name: value };
// log: { name, lines }. Nothing here is taken out yet: scrub() does that.
export function reportText(c = {}, { about = {}, settings = {}, log = null } = {}) {
  const k = kindOf(c.kind)
  const first = String(c.message || c.reason || '').split('\n')[0].trim().slice(0, 90)
  const lines = [
    `Bridge AI: ${about.version || 'unknown'}${about.install ? ` (${about.install})` : ''}`,
    about.system && `System: ${about.system}`,
    about.language && `Language: ${about.language}`,
    `What crashed: ${k.title.replace(/^The /, 'the ')}${c.where && !WHOLE.has(c.where) ? ` (${c.where})` : ''}`,
    c.at && `When: ${String(c.at).slice(0, 16).replace('T', ' ')} UTC`,
    c.reason && `Why: ${c.reason}${c.exitCode != null ? ` (exit code ${c.exitCode})` : ''}`,
    '',
    c.message && `Error: ${String(c.message).trim()}`,
    c.stack && `\n${String(c.stack).trim()}`,
  ]
  const set = Object.entries(settings).filter(([, v]) => v != null && v !== '')
  if (set.length) lines.push('', 'Settings:', ...set.map(([n, v]) => `  ${n}: ${v}`))
  if (log?.lines?.length) lines.push('', `Last lines of ${log.name}:`, ...log.lines)
  return {
    title: `${k.title}${first ? `: ${first}` : ''}`,
    what: `${k.what(c.where)}\n\nWhat I was doing when it happened: `,
    details: lines.filter((l) => l !== false && l != null).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  }
}

// The link to GitHub's new-issue page, filled in from the bug template (.github/ISSUE_TEMPLATE/
// bug.yml: its fields what, steps and diagnostics). { url, fits }: when the whole text doesn't fit
// in a link, the link carries the title and what happened, and says to paste the details, which
// the caller puts on the clipboard.
export function issueLink({ title = '', what = '', details = '' } = {}, max = MAX_URL) {
  const base = `https://github.com/${REPO}/issues/new?template=bug.yml&labels=bug`
  const link = (o) => base + Object.entries(o).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('')
  const url = link({ title, what, diagnostics: details })
  if (url.length <= max) return { url, fits: true }
  const short = link({ title: title.slice(0, 200), what: what.slice(0, 1500), diagnostics: 'Bridge AI copied the details: paste them here.' })
  return { url: short.length <= max ? short : link({ title: title.slice(0, 200), diagnostics: 'Bridge AI copied the details: paste them here.' }), fits: false }
}

// The whole text, for the clipboard.
export const issueText = ({ title = '', what = '', details = '' } = {}) => `${title}\n\n${what}\n\n${details}`.trim()
