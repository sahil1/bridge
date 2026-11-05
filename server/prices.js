// List prices for models reached with an API key, in US dollars per million tokens: what's read,
// what's written, and what's read from the provider's cache. Pinned here, from each provider's own
// pricing page as of AS_OF, so a cost is worked out on this computer with nothing fetched. Only the
// providers you pay by the token with a key you saved: a plan (a sign-in), a cloud (Azure,
// Bedrock and Vertex price by contract and region) and a model on this computer have no cost, and
// a model not listed here says so rather than guess. OpenRouter says each answer's cost itself.
export const AS_OF = '2026-10'

// [route, model name or the start of one, [in, out, cache read]]. The longest name that fits wins,
// so "gpt-5-mini" isn't priced as "gpt-5", and a dated name ("claude-sonnet-4-5-20250929") as its model.
const TABLE = [
  ['anthropic', 'claude-fable-5-1', [10, 50, 0.25]],
  ['anthropic', 'claude-fable-5', [10, 50, 1]],
  ['anthropic', 'claude-opus-5-5', [4, 20, 0.2]],
  ['anthropic', 'claude-opus-5', [5, 25, 0.5]],
  ['anthropic', 'claude-opus-4-8', [5, 25, 0.5]],
  ['anthropic', 'claude-opus-4-7', [5, 25, 0.5]],
  ['anthropic', 'claude-opus-4-6', [5, 25, 0.5]],
  ['anthropic', 'claude-opus-4-5', [5, 25, 0.5]],
  ['anthropic', 'claude-opus-4-1', [15, 75, 1.5]],
  ['anthropic', 'claude-opus-4', [15, 75, 1.5]],
  ['anthropic', 'claude-sonnet-5-5', [2, 10, 0.2]],
  ['anthropic', 'claude-sonnet-5', [2, 10, 0.2]],
  ['anthropic', 'claude-sonnet-4-6', [3, 15, 0.3]],
  ['anthropic', 'claude-sonnet-4-5', [3, 15, 0.3]],
  ['anthropic', 'claude-sonnet-4', [3, 15, 0.3]],
  ['anthropic', 'claude-haiku-5-5', [0.1, 0.5, 0.01]],
  ['anthropic', 'claude-haiku-4-5', [1, 5, 0.1]],
  ['anthropic', 'claude-3-5-haiku', [0.8, 4, 0.08]],
  ['openai', 'gpt-5', [1.25, 10, 0.125]],
  ['openai', 'gpt-5.1', [1.25, 10, 0.125]],
  ['openai', 'gpt-5-mini', [0.25, 2, 0.025]],
  ['openai', 'gpt-5-nano', [0.05, 0.4, 0.005]],
  ['openai', 'gpt-5-pro', [15, 120, 15]],
  ['openai', 'gpt-4.1', [2, 8, 0.5]],
  ['openai', 'gpt-4.1-mini', [0.4, 1.6, 0.1]],
  ['openai', 'gpt-4.1-nano', [0.1, 0.4, 0.025]],
  ['openai', 'gpt-4o', [2.5, 10, 1.25]],
  ['openai', 'gpt-4o-mini', [0.15, 0.6, 0.075]],
  ['openai', 'o3', [2, 8, 0.5]],
  ['openai', 'o3-mini', [1.1, 4.4, 0.55]],
  ['openai', 'o3-pro', [20, 80, 20]],
  ['openai', 'o4-mini', [1.1, 4.4, 0.275]],
  ['xai', 'grok-4', [3, 15, 0.75]],
  ['xai', 'grok-4-fast', [0.2, 0.5, 0.05]],
  ['xai', 'grok-4-1-fast', [0.2, 0.5, 0.05]],
  ['xai', 'grok-3', [3, 15, 0.75]],
  ['xai', 'grok-3-mini', [0.3, 0.5, 0.075]],
  ['xai', 'grok-code-fast-1', [0.2, 1.5, 0.02]],
  ['gemini', 'gemini-2.5-pro', [1.25, 10, 0.31]],
  ['gemini', 'gemini-2.5-flash', [0.3, 2.5, 0.03]],
  ['gemini', 'gemini-2.5-flash-lite', [0.1, 0.4, 0.01]],
  ['gemini', 'gemini-2.0-flash', [0.1, 0.4, 0.025]],
  ['deepseek', 'deepseek-chat', [0.28, 0.42, 0.028]],
  ['deepseek', 'deepseek-reasoner', [0.28, 0.42, 0.028]],
  ['groq', 'llama-3.3-70b-versatile', [0.59, 0.79, 0.59]],
  ['groq', 'llama-3.1-8b-instant', [0.05, 0.08, 0.05]],
  ['perplexity', 'sonar-pro', [3, 15, 3]],
  ['perplexity', 'sonar', [1, 1, 1]],
].sort((a, b) => b[1].length - a[1].length)
// Anthropic charges a quarter more than reading for what's written to its cache.
const WRITE = { anthropic: 1.25 }

const fits = (name, model) => model === name || model.startsWith(`${name}-`) || model.startsWith(`${name}@`)
export const priced = (route) => TABLE.some((x) => x[0] === route) || route === 'openrouter'
// The price of a model, or null.
export function priceOf(route, model) {
  const m = String(model || '').toLowerCase()
  const hit = TABLE.find(([r, name]) => r === route && fits(name, m))
  return hit ? { in: hit[2][0], out: hit[2][1], cached: hit[2][2] } : null
}
// What one answer cost: { in, out, cached, written } tokens (in counts the cached and written
// parts), or null when there's no price for it. A cost the provider said (OpenRouter) is taken as is.
export function costOf(route, model, u) {
  if (typeof u?.cost === 'number') return u.cost
  if (u?.in == null && u?.out == null) return null
  const p = priceOf(route, model)
  if (!p) return null
  const cached = u.cached || 0, written = u.written || 0
  const plain = Math.max(0, (u.in || 0) - cached - written)
  return (plain * p.in + cached * p.cached + written * p.in * (WRITE[route] || 1) + (u.out || 0) * p.out) / 1e6
}
