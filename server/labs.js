// More models, off to start with: Alibaba's Qwen (and Qwen Code), DeepSeek, Moonshot's Kimi, Zhipu's
// GLM (Z.ai), and the like served by hosts like OpenRouter or run in Ollama (MiniMax, Hunyuan, ERNIE,
// ...). Left out everywhere (the agents to start, Settings › Model providers, the models a chat,
// a summary or a second opinion can use, usage) and their saved keys aren't handed to agents,
// unless Settings › Model providers › "Show more models" is on (moreModels; paths.js carries over the
// older name).
let cfg = {}
export const configure = (c) => { cfg = c || {} }
export const moreOn = () => cfg.moreModels === true

const AGENTS = new Set(['qwen'])
// Settings › Model providers ids, and the names usage readings use.
const PROVIDERS = new Set(['deepseek', 'moonshot', 'kimi', 'zai'])
const MODEL = /qwen|qwq|deepseek|kimi|moonshot|(^|[^a-z])glm|zhipu|z-ai\/|minimax|hunyuan|ernie|baichuan|internlm|01-ai|(^|\/)yi-|doubao|stepfun/i

export const hiddenAgent = (kind) => !moreOn() && AGENTS.has(kind)
export const hiddenProvider = (id) => !moreOn() && (PROVIDERS.has(id) || AGENTS.has(id))
// A model id as chatmodels.js names it, "<route>:<model>" ("deepseek:deepseek-chat",
// "openrouter:qwen/qwen3-coder", "cli:qwen").
export function hiddenModel(id) {
  if (moreOn()) return false
  const [route, ...rest] = String(id || '').split(':')
  const model = rest.join(':')
  return PROVIDERS.has(route) || (route === 'cli' && AGENTS.has(model)) || MODEL.test(model)
}
export const OFF = 'That one is off to start with. Turn it on in Settings › Model providers › Show more models.'
