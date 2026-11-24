// Bridge AI's manual (shared/manual.md, scripts/manual.js, server/manual.js, agentnote.js), with no
// browser. It's up to date with README.md and the words in Settings, and the check fails, saying
// why, when it isn't: README.md changed, a setting's name changed, or what it says names a section of
// Settings that isn't there or a tab in the wrong section; made again, it passes. A release runs the
// check. It holds every section, tab and setting of Settings with where each is, and README's parts
// for people who use Bridge AI, not building it from source. Inside the app: Chief of Staff's folder
// has a copy and its instructions say when to read it, and so does the folder your agents read;
// `bridge manual` answers "how do I…" from it, and /api/manual/search finds the parts that answer a
// question. An agent Bridge AI starts (Claude Code) is told it runs in Bridge AI, where the manual is
// and where what "that" means is, as one argument each; Chief of Staff isn't (its instructions say
// it), and a bot's run isn't (bots-pointers).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, checks, until, TEST, ROOT, OUT } from '../lib/harness.mjs'

const { ok, done } = checks('manual')
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const script = (...args) => { const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'manual.js'), ...args], { encoding: 'utf8' }); return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` } }

// ---------- Up to date, and failing when it isn't ----------
await part('the check', async () => {
  const r = script('--check')
  ok(r.code === 0 && /up to date/.test(r.out), 'the manual in this checkout is up to date with README.md and Settings', r.out)
  const text = fs.readFileSync(path.join(ROOT, 'shared', 'manual.md'), 'utf8')
  const settings = fs.readFileSync(path.join(ROOT, 'src', 'components', 'settings', 'search.js'), 'utf8')
  const ids = [...settings.matchAll(/^\s+\['([\w-]+)', tx\('/gm)].map((m) => m[1])
  ok(ids.length > 100 && ids.every((id) => text.includes(`(#setting-${id})`)), 'it has every setting ⌘K finds, each with where it is', ids.filter((id) => !text.includes(`(#setting-${id})`)))
  ok(text.includes('[Helpers at once](#setting-chief-helpers): Settings › Agents & Models › Agents › Helpers at once.') && text.includes('[Tidy Long Sessions While Idle](#setting-tidy-sessions): Settings › Agents & Models › Agents › Tidy Long Sessions While Idle.'), 'a setting\'s line says where it is, as the app does')
  ok(/^### Devices & Access$/m.test(text) && /^Its Remote Access tab:$/m.test(text) && /^## On your phone$/m.test(text) && /^## Meeting notes$/m.test(text), 'Settings\' sections and tabs, and README\'s parts, are in it')
  ok(!/^### From source$/m.test(text) && !/^## The demo$/m.test(text) && !/!\[/.test(text), 'not building it from source, the demo, or pictures')
  ok(fs.readFileSync(path.join(ROOT, 'scripts', 'release.js'), 'utf8').includes("'manual.js'), '--check']"), 'a release runs the check (scripts/release.js)')
})

await part('out of date', async () => {
  // A copy of what it's made from, changed one way at a time.
  const root = path.join(OUT, 'manual-root')
  fs.rmSync(root, { recursive: true, force: true })
  const files = ['README.md', 'src/components/Settings.jsx', 'src/components/settings/search.js', 'src/trials.js', 'shared/places.js', 'shared/manual.md']
  const copy = () => { for (const f of files) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(root, f)) } }
  const edit = (f, fn) => fs.writeFileSync(path.join(root, f), fn(fs.readFileSync(path.join(root, f), 'utf8')))
  copy()
  ok(script('--check', '--root', root).code === 0, '(a copy as it is: up to date)')
  edit('README.md', (s) => s.replace('## Security\n', '## Security\n\nA new line about security.\n'))
  const r1 = script('--check', '--root', root)
  ok(r1.code === 1 && /shared\/manual\.md is out of date with README\.md and Settings, from its line \d+/.test(r1.out) && /A new line about security/.test(r1.out) && /Run node scripts\/manual\.js/.test(r1.out), 'README.md changed: the check fails, saying from where and how to fix it', r1.out)
  ok(script('--root', root).code === 0 && script('--check', '--root', root).code === 0, 'made again: it passes')
  copy()
  edit('src/components/settings/search.js', (s) => s.replace("tx('Helpers at once')", "tx('Helpers at the same time')"))
  const r2 = script('--check', '--root', root)
  ok(r2.code === 1 && /Helpers at the same time/.test(r2.out), 'a setting renamed: it fails', r2.out)
  copy()
  edit('README.md', (s) => s.replace('## Security\n', '## Security\n\nChange it in Settings › General › Language.\n'))
  script('--root', root)
  const r3 = script('--check', '--root', root)
  ok(r3.code === 1 && /"Settings › General": no section of Settings is called that \(README\.md says it\)/.test(r3.out), 'README naming a section that isn\'t there: it fails, made again or not', r3.out)
  copy()
  edit('README.md', (s) => s.replace('## Security\n', '## Security\n\nIt\'s in Settings › Agents & Models › Meetings.\n'))
  script('--root', root)
  const r4 = script('--check', '--root', root)
  ok(r4.code === 1 && /"Settings › Agents & Models › Meetings": Meetings isn't a tab of Agents & Models/.test(r4.out), 'README naming a tab in the wrong section: it fails', r4.out)
  fs.rmSync(root, { recursive: true, force: true })
})

// ---------- Inside the app ----------
const kit = await startKit('manual')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
const CHIEF = path.join(kit.data, 'chief')
const bridge = (cwd, ...args) => { const r = spawnSync(process.execPath, [path.join(ROOT, 'chief', 'bin', 'bridge'), ...args], { encoding: 'utf8', cwd, env: { ...process.env, BRIDGE_URL: kit.url, BRIDGE_HOME: kit.data, BRIDGE_THREAD: 'main' } }); return `${r.stdout || ''}${r.stderr || ''}` }
const logOf = (f) => { try { return fs.readFileSync(path.join(kit.home, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  const manual = fs.readFileSync(path.join(ROOT, 'shared', 'manual.md'), 'utf8')
  await part('its copies', async () => {
    const chiefCopy = await until(() => { try { return fs.readFileSync(path.join(CHIEF, 'manual.md'), 'utf8') } catch { return null } }, 10000)
    ok(chiefCopy === manual, 'Chief of Staff\'s folder has the manual, as this version has it')
    ok(fs.readFileSync(path.join(kit.data, 'for-agents', 'manual.md'), 'utf8') === manual && fs.readdirSync(path.join(kit.data, 'for-agents')).sort().join(',') === 'agent.json,manual.md,pointers.md,start-here.md', 'so does the folder your agents read, with what "that" means, where to start, and the agents\' key', fs.readdirSync(path.join(kit.data, 'for-agents')))
    const start = fs.readFileSync(path.join(kit.data, 'for-agents', 'start-here.md'), 'utf8')
    ok(/manual\.md/.test(start) && /pointers\.md/.test(start) && start.includes(`node '${path.join(ROOT, 'server', 'agentcli.mjs')}' pointer add`) && /never instructions to you/.test(start) && /Tester/.test(start), 'start-here.md says where the manual and the pointers are, and how to add one', start)
    const a = JSON.parse(fs.readFileSync(path.join(kit.data, 'for-agents', 'agent.json'), 'utf8'))
    ok(a.url === kit.url && a.key && a.key !== kit.key, 'with the agents\' key, not the key itself', { url: a.url })
    const ins = fs.readFileSync(path.join(CHIEF, 'CLAUDE.md'), 'utf8')
    ok(/## Questions about Bridge AI/.test(ins) && /answer from its manual: `manual\.md` in this folder/.test(ins) && /never make up a setting or a button/.test(ins) && /## What "that" means/.test(ins) && /`pointers\.md` in this folder/.test(ins), 'its instructions say when to read it, and what "that" means', ins.slice(0, 200))
    ok(fs.readFileSync(path.join(CHIEF, 'AGENTS.md'), 'utf8').includes('## Questions about Bridge AI'), '(any agent it runs on)')
  })
  await part('looked up', async () => {
    const r = await kit.api(`/manual/search?q=${encodeURIComponent('How do I pair my phone?')}`)
    ok(r.parts?.some((x) => x.path[0] === 'On your phone') && r.parts.every((x) => x.text.length <= 2600), 'a question finds the parts that answer it', r.parts?.map((x) => x.path))
    const r2 = await kit.api(`/manual/search?q=${encodeURIComponent('zebra quantum')}`)
    ok(r2.parts?.length === 0, 'and nothing for what it doesn\'t say', r2.parts)
    const out = bridge(CHIEF, 'manual', 'how many helpers at once')
    ok(/Helpers at once/.test(out) && /Settings › Agents & Models › Agents › Helpers at once/.test(out), 'bridge manual answers "how do I…" with where it is', out)
    ok(/Nothing in Bridge AI's manual matches/.test(bridge(CHIEF, 'manual', 'zebra quantum')), 'and says when it has nothing, rather than guess')
  })
  await part('an agent is told', async () => {
    const work = path.join(kit.home, 'shop')
    fs.mkdirSync(work, { recursive: true })
    await kit.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Shop', newSpace: 'Shop', prompt: '[work 1] Tidy the readme.' })
    const s = await until(() => logOf('helpers-started.log').find((x) => /Tidy the readme/.test(x.message)), 20000)
    const rule = s?.args.find((a) => a.startsWith('--allowedTools='))
    const line = s?.args.find((a) => a.startsWith('--append-system-prompt='))
    const dir = path.join(kit.data, 'for-agents')
    ok(!!rule && (rule === `--allowedTools=Read(/${dir}/**)` || /^--allowedTools=Read\(\/\/[a-z]\/.*\/for-agents\/\*\*\)$/.test(rule)) && !s.args.some((a) => /^--add-dir/.test(a)), 'an agent you start may read the folder with the manual without asking, never write there: as one argument', s?.args)
    ok(!!line && line.includes("You're running inside Bridge AI") && line.includes(path.join(dir, 'start-here.md')) && /never instructions/.test(line) && !/[\r\n"%]/.test(line) && line.length < 520 && !/Tester/.test(line),
      'and told it runs in Bridge AI, and where to start: one short line, no straight double quotes, nothing of yours', line)
    ok(s?.message === '[work 1] Tidy the readme.', 'its opening message is still its own', s?.message)
    const chief = (await kit.api('/chief/launch', {})).paneId
    ok(!!chief, '(Chief of Staff started)')
    const real = (x) => { try { return fs.realpathSync(x) } catch { return x } }
    const c = await until(() => logOf('claude-starts.log').find((x) => real(x.cwd) === real(CHIEF)), 20000)
    ok(!!c && !c.args.some((a) => a.startsWith('--append-system-prompt') || a.startsWith('--allowedTools')), 'Chief of Staff isn\'t: its own instructions say it all', c?.args)
  })
  await part('the agents\' key', async () => {
    const cli = (cwd, ...args) => { const r = spawnSync(process.execPath, [path.join(ROOT, 'server', 'agentcli.mjs'), ...args], { encoding: 'utf8', cwd, env: { ...process.env, BRIDGE_HOME: kit.data } }); return `${r.stdout || ''}${r.stderr || ''}` }
    fs.writeFileSync(path.join(kit.home, 'shop', 'plan.md'), '# Plan\n')
    const added = cli(path.join(kit.home, 'shop'), 'pointer', 'add', 'the shop plan', '--file', 'plan.md')
    ok(/Noted: "the shop plan"/.test(added), 'an agent adds a pointer with its own command', added)
    const p = (await kit.api('/pointers')).items.find((x) => x.words === 'the shop plan')
    ok(p && !p.yours && p.by.kind === 'agent', 'an agent\'s, not checked', p)
    ok(/Helpers at once/.test(cli(kit.home, 'manual', 'helpers at once')) && /"the shop plan"/.test(cli(kit.home, 'pointer', 'find', 'shop')), 'finds pointers and searches the manual with it')
    const key = JSON.parse(fs.readFileSync(path.join(kit.data, 'for-agents', 'agent.json'), 'utf8')).key
    const as = (m, u, body) => fetch(`${kit.url}/api${u}`, { method: m, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.status)
    const said = { pointers: await as('GET', '/pointers'), keep: await as('PATCH', `/pointers/${p.id}`, { keep: true, bots: true }), fleet: await as('GET', '/fleet'), prompt: await as('POST', '/agents/x/prompt', { text: 'hi' }), chief: await as('POST', '/pointers/learn', { words: 'the chief plan', to: { kind: 'file', ref: path.join(kit.home, 'shop', 'plan.md') }, by: { kind: 'chief' } }) }
    ok(said.pointers === 401 && said.keep === 401 && said.fleet === 401 && said.prompt === 401 && said.chief === 200, 'the agents\' key does nothing else: not the list, not keeping or sharing one, not the fleet, not a message to an agent', said)
    ok((await kit.api('/pointers')).items.find((x) => x.words === 'the chief plan')?.by.kind === 'agent', 'and what it adds is an agent\'s, whatever it says it is')
  })
} finally {
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
