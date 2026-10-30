// Where agents run. Set "runtime" in your config:
//   "builtin" (default) Bridge AI runs the terminals itself; nothing else to install. They live in
//             a small terminal host, so they keep running when Bridge AI quits ("keepAgents")
//   "herdr"   use herdr (https://herdr.dev), only when you choose it. Agents then live in your
//             herdr session alongside anything else you run there.
// Every runtime exposes the same calls (see builtin.js for the full list), so the rest of the
// server never needs to know which one is in use.
import * as herdr from './herdr.js'
import * as builtin from './builtin.js'
import { useSession } from './herdr-cli.js'
import { stopHost } from './hostlink.js'

// herdr was chosen but agents run here instead, and why (shown under the top bar), or null.
let instead = null
export const fellBack = () => instead

export async function pickRuntime(cfg = {}) {
  const want = String(process.env.BRIDGE_RUNTIME || cfg.runtime || 'builtin').toLowerCase()
  // A herdr too old for what Bridge AI asks of it would half work (screens that read empty,
  // prompts that don't go in): run agents here until it's updated. One that isn't installed, or
  // doesn't answer, stays chosen, and the notice says to start it.
  const v = want === 'herdr' ? await herdr.version() : null
  if (v?.old) instead = { from: 'herdr', version: v.version, min: herdr.MIN_VERSION, why: `herdr ${v.version} is older than ${herdr.MIN_VERSION}, the oldest Bridge AI works with` }
  else if (want === 'herdr') {
    useSession(cfg.herdr?.session)
    // Built-in agents still running from before you switched would be out of sight: end them.
    // The saved layout stays, so switching back resumes them.
    stopHost().catch(() => {})
    return herdr
  }
  // Anything else, including the old "auto", is built in: having herdr installed shouldn't move
  // your agents into it without asking. Bring your agents back, but don't hold the server for it:
  // if macOS is still asking about their folder (your Desktop, say), the server answers meanwhile
  // and they appear once you allow it.
  await Promise.race([builtin.restore({ keep: cfg.keepAgents !== false }).catch(() => {}), new Promise((r) => setTimeout(r, 3000))])
  return builtin
}
