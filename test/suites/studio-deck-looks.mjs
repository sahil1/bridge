// A PowerPoint's look in Studio as PowerPoint draws it, in the browser named by BRIDGE_TEST_BROWSER:
// its backgrounds, masters, layouts and theme. A deck for each (test/lib/bgdecks.mjs), one thing on
// its slide: a master's picture stretched and tiled, a layout's background over its master's, a
// slide's over both, gradients down, at 45° and from the centre, see-through ones, a pattern, the
// theme's background styles, a dark master, a picture or shape over the whole slide from the master
// or layout, master graphics hidden by a slide and by a layout, the theme's fonts and the master's
// text styles, decks as PowerPoint for Mac, Google Slides and Keynote write them, and a picture a
// browser can't show (TIFF).
// The files (no page): each background read as the file has it (a picture's address and size, a
// gradient's angle and centre, a pattern, its nearest for a picture that can't be shown), a
// subtitle in the master's body style, a dark master's words light; the deck's look for a Markdown
// deck from its master's real background through its colour map; and each saved by Studio
// unchanged byte for byte, and with its words changed, everything but that slide as it was and the
// slide's own background too.
// The page: each opened (the first from Studio's Recent list, as you would), its slide in the
// middle, its thumbnail down the side and presenting, each looked at in its corners and centre
// against what the deck says (a colour, a gradient's ends, the picture's colours), a picture of
// each; see-through backgrounds still over white in dark mode; a background that can't be shown,
// said once; AI Assist's slides shown in the deck's colours; a Markdown deck of it keeping them. At
// 1440 wide and on a 390 phone, light and dark.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { startKit, startModel, checks, until, sleep, browser, page, shot, ROOT } from '../lib/harness.mjs'
import { bgCases, bgDeck, readPng, rgb, hexOf } from '../lib/bgdecks.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const JSZip = require('jszip')
const { ok, done } = checks('studio-deck-looks')
const X = await import(pathToFileURL(path.join(ROOT, 'src/components/studio/pptxdoc.js')).href)
const R = await import(pathToFileURL(path.join(ROOT, 'src/components/studio/pptxdraw.js')).href)
const P = await import(pathToFileURL(path.join(ROOT, 'src/components/studio/pptx.js')).href)
const kit = await startKit('studio-deck-looks')
const model = await startModel('studio-deck-looks')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const pages = []
const cases = bgCases()
const byName = Object.fromEntries(cases.map((c) => [c.name, c]))
const files = new Map()
for (const c of cases) files.set(c.name, await bgDeck(c.spec))
const parts = async (bytes) => { const z = await JSZip.loadAsync(bytes); const out = {}; for (const [n, f] of Object.entries(z.files)) if (!f.dir) out[n] = Buffer.from(await f.async('uint8array')); return out }
const far = (a, b2) => Math.max(...a.map((v, i) => Math.abs(v - b2[i])))
// A drawn slide (a picture of it) looked at where its deck says what it shows: the spots that are
// off by more than they may be, [{ at, want, got, off }] (none when it's right). A pattern's spot is
// the mean of the dots around it.
function offSpots(png, c, spots = c.spots) {
  const img = readPng(png)
  const out = []
  for (const [x, y, want, tol] of spots) {
    const px = x * (img.w - 1), py = y * (img.h - 1)
    let got = img.at(px, py)
    if (c.average) {
      const acc = [0, 0, 0]
      let n = 0
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const q = img.at(px + dx, py + dy); acc[0] += q[0]; acc[1] += q[1]; acc[2] += q[2]; n++ }
      got = acc.map((v) => v / n)
    }
    const off = far(got, rgb(want))
    if (off > tol) out.push({ at: [x, y], want, got: hexOf(got), off })
  }
  return out
}
// The mean colour of a whole picture (a small thumbnail of a tiled picture or a pattern).
function meanOf(png) {
  const img = readPng(png)
  const acc = [0, 0, 0]
  let n = 0
  for (let y = 2; y < img.h - 2; y += 2) for (let x = 2; x < img.w - 2; x += 2) { const q = img.at(x, y); acc[0] += q[0]; acc[1] += q[1]; acc[2] += q[2]; n++ }
  return acc.map((v) => v / n)
}
// A slide drawn in one of the places a deck is (thumb: a thumbnail), looked at: spot by spot, or
// as its mean colour where its dots are too small to look at one by one (a tile or a pattern in a
// thumbnail; and a tile in WebKit, which draws each tile a whole number of screen pixels wide, so at
// a zoom between its tiles drift a pixel or so each across the slide: there its first tile and its
// mean). A thumbnail's top right is under its menu's button.
const TILE_MEAN = ['E74C3C', '3498DB', '2ECC71', 'F39C12'].map(rgb).reduce((a, x) => a.map((v, i) => v + x[i] / 4), [0, 0, 0])
function offIn(png, c, { thumb = false } = {}) {
  const tiled = c.name === 'master-tiled' && (thumb || which === 'webkit')
  if (tiled || (thumb && c.average)) {
    const want = tiled ? TILE_MEAN : rgb(c.spots[0][2]), got = meanOf(png)
    return [...(far(got, want) > 24 ? [{ want: hexOf(want), got: hexOf(got) }] : []), ...(tiled && !thumb ? offSpots(png, c, c.spots.slice(0, 1)) : [])]
  }
  return offSpots(png, c, thumb ? c.spots.filter((_, i) => i !== 1) : c.spots)
}
// Looked at again until it's right (a picture can take a moment to be decoded), else the last look.
async function settle(fn, ms = 4000) {
  let last = null
  const end = Date.now() + ms
  do { last = await fn().catch((e) => [{ error: e.message }]); if (!last.length) return last; await sleep(150) } while (Date.now() < end)
  return last
}

try {
  // ---------- The files ----------
  const views = {}
  const docs = {}
  for (const c of cases) {
    const doc = await X.readPptx(files.get(c.name))
    doc.urlOf = (p) => `blob:${p}`
    docs[c.name] = doc
    views[c.name] = X.slideView(doc, doc.slides[0])
  }
  const v = (n) => views[n]
  const pics = ['master-picture', 'bgref-picture', 'mac', 'google'].map((n) => ({ n, bg: v(n).bg }))
  ok(pics.every(({ bg }) => bg.type === 'blip' && /^blob:ppt\/media\/image\d\.png$/.test(bg.url) && Math.round(bg.size.w) === 30) && /class="px-bg"[^>]*background:url\(&quot;blob:ppt\/media\/image1\.png&quot;\) 0px 0px \/ 1280px 720px no-repeat/.test(R.slideHtml(v('master-picture'))), 'a picture background (a master\'s, a theme\'s style\'s, as PowerPoint for Mac and Google Slides write it): its picture, stretched over the slide', pics.map(({ n, bg }) => ({ n, type: bg.type, url: bg.url, size: bg.size })))
  const tile = v('master-tiled').bg
  ok(tile.tile && tile.size.w === 32 && tile.size.h === 32 && /0px 0px \/ 32px 32px repeat/.test(R.bgHtml(tile, 1280, 720)), 'a tiled one: tiles its own size (32 px at the 96 dpi it says), from the top left', { tile: tile.tile, size: tile.size, html: R.bgHtml(tile, 1280, 720) })
  ok(v('layout-over-master').bg.color.hex === '065F46' && v('slide-over-both').bg.color.hex === '6D28D9' && v('layout-full-shape').under.length === 1 && v('slide-hides-master').under.length === 0 && v('layout-hides-master').under.map((o) => o.name).join() === 'Layout bar', 'a layout\'s background over its master\'s, a slide\'s over both; a layout\'s shape under the slide; master graphics hidden by a slide, and by a layout keeping its own', v('layout-hides-master').under.map((o) => o.name))
  const diag = v('gradient-diagonal').bg, radial = v('gradient-radial').bg
  const deg = (Math.atan2(1 / 720, 1 / 1280) * 180) / Math.PI + 90
  ok(diag.scaled && diag.angle === 45 && R.bgHtml(diag, 1280, 720).includes(`linear-gradient(${+deg.toFixed(2)}deg`) && radial.radial && radial.focus.x === 0.5 && /radial-gradient\(circle farthest-corner at 50% 50%, #FACC15 0%, #7C2D12 100%\)/.test(R.bgHtml(radial, 1280, 720)), 'gradients: one at 45° scaled to the slide (corner to corner), one from the centre out', { diag: R.bgHtml(diag, 1280, 720), radial: R.bgHtml(radial, 1280, 720) })
  ok(v('pattern').bg.type === 'pattern' && v('pattern').bg.prst === 'pct50' && /data:image\/bmp;base64,/.test(R.bgHtml(v('pattern').bg, 1280, 720)) && /class="px-slide" style="[^"]*background:#fff">/.test(R.slideHtml(v('see-through'))), 'a pattern in its two colours; a see-through background over white', v('pattern').bg)
  ok(v('tiff').bgLost === 'TIFF' && v('tiff').bg.color.hex === 'E0F2FE' && !v('master-picture').bgLost, 'a background picture a browser can\'t show (TIFF): said, and its nearest drawn (the colour the master makes the background)', { lost: v('tiff').bgLost, bg: v('tiff').bg })
  const runOf = (o) => o.text.paras[0].runs[0]
  const [title, sub] = v('theme-fonts').objs.map(runOf)
  ok(title.font === 'Georgia' && title.b && title.color.hex === 'ED7D31' && title.sz === 54 && sub.font === 'Courier New' && !sub.b && sub.color.hex === '000000' && v('theme-fonts').objs[1].text.paras[0].bullet?.text === '•', 'the theme\'s fonts and the master\'s styles: the title in its title style (the heading font, bold, accent 2, 54 pt), the subtitle in its body style, not the title\'s', { title, sub })
  const dark = v('dark-master')
  ok(dark.bg.color.hex === '111827' && runOf(dark.objs[0]).color.hex === 'FFFFFF' && runOf(dark.objs[2]).color.hex === 'D1D5DB', 'a dark master: its background dk1 and its words lt1, through its colour map', { bg: dark.bg, words: dark.objs.map((o) => runOf(o).color) })
  ok(v('keynote').objs[0].img.alpha === 0.5 && /opacity:0\.5/.test(R.slideHtml(v('keynote'))) && v('mac').under.length === 1 && v('mac').under[0].fill.color.hex === 'B4C7E7', 'a picture made half see-through (Keynote); PowerPoint for Mac\'s alternate content and its colours made lighter', { keynote: v('keynote').objs[0].img, mac: v('mac').under.map((o) => o.fill) })
  // A Markdown deck of it: its master's background as it's drawn, through its colour map.
  const lookOf = async (n) => (await P.deckFromPptx(files.get(n), `${n}.pptx`)).look.colors
  const looks = { dark: await lookOf('dark-master'), layout: await lookOf('layout-over-master'), ref: await lookOf('bgref-solid'), tiff: await lookOf('tiff'), plain: await lookOf('solid') }
  ok(looks.dark.background === '#111827' && looks.dark.text === '#ffffff' && looks.layout.background === '#b91c1c' && looks.ref.background === '#5b9bd5' && looks.tiff.background === '#e0f2fe' && looks.plain.background === '#ffffff' && looks.plain.text === '#000000', 'a Markdown deck of it: its master\'s background (a dark one dk1, a theme style\'s colour), its words\' colour through the colour map', looks)
  // Saved by Studio: unchanged, every part byte for byte; its words changed, all but that slide as
  // they were, and the slide's own background too.
  const moved = []
  for (const c of cases) {
    const doc = docs[c.name]
    const before = await parts(files.get(c.name))
    const same = await parts(await X.writePptx(doc, doc.slides))
    if (Object.keys(before).length !== Object.keys(same).length || !Object.keys(before).every((n) => same[n]?.equals(before[n]))) moved.push(`${c.name}: unchanged`)
    const s = doc.slides[0]
    const at = X.textsOf(s)[0]
    const changed = X.withTextAt(s, at, { ...at.t, paras: at.t.paras.map((p, i) => (i ? p : { ...p, runs: [{ ...p.runs[0], text: 'Changed here' }] })) })
    const after = await parts(await X.writePptx(doc, [changed]))
    const bgOf = (x) => /<p:bg>[\s\S]*?<\/p:bg>/.exec(x?.toString() || '')?.[0] || ''
    const others = Object.keys(before).filter((n) => n !== 'ppt/slides/slide1.xml')
    if (!others.every((n) => after[n]?.equals(before[n])) || bgOf(after['ppt/slides/slide1.xml']) !== bgOf(before['ppt/slides/slide1.xml']) || !/Changed here/.test(after['ppt/slides/slide1.xml'])) moved.push(`${c.name}: changed`)
  }
  ok(!moved.length, 'saved by Studio: each deck unchanged byte for byte; with its words changed, its masters, layouts, theme and pictures as they were, and its slide\'s own background', moved)

  // ---------- The page ----------
  await api('/setup', { name: 'Tester' })
  await api('/settings', { trials: { studio: true } }, 'PATCH')
  const dir = path.join(kit.home, 'Work', 'looks')
  fs.mkdirSync(dir, { recursive: true })
  for (const c of cases) fs.writeFileSync(path.join(dir, `${c.name}.pptx`), files.get(c.name))
  const place = (await api('/places', { path: dir })).place
  const root = `place:${place.id}`
  const w = await page(b, kit.url, { width: 1440, height: 900 })
  pages.push(w)
  const p = w.p
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  const canvas = (pp) => pp.locator('.px-canvas .px-draw > .px-slide')
  // Opened, and its slide showing (its title, or the words it has).
  const showing = (pp, c) => until(async () => (await pp.locator(`.sd-dl-btn[download="${c.name}.pptx"]`).count()) === 1 && (await pp.locator('.px-canvas').innerText()).includes(c.mark), 3000, 100)
  const open = async (pp, c) => until(async () => { await pp.evaluate(({ root, name }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: name } })), { root, name: `${c.name}.pptx` }); return showing(pp, c) }, 30000, 300)
  // The first from Studio's Recent list, as the deck you'd open.
  const first = byName.mac
  await until(async () => { await p.locator('.rail-nav-btn', { hasText: 'Studio' }).click(); return p.locator('.sd-home').waitFor({ timeout: 1500 }).then(() => true, () => false) }, 20000, 300)
  const row = p.locator('.sd-files-row', { hasText: 'mac.pptx' })
  ok(!!(await until(async () => (await row.count()) > 0, 20000, 300)), 'the decks listed in Studio\'s Recent')
  await row.first().locator('.sd-file-name').click()
  ok(!!(await showing(p, first)), 'a deck opened from Studio\'s Recent list, as PowerPoint for Mac saved it')
  const bad = { editor: [], thumbs: [], present: [] }
  const thumb = () => p.locator('.sd-strip .sd-thumb.on .px-slide-box')
  for (const c of [first, ...cases.filter((x) => x !== first)]) {
    if (c !== first && !(await open(p, c))) { bad.editor.push({ name: c.name, error: 'didn\'t open' }); continue }
    const off = await settle(async () => offIn(await canvas(p).screenshot(), c))
    if (off.length) bad.editor.push({ name: c.name, off })
    await shot(p, `${tag}looks-${c.name}`)
    // Down the side: a thumbnail 160 px wide.
    const toff = await settle(async () => offIn(await thumb().screenshot(), c, { thumb: true }))
    if (toff.length) bad.thumbs.push({ name: c.name, off: toff })
    // Presenting: the slide alone, as big as the screen lets it.
    await p.locator('.sd-deck-tools button[aria-label="Present"]').click()
    await p.locator('.sd-present').waitFor({ timeout: 5000 })
    await p.mouse.move(5, 5)
    const poff = await settle(async () => offIn(await p.locator('.sd-present-stage .px-slide-box').screenshot(), c))
    if (poff.length) bad.present.push({ name: c.name, off: poff })
    if (c.name === 'master-picture') await shot(p, `${tag}looks-present`)
    await p.keyboard.press('Escape')
    await until(async () => (await p.locator('.sd-present').count()) === 0, 3000, 50)
  }
  ok(!bad.editor.length, `each deck's slide in the middle as PowerPoint draws it (${cases.length} decks): its background at its corners and centre`, bad.editor)
  ok(!bad.thumbs.length, 'and its thumbnail down the side', bad.thumbs)
  ok(!bad.present.length, 'and presenting', bad.present)
  // What it can't show, said once; the rest say nothing of it.
  await open(p, byName.tiff)
  const said = await p.locator('.sd-deck-said').innerText().catch(() => '')
  ok(/A background picture on its slides can't be shown here \(TIFF\): they show the theme's background colour in its place/.test(said), 'a TIFF background: said, once, over the slides', said)
  await open(p, byName.mac)
  ok((await p.locator('.sd-deck-said').count()) === 0, 'a deck Studio draws all of says nothing of it')
  // The theme's fonts and the master's styles, as the page draws them.
  await open(p, byName['theme-fonts'])
  const fontsDrawn = await p.evaluate(() => [...document.querySelectorAll('.px-canvas .px-draw > .px-slide > [data-o] span[data-r]')].map((s) => { const c = getComputedStyle(s); return { font: c.fontFamily.split(',')[0].replace(/['"]/g, ''), weight: c.fontWeight, color: c.color, size: c.fontSize } }))
  ok(fontsDrawn.length === 2 && fontsDrawn[0].font === 'Georgia' && Number(fontsDrawn[0].weight) >= 700 && fontsDrawn[0].color === 'rgb(237, 125, 49)' && fontsDrawn[0].size === '72px' && fontsDrawn[1].font === 'Courier New' && fontsDrawn[1].color === 'rgb(0, 0, 0)', 'drawn in them: the title in Georgia, bold, accent 2 at 54 pt, the subtitle in Courier New', fontsDrawn)

  // AI Assist's slides, shown before they're kept, in the deck's own colours.
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { meetings: { model: 'openai:gpt-5' } }, 'PATCH')
  await open(p, byName['dark-master'])
  await p.locator('.sd-file .pane-head button[aria-label="AI Assist"]').click()
  await p.locator('.ai-menu button', { hasText: 'Write the deck' }).click()
  await p.locator('.sd-ai textarea').fill('Our quarter')
  await p.locator('.sd-ai button', { hasText: 'Write the deck' }).click()
  const shown = p.locator('.sd-ai-result .sd-slide').nth(1)
  await shown.waitFor({ timeout: 15000 })
  const aiOff = await settle(async () => offSpots(await shown.screenshot(), byName['dark-master'], [[0.5, 0.97, '111827', 6], [0.03, 0.97, '111827', 6]]))
  ok(!aiOff.length, 'AI Assist\'s slides shown in the deck\'s own colours (a dark master\'s), not Studio\'s white', aiOff)
  await shot(p, `${tag}looks-ai`)
  await p.locator('.sd-ai-head button[aria-label="Close AI Assist"]').click()
  // A Markdown deck of it, beside it: its master's background and words' colour kept, and drawn so.
  await p.locator('.px-row button[aria-label="Export"]').click()
  await p.locator('.sd-tool-menu .menu-item', { hasText: 'Markdown deck, beside it' }).click()
  const mdPath = path.join(dir, 'dark-master.md')
  ok(!!(await until(() => fs.existsSync(mdPath) && /^background: "#111827"$/m.test(fs.readFileSync(mdPath, 'utf8')) && /^textColor: "#ffffff"$/m.test(fs.readFileSync(mdPath, 'utf8')), 10000, 100)), 'a Markdown deck of it, beside it, keeping its background and its words\' colour', fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8').slice(0, 200) : 'not made')
  await until(async () => { await p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'dark-master.md' } })), { root }); return p.locator('.sd-canvas section[id]').waitFor({ timeout: 3000 }).then(() => true, () => false) }, 30000, 300)
  const mdOff = await settle(async () => offSpots(await p.locator('.sd-canvas section[id]').first().screenshot(), byName['dark-master'], [[0.03, 0.96, '111827', 6], [0.5, 0.96, '111827', 6]]))
  const h1 = await p.locator('.sd-canvas section[id] h1').first().evaluate((e) => getComputedStyle(e).color).catch(() => '')
  ok(!mdOff.length && h1 === 'rgb(255, 255, 255)', 'and opened, drawn in them: dark, its title white', { mdOff, h1 })
  ok(w.errors.length === 0, 'no page errors', w.errors)

  // Dark: a see-through background still over white, not the page's dark; a dark master as it is.
  const dk = await page(b, kit.url, { mode: 'dark', width: 1440, height: 900 })
  pages.push(dk)
  await dk.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  const darkBad = []
  for (const n of ['see-through', 'solid-alpha', 'dark-master', 'master-picture']) {
    const c = byName[n]
    if (!(await open(dk.p, c))) { darkBad.push({ n, error: 'didn\'t open' }); continue }
    const off = await settle(async () => offSpots(await canvas(dk.p).screenshot(), c))
    if (off.length) darkBad.push({ n, off })
    await shot(dk.p, `${tag}looks-dark-${n}`)
  }
  ok(!darkBad.length, 'dark: a see-through background over white as PowerPoint has it, not over the page; a dark master and a picture as they are', darkBad)
  ok(dk.errors.length === 0, 'dark: no page errors', dk.errors)

  // A phone: the slide as it is, its thumbnails in the grid.
  for (const mode of ['light', 'dark']) {
    const ph = await page(b, kit.url, { mode, phone: true })
    pages.push(ph)
    await ph.p.waitForSelector('.m-tabs, .rail-nav-btn, .m-more-row', { timeout: 20000 }).catch(() => {})
    const c = byName.mac
    if (await open(ph.p, c)) {
      const off = await settle(async () => offSpots(await canvas(ph.p).screenshot(), c))
      ok(!off.length, `phone (${mode}): a deck's picture background as it is`, off)
    } else ok(false, `phone (${mode}): the deck opened`)
    await shot(ph.p, `${tag}looks-phone-${mode}`)
    ok(ph.errors.length === 0, `phone (${mode}): no page errors`, ph.errors)
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const x of pages) await x.ctx.close().catch(() => {})
  await b.close()
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
