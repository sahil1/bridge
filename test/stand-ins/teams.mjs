// Microsoft Teams for tests (Bots: teams-client): what a Teams bot talks to, on this computer, so a
// test sends it messages and gets answers with nothing leaving the machine. The server reaches it as
// BRIDGE_TEAMS_URL.
//   node teams.mjs <port> <log>
// Three of Microsoft's services in one:
//   - the Bot Framework's OpenID metadata and signing keys (/v1/.well-known/openidconfiguration,
//     /v1/.well-known/keys): its keys made here, k1 endorsed for Teams (msteams) and k3 only for
//     another channel; tokens signed with them as the Bot Connector signs them (RS256, issuer
//     https://api.botframework.com, audience the bot's app ID, a serviceurl claim);
//   - Microsoft Entra ID's token endpoint (POST /<tenant>/oauth2/v2.0/token, client credentials):
//     the app 00000000-0000-4000-8000-00000000a001 with the client secret teams-secret-1, in the
//     tenant 11111111-1111-4111-8111-111111111111 (Acme); a wrong secret is AADSTS7000215, an
//     unknown tenant AADSTS90002;
//   - the Bot Connector at /amer/ (the serviceUrl): replying to an activity, sending one (typing),
//     updating one, a conversation's member (GET …/members/:user, with userRole and tenantId) and
//     its members a page at a time (…/pagedmembers), each with a token it issued (else 401).
// People: Dana, Sam, Eve and Tester (the owner) in Acme; Gus, a guest in Acme (userRole guest);
// Xena, in another organization (tenant 22222222-…). A team, Acme Team, with a channel, Launch.
// Each call goes in the log, as { method, route, body } (never a secret or a token).
// And, for tests:
//   POST /_test/endpoint { url }       where the bot listens (its messaging endpoint)
//   POST /_test/say { user, text, kind?, thread?, mention?, token?, tenant?, quote?, files?, to? }
//        someone writes: in a chat with the bot (kind personal, the default), in the Launch channel
//        (channel: a new post, or a reply in thread: the post's id), or in a group chat (groupChat);
//        mention: the bot's name in it as a mention. It's sent to the bot as an activity, signed;
//        token makes it wrong in one way: none, garbage, bad-signature, unknown-kid, not-endorsed,
//        wrong-audience, wrong-issuer, expired, not-yet, serviceurl-mismatch, alg-none, hs256,
//        untrusted-service. { status, id, conversation }
//   POST /_test/raw { body, token? }    the bytes given, with a good token (or token: none)
//   POST /_test/edit { conversation, id, text }, /_test/delete { conversation, id }
//   POST /_test/install { kind? }        the bot added to the team (or a chat)
//   POST /_test/rotate                  Microsoft starts signing with a new key, k2; k1 is dropped
//   POST /_test/limit { route, n, wait }, /_test/fail { route, status, n, body }
//                                       (route as "POST /v3/conversations/:conv/activities/:id")
//   GET  /_test/state  { posted, updated, typing, tokens, tokenRequests, keyFetches,
//                        metadataFetches, sent: [{ status }] }
import http from 'node:http'
import fs from 'node:fs'
import crypto from 'node:crypto'

const [port, log] = process.argv.slice(2)
const BASE = `http://127.0.0.1:${port}`
const SERVICE = `${BASE}/amer/`
const APP = '00000000-0000-4000-8000-00000000a001'
const SECRET = 'teams-secret-1'
const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ISSUER = 'https://api.botframework.com'
const BOT = { id: `28:${APP}`, name: 'Atlas' }
const TEAM = { id: '19:acme-team@thread.tacv2', name: 'Acme Team' }
const CHANNEL = { id: '19:launch@thread.tacv2', name: 'Launch' }
const GROUP = '19:group-chat-1@thread.v2'
const PEOPLE = {
  dana: { id: '29:dana', aadObjectId: 'aad-dana-0001', name: 'Dana Reyes', givenName: 'Dana', email: 'dana@example.com', userPrincipalName: 'dana@example.com', tenantId: TENANT, userRole: 'user' },
  sam: { id: '29:sam', aadObjectId: 'aad-sam-0002', name: 'Sam Okafor', email: 'sam@example.com', userPrincipalName: 'sam@example.com', tenantId: TENANT, userRole: 'user' },
  eve: { id: '29:eve', aadObjectId: 'aad-eve-0003', name: 'Eve', email: 'eve@example.com', userPrincipalName: 'eve@example.com', tenantId: TENANT, userRole: 'user' },
  tester: { id: '29:tester', aadObjectId: 'aad-tester-0004', name: 'Tester', email: 'tester@example.com', userPrincipalName: 'tester@example.com', tenantId: TENANT, userRole: 'user' },
  gus: { id: '29:gus', aadObjectId: 'aad-gus-0005', name: 'Gus Guest', email: 'gus@example.org', userPrincipalName: 'gus_example.org#EXT#@example.com', tenantId: TENANT, userRole: 'guest' },
  xena: { id: '29:xena', aadObjectId: 'aad-xena-0009', name: 'Xena Partner', email: 'xena@example.org', userPrincipalName: 'xena@example.org', tenantId: OTHER, userRole: 'user' },
}
const ROSTER = ['dana', 'sam', 'eve', 'tester', 'gus']
const note = (o) => { if (log) fs.appendFileSync(log, `${JSON.stringify(o)}\n`) }
const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url')

// ---------- Keys and tokens ----------
const made = (kid, endorsements) => { const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); return { kid, endorsements, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, kty: 'RSA', use: 'sig', endorsements } } }
let keys = [made('k1', ['msteams', 'webchat']), made('k3', ['skype'])]
const rogue = made('k9', ['msteams'])
const sign = (key, claims, head = {}) => { const h = b64({ alg: 'RS256', typ: 'JWT', kid: key.kid, x5t: key.kid, ...head }); const c = b64(claims); return `${h}.${c}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${c}`), key.privateKey).toString('base64url')}` }
// A token for an activity, as the Bot Connector makes one, or wrong in the way asked.
function tokenFor(activity, how = null) {
  const now = Math.floor(Date.now() / 1000)
  const claims = { serviceurl: activity.serviceUrl, nbf: now - 10, exp: now + 3600, iss: ISSUER, aud: APP }
  const k1 = keys.find((k) => k.endorsements.includes('msteams'))
  switch (how) {
    case 'none': return null
    case 'garbage': return 'Bearer not.a-token'
    case 'bad-signature': return `Bearer ${sign({ ...rogue, kid: k1.kid }, claims)}`
    case 'unknown-kid': return `Bearer ${sign(rogue, claims)}`
    case 'not-endorsed': return `Bearer ${sign(keys.find((k) => k.kid === 'k3'), claims)}`
    case 'wrong-audience': return `Bearer ${sign(k1, { ...claims, aud: '99999999-0000-4000-8000-000000000000' })}`
    case 'wrong-issuer': return `Bearer ${sign(k1, { ...claims, iss: 'https://sts.windows.net/someone/' })}`
    case 'expired': return `Bearer ${sign(k1, { ...claims, nbf: now - 7200, exp: now - 3600 })}`
    case 'not-yet': return `Bearer ${sign(k1, { ...claims, nbf: now + 3600, exp: now + 7200 })}`
    case 'serviceurl-mismatch': return `Bearer ${sign(k1, { ...claims, serviceurl: 'https://smba.trafficmanager.net/emea/' })}`
    case 'alg-none': return `Bearer ${b64({ alg: 'none', typ: 'JWT', kid: k1.kid })}.${b64(claims)}.`
    case 'hs256': {
      // The classic mix-up: HMAC with the public key as its secret.
      const h = b64({ alg: 'HS256', typ: 'JWT', kid: k1.kid })
      const c = b64(claims)
      return `Bearer ${h}.${c}.${crypto.createHmac('sha256', JSON.stringify(k1.jwk)).update(`${h}.${c}`).digest('base64url')}`
    }
    default: return `Bearer ${sign(k1, claims)}`
  }
}

const issued = new Set()
const posted = []
const updated = []
const typing = []
const sent = []
const limits = {}
const fails = {}
const count = { tokens: 0, tokenRequests: 0, keyFetches: 0, metadataFetches: 0 }
let endpoint = null
let seq = 1700000000000
const nextId = () => String(++seq)

// An activity sent to the bot's endpoint, signed (or not), and what the bot answered.
async function deliver(activity, how = null) {
  const auth = tokenFor(activity, how)
  let r
  try {
    r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: typeof activity === 'string' ? activity : JSON.stringify(activity) })
  } catch (e) { sent.push({ status: 0, error: e.message }); return { status: 0, error: e.message } }
  sent.push({ status: r.status, type: activity.type })
  return { status: r.status }
}
const who = (u) => PEOPLE[u] || { id: `29:${u}`, name: u }
function activityOf(j) {
  const u = who(j.user)
  const kind = j.kind || 'personal'
  const id = nextId()
  const root = kind === 'channel' ? j.thread || id : null
  const conv = kind === 'personal' ? `a:personal-${u.id.slice(3)}` : kind === 'groupChat' ? GROUP : `${CHANNEL.id};messageid=${root}`
  const mention = j.mention ? `<at>${BOT.name}</at> ` : ''
  const a = {
    type: 'message', id, timestamp: new Date().toISOString(), localTimestamp: new Date().toISOString(), channelId: 'msteams',
    serviceUrl: j.serviceUrl || SERVICE,
    from: { id: u.id, name: u.name, ...(j.noAad ? {} : { aadObjectId: u.aadObjectId }) },
    conversation: { id: conv, conversationType: kind, tenantId: j.tenant || u.tenantId || TENANT, ...(kind === 'channel' ? { isGroup: true } : kind === 'groupChat' ? { isGroup: true, name: 'Launch crew' } : {}) },
    recipient: { ...BOT },
    textFormat: 'plain', text: `${mention}${j.text ?? ''}`,
    entities: [...(j.mention ? [{ type: 'mention', text: `<at>${BOT.name}</at>`, mentioned: { ...BOT } }] : []), { type: 'clientInfo', locale: 'en-US', country: 'US', platform: 'Mac' }],
    channelData: { tenant: { id: j.tenant || u.tenantId || TENANT }, ...(kind === 'channel' ? { team: { ...TEAM }, channel: { ...CHANNEL } } : {}) },
    attachments: [
      ...(j.quote ? [{ contentType: 'text/html', content: `<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="1"><strong itemprop="mri" itemid="8:orgid:x">${j.quote.name}</strong><span itemprop="time" itemid="1"></span><p itemprop="preview">${j.quote.text}</p></blockquote><p>${j.text}</p>` }] : []),
      ...(j.files || []).map((f) => ({ contentType: 'application/vnd.microsoft.teams.file.download.info', name: f, content: { downloadUrl: `${BASE}/files/${encodeURIComponent(f)}`, uniqueId: `file-${f}`, fileType: f.split('.').pop() } })),
    ],
    locale: 'en-US',
  }
  return a
}

const answer = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(body == null ? undefined : JSON.stringify(body)) }
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => r(b)) })
const routeOf = (method, p) => `${method} ${p.replace(/^\/amer/, '').replace(/\/v3\/conversations\/[^/]+/, '/v3/conversations/:conv').replace(/\/activities\/[^/]+$/, '/activities/:id').replace(/\/members\/[^/]+$/, '/members/:user')}`

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const raw = await body(req)
  // ---------- test controls ----------
  if (url.pathname.startsWith('/_test/')) {
    const what = url.pathname.slice(7)
    const j = raw ? JSON.parse(raw) : {}
    if (what === 'endpoint') { endpoint = j.url; return answer(res, 200, { ok: true }) }
    if (what === 'say') {
      const a = activityOf(j)
      if (j.token === 'untrusted-service') a.serviceUrl = 'https://bots.evil.test/amer/'
      const r = await deliver(a, j.token === 'untrusted-service' ? null : j.token)
      return answer(res, 200, { ...r, id: a.id, conversation: a.conversation.id, activity: a })
    }
    if (what === 'raw') {
      const r = await (async () => {
        const auth = j.token === 'none' ? null : tokenFor({ serviceUrl: SERVICE })
        try { const x = await fetch(endpoint, { method: j.method || 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: j.method === 'GET' ? undefined : String(j.body ?? '') }); return { status: x.status } } catch (e) { return { status: 0, error: e.message } }
      })()
      return answer(res, 200, r)
    }
    if (what === 'edit' || what === 'delete') {
      const a = activityOf({ user: j.user || 'dana', kind: j.kind || 'channel', thread: j.thread, text: j.text })
      a.type = what === 'edit' ? 'messageUpdate' : 'messageDelete'
      a.id = String(j.id)
      a.channelData.eventType = what === 'edit' ? 'editMessage' : 'softDeleteMessage'
      if (what === 'delete') a.text = ''
      return answer(res, 200, await deliver(a))
    }
    if (what === 'install') {
      const a = activityOf({ user: 'tester', kind: j.kind || 'channel', text: '' })
      Object.assign(a, { type: 'conversationUpdate', membersAdded: [{ ...BOT }], text: undefined, entities: [] })
      a.conversation.id = j.kind === 'groupChat' ? GROUP : CHANNEL.id
      return answer(res, 200, await deliver(a))
    }
    if (what === 'rotate') { keys = [made('k2', ['msteams']), ...keys.filter((k) => k.kid !== 'k1')]; return answer(res, 200, { ok: true }) }
    if (what === 'limit') { limits[j.route] = { n: j.n ?? 1, wait: j.wait ?? 1 }; return answer(res, 200, { ok: true }) }
    if (what === 'fail') { fails[j.route] = { n: j.n ?? 1, after: j.after || 0, status: j.status || 500, body: j.body || { error: { code: 'ServiceError', message: 'test' } } }; return answer(res, 200, { ok: true }) }
    if (what === 'state') return answer(res, 200, { posted, updated, typing, sent, ...count, issued: issued.size })
    return answer(res, 404, { error: 'no such control' })
  }
  // ---------- the Bot Framework's keys ----------
  if (req.method === 'GET' && url.pathname === '/v1/.well-known/openidconfiguration') {
    count.metadataFetches++
    return answer(res, 200, { issuer: ISSUER, authorization_endpoint: 'https://invalid.botframework.com', jwks_uri: `${BASE}/v1/.well-known/keys`, id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['private_key_jwt'] })
  }
  if (req.method === 'GET' && url.pathname === '/v1/.well-known/keys') { count.keyFetches++; return answer(res, 200, { keys: keys.map((k) => k.jwk) }) }
  // ---------- Microsoft Entra ID ----------
  const t = /^\/([^/]+)\/oauth2\/v2\.0\/token$/.exec(url.pathname)
  if (t && req.method === 'POST') {
    count.tokenRequests++
    const f = Object.fromEntries(new URLSearchParams(raw))
    note({ method: 'POST', route: 'token', tenant: t[1], body: { grant_type: f.grant_type, client_id: f.client_id, scope: f.scope } })
    if (decodeURIComponent(t[1]) !== TENANT && decodeURIComponent(t[1]) !== 'botframework.com') return answer(res, 400, { error: 'invalid_request', error_description: `AADSTS90002: Tenant '${t[1]}' not found.` })
    if (f.grant_type !== 'client_credentials' || f.scope !== 'https://api.botframework.com/.default') return answer(res, 400, { error: 'invalid_request', error_description: 'AADSTS900144: The request body must contain the following parameter: scope.' })
    if (f.client_id !== APP) return answer(res, 400, { error: 'unauthorized_client', error_description: `AADSTS700016: Application with identifier '${f.client_id}' was not found in the directory.` })
    if (f.client_secret !== SECRET) return answer(res, 401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID.' })
    const tok = `tok-${crypto.randomBytes(12).toString('hex')}`
    issued.add(tok)
    count.tokens++
    return answer(res, 200, { token_type: 'Bearer', expires_in: 3599, ext_expires_in: 3599, access_token: tok })
  }
  // ---------- the Bot Connector ----------
  if (url.pathname.startsWith('/amer/v3/')) {
    const route = routeOf(req.method, url.pathname)
    let j = {}
    try { j = raw ? JSON.parse(raw) : {} } catch { return answer(res, 400, { error: { code: 'BadArgument', message: 'bad JSON' } }) }
    note({ method: req.method, route, path: url.pathname, ...(raw ? { body: j } : {}) })
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/, '')
    if (!issued.has(tok)) return answer(res, 401, { message: 'Authorization has been denied for this request.' })
    if (limits[route]?.n > 0) { const l = limits[route]; l.n--; return answer(res, 429, { error: { code: 'TooManyRequests', message: 'Too many requests' } }, { 'retry-after': String(l.wait) }) }
    if (fails[route]?.after > 0) fails[route].after--
    else if (fails[route]?.n > 0) { const f = fails[route]; f.n--; return answer(res, f.status, f.body) }
    // A new conversation: a post at the top of a channel (with its first message), or a chat with
    // one person.
    if (route === 'POST /v3/conversations') {
      if (j.isGroup && j.channelData?.channel?.id) {
        const id = nextId()
        posted.push({ conversation: `${j.channelData.channel.id};messageid=${id}`, replyTo: null, id, text: j.activity?.text, textFormat: j.activity?.textFormat, type: 'message', newPost: true, channel: j.channelData.channel.id })
        return answer(res, 201, { id: `${j.channelData.channel.id};messageid=${id}`, activityId: id })
      }
      const m = j.members?.[0]?.id
      if (!m || !Object.values(PEOPLE).some((p) => p.id === m)) return answer(res, 400, { error: { code: 'BadArgument', message: 'no such member' } })
      return answer(res, 201, { id: `a:personal-${m.slice(3)}` })
    }
    const conv = decodeURIComponent(url.pathname.split('/')[4] || '')
    const rest = url.pathname.split('/').slice(5)
    if (route === 'POST /v3/conversations/:conv/activities/:id' || route === 'POST /v3/conversations/:conv/activities') {
      if (j.type === 'typing') { typing.push({ conversation: conv }); return answer(res, 200, {}) }
      const id = nextId()
      posted.push({ conversation: conv, replyTo: rest[1] ? decodeURIComponent(rest[1]) : null, id, text: j.text, textFormat: j.textFormat, type: j.type })
      return answer(res, 200, { id })
    }
    if (route === 'PUT /v3/conversations/:conv/activities/:id') { updated.push({ conversation: conv, id: decodeURIComponent(rest[1]), text: j.text }); return answer(res, 200, { id: decodeURIComponent(rest[1]) }) }
    if (route === 'GET /v3/conversations/:conv/members/:user') {
      const u = decodeURIComponent(rest[1])
      const p = Object.values(PEOPLE).find((x) => x.id === u || x.aadObjectId === u)
      return p ? answer(res, 200, p) : answer(res, 404, { error: { code: 'MemberNotFoundInConversation', message: 'The member is not in the conversation' } })
    }
    if (route === 'GET /v3/conversations/:conv/pagedmembers') {
      const size = Number(url.searchParams.get('pageSize') || 100)
      const from = Number(url.searchParams.get('continuationToken') || 0)
      const all = [...ROSTER.map((k) => PEOPLE[k]), { id: `28:${APP}`, name: BOT.name }]
      const page = all.slice(from, from + Math.min(size, 3))
      return answer(res, 200, { members: page, ...(from + page.length < all.length ? { continuationToken: String(from + page.length) } : {}) })
    }
    return answer(res, 404, { error: { code: 'NotFound', message: 'no such route' } })
  }
  return answer(res, 404, { error: 'not here' })
})
server.listen(Number(port), '127.0.0.1', () => console.log(`stand-in Teams on ${port}`))
