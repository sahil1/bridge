// Settings › About & Updates › Update Channel (src/components/settings/About.jsx, server/updates.js):
// anyone picks Stable, Early Access or Nightly, with no code, account or sign-in. A server in the
// desktop app (stood in for, BRIDGE_INSTALL_HOW) with GitHub's releases a stand-in (a nightly, a
// beta, the release): the three, each with its line, Stable to start with and no code anywhere;
// Early Access picked, offered the beta; Nightly, the nightly; Stable again, the release, with
// nothing of either kept; leaving said to keep the version here. Only on the computer itself: through
// the relay or another computer, the channel can't be changed (POST /api/updates/channel, Nightly's
// own switch, or the settings and their file), and their windows show it read-only, saying to change
// it on that computer (a phone through the relay, a window showing another computer). An old
// ?early=<code> link opens About & Updates at the picker, taken off the address and joining nothing;
// Early Access is one click from there. Docker and a clone say it's for the desktop app; Nightly
// switched on there by hand says so, with Leave Nightly. In light and dark, on a computer and on a
// phone (nothing wider than the screen, each choice a whole 40 px target there). And `bridge-ai
// channel` (with `bridge-ai nightly off` going back to the channel under it).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { ROOT, startKit, checks, until, browser, page, shot, freePort, noServiceWorker } from '../lib/harness.mjs'

const { ok, done } = checks('update-channel')
const HOUR = 60 * 60 * 1000

// GitHub, stood in for: its list of releases (newest first) and its latest (the newest that isn't a
// pre-release).
const rel = (tag, o = {}) => ({ tag_name: tag, html_url: `https://github.com/sahil1/bridge/releases/tag/${tag}`, prerelease: !!o.pre, draft: false, body: 'Notes\n\n<!-- macOS 14.0 or later -->\n', published_at: new Date(Date.now() - 30 * HOUR).toISOString() })
const LIST = [rel('v99.1.0-nightly.20261116.7', { pre: true }), rel('v99.1.0-beta.2', { pre: true }), rel('v99.0.0'), rel('v98.0.0')]
const gh = http.createServer((req, res) => {
  const at = new URL(req.url, 'http://x').pathname
  const out = at.endsWith('/releases/latest') ? LIST.find((x) => !x.prerelease) : at.endsWith('/releases') ? LIST : null
  res.writeHead(out ? 200 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(out || { message: 'Not Found' }))
})
const ghPort = await freePort()
await new Promise((r) => gh.listen(ghPort, '127.0.0.1', r))
const kits = []
const kitAs = async (name, how) => {
  const k = await startKit(`channel-${name}`, { env: { BRIDGE_RELEASES_API: `http://127.0.0.1:${ghPort}/repos/sahil1/bridge/releases/latest`, BRIDGE_INSTALL_HOW: how, BRIDGE_MACHINE: JSON.stringify({ platform: 'darwin', arch: 'arm64', os: '15.5', docker: how === 'docker' }) } })
  kits.push(k)
  await k.api('/setup', { name: 'Tester' })
  return k
}
const user = (k) => JSON.parse(fs.readFileSync(path.join(k.data, 'config.json'), 'utf8'))
// Asked as a phone through the relay asks (x-bridge-relay): the status and the error back.
const relayed = (k, p, method, body) => fetch(`${k.url}/api${p}`, { method, headers: { 'content-type': 'application/json', 'x-bridge-relay': 'a-phone' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, error: (await r.json().catch(() => ({}))).error || '' }))

let b = null
try {
  const k = await kitAs('app', 'app')
  let u = await k.api('/updates?refresh=1')
  ok(u.channel === 'stable' && u.latest === '99.0.0' && u.early?.on === false && u.nightly?.on === false, 'Stable to start with: offered the release', u)

  // ---------- Only on the computer itself ----------
  let r = await relayed(k, '/updates/channel', 'POST', { channel: 'early' })
  ok(r.status >= 400 && /on the computer itself/.test(r.error) && (await k.api('/updates')).channel === 'stable', 'through the relay: picking Early Access refused, saying to change it on the computer itself', r)
  r = await relayed(k, '/updates/nightly', 'POST', {})
  ok(r.status >= 400 && (await k.api('/updates')).channel === 'stable', 'and Nightly\'s own switch too', r)
  r = await relayed(k, '/settings', 'PATCH', { updates: { nightly: true } })
  const r2 = await relayed(k, '/settings', 'PATCH', { earlyAccess: { on: true } })
  const r3 = await relayed(k, '/settings/raw', 'PUT', { text: JSON.stringify({ ...user(k), earlyAccess: { on: true } }) })
  ok([r, r2, r3].every((x) => x.status >= 400 && /on the computer itself/.test(x.error)) && (await k.api('/updates')).channel === 'stable' && !user(k).earlyAccess && !user(k).updates?.nightly, 'nor by changing the settings, or their file, from there', [r, r2, r3])
  r = await relayed(k, '/settings', 'PATCH', { updates: { check: true } })
  ok(r.status === 200, 'the rest of the settings change from there as before', r)
  const bad = await k.api('/updates/channel', { channel: 'weird' }).then(() => null, (e) => e)
  ok(!!bad && /stable, early or nightly/.test(bad.message), 'a channel that isn\'t one: refused, naming the three', bad?.message)

  // ---------- The page, in the desktop app ----------
  ;({ b } = await browser())
  const tag = b.browserType().name() === 'webkit' ? 'webkit-' : ''
  const desktop = (cx) => cx.addInitScript(() => { window.bridgeApp = { platform: 'darwin', desktop: true } })
  const about = async (p) => {
    await p.locator('.topbar .search-btn').waitFor({ timeout: 15000 }).catch(() => {})
    await until(async () => {
      if (!(await p.locator('.modal.settings').count())) await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
      return p.locator('.modal.settings').waitFor({ timeout: 1000 }).then(() => true, () => false)
    }, 10000, 300)
  }
  const sec = (p) => p.locator('.st-sec.ab-channel')
  const choice = (p, id) => sec(p).locator(`.ab-channel-pick[data-channel="${id}"]`)
  const picked = async (p) => ((await sec(p).locator('.ab-channel-pick.on').count()) ? sec(p).locator('.ab-channel-pick.on').first().getAttribute('data-channel', { timeout: 1000 }).catch(() => null) : null)
  const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.ab-channel *')].every((x) => x.getBoundingClientRect().right <= window.innerWidth + 1))
  const LINES = { stable: ['Stable', 'Regular releases. The default.'], early: ['Early Access', 'Betas, before everyone else.'], nightly: ['Nightly', 'A build of main each day it changes. It may be broken some days.'] }
  {
    const { ctx, p, errors } = await page(b, k.url, { mode: 'light', theme: 'sky', before: desktop })
    await about(p)
    const shown = await until(async () => (await sec(p).locator('h4').innerText().catch(() => '')) === 'Update Channel' && await sec(p).locator('.ab-channel-pick').count() === 3, 10000)
    const said = {}
    for (const id of Object.keys(LINES)) said[id] = (await choice(p, id).innerText().catch(() => '')).split('\n').map((x) => x.trim()).filter(Boolean)
    ok(!!shown && Object.entries(LINES).every(([id, want]) => JSON.stringify(said[id]) === JSON.stringify(want)), 'About & Updates: Update Channel, with Stable, Early Access and Nightly, each with its line', said)
    ok(await picked(p) === 'stable' && await choice(p, 'stable').locator('input').isChecked(), 'Stable picked to start with')
    const text = await p.locator('.modal.settings').innerText()
    ok(!/early-access code|Have an early|ea1\./i.test(text) &&await sec(p).locator('input:not([type=radio])').count() === 0 && await sec(p).locator('.ab-channel-there').count() === 0, 'no code, account or sign-in asked for anywhere, and nothing read-only on the computer itself', text.slice(0, 600))
    await p.waitForTimeout(400) // Settings' fade-in
    await sec(p).scrollIntoViewIfNeeded()
    await shot(p, `${tag}channel-stable`)

    await choice(p, 'early').click()
    ok(!!(await until(async () => (await k.api('/updates')).channel === 'early', 8000)) && JSON.stringify(user(k).earlyAccess) === '{"on":true}', 'Early Access picked: on it, kept in the settings with no code', user(k).earlyAccess)
    ok(!!(await until(async () => /99\.1\.0-beta\.2 is available \(Beta\)/.test(await p.locator('.st-body').innerText()) && await picked(p) === 'early', 8000)), 'offered the newest beta, Early Access marked', await p.locator('.st-body').innerText().catch(() => ''))
    ok(/^Early Access/.test(await p.locator('.ab-build').innerText()) && /Leaving keeps the version you have: Bridge AI stays on it until a regular release is newer\./.test(await sec(p).innerText()), 'the version line says Early Access, and leaving keeps the version here', await sec(p).innerText())
    const pv = (await k.api('/counts/preview')).report
    ok(pv.channel === 'early' && pv.tester === null, 'the usage stats say Early Access, with no tester (there\'s no code)', { channel: pv.channel, tester: pv.tester })
    await shot(p, `${tag}channel-early`)

    await choice(p, 'nightly').click()
    ok(!!(await until(async () => /99\.1\.0-nightly\.20261116\.7 is available \(Nightly build\)/.test(await p.locator('.st-body').innerText()) && await picked(p) === 'nightly', 8000)) && user(k).updates?.nightly === true, 'Nightly picked: offered the nightly, Nightly marked', await p.locator('.st-body').innerText().catch(() => ''))
    ok((await k.api('/counts/preview')).report.channel === 'nightly', 'the usage stats say Nightly')

    await choice(p, 'stable').click()
    ok(!!(await until(async () => /99\.0\.0 is available/.test(await p.locator('.st-body').innerText()) && await picked(p) === 'stable' && !(await sec(p).locator('.ab-channel-leave').count()), 8000)), 'Stable again: offered the release, Stable marked', await p.locator('.st-body').innerText().catch(() => ''))
    u = await k.api('/updates')
    ok(u.channel === 'stable' && !user(k).earlyAccess && !user(k).updates?.nightly, 'nothing of Early Access or Nightly kept', user(k))
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- Light and dark, on a computer and on a phone ----------
  await k.api('/updates/channel', { channel: 'early' })
  for (const [what, o] of [['dark, on a computer', { mode: 'dark', theme: 'midnight', before: desktop }], ['on a phone', { mode: 'light', theme: 'sky', phone: true }], ['on a phone, dark', { mode: 'dark', theme: 'midnight', phone: true }]]) {
    const { ctx, p, errors } = await page(b, k.url, o)
    await about(p)
    const shown = await until(async () => await picked(p) === 'early', 10000)
    await sec(p).scrollIntoViewIfNeeded().catch(() => {})
    const tall = o.phone ? await sec(p).locator('.ab-channel-pick').evaluateAll((xs) => xs.map((x) => Math.round(x.getBoundingClientRect().height))) : []
    ok(!!shown && await fits(p) && tall.every((h) => h >= 40), `${what}: Early Access marked, nothing wider than the screen${o.phone ? ', each choice a whole 40 px target' : ''}`, tall)
    await shot(p, `${tag}channel-${what.replace(/[^a-z]+/g, '-')}`)
    ok(errors.length === 0, `${what}: no page errors`, errors)
    await ctx.close()
  }

  // ---------- A phone through the relay, and a window showing another computer ----------
  // The phone's page: Bridge AI inside the relay's frame (bridgeRelay), opened from an old tester's
  // link (?early=), in light and dark.
  for (const mode of ['light', 'dark']) {
    const ph = await page(b, `${k.url}/api/config`, { phone: true, mode, theme: mode === 'dark' ? 'midnight' : 'sky' })
    await ph.p.evaluate(() => {
      window.bridgeRelay = {
        WebSocket: class extends WebSocket { constructor(u) { super(`ws://${location.host}${u}`) } },
        computers: { list: () => [{ relay: location.origin, name: 'Desk', current: true }], open: () => {}, add: () => {}, forget: async () => {} },
      }
      document.open()
      document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style><iframe id="app" src="/?early=ea1.from-an-old-link"></iframe>')
      document.close()
    })
    const app = ph.p.frameLocator('#app')
    const s = app.locator('.st-sec.ab-channel')
    const shown = await until(async () => (await s.locator('.ab-channel-pick.on').getAttribute('data-channel').catch(() => null)) === 'early' && await s.locator('.ab-channel-there').count() === 1, 20000)
    const off = await s.locator('input[type=radio]').evaluateAll((xs) => xs.map((x) => x.disabled))
    ok(!!shown && off.length === 3 && off.every(Boolean) && (await s.locator('.ab-channel-there').innerText()) === 'Change it in Bridge AI on that computer.', `a phone through the relay (${mode}): the ?early link opens the picker, read-only, Early Access marked, saying to change it on that computer`, off)
    await s.locator('.ab-channel-pick[data-channel="stable"]').click({ force: true }).catch(() => {})
    await ph.p.waitForTimeout(500)
    const frame = ph.p.frames().find((f) => f !== ph.p.mainFrame())
    const inside = await frame?.evaluate(() => ({ at: location.href, wide: document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.ab-channel *')].every((x) => x.getBoundingClientRect().right <= window.innerWidth + 1) })).catch(() => null)
    ok((await k.api('/updates')).channel === 'early' && inside?.wide && !/early=/.test(inside?.at || ''), 'a tap there changes nothing, nothing is wider than the screen, and the link is taken off the address', inside)
    await shot(ph.p, `${tag}channel-phone-relay-${mode}`)
    await ph.ctx.close()
  }
  {
    // Another computer's window showing this one (its requests come through that computer, as the
    // relay's do: x-bridge-relay).
    const { ctx, p } = await page(b, `${k.url}/m/far/`, {
      before: async (cx) => { await desktop(cx); await noServiceWorker(cx); await cx.route(/\/m\/far\//, async (rt) => {
        if (rt.request().headers().accept === 'text/event-stream') return rt.abort()
        const at = new URL(rt.request().url())
        try { return await rt.fulfill({ response: await rt.fetch({ url: `${k.url}${at.pathname.slice('/m/far'.length)}${at.search}`, headers: { ...rt.request().headers(), 'x-bridge-relay': 'far' } }) }) } catch { /* closed */ }
      }) },
    })
    await about(p)
    const shown = await until(async () => await picked(p) === 'early' && await sec(p).locator('.ab-channel-there').count() === 1, 15000)
    ok(!!shown && (await sec(p).locator('input[type=radio]').evaluateAll((xs) => xs.every((x) => x.disabled))), 'a window showing another computer: read-only, saying to change it on that computer')
    const asked = await p.evaluate(() => fetch('/m/far/api/updates/channel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"channel":"stable"}' }).then((x) => x.status))
    ok(asked >= 400 &&(await k.api('/updates')).channel === 'early', 'and asked from there anyway, refused', asked)
    await shot(p, `${tag}channel-other-computer`)
    await ctx.unrouteAll({ behavior: 'ignoreErrors' })
    await ctx.close()
  }

  // ---------- An old tester's link, on the computer ----------
  await k.api('/updates/channel', { channel: 'stable' })
  {
    const { ctx, p, errors } = await page(b, `${k.url}/?early=${encodeURIComponent('ea1.eyJpZCI6IjEifQ.x')}`, { mode: 'light', theme: 'sky', before: desktop })
    const shown = await until(async () => await picked(p) === 'stable' && await sec(p).isVisible(), 15000)
    const top = await sec(p).evaluate((el) => { const r = el.getBoundingClientRect(); const box = el.closest('.st-scroll')?.getBoundingClientRect(); return !!box && r.top >= box.top - 1 && r.top < box.bottom }).catch(() => false)
    ok(!!shown && top && !/early=/.test(await p.evaluate(() => location.href)) && (await k.api('/updates')).channel === 'stable', 'a ?early=<code> link: About & Updates opens at the Update Channel, taken off the address, joining nothing', await p.evaluate(() => location.href))
    await choice(p, 'early').click()
    ok(!!(await until(async () => (await k.api('/updates')).channel === 'early' && await picked(p) === 'early', 8000)), 'Early Access is one click from there, with no code')
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- Docker and a clone ----------
  const d = await kitAs('docker', 'docker')
  const c = await kitAs('source', 'source')
  for (const [what, kit, why] of [['Docker', d, "Early Access and Nightly are for the desktop app. Bridge AI in Docker updates by its image's tag, which stays on regular releases."], ['a clone', c, 'Early Access and Nightly are for the desktop app. Bridge AI from a clone updates with git pull, which is main already.']]) {
    const e = await kit.api('/updates/channel', { channel: 'early' }).then(() => null, (x) => x)
    ok(/is for the desktop app/.test(e?.message || '') && (await kit.api('/updates')).channel === 'stable', `${what}: Early Access refused, saying it's for the desktop app`, e?.message)
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', before: desktop })
    await about(p)
    const said = await until(async () => (await sec(p).locator('.ab-channel-why').innerText().catch(() => '')) === why, 10000)
    ok(!!said && await sec(p).locator('input').count() === 0, `${what}: About & Updates says why the channels aren't here, with nothing to pick`, await sec(p).innerText().catch(() => ''))
    await shot(p, `${tag}channel-${what.replace(/[^a-z]+/gi, '-').toLowerCase()}`)
    ok(errors.length === 0, `${what}: no page errors`, errors)
    await ctx.close()
  }
  {
    // Nightly switched on by hand in Docker: it says so, with the way back.
    await d.api('/settings', { updates: { nightly: true } }, 'PATCH')
    const { ctx, p, errors } = await page(b, d.url, { mode: 'dark', theme: 'midnight', before: desktop })
    await about(p)
    const said = await until(async () => /Nightly is switched on, but it's for the desktop app: Bridge AI in Docker updates by its image's tag/.test(await sec(p).locator('.st-note').innerText().catch(() => '')), 10000)
    ok(!!said && (await d.api('/updates')).channel === 'stable', 'Docker with Nightly switched on by hand: still Stable, saying why', await sec(p).innerText().catch(() => ''))
    await shot(p, `${tag}channel-docker-nightly`)
    await sec(p).locator('button', { hasText: 'Leave Nightly' }).click()
    ok(!!(await until(async () => !user(d).updates?.nightly && await sec(p).locator('.ab-channel-why').count() === 1, 8000)), 'Leave Nightly: switched off, and the note as before')
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- bridge-ai channel ----------
  // (Run alongside, not blocking this test: its server's idle connections stay open meanwhile.)
  const cli = (...a) => new Promise((resolve) => execFile(process.execPath, [path.join(ROOT, 'scripts', 'cli.js'), ...a], { env: { ...process.env, BRIDGE_URL: k.url, BRIDGE_HOME: k.data }, encoding: 'utf8', timeout: 30000 }, (e, stdout, stderr) => resolve({ status: e ? e.code ?? 1 : 0, out: `${stdout}${stderr}` })))
  r = await cli('channel')
  ok(r.status === 0 && /^On Early Access: Bridge AI .+ here; 99\.1\.0-beta\.2 is ready/.test(r.out), 'bridge-ai channel: where it stands', r.out)
  r = await cli('channel', 'nightly')
  ok(r.status === 0 && /^Now on Nightly/.test(r.out) && (await k.api('/updates')).channel === 'nightly', 'bridge-ai channel nightly: on Nightly', r.out)
  r = await cli('nightly', 'off')
  ok(r.status === 0 && /back to Early Access/.test(r.out) && (await k.api('/updates')).channel === 'early', 'bridge-ai nightly off: back to the channel under it, Early Access', r.out)
  r = await cli('channel', 'stable')
  ok(r.status === 0 && /^Now on Stable/.test(r.out) && (await k.api('/updates')).channel === 'stable', 'bridge-ai channel stable: Stable', r.out)
  r = await cli('channel', 'beta')
  ok(r.status !== 0 && /bridge-ai channel stable, early or nightly/.test(r.out), 'a channel that isn\'t one: says which there are', r.out)
} finally {
  await b?.close().catch(() => {})
  for (const k of kits) k.stop()
  gh.close()
}

process.exit(done().fail ? 1 : 0)
