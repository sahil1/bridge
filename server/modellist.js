// A list of models to answer with, in order: a first choice and then its fallbacks, as a bot's What
// Answers has them (botanswer.js) and each kind of job's model in Settings › Model Providers
// (modeljobs.js). A model is named as chatmodels.js names it ("groq:openai/gpt-oss-120b",
// "ollama:qwen3"); one that can't run now (no key for it, its server here not running, the local
// model built in not downloaded) is passed over before it's tried, and one that fails (its provider
// down or saying no, a rate limit, its usage limit) when it's tried, each with why. A list goes
// where it says: from a model on this computer to one elsewhere only when the next in it is.
import { placeEn } from '../shared/places.js'

export const isLocal = (id) => /^(ollama|lmstudio|bridge):/.test(String(id || ''))

// Its name as Model Providers shows it (models: chatmodels.js's list): "gpt-5 · OpenAI", else the
// model's own name.
export function labelOf(id, models = []) {
  const m = models.find((x) => x?.id === id)
  return m ? `${m.label}${m.provider ? ` · ${m.provider}` : ''}` : String(id || '').split(':').slice(1).join(':') || String(id || '')
}

// Why it can't run now, before it's tried, or null. models: what chatmodels.js reaches now (its
// list, or their ids); provider(route): the provider's name, to say whose key it needs. A model by
// name from a provider whose key is there (one of its models in the list, via 'key') can run: the
// list is the provider's, not all it has, and one it has retired answers with its current model.
export function whyNot(id, models = [], provider = () => null) {
  if (models.some((m) => (m?.id ?? m) === id)) return null
  const route = String(id || '').split(':')[0]
  if (!isLocal(id) && route !== 'cli' && models.some((m) => m?.via === 'key' && String(m.id).split(':')[0] === route)) return null
  const name = labelOf(id, models.filter((m) => m?.id))
  if (/^bridge:/.test(id)) return `${name} isn't downloaded on this computer`
  if (isLocal(id)) return `${name} isn't running on this computer`
  if (/^cli:/.test(id)) return `${name} isn't signed in here`
  const who = provider(String(id).split(':')[0])
  return `${name} isn't set up here: no ${who ? `${who} ` : ''}key for it in Model Providers`
}

// Why one couldn't answer when it was tried, naming it: "gpt-5 · OpenAI couldn't answer: HTTP 429".
export const failed = (id, e, models = []) => ({ id, why: `${labelOf(id, models)} couldn't answer: ${String(e?.message || e).slice(0, 240)}` })

// A model's call that failed, in words that say what happened and what to do, the same for every
// job that asks one (server/index.js replyFor): its provider not reached (the connection, or on this
// computer its app not running), too slow to answer, or the key turned down. Anything else (a
// rate limit, a model it doesn't know, a prompt too long) as it was said. provider(route): its name.
const SAID = /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ENETDOWN|socket hang up|other side closed|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|getaddrinfo/i
const TIMED = /TimeoutError|UND_ERR_(HEADERS|BODY)_TIMEOUT|ETIMEDOUT|aborted due to timeout/i
export function explain(id, e, provider = (r) => r) {
  if (!e || e.code === 'too_long' || e.code === 'stopped' || e.code === 'consent' || e.name === 'AbortError' || /^(cli|bridge):/.test(String(id || ''))) return e
  const route = String(id || '').split(':')[0]
  const who = provider(route) || route
  const seen = `${e.name || ''} ${e.message || ''} ${e.code || ''} ${e.cause?.name || ''} ${e.cause?.code || ''} ${e.cause?.message || ''}`
  const why = (message, code) => Object.assign(new Error(message), { code, ...(e.status ? { status: e.status } : {}), cause: e })
  if (e.status === 401 || e.status === 403) {
    // Its own words, from its answer, or as chatmodels.js put them in brackets ("… (invalid x-api-key). Check it…").
    const theirs = [e.body?.error?.message, e.body?.message, typeof e.body?.error === 'string' ? e.body.error : '', /\(([^()]{1,200})\)\. Check it/.exec(String(e.message || ''))?.[1]].find((w) => w && !/^HTTP \d+$/.test(w)) || ''
    return why(`${who} refused the key${theirs ? ` ("${String(theirs).slice(0, 160)}")` : ''}. Check it, or paste a new one, in ${placeEn('providers')}.`, 'key_refused')
  }
  if (TIMED.test(seen) && !/UND_ERR_CONNECT_TIMEOUT/.test(seen)) return why(`${who} took too long to answer, so Bridge AI stopped waiting. Try again, or pick a faster model in ${placeEn('models')}.`, 'timeout')
  if (SAID.test(seen)) {
    return why(isLocal(id)
      ? `Couldn't reach ${who} on this computer: start it, or pick another model in ${placeEn('models')}.`
      : `Couldn't reach ${who}. Check this computer's connection, or pick another model in ${placeEn('models')}.`, 'unreachable')
  }
  return e
}

// The rest of a list after one in it, or null when it isn't in the list (or there's no list).
export const after = (list, id) => { const i = Array.isArray(list) ? list.indexOf(id) : -1; return i < 0 ? null : list.slice(i + 1) }

// Each in turn until one answers: call(id) for each that can run now (whyNot, from ready), the next
// at once when it can't or fails, unless stop(e) (stopped, or a prompt too long for it, which goes
// again in pieces instead). { ...its answer, model, passed: [{ id, why }] }; none, the first failure
// (or why the first couldn't run), with passed.
export async function inTurn(ids, call, { ready = [], stop = () => false, provider } = {}) {
  const passed = []
  let first = null
  for (const id of ids) {
    const why = whyNot(id, ready, provider)
    if (why) { passed.push({ id, why }); continue }
    try { return { ...(await call(id)), model: id, passed } } catch (e) {
      // (A phone's request that needs your OK for this model's provider first: asked, not tried around.)
      if (e?.code === 'consent' || stop(e)) throw e
      first ||= e
      passed.push(failed(id, e, ready))
    }
  }
  throw Object.assign(first || new Error(passed[0]?.why || 'There\'s no model in the list'), { passed })
}
