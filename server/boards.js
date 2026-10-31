// Whiteboards: drawings kept as Excalidraw files (.excalidraw, the format excalidraw.com and its
// editors open) in ~/.bridge-ai/boards, one file per board, named as the board is. The page draws
// them (src/components/whiteboard); this keeps the files and asks a model to draw or change one.
//
// A model is only asked when you press Draw or Change, and it's the one you picked or the one
// meeting notes use (your sign-in to an agent, a key, a model on this computer): what's sent is
// your words, the shapes and words on the board, and the meeting, project or agent's work you
// chose to draw from. Nothing else leaves the computer.
//
// Mermaid and draw.io handed over by an agent or the chief of staff (bin/bridge board) wait in the
// board as `bridge.pending` until the page next opens it: turning them into shapes needs a browser.
// Everything here reads and writes without blocking, and only in Bridge AI's own folder, apart
// from a project you pick to draw from.
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { dataFile, IS_MAC, IS_WIN } from './paths.js'
import { machine } from './machine.js'
import * as meetings from './meetings.js'
import * as projects from './projects.js'
import { gitReady } from './gitready.js'

const EXT = '.excalidraw'
const folder = () => dataFile('boards')
const previews = () => path.join(folder(), '.previews')
const trash = () => path.join(folder(), '.trash')
const MAX_BOARD = 40 * 1024 * 1024 // pictures pasted in are kept inside the file

// A board's name is its file's name, so it reads the same in Finder. Characters no system allows
// in a file name become spaces, and the name can't start with a dot (a hidden file) or be empty.
// Names Windows keeps for devices (CON, NUL, COM1…) get a mark after them.
export function cleanTitle(s) {
  const t = String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim().slice(0, 80).trim()
  return !t ? 'Untitled' : /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t) ? `${t}_` : t
}
// A board named in a request: only one whose name is already clean, so a name can't reach outside
// the folder (no slashes, no "..").
function fileOf(id) {
  const name = String(id || '')
  if (!name || cleanTitle(name) !== name) throw Object.assign(new Error('No such whiteboard'), { status: 404 })
  return path.join(folder(), `${name}${EXT}`)
}
const exists = (p) => fsp.access(p).then(() => true, () => false)

// Whole or not at all: next to it, then renamed over it.
let saves = 0
async function writeWhole(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}-${(saves++).toString(36)}.tmp`
  try {
    await fsp.writeFile(tmp, data)
    await fsp.rename(tmp, file)
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

export const empty = (more = {}) => ({ type: 'excalidraw', version: 2, source: 'https://github.com/sahil1/bridge', elements: [], appState: { viewBackgroundColor: '#ffffff', gridSize: 20 }, files: {}, ...more })

// What can be handed over to draw: Mermaid, a draw.io file, or an Excalidraw file as it is.
const KINDS = ['mermaid', 'drawio', 'excalidraw']
function sourceOf(s) {
  if (!s) return null
  const kind = KINDS.includes(s.kind) ? s.kind : null
  const text = String(s.text || '')
  if (!kind || !text.trim()) throw new Error('Give the diagram as Mermaid, draw.io or Excalidraw')
  if (text.length > 2_000_000) throw new Error('That diagram is too big to hand over this way')
  if (kind === 'excalidraw') {
    let j
    try { j = JSON.parse(text) } catch { throw new Error('That isn\'t an Excalidraw file (not JSON)') }
    if (!Array.isArray(j?.elements)) throw new Error('That isn\'t an Excalidraw file (no elements)')
    return { kind, data: j }
  }
  return { kind, text }
}

// ---------- The boards ----------
export async function list() {
  await fsp.mkdir(folder(), { recursive: true })
  const names = (await fsp.readdir(folder())).filter((f) => f.endsWith(EXT) && !f.startsWith('.'))
  const out = await Promise.all(names.map(async (f) => {
    const st = await fsp.stat(path.join(folder(), f)).catch(() => null)
    if (!st?.isFile()) return null
    const id = f.slice(0, -EXT.length)
    const pv = await fsp.stat(path.join(previews(), `${id}.png`)).catch(() => null)
    return { id, title: id, mtime: st.mtimeMs, size: st.size, preview: pv ? pv.mtimeMs : null }
  }))
  return { folder: folder(), canOpen: await canOpenFolder(), boards: out.filter(Boolean).sort((a, b) => b.mtime - a.mtime) }
}

async function readBoard(id) {
  const file = fileOf(id)
  const st = await fsp.stat(file).catch(() => null)
  if (!st) throw Object.assign(new Error('No such whiteboard'), { status: 404 })
  let data
  try { data = JSON.parse(await fsp.readFile(file, 'utf8')) } catch { data = null }
  if (!data || !Array.isArray(data.elements)) throw new Error(`${id}${EXT} isn't a drawing Bridge AI can open`)
  return { id, title: id, mtime: st.mtimeMs, data }
}
export const read = readBoard
export async function stat(id) {
  const st = await fsp.stat(fileOf(id)).catch(() => null)
  if (!st) throw Object.assign(new Error('No such whiteboard'), { status: 404 })
  return { id, mtime: st.mtimeMs }
}

// A new name, not taken yet: "Name", "Name 2", "Name 3"...
async function freeTitle(title) {
  const base = cleanTitle(title)
  for (let n = 1; ; n++) {
    const t = n === 1 ? base : `${base.slice(0, 75)} ${n}`
    if (!(await exists(fileOf(t)))) return t
  }
}

export async function create({ title, source } = {}) {
  const src = sourceOf(source)
  const id = await freeTitle(title || 'Untitled')
  const data = src?.kind === 'excalidraw' ? src.data : empty(src ? { bridge: { pending: { kind: src.kind, text: src.text, at: new Date().toISOString() } } } : {})
  await writeWhole(fileOf(id), JSON.stringify(data))
  return stat(id)
}

// Saved from the page: the whole file, and the small picture the list shows. mtime is what the page
// loaded or last saved; a different one on disk means something else (an agent, the chief of staff,
// another window) wrote it since, and the page asks before overwriting (force).
export async function save(id, { text, mtime, force = false, preview } = {}) {
  const file = fileOf(id)
  if (typeof text !== 'string') throw new Error('Expected the drawing')
  if (Buffer.byteLength(text) > MAX_BOARD) throw new Error('This whiteboard is too big to save (40 MB at most): take a picture or two out')
  let j
  try { j = JSON.parse(text) } catch { throw new Error('Expected the drawing as JSON') }
  if (!Array.isArray(j?.elements)) throw new Error('Expected the drawing\'s elements')
  const st = await fsp.stat(file).catch(() => null)
  if (!st) throw Object.assign(new Error('No such whiteboard'), { status: 404 })
  if (!force && mtime != null && Math.abs(st.mtimeMs - Number(mtime)) > 1) throw Object.assign(new Error('This whiteboard was changed somewhere else since you opened it'), { status: 409, conflict: true })
  await writeWhole(file, text)
  if (typeof preview === 'string' && /^data:image\/png;base64,/.test(preview) && preview.length < 3_000_000) {
    await writeWhole(path.join(previews(), `${id}.png`), Buffer.from(preview.split(',')[1], 'base64')).catch(() => {})
  }
  return stat(id)
}

export async function rename(id, title) {
  const from = fileOf(id)
  if (!(await exists(from))) throw Object.assign(new Error('No such whiteboard'), { status: 404 })
  if (cleanTitle(title) === id) return stat(id)
  const to = await freeTitle(title)
  await fsp.rename(from, fileOf(to))
  await fsp.rename(path.join(previews(), `${id}.png`), path.join(previews(), `${to}.png`)).catch(() => {})
  return stat(to)
}

// Out of the list, into .trash in the same folder (with the time, so two of the same name both
// stay), where it can be found again.
export async function remove(id) {
  const from = fileOf(id)
  if (!(await exists(from))) throw Object.assign(new Error('No such whiteboard'), { status: 404 })
  await fsp.mkdir(trash(), { recursive: true })
  await fsp.rename(from, path.join(trash(), `${id} ${new Date().toISOString().replace(/[:.]/g, '-')}${EXT}`))
  await fsp.rm(path.join(previews(), `${id}.png`), { force: true })
  return { ok: true }
}

// An agent or the chief of staff hands over a new version (replace) or more to add beside what's
// there (add). It waits as pending until the page opens the board; one opened now picks it up.
export async function update(id, { source, mode = 'replace' } = {}) {
  const src = sourceOf(source)
  if (!src) throw new Error('Give the diagram as Mermaid, draw.io or Excalidraw')
  const b = await readBoard(id)
  const data = src.kind === 'excalidraw' && mode === 'replace' ? src.data
    : { ...b.data, bridge: { ...(b.data.bridge || {}), pending: { kind: src.kind, mode: mode === 'add' ? 'add' : 'replace', at: new Date().toISOString(), ...(src.kind === 'excalidraw' ? { elements: src.data.elements, files: src.data.files || {} } : { text: src.text }) } } }
  await writeWhole(fileOf(id), JSON.stringify(data))
  return stat(id)
}

export async function previewFile(id) {
  fileOf(id)
  const p = path.join(previews(), `${id}.png`)
  if (!(await exists(p))) throw Object.assign(new Error('No picture yet'), { status: 404 })
  return p
}

// The folder opens in Finder, Explorer or the desktop's file manager: not in a container, or on
// Linux with no desktop to show it on.
export async function canOpenFolder() {
  const m = await machine()
  if (m.docker) return false
  return m.platform !== 'linux' || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
}

export async function openFolder() {
  if (!(await canOpenFolder())) throw new Error('There\'s no desktop here to show the folder on')
  await fsp.mkdir(folder(), { recursive: true })
  const bin = IS_MAC ? 'open' : IS_WIN ? 'explorer.exe' : 'xdg-open'
  if (process.env.BRIDGE_FIX_DRYRUN) return { ok: true, dry: [bin, folder()] }
  return new Promise((resolve) => { execFile(bin, [folder()], { timeout: 10000 }, () => resolve({ ok: true })) })
}

// ---------- What's on a board, in words ----------
// For the chief of staff (bin/bridge board show) and for "Change it": each shape with its words,
// each arrow with what it joins, and the words on their own.
const SHAPES = new Set(['rectangle', 'ellipse', 'diamond', 'frame', 'image', 'embeddable', 'iframe'])
function describe(elements = []) {
  const live = elements.filter((e) => e && !e.isDeleted)
  const byId = new Map(live.map((e) => [e.id, e]))
  const textOf = (e) => {
    const t = (e.boundElements || []).map((b) => byId.get(b.id)).find((x) => x?.type === 'text')
    return String(t?.originalText ?? t?.text ?? e.name ?? '').trim()
  }
  const pick = live
  const shapes = pick.filter((e) => SHAPES.has(e.type)).map((e) => ({
    id: e.id, shape: e.type, text: textOf(e), x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height),
    ...(e.backgroundColor && e.backgroundColor !== 'transparent' ? { fill: e.backgroundColor } : {}),
    ...(e.strokeColor && e.strokeColor !== '#1e1e1e' ? { stroke: e.strokeColor } : {}),
  }))
  const arrows = pick.filter((e) => e.type === 'arrow' || e.type === 'line').map((e) => ({
    id: e.id, from: e.startBinding?.elementId || null, to: e.endBinding?.elementId || null, text: textOf(e),
  }))
  const texts = pick.filter((e) => e.type === 'text' && !e.containerId).map((e) => ({ id: e.id, text: String(e.originalText ?? e.text ?? '').trim(), x: Math.round(e.x), y: Math.round(e.y) }))
  return { shapes, arrows, texts, drawings: pick.filter((e) => e.type === 'freedraw').length }
}
export function sayBoard(b) {
  const d = describe(b.data.elements)
  const name = new Map(d.shapes.map((s) => [s.id, s.text || `(${s.shape})`]))
  const lines = [`${b.title} · ${d.shapes.length} shape${d.shapes.length === 1 ? '' : 's'}, ${d.arrows.length} arrow${d.arrows.length === 1 ? '' : 's'}`]
  if (b.data.bridge?.pending) lines.push(`(A ${b.data.bridge.pending.kind} diagram is waiting to be drawn: it's turned into shapes the next time the board is opened in Bridge AI.)`)
  for (const s of d.shapes) lines.push(`- ${s.shape} ${s.id}: ${s.text || '(no words)'}`)
  for (const a of d.arrows) lines.push(`- arrow ${a.id}: ${name.get(a.from) || '(loose)'} -> ${name.get(a.to) || '(loose)'}${a.text ? ` "${a.text}"` : ''}`)
  for (const t of d.texts) lines.push(`- text ${t.id}: ${t.text}`)
  if (d.drawings) lines.push(`- ${d.drawings} hand drawn stroke${d.drawings === 1 ? '' : 's'}`)
  return lines.join('\n')
}

// ---------- Drawing with a model ----------
// index.js hands over the model call (chatmodels.reply), the model meeting notes use when none is
// picked, the models there are, and an agent's conversation (setHelpers).
let helpers = { reply: null, pickModel: null, models: null, agentWork: null }
export const setHelpers = (h) => { helpers = { ...helpers, ...h } }

export async function models() {
  const all = (await helpers.models?.().catch(() => [])) || []
  return { models: all, pick: (await helpers.pickModel?.().catch(() => null)) || null }
}

const KIND_ASK = {
  auto: 'Pick the kind of diagram that fits best.',
  flowchart: 'Make it a flowchart (flowchart TD, or LR when the steps read better across).',
  architecture: 'Make it an architecture diagram: a flowchart LR with a subgraph for each part of the system (people and clients, services, data stores, outside services), and arrows labelled with what goes between them.',
  sequence: 'Make it a sequence diagram (sequenceDiagram): who sends what to whom, in order.',
  org: 'Make it an org chart: flowchart TD, one box per person or team, "Name, role" when there is a role, managers above the people they lead.',
  mindmap: 'Make it a mind map as a flowchart LR: the main idea in the middle, its branches around it.',
}
const RULES = [
  'Answer with one Mermaid diagram in a ```mermaid block and nothing else.',
  'Use only flowchart (or graph), sequenceDiagram or classDiagram: they become shapes that can be moved and edited. No other kind of diagram.',
  'Short labels, a few words each. Put a label in double quotes when it has punctuation. At most about 30 boxes.',
  'No styling, colours, classDef, click, links, icons or HTML in labels.',
].join('\n')

const clip = (s, n) => { s = String(s || ''); return s.length > n ? `${s.slice(0, n)}\n(…cut)` : s }

// What the diagram is drawn from, besides your words. Each says what it is, for the prompt.
async function context(from = {}) {
  if (from.meeting) {
    const m = meetings.get(String(from.meeting))
    const body = m.summary?.trim() ? `Its notes:\n${clip(m.summary, 20_000)}` : `What was said:\n${clip(meetings.transcriptText(m.id), 30_000)}`
    return { label: `the meeting "${m.title}"`, text: `The meeting "${m.title}" (${new Date(m.startedAt).toDateString()}).${m.notes?.trim() ? `\nThe user's own notes:\n${clip(m.notes, 6000)}` : ''}\n${body}` }
  }
  if (from.agent) {
    const t = await helpers.agentWork(String(from.agent))
    const said = (t?.messages || []).filter((x) => x.text && (x.role === 'user' || x.role === 'assistant')).slice(-40)
      .map((x) => `${x.role === 'user' ? 'User' : 'Agent'}: ${clip(x.text, 3000)}`).join('\n\n')
    if (!said) throw new Error('That agent hasn\'t said anything yet to draw from')
    return { label: 'the agent\'s work', text: `An agent's conversation, latest last:\n${clip(said, 40_000)}` }
  }
  if (from.project) {
    const dir = path.resolve(String(from.project))
    const known = (await projects.list().catch(() => [])).some((p) => path.resolve(p.path) === dir)
    if (!known) throw new Error('Pick one of your projects')
    // Only a project Bridge AI may look in already (one you picked or worked in), so this never
    // brings up macOS's question about a protected folder.
    if (!projects.mayLook(dir)) throw new Error('Bridge AI hasn\'t looked in that project yet: open it once with an agent, then draw from it')
    // git goes into the folder itself (-C), as in files.js, and only once it can run without
    // macOS offering its developer tools.
    const files = !(await gitReady()) ? null : await new Promise((resolve) => execFile('git', ['-C', dir, 'ls-files'], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? null : String(out).split('\n').filter(Boolean))))
    const list = files || (await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    const readme = await Promise.any(['README.md', 'readme.md', 'README', 'README.txt'].map((n) => fsp.readFile(path.join(dir, n), 'utf8'))).catch(() => '')
    const name = path.basename(dir)
    return { label: `the project ${name}`, text: `The project ${name}. Its files (${list.length}${list.length > 600 ? ', the first 600' : ''}):\n${list.slice(0, 600).join('\n')}${readme ? `\n\nIts README:\n${clip(readme, 12_000)}` : ''}` }
  }
  return null
}

async function ask(model, prompt, system) {
  const use = model || await helpers.pickModel?.()
  if (!use) throw Object.assign(new Error('No model to draw with yet: sign in to an agent (Claude Code, Codex…) or add a key in Settings › Model Providers'), { code: 'noModel' })
  const r = await helpers.reply(use, [{ role: 'user', text: prompt }], { system })
  return { text: String(r?.text || '').trim(), model: use }
}

// The Mermaid in a model's answer: a ```mermaid block, else the first fenced block, else the answer
// itself when it starts like a diagram.
export function mermaidIn(text) {
  const s = String(text || '')
  const block = /```\s*mermaid[^\n]*\n([\s\S]*?)```/i.exec(s) || /```[^\n]*\n([\s\S]*?)```/.exec(s)
  const m = (block ? block[1] : s).trim()
  return /^(%%[^\n]*\n\s*)*(flowchart|graph|sequenceDiagram|classDiagram)\b/.test(m) ? m : null
}

// "Draw this": Mermaid for the page to turn into shapes. again: the Mermaid that didn't draw last
// time and why, so the model can fix it.
export async function draw({ prompt, kind = 'auto', from, model, again } = {}) {
  const words = String(prompt || '').trim()
  const ctx = await context(from || {})
  if (!words && !ctx) throw new Error('Say what to draw')
  const parts = [
    `Draw this as a diagram: ${words || `the main points of ${ctx.label}`}`,
    KIND_ASK[kind] || KIND_ASK.auto,
    ctx ? `\nDraw it from ${ctx.label}:\n${ctx.text}` : '',
    again?.mermaid ? `\nYour last answer didn't draw:\n\`\`\`mermaid\n${clip(again.mermaid, 20_000)}\n\`\`\`\nThe error was: ${clip(again.error, 500)}\nFix it.` : '',
    `\n${RULES}`,
  ]
  const r = await ask(model, parts.filter(Boolean).join('\n'), 'You draw clear diagrams as Mermaid, for a whiteboard where each box and arrow can then be moved and edited.')
  const mermaid = mermaidIn(r.text)
  if (!mermaid) throw new Error('The model didn\'t send back a diagram. Try again, or say it another way.')
  return { mermaid, model: r.model, title: titleFor(words || ctx?.label || '') }
}
export const titleFor = (s) => cleanTitle(String(s).replace(/^(draw|make|show|create)\s+(me\s+)?(a|an|the)?\s*/i, '').split(/\s+/).slice(0, 7).join(' ').replace(/[.,;:!?]+$/, '').replace(/^./, (c) => c.toUpperCase()))

// The JSON object in a model's answer.
function jsonIn(text) {
  const s = String(text || '')
  const block = /```(?:json)?\s*\n([\s\S]*?)```/.exec(s)
  const raw = block ? block[1] : s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)
  try { return JSON.parse(raw) } catch { return null }
}

// "Change it": what to change on the board (or the part of it selected), as steps the page carries
// out on the shapes already there, so the rest of the drawing stays where you put it.
export async function change({ prompt, scene, model, selected = false } = {}) {
  const words = String(prompt || '').trim()
  if (!words) throw new Error('Say what to change')
  const s = { shapes: (scene?.shapes || []).slice(0, 300), arrows: (scene?.arrows || []).slice(0, 400), texts: (scene?.texts || []).slice(0, 200) }
  const prompt2 = [
    `Change this diagram: ${words}`,
    '',
    `The diagram${selected ? ' (only the part selected; leave the rest alone)' : ''}, as JSON:`,
    JSON.stringify(s),
    '',
    'Answer with JSON only, in this shape, leaving out what you don\'t need:',
    '{"update":[{"id":"<id>","text":"new words","fill":"#hex","stroke":"#hex"}],',
    ' "add":[{"ref":"n1","shape":"rectangle|ellipse|diamond","text":"words","near":"<id or ref>","side":"right|left|above|below","fill":"#hex"}],',
    ' "connect":[{"from":"<id or ref>","to":"<id or ref>","text":"words"}],',
    ' "remove":["<id>"]}',
    'Use the ids above for what is there and your own refs (n1, n2…) for new shapes. Keep the words short. Colours as #rrggbb, light fills.',
  ].join('\n')
  const r = await ask(model, prompt2, 'You edit diagrams on a whiteboard by listing the changes to make, as JSON.')
  const ops = jsonIn(r.text)
  if (!ops || typeof ops !== 'object') throw new Error('The model didn\'t send back changes. Try again, or say it another way.')
  const arr = (x) => (Array.isArray(x) ? x : [])
  return { ops: { update: arr(ops.update), add: arr(ops.add), connect: arr(ops.connect), remove: arr(ops.remove).map(String) }, model: r.model }
}

// ---------- Routes ----------
// wrap: index.js's (JSON back, an error's words with a 502). onComputer: turns down what only makes
// sense on the computer itself (opening its folder) when it comes through the relay.
export function routes(app, { wrap, onComputer }) {
  const fail = (res, e) => res.status(e.status || 502).json({ error: e.message, ...(e.conflict ? { conflict: true } : {}), ...(typeof e.code === 'string' ? { code: e.code } : {}) })
  const route = (fn) => async (req, res) => { try { res.json(await fn(req, res)) } catch (e) { fail(res, e) } }
  app.get('/api/boards', wrap(() => list()))
  app.post('/api/boards', route((req) => create(req.body || {})))
  app.get('/api/boards/models', wrap(() => models()))
  app.post('/api/boards/draw', route((req) => draw(req.body || {})))
  app.post('/api/boards/change', route((req) => change(req.body || {})))
  app.post('/api/boards/folder', wrap((req) => { onComputer(req); return openFolder() }))
  app.get('/api/boards/:id', route((req) => read(req.params.id)))
  app.get('/api/boards/:id/stat', route((req) => stat(req.params.id)))
  app.get('/api/boards/:id/text', route(async (req) => ({ text: sayBoard(await read(req.params.id)) })))
  // dotfiles: the boards live in a dot folder (~/.bridge-ai), which sendFile otherwise won't serve from.
  app.get('/api/boards/:id/preview', async (req, res) => { try { res.set('Cache-Control', 'no-cache'); res.sendFile(await previewFile(req.params.id), { dotfiles: 'allow' }) } catch (e) { fail(res, e) } })
  app.put('/api/boards/:id', route((req) => save(req.params.id, req.body || {})))
  app.post('/api/boards/:id/update', route((req) => update(req.params.id, req.body || {})))
  app.patch('/api/boards/:id', route((req) => rename(req.params.id, req.body?.title)))
  app.delete('/api/boards/:id', route((req) => remove(req.params.id)))
}
