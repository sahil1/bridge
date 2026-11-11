// Studio's comments in Word files (Comments and @bridge, a beta feature), in the browser named by
// BRIDGE_TEST_BROWSER. A Word file with comments as Word 365 writes them (lib/wordfile.mjs
// threadsDocx: a question and its reply, a resolved comment, a colleague's @bridge) read as
// threads: who wrote each and when, which answers which, the resolved one folded away and its words
// not marked. A comment on words picked (by them, from the pane and with ⌥⌘M), a reply, Resolve
// and Open it again, a reply and a thread deleted: each saved into the file itself, part by part as
// Word writes them (each new comment shaped as Word's own, its paraId in commentsExtended,
// commentsIds and commentsExtensible, its author in people.xml, its start, end and reference in
// the document), every comment it didn't change written as it was, and read back as threads. A
// file another app made, without Word's newer parts: answered, given commentsExtended (its
// relationship and content type) and Word's comment styles. With the beta off, the comments as
// before: shown, to answer in Word. In the dark and on a phone.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startKit, checks, until, sleep, browser, page, shot, ROOT } from '../lib/harness.mjs'
import { richDocx, threadsDocx, THREADS, THREAD_PARAS } from '../lib/wordfile.mjs'
import { readDocx } from '../../src/components/studio/ooxml.js'
import { commentsOf, threadsOf } from '../../src/components/studio/wordcomments.js'

const require = createRequire(path.join(ROOT, 'package.json'))
const JSZip = require('jszip')
const { ok, done } = checks('studio-comments')
const kit = await startKit('studio-comments')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const pages = []
const partsOf = async (file) => { const z = await JSZip.loadAsync(fs.readFileSync(file)); const o = {}; for (const n of Object.keys(z.files)) if (!z.files[n].dir) o[n] = await z.file(n).async('string'); return o }
const changed = (a, c) => Object.keys({ ...a, ...c }).filter((k) => a[k] !== c[k]).sort()
// A comment's XML with its words, names, times and ids taken out: its shape, to hold against Word's.
const shape = (x) => String(x || '').replace(/="[^"]*"/g, '=""').replace(/>[^<]+</g, '><').replace(/\s+w:rsid\w*=""/g, '')
const commentXml = (xml, id) => new RegExp(`<w:comment w:id="${id}"[\\s\\S]*?</w:comment>`).exec(xml)?.[0] || ''
// The threads a saved file has, read as Studio reads them: [[author: words, …] (resolved)].
const threadsIn = async (file) => threadsOf(commentsOf(await readDocx(fs.readFileSync(file)))).map((th) => `${th.items.map((c) => `${c.author}: ${c.text}`).join(' / ')}${th.root.done ? ' (resolved)' : ''}`)

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/settings', { trials: { studio: true, comments: true } }, 'PATCH')
  const dir = path.join(kit.home, 'Work', 'plans')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'threads.docx'), await threadsDocx())
  fs.writeFileSync(path.join(dir, 'report.docx'), await richDocx({ pages: 1 }))
  const root = `place:${(await kit.api('/places', { path: dir })).place.id}`
  const file = (n) => path.join(dir, n)

  const w = await page(b, kit.url, { width: 1440, height: 900 })
  pages.push(w)
  const p = w.p
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  const open = (rel) => until(async () => { await p.evaluate(({ root, rel }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: rel } })), { root, rel }); return p.locator('.pane-head h2', { hasText: rel }).first().waitFor({ timeout: 2500 }).then(() => p.locator('.sd-w').first().waitFor({ timeout: 5000 })).then(() => true, () => false) }, 25000, 300)
  const E = (fn, arg) => p.evaluate(({ fn, arg }) => { const ed = document.querySelector('.sd-w').editor; return new Function('ed', 'arg', `return (${fn})(ed, arg)`)(ed, arg) }, { fn: String(fn), arg })
  // Words picked, through the editor (and brought into view, where the bubble by them shows).
  const pick = (text) => E((ed, t) => { let r = null; ed.state.doc.descendants((n, pos) => { if (!r && n.isTextblock && n.textContent.includes(t)) { const i = n.textContent.indexOf(t); r = { from: pos + 1 + i, to: pos + 1 + i + t.length } } return !r }); ed.view.focus(); ed.commands.setTextSelection(r); ed.commands.scrollIntoView() }, text)
  const saveNow = () => p.keyboard.press(`${MOD}+s`)
  const thread = (has) => p.locator('.sd-threads .sd-thread', { hasText: has })
  const savedWith = (name, test) => until(async () => { const x = await partsOf(file(name)); return test(x) && x }, 10000, 200)

  // ---------- Read as Word wrote them ----------
  ok(!!(await open('threads.docx')), 'a Word file with comments opens')
  const was = await partsOf(file('threads.docx'))
  await p.locator('.sd-doc-tools button[aria-label="Comments"]').click()
  await p.locator('.sd-threads').waitFor({ timeout: 5000 })
  const avery = thread('Which quarter is this?')
  const said = await avery.locator('.sd-thread-entry').evaluateAll((es) => es.map((e) => `${e.querySelector('.sd-comment-who b').innerText}: ${e.querySelector('.sd-comment-text').innerText}`))
  ok(JSON.stringify(said) === JSON.stringify(['Avery Stone: Which quarter is this?', 'Sam Lee: Q3, I think.']), 'Word\'s comments as threads: a question with its reply under it, each with who wrote it', said)
  ok((await avery.locator('.sd-thread-quote').innerText()).startsWith('Revenue grew 20%') && /Oct 1/.test(await avery.innerText()), 'each thread with the words it\'s on and when it was written', await avery.innerText())
  const marked = await p.locator('.sd-w .sd-cmt[data-cid]').evaluateAll((es) => [...new Set(es.map((e) => e.getAttribute('data-cid')))].sort())
  ok(JSON.stringify(marked) === '["0","3"]', 'the open threads\' words marked on the page; a reply\'s are its thread\'s, and a resolved one\'s aren\'t marked', marked)
  const doneBtn = p.locator('.sd-thread-done > button')
  ok(/1 resolved/.test(await doneBtn.innerText()) && (await thread('Spell out the numbers').count()) === 0, 'a resolved thread folded away, saying how many there are')
  await doneBtn.click()
  ok(!!(await until(async () => (await thread('Spell out the numbers').count()) === 1, 3000, 100)), 'and shown when asked')
  await doneBtn.click()
  await shot(p, `${tag}studio-comments-threads`)

  // ---------- A comment on the words picked ----------
  await pick('what a new person sees')
  const bubble = p.locator('.sd-bubble-cmt')
  ok(!!(await until(() => bubble.isVisible(), 5000, 100)), 'words picked: Comment beside AI Assist, by them')
  await bubble.click()
  const box = p.locator('.sd-thread-new textarea')
  ok(!!(await until(async () => (await box.evaluate((e) => e === document.activeElement).catch(() => false)) && /what a new person sees/.test(await p.locator('.sd-thread-new .sd-thread-quote').innerText()), 5000, 100)), 'a new comment\'s box, ready to type in, with the words it\'s on', await p.locator('.sd-thread-new').innerText().catch(() => ''))
  ok(await p.locator('.sd-w .sd-cmt.draft').count() > 0, 'and those words stay marked while it\'s written')
  await box.fill('Say how long the first hour is.')
  await box.press(`${MOD}+Enter`)
  const mine = thread('Say how long the first hour is.')
  ok(!!(await until(async () => (await mine.count()) === 1 && /Tester/.test(await mine.innerText()), 5000, 100)), 'posted: a thread of its own, signed with your name')
  ok(!!(await until(async () => (await p.locator('.sd-w .sd-cmt[data-cid="4"]').innerText().catch(() => '')) === 'what a new person sees', 3000, 100)), 'its words marked on the page', await p.locator('.sd-w .sd-cmt[data-cid="4"]').innerText().catch(() => ''))
  ok(/Unsaved changes|Saving|Saved/.test(await p.locator('.sd-status').innerText()), 'a change to the file, saved like any other')
  await saveNow()
  const one = await savedWith('threads.docx', (x) => /Say how long the first hour/.test(x['word/comments.xml'] || ''))
  const c4 = commentXml(one?.['word/comments.xml'], 4)
  const pid4 = /w14:paraId="([0-9A-F]{8})"/.exec(c4)?.[1]
  ok(!!one && shape(c4) === shape(commentXml(was['word/comments.xml'], 0)), 'saved into comments.xml, shaped as Word writes a comment (its paraId, the CommentText style, Word\'s annotation mark first)', c4)
  ok(/w:author="Tester"/.test(c4) && /w:initials="T"/.test(c4) && /w:date="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"/.test(c4), 'with your name, initials and the time', c4)
  ok(!!pid4 && new RegExp(`<w15:commentEx w15:paraId="${pid4}" w15:done="0"/>`).test(one['word/commentsExtended.xml']), 'in commentsExtended, open, answering none', one?.['word/commentsExtended.xml'].slice(-400))
  const durable = new RegExp(`<w16cid:commentId w16cid:paraId="${pid4}" w16cid:durableId="([0-9A-F]{8})"/>`).exec(one?.['word/commentsIds.xml'] || '')?.[1]
  ok(!!durable && new RegExp(`<w16cex:commentExtensible w16cex:durableId="${durable}" w16cex:dateUtc="[^"]+Z"/>`).test(one['word/commentsExtensible.xml']) && /w15:author="Tester"/.test(one['word/people.xml']), 'in commentsIds and commentsExtensible (a lasting id, the time in UTC), and you in people.xml, as Word 365 has them')
  ok(/<w:commentRangeStart w:id="4"\/><w:r><w:t[^>]*>what a new person sees<\/w:t><\/w:r><w:commentRangeEnd w:id="4"\/><w:r><w:rPr><w:rStyle w:val="CommentReference"\/><\/w:rPr><w:commentReference w:id="4"\/><\/w:r>/.test(one?.['word/document.xml'] || ''), 'in the document: its start and end around the words, its reference after them, as Word puts them', /<w:p [^>]*>(?:(?!<\/w:p>).)*first hour(?:(?!<\/w:p>).)*<\/w:p>/s.exec(one?.['word/document.xml'] || '')?.[0])
  ok(THREADS.every((c) => one?.['word/comments.xml'].includes(commentXml(was['word/comments.xml'], c.id))), 'every comment it didn\'t change written as it was, byte for byte')
  ok(JSON.stringify(changed(was, one || {})) === JSON.stringify(['word/comments.xml', 'word/commentsExtended.xml', 'word/commentsExtensible.xml', 'word/commentsIds.xml', 'word/document.xml', 'word/people.xml']), 'and nothing else in the file changed: its styles, relationships and content types as they were', changed(was, one || {}))

  // ---------- A reply, resolved and opened again ----------
  await avery.locator('.sd-thread-quote').click()
  const reply = avery.locator('.sd-thread-box textarea')
  ok(!!(await until(() => reply.isVisible(), 3000, 100)), 'a thread picked: its reply box')
  await reply.fill('It is Q3.')
  await avery.locator('.sd-thread-box button[type="submit"]').click()
  ok(!!(await until(async () => (await avery.locator('.sd-thread-entry').count()) === 3, 3000, 100)), 'a reply goes under the others in the thread')
  await saveNow()
  const two = await savedWith('threads.docx', (x) => /It is Q3/.test(x['word/comments.xml'] || ''))
  const pid5 = /w14:paraId="([0-9A-F]{8})"/.exec(commentXml(two?.['word/comments.xml'], 5))?.[1]
  ok(!!pid5 && new RegExp(`<w15:commentEx w15:paraId="${pid5}" w15:paraIdParent="3D1E8F21" w15:done="0"/>`).test(two['word/commentsExtended.xml']), 'saved: a reply to the thread\'s first comment, as Word marks one', two?.['word/commentsExtended.xml'].slice(-500))
  ok(/<w:commentRangeStart w:id="0"\/><w:commentRangeStart w:id="5"\/><w:commentRangeStart w:id="1"\/>|<w:commentRangeStart w:id="0"\/><w:commentRangeStart w:id="1"\/><w:commentRangeStart w:id="5"\/>/.test(two?.['word/document.xml'] || '') && /<w:commentReference w:id="1"\/><\/w:r><w:commentRangeEnd w:id="5"\/><w:r><w:rPr><w:rStyle w:val="CommentReference"\/><\/w:rPr><w:commentReference w:id="5"\/>/.test(two?.['word/document.xml'] || ''), 'its marks in the document beside its thread\'s, as Word puts a reply\'s')
  await avery.locator('button[aria-label="Resolve"]').click()
  ok(!!(await until(async () => /2 resolved/.test(await p.locator('.sd-thread-done > button').innerText().catch(() => '')) && (await p.locator('.sd-w .sd-cmt[data-cid="0"]').count()) === 0, 3000, 100)), 'Resolve: the thread folds away with the resolved ones, and its words aren\'t marked')
  await saveNow()
  const three = await savedWith('threads.docx', (x) => /w15:paraId="3D1E8F21" w15:done="1"/.test(x['word/commentsExtended.xml'] || ''))
  ok(!!three && [`3D1E8F21" w15:done="1"`, `4E2F9032" w15:paraIdParent="3D1E8F21" w15:done="1"`, `${pid5}" w15:paraIdParent="3D1E8F21" w15:done="1"`].every((x) => three['word/commentsExtended.xml'].includes(x)), 'saved: the thread and its replies done, as Word marks a resolved one', three?.['word/commentsExtended.xml'])
  ok(JSON.stringify(await threadsIn(file('threads.docx'))) === JSON.stringify(['Avery Stone: Which quarter is this? / Sam Lee: Q3, I think. / Tester: It is Q3. (resolved)', 'Avery Stone: Spell out the numbers. (resolved)', 'Sam Lee: @bridge make this shorter', 'Tester: Say how long the first hour is.']), 'read back from the file: the same threads, replies and resolved ones', await threadsIn(file('threads.docx')))
  await p.locator('.sd-thread-done > button').click()
  await avery.locator('button[aria-label="Open it again"]').click()
  ok(!!(await until(async () => (await p.locator('.sd-thread-list').first().locator('.sd-thread', { hasText: 'Which quarter' }).count()) === 1, 3000, 100)), 'Open it again: back with the open threads')
  await saveNow()
  ok(!!(await savedWith('threads.docx', (x) => /w15:paraId="3D1E8F21" w15:done="0"/.test(x['word/commentsExtended.xml'] || ''))), 'saved open again')

  // ---------- Deleted ----------
  await avery.locator('.sd-thread-entry', { hasText: 'It is Q3.' }).hover()
  await avery.locator('.sd-thread-entry', { hasText: 'It is Q3.' }).locator('button[aria-label="Delete this reply"]').click()
  ok(!!(await until(async () => (await avery.locator('.sd-thread-entry').count()) === 2, 3000, 100)), 'a reply deleted')
  await mine.locator('button[aria-label="Delete the comment"]').click()
  ok(/Delete this comment\?/.test(await mine.locator('.sd-thread-confirm').innerText().catch(() => '')), 'deleting a thread asks first')
  await mine.locator('.sd-thread-confirm button', { hasText: 'Delete' }).click()
  ok(!!(await until(async () => (await mine.count()) === 0 && (await p.locator('.sd-w .sd-cmt[data-cid="4"]').count()) === 0, 3000, 100)), 'and deleted: gone from the pane and its words not marked')
  await saveNow()
  const four = await savedWith('threads.docx', (x) => !/It is Q3|first hour is/.test(x['word/comments.xml'] || ''))
  ok(!!four && !/w:id="[45]"/.test(four['word/document.xml']) && ![pid4, pid5].some((x) => four['word/commentsExtended.xml'].includes(x) || four['word/commentsIds.xml'].includes(x)), 'saved: gone from the file, its marks and its lines in Word\'s other parts too')
  ok(!!four && ['word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml'].every((k) => four[k] === was[k]), 'back to the comments it came with: those parts as Word wrote them, byte for byte', four && ['word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml'].filter((k) => four[k] !== was[k]))

  // ---------- A file another app made ----------
  // Made without commentsExtended (as the docx library writes one): answered, it's given the part,
  // and its comment a paraId to be answered by.
  ok(!!(await open('report.docx')), 'a Word file another app made opens')
  const before = await partsOf(file('report.docx'))
  if (!(await p.locator('.sd-threads').isVisible().catch(() => false))) await p.locator('.sd-doc-tools button[aria-label="Comments"]').click()
  const q = thread('Is this the quarter or the year?')
  await q.locator('.sd-thread-quote').click()
  await q.locator('.sd-thread-box textarea').fill('The quarter.')
  await q.locator('.sd-thread-box textarea').press(`${MOD}+Enter`)
  await saveNow()
  const other = await savedWith('report.docx', (x) => !!x['word/commentsExtended.xml'])
  const pid0 = /<w:comment w:id="0"[^>]*><w:p w14:paraId="([0-9A-F]{8})"/.exec(other?.['word/comments.xml'] || '')?.[1]
  ok(!!pid0 && new RegExp(`w15:paraId="[0-9A-F]{8}" w15:paraIdParent="${pid0}"`).test(other['word/commentsExtended.xml']), 'answered: its comment given a paraId, and the reply saved as answering it', other?.['word/commentsExtended.xml'])
  ok(!!other && /Type="http:\/\/schemas\.microsoft\.com\/office\/2011\/relationships\/commentsExtended" Target="commentsExtended\.xml"/.test(other['word/_rels/document.xml.rels']) && /PartName="\/word\/commentsExtended\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.commentsExtended\+xml"/.test(other['[Content_Types].xml']), 'commentsExtended added as Word adds it: its relationship and its content type')
  ok(!!other && /w:styleId="CommentText"/.test(other['word/styles.xml']) && /w:styleId="CommentReference"/.test(other['word/styles.xml']) && !/w:styleId="CommentText"/.test(before['word/styles.xml']), 'and Word\'s comment styles, which it didn\'t have')
  ok(JSON.stringify(await threadsIn(file('report.docx'))) === JSON.stringify(['Avery Stone: Is this the quarter or the year? / Tester: The quarter.']), 'read back: the question and its answer', await threadsIn(file('report.docx')))
  await shot(p, `${tag}studio-comments-reply`)
  ok(!w.errors.length, 'no errors on the page', w.errors)

  // ---------- In the dark, and on a phone ----------
  const dark = await page(b, kit.url, { width: 1440, height: 900, mode: 'dark' })
  pages.push(dark)
  await dark.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await until(async () => { await dark.p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'threads.docx' } })), { root }); return dark.p.locator('.sd-w').first().waitFor({ timeout: 2500 }).then(() => true, () => false) }, 25000, 300)
  await dark.p.locator('.sd-doc-tools button[aria-label="Comments"]').click()
  const card = await until(() => dark.p.locator('.sd-threads .sd-thread').first().evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => null), 5000, 100)
  ok(!!card && card !== 'rgb(255, 255, 255)', 'dark: the threads in the dark look', card)
  await shot(dark.p, `${tag}studio-comments-dark`)
  const ph = await page(b, kit.url, { phone: true })
  pages.push(ph)
  await until(async () => { await ph.p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'threads.docx' } })), { root }); return ph.p.locator('.sd-w').first().waitFor({ timeout: 2500 }).then(() => true, () => false) }, 25000, 300)
  await ph.p.locator('.sd-doc-tools button[aria-label="Comments"]').click()
  await ph.p.locator('.sd-threads .sd-thread').first().waitFor({ timeout: 5000 })
  const fits = await ph.p.evaluate(() => { const pane = document.querySelector('.sd-threads').getBoundingClientRect(); const small = [...document.querySelectorAll('.sd-threads button')].filter((x) => x.getClientRects().length && x.getBoundingClientRect().height < 32).map((x) => x.getAttribute('aria-label') || x.innerText); return { right: Math.round(pane.right), width: innerWidth, small } })
  ok(fits.right <= fits.width && !fits.small.length, 'on a phone: the comments over the page, fitting it, each button big enough to tap', fits)
  await shot(ph.p, `${tag}studio-comments-phone`)

  // ---------- The beta off ----------
  await kit.api('/settings', { trials: { comments: false } }, 'PATCH')
  const off = await page(b, kit.url, { width: 1440, height: 900 })
  pages.push(off)
  await off.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await until(async () => { await off.p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'threads.docx' } })), { root }); return off.p.locator('.sd-w').first().waitFor({ timeout: 2500 }).then(() => true, () => false) }, 25000, 300)
  await off.p.locator('.sd-doc-tools button[aria-label="Comments"]').click()
  ok(!!(await until(async () => /Answer them in Word/.test(await off.p.locator('.sd-comments-pane').innerText().catch(() => '')), 5000, 100)) && (await off.p.locator('.sd-threads, .sd-thread-add').count()) === 0, 'with Comments and @bridge off: the comments shown as before, to answer in Word, and nothing to write them with')
  await off.p.evaluate(() => { const ed = document.querySelector('.sd-w').editor; let r = null; ed.state.doc.descendants((n, pos) => { if (!r && n.isTextblock && n.textContent.includes('first hour')) r = { from: pos + 1, to: pos + 10 }; return !r }); ed.view.focus(); ed.commands.setTextSelection(r) })
  ok(!!(await until(() => off.p.locator('.sd-bubble-ai').isVisible(), 5000, 100)) && (await off.p.locator('.sd-bubble-cmt').count()) === 0, 'and words picked have AI Assist by them, not Comment')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const x of pages) await x.ctx.close().catch(() => {})
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
