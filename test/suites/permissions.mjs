// Permissions, one way everywhere (src/permissions.js, src/components/PermissionFix.jsx,
// desktop/permissions.js, server/fixes.js), with macOS's answers simulated and nothing real asked:
//   The desktop app's side, with a stand-in for Electron's systemPreferences: macOS's own question
//   first (the mic's askForMediaAccess, Accessibility's prompt), System Settings and the tile only
//   once it has said no; Reset and ask again forgets this app's answer (tccutil, its bundle id) and
//   asks again; from source there's nothing of Bridge AI's to reset; Windows opens its own Settings;
//   Linux has nothing to allow.
//   Which permissions each kind of computer lists (macOS, Windows, Linux and Docker).
//   The server: what the desktop app says it's allowed, seen from elsewhere; another device asking
//   this one (the app's own feed hears it); Reset with a stand-in tccutil; Automation asked of
//   Finder first; and the Permissions list answering at once with Desktop, Documents and Downloads
//   acting like macOS's protected folders (scripts/tcc-sim.mjs), so opening it asks nothing.
//   Settings › General › Permissions, with stand-ins for the desktop app (window.bridgeApp) and for
//   the server's answers: macOS's question first, noticed with no click, stuck then Reset and ask
//   again, Restart to apply and back to where you were, Windows, a browser, Linux; another device's
//   page shown in this window (Ask that device, never this window's app); and a desktop app older
//   than the page (Update Bridge AI, one click, and the top bar's Update for the app).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { startKit, checks, until, sleep, browser, page, shot, noServiceWorker, ROOT, OUT, IS_MAC, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('permissions')
// A stood-in answer for a request the page made, which may come after the page has closed (a slow
// machine): then there's no one to answer, and that's fine.
const safe = (fn) => async (r) => { try { await fn(r) } catch { /* the page went meanwhile */ } }
const require = createRequire(import.meta.url)

// ---------- The desktop app's side (desktop/permissions.js), macOS simulated ----------
try {
  const { create } = require(path.join(ROOT, 'desktop', 'permissions.js'))
  // macOS's answers: the mic's (granted, denied, not-determined), whether Accessibility is on, and
  // what the person says when macOS asks. Everything asked of it is logged.
  const mac = ({ mic = 'not-determined', ax = false, says = 'granted', platform = 'darwin', id = 'dev.bridge-ai.app', paste = true } = {}) => {
    const log = []
    const st = { mic, ax }
    const sys = {
      getMediaAccessStatus: () => st.mic,
      askForMediaAccess: async () => { log.push('ask-mic'); if (st.mic === 'not-determined') st.mic = says; return st.mic === 'granted' },
      isTrustedAccessibilityClient: (prompt) => { if (prompt) log.push('ask-ax'); return st.ax },
    }
    const p = create({
      platform, systemPreferences: sys, bundleId: () => id, paste: () => paste,
      openExternal: async (u) => { log.push(`open ${u}`) },
      showTile: async (k) => { log.push(`tile ${k}`); return true },
      tccutil: async (args) => { log.push(`tccutil ${args.join(' ')}`); if (args[1] === 'Microphone') st.mic = 'not-determined'; if (args[1] === 'Accessibility') st.ax = false },
    })
    return { p, log, st }
  }
  {
    const { p, log } = mac()
    const r = await p.ask('microphone')
    ok(r === 'ok' && log.join('|') === 'ask-mic', 'the mic not asked yet: macOS\'s own question, and nothing opened', log)
  }
  {
    const { p, log } = mac({ says: 'denied' })
    const r = await p.ask('microphone')
    ok(r === 'denied' && !log.some((l) => l.startsWith('open')), 'turned down just now: that\'s the answer, System Settings isn\'t pushed at you', log)
    await p.ask('microphone')
    ok(log.filter((l) => l === 'ask-mic').length === 1 && log.includes('open x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone') && log.includes('tile microphone'), 'asked again after a no: macOS has no question left, so its page of System Settings and the tile', log)
  }
  {
    const { p, log, st } = mac({ ax: false })
    ok(p.status('accessibility') === 'ask', 'Accessibility, never asked: "not asked yet"')
    const first = await p.ask('accessibility')
    const second = await p.ask('accessibility')
    ok(first === 'asked' && log[0] === 'ask-ax' && log[1] === 'tile accessibility' && second === 'opened' && log.includes('open x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'), 'Accessibility: macOS\'s prompt the first time (with the tile), its page after', log)
    st.ax = true
    ok(p.status('accessibility') === 'ok' && await p.ask('accessibility') === 'ok', 'turned on: noticed without asking, and asking says it\'s on')
  }
  {
    const { p, log } = mac({ mic: 'granted' })
    const r = await p.reset('microphone')
    ok(log[0] === 'tccutil reset Microphone dev.bridge-ai.app' && log[1] === 'ask-mic' && r === 'ok', 'Reset and ask again (the mic): this app\'s answer forgotten by its bundle id, then macOS asks again', log)
    const ax = mac({ ax: true })
    await ax.p.ask('accessibility')
    const r2 = await ax.p.reset('accessibility')
    ok(ax.log.includes('tccutil reset Accessibility dev.bridge-ai.app') && ax.log.includes('tccutil reset PostEvent dev.bridge-ai.app') && ax.log.at(-2) === 'ask-ax' && r2 === 'asked', 'and Accessibility: both its answers forgotten, and macOS\'s prompt again', ax.log)
  }
  {
    const { p, log } = mac({ id: null })
    ok(await p.reset('microphone') === null && !p.canReset('microphone') && !log.length, 'from source (Electron\'s own app): nothing of Bridge AI\'s to reset, so no Reset offered', log)
    ok(!mac({ paste: false }).p.kinds().includes('accessibility'), 'Accessibility only where pasting where you\'re typing can work')
  }
  {
    const { p, log } = mac({ platform: 'win32', mic: 'denied' })
    const r = await p.ask('microphone')
    ok(p.kinds().join() === 'microphone,notifications' && r === 'opened' && log.join('|') === 'open ms-settings:privacy-microphone' && await p.reset('microphone') === null, 'Windows: the mic and notifications, its own Settings page, no tile and nothing to reset', log)
    const linux = mac({ platform: 'linux' })
    ok(!linux.p.kinds().length && linux.p.status('microphone') === null && await linux.p.ask('microphone') === null, 'Linux: nothing to allow')
  }
  {
    // Input Monitoring (Fn or the right ⌥ as the dictation key): only once one is picked; looked up
    // through the helper without asking, macOS's own question once, then System Settings; Accessibility
    // covers it too.
    let listening = false
    let trusted = false
    const log = []
    const sys = { getMediaAccessStatus: () => 'granted', isTrustedAccessibilityClient: () => trusted }
    const mk = (lone) => create({
      platform: 'darwin', systemPreferences: sys, bundleId: () => 'dev.bridge-ai.app', lone: () => lone,
      listen: { access: async () => listening, ask: async () => { log.push('listen-ask'); return listening } },
      openExternal: async (u) => { log.push(`open ${u}`) }, showTile: async (k) => { log.push(`tile ${k}`) }, tccutil: async (args) => { log.push(`tccutil ${args.join(' ')}`) },
    })
    ok(!mk(false).kinds().includes('input-monitoring') && mk(true).kinds().includes('input-monitoring'), 'Input Monitoring only once Fn or the right ⌥ is the key')
    const p = mk(true)
    const before = await p.status('input-monitoring')
    const first = await p.ask('input-monitoring')
    const second = await p.ask('input-monitoring')
    ok(before === 'ask' && first === 'asked' && log[0] === 'listen-ask' && log[1] === 'tile input-monitoring' && second === 'opened' && log.includes('open x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'), 'Input Monitoring: macOS asked the first time (with the tile), its page after', log)
    listening = true
    ok(await p.status('input-monitoring') === 'ok' && (await p.all())['input-monitoring'] === 'ok', 'allowed: noticed without asking, and told the server')
    listening = false
    log.length = 0
    await p.reset('input-monitoring')
    ok(log[0] === 'tccutil reset ListenEvent dev.bridge-ai.app' && log[1] === 'listen-ask', 'Reset and ask again: its answer forgotten, and asked again', log)
    trusted = true
    ok(await mk(true).status('input-monitoring') === 'ok', 'Accessibility on (pasting where you\'re typing): nothing more to allow')
  }
} catch (e) { ok(false, `the desktop app's side: ${e.message}`) }

// ---------- Which permissions each kind of computer lists (server/fixes.js) ----------
try {
  process.env.BRIDGE_HOME = path.join(OUT, 'kits', 'permissions-rows')
  const { rowsFor } = await import(pathToFileURL(path.join(ROOT, 'server', 'fixes.js')).href)
  const mac = rowsFor({ os: 'mac', desktop: true, paste: true, callSound: true, trash: false })
  ok(mac.join() === 'microphone,accessibility,calendars,full-disk,files,audio,automation,notifications', 'a Mac with the desktop app: everything it may ask for', mac)
  ok(rowsFor({ os: 'mac', desktop: true, listen: true }).includes('input-monitoring') && !rowsFor({ os: 'mac', desktop: true }).includes('input-monitoring') && !rowsFor({ os: 'win', desktop: true, listen: true }).includes('input-monitoring'), 'Input Monitoring listed only on a Mac with Fn or the right ⌥ as the key')
  ok(!rowsFor({ os: 'mac', desktop: true, trash: true }).includes('automation') && !rowsFor({ os: 'mac', desktop: true }).includes('audio') && !rowsFor({ os: 'mac', desktop: true }).includes('accessibility'), 'macOS 15 (its own trash): no Automation; no call\'s sound recorder: no Screen & System Audio; no pasting: no Accessibility')
  const term = rowsFor({ os: 'mac', desktop: false, trash: true })
  ok(term.join() === 'calendars,full-disk,files', 'a Mac running Bridge AI from a terminal: only what the server reads (the app\'s own aren\'t there)', term)
  ok(rowsFor({ os: 'win', desktop: true }).join() === 'microphone,notifications' && !rowsFor({ os: 'win' }).length, 'Windows: the mic and notifications, with the desktop app')
  ok(!rowsFor({ os: 'linux', desktop: true }).length && !rowsFor({ os: 'linux' }).length, 'Linux and Docker: nothing (nothing asks there)')
} catch (e) { ok(false, `which permissions each computer lists: ${e.message}`) }

// ---------- The server ----------
const kit = await startKit('permissions', {
  env: ({ home, bin }) => ({
    NODE_OPTIONS: `--import ${pathToFileURL(path.join(ROOT, 'scripts', 'tcc-sim.mjs')).href}`,
    SIM_PROTECTED: ['Documents', 'Downloads', 'Desktop'].map((d) => path.join(home, d)).join(':'),
    SIM_MS: '8000',
    BRIDGE_FIX_BUNDLE_ID: 'dev.bridge-ai.test',
    BRIDGE_TCCUTIL: path.join(bin, IS_WIN ? 'tccutil.cmd' : 'tccutil'),
    BRIDGE_OSASCRIPT: path.join(bin, IS_WIN ? 'osascript.cmd' : 'osascript'),
  }),
})
// tccutil and osascript stand-ins: each says what it was asked (tcc.log); osascript answers as
// osascript.json says (Finder allowed, or -1743).
kit.program('tccutil', `require('node:fs').appendFileSync(require('node:path').join(__dirname, 'tcc.log'), process.argv.slice(2).join(' ') + '\\n')\n`)
kit.program('osascript', `const fs = require('node:fs'), p = require('node:path')
fs.appendFileSync(p.join(__dirname, 'tcc.log'), 'osascript ' + process.argv.slice(2).join(' ') + '\\n')
let a = 'ok'; try { a = JSON.parse(fs.readFileSync(p.join(__dirname, 'osascript.json'), 'utf8')).answer } catch {}
if (a === 'ok') { console.log('Finder'); process.exit(0) }
console.error('execution error: Not authorized to send Apple events to Finder. (-1743)'); process.exit(1)
`)
const tcc = () => { try { return fs.readFileSync(path.join(kit.bin, 'tcc.log'), 'utf8') } catch { return '' } }
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  try {
    for (const d of ['Desktop', 'Documents', 'Downloads']) fs.mkdirSync(path.join(kit.home, d), { recursive: true })
    const t0 = Date.now()
    const l = await kit.api('/fix/list')
    const ms = Date.now() - t0
    ok(ms < 4000 && !/\[tcc-sim\] FROZE/.test(kit.log()), `the Permissions list answers at once, without a look into Desktop, Documents or Downloads (${ms} ms)`, kit.log().match(/\[tcc-sim\].*/g))
    if (IS_MAC) ok(l.items.map((i) => i.pane).join().startsWith('calendars,full-disk,files') && l.items.find((i) => i.pane === 'files').state === 'unknown', 'here (a Mac, from a terminal): what the server reads, the folders not looked at', l.items)
    else ok(!l.items.length || IS_WIN, 'here (not a Mac): nothing to list', l.items)
    await kit.api('/fix/desktop', { version: '3.8.0', states: { microphone: 'denied', accessibility: 'ask', notifications: 'unknown', bogus: 'ok' } })
    const after = await kit.api('/fix/list')
    const fix = await kit.api('/fix')
    const mic = (await kit.api('/fix/check?pane=microphone')).state
    if (IS_MAC || IS_WIN) ok(after.items.some((i) => i.pane === 'microphone' && i.state === 'denied') && mic === 'denied', 'what the desktop app says it\'s allowed is seen here too (from a phone or another device)', [after.items, mic])
    else ok(!after.items.length, 'Linux: still nothing, whatever an app says', after.items)
    ok(fix.desktop?.version === '3.8.0' && fix.desktop.listening === false && typeof fix.device === 'string', 'the desktop app\'s version, not listening yet, and this computer\'s name', fix)
  } catch (e) { ok(false, `crashed: ${String(e.message).split('\n')[0]}`) }
  try {
    // Another device asks this computer: the desktop app's own feed hears it.
    const ac = new AbortController()
    const heard = []
    const feed = fetch(`${kit.url}/api/events`, { headers: { Accept: 'text/event-stream', 'x-bridge-desktop': '3.8.0' }, signal: ac.signal }).then(async (r) => {
      const dec = new TextDecoder()
      for await (const c of r.body) heard.push(dec.decode(c))
    }).catch(() => {})
    await until(async () => (await kit.api('/fix')).desktop?.listening, 5000, 100)
    if (IS_MAC || IS_WIN) {
      const r = await kit.api('/fix/ask-here', { pane: 'microphone' })
      ok(r.told && !!(await until(() => /event: fix-ask\ndata: \{"pane":"microphone"/.test(heard.join('')), 4000, 100)), 'another device asks for the mic here: the desktop app\'s feed hears it, to show macOS\'s question', heard.join('').slice(-300))
      ok((await kit.api('/fix')).asked?.pane === 'microphone', 'and this computer\'s Settings can say it was asked')
    } else ok(await kit.api('/fix/ask-here', { pane: 'microphone' }).then(() => false, (e) => /Nothing to allow/.test(e.message)), 'Linux: there\'s nothing to ask for')
    ac.abort()
    await feed
  } catch (e) { ok(false, `crashed: ${String(e.message).split('\n')[0]}`) }
  if (!IS_MAC) skip('Reset and Automation on the server', 'they\'re macOS\'s')
  else try {
    const r = await kit.api('/fix/reset', { pane: 'microphone' })
    await kit.api('/fix/reset', { pane: 'files', folder: 'Desktop' })
    ok(/^reset Microphone dev\.bridge-ai\.test$/m.test(tcc()) && /^reset SystemPolicyDesktopFolder dev\.bridge-ai\.test$/m.test(tcc()) && !/SystemPolicyDocumentsFolder/.test(tcc()) && r.reset?.[0] === 'Microphone', 'Reset: tccutil forgets this app\'s answer only (its bundle id), and for the folder asked about only', tcc())
    const relay = await fetch(`${kit.url}/api/fix/reset`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-relay': 'phone' }, body: JSON.stringify({ pane: 'microphone' }) })
    ok(!relay.ok && /on your computer/.test((await relay.json()).error), 'never from a phone or another device: only on the computer itself', relay.status)
    ok((await kit.api('/fix')).canReset === true, 'Reset is offered (the app\'s own answers to forget)')
    const before = kit.log().length
    const a = await kit.api('/fix/settings', { pane: 'automation' })
    ok(a.state === 'ok' && /osascript -e tell application "Finder" to get name/.test(tcc()) && !/Privacy_Automation/.test(kit.log().slice(before)), 'Automation: Finder asked first (macOS\'s own question), and said yes: nothing opened', [a, kit.log().slice(before)])
    fs.writeFileSync(path.join(kit.bin, 'osascript.json'), JSON.stringify({ answer: 'no' }))
    await kit.api('/fix/settings', { pane: 'automation' })
    ok(/open x-apple\.systempreferences:com\.apple\.preference\.security\?Privacy_Automation/.test(kit.log().slice(before)) && (await kit.api('/fix/check?pane=automation')).state === 'denied', 'said no: its page of System Settings, and it\'s known to be off', kit.log().slice(before))
    fs.writeFileSync(path.join(kit.bin, 'osascript.json'), JSON.stringify({ answer: 'ok' }))
    ok((await kit.api('/fix/check?pane=automation')).state === 'ok', 'turned on: noticed (asking again asks nothing once it\'s answered)')
  } catch (e) { ok(false, `crashed: ${String(e.message).split('\n')[0]}`) }

  // ---------- Settings › General › Permissions ----------
  await kit.api('/setup', { name: 'Tester' })
  // The server's answers stood in (a Mac's, whatever these tests run on), and the desktop app too:
  // macOS simulated in the page (window.__perm), every ask, open, reset and tile logged.
  const MAC_FIX = { mac: true, win: false, app: { name: 'Bridge AI', bundle: '/Applications/Bridge AI.app', desktop: true }, panes: {}, restart: [], tools: { brew: false }, canReset: true, desktop: { version: '3.8.0', listening: true }, asked: null, device: 'Studio Mac' }
  const rows = (panes, states = {}) => ({ items: panes.map((p) => ({ pane: p, state: states[p] || 'unknown' })) })
  const ALL = ['microphone', 'accessibility', 'calendars', 'full-disk', 'files', 'automation', 'notifications']
  const settings = async (p) => {
    await p.locator('button[aria-label="Settings"]').first().click()
    const s = p.locator('.st-perms')
    await s.waitFor({ timeout: 10000 }).catch(() => {})
    return s
  }
  const row = (s, pane) => s.locator(`.perm-row[data-pane="${pane}"]`)
  // fixState: what /api/fix says; server: the panes the server answers for ({ check, settings,
  // claim }), with every request kept; app: the desktop app's stand-in, or null; ua: its user agent.
  const open = (o) => page(b, kit.url, {
    before: async (c) => {
      await noServiceWorker(c)
      const srv = o.server || {}
      const seen = []
      c.__seen = seen
      await c.route(/\/api\/fix(\/[\w-]+)?(\?.*)?$/, safe(async (r) => {
        const u = new URL(r.request().url())
        const sub = u.pathname.replace(/^.*\/api\/fix/, '')
        seen.push(`${r.request().method()} ${sub || '/'}${u.search} ${r.request().postData() || ''}`)
        if (sub === '') return r.fulfill({ json: { ...MAC_FIX, ...(typeof o.fix === 'function' ? o.fix() : o.fix || {}) } })
        if (sub === '/list') return r.fulfill({ json: o.list })
        if (sub === '/check') { const pn = u.searchParams.get('pane'); return r.fulfill({ json: { pane: pn, state: srv.check?.(pn) || o.list.items.find((i) => i.pane === pn)?.state || 'denied' } }) }
        if (sub === '/settings') return r.fulfill({ json: srv.settings?.(JSON.parse(r.request().postData() || '{}')) || { ok: true } })
        if (sub === '/claim') { srv.claim?.(); return r.fulfill({ json: { state: 'restart' } }) }
        return r.fulfill({ json: { ok: true } })
      }))
      // The desktop app's version, as Electron puts it in its user agent.
      if (o.ua) await c.addInitScript((v) => { const ua = `${navigator.userAgent} BridgeAI/${v}`; Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => ua, configurable: true }) }, o.ua)
      if (o.updates) await c.route(/\/api\/updates(\/install)?(\?.*)?$/, safe((r) => { seen.push(`${r.request().method()} updates ${r.request().postData() || ''}`); return r.fulfill({ json: r.request().method() === 'POST' ? { started: true } : o.updates }) }))
      if (o.app !== null) {
        await c.addInitScript((a) => {
          const st = { microphone: 'ask', accessibility: 'ask', notifications: 'unknown', ...(a.st || {}) }
          const P = window.__perm = { calls: [], st, stuck: !!a.stuck }
          const ask = async (k) => {
            P.calls.push(`ask:${k}`)
            if (st[k] === 'ok') return 'ok'
            if (k === 'microphone' && st[k] === 'ask') { st[k] = a.says || 'ok'; return st[k] }
            if (k === 'accessibility' && st[k] === 'ask') { st[k] = 'denied'; return 'asked' }
            P.calls.push(`open:${k}`)
            return 'opened'
          }
          window.bridgeApp = {
            platform: a.platform || 'darwin', desktop: true,
            restart: async () => { P.calls.push('restart'); return true },
            fixTile: async (p) => { P.calls.push(`tile:${p}`); return true },
            closeFixTile: async () => true,
            testNotification: async () => { P.calls.push('test-notification'); return true },
            mediaAccess: async () => ({ ok: 'granted', ask: 'not-determined', denied: 'denied' })[st.microphone] || 'denied',
            ...(a.old ? {} : {
              dictateStatus: async () => ({ mode: 'hold', key: 'Alt+Space', active: true, paste: { can: true, via: 'bridgekeys', asks: 'accessibility', allowed: st.accessibility === 'ok' } }),
              permission: {
                kinds: async () => a.kinds || ['microphone', 'accessibility', 'notifications'],
                status: async (k) => st[k],
                ask,
                open: async (k) => { P.calls.push(`open:${k}`); return 'opened' },
                // A switch that's on and doesn't take comes right once its answer is forgotten.
                reset: async (k) => { P.calls.push(`reset:${k}`); P.stuck = false; st[k] = 'ask'; return ask(k) },
                canReset: async (k) => k !== 'notifications',
              },
            }),
          }
        }, o.app || {})
      }
    },
  })
  const calls = (p) => p.evaluate(() => window.__perm?.calls || [])

  try {
    // macOS's own question first, and noticed with no click.
    const d = await open({ list: rows(ALL, { calendars: 'ok', 'full-disk': 'denied' }), app: {} })
    const s = await settings(d.p)
    const shown = await s.locator('.perm-row').evaluateAll((els) => els.map((e) => e.dataset.pane))
    ok(shown.join() === ALL.join(), 'Settings › General › Permissions: each one Bridge AI may use on this Mac', shown)
    ok(/Voice notes, dictation and meeting notes/.test(await row(s, 'microphone').innerText()) && /On/.test(await row(s, 'calendars').innerText()) && /Not asked yet/.test(await row(s, 'microphone').innerText()), 'what each is for, and whether it\'s on', await s.innerText())
    await s.scrollIntoViewIfNeeded().catch(() => {}); await shot(d.p, `${tag}permissions-list`)
    await row(s, 'microphone').locator('button', { hasText: 'Allow' }).click()
    ok(!!(await until(async () => (await row(s, 'microphone').getAttribute('data-state')) === 'ok', 4000, 100)) && (await calls(d.p)).join() === 'ask:microphone' && !d.ctx.__seen.some((x) => /POST \/settings/.test(x)), 'Allow (the mic): macOS\'s own question, nothing opened, and it\'s on', [await calls(d.p), d.ctx.__seen])
    await row(s, 'accessibility').locator('button', { hasText: 'Allow' }).click()
    ok(!!(await until(async () => /macOS is asking: choose Open System Settings, then turn on Bridge AI/.test(await row(s, 'accessibility').innerText()), 4000, 100)), 'Allow (Accessibility): macOS\'s prompt, and what to do there', await row(s, 'accessibility').innerText())
    // The person turns it on in System Settings; nobody clicks anything here.
    await d.p.evaluate(() => { window.__perm.st.accessibility = 'ok' })
    ok(!!(await until(async () => (await row(s, 'accessibility').getAttribute('data-state')) === 'ok', 6000, 200)), 'turned on in System Settings: noticed by itself, without Check again')
    // Notifications: the first one is how macOS asks.
    await row(s, 'notifications').locator('button', { hasText: 'Allow' }).click()
    ok(!!(await until(async () => (await calls(d.p)).includes('test-notification') && /Didn't see it\?/.test(await row(s, 'notifications').innerText()), 4000, 100)), 'notifications: a test one (the first is what macOS asks about), and the way to its page if it didn\'t show')
    ok(d.errors.length === 0, 'no page errors', d.errors)
    await d.ctx.close()
  } catch (e) { ok(false, `crashed: ${String(e.message).split('\n')[0]}`) }
  try {
    // Stuck: turned on in System Settings, and macOS still says no. Then Reset and ask again.
    const d = await open({ list: rows(ALL), app: { st: { accessibility: 'denied' }, stuck: true } })
    const s = await settings(d.p)
    const ax = row(s, 'accessibility')
    await ax.locator('button', { hasText: 'Allow' }).click()
    ok(!!(await until(async () => /Turn on Bridge AI in the list/.test(await ax.innerText()), 4000, 100)) && (await calls(d.p)).includes('open:accessibility'), 'asked before: its page of System Settings, with the tile', [await calls(d.p), await ax.innerText()])
    await ax.locator('button', { hasText: 'I\'ve turned it on' }).click()
    ok(!!(await until(async () => /still off for Bridge AI/.test(await ax.innerText()) && await ax.locator('button', { hasText: 'Reset and ask again' }).isVisible(), 8000, 200)), 'said it\'s on, and a moment later it still isn\'t: Reset and ask again, with why', await ax.innerText())
    await s.scrollIntoViewIfNeeded().catch(() => {}); await shot(d.p, `${tag}permissions-stuck`)
    await ax.locator('button', { hasText: 'Reset and ask again' }).click()
    ok(!!(await until(async () => (await calls(d.p)).includes('reset:accessibility') && /macOS is asking/.test(await ax.innerText()), 4000, 100)), 'Reset: this app\'s answer forgotten, and macOS asks again', [await calls(d.p), await ax.innerText()])
    await d.p.evaluate(() => { window.__perm.st.accessibility = 'ok' })
    ok(!!(await until(async () => (await ax.getAttribute('data-state')) === 'ok', 6000, 200)), 'allowed this time: on, noticed by itself')
    await d.ctx.close()
  } catch (e) { ok(false, `crashed: ${String(e.message).split('\n')[0]}`) }
  try {
    // Full Disk Access: applies only after a restart, and comes back to where you were.
    let claimed = false
    const d = await open({
      list: rows(ALL, { 'full-disk': 'denied' }), app: {},
      fix: () => ({ restart: claimed ? [{ pane: 'full-disk', label: 'Full Disk Access' }] : [] }),
      server: { check: (p) => (p === 'full-disk' && claimed ? 'restart' : 'denied'), claim: () => { claimed = true } },
    })
    const s = await settings(d.p)
    const fd = row(s, 'full-disk')
    await fd.locator('button', { hasText: 'Allow' }).click()
    ok(!!(await until(async () => /Drag Bridge AI from the tile/.test(await fd.innerText()), 4000, 100)) && d.ctx.__seen.some((x) => /POST \/settings .*full-disk/.test(x)) && (await calls(d.p)).includes('tile:full-disk'), 'Full Disk Access (macOS has no question for it): its page of System Settings and the tile to drag in', [d.ctx.__seen, await calls(d.p)])
    await fd.locator('button', { hasText: 'I\'ve turned it on' }).click()
    ok(!!(await until(async () => /On after a restart/.test(await fd.innerText()) && await fd.locator('button', { hasText: 'Restart to apply' }).isVisible(), 4000, 100)), 'on, but only after a restart: Restart to apply', await fd.innerText())
    await fd.locator('button', { hasText: 'Restart to apply' }).click()
    const now = d.p.locator('.update-pop button', { hasText: 'Restart now' })
    ok(!!(await until(() => now.isVisible(), 4000, 100)), 'the top bar\'s Restart to apply, with what it\'ll do')
    await now.click()
    ok(!!(await until(async () => (await calls(d.p)).includes('restart'), 3000, 100)) && (await d.p.evaluate(() => JSON.parse(localStorage.getItem('cc-perm-return') || 'null')?.section)) === 'permissions', 'restarted, remembering where it was asked from', await d.p.evaluate(() => localStorage.getItem('cc-perm-return')))
    // The app comes back (a reload stands in for the restart): Settings, at Permissions.
    await d.p.reload()
    ok(!!(await until(() => d.p.locator('.st-perms').isVisible(), 8000, 200)) && await d.p.evaluate(() => localStorage.getItem('cc-perm-return')) === null, 'back after the restart: Settings opens where it was, at Permissions')
    await d.ctx.close()
  } catch (e) { ok(false, `crashed: ${String(e.message).split('\n')[0]}`) }
  try {
    // The desktop app on a Mac showing a page from a server elsewhere (Linux here): what the app asks
    // for itself is still the Mac's to ask, so its card shows, and asks macOS.
    const d = await open({ list: rows(['microphone']), fix: { mac: false, win: false, canReset: false }, app: { st: { microphone: 'denied' } } })
    const s = await settings(d.p)
    const mic = row(s, 'microphone')
    await mic.locator('button', { hasText: 'Allow' }).click({ timeout: 8000 })
    ok(!!(await until(async () => (await calls(d.p)).includes('ask:microphone'), 4000, 100)), 'a Mac\'s desktop app with its server elsewhere: the mic is still the Mac\'s to allow, asked of macOS', await calls(d.p))
    await d.ctx.close()
  } catch (e) { ok(false, `crashed: ${String(e.message).split('\n')[0]}`) }
  try {
    // Windows, a browser on a Mac, and Linux: only what applies.
    const w = await open({ list: rows(['microphone', 'notifications'], { microphone: 'denied' }), fix: { mac: false, win: true, canReset: false }, app: { platform: 'win32', st: { microphone: 'denied' }, kinds: ['microphone', 'notifications'] } })
    let s = await settings(w.p)
    const panes = await s.locator('.perm-row').evaluateAll((els) => els.map((e) => e.dataset.pane))
    await row(s, 'microphone').locator('button', { hasText: 'Allow' }).click()
    ok(panes.join() === 'microphone,notifications' && !!(await until(async () => /Windows Settings › Privacy & security › Microphone, turn it on for desktop apps/.test(await row(s, 'microphone').innerText()), 4000, 100)), 'Windows: the mic and notifications, and its own Settings to turn the mic on', [panes, await row(s, 'microphone').innerText()])
    await w.ctx.close()
    const br = await open({ list: rows(ALL), app: null, fix: { app: { name: 'Terminal', bundle: null, desktop: false }, canReset: false } })
    s = await settings(br.p)
    const bp = await s.locator('.perm-row').evaluateAll((els) => els.map((e) => e.dataset.pane))
    ok(bp.join() === 'calendars,full-disk,files,automation' && /runs from Terminal here, so macOS asks about Terminal/.test(await s.innerText()), 'a browser on a Mac (Bridge AI from a terminal): the app\'s own aren\'t there (the browser asks for its own), and it says macOS asks about Terminal', [bp, await s.innerText()])
    await br.ctx.close()
    const lx = await open({ list: { items: [] }, fix: { mac: false, win: false }, app: null })
    await lx.p.locator('button[aria-label="Settings"]').first().click()
    await lx.p.locator('.st-sections').first().waitFor({ timeout: 8000 })
    await sleep(800)
    ok(await lx.p.locator('.st-perms').count() === 0, 'Linux (and Docker): no Permissions at all, nothing asks there')
    await lx.ctx.close()
  } catch (e) { ok(false, `crashed: ${String(e.message).split('\n')[0]}`) }
  try {
    // A desktop app older than the page (3.5.0): it can't ask for Accessibility, so it says to update.
    const d = await open({
      list: rows(ALL, { accessibility: 'unknown' }), app: { old: true }, ua: '3.5.0',
      updates: { current: '3.8.0', latest: '3.8.0', available: false, how: 'source', command: 'git pull && npm start', appUpdate: true, url: 'https://example.invalid', notes: '' },
    })
    const s = await settings(d.p)
    const ax = row(s, 'accessibility')
    ok(!!(await until(async () => /Needs an update/.test(await ax.innerText()), 4000, 100)) && await ax.locator('button', { hasText: /^\s*Allow/ }).count() === 0, 'an older desktop app: Accessibility says it needs an update, no Allow that can\'t work', await ax.innerText().catch(() => ''))
    await ax.locator('button', { hasText: 'Update Bridge AI' }).click()
    ok(!!(await until(() => d.ctx.__seen.some((x) => /POST updates \{"app":true\}/.test(x)), 4000, 100)), 'Update Bridge AI: one click, the desktop app\'s update', d.ctx.__seen.filter((x) => /updates/.test(x)))
    await d.p.keyboard.press('Escape')
    const chip = d.p.locator('.topbar .update-chip')
    ok(!!(await until(() => chip.isVisible(), 4000, 100)), 'the top bar says there\'s an update, though the server (your clone) is up to date: the app around it is behind')
    await chip.click()
    ok(/desktop app's update/.test(await d.p.locator('.update-pop').innerText()) && /you have 3\.5\.0/.test(await d.p.locator('.update-pop').innerText()), 'its pop-up says it\'s the desktop app\'s, and which version you have', await d.p.locator('.update-pop').innerText())
    const n = d.ctx.__seen.length
    await d.p.locator('.update-pop button', { hasText: 'Update now' }).click()
    ok(!!(await until(() => d.ctx.__seen.slice(n).some((x) => /POST updates \{"app":true\}/.test(x)), 4000, 100)), 'Update now: the desktop app, from the server run from your clone', d.ctx.__seen.slice(n))
    await shot(d.p, `${tag}permissions-update-app`)
    await d.ctx.close()
    // The same, with the app as new as the server: nothing to update.
    const cur = await open({ list: rows(ALL), app: {}, ua: '3.8.0', updates: { current: '3.8.0', latest: '3.8.0', available: false, how: 'source', appUpdate: true } })
    await cur.p.locator('.topbar').waitFor({ timeout: 8000 })
    await sleep(1200)
    ok(await cur.p.locator('.topbar .update-chip').count() === 0, 'a desktop app as new as the server: no update offered')
    await cur.ctx.close()
  } catch (e) { ok(false, `crashed: ${String(e.message).split('\n')[0]}`) }
  try {
    // Another device's page shown in this window (/m/<id>/): its permissions are that computer's.
    // It stands in for the other device: its answers here, and the page and the rest from this one.
    const asks = []
    let micOn = false
    const device = (listening) => page(b, `${kit.url}/m/dev2/`, {
      before: async (c) => {
        await noServiceWorker(c)
        await c.route(/\/m\/dev2\//, safe(async (r) => {
          const u = new URL(r.request().url())
          const sub = u.pathname.replace(/^\/m\/dev2/, '')
          if (sub === '/api/fix') return r.fulfill({ json: { ...MAC_FIX, device: 'Studio Mac', desktop: { version: '3.8.0', listening } } })
          if (sub === '/api/fix/list') return r.fulfill({ json: rows(['microphone', 'calendars', 'full-disk'], { microphone: micOn ? 'ok' : 'denied', calendars: 'ok' }) })
          if (sub === '/api/fix/check') return r.fulfill({ json: { state: u.searchParams.get('pane') === 'microphone' && !micOn ? 'denied' : 'ok' } })
          if (sub === '/api/fix/ask-here') { asks.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ json: { told: true } }) }
          if (sub === '/api/events') return r.abort()
          return r.fulfill({ response: await r.fetch({ url: `${kit.url}${sub}${u.search}` }) })
        }))
        // What preload.js gives another device's page: windows only. This computer's permission
        // calls are put there anyway, to show the page never reaches for them.
        await c.addInitScript(() => {
          const P = window.__perm = { calls: [] }
          window.bridgeApp = { platform: 'darwin', desktop: false, machine: 'dev2', permission: { ask: async (k) => { P.calls.push(`ask:${k}`); return 'ok' }, status: async () => 'ok', kinds: async () => ['microphone'] }, fixTile: async (k) => { P.calls.push(`tile:${k}`) }, mediaAccess: async () => 'granted' }
        })
      },
    })
    const d = await device(true)
    const s = await settings(d.p)
    const mic = row(s, 'microphone')
    ok(!!(await until(async () => /on Studio Mac/.test(await s.innerText()) && await mic.locator('button', { hasText: 'Ask Studio Mac' }).isVisible(), 8000, 200)) && /allowed on the computer it's for: Studio Mac/.test(await mic.innerText()), 'another device\'s page: the mic is Studio Mac\'s, so Ask Studio Mac, not Allow', await s.innerText().catch(() => ''))
    await s.scrollIntoViewIfNeeded().catch(() => {}); await shot(d.p, `${tag}permissions-other-device`)
    await mic.locator('button', { hasText: 'Ask Studio Mac' }).click()
    ok(!!(await until(() => asks.length === 1 && asks[0].pane === 'microphone', 4000, 100)) && !!(await until(async () => /Asked\. Answer on Studio Mac/.test(await mic.innerText()), 3000, 100)), 'Ask Studio Mac: that computer is asked to show its own question', [asks, await mic.innerText()])
    micOn = true
    ok(!!(await until(async () => (await mic.getAttribute('data-state')) === 'ok', 8000, 200)), 'allowed there: noticed here')
    ok((await calls(d.p)).length === 0, 'and this window\'s own app was never asked anything', await calls(d.p))
    await d.ctx.close()
    micOn = false
    const q = await device(false)
    const s2 = await settings(q.p)
    const m2 = row(s2, 'microphone')
    ok(!!(await until(async () => /On Studio Mac, open Bridge AI and allow it in Settings › General › Permissions/.test(await m2.innerText()), 8000, 200)) && await m2.locator('button').count() === 0, 'a device whose app can\'t be asked: what to do there, and no button', await m2.innerText().catch(() => ''))
    await q.ctx.close()
  } catch (e) { ok(false, `crashed: ${String(e.message).split('\n')[0]}`) }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close().catch(() => {})
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
