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
//   "Draw this" from the list and on a board (boxes,
//   arrows joined to them and words you can edit, not a picture; Mermaid that doesn't draw sent
//   back once); "Change it" in place, and undone; PNG and SVG export; ⌘K over the board opening
//   Bridge AI's search; a dark theme. Diagram files in an agent's Files tab: .excalidraw drawn and
//   saved back into the file, .mmd and .drawio (plain and compressed) drawn as shapes, saved
//   beside or added to Whiteboards; a Mermaid block in Markdown and in the agent's chat opening as
//   a board. On a phone: the list and a board fit, with Excalidraw's phone tools. Nothing the page
//   loads comes from anywhere but this computer (Excalidraw's fonts included).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { startKit, startModel, checks, until, sleep, browser, page, shot, ROOT, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('whiteboard')

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
const chief = (args, input) => spawnSync(process.execPath, [path.join(ROOT, 'chief', 'bin', 'bridge'), 'board', ...args], { input, encoding: 'utf8', env: { ...process.env, BRIDGE_URL: kit.url } })
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
  ok(model.asked(/its parts/).some((q) => /The project shop/.test(q) && /A web shop: a cart/.test(q) && /subgraph/.test(q)), 'a project goes as its files and README, and the kind asked for is said', model.asked(/its parts/))
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
  await again.getByRole('button', { name: /Draw this/ }).first().click()
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
  await p.locator('.wb-file-bar').getByRole('button', { name: /Draw this/ }).click()
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

  // A dark theme.
  const dark = await page(b, kit.url, { mode: 'dark', store: { 'cc-ws': { tabs: [`view:whiteboard:${board}`], active: `view:whiteboard:${board}`, side: null, split: false, group: 'main' } }, before: async (c) => watch(c) })
  await dark.p.waitForSelector('.excalidraw canvas', { timeout: 30000 })
  ok(await dark.p.locator('.excalidraw.theme--dark').count() === 1, 'in a dark theme, the board is dark too')
  await shot(dark.p, `${tag}whiteboard-dark`)
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
  await ph.p.locator('.wb-view .pane-extras button[aria-pressed]').click()
  await ph.p.waitForSelector('.wb-draw textarea')
  ok(await fits(ph.p), 'and it and Draw this fit the screen')
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
