// An agent installed while Bridge AI is still looking for agents is found when it looks again (as
// the app does after an install). A look can take seconds: on Windows, or with a folder on PATH that
// macOS is holding (scripts/tcc-sim.mjs stands in for that here); a look again used to get the
// answer of the one already under way, from before the install. tcc-sim takes POSIX paths, so not
// on Windows, where the slowness showed. And Antigravity CLI, found and started with its prompt.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { startKit, checks, sleep, IS_WIN, ROOT, TEST } from '../lib/harness.mjs'

const { ok, skip, done } = checks('agents-found')
if (IS_WIN) { skip('an agent installed during a look', 'the slow-folder stand-in takes POSIX paths'); process.exit(done().fail ? 1 : 0) }

const HOLD = 4000
const kit = await startKit('agents-found', {
  env: ({ home, PATH }) => {
    const slow = path.join(home, 'Documents', 'bin')
    return { NODE_OPTIONS: `--import ${pathToFileURL(path.join(ROOT, 'scripts', 'tcc-sim.mjs')).href}`, SIM_PROTECTED: slow, SIM_MS: String(HOLD), BRIDGE_PATH: `${PATH}${path.delimiter}${slow}` }
  },
})
try {
  fs.mkdirSync(path.join(kit.home, 'Documents', 'bin'), { recursive: true })
  const first = kit.api('/agents/catalog') // a look, held on the slow folder
  await sleep(500)
  kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  const again = await kit.api('/agents/catalog')
  ok(again.some((a) => a.kind === 'claude' && a.installed), 'Claude Code, installed during a look, is found by the look after it', again.filter((a) => a.installed).map((a) => a.kind))
  await first
  // Antigravity CLI (Gemini CLI's successor for Google's plans): found as agy, and started with its
  // opening prompt the way it takes one (-i).
  kit.program('agy', "require('node:fs').appendFileSync(require('node:path').join(require('node:os').homedir(), 'agy-args.log'), JSON.stringify(process.argv.slice(2)) + '\\n'); setInterval(() => {}, 1000)")
  const cat = await kit.api('/agents/catalog')
  const agy = cat.find((a) => a.kind === 'agy')
  ok(agy?.installed && agy.label === 'Antigravity CLI', 'Antigravity CLI is found when agy is installed', agy)
  const d = path.join(kit.home, 'code', 'site')
  fs.mkdirSync(d, { recursive: true })
  await kit.api('/agents/launch', { kind: 'agy', cwd: d, label: 'Site', prompt: 'fix the header' })
  const said = await (async () => { for (let i = 0; i < 40; i++) { try { const t = fs.readFileSync(path.join(kit.home, 'agy-args.log'), 'utf8'); if (t) return t } catch { /* not yet */ } await sleep(250) } return '' })()
  ok(/\["-i","fix the header"\]/.test(said), 'and starts with what to do first', said)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
