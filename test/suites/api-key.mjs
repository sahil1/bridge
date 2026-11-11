// Bridge AI's key for its own API (server/apitoken.js, apiauth.js): the server answers on 127.0.0.1,
// where every program on the computer can reach it, and only Bridge AI's own windows, programs and
// the browsers you let in get anything. Checked without a browser: no key, or a wrong one, is
// refused with words saying where the key is; the key is in a file only you can read; what's public
// on purpose (the app's own files, /api/health) is, and its page isn't (a page saying how to get in
// instead); the one-time link works once, for the address it was made for, and leaves a cookie no
// page script or other site's page carries; it can't be made from a phone; a link followed from
// another site is sent on once from here; another Host (DNS rebinding) and another site's page are
// still refused with the key; a terminal's WebSocket needs it; an HTML preview's own files load
// with the key its address carries, for that folder only; the CLI and the Chief of Staff's bridge
// send it, and say why when it's wrong; the desktop app's key and cookie are the server's.
// In the browser (BRIDGE_TEST_BROWSER): a browser never let in says how to get in, and opens the app
// by itself once the one-time link has let it in in another tab; then the app works, through a
// reload too, with the cookie out of the page's reach; and an HTML preview's picture loads in its
// sandbox. And the desktop app's windows (Electron, with its preload, let in as desktop/main.js lets
// them in): the main window, an agent's own window, the floating card, the dictation pill and a
// window showing another of your computers each open the app and reach their API.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import WebSocket from 'ws'
import { ROOT, TEST, IS_WIN, startKit, startRelay, checks, until, browser, page, shot, electronBin } from '../lib/harness.mjs'

const { ok, skip, done } = checks('api-key')
const require = createRequire(import.meta.url)
const desktopKey = require('../../desktop/apitoken.js')
const server = await import('../../server/apitoken.js')
const kits = []
const relays = []
let b = null
let el = null
const req = (k, p, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port: k.port, path: p, method, headers: { host: `127.0.0.1:${k.port}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
    let s = ''
    res.on('data', (c) => { s += c })
    res.on('end', () => { let j = null; try { j = JSON.parse(s) } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, j, text: s }) })
  })
  r.on('error', (e) => resolve({ status: 0, error: e.message }))
  r.end(body ? JSON.stringify(body) : undefined)
})
const bearer = (k) => ({ authorization: `Bearer ${k.key}` })
const cookie = (k) => ({ cookie: `${k.cookie.name}=${k.cookie.value}` })
const doc = { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', accept: 'text/html' }
try {
  const kit = await startKit('api-key', { env: { BRIDGE_COMPUTER_NAME: 'Studio' } })
  kits.push(kit)
  await kit.api('/setup', { name: 'Tester' })

  // ---------- Without a browser ----------
  {
    const file = path.join(kit.data, 'api-token')
    ok(fs.existsSync(file) && /^[A-Za-z0-9_-]{32,}$/.test(kit.key), 'the server made its key, in its data folder')
    if (!IS_WIN) ok((fs.statSync(file).mode & 0o777) === 0o600, 'only you can read it', (fs.statSync(file).mode & 0o777).toString(8))
    const none = await req(kit, '/api/config')
    ok(none.status === 401 && none.j?.code === 'apiKey' && /needs its key/.test(none.j?.error || '') && /api-token/.test(none.j.error) && /Open in Browser/.test(none.j.error), 'no key: refused, saying where a program finds it and how a browser gets in', none.j)
    const wrong = await req(kit, '/api/config', { headers: { authorization: 'Bearer 0123456789abcdefghijklmnopqrstuvwxyzABCD' } })
    const wrongCookie = await req(kit, '/api/config', { headers: { cookie: `${kit.cookie.name}=not-it` } })
    ok(wrong.status === 401 && wrong.j?.code === 'apiKey' && wrongCookie.status === 401, 'a wrong key, or a wrong cookie: refused the same way', [wrong.status, wrongCookie.status])
    ok((await req(kit, '/api/config', { headers: bearer(kit) })).status === 200 && (await req(kit, '/api/config', { headers: cookie(kit) })).status === 200, 'the key, or the cookie made from it: answered')
    const posted = await req(kit, '/api/settings', { method: 'PATCH', body: { name: 'Taken' } })
    ok(posted.status === 401 && (await kit.api('/config')).name === 'Tester', 'a change without it: refused, and nothing changed', posted.status)
    const health = await req(kit, '/api/health')
    const healthIn = await req(kit, '/api/health', { headers: bearer(kit) })
    ok(health.status === 200 && health.j?.app === 'Bridge AI' && health.j.in === false && healthIn.j?.in === true && !('computer' in health.j) && !('pid' in health.j), '/api/health is public: that Bridge AI is here and its version, and whether you\'re let in, nothing more', health.j)
    const entry = /src="\.?\/(assets\/[^"]+\.js)"/.exec(fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8'))?.[1]
    const files = await Promise.all([`/${entry}`, '/sw.js', '/manifest.webmanifest', '/icon.svg'].map((p) => req(kit, p)))
    ok(!!entry && files.every((r) => r.status === 200), 'the app\'s own files are public (its code, the same for everyone with this version)', files.map((r) => r.status))
    const pagesOut = await Promise.all(['/', '/index.html', '/?window=w1', '/something'].map((p) => req(kit, p, { headers: doc })))
    ok(pagesOut.every((r) => r.status === 401 && /Open Bridge AI from the app/.test(r.text) && /View › Open in Browser/.test(r.text) && /bridge-ai open/.test(r.text) && !/<script type="module"/.test(r.text)), 'its page isn\'t: a page saying how to get in, in plain words, instead', pagesOut.map((r) => r.status))
    ok(/frame-ancestors 'self'/.test(pagesOut[0].headers['content-security-policy'] || '') && /script-src 'sha256-/.test(pagesOut[0].headers['content-security-policy']), 'which no other site can frame, and runs only its own script', pagesOut[0].headers['content-security-policy'])
    const parts = (await req(kit, '/api/missing')).status
    ok(parts === 401, 'nor anything else under /api', parts)

    // The one-time link.
    const fromPhone = await req(kit, '/api/browser-link', { method: 'POST', body: {}, headers: { ...bearer(kit), 'x-bridge-relay': 'a-phone' } })
    ok(fromPhone.status === 403, 'a one-time link can\'t be made from a phone', fromPhone.status)
    const { url, expires } = await kit.api('/browser-link', {})
    const u = new URL(url)
    ok(u.origin === kit.url && /^\?open=[\w-]{20,}$/.test(u.search) && Math.abs(Date.parse(expires) - Date.now() - 120000) < 10000, 'a one-time link: this computer\'s address, good for two minutes', url)
    const first = await req(kit, `${u.pathname}${u.search}`, { headers: doc })
    const set = String(first.headers['set-cookie'] || '')
    const v = new RegExp(`${kit.cookie.name}=([^;]+)`).exec(set)?.[1]
    ok(first.status === 303 && first.headers.location === '/' && v === kit.cookie.value, 'opened: let in, and sent on to the app', { status: first.status, location: first.headers.location })
    ok(/HttpOnly/i.test(set) && /SameSite=Strict/i.test(set) && /Path=\//.test(set) && /Max-Age=\d{7,}/.test(set) && !/Domain=/i.test(set), 'the cookie: out of reach of page scripts, kept from other sites\' pages and links, for every path, kept for months', set)
    const again = await req(kit, `${u.pathname}${u.search}`, { headers: doc })
    ok(again.status === 401 && /That link has been used/.test(again.text) && !again.headers['set-cookie'], 'the same link again: used, saying so, and no cookie', again.status)
    const made = (to) => kit.api('/browser-link', { to }).then((r) => new URL(r.url).search)
    const landed = await req(kit, `/${await made('/?window=w1%3Ap2')}`, { headers: doc })
    const elsewhere = await req(kit, `/${await made('//example.com/')}`, { headers: doc })
    ok(landed.headers.location === '/?window=w1%3Ap2' && elsewhere.headers.location === '/', 'it lands where it was made for, on this server only', [landed.headers.location, elsewhere.headers.location])
    const inAlready = await req(kit, '/?open=nothing&window=w1', { headers: { ...doc, ...cookie(kit) } })
    ok(inAlready.status === 303 && inAlready.headers.location === '/?window=w1', 'a used link in a browser that\'s let in: the app, with the link taken off the address', inAlready.headers.location)
    const bounce = await req(kit, '/?early=CODE', { headers: { ...doc, 'sec-fetch-site': 'cross-site' } })
    ok(bounce.status === 401 && /location\.replace\(location\.href\)/.test(bounce.text) && /script-src 'sha256-/.test(bounce.headers['content-security-policy'] || ''), 'a link to Bridge AI followed from another site (which leaves the cookie behind): sent on once from here', bounce.text.slice(0, 200))

    // What guard.js refuses, it still refuses with the key.
    ok((await req(kit, '/api/config', { headers: { ...bearer(kit), host: 'evil.example' } })).status === 403 && (await req(kit, '/api/config', { headers: { ...cookie(kit), host: `rebind.example:${kit.port}` } })).status === 403, 'another Host (DNS rebinding) is refused, key or cookie')
    ok((await req(kit, '/api/config', { headers: { ...cookie(kit), origin: 'http://localhost:8000' } })).status === 403 && (await req(kit, '/api/config', { headers: { ...cookie(kit), 'sec-fetch-site': 'cross-site' } })).status === 403, 'and a page on another site or port, with the cookie')

    // A terminal's WebSocket.
    const sh = await kit.api('/agents/launch', { kind: 'shell', cwd: kit.home, label: 'Terminal', newSpace: 'Terminals' })
    const sock = (headers) => new Promise((resolve) => {
      const w = new WebSocket(`ws://127.0.0.1:${kit.port}/api/panes/${encodeURIComponent(sh.paneId)}/attach?cols=80&rows=24`, { headers })
      w.on('open', () => { w.close(); resolve(101) })
      w.on('unexpected-response', (_q, r) => resolve(r.statusCode))
      w.on('error', () => resolve(0))
    })
    ok(await sock({}) === 401 && await sock({ authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong-wr' }) === 401, 'a terminal\'s WebSocket without the key, or with a wrong one: refused')
    ok(await sock(bearer(kit)) === 101 && await sock({ ...cookie(kit), origin: kit.url }) === 101, 'with the key (bridge-ai attach) or the cookie (its page): opened')

    // An HTML preview's own files.
    fs.writeFileSync(path.join(kit.home, 'index.html'), '<!doctype html><link rel="stylesheet" href="style.css"><img id="pic" src="pic.svg">')
    fs.writeFileSync(path.join(kit.home, 'style.css'), 'body { color: red }')
    fs.writeFileSync(path.join(kit.home, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>')
    const pane = encodeURIComponent(sh.paneId)
    const keyRes = await req(kit, `/api/agents/${pane}/site-key`)
    const { key } = await kit.api(`/agents/${pane}/site-key`)
    ok(keyRes.status === 401 && /^[\w-]{32}$/.test(key || ''), 'a preview\'s key is given only with Bridge AI\'s', keyRes.status)
    const withKey = await req(kit, `/api/agents/${pane}/site/~${key}/style.css`, { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'style' } })
    const noKey = await req(kit, `/api/agents/${pane}/site/style.css`, { headers: { 'sec-fetch-site': 'cross-site' } })
    const badKey = await req(kit, `/api/agents/${pane}/site/~${'x'.repeat(32)}/style.css`)
    ok(withKey.status === 200 && /color: red/.test(withKey.text) && noKey.status === 401 && badKey.status === 404, 'its files load from its sandbox (no cookie) with the key in their address; not without it, nor with another', [withKey.status, noKey.status, badKey.status])
    const sh2 = await kit.api('/agents/launch', { kind: 'shell', cwd: path.join(kit.home), label: 'Other', newSpace: 'Terminals' })
    const other = await req(kit, `/api/agents/${encodeURIComponent(sh2.paneId)}/site/~${key}/style.css`)
    const post = await req(kit, `/api/agents/${pane}/site/~${key}/style.css`, { method: 'POST', body: {} })
    ok(other.status === 404 && post.status === 401, 'the key is that folder\'s alone, and only to read', [other.status, post.status])

    // The CLI and the Chief of Staff's bridge.
    const cli = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'cli.js'), ...a], { env: { ...process.env, HOME: kit.home, BRIDGE_HOME: kit.data, BRIDGE_PORT: String(kit.port) }, encoding: 'utf8', timeout: 30000 })
    const st = cli('status')
    ok(st.status === 0 && /Bridge AI .* is running at/.test(st.stdout), 'bridge-ai status: answered, with the key from the data folder', st.stdout + st.stderr)
    const printed = cli('open', '--print')
    const link = /http:\/\/127\.0\.0\.1:\d+\/\?open=[\w-]+/.exec(printed.stdout)?.[0]
    const viaCli = link && await req(kit, new URL(link).pathname + new URL(link).search, { headers: doc })
    ok(printed.status === 0 && viaCli?.status === 303 && /bridge-ai-\d+=/.test(String(viaCli.headers['set-cookie'])), 'bridge-ai open --print: a one-time link that lets a browser in', printed.stdout)
    const empty = path.join(kit.dir, 'elsewhere')
    fs.mkdirSync(empty, { recursive: true })
    fs.writeFileSync(path.join(empty, 'api-token'), 'not-the-key-not-the-key-not-the-key-00\n')
    const bad = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'cli.js'), 'list'], { env: { ...process.env, HOME: kit.home, BRIDGE_HOME: empty, BRIDGE_PORT: String(kit.port) }, encoding: 'utf8', timeout: 30000 })
    ok(bad.status === 1 && /needs its key/.test(bad.stderr), 'with a key that isn\'t this server\'s: says so', bad.stderr)
    const chiefBin = path.join(kit.data, 'chief', 'bin', 'bridge')
    const said = JSON.parse(fs.readFileSync(path.join(kit.data, 'chief', 'bin', 'bridge.json'), 'utf8'))
    const chief = (...a) => spawnSync(process.execPath, [chiefBin, ...a], { env: { ...process.env, HOME: kit.home, BRIDGE_HOME: '' }, encoding: 'utf8', timeout: 30000 })
    const added = chief('task', 'add', 'Check the key')
    const listed = chief('task', 'list')
    ok(said.key === path.join(kit.data, 'api-token') && added.status === 0 && /Added task/.test(added.stdout) && /Check the key/.test(listed.stdout), 'the Chief of Staff\'s bridge (its copy in the data folder) finds the key where bridge.json says, and works', added.stdout + added.stderr)

    // The desktop app makes the same key and cookie as the server.
    const fresh = path.join(kit.dir, 'fresh-data')
    const made1 = desktopKey.ensure(fresh)
    ok(made1 === desktopKey.ensure(fresh) && made1 === server.readToken(path.join(fresh, 'api-token')) && (IS_WIN || (fs.statSync(path.join(fresh, 'api-token')).mode & 0o777) === 0o600), 'the desktop app, first: makes the key as the server would, for you only, once')
    ok(desktopKey.cookieValue(kit.key) === kit.cookie.value && desktopKey.cookieName(kit.port) === kit.cookie.name && server.cookieValue(kit.key) === kit.cookie.value, 'and gives its windows the cookie the server takes')
    const main = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8')
    const ready = main.slice(main.indexOf('app.whenReady()'))
    ok(ready.indexOf('await letInWindows()') > 0 && ready.indexOf('await letInWindows()') < ready.indexOf('createWindow()'), 'the desktop app lets its windows in before the first one opens')
    ok(main.split('globalThis.fetch(').length === 2 && /const fetch = \(u, o = \{\}\) => globalThis\.fetch\(u, ownServer\(u\)/.test(main), 'and its own requests to its server all send the key (one fetch, which sends it to its server alone)')
    ok(/'Open in Browser', click: \(\) => \{ openInBrowser\(\)/.test(main), 'View › Open in Browser opens a one-time link')
    const preload = fs.readFileSync(path.join(ROOT, 'desktop', 'preload.js'), 'utf8')
    ok(!/token|apiKey|api-token|cookie/i.test(preload), 'the preload hands no page the key or the cookie')
  }

  // ---------- In the browser ----------
  ;({ b } = await browser())
  const which = b.browserType().name()
  const tag = which === 'webkit' ? 'webkit-' : ''
  {
    // A browser never let in: no cookie (a context of its own, made without the harness's).
    const pw = await import('playwright-core')
    const cold = await pw[which].launch()
    try {
      for (const mode of ['light', 'dark']) {
        const ctx = await cold.newContext({ viewport: { width: 1024, height: 700 }, colorScheme: mode })
        const p = await ctx.newPage()
        await p.goto(`${kit.url}/?window=w1`)
        const words = await p.locator('main').innerText().catch(() => '')
        ok(/Open Bridge AI from the app/.test(words) && /View › Open in Browser/.test(words), `a browser never let in (${mode}): it says how to get in`, words)
        await shot(p, `${tag}api-key-how-to-${mode}`)
        if (mode === 'light') {
          // The one-time link, opened in another tab as the app opens it: this one opens by itself.
          const { url } = await kit.api('/browser-link', {})
          const other = await ctx.newPage()
          await other.goto(url)
          const inApp = await until(async () => (await p.locator('script[type=module]').count()) > 0 && !/Open Bridge AI from the app/.test(await p.locator('body').innerText().catch(() => '')), 15000)
          ok(!!inApp && p.url().endsWith('/?window=w1'), 'once the link has let it in in another tab, the first opens the app by itself, at its own address', p.url())
          await other.goto(kit.url)
          ok(await other.evaluate(async () => (await fetch('/api/config')).status) === 200, 'the app reaches its API')
          await other.reload()
          ok(await other.evaluate(async () => (await fetch('/api/fleet')).status) === 200 && await other.evaluate(() => document.cookie) === '', 'through a reload too, with the cookie out of the page\'s reach')
          const cookies = await ctx.cookies(kit.url)
          ok(cookies.some((c) => c.name === kit.cookie.name && c.httpOnly && c.sameSite === 'Strict'), 'the browser keeps it HttpOnly and SameSite=Strict', cookies.map((c) => `${c.name} ${c.httpOnly} ${c.sameSite}`))
        }
        await ctx.close()
      }
    } finally { await cold.close() }
  }
  {
    // An HTML preview, in its sandbox as Files shows it: its picture loads with the key in its
    // address, and not without (the sandbox carries no cookie).
    const { ctx, p } = await page(b, kit.url)
    const shell = (await kit.api('/fleet')).agents?.find((a) => a.tab === 'Terminal')?.paneId || (await kit.api('/panes')).panes.find((x) => x.tab === 'Terminal')?.paneId
    const { key } = await kit.api(`/agents/${encodeURIComponent(shell)}/site-key`)
    const tryFrame = (src) => p.evaluate((src) => new Promise((resolve) => {
      const f = document.createElement('iframe')
      f.setAttribute('sandbox', 'allow-scripts')
      f.srcdoc = `<base href="${src}"><img src="pic.svg" onload="parent.postMessage('loaded','*')" onerror="parent.postMessage('failed','*')">`
      const on = (e) => { if (e.source === f.contentWindow) { removeEventListener('message', on); f.remove(); resolve(e.data) } }
      addEventListener('message', on)
      document.body.append(f)
      setTimeout(() => resolve('no answer'), 8000)
    }), src)
    const base = `${kit.url}/api/agents/${encodeURIComponent(shell)}/site/`
    const keyed = await tryFrame(`${base}~${key}/`)
    const bare = await tryFrame(base)
    ok(keyed === 'loaded', 'an HTML preview\'s picture loads in its sandbox, with the key in its address', keyed)
    // (Chromium's sandbox carries no cookie, so without the key it couldn't; WebKit's carries it.)
    if (which === 'chromium') ok(bare === 'failed', '(without it, it can\'t: the sandbox carries no cookie)', bare)
    await ctx.close()
  }

  // ---------- The desktop app's windows ----------
  const electron = electronBin()
  if (!electron || (process.platform === 'linux' && !process.env.DISPLAY)) skip('the desktop app\'s windows', !electron ? 'Electron isn\'t installed (npm install in desktop/)' : 'no screen')
  else {
    // Another of your computers, linked, for a window showing it at its own port.
    const rs = await startRelay('api-key-studio')
    const rd = await startRelay('api-key-desk')
    relays.push(rs, rd)
    fs.writeFileSync(path.join(kit.data, 'relay.json'), JSON.stringify(rs.relayFile))
    await kit.restart()
    const desk = await startKit('api-key-desk', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rd.relayFile)); return { BRIDGE_COMPUTER_NAME: 'Desk' } } })
    kits.push(desk)
    await desk.api('/setup', { name: 'Tester' })
    ok(!!(await until(async () => (await kit.api('/relay')).online && (await desk.api('/relay')).online, 20000)), 'two computers, each on its relay (unchanged: the relay runs their requests with each one\'s own key)')
    const code = (await desk.api('/relay/pair', {})).pairing.code
    await kit.api('/machines', { link: `${rd.url} ${code}` })
    const m = await until(async () => (await kit.api('/machines')).machines.find((x) => x.name === 'Desk' && x.online && x.port), 30000, 300)
    ok(!!m, 'Studio is linked with Desk, which has a port of its own on Studio')
    const pane = (await kit.api('/panes')).panes[0]?.paneId || 'w1:p1'
    const wins = [['main', '/'], ['agent', `/?window=${encodeURIComponent(pane)}`], ['card', '/?float=1'], ['dictation', '/?dictate=1'], ['desk', `http://127.0.0.1:${m?.port}/m/${m?.id}/`]]
    const { _electron } = await import('playwright-core')
    const env = { ...process.env, KIT_URL: kit.url, KIT_DATA: kit.data, PAGES: JSON.stringify(wins) }
    delete env.ELECTRON_RUN_AS_NODE
    el = await _electron.launch({ executablePath: electron, args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), path.join(TEST, 'stand-ins', 'desktop-windows.cjs')], env, timeout: 60000 })
    // Each window's page, looked at from the app's side: the app's page (not the one saying how to
    // get in), and its API from that page.
    const look = () => el.evaluate(async (_e, deskApi) => {
      const out = {}
      for (const [n, w] of Object.entries(globalThis.wins || {})) {
        const wc = w.webContents
        const html = await wc.executeJavaScript('document.documentElement.outerHTML').catch(() => '')
        const api = await wc.executeJavaScript(`fetch(${JSON.stringify(n === 'desk' ? deskApi : '/api/config')}).then((r) => r.status, (e) => e.message)`).catch((e) => e.message)
        out[n] = { url: wc.getURL(), app: /<script type="module"/.test(html) && !/Open Bridge AI from the app/.test(html), api }
      }
      return out
    }, `/m/${m?.id}/api/config`)
    let seen = null
    await until(async () => { seen = await look(); return Object.keys(seen).length === wins.length && Object.values(seen).every((s) => s.app && s.api === 200) }, 40000, 500)
    ok(!!seen && Object.keys(seen).length === wins.length && Object.values(seen).every((s) => s.app && s.api === 200), 'the desktop app\'s windows: the main window, an agent\'s own, the floating card, the dictation pill and another computer\'s each open the app and reach their API', seen)
  }
} catch (e) {
  ok(false, `crashed: ${e.message}`)
  console.log(e.stack)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  await el?.close().catch(() => {})
  await b?.close().catch(() => {})
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
}
process.exit(done().fail ? 1 : 0)
