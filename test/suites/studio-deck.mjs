// Studio's decks, on any platform, in the browser named by BRIDGE_TEST_BROWSER. A Markdown deck
// (Marp's format) and a PowerPoint in a folder you added to Files (a place).
// The files (no page): a deck's slides found as Marp finds them; slides added, duplicated, moved,
// deleted, laid out, noted and pictured by changing its Markdown; what's typed on a slide put back
// on its own lines; a PowerPoint made of it with a layout per kind of slide, placeholders for its
// titles and text, notes, pictures, its look in its theme, and every paragraph's properties once
// (or PowerPoint offers to repair it); and read back into the same deck (a round trip, twice); a
// PowerPoint made elsewhere read too; a skipped slide; a picture of every common kind, and crafted
// ones that made image-size up to 2.0.2 loop forever, in a process killed if it hangs. A
// PowerPoint as itself (pptxdoc.js and the rest): read and drawn as PowerPoint draws it, saved
// unchanged byte for byte, its words changed in their runs, and changed and saved with only what
// changed written.
// The server: a picture saved beside a deck; AI writing a deck from what it's about or a document,
// rewriting a slide, adding one; no model, said.
// The page: the slides down the side and the slide in the middle; typing a title right on the
// slide, and a point (Enter for the next, Tab in a level); "Click to add title" where a slide has
// none; a new slide in a layout, duplicated, moved by dragging and by keys, deleted, undone; its
// layout and theme from the galleries; a picture; speaker notes; the grid of every slide;
// presenting full screen, next and back, the presenter's view; AI Assist (the header's, and Rewrite
// on the slide) writing a deck shown before it's taken; the PowerPoint; slides picked together, copied, skipped; find and replace; zoom; the
// Markdown kept as it was where it wasn't touched. A PowerPoint edited as itself: typed in place,
// shapes, pictures and a table put in and handled, copied, undone; presented; saved over itself
// keeping everything it didn't change; in Focus, its slide bigger, Esc letting go of the shapes
// picked before it leaves. At 1440 wide and on a 390 phone, light and dark.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { startKit, startModel, checks, until, sleep, browser, page, shot, phoneFaults, noServiceWorker, ROOT } from '../lib/harness.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const JSZip = require('jszip')
const { ok, done } = checks('studio-deck')
const D = await import(pathToFileURL(path.join(ROOT, 'src/components/studio/deck.js')).href)
const P = await import(pathToFileURL(path.join(ROOT, 'src/components/studio/pptx.js')).href)
const kit = await startKit('studio-deck')
const model = await startModel('studio-deck')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const err = (p, body, method) => api(p, body, method).then(() => null, (e) => e)
const pages = []
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const PNG = fs.readFileSync(path.join(ROOT, 'public', 'apple-touch-icon.png'))
const DECK = `---
marp: true
title: Q4 pitch
paginate: true
---

<!-- _class: title -->

# Q4 pitch

## Pricing that grows with you

<!-- Open with the story -->

---

# Why now

- Customers **asked** for it
  - Twelve in October
- It is *ready*

<!-- Say the numbers -->

---

<!-- _class: stats -->

# What changed

- **42%** of trials convert
- **3x** more seats

---

<!-- _class: cols -->

# Before and after

### Before

- Slow

### After

- Fast

---

<!-- _class: quote -->

> Finally, pricing that makes sense.

A customer

---

| Plan | Price |
| --- | --- |
| Team | 12 |
`
// Each slide's words, as a list, to compare decks by.
const words = (md) => P.slidesOf(md).map((s) => [s.layout, P.plain(s.title), P.plain(s.subtitle), ...s.blocks.flatMap((x) => (x.items ? x.items.map((i) => `${'>'.repeat(i.level)}${P.plain(i.runs)}`) : x.rows ? x.rows.flat().map(P.plain) : [P.plain(x.runs)])), s.notes].filter(Boolean).join(' | '))

try {
  // ---------- The files ----------
  const r = D.deckRenderer()
  const out = r.render(DECK)
  const st = D.structure(DECK, out.maps)
  ok(st.slides.length === 6 && out.slides.length === 6 && D.slideText(st, 1).startsWith('# Why now') && D.notesOf(D.slideText(st, 1)) === 'Say the numbers', 'a deck\'s slides, where Marp finds them, each with its notes', st.slides)
  ok(['title', 'content', 'stats', 'cols', 'quote', 'content'].join() === st.slides.map((_, i) => D.layoutOf(D.slideText(st, i))).join(), 'each slide\'s layout, from its class', st.slides.map((_, i) => D.layoutOf(D.slideText(st, i))))
  ok(/data-ln="16:17"[^>]*>Why now/.test(out.slides[1]) && /data-tl="18:19"/.test(out.slides[1]), 'each block drawn with the lines it came from', out.slides[1].slice(0, 600))
  let m = D.duplicateSlide(st, 1)
  let s2 = D.structure(m, r.render(m).maps)
  ok(s2.slides.length === 7 && D.slideText(s2, 2) === D.slideText(st, 1), 'duplicated: the same slide after it')
  m = D.moveSlide(st, 0, 2)
  s2 = D.structure(m, r.render(m).maps)
  ok(D.slideText(s2, 2) === D.slideText(st, 0) && D.slideText(s2, 0) === D.slideText(st, 1) && m.startsWith('---\nmarp: true\ntitle: Q4 pitch'), 'moved: the first slide third, the front matter where it was')
  m = D.removeSlide(st, 5)
  ok(!/\| Plan/.test(m) && D.structure(m, r.render(m).maps).slides.length === 5, 'deleted: the table slide gone')
  ok(D.withLayout('# A\n\n- b\n\n![](x.png)', 'image') === '<!-- _class: image -->\n\n# A\n\n- b\n\n![bg right:42%](x.png)' && D.layoutOf(D.withLayout('<!-- _class: title invert -->\n# A', 'section')) === 'section' && /class: section invert/.test(D.withLayout('<!-- _class: title invert -->\n# A', 'section')), 'a layout set: its class, its other classes kept, its picture where the layout has it')
  ok(D.withNotes('# A\n\n<!-- old -->\n<!-- _class: x -->', 'new --> one') === '# A\n\n<!-- _class: x -->\n\n<!-- new —> one -->', 'notes changed: the old ones out, directives kept, a --> that would end them made safe', D.withNotes('# A\n\n<!-- old -->\n<!-- _class: x -->', 'new --> one'))
  ok(/!\[bg\]\(p\.png\)/.test(D.withPicture('<!-- _class: title -->\n\n# A', 'p.png')) && D.layoutOf(D.withPicture('<!-- _class: title -->\n\n# A', 'p.png')) === 'picture' && /bg right:42%\]\(q\.png/.test(D.withPicture('# A\n\n- b', 'q.png')), 'a picture: a title slide becomes a full picture, a slide of points text and picture')
  ok(D.withText(DECK, 16, 17, 'Why *now*') === DECK.replace('# Why now', '# Why *now*') && D.withText(DECK, 18, 19, 'Customers asked') === DECK.replace('- Customers **asked** for it', '- Customers asked') && D.withText(DECK, 19, 20, 'Twelve, or more') === DECK.replace('  - Twelve in October', '  - Twelve, or more'), 'typed on a slide: only its own line changes, what starts it kept (# , - , its indent)')
  ok(D.indentLine(DECK, 20) === DECK.replace('- It is *ready*', '  - It is *ready*') && D.indentLine(DECK.replace('- It is *ready*', '  - It is *ready*'), 20, true) === DECK && D.indentLine(DECK, 18) === DECK, 'Tab: in a level under the point before; ⇧Tab: back out; the first point can\'t go in')
  const g = D.ghostsOf(D.structure('---\nmarp: true\n---\n\n<!-- _class: stats -->\n', r.render('---\nmarp: true\n---\n\n<!-- _class: stats -->\n').maps), 0, { title: 'T', subtitle: 'S', text: 'X', quote: 'Q' })
  ok(g.map((x) => `${x.ph}@${x.at}`).join() === 'title@6,text@6', 'an empty slide shows where its title and text go', g)
  const ghosted = r.render('---\nmarp: true\n---\n\n<!-- _class: stats -->\n', g).slides[0]
  ok(/data-ph="title" data-at="6"[^>]*>T</.test(ghosted) && /data-ph="text"/.test(ghosted), 'drawn where they go, marked to be clicked', ghosted.slice(200, 900))

  // The PowerPoint: a layout per kind, placeholders, notes, pictures, its look in its theme.
  const look = D.LOOKS.find((l) => l.name === 'Ember')
  const withPic = DECK.replace('# Why now\n', '<!-- _class: image -->\n\n# Why now\n').replace('<!-- Say the numbers -->', '![bg right:42%](p.png)\n\n<!-- Say the numbers -->')
  const bytes = await P.pptxOf(P.slidesOf(withPic), look, { image: async (src) => (src === 'p.png' ? `data:image/png;base64,${PNG.toString('base64')}` : null), title: 'Q4 pitch' })
  const zip = await JSZip.loadAsync(bytes)
  const part = (n) => zip.file(n)?.async('string') || ''
  const types = await part('[Content_Types].xml')
  const pres = await part('ppt/presentation.xml')
  const layouts = await Promise.all(Object.keys(zip.files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n)).map(part))
  const names = layouts.map((x) => /<p:cSld name="([^"]+)"/.exec(x)?.[1]).filter(Boolean)
  const slideXml = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => part(`ppt/slides/slide${n}.xml`)))
  ok((pres.match(/<p:sldId /g) || []).length === 6 && [1, 2, 3, 4, 5, 6].every((n) => types.includes(`/ppt/slides/slide${n}.xml`)) && /presentationml\.slideMaster/.test(types) && /notesSlide/.test(types), 'PowerPoint: six slides, each in its content types, a master, notes', { slides: (pres.match(/<p:sldId /g) || []).length })
  ok(['Title', 'Text and Picture', 'Big Numbers', 'Two Columns', 'Quote', 'Title and Text'].every((n) => names.includes(n)), 'a layout of its own for each kind of slide, named as PowerPoint shows them', names)
  ok(/<p:ph[^>]*type="title"/.test(slideXml[0]) && />Q4 pitch</.test(slideXml[0]) && /<p:ph[^>]*type="body"/.test(slideXml[1]) && /<a:buChar/.test(slideXml[1]) && /lvl="1"/.test(slideXml[1]), 'titles in title placeholders, points in body placeholders with their bullets and levels')
  const twice = slideXml.map((x) => [...x.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].filter((p) => (p[1].match(/<a:pPr\b/g) || []).length > 1).length).reduce((a, b) => a + b, 0)
  ok(twice === 0 && slideXml.every((x) => !/<a:pPr\b[^>]*>(?:(?!<\/a:pPr>)[\s\S])*<\/a:pPr>[\s\S]*?<a:r>[\s\S]*?<a:pPr/.test(x.split('</a:p>')[0] || '')), 'every paragraph\'s properties once, before its words (or PowerPoint offers to repair the file)', twice)
  ok(Object.keys(zip.files).some((n) => /^ppt\/media\/.+\.png$/.test(n)) && /r:embed/.test(slideXml[1]), 'the picture in the file, on its slide')
  const notes = await Promise.all(Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).map(part))
  ok(notes.some((x) => />Say the numbers</.test(x)) && notes.some((x) => />Open with the story</.test(x)), 'speaker notes on the notes pages')
  const theme = await part('ppt/theme/theme1.xml')
  ok(/<a:accent1><a:srgbClr val="D9502B"\/>/.test(theme) && /<a:majorFont>\s*<a:latin typeface="Georgia"/.test(theme), 'its look as the file\'s theme: the accent and the headings\' font', theme.slice(theme.indexOf('<a:clrScheme'), theme.indexOf('<a:clrScheme') + 400))
  // Read back: the same slides, twice over.
  const back = await P.deckFromPptx(bytes, 'Q4 pitch.pptx')
  const plainDeck = withPic.replace(/!\[bg right:42%\]\(p\.png\)/, '![bg right:42%](media:1.png)')
  ok(JSON.stringify(words(back.md)) === JSON.stringify(words(plainDeck)), 'read back: every slide\'s layout, title, subtitle, points (and their levels), table and notes as they were', { back: words(back.md), was: words(plainDeck) })
  ok(back.media.length === 1 && back.media[0].bytes.length === PNG.length && back.look.colors.accent === '#d9502b' && back.look.fonts.heading === 'Georgia', 'and its picture, and its look', { media: back.media.map((x) => x.id), look: back.look })
  const again = await P.deckFromPptx(await P.pptxOf(P.slidesOf(back.md), back.look, { image: async () => `data:image/png;base64,${PNG.toString('base64')}` }), 'Q4 pitch.pptx')
  ok(again.md === back.md, 'written and read again: the same deck', again.md)
  // Pictures of every common kind, and crafted ones that made image-size up to 2.0.2 (a picture
  // sizer pptxgenjs brings) loop forever: an ICNS entry, a JPEG XL jxlp box and a HEIF ispe box of
  // size 0. Each run in a process of its own, killed if it doesn't finish, so a hang fails here.
  const be32 = (n) => { const x = Buffer.alloc(4); x.writeUInt32BE(n); return x }
  const box = (name, body) => Buffer.concat([be32(8 + body.length), Buffer.from(name), body])
  const CRAFTED = {
    icns: Buffer.concat([Buffer.from('icns'), be32(64), Buffer.from('ic07'), be32(8), Buffer.from('ic08'), be32(0), Buffer.alloc(40)]),
    jxl: Buffer.concat([box('JXL ', Buffer.from([13, 10, 135, 10])), box('ftyp', Buffer.from('jxl \0\0\0\0jxl ', 'latin1')), be32(0), Buffer.from('jxlp'), Buffer.alloc(24)]),
    heic: Buffer.concat([box('ftyp', Buffer.from('heic\0\0\0\0mif1heic', 'latin1')), box('meta', Buffer.concat([be32(0), box('iprp', box('ipco', Buffer.concat([be32(0), Buffer.from('ispe'), Buffer.alloc(12)])))]))]),
  }
  const PICS = {
    'a.png': `data:image/png;base64,${PNG.toString('base64')}`,
    'a.jpg': 'data:image/jpeg;base64,/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAQABgDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAQF/8QAHBAAAQQDAQAAAAAAAAAAAAAAEQAFE2ESFSNC/8QAFgEBAQEAAAAAAAAAAAAAAAAABAMF/8QAHhEAAQEJAAAAAAAAAAAAAAAAABITIiMxUWFigZH/2gAMAwEAAhEDEQA/ALGhq2cvaKMeciTdI7tWsi7SyHziALtGh11kvGWQesQDVo7uuzi4xRn1kSKpAcRc2YzbHVOzM1ERSEn/2Q==',
    'a.gif': 'data:image/gif;base64,R0lGODdhGAAQAJEAAAAAANlQK////wAAACH5BAkAAAMALAAAAAAYABAAAAIdjI+py+0PYxO0UmmsxUFX7l1YKICh6aEax7bu2xYAOw==',
    'a.webp': 'data:image/webp;base64,UklGRmYAAABXRUJQVlA4IFoAAAAQBACdASoYABAAPtFUo0uoJKMhsAgBABoJagC7LoAs//JQAHXOQw+oAAD51ohvwG0JH+V657Psw1K/MBFX83j//VUGNowUzWdH2PcBXydkeZWZvm9JnXPfAAA=',
    'a.svg': `data:image/svg+xml;base64,${fs.readFileSync(path.join(ROOT, 'public', 'icon.svg')).toString('base64')}`,
    ...Object.fromEntries(Object.entries(CRAFTED).map(([k, v]) => [`a.${k}`, `data:image/${k};base64,${v.toString('base64')}`])),
  }
  const picDeck = `---\nmarp: true\n---\n\n${Object.keys(PICS).map((n) => `# ${n}\n\n- a point\n\n![bg right:42%](${n})`).join('\n\n---\n\n')}\n`
  const picMade = spawnSync(process.execPath, ['--input-type=module', '-e', `import { pptxOf, slidesOf } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'src/components/studio/pptx.js')).href)}
let s = ''; for await (const c of process.stdin) s += c
const { deck, pics } = JSON.parse(s)
process.stdout.write(Buffer.from(await pptxOf(slidesOf(deck), null, { image: async (src) => pics[src] || null })).toString('base64'))`], { input: JSON.stringify({ deck: picDeck, pics: PICS }), timeout: 30_000, encoding: 'utf8', maxBuffer: 64 << 20 })
  const picZip = picMade.status === 0 ? await JSZip.loadAsync(Buffer.from(picMade.stdout, 'base64')).catch(() => null) : null
  const picMedia = picZip ? Object.keys(picZip.files).filter((n) => /^ppt\/media\/.+\.\w+$/.test(n)).map((n) => n.split('.').pop()) : []
  ok(!!picZip && ['png', 'jpeg', 'gif', 'webp', 'svg', 'icns', 'jxl', 'heic'].every((x) => picMedia.includes(x)), 'a PowerPoint with a picture of every common kind, and crafted ICNS, JPEG XL and HEIF ones, made in seconds with each in it', { status: picMade.status, signal: picMade.signal, error: picMade.error?.code, stderr: picMade.stderr?.slice(0, 400), media: picMedia })
  const sized = spawnSync(process.execPath, ['-e', `const m = require('image-size'), f = m.imageSize || m
for (const [k, v] of Object.entries(${JSON.stringify(Object.fromEntries(Object.entries(CRAFTED).map(([k, v]) => [k, v.toString('base64')])))})) { try { f(Buffer.from(v, 'base64')); console.log(k, 'sized') } catch (e) { console.log(k, e.message) } }`], { cwd: ROOT, timeout: 10_000, encoding: 'utf8' })
  ok(sized.status === 0 && sized.stdout.trim().split('\n').length === 3, 'image-size itself turns the crafted pictures down at once rather than looping (2.0.3 or later, set in package.json\'s overrides)', { status: sized.status, signal: sized.signal, error: sized.error?.code, out: sized.stdout, stderr: sized.stderr?.slice(0, 400) })
  // A PowerPoint made elsewhere: text boxes and PowerPoint's own layout names.
  const PptxGenJS = require('pptxgenjs')
  const other = new PptxGenJS()
  other.layout = 'LAYOUT_16x9'
  const o1 = other.addSlide()
  o1.addText('Made elsewhere', { x: 0.5, y: 0.3, w: 9, h: 1, fontSize: 32 })
  o1.addText([{ text: 'One point', options: { bullet: true, breakLine: true } }, { text: 'A deeper one', options: { bullet: true, indentLevel: 1 } }], { x: 0.5, y: 1.5, w: 9, h: 3 })
  o1.addNotes('Elsewhere notes')
  const elsewhere = await P.deckFromPptx(new Uint8Array(await other.write({ outputType: 'arraybuffer' })), 'other.pptx')
  ok(/Made elsewhere/.test(elsewhere.md) && /- One point\n {2}- A deeper one/.test(elsewhere.md) && /<!-- Elsewhere notes -->/.test(elsewhere.md), 'a PowerPoint made elsewhere: its text, points and levels, notes', elsewhere.md)
  // A Markdown deck's skipped slide: a class Marp's tools pass over, hidden in its PowerPoint.
  const skipped = D.withSkip('<!-- _class: title -->\n\n# A', true)
  ok(skipped === '<!-- _class: title skip -->\n\n# A' && D.isSkipped(skipped) && D.layoutOf(skipped) === 'title' && D.withSkip(skipped, false) === '<!-- _class: title -->\n\n# A' && !D.notesOf(skipped), 'skip: a class on the slide, its layout kept, never a note', skipped)
  const skipPptx = await JSZip.loadAsync(await P.pptxOf(P.slidesOf(`---\nmarp: true\n---\n\n# A\n\n---\n\n${skipped}\n`)))
  ok(/<p:sld show="0"/.test(await skipPptx.file('ppt/slides/slide2.xml').async('string')) && !/show="0"/.test(await skipPptx.file('ppt/slides/slide1.xml').async('string')) && D.isSkipped((await P.deckFromPptx(await skipPptx.generateAsync({ type: 'uint8array' }))).md.split('---').at(-1)), 'and hidden in its PowerPoint, read back as skipped')
  ok(D.withListKind('a\n- b\n  1. c', 0, 'bullet') === '- a\n- b\n  1. c' && D.withListKind('a\n- b\n  1. c', 1, 'number') === 'a\n1. b\n  1. c' && D.withListKind('a\n- b\n  1. c', 2, null) === 'a\n- b\nc' && D.findInDeck(st, 'now').length === 1, 'a line made a bullet, a number or a paragraph; words found in the slides')

  // ---------- A PowerPoint as itself (pptxdoc.js, pptxdraw.js, pptxtext.js) ----------
  const X = await import(pathToFileURL(path.join(ROOT, 'src/components/studio/pptxdoc.js')).href)
  const R = await import(pathToFileURL(path.join(ROOT, 'src/components/studio/pptxdraw.js')).href)
  const T = await import(pathToFileURL(path.join(ROOT, 'src/components/studio/pptxtext.js')).href)
  const { deckPptx, boardSlides } = await import(pathToFileURL(path.join(ROOT, 'test/lib/deckfile.mjs')).href)
  const parts = async (bytes) => { const z = await JSZip.loadAsync(bytes); const out = {}; for (const [n, f] of Object.entries(z.files)) if (!f.dir) out[n] = Buffer.from(await f.async('uint8array')); return out }
  {
    const board = await deckPptx({ slides: boardSlides(64) })
    let t0 = Date.now()
    const doc = await X.readPptx(board)
    doc.urlOf = (p) => `blob:${p}`
    const views = doc.slides.map((s) => X.slideView(doc, s))
    const readMs = Date.now() - t0
    ok(doc.slides.length === 64 && doc.slides[12].hidden && doc.slides[0].notes.text === 'Welcome everyone.\nThank the board for the time.' && readMs < 3000, 'a 64-slide PowerPoint read: its slides, the hidden one, notes', { slides: doc.slides.length, readMs })
    const title = views[1].objs[0], body = views[1].objs[1]
    ok(Math.round(title.x) === 88 && Math.round(title.w) === 1104 && title.text.paras[0].runs[0].font === 'Georgia' && title.text.paras[0].runs[0].color.hex === '1F2A44' && title.text.paras[0].runs[0].sz === 40, 'a placeholder in its layout\'s place, the master\'s title style, the theme\'s heading font and colour', { x: title.x, w: title.w, run: title.text.paras[0].runs[0] })
    ok(body.text.paras.map((p) => p.bullet?.text || '').join('') === '•––••' && body.text.paras[1].lvl === 1 && body.text.paras[0].runs[0].font === 'Arial' && body.text.paras[0].runs[0].sz === 26, 'points with the master\'s bullets for each level, in the body font', body.text.paras.map((p) => [p.lvl, p.bullet?.text]))
    ok(views[1].under.length === 1 && views[1].under[0].fill.color.hex === '2E6BD9', 'the master\'s own shape under every slide (its accent band)')
    const flow = views[4].objs
    ok(flow.length === 8 && flow[1].geom.prst === 'roundRect' && flow[1].fill.color.hex === '1E4FA7' && flow[1].text.paras[0].runs[0].color.hex === 'FFFFFF' && flow[4].rot === 15 && flow[5].kind === 'cxn' && flow[5].line.tail?.type === 'triangle' && flow[7].flipH, 'shapes: each kind, a theme colour made darker, a style\'s line, turned, flipped, a line with an arrowhead', flow.map((o) => `${o.kind}:${o.geom?.prst}`))
    ok(views[5].objs[1].kind === 'grp' && views[5].objs[1].kids.length === 3 && views[6].objs[1].img.crop.l === 0.05 && views[6].objs[1].img.crop.b === 0.1, 'a group of three; a picture cropped')
    const tbl = views[7].objs[1].table
    ok(tbl.rows.length === 4 && tbl.cols.length === 3 && tbl.rows[0].cells[0].text.paras[0].runs[0].b && tbl.rows[0].cells[0].fill.color.hex === '7A9A3A', 'a table in its style: a header row in the accent, bold', { fill: tbl.rows[0].cells[0].fill })
    const chart = views[8].objs[1].chart
    ok(chart.type === 'col' && chart.series.length === 2 && chart.series[1].values.join() === '3.6,4.1,4.4,5.2' && chart.cats.join() === 'Q1,Q2,Q3,Q4', 'a chart from the values it keeps', chart)
    ok(R.missingIn(views[9]).diagrams === 1 && views[10].objs[1].text.paras.map((p) => p.bullet?.text || '').join('|') === '•|•|•|•|1.|2.' && views[11].objs[1].text.paras[0].runs[0].sz === 11.25, 'a diagram it can\'t draw, counted; numbered points; words shrunk to fit as the file says', views[10].objs[1].text.paras.map((p) => p.bullet?.text))
    const html = R.slideHtml(views[4], { number: 5 })
    ok((html.match(/data-o="/g) || []).length === 8 && /rotate\(15deg\)/.test(html) && /marker-end/.test(html) && /scale\(-1,1\)/.test(html) && /#1E4FA7/.test(html) && /width:1280px;height:720px/.test(html), 'drawn: every shape where it is, turned, flipped, filled, with its arrowhead', html.length)
    ok(/<img[^>]+blob:ppt\/media\/image1\.png/.test(R.slideHtml(views[6])) && (R.slideHtml(views[8]).match(/<rect/g) || []).length >= 8 && /<table class="px-table"/.test(R.slideHtml(views[7])), 'a picture, a chart\'s bars and a table drawn')
    // Saved with nothing changed: every part as it was, byte for byte.
    const before = await parts(board)
    const same = await parts(await X.writePptx(doc, doc.slides))
    ok(Object.keys(before).length === Object.keys(same).length && Object.keys(before).every((n) => same[n]?.equals(before[n])), 'saved unchanged: every part byte for byte the same')
    // Words typed, a run made bold, Enter, a word replaced.
    let tm = X.textAt(doc.slides[1].objs[1], {})
    tm = T.insertText(tm, { p: 0, o: 5 }, null, ' exactly').t
    ok(T.paraText(tm.paras[0]) === 'Where exactly we are' && tm.paras[0].runs.length === 1, 'typed: into the run it\'s in, in its look')
    tm = T.formatRange(tm, { p: 0, o: 6 }, { p: 0, o: 13 }, { b: true })
    ok(tm.paras[0].runs.length === 3 && /\sb="1"/.test(tm.paras[0].runs[1].rPr) && tm.paras[0].runs[1].text === 'exactly' && !/\sb="1"/.test(tm.paras[0].runs[0].rPr), 'a stretch made bold: its own run, the rest as it was', tm.paras[0].runs)
    let sp = T.splitPara(tm, { p: 0, o: 13 }, null)
    ok(sp.t.paras.length === tm.paras.length + 1 && T.paraText(sp.t.paras[1]) === ' we are' && sp.t.paras[1].pPr === tm.paras[0].pPr && sp.caret.p === 1, 'Enter: the paragraph split, the new one in its look')
    ok(T.paraText(T.joinBack(sp.t, 1).t.paras[0]) === 'Where exactly we are', 'Backspace at its start: joined back')
    const rep = T.replaceAll(tm, 'exactly we', 'now', {})
    ok(rep.n === 1 && T.paraText(rep.t.paras[0]) === 'Where now are', 'replaced across two runs')
    // Changed: words, a shape moved and one taken off, a text box, a new slide, a copy with its
    // chart, one hidden, two swapped, notes; saved and read back.
    const s2 = X.withTextAt(doc.slides[1], { at: 1 }, tm)
    let s5 = X.changeObj(doc.slides[4], 1, (xml) => X.withXfrm(xml, { x: 300, y: 400, w: 250, h: 125 }))
    s5 = X.addObjs(X.removeObjs(s5, [7]), [X.textBoxXml({ x: 100, y: 600, w: 400, h: 40 }, 'Added here')])
    const fresh = X.newSlide(doc, doc.slides[1].layout)
    const chartCopy = X.copySlide(doc, doc.slides[8])
    const list = [doc.slides[0], X.withNotes(s2, 'New notes'), doc.slides[3], doc.slides[2], s5, ...doc.slides.slice(5, 63), fresh, chartCopy, X.withHidden(doc.slides[63], true)]
    t0 = Date.now()
    const saved = await X.writePptx(doc, list)
    const writeMs = Date.now() - t0
    const after = await parts(saved)
    const changed = Object.keys(after).filter((n) => !before[n]?.equals(after[n]))
    const kept = ['ppt/slideMasters/slideMaster1.xml', 'ppt/theme/theme1.xml', 'ppt/charts/chart1.xml', 'ppt/slideLayouts/slideLayout2.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide9.xml', 'ppt/media/image1.png']
    ok(kept.every((n) => after[n]?.equals(before[n])) && changed.every((n) => /^(ppt\/slides\/|ppt\/notesSlides\/|ppt\/charts\/|ppt\/presentation\.xml|ppt\/_rels\/presentation|\[Content_Types\])/.test(n)) && writeMs < 3000, 'saved: only what changed is written; masters, layouts, theme, charts and the slides not touched as they were', { changed, writeMs })
    const back = await X.readPptx(saved)
    back.urlOf = () => null
    const bv = back.slides.map((s) => X.slideView(back, s))
    const plainAt = (v, i) => X.plainOf(v.objs[i].textModel)
    ok(back.slides.length === 66 && /Where exactly we are/.test(plainAt(bv[1], 1)) && back.slides[1].notes.text === 'New notes' && /Section|Results/.test(plainAt(bv[3], 0)) && /Before and after/.test(plainAt(bv[2], 0)), 'read back: the words, the notes, the two swapped', back.slides.slice(0, 4).map((s, i) => plainAt(bv[i], 0)))
    ok(Math.round(bv[4].objs[1].x) === 300 && bv[4].objs.length === 8 && /Added here/.test(plainAt(bv[4], 7)) && bv[63].objs.every((o) => o.empty) && bv[63].objs.length === 2 && bv[64].objs[1].chart?.series.length === 2 && back.slides[65].hidden, 'a shape moved, one gone, a text box; a new slide\'s empty placeholders; the copy\'s chart its own', { x: bv[4].objs[1].x, n: bv[4].objs.length })
    ok(Object.keys(after).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)).length === 2 && back.slides.filter((s) => s.hidden).length === 2, 'the copied chart a part of its own; the hidden slides hidden')
    // Every slide's things have ids of their own (or PowerPoint repairs it).
    const idsOk = back.slides.every((s) => { const ids = (s.objs.join('').match(/<p:cNvPr\b[^>]*\bid="(\d+)"/g) || []).map((x) => /id="(\d+)"/.exec(x)[1]); return new Set(ids).size === ids.length })
    const sldIds = [...after['ppt/presentation.xml'].toString().matchAll(/<p:sldId id="(\d+)"/g)].map((m) => m[1])
    const types = after['[Content_Types].xml'].toString()
    ok(idsOk && new Set(sldIds).size === 66 && Object.keys(after).filter((n) => /^ppt\/(slides|notesSlides|charts)\/[^/]+\.xml$/.test(n)).every((n) => types.includes(`PartName="/${n}"`)), 'ids unique on each slide and in the presentation; every new part in the content types')
    // An animation that names a shape taken off goes with it; the slide's others stay.
    const timed = { ...doc.slides[4], tail: `<p:timing><p:tnLst><p:par><p:cTn id="1"><p:spTgt spid="${/<p:cNvPr id="(\d+)"/.exec(doc.slides[4].objs[7])[1]}"/></p:cTn></p:par></p:tnLst></p:timing>${doc.slides[4].tail}` }
    ok(X.animationsLost(X.removeObjs(timed, [7])) && !X.animationsLost(X.removeObjs(timed, [6])), 'an animation naming a shape taken off goes; one that doesn\'t stays')
  }

  // ---------- The server ----------
  await api('/setup', { name: 'Tester' })
  await api('/settings', { trials: { studio: true } }, 'PATCH')
  const dir = path.join(kit.home, 'Work', 'decks')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'pitch.md'), DECK)
  fs.writeFileSync(path.join(dir, 'brief.md'), '# Launch brief\n\nWe launch the new pricing in November.\n')
  fs.writeFileSync(path.join(dir, 'theirs.pptx'), bytes)
  const place = (await api('/places', { path: dir })).place
  const root = `place:${place.id}`
  await api(`/studio/open?root=${encodeURIComponent(root)}&path=brief.md`)
  const pic = await api('/studio/picture', { root, path: 'pitch.md', name: 'team photo.png', data: PNG.toString('base64') })
  ok(pic.src === 'images/team-photo.png' && fs.readFileSync(path.join(dir, 'images', 'team-photo.png')).equals(PNG), 'a picture for a deck: saved beside it, in images, named as it came', pic)
  ok(/A picture/.test((await err('/studio/picture', { root, path: 'pitch.md', name: 'run.sh', data: 'eA==' }))?.message || '') && !!(await err('/studio/picture', { root, path: '../../x.md', name: 'a.png', data: PNG.toString('base64') })), 'only a picture, and only beside a deck in the place')
  const noModel = await err('/studio/deck/ai', { root, path: 'pitch.md', mode: 'deck', prompt: 'Pricing' })
  ok(/No model to write with yet/.test(noModel?.message || ''), 'AI with no model: it says so, and where to add one', noModel?.message)
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { meetings: { model: 'openai:gpt-5' } }, 'PATCH')
  const made = await api('/studio/deck/ai', { root, path: 'pitch.md', mode: 'deck', from: { root, path: 'brief.md' } })
  ok(made.slides.length === 4 && /# Launch brief/.test(made.slides[0]) && /_class: stats/.test(made.slides[2]) && model.asked(/Write a slide deck from the document/).some((x) => /launch the new pricing in November/.test(x) && /_class: stats/.test(x)), 'a deck from a document: its words go to the model with the layouts, its slides come back', made)
  const re = await api('/studio/deck/ai', { root, path: 'pitch.md', mode: 'slide', prompt: 'as big numbers', at: 1, slides: st.slides.map((_, i) => D.slideText(st, i)) })
  ok(re.slides.length === 1 && /# Rewritten/.test(re.slides[0]) && model.asked(/^Rewrite slide 2: as big numbers/m).some((x) => /Slide 2:\n# Why now/.test(x)), 'a slide rewritten: the deck goes with it, for context', re)
  ok(/Say what the deck is about/.test((await err('/studio/deck/ai', { root, path: 'pitch.md', mode: 'deck', prompt: ' ' }))?.message || ''), 'a deck asked for with nothing to go on: it says what it needs')

  // ---------- The page ----------
  const w = await page(b, kit.url, { width: 1440, height: 900 })
  pages.push(w)
  const p = w.p
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  const open = async (pp, name) => pp.evaluate(({ root, name }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: name } })), { root, name })
  // Opened, asked again until it shows (a page that's just loaded can take the ask before it listens).
  const opened = (pp, name) => until(async () => { await open(pp, name); return pp.locator('.sd-canvas section[id]').waitFor({ timeout: 3000 }).then(() => true, () => false) }, 30000, 200)
  await opened(p, 'pitch.md')
  await until(async () => (await p.locator('.sd-strip .sd-thumb').count()) === 6, 10000)
  ok((await p.locator('.sd-strip .sd-thumb').count()) === 6 && /Q4 pitch/.test(await p.locator('.sd-canvas').innerText()), 'a deck: its six slides down the side, the first in the middle')
  ok(!!(await until(async () => /Slide 1 of 6/.test(await p.locator('.sd-status').innerText()), 5000)), 'the status line: which slide of how many', await p.locator('.sd-status').innerText())
  await shot(p, `${tag}deck-1440`)
  const canvas = p.locator('.sd-canvas section[id]')
  const thumbs = p.locator('.sd-strip .sd-thumb')
  const file = () => fs.readFileSync(path.join(dir, 'pitch.md'), 'utf8')
  // Saved with the header's Save, and the file read.
  const saved = async () => {
    await p.keyboard.press(`${MOD}+s`)
    await until(async () => /Saved/.test(await p.locator('.sd-status .sd-state').innerText()), 8000, 100)
    return file()
  }
  // A title typed right on the slide: only its line changes, and its thumbnail shows it.
  await canvas.locator('h1.sd-ed').click()
  await p.keyboard.press(`${MOD}+a`)
  await p.keyboard.type('Q4 pricing pitch')
  ok(!!(await until(async () => /Q4 pricing pitch/.test(await thumbs.nth(0).innerText()), 5000, 100)), 'typed on the slide: its thumbnail shows it as it\'s typed')
  let md = await saved()
  ok(md === DECK.replace('\n# Q4 pitch\n', '\n# Q4 pricing pitch\n'), 'saved: the title\'s line changed, and nothing else in the file', md)
  // Points: one typed on, Enter for the next, Tab to put it under the one before.
  await thumbs.nth(1).locator('.sd-thumb-btn').click()
  await until(async () => /Why now/.test(await canvas.innerText()), 5000, 100)
  const point = canvas.locator('li .sd-ed', { hasText: 'It is' })
  await point.click()
  // The caret at its end (End doesn't move it in Safari on a Mac).
  await point.evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r) })
  await p.keyboard.type(' now')
  await p.keyboard.press('Enter')
  await p.keyboard.type('Priced per seat')
  await p.keyboard.press('Tab')
  await p.keyboard.press('Escape')
  md = await saved()
  ok(/- It is \*ready(\* now| now\*)\n {2}- Priced per seat\n/.test(md) && md.includes('- Customers **asked** for it\n  - Twelve in October\n'), 'points: typed on, Enter for a new one, Tab under the one before; the bold and italics kept', md.slice(md.indexOf('# Why now'), md.indexOf('# Why now') + 160))
  // A new slide in a layout: what its empty parts take, typed in.
  await p.locator('.sd-deck-tools button[aria-label="New slide in a layout"]').click()
  await p.locator('.sd-gallery button', { hasText: 'Big numbers' }).click()
  await until(async () => (await thumbs.count()) === 7, 5000, 100)
  const ghosts = await canvas.locator('.sd-ghost').allInnerTexts()
  ok((await thumbs.count()) === 7 && ghosts.some((x) => /Click to add title/.test(x)) && ghosts.some((x) => /Click to add text/.test(x)), 'New slide in a layout: after this one, showing where its title and text go', ghosts)
  await shot(p, `${tag}deck-new-slide`)
  await canvas.locator('.sd-ghost', { hasText: 'Click to add title' }).click()
  await p.keyboard.type('Our numbers')
  await p.keyboard.press('Enter')
  await p.keyboard.type('Fast')
  await p.keyboard.press('Escape')
  md = await saved()
  ok(/---\n\n<!-- _class: stats -->\n\n# Our numbers\n\n- Fast\n/.test(md), 'clicked and typed: a title, then Enter, a point', md.slice(md.indexOf('Priced per seat'), md.indexOf('Priced per seat') + 120))
  // Duplicate, undo; move by keys; delete from its menu.
  await thumbs.nth(2).locator('.sd-thumb-btn').click()
  await p.keyboard.press(`${MOD}+d`)
  ok(!!(await until(async () => (await thumbs.count()) === 8, 3000, 100)), 'duplicated (⌘D)')
  await p.keyboard.press(`${MOD}+z`)
  ok(!!(await until(async () => (await thumbs.count()) === 7, 3000, 100)), 'and undone (⌘Z)')
  await p.keyboard.press(`${MOD}+ArrowUp`)
  ok(!!(await until(async () => /Our numbers/.test(await thumbs.nth(1).innerText()) && /Why now/.test(await thumbs.nth(2).innerText()), 3000, 100)), 'moved up a place (⌘↑)')
  await thumbs.nth(1).dragTo(thumbs.nth(3), { targetPosition: { x: 60, y: 70 } })
  ok(!!(await until(async () => /Our numbers/.test(await thumbs.nth(3).innerText()), 3000, 100)), 'dragged into place, after the slide it was dropped on', await thumbs.allInnerTexts())
  await thumbs.nth(3).hover()
  await thumbs.nth(3).locator('.sd-thumb-more').click()
  await shot(p, `${tag}deck-slide-menu`)
  await p.locator('.sd-ctx .menu-item', { hasText: 'Delete the slide' }).click()
  ok(!!(await until(async () => (await thumbs.count()) === 6 && !/Our numbers/.test((await thumbs.allInnerTexts()).join(' ')), 3000, 100)), 'deleted from its menu')
  // Its layout, from the gallery, drawn in the deck's look.
  await thumbs.nth(1).locator('.sd-thumb-btn').click()
  await p.locator('.sd-deck-tools button[aria-label="Layout"]').click()
  await p.locator('.sd-gallery .sd-slide').first().waitFor({ timeout: 5000 })
  const marked = await p.locator('.sd-gallery button[aria-checked="true"]').allInnerTexts()
  ok((await p.locator('.sd-gallery button').count()) === 9 && (await p.locator('.sd-gallery .sd-slide').count()) === 9 && marked.length === 1 && /Title and text$/.test(marked[0]), 'Layout: nine, each drawn in the deck\'s look, this slide\'s marked', { marked, slide: await canvas.innerText() })
  await shot(p, `${tag}deck-layouts`)
  await p.locator('.sd-gallery button', { hasText: 'Two columns' }).click()
  ok(!!(await until(async () => (await canvas.getAttribute('class') || '').includes('cols'), 3000, 100)), 'a layout picked: the slide drawn in it')
  // Its theme: Studio's Ember, then back to the default.
  await p.locator('.sd-deck-tools button[aria-label="Theme"]').click()
  await shot(p, `${tag}deck-themes`)
  await p.locator('.sd-themes button', { hasText: 'Ember' }).click()
  md = await saved()
  ok(/^---\nmarp: true\ntitle: Q4 pitch\npaginate: true\npack: Ember\n---\n/.test(md) && /d9502b/i.test(await p.locator('.sd-deck2 > style').innerText()), 'Theme: Ember, written in its front matter and drawn in it', md.slice(0, 90))
  // A picture, beside the deck; then the speaker notes.
  await p.locator('.sd-deck-tools input[type=file]').setInputFiles({ name: 'chart.png', mimeType: 'image/png', buffer: PNG })
  md = await until(async () => { const x = await saved(); return /!\[bg right:42%\]\(images\/chart\.png\)/.test(x) && x }, 20000, 300)
  ok(!!md && fs.existsSync(path.join(dir, 'images', 'chart.png')) && /<!-- _class: image -->/.test(md), 'Picture: saved beside the deck, on the slide, which becomes text and picture', md && md.slice(md.indexOf('# Why now') - 40, md.indexOf('# Why now') + 200))
  ok(!!(await until(async () => /images%2Fchart\.png/.test(await p.locator('.sd-canvas').innerHTML()), 5000, 100)), 'and drawn on it, from beside the deck')
  const notesBox = p.locator('.sd-notes-box')
  await notesBox.fill('Pause here for questions')
  await p.locator('.sd-notes-head').click()
  await p.locator('.sd-notes-head').click()
  md = await saved()
  ok(/<!-- Pause here for questions -->/.test(md) && !/Say the numbers/.test(md), 'speaker notes: typed under the slide, kept on it in place of the old ones', md.slice(md.indexOf('# Why now'), md.indexOf('# Why now') + 260))
  await shot(p, `${tag}deck-picture`)
  // Every slide at once, and back to one.
  await p.locator('.sd-deck-tools button[aria-label="Grid"]').click()
  ok(!!(await until(async () => (await p.locator('.sd-sorter .sd-slide-in').count()) === 6, 3000, 100)), 'Grid: every slide at once, drawn')
  await shot(p, `${tag}deck-grid`)
  await p.locator('.sd-sorter .sd-thumb').nth(4).locator('.sd-thumb-btn').click()
  ok(!!(await until(async () => (await p.locator('.sd-sorter').count()) === 0 && /Slide 5 of 6/.test(await p.locator('.sd-status').innerText()), 3000, 100)), 'a slide clicked there: open in the middle')
  // Presenting: full screen from this slide, next and back, the presenter's view, Esc.
  await thumbs.nth(1).locator('.sd-thumb-btn').click()
  await p.locator('.sd-deck-tools button[aria-label="Present"]').click()
  await p.locator('.sd-present').waitFor({ timeout: 5000 })
  ok(/2 of 6/.test(await p.locator('.sd-present-n').innerText()), 'Present: from this slide', await p.locator('.sd-present-n').innerText())
  await p.keyboard.press('ArrowRight')
  ok(!!(await until(async () => /3 of 6/.test(await p.locator('.sd-present-n').innerText()), 3000, 100)), 'the next slide (→)')
  await p.keyboard.press('ArrowLeft')
  await p.locator('.sd-present-bar button[aria-label="Presenter view"]').click()
  ok(!!(await until(async () => /Pause here for questions/.test(await p.locator('.sd-presenter').innerText().catch(() => '')), 3000, 100)) && (await p.locator('.sd-presenter .sd-slide').count()) === 1, 'the presenter\'s view: the next slide, this one\'s notes, the time')
  await shot(p, `${tag}deck-presenter`)
  await p.keyboard.press('Escape')
  ok(!!(await until(async () => (await p.locator('.sd-present').count()) === 0, 5000, 100)), 'Esc: back to editing')
  // AI Assist: its menu at the right end of the header; a slide rewritten from the slide's own
  // Rewrite, shown first, kept; then a whole deck, shown first, put after.
  const wand = p.locator('.sd-file .pane-head .pane-extras button[aria-label="AI Assist"]')
  ok(await wand.evaluate((e) => !e.nextElementSibling) && !(await p.locator('.sd-deck-tools button[aria-label="Write with AI"]').count()), 'AI Assist at the right end of the header, and none of its own in the deck\'s toolbar')
  await wand.click()
  const verbs = await p.locator('.ai-menu .ai-item-label').allInnerTexts()
  ok(JSON.stringify(verbs) === JSON.stringify(['Write the deck', 'Rewrite this slide', 'Add a slide after this one']), 'a deck\'s AI Assist: Write the deck, Rewrite this slide, Add a slide after this one', verbs)
  await shot(p, `${tag}deck-ai-menu`)
  await p.keyboard.press('Escape')
  ok(await p.locator('.sd-pill .sd-pill-ai').count() === 2, 'on the slide, inline: the wand with Rewrite and Add a slide after')
  await p.locator('.sd-pill button', { hasText: 'Rewrite' }).click()
  await p.locator('.sd-ai textarea').fill('as big numbers')
  await p.locator('.sd-ai button', { hasText: 'Rewrite it' }).click()
  await p.locator('.sd-ai-result .sd-slide').first().waitFor({ timeout: 15000 })
  ok(/1 slide, not in the deck yet/.test(await p.locator('.sd-ai-result').innerText()) && !/Rewritten/.test(file()), 'AI: the rewritten slide shown, not yet in the deck')
  await shot(p, `${tag}deck-ai-slide`)
  await p.locator('.sd-ai button', { hasText: 'Keep it' }).click()
  md = await saved()
  ok(/<!-- _class: stats -->\n\n# Rewritten\n\n- \*\*42%\*\* shorter/.test(md) && !/# Why now/.test(md), 'kept: it takes the slide\'s place', md)
  await p.locator('.sd-ai-modes button', { hasText: 'Whole deck' }).click()
  await p.locator('.sd-ai textarea').fill('Pricing for the sales team')
  await p.locator('.sd-ai button', { hasText: 'Write the deck' }).click()
  await p.locator('.sd-ai-result .sd-slide').nth(3).waitFor({ timeout: 15000 })
  await shot(p, `${tag}deck-ai-deck`)
  await p.locator('.sd-ai button', { hasText: 'Add them after slide 2' }).click()
  ok(!!(await until(async () => (await thumbs.count()) === 10 && /Pricing for the sales team/.test(await thumbs.nth(2).innerText()), 3000, 100)), 'a deck written: its four slides after this one', await thumbs.count())
  await p.keyboard.press('Escape')
  await p.locator('.sd-deck-tools button[aria-label="Undo"]').click()
  ok(!!(await until(async () => (await thumbs.count()) === 6, 3000, 100)), 'and Undo takes them back out')
  await p.locator('.sd-ai-head button[aria-label="Close AI Assist"]').click()
  // The Markdown, beside the slides, typed in.
  await p.locator('.sd-deck-tools button[aria-label="Markdown"]').click()
  const mdBox = p.locator('.sd-deck-md')
  ok((await mdBox.inputValue()) === file(), 'Markdown: the deck as it is')
  await mdBox.fill((await mdBox.inputValue()).replace('# Before and after', '# Then and now'))
  ok(!!(await until(async () => /Then and now/.test((await thumbs.allInnerTexts()).join(' ')), 3000, 100)), 'typed there: the slides follow')
  await shot(p, `${tag}deck-markdown`)
  await p.locator('.sd-deck-tools button[aria-label="Markdown"]').click()
  md = await saved()
  // What wasn't touched is as it was, byte for byte.
  ok(md.includes('<!-- _class: quote -->\n\n> Finally, pricing that makes sense.\n\nA customer') && md.endsWith('| Plan | Price |\n| --- | --- |\n| Team | 12 |\n'), 'the slides nobody touched: their Markdown as it was', md.slice(-200))
  // PowerPoint, beside it.
  await p.locator('.sd-deck-tools button[aria-label="Export"]').click()
  await p.locator('.sd-tool-menu .menu-item', { hasText: 'PowerPoint, beside it' }).click()
  ok(!!(await until(() => fs.existsSync(path.join(dir, 'pitch.pptx')), 15000)), 'Export: pitch.pptx beside it', await p.locator('.sd-note').innerText().catch(() => ''))
  const made2 = await P.deckFromPptx(fs.readFileSync(path.join(dir, 'pitch.pptx')), 'pitch.pptx')
  ok(JSON.stringify(words(made2.md)) === JSON.stringify(words(md)) && made2.look.colors.accent === '#d9502b', 'and it reads back: its slides as they are here, its look', { pptx: words(made2.md), here: words(md) })
  // Slides picked together (⇧-click), copied and pasted, then undone; one skipped.
  await thumbs.nth(1).locator('.sd-thumb-btn').click()
  await thumbs.nth(2).locator('.sd-thumb-btn').click({ modifiers: ['Shift'] })
  ok((await p.locator('.sd-strip .sd-thumb.picked').count()) === 2, 'Markdown deck: two slides picked together')
  await p.keyboard.press(`${MOD}+c`)
  await thumbs.nth(5).locator('.sd-thumb-btn').click()
  await p.keyboard.press(`${MOD}+v`)
  ok(!!(await until(async () => (await thumbs.count()) === 8, 3000, 50)), 'copied and pasted after the last (⌘C ⌘V)')
  await p.keyboard.press(`${MOD}+z`)
  await until(async () => (await thumbs.count()) === 6, 3000, 50)
  await thumbs.nth(4).click({ button: 'right' })
  await p.locator('.sd-ctx .menu-item', { hasText: 'Skip when presenting' }).click()
  md = await saved()
  ok(/<!-- _class: quote skip -->/.test(md) && await thumbs.nth(4).evaluate((x) => x.classList.contains('skipped')), 'skipped: a class on the slide, shown in the strip', md.slice(md.indexOf('quote') - 20, md.indexOf('quote') + 40))
  // A point numbered; ⌘U said, not lost.
  await thumbs.nth(1).locator('.sd-thumb-btn').click()
  await canvas.locator('li .sd-ed').first().click()
  await p.keyboard.press(`${MOD}+u`)
  ok(/no underline/.test((await p.locator('.sd-note').allInnerTexts()).join(' ')), '⌘U: Markdown has no underline, said')
  await p.keyboard.press(`${MOD}+Shift+7`)
  await p.keyboard.press('Escape')
  md = await saved()
  ok(/\n1\. \*\*42%\*\*/.test(md), 'a point numbered (⌘⇧7)', md.slice(md.indexOf('42%') - 40, md.indexOf('42%') + 40))
  // Find and replace, then back as it was.
  await p.locator('.sd-stage').click({ position: { x: 4, y: 40 } })
  await p.keyboard.press(`${MOD}+Shift+h`)
  await p.locator('.sd-findbar input[aria-label="Find"]').fill('Fast')
  ok(!!(await until(async () => /1 of 1/.test(await p.locator('.sd-find-count').innerText()), 2000, 50)), 'find (⌘⇧H)')
  await p.locator('.sd-findbar input[aria-label="Replace with"]').fill('Quick')
  await p.locator('.sd-findbar button', { hasText: 'Replace all' }).click()
  md = await saved()
  ok(/- Quick\n/.test(md) && !/- Fast\n/.test(md), 'replaced')
  await p.keyboard.press('Escape')
  // Zoom, scrolled; presenting from the beginning passes the skipped slide.
  const zw = (await p.locator('.sd-canvas').boundingBox()).width
  await p.locator('.sd-deck-tools button[aria-label="Zoom"]').click()
  await p.locator('.sd-tool-menu .menu-item', { hasText: '200%' }).click()
  ok(!!(await until(async () => (await p.locator('.sd-canvas').boundingBox()).width > zw * 1.5, 2000, 50)) && await p.locator('.sd-stage').evaluate((x) => x.scrollWidth > x.clientWidth), 'zoomed to 200%, the slide scrolling')
  await p.keyboard.press(`${MOD}+Alt+0`)
  await p.keyboard.press(`${MOD}+Shift+Enter`)
  await p.locator('.sd-present').waitFor({ timeout: 5000 })
  for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowRight')
  ok(!!(await until(async () => /6 of 6/.test(await p.locator('.sd-present-n').innerText()), 2000, 50)), 'presenting from the beginning (⌘⇧↵), the skipped slide passed over', await p.locator('.sd-present-n').innerText())
  await p.keyboard.press('Escape')
  await until(async () => (await p.locator('.sd-present').count()) === 0, 3000, 50)
  // ---------- A PowerPoint, edited as itself ----------
  {
    // Studio's own PowerPoint (made from a Markdown deck) opens as its slides, as PowerPoint draws them.
    const objs = p.locator('.px-canvas .px-draw > .px-slide > [data-o]')
    const openPptx = (name) => until(async () => { await open(p, name); return p.locator('.px-canvas [data-o]').first().waitFor({ timeout: 3000 }).then(() => true, () => false) }, 30000, 200)
    ok(!!(await openPptx('theirs.pptx')) && (await thumbs.count()) === 6 && /Q4 pitch/.test(await p.locator('.px-canvas').innerText()), 'a PowerPoint Studio made opens as its six slides, as itself')
    await thumbs.nth(1).locator('.sd-thumb-btn').click()
    ok(!!(await until(async () => (await p.locator('.px-canvas img').count()) > 0, 5000, 100)), 'its picture on its slide')
    // A board deck as PowerPoint writes one: 20 slides on its own masters, layouts and theme.
    fs.writeFileSync(path.join(dir, 'board.pptx'), await deckPptx({ slides: boardSlides(20) }))
    const boardWas = await parts(fs.readFileSync(path.join(dir, 'board.pptx')))
    ok(!!(await openPptx('board.pptx')) && !!(await until(async () => (await thumbs.count()) === 20, 10000, 100)), 'a PowerPoint\'s 20 slides down the side')
    ok(await thumbs.nth(12).evaluate((x) => x.classList.contains('skipped')) && /1 thing on its slides isn't shown/.test(await p.locator('.sd-deck-said').innerText()), 'its hidden slide shown as skipped; what Studio can\'t draw said, and kept')
    const go = async (i) => { await thumbs.nth(i).locator('.sd-thumb-btn').click(); await sleep(100) }
    await go(4)
    ok((await objs.count()) === 8 && /Order/.test(await p.locator('.px-canvas').innerText()), 'its shapes where they are, each one there to pick')
    await shot(p, `${tag}deck-pptx`)
    // In Focus: the slide bigger in the middle; Esc lets go of the shapes picked first, then leaves.
    const slideW = async () => (await p.locator('.px-canvas').boundingBox())?.width || 0
    const w0 = await slideW()
    await p.keyboard.press(`${MOD}+Alt+f`)
    const deckFocus = () => p.locator('.sd-file.focus').count().then((n) => n === 1)
    ok(!!(await until(async () => (await deckFocus()) && (await slideW()) > w0 + 40, 3000, 100)), 'a PowerPoint in Focus: its slide bigger, in the whole window', { w0, w1: await slideW() })
    await shot(p, `${tag}deck-pptx-focus`)
    ok(await p.locator('.sd-file.focus .sd-status button[aria-label="AI Assist"]').isVisible(), 'in Focus, AI Assist is in the status line, the header being out of sight')
    await p.locator('.px-stage').focus()
    await p.keyboard.press(`${MOD}+a`)
    const picks = () => p.locator('.px-sel .px-frame:not(.hover)').count()
    ok(!!(await until(async () => (await picks()) > 0, 2000, 100)), 'its shapes picked (⌘A)')
    await p.keyboard.press('Escape')
    await sleep(300)
    ok(await deckFocus() && (await picks()) === 0, 'Esc lets go of them, and stays in Focus', { focus: await deckFocus(), picks: await picks(), at: await p.evaluate(() => document.activeElement?.className) })
    await p.keyboard.press('Escape')
    ok(!!(await until(async () => !(await deckFocus()), 3000, 100)), 'Esc again: out of Focus')
    // A title: one click in it, typed, made bold; its thumbnail follows.
    await go(1)
    const tb = await objs.nth(0).boundingBox()
    await p.mouse.click(tb.x + tb.width * 0.2, tb.y + tb.height / 2)
    await p.locator('.px-edit-body').waitFor({ timeout: 3000 })
    await p.locator('.px-edit-body').evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })
    await p.keyboard.type(' for 2026')
    ok(!!(await until(async () => /Agenda for 2026/.test(await thumbs.nth(1).innerText()), 3000, 50)), 'typed in its title, where it is: the thumbnail follows')
    await p.keyboard.press(`${MOD}+a`)
    await p.keyboard.press(`${MOD}+b`)
    ok(/font-weight:\s*700/.test(await p.locator('.px-edit-body span').first().getAttribute('style')) && (await p.locator('.px-format button[aria-label="Bold"]').getAttribute('aria-pressed')) === 'true', 'made bold (⌘B), shown on its button')
    await p.keyboard.press('Escape')
    // Its points: Enter for a new one, Tab under the one before, numbered.
    const bb = await objs.nth(1).boundingBox()
    await p.mouse.click(bb.x + 120, bb.y + 16)
    await p.locator('.px-edit-body').waitFor({ timeout: 3000 })
    await p.keyboard.press(`${MOD}+End`).catch(() => {})
    await p.locator('.px-edit-body p').last().evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })
    await p.keyboard.press('Enter')
    await p.keyboard.type('Budget')
    await p.keyboard.press('Tab')
    const bud = () => p.locator('.px-edit-body p', { hasText: 'Budget' })
    ok(!!(await until(async () => (await bud().getAttribute('data-bu')) === '–', 2000, 50)), 'Enter: a new point; Tab: under the one before, with its level\'s bullet', await bud().getAttribute('data-bu'))
    await p.keyboard.press(`${MOD}+Shift+7`)
    ok(/^1\./.test(await bud().getAttribute('data-bu') || ''), 'numbered (⌘⇧7)', await bud().getAttribute('data-bu'))
    // More than fits: the placeholder's words shrink, as PowerPoint's and Google's do.
    for (let i = 0; i < 9; i++) { await p.keyboard.press('Enter'); await p.keyboard.type(`More to say ${i + 1}`) }
    await sleep(300)
    await p.keyboard.press('Escape')
    const fit = await until(async () => { const px = await objs.nth(1).locator('span').first().evaluate((x) => parseFloat(x.style.fontSize)); return px < 34 && px }, 3000, 50)
    ok(!!fit, 'words that outgrow their placeholder shrink to fit (26 pt was 34.7 px)', fit)
    await p.keyboard.press('Escape')
    // A shape: put in, picked, sized by a handle, turned, coloured, moved with guides, duplicated.
    await go(13)
    const n0 = await objs.count()
    await p.locator('.px-row button[aria-label="Shape"]').click()
    await p.locator('.px-shape-grid button[aria-label="Oval"]').click()
    ok(!!(await until(async () => (await objs.count()) === n0 + 1 && (await p.locator('.px-frame .px-handle').count()) === 9, 2000, 50)), 'a shape put in, picked, with its handles')
    const f0 = await p.locator('.px-frame').first().boundingBox()
    const se = await p.locator('.px-frame .px-handle.se').boundingBox()
    await p.mouse.move(se.x + 4, se.y + 4); await p.mouse.down(); await p.mouse.move(se.x + 54, se.y + 34, { steps: 4 }); await p.mouse.up()
    const f1 = await p.locator('.px-frame').first().boundingBox()
    ok(Math.abs(f1.width - f0.width - 50) < 4 && Math.abs(f1.height - f0.height - 30) < 4, 'sized from its corner', [f0, f1])
    const rot = await p.locator('.px-frame .px-handle.rot').boundingBox()
    await p.mouse.move(rot.x + 4, rot.y + 4); await p.mouse.down(); await p.mouse.move(f1.x + f1.width / 2 + 200, f1.y + f1.height / 2, { steps: 4 }); await p.mouse.up()
    ok(/rotate\(90deg\)/.test(await p.locator('.px-frame').first().evaluate((x) => x.style.transform)), 'turned by its handle, settling on 90°')
    await p.locator('.px-format button[aria-label="Fill colour"]').click()
    await p.locator('.sd-drop .sd-sw[aria-label="#6AA84F"]').click()
    ok(/#6AA84F/i.test(await objs.last().innerHTML()), 'filled in a colour')
    const c0 = await p.locator('.px-frame').first().boundingBox()
    await p.mouse.move(c0.x + c0.width / 2, c0.y + c0.height / 2); await p.mouse.down(); await p.mouse.move(c0.x + c0.width / 2 - 90, c0.y + c0.height / 2 - 20, { steps: 6 })
    await sleep(60)
    const guided = await p.locator('.px-guide').count()
    await shot(p, `${tag}deck-pptx-drag`)
    await p.mouse.up()
    const c1 = await p.locator('.px-frame').first().boundingBox()
    ok(c1.x < c0.x - 60 && guided > 0, 'moved by dragging, a guide shown where it lines up', { guided })
    await p.keyboard.press('Shift+ArrowRight')
    const c2 = await p.locator('.px-frame').first().boundingBox()
    ok(c2.x > c1.x && c2.x - c1.x < 4, 'nudged a pixel (⇧→)')
    await p.keyboard.press(`${MOD}+d`)
    ok(!!(await until(async () => (await objs.count()) === n0 + 2, 2000, 50)), 'duplicated (⌘D)')
    await p.keyboard.press('Delete')
    ok(!!(await until(async () => (await objs.count()) === n0 + 1, 2000, 50)), 'deleted (Delete)')
    // A picture: put in, cropped by its edge.
    await p.locator('.px-row input[type=file]').first().setInputFiles({ name: 'team.png', mimeType: 'image/png', buffer: PNG })
    ok(!!(await until(async () => (await objs.count()) === n0 + 2, 5000, 50)), 'a picture put on the slide')
    await objs.last().dblclick()
    const ce = await p.locator('.px-frame.crop .px-handle.e').boundingBox()
    await p.mouse.move(ce.x + 2, ce.y + 6); await p.mouse.down(); await p.mouse.move(ce.x - 30, ce.y + 6, { steps: 3 }); await p.mouse.up()
    await p.keyboard.press('Escape')
    const iw = await objs.last().locator('img').evaluate((x) => [x.offsetWidth, x.parentElement.offsetWidth])
    ok(iw[0] > iw[1] + 10, 'cropped: the picture runs past its box', iw)
    // A table: put in, its cell typed in.
    await p.locator('.px-row button[aria-label="Table"]').click()
    await p.locator('.sd-grid-cell').nth(9).click()
    const tbl = p.locator('.px-canvas [data-o]:has(table)').last()
    await tbl.locator('td').first().click()
    await p.keyboard.type('Plan')
    await p.keyboard.press('Escape')
    ok(!!(await until(async () => /Plan/.test(await tbl.innerText()) && (await tbl.locator('tr').count()) === 2, 2000, 50)), 'a table put in, a cell typed in')
    // Copied to another slide; undone; redone.
    await go(4)
    await objs.nth(1).click()
    await p.keyboard.press(`${MOD}+c`)
    await go(13)
    const n1 = await objs.count()
    await p.locator('.px-canvas').click({ position: { x: 4, y: 4 } })
    await p.keyboard.press(`${MOD}+v`)
    ok(!!(await until(async () => (await objs.count()) === n1 + 1 && /Order/.test(await p.locator('.px-canvas').innerText()), 2000, 50)), 'a shape copied (⌘C) onto another slide (⌘V)')
    await p.keyboard.press(`${MOD}+z`)
    ok(!!(await until(async () => (await objs.count()) === n1, 2000, 50)), 'undone (⌘Z)')
    await p.keyboard.press(`${MOD}+Shift+z`)
    ok(!!(await until(async () => (await objs.count()) === n1 + 1, 2000, 50)), 'redone (⌘⇧Z)')
    await shot(p, `${tag}deck-pptx-things`)
    // Slides: picked together, copied, pasted at the end; one skipped from its menu.
    await go(1)
    await thumbs.nth(2).locator('.sd-thumb-btn').click({ modifiers: ['Shift'] })
    ok((await p.locator('.sd-strip .sd-thumb.picked').count()) === 2, 'two slides picked together (⇧-click)')
    await p.keyboard.press(`${MOD}+c`)
    await go(19)
    await p.keyboard.press(`${MOD}+v`)
    ok(!!(await until(async () => (await thumbs.count()) === 22 && /Agenda for 2026/.test(await thumbs.nth(20).innerText()), 2000, 50)), 'copied and pasted after the last (⌘C ⌘V)')
    await thumbs.nth(21).click({ button: 'right' })
    await p.locator('.sd-ctx .menu-item', { hasText: 'Skip when presenting' }).click()
    ok(await thumbs.nth(21).evaluate((x) => x.classList.contains('skipped')), 'skipped from its menu')
    // AI Assist's Add a slide after this one: a slide written, shown first, then added on the file's own layout.
    await go(2)
    await p.locator('.sd-file .pane-head button[aria-label="AI Assist"]').click()
    await p.locator('.ai-menu button', { hasText: 'Add a slide after this one' }).click()
    ok(await p.locator('.sd-ai-modes button[aria-selected="true"]', { hasText: 'New slide' }).count() === 1, 'AI Assist\'s Add a slide after this one opens its panel on New slide')
    await p.locator('.sd-ai textarea').fill('what we do next')
    await p.locator('.sd-ai button', { hasText: 'Write it' }).click()
    await p.locator('.sd-ai-result .sd-slide').first().waitFor({ timeout: 15000 })
    await p.locator('.sd-ai button', { hasText: 'Add it' }).click()
    ok(!!(await until(async () => (await thumbs.count()) === 23 && /Next steps/.test(await thumbs.nth(3).innerText()), 3000, 50)) && /Ship it/.test(await p.locator('.px-canvas').innerText()) && (await objs.count()) === 2, 'AI Assist: a new slide shown first, then added after this one on the file\'s own layout, its title and points in its placeholders')
    await p.locator('.sd-ai-head button[aria-label="Close AI Assist"]').click()
    await p.keyboard.press(`${MOD}+z`)
    await until(async () => (await thumbs.count()) === 22, 3000, 50)
    // Speaker notes; find and replace across the deck.
    await go(2)
    await p.locator('.sd-notes-box').fill('Keep it short')
    await p.locator('.sd-notes-head').click()
    await p.locator('.sd-notes-head').click()
    await p.locator('.px-canvas').click({ position: { x: 4, y: 4 } })
    await p.keyboard.press(`${MOD}+Shift+h`)
    await p.locator('.sd-findbar input[aria-label="Find"]').fill('Revenue up')
    ok(!!(await until(async () => /of 6/.test(await p.locator('.sd-find-count').innerText()), 2000, 50)), 'find across the deck (⌘⇧H): counted', await p.locator('.sd-find-count').innerText())
    await p.locator('.sd-findbar input[aria-label="Replace with"]').fill('Sales up')
    await p.locator('.sd-findbar button', { hasText: 'Replace all' }).click()
    ok(/Replaced 6 matches/.test((await p.locator('.sd-note').allInnerTexts()).join(' ')) && /Sales up/.test(await thumbs.nth(15).innerText()), 'replaced in every slide')
    await p.keyboard.press('Escape')
    // Presenting: a number and Enter goes there, a skipped slide is passed over.
    await go(10)
    await p.locator('.px-canvas').click({ position: { x: 4, y: 4 } })
    await p.keyboard.press(`${MOD}+Enter`)
    await p.locator('.sd-present').waitFor({ timeout: 5000 })
    await p.keyboard.press('ArrowRight')
    await p.keyboard.press('ArrowRight')
    ok(!!(await until(async () => /14 of 22/.test(await p.locator('.sd-present-n').innerText()), 2000, 50)), 'presenting: the skipped slide 13 passed over', await p.locator('.sd-present-n').innerText())
    await p.keyboard.type('3')
    await p.keyboard.press('Enter')
    await p.locator('.sd-present-bar button[aria-label="Presenter view"]').click()
    ok(!!(await until(async () => /3 of 22/.test(await p.locator('.sd-present-n').innerText()) && /Keep it short/.test(await p.locator('.sd-presenter').innerText()), 2000, 50)), 'a number and Enter goes there; the presenter\'s view with its notes')
    await shot(p, `${tag}deck-pptx-presenter`)
    await p.keyboard.press('Escape')
    await until(async () => (await p.locator('.sd-present').count()) === 0, 3000, 50)
    // Saved over itself, with no question: only what changed is written.
    ok(/only the slides you change are written/.test(await (async () => { await p.locator('.sd-status button[title="What saving keeps"]').click(); const x = await p.locator('.sd-note-bar').innerText(); await p.locator('.sd-status button[title="What saving keeps"]').click(); return x })()), 'what saving keeps, said in the status line')
    await p.keyboard.press(`${MOD}+s`)
    ok(!!(await until(async () => /Saved/.test(await p.locator('.sd-status .sd-state').innerText()), 10000, 50)) && (await p.locator('.sd-conflict').count()) === 0, 'saved with ⌘S, into the file, without asking')
    const boardNow = await parts(fs.readFileSync(path.join(dir, 'board.pptx')))
    const changedNow = Object.keys(boardNow).filter((n) => !boardWas[n]?.equals(boardNow[n]))
    ok(['ppt/slideMasters/slideMaster1.xml', 'ppt/theme/theme1.xml', 'ppt/charts/chart1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide9.xml'].every((n) => boardNow[n]?.equals(boardWas[n])), 'the masters, layouts, theme, chart and slides not touched: byte for byte as they were', changedNow)
    // Every part written is XML a reader takes (as the browser reads it).
    const bad = await p.evaluate((xs) => xs.filter(([, x]) => new DOMParser().parseFromString(x, 'application/xml').getElementsByTagName('parsererror').length).map(([n]) => n), changedNow.filter((n) => /\.(xml|rels)$/.test(n)).map((n) => [n, boardNow[n].toString()]))
    ok(!bad.length, 'every part written well-formed XML', bad)
    const reread = await X.readPptx(fs.readFileSync(path.join(dir, 'board.pptx')))
    reread.urlOf = () => null
    const rv = reread.slides.map((s) => X.slideView(reread, s))
    ok(reread.slides.length === 22 && /Agenda for 2026/.test(X.plainOf(rv[1].objs[0].textModel)) && /Budget/.test(X.plainOf(rv[1].objs[1].textModel)) && reread.slides[2].notes.text === 'Keep it short' && reread.slides[21].hidden && rv[13].objs.some((o) => o.kind === 'table') && rv[13].objs.some((o) => o.kind === 'pic'), 'read back: the words, the new point, notes, the skipped copy, the table and picture', reread.slides.length)
    // A Markdown deck of it, beside it; this slide as a picture.
    await p.locator('.px-row button[aria-label="Export"]').click()
    await p.locator('.sd-tool-menu .menu-item', { hasText: 'Markdown deck, beside it' }).click()
    ok(!!(await until(() => fs.existsSync(path.join(dir, 'board.md')) && /# Agenda for 2026/.test(fs.readFileSync(path.join(dir, 'board.md'), 'utf8')), 10000, 100)), 'Export: a Markdown deck of it, beside it')
    await p.locator('.px-row button[aria-label="Export"]').click()
    await p.locator('.sd-tool-menu .menu-item', { hasText: 'This slide as a picture' }).click()
    ok(!!(await until(async () => /saved as a picture/.test((await p.locator('.sd-note').allInnerTexts()).join(' ')), 8000, 100)), 'Export: this slide as a picture', (await p.locator('.sd-note').allInnerTexts()).join(' '))
  }
  ok(w.errors.length === 0, 'no page errors', w.errors)
  // Studio's own save isn't a change from outside. A look at whether the file changed, sent just
  // before a save and answered after it, saw the save: the deck was loaded again (back to slide 1,
  // what was being done in it lost) and "Another app changed it" said. Now it stays as it is, and a
  // change from outside after it is still shown.
  fs.writeFileSync(path.join(dir, 'race.md'), DECK)
  let hold = false
  const held = []
  const rc = await page(b, kit.url, { width: 1440, height: 900, before: async (c) => { await noServiceWorker(c); await c.route(/\/api\/studio\/changed/, (r) => (hold ? held.push(r) : r.continue())) } })
  pages.push(rc)
  const rp = rc.p
  const rThumbs = rp.locator('.sd-strip .sd-thumb')
  const rBar = () => rp.locator('.sd-bar').innerText().catch(() => '')
  await rp.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await opened(rp, 'race.md')
  await until(async () => (await rThumbs.count()) === 6, 10000)
  await rThumbs.nth(2).locator('.sd-thumb-btn').click()
  await rp.locator('.sd-canvas section[id] h1.sd-ed').click()
  await rp.keyboard.press(`${MOD}+a`)
  await rp.keyboard.type('What changed here')
  await rp.keyboard.press('Escape')
  await until(async () => /Unsaved/.test(await rp.locator('.sd-status .sd-state').innerText()), 5000, 100)
  hold = true
  await rp.evaluate(() => window.dispatchEvent(new Event('focus'))) // Studio looks at once
  const looked = await until(() => held.length > 0, 5000, 50)
  await rp.keyboard.press(`${MOD}+s`)
  await until(async () => /Saved/.test(await rp.locator('.sd-status .sd-state').innerText()), 8000, 100)
  hold = false
  const answered = rp.waitForResponse(/\/api\/studio\/changed/, { timeout: 5000 }).catch(() => null)
  for (const r of held.splice(0)) await r.continue()
  await answered
  // Given time to load it again, as it did.
  const raced = async () => ({ status: (await rp.locator('.sd-status').innerText()).replace(/\s+/g, ' '), bar: await rBar(), conflict: await rp.locator('.sd-conflict').count(), title: await rp.locator('.sd-canvas section[id] h1').innerText().catch(() => '') })
  const reloaded = await until(async () => { const x = await raced(); return (!/Slide 3 of 6/.test(x.status) || /changed it/.test(x.bar) || x.conflict) && x }, 3000, 100)
  const now = reloaded || await raced()
  const rVersions = (await api(`/studio/versions?root=${encodeURIComponent(root)}&path=race.md`)).versions.map((v) => v.by)
  ok(!!looked && !reloaded && /What changed here/.test(now.title) && rVersions[0] === 'you' && !rVersions.includes('outside'), 'a look at the file sent before your save and answered after it: the deck stays as it is (the slide you\'re on, nothing said), and the save is your version', { ...now, versions: rVersions })
  await sleep(50)
  fs.writeFileSync(path.join(dir, 'race.md'), fs.readFileSync(path.join(dir, 'race.md'), 'utf8').replace('# Why now', '# Why now, from outside'))
  await rp.evaluate(() => window.dispatchEvent(new Event('focus')))
  ok(!!(await until(async () => /from outside/.test(await rThumbs.nth(1).innerText().catch(() => '')) && /Another app changed it/.test(await rBar()), 8000, 100)), 'and a change from outside after it is still shown, and said', await rBar())
  // In the dark, the same deck.
  const dk = await page(b, kit.url, { width: 1440, height: 900, mode: 'dark' })
  pages.push(dk)
  await dk.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  ok(!!(await opened(dk.p, 'pitch.md')), 'dark: the deck opens')
  await sleep(400)
  await shot(dk.p, `${tag}deck-1440-dark`)
  await dk.p.locator('.sd-file .pane-head button[aria-label="AI Assist"]').click()
  await shot(dk.p, `${tag}deck-ai-menu-dark`)
  await dk.p.locator('.ai-menu button', { hasText: 'Write the deck' }).click()
  await sleep(200)
  await shot(dk.p, `${tag}deck-ai-dark`)
  ok(!!(await until(async () => { await open(dk.p, 'board.pptx'); return dk.p.locator('.px-canvas [data-o]').first().waitFor({ timeout: 3000 }).then(() => true, () => false) }, 30000, 200)), 'dark: a PowerPoint opens, its slides white as they are')
  await dk.p.locator('.px-canvas [data-o]').nth(1).click()
  await sleep(200)
  await shot(dk.p, `${tag}deck-pptx-dark`)
  // On a phone: the slide across the screen, back and next under it, every slide in the grid;
  // everything a whole 40 px target, and nothing wider than the screen. Light and dark.
  for (const mode of ['light', 'dark']) {
    const ph = await page(b, kit.url, { phone: true, mode })
    pages.push(ph)
    await ph.p.waitForSelector('.app', { timeout: 15000 })
    ok(!!(await opened(ph.p, 'pitch.md')), `phone (${mode}): the deck opens`)
    await sleep(500)
    let f = await phoneFaults(ph.p, '.sd-file')
    ok(!Object.keys(f).length, `phone (${mode}): a deck fits, its toolbar wrapping, each control a whole 40 px target`, f)
    ok(/1 of 6/.test(await ph.p.locator('.sd-nav').innerText()), `phone (${mode}): which slide, under it`)
    await shot(ph.p, `${tag}deck-phone-${mode}`)
    await ph.p.locator('.sd-nav button[aria-label="Next"]').click()
    ok(!!(await until(async () => /2 of 6/.test(await ph.p.locator('.sd-nav').innerText()), 3000, 100)), `phone (${mode}): Next`)
    await ph.p.locator('.sd-nav button', { hasText: 'All slides' }).click()
    await until(async () => (await ph.p.locator('.sd-sorter .sd-slide-in').count()) === 6, 5000, 100)
    f = await phoneFaults(ph.p, '.sd-file')
    ok(!Object.keys(f).length, `phone (${mode}): every slide in a grid of two, fitting`, f)
    await shot(ph.p, `${tag}deck-phone-grid-${mode}`)
    await ph.p.locator('.sd-sorter .sd-thumb-btn').nth(0).click()
    if (mode === 'light') {
      // A PowerPoint on a phone: the slide across the screen, the next a tap away, fitting.
      ok(!!(await until(async () => { await open(ph.p, 'board.pptx'); return ph.p.locator('.px-canvas [data-o]').first().waitFor({ timeout: 3000 }).then(() => true, () => false) }, 30000, 200)), 'phone: a PowerPoint opens')
      await sleep(300)
      f = await phoneFaults(ph.p, '.sd-file')
      ok(!Object.keys(f).length, 'phone: a PowerPoint fits, each control a whole 40 px target', f)
      await ph.p.locator('.sd-nav button[aria-label="Next"]').click()
      ok(!!(await until(async () => /2 of 22/.test(await ph.p.locator('.sd-nav').innerText()), 3000, 100)), 'phone: its next slide')
      await shot(ph.p, `${tag}deck-phone-pptx`)
      ok(!!(await opened(ph.p, 'pitch.md')), 'phone: back to the deck')
      await ph.p.locator('.sd-file .pane-head button[aria-label="AI Assist"]').click()
      f = await phoneFaults(ph.p, '.ai-menu')
      ok(!Object.keys(f).length, 'phone: AI Assist\'s menu fits, every choice a whole target', f)
      await shot(ph.p, `${tag}deck-phone-ai-menu`)
      await ph.p.locator('.ai-menu button', { hasText: 'Write the deck' }).click()
      await ph.p.locator('.sd-ai textarea').waitFor({ timeout: 5000 })
      f = await phoneFaults(ph.p, '.sd-ai')
      ok(!Object.keys(f).length, 'phone: AI Assist over the slide, fitting, its fields 16 px', f)
      await shot(ph.p, `${tag}deck-phone-ai`)
      await ph.p.locator('.sd-ai-head button[aria-label="Close AI Assist"]').click()
      await ph.p.locator('.sd-deck-tools button[aria-label="Present"]').click()
      await ph.p.locator('.sd-present').waitFor({ timeout: 5000 })
      await ph.p.locator('.sd-present-stage').tap({ position: { x: 300, y: 300 } })
      ok(!!(await until(async () => /2 of 6/.test(await ph.p.locator('.sd-present-n').innerText()), 3000, 100)), 'phone: presenting, a tap on the right goes on')
      await shot(ph.p, `${tag}deck-phone-present`)
      await ph.p.locator('.sd-present-bar button[aria-label="Stop presenting"]').click()
    }
    ok(ph.errors.length === 0, `phone (${mode}): no page errors`, ph.errors)
  }
  await shot(p, `${tag}deck-after`)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const x of pages) await x.ctx.close().catch(() => {})
  await b.close()
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
