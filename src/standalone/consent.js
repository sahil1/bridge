// Your OK before what you send goes to an AI provider, in the UIs that answer in the page (the demo,
// and the phone apps' Cloud Agents), the way your computer asks it of a phone (server/aiconsent.js):
// a request that would send to a provider not allowed yet is refused (409, code 'consent', with
// the provider and what it's for), the sheet asks (src/aiconsent.js, components/AiConsent.jsx), and
// Allow comes back as POST /ai-consent before the request goes again. /ai-consent lists them for
// Settings and takes one back (DELETE).
//
//   pageConsent({ kept, device }) -> { check(provider, feature), route(method, path, body) }
//     kept: { get(id) -> { at, via, name } | null, set(id, entry), del(id), all() -> [[id, entry]] }
//     device: what the device that allowed it is called. route() answers NOT_CONSENT for anything else.
export const NOT_CONSENT = Symbol('not consent')

export function pageConsent({ kept, device }) {
  const list = () => kept.all().filter(([, v]) => v?.at).map(([id, v]) => ({ id, name: v.name || id, at: v.at, device: v.device || null, via: v.via || null })).sort((a, b) => b.at.localeCompare(a.at))
  return {
    // Throws the refusal when this provider isn't allowed yet (null provider: on this phone, nothing asked).
    check(provider, feature) {
      if (!provider || kept.get(provider.id)?.at) return
      const consent = { provider: { id: provider.id, name: provider.name, via: provider.via || null, ...(provider.setUp ? { setUp: true } : {}) }, feature: feature || null }
      throw Object.assign(new Error(`Not sent: ${provider.name} needs your OK first.`), { status: 409, code: 'consent', data: { consent } })
    },
    route(method, path, body) {
      if (path === '/ai-consent' && method === 'GET') return { allowed: list(), phone: true }
      if (path === '/ai-consent' && method === 'POST') {
        const p = body?.provider
        if (!p?.id) throw Object.assign(new Error('Which provider?'), { status: 400 })
        kept.set(String(p.id), { name: String(p.name || p.id), via: p.via ? String(p.via) : null, at: new Date().toISOString(), device })
        return { allowed: list() }
      }
      const m = /^\/ai-consent\/([^/]+)$/.exec(path)
      if (m && method === 'DELETE') { kept.del(decodeURIComponent(m[1])); return { allowed: list() } }
      return NOT_CONSENT
    },
  }
}

// What a request in these UIs would send to an AI provider, or null: a message to an agent (the
// demo's, and cloud agents'), an agent started with something to do, the Chief of Staff, AI Assist.
// agentOf(pane) -> { kind, chief, question } | null; assist: the model AI Assist answers with there.
// ofAgent, ofModel, ofCloud: shared/aiproviders.js's.
export function pageGate({ agentOf, assist, ofAgent, ofModel, ofCloud }) {
  const submits = (steps) => (Array.isArray(steps) ? steps : []).some((x) => (Array.isArray(x?.keys) && x.keys.some((k) => /^enter$/i.test(String(k)))) || /[\r\n]/.test(String(x?.text ?? '')))
  const freeText = (steps) => (Array.isArray(steps) ? steps : []).some((x) => String(x?.text ?? '').replace(/[\r\n]/g, '').trim().length > 1)
  const kindGoes = (kind, model, feature = 'agent') => (kind === 'chat' ? { provider: ofModel(model || assist), feature: 'chat' } : { provider: ofAgent(kind || 'claude'), feature })
  const paneGoes = (pane, feature = 'agent') => {
    const cloud = /^cloud:([a-z]+):/.exec(pane)
    if (cloud) return { provider: ofCloud(cloud[1]), feature: 'cloud' }
    const a = agentOf(pane)
    return a ? kindGoes(a.kind, a.model, a.chief ? 'chief' : feature) : null
  }
  const chief = () => ({ provider: ofAgent('claude'), feature: 'chief' })
  const ASSIST = [
    [/^\/meetings\/ask$|^\/meetings\/[^/]+\/(ask|summary|speakers|cleanup|deck)$|^\/calendar\/prep$|^\/prep\/suggest$/, 'meetings'],
    [/^\/mail\/[^/]+\/draft$|^\/mail\/voice\/learn$/, 'mail'],
    [/^\/insights\/run$/, 'insights'],
    [/^\/agents\/[^/]+\/pr\/draft$/, 'assist'],
    [/^\/files\/insights\/[^/]+\/ask$/, 'files'],
    [/^\/bots\/(assist|[^/]+\/assist)$/, 'bot'],
  ]
  return (method, path, body) => {
    if (method !== 'POST' && method !== 'PATCH') return null
    let m
    if ((m = /^\/agents\/([^/]+)\/(prompt|queue|steer|rewind)$/.exec(path))) return paneGoes(decodeURIComponent(m[1]))
    if ((m = /^\/agents\/([^/]+)\/queue\/[^/]+$/.exec(path)) && method === 'PATCH') return paneGoes(decodeURIComponent(m[1]))
    if ((m = /^\/panes\/([^/]+)\/input$/.exec(path))) {
      const a = agentOf(decodeURIComponent(m[1]))
      return a && !body?.setup && submits(body?.steps) && !(a.question && !freeText(body?.steps)) ? kindGoes(a.kind, a.model, a.chief ? 'chief' : 'agent') : null
    }
    if (method !== 'POST') return null
    // Typed into an agent's terminal and sent (Enter), an answer to its question, its own handover,
    // a nudge to carry on, and a routine run now: each goes to the agent's provider, as the
    // computer asks of a phone (server/index.js PHONE_GATES).
    if ((m = /^\/panes\/([^/]+)\/text$/.exec(path))) return body?.enter || /[\r\n]/.test(String(body?.text ?? '')) ? paneGoes(decodeURIComponent(m[1])) : null
    if ((m = /^\/(?:agents|panes)\/([^/]+)\/keys$/.exec(path))) {
      const a = agentOf(decodeURIComponent(m[1]))
      return a && !a.question && (body?.keys || []).some((k) => /^enter$/i.test(String(k))) ? kindGoes(a.kind, a.model, a.chief ? 'chief' : 'agent') : null
    }
    if ((m = /^\/agents\/([^/]+)\/(asks|handoff\/ask)$/.exec(path))) return paneGoes(decodeURIComponent(m[1]))
    if ((m = /^\/agents\/([^/]+)\/continue$/.exec(path))) return body?.nudge ? paneGoes(decodeURIComponent(m[1])) : null
    if (/^\/routines\/[^/]+\/run$/.test(path)) return { provider: ofAgent('claude'), feature: 'agent' }
    if (path === '/agents/launch' || path === '/chats') return String(body?.prompt || '').trim() ? kindGoes(body?.kind || 'claude', body?.model) : null
    if ((m = /^\/agents\/[^/]+\/handoff$/.exec(path))) return body?.to ? kindGoes(String(body.to), body?.model) : null
    if (path === '/chief/launch' || path === '/chief/threads' || (path === '/chief/tasks' && body?.send) || /^\/ideas\/[^/]+\/send$/.test(path)) return chief()
    if (path === '/cloud/launch') return { provider: ofCloud(body?.provider), feature: 'cloud' }
    if ((m = /^\/cloud\/agents\/([^/]+)\/send$/.exec(path))) return paneGoes(decodeURIComponent(m[1]))
    // A meeting's live suggestions, turned on or asked for now (not off, nor how often).
    if (/^\/meetings\/[^/]+\/assist$/.test(path)) return body?.on === true || (body?.on == null && body?.level == null) ? { provider: ofModel(assist), feature: 'live' } : null
    const a = ASSIST.find(([re]) => re.test(path))
    return a ? { provider: ofModel(assist), feature: a[1] } : null
  }
}
