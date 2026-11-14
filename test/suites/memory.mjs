// Memory, a page in Meetings and in Dictations for everyone, in the browser named by BRIDGE_TEST_BROWSER.
// First what meeting memory keeps (server/meetmemory.js, in this process, on a folder of its own): a
// summary's names by kind, leaving out places, languages, days, months and everyday words (in other
// languages' words too), a first name alone, and a name speech to text spelled right by itself that
// nothing more is known about; keeping a person's whole name, a name the invite has, one that was
// misheard and one a meeting says who or what it is; the older form of the block (names) still read.
// The names memory has, said in a dictation (any case, a hyphen for a space), get that dictation, and
// nothing new comes from one; a dictation gone is taken off. Two merged: one name, the other kept as
// another way it's written, that a summary then finds it by. About You first in what a model is
// told, and not once it's switched off.
//
// Then a server whose settings still have Memory's old beta switch, off, and a memory with a bit of
// everything in it: no such beta feature (not in /config, not in Beta Features), its routes answer,
// and meeting memory's own routes are as they were. Each name's kind (yours, or a guess from an invite or its note), the dictations it came up in (one
// kept before memory was first looked at and one after), what looks the same, what looks like it
// adds little and why (never yours, a person or a name with a mishearing), and About You made from
// it, on without being asked (your name and organization, what you work on, the people and
// organizations you deal with most), in Chief of Staff's folder too. The model writing notes and
// the one tidying dictation are given it (the names, for tidying); yours once you write it; off,
// neither is, and Chief of Staff's copy is gone.
//
// In the app, light and dark at 1440: nothing of Memory in the sidebar, wide or folded down, nor in
// the phone's More. Meetings' Memory tab, a page in Meetings: what came up in meetings and the names
// you added, the one only said in a dictation left out, the collections and the search at the top
// with About You (made from all of memory, it says) beside them, their counts; All memory and back,
// the counts following; a search that finds nothing here saying all of memory has it, with the way
// there. The tidy-up looked over with one kept and the rest taken out, a pair merged under the name
// picked and one kept apart, a kind changed, a dictation opened from a name, About You edited and
// switched off and on, Meetings and Memory's collection kept across a reload, from meetings again;
// People with the people you meet (Meeting Insights on), one kept in memory, and nothing of it with
// it off. Dictations' Memory tab: what came up in dictations and yours, A to Z, no people you meet,
// All memory with them, and from dictations again from its tab. Every way in opens a page, never a
// dialog: Meetings' tab and a meeting's menu at its own, ⌘K, Settings › Voice & Meetings and a tab kept from
// when Memory was a page of its own at all of it. A window showing another computer (Desk, its own
// server, reached at /m/desk/ as Bridge AI does): Desk's memory, said to be Desk's; each computer
// keeping its own Meetings at Memory and collection as the window goes from one to the other; Desk
// away, said, with Try again. On 375 and 430 px phones in the Meetings tab, Meetings' and
// Dictations': nothing wider than the phone, every target whole, and still Memory after a reload; a
// phone left at More's old Memory row lands there too.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startModel, checks, until, browser, page, shot, phoneFaults, withoutCutOff, changeAnswer, noServiceWorker, OUT, ROOT } from '../lib/harness.mjs'

const { ok, done } = checks('memory')
const DAY = 864e5
const ago = (days) => new Date(Date.now() - days * DAY).toISOString()

// ---------- What memory keeps, in this process ----------
{
  const home = path.join(OUT, 'kits', `memory-unit-${process.pid}`)
  fs.rmSync(home, { recursive: true, force: true })
  process.env.BRIDGE_HOME = home
  const m = await import('../../server/meetmemory.js')
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
  ok(/^About me, from my memory in Bridge AI:\nI'm Tester\.\nThe people I deal with most: Dan Ruiz\./.test(m.about('nothing here')) && m.personaNames().join() === 'Dan Ruiz', 'About you goes first, line by line, with nothing to turn on')
  m.setAboutYou({ on: false })
  ok(m.about('nothing here') === '' && !m.personaNames().length, 'and not once it\'s switched off')
}

// ---------- A server, its settings from when Memory was a beta feature ----------
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
  // Yours, from no meeting or dictation yet; and one only ever said in a dictation.
  term('SKU sync', { source: 'you', heard: ['skew sink'] }),
  term('Tailspin', { note: 'customer, buys the starter plan' }),
]
const FROM_MEETINGS = TERMS.filter((x) => x.meetings.length || x.source === 'you').length
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
// Settings from a computer that had Memory's beta switch, and turned it off.
const kit = await startKit('memory', { env: seed, config: { trials: { memory: false } } })
// Another computer, Desk, with a memory of its own.
const desk = await startKit('memory-desk', {
  env: ({ data }) => {
    fs.mkdirSync(path.join(data, 'meetings'), { recursive: true })
    fs.writeFileSync(path.join(data, 'meetings', 'memory.json'), JSON.stringify({ terms: [term('Kestrel', { source: 'you', kind: 'project', note: 'our robot arm' }), term('Fabrikam', { note: 'customer, buys the arms' })] }, null, 2))
    return {}
  },
})
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
// Which tab is in front, Meetings' view, which memory and collection are picked, and how many each
// collection says it has.
const front = (p) => p.locator('.ws-tab.main').first().getAttribute('data-pane', { timeout: 1000 }).catch(() => null)
const meetView = (p) => p.locator('.mt-view .pane-head .seg button[aria-selected="true"]').first().getAttribute('data-view', { timeout: 1000 }).catch(() => null)
const picked = (p) => p.locator('.mm-colls button[aria-selected="true"]').first().getAttribute('data-coll', { timeout: 1000 }).catch(() => null)
const scope = (where) => where.locator('.mm-scope button[aria-selected="true"]').first().getAttribute('data-scope', { timeout: 1000 }).catch(() => null)
const countsIn = (where) => where.locator('.mm-colls button').evaluateAll((bs) => Object.fromEntries(bs.map((x) => [x.dataset.coll, Number(x.querySelector('.num').textContent)])))
const termsIn = (where) => where.locator('.mm-item').evaluateAll((xs) => xs.map((x) => x.dataset.term))

try {
  await api('/setup', { name: me })
  await desk.api('/setup', { name: me })
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  // Meeting Insights off to start with (it would turn itself on at the fifth meeting).
  await api('/settings', { meetings: { engine: 'openai', model: 'openai:gpt-5', autoSummary: false, cleanup: false }, dictation: { tidyModel: 'openai:gpt-5' }, trials: { 'dictation-cleanup': true, 'meeting-insights': false } }, 'PATCH')
  // A dictation from before memory is first looked at.
  await api('/dictations', { text: 'Send the Atlas numbers to Priya Shah before the Northwind call', ms: 2400 })

  // ---------- For everyone ----------
  const conf = await api('/config')
  ok(!('memory' in conf.trials) && JSON.parse(fs.readFileSync(path.join(kit.data, 'config.json'), 'utf8')).trials?.memory === false, 'no beta feature: /config has no such trial, though these settings still say it was off', conf.trials)
  let v = await api('/memory')
  ok(v.terms.length === TERMS.length, 'its routes answer all the same')
  const before = (await api('/meetings/memory')).terms
  ok(before.length === TERMS.length && before.some((x) => x.term === 'India'), 'meeting memory\'s own routes are as they were')
  const deskPage = await page(b, kit.url, { mode: 'light' })
  pages.push(deskPage)
  const p = deskPage.p
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
  const betas = p.locator('.modal.settings .st-sec', { has: p.locator('h4', { hasText: 'Beta Features' }) })
  await betas.locator('.st-check').first().waitFor({ timeout: 8000 })
  const listed = (await betas.locator('.st-check b').allInnerTexts()).map((x) => x.trim())
  ok(listed.includes('Studio') && !listed.includes('Memory'), 'and Beta Features doesn\'t list it', listed)
  await p.keyboard.press('Escape')
  await until(async () => !(await p.locator('.modal.settings').count()), 5000)
  // Dictations after: one with a name only ever said in dictations.
  await api('/dictations', { text: 'Ask open-ai about the Atlas invoice', ms: 1800 })
  await api('/dictations', { text: 'Call Tailspin about their renewal', ms: 1500 })
  v = await until(async () => { const r = await api('/memory'); const atlas = r.terms.find((x) => x.term === 'Atlas'); return atlas?.dictations.length === 2 && r.terms.find((x) => x.term === 'Tailspin')?.dictations.length === 1 ? r : null }, 8000)
  const by = (n) => v.terms.find((x) => x.term === n)
  ok(!!v, 'the dictations, from before memory was first looked at and since, are on the names they say', v?.terms.map((x) => [x.term, x.dictations.length]))
  // What each place shows to start with: what came up there, and the names you added.
  const FROM_DICTATIONS = v.terms.filter((x) => x.dictations.length || x.source === 'you').length
  ok(by('Priya Shah').kind === 'person' && by('Priya Shah').guessed && by('Northwind').kind === 'org' && by('Acme').kind === 'org' && by('Atlas').kind === 'project' && !by('Atlas').guessed && by('Kanban board').kind === 'term' && by('Jordan').kind === 'person' && by('Open AI').dictations.length === 1,
    'each one\'s kind: yours, a summary\'s, or a guess from the invites and its note', v.terms.map((x) => [x.term, x.kind, x.guessed]))
  const why = Object.fromEntries(v.little.map((x) => [v.terms.find((t) => t.id === x.id).term, x.why]))
  ok(JSON.stringify(Object.entries(why).sort()) === JSON.stringify(Object.entries({ India: 'place', Monday: 'time', CEO: 'common', German: 'language', 'Kanban board': 'once' }).sort()), 'what looks like it adds little, with why: not yours, a person or one with a mishearing', why)
  const pairs = v.same.map(([a, c]) => `${v.terms.find((t) => t.id === a).term}|${v.terms.find((t) => t.id === c).term}`)
  ok(pairs.includes('Priya Shah|Priya') && pairs.some((x) => /^(Open AI\|OpenAI|OpenAI\|Open AI)$/.test(x)) && pairs.length === 2, 'what looks the same: written alike, and a first name with the whole one (kept first)', pairs)
  const draft = v.aboutYou.text
  ok(v.aboutYou.on && !v.aboutYou.yours && /^I'm Tester, at Acme\.$/m.test(draft) && /^What I work on: Atlas \(our billing app\)\.$/m.test(draft) && /^The people I deal with most: Priya Shah \(head of data at Northwind\)/m.test(draft) && /^The organizations I deal with most: Northwind \(customer, buys the enterprise plan\)/m.test(draft) && !/India|Monday/.test(draft),
    'About You made from it, and on without being asked: your name and company, your work, the people and organizations most', draft)
  ok(!!(await until(() => read(chiefFile())?.includes(draft), 5000)) && /# About Tester\n\nWhat Bridge AI knows about Tester, made on this computer/.test(read(chiefFile())), 'and it\'s in Chief of Staff\'s folder', read(chiefFile()))
  const chiefMd = read(path.join(kit.data, 'chief', 'CLAUDE.md')) || ''
  ok(/When there's an `about-you\.md` in this folder/.test(chiefMd), 'which Chief of Staff is told to read', chiefMd.slice(0, 300))
  let s0 = await summaryOf('a1')
  ok(s0.includes(`About me, from my memory in Bridge AI:\n${draft}`) && /Atlas: our billing app/.test(s0), 'the model writing notes is given it, with memory\'s names', s0.slice(0, 900))
  const tidy0 = await tidied('um send it to priya shah')
  ok(/Names this person often says, spelled the way they write them[^"]*Acme, Atlas, Priya Shah/.test(tidy0), 'and the one tidying dictation, the names in it', tidy0.slice(0, 600))

  // ---------- In the app ----------
  // Nothing of Memory in the sidebar, wide or folded down: it's a tab of Meetings and of Dictations.
  // (Dictations shows there once the sidebar has heard there's one.)
  await until(() => p.locator('.rail-nav-btn', { hasText: 'Dictations' }).count(), 8000)
  const rows = await p.locator('.rail-nav .rail-nav-btn').allInnerTexts()
  ok(rows.some((x) => /Meetings/.test(x)) && rows.some((x) => /Dictations/.test(x)) && !rows.some((x) => /Memory/.test(x)), 'nothing of Memory in the sidebar', rows)
  await p.locator('.rail-btn').click()
  await p.waitForSelector('.rail.collapsed', { timeout: 5000 }).catch(() => {})
  const minis = await p.locator('.rail.collapsed .mini-nav').evaluateAll((xs) => xs.map((x) => x.getAttribute('aria-label')))
  ok(minis.includes('Meetings') && minis.includes('Dictations') && !minis.includes('Memory'), 'nor in it folded down', minis)
  await p.locator('.rail-btn').click()
  // Meetings' Memory: a tab beside the list, a page in Meetings.
  await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).first().click()
  await p.locator('.mt-view .pane-head .seg button[data-view="memory"]').click()
  const home = p.locator('.mt-view .mm-page')
  ok(!!(await until(() => home.locator('.mm-you .mm-you-text').count(), 10000)) && (await home.locator('.mm-you .mm-you-text').innerText()).includes('Priya Shah (head of data at Northwind)'), 'Meetings\' Memory, with About You as it was made')
  ok(await front(p) === 'view:meetings' && await meetView(p) === 'memory' && !(await p.locator('.mt-dialog').count()), 'a page in Meetings, not a dialog', { front: await front(p), view: await meetView(p) })
  // What came up in meetings, and yours: not the one only said in a dictation.
  ok(await scope(home) === 'here' && /From meetings/.test(await home.locator('.mm-scope button[data-scope="here"]').innerText()), 'from meetings to start with', await home.locator('.mm-bar').innerText().catch(() => ''))
  let shownNow = await termsIn(home)
  ok(!shownNow.includes('Tailspin') && shownNow.includes('SKU sync') && shownNow.includes('Kanban board'), 'what came up in meetings and the names you added; not one only said in a dictation', shownNow)
  ok((await home.locator('.mm-bar .mm-count').innerText()).trim() === `${FROM_MEETINGS} of ${TERMS.length} names · On this computer`, 'how many of all of them, and whose', await home.locator('.mm-bar .mm-count').innerText())
  ok(/Made from all your memory/.test(await home.locator('.mm-you').innerText()), 'About You says it\'s made from all of memory', await home.locator('.mm-you').innerText())
  // The first screen: which memory along the top, the collections and the search under it, About
  // You and what to look over beside them, the explanation out of the way.
  const box = async (sel) => home.locator(sel).first().boundingBox()
  const [bar, tools, you, looks, how] = [await box('.mm-bar'), await box('.mm-tools'), await box('.mm-you'), await box('.mm-looks'), await box('.mm-how')]
  const pane = await p.locator('.mt-view .mm-view').boundingBox()
  ok(bar.y - pane.y < 30 && tools.y - pane.y < 100 && you.x >= tools.x + tools.width && Math.abs(you.y - tools.y) < 40 && looks.y + looks.height < pane.y + pane.height && how.y > looks.y && (await home.locator('.mm-item').count()) > 0 && (await home.locator('.mm-item').first().boundingBox()).y < pane.y + 290,
    'the first screen: which memory at the top, the collections and the search under it, the names right under them, About You and what to look over beside them, and the explanation after those', { bar, tools, you, looks, how, pane })
  ok(you.height < 360 && (await home.locator('.mm-look').evaluateAll((xs) => xs.every((x) => x.getBoundingClientRect().height < 70))), 'About You and what to look over each compact', { you: you.height })
  let counts = await countsIn(home)
  ok(counts.all === FROM_MEETINGS && counts.person === 3 && counts.org === 2 && counts.project === 1 && counts.term === FROM_MEETINGS - 6, 'the collections, each with how many came up in meetings or are yours', counts)
  await shot(p, `${tag}memory-light`)
  // All memory, the counts following, and back.
  await home.locator('.mm-scope button[data-scope="all"]').click()
  ok(!!(await until(async () => (await scope(home)) === 'all' && (await termsIn(home)).includes('Tailspin'), 5000)), 'All memory: the one only said in a dictation too')
  counts = await countsIn(home)
  ok(counts.all === TERMS.length && counts.org === 3 && counts.person === 3 && (await home.locator('.mm-bar .mm-count').innerText()).trim() === `${TERMS.length} names · On this computer` && /Made from memory/.test(await home.locator('.mm-you').innerText()), 'and the counts follow', counts)
  await shot(p, `${tag}memory-light-all`)
  await home.locator('.mm-scope button[data-scope="here"]').click()
  ok(!!(await until(async () => (await countsIn(home)).all === FROM_MEETINGS && !(await termsIn(home)).includes('Tailspin'), 5000)), 'and back to what came up in meetings')
  // A search that finds nothing here: said, with all of memory having it and the way there.
  await home.locator('.mm-find input').fill('tailspin')
  ok(!!(await until(async () => /Nothing from meetings matches "tailspin"\. All memory has one\./.test(await home.locator('.mm-none').innerText().catch(() => '')), 5000)), 'a search with nothing from meetings says all of memory has it', await home.locator('.mm-none').innerText().catch(() => ''))
  await home.locator('.mm-none button', { hasText: 'Show all memory' }).click()
  ok(!!(await until(async () => (await scope(home)) === 'all' && (await termsIn(home)).join() === 'Tailspin', 5000)), 'and Show all memory finds it')
  await home.locator('.mm-find input').fill('')
  await home.locator('.mm-scope button[data-scope="here"]').click()
  // The tidy-up: German kept, the rest out.
  await home.locator('.mm-tidy button', { hasText: 'Review' }).click()
  ok((await home.locator('.mm-tidy-row').count()) === 5 && /A place/.test(await home.locator('.mm-tidy-row[data-term="India"]').innerText()), 'the tidy-up: each with why', await home.locator('.mm-tidy').innerText())
  await home.locator('.mm-tidy-row[data-term="German"] input').uncheck()
  await shot(p, `${tag}memory-tidy`)
  await home.locator('.mm-tidy button', { hasText: 'Remove 4, keep the rest' }).click()
  ok(!!(await until(async () => !(await home.locator('.mm-tidy').count()), 8000)), 'taken out, and nothing left to look over')
  v = await api('/memory')
  ok(!['India', 'Monday', 'CEO', 'Kanban board'].some((n) => v.terms.some((x) => x.term === n)) && v.terms.find((x) => x.term === 'German')?.keep === true && !v.little.length, 'the four gone, German kept and not offered again')
  // The same: Priya under her whole name, the two OpenAIs kept apart.
  await home.locator('.mm-same button', { hasText: 'Review' }).click()
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
  ok(!!(await until(() => p.locator('.dc-row.open', { hasText: 'Ask open-ai about the Atlas invoice' }).count(), 8000)), 'and a dictation opens from it, in Dictations\' list')
  // About You, in your words, then off and on. (Meetings, from the sidebar: at Memory, as it was left.)
  await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).first().click()
  ok(!!(await until(async () => await meetView(p) === 'memory' && await picked(p) === 'project', 5000)), 'Meetings again, from the sidebar: at Memory, as it was left')
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
  // Where it goes, as it goes: with what every model for meetings is told (memory.about() is in each),
  // said the same on the page and in PRIVACY.md.
  const says = await home.locator('.mm-you').innerText()
  ok(/the models you use for meetings \(notes, Who spoke, cleanup, AI Assist and your questions\) and the one that tidies your dictation/.test(says) && /goes with what the models\s+you use for meetings are told/.test(fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8')), 'About You says where it goes, every model for meetings and the one tidying dictation, as PRIVACY.md does', says)
  // At 1280, About You beside the list: each name's Edit stays on its name's line, never on one of its own.
  // (All of them, found by a letter most have, so every group is open.)
  await p.setViewportSize({ width: 1280, height: 800 })
  await home.locator('.mm-colls button[data-coll="all"]').click()
  await home.locator('.mm-find input').fill('a')
  await p.waitForTimeout(500)
  const lines = await home.locator('.mm-item').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height).map((e) => {
    const name = e.querySelector('.mt-mem-what b').getBoundingClientRect(), pen = e.querySelector('.mm-pen').getBoundingClientRect()
    return { term: e.dataset.term, lone: Math.abs((pen.top + pen.bottom) / 2 - (name.top + name.bottom) / 2) > 14 }
  }))
  ok(lines.length >= 5 && !lines.some((x) => x.lone) && !!(await home.locator('.mm-you').isVisible()), '1280 wide, About You beside it: each name\'s Edit on its line, none alone on a line of its own', { n: lines.length, lone: lines.filter((x) => x.lone), you: await home.locator('.mm-you').isVisible() })
  await home.locator('.mm-find input').fill('')
  await p.setViewportSize({ width: 1440, height: 900 })
  // People: with Meeting Insights off (a beta feature) nothing of it shows; on, the people you meet, one kept.
  await home.locator('.mm-colls button[data-coll="person"]').click()
  await home.locator('.mm-colls button[data-coll="person"][aria-selected="true"]').waitFor({ timeout: 5000 }).catch(() => {})
  ok(!(await home.locator('.mm-met').count()) && !/Meeting Insights/i.test(await home.innerText()), 'People, with Meeting Insights off: only the people memory has, and nothing about the beta feature', await home.innerText().catch(() => ''))
  await api('/settings', { trials: { 'meeting-insights': true } }, 'PATCH')
  // All memory picked, then a reload: Meetings in front at Memory and People, from meetings again.
  await home.locator('.mm-scope button[data-scope="all"]').click()
  await until(async () => (await scope(home)) === 'all', 5000)
  await p.reload()
  ok(!!(await until(async () => await front(p) === 'view:meetings' && await meetView(p) === 'memory' && await picked(p) === 'person' && (await scope(home)) === 'here', 10000)), 'a reload keeps Meetings in front at Memory, at the collection it was at, and from meetings again', { front: await front(p), view: await meetView(p), picked: await picked(p), scope: await scope(home) })
  ok(!!(await until(() => home.locator('.mm-met-row[data-person="Dan Ruiz"]').count(), 10000)) && !(await home.locator('.mm-met-row[data-person="Priya Shah"]').count()), 'on: the people you meet that memory doesn\'t have', await home.locator('.mm-met').innerText().catch(() => ''))
  const pv = await api('/memory')
  ok((await countsIn(home)).person === pv.terms.filter((x) => x.kind === 'person').length + pv.people.length, 'counted with the people memory has', { counts: await countsIn(home), people: pv.people.map((x) => x.name) })

  // ---------- Dictations' Memory ----------
  // What came up in dictations and yours, A to Z; no people you meet (they're from meetings) until
  // All memory; from dictations again when it's gone to from its tab. Then back to Meetings'.
  v = await api('/memory')
  const inDicts = v.terms.filter((x) => x.dictations.length || x.source === 'you')
  await p.locator('.rail-nav-btn', { hasText: 'Dictations' }).click()
  await p.locator('.dc-view .pane-head .seg button[data-view="memory"]').click()
  const dm = p.locator('.dc-view .mm-page')
  ok(!!(await until(() => dm.locator('.mm-item').count(), 10000)) && await front(p) === 'view:dictations', 'Dictations\' Memory: a page in Dictations')
  // (At People, as Meetings' was: the collection is the same in both.)
  ok(await picked(p) === 'person', 'at the collection Meetings\' was at', await picked(p))
  await dm.locator('.mm-colls button[data-coll="all"]').click()
  shownNow = await termsIn(dm)
  ok(await scope(dm) === 'here' && /From dictations/.test(await dm.locator('.mm-scope button[data-scope="here"]').innerText()) && shownNow.includes('Tailspin') && shownNow.includes('SKU sync') && shownNow.includes('Atlas') && !shownNow.includes('Mia Chen') && !shownNow.includes('Jordan'),
    'from dictations to start with: what came up in them and the names you added, not what only came up in meetings', shownNow)
  counts = await countsIn(dm)
  ok(counts.all === inDicts.length && counts.person === inDicts.filter((x) => x.kind === 'person').length && counts.org === inDicts.filter((x) => x.kind === 'org').length, 'the counts, of what came up in dictations', { counts, inDicts: inDicts.map((x) => x.term) })
  ok(await dm.locator('.mm-find .seg button[aria-selected="true"]').innerText() === 'A–Z' && (await dm.locator('.mm-you').count()) === 1, 'A to Z to start with, with About You', await dm.locator('.mm-find .seg button[aria-selected="true"]').innerText())
  await dm.locator('.mm-colls button[data-coll="person"]').click()
  ok(!(await dm.locator('.mm-met').count()), 'People: no people you meet, who come from meetings')
  await shot(p, `${tag}memory-dictations`)
  await dm.locator('.mm-scope button[data-scope="all"]').click()
  ok(!!(await until(async () => (await termsIn(dm)).includes('Mia Chen') && (await dm.locator('.mm-met-row[data-person="Dan Ruiz"]').count()) === 1, 5000)), 'All memory: theirs too, and the people you meet')
  await p.locator('.dc-view .pane-head .seg button[data-view="list"]').click()
  await p.locator('.dc-view .pane-head .seg button[data-view="memory"]').click()
  ok(!!(await until(async () => (await scope(dm)) === 'here' && !(await termsIn(dm)).includes('Mia Chen'), 5000)), 'gone to from its tab again: from dictations')
  await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).first().click()
  ok(!!(await until(async () => await meetView(p) === 'memory' && await picked(p) === 'person' && (await scope(home)) === 'here', 5000)), 'Meetings\' Memory as it was, from meetings')

  await home.locator('.mm-met-row[data-person="Dan Ruiz"] button').click()
  ok(!!(await until(async () => (await home.locator('.mm-item[data-term="Dan Ruiz"]').count()) && !(await home.locator('.mm-met-row[data-person="Dan Ruiz"]').count()), 8000)), 'one kept in memory, as a person')
  const dan = (await api('/memory')).terms.find((x) => x.term === 'Dan Ruiz')
  ok(dan?.kind === 'person' && ['n1', 'n2', 'n3'].every((x) => dan.meetings.includes(x)), 'with the meetings you met in', dan)
  await home.locator('.mm-colls button[data-coll="all"]').click()
  await shot(p, `${tag}memory-after`)

  // ---------- Every way in opens a page ----------
  const away = async () => {
    await p.locator('.rail-nav-btn', { hasText: 'Dictations' }).click()
    await until(async () => await front(p) === 'view:dictations', 5000)
  }
  const opened = (all) => until(async () => await front(p) === 'view:meetings' && await meetView(p) === 'memory' && (await scope(home)) === (all ? 'all' : 'here') && (await home.isVisible()) && !(await p.locator('.mt-dialog, .modal.settings, .ctx-menu').count()), 8000)
  await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).first().click()
  await p.locator('.mt-view .pane-head .seg button[data-view="list"]').click()
  await p.locator('.mt-view .pane-head .seg button[data-view="memory"]').click()
  ok(!!(await opened(false)), 'Meetings\' Memory tab opens its page, from meetings')
  await p.locator('.mt-view .pane-head .seg button[data-view="list"]').click()
  await p.locator('.mt-view .mt-row-open', { hasText: 'Atlas planning' }).click({ button: 'right' })
  await p.locator('.ctx-menu button', { hasText: 'Open Memory' }).click()
  ok(!!(await opened(false)), 'and a meeting\'s menu, Open Memory')
  await away()
  await p.keyboard.press('ControlOrMeta+K')
  await p.locator('.palette input').fill('memory')
  ok(/In Meetings and Dictations/.test(await p.locator('.pal-item[data-id="a:memory"]').innerText()), '⌘K says where Memory is', await p.locator('.pal-item[data-id="a:memory"]').innerText())
  await p.locator('.pal-item[data-id="a:memory"]').click()
  ok(!!(await opened(true)), 'and ⌘K, at all of it')
  await away()
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'meetings' } })))
  await p.locator('.modal.settings button', { hasText: 'Open Memory' }).click()
  ok(!!(await opened(true)), 'and Settings › Voice & Meetings\' Open Memory, closing Settings, at all of it')
  ok(!real(deskPage.errors).length, 'no page errors', deskPage.errors)

  // ---------- A window showing Desk ----------
  // As Bridge AI shows another of your computers: at /m/desk/, the page from here and every request
  // it makes passed on to Desk (machines.js proxy), with Desk among your computers.
  const DESK = { id: 'desk', name: 'Desk', relay: null, os: 'darwin', version: '3.12.0', state: 'linked', online: true, lastSeen: new Date().toISOString(), addedAt: ago(30), code: null, error: null, counts: {}, agents: [], needs: null, at: null, home: null, about: null, systemName: 'Desk', safety: null }
  const both = await page(b, kit.url, { mode: 'light', before: async (ctx) => {
    await changeAnswer(ctx, `${kit.url}/api/machines`, (r) => ({ ...r, machines: [...(r.machines || []), DESK] }))
    await ctx.route(/\/m\/desk\//, async (r) => {
      const u = new URL(r.request().url())
      const rest = u.pathname.slice('/m/desk'.length)
      if (rest === '/api/events') return r.abort()
      const res = await r.fetch({ url: `${rest.startsWith('/api/') ? desk.url : kit.url}${rest}${u.search}` }).catch(() => null)
      return res ? r.fulfill({ response: res }) : r.abort()
    })
  } })
  pages.push(both)
  const q = both.p
  const mm = q.locator('.mt-view .mm-page')
  const meetMemory = async () => {
    await q.locator('.rail-nav-btn', { hasText: 'Meetings' }).first().click()
    await q.locator('.mt-view .pane-head .seg button[data-view="memory"]').click()
  }
  // Here: Memory at People.
  await q.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await meetMemory()
  await mm.locator('.mm-colls button[data-coll="person"]').click()
  ok(!!(await until(async () => await picked(q) === 'person' && /On this computer/.test(await mm.locator('.mm-bar').innerText()), 8000)), 'here: this computer\'s memory, at People')
  // Desk: its own memory, said to be Desk's.
  await q.goto(`${kit.url}/m/desk/`)
  await q.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  ok(await front(q) !== 'view:meetings', 'Desk\'s window has tabs of its own')
  await meetMemory()
  ok(!!(await until(async () => (await mm.locator('.mm-item[data-term="Kestrel"]').count()) === 1 && !(await mm.locator('.mm-item[data-term="Atlas"]').count()) && /On Desk/.test(await mm.locator('.mm-bar').innerText()), 10000)), 'Desk\'s window: Desk\'s memory, and it says so', await mm.locator('.mm-bar').innerText().catch(() => ''))
  ok(/made and kept on Desk/.test(await mm.locator('.mm-you').innerText()), 'with About You made on Desk', await mm.locator('.mm-you').innerText())
  ok(!(await mm.locator('.mm-item[data-term="Fabrikam"]').count()) && /^1 of 2 names · On Desk$/.test((await mm.locator('.mm-bar .mm-count').innerText()).trim()), 'from Desk\'s meetings and yours: not a name from neither', await mm.locator('.mm-bar .mm-count').innerText())
  // (Desk has no dictations, so its sidebar has no Dictations yet.)
  await q.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-dictations')))
  ok(!!(await until(async () => /On Desk/.test(await q.locator('.dc-view .pane-sub').innerText().catch(() => '')), 8000)), 'and Desk\'s Dictations say they\'re Desk\'s', await q.locator('.dc-view .pane-sub').innerText().catch(() => ''))
  await meetMemory()
  await mm.locator('.mm-colls button[data-coll="project"]').click()
  await until(async () => await picked(q) === 'project', 5000)
  await shot(q, `${tag}memory-desk`)
  // Back here, then Desk again: each where it was.
  await q.goto(`${kit.url}/`)
  ok(!!(await until(async () => await front(q) === 'view:meetings' && await meetView(q) === 'memory' && await picked(q) === 'person' && (await mm.locator('.mm-item[data-term="Priya Shah"]').count()) === 1, 10000)), 'back to this computer: Meetings at Memory, at People, its own names')
  await q.goto(`${kit.url}/m/desk/`)
  ok(!!(await until(async () => await front(q) === 'view:meetings' && await meetView(q) === 'memory' && await picked(q) === 'project' && (await mm.locator('.mm-item[data-term="Kestrel"]').count()) === 1, 10000)), 'and Desk again: its Memory, at Projects & Products')
  // Desk away: said, with Try again, and its memory once it's back.
  const gone = (r) => r.fulfill({ status: 503, json: { error: 'Desk isn\'t connected', offline: true } })
  await q.context().route(/\/m\/desk\/api\/memory$/, gone)
  await q.reload()
  ok(!!(await until(async () => /Memory on Desk can't be shown right now\.[\s\S]*Desk isn't connected/.test(await mm.locator('.mm-cant').innerText().catch(() => '')), 10000)), 'Desk away: it says Desk\'s memory can\'t be shown, and why', await mm.innerText().catch(() => ''))
  await shot(q, `${tag}memory-desk-away`)
  await q.context().unroute(/\/m\/desk\/api\/memory$/, gone)
  await mm.locator('.mm-cant button', { hasText: 'Try again' }).click()
  ok(!!(await until(async () => (await mm.locator('.mm-item[data-term="Kestrel"]').count()) === 1, 10000)), 'and Try again shows it once Desk is back')
  ok(!real(both.errors).length, 'no page errors in either window', both.errors)

  // ---------- Dark, from a tab kept from before; and phones ----------
  // A window that had Memory in a tab of its own (and Meetings in another, behind it): Meetings in
  // front at Memory, all of it, as the page showed, and one Meetings tab.
  const was = { tabs: ['view:meetings', 'view:memory'], active: 'view:memory', side: null, split: false, group: 'main' }
  const dark = await page(b, kit.url, { mode: 'dark', store: { 'cc-mm-coll': 'person', 'cc-meet-tab': 'list', 'cc-ws': was } })
  pages.push(dark)
  const dh = dark.p.locator('.mt-view .mm-page')
  ok(!!(await until(async () => await front(dark.p) === 'view:meetings' && await meetView(dark.p) === 'memory' && (await scope(dh)) === 'all' && (await dh.locator('.mm-item').count()) > 0, 10000)), 'a tab kept from when Memory was a page of its own: Meetings at Memory, all of it', { front: await front(dark.p), view: await meetView(dark.p), scope: await scope(dh) })
  const tabsNow = await dark.p.locator('.ws-tab').evaluateAll((xs) => xs.map((x) => x.dataset.pane))
  ok(tabsNow.filter((x) => x === 'view:meetings').length === 1 && !tabsNow.includes('view:memory'), 'with one Meetings tab, and none for Memory', tabsNow)
  await shot(dark.p, `${tag}memory-dark`)
  await dark.p.locator('.rail-nav-btn', { hasText: 'Dictations' }).click()
  await dark.p.locator('.dc-view .pane-head .seg button[data-view="memory"]').click()
  await until(() => dark.p.locator('.dc-view .mm-page .mm-item').count(), 10000)
  await shot(dark.p, `${tag}memory-dictations-dark`)
  ok(!real(dark.errors).length, 'dark: no page errors', dark.errors)
  // Nothing in memory from a dictation yet (none said, none yours): said, with the way to all of it.
  const none = await page(b, kit.url, { before: async (ctx) => { await noServiceWorker(ctx); await changeAnswer(ctx, /\/api\/memory(\?|$)/, (r) => ({ ...r, terms: r.terms.map((x) => ({ ...x, dictations: [], source: 'learned' })) })) } })
  pages.push(none)
  await none.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await none.p.locator('.rail-nav-btn', { hasText: 'Dictations' }).click()
  await none.p.locator('.dc-view .pane-head .seg button[data-view="memory"]').click()
  const nm = none.p.locator('.dc-view .mm-page')
  ok(!!(await until(async () => /Nothing in memory has come up in a dictation yet\.[\s\S]*Show all memory/.test(await nm.locator('.mm-none-here').innerText().catch(() => '')) && !(await nm.locator('.mm-tools').count()) && (await nm.locator('.mm-you').count()) === 1, 10000)),
    'none from dictations yet: said, with About You, and the way to all of memory', await nm.innerText().catch(() => ''))
  await shot(none.p, `${tag}memory-dictations-none`)
  await nm.locator('.mm-none-here button', { hasText: 'Show all memory' }).click()
  ok(!!(await until(async () => (await scope(nm)) === 'all' && (await nm.locator('.mm-item').count()) > 0, 5000)), 'and Show all memory shows it')
  ok(!real(none.errors).length, 'and no page errors', none.errors)
  for (const [w, mode] of [[375, 'light'], [430, 'dark']]) {
    // Meetings named at length, as a customer call's invite often is: its group's name is cut to fit,
    // never making the page wider than the phone.
    const long = (ctx) => changeAnswer(ctx, /\/api\/memory(\?|$)/, (real) => ({ ...real, meetings: Object.fromEntries(Object.entries(real.meetings || {}).map(([k, m]) => [k, { ...m, title: `${m.title}: renewal, pricing and the expansion into the EMEA region` }])) }))
    const ph = await page(b, kit.url, { mode, phone: true, before: async (ctx) => { await noServiceWorker(ctx); await long(ctx) } })
    pages.push(ph)
    await ph.p.setViewportSize({ width: w, height: 844 })
    // Not in More.
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    await ph.p.locator('.m-more-row').first().waitFor({ timeout: 8000 })
    ok(!(await ph.p.locator('.m-more-row[data-id="memory"]').count()) && !(await ph.p.locator('.m-more-row', { hasText: /^Memory/ }).count()), `${w} px: nothing of Memory in More`)
    // Meetings' Memory.
    await ph.p.locator('.tabbar button', { hasText: 'Meetings' }).click()
    await ph.p.locator('.m-meetings .mt-view .pane-head .seg button[data-view="memory"]').click()
    const pm = ph.p.locator('.m-meetings .mm-page')
    ok(!!(await until(() => pm.locator('.mm-you').count(), 10000)) && (await scope(pm)) === 'here', `${w} px: Memory in the Meetings tab, from meetings`)
    const [t0, y0] = [await pm.locator('.mm-tools').boundingBox(), await pm.locator('.mm-you').boundingBox()]
    ok(t0.y < 480 && t0.y + t0.height <= 844 && y0.y > t0.y, `${w} px: the collections and the search on the first screen, About You under them`, { tools: t0, you: y0 })
    await shot(ph.p, `${tag}memory-phone-${w}-${mode}`)
    let faults = await phoneFaults(ph.p, '.m-meetings .mm-view')
    ok(!Object.keys(faults).length, `${w} px: it fits, every target whole, meetings with long names too`, faults)
    faults = await phoneFaults(ph.p, '.m-meetings .mt-view .pane-head')
    ok(!Object.keys(faults).length, `${w} px: and Meetings' header, with Memory a view of it`, faults)
    await pm.locator('.mm-item').first().scrollIntoViewIfNeeded()
    await pm.locator('.mm-item[data-term="Priya Shah"] .mm-from').click()
    faults = await phoneFaults(ph.p, '.m-meetings .mm-view')
    ok(!Object.keys(faults).length, `${w} px: and with a name's meetings open`, faults)
    await shot(ph.p, `${tag}memory-phone-${w}-${mode}-names`)
    await pm.locator('.mm-item .mm-pen').first().click()
    faults = await phoneFaults(ph.p, '.m-meetings .mm-view')
    ok(!Object.keys(faults).length, `${w} px: and editing one, with fields that don't zoom`, faults)
    await pm.locator('.mm-edit button', { hasText: 'Done' }).click()
    await pm.locator('.mm-find input').fill('priya')
    ok(!!(await until(async () => !(await pm.locator('.mm-you').isVisible()) && (await pm.locator('.mm-item[data-term="Priya Shah"]').isVisible()), 5000)), `${w} px: while searching, the names right under the search`)
    await pm.locator('.mm-find input').fill('')
    await pm.locator('.mm-scope button[data-scope="all"]').click()
    ok(!!(await until(async () => (await scope(pm)) === 'all' && (await countsIn(pm)).all === (await api('/memory')).terms.length, 5000)), `${w} px: All memory`)
    await ph.p.reload()
    ok(!!(await until(() => ph.p.locator('.m-meetings .mt-view .mm-page').isVisible(), 10000)) && (await ph.p.locator('.tabbar button.on').innerText()).trim() === 'Meetings', `${w} px: still Memory after a reload`)
    // Dictations' Memory.
    await ph.p.locator('.m-meetings .m-seg button', { hasText: 'Dictations' }).click()
    await ph.p.locator('.m-meetings .dc-view .pane-head .seg button[data-view="memory"]').click()
    const pd = ph.p.locator('.m-meetings .dc-view .mm-page')
    ok(!!(await until(() => pd.locator('.mm-item[data-term="Tailspin"]').count(), 10000)) && (await scope(pd)) === 'here', `${w} px: Dictations' Memory, from dictations`)
    await shot(ph.p, `${tag}memory-phone-${w}-${mode}-dictations`)
    faults = await phoneFaults(ph.p, '.m-meetings .dc-view')
    ok(!Object.keys(faults).length, `${w} px: it fits too, Dictations' header with it`, faults)
    ok(!real(ph.errors).length, `${w} px: no page errors`, ph.errors)
  }
  // A phone left at More's old Memory row: the Meetings tab at Memory, all of it.
  const old = await page(b, kit.url, { phone: true, store: { 'cc-mtab': 'more', 'cc-more-view': 'view:memory', 'cc-meet-tab': 'list' }, before: noServiceWorker })
  pages.push(old)
  ok(!!(await until(async () => (await old.p.locator('.tabbar button.on').innerText().catch(() => '')).trim() === 'Meetings' && (await scope(old.p.locator('.m-meetings .mm-page'))) === 'all', 10000)), 'a phone left at More\'s old Memory row: the Meetings tab at Memory, all of it')
  ok(!real(old.errors).length, 'and no page errors', old.errors)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const w of pages) await w.ctx.close().catch(() => {})
  await b.close()
  kit.stop()
  desk.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
