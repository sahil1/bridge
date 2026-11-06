// A meeting mentioned in an agent's message box, from any of your computers, in the browser named by
// BRIDGE_TEST_BROWSER. Three Bridge AIs, each on its own relay (stand-ins/relay.mjs): "Studio", where
// the agent works and the page is; "Desk PC", linked to it, where a meeting was recorded; and,
// later, "Old PC", an older Bridge AI (stand-ins/older-meetings.mjs) with a meeting of its own.
// Checked: "@" alone shows Meetings first, then the folder's files; picking it lists the latest
// meetings from both computers, Desk PC's named for it; typing filters them; Esc and Backspace go
// back; a word after @ shows the meetings matching it above the files; Desk PC's meeting, picked,
// puts in an @path of a file on Studio whose text is that meeting's summary; another meeting key
// lists only meetings and leaves @ to the files; Old PC's meeting says to update Bridge AI there, in
// the foot and when picked; Desk PC gone quiet is said in the foot ("isn't reachable") while
// Studio's own meetings are there in a couple of seconds; and on a phone, the same, each row a whole
// 40 px, with nothing past the screen's edge.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { startKit, startRelay, checks, until, browser, page, shot, phoneFaults, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('mention-meetings')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const relays = []
const kits = []
const kitWith = async (name, rel, env = {}) => {
  const k = await startKit(`mention-meetings-${name.toLowerCase().replace(/\W+/g, '-')}`, { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, ...env } } })
  kits.push(k)
  await k.api('/setup', { name: 'Tester' })
  return k
}
// A meeting that's done, as the server keeps it, with a summary.
const meeting = (k, id, title, at, summary) => {
  const d = path.join(k.data, 'meetings', id)
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'meeting.json'), JSON.stringify({ id, title, startedAt: new Date(at).toISOString(), endedAt: new Date(+new Date(at) + 2520e3).toISOString(), status: 'done', seconds: 2520, kind: 'general', call: 'off' }))
  fs.writeFileSync(path.join(d, 'summary.md'), `# ${title}\n\n${summary}\n`)
  fs.writeFileSync(path.join(d, 'transcript.jsonl'), `${JSON.stringify({ src: 'you', t0: 1, t1: 4, text: `Let's start the ${title.toLowerCase()}.`, engine: 'test' })}\n`)
}
// One computer linked to another with its pairing code, and seen online there.
const link = async (from, to, rel, name) => {
  const p = (await to.api('/relay/pair', {})).pairing
  await from.api('/machines', { link: `${rel.url} ${p.code}` })
  return until(async () => (await from.api('/machines')).machines.find((m) => m.name === name && m.online), 30000, 300)
}

try {
  const rs = await startRelay('mention-meetings-studio')
  const rp = await startRelay('mention-meetings-pc')
  const ro = await startRelay('mention-meetings-old')
  relays.push(rs, rp, ro)
  const studio = await kitWith('Studio', rs)
  const pc = await kitWith('Desk PC', rp)
  ok(!!(await until(async () => (await studio.api('/relay')).online && (await pc.api('/relay')).online, 20000)), 'each is connected to its own relay')

  meeting(studio, '2026-11-03-aaa111', 'Design review', '2026-11-03T15:00:00Z', '- The new menu goes ahead.')
  meeting(studio, '2026-11-01-bbb222', 'Quarterly budget', '2026-11-01T10:00:00Z', '- Spend stays flat.')
  meeting(pc, '2026-11-04-ccc333', 'Quarterly plan', '2026-11-04T09:30:00Z', '- Ship the beta on the 20th.\n\n## Action items\n- [ ] Priya: book the launch room')

  // The agent, at work in a folder with a file whose name matches too: a repo of its own (inside this
  // one's ignored test/.out, git would list none of it).
  const work = path.join(studio.home, 'launch')
  fs.mkdirSync(path.join(work, 'src'), { recursive: true })
  fs.writeFileSync(path.join(work, 'src', 'app.js'), 'export {}\n')
  fs.writeFileSync(path.join(work, 'quarterly-report.md'), '# Report\n')
  fs.writeFileSync(path.join(work, 'notes.md'), 'notes\n')
  spawnSync('git', ['init', '-q', work])
  studio.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await studio.api('/agents/catalog')
  const pane = (await studio.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Launch', newSpace: 'Launch', prompt: 'idle' })).paneId

  const desk = await link(studio, pc, rp, 'Desk PC')
  ok(!!desk, 'Studio is linked to Desk PC')

  // ---------- the server ----------
  const own = await pc.api('/meetings/mentions?here=1')
  ok(own.agentText === true && own.meetings.length === 1 && own.meetings[0].title === 'Quarterly plan' && own.meetings[0].machine === null, 'here=1: only that computer\'s own meetings, and it gives their words', own)
  let all = await studio.api('/meetings/mentions?n=20')
  ok(all.meetings.map((m) => m.title).join() === 'Quarterly plan,Design review,Quarterly budget' && all.meetings[0].device === 'Desk PC' && all.meetings[0].machine === desk.id && all.meetings[1].device === null && all.here === 'Studio' && all.from.join() === 'Desk PC' && !all.unreachable.length && !all.update.length,
    'Studio lists its meetings and Desk PC\'s, the latest first, each named for its computer', all)
  const words = await pc.api('/meetings/2026-11-04-ccc333/for-agents?text=1', {})
  ok(/^# Quarterly plan\n/.test(words.text) && /Ship the beta on the 20th/.test(words.text) && fs.readFileSync(words.path, 'utf8') === words.text, 'asked for its text: the file for the agent, and its words', words)

  // ---------- the menu, at a desk ----------
  const { ctx, p, errors } = await page(b, studio.url, { mode: 'light', theme: 'sky' })
  await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
  await p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), pane)
  const box = p.locator(`textarea[data-composer="${pane}"]`)
  await box.waitFor({ timeout: 20000 })
  const menu = p.locator('.mention-menu')
  const rows = () => p.evaluate(() => [...document.querySelectorAll('.mention-menu .slash-item')].map((e) => ({ kind: e.classList.contains('meeting') ? 'meeting' : e.classList.contains('jump') ? 'jump' : 'file', label: e.querySelector('b').innerText.trim(), desc: e.querySelector('.slash-desc').innerText.trim(), badge: e.querySelector('.slash-badge')?.textContent.trim() || null, icon: !!e.querySelector('b svg'), on: e.classList.contains('on') })))
  const title = () => menu.locator('.slash-title').innerText().then((s) => s.replace(/\s+/g, ' ').trim(), () => '')
  const foot = () => menu.locator('.slash-foot').innerText().then((s) => s.replace(/\s+/g, ' ').trim(), () => '')
  const settle = async (fn, ms = 8000) => (await until(async () => { const r = await rows(); return fn(r) ? r : null }, ms, 100)) || rows()
  const type = async (s) => { await box.focus(); await box.pressSequentially(s, { delay: 30 }) }
  // The box emptied, and its draft too (kept a moment after each change), so a reload starts empty.
  const clear = async () => { await box.fill(''); await p.keyboard.press('Escape'); await p.waitForTimeout(400) }

  await type('@')
  let r = await settle((x) => x.length > 2 && x.some((y) => y.label === 'quarterly-report.md'))
  ok(r[0]?.kind === 'jump' && r[0].label === 'Meetings' && r[0].desc === 'Your recorded meetings, on every computer' && r[0].icon && r[0].on, '"@" alone: the first row is Meetings, with the meetings icon and what it is, chosen', r.slice(0, 2))
  ok(r.slice(1).every((x) => x.kind === 'file') && r.some((x) => x.label === 'src/') && r.some((x) => x.label === 'notes.md'), 'then the folder\'s files', r.map((x) => x.label))
  ok(/^Files and meetings ?launch\/$/.test(await title()), 'the title says what\'s in it: files and meetings, in the agent\'s folder', await title())
  await shot(p, `${tag}mention-at`)

  await p.keyboard.press('Enter')
  r = await settle((x) => x.length === 3 && x.every((y) => y.kind === 'meeting'))
  ok(r.map((x) => x.label).join() === 'Quarterly plan,Design review,Quarterly budget' && r.every((x) => x.badge === 'meeting' && x.icon), 'picked: the latest meetings, from both computers, each with the meeting badge and icon', r)
  ok(/·\s*42 min\s*·\s*Desk PC$/.test(r[0].desc) && /·\s*42 min$/.test(r[1].desc), 'each with its date and length, and its computer when it isn\'t this one', r.map((x) => x.desc))
  ok(await title() === 'Meetings' && /Esc back/.test(await foot()) && /Meetings on Studio and Desk PC/.test(await foot()), 'the title says Meetings, and the foot where they\'re from and that Esc goes back', [await title(), await foot()])
  ok(await box.inputValue() === '@', 'the box still has just the @')
  await shot(p, `${tag}mention-meetings`)

  await type('quar')
  r = await settle((x) => x.length === 2)
  ok(r.map((x) => x.label).join() === 'Quarterly plan,Quarterly budget' && await title() === 'Meetings matching "quar"', 'typing filters them', [r.map((x) => x.label), await title()])
  await p.keyboard.press('Escape')
  r = await settle((x) => x.some((y) => y.label === 'quarterly-report.md') && !x.some((y) => y.label === 'notes.md'))
  ok(r.map((x) => `${x.kind}:${x.label}`).join() === 'meeting:Quarterly plan,meeting:Quarterly budget,file:quarterly-report.md' && await title() === 'Files and meetings matching "quar"' && await box.inputValue() === '@quar',
    'Esc goes back: with a word after @, the meetings matching it come first, then the files', [r.map((x) => `${x.kind}:${x.label}`), await title()])
  for (let i = 0; i < 4; i++) await p.keyboard.press('Backspace')
  r = await settle((x) => x[0]?.kind === 'jump')
  await p.keyboard.press('Tab')
  r = await settle((x) => x.length === 3 && x.every((y) => y.kind === 'meeting'))
  ok(r.length === 3 && r.every((y) => y.kind === 'meeting'), 'Tab picks Meetings too', r.map((x) => x.label))
  await p.keyboard.press('Backspace')
  r = await settle((x) => x[0]?.kind === 'jump' && x.some((y) => y.kind === 'file'))
  ok(r[0]?.kind === 'jump' && r.some((x) => x.kind === 'file') && await box.inputValue() === '@', 'Backspace with nothing typed goes back to the files, keeping the @', [r.map((x) => x.label), await box.inputValue()])
  await p.keyboard.press('Backspace')
  ok(!!(await until(async () => !(await menu.count()), 3000, 100)) && await box.inputValue() === '', 'Backspace past the @: the menu goes')

  // Desk PC's meeting, picked: a file here for the agent, with its summary.
  await type('@plan')
  r = await settle((x) => x[0]?.label === 'Quarterly plan')
  ok(r[0]?.kind === 'meeting' && /Desk PC$/.test(r[0].desc), 'a word after @: Desk PC\'s meeting first', r)
  await p.keyboard.press('Enter')
  const put = await until(async () => { const v = await box.inputValue(); return /^@"[^"]+" $/.test(v) && v }, 15000, 200)
  const file = put ? put.slice(2, -2) : ''
  const text = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  ok(!!put && file.startsWith(path.join(studio.data, 'meeting-copies', desk.id)) && path.basename(file) === 'Quarterly plan.md', 'picked: an @path of a file on Studio, in its folder of copies, named for the meeting', put)
  ok(/^# Quarterly plan\n/.test(text) && /## Summary\n\n- Ship the beta on the 20th\./.test(text) && /Priya: book the launch room/.test(text), 'whose text is that meeting\'s summary, from Desk PC', text.slice(0, 300))
  ok(!(await menu.count()), 'and the menu is gone')
  await clear()

  // Another meeting key: only meetings with it, and @ is the files (in a window opened since, as
  // the box asks for the key when it opens).
  await studio.api('/settings', { meetings: { mentionKey: '#' } }, 'PATCH')
  {
    const k = await page(b, studio.url, { mode: 'light', theme: 'sky' })
    await k.p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await k.p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), pane)
    const kbox = k.p.locator(`textarea[data-composer="${pane}"]`)
    await kbox.waitFor({ timeout: 20000 })
    const krows = () => k.p.evaluate(() => [...document.querySelectorAll('.mention-menu .slash-item')].map((e) => ({ kind: e.classList.contains('meeting') ? 'meeting' : e.classList.contains('jump') ? 'jump' : 'file', label: e.querySelector('b').innerText.trim() })))
    await kbox.focus()
    await kbox.pressSequentially('#', { delay: 30 })
    let kr = await until(async () => { const x = await krows(); return x.length === 3 && x }, 8000, 100) || await krows()
    const ktop = await k.p.locator('.mention-menu .slash-title').innerText().catch(() => '')
    ok(kr.map((x) => x.label).join() === 'Quarterly plan,Design review,Quarterly budget' && kr.every((x) => x.kind === 'meeting') && ktop === 'Meetings', 'another meeting key alone: the latest meetings, Desk PC\'s too, under Meetings', [kr.map((x) => x.label), ktop])
    await kbox.fill('')
    await kbox.pressSequentially('@', { delay: 30 })
    kr = await until(async () => { const x = await krows(); return x.some((y) => y.label === 'quarterly-report.md') && x }, 8000, 100) || await krows()
    const ktitle = await k.p.locator('.mention-menu .slash-title').innerText().catch(() => '')
    ok(kr.every((x) => x.kind === 'file') && !/meetings/i.test(ktitle), 'and @ is only the files', [kr.map((x) => x.label), ktitle])
    ok(!k.errors.length, 'no page errors there', k.errors)
    await kbox.fill('')
    await k.p.waitForTimeout(400)
    await k.ctx.close()
  }
  await studio.api('/settings', { meetings: { mentionKey: null } }, 'PATCH')

  // ---------- an older Bridge AI ----------
  const old = await kitWith('Old PC', ro, { NODE_OPTIONS: `--import=${pathToFileURL(path.join(TEST, 'stand-ins', 'older-meetings.mjs')).href}` })
  await until(async () => (await old.api('/relay')).online, 20000)
  meeting(old, '2026-11-02-ddd444', 'Budget review', '2026-11-02T11:00:00Z', '- Cut the travel line.')
  const op = await link(studio, old, ro, 'Old PC')
  ok(!!op, 'Studio is linked to Old PC')
  all = await studio.api('/meetings/mentions?n=20')
  const bud = all.meetings.find((m) => m.title === 'Budget review')
  ok(bud?.old === true && bud.device === 'Old PC' && all.update.join() === 'Old PC', 'Old PC\'s meeting is listed, marked as from an older Bridge AI that can\'t give its words', all)
  const said = await studio.api('/meetings/2026-11-02-ddd444/for-agents', { machine: op.id }).catch((e) => e)
  ok(said.j?.code === 'update' && /^Update Bridge AI on Old PC to mention its meetings here/.test(said.message), 'asked for it anyway: update Bridge AI on Old PC', said.j || said)
  await type('@')
  await settle((x) => x[0]?.kind === 'jump')
  await p.keyboard.press('Enter')
  r = await settle((x) => x.length === 4)
  ok(r.map((x) => x.label).join() === 'Quarterly plan,Design review,Budget review,Quarterly budget' && /Old PC$/.test(r[2].desc), 'its meeting is in the list, named for it', r.map((x) => `${x.label} ${x.desc}`))
  ok(/Update Bridge AI on Old PC to mention its meetings here/.test(await foot()), 'and the foot says to update Bridge AI there', await foot())
  for (let i = 0; i < 2; i++) await p.keyboard.press('ArrowDown')
  await p.keyboard.press('Enter')
  const note = p.locator('.comp-note')
  ok(!!(await until(async () => /Update Bridge AI on Old PC to mention its meetings here/.test(await note.innerText().catch(() => '')), 5000, 100)) && await box.inputValue() === '@', 'picked, it says so instead of putting nothing in', [await note.innerText().catch(() => ''), await box.inputValue()])
  await shot(p, `${tag}mention-update`)
  await clear()

  // ---------- on a phone ----------
  const ph = await page(b, studio.url, { mode: 'dark', theme: 'midnight', phone: true })
  await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
  await ph.p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), pane)
  const pbox = ph.p.locator(`textarea[data-composer="${pane}"]`)
  await pbox.waitFor({ timeout: 20000 })
  await pbox.focus()
  await pbox.pressSequentially('@', { delay: 30 })
  const prow = () => ph.p.evaluate(() => [...document.querySelectorAll('.mention-menu .slash-item')].map((e) => ({ kind: e.classList.contains('meeting') ? 'meeting' : e.classList.contains('jump') ? 'jump' : 'file', label: e.querySelector('b').innerText.trim(), h: Math.round(e.getBoundingClientRect().height) })))
  let pr = await until(async () => { const x = await prow(); return x.some((y) => y.label === 'notes.md') && x }, 10000, 100) || await prow()
  ok(pr[0]?.kind === 'jump' && pr[0].label === 'Meetings' && pr.every((x) => x.h >= 40), 'on a phone: Meetings first too, each row a whole 40 px', pr)
  await ph.p.locator('.mention-menu .slash-item.jump').tap()
  pr = await until(async () => { const x = await prow(); return x.length === 4 && x.every((y) => y.kind === 'meeting') && x }, 10000, 100) || await prow()
  ok(pr.length === 4 && pr.every((x) => x.h >= 40), 'tapped: the meetings, each a whole 40 px', pr)
  const pfoot = await ph.p.locator('.mention-menu .slash-foot').innerText().catch(() => '')
  ok(/Update Bridge AI on Old PC/.test(pfoot) && !/choose/.test(pfoot), 'the foot says what\'s missing on a phone too, without the keys', pfoot)
  const back = ph.p.locator('.mention-menu .mention-jump', { hasText: 'Files and meetings' })
  ok(await back.count() === 1, 'and a way back to the files, for a phone with no Esc')
  const pf = await phoneFaults(ph.p, '.mention-menu')
  ok(!Object.keys(pf).length, 'the menu fits the phone (nothing past its edge, sideways or cut off; each target 40 px and uncovered)', pf)
  await shot(ph.p, `${tag}mention-phone`)
  await back.tap()
  pr = await until(async () => { const x = await prow(); return x[0]?.kind === 'jump' && x.some((y) => y.kind === 'file') && x }, 5000, 100) || await prow()
  ok(pr[0]?.kind === 'jump' && pr.some((x) => x.kind === 'file'), 'tapped, back to the files and Meetings', pr.map((x) => x.label))
  ok(!ph.errors.length, 'no page errors on the phone', ph.errors)
  await ph.ctx.close()

  // ---------- a computer that doesn't answer ----------
  await rp.freeze()
  const t0 = Date.now()
  all = await studio.api('/meetings/mentions?n=20')
  const took = Date.now() - t0
  ok(all.unreachable.includes('Desk PC') && !all.meetings.some((m) => m.device === 'Desk PC') && all.meetings.some((m) => m.title === 'Design review') && took < 3500, 'Desk PC gone quiet: named as unreachable, and Studio\'s own meetings come in a couple of seconds', { took, all })
  await type('@')
  await settle((x) => x[0]?.kind === 'jump')
  await p.keyboard.press('Enter')
  ok(!!(await until(async () => /Desk PC isn't reachable/.test(await foot()), 8000, 100)), 'the foot says Desk PC isn\'t reachable rather than leaving its meetings out without a word', await foot())
  r = await rows()
  ok(r.some((x) => x.label === 'Design review') && !r.some((x) => x.label === 'Quarterly plan'), 'Studio\'s own meetings are there', r.map((x) => x.label))
  await shot(p, `${tag}mention-unreachable`)
  await rp.thaw()
  ok(!errors.length, 'no page errors', errors)
  await ctx.close()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  await b.close().catch(() => {})
}
process.exit(done().fail ? 1 : 0)
