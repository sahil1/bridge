// Settings, by what you're doing (src/components/Settings.jsx): it opens on Your Features, a card
// for each feature with its switch, a line on how it's doing and Open; then You, Agents & Models,
// Meetings & Voice, Mail & Calendar (a Mac), Bots, Devices & Access, Notifications, Back Up & Move
// (Account & Backup once accounts exist) and About & Updates, their names and tabs the same as the
// table every message that names a place takes them from (shared/places.js). Each section shows what
// most people change first, and the rest under Advanced at its end (settings/Advanced.jsx): in every
// section its essentials show, and Advanced is there, closed; opened, it stays open for that section
// (another section's stays closed), across Settings closed and opened and a reload, and closed again
// stays closed. ⌘K finds a setting under Advanced (and none while nothing's typed): Settings opens at
// it, Advanced opened to show it near the top, and that opening isn't kept. A link to one
// (bridge-open-settings) does the same, and the ids that opened a section before it moved (general,
// appearance, voice, sharing, slack-bot…) land where it is now. Every data-setting any section shows
// is one ⌘K knows (settings/search.js), so nothing in Settings is out of its reach; a beta feature's
// own settings it finds only while it's on, its switch always (Share Links'). What's on unless
// turned off and sends what it reads off the computer is never under Advanced: Meetings' cleanup,
// naming who spoke and preparing (with which model writes the notes and where it runs said there:
// none yet, then a key's), Mail's learning again, the Agents tab's picking up unfinished work.
// You's Enter Key (src/enter.js): Smart, Always Sends or ⌘Enter Sends, Smart until another is picked,
// each kept, and Smart again taken out of your settings. Nothing was lost: every setting there was (each control by its name) is still in its place,
// Advanced opened. Each beta feature's switch is at the top of its own place, marked Beta; About &
// Updates › Beta Features lists only what's still in beta, each with the way to its place. The ones
// out of beta (Home, Scheduled Routines, Meeting Insights, Bridge AI as an MCP Server) are regular
// cards in Your Features and ordinary switches in their own places, with no Beta mark; and a
// settings file from before 3.22.0 with their Beta Features switches on, off or never set comes up
// as it was left (on stays on, off stays off, never set takes each one's default), and so after a
// restart. A setting
// that needs another one on shows greyed with Turn On (Dictation's extras), and Which Devices May
// Connect shows with Remote Screen and Preview off. Meetings & Voice and Devices & Access have four
// tabs each: a link to one of them lands on it, the section's own id and its row in the list on the
// first, and on a phone the tabs two by two across the top, each a whole 40 px target. At phone
// width (375 px), dark: Meetings with Advanced open, nothing wider than the screen or cut off, and
// Advanced a whole 40 px target. Meetings' Names from the call, on a Mac, where Screen Recording
// shows as on in System Settings and doesn't take until Bridge AI restarts: after Open it, Restart
// Bridge AI (the top bar's Restart to apply, in a browser); restarted and still off, Reset and ask
// again, for Screen Recording alone;
// and on, seen as soon as you come back to the window, not 30 seconds later. Stand-ins for
// native/callwatch (bin/callwatch.json says whether it's allowed) and tccutil (bin/tcc.log).
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startModel, checks, until, sleep, browser, page, shot, phoneFaults, advanced, withoutCutOff, noServiceWorker, IS_MAC, ROOT } from '../lib/harness.mjs'
import { SECTIONS as PLACE_SECTIONS, TABS as PLACE_TABS, NO_ACCOUNTS, placeEn } from '../../shared/places.js'

const { ok, done } = checks('settings-ui')
const stand = (bin, name, source) => {
  fs.writeFileSync(path.join(bin, `${name}.cjs`), source)
  fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, `${name}.cjs`)}" "$@"\n`, { mode: 0o755 })
  return path.join(bin, name)
}
// (Home as Bridge AI starts, on: its card and switch are checked as they come.)
const kit = await startKit('settings-ui', { config: { home: undefined }, env: ({ bin }) => (IS_MAC ? {
  BRIDGE_CALLWATCH: stand(bin, 'callwatch', `const fs = require('node:fs'), path = require('node:path')
const read = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'callwatch.json'), 'utf8')) } catch { return {} } }
const say = (o) => { process.stdout.write(JSON.stringify(o) + '\\n'); process.exit(0) }
if (process.argv[2] === 'screen-ask') { fs.appendFileSync(path.join(__dirname, 'screen-asked'), 'asked\\n'); say({ allowed: !!read().screen }) }
if (process.argv[2] === 'screen') say({ allowed: !!read().screen })
setInterval(() => {}, 1000); process.stdout.write('{"input":[]}\\n')`),
  BRIDGE_TCCUTIL: stand(bin, 'tccutil', `require('node:fs').appendFileSync(require('node:path').join(__dirname, 'tcc.log'), process.argv.slice(2).join(' ') + '\\n')`),
  BRIDGE_FIX_BUNDLE_ID: 'dev.bridge-ai.test',
} : {}) })
const model = await startModel('settings-ui')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''

// What each section shows first (not under Advanced); for a section with tabs, each of its tabs.
const TABS = ['Meetings', 'Dictation', 'Speech Models', 'Spoken Answers']
const TABBED = {
  'Agents & Models': ['Agents', 'Model Providers', 'Which Model Does What', 'MCP Servers'],
  'Meetings & Voice': TABS,
  'Devices & Access': ['Phone', 'Computers', 'Remote Access', 'Share Links'],
}
const SECTIONS = ['Your Features', 'You', 'Agents & Models', 'Meetings & Voice', ...(IS_MAC ? ['Mail & Calendar'] : []), 'Bots', 'Devices & Access', 'Notifications', 'Back Up & Move', 'About & Updates']
const FIRST = {
  'Your Features': ['Home', 'Meetings', 'Meeting Insights', 'Dictation', 'Chief of Staff', 'Scheduled Routines', 'Phone', 'Share Links', 'Notifications', 'Bridge AI as an MCP Server', 'Beta', 'Bots', 'Remote Screen and Preview', 'Set up'],
  You: ['Home', 'Your name', 'Location', 'Layout', 'Enter Key', 'Color Mode', 'Theme', 'Text Size', 'Language'],
  Agents: ['Scheduled Routines', 'Default agent', 'Pick up unfinished work', 'Chief of Staff', 'Runs on', 'Helpers at once', 'Your Agents'],
  'Model Providers': ['Usage Across Every Provider', /model labs/i, /run locally/i],
  'Which Model Does What': ['Agents and the Chief of Staff', 'New agents and chats', 'Models for Each Task', 'Speech and Dictation', 'Speech to text'],
  'Speech Models': ['Speech Model'],
  'Spoken Answers': ['Voice'],
  Dictation: ['Talk to your agents'],
  Meetings: ['Live Meeting Board', 'Answers in AI Assist', 'Meeting Insights', 'Transcribe with', 'Language', 'Names and terms', 'Notes are written by', 'Write the summary when a meeting ends', 'Clean up the transcript when a meeting ends', 'Name who spoke on the call', ...(IS_MAC ? ['Prepare for each meeting'] : []), 'Record the other side of calls', 'Notice calls', 'Save every meeting as Markdown'],
  'Mail & Calendar': ['How You Write', 'Learn it again now and then', 'Working days', 'Working hours', 'Read-Only'],
  Bots: ['Bots', /beta/i, 'Open Bots'],
  'MCP Servers': ['Bridge AI as an MCP Server', 'Add server'],
  Phone: [/relay|Cloudflare/i],
  Computers: ['Your Devices', 'Link a device'],
  'Remote Access': ['Remote Screen and Preview', 'Which Devices May Connect'],
  'Share Links': ['Share Links', /beta/i, /Nothing is shared now/],
  Notifications: ['Notifications on this device', 'What to notify about', 'An agent needs you', 'Notification sounds', 'Screen Sharing Notifications', 'Needs Remote Screen and Preview on'],
  'Back Up & Move': ['Back Up to a File', 'Restore From a File'],
  'About & Updates': ['Version', 'Check for new versions', 'Beta Features', 'Privacy', 'Report a problem'],
}
// Every setting there was, by its control's name (kind|name; a name the control's own includes), in
// its place with Advanced opened. Platform's own: Mail only on a Mac, Prepare for each meeting only
// with a calendar (a Mac).
const ALL = {
  You: ['input|Your name', 'button|Simple', 'button|Everything', 'button|Smart', 'button|Always Sends', 'button|Enter Sends', 'button|Use my location', 'input|Search for a city', 'button|Light', 'button|Dark', 'button|Sync with system', 'button|Midnight', 'button|Custom', 'button|Copy', 'input|Paste a theme', 'button|Use', 'button|Small', 'button|Large', 'button|Comfortable', 'button|Compact', 'button|Geist', 'button|Rounded', 'input|Weather', 'input|Clock', 'input|Usage', 'input|Updates', 'input|Restart to apply', 'input|Setup', 'input|Notification sounds', 'select|Language', 'button|Reset appearance', 'input|Home'],
  Agents: ['input|Scheduled Routines', 'button|More agents', 'button|Refresh', 'button|Install', 'button|Copy the command', 'select|Chief of Staff runs on', 'select|Helpers at once', 'button|Off', 'button|On', 'select|Terminal app', 'button|Built in', 'button|herdr', 'input|Keep agents running when Bridge AI quits', 'input|Pick up unfinished work after an update, a crash or a restart'],
  'Model Providers': ['input|Usage Across Every Provider', 'input|Show more models (Qwen Code, DeepSeek, Kimi, GLM)', 'button|Anthropic', 'button|OpenAI', 'button|Azure OpenAI', 'button|AWS Bedrock', 'button|OpenRouter', 'button|Groq', 'button|Ollama', 'button|LM Studio', 'button|Deepgram', 'button|AssemblyAI', 'button|Another speech service', 'button|Cursor', 'button|GitHub Copilot', 'button|Jules'],
  'Which Model Does What': ['button|Model for Meeting notes', 'button|Model for Diagrams', 'button|Change'],
  'Speech Models': ['button|Download'],
  'Spoken Answers': ['select|Voice', 'select|Speed', 'button|Test'],
  Dictation: ['input|Talk to your agents', 'button|Change', 'input|Light cleanup', 'input|Mention files by saying them', 'input|Show the words as you talk', 'input|Keep a history of what you dictate', 'input|30 days', 'input|1 year', 'input|Always', 'input|Keep the recordings too', 'button|Delete all dictations'],
  Meetings: ['input|Live Meeting Board', 'input|Answers in AI Assist', 'input|Meeting Insights', 'input|On this computer', 'input|OpenAI', 'input|Groq', 'input|Deepgram', 'input|AssemblyAI', 'input|Another OpenAI-style service', 'button|Speech models', 'select|Meeting language', 'button|Open Memory', 'input|More words to listen for', 'input|Record the other side of calls', 'select|Model for meeting notes', 'input|Write the summary when a meeting ends', 'input|Clean up the transcript when a meeting ends', 'input|Suggest what to ask, in every meeting', 'select|How often AI Assist suggests something', ...(IS_MAC ? ['input|Prepare for each meeting', "input|Speakers From the Call's Video"] : []), 'input|Name who spoke on the call', 'textarea|Your own instructions for every summary', 'input|Tell voices apart in a room', 'input|Tell voices apart on a call', 'input|Learn my voice', 'input|Remember voices you name', 'select|The key that mentions a meeting', 'input|Notice calls', 'input|Stop by itself when the call ends', 'select|What to save', 'input|Folder', 'input|Subfolders', 'input|File name', 'input|Front matter', 'input|Your mic, as', 'input|The call, as', 'input|Keep saved notes up to date', 'input|Save every meeting as Markdown'],
  'Mail & Calendar': ['input|Learn it again now and then', 'button|Mon', 'button|Sun', 'input|From', 'input|To', 'select|Kept clear around meetings', 'select|Around a meeting somewhere else', 'select|How many times to offer'],
  Bots: ['input|Bots', 'button|Open Bots'],
  'MCP Servers': ['input|Bridge AI as an MCP Server', 'button|Add server', 'button|Refresh'],
  Phone: ['button|Sign in with Cloudflare', 'button|Use an API token instead', 'button|Check again'],
  Computers: ['button|Details', "input|The other device's link", 'button|Link'],
  'Remote Access': ['input|Remote Screen and Preview'],
  'Share Links': ['input|Share Links'],
  Notifications: ['button|Turn on notifications', 'input|An agent needs you (a question, a permission)', 'input|An agent finished', 'select|Usage running low', 'input|Notification sounds', 'input|Answer buttons for simple questions (yes or no, or two short choices)', "input|Notify my phone even when I'm at the computer", 'input|Screen Sharing Notifications', 'button|Turn On'],
  'Back Up & Move': ['input|Passphrase', 'button|Back Up', 'button|Choose a Backup'],
  'About & Updates': ['button|Check now', 'input|Check for new versions', 'button|Take the tour', 'a|Report a problem', 'a|Suggest an idea', 'button|Copy details', 'input|Usage Across Every Provider', 'input|Share Links', 'button|Copy path', 'textarea|config.json', 'button|Save', 'button|Effective settings', 'button|Defaults', ...(IS_MAC ? ["input|Speakers From the Call's Video"] : [])],
}
// Beta Features: only those still in beta, in order (Studio, Sign PDFs, Comments and @bridge, Make a
// Sheet, Back and Forward, Tab Groups, Files and Recommended Settings are part of the app since
// 3.19.0; Home, Tidy what I say, Meeting Insights, Scheduled Routines and Bridge AI as an MCP Server
// since 3.22.0); Speakers From the Call's Video only where the server runs on a Mac. Each one's
// switch is first in its own place too.
// Your Features' cards in a browser: 15, and the Mac's Speakers From the Call's Video (Tidy What I
// Say's only in the desktop app, where it can hear the key from other apps).
const CARDS = IS_MAC ? 16 : 15
const BETAS = ['Usage Across Every Provider', 'Live Meeting Board', 'Answers in AI Assist', 'Bots', 'Remote Screen and Preview', 'Share Links', ...(IS_MAC ? ["Speakers From the Call's Video"] : [])]
const BETA_AT = { 'Share Links': 'Share Links', 'Usage Across Every Provider': 'Model Providers', 'Live Meeting Board': 'Meetings', 'Answers in AI Assist': 'Meetings', Bots: 'Bots', 'Remote Screen and Preview': 'Remote Access', "Speakers From the Call's Video": 'Meetings' }
// Out of beta: each an ordinary switch in its own place, by its data-setting, with no Beta mark (Tidy
// what I say only in the desktop app, where the key works from other apps: dictation-cleanup has it).
const OUT_AT = { home: 'You', 'scheduled-routines': 'Agents', 'meeting-insights': 'Meetings', 'mcp-server': 'MCP Servers' }
// Every setting ⌘K knows (search.js), by id, and the ones known by the start of theirs (each agent's
// row, each group of providers).
const SEARCH = fs.readFileSync(path.join(ROOT, 'src', 'components', 'settings', 'search.js'), 'utf8')
const KNOWN = new Set([...SEARCH.matchAll(/^\s+\['([\w-]+)', tx\(/gm)].map((m) => m[1]))
const FAMILIES = JSON.parse((/export const FAMILIES = (\[[^\]]*\])/.exec(SEARCH)?.[1] || '[]').replace(/'/g, '"'))
const known = (id) => KNOWN.has(id) || FAMILIES.some((f) => id.startsWith(f))
const unknownSettings = (p) => p.evaluate(() => [...new Set([...document.querySelectorAll('.modal.settings [data-setting]')].flatMap((e) => e.dataset.setting.split(/\s+/)).filter(Boolean))])

// Every control's name in the panel, every fold opened (as kind|name).
const names = (p) => p.evaluate(() => {
  const root = document.querySelector('.modal.settings .st-scroll')
  root.querySelectorAll('details').forEach((d) => { d.open = true })
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  return [...root.querySelectorAll('input, select, textarea, button, a.btn')].map((el) => {
    const lab = el.closest('label')
    const n = clean(el.getAttribute('aria-label')) || (lab && clean(lab.querySelector('b')?.textContent || lab.textContent)) || clean(el.textContent) || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title'))
    return `${el.tagName.toLowerCase()}|${n}`
  })
})
// What shows first: the panel's words outside Advanced, as they're drawn.
const first = (p) => p.evaluate(() => {
  const root = document.querySelector('.modal.settings .st-scroll')
  const adv = root.querySelector('details.st-adv')
  const was = adv?.open
  if (adv) adv.open = false
  const text = root.innerText
  if (adv) adv.open = was
  return text
})
const settled = async (p) => {
  let last = ''
  let same = 0
  await until(async () => {
    const now = await p.locator('.modal.settings .st-scroll').innerText().catch(() => '')
    same = now && now === last && !(await p.locator('.modal.settings .st-scroll .skeleton-rows').count()) ? same + 1 : 0
    last = now
    return same >= 3
  }, 10000, 250)
}
const adv = (p) => p.locator('.modal.settings details.st-adv')
const isOpen = (p) => adv(p).evaluate((d) => d.open).catch(() => null)
const nav = async (p, name) => { await p.locator('.st-nav-item', { has: p.locator('span', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first().click(); await settled(p) }

try {
  await kit.api('/setup', { name: 'Tester' })

  // ---------- The table messages read: the same names and tabs as Settings itself ----------
  {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'components', 'Settings.jsx'), 'utf8')
    const block = /export const SECTIONS = \[([\s\S]*?)\n\]/.exec(src)[1]
    const sections = [...block.matchAll(/^ {2}\{ id: '([\w-]+)', label: tx\('([^']+)'\)/gm)].map((m) => [m[1], m[2]])
    const tabs = [...block.matchAll(/\{ id: '([\w-]+)', label: tx\('([^']+)'\)(?:, accounts: true)? \}/g)].map((m) => [m[1], m[2]])
    const off = [...sections.filter(([id, l]) => PLACE_SECTIONS[id] !== l), ...tabs.filter(([id, l]) => PLACE_TABS[id]?.[1] !== l)]
    ok(sections.length === Object.keys(PLACE_SECTIONS).length && tabs.length === Object.keys(PLACE_TABS).length && !off.length, 'Settings\' sections and tabs are the ones shared/places.js names, so a message that sends you somewhere names a place that is there', { off, sections, tabs })
    ok(placeEn('remote-devices') === 'Settings › Devices & Access › Remote Access › Which Devices May Connect' && placeEn('backup') === `Settings › ${NO_ACCOUNTS['account-backup']}` && placeEn('backup', { accounts: true }) === 'Settings › Account & Backup › Back Up & Move', 'and the way to a setting reads as Settings shows it, accounts or not', [placeEn('remote-devices'), placeEn('backup'), placeEn('backup', { accounts: true })])
    // No message anywhere in the app hard-codes a place in Settings: each takes it from the table.
    // (System Settings, a phone's own Settings, and "its Settings", an older Bridge AI's on another computer, are theirs.)
    const { strings } = await import('../../scripts/i18n.js')
    const hard = [...strings()].filter(([k]) => /(?<!System |iPhone |Android |phone's |GitHub's |GitHub › |its )Settings › (?:General|Voice & Meetings|Account & Devices|Devices\b(?! &)|Sharing|Appearance|Config File|Remote Access|Model Providers|MCP Servers|Agents\b(?! &)|Mail\b(?! &)|About\b|Account\b(?! &))/.test(k)).map(([k, f]) => `${[...f].join(', ')}: ${k.slice(0, 100)}`)
    ok(!hard.length, 'no string in the app names a place in Settings by hand (each takes {place} from where())', hard)
  }

  // ---------- Your Features first, then each section: its essentials, Advanced closed; and nothing lost ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    await p.locator('button[aria-label="Settings"]').first().click()
    await p.waitForSelector('.st-nav-item', { timeout: 8000 })
    const navs = (await p.locator('.st-nav-item > span:not(.st-chip)').allInnerTexts()).map((x) => x.trim())
    ok(JSON.stringify(navs) === JSON.stringify(SECTIONS), 'Settings\' sections, by what you\'re doing', navs)
    ok((await p.locator('.st-nav-item.on').innerText()).trim() === 'Your Features' && (await p.locator('.st-head h3').innerText()).trim() === 'Your Features', 'Settings opens on Your Features')
    ok(await p.locator('.st-nav-item', { hasText: 'Bots' }).locator('.st-chip.beta').count() === 1, 'Bots is marked Beta in the list, not hidden while it\'s off')
    // Your Features: a card for each feature, the betas too, each with its line and Open; a beta's
    // switch here is the one in its own place.
    await settled(p)
    const cards = await p.locator('.ft-card').evaluateAll((l) => l.map((c) => ({ id: c.dataset.feature, name: c.querySelector('.ft-name b')?.innerText.trim(), status: c.querySelector('.ft-status')?.innerText.trim(), open: !!c.querySelector('.ft-open'), beta: !!c.querySelector('.st-chip.beta'), sw: !!c.querySelector('input[role="switch"]') })))
    const betaCards = cards.filter((c) => c.beta).map((c) => c.name)
    ok(cards.length >= CARDS && cards.every((c) => c.name && c.status && c.open) && JSON.stringify(betaCards) === JSON.stringify(BETAS) && cards.filter((c) => c.beta).every((c) => c.sw), 'Your Features: a card for each feature, each with a line on how it\'s doing and Open, every beta there and marked, with its switch', cards)
    ok(cards.find((c) => c.id === 'remote-screen')?.status === 'See and control your other computers' && cards.every((c) => c.status !== 'Off') && cards.find((c) => c.id === 'dictation')?.sw && /^Hold .+ and talk$/.test(cards.find((c) => c.id === 'dictation')?.status || ''), 'and says how each is: Remote Screen, off, says what it is (its switch says it\'s off), Dictation is on with its key', cards.filter((c) => ['remote-screen', 'dictation'].includes(c.id)))
    // The ones out of beta: regular cards, each with its switch, as each starts.
    const card = (id) => cards.find((c) => c.id === id) || {}
    const sw = (id) => p.locator(`.ft-card[data-feature="${id}"] input[role="switch"]`)
    ok(['home', 'meeting-insights', 'routines', 'mcp-server'].every((id) => card(id).sw && !card(id).beta) && !card('tidy').name
      && await sw('home').isChecked() && await sw('routines').isChecked() && !(await sw('meeting-insights').isChecked()) && !(await sw('mcp-server').isChecked())
      && card('home').status === 'Your day at a glance' && card('meeting-insights').status === 'On by itself after 5 meetings' && card('routines').status === 'None on a schedule yet' && card('mcp-server').status === 'Your boards and files in other AI apps',
    'Home, Meeting Insights, Scheduled Routines and Bridge AI as an MCP Server: regular cards with their switches, Home and Scheduled Routines on, Meeting Insights on by itself after 5 meetings, the MCP server off; Tidy What I Say only in the desktop app', ['home', 'meeting-insights', 'routines', 'mcp-server', 'tidy'].map((id) => [id, card(id)]))
    await sw('meeting-insights').check()
    ok(!!(await until(async () => (await kit.api('/config')).features?.['meeting-insights'] === true && (await kit.api('/settings')).user.meetings?.insights === true, 5000)), 'its card\'s switch turns Meeting Insights on, saved as its own setting')
    await p.locator('.ft-card[data-feature="meeting-insights"] .ft-open').click()
    const insightsAt = p.locator('.modal.settings [data-setting="meeting-insights"] input[type="checkbox"]')
    ok(!!(await until(async () => (await p.locator('.st-tabs [role="tab"][aria-selected="true"]').innerText().catch(() => '')) === 'Meetings' && await insightsAt.isChecked().catch(() => false), 8000)), 'and Open goes to its switch in Settings › Meetings & Voice › Meetings, on')
    await insightsAt.uncheck()
    ok(!!(await until(async () => (await kit.api('/config')).features?.['meeting-insights'] === false, 5000)), 'turned off there, it\'s off')
    await nav(p, 'Your Features')
    const lines = await p.locator('.ft-status').evaluateAll((l) => l.map((e) => ({ t: e.innerText, one: e.getBoundingClientRect().height < parseFloat(getComputedStyle(e).lineHeight) * 1.5 })))
    ok(lines.every((x) => x.one), 'each card\'s line is one line', lines.filter((x) => !x.one))
    await shot(p, `${tag}settings-ui-your-features`)
    await p.locator('.ft-card[data-feature="meeting-board"] input[role="switch"]').check()
    ok(!!(await until(async () => (await kit.api('/settings')).effective.trials?.['meeting-board'] === true, 5000)), 'a beta\'s switch on its card turns it on')
    await p.locator('.ft-card[data-feature="meeting-board"] .ft-open').click()
    ok(!!(await until(async () => (await p.locator('.st-tabs [role="tab"][aria-selected="true"]').innerText().catch(() => '')) === 'Meetings' && await p.locator('.modal.settings [data-setting="beta-meeting-board"] input[role="switch"]').isChecked().catch(() => false), 8000)), 'and Open goes to its own place, where its switch is first, on')
    await p.locator('.modal.settings [data-setting="beta-meeting-board"] input[role="switch"]').uncheck()
    ok(!!(await until(async () => (await kit.api('/settings')).effective.trials?.['meeting-board'] === false, 5000)), 'turned off there, it\'s off')
    // Each section and tab.
    const places = navs.flatMap((x) => (TABBED[x] ? TABBED[x].map((tab) => [x, tab]) : [[x, null]]))
    const strays = new Set()
    for (const [section, tab] of places) {
      const name = tab || section
      await nav(p, section)
      if (TABBED[section] && tab === TABBED[section][0]) {
        const tabs = p.locator('.st-head .st-tabs [role="tab"]')
        ok(JSON.stringify(await tabs.allInnerTexts()) === JSON.stringify(TABBED[section]) && (await p.locator('.st-tabs [role="tab"][aria-selected="true"]').innerText()) === TABBED[section][0], `${section}: its tabs are ${TABBED[section].join(', ')}, opened at the first`, await tabs.allInnerTexts())
      }
      if (tab) { await p.locator('.st-tabs [role="tab"]', { hasText: tab }).click(); await settled(p) }
      if (!tab) ok(await p.locator('.modal.settings .st-tabs').count() === 0, `${name}: no tabs`)
      const shown = await first(p)
      const want = (FIRST[name] || []).filter((x) => !(typeof x === 'string' ? shown.includes(x) : x.test(shown)))
      if (FIRST[name]) ok(!want.length, `${name}: what most people change shows first`, { missing: want.map(String), shown: shown.slice(0, 600) })
      const has = await adv(p).count() && await adv(p).isVisible()
      if (TABBED[section]) ok(await p.locator('.st-head p').count() === 0, `${name}: no line under the section's name, where its tabs are`)
      if (['Your Features', 'Which Model Does What', 'Speech Models', 'Spoken Answers', 'Computers', 'Remote Access', 'Share Links', 'Bots', 'MCP Servers'].includes(name)) ok(!has, `${name}: nothing under Advanced, so no Advanced`, { has })
      else ok(has && (await isOpen(p)) === false, `${name}: the rest under Advanced, at the end, closed`, { has, open: await isOpen(p) })
      // A feature out of beta: its switch here, an ordinary one.
      for (const [id, at] of Object.entries(OUT_AT)) {
        if (at !== name) continue
        const sw = p.locator(`.modal.settings [data-setting="${id}"]`).first()
        ok(await sw.isVisible() && !(await sw.locator('.st-chip.beta').count()) && !(await sw.evaluate((e) => !!e.closest('.st-beta, .st-adv'))) && await sw.locator('input[type="checkbox"]').count() >= 1, `${name}: ${id}'s switch is here, an ordinary one (no Beta mark, not under Advanced)`)
      }
      // A beta's switch, first in its place and marked.
      for (const [beta, at] of Object.entries(BETA_AT)) {
        if (at !== name || (beta === "Speakers From the Call's Video" && !IS_MAC)) continue
        const sw = p.locator('.modal.settings .st-beta, .modal.settings .mcp-self', { hasText: beta }).first()
        ok(await sw.isVisible() && await sw.locator('.st-chip.beta').count() === 1 && await sw.locator('input[role="switch"]').count() === 1, `${name}: ${beta}'s switch is here, marked Beta`)
      }
      if (ALL[name]) {
        const got = await names(p)
        // Spoken Answers' speed and Test are there only where this browser has a voice of its own
        // (none in Chromium on Linux).
        const voiced = await p.evaluate(() => (window.speechSynthesis?.getVoices?.() || []).some((v) => v.localService))
        const lost = ALL[name].filter((x) => voiced || !['select|Speed', 'button|Test'].includes(x)).filter((x) => { const [k, n] = x.split('|'); return !got.some((g) => g.startsWith(`${k}|`) && g.slice(k.length + 1).includes(n)) })
        ok(!lost.length, `${name}: every setting there was is still here`, { lost, got })
      }
      for (const id of await unknownSettings(p)) if (!known(id)) strays.add(`${name}: ${id}`)
      if (name === 'You') {
        // Enter Key (src/enter.js): Smart until another is picked; each pick kept, Smart by taking it out.
        const opts = p.locator('.modal.settings [data-setting="enter-key"] [role="radio"]')
        const said = (await opts.allInnerTexts()).map((x) => x.trim())
        ok(said.length === 3 && said[0] === 'Smart' && said[1] === 'Always Sends' && /^(⌘Enter|Ctrl\+Enter) Sends$/.test(said[2]) && (await opts.first().getAttribute('aria-checked')) === 'true', 'You: Enter Key, Smart, Always Sends or ⌘Enter Sends (Ctrl+Enter off a Mac), Smart picked', said)
        // Kept: saved, in /config, and the page showing it picked (it draws that once the save is back).
        const kept = (v, i) => until(async () => (await kit.api('/settings')).user.enterKey === v && (await kit.api('/config')).enterKey === (v || 'smart') && (await opts.nth(i).getAttribute('aria-checked')) === 'true', 5000, 100)
        await opts.nth(2).click()
        ok(!!(await kept('mod', 2)), 'You: ⌘Enter Sends picked is kept', (await kit.api('/settings')).user.enterKey)
        await opts.nth(1).click()
        ok(!!(await kept('always', 1)), 'You: Always Sends picked is kept', (await kit.api('/settings')).user.enterKey)
        await opts.nth(0).click()
        ok(!!(await kept(undefined, 0)), 'You: Smart again takes it out of your settings (the default)', (await kit.api('/settings')).user)
      }
      if (name === 'About & Updates') {
        const betas = (await p.locator('[data-setting="beta"] .ab-trial .st-check b').allInnerTexts()).map((x) => x.trim())
        ok(JSON.stringify(betas) === JSON.stringify(BETAS), 'About & Updates › Beta Features lists only the features still in beta', betas)
        const ways = await p.locator('[data-setting="beta"] .ab-trial-at').allInnerTexts()
        ok(ways.length === BETAS.length && ways.every((w) => w.trim()), 'each with the way to its own place', ways)
      }
      if (['Meetings', 'Dictation', 'Speech Models', 'Agents', 'You', 'Remote Access', 'Notifications', 'About & Updates'].includes(name)) await shot(p, `${tag}settings-ui-${name.replace(/\W+/g, '-').toLowerCase()}`)
    }
    ok(!strays.size, 'every data-setting Settings shows is one ⌘K knows (settings/search.js)', [...strays])
    ok(!navs.includes('Mail & Calendar') || IS_MAC, 'Mail & Calendar only on a Mac', navs)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- Where a link lands: each tab, and the ids that opened a section before it moved ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    const at = () => p.evaluate(() => ({ nav: document.querySelector('.st-nav-item.on > span')?.innerText.trim(), tab: document.querySelector('.st-tabs [role="tab"][aria-selected="true"]')?.innerText.trim() || null }))
    const lands = async (section, nav, tab, sel) => {
      await p.evaluate((s) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: s } })), section)
      return !!(await until(async () => { const a = await at(); return a.nav === nav && a.tab === tab && await p.locator(`.modal.settings .st-scroll ${sel}`).first().isVisible() }, 8000, 100))
    }
    ok(await lands('voice', 'Meetings & Voice', 'Speech Models', '.st-voice [data-setting="speech-model"]') && await p.locator('.modal.settings .st-dictation, .modal.settings [data-setting="spoken-answers"]').count() === 0, 'a link to "voice" (Settings closed) opens Meetings & Voice at Speech Models: the speech models, without dictation or the voice that speaks', await at())
    ok(await lands('meetings', 'Meetings & Voice', 'Meetings', '.st-meet'), 'a link to "meetings" (from another tab): Meetings', await at())
    ok(await lands('dictation', 'Meetings & Voice', 'Dictation', '.st-dictation') && await p.locator('.modal.settings .st-voice, .modal.settings .st-meet').count() === 0, 'a link to "dictation": Dictation, on its own', await at())
    ok(await lands('meetings-voice', 'Meetings & Voice', 'Meetings', '.st-meet') && await lands('voice-meetings', 'Meetings & Voice', 'Meetings', '.st-meet'), 'and the section\'s own id, and its old one: its first tab', await at())
    ok(await lands('dictation-history', 'Meetings & Voice', 'Dictation', '[data-setting="dictation-history"]') && await isOpen(p) === true, 'a setting of dictation\'s (Dictation History): the Dictation tab, Advanced opened to show it', await at())
    ok(await lands('spoken-answers', 'Meetings & Voice', 'Spoken Answers', '[data-setting="spoken-answers"]') && await lands('spoken', 'Meetings & Voice', 'Spoken Answers', '[data-setting="spoken-answers"]'), 'Spoken Answers: its own tab', await at())
    // The Dictation tab says Dictation once: no heading under the tab, and Advanced's part has its own name.
    await lands('dictation', 'Meetings & Voice', 'Dictation', '.st-dictation')
    ok(await p.locator('.st-dictation > h4').count() === 0 && /Cleanup and Mentions/.test(await adv(p).locator('summary').innerText()) && !/Dictation,/.test(await adv(p).locator('summary').innerText()), 'the Dictation tab has no Dictation heading under it, and Advanced says Cleanup and Mentions', await adv(p).locator('summary').innerText())
    // Devices & Access the same way.
    ok(await lands('phone', 'Devices & Access', 'Phone', '[data-setting="relay"]') && await p.locator('.modal.settings #st-machines, .modal.settings [data-setting="notify"]').count() === 0, 'a link to "phone": Devices & Access at Phone, the relay without your devices or notifications', await at())
    ok(await lands('machines', 'Devices & Access', 'Computers', '#st-machines') && await p.locator('.modal.settings [data-setting="relay"], .modal.settings [data-setting="remote-devices"]').count() === 0, 'a link to "machines": Computers, your devices on their own', await at())
    ok(await lands('link-device', 'Devices & Access', 'Computers', '[data-setting="link-device"]'), 'Link a device: Computers', await at())
    ok(await lands('devices', 'Devices & Access', 'Phone', '[data-setting="relay"]'), 'the section\'s own id: its first tab, Phone', await at())
    ok(await lands('remote-devices', 'Devices & Access', 'Remote Access', '[data-setting="remote-devices"]') && await p.locator('.modal.settings [data-setting="beta-remote-screen"] input[role="switch"]').isChecked() === false, 'Which Devices May Connect: Remote Access, there with Remote Screen and Preview off', await at())
    ok(await lands('sharing', 'Devices & Access', 'Share Links', '[data-setting="shares"]') && await lands('shares', 'Devices & Access', 'Share Links', '[data-setting="shares"]'), 'Share Links (what was Sharing): Devices & Access\'s last tab', await at())
    for (const id of ['this-device', 'notify', 'notify-more', 'notify-sounds', 'remote-notify']) ok(await lands(id, 'Notifications', null, `[data-setting="${id}"]`) && (id !== 'notify-more' || await isOpen(p) === true), `a link to "${id}": Notifications, at it`, await at())
    ok(await lands('notifications', 'Notifications', null, '[data-setting="this-device"]') && await p.locator('.modal.settings [data-setting="relay"], .modal.settings #st-machines').count() === 0, 'and "notifications": its own section', await at())
    ok(await lands('relay', 'Devices & Access', 'Phone', '[data-setting="relay"]') && await lands('keep-awake', 'Devices & Access', 'Phone', '[data-setting="relay"]'), 'the relay, and keeping the computer awake (not there without a relay: the relay instead): Phone', await at())
    // What opened a section before it moved lands where it is now.
    ok(await lands('general', 'You', null, '[data-setting="name"]') && await lands('appearance', 'You', null, '[data-setting="theme"]'), 'General and Appearance: You', await at())
    ok(await lands('providers', 'Agents & Models', 'Model Providers', '[data-setting="providers-labs"]') && await lands('agents', 'Agents & Models', 'Agents', '[data-setting="agent-list"]') && await lands('mcp', 'Agents & Models', 'MCP Servers', '[data-setting="mcp-server"]'), 'Model Providers, Agents and MCP Servers: Agents & Models\' tabs', await at())
    ok(await lands('model-jobs', 'Agents & Models', 'Which Model Does What', '[data-setting="model-jobs"]'), 'Models for Each Task: Which Model Does What', await at())
    ok(await lands('slack-bot', 'Bots', null, '[data-setting="bots-beta"]'), 'the Bots beta\'s id: Bots', await at())
    ok(await lands('config', 'About & Updates', null, '[data-setting="config-file"]') && await isOpen(p) === true, 'the config file: About & Updates, under Advanced', await at())
    ok(await lands('backup', 'Back Up & Move', null, '[data-setting="backup"]'), 'Back Up & Move', await at())
    ok(await lands('setup', 'Your Features', null, '[data-setting="setup"]') && await lands('all', 'Your Features', null, '.ft-grid'), 'Set up, and Settings itself: Your Features', await at())
    await lands('meetings', 'Meetings & Voice', 'Meetings', '.st-meet')
    // The section in the list, with a tab showing: it stays; from another section: the first again.
    await p.locator('.st-tabs [role="tab"]', { hasText: 'Dictation' }).click()
    await nav(p, 'Meetings & Voice')
    ok((await at()).tab === 'Dictation', 'Meetings & Voice in the list, while it shows: the tab stays', await at())
    await nav(p, 'You')
    await nav(p, 'Meetings & Voice')
    ok((await at()).tab === 'Meetings', 'from another section: Meetings again', await at())
    // Opened where it opens first (a reload, then Settings at a tab), and ⌘K says where each is.
    await p.reload()
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    ok(await lands('dictation', 'Meetings & Voice', 'Dictation', '.st-dictation'), 'Settings opened at "dictation": Dictation', await at())
    await p.locator('button[aria-label="Close settings"]').click()
    await p.keyboard.press('ControlOrMeta+K')
    await p.locator('.palette input').fill('dictation history')
    const hit = p.locator('.pal-item[data-id="s:dictation-history"]')
    ok(!!(await until(() => hit.isVisible(), 4000)) && /Settings › Meetings & Voice › Dictation/.test(await hit.innerText()), '⌘K "dictation history": in Settings › Meetings & Voice › Dictation', await p.locator('.pal-list').innerText().catch(() => ''))
    await hit.click()
    ok(!!(await until(async () => (await at()).tab === 'Dictation' && await p.locator('.modal.settings [data-setting="dictation-history"]').isVisible(), 8000, 100)), 'and it opens the Dictation tab at it', await at())
    // A beta feature's own settings are in ⌘K only while it's on; its switch always (Share Links).
    const found = async (words) => {
      await p.locator('button[aria-label="Close settings"]').click().catch(() => {})
      await p.keyboard.press('ControlOrMeta+K')
      await p.locator('.palette input').fill(words)
      await until(() => p.locator('.pal-item[data-id="s:beta-share-links"]').isVisible(), 4000)
      const ids = await p.locator('.pal-item[data-id^="s:"]').evaluateAll((l) => l.map((e) => e.dataset.id))
      await p.keyboard.press('Escape')
      return ids
    }
    const offIds = await found('share links')
    await kit.api('/settings', { trials: { 'share-links': true } }, 'PATCH')
    await p.reload()
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    const onIds = await found('share links')
    await kit.api('/settings', { trials: { 'share-links': false } }, 'PATCH')
    ok(offIds.includes('s:beta-share-links') && !offIds.includes('s:shares') && onIds.includes('s:beta-share-links') && onIds.includes('s:shares'), '⌘K "share links": its switch, on or off; the links you shared only while Share Links is on', { offIds, onIds })
    // A setting that needs another one on: greyed where it is, with Turn On, not gone.
    await kit.api('/settings', { dictation: { on: false } }, 'PATCH')
    await p.reload()
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    await lands('light-cleanup', 'Meetings & Voice', 'Dictation', '[data-setting="dictation-more"]')
    const needs = p.locator('.modal.settings [data-setting="dictation-more"] .st-needs-line')
    ok(await needs.isVisible() && /Needs Dictation on/.test(await needs.innerText()) && await p.locator('.modal.settings [data-setting="light-cleanup"]').isVisible() && await p.locator('.modal.settings [data-setting="light-cleanup"]').evaluate((e) => !!e.closest('[inert]')), 'dictation off: its extras still show, greyed, saying they need Dictation on', await needs.innerText().catch(() => ''))
    await needs.locator('button', { hasText: 'Turn On' }).click()
    ok(!!(await until(async () => (await kit.api('/settings')).effective.dictation?.on !== false && !(await needs.count()), 5000)), 'and Turn On turns dictation on, and they\'re usable')
    await shot(p, `${tag}settings-ui-needs`)
    ok(errors.length === 0, 'links: no page errors', errors)
    await ctx.close()
  }

  // ---------- Advanced: closed until opened, then kept for its section ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    const open = async (section) => { await p.evaluate((s) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: s } })), section); await p.locator('.modal.settings .st-sections').first().waitFor({ timeout: 8000 }); await settled(p) }
    await open('meetings')
    ok(await isOpen(p) === false && !(await p.locator('.st-voices, [data-setting="save-notes"]').first().isVisible()), 'Meetings: Advanced closed, what\'s in it out of sight')
    const what = await adv(p).locator('summary').innerText()
    ok(/^Advanced/.test(what) && /AI Assist/.test(what) && /Save notes as Markdown/.test(what), 'and Advanced says what\'s in it', what)
    await advanced(p)
    ok(!!(await until(() => p.locator('[data-setting="save-notes"]').isVisible(), 4000)), 'opened: Save notes as Markdown and the rest show')
    await nav(p, 'You')
    ok(await isOpen(p) === false, 'You\'s Advanced stays closed')
    await nav(p, 'Meetings & Voice')
    ok(await isOpen(p) === true, 'back to Meetings: its Advanced still open')
    await p.locator('button[aria-label="Close settings"]').click()
    await p.reload()
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    await open('meetings')
    ok(await isOpen(p) === true, 'and after a reload')
    await adv(p).locator('summary').click()
    ok(!!(await until(async () => (await isOpen(p)) === false, 3000)), 'closed again')
    await p.reload()
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    await open('meetings')
    ok(await isOpen(p) === false, 'and kept closed')

    // ---------- ⌘K finds a setting under Advanced ----------
    await p.locator('button[aria-label="Close settings"]').click()
    await p.keyboard.press('ControlOrMeta+K')
    await p.locator('.palette input').waitFor({ timeout: 5000 })
    await p.waitForTimeout(300)
    ok(await p.locator('.pal-item[data-id^="s:"]').count() === 0, '⌘K with nothing typed: no settings listed')
    await p.locator('.palette input').fill('front matter')
    const hit = p.locator('.pal-item[data-id="s:save-notes"]')
    ok(!!(await until(() => hit.isVisible(), 4000)) && /Settings › Meetings & Voice › Meetings/.test(await hit.innerText()), '⌘K "front matter": Save notes as Markdown, in Settings › Meetings & Voice › Meetings', await p.locator('.pal-list').innerText())
    await hit.click()
    const target = p.locator('.modal.settings [data-setting="save-notes"]')
    ok(!!(await until(async () => /Meetings/.test(await p.locator('.st-nav-item.on').innerText().catch(() => '')) && await target.isVisible(), 8000)) && await isOpen(p) === true, 'Settings opens at Meetings, Advanced opened to show it')
    const near = await until(() => p.evaluate(() => { const e = document.querySelector('.modal.settings [data-setting="save-notes"]'); const s = document.querySelector('.modal.settings .st-scroll'); return Math.abs(e.getBoundingClientRect().top - s.getBoundingClientRect().top) < 60 }), 4000)
    ok(!!near, 'scrolled to it, at the top of the panel')
    await shot(p, `${tag}settings-ui-found`)
    await nav(p, 'You')
    await nav(p, 'Meetings & Voice')
    ok(await isOpen(p) === false, 'opened to show it, not kept: Meetings\' Advanced is closed again next time')
    // An essential one too.
    await p.locator('button[aria-label="Close settings"]').click()
    await p.keyboard.press('ControlOrMeta+K')
    await p.locator('.palette input').fill('text size')
    ok(!!(await until(() => p.locator('.pal-item[data-id="s:text-size"]').isVisible(), 4000)), '⌘K "text size": Appearance\'s Text Size')
    await p.keyboard.press('Escape')

    // ---------- A link to one (bridge-open-settings, as Usage's Plan usage would) ----------
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'plan-usage' } })))
    ok(!!(await until(async () => /Agents & Models/.test(await p.locator('.st-nav-item.on').innerText().catch(() => '')) && await p.locator('.modal.settings [data-setting="plan-usage"]').isVisible(), 8000)), 'a link to Plan usage: General, Advanced opened at it')
    // And, from inside Settings, to one in another section.
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers-speech' } })))
    ok(!!(await until(async () => /Agents & Models/.test(await p.locator('.st-nav-item.on').innerText().catch(() => '')) && (await p.locator('.st-tabs [role="tab"][aria-selected="true"]').innerText().catch(() => '')) === 'Model Providers' && await p.locator('.modal.settings [data-setting="providers-speech"]').isVisible(), 8000)), 'from inside Settings, a link to the speech services\' keys: Model Providers, Advanced opened at them')
    // (WebKit counts a request a reload cuts off as a page error.)
    ok(withoutCutOff(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- What's on and sends what it reads off the computer: never under Advanced ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    const at = async (section) => { await p.evaluate((s) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: s } })), section); await p.locator('.modal.settings .st-sections').first().waitFor({ timeout: 8000 }); await settled(p) }
    const first = async (id) => (await p.locator(`.modal.settings [data-setting="${id}"]`).isVisible()) && !(await p.locator(`.modal.settings .st-adv [data-setting="${id}"]`).count())
    const where = () => p.locator('.modal.settings [data-notes-where]').innerText().catch(() => '')
    await at('meetings')
    for (const id of ['transcript-cleanup', 'name-speakers', ...(IS_MAC ? ['prep'] : [])]) ok(await first(id), `Meetings: ${id}, on unless turned off and read by the notes' model, first, not under Advanced`)
    ok(/No model to write them yet/.test(await where()), 'with no model: said where notes are written', await where())
    await at('agents')
    ok(await first('resume-work') && /carry on, on its own plan or key/.test(await p.locator('[data-setting="resume-work"]').innerText()), 'Agents: Pick up unfinished work first, saying the agent carries on on its own plan or key')
    if (IS_MAC) {
      await at('mail')
      ok(await first('mail-learn'), 'Mail: Learn it again now and then first, below what says where it goes')
    }
    await p.locator('button[aria-label="Close settings"]').click()
    // A key: Automatic is then that model, and where it runs is said.
    await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
    await at('meetings')
    ok(!!(await until(async () => /, at OpenAI: the transcript, and what each one below reads, go there\./.test(await where()), 10000)), 'with a key: which model writes the notes, and that what it and each one below reads goes to OpenAI', await where())
    // The one the server picks for Automatic (pickMeetingModel), as it says: the page only shows it.
    const chat = await kit.api('/chat/models')
    const auto = chat.models.find((x) => x.id === chat.automatic)
    ok(!!auto && (await where()).startsWith(`${auto.label}, at ${auto.provider}:`), 'Automatic is the model the server says it is', { automatic: chat.automatic, where: await where() })
    if (IS_MAC) {
      const prep = await p.locator('.modal.settings [data-setting="prep"] .muted').innerText()
      ok(/reads the invite and your mail with the people invited, with .+, at OpenAI\./.test(prep), 'Prepare for each meeting: it reads your mail with the people invited, with that model, at OpenAI', prep)
    }
    await p.locator('.modal.settings [data-setting="notes-model"]').scrollIntoViewIfNeeded()
    await shot(p, `${tag}settings-ui-notes-model`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- A setting found keeps its place as the rest of its section comes ----------
  // A busy computer: Set up's list and Permissions (above it) come 3 seconds after it shows. It
  // stays just where it showed, and ticked then, it ticks.
  {
    const held = []
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', before: async (c) => { await noServiceWorker(c); await c.route(/\/api\/(consult|subscriptions)(\?|$)/, (r) => held.push(r)) } })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'keep-agents' } })))
    const tick = p.locator('.modal.settings [data-setting="keep-agents"] input')
    await tick.waitFor({ timeout: 8000 })
    const y0 = (await tick.boundingBox())?.y
    await until(() => held.length >= 2, 5000)
    await sleep(3000)
    const asked = held.length
    for (const r of held.splice(0)) await r.continue().catch(() => {})
    await settled(p)
    const y1 = (await tick.boundingBox())?.y
    ok(asked >= 2 && y0 != null && Math.abs(y1 - y0) < 1, 'Settings at Keep agents running, with what\'s above it coming seconds later: it stays just where it showed', { asked, y0, y1, grew: await p.locator('.modal.settings .st-scroll').evaluate((e) => e.scrollHeight) })
    await tick.uncheck()
    ok(!!(await until(async () => (await kit.api('/settings')).effective.keepAgents === false, 5000)), 'and ticked then, it\'s the one that changes')
    await kit.api('/settings', { keepAgents: true }, 'PATCH')
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- Names from the call: Screen Recording on there, and not yet here ----------
  if (IS_MAC) {
    const said = (f) => { try { return fs.readFileSync(path.join(kit.bin, f), 'utf8') } catch { return '' } }
    fs.writeFileSync(path.join(kit.bin, 'callwatch.json'), JSON.stringify({ screen: false }))
    const go = async (p) => {
      await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'meetings' } })))
      await p.locator('.modal.settings .st-sections').first().waitFor({ timeout: 8000 })
      await settled(p)
      await advanced(p)
      return p.locator('.modal.settings .st-screen-names')
    }
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    let row = await go(p)
    const text = () => row.innerText().catch(() => '')
    ok(!!(await until(async () => /Screen Recording puts the names/.test(await text()), 8000)) && await row.locator('button', { hasText: 'Allow' }).count() === 1, 'Screen Recording off: why, and Allow', await text())
    await row.locator('button', { hasText: 'Allow' }).click()
    ok(!!(await until(async () => /Turn on Bridge AI under System Settings .* in Screen Recording/.test(await text()), 5000)) && /asked/.test(said('screen-asked')), 'Allow asks macOS, then says where to turn it on, with Open it', await text())
    await row.locator('button', { hasText: 'Open it' }).click()
    ok(!!(await until(async () => /Already on there\? macOS applies it once Bridge AI restarts\./.test(await text()), 5000)) && await row.locator('button', { hasText: 'Restart Bridge AI' }).count() === 1, 'once it\'s open there: already on there? macOS applies it once Bridge AI restarts, with Restart Bridge AI', await text())
    await row.scrollIntoViewIfNeeded().catch(() => {})
    await shot(p, `${tag}settings-ui-screen-restart`)
    await row.locator('button', { hasText: 'Restart Bridge AI' }).click()
    ok(!!(await until(async () => (await kit.api('/fix')).restart.some((x) => x.pane === 'audio') && await p.locator('.update-pop', { hasText: 'Restart to apply' }).isVisible(), 5000)), 'in a browser, Restart Bridge AI opens the top bar\'s Restart to apply, for Screen & System Audio Recording', (await kit.api('/fix')).restart)
    await p.keyboard.press('Escape')
    // Bridge AI restarted (the server too), and Screen Recording is still off: Reset, for it alone.
    const was = (await kit.api('/calls/screen')).started
    await kit.restart()
    await p.reload()
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    row = await go(p)
    const now = (await kit.api('/calls/screen')).started
    ok(now > was, 'the server says when it started, so the page can tell it restarted', { was, now })
    ok(!!(await until(async () => /Still off since Bridge AI restarted/.test(await text()), 8000)) && await row.locator('button', { hasText: 'Reset and ask again' }).count() === 1, 'still off after the restart: why, and Reset and ask again', await text())
    await row.scrollIntoViewIfNeeded().catch(() => {})
    await shot(p, `${tag}settings-ui-screen-reset`)
    const asks = said('screen-asked').split('\n').filter(Boolean).length
    await row.locator('button', { hasText: 'Reset and ask again' }).click()
    ok(!!(await until(async () => /macOS asks again/.test(await text()), 5000)) && said('tcc.log').trim() === 'reset ScreenCapture dev.bridge-ai.test' && said('screen-asked').split('\n').filter(Boolean).length === asks + 1, 'Reset forgets macOS\'s answer for Screen Recording only (not the call\'s sound) and asks again', { text: await text(), tcc: said('tcc.log') })
    // Turned on, and back to the window: seen at once, not from what the server kept.
    fs.writeFileSync(path.join(kit.bin, 'callwatch.json'), JSON.stringify({ screen: true }))
    await p.evaluate(() => window.dispatchEvent(new Event('focus')))
    ok(!!(await until(async () => /Screen Recording is on/.test(await text()), 3000)), 'turned on and back to the window: it says it\'s on straight away', await text())
    ok(withoutCutOff(errors).length === 0, 'Screen Recording: no page errors', errors)
    await ctx.close()
  }

  // ---------- A phone, dark ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'dark', theme: 'midnight', phone: true })
    await p.setViewportSize({ width: 375, height: 812 })
    await p.waitForSelector('.tabbar button', { timeout: 15000 })
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'meetings' } })))
    await p.locator('.modal.settings.phone .st-back').waitFor({ timeout: 8000 })
    await settled(p)
    await advanced(p)
    await settled(p)
    const faults = await phoneFaults(p, '.modal.settings .st-scroll')
    const box = await adv(p).locator('summary').boundingBox()
    ok(!faults.wider && !faults.past && !faults.sideways && !faults.cut, 'phone: Meetings with Advanced open, nothing wider than the screen, past its edge or cut off', faults)
    ok(box && box.height >= 40 && box.width >= 40, 'and Advanced a whole 40 px target', box)
    await shot(p, `${tag}settings-ui-phone-dark`)
    // Meetings & Voice on a phone: its name in the bar, its four tabs two by two across the top, one row in the list.
    const tabs = await p.locator('.modal.settings.phone .st-scroll .st-tabs [role="tab"]').evaluateAll((l) => l.map((e) => { const r = e.getBoundingClientRect(); return { name: e.innerText.trim(), on: e.getAttribute('aria-selected') === 'true', h: Math.round(r.height), inside: r.left >= 0 && r.right <= innerWidth } }))
    ok((await p.locator('.st-bar h3').innerText()).trim() === 'Meetings & Voice' && JSON.stringify(tabs.map((x) => x.name)) === JSON.stringify(TABS) && tabs[0].on && tabs.every((x) => x.h >= 40 && x.inside), 'phone: Voice & Meetings in the bar, its three tabs across the top at Meetings, each a whole 40 px target', tabs)
    for (const [tab, sel] of [['Dictation', '.st-dictation'], ['Speech Models', '.st-voice'], ['Spoken Answers', '.st-spoken']]) {
      await p.locator('.st-tabs [role="tab"]', { hasText: tab }).click()
      await p.locator(`.modal.settings.phone .st-scroll ${sel}`).waitFor({ timeout: 8000 }).catch(() => {})
      await settled(p)
      const f = await phoneFaults(p, '.modal.settings .st-scroll')
      ok(await p.locator(`.modal.settings.phone .st-scroll ${sel}`).isVisible() && (await p.locator('.st-tabs [role="tab"][aria-selected="true"]').innerText()) === tab && !f.wider && !f.past && !f.sideways && !f.cut, `phone: the ${tab} tab, nothing wider than the screen, past its edge or cut off`, f)
    }
    await shot(p, `${tag}settings-ui-phone-tabs`)
    await p.locator('.st-back').click()
    const rows = await p.locator('.st-list-row b').allInnerTexts()
    ok(JSON.stringify(rows.map((x) => x.replace(/\s*Beta$/i, '').trim())) === JSON.stringify(SECTIONS), 'phone: the same sections, one row each, in the list', rows)
    await p.locator('.st-list-row', { hasText: 'Meetings & Voice' }).click()
    ok(!!(await until(async () => (await p.locator('.st-tabs [role="tab"][aria-selected="true"]').innerText().catch(() => '')) === 'Meetings', 5000, 100)), 'and its row opens it at Meetings')
    ok(await p.locator('.modal.settings.phone .st-lede').count() === 0, 'phone: no line under the bar where the tabs are (the list keeps it)')
    // Devices on a phone: its three tabs across the top, each fitting.
    await p.locator('.st-back').click()
    await p.locator('.st-list-row', { hasText: 'Devices & Access' }).click()
    for (const [tab, sel] of [['Phone', '[data-setting="relay"]'], ['Computers', '#st-machines'], ['Remote Access', '[data-setting="remote-devices"]'], ['Share Links', '[data-setting="shares"]']]) {
      await p.locator('.st-tabs [role="tab"]', { hasText: tab }).click()
      await p.locator(`.modal.settings.phone .st-scroll ${sel}`).waitFor({ timeout: 8000 }).catch(() => {})
      await settled(p)
      const f = await phoneFaults(p, '.modal.settings .st-scroll')
      const dt = await p.locator('.st-tabs [role="tab"]').evaluateAll((l) => l.map((e) => { const r = e.getBoundingClientRect(); return { name: e.innerText.trim(), h: Math.round(r.height), inside: r.left >= 0 && r.right <= innerWidth } }))
      ok(await p.locator(`.modal.settings.phone .st-scroll ${sel}`).isVisible() && dt.map((x) => x.name).join('|') === 'Phone|Computers|Remote Access|Share Links' && dt.every((x) => x.h >= 40 && x.inside) && !f.wider && !f.past && !f.sideways && !f.cut, `phone: Devices & Access' ${tab} tab, its tabs two by two across the top, nothing wider than the screen, past its edge or cut off`, { f, dt })
    }
    await shot(p, `${tag}settings-ui-phone-devices`)
    // Your Features on a phone: its cards one under the other, each Open a whole target.
    await p.locator('.st-back').click()
    await p.locator('.st-list-row', { hasText: 'Your Features' }).click()
    await p.locator('.modal.settings.phone .ft-card').first().waitFor({ timeout: 8000 })
    await settled(p)
    const ff = await phoneFaults(p, '.modal.settings .st-scroll')
    const opens = await p.locator('.modal.settings.phone .ft-open').evaluateAll((l) => l.map((e) => Math.round(e.getBoundingClientRect().height)))
    ok(!ff.wider && !ff.past && !ff.sideways && !ff.cut && opens.length >= CARDS && opens.every((h) => h >= 40), 'phone: Your Features, nothing wider than the screen or cut off, each Open a whole 40 px target', { ff, opens })
    await shot(p, `${tag}settings-ui-phone-features`)
    ok(errors.length === 0, 'phone: no page errors', errors)
    await ctx.close()
  }

  // ---------- A settings file from before 3.22.0 ----------
  // Its Beta Features switches for the five out of beta all on, all off (Tidy what I say's own switch
  // on under it), or never set, beside one still in beta: as it starts, each is its own setting, as it
  // was left; the one still in beta stays in Beta Features.
  {
    const FIVE = ['home', 'routines', 'meeting-insights', 'mcp-server', 'dictation-cleanup']
    const was = {
      on: { trials: { ...Object.fromEntries(FIVE.map((id) => [id, true])), 'meeting-board': true }, dictation: { tidy: true } },
      off: { trials: Object.fromEntries(FIVE.map((id) => [id, false])), dictation: { tidy: true } },
      never: { name: 'Tester', home: undefined },
    }
    const want = {
      on: { features: { home: true, routines: true, 'meeting-insights': true, 'mcp-server': true, 'dictation-cleanup': true }, saved: { home: { on: true }, routines: { on: true }, insights: true, mcp: { on: true }, tidy: true, trials: { 'meeting-board': true } } },
      off: { features: { home: false, routines: false, 'meeting-insights': false, 'mcp-server': false, 'dictation-cleanup': false }, saved: { home: { on: false }, routines: { on: false }, insights: false, mcp: { on: false }, tidy: false, trials: undefined } },
      never: { features: { home: true, routines: true, 'meeting-insights': false, 'mcp-server': false, 'dictation-cleanup': false }, saved: { home: undefined, routines: undefined, insights: undefined, mcp: undefined, tidy: undefined, trials: undefined } },
    }
    const olds = {}
    try {
      for (const [k, config] of Object.entries(was)) olds[k] = await startKit(`settings-ui-was-${k}`, { config })
      // (Where a build of the local model came with this checkout, never set, it's on.)
      want.never.features['dictation-cleanup'] = !!(await olds.never.api('/llm')).offered
      await until(async () => (await olds.never.api('/config')).features?.['dictation-cleanup'] === want.never.features['dictation-cleanup'], 5000)
      for (const [k, o] of Object.entries(olds)) {
        const conf = await o.api('/config')
        const f = JSON.parse(fs.readFileSync(path.join(o.data, 'config.json'), 'utf8'))
        const saved = { home: f.home, routines: f.routines, insights: f.meetings?.insights, mcp: f.mcpServer, tidy: f.dictation?.tidy, trials: f.trials }
        const features = Object.fromEntries(FIVE.map((id) => [id, conf.features?.[id]]))
        ok(JSON.stringify(features) === JSON.stringify(want[k].features) && JSON.stringify(saved) === JSON.stringify(want[k].saved) && !FIVE.some((id) => id in (conf.trials || {})),
          `the Beta Features switches ${k === 'never' ? 'never set: each takes its default' : `all ${k}: each its own setting, ${k}`}${k === 'on' ? ', and the one still in beta stays one' : ''}`, { features, saved })
      }
      ok((await olds.on.api('/config')).trials?.['meeting-board'] === true, 'Live Meeting Board, still in beta, still on')
      // Restarted: each as it was saved (nothing read again from the old switches, which are gone).
      const savedOff = fs.readFileSync(path.join(olds.off.data, 'config.json'), 'utf8')
      await olds.off.restart()
      const offAgain = await olds.off.api('/config')
      ok(fs.readFileSync(path.join(olds.off.data, 'config.json'), 'utf8') === savedOff && FIVE.every((id) => offAgain.features?.[id] === false), 'all off, restarted: still off, the settings file as it was saved', offAgain.features)
      // In the app: each card and its switch as it was left, and Beta Features without them.
      for (const k of ['on', 'off']) {
        const { ctx, p, errors } = await page(b, olds[k].url)
        await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
        await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'features' } })))
        await p.locator('.ft-card[data-feature="mcp-server"]').waitFor({ timeout: 10000 })
        await settled(p)
        const states = await p.locator('.ft-card').evaluateAll((l) => Object.fromEntries(l.filter((c) => ['home', 'meeting-insights', 'routines', 'mcp-server'].includes(c.dataset.feature)).map((c) => [c.dataset.feature, c.querySelector('input[role="switch"]')?.checked])))
        ok(Object.values(states).length === 4 && Object.values(states).every((v) => v === (k === 'on')), `${k}: Your Features' cards say so`, states)
        await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
        await p.locator('.modal.settings [data-setting="beta"] .ab-trial').first().waitFor({ timeout: 10000 })
        const listed = (await p.locator('[data-setting="beta"] .ab-trial .st-check b').allInnerTexts()).map((x) => x.trim())
        ok(JSON.stringify(listed) === JSON.stringify(BETAS), `${k}: Beta Features lists only the ones still in beta`, listed)
        ok(!errors.length, `${k}: no page errors`, errors)
        await ctx.close()
      }
    } finally {
      for (const o of Object.values(olds)) o.stop()
    }
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
