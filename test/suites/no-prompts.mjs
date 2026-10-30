// A first start asks macOS for nothing, on a Mac whose Claude Code history has a project in
// Documents, with Documents acting like macOS's protected folder (scripts/tcc-sim.mjs: the first
// look into it waits, as for "Allow access to your Documents folder?"): setup's look for projects
// answers at once and lists it without looking in; picking it keeps it so, and a restart doesn't
// look either. Work starting there (which asks anyway, as the agent opens) lets Bridge AI look from
// then on. Off a Mac nothing is protected, so there's nothing to check.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { startKit, checks, until, IS_MAC, ROOT, TEST } from '../lib/harness.mjs'

const { ok, skip, done } = checks('no-prompts')
if (!IS_MAC) { skip('a first start on a Mac', 'Desktop and Documents are only protected on a Mac'); process.exit(done().fail ? 1 : 0) }

const HOLD = 12000
const kit = await startKit('no-prompts', {
  env: ({ home }) => ({ NODE_OPTIONS: `--import ${pathToFileURL(path.join(ROOT, 'scripts', 'tcc-sim.mjs')).href}`, SIM_PROTECTED: path.join(home, 'Documents'), SIM_MS: String(HOLD) }),
})
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const shop = path.join(kit.home, 'Documents', 'shop')
const timed = async (fn) => { const t = Date.now(); const r = await fn(); return [r, Date.now() - t] }
try {
  fs.mkdirSync(shop, { recursive: true })
  // Three conversations there this week, as Claude Code keeps them.
  const logs = path.join(kit.home, '.claude', 'projects', shop.replace(/[^a-zA-Z0-9]/g, '-'))
  fs.mkdirSync(logs, { recursive: true })
  for (const n of [1, 2, 3]) fs.writeFileSync(path.join(logs, `0000000${n}-aaaa-bbbb-cccc-dddddddddddd.jsonl`), `${JSON.stringify({ type: 'user', cwd: shop, sessionId: `s${n}`, message: { role: 'user', content: 'hi' } })}\n`)

  const [scan, ms] = await timed(() => kit.api('/projects?scan=fresh'))
  const found = (scan.found || []).find((x) => x.path === shop)
  ok(ms < 5000, `setup's look for projects answers at once, without waiting on macOS (${ms} ms)`)
  ok(!!found && found.unchecked && found.suggested, 'and lists the project in Documents from the history, ticked, without looking in', scan.found)

  const [, addMs] = await timed(() => kit.api('/projects', { paths: [shop] }))
  const [list, listMs] = await timed(() => kit.api('/projects'))
  ok(addMs < 5000 && listMs < 5000 && (list.projects || list).some?.((x) => x.path === shop), `picking it keeps it, still without a look (${addMs} ms, ${listMs} ms)`, list)

  await kit.restart()
  const [, again] = await timed(() => kit.api('/projects'))
  ok(again < 5000, `after a restart, still no look (${again} ms)`)
  ok(!/\[tcc-sim\] FROZE/.test(kit.log()), 'nothing in the server waited on macOS', kit.log().match(/\[tcc-sim\] FROZE.*/g))

  // Work starts there: the agent opening asks macOS anyway, and from then on Bridge AI may look.
  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed), 'the stand-in Claude Code is found')
  await kit.api('/agents/launch', { kind: 'claude', cwd: shop, label: 'Shop', newSpace: 'Shop', prompt: 'idle' })
  const asked = () => { try { return JSON.parse(fs.readFileSync(path.join(kit.data, 'asked-folders.json'), 'utf8')) } catch { return [] } }
  ok(!!(await until(() => asked().includes(path.join(kit.home, 'Documents')), HOLD + 10000, 300)), 'once work starts there, Documents counts as asked', asked())
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
