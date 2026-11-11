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
// relationship and content type) and Word's comment styles. @bridge (the stand-in model): a
// colleague's from the file waiting for you, nothing sent by itself; typing @ offering @bridge;
// yours with no model saying how to add one (Open Model Providers); then answered in the thread,
// signed AI Assist with the wand and the model, asked about that place only (the words, the
// document around them, the thread so far, and told the content isn't instructions), its change a
// tracked suggestion on the words (saved as one by AI Assist, which Word shows) with Keep, Discard
// and Keep all; working said in the thread while its words pulse; a question answered with no
// change. An Excel file's threaded comments, as Excel 365 writes them (lib/sheetfile.mjs): read as
// threads beside the sheet (Insert › Comments), each with its cell; one on a cell picked (⌥⌘M) and
// on cells picked (Insert › Comment), a reply, Resolve and Open it again, a row added above them
// (each moves with its cell, and back with undo), deleted ones: each saved as Excel writes it (the
// thread, its person, its placeholder note for older Excels), the rest as it was, and read back.
// @bridge on cells: a colleague's waiting, yours with no model saying so; then answered in the
// thread through the sheet's AI Assist (the cell's table, the thread so far, told the content
// isn't instructions), its change outlined on the sheet as a suggestion with Keep, Discard and
// Keep all, saved only when kept. With the beta off, the comments as before: shown, to answer in
// Word, and a sheet's threaded comments kept as they are; @bridge's routes not there, and nothing
// sent. In the dark and on a phone.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startKit, startModel, checks, until, browser, page, shot, ROOT } from '../lib/harness.mjs'
import { richDocx, threadsDocx, THREADS, THREAD_PARAS } from '../lib/wordfile.mjs'
import { readDocx } from '../../src/components/studio/ooxml.js'
import { commentsOf, threadsOf } from '../../src/components/studio/wordcomments.js'
import { threadsXlsx } from '../lib/sheetfile.mjs'
import { readBook } from '../../src/components/studio/xlsxbook.js'

const require = createRequire(path.join(ROOT, 'package.json'))
const JSZip = require('jszip')
const { ok, done } = checks('studio-comments')
const kit = await startKit('studio-comments')
const model = await startModel('studio-comments')
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

  // ---------- An Excel file's comments ----------
  // Excel 365's threaded comments (lib/sheetfile.mjs) as threads beside the sheet, each cell with
  // one marked; a comment on the cell picked (⌥⌘M), a reply, Resolve, a row added above them and
  // deleted ones, each saved into the file as Excel writes them, and read back.
  fs.writeFileSync(file('threads.xlsx'), await threadsXlsx())
  const xWas = await partsOf(file('threads.xlsx'))
  const openSheet = (pg, rel) => until(async () => { await pg.evaluate(({ root, rel }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: rel } })), { root, rel }); return pg.locator('.pane-head h2', { hasText: rel }).first().waitFor({ timeout: 2500 }).then(() => pg.locator('.sd-univer canvas').first().waitFor({ timeout: 5000 })).then(() => true, () => false) }, 25000, 300)
  const nameBox = (pg) => until(() => pg.evaluate(() => { document.querySelectorAll('[data-name-box]').forEach((x) => x.removeAttribute('data-name-box')); const i = [...document.querySelectorAll('.sd-file .sd-univer [data-u-comp="defined-name"] input, .sd-file .sd-univer input')].find((x) => /^[A-Z]+[0-9]+$/.test(x.value)); i?.setAttribute('data-name-box', '1'); return !!i }), 15000, 200)
  const goTo = async (a1) => { const nb = p.locator('input[data-name-box]'); await nb.click(); await nb.fill(a1); await nb.press('Enter'); await p.waitForTimeout(250) }
  const ribbon = async (pg, cmd) => { await pg.locator('.sd-univer [role="tab"]', { hasText: 'Insert' }).first().click(); await pg.locator(`.sd-univer [data-u-command="${cmd}"]`).first().click() }
  const xThread = (has) => p.locator('.sh-threads .sd-thread', { hasText: has })
  const xSaved = (test) => savedWith('threads.xlsx', test)
  const tcIn = (x) => x['xl/threadedComments/threadedComment1.xml'] || ''
  const tcOf = (xml, has) => new RegExp(`<threadedComment [^>]*>(?:(?!</threadedComment>)[\\s\\S])*${has}[\\s\\S]*?</threadedComment>`).exec(xml)?.[0] || ''
  const xShape = (x) => String(x || '').replace(/="[^"]*"/g, '=""').replace(/>[^<]+</g, '><')
  const sheetThreads = async () => (await readBook(fs.readFileSync(file('threads.xlsx')), 'threads.xlsx', { threads: true })).threads.sheet1?.map((x) => `${String.fromCharCode(65 + x.c)}${x.r + 1} ${x.author}: ${x.text}${x.done ? ' (resolved)' : ''}`) || []
  ok(!!(await openSheet(p, 'threads.xlsx')), 'an Excel file with threaded comments opens')
  await nameBox(p)
  await ribbon(p, 'bridge.sheet.comments')
  await p.locator('.sh-threads').waitFor({ timeout: 5000 })
  const hosting = xThread('Is hosting monthly or yearly?')
  const xSaid = await hosting.locator('.sd-thread-entry').evaluateAll((es) => es.map((e) => `${e.querySelector('.sd-comment-who b').innerText}: ${e.querySelector('.sd-comment-text').innerText}`))
  ok(JSON.stringify(xSaid) === JSON.stringify(['Avery Stone: Is hosting monthly or yearly?', 'Sam Lee: Monthly.']) && /^B2 · 120/.test(await hosting.locator('.sd-thread-quote').innerText()), 'Insert › Comments: Excel\'s threaded comments as threads, each with the cell it\'s on and what\'s in it, who wrote each, a reply under its question', xSaid)
  ok(/1 resolved/.test(await p.locator('.sh-threads .sd-thread-done > button').innerText()) && (await xThread('Check the design quote').count()) === 0 && !/threaded comments/.test(await p.locator('.sh-note').innerText().catch(() => '')), 'a resolved thread folded away, and nothing said about comments kept but not shown')
  await shot(p, `${tag}studio-comments-sheet`)
  // A comment on the cell picked, with ⌥⌘M.
  await goTo('C3')
  await p.keyboard.press(`${MOD}+Alt+KeyM`)
  const xBox = p.locator('.sh-threads .sd-thread-new textarea')
  ok(!!(await until(async () => /^C3$/.test(await p.locator('.sh-threads .sd-thread-new .sd-thread-quote').innerText().catch(() => '')) && await xBox.evaluate((e) => e === document.activeElement).catch(() => false), 5000, 100)), '⌥⌘M on a cell: a new comment\'s box, ready to type in, with the cell it\'s on', await p.locator('.sh-threads').innerText().catch(() => ''))
  await xBox.fill('Is design before tax?')
  await xBox.press(`${MOD}+Enter`)
  const taxed = xThread('Is design before tax?')
  ok(!!(await until(async () => (await taxed.count()) === 1 && /Tester/.test(await taxed.innerText()), 5000, 100)), 'posted: a thread of its own, signed with your name')
  await hosting.locator('.sd-thread-quote').click()
  await hosting.locator('.sd-thread-box textarea').fill('Yearly, from March.')
  await hosting.locator('.sd-thread-box button[type="submit"]').click()
  ok(!!(await until(async () => (await hosting.locator('.sd-thread-entry').count()) === 3, 3000, 100)), 'a reply goes under the others in its thread')
  await saveNow()
  const x1 = await xSaved((x) => /Is design before tax/.test(tcIn(x)) && /Yearly, from March/.test(tcIn(x)))
  const mineTc = tcOf(tcIn(x1), 'Is design before tax'), replyTc = tcOf(tcIn(x1), 'Yearly, from March')
  ok(!!x1 && xShape(mineTc) === xShape(tcOf(tcIn(xWas), 'Is hosting monthly')) && xShape(replyTc) === xShape(tcOf(tcIn(xWas), 'Monthly\\.')), 'saved: the new thread and the reply each shaped as Excel writes one', [mineTc, replyTc])
  ok(/ref="C3"/.test(mineTc) && /ref="B2"/.test(replyTc) && replyTc.includes('parentId="{A0000001-0000-4000-8000-000000000001}"') && /<person displayName="Tester" id="\{[0-9A-F-]{36}\}" userId="Tester" providerId="None"\/>/.test(x1?.['xl/persons/person.xml'] || ''), 'on its cell, the reply answering its thread, and you added to the people who wrote them')
  const holder = /<comment ref="C3" authorId="(\d+)" shapeId="0" xr:uid="(\{[0-9A-F-]+\})"><text><t>([\s\S]*?)<\/t><\/text><\/comment>/.exec(x1?.['xl/comments1.xml'] || '')
  ok(!!holder && mineTc.includes(`id="${holder[2]}"`) && new RegExp(`<author>tc=${holder[2].replace(/[{}]/g, '\\$&')}</author>`).test(x1['xl/comments1.xml']) && /^\[Threaded comment\]\n\nYour version of Excel[\s\S]*Comment:\n {4}Is design before tax\?$/.test(holder[3]) && /Comment:\n {4}Is hosting monthly or yearly\?\nReply:\n {4}Monthly\.\nReply:\n {4}Yearly, from March\.<\/t>/.test(x1['xl/comments1.xml']), 'and each thread\'s placeholder for older Excels, by tc={its id}, in Excel\'s words', holder?.[0])
  ok(JSON.stringify(changed(xWas, x1 || {})) === JSON.stringify(['xl/comments1.xml', 'xl/drawings/vmlDrawing1.vml', 'xl/persons/person.xml', 'xl/threadedComments/threadedComment1.xml']), 'and nothing else in the file changed', changed(xWas, x1 || {}))
  // Resolved, and opened again.
  await hosting.locator('button[aria-label="Resolve"]').click()
  ok(!!(await until(async () => /2 resolved/.test(await p.locator('.sh-threads .sd-thread-done > button').innerText().catch(() => '')), 3000, 100)), 'Resolve: the thread folds away with the resolved ones')
  await saveNow()
  ok(!!(await xSaved((x) => /id="\{A0000001-0000-4000-8000-000000000001\}" done="1"/.test(tcIn(x))) ), 'saved resolved, as Excel marks a thread done')
  await p.locator('.sh-threads .sd-thread-done > button').click()
  await hosting.locator('button[aria-label="Open it again"]').click()
  // A row added above them: each comment moves with its cell.
  await goTo('A2')
  const grid = await p.evaluate(() => { const c = [...document.querySelectorAll('.sd-univer canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0].getBoundingClientRect(); return { x: c.x, y: c.y } })
  await p.mouse.click(grid.x + 46 + 60, grid.y + 20 + 30, { button: 'right' })
  const insertItem = p.locator('button', { hasText: /^Insert$/ }).last()
  await until(async () => { await p.locator('button', { hasText: /^Freeze$/ }).last().hover().catch(() => {}); await insertItem.hover(); return p.getByText('rows above').first().isVisible() }, 8000, 400)
  // Insert [1] rows above: by its icon (its words and number box are for typing how many).
  const above = await p.getByText('rows above').first().evaluate((e) => { let x = e; while (x.parentElement && x.getBoundingClientRect().width < 200) x = x.parentElement; const r = e.getBoundingClientRect(); return { x: x.getBoundingClientRect().x + 20, y: r.y + r.height / 2 } })
  await p.mouse.click(above.x, above.y)
  ok(!!(await until(async () => /^B3 · 120/.test(await hosting.locator('.sd-thread-quote').innerText().catch(() => '')) && /^C4/.test(await taxed.locator('.sd-thread-quote').innerText().catch(() => '')), 5000, 100)), 'a row added above: each comment moves with its cell', [await hosting.locator('.sd-thread-quote').innerText().catch(() => ''), await taxed.locator('.sd-thread-quote').innerText().catch(() => '')])
  await saveNow()
  const x2 = await xSaved((x) => /ref="B3"[^>]*id="\{A0000001-0000-4000-8000-000000000001\}"/.test(tcIn(x)))
  ok(!!x2 && /<comment ref="B3" authorId="1"/.test(x2['xl/comments1.xml']) && /<comment ref="A3" authorId="0"/.test(x2['xl/comments1.xml']) && /ref="C4"/.test(tcOf(tcIn(x2), 'Is design before tax')) && !/done=/.test(/<threadedComment [^>]*id="\{A0000001-0000-4000-8000-000000000001\}"[^>]*>/.exec(tcIn(x2))?.[0] || 'done='), 'saved: the threads, their placeholders and the note moved with their cells, and the one opened again open', x2 && tcIn(x2).slice(0, 500))
  await p.keyboard.press(`${MOD}+z`)
  ok(!!(await until(async () => /^B2 · 120/.test(await hosting.locator('.sd-thread-quote').innerText().catch(() => '')), 5000, 100)), 'undone: back on their cells')
  // Deleted: back to the comments it came with, each part as Excel wrote it.
  await hosting.locator('.sd-thread-entry', { hasText: 'Yearly, from March.' }).hover()
  await hosting.locator('.sd-thread-entry', { hasText: 'Yearly, from March.' }).locator('button[aria-label="Delete this reply"]').click()
  await taxed.locator('button[aria-label="Delete the comment"]').click()
  await taxed.locator('.sd-thread-confirm button', { hasText: 'Delete' }).click()
  ok(!!(await until(async () => (await taxed.count()) === 0 && (await hosting.locator('.sd-thread-entry').count()) === 2, 3000, 100)), 'a reply and a thread deleted')
  await saveNow()
  const x3 = await xSaved((x) => !/Is design before tax|Yearly, from March/.test(tcIn(x)) && /ref="B2"/.test(tcIn(x)))
  ok(!!x3 && ['xl/threadedComments/threadedComment1.xml', 'xl/comments1.xml', 'xl/drawings/vmlDrawing1.vml', 'xl/worksheets/sheet1.xml'].every((k) => x3[k] === xWas[k]), 'saved: gone, and the comments as the file came with them, each part as Excel wrote it', x3 && changed(xWas, x3))
  ok(JSON.stringify(await sheetThreads()) === JSON.stringify(['B2 Avery Stone: Is hosting monthly or yearly?', 'B2 Sam Lee: Monthly.', 'B3 Avery Stone: Check the design quote. (resolved)', 'B6 Sam Lee: @bridge double this cost']), 'read back: the threads it came with', await sheetThreads())
  // @bridge: a colleague's from the file waits; yours, with no model yet, says how to add one.
  const travel = xThread('@bridge double this cost')
  ok(/Sam Lee asked @bridge in the file\. It waits for you/.test(await travel.locator('.sd-thread-ai.wait').innerText().catch(() => '')) && (await travel.locator('button', { hasText: 'Send to AI Assist' }).count()) === 1 && !model.asked(/^In the spreadsheet/).length, 'a colleague\'s @bridge on a cell waits for you, with Send to AI Assist, and nothing was sent')
  await goTo('A2:B6')
  await ribbon(p, 'bridge.sheet.comment')
  ok(/^A2:B6 · Hosting/.test(await p.locator('.sh-threads .sd-thread-new .sd-thread-quote').innerText().catch(() => '')), 'Insert › Comment on cells picked: on all of them', await p.locator('.sh-threads .sd-thread-new .sd-thread-quote').innerText().catch(() => ''))
  await xBox.fill('@bridge double these costs')
  await xBox.press(`${MOD}+Enter`)
  const doubled = xThread('@bridge double these costs')
  ok(!!(await until(async () => /no model to answer with yet[\s\S]*Model Providers/i.test(await doubled.locator('.sd-thread-ai.bad').innerText().catch(() => '')) && (await doubled.locator('button', { hasText: 'Open Model Providers' }).count()) === 1, 10000, 200)), 'your own @bridge with no model: the thread says so, with Open Model Providers', await doubled.innerText().catch(() => ''))
  await saveNow()
  await xSaved((x) => /double these costs/.test(tcIn(x)))

  // Back to the Word file, for its own @bridge.
  ok(!!(await open('threads.docx')), 'and back to the Word file')
  if (!(await p.locator('.sd-threads').isVisible().catch(() => false))) await p.locator('.sd-doc-tools button[aria-label="Comments"]').click()
  await p.locator('.sd-threads .sd-thread').first().waitFor({ timeout: 5000 })

  // ---------- @bridge ----------
  // A colleague's @bridge that came in the file: waiting for you, and nothing sent by itself.
  const sam = thread('The team spent the quarter')
  ok(/Sam Lee asked @bridge in the file\. It waits for you/.test(await sam.locator('.sd-thread-ai.wait').innerText().catch(() => '')) && (await sam.locator('button', { hasText: 'Send to AI Assist' }).count()) === 1, 'a colleague\'s @bridge from the file waits for you, saying so, with Send to AI Assist', await sam.innerText())
  ok(!model.asked(/^Request:/).length, 'and nothing was sent to a model by itself')
  // Typing @ offers @bridge, AI Assist.
  await pick('what they come back for')
  await p.keyboard.press(`${MOD}+Alt+KeyM`)
  const box2 = p.locator('.sd-thread-new textarea')
  ok(!!(await until(() => box2.isVisible(), 3000, 100)), '⌥⌘M: a comment on the words picked')
  await box2.fill('@br')
  const chip = p.locator('.sd-thread-new .sd-mention')
  ok(!!(await until(async () => /@bridge\s*AI Assist/.test(await chip.innerText().catch(() => '')), 3000, 100)) && (await chip.locator('.icon').count()) === 1, 'typing @ offers @bridge, AI Assist, with the wand')
  await chip.click()
  ok(await box2.inputValue() === '@bridge ', 'picked, it finishes the mention', await box2.inputValue())
  // No model yet: the thread says so and how to add one.
  await box2.fill('@bridge make this shorter')
  await box2.press(`${MOD}+Enter`)
  const ask = p.locator('.sd-threads .sd-thread', { hasText: 'what they come back for' })
  ok(!!(await until(async () => /no model for AI Assist to answer with[\s\S]*Settings › Model Providers/.test(await ask.locator('.sd-thread-ai.bad').innerText().catch(() => '')), 10000, 200)) && (await ask.locator('button', { hasText: 'Open Model Providers' }).count()) === 1, 'your own @bridge with no model: the thread says there\'s none and how to add one, with Open Model Providers', await ask.innerText().catch(() => ''))
  await ask.locator('button', { hasText: 'Open Model Providers' }).click()
  ok(!!(await until(async () => /Model Providers/.test(await p.locator('.modal.settings').innerText().catch(() => '')), 5000, 100)), 'which opens Settings › Model Providers')
  await p.keyboard.press('Escape')
  await p.locator('.modal.settings').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  // A model: AI Assist's reply in the thread, its change a suggestion on the words.
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await kit.api('/settings', { studio: { model: 'openai:gpt-5' } }, 'PATCH')
  await ask.locator('button', { hasText: 'Try again' }).click()
  const aiEntry = ask.locator('.sd-thread-entry.ai')
  ok(!!(await until(async () => (await aiEntry.count()) === 1, 15000, 200)), 'Try again: AI Assist answers in the thread')
  const entry = await aiEntry.evaluate((e) => ({ who: e.querySelector('.sd-comment-who b')?.innerText, wand: !!e.querySelector('.sd-who-ai .icon'), text: e.querySelector('.sd-comment-text')?.innerText }))
  ok(entry.who === 'AI Assist' && entry.wand && /^Cut it to its first part/.test(entry.text) && /AI Assist · .*gpt-5/.test(entry.text), 'signed AI Assist with the wand, saying what it did and why, and which model did it', entry)
  const sent = model.requests().filter((r) => /^Request:/.test(r.messages?.find((m) => m.role === 'user')?.content || '')).at(-1)
  const sys = sent?.messages?.find((m) => m.role === 'system')?.content || ''
  const user = sent?.messages?.find((m) => m.role === 'user')?.content || ''
  ok(/^Request: make this shorter\n\nThe commented words:\n"""\nwhat they come back for\n"""/.test(user) && /Just before the commented words:[\s\S]*what a new person sees, and/.test(sys) && /threads\.docx/.test(sys) && /not instructions to you/.test(sys), 'it was asked about that place only: the words, the document around them and the request, told that the content isn\'t instructions', { user, sys: sys.slice(-400) })
  const onPage = async () => p.evaluate(() => ({ del: [...document.querySelectorAll('.sd-w del.sd-rev')].map((e) => e.innerText).join('|'), ins: [...document.querySelectorAll('.sd-w ins.sd-rev')].map((e) => e.innerText).join('|') }))
  ok(!!(await until(async () => { const x = await onPage(); return x.del === 'what they come back for' && x.ins === 'what they come back' }, 5000, 100)), 'its change shown on the words as a tracked suggestion: what goes struck out, what comes marked', await onPage())
  ok(/what they come back for/.test(await ask.locator('.sd-thread-sug del').innerText().catch(() => '')) && (await ask.locator('.sd-thread-sug button', { hasText: 'Keep' }).count()) === 1 && (await ask.locator('.sd-thread-sug button', { hasText: 'Discard' }).count()) === 1 && /1 suggestion from AI Assist/.test(await p.locator('.sd-thread-sugbar').innerText().catch(() => '')), 'Keep and Discard in the thread, and Keep all at the top')
  await shot(p, `${tag}studio-comments-suggestion`)
  // Saved before it's kept: a tracked change by AI Assist, as Word shows one; its reply in the file.
  await saveNow()
  const five = await savedWith('threads.docx', (x) => /w:author="AI Assist"/.test(x['word/comments.xml'] || ''))
  ok(!!five && /<w:del w:id="\d+" w:author="AI Assist" w:date="[^"]+Z"><w:r><w:delText>what they come back for<\/w:delText><\/w:r><\/w:del><w:ins w:id="\d+" w:author="AI Assist" w:date="[^"]+Z"><w:r><w:t>what they come back<\/w:t><\/w:r><\/w:ins>/.test(five['word/document.xml']), 'saved before it\'s kept: a tracked change by AI Assist in the file, which Word shows as a suggestion; the words themselves as they were', /<w:p [^>]*>(?:(?!<\/w:p>).)*come back for(?:(?!<\/w:p>).)*<\/w:p>/s.exec(five?.['word/document.xml'] || '')?.[0])
  ok(/<w:comment w:id="\d+" w:author="AI Assist" w:date="[^"]+" w:initials="AI">/.test(five?.['word/comments.xml'] || ''), 'and its reply in comments.xml, signed AI Assist')
  // Discard: as it was. Then again (slowly): working, then Keep.
  await ask.locator('.sd-thread-sug button', { hasText: 'Discard' }).click()
  ok(!!(await until(async () => { const x = await onPage(); return !/come back for/.test(x.del + x.ins) && (await ask.locator('.sd-thread-sug').count()) === 0 }, 3000, 100)) && /what they come back for\.$/.test(await E((ed) => ed.state.doc.textContent)), 'Discard: the words as they were, and the reply stays in the thread')
  await ask.locator('.sd-thread-quote').click()
  await ask.locator('.sd-thread-box textarea').fill('@bridge shorter please, slowly')
  await ask.locator('.sd-thread-box button[type="submit"]').click()
  ok(!!(await until(async () => /AI Assist is working…/.test(await ask.locator('.sd-thread-ai.busy').innerText().catch(() => '')) && (await p.locator('.sd-w .sd-cmt.busy').count()) > 0, 3000, 50)), 'a reply with @bridge carries on: "AI Assist is working…" in the thread, its words pulsing')
  await shot(p, `${tag}studio-comments-working`)
  ok(!!(await until(async () => (await ask.locator('.sd-thread-entry.ai').count()) === 2 && (await ask.locator('.sd-thread-sug').count()) === 1, 15000, 200)), 'then its reply and its suggestion')
  const threadSent = model.requests().filter((r) => /^Request:/.test(r.messages?.find((m) => m.role === 'user')?.content || '')).at(-1)?.messages?.find((m) => m.role === 'user')?.content || ''
  ok(/The thread so far:\n- Tester: @bridge make this shorter\n- AI Assist: Cut it to its first part/.test(threadSent), 'with the thread so far', threadSent)
  await ask.locator('.sd-thread-sug button', { hasText: 'Keep' }).click()
  ok(!!(await until(async () => { const x = await onPage(); return !/come back/.test(x.del + x.ins) && /what a new person sees, and what they come back\.$/.test(await E((ed) => ed.state.doc.textContent)) }, 3000, 100)), 'Keep: the new words in place, no longer marked', await E((ed) => ed.state.doc.textContent.slice(-80)))
  await saveNow()
  ok(!!(await savedWith('threads.docx', (x) => !/w:author="AI Assist"/.test(x['word/document.xml']) && /what they come back<\/w:t>/.test(x['word/document.xml']))), 'saved kept: the words changed in the file, no tracked change left')
  // The colleague's, sent: answered, and kept with Keep all.
  await sam.locator('button', { hasText: 'Send to AI Assist' }).click()
  ok(!!(await until(async () => (await sam.locator('.sd-thread-entry.ai').count()) === 1 && (await sam.locator('.sd-thread-ai.wait').count()) === 0, 15000, 200)), 'Send to AI Assist: the colleague\'s request answered once you send it')
  await p.locator('.sd-thread-sugbar button', { hasText: 'Keep all' }).click()
  ok(!!(await until(async () => (await p.locator('.sd-thread-sugbar').count()) === 0 && /^The team spent the quarter on the parts of the product people use every day\.$/m.test(await E((ed) => { let s = ''; ed.state.doc.forEach((n) => { s += `${n.textContent}\n` }); return s })), 3000, 100)), 'Keep all: every suggestion kept')
  // A question: an answer, no change.
  await sam.locator('.sd-thread-quote').click()
  await sam.locator('.sd-thread-box textarea').fill('@bridge what is this about?')
  await sam.locator('.sd-thread-box button[type="submit"]').click()
  ok(!!(await until(async () => (await sam.locator('.sd-thread-entry.ai').count()) === 2, 15000, 200)) && (await sam.locator('.sd-thread-sug').count()) === 0 && /words on what the team worked on/.test(await sam.locator('.sd-thread-entry.ai').last().innerText()), 'a question gets an answer in the thread, and no change')
  ok(model.asked(/^Request:/).length === 4, 'a model asked only when you sent it: four times', model.asked(/^Request:/).length)

  // ---------- @bridge on a sheet's cells ----------
  // With a model now: AI Assist answers in the thread, signed with the wand and the model, and its
  // change goes on the sheet outlined as a suggestion, to Keep or Discard (or Keep all), as the
  // sheet's AI Assist puts one. Your @bridge from before, back from the file, waits like a colleague's.
  ok(!!(await openSheet(p, 'threads.xlsx')), 'the Excel file again')
  await nameBox(p)
  await ribbon(p, 'bridge.sheet.comments')
  await p.locator('.sh-threads').waitFor({ timeout: 5000 })
  ok(/Tester asked @bridge in the file\. It waits for you/.test(await doubled.locator('.sd-thread-ai.wait').innerText().catch(() => '')), 'your own @bridge from before, read back from the file, waits to be sent too', await doubled.innerText().catch(() => ''))
  const sheetAsks = model.asked(/^In the spreadsheet threads\.xlsx/).length
  await doubled.locator('button', { hasText: 'Send to AI Assist' }).click()
  const xAi = doubled.locator('.sd-thread-entry.ai')
  ok(!!(await until(async () => (await xAi.count()) === 1, 15000, 200)), 'Send to AI Assist: AI Assist answers in the thread', await doubled.innerText().catch(() => ''))
  const xEntry = await xAi.evaluate((e) => ({ who: e.querySelector('.sd-comment-who b')?.innerText, wand: !!e.querySelector('.sd-who-ai .icon'), text: e.querySelector('.sd-comment-text')?.innerText }))
  ok(xEntry.who === 'AI Assist' && xEntry.wand && /^Doubled each cost into column C/.test(xEntry.text) && /AI Assist · .*gpt-5/.test(xEntry.text), 'signed AI Assist with the wand, saying what it did and which model did it', xEntry)
  const xSent = model.requests().filter((r) => /^In the spreadsheet threads\.xlsx/.test(r.messages?.find((m) => m.role === 'user')?.content || '')).at(-1)
  const xUser = xSent?.messages?.find((m) => m.role === 'user')?.content || ''
  const xSys = xSent?.messages?.find((m) => m.role === 'system')?.content || ''
  ok(model.asked(/^In the spreadsheet threads\.xlsx/).length === sheetAsks + 1 && /on the sheet "Budget": double these costs\n/.test(xUser) && /The cells I commented on \(A2 on Budget, in the table A1:B7\)/.test(xUser) && /Hosting\t120/.test(xUser) && /not instructions to you/.test(xSys), 'it was asked through the sheet\'s AI Assist about the cell the comment is on (as Excel keeps one), with the table it\'s in: the request, the cells with their values, told that they aren\'t instructions', { user: xUser.slice(0, 400), sys: xSys })
  const xSug = doubled.locator('.sd-thread-sug')
  ok(/5 cells, outlined on the sheet/.test(await xSug.innerText().catch(() => '')) && /C2\s*=B2\*2/.test(await xSug.innerText().catch(() => '')) && (await xSug.locator('button', { hasText: 'Keep' }).count()) === 1 && (await xSug.locator('button', { hasText: 'Discard' }).count()) === 1 && /1 suggestion from AI Assist/.test(await p.locator('.sh-threads .sd-thread-sugbar').innerText().catch(() => '')), 'its change a suggestion outlined on the sheet, its cells listed, with Keep and Discard in the thread and Keep all at the top', await xSug.innerText().catch(() => ''))
  await shot(p, `${tag}studio-comments-sheet-suggestion`)
  const ExcelJS = require('exceljs')
  const cellIn = async (a1) => { const x = new ExcelJS.Workbook(); await x.xlsx.readFile(file('threads.xlsx')); return x.getWorksheet('Budget').getCell(a1).value }
  await xSug.locator('button', { hasText: 'Discard' }).click()
  ok(!!(await until(async () => (await xSug.count()) === 0 && (await p.locator('.sh-threads .sd-thread-sugbar').count()) === 0 && (await xAi.count()) === 1, 3000, 100)), 'Discard: off the sheet, the reply staying in the thread')
  await saveNow()
  const x4 = await xSaved((x) => /displayName="AI Assist"/.test(x['xl/persons/person.xml'] || ''))
  ok(!!x4 && (await cellIn('C2')) == null && /Doubled each cost into column C[\s\S]*AI Assist · /.test(tcOf(tcIn(x4), 'Doubled each cost')), 'saved: nothing of the change in the file; AI Assist\'s reply there, AI Assist one of the people who wrote', await cellIn('C2'))
  // Again, slowly: working, then Keep.
  await doubled.locator('.sd-thread-quote').click()
  await doubled.locator('.sd-thread-box textarea').fill('@bridge double these costs slowly')
  await doubled.locator('.sd-thread-box button[type="submit"]').click()
  ok(!!(await until(async () => /AI Assist is working…/.test(await doubled.locator('.sd-thread-ai.busy').innerText().catch(() => '')), 3000, 50)), 'a reply with @bridge carries on: "AI Assist is working…" in the thread')
  await shot(p, `${tag}studio-comments-sheet-working`)
  ok(!!(await until(async () => (await xAi.count()) === 2 && (await xSug.count()) === 1, 15000, 200)), 'then its reply and its suggestion')
  ok(/The comment thread on them so far:\n- Tester: @bridge double these costs\n- AI Assist: Doubled each cost/.test(model.asked(/^In the spreadsheet threads\.xlsx/).at(-1) || ''), 'with the thread so far', model.asked(/^In the spreadsheet threads\.xlsx/).at(-1))
  await xSug.locator('button', { hasText: 'Keep' }).click()
  ok(!!(await until(async () => (await xSug.count()) === 0, 3000, 100)), 'Keep: kept, no longer outlined')
  await saveNow()
  await xSaved(() => true)
  ok(!!(await until(async () => (await cellIn('C2'))?.formula === 'B2*2' && (await cellIn('C6'))?.formula === 'B6*2', 10000, 200)), 'saved kept: the new formulas in the file', [await cellIn('C2'), await cellIn('C6')])
  // The colleague's, sent: answered, and kept with Keep all; a question answered with no change.
  await travel.locator('button', { hasText: 'Send to AI Assist' }).click()
  ok(!!(await until(async () => (await travel.locator('.sd-thread-entry.ai').count()) === 1 && (await travel.locator('.sd-thread-ai.wait').count()) === 0 && (await travel.locator('.sd-thread-sug').count()) === 1, 15000, 200)), 'Send to AI Assist: the colleague\'s request answered once you send it')
  await p.locator('.sh-threads .sd-thread-sugbar button', { hasText: 'Keep all' }).click()
  ok(!!(await until(async () => (await p.locator('.sh-threads .sd-thread-sugbar').count()) === 0 && (await travel.locator('.sd-thread-sug').count()) === 0, 3000, 100)), 'Keep all: every suggestion kept')
  await travel.locator('.sd-thread-quote').click()
  await travel.locator('.sd-thread-box textarea').fill('@bridge what does this come to?')
  await travel.locator('.sd-thread-box button[type="submit"]').click()
  ok(!!(await until(async () => (await travel.locator('.sd-thread-entry.ai').count()) === 2, 15000, 200)) && (await travel.locator('.sd-thread-sug').count()) === 0 && /numbers come to \d+/.test(await travel.locator('.sd-thread-entry.ai').last().innerText()), 'a question gets its answer in the thread, and no change')
  await saveNow()
  await xSaved((x) => /numbers come to \d+/.test(tcIn(x)))

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
  ok(!!(await openSheet(dark.p, 'threads.xlsx')), 'dark: the Excel file')
  await ribbon(dark.p, 'bridge.sheet.comments')
  const xCard = await until(() => dark.p.locator('.sh-threads .sd-thread').first().evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => null), 5000, 100)
  ok(!!xCard && xCard !== 'rgb(255, 255, 255)', 'and its threads beside the sheet, in the dark look too', xCard)
  await shot(dark.p, `${tag}studio-comments-sheet-dark`)
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
  const refused = await kit.api('/studio/comment-assist', { request: 'make this shorter', text: 'Some words' }).catch((e) => e)
  ok(refused?.status === 404 && refused.j?.trial === 'comments' && /^Comments and @bridge is a beta feature\. Turn it on in Settings › About & Updates › Beta Features\.$/.test(refused.message), 'with the beta off, @bridge\'s route isn\'t there, and says how to turn it on', refused?.message)
  const asks = model.asked(/^Request:/).length
  const xAsked = model.asked(/^In the spreadsheet/).length
  const off = await page(b, kit.url, { width: 1440, height: 900 })
  pages.push(off)
  await off.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await until(async () => { await off.p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'threads.docx' } })), { root }); return off.p.locator('.sd-w').first().waitFor({ timeout: 2500 }).then(() => true, () => false) }, 25000, 300)
  await off.p.locator('.sd-doc-tools button[aria-label="Comments"]').click()
  ok(!!(await until(async () => /Answer them in Word/.test(await off.p.locator('.sd-comments-pane').innerText().catch(() => '')), 5000, 100)) && (await off.p.locator('.sd-threads, .sd-thread-add').count()) === 0, 'with Comments and @bridge off: the comments shown as before, to answer in Word, and nothing to write them with')
  await shot(off.p, `${tag}studio-comments-off`)
  await off.p.evaluate(() => { const ed = document.querySelector('.sd-w').editor; let r = null; ed.state.doc.descendants((n, pos) => { if (!r && n.isTextblock && n.textContent.includes('first hour')) r = { from: pos + 1, to: pos + 10 }; return !r }); ed.view.focus(); ed.commands.setTextSelection(r) })
  ok(!!(await until(() => off.p.locator('.sd-bubble-ai').isVisible(), 5000, 100)) && (await off.p.locator('.sd-bubble-cmt').count()) === 0, 'and words picked have AI Assist by them, not Comment')
  ok((await off.p.locator('.sd-comments-pane').innerText()).includes('@bridge make this shorter') && !(await off.p.locator('.sd-comments-pane button', { hasText: /Send to AI Assist|Keep|Reply/ }).count()) && model.asked(/^Request:/).length === asks, 'a comment with @bridge in it is only words: nothing to send, and nothing sent')
  const xRefused = await kit.api('/studio/sheet/comment', { instruction: 'double these', selection: 'A1' }).catch((e) => e)
  ok(xRefused?.status === 404 && xRefused.j?.trial === 'comments', 'and @bridge\'s route for a sheet isn\'t there either', xRefused?.message)
  ok(!!(await openSheet(off.p, 'threads.xlsx')), 'an Excel file with threaded comments, the beta off')
  ok(!!(await until(async () => /threaded comments: they aren't shown here, and saving here keeps them as they are/.test(await off.p.locator('.sh-note').innerText().catch(() => '')), 8000, 100)), 'says, as before, that it has threaded comments kept as they are', await off.p.locator('.sh-note').innerText().catch(() => ''))
  await off.p.locator('.sd-univer [role="tab"]', { hasText: 'Insert' }).first().click()
  ok((await off.p.locator('.sd-univer [data-u-command="bridge.sheet.comment"], .sd-univer [data-u-command="bridge.sheet.comments"], .sh-threads').count()) === 0 && model.asked(/^In the spreadsheet/).length === xAsked, 'and has nothing to comment with, and nothing was sent', model.asked(/^In the spreadsheet/).length)
  await shot(off.p, `${tag}studio-comments-sheet-off`)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const x of pages) await x.ctx.close().catch(() => {})
  await b.close()
  kit.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
