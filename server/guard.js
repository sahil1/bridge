// Bridge drives your terminals, so only Bridge's own pages may talk to it. The server listens on
// 127.0.0.1, but a web page open in your browser can still reach 127.0.0.1: by opening a WebSocket
// (browsers don't stop that cross-site) or by pointing its own domain at 127.0.0.1 (DNS rebinding).
// So: the Host must be this machine or your Tailscale name, and a browser's Origin must be too.

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

export function makeGuard(cfg = {}) {
  const extra = new Set((cfg.allowedHosts || []).map((h) => String(h).toLowerCase()))
  const hostOk = (host) => {
    if (!host) return false
    const name = host.toLowerCase().replace(/:\d+$/, '')
    return LOOPBACK.has(name) || name.endsWith('.ts.net') || extra.has(name)
  }
  const originOk = (origin) => {
    if (!origin) return true // not a browser (curl, the bridge CLI, the Mac app's own fetches)
    if (origin === 'null') return false
    try { return hostOk(new URL(origin).host) } catch { return false }
  }

  const http = (req, res, next) => {
    if (!hostOk(req.headers.host)) return res.status(403).json({ error: 'Host not allowed' })
    if (!originOk(req.headers.origin)) return res.status(403).json({ error: 'Origin not allowed' })
    next()
  }
  // WebSockets: a browser always sends Origin, so a page from another site is refused. No Origin
  // means a program on this machine (the `bridge-ai attach` terminal client), which is allowed.
  const upgrade = (req) => hostOk(req.headers.host) && originOk(req.headers.origin)
  return { http, upgrade }
}
