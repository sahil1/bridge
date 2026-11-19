// A bot's way in and out of Microsoft Teams (Bots, a beta feature): your own Azure Bot, with the
// name you give the bot, and the Teams app Settings makes for it (teamsapp.js) uploaded to Teams.
// It's a connector (connector.js), one per bot, and does what one does: says whether it's
// connected and why not, hands over each message put to the bot, gives the conversation a question
// was asked in, posts a reply where it was asked, and lists who can be picked to ask.
//
// Teams reaches a bot only over HTTPS from the internet: it sends each message (an activity) to the
// bot's messaging endpoint. So the bot listens on this computer only (127.0.0.1, its own port,
// 3978 unless set), at /api/messages and nothing else of Bridge AI, and you make that reachable
// with a tunnel of your own (Cloudflare Tunnel, or Microsoft's dev tunnels), whose address is the
// Azure Bot's messaging endpoint. Never through Bold Bridge or its relay. Settings can check the
// tunnel reaches this computer (checkEndpoint).
//
// Anyone can send anything to an address on the internet, so each activity is taken only with a
// token Microsoft's Bot Connector signed for it, checked before anything else is done with it:
//   - a JWT in the Authorization header, signed RS256 with one of the keys Microsoft publishes
//     (the OpenID metadata at login.botframework.com names where; read once a day, and again for a
//     key it doesn't know, at most every half a minute), and with that key endorsed for Teams
//     (msteams);
//   - issued by the Bot Framework (iss https://api.botframework.com), for this bot (aud its app
//     ID), and not expired (five minutes' leeway either way);
//   - for the address it came from: the token's serviceurl claim is the activity's serviceUrl,
//     and that's one of Microsoft's.
// Anything else is turned away (401) unread, and Settings says how many were and why the last one
// was. Each one taken is answered at once (200) and handled after.
//
// What it hands over: a mention of the bot, a message in a chat with it, and a reply in a channel
// thread it's answering in (frontdesk.js says which; the Teams app asks to be sent a channel's and
// a chat's messages, for those). With each, who wrote it, as the desk takes them (connector.js
// person): someone from another organization (another tenant), or anonymous, is external; a guest
// account in yours is a guest; someone Teams couldn't say anything about (no Entra ID, a lookup that
// failed), or anyone while no organization is set, is unknown. Edits and deletions in its threads
// are handed over too.
//
// Teams doesn't let a bot read a conversation's earlier messages, nor react to one. So what it was
// sent is kept, in memory only (the last 50 in each conversation, for three days, gone when Bridge
// AI closes), for a question's context; the message a question quotes is in the question itself.
// For 👀 it shows "typing…" instead, and ✅ is the answer itself. What was asked while Bridge AI
// wasn't running never reaches it: Teams tells the asker the bot didn't answer.
//
// Replies go to the activity's serviceUrl, with a token from Microsoft Entra ID for the bot's app
// (client credentials: its app ID and a client secret), kept until shortly before it expires.
// Teams' rate limits are kept: a 429 waits as long as Retry-After says, then says so.
//
// The app ID, its client secret and your organization's tenant ID are kept in the bot's teams.json
// in the data folder, readable by you only (0600): never in config.json, never in a log, a record
// or a command line, and never given to an agent; the secret is sent only to Microsoft Entra ID.
// BRIDGE_TEAMS_URL (tests): a stand-in for Microsoft's sign-in, keys and Bot Connector
// (test/stand-ins/teams.mjs).
import fs from 'node:fs'
import http from 'node:http'
import crypto from 'node:crypto'
import { writeFileAtomic } from './paths.js'
import { failure, masked, sleep, split } from './connector.js'
import { appPackage, SHORT_MAX } from './teamsapp.js'

const STANDIN = () => String(process.env.BRIDGE_TEAMS_URL || '').replace(/\/+$/, '')
const OPENID = () => `${STANDIN() || 'https://login.botframework.com'}/v1/.well-known/openidconfiguration`
const SIGNIN = (tenant) => `${STANDIN() || 'https://login.microsoftonline.com'}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`
const ISSUER = 'https://api.botframework.com'
const SCOPE = 'https://api.botframework.com/.default'
export const PORT = 3978 // the Bot Framework's usual
const MAX_BODY = 256 * 1024
const LEEWAY = 300 // seconds
const KEYS_EVERY = 24 * 3600 * 1000
const UNKNOWN_KEY_EVERY = 30 * 1000
const KEEP_MSGS = 50
const KEEP_CONVERSATIONS = 300
const KEEP_DAYS = 3
const LONGEST = 25000 // characters in a message (Teams takes about 28 KB)
const LONGEST_SAID = 1500
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TENANT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i
// Microsoft's Bot Connector addresses for Teams (and its government clouds): only these get a token.
const SERVICE_HOSTS = [/^smba\.trafficmanager\.net$/, /\.botframework\.com$/, /\.botframework\.us$/, /\.teams\.microsoft\.com$/, /\.teams\.microsoft\.us$/]

const read = (file) => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : {} } catch { return {} } }
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const b64 = (s) => Buffer.from(s, 'base64url')
const now = () => new Date().toISOString()

// An address the bot's token may go to: one of Microsoft's Bot Connector's, over HTTPS (or the
// stand-in's, in tests).
export function trustedService(u) {
  let x
  try { x = new URL(String(u)) } catch { return false }
  if (x.username || x.password) return false
  const s = STANDIN()
  if (s) { try { if (x.origin === new URL(s).origin) return true } catch { /* not one */ } }
  return x.protocol === 'https:' && SERVICE_HOSTS.some((re) => re.test(x.hostname))
}
const trustedKeys = (u) => {
  let x
  try { x = new URL(String(u)) } catch { return false }
  const s = STANDIN()
  if (s) { try { return x.origin === new URL(s).origin } catch { return false } }
  return x.protocol === 'https:' && x.hostname === 'login.botframework.com'
}

// Teams' text, as plain words: the bot's own mention taken out, anyone else's as @name, other
// markup dropped and its escapes undone.
export function plainText(text, { me = null, mentions = [] } = {}) {
  let t = String(text || '').replace(/\r\n?/g, '\n')
  for (const e of mentions || []) {
    if (!e?.text) continue
    const label = String(e.text).replace(/<\/?at>/g, '')
    t = t.split(e.text).join(e.mentioned?.id === me ? '' : `@${label}`)
  }
  return t.replace(/<at>([^<]*)<\/at>/g, '@$1').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}
// What's posted: < > & escaped, so a reply's words can't be read as markup.
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---------- Checking a token ----------
// Microsoft's signing keys, from the OpenID metadata: read when first needed and once a day, and
// again for a key it doesn't know (a key Microsoft has just started using), at most every 30 s
// (so a flood of made-up tokens can't make it fetch them over and over).
export function makeKeys() {
  let keys = null
  let at = 0
  let missAt = 0
  let loading = null
  let fetches = 0
  async function load() {
    fetches++
    const get = async (u) => {
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) }).catch((e) => { throw failure(`Couldn't reach Microsoft for its signing keys: ${e.cause?.code || e.message}`, 'offline') })
      if (!r.ok) throw failure(`Microsoft's signing keys couldn't be read (${r.status})`, `http_${r.status}`)
      return r.json()
    }
    const meta = await get(OPENID())
    if (!trustedKeys(meta?.jwks_uri)) throw failure('The Bot Framework\'s OpenID metadata named keys somewhere other than Microsoft', 'invalid_metadata')
    const j = await get(meta.jwks_uri)
    keys = (j?.keys || []).filter((k) => k?.kty === 'RSA' && k.kid && k.n && k.e)
    at = Date.now()
  }
  const fresh = () => (loading ||= load().finally(() => { loading = null }))
  return {
    async find(kid) {
      if (!keys || Date.now() - at > KEYS_EVERY) await fresh()
      let k = keys.find((x) => x.kid === kid)
      if (!k && Date.now() - missAt > UNKNOWN_KEY_EVERY) { missAt = Date.now(); await fresh(); k = keys.find((x) => x.kid === kid) }
      return k || null
    },
    ready: () => (keys && Date.now() - at < KEYS_EVERY ? Promise.resolve() : fresh()),
    fetches: () => fetches,
  }
}

// The token on an activity, checked, in two steps: the token itself (signed by a key Microsoft
// publishes, by the Bot Framework, for this bot, in date), then what it vouches for (the activity
// came from Teams, at the address the token names, which is Microsoft's, with a key endorsed for
// Teams). Nothing in the activity is trusted until both say ok: { ok, why, claims }.
export async function verifyToken(authorization, { appId, keys, at = Date.now() }) {
  const no = (why) => ({ ok: false, why })
  const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/.exec(String(authorization || ''))
  if (!m) return no('No Bot Framework token')
  let head
  let claims
  try { head = JSON.parse(b64(m[1]).toString('utf8')); claims = JSON.parse(b64(m[2]).toString('utf8')) } catch { return no('A token that couldn\'t be read') }
  if (!head || !claims || typeof claims !== 'object') return no('A token that couldn\'t be read')
  if (head.alg !== 'RS256') return no(`A token signed with ${String(head.alg || 'nothing').slice(0, 20)}, not RS256`)
  if (!head.kid || typeof head.kid !== 'string') return no('A token without a key id')
  let key
  try { key = await keys.find(head.kid) } catch (e) { return no(e.message) }
  if (!key) return no('A token signed with a key Microsoft doesn\'t publish')
  let good = false
  try { good = crypto.verify('RSA-SHA256', Buffer.from(`${m[1]}.${m[2]}`), crypto.createPublicKey({ key: { kty: 'RSA', n: key.n, e: key.e }, format: 'jwk' }), b64(m[3])) } catch { good = false }
  if (!good) return no('A token whose signature doesn\'t match')
  const s = at / 1000
  if (claims.iss !== ISSUER) return no(`A token from ${String(claims.iss || 'no issuer').slice(0, 80)}, not the Bot Framework`)
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!appId || !aud.includes(appId)) return no('A token for another app (its audience isn\'t this bot\'s app ID)')
  if (!Number.isFinite(claims.exp) || s > claims.exp + LEEWAY) return no('An expired token')
  if (claims.nbf != null && (!Number.isFinite(claims.nbf) || s < claims.nbf - LEEWAY)) return no('A token not valid yet')
  return { ok: true, claims, key }
}
export function vouches(v, activity) {
  const no = (why) => ({ ok: false, why })
  if (!v?.ok) return no(v?.why || 'No token')
  if (!activity || typeof activity !== 'object') return no('No activity')
  if (activity.channelId !== 'msteams') return no(`An activity from ${String(activity.channelId || 'nowhere').slice(0, 40)}, not Teams`)
  if (!Array.isArray(v.key.endorsements) || !v.key.endorsements.includes(activity.channelId)) return no('A token signed with a key not endorsed for Teams')
  const said = v.claims.serviceurl ?? v.claims.serviceUrl
  if (!said || said !== activity.serviceUrl) return no('A token for another address (its serviceurl isn\'t the activity\'s)')
  if (!trustedService(activity.serviceUrl)) return no('An activity from an address that isn\'t Microsoft\'s')
  return { ok: true, claims: v.claims }
}
export async function verify(authorization, activity, o) {
  const v = await verifyToken(authorization, o)
  return v.ok ? vouches(v, activity) : v
}

// id: the bot's. file: where its credentials are kept. say(event): what happened, for its record.
// threads()/follows(): as Slack's (connector.js). port: where it listens (tests: 0, any free one).
export function makeTeams({ id = 'teams', file, say = () => {}, threads = () => [], follows = () => false, listens = () => false, port = null, defaultPort = PORT } = {}) {
  void threads // (Teams can't be asked for what was missed: nothing to read back)
  const FILE = file
  let kept = read(FILE)
  const save = () => writeFileAtomic(FILE, JSON.stringify(kept, null, 2), { mode: 0o600 })
  let saving = null
  const savedSoon = () => { if (saving) return; saving = setTimeout(() => { saving = null; try { save() } catch (e) { say({ what: 'save', ok: false, why: e.message }) } }, 2000); saving.unref?.() }
  const keys = makeKeys()
  const has = () => !!(kept.appId && kept.password && kept.tenantId)
  let hear = null
  let server = null
  let retry = null
  let tries = 0
  let st = { state: has() ? 'off' : 'no-tokens', why: null, since: now(), lastEvent: null, connectedAt: null, listening: null, rejected: { n: 0, why: null, at: null }, endpoint: null }
  const set = (patch) => { st = { ...st, ...patch, since: patch.state && patch.state !== st.state ? now() : st.since } }
  let rejectedSaid = 0

  // ---------- Microsoft Entra ID: the bot's own token ----------
  let tok = { value: null, until: 0 }
  async function signIn(c = kept) {
    const tenant = c.single === false ? 'botframework.com' : c.tenantId
    let r
    try {
      r = await fetch(SIGNIN(tenant), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.appId, client_secret: c.password, scope: SCOPE }), signal: AbortSignal.timeout(20000) })
    } catch (e) { throw failure(`Couldn't reach Microsoft Entra ID: ${e.cause?.code || e.message}`, 'offline') }
    const j = await r.json().catch(() => null)
    if (r.ok && j?.access_token) return { value: j.access_token, until: Date.now() + Math.max(60, Number(j.expires_in) || 3600) * 1000 - 5 * 60 * 1000 }
    const said = String(j?.error_description || j?.error || r.status)
    const code = /AADSTS(\d+)/.exec(said)?.[1]
    const why = code === '7000215' ? 'Microsoft turned the client secret down: copy its Value (not its ID) again, or make a new one'
      : code === '7000222' ? 'The client secret has expired: make a new one in the app registration (Certificates & secrets)'
        : code === '700016' ? 'There\'s no app with that app ID in that organization: check both on the Azure Bot\'s Configuration page'
          : code === '90002' || code === '900023' ? 'There\'s no organization with that tenant ID'
            : r.status >= 500 ? `Microsoft Entra ID answered ${r.status}` : `Microsoft Entra ID said: ${clip(said.split('\r\n')[0], 200)}`
    throw failure(why, r.status >= 500 ? `http_${r.status}` : 'invalid_auth')
  }
  async function bearer() {
    if (tok.value && Date.now() < tok.until) return tok.value
    tok = await signIn()
    return tok.value
  }

  // ---------- The Bot Connector ----------
  // One call to the activity's serviceUrl, only if it's Microsoft's, with the bot's token. A 429
  // waits as long as Retry-After says (up to `waits` times, a minute at most each), then says so;
  // a token turned down is made again once.
  async function connector(method, serviceUrl, route, body = null, { waits = 2 } = {}) {
    if (!trustedService(serviceUrl)) throw failure('Teams gave an address that isn\'t Microsoft\'s: nothing was sent there', 'invalid_service_url')
    const url = `${String(serviceUrl).replace(/\/+$/, '')}/${route.replace(/^\/+/, '')}`
    let again = true
    for (let i = 0; ; i++) {
      const t = await bearer()
      let r
      try {
        r = await fetch(url, { method, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) })
      } catch (e) { throw failure(`Couldn't reach Teams: ${e.cause?.code || e.message}`, 'offline') }
      if (r.status === 401 && again) { again = false; tok = { value: null, until: 0 }; continue }
      if (r.status === 429) {
        const wait = Math.min(60, Math.max(1, Number(r.headers.get('retry-after')) || 1))
        if (i >= waits) throw failure(`Teams asked to wait ${wait} s before more (rate limited)`, 'ratelimited', { retryAfter: wait })
        await sleep(wait * 1000)
        continue
      }
      const j = r.status === 204 ? null : await r.json().catch(() => null)
      if (r.ok) return j
      const said = j?.error?.message || j?.message || null
      if (r.status === 401 || r.status === 403) throw failure(`Teams turned the bot down (${r.status})${said ? `: ${clip(said, 160)}` : ''}: check its app ID and client secret`, 'not_authed')
      if (r.status === 404) throw failure('That conversation isn\'t there any more, or the bot was removed from it', 'channel_not_found')
      if (r.status === 400) throw failure(`Teams didn't take what was sent${said ? `: ${clip(said, 160)}` : ''}`, 'invalid_arguments')
      throw failure(`Teams answered ${r.status}`, `http_${r.status}`)
    }
  }
  const convPath = (conv) => `v3/conversations/${encodeURIComponent(conv)}`

  // ---------- Listening ----------
  // Its own small server, on this computer only: POST /api/messages, and the tunnel check.
  const checks = new Set() // nonces of checks under way
  const body = (req) => new Promise((resolve, reject) => {
    let n = 0
    const parts = []
    req.on('data', (c) => { if (n > MAX_BODY) return; n += c.length; if (n > MAX_BODY) { parts.length = 0; reject(Object.assign(new Error('too big'), { status: 413 })) } else parts.push(c) })
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })
  const end = (res, status, j = null) => { res.writeHead(status, j ? { 'content-type': 'application/json' } : {}); res.end(j ? JSON.stringify(j) : undefined) }
  function rejected(why) {
    st.rejected = { n: st.rejected.n + 1, why, at: now() }
    // (In the record once every ten minutes at most: anyone can send junk to an address.)
    if (Date.now() - rejectedSaid > 10 * 60 * 1000) { rejectedSaid = Date.now(); say({ what: 'rejected', ok: false, why: `A message to the bot's endpoint was turned away: ${why}` }) }
  }
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x')
    if (req.method === 'GET' && url.pathname === '/api/messages/check') {
      const n = url.searchParams.get('n') || ''
      return end(res, checks.has(n) ? 204 : 404)
    }
    if (url.pathname !== '/api/messages') return end(res, 404)
    if (req.method !== 'POST') return end(res, 405)
    let raw
    try { raw = await body(req) } catch (e) { res.setHeader('connection', 'close'); return end(res, e.status || 400) } // (one too big: said, and the rest of it not read)
    // The token first: nothing is done with what came until it's checked.
    const t = await verifyToken(req.headers.authorization, { appId: kept.appId, keys })
    if (!t.ok) { rejected(t.why); return end(res, 401, { error: 'Unauthorized' }) }
    let a = null
    try { a = JSON.parse(raw) } catch { a = null }
    if (!a || typeof a !== 'object' || Array.isArray(a) || !a.type) return end(res, 400)
    const v = vouches(t, a)
    if (!v.ok) { rejected(v.why); return end(res, 401, { error: 'Unauthorized' }) }
    if (a.recipient?.id && !String(a.recipient.id).endsWith(kept.appId)) { rejected('An activity for another bot'); return end(res, 401, { error: 'Unauthorized' }) }
    end(res, 200)
    took(a).catch((e) => say({ what: 'event', ok: false, why: e.message }))
  }
  function listen() {
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => { handle(req, res).catch(() => { try { end(res, 500) } catch { /* gone */ } }) })
      s.requestTimeout = 30000
      s.on('error', reject)
      s.listen(port ?? kept.port ?? defaultPort, '127.0.0.1', () => { s.off('error', reject); s.on('error', (e) => say({ what: 'listen', ok: false, why: e.message })); resolve(s) })
    })
  }

  // ---------- What comes in ----------
  const ring = new Map() // `${conversation}:${thread or ''}` -> [{ ts, at, person, text, you }], in memory only
  const refs = new Map() // message id -> its reply ({ serviceUrl, conversation, activity, channel })
  const quotes = new Map() // message id -> what it quoted
  const users = new Map() // Entra ID -> { user (Teams' id for them), serviceUrl, tenant }, for a word to them alone
  const members = new Map() // `${conversation}:${user}` -> { at, m } or { at, missing }
  const remember = (map, k, v, max = 2000) => { map.delete(k); map.set(k, v); if (map.size > max) map.delete(map.keys().next().value) }
  function keep(key, m) {
    const list = ring.get(key) || []
    if (list.some((x) => x.ts === m.ts)) return
    list.push(m)
    remember(ring, key, list.slice(-KEEP_MSGS), KEEP_CONVERSATIONS)
  }
  const tidy = setInterval(() => {
    const old = Date.now() - KEEP_DAYS * 86400000
    for (const [k, list] of ring) { const l = list.filter((x) => Date.parse(x.at) > old); if (l.length) ring.set(k, l); else ring.delete(k) }
  }, 3600 * 1000)
  tidy.unref?.()

  // Where an activity was: the conversation without its thread, the thread (a channel post's id),
  // and what kind.
  const placeOf = (a) => {
    const conv = String(a.conversation?.id || '')
    const kind = a.conversation?.conversationType || 'groupChat'
    const [base, root0] = conv.split(';messageid=')
    const root = kind === 'channel' ? root0 || String(a.id || '') : null
    return { conv, kind, base, root, dm: kind === 'personal' }
  }
  const nameOfPlace = (a, p) => (p.dm ? null : p.kind === 'channel' ? a.channelData?.channel?.name || (a.channelData?.channel?.id === a.channelData?.team?.id ? 'General' : null) : a.conversation?.name || 'Group chat')
  // The conversations it's in, for people() and channels() after Bridge AI starts again (ids,
  // names and addresses only).
  function known(a, p) {
    if (p.kind === 'channel' && a.serviceUrl) {
      kept.channels ||= {}
      const c = kept.channels[p.base]
      const name = nameOfPlace(a, p) || c?.name || null
      if (!c || c.serviceUrl !== a.serviceUrl || c.name !== name) {
        kept.channels[p.base] = { id: p.base, name, team: a.channelData?.team?.name || c?.team || null, serviceUrl: a.serviceUrl, tenant: a.channelData?.tenant?.id || null }
        const all = Object.entries(kept.channels)
        if (all.length > 200) kept.channels = Object.fromEntries(all.slice(-200))
        savedSoon()
      }
    }
    kept.conversations ||= {}
    const k = p.kind === 'channel' && a.channelData?.team?.id ? `team:${a.channelData.team.id}` : p.base
    const was = kept.conversations[k]
    const row = { conversation: p.kind === 'channel' ? a.channelData?.team?.id || p.base : p.base, serviceUrl: a.serviceUrl, kind: p.kind, name: p.kind === 'channel' ? a.channelData?.team?.name || was?.name || null : nameOfPlace(a, p), at: now() }
    if (!was || was.serviceUrl !== row.serviceUrl || was.name !== row.name || Date.now() - Date.parse(was.at || 0) > 86400000) {
      kept.conversations[k] = row
      const all = Object.entries(kept.conversations).sort((x, y) => String(y[1].at).localeCompare(String(x[1].at)))
      if (all.length > 200) kept.conversations = Object.fromEntries(all.slice(0, 200))
      savedSoon()
    }
  }

  // Who wrote it, as the desk takes them: another organization's tenant, or anonymous, external; a
  // guest account in yours, a guest; anything Teams couldn't say, unknown.
  async function personOf(a, p) {
    const aad = a.from?.aadObjectId || null
    const name = a.from?.name || null
    if (!aad) return { id: null, name, unknown: true, why: 'Teams didn\'t say who sent it' }
    if (!kept.tenantId) return { id: aad, name, unknown: true, why: 'No organization (tenant ID) is set for the bot' }
    const tenant = a.channelData?.tenant?.id || a.conversation?.tenantId || null
    if (!tenant) return { id: aad, name, unknown: true, why: 'Teams didn\'t say which organization they\'re in' }
    if (tenant.toLowerCase() !== String(kept.tenantId).toLowerCase()) return { id: aad, name, external: true, why: 'From another organization' }
    let m
    try { m = await memberOf(a.serviceUrl, p.kind === 'channel' ? a.channelData?.team?.id || p.base : p.base, a.from?.id || aad) } catch (e) {
      return { id: aad, name, unknown: true, why: `Couldn't check who they are: ${e.message}` }
    }
    const shown = m.name || name
    const role = String(m.userRole || '').toLowerCase()
    if (role === 'anonymous') return { id: aad, name: shown, external: true, why: 'Anonymous, in a meeting' }
    if (m.tenantId && String(m.tenantId).toLowerCase() !== String(kept.tenantId).toLowerCase()) return { id: aad, name: shown, external: true, why: 'From another organization' }
    if (role === 'guest') return { id: aad, name: shown, guest: true, why: 'A guest in your organization' }
    if (m.aadObjectId && m.aadObjectId !== aad) return { id: aad, name: shown, unknown: true, why: 'Teams gave two different ids for them' }
    return { id: aad, name: shown, guest: false, external: false }
  }
  async function memberOf(serviceUrl, conv, user) {
    const k = `${conv}:${user}`
    const had = members.get(k)
    if (had && Date.now() - had.at < 10 * 60 * 1000) return had.m
    const m = await connector('GET', serviceUrl, `${convPath(conv)}/members/${encodeURIComponent(user)}`)
    remember(members, k, { at: Date.now(), m }, 500)
    return m
  }

  // What's in a message besides its words: files and pictures (named only, never fetched here),
  // and a message it quoted (a reply with a quote), for its context.
  function extras(a) {
    const files = []
    let quote = null
    for (const x of a.attachments || []) {
      const t = String(x?.contentType || '')
      if (t === 'text/html') {
        const q = /<blockquote[^>]*itemtype="http:\/\/schema\.skype\.com\/Reply"[^>]*>([\s\S]*?)<\/blockquote>/i.exec(String(x.content || ''))
        if (q) {
          const who = /<strong[^>]*itemprop="mri"[^>]*>([\s\S]*?)<\/strong>/i.exec(q[1])
          const said = /<p[^>]*itemprop="preview"[^>]*>([\s\S]*?)<\/p>/i.exec(q[1])
          quote = { person: { id: null, name: who ? plainText(who[1]) : null }, text: plainText(said ? said[1] : q[1]) }
        }
      } else if (t === 'application/vnd.microsoft.teams.file.download.info') files.push({ id: x.content?.uniqueId || null, name: x.name || 'file', type: x.content?.fileType || null })
      else if (t.startsWith('image/')) files.push({ id: null, name: x.name || 'picture', type: t })
    }
    return { files, quote }
  }

  async function took(a) {
    st.lastEvent = now()
    if (!kept.bot?.id && a.recipient?.id) { kept.bot = { id: a.recipient.id, name: a.recipient.name || null }; savedSoon() }
    const p = placeOf(a)
    if (p.base && a.serviceUrl) known(a, p)
    if (a.type === 'message') return heard(a, p)
    if (a.type === 'messageUpdate' || a.type === 'messageDelete') return altered(a, p)
    if (a.type === 'conversationUpdate' || a.type === 'installationUpdate') {
      const me = a.recipient?.id
      const where = p.dm ? 'a chat' : p.kind === 'channel' ? a.channelData?.team?.name || 'a team' : 'a group chat'
      if ((a.membersAdded || []).some((x) => x.id === me) || a.action === 'add') say({ what: 'installed', ok: true, why: `Added to ${where}` })
      if ((a.membersRemoved || []).some((x) => x.id === me) || a.action === 'remove') say({ what: 'removed', ok: false, why: `Removed from ${where}` })
    }
  }

  // A message: a mention of the bot, one in a chat with it, or one in a channel thread it's
  // answering in, from a person, is handed over; every one is kept (in memory) for the context.
  async function heard(a, p) {
    if (!a.id || !p.base || !hear) return
    const me = a.recipient?.id
    if (a.from?.id && a.from.id === me) return
    const mention = (a.entities || []).some((e) => e?.type === 'mention' && e.mentioned?.id === me)
    const text = plainText(a.text, { me, mentions: (a.entities || []).filter((e) => e?.type === 'mention') })
    const { files, quote } = extras(a)
    const thread = p.kind === 'channel' && p.root !== String(a.id) ? p.root : null
    const at = Number.isFinite(Date.parse(a.timestamp)) ? new Date(a.timestamp).toISOString() : now()
    const said = { ts: String(a.id), at, person: { id: a.from?.aadObjectId || a.from?.id || null, name: a.from?.name || null }, text: clip(text, LONGEST_SAID), you: false }
    keep(`${p.base}:${p.kind === 'channel' ? p.root : ''}`, said)
    if (p.kind === 'channel' && !thread) keep(`${p.base}:`, said) // (a channel's own posts, for a question at its top)
    if (quote) remember(quotes, String(a.id), quote, 500)
    const reply = { serviceUrl: a.serviceUrl, conversation: p.kind === 'channel' ? `${p.base};messageid=${p.root}` : p.conv, activity: String(a.id), channel: p.base, thread: p.kind === 'channel' ? p.root : null }
    remember(refs, String(a.id), reply)
    if (a.from?.aadObjectId && a.from.id) remember(users, a.from.aadObjectId, { user: a.from.id, serviceUrl: a.serviceUrl, tenant: a.channelData?.tenant?.id || a.conversation?.tenantId || null }, 2000)
    const listen = !p.dm && !mention && !thread && listens(p.base)
    if (!p.dm && !mention && !listen && !(thread && follows(p.base, thread))) return
    const from = await personOf(a, p)
    await hear({
      ts: String(a.id), channel: p.base, thread, mention, dm: p.dm, from, text, ...(listen ? { via: 'listen' } : {}),
      place: p.dm ? { kind: 'dm', id: p.base, name: null } : { kind: 'channel', id: p.base, name: nameOfPlace(a, p), within: p.kind === 'channel' ? a.channelData?.team?.name || null : null, ...(p.kind !== 'channel' ? { private: true } : {}) },
      at, late: false, attachments: files, reply,
      // (A post at the top of a channel, answered with a post of its own there instead of in its
      // reply chain, where the bot answers in the channel: the desk picks. newPost below.)
      ...(p.kind === 'channel' && !thread ? { top: { channel: p.base, thread: null } } : {}),
    })
  }
  async function altered(a, p) {
    if (!hear?.change || !a.id) return
    const thread = p.kind === 'channel' ? p.root : null
    const text = a.type === 'messageDelete' ? null : plainText(a.text, { me: a.recipient?.id, mentions: (a.entities || []).filter((e) => e?.type === 'mention') })
    // (What it said before, if it was kept for the context.)
    const list = ring.get(`${p.base}:${thread || ''}`) || []
    const was = list.find((x) => x.ts === String(a.id))
    const before = was ? was.text : null
    if (was) { if (text == null) ring.set(`${p.base}:${thread || ''}`, list.filter((x) => x !== was)); else was.text = clip(text, LONGEST_SAID) }
    await hear.change({ kind: a.type === 'messageDelete' ? 'deleted' : 'changed', channel: p.base, ts: String(a.id), thread: thread || String(a.id), from: a.from?.aadObjectId ? { id: a.from.aadObjectId, name: a.from.name || null } : null, text, before })
  }

  // The conversation a question was asked in, from what the bot was sent (Teams has no way for a
  // bot to read it back): in a thread, its earlier messages; at the top of a channel, its latest
  // posts; in a chat, its latest messages; and the message a question quoted.
  function context({ channel, thread, ts, since = null, dm = false }) {
    const list = ring.get(`${channel}:${thread || ''}`) || []
    const i = list.findIndex((x) => x.ts === String(ts))
    const upTo = i >= 0 ? list.slice(0, i) : list.filter((x) => x.ts !== String(ts))
    const j = since ? upTo.findIndex((x) => x.ts === String(since)) : -1
    let messages = (j >= 0 ? upTo.slice(j + 1) : upTo).slice(thread ? -50 : -20).map(({ at, ...x }) => x) // eslint-disable-line no-unused-vars
    const q = quotes.get(String(ts))
    if (q && !messages.some((x) => x.text === q.text)) messages = [{ ts: null, person: q.person, text: clip(q.text, LONGEST_SAID), you: false }, ...messages]
    const kind = thread ? 'thread' : dm ? 'dm' : 'channel'
    const problem = thread && !messages.length && !since ? 'Teams doesn\'t let a bot read a thread\'s earlier messages, and none were sent to it while Bridge AI was running' : null
    return Promise.resolve({ kind, messages, pins: [], problem })
  }

  // ---------- What goes out ----------
  // A reply to the question, in its thread (a channel's) or its chat; or, with no question (a
  // scheduled post), a new post at the top of a channel, or a message in a group chat it's in. Over
  // Teams' longest, in parts.
  let line = Promise.resolve()
  async function newPost(reply, text) {
    const c = kept.channels?.[reply.channel]
    const g = Object.values(kept.conversations || {}).find((x) => x.conversation === reply.channel && x.kind === 'groupChat')
    if (c) {
      const j = await connector('POST', c.serviceUrl, 'v3/conversations', { isGroup: true, channelData: { channel: { id: c.id }, ...(c.tenant ? { tenant: { id: c.tenant } } : {}) }, activity: { type: 'message', text: escape(text), textFormat: 'markdown' } }, { waits: 1 })
      const ts = String(j?.activityId || String(j?.id || '').split(';messageid=')[1] || '')
      keep(`${c.id}:`, { ts, at: now(), person: { id: kept.bot?.id || null, name: kept.bot?.name || null }, text: clip(String(text), LONGEST_SAID), you: true })
      return { ts, channel: j?.id || c.id, conversation: j?.id || c.id, serviceUrl: c.serviceUrl, parts: [ts] }
    }
    if (g) {
      const j = await connector('POST', g.serviceUrl, `${convPath(g.conversation)}/activities`, { type: 'message', text: escape(text), textFormat: 'markdown' }, { waits: 1 })
      return { ts: String(j?.id || ''), channel: g.conversation, conversation: g.conversation, serviceUrl: g.serviceUrl, parts: [String(j?.id || '')] }
    }
    throw failure('The bot hasn\'t been sent anything in that channel yet, so Teams has given it no way to post there', 'channel_not_found')
  }
  function post(reply, text) {
    const go = line.then(async () => {
      if (reply?.channel && !reply.activity) return newPost(reply, text)
      if (!reply?.serviceUrl || !reply.conversation || !reply.activity) throw failure('Nowhere to reply to', 'invalid_arguments')
      const ids = []
      for (const part of split(text, LONGEST)) {
        const j = await connector('POST', reply.serviceUrl, `${convPath(reply.conversation)}/activities/${encodeURIComponent(reply.activity)}`, {
          type: 'message', text: escape(part), textFormat: 'markdown', replyToId: reply.activity, ...(kept.bot?.id ? { from: { id: kept.bot.id, name: kept.bot.name || undefined } } : {}), conversation: { id: reply.conversation },
        }, { waits: 1 })
        ids.push(String(j?.id || ''))
      }
      const said = { ts: ids[0], at: now(), person: { id: kept.bot?.id || null, name: kept.bot?.name || null }, text: clip(String(text), LONGEST_SAID), you: true }
      keep(`${reply.channel || reply.conversation.split(';messageid=')[0]}:${reply.thread || ''}`, said)
      return { ts: ids[0], channel: reply.conversation, conversation: reply.conversation, serviceUrl: reply.serviceUrl, parts: ids }
    })
    line = go.catch(() => {})
    return go
  }
  async function edit(posted, text) {
    if (!posted?.serviceUrl || !posted.conversation || !posted.ts) throw failure('Nothing posted to change', 'invalid_arguments')
    await connector('PUT', posted.serviceUrl, `${convPath(posted.conversation)}/activities/${encodeURIComponent(posted.ts)}`, { type: 'message', id: posted.ts, text: escape(text), textFormat: 'markdown' })
    return { ...posted, parts: [posted.ts] }
  }
  // "Typing…" in the question's conversation.
  async function typing(reply) {
    if (!reply?.serviceUrl || !reply.conversation) return false
    await connector('POST', reply.serviceUrl, `${convPath(reply.conversation)}/activities`, { type: 'typing' }, { waits: 0 })
    return true
  }
  // A word to one person only: in a chat between them and the bot (made if there isn't one yet).
  async function whisper(reply, aad, text) {
    const u = users.get(String(aad))
    if (!u?.user) throw failure('Teams hasn\'t told the bot how to reach them on their own', 'not_supported')
    const j = await connector('POST', u.serviceUrl, 'v3/conversations', { bot: { id: kept.bot?.id || `28:${kept.appId}` }, members: [{ id: u.user }], isGroup: false, ...(u.tenant ? { tenantId: u.tenant, channelData: { tenant: { id: u.tenant } } } : {}) }, { waits: 1 })
    if (!j?.id) throw failure('Teams didn\'t open a chat with them', 'invalid_arguments')
    const r = await connector('POST', u.serviceUrl, `${convPath(j.id)}/activities`, { type: 'message', text: escape(text), textFormat: 'markdown' }, { waits: 1 })
    return { ts: String(r?.id || ''), channel: j.id }
  }
  // The channels and group chats it's in, as far as it's been sent anything there (Teams lists a
  // team's channels only to an app with more permissions): [{ id, name, private }].
  async function channels() {
    const out = Object.values(kept.channels || {}).map((c) => ({ id: c.id, name: c.team ? `${c.name || 'General'} (${c.team})` : c.name || c.id, private: false }))
    for (const g of Object.values(kept.conversations || {}).filter((x) => x.kind === 'groupChat')) out.push({ id: g.conversation, name: g.name || 'Group chat', private: true })
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }
  // Teams has no reactions for bots: for 👀, "typing…"; for the rest, nothing, said so.
  async function react({ ts, name, off = false, reply = null }) {
    // (An answer going in the channel itself has no activity to type under: the question's own.)
    const r = reply?.serviceUrl ? reply : refs.get(String(ts)) || reply
    if (name === 'eyes' && !off && r) { await typing(r); return { shown: 'typing' } }
    return { skipped: 'Teams doesn\'t let a bot react to a message' }
  }

  // The people in the teams and chats it's in, to pick askers from: neither guests, anonymous
  // people nor anyone from another organization (they're never answered). Kept for ten minutes.
  let memo = { at: 0, list: null }
  async function people({ fresh = false } = {}) {
    if (!fresh && memo.list && Date.now() - memo.at < 10 * 60 * 1000) return memo.list
    const convs = Object.values(kept.conversations || {})
    if (!convs.length) return Object.assign([], { problem: 'Add the bot to a team or a chat in Teams first: then the people there can be picked' })
    const out = new Map()
    const problems = []
    for (const c of convs.slice(0, 50)) {
      try {
        let token = null
        do {
          const j = await connector('GET', c.serviceUrl, `${convPath(c.conversation)}/pagedmembers?pageSize=500${token ? `&continuationToken=${encodeURIComponent(token)}` : ''}`)
          for (const m of j?.members || []) {
            const role = String(m.userRole || '').toLowerCase()
            if (!m.aadObjectId || role === 'guest' || role === 'anonymous') continue
            if (m.tenantId && kept.tenantId && String(m.tenantId).toLowerCase() !== String(kept.tenantId).toLowerCase()) continue
            out.set(m.aadObjectId, { id: m.aadObjectId, name: m.name || m.givenName || m.email || m.aadObjectId, detail: m.email || m.userPrincipalName || null })
          }
          token = j?.continuationToken || null
        } while (token && out.size < 5000)
      } catch (e) { problems.push(`${c.name || c.kind}: ${e.message}`) }
    }
    const list = [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
    if (problems.length) return Object.assign(list, { problem: `Couldn't list everyone: ${problems.slice(0, 3).join('; ')}` })
    memo = { at: Date.now(), list }
    return list
  }
  const person = async (aad) => { const p = (await people()).find((x) => x.id === aad); return p ? { id: p.id, name: p.name, guest: false, external: false } : { id: aad, name: null, unknown: true, why: 'Not in a team or chat the bot is in' } }

  // ---------- Starting and stopping ----------
  // Listening, and signed in with Microsoft, and its signing keys read: connected (Teams can reach
  // it as soon as your tunnel does). A client secret turned down isn't tried again until it's
  // changed; anything else, again in a while.
  const BACKOFF = [2, 5, 10, 30, 60]
  function later(why, { final = false } = {}) {
    clearTimeout(retry)
    retry = null
    if (!hear) return
    if (final) { set({ state: 'error', why, nextTry: null }); say({ what: 'stopped', ok: false, why }); return }
    const s = BACKOFF[Math.min(tries, BACKOFF.length - 1)]
    tries++
    set({ state: 'reconnecting', why, nextTry: new Date(Date.now() + s * 1000).toISOString() })
    retry = setTimeout(() => { up().catch((e) => later(e.message)) }, s * 1000)
    retry.unref?.()
  }
  async function up() {
    if (!hear) return
    if (st.state !== 'reconnecting') set({ state: 'connecting', why: null })
    if (!server) {
      try { server = await listen() } catch (e) {
        const p = port ?? kept.port ?? defaultPort
        return later(e.code === 'EADDRINUSE' ? `Port ${p} is in use: pick another for this bot, and point your tunnel at it` : `Couldn't listen on port ${p}: ${e.message}`, { final: e.code === 'EADDRINUSE' || e.code === 'EACCES' })
      }
      if (!hear) { server.close(); server = null; return }
      set({ listening: { host: '127.0.0.1', port: server.address().port } })
    }
    try { tok = await signIn() } catch (e) { return later(e.message, { final: e.code === 'invalid_auth' }) }
    try { await keys.ready() } catch (e) { return later(e.message) }
    if (!hear) return
    tries = 0
    set({ state: 'connected', why: null, connectedAt: now(), nextTry: null })
    say({ what: 'connected', ok: true })
  }
  function start(fn) {
    hear = fn
    if (!has()) { set({ state: 'no-tokens', why: null }); return }
    if (['connected', 'connecting', 'reconnecting'].includes(st.state) && (server || retry)) return
    tries = 0
    up().catch((e) => later(e.message))
  }
  function stop() {
    hear = null
    clearTimeout(retry)
    retry = null
    if (saving) { clearTimeout(saving); saving = null; try { save() } catch { /* next time */ } }
    if (server) { const s = server; server = null; s.close(); s.closeAllConnections?.() }
    set({ state: has() ? 'off' : 'no-tokens', why: null, nextTry: null, listening: null })
  }
  const endpointUrl = () => (kept.publicUrl ? `${kept.publicUrl}/api/messages` : null)
  const state = () => ({
    // (team: your organization, as Slack's workspace is, for its record.)
    ...st, bot: kept.bot || null, app: kept.appId ? { id: kept.appId, single: kept.single !== false } : null, tenant: kept.tenantId || null, team: kept.tenantId ? { id: kept.tenantId, name: null } : null,
    tokens: kept.password ? { secret: masked(kept.password) } : null, port: server?.address()?.port ?? kept.port ?? defaultPort, endpoint: { url: endpointUrl(), ...(st.endpoint || {}) },
  })

  // New credentials: the app ID and tenant ID as Azure shows them, and a client secret's Value;
  // checked with Microsoft Entra ID (a token for the bot) before they're kept, so a wrong one is
  // said at once. single: false for an older multi-tenant bot.
  async function setCredentials({ appId, password, tenantId, single = true } = {}) {
    const c = { appId: String(appId || '').trim(), password: String(password || '').trim(), tenantId: String(tenantId || '').trim(), single: single !== false }
    if (!GUID.test(c.appId)) throw new Error('The app ID is a GUID (like 1a2b3c4d-…): it\'s the Microsoft App ID on the Azure Bot\'s Configuration page')
    if (!TENANT.test(c.tenantId)) throw new Error('The tenant ID is a GUID too: it\'s the Directory (tenant) ID on the app registration\'s Overview')
    if (!c.password && kept.password && kept.appId === c.appId) c.password = kept.password // (the one kept, unchanged)
    if (!c.password) throw new Error('Paste the client secret\'s Value: Certificates & secrets › New client secret')
    tok = await signIn(c).catch((e) => { throw new Error(e.message) })
    const other = !!kept.appId && kept.appId !== c.appId
    kept = { ...(other ? {} : kept), ...c, teamsAppId: (!other && kept.teamsAppId) || crypto.randomUUID() }
    if (other) delete kept.bot
    save()
    memo = { at: 0, list: null }
    members.clear()
    const was = hear
    stop()
    if (was) start(was)
    return state()
  }
  // Where the tunnel reaches it from (its https address), and the port it listens on.
  async function setEndpoint({ publicUrl, port: p } = {}) {
    if (publicUrl !== undefined) {
      const u = String(publicUrl || '').trim().replace(/\/api\/messages\/?$/, '').replace(/\/+$/, '')
      if (u) {
        let x
        try { x = new URL(u) } catch { throw new Error('That isn\'t an address: paste your tunnel\'s, starting https://') }
        if (x.protocol !== 'https:' && !(STANDIN() && x.hostname === '127.0.0.1')) throw new Error('Teams reaches a bot only over https: paste your tunnel\'s https address')
        kept.publicUrl = u
      } else delete kept.publicUrl
      st.endpoint = null
    }
    if (p !== undefined) {
      const n = Number(p)
      if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error('Pick a port from 1024 to 65535')
      kept.port = n
    }
    save()
    if (p !== undefined && server) { const was = hear; stop(); if (was) start(was) }
    return state()
  }
  // Whether the tunnel reaches this computer: a check at its address, answered by this listener.
  async function checkEndpoint() {
    if (!kept.publicUrl) throw new Error('Set your tunnel\'s address first')
    if (!server) throw new Error('The bot isn\'t listening: connect it first')
    const n = crypto.randomBytes(16).toString('hex')
    checks.add(n)
    let r = null
    let why = null
    try { r = await fetch(`${kept.publicUrl}/api/messages/check?n=${n}`, { signal: AbortSignal.timeout(15000), redirect: 'manual' }) } catch (e) { why = `Couldn't reach ${kept.publicUrl}: ${e.cause?.code || e.message}` } finally { checks.delete(n) }
    if (r && r.status !== 204) why = r.status === 404 ? `${kept.publicUrl} answered, but not from this bot: point your tunnel at port ${server.address().port}` : `${kept.publicUrl} answered ${r.status}: is the tunnel running?`
    st.endpoint = { ok: !why, why, at: now() }
    say({ what: 'endpoint', ok: !why, why })
    return state()
  }
  // The Teams app to upload, with the version raised whenever its manifest changed.
  function teamsApp({ name, description = '', you = '' } = {}) {
    if (!kept.appId) throw new Error('Connect the Azure Bot first: the app needs its app ID')
    kept.teamsAppId ||= crypto.randomUUID()
    const o = { name: String(name || '').slice(0, 100), description, you, appId: kept.appId, teamsAppId: kept.teamsAppId }
    const hash = crypto.createHash('sha256').update(JSON.stringify({ ...o, v: 1 })).digest('hex').slice(0, 16)
    const was = kept.package || { version: '1.0.0', hash: null }
    let version = was.version || '1.0.0'
    if (was.hash && was.hash !== hash) { const [a, b, c] = version.split('.').map(Number); version = `${a}.${b}.${(c || 0) + 1}` }
    if (was.hash !== hash) { kept.package = { version, hash }; save() }
    return { ...appPackage({ ...o, version }), version, file: `${String(name || 'bot').replace(/[^\w.-]+/g, '-').slice(0, SHORT_MAX)}-teams.zip` }
  }
  function forget() {
    stop()
    kept = {}
    try { fs.rmSync(FILE, { force: true }) } catch { /* gone */ }
    tok = { value: null, until: 0 }
    ring.clear(); refs.clear(); quotes.clear(); members.clear(); users.clear()
    memo = { at: 0, list: null }
    set({ state: 'no-tokens', why: null, endpoint: null })
  }

  return {
    id, label: 'Microsoft Teams', platform: 'teams',
    caps: { react: false, edit: true, typing: true, threads: true, history: false },
    start, stop, state, post, edit, react, typing, whisper, context, people, channels, person, setCredentials, setEndpoint, checkEndpoint, teamsApp, forget,
    // (For tests: how often the signing keys were read.)
    keyFetches: () => keys.fetches(),
  }
}
