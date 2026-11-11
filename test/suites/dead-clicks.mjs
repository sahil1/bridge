// No button that does nothing. The main views (Home, an agent's Chat, Terminal and Files, Files,
// Studio, Meetings, Calendar, each section of Settings, the top bar and its menus, ‹ and › with
// somewhere to go, the sidebar, the tabs and the Agents board) are opened in the desktop app (a stand-in for what it gives the page,
// window.bridgeApp, and for where it opens a link in a new window, desktop/senders.js opens) and in
// a plain browser, side by side. Each button and link you can see and press there is pressed, and
// something has to come of it: the page changes or scrolls, it asks the server, the focus or the
// address moves, a dialog, a new tab, a download or a file picker opens, or the desktop app is
// asked to do something. A click after which nothing changed fails, with where it was and what
// it's called. What isn't pressed (it deletes, signs out, sends, starts real work) and what may
// show nothing (each with why) are listed below. DEAD_CLICKS_DEBUG=1 says what each press did.
// And a click whose request fails says why (deleting a saved prompt; a new window the browser
// blocks).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startKit, checks, until, browser, page, sleep, shot, changeAnswer, noServiceWorker, withoutCutOff, TEST, ROOT } from '../lib/harness.mjs'

const { ok, done } = checks('dead-clicks')
const require = createRequire(import.meta.url)
const senders = require('../../desktop/senders.js')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const DEBUG = !!process.env.DEAD_CLICKS_DEBUG
const ONLY = process.env.DEAD_CLICKS_ONLY ? new RegExp(process.env.DEAD_CLICKS_ONLY) : null

// Not pressed: what would delete, sign out, send or start real work, ask macOS for something or
// read outside the test's own home folder. By the word its name starts with, for a name of a few
// words (a longer one, as a step of an agent's work in its chat, says what was done: pressing it
// shows it), or by its whole name; some only in one place.
const SHORT = (re) => (name) => name.split(' ').length <= 5 && re.test(name)
const SKIP = [
  [SHORT(/^(delete|remove|move to trash|trash|erase|forget|unlink|archive|discard|revert|clear)\b/i), 'deletes or forgets something'],
  [SHORT(/^(sign out|log out|disconnect|quit|turn off)\b/i), 'signs out, quits or turns something off'],
  [SHORT(/^(send|submit|approve|publish|share)\b/i), 'sends or shares something'],
  [SHORT(/^(restart|update|install|download|upgrade)\b/i), 'restarts, updates, installs or downloads'],
  [SHORT(/^(start|stop|record|fork|new terminal|run|sign in|log in|launch|pair|join|dictate|continue on)\b/i), 'starts or stops real work, or listens'],
  [/^Stop what the agent is doing and send this now$|^Runs the agent's own sign-in/, 'starts or stops real work, or listens'],
  [SHORT(/^(allow|ask|reset and ask)\b/i), 'asks macOS (or another computer) for a permission'],
  [/^Open in your terminal app$/, 'opens a terminal app on this computer'],
  [/^\//, 'a folder outside the test\'s own home (macOS can ask about what\'s below it)', /^Files$/],
]
const skipOf = (place, name) => SKIP.find(([is, , at]) => (!at || at.test(place)) && (typeof is === 'function' ? is(name) : is.test(name)))
// What may show nothing when pressed, and why: by place and name (RegExps), or by what it is.
const QUIET = [
  { what: 'the tab, the place or the choice already shown', is: (it) => it.current, why: 'pressing where you are keeps you there, as any tab does' },
]

// ---------- a Bridge AI with something in each view ----------
const kit = await startKit('dead-clicks', { config: { trials: { studio: true, home: true, files: true, routines: true, 'meeting-insights': true, 'tab-groups': true, 'usage-everywhere': true, 'signature-assist': true, 'recommended-settings': true, comments: true } } })
// macOS's open, osascript (Finder, Terminal) and xdg-open: written down, never run.
const NOTE = "require('fs').appendFileSync(require('path').join(__dirname, 'opened.log'), JSON.stringify(process.argv.slice(1)) + '\\n')\n"
for (const n of ['open', 'osascript', 'xdg-open']) kit.program(n, NOTE)
const pages = senders.create(kit.port)
let pane = null
const t0 = Date.now()
try {
  await kit.api('/setup', { name: 'Tester' })
  const proj = path.join(kit.home, 'Projects', 'site')
  fs.mkdirSync(path.join(proj, 'src', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(proj, 'README.md'), '# Site\n\nLaunch on *Friday*.\n')
  fs.writeFileSync(path.join(proj, 'src', 'index.js'), 'console.log(1)\n')
  fs.writeFileSync(path.join(proj, 'src', 'lib', 'a.js'), 'export const a = 1\n')
  fs.writeFileSync(path.join(proj, 'dot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
  kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await kit.api('/agents/catalog')
  pane = (await kit.api('/agents/launch', { kind: 'claude', cwd: proj, label: 'Site', newSpace: 'Site' })).paneId
  await kit.api('/dictations', { text: 'A note to self', ms: 1200 }).catch(() => {})
  await kit.api('/boards', { title: 'Plans' }).catch(() => {})
} catch (e) { ok(false, `the kit couldn't be set up: ${e.message}`) }

// ---------- what's watched on a page ----------
// In the page: changes to it and scrolling, but not where it changes by itself (a clock, a list
// asked for again), learnt by watching it a moment with nothing pressed, nor what can't be seen (an
// attribute of something not shown, but whether it's shown). where: the first two changes, said.
const WATCH = () => {
  const dc = window.__dc = { muts: 0, where: [], scrolls: 0, calls: 0, asked: [], links: [], learning: false, seen: new Set(), noisy: new WeakSet() }
  const el = (n) => (n.nodeType === 1 ? n : n.parentElement)
  const quiet = (n) => { for (let e = el(n); e; e = e.parentElement) if (dc.noisy.has(e)) return true; return false }
  const SHOWS = ['hidden', 'class', 'style', 'open', 'aria-hidden']
  new MutationObserver((list) => {
    for (const m of list) {
      const e = el(m.target)
      if (!e) continue
      if (dc.learning) { dc.seen.add(e); continue }
      if (quiet(e) || (m.type === 'attributes' && !SHOWS.includes(m.attributeName) && !e.getClientRects().length)) continue
      dc.muts++
      if (dc.where.length < 2) dc.where.push(`${e.tagName.toLowerCase()}${[...e.classList].map((c) => `.${c}`).join('')}${m.attributeName ? `[${m.attributeName}]` : ''}`)
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  document.addEventListener('scroll', (e) => { if (!dc.learning && !(e.target.nodeType === 1 && quiet(e.target))) dc.scrolls++ }, true)
  // What's heard: a voice speaking, a sound or a video playing.
  const heard = (o, k) => { const f = o?.[k]; if (typeof f === 'function') o[k] = function (...a) { if (!dc.learning) dc.sounds++; return f.apply(this, a) } }
  dc.sounds = 0
  heard(window.speechSynthesis, 'speak')
  heard(window.HTMLMediaElement?.prototype, 'play')
}
// The desktop app's page: window.bridgeApp as desktop/preload.js gives it, each call written down
// (but what only asks or reports), and a link opened in a new window handed to the app, which
// opens it or not as main.js does (decided here, by senders.js opens).
const DESKTOP = () => {
  const dc = () => window.__dc
  const ASKS = new Set(['idle', 'answerBusy', 'looking', 'recording', 'watching', 'floatSize', 'floatMove', 'hudSize', 'hudPhase', 'hudPointer', 'hudReady', 'pathOf', 'kinds', 'status', 'canReset', 'mediaAccess', 'dictateStatus', 'dictateConfigure', 'pasteAccess', 'closeFixTile', 'hudLooked'])
  const said = { mode: null, paste: { can: true, via: 'bridgekeys', asks: 'accessibility', allowed: true } }
  const fn = (name, ret = null, sync = false) => (...a) => {
    if (!ASKS.has(name) && !(name === 'fullScreen' && typeof a[0] !== 'boolean')) { dc().calls++; dc().asked.push(name) }
    return sync ? ret : Promise.resolve(ret)
  }
  const platform = navigator.platform.startsWith('Mac') ? 'darwin' : navigator.platform.startsWith('Win') ? 'win32' : 'linux'
  window.bridgeApp = {
    platform, desktop: true,
    capture: fn('capture'), popOut: fn('popOut', true), focusMain: fn('focusMain', true), focusPopout: fn('focusPopout', true), openMachine: fn('openMachine', true), answerBusy: fn('answerBusy', undefined, true),
    pickFolder: fn('pickFolder'), idle: fn('idle', 0), restart: fn('restart', true),
    permission: { kinds: fn('kinds', ['microphone', 'accessibility', 'notifications']), status: fn('status', 'ok'), ask: fn('ask', 'ok'), open: fn('open', true), reset: fn('reset', true), canReset: fn('canReset', false) },
    fixTile: fn('fixTile', true), closeFixTile: fn('closeFixTile', true), mediaAccess: fn('mediaAccess', 'granted'), askMedia: fn('askMedia', 'granted'), resetMedia: fn('resetMedia', true), testNotification: fn('testNotification', true),
    recording: fn('recording'), floatSize: fn('floatSize', undefined, true), floatHide: fn('floatHide'), floatStart: fn('floatStart'), floatOpen: fn('floatOpen'), floatMove: fn('floatMove', undefined, true), floatWatch: fn('floatWatch'),
    pickFiles: fn('pickFiles', []), pathOf: fn('pathOf', null, true), watching: fn('watching'), fullScreen: fn('fullScreen', false),
    dictateStatus: fn('dictateStatus', said), hudPaste: fn('hudPaste'), hudInto: fn('hudInto'), hudLooked: fn('hudLooked'), hudSelection: fn('hudSelection'), pasteAccess: fn('pasteAccess', true), pasteAsk: fn('pasteAsk', true), dictateConfigure: fn('dictateConfigure', said),
    hudReady: fn('hudReady'), hudSize: fn('hudSize', undefined, true), hudPhase: fn('hudPhase', undefined, true), hudHide: fn('hudHide'), hudCopy: fn('hudCopy'), hudKeyboard: fn('hudKeyboard', true), hudPointer: fn('hudPointer', undefined, true), dictateRepaste: fn('dictateRepaste'),
  }
  document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('in-bridge-app', `platform-${platform}`))
  const go = (u) => { try { dc().links.push(new URL(u, location.href).href) } catch { /* not a link */ } }
  window.open = (u) => { go(u); return null }
  window.addEventListener('click', (e) => { const a = e.target.closest?.('a[href][target="_blank"]'); if (a && !e.defaultPrevented) { e.preventDefault(); go(a.href) } })
}

// ---------- the places ----------
const send = (p, detail, event = 'bridge-open-agent') => p.evaluate(({ e, d }) => window.dispatchEvent(new CustomEvent(e, { detail: d })), { e: event, d: detail })
const today = new Date().toISOString().slice(0, 10)
const view = (id) => (p) => send(p, { paneId: id })
const agentView = (v) => async (p) => {
  if (!(await p.locator(`.ws-tab[aria-selected="true"][data-pane="${pane}"]`).count())) { await send(p, { paneId: pane }); await sleep(200) }
  await send(p, { paneId: pane, view: v }, 'cc-set-view')
}
const SECTIONS = [...(/export const SECTIONS = \[([\s\S]*?)\n\]/.exec(fs.readFileSync(path.join(ROOT, 'src', 'components', 'Settings.jsx'), 'utf8'))?.[1] || '').matchAll(/\{ id: '([\w-]+)', label: tx\('([^']+)'\)([^}]*)\}/g)]
  .filter((m) => !/accounts: true/.test(m[3]) && (!/mac: true/.test(m[3]) || process.platform === 'darwin')).map((m) => ({ id: m[1], label: m[2] }))
const PLACES = [
  { name: 'Home', open: view('view:home'), scope: '.cmd .hm', ready: '.hm' },
  { name: 'an agent\'s Chat', open: agentView('chat'), scope: '.cmd .work .console', ready: '.console .msg, .console .composer' },
  { name: 'an agent\'s Terminal', open: agentView('terminal'), scope: '.cmd .work .console', ready: '.console .term-wrap:not([hidden])' },
  {
    name: 'an agent\'s Files', open: agentView('files'), scope: '.cmd .work .console', ready: '.files-view .tree-row',
    // Every folder closed (what the owner found: Collapse all then did nothing) and a file shown, so
    // the viewer's buttons are there too.
    prep: async (p) => {
      if (await p.locator('.files-view .tree-row', { hasText: 'index.js' }).count()) await p.locator('.files-view .tree-row', { hasText: 'src' }).first().click({ timeout: 3000 })
      if (!(await p.locator('.viewer-head .crumbs', { hasText: 'README.md' }).count())) await p.locator('.files-view .tree-row', { hasText: 'README.md' }).first().click({ timeout: 3000 })
      await p.locator('.viewer-head').waitFor({ timeout: 5000 })
    },
  },
  { name: 'Files', open: view('view:files'), scope: '.cmd .fx', ready: '.fx .fx-body' },
  { name: 'Studio', open: view('view:studio'), scope: '.cmd .sd-home-view', ready: '.sd-home-view' },
  { name: 'Meetings', open: view('view:meetings'), scope: '.cmd .mt-view', ready: '.mt-view' },
  { name: 'Calendar', open: (p) => send(p, { date: today }, 'bridge-open-event'), scope: '.cmd .calv', ready: '.calv' },
  ...SECTIONS.map((s) => ({
    name: `Settings › ${s.label}`, open: (p) => send(p, { section: s.id }, 'bridge-open-settings'), scope: '.modal.settings .st-body', ready: '.modal.settings .st-head h3', over: 1,
    prep: (p) => p.evaluate(() => document.querySelectorAll('.modal.settings details').forEach((d) => { d.open = true })),
  })),
  { name: 'the top bar', open: async () => {}, scope: '.topbar', drill: true },
  // ‹ and › (Back and Forward, on to start with) with somewhere to go each way: after a key (so
  // what follows is yours, not the window opening), Meetings, then Files, then ‹ back to Meetings.
  {
    name: 'Back and Forward', scope: '.topbar .nav-arrows', ready: '.topbar .nav-btn[data-dir="forward"]:not([disabled])',
    open: async (p) => {
      await p.locator('.topbar .nav-btn').first().waitFor({ timeout: 10000 }).catch(() => {})
      await p.keyboard.press('Shift')
      await send(p, { paneId: 'view:meetings' }); await sleep(400)
      await send(p, { paneId: 'view:files' }); await sleep(400)
      await p.locator('.topbar .nav-btn[data-dir="back"]').click({ timeout: 3000 }).catch(() => {})
    },
  },
  { name: 'the sidebar', open: async () => {}, scope: '.cmd .rail-slot' },
  { name: 'the tabs and the Agents board', open: agentView('chat'), scope: '.cmd .ws-tabs, .cmd .ws-tab-tools, .cmd .board' },
]

// What a place's buttons and links are: each by its name and which of that name it is. current:
// the tab or place already shown.
const LIST = (scope) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }
  const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.querySelector('img')?.alt || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const out = []
  const seen = new Map()
  for (const box of document.querySelectorAll(scope)) {
    for (const e of box.querySelectorAll('button, a[href], [role="button"], [role="tab"], [role="menuitem"], summary')) {
      if (!vis(e) || e.disabled || e.getAttribute('aria-disabled') === 'true' || e.closest('[inert], [hidden]')) continue
      if (['switch', 'checkbox', 'radio'].includes(e.getAttribute('role'))) continue
      const n = name(e)
      const k = seen.get(n) || 0
      seen.set(n, k + 1)
      // A tab that's selected (but its ×), a link to where you are, or the choice made in a row of choices.
      const current = (!!e.closest('[role="tab"][aria-selected="true"], [aria-current]:not([aria-current="false"])') && !/^close\b/i.test(e.getAttribute('aria-label') || ''))
        || (!!e.parentElement?.matches('.seg') && (e.classList.contains('on') || e.getAttribute('aria-pressed') === 'true'))
      out.push({ name: n, nth: k, current, last: e.getAttribute('role') === 'tab' || e.tagName === 'SUMMARY', html: e.outerHTML.slice(0, 160) })
    }
  }
  // Tabs and what folds (Advanced) last: they change what else is there.
  return [...out.filter((x) => !x.last), ...out.filter((x) => x.last)]
}
// The one named so, marked for the click (or false).
const MARK = ({ scope, name: want, nth }) => {
  document.querySelectorAll('[data-dc]').forEach((e) => e.removeAttribute('data-dc'))
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.querySelector('img')?.alt || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  let k = 0
  for (const box of document.querySelectorAll(scope)) {
    for (const e of box.querySelectorAll('button, a[href], [role="button"], [role="tab"], [role="menuitem"], summary')) {
      if (!vis(e) || name(e) !== want) continue
      if (k++ === nth) { if (e.disabled || e.getAttribute('aria-disabled') === 'true') return false; e.setAttribute('data-dc', '1'); return true }
    }
  }
  return false
}
// Where the page is: its address, what's over it (a menu, a dialog), whether the place is there,
// and which tab, view and section of Settings are shown. Changed by a press, it's put back (Escape,
// or the place again).
const WHERE = (scope) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const over = [...document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], [aria-modal="true"], .modal, .menu, .popover, .palette')].filter(vis).length
  const text = (sel) => document.querySelector(sel)?.textContent || null
  return JSON.stringify({ u: location.href, over, here: !!document.querySelector(scope), maxed: !!document.querySelector('.work.maxed'), tab: document.querySelector('.ws-tab[aria-selected="true"]')?.dataset.pane || null, view: text('.console .seg [aria-selected="true"]'), section: text('.modal.settings .st-head h3') })
}
const overOf = (w) => JSON.parse(w).over

// One browser page, in one of the two shapes, pressing through every place.
async function walk(shape) {
  const desktop = shape === 'desktop'
  const { p, ctx, errors } = await page(b, kit.url, {
    before: async (c) => {
      await noServiceWorker(c)
      await c.addInitScript(WATCH)
      if (desktop) await c.addInitScript(DESKTOP)
      await c.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort())
      // Files' sidebar without this computer's other drives: macOS asks before an app opens one.
      await changeAnswer(c, /\/api\/files\/sidebar/, (j) => ({ ...j, drives: (j.drives || []).filter((d) => !d.guard) }))
    },
  })
  const st = { reqs: [], popups: 0, dialogs: 0, downloads: 0, choosers: 0, background: new Set() }
  const key = (r) => { try { return `${r.method()} ${new URL(r.url()).pathname}` } catch { return r.url() } }
  p.on('request', (r) => st.reqs.push(key(r)))
  p.on('dialog', (d) => { st.dialogs++; d.dismiss().catch(() => {}) })
  p.on('download', (d) => { st.downloads++; d.cancel().catch(() => {}) })
  p.on('filechooser', () => { st.choosers++ })
  ctx.on('page', (np) => { if (np !== p) { st.popups++; np.close().catch(() => {}) } })
  const dead = []
  const skipped = []
  const quiet = []
  let pressed = 0
  let missed = 0
  // A place opened from wherever the page is (fresh: the page loaded again): what's over it closed,
  // then its own way in; and a moment with nothing pressed, to learn what changes by itself there
  // and what's asked of the server meanwhile.
  const goTo = async (pl, fresh = false) => {
    const tg = Date.now()
    if (DEBUG) console.log(`  ${shape} ${pl.name}: opened again${fresh ? ' (loaded)' : ''}`)
    // Not there in a moment (something a press left over it): the page loaded again, once.
    for (let tries = 0; tries < 2; tries++) {
      if (fresh || tries || p.url() !== `${kit.url}/`) { await p.goto(kit.url); await p.waitForSelector('.rail', { timeout: 30000 }) }
      for (let i = 0; i < 3 && overOf(await p.evaluate(WHERE, pl.scope)) > (pl.over || 0); i++) { await p.keyboard.press('Escape'); await sleep(120) }
      await pl.open(p)
      if (!pl.ready || await p.locator(pl.ready).first().waitFor({ timeout: 6000 }).then(() => true, () => false)) break
    }
    await pl.prep?.(p).catch(() => {})
    // What changes in two moments in a row changes by itself (a clock, a terminal); what changed in
    // one only was the place still coming in.
    const moment = fresh ? 400 : 120
    await sleep(100)
    const before = st.reqs.length
    await p.evaluate(() => { window.__dc.learning = true; window.__dc.seen = new Set() })
    await sleep(moment)
    await p.evaluate(() => { const dc = window.__dc; dc.first = dc.seen; dc.seen = new Set() })
    await sleep(moment)
    await p.evaluate(() => { const dc = window.__dc; for (const e of dc.seen) if (dc.first.has(e) && e.querySelectorAll('*').length < 40) dc.noisy.add(e); dc.learning = false })
    for (const r of st.reqs.slice(before)) st.background.add(r)
    if (DEBUG) console.log(`  ${shape} ${pl.name}: open in ${Date.now() - tg} ms`)
    return p.evaluate(WHERE, pl.scope)
  }
  // One press, and what came of it (null: nothing).
  const press = async (pl, it) => {
    if (!(await p.evaluate(MARK, { scope: pl.scope, name: it.name, nth: it.nth }))) return { gone: true }
    const el = p.locator('[data-dc="1"]')
    if (!(await el.hover({ timeout: 600 }).then(() => true, () => false))) return { covered: true }
    await sleep(60)
    const was = await p.evaluate(() => { const dc = window.__dc; Object.assign(dc, { muts: 0, where: [], scrolls: 0, sounds: 0, calls: 0, asked: [], links: [] }); return document.activeElement?.outerHTML?.slice(0, 80) || '' })
    const n0 = { reqs: st.reqs.length, popups: st.popups, dialogs: st.dialogs, downloads: st.downloads, choosers: st.choosers, url: p.url() }
    if (!(await el.click({ timeout: 800, noWaitAfter: true }).then(() => true, () => false))) return { covered: true }
    pressed++
    let what = null
    for (let waited = 0; waited < 1000 && !what; waited += 50) {
      const now = await p.evaluate(() => { const dc = window.__dc; const a = document.activeElement; return { muts: dc.muts, where: dc.where, scrolls: dc.scrolls, sounds: dc.sounds, asked: dc.asked, links: dc.links, focus: a && a !== document.body && !a.hasAttribute('data-dc') ? a.outerHTML.slice(0, 80) : null } }).catch(() => ({ gone: true }))
      const asked = st.reqs.slice(n0.reqs).filter((r) => !st.background.has(r))
      if (now.gone) what = 'the page went'
      else if (now.muts) what = `${now.muts} change${now.muts > 1 ? 's' : ''} (${now.where.join(', ')})`
      else if (now.asked.length) what = `the app asked: ${now.asked.join(', ')}`
      else if (now.links.some((u) => pages.opens(u, `${kit.url}/`))) what = `the app opened ${now.links[0]}`
      else if (asked.length) what = `asked ${asked[0]}`
      else if (now.scrolls) what = 'it scrolled'
      else if (now.sounds) what = 'a sound'
      else if (st.popups > n0.popups || st.dialogs > n0.dialogs || st.downloads > n0.downloads || st.choosers > n0.choosers) what = 'a window, dialog, download or picker'
      else if (p.url() !== n0.url) what = 'the address'
      else if (now.focus && now.focus !== was) what = 'the focus'
      if (!what) await sleep(50)
    }
    await p.evaluate(() => document.querySelectorAll('[data-dc]').forEach((e) => e.removeAttribute('data-dc'))).catch(() => {})
    return { what }
  }
  const pressAll = async (pl, items, base) => {
    for (const it of items) {
      // A row of the same (Add a key, Download): the first three of them.
      if (it.nth >= 3) continue
      const why = skipOf(pl.name, it.name)
      if (why) { skipped.push(`${pl.name} · ${it.name}: ${why[1]}`); continue }
      const q = QUIET.find((x) => (x.is ? x.is(it) : x.place.test(pl.name) && x.name.test(it.name)))
      if (q) { quiet.push(`${pl.name} · ${it.name}: ${q.what}`); continue }
      const tp = Date.now()
      let r = await press(pl, it).catch((e) => ({ failed: e.message.split('\n')[0] }))
      // Not there now (a press before it went somewhere else in the place): the place again, once.
      if (r.gone && pl.open) { base = await goTo(pl); r = await press(pl, it).catch((e) => ({ failed: e.message.split('\n')[0] })) }
      // Nothing came of it: once more, from the page loaded again (what changed by itself then may not now).
      if (!r.gone && !r.covered && !r.failed && !r.what) { base = await goTo(pl, true); r = await press(pl, it).catch((e) => ({ failed: e.message.split('\n')[0] })) }
      if (DEBUG) console.log(`  ${shape} ${pl.name} · ${it.name}: ${r.gone ? '(gone)' : r.covered ? '(covered)' : r.failed ? `(${r.failed})` : r.what || 'NOTHING'} ${Date.now() - tp} ms`)
      if (r.gone || r.covered || r.failed) { missed++; continue }
      if (!r.what) dead.push({ place: pl.name, name: it.name, html: it.html })
      // Back as it was: Escape for a menu or a dialog, else the place again.
      if (await p.evaluate(WHERE, pl.scope).catch(() => null) !== base) {
        await p.keyboard.press('Escape').catch(() => {})
        await sleep(150)
        if (await p.evaluate(WHERE, pl.scope).catch(() => null) !== base) base = await goTo(pl)
      }
      // A menu that came of it (the top bar's): each thing in it pressed too, the menu opened again for each.
      if (pl.drill) {
        const menu = {
          name: `${pl.name} › ${it.name}`, scope: '[role="menu"], .menu, .popover',
          open: async () => { if (await p.evaluate(MARK, { scope: pl.scope, name: it.name, nth: it.nth })) { await p.locator('[data-dc="1"]').click({ timeout: 800 }).catch(() => {}); await sleep(200) } },
        }
        await goTo(menu)
        const inside = await p.evaluate(LIST, menu.scope)
        for (const [i, sub] of inside.entries()) await pressAll(menu, [sub], i ? await goTo(menu) : await p.evaluate(WHERE, menu.scope))
        base = await goTo(pl)
      }
    }
  }
  // ---------- an agent's Files, as the owner found it ----------
  // Collapse all, drawn as an expand (four arrows out) and doing nothing with no folder open: now
  // folds, is off saying why with nothing open, and on once a folder is. A file's Open in a new tab,
  // which did nothing in the desktop app: there it opens the file in the browser, and says so. And
  // Full size's way back no longer looks the same as it (its arrows point in).
  if (!ONLY) {
    const there = desktop ? 'in the desktop app' : 'in a browser'
    await goTo(PLACES.find((x) => x.name === 'an agent\'s Files'), true)
    const fold = p.locator('.tree-head button[aria-label="Collapse all"]')
    const off = { disabled: await fold.isDisabled(), title: await fold.getAttribute('title'), icon: await fold.locator('svg').innerHTML() }
    ok(off.disabled && /no folder is open/.test(off.title) && !/m15 15 6 6/.test(off.icon), `${there}, with no folder open, Files' Collapse all is off and says why, and isn't drawn as an expand`, off)
    await p.locator('.files-view .tree-row', { hasText: 'src' }).first().click()
    await p.locator('.files-view .tree-row', { hasText: 'index.js' }).waitFor({ timeout: 5000 }).catch(() => {})
    const on = !(await fold.isDisabled())
    if (on) await fold.click()
    const shut = await p.locator('.files-view .tree-row', { hasText: 'index.js' }).waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false)
    ok(on && shut && await fold.isDisabled(), `${there}, with a folder open it's on, and closes it`, { on, shut })
    await p.locator('.files-view .tree-row', { hasText: 'dot.png' }).first().click()
    const link = p.locator('.viewer-head a.win-btn[target="_blank"]')
    await link.waitFor({ timeout: 8000 }).catch(() => {})
    const label = await link.getAttribute('aria-label').catch(() => null)
    const was = { links: (await p.evaluate(() => window.__dc.links.length)), popups: st.popups }
    await link.click().catch(() => {})
    // The new tab, or the address handed to the app, waited for: a busy browser opens a tab a while after the click.
    await until(async () => (desktop ? (await p.evaluate(() => window.__dc.links.length)) > was.links : st.popups > was.popups), 10000, 100)
    const went = desktop ? (await p.evaluate(() => window.__dc.links)).slice(was.links) : []
    ok(desktop ? label === 'Open in your browser' && went.length === 1 && pages.opens(went[0], `${kit.url}/`) === 'browser' && /\/raw\?path=dot\.png/.test(went[0]) : label === 'Open in a new tab' && st.popups > was.popups,
      desktop ? 'in the desktop app, a picture\'s Open in your browser hands the app its address, which opens it in the browser' : 'in a browser, a picture\'s Open in a new tab opens one', { label, went, popups: st.popups - was.popups })
    const full = p.locator('.console .pane-head button[aria-label="Full size"]')
    const outIcon = await full.locator('svg').innerHTML().catch(() => '')
    await full.click().catch(() => {})
    const back = p.locator('.console .pane-head button[aria-label="Exit full size"]')
    const inIcon = await back.locator('svg').innerHTML().catch(() => '')
    ok(!!outIcon && !!inIcon && outIcon !== inIcon && !/m15 15 6 6/.test(inIcon), `${there}, Full size and its way back look different`, { outIcon, inIcon })
    await back.click().catch(() => {})
  }

  for (const pl of PLACES.filter((x) => !ONLY || ONLY.test(x.name))) {
    const tp = Date.now()
    const base = await goTo(pl, true)
    const items = await p.evaluate(LIST, pl.scope)
    ok(items.length > 0, `in ${desktop ? 'the desktop app' : 'a browser'}, ${pl.name} has buttons to press`, pl.scope)
    await pressAll(pl, items, base)
    if (DEBUG) console.log(`${shape} ${pl.name}: ${items.length} in ${Date.now() - tp} ms`)
  }
  await shot(p, `${tag}dead-clicks-${shape}`)
  await ctx.close()
  return { dead, skipped, quiet, pressed, missed, errors }
}

try {
  if (pane) {
    // ---------- what fails says why ----------
    // A click whose request fails (here, refused by a route) shows why, where it was silent: deleting
    // a saved prompt; and opening an agent in its own window when the browser blocks pop-ups.
    await kit.api('/prompts', { name: 'Weekly note', text: 'Write the weekly note for {{week}}.' })
    const { p, ctx, errors } = await page(b, kit.url, { before: async (c) => {
      await noServiceWorker(c)
      await c.route(/\/api\/prompts\/[^/?]+(\?|$)/, (r) => (r.request().method() === 'DELETE' ? r.fulfill({ status: 500, json: { error: 'the disk is full' } }) : r.fallback()))
      await c.addInitScript(() => { window.open = () => null })
    } })
    const dialogs = []
    p.on('dialog', (d) => { dialogs.push(d.message()); d.accept().catch(() => {}) })
    await p.locator('.rail').waitFor({ timeout: 30000 }).catch(() => {})
    await p.locator('.rail').getByText(/Projects[\\/]site/).first().click({ timeout: 10000 }).catch(() => {}) // (Windows: Projects\site)
    await p.locator('.console button[aria-label="Saved prompts"]').first().waitFor({ timeout: 15000 }).catch(() => {})
    await p.locator('.console button[aria-label="Saved prompts"]').first().click({ timeout: 10000 }).catch(() => {})
    await p.locator('.saved-pop button[aria-label="Delete Weekly note"]').click({ timeout: 5000 }).catch(() => {})
    const said = await p.locator('.saved-pop .error-text').innerText({ timeout: 5000 }).catch(() => '')
    ok(/Couldn't delete it: the disk is full/.test(said), 'a saved prompt that couldn\'t be deleted says why', { said, dialogs })
    await p.keyboard.press('Escape')
    const n = dialogs.length
    await p.locator('.console button[aria-label="Open in its own window"]').first().click({ timeout: 5000 }).catch(() => {})
    await until(() => dialogs.slice(n).length, 5000, 100)
    ok(dialogs.slice(n).some((m) => /blocked the new window/.test(m)), 'opened in its own window with pop-ups blocked: it says the browser blocked it, and what to do', dialogs.slice(n))
    ok(!withoutCutOff(errors).length, 'and no page errors', errors)
    await ctx.close()
    const [desk, web] = await Promise.all([walk('desktop'), walk('browser')])
    for (const [shape, r] of [['the desktop app', desk], ['a browser', web]]) {
      ok(r.pressed > 150, `in ${shape}, the main views' buttons and links are pressed (${r.pressed}; ${r.missed} gone or covered by then, ${r.skipped.length} skipped)`, r.pressed)
      ok(!r.dead.length, `in ${shape}, each one pressed does something you can see`, r.dead.map((d) => `${d.place} · "${d.name}" ${d.html}`))
      ok(!withoutCutOff(r.errors).length, `in ${shape}, no page errors`, withoutCutOff(r.errors).slice(0, 3))
      if (DEBUG) console.log(`${shape} skipped:\n  ${[...r.skipped, ...r.quiet].join('\n  ')}`)
    }
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  console.log(`took ${Math.round((Date.now() - t0) / 1000)} s`)
  kit.stop()
  await b.close()
}
process.exit(done().fail ? 1 : 0)
