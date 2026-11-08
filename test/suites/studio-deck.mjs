// Studio's decks, on any platform, in the browser named by BRIDGE_TEST_BROWSER. A Markdown deck
// (Marp's format) and a PowerPoint in a folder you added to Files (a place).
// The files (no page): a deck's slides found as Marp finds them; slides added, duplicated, moved,
// deleted, laid out, noted and pictured by changing its Markdown; what's typed on a slide put back
// on its own lines; a PowerPoint made of it with a layout per kind of slide, placeholders for its
// titles and text, notes, pictures, its look in its theme, and every paragraph's properties once
// (or PowerPoint offers to repair it); and read back into the same deck (a round trip, twice); a
// PowerPoint made elsewhere read too. The server: a picture saved beside a deck; AI writing a deck
// from what it's about or a document, rewriting a slide, adding one; no model, said.
// The page: the slides down the side and the slide in the middle; typing a title right on the
// slide, and a point (Enter for the next, Tab in a level); "Click to add title" where a slide has
// none; a new slide in a layout, duplicated, moved by dragging and by keys, deleted, undone; its
// layout and theme from the galleries; a picture; speaker notes; the grid of every slide;
// presenting full screen, next and back, the presenter's view; AI writing a deck shown before it's
// taken; the PowerPoint, and a PowerPoint opened, changed and saved as one; the Markdown kept as
// it was where it wasn't touched. At 1440 wide and on a 390 phone, light and dark.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
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
  // Write with AI: a slide rewritten, shown first, kept; then a whole deck, shown first, put after.
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
  await p.locator('.sd-ai-head button[aria-label="Close"]').click()
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
  // A PowerPoint, opened as slides: its text, pictures, notes and theme; changed and saved as one.
  await open(p, 'theirs.pptx')
  await until(async () => (await thumbs.count()) === 6 && /Q4 pitch/.test(await canvas.innerText().catch(() => '')), 20000, 200)
  ok((await thumbs.count()) === 6 && /PowerPoint, shown with its text/.test(await p.locator('.sd-deck-said').innerText()) && /d9502b/i.test(await p.locator('.sd-deck2 > style').innerText()), 'a PowerPoint opens as its six slides, in its own theme, saying what\'s shown')
  await thumbs.nth(1).locator('.sd-thumb-btn').click()
  ok(!!(await until(async () => (await canvas.locator('figure, img').count()) > 0 || /blob:/.test(await p.locator('.sd-canvas').innerHTML()), 5000, 100)), 'its picture on its slide')
  await shot(p, `${tag}deck-pptx`)
  // A title typed on its first slide.
  const retitle = async (words) => {
    await thumbs.nth(0).locator('.sd-thumb-btn').click()
    await canvas.locator('h1.sd-ed').click()
    await p.keyboard.press(`${MOD}+a`)
    await p.keyboard.type(words)
    await p.keyboard.press('Escape')
  }
  const dialog = p.locator('.sd-conflict[role="alertdialog"]')
  const original = fs.readFileSync(path.join(dir, 'theirs.pptx'))
  const read = (name) => P.deckFromPptx(fs.readFileSync(path.join(dir, name)), name).catch(() => null)
  await retitle('Their pitch')
  // Export as a Markdown deck, with its picture beside it.
  await p.locator('.sd-deck-tools button[aria-label="Export"]').click()
  await p.locator('.sd-tool-menu .menu-item', { hasText: 'Markdown deck, beside it' }).click()
  const asMd = await until(() => fs.existsSync(path.join(dir, 'theirs.md')) && fs.readFileSync(path.join(dir, 'theirs.md'), 'utf8'), 10000, 200)
  ok(!!asMd && /^---\nmarp: true/.test(asMd) && /# Their pitch/.test(asMd) && /!\[bg right:42%\]\(images\/theirs-1\.png\)/.test(asMd) && fs.existsSync(path.join(dir, 'images', 'theirs-1.png')), 'Export as a Markdown deck: beside it, its picture beside it too', asMd)
  // Its first save: a copy unless you say otherwise, since it's redrawn in Studio's layouts.
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  await dialog.waitFor({ timeout: 5000 })
  const choices = await dialog.locator('button').evaluateAll((bs) => bs.map((x) => `${x.innerText.trim()}${x.classList.contains('primary') ? ' (primary)' : ''}`))
  ok(/writes the PowerPoint again/.test(await dialog.innerText()) && choices.join() === 'Save as a copy (primary),Replace the original,Not now', 'its first save: Save as a copy first, Replace the original second, saying what replacing loses', choices)
  await shot(p, `${tag}deck-pptx-save`)
  await dialog.locator('button', { hasText: 'Save as a copy' }).click()
  const copy = await until(async () => fs.existsSync(path.join(dir, 'theirs (Studio).pptx')) && (await read('theirs (Studio).pptx')), 10000, 300)
  ok(!!copy && /# Their pitch/.test(copy.md) && copy.media.length === 1 && /<!-- Say the numbers -->/.test(copy.md) && copy.look.colors.accent === '#d9502b' && fs.readFileSync(path.join(dir, 'theirs.pptx')).equals(original), 'Save as a copy: "theirs (Studio).pptx" beside it, with the change, its picture, notes and theme; the original\'s bytes untouched', copy && copy.md.slice(0, 200))
  ok(!!(await until(async () => (await p.locator('.sd-file .pane-head h2').innerText()) === 'theirs (Studio).pptx' && /Their pitch/.test(await canvas.innerText().catch(() => '')), 10000, 200)), 'and the copy opens, to carry on in', await p.locator('.sd-file .pane-head h2').innerText())
  await retitle('Their pitch, again')
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  const toCopy = await until(async () => { const x = await read('theirs (Studio).pptx'); return x && /# Their pitch, again/.test(x.md) }, 10000, 300)
  ok(!!toCopy && (await dialog.count()) === 0, 'the copy saves to itself, without asking')
  // Asked again on the original: another copy is (Studio 2); Replace asks once, then saves over it.
  await opened(p, 'theirs.pptx')
  await until(async () => /Q4 pitch/.test(await canvas.innerText().catch(() => '')), 10000, 200)
  await retitle('Second try')
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  await dialog.waitFor({ timeout: 5000 })
  await dialog.locator('button', { hasText: 'Save as a copy' }).click()
  ok(!!(await until(async () => /# Second try/.test((await read('theirs (Studio 2).pptx'))?.md || ''), 10000, 300)) && fs.readFileSync(path.join(dir, 'theirs.pptx')).equals(original), 'a second copy: "theirs (Studio 2).pptx", the original still untouched')
  await opened(p, 'theirs.pptx')
  await until(async () => /Q4 pitch/.test(await canvas.innerText().catch(() => '')), 10000, 200)
  await retitle('Replaced here')
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  await dialog.waitFor({ timeout: 5000 })
  await dialog.locator('button', { hasText: 'Replace the original' }).click()
  const replaced = await until(async () => { const x = await read('theirs.pptx'); return x && /# Replaced here/.test(x.md) && x }, 10000, 300)
  ok(!!replaced && replaced.media.length === 1 && /<!-- Say the numbers -->/.test(replaced.md), 'Replace the original: saved over it, its picture and notes still there')
  await retitle('Replaced twice')
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  ok(!!(await until(async () => /# Replaced twice/.test((await read('theirs.pptx'))?.md || ''), 10000, 300)) && (await dialog.count()) === 0, 'and from then on it saves over it without asking again')
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
  await dk.p.locator('.sd-deck-tools button[aria-label="Write with AI"]').click()
  await sleep(200)
  await shot(dk.p, `${tag}deck-ai-dark`)
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
      // A PowerPoint's first save, on a phone: the copy first, every choice a whole target.
      ok(!!(await opened(ph.p, 'pitch.pptx')), 'phone: a PowerPoint opens')
      const head = ph.p.locator('.sd-canvas section[id] h1.sd-ed')
      await head.click()
      await head.evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r) })
      await ph.p.keyboard.type(' too')
      await ph.p.locator('.sd-canvas section[id] h1.sd-ed').evaluate((e) => e.blur())
      await ph.p.locator('.pane-head button[aria-label="Save"]').click()
      await ph.p.locator('.sd-conflict[role="alertdialog"]').waitFor({ timeout: 5000 })
      f = await phoneFaults(ph.p, '.sd-conflict')
      ok(!Object.keys(f).length, 'phone: the save dialog fits, each choice a whole 40 px target', f)
      await shot(ph.p, `${tag}deck-phone-pptx-save`)
      await ph.p.locator('.sd-conflict button', { hasText: 'Not now' }).click()
      ok(!!(await opened(ph.p, 'pitch.md')), 'phone: back to the deck')
      await ph.p.locator('.sd-deck-tools button[aria-label="Write with AI"]').click()
      await ph.p.locator('.sd-ai textarea').waitFor({ timeout: 5000 })
      f = await phoneFaults(ph.p, '.sd-ai')
      ok(!Object.keys(f).length, 'phone: Write with AI over the slide, fitting, its fields 16 px', f)
      await shot(ph.p, `${tag}deck-phone-ai`)
      await ph.p.locator('.sd-ai-head button[aria-label="Close"]').click()
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
