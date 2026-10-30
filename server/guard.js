// Bridge drives your terminals, so only Bridge's own pages may talk to it. The server listens on
// 127.0.0.1, but a web page open in your browser can still reach 127.0.0.1: by opening a WebSocket
// (browsers don't stop that cross-site), by loading a link or a picture from it, or by pointing its
// own domain at 127.0.0.1 (DNS rebinding). So:
//   - the Host must be this device or your Tailscale name;
//   - a browser's Origin must be the very page it's on: the same host and port as the request. Another
//     app on localhost (a project's dev server in Preview, say) or another *.ts.net site isn't;
//   - a request a page on another site sent (Sec-Fetch-Site) can't reach /api, links and pictures
//     too, except the files of an HTML preview, which load from its sandbox and can't be read back;
//   - through Tailscale (a *.ts.net name), only you: Tailscale says who's asking (Tailscale-User-Login,
//     which it sets itself), and it has to be who this computer belongs to. Someone else on the
//     tailnet, a shared or tagged device, or a visitor through Funnel isn't.

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const DEFAULT_PORT = { 'http:': '80', 'https:': '443' }
const PREVIEW_FILES = /^\/api\/agents\/[^/]+\/site\//

// tailnetOwner: () => this computer's Tailscale login, or null (phone.js).
export function makeGuard(cfg = {}, { tailnetOwner = async () => null } = {}) {
  const extra = new Set((cfg.allowedHosts || []).map((h) => String(h).toLowerCase()))
  const hostOk = (host) => {
    if (!host) return false
    const name = host.toLowerCase().replace(/:\d+$/, '')
    return LOOPBACK.has(name) || name.endsWith('.ts.net') || extra.has(name)
  }
  // The Host as a browser writes an origin's host: lower case, without the scheme's own port.
  const asOrigin = (host, scheme) => {
    const h = String(host || '').toLowerCase()
    const d = DEFAULT_PORT[scheme]
    return d && h.endsWith(`:${d}`) ? h.slice(0, -d.length - 1) : h
  }
  const originOk = (origin, host) => {
    if (!origin) return true // not a browser (curl, the bridge CLI, the Mac app's own fetches)
    if (origin === 'null') return false
    try {
      const o = new URL(origin)
      return hostOk(o.host) && o.host === asOrigin(host, o.protocol)
    } catch { return false }
  }
  const elsewhere = (req) => /^(cross-site|same-site)$/i.test(req.headers['sec-fetch-site'] || '')
  const tailnetName = (host) => { const name = String(host || '').toLowerCase().replace(/:\d+$/, ''); return name.endsWith('.ts.net') && !extra.has(name) }
  const you = async (req) => {
    if (!tailnetName(req.headers.host) && !tailnetName(req.headers['x-forwarded-host'])) return true
    const who = String(req.headers['tailscale-user-login'] || '').toLowerCase()
    const own = String((await tailnetOwner().catch(() => null)) || '').toLowerCase()
    return !!who && who === own
  }

  const http = async (req, res, next) => {
    if (!hostOk(req.headers.host)) return res.status(403).json({ error: 'Host not allowed' })
    if (!originOk(req.headers.origin, req.headers.host)) return res.status(403).json({ error: 'Origin not allowed' })
    if (req.path.startsWith('/api/') && elsewhere(req) && !(req.method === 'GET' && PREVIEW_FILES.test(req.path))) return res.status(403).json({ error: 'Not from another site' })
    if (!(await you(req))) return res.status(403).json({ error: 'Through Tailscale, Bridge AI answers only the person this computer belongs to. Sign in to Tailscale as them on this device.' })
    next()
  }
  // WebSockets: a browser always sends Origin, so a page from another site or port is refused. No
  // Origin means a program on this device (the `bridge-ai attach` terminal client), which is allowed.
  const upgrade = async (req) => hostOk(req.headers.host) && originOk(req.headers.origin, req.headers.host) && !elsewhere(req) && await you(req)
  return { http, upgrade }
}
