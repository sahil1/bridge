// Share Links (server/shares.js, relay/web/share.js and share-frame.js, the relay's share addresses
// in relay/worker.js), end to end, with Playwright as the person a link was given to and
// lib/viewer.mjs where a test needs the computer's own words. Two computers: Studio on a relay of
// your own (the relay stand-in and its share address: what's shown runs no scripts), and Hosted on
// Bridge AI's relay stood in for, with its share domain (share.localhost), where a site or an app runs
// at a content address of each link's own. Bold Bridge's accounts service is stood in for
// (stand-ins/accounts.mjs, its mailbox), as what emails a named person's code; links' hours are
// seconds here (BRIDGE_TEST_SHARE_HOUR_MS).
//   a file: it shows, and only it; its scripts don't run; the link's secret leaves the address;
//   a folder of files: listed, its pages' relative links; a site or an app refused on a relay of your
//     own, saying why;
//   path escapes refused: .., encoded or not, a backslash, a dot name, a symlink out (not on Windows),
//     a pipe, the folder swapped for a link elsewhere, Bridge AI's own folder;
//   never /api, nor anything else of Bridge AI's, however it's asked;
//   the relay never sees what's shown, the link's secret or the password (its traffic tapped);
//   what a page may send and hold open: nothing before it's let in but small questions, no body to
//     what's only looked at, a few answers at once;
//   hellos for links that don't exist never keep a real one out;
//   a password: a wrong one said with tries left, the fifth locking that page out (another page still
//     gets in), enough from anyone locking the link, your devices told; a reload asks for the link;
//   only named people: an 8-digit code emailed, a wrong one said, an unnamed email answered the same
//     and sent nothing, an email's codes capped, the accounts service sending only to named emails,
//     a __proto__ email harmless, the code to your devices when it can't be emailed;
//   a Studio document: shown as a page, and again as it changes, live;
//   a download let go (cancelled, closed, stopped), on a link and on a phone: the server stays up;
//   expiry and Stop Sharing: an open page ends at once, said, and the link opens no more;
//   the computer offline: said in the owner's words, and the link works again when it's back;
//   your devices told of each link's first open; what's kept (opens, the country, the email);
//   phone parity: a phone makes, sees and stops a link; another device sees it without its secret;
//   the dialog: Share Link from Studio, a link and its QR code;
//   Bridge AI's relay, with its share domain: each link at an address of its own, what it shows at a
//     content address of its own, a site and an app running there, unable to reach the page holding
//     the secret, or anywhere but its own address; a page of it never opened outside its frame;
//     before its password a page costs the account nothing.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import WebSocket, { WebSocketServer } from 'ws'
import { startKit, startRelay, startAccounts, startHostedRelay, checks, until, browser, page, sleep, shot, freePort, phoneFaults, TEST, IS_WIN, stopTree } from '../lib/harness.mjs'
import { viewAs } from '../lib/viewer.mjs'
import { linkAs } from '../lib/linkclient.mjs'
import { K, plainFrame } from '../../relay/web/link.js'

const { ok, skip, done } = checks('share-links')
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: ${String(e.stack || e.message).split('\n').slice(0, 4).join(' | ')}`) } }
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const enc = encodeURIComponent
// A link's hour, in this test.
const HOUR = 8000

// A tap between a page and the relay's share address: every message, both ways, as the relay carries it.
async function tap(target) {
  const port = await freePort()
  const seen = []
  const wss = new WebSocketServer({ port, host: '127.0.0.1' })
  wss.on('connection', (client, req) => {
    const up = new WebSocket(`${target.replace(/^http/, 'ws')}${req.url}`)
    const early = []
    up.on('open', () => { for (const [d, bin] of early.splice(0)) up.send(d, { binary: bin }) })
    client.on('message', (d, bin) => { seen.push(Buffer.from(d)); if (up.readyState === 1) up.send(d, { binary: bin }); else early.push([d, bin]) })
    up.on('message', (d, bin) => { seen.push(Buffer.from(d)); if (client.readyState === 1) client.send(d, { binary: bin }) })
    client.on('close', () => up.close())
    up.on('close', () => client.close())
    up.on('error', () => {})
    client.on('error', () => {})
  })
  return { url: `http://127.0.0.1:${port}`, seen, stop: () => wss.close() }
}

// Somewhere else on the web, where what's shown might try to send what it finds.
const loot = []
const elsewhere = http.createServer((req, res) => { let b2 = ''; req.on('data', (c) => { b2 += c }); req.on('end', () => { loot.push({ path: req.url, body: b2 }); res.writeHead(200, { 'access-control-allow-origin': '*' }); res.end('ok') }) })
await new Promise((r) => elsewhere.listen(0, '127.0.0.1', r))
const EX = `http://127.0.0.1:${elsewhere.address().port}`

// An app an agent's `npm run dev` would serve: a page with a button that POSTs, a counter, its own
// absolute paths, a cookie it sets, a look at what it was sent, and a try at the page around it.
const APP = String.raw`
import http from 'node:http'
let count = 0
const ex = process.argv[3]
const page = '<!doctype html><html><head><meta charset="utf-8"><title>Counter App</title><link rel="stylesheet" href="/style.css"></head><body><h1 id="n">0</h1><button id="add">Add</button><p id="api">?</p><p id="parent">?</p>' +
  '<script>const n = document.getElementById("n"); fetch("/count").then((r) => r.json()).then((j) => { n.textContent = j.count });' +
  'document.getElementById("add").onclick = () => fetch("/add", { method: "POST", body: "1" }).then((r) => r.json()).then((j) => { n.textContent = j.count });' +
  'fetch("/api/config").then((r) => r.text()).then((t) => { document.getElementById("api").textContent = t }, () => { document.getElementById("api").textContent = "failed" });' +
  'let got = []; for (const f of [() => top.location.href, () => parent.parent.location.href, () => top.sessionStorage.length, () => top.document.title]) { try { got.push(String(f())) } catch (e) { got.push("blocked") } }' +
  'document.getElementById("parent").textContent = got.join("|"); fetch(' + JSON.stringify(ex) + ' + "/loot-app", { method: "POST", mode: "no-cors", body: got.join("|") }).catch(() => {})</script></body></html>'
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.setHeader('set-cookie', 'sid=app-secret; Path=/'); return res.end(page) }
  if (u.pathname === '/style.css') { res.setHeader('content-type', 'text/css'); return res.end('h1 { color: rgb(0, 128, 0) }') }
  if (u.pathname === '/count') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ count })) }
  if (u.pathname === '/add' && req.method === 'POST') { count++; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ count })) }
  if (u.pathname === '/whoami') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ cookie: req.headers.cookie || '', auth: req.headers.authorization || null, host: req.headers.host, bridge: Object.keys(req.headers).filter((k) => k.startsWith('x-bridge')) })) }
  if (u.pathname === '/go') { res.statusCode = 302; res.setHeader('location', 'http://localhost:' + process.argv[2] + '/count'); return res.end() }
  res.statusCode = 404; res.end('the app has no ' + u.pathname)
}).listen(Number(process.argv[2]), '127.0.0.1', () => console.log('app on', process.argv[2]))
`

const relay = await startRelay('share-links')
const accounts = await startAccounts('share-links')
const hosted = await startHostedRelay('share-links', { SHARE_DOMAIN: 'share.localhost' }, accounts)
const push = path.join(TEST, '.out', `share-links-push-${process.pid}.jsonl`)
fs.rmSync(push, { force: true })
const kits = []
const procs = []
const kit = await startKit('share-links', {
  config: { account: accounts.accountConfig },
  env: (d) => { fs.writeFileSync(path.join(d.data, 'relay.json'), JSON.stringify(relay.relayFile)); return { BRIDGE_TEST_PUSH: push, BRIDGE_TEST_SHARE_HOUR_MS: String(HOUR), BRIDGE_COMPUTER_NAME: 'Studio', BRIDGE_VIEW_IDLE_MS: '3000', BRIDGE_VIEW_WAIT_MS: '4000' } },
})
kits.push(kit)
const hk = await startKit('share-links-hosted', { config: { account: accounts.accountConfig, relay: { hostedUrl: hosted.url } }, env: { BRIDGE_COMPUTER_NAME: 'Hosted' } })
kits.push(hk)
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const share = (body, k = kit) => k.api('/shares', { lasts: 'week', who: 'link', ...body }).then((r) => r.share)
const refusal = (body, k = kit) => k.api('/shares', { lasts: 'week', who: 'link', ...body }).then(() => null, (e) => e.message)
const notes = () => lines(push).map((l) => l.note)
const secretOf = (link) => new URLSearchParams(new URL(link).hash.slice(1)).get('s')
const alive = (k = kit) => fetch(`${k.url}/api/config`).then((r) => r.ok, () => false)
// A page with the link open, as the person it was given to (a browser of their own: none of the
// kit's cookies), and its frame once what's shared shows.
async function viewer(link, opts = {}) {
  const ctx = await b.newContext({ ...(opts.phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}) })
  await ctx.clearCookies()
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(link)
  return { ctx, p, errors }
}
const frameOf = (p, has) => until(async () => { const f = p.frames().find((x) => /\/_c\//.test(x.url())); return f && (await f.locator(has).count()) ? f : null }, 20000, 200)
// A request as what's shared asks it (c: 1, as share.js marks one from its frame): its status.
async function asContent(v, id, req) {
  await v.send(K.REQ, id, { h: [], body: false, ...req, c: 1 })
  let head = null
  for (;;) {
    const r = await v.next()
    if (r.id !== id) continue
    if (r.kind === K.HEAD) head = JSON.parse(Buffer.from(r.body).toString('utf8'))
    else if (r.kind === K.END || r.kind === K.ERR) return head?.s ?? 'error'
  }
}
const codeIn = async (email) => { const m = (await accounts.mail()).filter((x) => x.to === email).at(-1); return /\b(\d{8})\b/.exec(m?.text || '')?.[1] || null }

try {
  await kit.api('/setup', { name: 'Tester' })
  ok(!!(await until(async () => (await kit.api('/relay')).online, 20000)), 'Studio is connected to its relay')
  // Notifications set up on one device of the owner's; signed in to Bold Bridge (codes by email).
  await kit.api('/push/subscribe', { subscription: { endpoint: `https://push.test/owner/${Date.now()}`, keys: { p256dh: 'test', auth: 'test' } }, label: 'Owner phone' })
  await kit.api('/account/code', { email: 'owner@example.com' })
  await kit.api('/account/verify', { email: 'owner@example.com', code: await accounts.code('owner@example.com') })
  const home = kit.home
  fs.writeFileSync(path.join(home, 'outside.txt'), 'OUTSIDE-SECRET')
  // A folder of files: no web pages in it, so a relay of your own shares it.
  const data = path.join(home, 'data')
  for (const d of ['sub', 'img', '.git']) fs.mkdirSync(path.join(data, d), { recursive: true })
  fs.writeFileSync(path.join(data, 'notes.txt'), 'MARKER-DATA notes')
  fs.writeFileSync(path.join(data, 'a b.txt'), 'spaced')
  fs.writeFileSync(path.join(data, 'sub', 'deep.txt'), 'deep file')
  fs.writeFileSync(path.join(data, 'img', 'dot.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
  fs.writeFileSync(path.join(data, '.env'), 'TOKEN=HIDDEN-ENV')
  fs.writeFileSync(path.join(data, '.git', 'config'), 'HIDDEN-GIT')
  fs.writeFileSync(path.join(data, 'big.bin'), Buffer.alloc(8 * 1024 * 1024, 7))

  // ---------- a file ----------
  await part('a file', async () => {
    const dir = path.join(home, 'report')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'report.html'), `<!doctype html><title>Report</title><h1 id="r">Quarterly report MARKER-FILE</h1><p id="js">no script</p><a id="next" href="notes.html">notes</a><img src="${EX}/loot-file-img"><script>document.getElementById('js').textContent = 'ran'; fetch('${EX}/loot-file', { method: 'POST', mode: 'no-cors', body: String(top.location.href) }).catch(() => {})</script>`)
    fs.writeFileSync(path.join(dir, 'notes.html'), 'notes')
    const s = await share({ kind: 'file', root: 'home', path: 'report/report.html' })
    ok(new RegExp(`^${relay.shareUrl}/v/[\\w-]{22}#s=[\\w-]{43}&n=Tester$`).test(s.link) && /<svg/.test(s.qr || '') && s.scripts === false, 'a link at the relay\'s share address (never the phone page\'s), its secret in the fragment, with a QR code; on a relay of your own, what it shows runs no scripts', s.link)
    const v = await viewAs(s.link)
    const about = await v.request('GET', '/.share/about')
    ok(about.json?.title === 'report.html' && about.json.kind === 'file' && about.json.name === 'Tester' && about.json.needs === null && about.json.entry === 'report.html' && about.json.frame === null, 'the page hears what it shows and who shares it', about.json)
    const f = await v.request('GET', '/c/report.html')
    ok(f.status === 200 && /MARKER-FILE/.test(f.text) && /script-src 'none'/.test(f.headers['content-security-policy'] || '') && f.headers['x-content-type-options'] === 'nosniff', 'the file, its scripts off (script-src \'none\'), never sniffed as something else', f.headers)
    const sib = await v.request('GET', '/c/notes.html')
    ok(sib.status === 404 && /Only report\.html is shared/.test(sib.text), 'what it links to beside it isn\'t shared: said', sib.status)
    v.close()
    const { ctx, p, errors } = await viewer(s.link)
    const fr = await frameOf(p, '#r')
    ok(!!fr && /MARKER-FILE/.test(await fr.locator('#r').innerText()), 'in a browser: it shows', fr?.url())
    await sleep(800)
    ok((await fr.locator('#js').innerText()) === 'no script' && !loot.some((x) => x.path === '/loot-file'), 'its scripts never run, so it can\'t reach the page around it, nor send anything anywhere')
    ok(!loot.some((x) => x.path === '/loot-file-img'), 'nor does it load anything from another site (a picture there would say it was opened)')
    const at = new URL(p.url())
    ok(!at.hash && !p.url().includes(secretOf(s.link)) && /^\/v\/[\w-]{22}$/.test(at.pathname) && (await p.evaluate(() => sessionStorage.length + localStorage.length)) === 0, 'the link\'s secret leaves the address at once, and nothing is kept in the browser', p.url())
    ok((await p.locator('#top-title').innerText()) === 'report.html' && /Tester/.test(await p.locator('#top-who').innerText()), 'with what it is and who shares it above it')
    ok(!errors.length, 'no page errors', errors)
    await shot(p, `${tag}share-file`)
    await p.reload()
    ok(!!(await until(async () => /Open the link again/.test(await p.locator('#wait-title').innerText()), 8000)), 'a reload asks for the link again: the page didn\'t keep it')
    await ctx.close()
  })

  // ---------- a folder of files ----------
  let folder = null
  await part('a folder of files', async () => {
    folder = await share({ kind: 'folder', root: 'home', path: 'data' })
    const v = await viewAs(folder.link)
    const list = await v.request('GET', '/c/')
    ok(list.status === 200 && /notes\.txt/.test(list.text) && /a%20b\.txt/.test(list.text) && /script-src 'none'/.test(list.headers['content-security-policy'] || '') && !/HIDDEN|\.env|\.git/.test(list.text), 'listed, with nothing that runs and nothing hidden', list.text.slice(0, 200))
    ok((await v.request('GET', '/c/a%20b.txt')).text === 'spaced' && (await v.request('GET', '/c/sub/deep.txt')).text === 'deep file', 'its files, in folders and with spaces as a link has them')
    const top = await v.request('GET', '/c/sub')
    ok(top.status === 302 && top.headers.location === '/sub/', 'a folder asked for without its /: sent there, from the root of what\'s shared (the page puts its own path in front)', top.headers)
    v.close()
    const { ctx, p, errors } = await viewer(folder.link)
    const fr = await frameOf(p, 'a[href="sub/"]')
    ok(!!fr, 'in a browser: its list')
    await fr.click('a[href="sub/"]')
    ok(!!(await until(async () => { const f = p.frames().find((x) => /\/_c\/[\w-]+\/sub\/$/.test(x.url())); return f && /deep\.txt/.test(await f.locator('body').innerText()) }, 10000, 200)), 'a folder in it opens, by its relative link')
    ok(!errors.length, 'no page errors', errors)
    await shot(p, `${tag}share-folder`)
    await ctx.close()
  })

  // ---------- a site or an app, on a relay of your own ----------
  await part('scripts refused on a relay of your own', async () => {
    const site = path.join(home, 'site')
    fs.mkdirSync(site, { recursive: true })
    fs.writeFileSync(path.join(site, 'index.html'), '<h1>site</h1>')
    const e1 = await refusal({ kind: 'folder', root: 'home', path: 'site' })
    const e2 = await refusal({ kind: 'app', port: 4123, pane: 'x' })
    ok(/sites\) can't be shared through this relay/.test(e1 || '') && /scripts would run beside the page holding the link/.test(e1 || ''), 'a folder with web pages in it (a site): refused, saying why', e1)
    ok(/isn't an app|Apps can't be shared/.test(e2 || ''), 'an app: refused too', e2)
  })

  // ---------- path escapes, links out, pipes, hidden files ----------
  await part('path escapes and symlinks', async () => {
    const v = await viewAs(folder.link)
    const tries = ['/c/../outside.txt', '/c/%2e%2e/outside.txt', '/c/sub/..%2f..%2foutside.txt', '/c/%2e%2e%2f%2e%2e%2foutside.txt', '/c/sub/%2e%2e/%2e%2e/outside.txt', '/c/..%5coutside.txt', '/c/.env', '/c/.git/config', '/c/%2eenv', '/c/sub/../.env', '/c//etc/passwd', '/c/C:%5cWindows', '/c/%00', `/c/${enc(path.join(home, 'outside.txt'))}`]
    const got = []
    for (const u of tries) { const r = await v.request('GET', u); got.push([u, r.status]); if (/OUTSIDE-SECRET|HIDDEN/.test(r.text || '')) got.push([u, 'LEAKED']) }
    ok(got.every(([, s]) => s === 404), '.. (encoded or not), a backslash, a name starting with a dot, an absolute path: refused, and nothing outside it read', got)
    if (IS_WIN) skip('a link (symlink) out of the folder, a pipe, the folder swapped for a link', 'making those on Windows needs more than a test has')
    else {
      fs.symlinkSync(path.join(home, 'outside.txt'), path.join(data, 'out.txt'))
      fs.symlinkSync(home, path.join(data, 'outdir'))
      fs.symlinkSync(path.join(data, 'notes.txt'), path.join(data, 'in.txt'))
      const out = await v.request('GET', '/c/out.txt')
      const outDir = await v.request('GET', '/c/outdir/outside.txt')
      const inside = await v.request('GET', '/c/in.txt')
      ok(out.status === 404 && outDir.status === 404 && !/OUTSIDE-SECRET/.test(out.text + outDir.text), 'a link (symlink) leading out of it, to a file or a folder: refused', [out.status, outDir.status])
      ok(inside.status === 200 && /MARKER-DATA/.test(inside.text), 'one leading to something inside it: served', inside.status)
      execFileSync('mkfifo', [path.join(data, 'pipe.log')])
      const t0 = Date.now()
      const pipe = await v.request('GET', '/c/pipe.log')
      const after = await v.request('GET', '/c/notes.txt')
      ok(pipe.status === 404 && after.status === 200 && Date.now() - t0 < 5000 && await alive(), 'a named pipe in it isn\'t opened (only regular files are): nothing waits on it', { pipe: pipe.status, ms: Date.now() - t0 })
      fs.rmSync(path.join(data, 'pipe.log'))
      // The folder swapped for a link to somewhere else: not what was shared.
      const swap = path.join(home, 'swapme')
      fs.mkdirSync(swap, { recursive: true })
      fs.writeFileSync(path.join(swap, 'x.txt'), 'ORIGINAL')
      const sw = await share({ kind: 'folder', root: 'home', path: 'swapme' })
      fs.renameSync(swap, `${swap}-was`)
      fs.symlinkSync(home, swap)
      const v2 = await viewAs(sw.link)
      const swapped = await v2.request('GET', '/c/outside.txt')
      ok(swapped.status === 404 && !/OUTSIDE-SECRET/.test(swapped.text), 'the shared folder swapped for a link to elsewhere: nothing there is served', swapped.status)
      v2.close()
      await kit.api(`/shares/${sw.id}/stop`, {})
    }
    for (const bad of [{ kind: 'folder', root: 'home', path: '' }, { kind: 'folder', root: 'home', path: 'data/.git' }, { kind: 'file', root: 'studio', path: '../../relay.json' }]) {
      const e = await refusal(bad)
      ok(!!e, `can't be shared: ${bad.path || 'the home folder'}`, e)
    }
    v.close()
  })

  // ---------- never /api ----------
  await part('never /api', async () => {
    const v = await viewAs(folder.link)
    const asks = ['/api/config', '/api/relay', '/api/shares', '/c/../api/config', '/.share/../api/config', '/../api/config', 'http://127.0.0.1/api/config', `${kit.url}/api/config`, '/_preview/5173/', '/m/x/api/config', '/assets/index.js']
    const got = []
    for (const u of asks) { const r = await v.request('GET', u); got.push([u, r.status, /"(keepAgents|configured|shares|devices)"/.test(r.text || '')]) }
    ok(got.every(([, s, leak]) => s !== 200 && !leak), 'none of Bridge AI\'s API, pages or files, however it\'s asked', got)
    const wsId = 77
    await v.send(K.WS_OPEN, wsId, { u: '/api/events' })
    const closed = await until(async () => { const r = await v.next(3000); return r.kind === K.WS_CLOSE && r.id === wsId ? r : null }, 6000, 0)
    ok(!!closed, 'nor a socket to it', closed)
    const asked = [await asContent(v, 80, { m: 'GET', u: '/.share/about' }), await asContent(v, 81, { m: 'GET', u: '/c/../.share/about' }), await asContent(v, 82, { m: 'POST', u: '/.share/password' }), (await v.request('GET', '/c/../.share/about')).status, await asContent(v, 83, { m: 'GET', u: '/c/notes.txt' })]
    ok(asked.slice(0, 4).every((s) => s === 404) && asked[4] === 200, 'what\'s shown never asks the page\'s own questions (/.share/), however the path is written; only what\'s shared', asked)
    v.close()
  })

  // ---------- a page waiting for its password keeps its place ----------
  await part('pages waiting at the relay', async () => {
    const s = await share({ kind: 'file', root: 'home', path: 'outside.txt', password: 'right-pass-77' })
    const v = await viewAs(s.link, { headers: { 'CF-Connecting-IP': '203.0.113.9' } })
    await v.request('GET', '/.share/about')
    const ws = []
    for (let i = 0; i < 60; i++) {
      const w = new WebSocket(`${relay.shareUrl.replace(/^http/, 'ws')}/_relay/view`, { headers: { 'CF-Connecting-IP': i % 2 ? '198.51.100.7' : `198.51.100.${10 + i}` } })
      w.on('error', () => {})
      ws.push(w)
      await sleep(10)
    }
    await sleep(1500)
    const fromOne = ws.filter((w, i) => i % 2 && w.readyState === 1).length
    const open = ws.filter((w) => w.readyState === 1).length
    const r = await v.request('POST', '/.share/password', { password: 'right-pass-77' })
    ok(r.status === 200 && !v.closed && /OUTSIDE-SECRET/.test((await v.request('GET', '/c/outside.txt')).text || ''), 'a page at the password screen keeps its place while many connect to the share address without a word', { status: r.status, closed: v.closed })
    ok(fromOne <= 4 && open <= 16, 'those that haven\'t proved a link wait in a small room of their own: 4 from one address, 16 in all, the oldest making room', { fromOne, open })
    for (const w of ws) w.terminate()
    v.close()
    // Someone with the link and not the password, many times over from one address: a few places
    // held for them, never the link's.
    const held = []
    for (let i = 0; i < 8; i++) { const h = await viewAs(s.link, { headers: { 'CF-Connecting-IP': '198.51.100.99' } }); if (h.request) { await h.request('GET', '/.share/about').catch(() => {}); held.push(h) } }
    await sleep(500)
    const stillHeld = held.filter((h) => !h.closed).length
    const next = await viewAs(s.link, { headers: { 'CF-Connecting-IP': '203.0.113.50' } })
    const nextIn = next.request ? await next.request('POST', '/.share/password', { password: 'right-pass-77' }) : next
    ok(stillHeld <= 2 && nextIn.status === 200, 'pages without the password, from one address, hold 2 places on the link at most; the next viewer gets in', { stillHeld, next: nextIn.status ?? nextIn.refused })
    // ...and a page that waits without the password is let go a while after its last try, said.
    const slow = await viewAs(s.link, { headers: { 'CF-Connecting-IP': '203.0.113.51' } })
    await slow.request('GET', '/.share/about')
    const gone = await until(async () => { try { const r = await slow.next(1000); return r.kind === K.GONE ? JSON.parse(Buffer.from(r.body).toString('utf8')) : null } catch { return null } }, 9000, 0)
    ok(/let go after waiting a while without the password/.test(gone?.text || ''), 'a page waiting without the password is let go after a while (60 seconds; 4 here), saying why', gone)
    for (const h of [...held, next, slow]) h.close?.()
    await kit.api(`/shares/${s.id}/stop`, {})
    // A link's 10 places are for pages let in: the 11th is told so.
    const noGate = await share({ kind: 'file', root: 'home', path: 'outside.txt' })
    const ten = []
    for (let i = 0; i < 10; i++) { const x = await viewAs(noGate.link); await x.request('GET', '/.share/about'); ten.push(x) }
    const eleventh = await viewAs(noGate.link)
    const r11 = eleventh.request ? await eleventh.request('GET', '/.share/about') : null
    ok(r11?.status === 429 && /takes at once \(10\)/.test(r11.json?.error || ''), 'a link open on 10 devices: the 11th is told it\'s full', r11?.json || eleventh)
    for (const x of [...ten, eleventh]) x.close?.()
    await kit.api(`/shares/${noGate.id}/stop`, {})
  })

  // ---------- the relay never sees what's shown ----------
  await part('the relay sees no plaintext', async () => {
    const t1 = await tap(relay.shareUrl)
    const s = await share({ kind: 'folder', root: 'home', path: 'data', password: 'open-sesame-42' })
    const v = await viewAs(s.link.replace(relay.shareUrl, t1.url))
    await v.request('POST', '/.share/password', { password: 'open-sesame-42' })
    const r = await v.request('GET', '/c/notes.txt')
    ok(/MARKER-DATA/.test(r.text), 'through the tap, it opens')
    const all = Buffer.concat(t1.seen).toString('latin1')
    ok(t1.seen.length > 4 && !/MARKER-DATA|open-sesame-42|notes\.txt/.test(all) && !all.includes(secretOf(s.link)), 'what the relay carries: no word of what\'s shown, nor what was asked for, nor the password, nor the link\'s secret', { messages: t1.seen.length })
    const hello = t1.seen.map((x) => x.toString('utf8')).find((x) => x.includes('"hello"')) || ''
    ok(/"view":1/.test(hello) && !hello.includes(secretOf(s.link)), 'the hello in the clear has the share\'s id, never its secret', hello.slice(0, 200))
    v.close()
    t1.stop()
    await kit.api(`/shares/${s.id}/stop`, {})
  })

  // ---------- what a page may send and hold ----------
  await part('bodies and answers at once', async () => {
    const s = await share({ kind: 'folder', root: 'home', path: 'data', password: 'never-given-9' })
    const v = await viewAs(s.link)
    await v.request('GET', '/.share/about')
    const before = await v.request('POST', '/c/notes.txt', 'x'.repeat(2000))
    ok(/Not let in yet/.test(before.error || ''), 'before it\'s let in, a body to what\'s shared is refused before it\'s taken in', before)
    const big = await v.request('POST', '/.share/password', 'y'.repeat(64 * 1024))
    ok(/more than a link takes at once/.test(big.error || ''), '...and a big one to a question of its own', big)
    v.close()
    const v2 = await viewAs(folder.link)
    await v2.request('GET', '/.share/about')
    const after = await v2.request('POST', '/c/notes.txt', 'z')
    ok(/can only be looked at/.test(after.error || ''), 'let in, a body to what\'s only looked at: refused', after)
    // Answers asked for and not read: no more than a few at once.
    for (let id = 500; id < 512; id++) await v2.send(K.REQ, id, { m: 'GET', u: '/c/big.bin', h: [], body: false, w: 1024 })
    const errs = []
    await until(async () => { try { const r = await v2.next(1500); if (r.kind === K.ERR) errs.push(new TextDecoder().decode(r.body)) } catch { /* none */ } return errs.length >= 4 }, 8000, 0)
    ok(errs.length >= 4 && errs.every((x) => /Too many at once/.test(x)), 'more answers on their way at once than a page may have: refused, said', errs)
    v2.close()
    await kit.api(`/shares/${s.id}/stop`, {})
    ok(await alive(), 'and the server is fine')
  })

  // ---------- hellos for links that aren't there ----------
  await part('hellos', async () => {
    const ws = []
    for (let i = 0; i < 80; i++) {
      const w = new WebSocket(`${relay.shareUrl.replace(/^http/, 'ws')}/_relay/view`)
      ws.push(w)
      w.on('message', (d, bin) => { if (!bin && /"host":true/.test(String(d))) w.send(plainFrame({ t: 'hello', v: 1, view: 1, e: 'A'.repeat(87), s: `${String(i).padStart(4, '0')}${'x'.repeat(18)}`, proof: 'B'.repeat(43) })) })
      w.on('error', () => {})
    }
    await sleep(1500)
    const v = await viewAs(folder.link)
    const r = v.request ? await v.request('GET', '/c/notes.txt') : null
    ok(/MARKER-DATA/.test(r?.text || ''), 'a link\'s page gets in right after many hellos for links that don\'t exist (those cost nothing and count against nothing)', v.refused || r?.status)
    v.close()
    for (const w of ws) w.close()
  })

  // ---------- a password, and its lockouts ----------
  await part('a password', async () => {
    const short = await refusal({ kind: 'folder', root: 'home', path: 'data', password: 'short7' })
    ok(/at least 8 characters/.test(short || ''), 'a password needs 8 characters', short)
    const before = notes().length
    const s = await share({ kind: 'folder', root: 'home', path: 'data', password: 'right-horse-7' })
    const { ctx, p } = await viewer(s.link)
    await p.locator('#password-input').waitFor({ timeout: 15000 })
    ok(/Tester set a password/.test(await p.locator('#password-text').innerText()) && !(await p.locator('#view').isVisible()) && !(await p.locator('#top-title').innerText()), 'asked for first; nothing shown before, not even its name')
    await p.fill('#password-input', 'wrong-one-1')
    await p.click('#password-go')
    const said = await until(async () => { const x = await p.locator('#password-err').innerText(); return x ? x : null }, 10000)
    ok(/isn't the password\. 4 more tries/.test(said || ''), 'a wrong one: said, with the tries left', said)
    await p.fill('#password-input', 'right-horse-7')
    await p.click('#password-go')
    ok(!!(await frameOf(p, 'a[href="notes.txt"]')), 'the right one: what\'s shared shows')
    await ctx.close()
    // Five wrong in a row from one page lock that page out; another page still gets in.
    const v = await viewAs(s.link)
    const r = []
    for (let i = 0; i < 5; i++) r.push((await v.request('POST', '/.share/password', { password: `nope-${i}-xxxx` })).json?.error)
    const right = await v.request('POST', '/.share/password', { password: 'right-horse-7' })
    ok(/1 more try/.test(r[3] || '') && /locked out for now/.test(r[4] || '') && /locked out for now/.test(right.json?.error || ''), 'the fifth wrong try in a row locks that page out: the right one is refused there', { r, right: right.json })
    const c = await v.request('GET', '/c/')
    ok(c.status === 401 && !/notes/.test(c.text), 'and nothing is served to it', c.status)
    const other = await viewAs(s.link)
    ok((await other.request('POST', '/.share/password', { password: 'right-horse-7' })).status === 200, 'another page still gets in with the right one: one page\'s wrong tries don\'t keep others out')
    other.close()
    v.close()
    // Enough wrong from anyone, though: the link locks, and your devices hear it.
    for (let i = 0; i < 4; i++) { const w = await viewAs(s.link); for (let j = 0; j < 4; j++) await w.request('POST', '/.share/password', { password: `again-${i}-${j}-x` }); w.close() }
    const late = await viewAs(s.link)
    const locked = await late.request('POST', '/.share/password', { password: 'right-horse-7' })
    ok(/locked for now/.test(locked.json?.error || ''), '20 wrong passwords from any pages lock the link itself: the right one is refused', locked.json)
    late.close()
    const told = notes().slice(before)
    ok(told.some((n) => n.kind === 'share' && /20 wrong passwords/.test(n.title) && /locked for 15 minutes/.test(n.body)), 'your devices hear it was locked', told.map((n) => n.title))
    const listed = (await kit.api('/shares')).shares.find((x) => x.id === s.id)
    ok(listed.locked > Date.now() && listed.opens.filter((o) => o.what === 'wrong password').length >= 15 && listed.opens[0]?.what === 'locked', 'Settings › Sharing has the wrong tries and the lock (its latest 20)', listed.opens.map((o) => o.what))
    const kept = fs.readFileSync(path.join(kit.data, 'shares.json'), 'utf8')
    ok(!kept.includes('right-horse-7') && /"N":/.test(kept), 'the password is kept only as a salted hash')
    await kit.api(`/shares/${s.id}/stop`, {})
  })

  // ---------- only these people ----------
  await part('named emails and their codes', async () => {
    const s = await share({ kind: 'folder', root: 'home', path: 'data', who: 'people', emails: 'ana@example.com, Bo@Example.com' })
    ok(JSON.stringify(s.emails) === JSON.stringify(['ana@example.com', 'bo@example.com']) && s.who === 'people', 'the people it names, by email, as they\'re compared', s.emails)
    const { ctx, p } = await viewer(s.link)
    await p.locator('#email-input').waitFor({ timeout: 15000 })
    ok(!(await p.locator('#view').isVisible()), 'nothing shows before the email is proved')
    await p.fill('#email-input', 'ana@example.com')
    await p.click('#email-go')
    await p.locator('#code-input').waitFor({ timeout: 10000 })
    const code = await until(() => codeIn('ana@example.com'), 10000)
    const mail = (await accounts.mail()).filter((x) => x.to === 'ana@example.com').at(-1)
    ok(/^\d{8}$/.test(code || '') && /owner@example\.com/.test(mail?.subject || '') && !/data|MARKER|notes/i.test(`${mail?.subject} ${mail?.text}`), 'an 8-digit code is emailed to it (by the accounts service, from the owner\'s account), saying whose link, nothing of what it shows', mail)
    await p.fill('#code-input', code === '00000000' ? '11111111' : '00000000')
    await p.click('#code-go')
    ok(/isn't right\. 4 more tries/.test(await until(async () => (await p.locator('#code-err').innerText()) || null, 8000) || ''), 'a wrong code: said, with the tries left')
    await p.fill('#code-input', code)
    await p.click('#code-go')
    ok(!!(await frameOf(p, 'a[href="notes.txt"]')), 'the right code: what\'s shared shows')
    await ctx.close()
    // An email it doesn't name: the same answer, and nothing sent; one it names: no more than its limit.
    const v = await viewAs(s.link)
    const n0 = (await accounts.mail()).length
    const no = await v.request('POST', '/.share/email', { email: 'eve@example.com' })
    const yes = await v.request('POST', '/.share/email', { email: 'bo@example.com' })
    ok(no.status === 200 && no.json.said.replace('eve@example.com', 'X') === yes.json.said.replace('bo@example.com', 'X') && !(await accounts.mail()).slice(n0).some((m) => m.to === 'eve@example.com'), 'an email it doesn\'t name: answered the same, and sent nothing', { no: no.json, yes: yes.json })
    ok((await v.request('GET', '/c/')).status === 401, 'and nothing served before the code')
    const proto = await v.request('POST', '/.share/code', { email: '__proto__', code: '12345678' })
    ok(proto.status === 403 && await alive(), 'a code for "__proto__": the same refusal as any, and nothing else touched', proto.json)
    v.close()
    for (let i = 0; i < 6; i++) { const w = await viewAs(s.link); await w.request('POST', '/.share/email', { email: 'bo@example.com' }); w.close() }
    await sleep(800)
    const toBo = (await accounts.mail()).filter((m) => m.to === 'bo@example.com').length
    ok(toBo === 5, 'one email gets 5 codes an hour, however many pages ask (each answered the same)', toBo)
    // The accounts service sends only to emails a link named.
    const token = JSON.parse(fs.readFileSync(path.join(kit.data, 'account.json'), 'utf8')).deviceToken
    const unnamed = await accounts.call('POST', '/v1/share-code', { link: s.id, to: 'eve@example.com', code: '12345678' }, token)
    const named = await accounts.call('POST', '/v1/share-code', { link: s.id, to: 'ana@example.com', code: '12345678' }, token)
    ok(unnamed.status === 403 && unnamed.code === 'not-named' && named.status === 200, 'the accounts service emails a code only to an email that link named', { unnamed, named })
    // The email can't go just now: your devices get the code, to pass on.
    await accounts.mailFails('unsent')
    try {
      const before = notes().length
      const v2 = await viewAs(s.link)
      await v2.request('POST', '/.share/email', { email: 'ana@example.com' })
      const told = await until(() => notes().slice(before).find((n) => /ana@example\.com asked to open/.test(n.title)), 8000)
      const passed = /Their code is (\d{8})/.exec(told?.body || '')?.[1]
      ok(!!passed, 'when it can\'t be emailed: your devices get the code, to pass on', told)
      const inNow = await v2.request('POST', '/.share/code', { email: 'ana@example.com', code: passed })
      ok(inNow.status === 200 && /MARKER-DATA/.test((await v2.request('GET', '/c/notes.txt')).text), 'and it works', inNow.json)
      v2.close()
    } finally { await accounts.mailFails('') }
    const listed = (await kit.api('/shares')).shares.find((x) => x.id === s.id)
    ok(listed.opens.some((o) => o.what === 'opened' && o.email === 'ana@example.com') && listed.opens.some((o) => o.what === 'not on the list' && o.email === 'eve@example.com') && listed.opens.some((o) => o.what === 'wrong code'), 'Settings › Sharing has which email opened it, and the tries', listed.opens)
    await kit.api(`/shares/${s.id}/stop`, {})
    await sleep(500)
    const forgot = await until(async () => { const r = await accounts.call('POST', '/v1/share-code', { link: s.id, to: 'ana@example.com', code: '12345678' }, token); return r.code === 'not-named' ? r : null }, 8000)
    ok(!!forgot, 'stopped: the accounts service forgets who the link named, and sends no more codes for it', forgot)
    // An account names people for so many links at once, and says so only so often.
    const fake = (i) => `fake${String(i).padStart(4, '0')}${'x'.repeat(14)}`
    let capped = null
    for (let i = 0; i < 55 && !capped; i++) { const r = await accounts.call('POST', '/v1/share-people', { link: fake(i), emails: ['someone@example.com'], until: Date.now() + 3600000 }, token); if (r.status !== 200) capped = { i, ...r } }
    ok(capped?.code === 'too-many' && capped.i === 50 && /50 links naming people/.test(capped.error || ''), 'the accounts service keeps people for 50 links of an account at once', capped)
    let slowed = null
    for (let i = 0; i < 20 && !slowed; i++) { const r = await accounts.call('POST', '/v1/share-people', { link: fake(i), emails: [] }, token); if (r.status !== 200) slowed = r }
    ok(slowed?.code === 'too-many' && /in the last hour/.test(slowed.error || ''), 'and is told which people only 60 times an hour', slowed)
  })

  // ---------- a Studio document, live ----------
  await part('a Studio document, live', async () => {
    const doc = path.join(home, 'Plan.md')
    fs.writeFileSync(doc, '# Version one\n\nThe plan.\n\n<script>document.title = "ran"</script>\n')
    fs.writeFileSync(path.join(home, 'Budget.csv'), 'Item,Cost\nDesk,120\n')
    const s = await share({ kind: 'doc', root: 'home', path: 'Plan.md' })
    const { ctx, p } = await viewer(s.link)
    const fr = await frameOf(p, 'h1')
    ok(!!fr && (await fr.locator('h1').innerText()) === 'Version one', 'shown as a page made from it', fr?.url())
    ok((await fr.title()) !== 'ran', 'with nothing in it that runs')
    fs.writeFileSync(doc, '# Version two\n\nChanged.\n')
    const live = await until(async () => { const f = p.frames().find((x) => /\/_c\//.test(x.url())); return f && (await f.locator('h1').innerText().catch(() => '')) === 'Version two' }, 15000, 300)
    ok(!!live, 'changed on the computer: the page shows its latest, by itself')
    await shot(p, `${tag}share-doc`)
    await ctx.close()
    const sheet = await share({ kind: 'doc', root: 'home', path: 'Budget.csv' })
    const v = await viewAs(sheet.link)
    const t = await v.request('GET', '/c/')
    ok(t.status === 200 && /<td>Desk<\/td><td>120<\/td>/.test(t.text), 'a sheet: its rows, as a table', t.text.slice(0, 300))
    ok((await v.request('GET', '/c/other.md')).status === 404, 'and only the document itself')
    v.close()
    await kit.api(`/shares/${s.id}/stop`, {})
    await kit.api(`/shares/${sheet.id}/stop`, {})
  })

  // ---------- a download let go ----------
  await part('a download let go', async () => {
    const s = await share({ kind: 'folder', root: 'home', path: 'data' })
    for (const how of ['cancel', 'close', 'idle', 'stop']) {
      const v = await viewAs(s.link)
      await v.request('GET', '/.share/about')
      await v.send(K.REQ, 9, { m: 'GET', u: '/c/big.bin', h: [], body: false, w: 1024 })
      await sleep(300)
      if (how === 'cancel') await v.send(K.CANCEL, 9)
      else if (how === 'close') v.close()
      else if (how === 'idle') await sleep(4500) // left unread past a page's idle time (3 s here)
      else await kit.api(`/shares/${s.id}/stop`, {})
      await sleep(1500)
      ok(await alive(), `a download on a link let go (${how}): the server is fine`)
      v.close()
    }
    const s2 = await share({ kind: 'file', root: 'home', path: 'data/big.bin' })
    const { ctx, p } = await viewer(s2.link)
    await until(async () => p.frames().some((f) => /\/_c\//.test(f.url())), 15000, 200)
    await sleep(800)
    await ctx.close()
    await sleep(1500)
    ok(await alive(), 'a browser closed mid-download: the server is fine')
    await kit.api(`/shares/${s2.id}/stop`, {})
    // A phone's download, let go of the same ways.
    const code = (await kit.api('/relay/pair', {})).pairing.code
    const ph = await linkAs(relay.url, { code, name: 'Downloader', about: { name: 'Downloader' } })
    for (const how of ['cancel', 'close']) {
      const c = how === 'close' ? await linkAs(relay.url, { device: ph.device, hostKey: ph.hostKey, name: 'Downloader' }) : ph
      await c.send(K.REQ, 21, { m: 'GET', u: `/api/agents/${'home'}/raw?path=data%2Fbig.bin`, h: [], body: false, w: 1024 })
      await sleep(400)
      if (how === 'cancel') await c.send(K.CANCEL, 21)
      else c.close()
      await sleep(1500)
      ok(await alive(), `a phone's download let go (${how}): the server is fine`)
    }
    ph.close()
  })

  // ---------- expiry, and Stop Sharing ----------
  await part('expiry and Stop Sharing', async () => {
    const s = await share({ kind: 'folder', root: 'home', path: 'data', lasts: 'hour' })
    const v = await viewAs(s.link)
    await v.request('GET', '/.share/about')
    const { ctx, p } = await viewer(s.link)
    await frameOf(p, 'a[href="notes.txt"]')
    const gone = await until(async () => { try { const r = await v.next(2000); return r.kind === K.GONE ? r : null } catch { return null } }, HOUR + 8000, 0)
    ok(!!gone, 'its hour (seconds here) ran out: an open page is told, sealed')
    ok(!!(await until(async () => /This link has ended/.test(await p.locator('#wait-title').innerText()) && /time ran out/.test(await p.locator('#wait-text').innerText()), 8000)) && !(await p.locator('#view').isVisible()), 'and the browser\'s page says so, what was shown gone')
    const again = await viewAs(s.link)
    ok(again.refused?.why === 'no-share', 'the link opens no more', again)
    const listed = (await kit.api('/shares')).shares.find((x) => x.id === s.id)
    ok(listed.ended === 'expired' && !listed.link && !fs.readFileSync(path.join(kit.data, 'shares.json'), 'utf8').includes(secretOf(s.link)), 'listed as ended, its secret forgotten', listed)
    await ctx.close()
    const s2 = await share({ kind: 'folder', root: 'home', path: 'data' })
    const w = await viewer(s2.link)
    await frameOf(w.p, 'a[href="notes.txt"]')
    ok((await kit.api('/shares')).shares.find((x) => x.id === s2.id)?.open === 1, 'Settings › Sharing says it\'s open on one device')
    await kit.api(`/shares/${s2.id}/stop`, {})
    ok(!!(await until(async () => /This link has ended/.test(await w.p.locator('#wait-title').innerText()) && /Tester stopped sharing it/.test(await w.p.locator('#wait-text').innerText()), 5000)), 'Stop Sharing: the open page ends at once, saying so')
    ok((await viewAs(s2.link)).refused?.why === 'no-share', 'and the link opens no more')
    await w.ctx.close()
  })

  // ---------- the computer offline ----------
  await part('the computer offline', async () => {
    const s = await share({ kind: 'folder', root: 'home', path: 'data' })
    const w = await viewer(s.link)
    await frameOf(w.p, 'a[href="notes.txt"]')
    await kit.restart(async () => {
      const off = await viewer(s.link)
      const said = await until(async () => { const x = `${await off.p.locator('#wait-title').innerText()} ${await off.p.locator('#wait-text').innerText()}`; return /offline/.test(x) ? x : null }, 20000)
      ok(/Tester's computer is offline/.test(said || '') && /The link works when it's back/.test(said || ''), 'a link opened while the computer is off: said in the owner\'s words', said)
      ok(/offline/.test(await w.p.locator('#top-state').innerText()), 'and an open page says it above what it shows')
      await shot(off.p, `${tag}share-offline`)
      await off.ctx.close()
      ok(!!(await viewAs(s.link)).offline, 'the relay says the computer is offline')
    })
    ok(!!(await until(async () => (await kit.api('/relay')).online, 20000)), 'back')
    ok(!!(await until(async () => !(await w.p.locator('#top-state').innerText()), 15000)) && !!(await frameOf(w.p, 'a[href="notes.txt"]')), 'the link works again by itself on the open page', await w.p.locator('#top-state').innerText())
    const v = await viewAs(s.link)
    ok(/MARKER-DATA/.test((await v.request('GET', '/c/notes.txt')).text), 'and opens for anyone again')
    v.close()
    await w.ctx.close()
    await kit.api(`/shares/${s.id}/stop`, {})
  })

  // ---------- your devices hear of the first open ----------
  await part('the owner told of the first open', async () => {
    const before = notes().length
    const s = await share({ kind: 'file', root: 'home', path: 'outside.txt', title: 'Notes file' })
    for (let i = 0; i < 2; i++) { const v = await viewAs(s.link, { headers: { 'X-Test-Country': 'DE' } }); await v.request('GET', '/.share/about'); v.close() }
    const told = await until(() => { const n = notes().slice(before).filter((x) => x.tag === `share-${s.id}`); return n.length ? n : null }, 8000)
    ok(told?.length === 1 && /Notes file was opened/.test(told[0].title) && /Germany/.test(told[0].body) && told[0].url === '/?settings=sharing', 'your devices hear of its first open, from where (the country the relay says), once', told)
    await sleep(500)
    ok(notes().slice(before).filter((x) => x.tag === `share-${s.id}`).length === 1, 'and not again for the next')
    const listed = (await kit.api('/shares')).shares.find((x) => x.id === s.id)
    ok(listed.opens.length === 2 && listed.opens.every((o) => o.country === 'DE' && o.what === 'opened'), 'each open is listed, with its country', listed.opens)
    await kit.api(`/shares/${s.id}/stop`, {})
  })

  // ---------- phone parity, and who reads a link ----------
  await part('phone parity', async () => {
    const ph = await linkAs(relay.url, { code: (await kit.api('/relay/pair', {})).pairing.code, name: 'Phone', about: { name: 'Phone' } })
    const other = await linkAs(relay.url, { code: (await kit.api('/relay/pair', {})).pairing.code, name: 'Tablet', about: { name: 'Tablet' } })
    ok(!ph.refused && !!ph.deviceId && !other.refused, 'two phones pair', [ph.refused, other.refused])
    const made = await ph.request('POST', '/api/shares', { kind: 'folder', root: 'home', path: 'data', who: 'link', lasts: 'day' })
    ok(made.status === 200 && /\/v\/[\w-]{22}#s=/.test(made.json?.share?.link || '') && made.json.share.by === 'Phone', 'the phone makes a link', made.json)
    const id = made.json.share.id
    const others = made.json.shares.filter((x) => x.id !== id && !x.ended)
    ok(others.length > 0 && others.every((x) => x.link === null), 'the links made on the computer are listed to the phone without theirs', others.map((x) => x.id))
    const seen = await ph.request('GET', '/api/shares')
    ok(seen.json?.shares?.some((x) => x.id === id && x.link === made.json.share.link), 'and sees it, its link too')
    const theirs = (await other.request('GET', '/api/shares')).json?.shares?.find((x) => x.id === id)
    ok(!!theirs && theirs.link === null && theirs.qr === null && theirs.hidden === true && theirs.by === 'Phone', 'another of your devices sees it (what, who, when) but not its link: only the computer and the device that made it read that', theirs)
    ok((await kit.api('/shares')).shares.find((x) => x.id === id)?.link === made.json.share.link, 'the computer itself reads it')
    // A device kept out (Which Devices May Connect): no links, no stopping them.
    await kit.api('/remote/devices', { id: other.deviceId, allowed: false })
    const shutList = await other.request('GET', '/api/shares')
    const shutStop = await other.request('POST', `/api/shares/${id}/stop`, {})
    ok(shutList.status === 403 && !shutList.json?.shares && shutStop.status === 403 && !(await kit.api('/shares')).shares.find((x) => x.id === id)?.ended, 'a device kept out of this computer sees no links and stops none', [shutList.status, shutStop.status])
    await kit.api('/remote/devices', { id: other.deviceId, allowed: true })
    other.close()
    const w = await viewer(made.json.share.link, { phone: true })
    ok(!!(await frameOf(w.p, 'a[href="notes.txt"]')), 'a phone\'s browser opens it')
    // Settings › Sharing at a phone's width: the link, and Stop Sharing.
    const p2 = await page(b, kit.url, { phone: true })
    await p2.p.waitForSelector('.tabbar button', { timeout: 20000 })
    await p2.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'sharing' } })))
    const row = p2.p.locator(`.share-row[data-share="${id}"]`)
    await row.waitFor({ timeout: 10000 })
    ok(/Made on Phone/.test(await row.innerText()) && /Open on 1 device now/.test(await until(async () => { const x = await row.innerText(); return /Open on 1 device now/.test(x) ? x : null }, 8000) || ''), 'Settings › Sharing on a phone: the link, where it was made, and that it\'s open', await row.innerText())
    const f = await phoneFaults(p2.p, '.modal.settings .shares')
    ok(!Object.keys(f).length, 'nothing wider than the phone, cut off, nor too small to tap', f)
    await shot(p2.p, `${tag}share-phone-settings`)
    await row.getByRole('button', { name: 'Stop Sharing' }).click()
    ok(!!(await until(async () => /This link has ended/.test(await w.p.locator('#wait-title').innerText()), 6000)), 'Stop Sharing there ends the open page at once')
    ok((await ph.request('GET', '/api/shares')).json?.shares?.find((x) => x.id === id)?.ended === 'stopped', 'and the phone sees it stopped')
    const third = await ph.request('POST', '/api/shares', { kind: 'file', root: 'home', path: 'outside.txt', who: 'link', lasts: 'hour' })
    const stopped = await ph.request('POST', `/api/shares/${third.json.share.id}/stop`, {})
    ok(stopped.status === 200 && stopped.json.shares.find((x) => x.id === third.json.share.id)?.ended === 'stopped', 'a phone stops a link too')
    ok(!p2.errors.length, 'no page errors', p2.errors)
    await p2.ctx.close()
    await w.ctx.close()
    ph.close()
  })

  // ---------- the dialog ----------
  await part('the dialog', async () => {
    fs.writeFileSync(path.join(home, 'Notes.md'), '# Dialog doc\n')
    const d = await page(b, kit.url)
    await d.p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await d.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root: 'home', path: 'Notes.md' } })))
    await d.p.locator('.sd-share-btn').waitFor({ timeout: 15000 })
    await until(async () => d.p.locator('.sd-share-btn').isEnabled(), 10000)
    await d.p.locator('.sd-share-btn').click()
    const dlg = d.p.locator('.share-dialog')
    await dlg.waitFor({ timeout: 8000 })
    await until(async () => /Up to 50 links at once/.test(await dlg.innerText()), 8000)
    ok(/Anyone With the Link/.test(await dlg.innerText()) && /Only These People/.test(await dlg.innerText()) && (await dlg.locator('.seg [aria-checked="true"]').innerText()) === '1 Day' && /Up to 50 links at once/.test(await dlg.innerText()), 'who can open it, how long (a day unless picked), and the limits', await dlg.innerText())
    await dlg.getByRole('radio', { name: '7 Days' }).click()
    await dlg.locator('input[type="password"]').fill('pw-123456')
    await dlg.getByRole('button', { name: 'Create Link' }).click()
    const link = await until(async () => { const v = await dlg.locator('input[readonly]').inputValue().catch(() => ''); return /#s=/.test(v) ? v : null }, 10000)
    ok(!!link && (await dlg.locator('.share-qr svg').count()) === 1 && /Anyone with the link and the password/.test(await dlg.innerText()), 'a link, its QR code and who can open it', link)
    await shot(d.p, `${tag}share-dialog`)
    const listed = (await kit.api('/shares')).shares.find((x) => x.link === link)
    ok(listed?.kind === 'doc' && listed.password && listed.ends - listed.createdAt === 168 * HOUR, 'made as asked: a Studio document, with a password, for 7 days', listed)
    await dlg.getByRole('button', { name: 'Stop Sharing' }).click()
    ok(!!(await until(async () => (await kit.api('/shares')).shares.find((x) => x.link === null && x.id === listed.id)?.ended === 'stopped', 5000)), 'Stop Sharing in the dialog stops it')
    ok(!d.errors.length, 'no page errors', d.errors)
    await d.ctx.close()
  })

  // ---------- Bridge AI's relay, with its share domain ----------
  await part('Bridge AI\'s relay: a site and an app at addresses of their own', async () => {
    await hk.api('/setup', { name: 'Kim' })
    await hk.api('/account/code', { email: 'kim@example.com' })
    await hk.api('/account/verify', { email: 'kim@example.com', code: await accounts.code('kim@example.com') })
    await accounts.admin('POST', `/admin/accounts/${(await hk.api('/account')).account.id}`, { relay: 'approved' })
    await until(async () => (await hk.api('/account?fresh=1').catch(() => null))?.relay?.on, 15000)
    await hk.api('/relay/deploy', { method: 'hosted' })
    ok(!!(await until(async () => (await hk.api('/relay')).online, 20000)), 'Hosted is on Bridge AI\'s relay')
    const id = new URL((await hk.api('/relay')).url).hostname.split('.')[0]
    // A site: its pages, its relative links and its own absolute paths, its scripts running.
    const site = path.join(hk.home, 'site')
    for (const d of ['css', 'sub']) fs.mkdirSync(path.join(site, d), { recursive: true })
    fs.writeFileSync(path.join(site, 'index.html'), `<!doctype html><title>Site</title><link rel="stylesheet" href="css/a.css"><link rel="stylesheet" href="/css/abs.css"><h1 id="h">Home MARKER-SITE</h1><p id="p">x</p><p id="probe">?</p><a id="go" href="sub/page.html">a page</a><script>
      const got = []
      for (const f of [() => top.location.href, () => parent.parent.location.href, () => top.sessionStorage.length, () => top.document.title]) { try { got.push(String(f())) } catch { got.push('blocked') } }
      document.getElementById('probe').textContent = got.join('|')
      fetch('${EX}/loot-site', { method: 'POST', body: got.join('|') }).then(() => { document.getElementById('probe').dataset.sent = 'yes' }, () => { document.getElementById('probe').dataset.sent = 'no' })
      new Image().src = '${EX}/loot-site-img'
    </script>`)
    fs.writeFileSync(path.join(site, 'reach.html'), `<!doctype html><title>Reach</title><p id="cap">?</p><button id="top">Go</button><script>
      const P = parent
      let cap = null
      const orig = P.MessagePort.prototype.postMessage
      P.MessagePort.prototype.postMessage = function (...a) { cap = this; return orig.apply(this, a) }
      fetch('css/a.css').catch(() => {}).finally(() => { P.MessagePort.prototype.postMessage = orig; document.getElementById('cap').textContent = cap ? 'captured' : 'not captured' })
      const away = (to) => { try { const a = P.document.createElement('a'); a.href = '${EX}' + to; a.target = '_top'; P.document.body.appendChild(a); a.click() } catch {} }
      setTimeout(() => away('/phish-noclick'), 300)
      document.getElementById('top').onclick = () => { away('/phish-click'); try { P.open('${EX}/phish-open', '_top') } catch {} try { top.location = '${EX}/phish-location' } catch {} }
    </script>`)
    fs.writeFileSync(path.join(site, 'css', 'a.css'), 'h1 { color: rgb(255, 0, 0) }')
    fs.writeFileSync(path.join(site, 'css', 'abs.css'), '#p { color: rgb(0, 0, 255) }')
    fs.writeFileSync(path.join(site, 'sub', 'page.html'), '<!doctype html><title>Page</title><h2 id="s">Sub page</h2><a id="abs" href="/index.html">home</a>')
    const s = await share({ kind: 'folder', root: 'home', path: 'site', password: 'site-pass-1' }, hk)
    const v1 = new URL(s.link)
    ok(new RegExp(`^${id}-[a-z2-7]{8}\\.localhost:${hosted.port}$`).test(v1.host) && s.scripts === true, 'the link at an address of its own, what it shows at a content address of its own (it may run its scripts there)', s.link)
    const { ctx, p, errors } = await viewer(s.link)
    await p.locator('#password-input').waitFor({ timeout: 15000 })
    await p.fill('#password-input', 'site-pass-1')
    await p.click('#password-go')
    const fr = await frameOf(p, '#h')
    const c = new URL(fr.url())
    ok(!!fr && c.host === `${v1.hostname.split('.')[0]}.share.localhost:${hosted.port}`, 'it shows, at the link\'s content address (the share domain)', fr?.url())
    ok((await fr.evaluate(() => getComputedStyle(document.getElementById('h')).color)) === 'rgb(255, 0, 0)' && !!(await until(() => fr.evaluate(() => getComputedStyle(document.getElementById('p')).color === 'rgb(0, 0, 255)'), 8000)), 'its relative links and its own absolute paths load')
    const probe = await until(async () => { const x = await fr.locator('#probe').innerText(); return x !== '?' && (await fr.locator('#probe').getAttribute('data-sent')) ? x : null }, 8000)
    ok(probe === 'blocked|blocked|blocked|blocked', 'its scripts run, but can\'t reach the page holding the link (its address, its storage, its page)', probe)
    ok((await fr.locator('#probe').getAttribute('data-sent')) === 'no' && !loot.some((x) => x.path === '/loot-site'), '...nor send anything anywhere but its own address (connect-src \'self\')')
    ok(!loot.some((x) => x.path === '/loot-site-img'), '...nor load anything from another site (default-src \'self\'): a picture from elsewhere never loads')
    ok(!new URL(p.url()).hash && !p.url().includes(secretOf(s.link)), 'and the link\'s secret is out of the address')
    await fr.click('#go')
    const sub = await until(async () => { const f = p.frames().find((x) => /\/sub\/page\.html$/.test(x.url())); return f && (await f.locator('#s').count()) ? f : null }, 10000, 200)
    ok(!!sub, 'a link to another page of it')
    await sub.click('#abs')
    const home2 = await until(async () => { const f = p.frames().find((x) => /\/_c\/[\w-]+\/index\.html$/.test(x.url())); return f && (await f.locator('#h').count()) ? f : null }, 10000, 200)
    ok(!!home2, 'and an absolute link back, under the link')
    // A page of it reaching into the page around it (its own address too): for the link's port, and
    // for this tab, with a click and without.
    const sandbox = await p.locator('#view').getAttribute('sandbox')
    ok(!!sandbox && !/allow-top-navigation/.test(sandbox), 'what\'s shown is in a frame that can\'t take the tab anywhere', sandbox)
    await home2.evaluate(() => { location.href = 'reach.html' })
    const reach = await until(async () => { const f = p.frames().find((x) => /\/reach\.html$/.test(x.url())); return f && (await f.locator('#cap').innerText().catch(() => '?')) !== '?' ? f : null }, 10000, 200)
    await sleep(800)
    await reach?.click('#top').catch(() => {})
    await sleep(1500)
    ok((await reach?.locator('#cap').innerText()) === 'not captured', 'reaching into the page around it, it never gets the port to the link\'s page')
    ok(new URL(p.url()).host === v1.host && !!(await p.locator('#view').count()), 'and never takes the tab anywhere, with a click or without', p.url())
    // Back through the tab's history, without a click: the link's page stays.
    const pb = await ctx.newPage()
    await pb.goto(`${EX}/before`)
    await pb.goto(s.link)
    await pb.locator('#password-input').waitFor({ timeout: 15000 })
    await pb.fill('#password-input', 'site-pass-1')
    await pb.click('#password-go')
    const bf = await until(async () => { const f = pb.frames().find((x) => /\/_c\//.test(x.url())); return f && (await f.locator('#h').count()) ? f : null }, 20000, 200)
    await bf.evaluate(() => { let n = 0; const t = setInterval(() => { history.back(); if (++n >= 4) clearInterval(t) }, 250) }).catch(() => {})
    await sleep(2500)
    ok(new URL(pb.url()).host === v1.host && !!(await pb.locator('#view').count()), 'what\'s shown going back through the tab\'s history leaves the link\'s page where it is', pb.url())
    await pb.close()
    // (WebKit reports each navigation of the tab it stopped as an error of the page.)
    ok(!errors.filter((e) => !/sandboxed/.test(e)).length, 'no page errors', errors)
    await shot(p, `${tag}share-site`)
    // A page of what's shared opened on its own (a window, another site's link): nothing.
    const lone = await ctx.newPage()
    await lone.goto(`${c.origin}${c.pathname}`)
    ok(!/MARKER-SITE/.test(await lone.content()), 'a page of it opened outside its frame: nothing shown', (await lone.content()).slice(0, 200))
    await lone.close()
    await ctx.close()
    // The addresses: each serves only what it's for.
    const get = (host, p2) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: hosted.port, path: p2, headers: { host } }, (r) => { let t = ''; r.on('data', (x) => { t += x }); r.on('end', () => resolve({ status: r.statusCode, text: t, csp: r.headers['content-security-policy'] || '' })) }).on('error', reject))
    const label = v1.hostname.split('.')[0]
    const atLink = await get(v1.host, '/')
    const atComputer = await get(`${id}.localhost:${hosted.port}`, '/')
    const frame = await get(`${label}.share.localhost:${hosted.port}`, '/_relay/frame')
    ok(/share\.js/.test(atLink.text) && !/shell\.js/.test(atLink.text) && /shell\.js/.test(atComputer.text) && /share-frame\.js/.test(frame.text) && new RegExp(`frame-ancestors http://${label}\\.localhost:${hosted.port}`).test(frame.csp), 'the link\'s address serves only its page, the content address only its frame (framed only by that link\'s page), and the computer\'s only the phone page', frame.csp)
    const wrong = [await get(`${id}.localhost:${hosted.port}`, '/share.js'), await get(`${label}.share.localhost:${hosted.port}`, '/share.js'), await get(`${label}.share.localhost:${hosted.port}`, '/_relay/view'), await get(v1.host, '/shell.js')]
    ok(wrong.every((r) => !/viewerHello|phoneHello|bridge-relay-assets/.test(r.text)), 'nothing else is at any of them', wrong.map((r) => r.status))
    // Before the password, a page is a stranger to the relay: it costs the account nothing.
    const sv = await viewAs(s.link)
    await sv.request('GET', '/.share/about')
    let sent = 0
    for (let i = 0; i < 200; i++) { try { await sv.send(K.PING, 0); sent++ } catch { break } }
    await sleep(1500)
    ok(!!sv.closed && (await hk.api('/relay')).online && !(await hk.api('/relay')).limit, 'a page that hasn\'t given the password and sends too much is let go, and the computer and its phones carry on', { sent, closed: sv.closed })
    sv.close()
    await hk.api(`/shares/${s.id}/stop`, {})
  })

  await part('Bridge AI\'s relay: links\' allowance, and codes per account', async () => {
    const caps = (await hk.api('/shares')).relay
    ok(caps?.window === 60000 && caps.week === 250000 && caps.linkWeek === 100000 && caps.perSecond === 50, 'Bridge AI\'s relay says what links may carry there, apart from the phones', caps)
    const d = await page(b, hk.url)
    await d.p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await d.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'sharing' } })))
    const said = await until(async () => { const x = await d.p.locator('.share-relay-limits').innerText().catch(() => ''); return x || null }, 10000)
    ok(/60,000 messages in 8 hours and 250,000 a week/.test(said || ''), 'Settings › Sharing says it', said)
    await d.ctx.close()
    // Kim's links get their own codes to an address another account has used up (bo@example.com).
    const token = JSON.parse(fs.readFileSync(path.join(hk.data, 'account.json'), 'utf8')).deviceToken
    const link = `kimlink${'y'.repeat(15)}`
    await accounts.call('POST', '/v1/share-people', { link, emails: ['bo@example.com'], until: Date.now() + 3600000 }, token)
    const sent = await accounts.call('POST', '/v1/share-code', { link, to: 'bo@example.com', code: '87654321' }, token)
    ok(sent.status === 200 && (await accounts.mail()).some((m) => m.to === 'bo@example.com' && /kim@example\.com/.test(m.subject)), 'one account using up its codes to an address leaves another\'s', sent)
  })

  await part('Bridge AI\'s relay: an agent\'s app', async () => {
    const project = path.join(hk.home, 'webapp')
    fs.mkdirSync(project, { recursive: true })
    fs.writeFileSync(path.join(project, 'app.mjs'), APP)
    hk.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
    await hk.api('/agents/catalog')
    const pane = (await hk.api('/agents/launch', { kind: 'claude', cwd: project, label: 'Web app', newSpace: 'Web app' })).paneId
    const port = await freePort()
    const term = (await hk.api('/agents/launch', { kind: 'shell', cwd: project, label: 'Dev server' })).paneId
    await sleep(800)
    const line = IS_WIN ? `& '${process.execPath}' '${path.join(project, 'app.mjs')}' ${port} ${EX}` : `"${process.execPath}" "${path.join(project, 'app.mjs')}" ${port} ${EX}`
    await hk.api(`/panes/${enc(term)}/text`, { text: line, enter: true })
    ok(!!(await until(async () => (await fetch(`http://127.0.0.1:${port}/count`).then((r) => r.ok, () => false)), 15000, 200)), 'an app runs from the agent\'s terminal')
    await until(async () => (await hk.api(`/agents/${enc(pane)}/servers`)).servers.find((x) => x.port === port), 15000, 500)
    const oport = await freePort()
    const other = spawn(process.execPath, [path.join(project, 'app.mjs'), String(oport), EX], { cwd: hk.home, stdio: 'ignore' })
    procs.push(other)
    await until(async () => (await fetch(`http://127.0.0.1:${oport}/count`).then((r) => r.ok, () => false)), 15000, 200)
    const no1 = await refusal({ kind: 'app', port: oport, pane }, hk)
    const no2 = await refusal({ kind: 'app', port: hk.port, pane }, hk)
    ok(/isn't an app one of your agents' terminals started/.test(no1 || '') && /isn't an app/.test(no2 || ''), 'an app started elsewhere, or Bridge AI\'s own port: can\'t be shared', [no1, no2])
    const s = await share({ kind: 'app', port, pane, title: 'Counter App' }, hk)
    ok(s.kind === 'app' && s.what === `Port ${port}`, 'its app can', s)
    const { ctx, p, errors } = await viewer(s.link)
    const fr = await frameOf(p, '#add')
    ok(!!fr, 'in a browser: the app shows')
    ok(!!(await until(() => fr.evaluate(() => getComputedStyle(document.getElementById('n')).color === 'rgb(0, 128, 0)'), 8000)), 'its own absolute paths are its own (/style.css)')
    await fr.click('#add')
    await fr.click('#add')
    ok(!!(await until(async () => (await fr.locator('#n').innerText()) === '2', 8000)) && (await (await fetch(`http://127.0.0.1:${port}/count`)).json()).count === 2, 'its buttons work, for real (a POST to the app)')
    const api = await until(async () => { const x = await fr.locator('#api').innerText(); return x !== '?' ? x : null }, 8000)
    ok(/the app has no \/api\/config/.test(api || '') && !/keepAgents/.test(api || ''), 'its /api/config is the app\'s, never Bridge AI\'s', api)
    ok((await fr.locator('#parent').innerText()) === 'blocked|blocked|blocked|blocked' && !loot.some((x) => x.path === '/loot-app'), 'it can\'t reach the page holding the link, nor send anything elsewhere')
    ok(!errors.length, 'no page errors', errors)
    await shot(p, `${tag}share-app`)
    await ctx.close()
    const v = await viewAs(s.link)
    const who = await v.request('GET', '/c/whoami', null, [['cookie', 'bridge-ai-1=x'], ['authorization', 'Bearer stolen'], ['x-bridge-relay', 'dev']])
    ok(who.json?.cookie === '' && who.json.auth === null && who.json.host === `localhost:${port}` && !who.json.bridge.length, 'the app gets no cookies, no Authorization and nothing of Bridge AI\'s', who.json)
    const first = await v.request('GET', '/c/')
    ok(!first.headers['set-cookie'] && /^sandbox allow-scripts allow-same-origin.*connect-src 'self'/.test(first.headers['content-security-policy'] || ''), 'its cookies aren\'t passed on; it\'s sandboxed, reaching only its own address', first.headers)
    const go = await v.request('GET', '/c/go')
    ok(go.status === 302 && go.headers.location === '/count', 'a redirect to itself stays on it (from its root, which the page puts its own path in front of)', go.headers)
    v.close()
    stopTree(other)
    await hk.api(`/shares/${s.id}/stop`, {})
  })

  const kept = fs.readFileSync(path.join(kit.data, 'shares.json'), 'utf8')
  ok(!/right-horse|open-sesame|pw-123456/.test(kept), 'no password is kept as it is')
  ok(!/#s=|right-horse|open-sesame/.test(kit.log() + hk.log()), 'nor is a link\'s secret or a password in the servers\' logs')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-2000))
} finally {
  await b.close().catch(() => {})
  for (const p of procs) stopTree(p)
  for (const k of kits) k.stop()
  relay.stop()
  hosted.stop()
  accounts.stop()
  elsewhere.close()
}
process.exit(done().fail ? 1 : 0)
