// A file moved or deleted while it's open in Studio (server/studio.js movedTo, saveCopy, the drafts;
// src/components/studio/Studio.jsx FilePage's gone), in the browser named by BRIDGE_TEST_BROWSER.
// What's in the editor is never lost: the page says "<name> was moved or deleted while it was open",
// keeps what's there as a recovery draft on its computer until it's saved somewhere, and offers Keep
// editing it there (moved: found by its number on its disk), Save a copy (in the folder it was in, or
// another of yours) and Download. It said "Couldn't save it: Not found", and leaving lost the work.
// On a computer: a document moved to a folder while typed in, kept editing where it went; a page
// deleted with unsaved changes, the window reloaded (its draft opens), a copy saved where it was; a
// big deck opened in parts, deleted, a copy saved in Studio's own folder with its photo put back from
// its versions byte for byte. On a phone: a note deleted while typed in, the bar fitting, Download.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { startKit, checks, until, sleep, browser, page, shot, phoneFaults, noServiceWorker, ROOT } from '../lib/harness.mjs'
import { bigDeck } from '../lib/bigdeck.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const JSZip = require('jszip')
const { ok, done } = checks('studio-gone')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const kit = await startKit('studio-gone')
const contexts = []
try {
  await kit.api('/setup', { name: 'Tester' })
  const dir = path.join(kit.home, 'Notes')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'Draft plan.md'), '# Draft plan\n\nShip on Friday.\n')
  fs.writeFileSync(path.join(dir, 'Prices.html'), '<!doctype html><title>Prices</title><h1>Old prices</h1>')
  fs.writeFileSync(path.join(dir, 'Phone note.md'), '# Phone note\n\nCall the site.\n')
  const { bytes: deck } = await bigDeck({ count: 3, photos: 1 })
  fs.writeFileSync(path.join(dir, 'Site deck.pptx'), deck)
  const photoSha = sha(await (await JSZip.loadAsync(deck)).file('ppt/media/photo1.png').async('nodebuffer'))
  const drafts = () => { try { return fs.readdirSync(path.join(kit.data, 'studio', 'drafts')).filter((n) => n.endsWith('.bin')).map((n) => fs.readFileSync(path.join(kit.data, 'studio', 'drafts', n))) } catch { return [] } }

  // ---------- on a computer ----------
  const dk = await page(b, kit.url, { width: 1440, height: 900, before: noServiceWorker })
  contexts.push(dk.ctx)
  const p = dk.p
  const openHere = (pg, rel) => until(async () => {
    await pg.evaluate((detail) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail })), { root: 'home', path: rel })
    return pg.evaluate((name) => document.querySelector('.sd-file .pane-head h2 .mid-name')?.getAttribute('title') === name, rel.split('/').pop())
  }, 20000, 700)
  const bar = (pg) => pg.locator('.sd-gone')
  const lookNow = (pg) => pg.evaluate(() => window.dispatchEvent(new Event('focus'))) // as coming back to the window does

  // A document moved to another folder while it's typed in: said, found where it went, kept editing there.
  await openHere(p, 'Notes/Draft plan.md')
  await p.locator('.sd-page .ProseMirror', { hasText: 'Ship on Friday' }).waitFor({ timeout: 20000 })
  fs.mkdirSync(path.join(dir, 'Moved'))
  fs.renameSync(path.join(dir, 'Draft plan.md'), path.join(dir, 'Moved', 'Draft plan.md'))
  await p.locator('.sd-page .ProseMirror').click()
  await p.keyboard.press(`${MOD}+End`)
  await p.keyboard.type(' Typed after it moved.')
  const said = await until(async () => { const x = await bar(p).innerText().catch(() => ''); return /It's in ~\/Notes\/Moved\/Draft plan\.md now/.test(x) ? x : null }, 20000, 200)
  ok(/^Draft plan\.md was moved or deleted while it was open\./.test(said || '') && /Your changes are still here, kept as a draft/.test(said || ''), 'a document moved while typed in: "Draft plan.md was moved or deleted while it was open", where it is now, and its changes kept', said || await bar(p).innerText().catch(() => ''))
  ok(!!(await until(() => drafts().some((x) => /Typed after it moved/.test(x.toString())), 8000, 200)), 'its changes kept as a recovery draft on its computer')
  const head = await p.locator('.sd-file .pane-head').evaluate((h) => ({ save: !!h.querySelector('.sd-save-btn'), state: h.querySelector('.sd-save-state')?.innerText.trim() }))
  ok(!head.save && head.state === 'Moved or deleted' && !(await p.locator('.sd-note-bar', { hasText: 'Not found' }).count()), 'the header says Moved or deleted (no Save, no "Couldn\'t save it: Not found")', head)
  await shot(p, `${tag}studio-gone-moved`)
  await bar(p).locator('button', { hasText: 'Keep editing it there' }).click()
  const there = await until(() => { const x = fs.readFileSync(path.join(dir, 'Moved', 'Draft plan.md'), 'utf8'); return /Typed after it moved/.test(x) ? x : null }, 10000, 200)
  const opened = await until(async () => (await p.locator('.sd-page .ProseMirror').innerText().catch(() => '')).includes('Typed after it moved') && !(await bar(p).count()), 10000, 200)
  ok(!!there && /^# Draft plan/.test(there) && !!opened && !fs.existsSync(path.join(dir, 'Draft plan.md')) && !drafts().length, 'Keep editing it there: what was typed saved where it went, open there now, its draft gone', { there, opened })

  // A page with unsaved changes, deleted: said; the window reloaded, its draft opens; a copy saved where it was.
  await openHere(p, 'Notes/Prices.html')
  await p.locator('.sd-code').waitFor({ timeout: 15000 })
  await p.locator('.sd-code').fill('<!doctype html><title>Prices</title><h1>New prices</h1>')
  await sleep(300)
  fs.rmSync(path.join(dir, 'Prices.html'))
  await lookNow(p)
  const deleted = await until(async () => { const x = await bar(p).innerText().catch(() => ''); return /Prices\.html was moved or deleted/.test(x) && !/Looking for where it went/.test(x) ? x : null }, 15000, 200)
  ok(!!deleted && !(await bar(p).locator('button', { hasText: 'Keep editing it there' }).count()) && await bar(p).locator('button', { hasText: 'Save a copy' }).count() === 1 && await bar(p).locator('button', { hasText: 'Download' }).count() === 1, 'a page deleted with unsaved changes: said, with Save a copy and Download (nowhere it went to keep editing)', deleted)
  ok(!!(await until(() => drafts().some((x) => /New prices/.test(x.toString())), 8000, 200)), 'and its changes kept as a draft')
  await p.reload()
  await until(async () => { if (await bar(p).count()) return true; await p.evaluate((detail) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail })), { root: 'home', path: 'Notes/Prices.html' }); return false }, 20000, 1000)
  const back = await until(async () => /New prices/.test(await p.locator('.sd-code').inputValue().catch(() => '')) && /Prices\.html was moved or deleted/.test(await bar(p).innerText().catch(() => '')), 15000, 200)
  ok(!!back, 'reloaded: the file opens from its draft, what was typed there, and the bar again', await p.locator('.sd-file').innerText().catch(() => ''))
  await bar(p).locator('button', { hasText: 'Save a copy' }).click()
  const copied = await until(() => fs.existsSync(path.join(dir, 'Prices.html')) && fs.readFileSync(path.join(dir, 'Prices.html'), 'utf8'), 10000, 200)
  ok(/New prices/.test(copied || '') && !!(await until(async () => !(await bar(p).count()), 5000)) && !drafts().length, 'Save a copy, in the folder it was in: there under its name, open, its draft gone', copied)

  // A big deck opened in parts, typed in, deleted: a copy saved in Studio's own folder, its photo
  // (never on the page) put back from its versions byte for byte.
  await openHere(p, 'Notes/Site deck.pptx')
  await until(() => p.evaluate(() => { const i = document.querySelector('.px-canvas img'); return i && i.complete && i.naturalWidth > 0 }), 30000, 200)
  await p.locator('.sd-strip .sd-thumb').nth(1).locator('.sd-thumb-btn').click()
  const tb = await p.locator('.px-canvas .px-draw > .px-slide > [data-o]').nth(0).boundingBox()
  await p.mouse.click(tb.x + tb.width * 0.2, tb.y + tb.height / 2)
  await p.locator('.px-edit-body').waitFor({ timeout: 5000 })
  await p.locator('.px-edit-body').evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })
  await p.keyboard.type(' checked')
  await p.keyboard.press('Escape')
  fs.rmSync(path.join(dir, 'Site deck.pptx'))
  await lookNow(p)
  await bar(p).waitFor({ timeout: 15000 })
  await bar(p).locator('select').selectOption('studio')
  await bar(p).locator('button', { hasText: 'Save a copy' }).click()
  const own = path.join(kit.data, 'studio', 'files', 'Site deck.pptx')
  const copy = await until(async () => { if (!fs.existsSync(own)) return null; const z = await JSZip.loadAsync(fs.readFileSync(own)).catch(() => null); return z && /checked/.test(await z.file('ppt/slides/slide2.xml')?.async('string') || '') ? z : null }, 15000, 300)
  ok(!!copy && sha(await copy.file('ppt/media/photo1.png').async('nodebuffer')) === photoSha && !drafts().length, 'a big deck opened in parts, deleted: a copy in Studio\'s own folder with what was typed, its photo put back from its versions byte for byte', { copied: !!copy })
  ok(!dk.errors.length, 'no page errors on the computer', dk.errors.slice(0, 3))

  // ---------- on a phone ----------
  const ph = await page(b, kit.url, { phone: true, before: noServiceWorker, store: { 'cc-mtab': 'more', 'cc-more-view': 'view:studio' } })
  contexts.push(ph.ctx)
  const q = ph.p
  await openHere(q, 'Notes/Phone note.md')
  await q.locator('.sd-page .ProseMirror', { hasText: 'Call the site' }).waitFor({ timeout: 20000 })
  fs.rmSync(path.join(dir, 'Phone note.md'))
  await q.locator('.sd-page .ProseMirror').click()
  await q.keyboard.press(`${MOD}+End`)
  await q.keyboard.type(' From the phone.')
  const onPhone = await until(async () => { const x = await bar(q).innerText().catch(() => ''); return /Phone note\.md was moved or deleted/.test(x) && !/Looking for where it went/.test(x) ? x : null }, 20000, 200)
  ok(!!onPhone, 'on a phone: a note deleted while typed in, said', onPhone)
  await sleep(300)
  const f = await phoneFaults(q, '.sd-gone')
  ok(!Object.keys(f).length, 'the bar fits the phone, each control a whole 40 px target, its folder list at 16 px', f)
  await shot(q, `${tag}studio-gone-phone`)
  const dl = q.waitForEvent('download', { timeout: 15000 })
  await bar(q).locator('button', { hasText: 'Download' }).click()
  const got = await dl.then((d) => d.path()).then((x) => fs.readFileSync(x, 'utf8'), () => '')
  ok(/^# Phone note/.test(got) && /From the phone\./.test(got) && !drafts().length, 'Download: the note with what was typed, to the phone', got)
  ok(!ph.errors.length, 'no page errors on the phone', ph.errors.slice(0, 3))
} catch (err) {
  ok(false, `crashed: ${err.stack}`)
  console.log(kit.log().slice(-2000))
} finally {
  for (const c of contexts) await c.close().catch(() => {})
  kit.stop()
  await b.close().catch(() => {})
}
process.exit(done().fail ? 1 : 0)
