// Who may use this server, after guard.js has checked where a request comes from. guard.js keeps
// out web pages (the Host, the Origin, Sec-Fetch-Site) and, through Tailscale, anyone but you; this
// keeps out the other programs on this computer, which guard.js can't tell from Bridge AI's own
// (none of them sends an Origin). Every request needs one of:
//   - the key (apitoken.js) as Authorization: Bearer <key>: the CLI, the Chief of Staff's
//     bin/bridge, `bridge-ai mcp`, the desktop app's main process, and the relay, which runs a
//     paired phone's or another of your computers' requests here (relay.js, inbox.js) once that
//     device has shown its own key: pairing and linking are as they were;
//   - the cookie made from the key: a window of the desktop app (its main process sets it before
//     any window opens), or a browser tab let in by a one-time link (below);
//   - Tailscale saying it's you, through this server's own Tailscale address while Tailscale
//     publishes it (Use on your phone), as before: guard.js checks who it is.
// Public on purpose, with no key: the app's built files (its code, styles and pictures, the same for
// everyone with this version, so a page can load to say how to get in), /api/health (that Bridge AI
// is here, and its version), and the one-time link itself. The relay's pages and the demo aren't
// served here at all: Cloudflare and the website serve them.
//
// An HTML preview's own files load from its sandbox, which carries no cookie (it's no site at all
// to the browser), so their address carries a key of its own instead, for that agent's folder (or
// that place) only, and only to read: /api/agents/<pane>/site/~<key>/<path> (Files.jsx asks for it).
// It's checked here and taken off before the routes see the address. Another computer's, through
// /m/<id>/, goes on to that computer, which checks its own.
//
// A browser tab opened without the cookie gets a page saying how to get in. The one-time link
// (/?open=<code>, made by POST /api/browser-link, which needs the key: View › Open in Browser,
// `bridge-ai open`) works once, for two minutes, and leaves the cookie: HttpOnly (no page script
// can read it), SameSite=Strict (no other site's page or link carries it), for every path here.
// Strict also leaves it off a link to Bridge AI followed from another site (an email, a chat):
// that tab is sent on to the same address once from here, where it has it again.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { cookieName, cookieValue, same } from './apitoken.js'

const SITE = /^(\/m\/[A-Za-z0-9_-]{1,20})?\/api\/agents\/([^/]+)\/site\/~([A-Za-z0-9_-]{16,64})\//
const CODE_MS = 2 * 60_000
const COOKIE_DAYS = 400 // as long as browsers keep one
const PUBLIC_API = new Set(['/api/health'])

// port: this server's own (the cookie is named for it); token(): the key; ui: the built UI's folder;
// viaTailnet(req): guard.js found it came through Tailscale from you; tailnetServed(): Tailscale
// publishes this server now.
export function makeAuth({ port, token, ui, viaTailnet = () => false, tailnetServed = () => false }) {
  const NAME = cookieName(port)
  const codes = new Map() // code -> { until, to }
  const bearer = (req) => { const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || '')); return m ? m[1] : null }
  const cookieOf = (req) => {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=')
      if (i > 0 && part.slice(0, i).trim() === NAME) { try { return decodeURIComponent(part.slice(i + 1).trim()) } catch { return null } }
    }
    return null
  }
  const keyed = (req) => same(bearer(req), token()) || same(cookieOf(req), cookieValue(token()))
  const allowed = (req) => keyed(req) || (viaTailnet(req) && tailnetServed())
  const siteKey = (pane) => crypto.createHmac('sha256', token()).update(`site\n${pane}`).digest('base64url').slice(0, 32)

  // A file of the built UI (not its page): public.
  const builtFile = (p) => {
    if (p === '/' || p.endsWith('.html') || p.startsWith('/api/') || p.startsWith('/m/')) return false
    const file = path.resolve(ui(), `.${decodeURIComponent(p)}`)
    if (!file.startsWith(path.resolve(ui()) + path.sep)) return false
    try { return fs.statSync(file).isFile() } catch { return false }
  }
  const isPublic = (req) => (req.method === 'GET' || req.method === 'HEAD') && (PUBLIC_API.has(req.path) || (() => { try { return builtFile(req.path) } catch { return false } })())
  // A page to show, not something a page fetches (as machinepages.js reads it).
  const h = (req, k) => String(req.headers[`sec-fetch-${k}`] || '')
  const page = (req) => req.method === 'GET' && !req.path.startsWith('/api/') && (h(req, 'mode') === 'navigate' || /^(document|iframe|frame)$/.test(h(req, 'dest')) || (!h(req, 'mode') && /text\/html/.test(req.headers.accept || '')))

  const setCookie = (res) => res.append('Set-Cookie', `${NAME}=${cookieValue(token())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_DAYS * 86400}`)

  // A one-time link: the code, kept until it's used or two minutes are up. to: where it lands, a
  // path of this server's ("/?window=w1"), "/" if not.
  // ms: how long it works (two minutes; the one `npm start` prints, longer).
  function link({ to = '/', base, ms = CODE_MS } = {}) {
    const now = Date.now()
    for (const [c, v] of codes) if (v.until < now) codes.delete(c)
    if (codes.size > 50) codes.delete(codes.keys().next().value)
    const code = crypto.randomBytes(24).toString('base64url')
    const where = typeof to === 'string' && /^\/(?![/\\])/.test(to) ? to : '/'
    codes.set(code, { until: now + ms, to: where })
    return { url: `${base}/?open=${code}`, expires: new Date(now + ms).toISOString() }
  }
  const take = (code) => {
    const v = codes.get(String(code || ''))
    if (!v) return null
    codes.delete(code)
    return v.until >= Date.now() ? v : null
  }

  const http = (req, res, next) => {
    if (req.method === 'GET' && req.path === '/' && typeof req.query.open === 'string') {
      const v = take(req.query.open)
      if (v) { setCookie(res); res.set('Cache-Control', 'no-store'); return res.redirect(303, v.to) }
      if (!allowed(req)) return howTo(res, 'used')
      const q = new URLSearchParams(req.query)
      q.delete('open')
      return res.redirect(303, `/${q.size ? `?${q}` : ''}`)
    }
    const site = (req.method === 'GET' || req.method === 'HEAD') && SITE.exec(req.path)
    if (site) {
      if (site[1]) return next()
      let pane = null
      try { pane = decodeURIComponent(site[2]) } catch { /* not an address */ }
      if (!pane || !same(site[3], siteKey(pane))) return res.status(404).json({ error: 'Not found' })
      req.url = req.url.replace(`/site/~${site[3]}/`, '/site/')
      return next()
    }
    if (allowed(req) || isPublic(req)) return next()
    if (page(req)) {
      // Followed from another site, where the cookie stays behind: sent on from here, once.
      if (/^(cross-site|same-site)$/i.test(h(req, 'site'))) return again(res)
      return howTo(res)
    }
    res.status(401).json({ error: 'Bridge AI needs its key for this. Programs on this computer read it from api-token in Bridge AI\'s data folder; a browser tab gets in with View › Open in Browser in the app, or `bridge-ai open`.', code: 'apiKey' })
  }
  // A WebSocket: a page's carries the cookie; a program's (bridge-ai attach) the key.
  const upgrade = (req) => allowed(req)
  return { http, upgrade, link, allowed, siteKey, NAME }
}

const PAGE_STYLE = `:root{color-scheme:light dark;--bg:#eef0f3;--pane:#fff;--ink:#1d2330;--muted:#5b6475;--line:#d9dde5;--accent:#3b6fd8}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--pane:#171a21;--ink:#e6e8ee;--muted:#a3abba;--line:#2a2f3a;--accent:#7aa2ff}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding:16px}
main{max-width:30rem;background:var(--pane);border:1px solid var(--line);border-radius:14px;padding:28px 28px 22px}
h1{font-size:19px;margin:0 0 10px}p{margin:0 0 12px;color:var(--muted)}ol{margin:0 0 12px;padding-left:20px}li{margin:4px 0}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:1px 6px;color:var(--ink)}b{color:var(--ink)}`

// It looks every two seconds whether this browser has been let in meanwhile (the link opens in a tab
// of its own), and then opens what was asked for here, its address as it was (a tester's ?early=…).
const WATCH = "setInterval(()=>fetch('/api/health',{cache:'no-store'}).then((r)=>r.json()).then((j)=>{if(j.in)location.reload()},()=>{}),2000)"
const WATCH_SHA = crypto.createHash('sha256').update(WATCH).digest('base64')
function howTo(res, why) {
  res.status(401).set({ 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${WATCH_SHA}'; connect-src 'self'; frame-ancestors 'self'`, 'X-Content-Type-Options': 'nosniff' })
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Bridge AI</title><style>${PAGE_STYLE}</style></head><body><main>
<h1>${why === 'used' ? 'That link has been used' : 'Open Bridge AI from the app'}</h1>
<p>${why === 'used' ? 'Each link to open Bridge AI in a browser works once, for two minutes. Ask for a new one:' : 'Bridge AI opens only in a browser you let in, so other programs and websites can\'t use it. To let this browser in:'}</p>
<ol><li>In the Bridge AI app, choose <b>View › Open in Browser</b>.</li><li>Or, in a terminal on this computer, run <code>bridge-ai open</code>.</li></ol>
<p>This browser then stays let in, and this page opens by itself.</p>
</main><script>${WATCH}</script></body></html>`)
}

// Sent on to the same address from this page, so the tab asks with its cookie (a link from another
// site leaves a SameSite=Strict cookie behind). The hash rides along. Once: that request comes from here.
function again(res) {
  const script = 'location.replace(location.href)'
  const sha = crypto.createHash('sha256').update(script).digest('base64')
  res.status(401).set({ 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${sha}'; frame-ancestors 'self'`, 'X-Content-Type-Options': 'nosniff' })
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bridge AI</title><script>${script}</script></head><body></body></html>`)
}
