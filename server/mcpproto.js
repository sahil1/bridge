// The Model Context Protocol, the parts Bridge AI needs as a server: JSON-RPC in, JSON-RPC out, for
// `bridge-ai mcp` (scripts/mcp.js, over stdio) and /mcp (index.js, over HTTP). Written here rather
// than with the official SDK, which needs a package of its own and a schema library beside it, for a
// few methods: server/discover, tools, resources, ping, and the subscription that says the tools
// changed.
//
// Two eras of the protocol, as the 2026-07-28 version allows a server to serve both:
//   - 2026-07-28: no handshake; every request names its version and the client's capabilities in
//     its _meta (io.modelcontextprotocol/protocolVersion, .../clientCapabilities), and is answered
//     on its own. A version this doesn't speak is refused with -32022 and the ones it does.
//   - 2025-11-25 and before: initialize first, then requests in that version for the rest of the
//     connection (Claude Desktop, Claude Code, Cursor and Codex may still speak these).
// Results in the new era carry resultType and who answered; lists carry how long they keep (ttlMs).
//
// backend: { state() -> { send }, call(name, args, client) -> CallToolResult, resources() -> list,
// read(uri, client) -> { contents } }. client: { name, version, via } as the client says it.

import { SERVER_NAME, INSTRUCTIONS, TEMPLATES, toolsFor } from './mcpdefs.js'

export const MODERN = '2026-07-28'
export const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const P = 'io.modelcontextprotocol/'
const LIST_MS = 60_000

const err = (code, message, data) => ({ code, message, ...(data !== undefined ? { data } : {}) })
const fail = (code, message, data) => Object.assign(new Error(message), { rpc: err(code, message, data) })

// The arguments as the tool's schema has them: what's required, of the kind it says, no more than
// it allows. Said in words the model can act on.
export function checkArgs(schema, args) {
  const v = args == null ? {} : args
  if (typeof v !== 'object' || Array.isArray(v)) return 'The arguments must be an object.'
  const props = schema.properties || {}
  for (const k of schema.required || []) if (v[k] === undefined || v[k] === null) return `${k} is needed.`
  for (const [k, x] of Object.entries(v)) {
    const p = props[k]
    if (!p) { if (schema.additionalProperties === false) return `There's no ${k} argument. The arguments are: ${Object.keys(props).join(', ')}.`; continue }
    const bad = checkValue(p, x, k)
    if (bad) return bad
  }
  return null
}
function checkValue(p, x, k) {
  if (x === undefined || x === null) return null
  if (p.type === 'string') {
    if (typeof x !== 'string') return `${k} must be text.`
    if (p.minLength && x.length < p.minLength) return `${k} can't be empty.`
    if (p.maxLength && x.length > p.maxLength) return `${k} is too long (${p.maxLength} characters at most).`
    if (p.enum && !p.enum.includes(x)) return `${k} is one of: ${p.enum.join(', ')}.`
  } else if (p.type === 'integer') {
    if (!Number.isInteger(x)) return `${k} must be a whole number.`
    if (p.minimum != null && x < p.minimum) return `${k} is ${p.minimum} or more.`
    if (p.maximum != null && x > p.maximum) return `${k} is ${p.maximum} or less.`
  } else if (p.type === 'boolean') {
    if (typeof x !== 'boolean') return `${k} must be true or false.`
  } else if (p.type === 'array') {
    if (!Array.isArray(x)) return `${k} must be a list.`
    if (p.maxItems && x.length > p.maxItems) return `${k} has ${p.maxItems} items at most.`
    for (const [i, it] of x.entries()) { const bad = p.items?.type === 'object' ? checkArgs(p.items, it) : checkValue(p.items || {}, it, `${k}[${i}]`); if (bad) return `${k}[${i}]: ${bad}` }
  } else if (p.type === 'object') {
    return checkArgs(p, x)
  }
  return null
}

// One connection (the stdio process, or one HTTP request): the version and client its initialize
// named (the older era), and its subscriptions. notify(message): sends one to the client, where it
// can (stdio).
export function connection({ via = 'stdio', notify = null } = {}) {
  return { via, legacy: null, client: null, subs: new Map(), notify }
}

export function makeMcp({ version, backend }) {
  const info = { name: SERVER_NAME, title: 'Bridge AI', version }
  // The tools change (sending to agents turned on or off): said where there's a way to say it (stdio).
  const capabilities = (conn) => ({ tools: { listChanged: !!conn.notify }, resources: {} })

  // A request's era and client: its own _meta (new), else what its connection's initialize said.
  function eraOf(msg, conn) {
    const meta = msg.params?._meta || {}
    const asked = meta[`${P}protocolVersion`]
    if (asked !== undefined) {
      if (asked !== MODERN) throw fail(-32022, 'Unsupported protocol version', { supported: [MODERN, ...LEGACY], requested: String(asked) })
      if (!meta[`${P}clientCapabilities`] || typeof meta[`${P}clientCapabilities`] !== 'object') throw fail(-32602, `Every request needs ${P}clientCapabilities in its _meta`)
      const ci = meta[`${P}clientInfo`]
      return { modern: true, client: { name: String(ci?.name || 'an MCP client').slice(0, 80), version: String(ci?.version || '').slice(0, 40), via: conn.via } }
    }
    if (conn.legacy) return { modern: false, client: conn.client }
    throw fail(-32602, `Name the protocol version in _meta (${P}protocolVersion: "${MODERN}"), or send initialize first`)
  }
  const done = (result, modern, cache) => (modern
    ? { resultType: 'complete', ...result, ...(cache ? { ttlMs: cache, cacheScope: 'private' } : {}), _meta: { ...(result._meta || {}), [`${P}serverInfo`]: info } }
    : result)

  async function answer(msg, conn) {
    const m = msg.method
    if (m === 'initialize') {
      const asked = String(msg.params?.protocolVersion || '')
      conn.legacy = LEGACY.includes(asked) ? asked : LEGACY[0]
      const ci = msg.params?.clientInfo
      conn.client = { name: String(ci?.name || 'an MCP client').slice(0, 80), version: String(ci?.version || '').slice(0, 40), via: conn.via }
      return { protocolVersion: conn.legacy, capabilities: capabilities(conn), serverInfo: info, instructions: INSTRUCTIONS }
    }
    if (m === 'server/discover') {
      const { modern } = (() => { try { return eraOf(msg, conn) } catch (e) { if (e.rpc?.code === -32022) throw e; return { modern: true } } })()
      return done({ supportedVersions: [MODERN, ...LEGACY], capabilities: capabilities(conn), instructions: INSTRUCTIONS }, modern, 3_600_000)
    }
    const { modern, client } = eraOf(msg, conn)
    const p = msg.params || {}
    if (m === 'ping') return done({}, modern)
    if (m === 'tools/list') return done({ tools: toolsFor(await backend.state().catch(() => ({}))) }, modern, LIST_MS)
    if (m === 'tools/call') {
      const name = String(p.name || '')
      const tool = toolsFor(await backend.state().catch(() => ({}))).find((t) => t.name === name)
      if (!tool) throw fail(-32602, `Unknown tool: ${name.slice(0, 80)}`)
      const bad = checkArgs(tool.inputSchema, p.arguments)
      if (bad) return done({ content: [{ type: 'text', text: bad }], isError: true }, modern)
      return done(await backend.call(name, p.arguments || {}, client), modern)
    }
    if (m === 'resources/list') return done({ resources: await backend.resources(client) }, modern, LIST_MS)
    if (m === 'resources/templates/list') return done({ resourceTemplates: TEMPLATES }, modern, LIST_MS)
    if (m === 'resources/read') {
      const uri = String(p.uri || '')
      if (!uri) throw fail(-32602, 'Which resource? Give its uri.')
      const r = await backend.read(uri, client)
      if (!r) throw fail(modern ? -32602 : -32002, 'Resource not found', { uri })
      return done(r, modern, 0)
    }
    // The new era's notifications come on a stream the client opens: here, only that the tools
    // changed (sending to agents turned on or off).
    if (m === 'subscriptions/listen' && modern) {
      const want = p.notifications || {}
      const id = msg.id
      const agreed = want.toolsListChanged ? { toolsListChanged: true } : {}
      if (agreed.toolsListChanged && conn.notify) conn.subs.set(id, true)
      conn.notify?.({ jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged', params: { _meta: { [`${P}subscriptionId`]: id }, notifications: agreed } })
      if (!agreed.toolsListChanged || !conn.notify) return done({ _meta: { [`${P}subscriptionId`]: id } }, true)
      return undefined // open until the client cancels it, or the connection ends
    }
    if (m === 'logging/setLevel' && !modern) return {}
    throw fail(-32601, `Bridge AI doesn't offer ${String(m).slice(0, 80)}`)
  }

  // One message in: its answer (a JSON-RPC response), or null for a notification, or undefined for a
  // request answered later (a subscription).
  async function handle(msg, conn) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      if (msg && (msg.result !== undefined || msg.error !== undefined)) return null // a response to us: we ask nothing
      return { jsonrpc: '2.0', id: msg?.id ?? null, error: err(-32600, 'Invalid request') }
    }
    if (msg.id === undefined || msg.id === null) {
      if (msg.method === 'notifications/cancelled') {
        const id = msg.params?.requestId
        if (conn.subs.delete(id)) conn.notify?.({ jsonrpc: '2.0', id, result: { resultType: 'complete', _meta: { [`${P}subscriptionId`]: id } } })
      }
      return null
    }
    try {
      const result = await answer(msg, conn)
      if (result === undefined) return undefined
      return { jsonrpc: '2.0', id: msg.id, result }
    } catch (e) {
      return { jsonrpc: '2.0', id: msg.id, error: e.rpc || err(-32603, String(e.message || e).slice(0, 300)) }
    }
  }

  // The tools changed: told to every client that asked (the new era's subscriptions, or the older
  // era's notification on its connection).
  function toolsChanged(conn) {
    if (!conn.notify) return
    if (conn.legacy) conn.notify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    for (const id of conn.subs.keys()) conn.notify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: { _meta: { [`${P}subscriptionId`]: id } } })
  }
  return { handle, toolsChanged, info }
}
