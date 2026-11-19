// A list of models to answer with, in order: a first choice and then its fallbacks, as a bot's What
// Answers has them (botanswer.js) and each kind of job's model in Settings › Model Providers
// (modeljobs.js). A model is named as chatmodels.js names it ("groq:llama-3.3-70b-versatile",
// "ollama:qwen3"); one that can't run now (no key for it, its server here not running, the local
// model built in not downloaded) is passed over before it's tried, and one that fails (its provider
// down or saying no, a rate limit, its usage limit) when it's tried, each with why. A list goes
// where it says: from a model on this computer to one elsewhere only when the next in it is.
export const isLocal = (id) => /^(ollama|lmstudio|bridge):/.test(String(id || ''))

// Its name as Model Providers shows it (models: chatmodels.js's list): "gpt-5 · OpenAI", else the
// model's own name.
export function labelOf(id, models = []) {
  const m = models.find((x) => x?.id === id)
  return m ? `${m.label}${m.provider ? ` · ${m.provider}` : ''}` : String(id || '').split(':').slice(1).join(':') || String(id || '')
}

// Why it can't run now, before it's tried, or null. models: what chatmodels.js reaches now (its
// list, or their ids); provider(route): the provider's name, to say whose key it needs.
export function whyNot(id, models = [], provider = () => null) {
  if (models.some((m) => (m?.id ?? m) === id)) return null
  const name = labelOf(id, models.filter((m) => m?.id))
  if (/^bridge:/.test(id)) return `${name} isn't downloaded on this computer`
  if (isLocal(id)) return `${name} isn't running on this computer`
  if (/^cli:/.test(id)) return `${name} isn't signed in here`
  const who = provider(String(id).split(':')[0])
  return `${name} isn't set up here: no ${who ? `${who} ` : ''}key for it in Model Providers`
}

// Why one couldn't answer when it was tried, naming it: "gpt-5 · OpenAI couldn't answer: HTTP 429".
export const failed = (id, e, models = []) => ({ id, why: `${labelOf(id, models)} couldn't answer: ${String(e?.message || e).slice(0, 240)}` })

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
      if (stop(e)) throw e
      first ||= e
      passed.push(failed(id, e, ready))
    }
  }
  throw Object.assign(first || new Error(passed[0]?.why || 'There\'s no model in the list'), { passed })
}
