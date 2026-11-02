// Whiteboards, second part: Bridge AI's own look, shapes for architecture and network diagrams,
// Auto-layout, PDF, Refine, learning what the user likes, and models on this computer. The model
// is the stand-in (stand-ins/model.mjs), which also stands in for Ollama (OLLAMA_HOST) and LM Studio
// (LM_STUDIO_BASE_URL).
//   The server: a board renamed in capitals only stays the same file, and its rounds of Refine go
//   with it; "Draw this" for an architecture comes back as a spec with icons and containers, asked
//   in a JSON shape; a model on Ollama or LM Studio is listed as on this computer, asked in plain
//   words first and again (held to the JSON shape) when its answer can't be drawn, sent only what
//   fits of a long meeting, and asked whether it can see (one that can is sent the board's picture in
//   Ollama's own chat); the chief of staff hands over a spec and lists the shapes; a preference kept,
//   sent in the next prompt, and forgotten. The build the app runs from carries its PDF code.
//   The app, in Chromium or WebKit: the clean look by default (straight lines, the pane's own
//   background, Bridge AI's accent, right-angled arrows joined to shapes) with Excalidraw's menu,
//   welcome screen, shortcut numbers, own links, web embeds and Mermaid importer gone, and
//   hand-drawn as an option; renaming by clicking the name, in the header and the list, keeping the
//   file and its tab; the Shapes panel searched, a container and an icon added, the container
//   dragged with what's in it; Auto-layout across and down; "Draw this" with Refine x3: an AWS
//   diagram with icons and containers, two rounds kept as versions to step through, stopping early,
//   with the calls counted and a picture sent to a model that can see; PDF export with the board's
//   words in it (its code loaded only then), and of a selection; a preference learnt from laying a
//   drawing out the other way, applied to the next prompt and forgotten, and one set by hand; a
//   model on this computer drawing and refining with no picture; the credit in About; on a phone,
//   the panels fit.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { startKit, startModel, checks, until, sleep, browser, page, shot, ROOT } from '../lib/harness.mjs'

const { ok, done } = checks('whiteboard-v2')
const model = await startModel('whiteboard-v2')
const kit = await startKit('whiteboard-v2', { env: { OLLAMA_HOST: model.url, LM_STUDIO_BASE_URL: `${model.url}/v1` } })
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const enc = encodeURIComponent
const BOARDS = path.join(kit.data, 'boards')
const file = (name) => path.join(BOARDS, `${name}.excalidraw`)
const readBoard = (name) => { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')) } catch { return null } }
const live = (j) => (j?.elements || []).filter((e) => !e.isDeleted)
const texts = (j) => live(j).filter((e) => e.type === 'text').map((e) => e.originalText ?? e.text)
const labelOf = (els, e) => els.find((t) => t.type === 'text' && t.containerId === e.id)?.originalText || ''
const byLabel = (els, text) => els.find((e) => e.type !== 'text' && labelOf(els, e) === text)
const holder = (e) => e?.customData?.bridge?.holder
const inside = (a, c) => a.x >= c.x - 1 && a.y >= c.y - 1 && a.x + a.width <= c.x + c.width + 1 && a.y + a.height <= c.y + c.height + 1
const chief = (args, input) => spawnSync(process.execPath, [path.join(ROOT, 'chief', 'bin', 'bridge'), 'board', ...args], { input, encoding: 'utf8', env: { ...process.env, BRIDGE_URL: kit.url } })
// The words in a PDF: its text, in its streams (compressed or not).
function pdfWords(buf) {
  let out = buf.toString('latin1')
  for (const m of out.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) { try { out += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { /* not deflated */ } }
  return out
}
// A part of the suite that fails as one when it crashes, so the parts after it still run.
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: ${e.message}`, e.stack?.split('\n').slice(0, 4).join(' ')) } }

try {
  await api('/setup', { name: 'Tester' })
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')

  // ---------- The server ----------
  await part('rename on the server', async () => {
    const made = await api('/boards', { title: 'roadmap' })
    await api(`/boards/${enc(made.id)}/rounds`, { prompt: 'x', rounds: [{ n: 0, changes: [] }, { n: 1, changes: ['Labelled an arrow'] }] }, 'PUT')
    const r = await api(`/boards/${enc(made.id)}`, { title: 'Roadmap' }, 'PATCH')
    const names = fs.readdirSync(BOARDS).filter((f) => /^roadmap/i.test(f))
    ok(r.id === 'Roadmap' && names.length === 1 && names[0] === 'Roadmap.excalidraw', 'a board renamed in capitals only is the same file under the new name, not "Roadmap 2"', [r.id, names])
    const moved = await api('/boards/Roadmap', { title: 'Plan' }, 'PATCH')
    ok(moved.id === 'Plan' && (await api('/boards/Plan/rounds')).rounds?.[1]?.changes?.[0] === 'Labelled an arrow', 'and its rounds of Refine go with it when it\'s renamed', await api('/boards/Plan/rounds').catch((e) => e.message))
    await api('/boards/Plan', null, 'DELETE')
  })

  await part('drawing an architecture', async () => {
    const before = model.requests().length
    const r = await api('/boards/draw', { prompt: 'A 3-tier web app on AWS with a load balancer, two app servers in private subnets and RDS', kind: 'architecture' })
    const kinds = new Set((r.spec?.groups || []).map((g) => g.kind))
    const shapes = new Set((r.spec?.nodes || []).map((n) => n.shape))
    ok(kinds.has('vpc') && kinds.has('subnet') && kinds.has('region') && shapes.has('aws.elb') && shapes.has('aws.ec2') && shapes.has('aws.rds'), '"Draw this" for an architecture comes back as a diagram of AWS icons in a region, a VPC and subnets', r)
    const q = model.requests().slice(before)[0]
    const words = q?.messages.find((m) => m.role === 'user')?.content || ''
    ok(/aws\.ec2 \(EC2\)/.test(words) && /aws\.rds/.test(words) && /region, vpc, subnet/.test(words) && /load-balancer/.test(words), 'the model is told the shapes it can use: network icons, AWS\'s (named in the request) and the kinds of container', words.slice(0, 600))
    ok(q?.format === 'json_schema', 'and asked for the answer in a JSON shape, as OpenAI can be held to one', q?.format)
  })

  await part('a model on this computer', async () => {
    const list = await api('/boards/models')
    const q = list.models.find((m) => m.id === 'ollama:llama3.1:8b')
    const before = model.requests().length
    const r = await api('/boards/draw', { prompt: 'a local web app', kind: 'architecture', model: 'ollama:llama3.1:8b' })
    const sent = model.requests().slice(before)
    ok(q?.via === 'local' && r.spec?.nodes?.length > 2 && r.calls === 2 && sent.length === 2 && sent.every((x) => x.model === 'llama3.1:8b' && x.path === '/api/chat') && !sent[0].format && sent[1].format === 'json_schema', 'a model on Ollama (on this computer) draws, through Ollama\'s own chat: asked in plain words first (small models write worse held to a shape), and an answer that can\'t be drawn goes back to it, held to the JSON shape', { local: q, calls: r.calls, sent: sent.map((x) => [x.path, x.model, x.format]) })
    ok(/That answer can't be drawn: It had no nodes/.test(JSON.stringify(sent[1]?.messages)), 'saying why', sent[1]?.messages?.slice(-1))
    // A long meeting: a cloud model gets much of it, a model on this computer only what fits in what
    // it reads at a time (the context Bridge AI says it has), with room left for the answer.
    const m = await api('/meetings', { title: 'Infra review', call: false })
    await api(`/meetings/${m.id}/stop`, {})
    const line = (i) => `${JSON.stringify({ src: 'them', t0: i, t1: i + 1, text: `Point ${i}: the queue in front of the billing service drops messages when the cache restarts.`, engine: 'test' })}\n`
    fs.appendFileSync(path.join(kit.data, 'meetings', m.id, 'transcript.jsonl'), Array.from({ length: 700 }, (_, i) => line(i)).join(''))
    const sizeOf = async (modelId) => {
      const n = model.requests().length
      await api('/boards/draw', { prompt: 'the billing services', kind: 'architecture', from: { meeting: m.id }, model: modelId }).catch(() => null)
      return (model.requests()[n]?.messages || []).map((x) => (typeof x.content === 'string' ? x.content : '')).join('\n').length
    }
    const cloud = await sizeOf('openai:gpt-5'), local = await sizeOf('ollama:llama3.1:8b')
    const context = (await api('/local-models')).models?.find((x) => x.id === 'ollama:llama3.1:8b')?.context
    ok(context > 0 && cloud > 25000 && local > 1000 && local < cloud * 0.8 && local / 3.2 + 2048 <= context, 'a model on this computer is sent only as much of a long meeting as fits what it reads at a time, with room for its answer, and less than a cloud model', { cloud, local, context })
    // "Change it" on a model on this computer: plain words first, its steps back.
    const n1 = model.requests().length
    const ch = await api('/boards/change', { prompt: 'call Start Begin', scene: { shapes: [{ id: 'a1', shape: 'rectangle', text: 'Start' }], arrows: [], texts: [] }, model: 'ollama:llama3.1:8b' })
    const sentCh = model.requests().slice(n1)
    const chWords = sentCh[0]?.messages?.find((x) => x.role === 'user')?.content || ''
    ok(ch.ops?.update?.[0]?.text === 'Begin' && sentCh.length === 1 && sentCh[0].model === 'llama3.1:8b' && !sentCh[0].format && /Shapes for "add" besides rectangle, ellipse and diamond:\nNetwork: router/.test(chWords), '"Change it" works with it too, in plain words, told the icons it may add', { ops: ch.ops, sent: sentCh.map((x) => [x.model, x.format]), words: chWords.slice(-500) })
    // LM Studio, the other server for models on this computer.
    const lms = list.models.find((x) => x.id === 'lmstudio:gpt-5')
    const n2 = model.requests().length
    const r2 = await api('/boards/draw', { prompt: 'a local web app', kind: 'architecture', model: 'lmstudio:gpt-5' }).catch((e) => ({ error: e.message }))
    const sent2 = model.requests().slice(n2)
    ok(lms?.via === 'local' && r2.spec?.nodes?.length > 2 && sent2.length === 2 && sent2.every((x) => x.model === 'gpt-5') && !sent2[0].format && sent2[1].format === 'json_schema', 'a model in LM Studio is offered as on this computer and draws the same way', { lms, calls: r2.calls, error: r2.error, sent: sent2.map((x) => [x.model, x.format]) })
    ok((await api(`/boards/sees?model=${enc('ollama:llama3.2-vision:11b')}`)).sees === true && (await api(`/boards/sees?model=${enc('ollama:llama3.1:8b')}`)).sees === false, 'whether a model on Ollama can look at a picture is asked of Ollama itself', null)
    ok((await api(`/boards/sees?model=${enc('openai:gpt-5')}`)).sees === true && (await api(`/boards/sees?model=${enc('cli:claude')}`)).sees === false, 'and a cloud model is known by name; a sign-in\'s one-shot mode takes words only')
    // A round of Refine on a model on Ollama that can see: the board's picture goes to Ollama's own
    // chat the way Ollama takes one, as base64 in the message's images.
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const n3 = model.requests().length
    const rv = await api('/boards/review', { mode: 'draw', prompt: 'a web app', kind: 'architecture', model: 'ollama:llama3.2-vision:11b', image: PNG, issues: ['Arrows with no label: Load balancer to App.'],
      spec: { direction: 'LR', groups: [], nodes: [{ id: 'lb', label: 'Load balancer', shape: 'load-balancer' }, { id: 'app', label: 'App', shape: 'server' }], edges: [{ from: 'lb', to: 'app' }] } }).catch((e) => ({ error: e.message }))
    const sent3 = model.requests().slice(n3)
    const asked3 = sent3[0]?.messages?.find((x) => x.role === 'user')
    ok(rv.saw === 'picture' && rv.spec?.edges?.[0]?.label === 'HTTP' && sent3.length === 1 && sent3[0].path === '/api/chat' && sent3[0].model === 'llama3.2-vision:11b' && asked3?.images?.length === 1 && asked3.images[0] === PNG.split(',')[1] && /A picture of it as drawn/.test(asked3.content), 'a round of Refine on a model on Ollama that can see sends the board\'s picture to Ollama\'s own chat, in the message\'s images, and its answer is drawn', { rv, sent: sent3.map((x) => [x.path, x.model, x.messages?.map((m) => [m.role, m.images?.length || 0])]) })
  })

  await part('the chief of staff', async () => {
    const spec = { direction: 'LR', groups: [{ id: 'vpc', label: 'VPC', kind: 'vpc' }], nodes: [{ id: 'lb', label: 'Load balancer', shape: 'aws.elb', group: 'vpc' }, { id: 'app', label: 'App', shape: 'aws.ec2', group: 'vpc' }], edges: [{ from: 'lb', to: 'app', label: 'HTTP' }] }
    const out = chief(['new', 'Shop architecture', '-'], JSON.stringify(spec))
    ok(out.status === 0 && /from a diagram spec/.test(out.stdout) && readBoard('Shop architecture')?.bridge?.pending?.kind === 'spec', '`bridge board new` takes a diagram spec, which waits to be drawn', out.stdout + out.stderr)
    const shapes = chief(['shapes'])
    ok(shapes.status === 0 && /aws\.ec2 \(EC2\)/.test(shapes.stdout) && /Container kinds for groups: region, vpc, subnet/.test(shapes.stdout), '`bridge board shapes` lists the shapes and containers a spec can use', shapes.stdout.slice(0, 300))
  })

  await part('preferences on the server', async () => {
    const empty = await api('/boards/preferences')
    ok(empty.on === true && !Object.keys(empty.prefs).length, 'nothing is learnt to begin with', empty)
    await api('/boards/preferences/learn', { key: 'colours', value: 'muted', board: 'Somewhere' })
    const f = JSON.parse(fs.readFileSync(path.join(BOARDS, 'preferences.json'), 'utf8'))
    ok(f.prefs.colours?.value === 'muted' && f.prefs.colours.evidence[0]?.board === 'Somewhere', 'what an edit shows is kept in preferences.json beside the boards, with where it was learnt', f)
    const before = model.requests().length
    await api('/boards/draw', { prompt: 'an office network', kind: 'network' })
    ok(/The user's preferences.*muted colours/.test(model.asked().slice(before).join('\n')), 'and sent with the next drawing', model.asked().slice(before).join('\n').slice(-400))
    await api('/boards/preferences', { forget: 'colours' }, 'PUT')
    const before2 = model.requests().length
    await api('/boards/draw', { prompt: 'an office network', kind: 'network' })
    ok(!/muted colours/.test(model.asked().slice(before2).join('\n')) && !JSON.parse(fs.readFileSync(path.join(BOARDS, 'preferences.json'), 'utf8')).prefs.colours, 'forgotten, it\'s gone from the file and the prompt')
  })

  // ---------- The app ----------
  // The build the app runs from carries the PDF code: one made before `npm ci` can't find jsPDF, says
  // so, and still writes a page whose Export as PDF can't load it (test/run.mjs builds again then).
  await part('the build', async () => {
    const assets = path.join(ROOT, 'dist', 'assets')
    const js = fs.readdirSync(assets).filter((f) => f.endsWith('.js'))
    const bare = js.filter((f) => /import\(\s*[`'"](jspdf|svg2pdf\.js)[`'"]\s*\)/.test(fs.readFileSync(path.join(assets, f), 'utf8')))
    ok(js.some((f) => /^jspdf\./.test(f)) && js.some((f) => /^svg2pdf\./.test(f)) && !bare.length, 'the app\'s build has its PDF code in it, not just a name it couldn\'t find', { bare, pdf: js.filter((f) => /pdf/i.test(f)) })
  })

  const elsewhere = []
  const pdfCode = []
  const host = new URL(kit.url).host
  // What the page asks of anywhere but this computer is noted, and never let out, so a check that
  // fails (an embedded video loading, say) still doesn't reach the internet.
  const away = (u) => !/^(data|blob):/.test(u) && new URL(u).host !== host
  const watch = async (ctx) => {
    ctx.on('request', (r) => { if (away(r.url())) elsewhere.push(r.url()) })
    ctx.on('response', (r) => { if (/jspdf|svg2pdf/.test(new URL(r.url()).pathname)) pdfCode.push(r.url()) })
    await ctx.route((u) => away(u.href), (r) => r.abort())
  }
  const { ctx, p, errors } = await page(b, kit.url, { store: { 'cc-board-refine': 3, 'cc-board-model': 'openai:gpt-5' }, before: async (c) => watch(c) })
  await p.waitForSelector('.rail-nav', { timeout: 30000 })
  // The list or a board opened the way the app's links do. The app listens once it's up, which can be
  // a moment after its sidebar shows: an open asked before that is lost, so it's asked again.
  const opened = async (detail, there) => {
    if (!await until(async () => { if (await there()) return true; await p.evaluate((d) => window.dispatchEvent(new CustomEvent('bridge-open-board', { detail: d })), detail); return there() }, 60000, 1000)) throw new Error(`couldn't open ${JSON.stringify(detail)}`)
  }
  const toList = () => opened({ list: true }, () => p.locator('.wb-home').isVisible())
  const canvasBox = async () => p.locator('.wb-canvas').boundingBox()
  // A board opened by its name, up and drawn (Excalidraw's code can take a while to load the first
  // time on a busy machine).
  const openBoard = async (name) => {
    await opened({ id: name }, async () => (await p.locator('.wb-view .pane-titles .wb-name', { hasText: name }).count()) > 0)
    await p.waitForSelector('.excalidraw canvas', { timeout: 60000 })
  }
  // What a menu item downloads; when nothing comes, the page's own error line says why.
  const download = async (item) => {
    const got = p.waitForEvent('download', { timeout: 60000 }).catch(() => null)
    await p.getByRole('menuitem', { name: item }).click()
    const dl = await got
    if (!dl) throw new Error(`${item} downloaded nothing: ${await p.locator('.wb-err').innerText().catch(() => 'no error shown')}`)
    return dl
  }
  const saved = () => until(async () => (await p.locator('.wb-state').innerText().catch(() => '')) === 'Saved', 8000)

  await part('the clean look', async () => {
    await toList()
    await p.getByRole('button', { name: 'New whiteboard' }).click()
    await p.waitForSelector('.excalidraw canvas', { timeout: 60000 })
    ok(await until(() => p.locator('.wb-empty-board').isVisible(), 5000), 'an empty board says what can be done on it, in Bridge AI\'s words')
    ok(!(await p.locator('.excalidraw .main-menu-trigger').isVisible().catch(() => false)) && !(await p.locator('.welcome-screen-center, .welcome-screen-decor').count()), 'Excalidraw\'s own menu and welcome screen aren\'t there')
    const colours = await p.evaluate(() => {
      const x = document.querySelector('.excalidraw')
      return { primary: getComputedStyle(x).getPropertyValue('--color-primary').trim(), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), font: getComputedStyle(x).getPropertyValue('--ui-font').trim(), bg: getComputedStyle(document.querySelector('.wb-canvas')).backgroundColor, pane: getComputedStyle(document.querySelector('.wb-view')).backgroundColor }
    })
    ok(colours.primary && colours.primary === colours.accent && /Geist/.test(colours.font) && colours.bg === colours.pane, 'the board\'s tools are in Bridge AI\'s accent and font, on the pane\'s own colour', colours)
    await p.locator('[data-testid="toolbar-rectangle"]').click({ force: true })
    const box = await canvasBox()
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    await p.mouse.move(cx - 100, cy - 40); await p.mouse.down(); await p.mouse.move(cx + 20, cy + 40, { steps: 5 }); await p.mouse.up()
    await p.locator('[data-testid="toolbar-rectangle"]').click({ force: true })
    await p.mouse.move(cx + 200, cy - 40); await p.mouse.down(); await p.mouse.move(cx + 320, cy + 40, { steps: 5 }); await p.mouse.up()
    // An arrow drawn by hand from one to the other.
    await p.locator('[data-testid="toolbar-arrow"]').click({ force: true })
    await p.mouse.move(cx - 40, cy); await p.mouse.down(); await p.mouse.move(cx + 110, cy + 30, { steps: 4 }); await p.mouse.move(cx + 260, cy, { steps: 6 }); await p.mouse.up()
    await p.keyboard.press('Escape')
    const j = await until(() => { const x = readBoard('Untitled'); return live(x).filter((e) => e.type === 'rectangle').length === 2 && live(x).some((e) => e.type === 'arrow') && x }, 10000)
    const rects = live(j).filter((e) => e.type === 'rectangle')
    ok(rects.length === 2 && rects.every((e) => e.roughness === 0 && e.strokeWidth === 1), 'a shape drawn by hand has straight lines (no roughness), thin', rects.map((e) => [e.roughness, e.strokeWidth]))
    ok(j?.appState?.viewBackgroundColor === 'transparent', 'and the board has no background of its own', j?.appState?.viewBackgroundColor)
    const arrow = live(j).find((e) => e.type === 'arrow')
    ok(arrow?.elbowed && arrow.startBinding?.elementId && arrow.endBinding?.elementId && arrow.startBinding.fixedPoint && arrow.endArrowhead === 'triangle', 'an arrow drawn by hand turns at right angles and is joined to the shapes it starts and ends on', arrow && { elbowed: arrow.elbowed, start: arrow.startBinding, end: arrow.endBinding, head: arrow.endArrowhead })
    await shot(p, `${tag}whiteboard-v2-clean`)
  })

  await part('Excalidraw toned down', async () => {
    const numbers = await p.locator('.excalidraw .ToolIcon__keybinding').evaluateAll((els) => els.length > 0 && els.every((e) => getComputedStyle(e).display === 'none'))
    ok(numbers, 'the drawing tools carry no shortcut numbers, as Excalidraw\'s do (their tooltips still say them)')
    await p.getByRole('button', { name: 'More tools' }).click()
    const more = await p.locator('.App-toolbar__extra-tools-dropdown').innerText().catch(() => '')
    await p.keyboard.press('Escape')
    ok(/Frame tool/.test(more) && !/Web Embed|Mermaid|Generate/.test(more), 'its More tools leave out web embeds and its own Mermaid importer', more)
    await p.locator('.wb-view .pane-extras').getByRole('button', { name: 'More' }).click()
    await p.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
    await p.waitForSelector('.HelpDialog', { timeout: 5000 })
    const help = await p.evaluate(() => {
      const box = document.querySelector('.excalidraw-modal-container')
      const header = box?.querySelector('.HelpDialog__header')
      return { header: !!header && getComputedStyle(header).display !== 'none', primary: box && getComputedStyle(box).getPropertyValue('--color-primary').trim(), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() }
    })
    ok(!help.header && help.primary === help.accent, 'Keyboard shortcuts opens without Excalidraw\'s own links (its docs, blog, YouTube), in Bridge AI\'s colours', help)
    await shot(p, `${tag}whiteboard-v2-help`)
    await p.keyboard.press('Escape')
    // A board with a YouTube video embedded in it (made on excalidraw.com, say): nothing is loaded.
    const embed = { id: 'yt', type: 'embeddable', x: 0, y: 0, width: 560, height: 315, angle: 0, strokeColor: '#1f2733', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', locked: false }
    await api('/boards', { title: 'Embedded', source: { kind: 'excalidraw', text: JSON.stringify({ type: 'excalidraw', version: 2, elements: [embed], appState: {}, files: {} }) } })
    await openBoard('Embedded')
    await sleep(2500)
    ok(!elsewhere.some((u) => /youtube|ytimg|google/.test(u)) && !(await p.locator('iframe[src*="youtube"]').count()), 'a web page embedded in a board isn\'t loaded: a board never reaches the internet', elsewhere)
    await openBoard('Untitled')
    await api('/boards/Embedded', null, 'DELETE')
  })

  await part('renaming', async () => {
    await p.locator('.wb-view .pane-titles .wb-name').click()
    const input = p.locator('.wb-view .pane-titles .wb-name-input')
    ok(await input.isVisible() && await input.evaluate((x) => document.activeElement === x), 'clicking the board\'s name in its header makes it a box to type in')
    await input.fill('Network plan')
    await input.press('Enter')
    ok(await until(() => fs.existsSync(file('Network plan')) && !fs.existsSync(file('Untitled')), 8000), 'Enter renames the board\'s file', fs.readdirSync(BOARDS))
    ok(await until(() => p.locator('.wb-view .pane-titles .wb-name', { hasText: 'Network plan' }).count(), 8000) && live(readBoard('Network plan')).filter((e) => e.type === 'rectangle').length === 2, 'and the board stays open under its new name, with what was on it', await p.locator('.wb-view .pane-titles').innerText().catch(() => ''))
    ok(await p.evaluate(() => JSON.parse(localStorage.getItem('cc-ws') || '{}').tabs?.includes('view:whiteboard:Network plan') && !JSON.parse(localStorage.getItem('cc-ws') || '{}').tabs?.includes('view:whiteboard:Untitled')), 'in the same tab, now named for it')
    await toList()
    await p.locator('.wb-card', { hasText: 'Network plan' }).locator('.wb-name').click()
    await p.locator('.wb-card .wb-name-input').fill('Network map')
    await p.locator('.wb-card .wb-name-input').press('Enter')
    ok(await until(() => fs.existsSync(file('Network map')) && !fs.existsSync(file('Network plan')), 8000), 'in the list, clicking a board\'s name renames it too', fs.readdirSync(BOARDS))
    ok(await until(() => p.evaluate(() => JSON.parse(localStorage.getItem('cc-ws') || '{}').tabs?.includes('view:whiteboard:Network map')), 5000), 'and its open tab follows the new name')
    await p.locator('.wb-card', { hasText: 'Network map' }).getByRole('button', { name: 'More' }).click()
    await p.getByRole('menuitem', { name: 'Rename…' }).click()
    ok(await until(() => p.locator('.wb-card .wb-name-input').isVisible(), 3000), 'and Rename… in its menu opens the same box')
    await p.keyboard.press('Escape')
    await shot(p, `${tag}whiteboard-v2-list`)
  })

  await part('shapes and containers', async () => {
    await api('/boards', { title: 'Holders' })
    await openBoard('Holders')
    await p.waitForSelector('.wb-shapes', { timeout: 30000 })
    await p.locator('.wb-shapes-search input').fill('balancer')
    ok(await until(() => p.locator('.wb-shape', { hasText: 'Load balancer' }).count(), 3000) && !(await p.locator('.wb-shape', { hasText: 'Router' }).count()), 'the Shapes panel finds a shape by what it\'s called')
    await p.locator('.wb-shapes-search input').fill('')
    ok(await p.locator('.wb-shapes-title', { hasText: 'Network' }).count() && await p.locator('.wb-shapes-title', { hasText: 'Containers' }).count() && await p.locator('.wb-shapes-title', { hasText: 'AWS' }).count() && await p.locator('.wb-shapes-title', { hasText: 'Azure' }).count() && await p.locator('.wb-shapes-title', { hasText: 'Google Cloud' }).count(), 'with flowchart, network, container and each cloud\'s sets')
    await p.locator('.wb-shape', { hasText: 'VPC or network' }).click()
    await p.locator('.wb-shape', { hasText: /^Server$/ }).click()
    const j = await until(() => { const x = readBoard('Holders'); return live(x).some((e) => holder(e) === 'vpc') && live(x).some((e) => holder(e) === 'node') && x }, 10000)
    const vpc = live(j).find((e) => holder(e) === 'vpc'), node = live(j).find((e) => holder(e) === 'node'), pic = live(j).find((e) => e.type === 'image')
    ok(vpc && node && pic && inside(node, vpc) && inside(pic, node) && labelOf(live(j), node) === 'Server' && labelOf(live(j), vpc) === 'VPC or network' && j.files?.[pic.fileId]?.mimeType === 'image/svg+xml', 'a container and an icon (its picture inside a node with its name under it) are added from the panel, the icon inside the container', j && live(j).map((e) => [e.type, holder(e)]))
    // The container dragged by its name: the server inside goes with it.
    const box = await canvasBox()
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    await p.keyboard.press('Escape')
    await p.mouse.move(cx - vpc.width / 2 + 30, cy - vpc.height / 2 + 12); await p.mouse.down(); await p.mouse.move(cx - vpc.width / 2 + 180, cy - vpc.height / 2 + 92, { steps: 8 }); await p.mouse.up()
    const after = await until(() => { const x = readBoard('Holders'); const v = live(x).find((e) => e.id === vpc.id); return v && Math.abs(v.x - vpc.x - 150) < 3 && x }, 8000)
    const moved = (e0) => { const e = live(after).find((x) => x.id === e0.id); return e && [Math.round(e.x - e0.x), Math.round(e.y - e0.y)] }
    ok(after && moved(vpc)?.join() === '150,80' && moved(node)?.join() === '150,80' && moved(pic)?.join() === '150,80', 'dragging a container moves what\'s inside it with it', after && [moved(vpc), moved(node), moved(pic)])
    // The icon dragged by its picture: the node goes with it, the container stays. (A moment first,
    // for the last drag's picking to settle on a busy machine.)
    await sleep(500)
    await p.mouse.move(cx + 150, cy + 80 - 20); await p.mouse.down(); await p.mouse.move(cx + 150, cy + 80 + 30, { steps: 6 }); await p.mouse.up()
    // (It may snap a few pixels to line up with the container's middle.)
    const after2 = (await until(() => { const x = readBoard('Holders'); const n = live(x).find((e) => e.id === node.id); return n && n.y - node.y > 110 && x }, 15000)) || readBoard('Holders')
    const moved2 = (e0) => { const e = live(after2).find((x) => x.id === e0.id); return e && [Math.round(e.x - e0.x), Math.round(e.y - e0.y)] }
    const down = moved2(node)?.[1]
    ok(after2 && down > 115 && down < 145 && moved2(pic)?.join() === moved2(node)?.join() && moved2(vpc)?.join() === '150,80', 'dragging an icon by its picture (the container it\'s in still picked) moves its node and name with it, and not the container around it', after2 && [moved2(vpc), moved2(node), moved2(pic)])
    await p.keyboard.press('Escape')
    await shot(p, `${tag}whiteboard-v2-shapes`)
  })

  await part('auto-layout', async () => {
    const r = (id, x, y) => ({ id, type: 'rectangle', x, y, width: 140, height: 60, angle: 0, strokeColor: '#1f2733', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: [], updated: 1, link: null, locked: false })
    const a = (id, from, to) => ({ id, type: 'arrow', x: 0, y: 0, width: 10, height: 10, angle: 0, strokeColor: '#1f2733', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, points: [[0, 0], [10, 10]], startBinding: { elementId: from, focus: 0, gap: 4 }, endBinding: { elementId: to, focus: 0, gap: 4 }, startArrowhead: null, endArrowhead: 'arrow', elbowed: false })
    const els = [r('A', 700, 400), r('B', 0, 0), r('C', 300, 700), r('D', 900, 0), a('ab', 'A', 'B'), a('bc', 'B', 'C'), a('ad', 'A', 'D')]
    for (const e of els) if (e.type === 'rectangle') e.boundElements = els.filter((x) => x.type === 'arrow' && (x.startBinding.elementId === e.id || x.endBinding.elementId === e.id)).map((x) => ({ type: 'arrow', id: x.id }))
    await api('/boards', { title: 'Messy', source: { kind: 'excalidraw', text: JSON.stringify({ type: 'excalidraw', version: 2, elements: els, appState: {}, files: {} }) } })
    await openBoard('Messy')
    const lay = async (dir) => { await p.getByRole('button', { name: 'Auto-layout' }).click(); await p.getByRole('menuitem', { name: dir }).click() }
    const check = (j, across) => {
      const at = Object.fromEntries(live(j).filter((e) => e.type === 'rectangle').map((e) => [e.id, e]))
      const flows = [['A', 'B'], ['B', 'C'], ['A', 'D']].every(([s, t]) => (across ? at[t].x >= at[s].x + at[s].width + 20 : at[t].y >= at[s].y + at[s].height + 20))
      const list = Object.values(at)
      const apart = list.every((x, i) => list.every((y, k) => k <= i || x.x + x.width + 10 <= y.x || y.x + y.width + 10 <= x.x || x.y + x.height + 10 <= y.y || y.y + y.height + 10 <= x.y))
      return flows && apart
    }
    await lay('Left to right')
    ok(await until(() => check(readBoard('Messy'), true), 8000), 'Auto-layout, left to right, lays the shapes out so each arrow runs to the right, with room between them', live(readBoard('Messy')).filter((e) => e.type === 'rectangle').map((e) => [e.id, Math.round(e.x), Math.round(e.y)]))
    await lay('Top to bottom')
    ok(await until(() => check(readBoard('Messy'), false), 8000), 'and top to bottom, each arrow running down', live(readBoard('Messy')).filter((e) => e.type === 'rectangle').map((e) => [e.id, Math.round(e.x), Math.round(e.y)]))
    const arrows = live(readBoard('Messy')).filter((e) => e.type === 'arrow')
    ok(arrows.every((x) => x.startBinding && x.endBinding), 'its arrows still joined to their shapes', arrows.map((x) => [x.startBinding?.elementId, x.endBinding?.elementId]))
  })

  const AWS = 'A 3-tier web app on AWS with a load balancer, two app servers in private subnets and RDS'
  const board = 'A 3-tier web app on AWS with'
  await part('draw this with Refine', async () => {
    const before = model.requests().length
    await toList()
    await p.fill('.wb-ask textarea', AWS)
    await p.locator('.wb-ask').getByRole('button', { name: 'Draw' }).click()
    await p.waitForSelector('.excalidraw canvas', { timeout: 30000 })
    ok(await until(() => p.locator('.wb-rounds-head', { hasText: 'Done' }).count(), 30000), 'Draw this with Refine x3 runs its rounds and says it\'s done', await p.locator('.wb-draw').innerText().catch(() => ''))
    const j = await until(() => { const x = readBoard(board); return texts(x).includes('RDS') && x }, 10000)
    const els = live(j)
    const icons = els.filter((e) => e.type === 'image' && e.customData?.bridge?.icon)
    const boxes = els.filter((e) => holder(e) && holder(e) !== 'node')
    const vpc = boxes.find((e) => labelOf(els, e) === 'VPC'), lb = byLabel(els, 'Load balancer'), db = byLabel(els, 'RDS')
    ok(icons.length >= 5 && boxes.length >= 5 && vpc && lb && db && inside(lb, vpc) && inside(db, vpc), 'it\'s an architecture diagram: icons for the users, load balancer, app servers and database, inside a region, a VPC and subnets', els.map((e) => [e.type, holder(e), labelOf(els, e)]))
    const arrows = els.filter((e) => e.type === 'arrow')
    const square = (x) => x.points.slice(1).every((pt, i) => Math.abs(pt[0] - x.points[i][0]) < 1.5 || Math.abs(pt[1] - x.points[i][1]) < 1.5)
    ok(arrows.length === 5 && arrows.every((x) => x.elbowed && x.startBinding?.fixedPoint && x.endBinding?.fixedPoint && square(x)), 'its arrows turn at right angles and are joined to the shapes at fixed points', arrows.map((x) => [x.elbowed, !!x.startBinding?.fixedPoint, x.points.length]))
    ok(arrows.length === 5 && arrows.every((x) => labelOf(els, x)), 'each arrow ends up with a label, as the rounds put them on', arrows.map((x) => labelOf(els, x)))
    const chips = await p.locator('.wb-versions .chip').allInnerTexts()
    ok(chips.join('|') === 'Draft|Round 1|Round 2', 'each round is kept as a version: the draft and two rounds', chips)
    ok(/found nothing more to change/.test(await p.locator('.wb-rounds-head').innerText()), 'it stops early, before the third round, when the review finds nothing to change', await p.locator('.wb-rounds-head').innerText())
    ok(/4 calls/.test(await p.locator('.wb-cost').innerText()), 'and says what it cost: one call to draw and three reviews', await p.locator('.wb-cost').innerText())
    ok(/Labelled the arrow from Load balancer/.test(await p.locator('.wb-why').innerText()), 'the round shown says what it changed and why', await p.locator('.wb-why').innerText().catch(() => ''))
    const reviews = model.asked().slice(before).filter((q) => /^You drew a diagram for/.test(q))
    ok(reviews.length === 3 && reviews.every((q) => q.includes('[image]') && /Arrows with no label|nothing wrong/.test(q)), 'each review sends a picture of the board to a model that can see, with what the check found', reviews.map((q) => q.slice(0, 120)))
    const kept = await until(async () => { const r = await api(`/boards/${enc(board)}/rounds`); return r.rounds?.length === 3 && r }, 5000)
    ok(kept && kept.rounds[1].changes.length && kept.rounds[2].spec && kept.calls === 4, 'the rounds are kept beside the board, each with what it changed and its diagram', kept)
    await shot(p, `${tag}whiteboard-v2-refine`)
    const bare = (x) => live(x).filter((e) => e.type === 'arrow' && !labelOf(live(x), e)).length
    await p.locator('.wb-versions .chip', { hasText: 'Draft' }).click()
    ok(await until(() => bare(readBoard(board)) === 2, 8000), 'stepping back to the draft puts it back on the board (two arrows with no label)', bare(readBoard(board)))
    await p.locator('.wb-versions .chip', { hasText: 'Round 2' }).click()
    ok(await until(() => bare(readBoard(board)) === 0, 8000), 'and forward to the last round again', bare(readBoard(board)))
  })

  await part('PDF export', async () => {
    const early = pdfCode.length
    await p.locator('.wb-draw .win-btn[aria-label="Close"]').click().catch(() => {})
    await p.getByRole('button', { name: 'Export' }).click()
    const dl = await download('Export as PDF')
    const out = path.join(kit.dir, 'board.pdf')
    await dl.saveAs(out)
    const buf = fs.readFileSync(out)
    const words = pdfWords(buf)
    ok(dl.suggestedFilename() === `${board}.pdf` && buf.subarray(0, 5).toString() === '%PDF-' && /%%EOF\s*$/.test(buf.toString('latin1')), 'Export as PDF saves a PDF named after the board', [dl.suggestedFilename(), buf.subarray(0, 8).toString()])
    ok(/\(Load balancer\)/.test(words) && /\(RDS\)/.test(words) && /\(VPC\)/.test(words), 'with the board\'s words in it as text', words.match(/\([^)]{2,30}\) Tj/g)?.slice(0, 10))
    ok(/ re\b| l\b| c\b/.test(words), 'and its shapes as lines, not a picture')
    ok(!early && pdfCode.length > 0, 'its code loaded only then, not with the board', { early, pdfCode })
    await p.getByRole('button', { name: 'Export' }).click()
    await p.getByRole('radio', { name: 'Dark' }).click()
    const dark = await download('Export as PDF')
    const out2 = path.join(kit.dir, 'board-dark.pdf')
    await dark.saveAs(out2)
    const w2 = pdfWords(fs.readFileSync(out2))
    ok(/\(Load balancer\)/.test(w2) && w2 !== words && /0\.0[5-9]\d* 0\.0[5-9]\d* 0\.0[5-9]\d* rg|0\.07\d* 0\.07\d* 0\.07\d* rg/.test(w2), 'and dark, on a dark background', w2.match(/[\d.]+ [\d.]+ [\d.]+ rg/g)?.slice(0, 4))
  })

  await part('learning what the user likes', async () => {
    // The model drew it left to right; laid out top to bottom, that's a preference.
    await p.getByRole('button', { name: 'Auto-layout' }).click()
    await p.getByRole('menuitem', { name: 'Top to bottom' }).click()
    const prefs = () => { try { return JSON.parse(fs.readFileSync(path.join(BOARDS, 'preferences.json'), 'utf8')) } catch { return null } }
    ok(await until(() => prefs()?.prefs?.direction?.value === 'TB', 8000) && prefs().prefs.direction.evidence.at(-1)?.board === board, 'laying out the other way from how the model drew it is learnt, with the board it was learnt on', prefs())
    await p.getByRole('button', { name: 'Whiteboard Settings' }).click()
    ok(await until(() => p.locator('.wb-summary', { hasText: 'You like: Top to bottom' }).count(), 5000), 'the whiteboard\'s settings show it in words', await p.locator('.wb-settings').innerText().catch(() => ''))
    await shot(p, `${tag}whiteboard-v2-settings`)
    const before = model.requests().length
    await api('/boards/draw', { prompt: 'a payments service', kind: 'architecture' })
    ok(/lay diagrams out top to bottom/.test(model.asked().slice(before).join('\n')), 'and it goes with the next drawing\'s prompt', model.asked().slice(before).join('\n').slice(-300))
    await p.getByRole('button', { name: 'Forget Direction' }).click()
    ok(await until(() => prefs() && !prefs().prefs.direction, 5000) && await until(async () => !(await p.locator('.wb-summary', { hasText: 'Top to bottom' }).count()), 3000), 'Forget takes it out of the file and the settings')
    const before2 = model.requests().length
    await api('/boards/draw', { prompt: 'a payments service', kind: 'architecture' })
    ok(!/lay diagrams out top to bottom/.test(model.asked().slice(before2).join('\n')), 'and out of the next prompt')
    // One set by hand, before anything was learnt about it.
    await p.locator('.wb-pref-add').selectOption('iconSet:aws')
    ok(await until(() => prefs()?.prefs?.iconSet?.value === 'aws' && prefs().prefs.iconSet.set, 5000) && await until(() => p.locator('.wb-prefs li', { hasText: 'Set by you' }).count(), 3000), 'a preference can be set by hand in the settings, before it\'s learnt', prefs())
    const before3 = model.requests().length
    await api('/boards/draw', { prompt: 'a payments service', kind: 'architecture' })
    ok(/AWS icons \(the aws\. shapes\) where they fit/.test(model.asked().slice(before3).join('\n')) && /aws\.ec2/.test(model.asked().slice(before3).join('\n')), 'and the next prompt asks for it, offering the AWS shapes', model.asked().slice(before3).join('\n').slice(-300))
    await p.getByRole('button', { name: 'Forget Icons' }).click()
    ok(await until(() => prefs() && !prefs().prefs.iconSet, 5000), 'and forgotten the same way')
  })

  await part('the hand-drawn look', async () => {
    await p.getByRole('radio', { name: 'Hand-drawn' }).click()
    const j = await until(() => { const x = readBoard(board); const shapes = live(x).filter((e) => e.type === 'rectangle' && e.strokeColor !== 'transparent'); return shapes.length && shapes.every((e) => e.roughness === 1) && x }, 8000)
    ok(!!j && live(j).filter((e) => e.type === 'text').every((e) => e.fontFamily === 5), 'hand-drawn is there as an option: sketchy lines and a handwritten font', j && live(j).filter((e) => e.type === 'text').map((e) => e.fontFamily))
    await shot(p, `${tag}whiteboard-v2-sketch`)
    await p.getByRole('radio', { name: 'Clean' }).click()
    ok(await until(() => live(readBoard(board)).filter((e) => e.type === 'rectangle').every((e) => e.roughness === 0), 8000), 'and back to clean')
    await p.locator('.wb-settings .win-btn[aria-label="Close"]').click()
  })

  await part('PDF of what\'s selected', async () => {
    const word = (id, text, x) => ({ id, type: 'text', x, y: 0, width: text.length * 10, height: 25, angle: 0, strokeColor: '#1f2733', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, text, originalText: text, fontSize: 20, fontFamily: 6, textAlign: 'left', verticalAlign: 'top', containerId: null, autoResize: true, lineHeight: 1.25 })
    await api('/boards', { title: 'Picked', source: { kind: 'excalidraw', text: JSON.stringify({ type: 'excalidraw', version: 2, elements: [word('k', 'Kept words', 0), word('l', 'Left out words', 400)], appState: {}, files: {} }) } })
    try {
      await openBoard('Picked')
      await sleep(800)
      // The two words are drawn in the middle of the board, 400 apart: a box dragged round the first.
      const box = await canvasBox()
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2
      await p.mouse.move(cx - 340, cy - 70); await p.mouse.down(); await p.mouse.move(cx - 90, cy + 70, { steps: 6 }); await p.mouse.up()
      await shot(p, `${tag}whiteboard-v2-picked`)
      await p.getByRole('button', { name: 'Export' }).click()
      await p.getByLabel('Only what’s selected').check()
      const dl = await download('Export as PDF')
      const out = path.join(kit.dir, 'picked.pdf')
      await dl.saveAs(out)
      const words = pdfWords(fs.readFileSync(out))
      ok(words.startsWith('%PDF-') && /\(Kept words\)/.test(words) && !/Left out/.test(words), 'with Only what’s selected, the PDF has only the selection in it', words.match(/\([^)]{2,30}\) Tj/g))
    } finally {
      // Back to the drawn board whatever happened here, for the parts after this one.
      await p.keyboard.press('Escape').catch(() => {})
      await openBoard(board).catch(() => {})
      await api('/boards/Picked', null, 'DELETE').catch(() => {})
    }
  })

  await part('versions from another time', async () => {
    // The board opened again (after other boards): its last Refine is still there to pick from.
    await openBoard(board)
    if (await p.locator('.wb-draw').count()) await p.locator('.wb-draw .win-btn[aria-label="Close"]').click()
    await p.getByRole('button', { name: 'Draw this' }).first().click()
    const head = p.locator('.wb-rounds-head', { hasText: 'Last Refine' })
    ok(await until(() => head.count(), 5000) && (await p.locator('.wb-versions .chip').allInnerTexts()).join('|') === 'Draft|Round 1|Round 2' && /4 calls/.test(await head.innerText()), 'opened again later, Draw this shows the board\'s last Refine, its versions and what it cost', await p.locator('.wb-draw').innerText().catch(() => ''))
    const rds = () => texts(readBoard(board)).filter((x) => x === 'RDS').length
    const had = rds()
    await p.locator('.wb-versions .chip', { hasText: 'Round 1' }).click()
    ok(/Labelled the arrow from Load balancer/.test(await p.locator('.wb-why').innerText().catch(() => '')), 'a version picked says what that round changed')
    await p.getByRole('button', { name: 'Put this version on the board' }).click()
    ok(await until(() => rds() === had + 1, 8000), 'and Put this version on the board draws it beside what\'s there', [had, rds()])
    await shot(p, `${tag}whiteboard-v2-last-refine`)
  })

  await part('a model on this computer, in the app', async () => {
    const before = model.requests().length
    if (!(await p.locator('.wb-draw').count())) await p.getByRole('button', { name: 'Draw this' }).first().click()
    await p.locator('.wb-draw [role="tab"]', { hasText: 'Draw this' }).click()
    await p.locator('.wb-draw select.wb-model').selectOption('ollama:llama3.1:8b')
    const said = await p.locator('.wb-privacy').innerText()
    await p.fill('.wb-draw textarea', 'a local web app on AWS')
    await p.locator('.wb-draw').getByRole('button', { name: 'Draw', exact: true }).click()
    ok(/stay on this computer \(llama3\.1:8b\)/.test(said) && await until(() => p.locator('.wb-rounds-head', { hasText: 'the check found nothing more to fix' }).count(), 30000), 'with a model on this computer (the words said to stay on it), it draws and refines, stopping once the check finds nothing to fix', [said, await p.locator('.wb-rounds').innerText().catch(() => '')])
    const sent = model.requests().slice(before)
    const reviews = sent.filter((x) => /^You drew a diagram for/.test(x.messages.find((m) => m.role === 'user')?.content || ''))
    ok(sent.length > 0 && sent.every((x) => x.model === 'llama3.1:8b') && reviews.length === 2 && reviews.every((x) => typeof x.messages.find((m) => m.role === 'user').content === 'string'), 'everything goes to that model, and as it can\'t see, the reviews go without a picture', sent.map((x) => [x.model, typeof x.messages.at(-1).content]))
    ok(/4 calls/.test(await p.locator('.wb-cost').innerText()), 'counting the drawing asked twice and two rounds', await p.locator('.wb-cost').innerText())
    await shot(p, `${tag}whiteboard-v2-local`)
  })

  await part('the credit in About', async () => {
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
    const credit = p.getByText('Whiteboards are drawn with Excalidraw (MIT License).').first()
    ok(await until(() => credit.isVisible(), 8000) && await p.locator('a[href$="/blob/main/NOTICE"]').count(), 'Settings › About & Updates credits Excalidraw, beside the link to NOTICE')
  })

  ok(!errors.length, 'no page errors', errors)
  await ctx.close()

  await part('on a phone', async () => {
    const ph = await page(b, kit.url, { phone: true, store: { 'cc-ws': { tabs: [`view:whiteboard:${board}`], active: `view:whiteboard:${board}`, side: null, split: false, group: 'main' } }, before: async (c) => watch(c) })
    await ph.p.waitForSelector('.tabbar', { timeout: 30000 })
    await ph.p.keyboard.press('ControlOrMeta+k')
    await ph.p.keyboard.type('Whiteboards')
    await ph.p.keyboard.press('Enter')
    await ph.p.waitForSelector('.wb-home', { timeout: 15000 })
    await ph.p.locator('.wb-card', { hasText: board }).locator('.wb-thumb').click()
    await ph.p.waitForSelector('.excalidraw canvas', { timeout: 30000 })
    const fits = () => ph.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.wb-view .pane-head *, .wb-shapes *, .wb-settings *')].every((e) => { const r = e.getBoundingClientRect(); return !r.width || (r.left >= -1 && r.right <= window.innerWidth + 1) }))
    const closed = !(await ph.p.locator('.wb-shapes').count()) && await fits()
    await ph.p.getByRole('button', { name: 'Shapes' }).first().click()
    ok(closed && await until(() => ph.p.locator('.wb-shapes').isVisible(), 3000) && await fits(), 'on a phone the board\'s header fits with the Shapes panel closed, and it opens over the board when asked for, and fits')
    await shot(ph.p, `${tag}whiteboard-v2-phone-shapes`)
    await ph.p.locator('.wb-shapes .win-btn[aria-label="Close"]').click()
    await ph.p.getByRole('button', { name: 'Whiteboard Settings' }).click()
    ok(await until(() => ph.p.locator('.wb-settings').isVisible(), 3000) && await fits(), 'and so do the whiteboard\'s settings')
    ok(!ph.errors.length, 'no page errors on a phone', ph.errors)
    await ph.ctx.close()
  })
  ok(!elsewhere.length, 'nothing the page asks for goes anywhere but this computer', elsewhere)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close().catch(() => {})
  model.stop()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
