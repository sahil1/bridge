// Where agents run. Set "runtime" in your config:
//   "builtin" (default) Bridge AI runs the terminals itself; nothing else to install
//   "herdr"   use herdr (https://herdr.dev), only when you choose it. Agents then live in your
//             herdr session alongside anything else you run there.
// Every runtime exposes the same calls (see builtin.js for the full list), so the rest of the
// server never needs to know which one is in use.
import * as herdr from './herdr.js'
import * as builtin from './builtin.js'

export async function pickRuntime(cfg = {}) {
  const want = String(process.env.BRIDGE_RUNTIME || cfg.runtime || 'builtin').toLowerCase()
  if (want === 'herdr') return herdr
  // Anything else, including the old "auto", is built in: having herdr installed shouldn't move
  // your agents into it without asking.
  await builtin.restore()
  return builtin
}
