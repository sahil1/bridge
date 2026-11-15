// What Claude Code's short names stand for, in the message box's model menu (server/models.js,
// src/components/ModelChip.jsx), from made-up agents and transcripts (no server): an agent asked
// for "opus" that replies as claude-opus-5-5 teaches the menu that Opus is Opus 5.5; one started on
// your default teaches what that is; a reply from before a /model since doesn't count; a newer
// reply moves the name on (a Claude Code update); and it's still known after a restart
// (model-names.json).
import fs from 'node:fs'
import path from 'node:path'
import { checks, OUT } from '../lib/harness.mjs'

const { ok, done } = checks('model-names')

const scratch = path.join(OUT, 'kits', `model-names-${process.pid}`)
fs.rmSync(scratch, { recursive: true, force: true })
const home = path.join(scratch, 'home')
const data = path.join(scratch, 'data')
fs.mkdirSync(home, { recursive: true })
process.env.BRIDGE_HOME = data
process.env.HOME = home
const cwd = path.join(home, 'code', 'shop')
const projects = path.join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
fs.mkdirSync(projects, { recursive: true })

const at = (min) => new Date(Date.now() - min * 60000).toISOString()
const reply = (model, min) => ({ type: 'assistant', timestamp: at(min), message: { role: 'assistant', model, content: [{ type: 'text', text: 'Done.' }] } })
const transcript = (sid, lines) => fs.writeFileSync(path.join(projects, `${sid}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

const load = async (tag) => {
  const m = await import(`../../server/models.js?${tag}`)
  const agents = new Map()
  const models = m.makeModels({ rt: {}, cfg: { agents: {} }, findAgent: async (id) => agents.get(id) })
  return { agents, view: models.view }
}

{
  const { agents, view } = await load('first')
  transcript('s-opus', [reply('claude-opus-5-5', 5)])
  agents.set('p1', { paneId: 'p1', kind: 'claude', sessionId: 's-opus', cwd, model: 'opus' })
  const v1 = await view('p1')
  ok(v1.named?.opus === 'claude-opus-5-5', 'an agent started on "opus" that replies as claude-opus-5-5: Opus is Opus 5.5', v1.named)

  transcript('s-plain', [reply('claude-sonnet-5-5', 4)])
  agents.set('p2', { paneId: 'p2', kind: 'claude', sessionId: 's-plain', cwd })
  const v2 = await view('p2')
  ok(v2.named?.default === 'claude-sonnet-5-5' && v2.named?.opus === 'claude-opus-5-5', 'one started on your default teaches what the default is, and Opus stays known', v2.named)

  // Asked for "haiku", then /model sonnet typed in it, and its last reply is from before that.
  transcript('s-moved', [
    reply('claude-haiku-5-0', 9),
    { type: 'user', timestamp: at(8), message: { role: 'user', content: '<command-name>/model</command-name>\n<command-args>sonnet</command-args>' } },
    { type: 'user', timestamp: at(8), message: { role: 'user', content: '<local-command-stdout>Set model to Sonnet 5.5 (claude-sonnet-5-5)</local-command-stdout>' } },
  ])
  agents.set('p3', { paneId: 'p3', kind: 'claude', sessionId: 's-moved', cwd, model: 'haiku' })
  const v3 = await view('p3')
  ok(!v3.named?.haiku, 'a reply from before a /model since says nothing about the name it was asked for', v3.named)

  transcript('s-opus', [reply('claude-opus-5-5', 5), reply('claude-opus-5-6', 1)])
  const v4 = await view('p1')
  ok(v4.named?.opus === 'claude-opus-5-6', 'a newer reply moves the name on (a Claude Code update)', v4.named)

  transcript('s-old', [reply('claude-opus-5-1', 30)])
  agents.set('p4', { paneId: 'p4', kind: 'claude', sessionId: 's-old', cwd, model: 'opus' })
  const v5 = await view('p4')
  ok(v5.named?.opus === 'claude-opus-5-6', 'an older conversation\'s reply doesn\'t move it back', v5.named)

  agents.set('c1', { paneId: 'c1', kind: 'codex', sessionId: null, cwd })
  const v6 = await view('c1').catch((e) => ({ error: e.message }))
  ok(v6 && !v6.error && v6.named === undefined, 'other agents\' menus carry no Claude names', v6)
}

{
  const saved = JSON.parse(fs.readFileSync(path.join(data, 'model-names.json'), 'utf8'))
  ok(saved.opus?.id === 'claude-opus-5-6' && saved.default?.id === 'claude-sonnet-5-5', 'kept in model-names.json', saved)
  const { agents, view } = await load('again')
  agents.set('p9', { paneId: 'p9', kind: 'claude', sessionId: null, cwd })
  const v = await view('p9')
  ok(v.named?.opus === 'claude-opus-5-6', 'and known again after a restart, before any reply', v.named)
}

// The menu's labels, as ModelChip.jsx makes them, from what the server says.
{
  const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'src', 'components', 'ModelChip.jsx'), 'utf8')
  ok(/BEHIND\[short\]/.test(src) && /data\.named/.test(src), 'the chip reads the names the server sends')
}

fs.rmSync(scratch, { recursive: true, force: true })
process.exit(done().fail ? 1 : 0)
