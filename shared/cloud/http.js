// One small JSON-over-HTTP helper for the cloud agent adapters. Plain fetch only (no Node APIs),
// so the same code runs in Bridge AI's server and, later, inside the phone apps. The caller hands
// in fetch, the base URL and the headers that carry the key.

export class CloudError extends Error {
  // status: the HTTP status (0 when the provider couldn't be reached). retryAfter: how long the
  // provider asked us to wait, in ms. auth: the key was refused. limited: a rate limit.
  constructor(message, { status = 0, retryAfter = null, auth = false, limited = false, network = false } = {}) {
    super(message)
    this.name = 'CloudError'
    this.status = status
    this.retryAfter = retryAfter
    this.auth = auth
    this.limited = limited
    this.network = network
  }
}

// How long a response asks us to wait: Retry-After (seconds or a date), or GitHub's
// x-ratelimit-reset (epoch seconds) once x-ratelimit-remaining is 0.
export function waitFrom(headers, now = Date.now()) {
  const get = (n) => (headers && typeof headers.get === 'function' ? headers.get(n) : null)
  const ra = get('retry-after')
  if (ra) {
    const s = Number(ra)
    if (Number.isFinite(s)) return Math.max(0, s * 1000)
    const at = Date.parse(ra)
    if (Number.isFinite(at)) return Math.max(0, at - now)
  }
  if (get('x-ratelimit-remaining') === '0') {
    const reset = Number(get('x-ratelimit-reset'))
    if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - now)
  }
  return null
}

// The provider's own words for what went wrong, without ever repeating the key back.
function messageOf(data, text) {
  const e = data?.error
  const m = (typeof e === 'string' ? e : e?.message) || data?.message || data?.detail || (typeof data?.errors?.[0]?.message === 'string' ? data.errors[0].message : '') || ''
  return String(m || (text && !text.trimStart().startsWith('<') ? text : '')).replace(/\s+/g, ' ').trim().slice(0, 240)
}
const scrub = (s, secrets) => secrets.filter((k) => k && k.length > 6).reduce((out, k) => out.split(k).join('***'), s)

// call(method, path, { query, body, headers }) -> parsed JSON (or null for an empty body).
// etags: an optional Map, so repeated GETs can be answered with 304 Not Modified (GitHub doesn't
// count those against the rate limit).
export function makeCall({ fetch, base, headers = {}, name = 'The provider', secrets = [], timeout = 20000, etags = null }) {
  if (typeof fetch !== 'function') throw new Error('fetch is required')
  const root = String(base || '').replace(/\/+$/, '')
  return async function call(method, path, { query, body, headers: extra = {} } = {}) {
    const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString() : ''
    const url = `${/^https?:/.test(path) ? path : root + path}${qs ? `${path.includes('?') ? '&' : '?'}${qs}` : ''}`
    const h = { Accept: 'application/json', ...headers, ...extra }
    if (body !== undefined) h['Content-Type'] = 'application/json'
    const cached = method === 'GET' && etags ? etags.get(url) : null
    if (cached) h['If-None-Match'] = cached.etag
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null
    let res
    try {
      res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl?.signal })
    } catch (e) {
      throw new CloudError(e?.name === 'AbortError' ? `${name} took too long to answer` : `Couldn't reach ${name}`, { network: true })
    } finally { if (timer) clearTimeout(timer) }
    if (res.status === 304 && cached) return cached.data
    const text = await res.text().catch(() => '')
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    if (!res.ok) {
      const wait = waitFrom(res.headers)
      // GitHub answers a spent rate limit with 403 and x-ratelimit-remaining: 0.
      const limited = res.status === 429 || (wait != null && (res.status === 403 || res.status === 503))
      // The key itself refused: 401, or Google's 400 "API key not valid" (reason API_KEY_INVALID).
      // A 403 usually means a valid key without access to one repo, so it isn't counted here.
      const auth = !limited && (res.status === 401 || (res.status === 400 && /api key not valid|API_KEY_INVALID/i.test(text)))
      const said = scrub(messageOf(data, text), secrets)
      const msg = limited ? `${name} asked us to slow down${wait ? ` (try again in ${Math.ceil(wait / 1000)}s)` : ''}`
        : res.status === 401 ? `${name} didn't accept the key${said ? `: ${said}` : ''}`
        : `${name}: HTTP ${res.status}${said ? `, ${said}` : ''}`
      throw new CloudError(msg, { status: res.status, retryAfter: wait, auth, limited })
    }
    const etag = res.headers?.get?.('etag')
    if (etag && etags && method === 'GET') {
      etags.set(url, { etag, data })
      if (etags.size > 200) etags.delete(etags.keys().next().value)
    }
    return data
  }
}

// The header that carries the key, from an adapter's info.auth ({ header, scheme }). The phone
// apps add it themselves, from the same info (vite.config.js writes it out for them).
export const authHeader = (auth, key) => ({ [auth.header]: auth.scheme ? `${auth.scheme} ${key}` : key })

// Shorten a long text to one line for previews and notifications.
export const oneLine = (s, n = 200) => {
  const t = String(s || '').replace(/[*`#>_]/g, '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

// "https://github.com/owner/repo(.git)" or "owner/repo" -> "owner/repo" (null if it isn't one).
export function repoName(s) {
  const t = String(s || '').trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const m = t.match(/^(?:https?:\/\/[^/]+\/|git@[^:]+:)?([\w.-]+\/[\w.-]+(?:\/[\w.-]+)*)$/)
  return m ? m[1] : null
}
