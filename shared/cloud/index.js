// Cloud agents: one adapter per provider, all with the same small interface. Plain ES modules
// that only use the fetch they're given (no Node APIs), so the server and the phone apps can run
// the same code.
//
//   create({ key, fetch, base?, memo?, github?, githubBase? }) -> client
//     memo: { get(k), set(k, v) } for the little a provider keeps between calls
//   client.check()                       -> { ok, account }
//   client.repos()                       -> [{ name: 'owner/repo', url, defaultBranch, private? }]
//   client.branches(repo)                -> ['main', ...] (may be [])
//   client.launch({ repo, branch, prompt, model? }) -> task
//   client.list()                        -> [task] (summaries)
//   client.get(id, { messages = true })  -> task, with messages when asked
//   client.send(id, text)                -> { ok }   (throws with .busy when it can't take it yet)
//   client.stop(id)                      -> { ok }   (absent when the provider has no way to stop)
//   client.approve(id)                   -> { ok }   (optional: approve a plan, allow a tool)
//
//   task: { id, title, status, state, repo, branch, base, url, urlLabel?, prUrl, createdAt,
//           updatedAt, summary, ask, approveLabel?, messages?: [{ id, role, text, ts, ... }] }
//   status is Bridge AI's: 'working' | 'blocked' (waiting on you) | 'done' | 'failed' | 'idle';
//   state is the provider's own word for it. Message roles: user, assistant, tool (tool, hint),
//   event (status: completed | failed | info).
import * as cursor from './cursor.js'
import * as copilot from './github.js'
import * as jules from './jules.js'
import * as claude from './claude.js'

export { CloudError } from './http.js'
export const ADAPTERS = { cursor, copilot, jules, claude }
export const PROVIDERS = Object.values(ADAPTERS).map((a) => a.info)
export const connect = (id, opts) => {
  const a = ADAPTERS[id]
  if (!a) throw new Error(`Unknown cloud provider: ${id}`)
  return a.create(opts)
}
