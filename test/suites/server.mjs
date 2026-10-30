// The server on its own, on any platform: it starts on an empty data folder, setup and settings
// stick, a model provider can be added and used, a terminal runs a command, only Bridge AI's own
// pages can reach it (guard.js), and a question for another agent is only ever text.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { startKit, startModel, checks, until, IS_WIN } from '../lib/harness.mjs'
import { draftIn } from '../../server/promptsafe.js'

const { ok, skip, done } = checks('server')
const kit = await startKit('server', { env: { BRIDGE_TAILNET_OWNER: 'me@example.com' } }) // who this computer is on Tailscale
const model = await startModel('server')
try {
  const cfg = await kit.api('/config')
  ok(cfg && typeof cfg === 'object', 'the server answers')
  if (!IS_WIN) ok((fs.statSync(kit.data).mode & 0o077) === 0, 'its data folder is yours only (no one else on the computer can open it)', (fs.statSync(kit.data).mode & 0o777).toString(8))
  const setup = await kit.api('/setup')
  ok(setup.runtime === 'builtin' && Array.isArray(setup.usable), 'setup says which runtime and which agents it found', setup)
  ok(!(setup.usable || []).length, 'no real agent is found (only the stand-ins are on PATH)', (setup.usable || []).map((a) => a.kind))
  await kit.api('/setup', { name: 'Tester' })
  ok((await kit.api('/setup')).suggested?.name === 'Tester', 'your name is kept')

  await kit.api('/settings', { meetings: { autoSummary: false } }, 'PATCH')
  const st = await kit.api('/settings')
  ok(JSON.stringify(st).includes('"autoSummary":false'), 'a setting is kept', st)

  // A model of your own (the stand-in), used by Chat with any model.
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  const models = await kit.api('/chat/models')
  ok((models.models || []).some((m) => /openai:/.test(m.id)), 'a provider\'s models are offered once its key is in', (models.models || []).map((m) => m.id))

  // A terminal: the answer only shows if the shell ran the line (the line itself says 6*7, not 42).
  // PowerShell gets a bare expression, not echo: a kit's AppData is new, so its first command lookup
  // scans every module on the machine first (over 30 s on a CI runner).
  const sh = await kit.api('/agents/launch', { kind: 'shell', cwd: kit.home, label: 'Terminal', newSpace: 'Terminals' })
  ok(!!sh.paneId, 'a terminal starts', sh)
  const screen = async () => ((await kit.api(`/agents/${encodeURIComponent(sh.paneId)}/screen?lines=50`)).ansi || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  // Once the shell shows its prompt (PowerShell can take a few seconds to start).
  ok(!!(await until(async () => /[$#%>]$/.test((await screen()).trimEnd().split('\n').pop() || ''), 30000)), 'the shell shows its prompt', (await screen()).slice(-300))
  let seen = false
  for (let i = 0; i < 3 && !seen; i++) {
    await kit.api(`/panes/${encodeURIComponent(sh.paneId)}/text`, { text: IS_WIN ? '"bridge-" + 6*7 + "-ok"' : 'echo bridge-$((6*7))-ok', enter: true })
    seen = !!(await until(async () => (await screen()).includes('bridge-42-ok'), 10000))
  }
  ok(seen, 'it runs a command and its output can be read back', (await screen()).slice(-400))
  const fleet = await kit.api('/fleet')
  ok(JSON.stringify(fleet).includes('Terminals'), 'it\'s in its own space', null)

  // Only Bridge AI's own pages: a request as a browser would send it, and a terminal's WebSocket.
  const send = (path, headers = {}, method = 'GET') => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: kit.port, path, method, headers: { Host: `127.0.0.1:${kit.port}`, ...headers } }, (res) => { res.resume(); resolve(res.statusCode) })
    r.on('error', () => resolve(0)); r.end()
  })
  const socket = (headers = {}) => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: kit.port, path: `/api/panes/${encodeURIComponent(sh.paneId)}/attach`, headers: { Host: `127.0.0.1:${kit.port}`, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers } })
    r.on('upgrade', (res, s) => { s.destroy(); resolve(res.statusCode) })
    r.on('response', (res) => { res.resume(); resolve(res.statusCode) })
    r.on('error', () => resolve(0)); r.end()
  })
  const own = `http://127.0.0.1:${kit.port}`
  ok(await send('/api/config', { Origin: own, 'Sec-Fetch-Site': 'same-origin' }) === 200, 'its own page is answered')
  ok(await send('/api/config', { Origin: 'http://localhost:8000' }) === 403, 'a page on another localhost port is refused (a project\'s dev server in Preview, say)')
  ok(await send('/api/config', { Origin: `http://127.0.0.1:${kit.port + 1}` }) === 403, 'the same address on another port is refused')
  ok(await send('/api/config', { Origin: 'https://example.tail1234.ts.net' }) === 403, 'another Tailscale site is refused')
  const ts = { Host: 'my-mac.tail1234.ts.net', Origin: 'https://my-mac.tail1234.ts.net' }
  ok(await send('/api/config', { ...ts, 'Tailscale-User-Login': 'me@example.com' }) === 200, 'its own Tailscale address is answered for you, signed in on your phone')
  ok(await send('/api/config', { ...ts, 'Tailscale-User-Login': 'someone@example.com' }) === 403 && await send('/api/config', ts) === 403, 'not for someone else on the tailnet, or a visitor Tailscale can\'t name (Funnel, a tagged device)')
  ok(await send('/api/config', { Host: `127.0.0.1:${kit.port + 1}`, Origin: `http://127.0.0.1:${kit.port + 1}` }) === 200, 'the hot-reloading UI is answered (npm start -- dev, whose proxy keeps the Host)')
  ok(await send('/api/config', { Host: 'evil.example:80' }) === 403, 'another Host is refused (DNS rebinding)')
  ok(await send('/api/config', { 'Sec-Fetch-Site': 'cross-site' }) === 403 && await send('/api/config', { 'Sec-Fetch-Site': 'same-site' }) === 403, 'a link or picture on another site can\'t reach the API')
  ok(await send('/api/config', { 'Sec-Fetch-Site': 'none' }) === 200 && await send('/api/config') === 200, 'typing the address, or a program like the CLI, is answered')
  ok(![0, 403].includes(await send(`/api/agents/${encodeURIComponent(sh.paneId)}/site/index.html`, { 'Sec-Fetch-Site': 'cross-site' })), 'an HTML preview\'s own files still load from its sandbox')
  ok(await send(`/api/agents/${encodeURIComponent(sh.paneId)}/site/index.html`, { 'Sec-Fetch-Site': 'cross-site' }, 'POST') === 403, 'but nothing else from another site')
  const framed = await Promise.all(['/', '/index.html'].map((p) => fetch(`${kit.url}${p}`).then((r) => r.headers.get('content-security-policy'))))
  ok(framed.every((c) => /frame-ancestors 'self'/.test(c || '')), 'the page can\'t be framed by another site', framed)
  ok(await socket({ Origin: own }) === 101 && await socket() === 101, 'a terminal\'s WebSocket opens from its own page and from the CLI')
  ok(await socket({ Origin: 'http://localhost:8000' }) !== 101, 'a page on another localhost port can\'t type into a terminal')
  ok(await socket({ Origin: 'https://example.tail1234.ts.net' }) !== 101, 'nor can another Tailscale site')
  ok(await socket({ Host: 'my-mac.tail1234.ts.net', Origin: 'https://my-mac.tail1234.ts.net', 'Tailscale-User-Login': 'someone@example.com' }) !== 101 && await socket({ Host: 'my-mac.tail1234.ts.net', Origin: 'https://my-mac.tail1234.ts.net', 'Tailscale-User-Login': 'me@example.com' }) === 101, 'through Tailscale, only you can open a terminal')

  // Discard throws a new file away, but never one a link in the repo leads out to. (On Windows the
  // test server's PATH is the system folders only, with no git, so there's nothing to discard with.)
  if (IS_WIN) skip('Discard and links out of the agent\'s folder', 'no git on the Windows test server\'s PATH')
  else {
    const outside = path.join(kit.dir, 'outside')
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'not the agent\'s')
    execFileSync('git', ['init', '-q'], { cwd: kit.home })
    fs.symlinkSync(outside, path.join(kit.home, 'link'), 'dir')
    fs.writeFileSync(path.join(kit.home, 'new.txt'), 'made by the agent')
    const discard = (p) => kit.api(`/agents/${encodeURIComponent(sh.paneId)}/discard`, { path: p }).then((r) => r, (e) => ({ error: e.message }))
    const away = await discard('link/keep.txt')
    ok(fs.existsSync(path.join(outside, 'keep.txt')) && !!away?.error, 'Discard won\'t delete a file a link leads out of the agent\'s folder to', away)
    const thrown = await discard('new.txt')
    ok(!fs.existsSync(path.join(kit.home, 'new.txt')), 'and still throws a new file away', thrown)
  }

  // What's typed in Claude's input box, before a message goes in (promptsafe.js), on screens as
  // Claude Code 2.1 draws them: the ❯ greys while it works, its cursor is an inverse cell, and a
  // placeholder or suggestion is faint, possibly starting under the cursor.
  const rule = `\x1b[0;38;2;138;138;138m${'─'.repeat(40)}\x1b[0m\r`
  const box = (...rows) => ['output\r', rule, ...rows, rule, '  footer\r'].join('\n')
  ok(draftIn(box('\x1b[0;38;2;102;102;102m❯\xa0\x1b[0;7m \x1b[0m\r')) === '', 'the input box: empty while it works (grey ❯, the cursor)')
  ok(draftIn(box('❯\xa0\x1b[0;7mR\x1b[0;38;2;153;153;153mun the tests again\x1b[0m\r')) === '', 'a suggested next message, faint under the cursor, isn\'t typed text')
  ok(draftIn(box('\x1b[0;38;2;102;102;102m❯\xa0\x1b[0mhalf typed\x1b[0;7m \x1b[0m\r')) === 'half typed', 'what\'s typed is seen while it works, too')
  ok(draftIn(box('❯\xa0first line\r', '  second line\r')) === 'first line\nsecond line', 'and every line of it')
} catch (e) {
  ok(false, `crashed: ${e.message}`)
  console.log(kit.log().slice(-1500))
} finally {
  kit.stop(); model.stop()
}

// Asking another agent (POST /api/consult, the chief's `bridge ask`): the question reaches it as one
// piece of text, whatever's in it, and nothing in it runs. On Windows an npm-installed agent is a .cmd
// that only cmd.exe runs, where & | " ^ % mean something. The stand-in Claude says what it was asked.
const STAND_IN = `const a = process.argv.slice(2)
if (a.includes('--version')) { console.log('2.1.312 (Claude Code)'); process.exit(0) }
if (a[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' })); process.exit(0) }
const i = a.indexOf('-p')
process.stdout.write(JSON.stringify({ prompt: a[i + 1], rest: a.slice(i + 2) }))
`
const asker = await startKit('server-consult', {
  env: ({ bin }) => {
    const js = path.join(bin, 'claude.cjs')
    fs.writeFileSync(js, STAND_IN)
    if (IS_WIN) fs.writeFileSync(path.join(bin, 'claude.cmd'), `@"${process.execPath}" "${js}" %*\r\n`)
    else fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 })
    // A stand-in bridgecal (native/bridgecal.swift): says what's in calask.txt, and notes each ask
    // (run with nothing after it). events: one meeting, at 16:00 UTC on the first day, when granted.
    const cal = path.join(bin, 'calask.cjs')
    fs.writeFileSync(cal, `const fs = require('fs'), p = require('path'), a = process.argv.slice(2), said = fs.readFileSync(p.join(__dirname, 'calask.txt'), 'utf8')
if (!a.length) fs.appendFileSync(p.join(__dirname, 'calask.log'), 'asked\\n')
if (a[0] === 'events' && said.trim() === 'granted') process.stdout.write(JSON.stringify([{ title: 'Standup', calendar: 'Work', start: a[1] + 'T16:00:00Z', end: a[1] + 'T16:15:00Z', allDay: false, location: 'Microsoft Teams Meeting', canceled: false, url: '', notes: 'Plan the week\\n________________\\nhttps://teams.microsoft.com/l/meetup-join/abc', attendees: ['Ana Lee', 'bo@example.com'] }]))
else process.stdout.write(said)`)
    fs.writeFileSync(path.join(bin, 'calask'), `#!/bin/sh\nexec "${process.execPath}" "${cal}" "$@"\n`, { mode: 0o755 })
    // A stand-in for the Mac's own speech (native/bridgespeech.swift): it has English.
    const speech = path.join(bin, 'speech.cjs')
    fs.writeFileSync(speech, `const a = process.argv.slice(2); process.stdout.write(a[0] === 'status' ? JSON.stringify({ available: true, installed: true, locale: 'en-US' }) : 'hello from the Mac')`)
    fs.writeFileSync(path.join(bin, 'speech'), `#!/bin/sh\nexec "${process.execPath}" "${speech}" "$@"\n`, { mode: 0o755 })
    return { BRIDGE_CALASK: path.join(bin, 'calask'), BRIDGE_SPEECH: path.join(bin, 'speech') }
  },
})
try {
  const marks = path.join(asker.dir, 'ran')
  const q = `R&D said "hi" & echo ran> "${marks}-1" | more\na" & echo ran> "${marks}-2" & "b ^caret %PATH% <x> (y) !z! ; , \\"end\\\\`
  const r = await asker.api('/consult', { who: 'claude', prompt: q, via: 'cli' })
  let got = null
  try { got = JSON.parse(r.text) } catch { /* shown below */ }
  // cmd.exe ends a command at a line break, so on Windows that's a space; the rest arrives as it was.
  const want = IS_WIN ? q.replace(/\n/g, ' ') : q
  ok(got?.prompt === want && got.rest.length === 0, 'the question reaches the agent as one piece of text, quotes, & | ^ % and all', { got: got?.prompt, rest: got?.rest, text: r.text || r.error })
  ok(!fs.existsSync(`${marks}-1`) && !fs.existsSync(`${marks}-2`), 'and nothing in it runs')

  // Allow access for Calendars: macOS is asked first (bridgecal), so Bridge AI is in its list; System
  // Settings opens only when you'd said no. (Tests open nothing: the open comes back as a dry run.)
  if (process.platform === 'darwin') {
    const answer = (w) => fs.writeFileSync(path.join(asker.bin, 'calask.txt'), `${w}\n`)
    const allow = () => asker.api('/fix/settings', { pane: 'calendars' }, 'POST').then((r) => r, (e) => ({ error: e.message }))
    answer('granted')
    const yes = await allow()
    ok(yes?.state === 'ok' && !yes.dryRun, 'Allow access for Calendars asks macOS, and a yes is the end of it', yes)
    answer('denied')
    const no = await allow()
    ok(no?.dryRun === true && no.state !== 'ok', 'a no from before opens System Settings, where Bridge AI is listed now', no)
    answer('restricted')
    ok(/profile on this Mac/.test((await allow())?.error || ''), 'a Mac whose profile forbids it says so')
    ok(fs.readFileSync(path.join(asker.bin, 'calask.log'), 'utf8').split('\n').filter(Boolean).length === 3, 'macOS is asked each time')

    // Checking and reading go through bridgecal too: icalBuddy sees no calendars on current macOS,
    // even once Bridge AI may see them. Neither asks macOS anything.
    const access = () => asker.api('/fix/check?pane=calendars').then((r) => r.state, (e) => e.message)
    const read = () => asker.api('/calendar?refresh=1').then((r) => r, (e) => ({ error: e.message }))
    answer('granted')
    ok(await access() === 'ok', 'Calendars allowed: the check says so, through bridgecal')
    const c = await read()
    const ev = [...(c.today || []), ...(c.tomorrow || [])].find((e) => e.title === 'Standup')
    ok(!!ev && ev.calendar === 'Work' && /teams\.microsoft\.com\/l\/meetup-join/.test(ev.join || '') && ev.agenda === 'Plan the week' && ev.location === null && ev.attendees.join('|') === 'Ana Lee|bo', 'and the calendar reads through it: the join link, the agenda, who\'s coming', c)
    answer('denied')
    ok(await access() === 'denied', 'Calendars turned off: the check says so')
    ok(/isn't allowed to see your calendars/.test((await read()).error || ''), 'and the calendar says to allow it, rather than showing nothing')
    ok(fs.readFileSync(path.join(asker.bin, 'calask.log'), 'utf8').split('\n').filter(Boolean).length === 3, 'checking and reading never ask macOS')
  }

  // whisper.cpp picked but not on this computer: the Mac's own speech stands in when it has the
  // language, so a meeting still turns into text instead of waiting on an install.
  if (!IS_WIN) {
    await asker.api('/settings', { meetings: { engine: 'local' } }, 'PATCH')
    const sp = await asker.api('/speech')
    ok(sp.engine === 'local' && sp.ready === true && sp.standIn === 'apple' && !sp.needs, 'whisper.cpp picked but not here: the Mac\'s own speech stands in, and nothing is asked of you', { engine: sp.engine, ready: sp.ready, standIn: sp.standIn, needs: sp.needs, apple: sp.apple })
    ok(sp.local?.program === null && sp.local?.ready === false, 'and whisper.cpp itself still shows as not here, so Settings keeps offering it', sp.local)
  }
} catch (e) {
  ok(false, `asking an agent crashed: ${e.message}`)
  console.log(asker.log().slice(-1500))
} finally {
  asker.stop()
}
process.exit(done().fail ? 1 : 0)
