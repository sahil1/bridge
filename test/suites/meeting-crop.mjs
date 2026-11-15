// Pictures of a call's window cropped to what's shared in them (src/components/meetings/crop.js,
// worked out in the page by cropping.jsx, kept beside the picture by meetings.js cropCapture).
// The call windows are mock ones, drawn in a page and taken as JPEGs the way a watched screen's
// pictures are (lib/callwindows.mjs): Teams with people down the right and buttons along the bottom,
// Zoom with people across the top, Meet with people beside it, at a few window sizes, cameras on and
// off, a dark slide and a 4:3 one. The crop lands on the slide within a few pixels and never cuts
// into it. A screen shared on its own, a slide with a row of logos at its foot, a call's gallery
// with nobody sharing and a deck being edited (its thumbnails beside it) aren't cropped.
// A call with one other person is cropped once the window's name says it's a call, or a second
// picture of it backs the first up; a dark slide gets the crop the slides before it had.
// In the app: a meeting's pictures from before are cropped as its page opens, and each is shown,
// read (by a stand-in for native/bridgeocr, not on Windows) and saved in its notes as its crop.
// Whole screen on one puts it back and Crop crops it again, with no reading again; Settings › Voice
// & Meetings turns it off, and then a crop is kept aside and offered. While it records (Chromium,
// with its fake mic): Capture on a watched call window keeps a cropped picture.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, ROOT, OUT, IS_WIN } from '../lib/harness.mjs'
import { render } from '../lib/callwindows.mjs'

const { ok, skip, done } = checks('meeting-crop')
// The words on a picture: which file it was, so a check can tell the crop's from the whole one's.
const ocr = (bin) => {
  fs.writeFileSync(path.join(bin, 'ocr.cjs'), `const fs = require('node:fs'), path = require('node:path'), f = process.argv[3]
fs.appendFileSync(path.join(__dirname, 'ocr.log'), f + '\\n')
process.stdout.write('Words on ' + path.basename(f) + '\\nQuarterly plan')`)
  fs.writeFileSync(path.join(bin, 'bridgeocr'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'ocr.cjs')}" "$@"\n`, { mode: 0o755 })
  return path.join(bin, 'bridgeocr')
}
const kit = await startKit('meeting-crop', { env: ({ bin }) => (IS_WIN ? {} : { BRIDGE_OCR: ocr(bin) }) })
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const reads = () => { try { return fs.readFileSync(path.join(kit.bin, 'ocr.log'), 'utf8').split('\n').filter(Boolean) } catch { return [] } }
// How far a crop is from the slide, side by side (negative: outside it), and whether it holds all of it.
const off = (r, s) => ['x0', 'y0', 'x1', 'y1'].map((k) => r[k] - s[k])
const holds = (d) => d[0] <= 0 && d[1] <= 0 && d[2] >= 0 && d[3] >= 0
const near = (d, px = 8) => holds(d) && d.every((v) => Math.abs(v) <= px)

try {
  // ---------- The crop, worked out on each mock window ----------
  const ctx = await b.newContext()
  const draw = await ctx.newPage()
  const work = await ctx.newPage()
  await work.setContent('<html><body></body></html>')
  const src = fs.readFileSync(path.join(ROOT, 'src/components/meetings/crop.js'), 'utf8').replace(/^export /gm, '')
  await work.addScriptTag({ content: `${src}\nwindow.crop = { analyze, steady }` })
  const look = (jpeg, source = '') => work.evaluate(async ([b64, source]) => {
    const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob()
    const bm = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bm.width
    c.height = bm.height
    const x = c.getContext('2d')
    x.drawImage(bm, 0, 0)
    return window.crop.analyze(x.getImageData(0, 0, c.width, c.height), { source })
  }, [jpeg.toString('base64'), source])
  // Pictures of one meeting, in order: each one's crop once they're weighed together.
  const together = (looks) => work.evaluate((looks) => { const s = window.crop.steady(); let now; looks.forEach((a, i) => { now = s.add(i, a) }); return looks.map((_, i) => now.get(i) || null) }, looks)

  const SIZES = [[1920, 1080], [1440, 900], [1280, 720]]
  const VARIANTS = [[{}, 'cameras on'], [{ off: true }, 'cameras off'], [{ aspect: 4 / 3 }, 'a 4:3 slide']]
  for (const name of ['teams', 'zoom', 'meet']) {
    const got = []
    for (const [W, H] of SIZES) for (const [o, what] of VARIANTS) {
      const r = await render(draw, name, { W, H, n: got.length + 1, ...o })
      const a = await look(r.jpeg)
      got.push({ W, H, what, d: a.crop ? off(a.crop, r.slide) : null, why: a.why })
      if (W === 1920 && !o.off && !o.aspect) { fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true }); fs.writeFileSync(path.join(OUT, 'shots', `${tag}crop-${name}.jpg`), r.jpeg) }
    }
    const worst = Math.max(...got.filter((g) => g.d).map((g) => Math.max(...g.d.map(Math.abs))))
    console.log(`${name}: ${got.filter((g) => g.d).length} of ${got.length} cropped, the farthest edge ${worst} px from the slide`)
    ok(got.every((g) => g.d && near(g.d)), `${name}: each picture cropped to the slide, every edge within 8 px of it and none inside it (${SIZES.length} window sizes; cameras on and off; a 4:3 slide)`, got.filter((g) => !g.d || !near(g.d)))
  }
  {
    // Dark slides: the crop of the slides around them, in one meeting. A 4:3 page shared after the
    // deck: a crop of its own.
    const shots = []
    for (const [n, o] of [[1, {}], [2, { dark: true }], [3, {}], [4, { dark: true }], [5, { aspect: 4 / 3 }]]) shots.push(await render(draw, 'teams', { W: 1600, H: 900, n, ...o }))
    const looks = []
    for (const s of shots) looks.push(await look(s.jpeg))
    const crops = await together(looks)
    const ds = crops.map((c, i) => c && off(c, shots[i].slide))
    const deck = crops.slice(0, 4)
    ok(ds.slice(0, 4).every((d) => d && near(d)) && deck.every((c) => JSON.stringify(c) === JSON.stringify(deck[0])), 'a deck with dark slides in it: every slide gets the one crop, the dark ones too', ds)
    ok(ds[4] && near(ds[4]), 'and a 4:3 page shared after it gets its own', ds[4])
  }
  {
    // Nobody to crop away: a screen shared on its own, light or dark, and a slide with logos at its foot.
    const plain = []
    for (const [name, o] of [['plain', {}], ['plain', { dark: true }], ['plain', { W: 1440, H: 900, n: 3 }], ['logos', {}], ['logos', { dark: false, n: 2 }]]) {
      const r = await render(draw, name, o)
      const a = await look(r.jpeg)
      plain.push({ name, crop: a.crop, why: a.why })
    }
    ok(plain.every((x) => !x.crop), 'a screen shared on its own, and a slide with a row of logos at its foot, are left whole', plain)
    // Nor a call with nobody sharing (never cropped to one face), nor a deck being edited, its
    // slides' thumbnails beside it, light or dark, twice over.
    const rest = []
    for (const [name, o] of [['gallery', {}], ['gallery', { off: true, W: 1600, H: 900 }], ['gallery', { people: 4, off: true }], ['editor', {}], ['editor', { dark: true }], ['editor', { dark: true, W: 1440, H: 900 }]]) {
      const r = await render(draw, name, o)
      rest.push({ name, o, a: await look(r.jpeg) })
    }
    const twice = await together([rest[3].a, rest[3].a, rest[4].a, rest[4].a])
    ok(rest.every((x) => !x.a.crop) && twice.every((c) => !c), 'a call with nobody sharing, and a deck being edited with its thumbnails beside it, are left whole', rest.map((x) => ({ name: x.name, o: x.o, crop: x.a.crop, why: x.a.why })))
  }
  {
    // A call with one other person: one tile isn't enough on its own.
    const one = await render(draw, 'teams', { W: 1600, H: 900, people: 1, n: 2 })
    const alone = await look(one.jpeg)
    ok(!alone.crop && /not sure/.test(alone.why.join()), 'a call with one other person, on its own: left whole (one tile could be a picture on a slide)', alone.why)
    const named = await look(one.jpeg, 'Q3 planning | Microsoft Teams')
    ok(named.crop && near(off(named.crop, one.slide)), 'the same, in a window named Microsoft Teams: cropped', named.crop && off(named.crop, one.slide))
    const two = await render(draw, 'teams', { W: 1600, H: 900, people: 1, n: 3 })
    const crops = await together([alone, await look(two.jpeg)])
    ok(crops.every((c) => c && near(off(c, one.slide))), 'and two pictures of it back each other up: both cropped, the first one too', crops)
  }
  await ctx.close()

  // ---------- In the app ----------
  await api('/setup', { name: 'Tester' })
  await api('/settings', { meetings: { autoSummary: false, folder: path.join(kit.home, 'Meeting notes') } }, 'PATCH')
  const M = await api('/meetings', { title: 'Q3 planning', call: false })
  await api(`/meetings/${M.id}/stop`, {})
  const dctx = await b.newContext()
  const dp = await dctx.newPage()
  const put = async (name, o, t) => {
    const r = await render(dp, name, o)
    const c = await fetch(`${kit.url}/api/meetings/${M.id}/captures?kind=screen&t=${t}&source=${encodeURIComponent(o.source || 'Entire screen')}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: r.jpeg }).then((x) => x.json())
    return { ...r, c }
  }
  const stills = [await put('teams', { n: 1 }, 10), await put('teams', { n: 2 }, 40), await put('teams', { n: 3, dark: true }, 70), await put('plain', { n: 4 }, 100)]
  if (!IS_WIN) await until(async () => (await api(`/meetings/${M.id}`)).captures.every((c) => c.read === 'done'), 15000)
  const before = reads().length
  const { p, errors } = await page(b, kit.url, { store: { 'cc-rail-meetings': true } })
  await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).click()
  await p.locator('.mt-row-open', { hasText: 'Q3 planning' }).click()
  const caps = await until(async () => { const c = (await api(`/meetings/${M.id}`)).captures; return c.every((x) => x.crop) && c }, 20000)
  ok(!!caps, 'its pictures from before are looked at as its page opens', caps)
  if (caps) {
    const [t1, t2, t3, pl] = caps
    const d = [t1, t2, t3].map((c, i) => c.crop.rect && off(c.crop.rect, stills[i].slide))
    ok(d.every((x) => x && near(x)) && [t1, t2, t3].every((c) => c.file === c.crop.file && c.crop.on && c.crop.whole === stills[0].c.file.replace(stills[0].c.id, c.id)), 'the call\'s pictures are cropped to the slide (the dark one too) and kept beside the pictures as taken', d)
    ok(!pl.crop.rect && !pl.crop.file && pl.file === stills[3].c.file, 'the one shared on its own is left as it was', pl.crop)
    const files = fs.readdirSync(path.join(kit.data, 'meetings', M.id, 'captures')).sort()
    ok(files.length === 7, 'both pictures of each cropped one are on the computer, one of the other', files)
    // What's shown is the crop.
    const shown = await until(async () => { const w = await p.locator('.mt-pic-img img').evaluateAll((els) => els.map((e) => e.complete && e.naturalWidth)); return w.length === 4 && w.every(Boolean) && w }, 8000)
    ok(shown && shown.slice(0, 3).every((w, i) => w === caps[i].crop.rect.x1 - caps[i].crop.rect.x0) && shown[3] === 1920, 'the meeting shows each crop, and the other whole', shown)
    await shot(p, `${tag}meeting-crop`)
    // And it's read: the crop's words, not the whole screen's.
    if (!IS_WIN) {
      const read = await until(async () => { const c = (await api(`/meetings/${M.id}`)).captures; return c.slice(0, 3).every((x) => x.read === 'done' && /-crop\.jpg/.test(x.text)) && c }, 15000)
      ok(!!read, 'the words on each are read from its crop', (await api(`/meetings/${M.id}`)).captures.map((x) => x.text))
      ok(reads().slice(before).every((f) => /-crop\.jpg$/.test(f)) && reads().length - before === 3, 'and only the crops were read again', reads().slice(before))
    } else skip('the words on the crop', 'native/bridgeocr is Mac-only, and its stand-in a shell script')
    // In the notes: Save as Markdown puts the crops in.
    const saved = await api(`/meetings/${M.id}/save`, {})
    const noteFile = (saved.files || []).find((f) => /From the screen/.test(fs.readFileSync(f, 'utf8'))) || ''
    const note = noteFile ? fs.readFileSync(noteFile, 'utf8') : ''
    const att = path.join(path.dirname(noteFile), 'attachments')
    ok(caps.slice(0, 3).every((c) => note.includes(`attachments/${c.id}-crop.jpg`) && fs.existsSync(path.join(att, `${c.id}-crop.jpg`))) && note.includes(`attachments/${pl.id}.jpg`), 'its notes saved as Markdown have the crops in them', note.slice(note.indexOf('From the screen'), note.indexOf('From the screen') + 400))

    // Whole screen: the picture as it was taken, back; Crop: the crop again. Nothing read again.
    const btn = p.locator('.mt-pic').first().locator('.mt-pic-crop')
    ok(/Whole screen/.test(await btn.innerText()), 'a cropped picture offers Whole screen', await btn.innerText())
    const r0 = reads().length
    await btn.click()
    const back = await until(async () => { const c = (await api(`/meetings/${M.id}`)).captures[0]; return c.file === c.crop.whole && c.crop.on === false && c.crop.byHand && c }, 6000)
    const w1 = await until(async () => { const w = await p.locator('.mt-pic-img img').first().evaluate((e) => e.complete && e.naturalWidth); return w === 1920 && w }, 6000)
    ok(!!back && w1 === 1920 && /Crop/.test(await btn.innerText()), 'Whole screen puts the picture as it was taken back, in the meeting too, and offers Crop', { back: !!back, w1 })
    if (!IS_WIN) ok(!!back && !/-crop/.test(back.text) && back.read === 'done' && reads().length === r0, 'with the words on it as they were read before, not read again', back?.text)
    await btn.click()
    const again = await until(async () => { const c = (await api(`/meetings/${M.id}`)).captures[0]; return c.file === c.crop.file && c.crop.on && c }, 6000)
    const w2 = await until(async () => { const w = await p.locator('.mt-pic-img img').first().evaluate((e) => e.complete && e.naturalWidth); return w === caps[0].crop.rect.x1 - caps[0].crop.rect.x0 && w }, 6000)
    ok(!!again && !!w2 && (IS_WIN || /-crop\.jpg/.test(again.text)), 'Crop crops it again', again?.text)

    // Off in Settings › Voice & Meetings: a new picture stays whole, its crop offered.
    await p.locator('button[aria-label="Settings"]').first().click()
    await p.waitForSelector('.modal.settings', { timeout: 5000 }).catch(() => {})
    await p.locator('.st-nav-item', { hasText: 'Meetings' }).click()
    const box = p.locator('[data-setting="crop-shots"] input[type="checkbox"]')
    await box.waitFor({ timeout: 6000 }).catch(() => {})
    ok(await box.isChecked().catch(() => false), 'Settings › Voice & Meetings: Crop pictures of a call to what\'s shared, on', await p.locator('[data-setting="crop-shots"]').innerText().catch(() => 'not there'))
    await box.click()
    ok(!!(await until(async () => (await api('/settings')).effective?.meetings?.cropShots === false, 5000)), 'and turned off there', (await api('/settings')).effective?.meetings)
    await p.locator('.modal.settings button[aria-label="Close settings"]').click()
    const late = await put('teams', { n: 5 }, 130)
    const aside = await until(async () => { const c = (await api(`/meetings/${M.id}`)).captures.find((x) => x.id === late.c.id); return c?.crop?.file && c }, 15000)
    ok(!!aside && aside.file === late.c.file && aside.crop.on === false && near(off(aside.crop.rect, late.slide)), 'off: a new picture stays whole, its crop kept aside', aside?.crop)
    const offer = p.locator('.mt-pic').nth(4).locator('.mt-pic-crop')
    ok(!!(await until(async () => /Crop/.test(await offer.innerText().catch(() => '')), 6000)), 'and Crop is offered on it')
    await offer.click()
    ok(!!(await until(async () => { const c = (await api(`/meetings/${M.id}`)).captures.find((x) => x.id === late.c.id); return c.file === c.crop.file }, 6000)), 'which crops that one')
    await api('/settings', { meetings: { cropShots: true } }, 'PATCH')
    // Removing one takes both its pictures.
    await api(`/meetings/${M.id}/captures/${late.c.id}`, null, 'DELETE')
    ok(!fs.readdirSync(path.join(kit.data, 'meetings', M.id, 'captures')).some((f) => f.startsWith(late.c.id)), 'a cropped picture removed takes the one as taken with it')
  }
  {
    // A call with one other person, in a whole screen watched: the first picture isn't plainly a
    // call, so its crop is offered and says why; the second backs it up, and both are cropped.
    const O = await api('/meetings', { title: 'One to one', call: false })
    await api(`/meetings/${O.id}/stop`, {})
    const one = async (n, t) => {
      const r = await render(dp, 'teams', { W: 1600, H: 900, people: 1, n })
      const c = await fetch(`${kit.url}/api/meetings/${O.id}/captures?kind=screen&t=${t}&source=Entire%20screen`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: r.jpeg }).then((x) => x.json())
      return { ...r, c }
    }
    const first = await one(1, 5)
    await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).click()
    await p.locator('.mt-row-open', { hasText: 'One to one' }).click()
    const offered = await until(async () => { const c = (await api(`/meetings/${O.id}`)).captures[0]; return c.crop && c }, 15000)
    const tip = await p.locator('.mt-pic .mt-pic-crop').first().getAttribute('title').catch(() => '')
    ok(!!offered && offered.crop.sure === false && offered.crop.on === false && offered.file === first.c.file && near(off(offered.crop.rect, first.slide)) && /not plainly enough/.test(tip || ''), 'one picture of a call with one other person: left whole, its crop offered, saying why', { crop: offered?.crop, tip })
    const second = await one(2, 25)
    const both = await until(async () => { const c = (await api(`/meetings/${O.id}`)).captures; return c.length === 2 && c.every((x) => x.crop?.on && x.file === x.crop.file) && c }, 15000)
    ok(!!both && both.every((c, i) => near(off(c.crop.rect, [first, second][i].slide))), 'a second picture of it backs the first up: both cropped, the first after the fact', both && both.map((c) => c.crop))
  }
  ok(!errors.length, 'no page errors', errors)
  await p.context().close()
  await dctx.close()

  // ---------- While it records: Capture on a watched call window ----------
  if (which === 'chromium') {
    const pic = (await render(await (await b.newContext()).newPage(), 'zoom', { n: 2 }))
    const live = await page(b, kit.url, { store: { 'cc-rail-meetings': true }, before: async (c) => {
      await c.addInitScript((b64) => {
        const md = navigator.mediaDevices
        if (!md) return
        // The screen picked: Zoom's window, someone sharing slides in it.
        md.getDisplayMedia = async () => {
          const img = new Image()
          img.src = `data:image/jpeg;base64,${b64}`
          await img.decode()
          const cv = document.createElement('canvas')
          cv.width = img.width
          cv.height = img.height
          const x = cv.getContext('2d')
          const drawIt = () => x.drawImage(img, 0, 0)
          drawIt()
          setInterval(drawIt, 300)
          return cv.captureStream(4)
        }
      }, pic.jpeg.toString('base64'))
    } })
    await live.p.waitForSelector('.rail-nav-row .rail-rec', { timeout: 15000 }).catch(() => {})
    await live.p.locator('.rail-nav-row .rail-rec').click()
    await live.p.waitForSelector('.mt-recbar', { timeout: 15000 }).catch(() => {})
    const rec = await until(async () => (await api('/meetings')).meetings.find((x) => x.status === 'recording'), 8000)
    await live.p.locator('.mt-recbar button', { hasText: 'Watch a screen' }).click()
    await until(async () => (await live.p.locator('.mt-recbar button', { hasText: 'Capture' }).count()) === 1, 6000)
    await new Promise((r) => setTimeout(r, 1500))
    await live.p.locator('.mt-recbar button', { hasText: 'Capture' }).click()
    const c = rec && await until(async () => (await api(`/meetings/${rec.id}`)).captures.find((x) => x.crop), 15000)
    ok(!!c && !!c.crop.rect && near(off(c.crop.rect, pic.slide)) && c.file === c.crop.file, 'while it records, Capture on a watched Zoom window keeps the slide, cropped', c?.crop)
    if (rec) await api(`/meetings/${rec.id}/stop`, {})
    ok(!live.errors.length, 'no page errors while it records', live.errors)
    await live.p.context().close()
  } else skip('Capture while it records', `${which} has no fake mic or screen to share`)
} finally {
  await b.close()
  await kit.stop()
}
process.exit(done().fail ? 1 : 0)
