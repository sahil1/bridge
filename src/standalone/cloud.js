// Cloud agents answered in the page, for the UI with no computer behind it (the demo, and the
// phone apps' Cloud agents): the same API as the server's (server/cloud.js), on the same
// following (shared/cloud/follow.js). Each backend brings its own keys.
//
//   cloudApi(f, { keys, mute }) -> (method, path, query, body) -> data, or NOT_CLOUD
//     keys: { put(provider, { key, github }), remove(provider), gh() } -> what the server answers
//     mute(t, on): notifications for one agent
import { ADAPTERS } from '../../shared/cloud/index.js'
import { isCloud } from '../../shared/cloud/follow.js'

export const NOT_CLOUD = Symbol('not cloud')
const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }) }

export function cloudApi(f, { keys, mute }) {
  const routes = []
  const on = (method, pattern, fn) => routes.push([method, new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn])
  const known = (id) => (ADAPTERS[id] ? id : fail('Unknown provider', 404))

  // Settings › Cloud agents
  on('GET', '/cloud', () => f.providers())
  on('GET', '/cloud/gh', () => ({ signedIn: false }))
  on('POST', '/cloud/keys/copilot/gh', () => fail('Do this in Bridge AI on your computer', 403))
  on('PUT', '/cloud/keys/:provider', ({ p, body }) => keys.put(known(p.provider), body || {}))
  on('POST', '/cloud/keys/:provider/test', async ({ p }) => ({ ...(await f.check(known(p.provider))), provider: f.providerView(p.provider) }))
  on('DELETE', '/cloud/keys/:provider', ({ p }) => keys.remove(known(p.provider)))

  // New agent › In the cloud
  on('GET', '/cloud/:provider/repos', ({ p, query }) => f.repos(known(p.provider), { refresh: query.get('refresh') === '1' }))
  on('GET', '/cloud/:provider/branches', ({ p, query }) => f.branches(known(p.provider), query.get('repo')))
  on('GET', '/cloud/:provider/models', ({ p }) => f.models(known(p.provider)))
  on('POST', '/cloud/launch', ({ body }) => f.launch(body || {}))

  // One agent
  on('GET', '/cloud/agents/:pane', ({ p, query }) => f.open(f.need(p.pane), { fresh: query.get('refresh') === '1' }))
  on('POST', '/cloud/agents/:pane/send', ({ p, body }) => f.send(f.need(p.pane), body?.text))
  on('POST', '/cloud/agents/:pane/stop', ({ p }) => f.stop(f.need(p.pane)))
  on('POST', '/cloud/agents/:pane/approve', ({ p }) => f.approve(f.need(p.pane)))
  on('POST', '/cloud/agents/:pane/seen', ({ p }) => f.seen(f.need(p.pane)))
  on('DELETE', '/cloud/agents/:pane/held/:id', ({ p }) => f.dropHeld(f.need(p.pane), p.id))
  on('DELETE', '/cloud/agents/:pane', ({ p }) => f.remove(f.need(p.pane)))

  // The routes every agent has, for a cloud agent's pane.
  on('POST', '/agents/:pane/mute', ({ p, body }) => mute(f.need(p.pane), !!body?.muted))
  const agent = /^\/agents\/(?<pane>[^/]+)\/(?<what>.+)$/

  return async (method, path, query, body) => {
    const route = path.replace(/\/$/, '') || '/'
    for (const [m, re, fn] of routes) {
      if (m !== method) continue
      const hit = re.exec(route)
      if (!hit) continue
      const p = Object.fromEntries(Object.entries(hit.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]))
      if (re.source.startsWith('^/agents/') && !isCloud(p.pane)) continue
      return fn({ p, query, body })
    }
    const a = agent.exec(route)
    if (a && isCloud(decodeURIComponent(a.groups.pane))) return f.agentRoute(decodeURIComponent(a.groups.pane), method, a.groups.what, body)
    return NOT_CLOUD
  }
}
