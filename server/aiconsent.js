// Your OK on a phone before what you give Bridge AI there goes on to an AI provider. On the
// computer itself you installed and signed in to your agents and keys, so nothing is asked there;
// from a phone (the iPhone and Android apps, the relay's page in a browser, Tailscale, or another
// of your computers acting for one of its phones), a request that would send what you typed, said
// or attached to a provider that isn't on this computer is refused (409, code 'consent') until you
// allow that provider. The phone shows a sheet saying what goes, to whom and how, with Allow and Not
// Now (src/components/AiConsent.jsx), and Allow sends it again. Each provider is asked once, by the
// company that gets it (shared/aiproviders.js), and kept in your settings (config.json aiConsent:
// when, from which device, through what), listed in Settings › Devices & Access › Phone, where it
// can be taken back; the phone then asks again. A model on this computer (Ollama, LM Studio, the
// local model built in, the Mac's own speech) is never asked about: nothing leaves.
//
// Two ways a request is held to it:
//   need(provider, feature) where the content goes (chatmodels.js reply, consult.js, speech.js, an
//   agent's message), while a phone's request that led there is still being answered: the request
//   is refused, whatever shape its route sends errors in (phoneScope turns it into the 409).
//   The same up front (needFor) in a route whose work goes on after it has answered (a meeting's
//   notes, an agent started with a prompt), so nothing starts that would be stopped later.
import { AsyncLocalStorage } from 'node:async_hooks'
import { PROVIDERS, ofAgent, ofModel, ofSpeech, ofCloud, nameOf } from '../shared/aiproviders.js'

export { ofAgent, ofModel, ofSpeech, ofCloud }

// Where it's kept: config.json's aiConsent ({ [provider id]: { name, at, device, via } }).
let read = () => ({})
let write = () => {}
export function use(o) { read = o.read; write = o.write }
const kept = () => { const c = read(); return c && typeof c === 'object' && !Array.isArray(c) ? c : {} }
export const allowed = (id) => typeof kept()[id]?.at === 'string'

// What's been allowed, newest first: { id, name, at, device, via }.
export const list = () => Object.entries(kept()).filter(([, v]) => typeof v?.at === 'string')
  .map(([id, v]) => ({ id, name: PROVIDERS[id]?.name || (typeof v.name === 'string' && v.name.slice(0, 80)) || nameOf(id), at: v.at, device: typeof v.device === 'string' ? v.device : null, via: typeof v.via === 'string' ? v.via : null }))
  .sort((a, b) => b.at.localeCompare(a.at))

const ID = /^[a-z][\w-]{0,60}$/
// Allowed from a device (its name) through something (an agent, an API, a speech service).
export function allow({ id, name, via }, device) {
  if (!ID.test(String(id || ''))) throw Object.assign(new Error('Which provider?'), { status: 400 })
  const at = new Date().toISOString()
  write({ ...kept(), [id]: { name: String(PROVIDERS[id]?.name || name || id).slice(0, 80), at, device: String(device || '').slice(0, 80) || null, via: via ? String(via).slice(0, 80) : null } })
  return list()
}
export function revoke(id) {
  const next = { ...kept() }
  delete next[id]
  write(next)
  return list()
}

// A phone's request, while it's being answered.
const scope = new AsyncLocalStorage()
const refusal = ({ provider, feature }) => ({
  error: `Not sent: ${provider.name} needs your OK first. Allow it on your phone, where Bridge AI asks.`,
  code: 'consent',
  consent: { provider, feature: feature || null },
})
const refused = (asked) => Object.assign(new Error(refusal(asked).error), { status: 409, code: 'consent', data: { consent: refusal(asked).consent } })

// Express middleware: a phone's request (isPhone) runs in a scope that need() reads. A refusal
// anywhere in it is sent as one, 409 with what the sheet needs, whatever the route sends its
// errors as. Once answered the scope closes: what a request leaves running isn't stopped later.
// Only what sends something (not GET or HEAD): a page looked at sends nothing of yours, and a feed
// a phone keeps open for hours mustn't hold back what this computer does by itself meanwhile.
export const phoneScope = (isPhone) => (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || !isPhone(req)) return next()
  const ctx = { open: true, asked: null }
  const close = () => { ctx.open = false }
  res.on('finish', close)
  res.on('close', close)
  const json = res.json.bind(res)
  res.json = (body) => (ctx.asked && res.statusCode >= 400 ? json.call(res.status(409), refusal(ctx.asked)) : json(body))
  scope.run(ctx, next)
}

// Whether this is a phone's request still being answered.
export const fromPhone = () => !!scope.getStore()?.open

// Throws (409, code 'consent') when a phone's request would send to this provider, not yet
// allowed. provider: from ofAgent/ofModel/ofSpeech (null: on this computer, nothing asked).
// feature: what it's for, so the sheet says what goes ('agent', 'assist', 'meeting', ...).
export function need(provider, feature = null) {
  if (!provider) return
  const ctx = scope.getStore()
  if (!ctx?.open || allowed(provider.id)) return
  const asked = { provider: { id: provider.id, name: provider.name, via: provider.via || null, ...(provider.setUp ? { setUp: true } : {}) }, feature }
  ctx.asked ||= asked
  throw refused(asked)
}
// The same for a model by its id, an agent by its kind, a speech service by its engine.
export const needModel = (id, feature) => need(ofModel(id), feature)
export const needAgent = (kind, feature, label) => need(ofAgent(kind, label), feature)
export const needSpeech = (engine, feature = 'speech') => need(ofSpeech(engine), feature)
// A refusal's code, for the places that try another model when one fails: this one isn't tried around.
export const isConsent = (e) => e?.code === 'consent'
