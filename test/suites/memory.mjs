// Memory as a page of its own, a beta feature (memory), in the browser named by BRIDGE_TEST_BROWSER.
// First what meeting memory keeps (server/meetmemory.js, in this process, on a folder of its own): a
// summary's names by kind, leaving out places, languages, days, months and everyday words (in other
// languages' words too), a first name alone, and a name speech to text spelled right by itself that
// nothing more is known about; keeping a person's whole name, a name the invite has, one that was
// misheard and one a meeting says who or what it is; the older form of the block (names) still read.
// The names memory has, said in a dictation (any case, a hyphen for a space), get that dictation, and
// nothing new comes from one; a dictation gone is taken off. Two merged: one name, the other kept as
// another way it's written, that a summary then finds it by.
//
// Then a server with Memory off and a memory with a bit of everything in it: its routes answer 404
// saying how to turn it on, meeting memory's own routes are as they were, Meetings' Memory opens the
// dialog and the sidebar has no Memory. On (Settings › About & Updates › Beta Features): the
// sidebar's Memory under Dictations, live. Each name's kind (yours, or a guess from an invite or its
// note), the dictations it came up in (ones from before Memory was on and one after), what looks the
// same, what looks like it adds little and why (never yours, a person or a name with a mishearing),
// and About You made from it (your name and organization, what you work on, the people and
// organizations you deal with most), in Chief of Staff's folder too. The model writing notes and
// the one tidying dictation are given it (the names, for tidying); yours once you write it; off,
// neither is, and Chief of Staff's copy is gone.
//
// In the app, light and dark at 1440: the page from the sidebar, the collections and their counts,
// a search, the tidy-up looked over with one kept and the rest taken out, a pair merged under the
// name picked and one kept apart, a kind changed, a dictation opened from a name, About You edited
// and switched off and on, Meetings' Memory and Settings › Meetings opening the page; People with
// the people you meet (Meeting Insights on), one kept in memory, and saying what's missing with it
// off. On 375 and 430 px phones from More: nothing wider than the phone, every target whole.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startModel, checks, until, browser, page, shot, phoneFaults, withoutCutOff, OUT } from '../lib/harness.mjs'

const { ok, done } = checks('memory')
const DAY = 864e5
const ago = (days) => new Date(Date.now() - days * DAY).toISOString()

// ---------- What memory keeps, in this process ----------
{
  const home = path.join(OUT, 'kits', `memory-unit-${process.pid}`)
  fs.rmSync(home, { recursive: true, force: true })
  process.env.BRIDGE_HOME = home
  const m = await import('../../server/meetmemory.js')
  m.configure({ trials: { memory: true } })
  const plain = Object.fromEntries(['India', 'Allemagne', 'Europe', 'German', 'Hindi', 'Indian', 'Monday', 'Mittwoch', 'March', 'Q3', 'FY25', '2025', 'CEO', 'API', '$5M', 'Acme', 'Priya Shah', 'Kubernetes'].map((w) => [w, m.plain(w)]))
  ok(plain.India === 'place' && plain.Allemagne === 'place' && plain.Europe === 'place' && plain.German === 'language' && plain.Hindi === 'language' && plain.Indian === 'language'
    && plain.Monday === 'time' && plain.Mittwoch === 'time' && plain.March === 'time' && plain.Q3 === 'time' && plain.FY25 === 'time' && plain['2025'] === 'time'
    && plain.CEO === 'common' && plain.API === 'common' && plain.$5M === 'common' && plain.Acme === null && plain['Priya Shah'] === null && plain.Kubernetes === null, 'what adds nothing: places, languages, days, months, quarters and everyday words, in other languages too', plain)
  ok(m.plainFor('Jordan', 'person') === null && m.plainFor('Jordan', 'org') === 'place', 'a person can be called what a country is')
  const heard = 'Priya said the Northwind deal is fine and India signed. We run Kubernetes, and the ack me portal goes live on Monday. The CEO wants Q3. Dan agreed, and so did Lee.'
  m.learn({ people: ['Priya Shah', 'Dan', 'Lee'], organizations: ['Northwind', 'Contoso'], projects: ['Kubernetes'], terms: ['Q3', 'CEO', 'SKU sync'], names: ['India', 'Monday', 'Germany'], misheard: { 'ack me': 'Acme' }, about: { Dan: 'runs the depot', India: 'where the team is' } },
    { meeting: 'm1', known: 'Northwind weekly\nPriya Shah\nAcme', heard })
  const got = Object.fromEntries(m.list().map((t) => [t.term, t]))
  ok(['Priya Shah', 'Northwind', 'Contoso', 'SKU sync', 'Acme', 'Dan'].every((n) => got[n]) && !['India', 'Monday', 'Germany', 'Q3', 'CEO', 'Kubernetes', 'Lee'].some((n) => got[n]),
    'a summary\'s names: a whole name, one the invite has, one it misheard, one it says who is and ones speech to text didn\'t spell; no place, day, everyday word, first name alone or name spelled right that nothing more is known about', Object.keys(got))
  ok(got['Priya Shah'].kind === 'person' && got.Northwind.kind === 'org' && got.Contoso.kind === 'org' && got['SKU sync'].kind === 'term' && got.Acme.heard.includes('ack me') && got.Dan.note === 'runs the depot' && got.Dan.kind === 'person', 'each with its kind, the mishearing and the note', got)
  m.learn({ names: ['Atlas', 'Monday'] }, { meeting: 'm2', known: 'Atlas review', heard: 'The atlas numbers' })
  ok(m.list().some((t) => t.term === 'Atlas' && !t.kind) && !m.list().some((t) => t.term === 'Monday'), 'the older block, names alone, is still read')
  // Dictations: the names memory has, said in one.
  const d2 = ago(0.5)
  m.mentions([{ id: 'd1', at: ago(1), text: 'Send the SKU-sync notes to priya shah and Contoso' }, { id: 'd2', at: d2, text: 'Lunch with Maya at noon' }])
  const ds = Object.fromEntries(m.list().map((t) => [t.term, t.dictations || []]))
  ok(ds['SKU sync'].includes('d1') && ds['Priya Shah'].includes('d1') && ds.Contoso.includes('d1') && !m.list().some((t) => t.term === 'Maya') && m.dictationsAt() === d2, 'a dictation counts for the names memory has that it says, and adds none', ds)
  m.forgetDictations(['d1'])
  ok(!m.list().some((t) => (t.dictations || []).includes('d1')), 'a dictation gone is taken off them')
  // Merged: one name, the other another way it's written, that a summary finds it by.
  const dan = m.add({ term: 'Dan Ruiz', kind: 'person' }, { source: 'learned', meeting: 'm3' })
  const short = m.list().find((t) => t.term === 'Dan')
  m.merge(dan.id, short.id)
  m.learn({ names: ['Dan'], about: {} }, { meeting: 'm4', known: 'Dan', heard: 'Dan' })
  const merged = m.list().filter((t) => /^Dan/.test(t.term))
  ok(merged.length === 1 && merged[0].also.includes('Dan') && merged[0].note === 'runs the depot' && ['m1', 'm3', 'm4'].every((x) => merged[0].meetings.includes(x)), 'two merged: one name with both meetings and the note, the other written another way, and found by it', merged)
  ok(/Dan Ruiz: runs the depot/.test(m.about('I spoke to Dan')) && m.about('nothing here') === '', 'and the notes know it by either name; with nothing to say, nothing')
  m.setDraft('I\'m Tester.\nThe people I deal with most: Dan Ruiz.', ['Dan Ruiz'])
  ok(/^About me, from my memory in Bridge AI:\nI'm Tester\.\nThe people I deal with most: Dan Ruiz\./.test(m.about('nothing here')) && m.personaNames().join() === 'Dan Ruiz', 'About you goes first, line by line, with Memory on')
  m.configure({ trials: { memory: false } })
  ok(m.about('nothing here') === '' && !m.personaNames().length, 'and not with Memory off')
}

// ---------- A server, Memory off and then on ----------
const model = await startModel('memory')
const me = 'Tester'
const meetingIn = (data, id, { title, when, seconds = 1800, people = [], lines = [], summary }) => {
  const d = path.join(data, 'meetings', id)
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'meeting.json'), JSON.stringify({ id, title, status: 'done', kind: 'general', startedAt: when, endedAt: new Date(Date.parse(when) + seconds * 1000).toISOString(), seconds, call: 'on', event: { title, attendees: people } }, null, 2))
  if (lines.length) fs.writeFileSync(path.join(d, 'transcript.jsonl'), lines.map(([src, t0, text]) => JSON.stringify({ src, t0, t1: t0 + 5, text, engine: 'test' })).join('\n') + '\n')
  if (summary) fs.writeFileSync(path.join(d, 'summary.md'), summary)
}
const term = (t, more = {}) => ({ id: Math.random().toString(16).slice(2, 10), term: t, heard: [], note: '', source: 'learned', seen: (more.meetings || []).length, meetings: [], updatedAt: ago(2), ...more })
// Made-up names only. A memory as months of summaries leave it: people, a customer, your company
// and your project, and what shouldn't be there (a country, a day, a title, a language, a term from
// one meeting long ago), two written alike, a first name and the whole one.
const TERMS = [
  term('Priya Shah', { note: 'head of data at Northwind', noteBy: 'you', meetings: ['n1', 'n2'] }),
  term('Priya', { meetings: ['n3'] }),
  term('Northwind', { note: 'customer, buys the enterprise plan', meetings: ['n1', 'n2', 'n3'] }),
  term('Atlas', { source: 'you', kind: 'project', kindBy: 'you', note: 'our billing app', meetings: ['a1'] }),
  term('Acme', { source: 'you', heard: ['ack me'], note: 'my company', meetings: ['n1'] }),
  term('Mia Chen', { meetings: ['n2'] }),
  term('India', { meetings: ['n1'] }),
  term('Monday', { meetings: ['n2'] }),
  term('CEO', { meetings: ['n3'] }),
  term('German', { meetings: ['n2'] }),
  term('Kanban board', { meetings: ['old'], updatedAt: ago(60) }),
  term('Open AI', { meetings: ['n2'] }),
  term('OpenAI', { meetings: ['a1'] }),
  term('Jordan', { kind: 'person', meetings: ['n3'] }),
  term('Spain', { heard: ['spane'], meetings: ['n3'] }),
]
const seed = ({ data }) => {
  fs.mkdirSync(path.join(data, 'meetings'), { recursive: true })
  fs.writeFileSync(path.join(data, 'meetings', 'memory.json'), JSON.stringify({ terms: TERMS }, null, 2))
  const people = ['Priya Shah <priya.shah@example.com>', 'Mia Chen', 'Dan Ruiz', 'Tester']
  meetingIn(data, 'n1', { title: 'Northwind weekly', when: ago(21), people, lines: [['you', 0, 'Morning, how is the rollout?'], ['them', 6, 'Fine, India signed on Monday.']] })
  meetingIn(data, 'n2', { title: 'Northwind weekly', when: ago(14), people, lines: [['you', 0, 'Any news?'], ['them', 6, 'Open AI pricing came up.']] })
  meetingIn(data, 'n3', { title: 'Northwind weekly', when: ago(7), people, lines: [['you', 0, 'Over to you, Priya.'], ['them', 6, 'The CEO wants it by Q3.']] })
  meetingIn(data, 'a1', { title: 'Atlas planning', when: ago(3), people: ['Mia Chen', 'Tester'], lines: [['you', 0, 'Atlas ships the invoices next.'], ['them', 6, 'Priya will check the numbers.']] })
  meetingIn(data, 'old', { title: 'Old offsite', when: ago(70), people: ['Tester'] })
  return {}
}
const kit = await startKit('memory', { env: seed })
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const pages = []
const real = withoutCutOff
const chiefFile = () => path.join(kit.data, 'chief', 'about-you.md')
const read = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
const summaryOf = async (id) => {
  const n = model.asked(/Write meeting notes in Markdown/).length
  await api(`/meetings/${id}/summary`, {})
  return (await until(() => model.asked(/Write meeting notes in Markdown/).slice(n)[0], 15000)) || ''
}
const tidied = async (text) => {
  const n = model.requests().length
  await api('/dictation/tidy', { text }).catch(() => {})
  return JSON.stringify(model.requests().slice(n))
}

try {
  await api('/setup', { name: me })
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  // Meeting Insights off to start with (it would turn itself on at the fifth meeting).
  await api('/settings', { meetings: { engine: 'openai', model: 'openai:gpt-5', autoSummary: false, cleanup: false }, dictation: { tidyModel: 'openai:gpt-5' }, trials: { 'dictation-cleanup': true, 'meeting-insights': false } }, 'PATCH')
  // A dictation from before Memory was on.
  await api('/dictations', { text: 'Send the Atlas numbers to Priya Shah before the Northwind call', ms: 2400 })

  // ---------- Off ----------
  const off = await api('/memory').then(() => null, (e) => e)
  ok(off?.status === 404 && /Memory is a beta feature\. Turn it on in Settings › About & Updates › Beta Features/.test(off.message), 'off: its routes answer 404 saying how to turn it on', off?.message)
  const before = (await api('/meetings/memory')).terms
  ok(before.length === TERMS.length && before.some((x) => x.term === 'India'), 'meeting memory\'s own routes are as they were')
  let s0 = await summaryOf('a1')
  ok(!/About me, from my memory/.test(s0) && /Atlas: our billing app/.test(s0), 'the notes get memory\'s names and not About you', s0.slice(0, 600))
  ok(!/Names this person often says/.test(await tidied('um send it to priya shah')), 'nor does tidying')
  const desk = await page(b, kit.url, { mode: 'light' })
  pages.push(desk)
  const p = desk.p
  await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).first().click()
  await p.locator('.mt-view .pane-head button.btn', { hasText: 'Memory' }).click()
  ok(!!(await until(() => p.locator('.mt-dialog[aria-label="Meeting memory"]').count(), 8000)) && !(await p.locator('.rail-nav-btn', { hasText: /^\s*Memory\s*$/ }).count()), 'off: Meetings\' Memory is its dialog, and the sidebar has no Memory')
  await p.keyboard.press('Escape')

  // ---------- On ----------
  await api('/settings', { trials: { memory: true } }, 'PATCH')
  ok(!!(await until(() => p.locator('.rail-nav-btn', { hasText: /^\s*Memory\s*$/ }).count(), 8000)), 'on: Memory is in the sidebar at once')
  const order = await p.locator('.rail-nav .rail-nav-btn').allInnerTexts()
  ok(order.findIndex((x) => /Memory/.test(x)) === order.findIndex((x) => /Dictations/.test(x)) + 1, 'under Dictations, the two it learns from above it', order)
  // A dictation once it's on.
  await api('/dictations', { text: 'Ask open-ai about the Atlas invoice', ms: 1800 })
  let v = await until(async () => { const r = await api('/memory'); const atlas = r.terms.find((x) => x.term === 'Atlas'); return atlas?.dictations.length === 2 ? r : null }, 8000)
  const by = (n) => v.terms.find((x) => x.term === n)
  ok(!!v, 'the dictations, from before Memory was on and since, are on the names they say', v?.terms.map((x) => [x.term, x.dictations.length]))
  ok(by('Priya Shah').kind === 'person' && by('Priya Shah').guessed && by('Northwind').kind === 'org' && by('Acme').kind === 'org' && by('Atlas').kind === 'project' && !by('Atlas').guessed && by('Kanban board').kind === 'term' && by('Jordan').kind === 'person' && by('Open AI').dictations.length === 1,
    'each one\'s kind: yours, a summary\'s, or a guess from the invites and its note', v.terms.map((x) => [x.term, x.kind, x.guessed]))
  const why = Object.fromEntries(v.little.map((x) => [v.terms.find((t) => t.id === x.id).term, x.why]))
  ok(JSON.stringify(Object.entries(why).sort()) === JSON.stringify(Object.entries({ India: 'place', Monday: 'time', CEO: 'common', German: 'language', 'Kanban board': 'once' }).sort()), 'what looks like it adds little, with why: not yours, a person or one with a mishearing', why)
  const pairs = v.same.map(([a, c]) => `${v.terms.find((t) => t.id === a).term}|${v.terms.find((t) => t.id === c).term}`)
  ok(pairs.includes('Priya Shah|Priya') && pairs.some((x) => /^(Open AI\|OpenAI|OpenAI\|Open AI)$/.test(x)) && pairs.length === 2, 'what looks the same: written alike, and a first name with the whole one (kept first)', pairs)
  const draft = v.aboutYou.text
  ok(v.aboutYou.on && !v.aboutYou.yours && /^I'm Tester, at Acme\.$/m.test(draft) && /^What I work on: Atlas \(our billing app\)\.$/m.test(draft) && /^The people I deal with most: Priya Shah \(head of data at Northwind\)/m.test(draft) && /^The organizations I deal with most: Northwind \(customer, buys the enterprise plan\)/m.test(draft) && !/India|Monday/.test(draft),
    'About You made from it: your name and company, your work, the people and organizations most', draft)
  ok(!!(await until(() => read(chiefFile())?.includes(draft), 5000)) && /# About Tester\n\nWhat Bridge AI knows about Tester, made on this computer/.test(read(chiefFile())), 'and it\'s in Chief of Staff\'s folder', read(chiefFile()))
  const chiefMd = read(path.join(kit.data, 'chief', 'CLAUDE.md')) || ''
  ok(/When there's an `about-you\.md` in this folder/.test(chiefMd), 'which Chief of Staff is told to read', chiefMd.slice(0, 300))
  s0 = await summaryOf('a1')
  ok(s0.includes(`About me, from my memory in Bridge AI:\n${draft}`), 'the model writing notes is given it', s0.slice(0, 900))
  const tidy0 = await tidied('um send it to priya shah')
  ok(/Names this person often says, spelled the way they write them[^"]*Acme, Atlas, Priya Shah/.test(tidy0), 'and the one tidying dictation, the names in it', tidy0.slice(0, 600))

  // ---------- In the app ----------
  await p.locator('.rail-nav-btn', { hasText: /^\s*Memory\s*$/ }).click()
  const home = p.locator('.mm-home')
  ok(!!(await until(() => home.locator('.mm-you .mm-you-text').count(), 10000)) && (await home.locator('.mm-you .mm-you-text').innerText()).includes('Priya Shah (head of data at Northwind)'), 'the page: About You first, as it was made')
  const counts = Object.fromEntries(await home.locator('.mm-colls button').evaluateAll((bs) => bs.map((x) => [x.dataset.coll, Number(x.querySelector('.num').textContent)])))
  ok(counts.all === TERMS.length && counts.person === 3 && counts.org === 2 && counts.project === 1, 'the collections, each with how many', counts)
  await shot(p, `${tag}memory-light`)
  // The tidy-up: German kept, the rest out.
  await home.locator('.mm-tidy button', { hasText: 'Look them over' }).click()
  ok((await home.locator('.mm-tidy-row').count()) === 5 && /A place/.test(await home.locator('.mm-tidy-row[data-term="India"]').innerText()), 'the tidy-up: each with why', await home.locator('.mm-tidy').innerText())
  await home.locator('.mm-tidy-row[data-term="German"] input').uncheck()
  await shot(p, `${tag}memory-tidy`)
  await home.locator('.mm-tidy button', { hasText: 'Take out 4, keep the rest' }).click()
  ok(!!(await until(async () => !(await home.locator('.mm-tidy').count()), 8000)), 'taken out, and nothing left to look over')
  v = await api('/memory')
  ok(!['India', 'Monday', 'CEO', 'Kanban board'].some((n) => v.terms.some((x) => x.term === n)) && v.terms.find((x) => x.term === 'German')?.keep === true && !v.little.length, 'the four gone, German kept and not offered again')
  // The same: Priya under her whole name, the two OpenAIs kept apart.
  await home.locator('.mm-same button', { hasText: 'Look them over' }).click()
  await home.locator('.mm-same-row[data-pair="Priya Shah|Priya"] button', { hasText: 'Keep "Priya Shah"' }).click()
  await until(async () => (await home.locator('.mm-same-row').count()) === 1, 8000)
  await home.locator('.mm-same-row button', { hasText: 'Not the same' }).click()
  ok(!!(await until(async () => !(await home.locator('.mm-same').count()), 8000)), 'merged and kept apart, and nothing left that looks the same')
  v = await api('/memory')
  const priya = v.terms.find((x) => x.term === 'Priya Shah')
  ok(!v.terms.some((x) => x.term === 'Priya') && priya.also.includes('Priya') && priya.meetings.includes('n3') && !v.same.length, 'Priya Shah has Priya\'s meeting, and Priya as another way she\'s written', priya)
  // A search, then a kind changed.
  await home.locator('.mm-find input').fill('open')
  ok(!!(await until(async () => (await home.locator('.mm-item').count()) === 2, 5000)), 'a search finds the two OpenAIs')
  await home.locator('.mm-item[data-term="OpenAI"] .mm-pen').click()
  await home.locator('.mm-edit select').selectOption('org')
  await home.locator('.mm-edit button', { hasText: 'Done' }).click()
  ok(!!(await until(async () => (await home.locator('.mm-item[data-term="OpenAI"] .mm-kind').innerText().catch(() => '')) === 'Organization' && !(await home.locator('.mm-item[data-term="OpenAI"] .mm-kind.guess').count()), 8000)), 'a kind changed is yours, no longer a guess')
  await home.locator('.mm-find input').fill('')
  // A dictation opened from a name.
  await home.locator('.mm-colls button[data-coll="project"]').click()
  await home.locator('.mm-item[data-term="Atlas"] .mm-from').click()
  ok(/1 meeting · 2 dictations/.test(await home.locator('.mm-item[data-term="Atlas"] .mm-from').innerText()), 'a name says where it came from')
  await home.locator('.mm-item[data-term="Atlas"] .mm-dict', { hasText: 'invoice' }).click()
  ok(!!(await until(() => p.locator('.dc-row.open', { hasText: 'Ask open-ai about the Atlas invoice' }).count(), 8000)), 'and a dictation opens from it, in Dictations')
  // About You, in your words, then off and on.
  await p.locator('.rail-nav-btn', { hasText: /^\s*Memory\s*$/ }).click()
  await home.locator('.mm-you button', { hasText: 'Edit' }).click()
  await home.locator('.mm-you textarea').fill('I lead billing at Acme. Atlas is mine.')
  await home.locator('.mm-you button', { hasText: 'Save' }).click()
  ok(!!(await until(async () => /As you wrote it/.test(await home.locator('.mm-you').innerText()) && /I lead billing at Acme/.test(await home.locator('.mm-you-text').innerText()), 8000)), 'About You in your own words, said so')
  ok(!!(await until(() => /as Tester wrote it[\s\S]*I lead billing at Acme/.test(read(chiefFile()) || ''), 5000)), 'Chief of Staff\'s copy too')
  s0 = await summaryOf('a1')
  ok(s0.includes('About me, from my memory in Bridge AI:\nI lead billing at Acme. Atlas is mine.'), 'and the notes', s0.slice(0, 400))
  await home.locator('.mm-you .mm-switch input').uncheck()
  ok(!!(await until(async () => /Off: no model and not Chief of Staff is given it/.test(await home.locator('.mm-you').innerText()), 8000)), 'switched off, it says so')
  ok(!!(await until(() => read(chiefFile()) === null, 5000)), 'Chief of Staff\'s copy is gone')
  s0 = await summaryOf('a1')
  ok(!/About me, from my memory/.test(s0) && !/Names this person often says/.test(await tidied('um send it to priya shah')), 'and neither model is given it', s0.slice(0, 300))
  await home.locator('.mm-you .mm-switch input').check()
  await until(async () => /While it's on/.test(await home.locator('.mm-you').innerText()), 8000)
  // People: with Meeting Insights off it says what's missing; on, the people you meet, one kept.
  await home.locator('.mm-colls button[data-coll="person"]').click()
  ok(/Only the people memory has are here/.test(await home.locator('.mm-note').innerText().catch(() => '')), 'People, with Meeting Insights off: what it would add')
  await api('/settings', { trials: { 'meeting-insights': true } }, 'PATCH')
  await p.reload()
  await home.locator('.mm-colls button[data-coll="person"]').click()
  ok(!!(await until(() => home.locator('.mm-met-row[data-person="Dan Ruiz"]').count(), 10000)) && !(await home.locator('.mm-met-row[data-person="Priya Shah"]').count()), 'on: the people you meet that memory doesn\'t have', await home.locator('.mm-met').innerText().catch(() => ''))
  await home.locator('.mm-met-row[data-person="Dan Ruiz"] button').click()
  ok(!!(await until(async () => (await home.locator('.mm-item[data-term="Dan Ruiz"]').count()) && !(await home.locator('.mm-met-row[data-person="Dan Ruiz"]').count()), 8000)), 'one kept in memory, as a person')
  const dan = (await api('/memory')).terms.find((x) => x.term === 'Dan Ruiz')
  ok(dan?.kind === 'person' && ['n1', 'n2', 'n3'].every((x) => dan.meetings.includes(x)), 'with the meetings you met in', dan)
  await home.locator('.mm-colls button[data-coll="all"]').click()
  await shot(p, `${tag}memory-after`)
  // Meetings' Memory, and Settings › Meetings, open the page.
  await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).first().click()
  await p.locator('.mt-view .pane-head button.btn', { hasText: 'Memory' }).click()
  ok(!!(await until(async () => (await home.isVisible()) && !(await p.locator('.mt-dialog').count()), 8000)), 'on: Meetings\' Memory opens the page, not the dialog')
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'meetings' } })))
  await p.locator('.modal.settings button', { hasText: 'Open Memory' }).click()
  ok(!!(await until(async () => (await home.isVisible()) && !(await p.locator('.modal.settings').count()), 8000)), 'and Settings › Meetings\' Open Memory, closing Settings')
  ok(!real(desk.errors).length, 'no page errors', desk.errors)

  // ---------- Dark, and phones ----------
  const dark = await page(b, kit.url, { mode: 'dark', store: { 'cc-mm-coll': 'person' } })
  pages.push(dark)
  await dark.p.locator('.rail-nav-btn', { hasText: /^\s*Memory\s*$/ }).click()
  await until(() => dark.p.locator('.mm-home .mm-item').count(), 10000)
  await shot(dark.p, `${tag}memory-dark`)
  ok(!real(dark.errors).length, 'dark: no page errors', dark.errors)
  for (const [w, mode] of [[375, 'light'], [430, 'dark']]) {
    const ph = await page(b, kit.url, { mode, phone: true })
    pages.push(ph)
    await ph.p.setViewportSize({ width: w, height: 844 })
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    await ph.p.locator('.m-more-row[data-id="memory"]').click()
    ok(!!(await until(() => ph.p.locator('.mm-home .mm-you').count(), 10000)), `${w} px: Memory from More`)
    await shot(ph.p, `${tag}memory-phone-${w}-${mode}`)
    await ph.p.locator('.mm-item').first().scrollIntoViewIfNeeded()
    await ph.p.locator('.mm-item[data-term="Priya Shah"] .mm-from').click()
    let faults = await phoneFaults(ph.p, '.mm-view')
    ok(!Object.keys(faults).length, `${w} px: it fits, every target whole`, faults)
    await shot(ph.p, `${tag}memory-phone-${w}-${mode}-names`)
    await ph.p.locator('.mm-item .mm-pen').first().click()
    faults = await phoneFaults(ph.p, '.mm-view')
    ok(!Object.keys(faults).length, `${w} px: and editing one, with fields that don't zoom`, faults)
    ok(!real(ph.errors).length, `${w} px: no page errors`, ph.errors)
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const w of pages) await w.ctx.close().catch(() => {})
  await b.close()
  kit.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
