// Whiteboards: boards kept as .excalidraw files in the data folder, drawn with Excalidraw, and
// diagrams made and changed by a model (the stand-in, stand-ins/model.mjs).
//   The server: a board made, saved (a save from a stale copy turned down until forced), renamed,
//   deleted into .trash, a name that would reach outside the folder refused, one Windows keeps for
//   a device marked; the boards folder shown on a desktop but not in Docker (simulated); the chief
//   of staff's `bridge board` making one from Mermaid, reading it back and updating it; "Draw this"
//   from a meeting and a project (what goes to the model), and a project that isn't one of yours
//   refused.
//   The app, in Chromium or WebKit: Whiteboards in the sidebar and ⌘K; Excalidraw loaded only when
//   a board opens; a shape drawn by hand saved to its file and there when opened again; a board the
//   chief made drawn into shapes when opened, and a new version from it drawn in while it's open;
//   Mermaid's own arrow ends kept (a line has none), an arrow back between two shapes drawn apart
//   from the first, a sequence diagram's messages in order down the page; words handed over
//   measured in another font measured again in the board's; "Draw this" from the list and on a
//   board (boxes, arrows joined to them and words you can edit, not a picture; Mermaid that
//   doesn't draw sent back once); "Change it" in place, and undone; what a model draws or changes
//   a suggestion (marked in the file, dashed, outlined with who made it, still there opened again),
//   discarded from AI Assist's panel or the board, kept with the bar's Keep; PNG and SVG export; ⌘K over
//   the board opening Bridge AI's search; a dark theme. Diagram files in an agent's Files tab:
//   .excalidraw drawn and saved back into the file, .mmd and .drawio (plain and compressed) drawn
//   as shapes, saved beside or added to Whiteboards; a Mermaid block in Markdown and in the
//   agent's chat opening as a board. On a phone: the list and a board fit, with Excalidraw's phone
//   tools. Nothing the page loads comes from anywhere but this computer (Excalidraw's fonts
//   included).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { startKit, startModel, checks, until, sleep, browser, page, shot, noServiceWorker, ROOT, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('whiteboard')
// AI Assist, at the right end of a board's header (or a diagram file's bar), and one of its verbs:
// Draw this or Change it.
const assist = async (pg, verb = 'Draw this', bar = '.wb-view .pane-extras') => {
  await pg.locator(`${bar} button[aria-label="AI Assist"]`).click()
  await pg.locator('.ai-menu button', { hasText: verb }).click()
}

// The built app passes the check the release runs before packaging it: Excalidraw's own service
// settings (excalidraw.com, its Firebase key) are left out of the build, source maps too.
{
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-private.js'), '--dir', path.join(ROOT, 'dist')], { encoding: 'utf8' })
  const leftIn = fs.readdirSync(path.join(ROOT, 'dist', 'assets'), { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name).filter((f) => /AIza[0-9A-Za-z_-]{30,}|oss-collab\.excalidraw\.com|json\.excalidraw\.com/.test(fs.readFileSync(path.join(ROOT, 'dist', 'assets', f), 'utf8')))
  ok(r.status === 0 && leftIn.length === 0, 'the built app has nothing personal or third-party in it: no Excalidraw service key or address, in the code or its source maps', `${r.stdout}${r.stderr}${leftIn.join(', ')}`)
}
const kit = await startKit('whiteboard')
const model = await startModel('whiteboard')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const BOARDS = path.join(kit.data, 'boards')
const file = (name) => path.join(BOARDS, `${name}.excalidraw`)
const readBoard = (name) => { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')) } catch { return null } }
const live = (j) => (j?.elements || []).filter((e) => !e.isDeleted)
const texts = (j) => live(j).filter((e) => e.type === 'text').map((e) => e.originalText ?? e.text)
const chief = (args, input) => spawnSync(process.execPath, [path.join(ROOT, 'chief', 'bin', 'bridge'), 'board', ...args], { input, encoding: 'utf8', env: { ...process.env, BRIDGE_URL: kit.url, BRIDGE_HOME: kit.data } })
const enc = encodeURIComponent

// A project with an agent's diagrams in it.
const proj = path.join(kit.home, 'shop')
fs.mkdirSync(path.join(proj, 'docs'), { recursive: true })
fs.writeFileSync(path.join(proj, 'README.md'), '# Shop\nA web shop: a cart, payments and orders.\n')
fs.writeFileSync(path.join(proj, 'flow.mmd'), 'flowchart LR\n  Cart --> Pay[Payment] --> Done\n')
const rect = (id, x, extra = {}) => ({ id, type: 'rectangle', x, y: 100, width: 200, height: 100, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...extra })
fs.writeFileSync(path.join(proj, 'design.excalidraw'), JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements: [rect('r1', 100)], appState: { viewBackgroundColor: '#ffffff' }, files: {} }))
const drawio = (pages) => `<mxfile host="test">${pages.join('')}</mxfile>`
const graph = (cells) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`
const page1 = graph('<mxCell id="a" value="Web app" style="rounded=1;fillColor=#dae8fc;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>'
  + '<mxCell id="b" value="&lt;b&gt;API&lt;/b&gt;" style="ellipse;html=1;" vertex="1" parent="1"><mxGeometry x="260" y="40" width="120" height="60" as="geometry"/></mxCell>'
  + '<mxCell id="c" value="Database" style="rhombus;" vertex="1" parent="1"><mxGeometry x="480" y="40" width="120" height="80" as="geometry"/></mxCell>'
  + '<mxCell id="e1" value="calls" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>'
  + '<mxCell id="e2" edge="1" parent="1" source="b" target="c"><mxGeometry relative="1" as="geometry"/></mxCell>')
const page2 = graph('<mxCell id="q" value="Queue" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="50" as="geometry"/></mxCell>')
fs.writeFileSync(path.join(proj, 'docs', 'system.drawio'), drawio([`<diagram name="Services">${page1}</diagram>`, `<diagram name="Jobs">${zlib.deflateRawSync(Buffer.from(encodeURIComponent(page2))).toString('base64')}</diagram>`]))
fs.writeFileSync(path.join(proj, 'docs', 'notes.md'), '# Notes\n\nHow an order moves:\n\n```mermaid\nflowchart TD\n  Placed --> Packed --> Shipped\n```\n')

try {
  await api('/setup', { name: 'Tester' })
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/projects', { path: proj })

  // ---------- The server ----------
  const made = await api('/boards', { title: 'Plan: Q3/Q4' })
  ok(made.id === 'Plan Q3 Q4' && fs.existsSync(file('Plan Q3 Q4')), 'a new board is a file named as it is, without the characters a file name can\'t have', made)
  const got = await api(`/boards/${enc(made.id)}`)
  ok(Array.isArray(got.data.elements) && got.data.type === 'excalidraw', 'it\'s an Excalidraw file', got.data)
  const stale = await fetch(`${kit.url}/api/boards/${enc(made.id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: JSON.stringify({ type: 'excalidraw', elements: [rect('x', 0)] }), mtime: got.mtime - 5000 }) })
  ok(stale.status === 409, 'a save from a copy older than the file is turned down', stale.status)
  const forced = await api(`/boards/${enc(made.id)}`, { text: JSON.stringify({ type: 'excalidraw', elements: [rect('x', 0)] }), mtime: got.mtime - 5000, force: true }, 'PUT')
  ok(live(readBoard(made.id)).length === 1 && forced.mtime, 'and saved when forced', readBoard(made.id))
  const outside = await fetch(`${kit.url}/api/boards/${enc('../config')}`)
  ok(outside.status === 404 && !(await outside.text()).includes('setupDone'), 'a name that would reach outside the boards folder is refused', outside.status)
  const renamed = await api(`/boards/${enc(made.id)}`, { title: 'Roadmap' }, 'PATCH')
  ok(renamed.id === 'Roadmap' && fs.existsSync(file('Roadmap')) && !fs.existsSync(file(made.id)), 'renaming renames the file', renamed)
  await api('/boards/Roadmap', null, 'DELETE')
  ok(!fs.existsSync(file('Roadmap')) && fs.readdirSync(path.join(BOARDS, '.trash')).some((f) => f.startsWith('Roadmap ')), 'deleting moves it to .trash beside the boards', fs.readdirSync(BOARDS))

  ok((await api('/boards')).canOpen === (process.platform !== 'linux' || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)), 'the boards folder can be shown on a desktop', await api('/boards'))
  if ((await api('/boards')).canOpen) ok((await api('/boards/folder', {})).dry, 'and Show the boards folder opens it (dry run in tests)')
  const con = await api('/boards', { title: 'con' })
  ok(con.id === 'con_', 'a name Windows keeps for a device gets a mark after it', con)
  await api('/boards/con_', null, 'DELETE')

  // The chief of staff's tool.
  const cn = chief(['new', 'Checkout', '-'], 'flowchart LR\n  Cart --> Pay[Payment] --> Done\n')
  ok(cn.status === 0 && /Made the whiteboard "Checkout" from Mermaid/.test(cn.stdout), '`bridge board new` makes a board from Mermaid on stdin', cn.stdout + cn.stderr)
  ok(readBoard('Checkout')?.bridge?.pending?.kind === 'mermaid', 'which waits to be drawn into shapes', readBoard('Checkout'))
  const cl = chief(['list'])
  ok(cl.status === 0 && /Checkout/.test(cl.stdout), '`bridge board list` lists it', cl.stdout + cl.stderr)

  // "Draw this" from a meeting and a project: what the model is sent.
  const m = await api('/meetings', { title: 'Payments sync', call: false })
  await api(`/meetings/${m.id}/stop`, {})
  fs.appendFileSync(path.join(kit.data, 'meetings', m.id, 'transcript.jsonl'), `${JSON.stringify({ src: 'them', t0: 1, t1: 3, text: 'Refunds go through the ledger first.', engine: 'test' })}\n`)
  const dm = await api('/boards/draw', { prompt: 'the refund flow', from: { meeting: m.id } })
  ok(/^flowchart TD/.test(dm.mermaid) && dm.model === 'openai:gpt-5', '"Draw this" answers with Mermaid, from the model meeting notes use', dm)
  ok(model.asked(/the refund flow/).some((q) => /Payments sync/.test(q) && /Refunds go through the ledger first/.test(q)), 'the meeting goes with it', model.asked(/refund/))
  await api('/boards/draw', { prompt: 'its parts', kind: 'architecture', from: { project: proj } })
  ok(model.asked(/its parts/).some((q) => /The project shop/.test(q) && /A web shop: a cart/.test(q) && /architecture diagram/.test(q)), 'a project goes as its files and README, and the kind asked for is said', model.asked(/its parts/))
  const notMine = await fetch(`${kit.url}/api/boards/draw`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'x', from: { project: kit.data } }) })
  ok(notMine.status === 502 && /Pick one of your projects/.test((await notMine.json()).error), 'a folder that isn\'t one of your projects isn\'t read', notMine.status)

  // ---------- The app ----------
  const elsewhere = []
  const fonts = []
  const host = new URL(kit.url).host
  const watch = (ctx) => ctx.on('request', (r) => {
    const u = new URL(r.url())
    if (/^(data|blob):/.test(r.url())) return
    if (u.host !== host) elsewhere.push(r.url())
  })
  // Excalidraw's fonts, served by Bridge AI as fonts (a request for one that isn't there gets the
  // page, and Excalidraw goes on to esm.sh).
  const fontsServed = (ctx) => ctx.on('response', (r) => {
    const u = new URL(r.url())
    if (u.host === host && /\/assets\/excalidraw\/fonts\//.test(u.pathname) && r.ok() && /font|octet/.test(r.headers()['content-type'] || '')) fonts.push(u.pathname)
  })
  // Excalidraw's code, wherever the bundler put it: the files that hold its canvas's class name,
  // watched from before the page opens.
  const loaded = []
  const code = (ctx) => ctx.on('response', async (r) => {
    if (!/\.js$/.test(new URL(r.url()).pathname)) return
    const body = await r.text().catch(() => '')
    if (body.includes('excalidraw__canvas')) loaded.push(r.url())
  })
  const { ctx, p, errors } = await page(b, kit.url, { before: async (c) => { watch(c); fontsServed(c); code(c) } })
  await p.waitForSelector('.rail-nav', { timeout: 30000 })
  await sleep(3500) // the views that load once the app is idle
  ok(!loaded.length, 'Excalidraw isn\'t loaded when the app opens, or when it\'s idle', loaded)
  await p.locator('.rail-nav-btn', { hasText: 'Whiteboards' }).click()
  await p.waitForSelector('.wb-home', { timeout: 20000 })
  ok(await until(() => p.locator('.wb-card', { hasText: 'Checkout' }).count(), 10000), 'Whiteboards in the sidebar lists the boards', await p.locator('.wb-home').innerText())
  await shot(p, `${tag}whiteboard-list`)
  await p.keyboard.press('ControlOrMeta+k')
  await p.keyboard.type('whiteboard')
  ok(await until(() => p.locator('.palette .pal-item', { hasText: 'Whiteboards' }).count(), 5000), '⌘K finds Whiteboards')
  await p.keyboard.press('Escape')

  // A board the chief made, drawn into shapes when it opens, and saved that way.
  await p.locator('.wb-card', { hasText: 'Checkout' }).click()
  await p.waitForSelector('.excalidraw canvas', { timeout: 30000 })
  ok(loaded.length > 0, 'Excalidraw loads when a board opens', loaded)
  const drawn = await until(() => { const j = readBoard('Checkout'); return !j?.bridge && texts(j).includes('Payment') && j }, 15000)
  ok(!!drawn && live(drawn).some((e) => e.type === 'arrow' && e.startBinding && e.endBinding), 'the Mermaid it was given is drawn as boxes and joined arrows, and saved', readBoard('Checkout'))
  const shown = chief(['show', 'Checkout'])
  ok(shown.status === 0 && /Checkout · 3 shapes, 2 arrows/.test(shown.stdout) && /Cart -> Payment/.test(shown.stdout), '`bridge board show` reads it back as words', shown.stdout + shown.stderr)
  // A new version from the chief while the board is open: drawn in straight away (undo would take it back).
  const cu = chief(['update', 'Checkout', '-'], 'flowchart LR\n  Cart --> Ship[Shipping]\n')
  ok(cu.status === 0, '`bridge board update` hands over a new version', cu.stdout + cu.stderr)
  ok(await until(() => { const j = readBoard('Checkout'); return !j?.bridge && texts(j).includes('Shipping') && !texts(j).includes('Payment') }, 15000), 'which the open board draws in place of the old one, and saves', readBoard('Checkout') && texts(readBoard('Checkout')))

  // Mermaid's own ends kept (a line, no arrowheads), an arrow back drawn apart from the first
  // rather than on top of it (its words too), and a sequence diagram's messages in order down the
  // page.
  const drawnAs = async (title, source, word) => {
    const { id } = await api('/boards', { title, source: { kind: 'mermaid', text: source } })
    await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-board', { detail: { id } })), id)
    return until(() => { const j = readBoard(id); return !j?.bridge && texts(j).includes(word) && j }, 20000)
  }
  // Comments and @bridge off (as it starts): a board has no Comments, and @bridge's route isn't there.
  const commentOff = await api('/boards/comment', { request: 'add a cache', scene: {} }).catch((e) => e)
  ok(commentOff?.status === 404 && commentOff.j?.trial === 'comments' && (await p.locator('.wb-view .pane-extras button[aria-label="Comments"]').count()) === 0, 'with Comments and @bridge off, a board has no Comments, and its @bridge route isn\'t there', commentOff?.message)
  const word = (j, w) => live(j).find((e) => e.type === 'text' && (e.originalText ?? e.text) === w)
  const holding = (j, w) => { const t = word(j, w); return t && live(j).find((e) => e.id === t.containerId) }
  const end = (a, i) => { const q = a.points.at(i); return { x: a.x + q[0], y: a.y + q[1] } }
  const far = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) > 20
  const across = (p, q) => !!p && !!q && p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height
  const loop = await drawnAs('Review loop', 'flowchart TD\n  A[Draft] -->|submit| B[Review]\n  B -->|changes asked| A\n  B --- C[Notes]', 'Notes')
  if (loop) {
    const [A, B, C] = ['Draft', 'Review', 'Notes'].map((w) => holding(loop, w))
    const arrows = live(loop).filter((e) => e.type === 'arrow')
    const joining = (s, t) => arrows.find((e) => e.startBinding?.elementId === s?.id && e.endBinding?.elementId === t?.id)
    const there = joining(A, B), back = joining(B, A), line = joining(B, C)
    ok(!!line && !line.startArrowhead && !line.endArrowhead && !!there?.endArrowhead, 'a Mermaid line (---) comes in without arrowheads, its arrows with them', arrows.map((e) => [e.startArrowhead, e.endArrowhead]))
    const said = [word(loop, 'submit'), word(loop, 'changes asked')]
    ok(!!there && !!back && far(end(there, 0), end(back, -1)) && far(end(there, -1), end(back, 0)) && !across(...said), 'an arrow back between the same two shapes is drawn apart from the first, its words clear of the first one\'s', { ends: [there, back].map((e) => e && [end(e, 0), end(e, -1)]), words: said.map((t) => t && [t.x, t.y, t.width, t.height]) })
  } else ok(false, 'a Mermaid flowchart with a line and an arrow back is drawn', fs.readdirSync(BOARDS))
  const seq = await drawnAs('Sign in flow', 'sequenceDiagram\n  Web->>API: Sign in\n  API-->>Web: Token\n  Web->>API: Refresh', 'Refresh')
  const rows = ['Sign in', 'Token', 'Refresh'].map((w) => { const a = seq && holding(seq, w); return a ? a.y + Math.min(...a.points.map((q) => q[1])) : NaN })
  ok(rows.every((y, i) => y > (i ? rows[i - 1] + 10 : -Infinity)), 'a sequence diagram\'s messages are drawn in order down the page', rows)
  // Words handed over measured in another font (as a diagram drawn before the board's font has
  // loaded) are measured again once it's open, so they aren't cut off.
  const words = await api('/boards', { title: 'Handed words' })
  const narrow = { ...rect('w1', 0), type: 'text', width: 10, height: 20, text: 'Measured again', originalText: 'Measured again', fontSize: 16, fontFamily: 6, textAlign: 'left', verticalAlign: 'top', containerId: null, autoResize: true, lineHeight: 1.25 }
  await api(`/boards/${enc(words.id)}/update`, { source: { kind: 'excalidraw', text: JSON.stringify({ type: 'excalidraw', elements: [narrow] }) }, mode: 'add' })
  await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-board', { detail: { id } })), words.id)
  const measured = await until(() => { const j = readBoard(words.id); const t = !j?.bridge && word(j, 'Measured again'); return t && t.width > 40 && t }, 15000)
  ok(!!measured, 'words handed over measured in another font are measured again in the board\'s once it opens', word(readBoard(words.id), 'Measured again'))

  // A new board, a shape drawn by hand, saved, and there after a reload.
  await p.locator('.wb-view .pane-head button', { hasText: /^‹?\s*$/ }).first().click().catch(() => {})
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-board', { detail: { list: true } })))
  await p.waitForSelector('.wb-home')
  await p.getByRole('button', { name: 'New whiteboard' }).click()
  await p.waitForSelector('.excalidraw canvas', { timeout: 30000 })
  await until(() => fs.existsSync(file('Untitled')), 5000)
  await p.locator('[data-testid="toolbar-rectangle"]').click({ force: true })
  const box = await p.locator('.wb-canvas').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await p.mouse.move(cx - 60, cy - 40); await p.mouse.down(); await p.mouse.move(cx + 80, cy + 50, { steps: 6 }); await p.mouse.up()
  ok(await until(() => live(readBoard('Untitled')).some((e) => e.type === 'rectangle'), 10000), 'a rectangle drawn by hand is saved to the board\'s file', readBoard('Untitled'))
  ok(await until(async () => (await p.locator('.wb-state').innerText()) === 'Saved', 5000), 'and the board says so')
  // Opened again (a new window, as a reload would be; WebKit reports a reload's cut-off requests as
  // page errors).
  const again = await ctx.newPage()
  const againErrors = []
  again.on('pageerror', (e) => againErrors.push(e.message))
  await again.goto(kit.url)
  await again.waitForSelector('.excalidraw canvas', { timeout: 30000 })
  ok(await until(() => again.locator('.wb-view .pane-titles h2', { hasText: 'Untitled' }).count(), 5000), 'opened again, the board is open again')
  const wand = again.locator('.wb-view .pane-extras button[aria-label="AI Assist"]')
  ok(await wand.evaluate((e) => e.parentElement.lastElementChild === e.nextElementSibling && e.nextElementSibling?.classList.contains('menu-anchor')), 'AI Assist at the right end of the board\'s header, with only More after it')
  await wand.click()
  const verbs = await again.locator('.ai-menu .ai-item-label').allInnerTexts()
  ok(JSON.stringify(verbs) === JSON.stringify(['Draw this', 'Change it', 'Ask about the board', 'Group by theme', 'A timeline', 'Action items']) && await again.locator('.ai-menu button', { hasText: 'Change it' }).isEnabled(), 'a board\'s AI Assist: Draw this, Change it, Ask about the board, and the meeting moves (Group by theme, A timeline, Action items), Change it offered with a shape on the board', verbs)
  await shot(again, `${tag}whiteboard-ai-menu`)
  await again.locator('.ai-menu button', { hasText: 'Change it' }).click()
  ok(await until(() => again.locator('.wb-draw [role="tab"][aria-selected="true"]', { hasText: 'Change it' }).count(), 5000) && /AI Assist/.test(await again.locator('.wb-draw-head').innerText()), 'Change it opens AI Assist\'s panel on Change it')
  ok(await until(() => again.locator('.wb-draw [role="tab"]', { hasText: 'Change it' }).isEnabled(), 5000) && live(readBoard('Untitled')).length === 1, 'with its shape (Change it is offered) and its file as it was', readBoard('Untitled'))
  await shot(again, `${tag}whiteboard-hand`)
  ok(!againErrors.length, 'no page errors opening it again', againErrors)
  await again.close()

  // "Draw this" from the list: a new board named for it, drawn as it opens.
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-board', { detail: { list: true } })))
  await p.waitForSelector('.wb-ask textarea')
  await p.fill('.wb-ask textarea', 'Draw a flowchart of how a release gets shipped')
  await p.locator('.wb-ask').getByRole('button', { name: 'Draw' }).click()
  const board = 'Flowchart of how a release gets shipped'
  await p.waitForSelector('.wb-note', { timeout: 30000 }).catch(() => {})
  const first = await until(() => { const j = readBoard(board); return texts(j).includes('Start') && j }, 15000)
  ok(!!first, '"Draw this" makes a board named for what was asked and draws on it', fs.readdirSync(BOARDS))
  if (first) {
    const els = live(first)
    const kinds = new Set(els.map((e) => e.type))
    ok(kinds.has('rectangle') && kinds.has('diamond') && kinds.has('arrow') && !kinds.has('image'), 'as shapes, not a picture', [...kinds])
    const startBox = els.find((e) => e.type === 'rectangle' && (e.boundElements || []).some((x) => els.find((t) => t.id === x.id)?.text === 'Start'))
    ok(!!startBox && els.some((e) => e.type === 'arrow' && e.startBinding?.elementId === startBox.id), 'with its words inside the boxes and arrows joined to them, to edit and move', els.map((e) => [e.type, e.text, e.containerId]))
    ok(await p.locator('.wb-note').innerText().then((s) => /Drawn by gpt-5/.test(s)).catch(() => false), 'the panel says which model drew it')
  }
  ok((await p.locator('.wb-privacy').innerText()).includes('go to gpt-5 (OpenAI). Nothing else leaves this computer.'), 'and before drawing, where the words go', await p.locator('.wb-privacy').innerText())
  await shot(p, `${tag}whiteboard-drawn`)
  ok(!(await p.locator('.wb-canvas .default-sidebar-trigger').isVisible().catch(() => false)), 'Excalidraw\'s library, which isn\'t kept anywhere yet, isn\'t offered')

  // "Change it" on the whole board, then undone.
  await p.locator('.wb-draw [role="tab"]', { hasText: 'Change it' }).click()
  await p.fill('.wb-draw textarea', 'Rename Start to Begin, colour Ship red, and add a cache')
  await p.locator('.wb-draw').getByRole('button', { name: 'Change', exact: true }).click()
  const changed = await until(() => { const j = readBoard(board); return texts(j).includes('Begin') && j }, 15000)
  ok(!!changed && !texts(changed).includes('Start') && texts(changed).includes('Cache') && texts(changed).includes('Tests pass?'), '"Change it" renames a box and adds one, leaving the rest', changed && texts(changed))
  if (changed) {
    const els = live(changed)
    const cache = els.find((e) => e.type === 'rectangle' && (e.boundElements || []).some((x) => els.find((t) => t.id === x.id)?.text === 'Cache'))
    ok(!!cache && els.some((e) => e.type === 'arrow' && e.endBinding?.elementId === cache.id), 'with an arrow joined to the new box', els.filter((e) => e.type === 'arrow').map((a) => [a.startBinding?.elementId, a.endBinding?.elementId]))
    ok(els.some((e) => e.backgroundColor === '#ffc9c9'), 'and the colour asked for', els.map((e) => e.backgroundColor))
    ok(first && els.filter((e) => e.type !== 'text').every((e) => { const was = live(first).find((x) => x.id === e.id); return !was || (was.x === e.x && was.y === e.y) }), 'what was there stays where it was')
  }
  await shot(p, `${tag}whiteboard-changed`)
  await p.locator('[data-testid="button-undo"]').first().click()
  ok(await until(() => { const j = readBoard(board); return texts(j).includes('Start') && !texts(j).includes('Cache') }, 10000), 'undo takes the change back, and the board saves that', texts(readBoard(board)))
  const before = model.asked().length
  await p.locator('.wb-draw [role="tab"]', { hasText: 'Draw this' }).click()
  await p.fill('.wb-draw textarea', 'a broken one')
  await p.locator('.wb-draw').getByRole('button', { name: 'Draw', exact: true }).click()
  ok(await until(() => texts(readBoard(board)).filter((x) => x === 'Start').length === 2, 15000), 'Mermaid that doesn\'t draw goes back to the model once and the fixed one is drawn', texts(readBoard(board)))
  ok(model.asked().slice(before).some((q) => /didn't draw/.test(q) && /The error was/.test(q)), 'saying why it didn\'t draw', model.asked().slice(before).map((q) => q.slice(0, 200)))

  // What a model draws is a suggestion: marked in the file (so it travels with it), drawn dashed,
  // outlined on the board with the wand and who made it, to keep or discard; Keep all for several.
  const marked = (j) => live(j).filter((e) => e.customData?.bridge?.suggestion)
  const sugIds = (j) => [...new Set(marked(j).map((e) => e.customData.bridge.suggestion.id))]
  const two = readBoard(board)
  ok(sugIds(two).length === 2 && marked(two).every((e) => e.customData.bridge.suggestion.by === 'gpt-5') && marked(two).filter((e) => e.type === 'rectangle' || e.type === 'diamond' || e.type === 'arrow').every((e) => e.strokeStyle === 'dashed'), 'each drawing is a suggestion: marked in the board\'s file with the model that made it, its shapes and arrows dashed', { ids: sugIds(two), styles: marked(two).map((e) => [e.type, e.strokeStyle]).slice(0, 8) })
  ok(await until(async () => (await p.locator('.wb-sug').count()) === 2, 5000), 'the board outlines each', await p.locator('.wb-sugs').innerText().catch(() => ''))
  ok(/Suggested by gpt-5/.test(await p.locator('.wb-sug-tag').first().innerText()) && (await p.locator('.wb-sug-tag').first().locator('button').allInnerTexts()).join('|') === 'Keep|Discard', 'each outline says who made it, with Keep and Discard', await p.locator('.wb-sug-tag').first().innerText())
  ok((await p.locator('.wb-draw .wb-sug-acts button').allInnerTexts()).map((x) => x.trim()).join('|') === 'Keep|Discard|Keep all 2' && !(await p.locator('.wb-sug-bar').count()), 'AI Assist\'s panel keeps or discards the last, or keeps all of them, in place of the board\'s bar it would cover', await p.locator('.wb-draw .wb-sug-acts').innerText().catch(() => ''))
  await shot(p, `${tag}whiteboard-suggestions`)
  // Opened again, they're still suggestions, and the board's bar says how many, with Keep all.
  const re = await ctx.newPage()
  await re.goto(kit.url)
  await re.waitForSelector('.excalidraw canvas', { timeout: 30000 })
  ok(await until(async () => (await re.locator('.wb-sug').count()) === 2 && /2 suggestions from AI Assist/.test(await re.locator('.wb-sug-bar').innerText()) && (await re.locator('.wb-sug-bar button', { hasText: 'Keep all' }).count()) === 1, 10000), 'opened again, the board shows them as suggestions still, and how many, with Keep all', await re.locator('.wb-sugs').innerText().catch(() => ''))
  await shot(re, `${tag}whiteboard-suggestions-bar`)
  await re.close()
  await p.locator('.wb-draw .wb-sug-acts button', { hasText: 'Discard' }).click()
  ok(await until(() => texts(readBoard(board)).filter((x) => x === 'Start').length === 1 && sugIds(readBoard(board)).length === 1, 8000), 'Discard in AI Assist\'s panel takes the last one off the board', texts(readBoard(board)))
  await p.locator('.wb-draw-head button[aria-label="Close AI Assist"]').click()
  await p.locator('.wb-sug-bar button', { hasText: 'Keep' }).click()
  ok(await until(() => { const j = readBoard(board); return !marked(j).length && texts(j).includes('Start') && live(j).filter((e) => e.type === 'rectangle' || e.type === 'diamond').every((e) => e.strokeStyle === 'solid') }, 8000), 'Keep keeps the other: no marks left in the file, its lines solid again', live(readBoard(board)).map((e) => [e.type, e.strokeStyle, !!e.customData?.bridge?.suggestion]).slice(0, 8))
  ok(await until(async () => !(await p.locator('.wb-sug, .wb-sug-bar').count()), 3000), 'and the board has no outlines left')
  // A change: what it renamed or added is suggested; Discard puts the board back as it was.
  await assist(p, 'Change it')
  await p.fill('.wb-draw textarea', 'Rename Start to Begin, colour Ship red, and add a cache')
  await p.locator('.wb-draw').getByRole('button', { name: 'Change', exact: true }).click()
  ok(await until(() => texts(readBoard(board)).includes('Cache') && sugIds(readBoard(board)).length === 1, 15000), 'a change is a suggestion too', texts(readBoard(board)))
  await p.locator('.wb-sug-tag button', { hasText: 'Discard' }).first().click()
  ok(await until(() => { const j = readBoard(board); return texts(j).includes('Start') && !texts(j).includes('Begin') && !texts(j).includes('Cache') && !live(j).some((e) => e.backgroundColor === '#ffc9c9') && !marked(j).length }, 8000), 'discarded on the board: its old words, colour and shapes back, nothing of it left', texts(readBoard(board)))

  // Ask about the board, then about part of it: answered in AI Assist's panel, naming the shapes
  // (each a click from being picked on the board), with a picture for a model that can see; the
  // board stays as it is.
  const unchanged = JSON.stringify(live(readBoard(board)).map((e) => [e.id, e.version]))
  const cbox = await p.locator('.wb-canvas').boundingBox()
  await p.mouse.click(cbox.x + cbox.width * 0.6, cbox.y + cbox.height - 30)
  await p.locator('.wb-view .pane-extras button[aria-label="AI Assist"]').click()
  const offered = await p.locator('.ai-menu .ai-item-label').allInnerTexts()
  ok(JSON.stringify(offered.slice(0, 3)) === JSON.stringify(['Draw this', 'Change it', 'Ask about the board']), 'with nothing selected, AI Assist offers Ask about the board', offered)
  await p.locator('.ai-menu button', { hasText: 'Ask about the board' }).click()
  ok(await until(() => p.locator('.wb-draw [role="tab"][aria-selected="true"]', { hasText: 'Ask' }).count(), 5000) && /About the whole board/.test(await p.locator('.wb-draw .wb-scope').innerText()), 'which opens AI Assist\'s panel on Ask, about the whole board')
  const asked0 = model.asked().length
  await p.fill('.wb-draw textarea', 'What is missing between these steps?')
  await p.locator('.wb-draw').getByRole('button', { name: 'Ask', exact: true }).click()
  const answer = p.locator('.wb-answer')
  ok(await until(async () => /4 shapes: "Start", "Tests pass\?", "Ship", "Fix"/.test(await answer.innerText().catch(() => '')), 15000), 'the answer, in the panel, names the shapes it\'s about', await answer.innerText().catch(() => ''))
  ok((await answer.locator('.wb-answer-shapes .chip').allInnerTexts()).join('|') === 'Start|Tests pass?|Ship|Fix' && /from the shapes and a picture of them/.test(await answer.innerText()), 'each named shape a chip, and it says it looked at a picture', await answer.innerText())
  const q1 = model.asked().slice(asked0).find((q) => /^A question about a diagram on a whiteboard: What is missing between these steps\?/.test(q)) || ''
  ok(/"text":"Tests pass\?"/.test(q1) && /\[image\]/.test(q1), 'the model is sent the board\'s shapes and a picture of them, as it can see', q1.slice(0, 300))
  await answer.locator('.wb-answer-shapes .chip', { hasText: 'Ship' }).click()
  await p.locator('.wb-view .pane-extras button[aria-label="AI Assist"]').click()
  ok(await until(() => p.locator('.ai-menu button', { hasText: 'Ask about these' }).count(), 3000) && /A question about the 1 selected/.test(await p.locator('.ai-menu').innerText()), 'a shape it named, clicked, is picked on the board: AI Assist offers Ask about these', await p.locator('.ai-menu').innerText().catch(() => ''))
  await p.locator('.ai-menu button', { hasText: 'Ask about these' }).click()
  await p.fill('.wb-draw textarea', 'What does this step do?')
  await p.locator('.wb-draw').getByRole('button', { name: 'Ask', exact: true }).click()
  ok(await until(async () => /One shape: "Ship"/.test(await answer.innerText().catch(() => '')), 15000), 'asked about it alone, the answer is about it alone', await answer.innerText().catch(() => ''))
  const q2 = model.asked().find((q) => /What does this step do\?/.test(q)) || ''
  ok(/^A question about part of a diagram on a whiteboard \(the shapes selected\)/.test(q2) && !/"text":"Fix"/.test(q2) && /\[image\]/.test(q2), 'only the shapes selected go to the model, with a picture of them', q2.slice(0, 300))
  await shot(p, `${tag}whiteboard-ask`)
  ok(JSON.stringify(live(readBoard(board)).map((e) => [e.id, e.version])) === unchanged, 'and asking changes nothing on the board')

  // Export.
  await p.getByRole('button', { name: 'Export' }).click()
  const [png] = await Promise.all([p.waitForEvent('download'), p.getByRole('menuitem', { name: 'Export as PNG' }).click()])
  const pngFile = path.join(kit.dir, 'out.png')
  await png.saveAs(pngFile)
  ok(png.suggestedFilename() === `${board}.png` && fs.readFileSync(pngFile).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Export as PNG saves a PNG named after the board', png.suggestedFilename())
  await p.getByRole('button', { name: 'Export' }).click()
  const [svg] = await Promise.all([p.waitForEvent('download'), p.getByRole('menuitem', { name: 'Export as SVG' }).click()])
  const svgFile = path.join(kit.dir, 'out.svg')
  await svg.saveAs(svgFile)
  const svgText = fs.readFileSync(svgFile, 'utf8')
  ok(/^<svg/.test(svgText) && svgText.includes('>Ship<') && svgText.includes('>Start<'), 'and as SVG, with the words in it', svgText.slice(0, 200))

  // Bridge AI's ⌘K over the board: its search, not Excalidraw's link box.
  const cb = await p.locator('.wb-canvas').boundingBox()
  await p.mouse.click(cb.x + cb.width * 0.6, cb.y + cb.height - 30)
  ok(await p.evaluate(() => !!document.activeElement?.closest('.excalidraw')), 'the board has the keyboard')
  await p.keyboard.press('ControlOrMeta+k')
  ok(await until(() => p.locator('.palette').count(), 3000) && !(await p.locator('.excalidraw-hyperlinkContainer').count()), '⌘K on the board opens Bridge AI\'s search, not Excalidraw\'s link box')
  await p.keyboard.press('Escape')

  // ---------- Diagram files in Files ----------
  // Looked for again, as the app does after an install: the server looked before the stand-in was there.
  await api('/agents/catalog')
  const agent = await api('/agents/launch', { kind: 'claude', cwd: proj, label: 'Shop', newSpace: 'Shop', prompt: 'diagram' })
  ok(!!agent.paneId, 'an agent works in the project (the stand-in Claude Code)', agent)
  const openFile = async (rel) => {
    await p.evaluate(({ id, rel }) => {
      localStorage.setItem('cc-agent-views', JSON.stringify({ [id]: 'files' }))
      window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } }))
      setTimeout(() => window.dispatchEvent(new CustomEvent('cc-set-view', { detail: { paneId: id, view: 'files', path: rel } })), 300)
    }, { id: agent.paneId, rel })
    await p.waitForSelector(`.viewer .crumb b:has-text("${rel.split('/').pop()}")`, { timeout: 20000 })
  }
  await until(async () => (await api('/fleet')).agents.some((a) => a.paneId === agent.paneId), 20000)

  await openFile('design.excalidraw')
  await p.waitForSelector('.viewer .wb-file .excalidraw canvas', { timeout: 30000 })
  await assist(p, 'Draw this', '.wb-file-bar')
  await p.locator('.wb-draw [role="tab"]', { hasText: 'Draw this' }).click()
  await p.locator('.wb-draw textarea').fill('Draw the checkout')
  await p.locator('.wb-draw').getByRole('button', { name: 'Draw', exact: true }).click()
  ok(await until(() => { const j = JSON.parse(fs.readFileSync(path.join(proj, 'design.excalidraw'), 'utf8')); return live(j).some((e) => e.id === 'r1') && live(j).length > 5 }, 15000), 'an .excalidraw file in Files is a board: drawn on and saved back into the file', fs.readFileSync(path.join(proj, 'design.excalidraw'), 'utf8').slice(0, 300))
  await shot(p, `${tag}whiteboard-file-excalidraw`)

  await openFile('flow.mmd')
  await p.waitForSelector('.viewer .wb-file .excalidraw canvas', { timeout: 30000 })
  ok(await p.locator('.wb-file-bar', { hasText: 'Drawn from this Mermaid' }).count() === 1, 'a .mmd file is drawn as a board, and says the file stays as it is')
  await p.locator('.wb-file-bar').getByRole('button', { name: 'Save as .excalidraw' }).click()
  const beside = await until(() => { try { return JSON.parse(fs.readFileSync(path.join(proj, 'flow.excalidraw'), 'utf8')) } catch { return null } }, 10000)
  ok(!!beside && texts(beside).includes('Payment') && live(beside).some((e) => e.type === 'arrow' && e.endBinding), 'Save as .excalidraw puts the drawing beside it, as shapes', beside && texts(beside))
  ok(fs.readFileSync(path.join(proj, 'flow.mmd'), 'utf8').startsWith('flowchart LR'), 'and leaves the Mermaid as it was')

  await openFile('docs/system.drawio')
  await p.waitForSelector('.viewer .wb-file .excalidraw canvas', { timeout: 30000 })
  await shot(p, `${tag}whiteboard-file-drawio`)
  await p.locator('.wb-file-bar').getByRole('button', { name: 'Add to Whiteboards' }).click()
  const sys = await until(() => readBoard('system'), 10000)
  ok(!!sys && ['Web app', 'API', 'Database', 'calls', 'Queue', 'Services', 'Jobs'].every((w) => texts(sys).includes(w)), 'a .drawio file is drawn, both pages (one of them compressed), with its words and arrow labels, and added to Whiteboards', sys && texts(sys))
  if (sys) {
    const els = live(sys)
    ok(els.some((e) => e.type === 'ellipse') && els.some((e) => e.type === 'diamond') && els.some((e) => e.backgroundColor === '#dae8fc'), 'its shapes and colours as drawn', els.map((e) => [e.type, e.backgroundColor]))
  }

  await openFile('docs/notes.md')
  await p.waitForSelector('.md-view .wb-open-mermaid', { timeout: 15000 })
  await p.locator('.md-view .wb-open-mermaid').click()
  ok(await until(() => texts(readBoard('notes')).includes('Shipped'), 20000), 'a Mermaid block in Markdown opens as a board of shapes', fs.readdirSync(BOARDS))

  // From the agent's chat: its Mermaid opens as a board, and the file it names opens drawn.
  await p.evaluate((id) => { localStorage.setItem('cc-agent-views', JSON.stringify({ [id]: 'chat' })); window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } })); setTimeout(() => window.dispatchEvent(new CustomEvent('cc-set-view', { detail: { paneId: id, view: 'chat' } })), 300) }, agent.paneId)
  const chatBtn = p.locator('.msg .wb-open-mermaid, .wb-open-mermaid').first()
  ok(await until(() => chatBtn.count(), 30000), 'a Mermaid diagram in an agent\'s chat has Open as a whiteboard')
  await chatBtn.click()
  ok(await until(() => texts(readBoard('Diagram from a chat')).includes('Payment'), 20000), 'which opens it as a board of shapes', fs.readdirSync(BOARDS))
  await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } })), agent.paneId)
  await p.evaluate((id) => window.dispatchEvent(new CustomEvent('cc-set-view', { detail: { paneId: id, view: 'chat' } })), agent.paneId)
  const link = p.locator('button.path-link', { hasText: 'flow.mmd' }).first()
  if (await until(() => link.count(), 10000)) {
    await link.click()
    ok(await until(() => p.locator('.viewer .wb-file .excalidraw canvas').count(), 20000), 'and the file it names opens drawn, from the chat')
  } else ok(false, 'the chat names flow.mmd as a link')

  // A board's own save isn't a change from somewhere else. Its look for a newer file, sent just
  // before a save and answered once the file was written but before the save's answer was back, took
  // the save for someone else's: "changed somewhere else", whose Show theirs dropped what was drawn
  // meanwhile.
  await api('/boards', { title: 'Race' })
  let holdSave = false
  const heldSaves = []
  const rc = await page(b, kit.url, { before: async (c) => {
    watch(c)
    await noServiceWorker(c)
    // The look held in the page, not on the network (where it would take one of the few connections).
    await c.addInitScript(() => {
      const f0 = window.fetch
      window.__look = { hold: false, waiting: [] }
      window.fetch = function (u, o) {
        if (window.__look.hold && /\/api\/boards\/Race\/stat/.test(String(u))) return new Promise((res) => window.__look.waiting.push(() => res(f0.call(this, u, o))))
        return f0.call(this, u, o)
      }
    })
    await c.route(/\/api\/boards\/Race(\?|$)/, async (r) => { if (r.request().method() !== 'PUT' || !holdSave) return r.continue(); const res = await r.fetch(); heldSaves.push(() => r.fulfill({ response: res })) })
  } })
  const rp = rc.p
  await rp.waitForSelector('.rail-nav', { timeout: 30000 })
  await until(async () => { if (await rp.locator('.excalidraw canvas').count()) return true; await rp.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-board', { detail: { id: 'Race' } }))); return false }, 30000, 1000)
  await rp.waitForSelector('.excalidraw canvas.interactive', { timeout: 30000 })
  const rbox = await rp.locator('.wb-canvas').boundingBox()
  const rFrame = () => rp.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const drawBox = async (x, y) => {
    await until(async () => { await rp.locator('[data-testid="toolbar-rectangle"]').click({ force: true }); return rp.locator('input[data-testid="toolbar-rectangle"]:checked').count() }, 5000, 200)
    await rp.mouse.move(x, y); await rFrame(); await rp.mouse.down(); await rFrame()
    for (let i = 1; i <= 6; i++) { await rp.mouse.move(x + i * 20, y + i * 10); await rFrame() }
    await rp.mouse.up(); await rFrame(); await rp.keyboard.press('Escape')
  }
  await rp.evaluate(() => { window.__look.hold = true })
  const looking = await until(() => rp.evaluate(() => window.__look.waiting.length > 0), 6000, 50)
  holdSave = true
  await drawBox(rbox.x + rbox.width / 2 - 150, rbox.y + rbox.height / 2)
  const written = await until(() => heldSaves.length > 0, 8000, 50)
  await drawBox(rbox.x + rbox.width / 2 + 100, rbox.y + rbox.height / 2)
  await rp.evaluate(() => { window.__look.hold = false; for (const f of window.__look.waiting.splice(0)) f() })
  // Given time to say so, as it did.
  const said = await until(() => rp.locator('.wb-conflict').count(), 3000, 100)
  holdSave = false
  for (const f of heldSaves.splice(0)) await f()
  const both = await until(() => live(readBoard('Race')).filter((e) => e.type === 'rectangle').length === 2, 8000)
  ok(!!looking && !!written && !said && !!both, 'a look for a newer file answered while the board\'s own save is on its way: not taken for a change from somewhere else, and what was drawn meanwhile saved too', { looking: !!looking, written: !!written, said: !!said, rects: live(readBoard('Race')).filter((e) => e.type === 'rectangle').length })
  await rc.ctx.close()

  // A dark theme.
  const dark = await page(b, kit.url, { mode: 'dark', store: { 'cc-ws': { tabs: [`view:whiteboard:${board}`], active: `view:whiteboard:${board}`, side: null, split: false, group: 'main' } }, before: async (c) => watch(c) })
  await dark.p.waitForSelector('.excalidraw canvas', { timeout: 30000 })
  ok(await dark.p.locator('.excalidraw.theme--dark').count() === 1, 'in a dark theme, the board is dark too')
  await shot(dark.p, `${tag}whiteboard-dark`)
  await assist(dark.p, 'Change it')
  await dark.p.fill('.wb-draw textarea', 'Rename Start to Begin, colour Ship red, and add a cache')
  await dark.p.locator('.wb-draw').getByRole('button', { name: 'Change', exact: true }).click()
  ok(await until(async () => (await dark.p.locator('.wb-sug').count()) && dark.p.locator('.wb-draw .wb-sug-acts').count(), 15000), 'dark: a suggestion outlined on the board')
  await shot(dark.p, `${tag}whiteboard-suggestion-dark`)
  await dark.p.locator('.wb-draw .wb-sug-acts button', { hasText: 'Discard' }).click()
  ok(await until(() => { const j = readBoard(board); return texts(j).includes('Start') && !texts(j).includes('Cache') }, 8000), 'and discarded', texts(readBoard(board)))
  await dark.p.locator('.wb-draw [role="tab"]', { hasText: 'Ask' }).click()
  await dark.p.fill('.wb-draw textarea', 'What is missing?')
  await dark.p.locator('.wb-draw').getByRole('button', { name: 'Ask', exact: true }).click()
  ok(await until(() => dark.p.locator('.wb-answer .chip').count(), 15000), 'dark: Ask\'s answer in the panel')
  await shot(dark.p, `${tag}whiteboard-ask-dark`)
  await assist(dark.p, 'Action items')
  ok(await until(() => dark.p.locator('.wb-tasks button', { hasText: 'Add them to Tasks' }).count(), 20000), 'dark: Action items drawn from the board, with Add them to Tasks')
  await shot(dark.p, `${tag}whiteboard-actions-dark`)
  await dark.p.locator('.wb-draw .wb-sug-acts button', { hasText: 'Discard' }).first().click()
  ok(!dark.errors.length, 'no page errors in the dark theme', dark.errors)
  await dark.ctx.close()

  // ---------- On a phone ----------
  const ph = await page(b, kit.url, { phone: true, before: async (c) => watch(c) })
  await ph.p.waitForSelector('.tabbar', { timeout: 30000 })
  await ph.p.keyboard.press('ControlOrMeta+k')
  await ph.p.keyboard.type('Whiteboards')
  await ph.p.keyboard.press('Enter')
  await ph.p.waitForSelector('.wb-home', { timeout: 15000 })
  const fits = (pp) => pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.wb-home *, .wb-view .pane-head *, .wb-draw *')].every((e) => { const r = e.getBoundingClientRect(); return !r.width || (r.left >= -1 && r.right <= window.innerWidth + 1) }))
  ok(await fits(ph.p), 'on a phone the list fits the screen')
  await shot(ph.p, `${tag}whiteboard-phone-list`)
  await ph.p.locator('.wb-card', { hasText: board }).click()
  await ph.p.waitForSelector('.excalidraw canvas', { timeout: 30000 })
  ok(await until(() => ph.p.locator('.excalidraw.excalidraw--mobile').count(), 5000), 'a board opens with Excalidraw\'s phone tools')
  await ph.p.locator('.wb-view .pane-extras button[aria-label="AI Assist"]').click()
  await shot(ph.p, `${tag}whiteboard-phone-ai-menu`)
  await ph.p.locator('.ai-menu button', { hasText: 'Draw this' }).click()
  await ph.p.waitForSelector('.wb-draw textarea')
  ok(await fits(ph.p), 'and it and AI Assist\'s Draw this fit the screen')
  await shot(ph.p, `${tag}whiteboard-phone-board`)
  ok(!ph.errors.length, 'no page errors on a phone', ph.errors)
  await ph.ctx.close()

  ok(fonts.length > 0, 'Excalidraw\'s fonts come from Bridge AI', fonts)
  ok(!elsewhere.length, 'nothing the page asks for goes anywhere but this computer', elsewhere)
  ok(!errors.length, 'no page errors', errors)
  await ctx.close()

  // In a container (Docker), there's no desktop to show the folder on: not offered, and turned down.
  const docker = await startKit('whiteboard-docker', { env: { BRIDGE_MACHINE: JSON.stringify({ docker: true }) } })
  try {
    await docker.api('/setup', { name: 'Tester' })
    ok((await docker.api('/boards')).canOpen === false, 'in Docker the boards folder isn\'t offered', await docker.api('/boards'))
    ok(await docker.api('/boards/folder', {}).then(() => false, (e) => /no desktop/.test(e.message)), 'and showing it is turned down')
  } finally { docker.stop() }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close().catch(() => {})
  model.stop()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
