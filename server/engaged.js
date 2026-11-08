// When you were last on each agent here, and in each project and space, so what needs you can be
// put in order by how recently you were on it as well as how much it holds up (shared/focus.js): a
// question from an agent you messaged a minute ago, or from one in a project you're working in,
// comes before one nobody has looked at for days.
//
// Noted as you do it, never guessed: a message you sent it (its message box, a reply from Needs you
// or Home, one queued or sent now), keys or typing in its terminal, an answer from Needs you or Home,
// its chat opened (its live transcript; a page reconnecting after a restart isn't you), a new agent
// you started in a folder, and a reply to one of Chief of Staff's tasks. What Chief of Staff sends
// or reads itself isn't you, nor is a first-run screen answered by the page.
//
// An agent is known by its pane and folder (a pane number used again for another agent is another
// agent); a project by its folder (an agent on its own branch by the repo it belongs to, a cloud agent
// by its repo; a New chat has none); a space by its id here. Kept in the cache folder
// (engaged.json), each for 30 days after you were last on it.
import fs from 'node:fs'
import path from 'node:path'
import { cacheFile, writeFileAtomic } from './paths.js'

const FILE = cacheFile('engaged.json')
const KEEP = 30 * 864e5
const iso = (t) => (t ? new Date(t).toISOString() : null)

// describe(cwd): an agent's own branch ({ repo }), for an agent from the runtime that doesn't say
// (worktrees.describe). chats: the folder New chats run in.
export function make({ describe = () => null, chats = null, file = FILE } = {}) {
  let kept = { agents: {}, projects: {}, spaces: {}, tasks: {} }
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const k of Object.keys(kept)) if (d?.[k] && typeof d[k] === 'object') kept[k] = d[k]
  } catch { /* none yet */ }
  const tidy = (now = Date.now()) => { for (const m of Object.values(kept)) for (const [k, at] of Object.entries(m)) if (!(now - at < KEEP)) delete m[k] }
  tidy()
  let timer = null
  const save = () => {
    if (timer) return
    timer = setTimeout(() => { timer = null; tidy(); try { fs.mkdirSync(path.dirname(file), { recursive: true }); writeFileAtomic(file, JSON.stringify(kept)) } catch { /* next change */ } }, 1500)
    timer.unref?.()
  }
  const note = (m, k, at) => { if (k && !((m[k] || 0) >= at)) { m[k] = at; save() } }

  const agentKey = (a) => (a?.paneId ? `${a.paneId}|${a.cwd || a.cloud?.repo || ''}` : null)
  function projectKey(a) {
    if (!a) return null
    if (a.cloud) return a.cloud.repo ? `cloud:${a.cloud.repo}` : null
    if (!a.cwd || a.plainChat || (chats && path.resolve(a.cwd) === path.resolve(chats))) return null
    const tree = a.worktree !== undefined ? a.worktree : describe(a.cwd)
    return path.resolve(tree?.repo || a.cwd)
  }

  // You on an agent (as the fleet has it: paneId, cwd, workspaceId, and worktree or cloud if any).
  function agent(a, at = Date.now()) {
    if (!a?.paneId) return
    note(kept.agents, agentKey(a), at)
    note(kept.projects, projectKey(a), at)
    if (a.workspaceId) note(kept.spaces, String(a.workspaceId), at)
  }
  // You in a folder, with no agent there yet: a new one you started.
  const folder = (dir, at = Date.now()) => { if (dir && !(chats && path.resolve(dir) === path.resolve(chats))) note(kept.projects, path.resolve(dir), at) }
  const task = (id, at = Date.now()) => note(kept.tasks, String(id), at)

  // What's known of you on an agent: when you were last on it, in its project and in its space.
  const of = (a) => ({ you: iso(kept.agents[agentKey(a)]), project: iso(kept.projects[projectKey(a)]), space: a?.workspaceId ? iso(kept.spaces[String(a.workspaceId)]) : null })
  const taskOf = (id) => iso(kept.tasks[String(id)])
  return { agent, folder, task, of, taskOf }
}
