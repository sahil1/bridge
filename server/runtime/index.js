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

export async function pickRuntime(cfg = {}) {
  const want = String(process.env.BRIDGE_RUNTIME || cfg.runtime || 'builtin').toLowerCase()
  if (want === 'herdr') {
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
