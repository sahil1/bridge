// Share Links (server/shares.js, relay/web/share.js, the relay's share address in relay/worker.js),
// end to end through the relay stand-in and its share address (stand-ins/relay.mjs), with Playwright
// as the person a link was given to and lib/viewer.mjs where a test needs the computer's own words.
// Bold Bridge's accounts service is stood in for (stand-ins/accounts.mjs, its mailbox), as what
// emails a named person their code; links' hours are seconds here (BRIDGE_TEST_SHARE_HOUR_MS).
//   a file: it shows, and only it (what it links to beside it isn't shared);
//   a folder as a site: its index.html, its relative links and its own absolute paths, a folder
//     without one listed, nothing hidden;
//   path escapes refused: .., encoded or not, a name starting with a dot, a link (symlink) out of the
//     folder (not on Windows, where making one needs more than a test has), Bridge AI's own folder;
//   never /api, nor anything else of Bridge AI's, however it's asked;
//   the relay never sees what's shown, the link's secret or the password (its traffic tapped);
//   a password: asked first, a wrong one said with the tries left, the 5th locks it for 15 minutes
//     (the right one refused meanwhile), your devices told;
//   only named people: an email, its code emailed (the stand-in's mailbox), a wrong code said, an
//     email it doesn't name answered the same and sent nothing, the code to your devices when it
//     can't be emailed;
//   a Studio document: shown as a page, and again as it changes, live;
//   an agent's app: usable (its buttons, a POST), its absolute paths its own, never Bridge AI's API,
//     its cookies not passed on; one not from an agent's terminal can't be shared;
//   expiry and Stop Sharing: an open page ends at once, said, and the link opens no more;
//   the computer offline: said in the owner's words, and the link works again when it's back;
//   your devices told of each link's first open; what's kept (opens, the country, the email);
//   phone parity: a phone makes, sees and stops a link; Settings › Sharing at a phone's width;
//   the dialog: Share Link from Studio, a link and its QR code;
//   on Bridge AI's relay (stood in for): a link opens at an address of its own, <id>-<8 letters>.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import WebSocket, { WebSocketServer } from 'ws'
import { startKit, startRelay, startAccounts, startHostedRelay, checks, until, browser, page, sleep, shot, freePort, phoneFaults, ROOT, TEST, IS_WIN, stopTree } from '../lib/harness.mjs'
import { viewAs } from '../lib/viewer.mjs'
import { linkAs } from '../lib/linkclient.mjs'
import { K } from '../../relay/web/link.js'

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

// An app an agent's `npm run dev` would serve: a page with a button that POSTs, a counter, its own
// absolute paths, a cookie it sets, and a look at what it was sent.
const APP = String.raw`
import http from 'node:http'
let count = 0
const page = '<!doctype html><html><head><meta charset="utf-8"><title>Counter App</title><link rel="stylesheet" href="/style.css"></head><body><h1 id="n">0</h1><button id="add">Add</button><p id="api">?</p>' +
  '<script>const n = document.getElementById("n"); fetch("/count").then((r) => r.json()).then((j) => { n.textContent = j.count });' +
  'document.getElementById("add").onclick = () => fetch("/add", { method: "POST", body: "1" }).then((r) => r.json()).then((j) => { n.textContent = j.count });' +
  'fetch("/api/config").then((r) => r.text()).then((t) => { document.getElementById("api").textContent = t }, () => { document.getElementById("api").textContent = "failed" })</script></body></html>'
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
const push = path.join(TEST, '.out', `share-links-push-${process.pid}.jsonl`)
fs.rmSync(push, { force: true })
const kits = []
const procs = []
const kit = await startKit('share-links', {
  config: { account: accounts.accountConfig },
  env: (d) => { fs.writeFileSync(path.join(d.data, 'relay.json'), JSON.stringify(relay.relayFile)); return { BRIDGE_TEST_PUSH: push, BRIDGE_TEST_SHARE_HOUR_MS: String(HOUR), BRIDGE_COMPUTER_NAME: 'Studio' } },
})
kits.push(kit)
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const share = (body) => kit.api('/shares', { lasts: 'week', who: 'link', ...body }).then((r) => r.share)
const notes = () => lines(push).map((l) => l.note)
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

try {
  await kit.api('/setup', { name: 'Tester' })
  ok(!!(await until(async () => (await kit.api('/relay')).online, 20000)), 'the computer is connected to its relay')
  // Notifications set up on one device of the owner's.
  await kit.api('/push/subscribe', { subscription: { endpoint: `https://push.test/owner/${Date.now()}`, keys: { p256dh: 'test', auth: 'test' } }, label: 'Owner phone' })
  const home = kit.home
  fs.writeFileSync(path.join(home, 'outside.txt'), 'OUTSIDE-SECRET')

  // ---------- a file ----------
  await part('a file', async () => {
    const dir = path.join(home, 'report')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'report.html'), '<!doctype html><title>Report</title><h1 id="r">Quarterly report MARKER-FILE</h1><img id="pic" src="pic.png" alt="pic"><a id="next" href="notes.html">notes</a>')
    fs.writeFileSync(path.join(dir, 'pic.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
    fs.writeFileSync(path.join(dir, 'notes.html'), 'notes')
    const s = await share({ kind: 'file', root: 'home', path: 'report/report.html' })
    ok(new RegExp(`^${relay.shareUrl}/v/[\\w-]{22}#s=[\\w-]{43}&n=Tester$`).test(s.link) && /<svg/.test(s.qr || ''), 'a link at the relay\'s share address (never the phone page\'s), its secret in the fragment, with a QR code', s.link)
    const v = await viewAs(s.link)
    const about = await v.request('GET', '/.share/about')
    ok(about.json?.title === 'report.html' && about.json.kind === 'file' && about.json.name === 'Tester' && about.json.needs === null && about.json.entry === 'report.html', 'the page hears what it shows and who shares it', about.json)
    const f = await v.request('GET', '/c/report.html')
    ok(f.status === 200 && /MARKER-FILE/.test(f.text) && /^sandbox allow-scripts allow-same-origin/.test(f.headers['content-security-policy'] || '') && f.headers['x-content-type-options'] === 'nosniff' && f.headers['referrer-policy'] === 'same-origin', 'the file, sandboxed, never sniffed as something else', f.headers)
    const sib = await v.request('GET', '/c/pic.png')
    ok(sib.status === 404 && /Only report\.html is shared/.test(sib.text), 'what it links to beside it isn\'t shared: said', sib.status)
    v.close()
    const { ctx, p, errors } = await viewer(s.link)
    const fr = await frameOf(p, '#r')
    ok(!!fr && /MARKER-FILE/.test(await fr.locator('#r').innerText()), 'in a browser: it shows', fr?.url())
    ok((await p.locator('#top-title').innerText()) === 'report.html' && /Tester/.test(await p.locator('#top-who').innerText()), 'with what it is and who shares it above it')
    ok(!errors.length, 'no page errors', errors)
    await shot(p, `${tag}share-file`)
    await ctx.close()
  })

  // ---------- a folder, as a site ----------
  let site = null
  await part('a folder as a site', async () => {
    const dir = path.join(home, 'site')
    for (const d of ['css', 'sub', 'img', 'empty', '.git']) fs.mkdirSync(path.join(dir, d), { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Site</title><link rel="stylesheet" href="css/a.css"><link rel="stylesheet" href="/css/abs.css"><h1 id="h">Home MARKER-SITE</h1><p id="p">x</p><img id="logo" src="img/logo.svg" alt="logo"><a id="go" href="sub/page.html">a page</a>')
    fs.writeFileSync(path.join(dir, 'css', 'a.css'), 'h1 { color: rgb(255, 0, 0) }')
    fs.writeFileSync(path.join(dir, 'css', 'abs.css'), '#p { color: rgb(0, 0, 255) }')
    fs.writeFileSync(path.join(dir, 'img', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
    fs.writeFileSync(path.join(dir, 'sub', 'page.html'), '<!doctype html><title>Page</title><h2 id="s">Sub page</h2><a id="back" href="../index.html">back</a><a id="abs" href="/index.html">home</a>')
    fs.writeFileSync(path.join(dir, 'empty', 'a b.txt'), 'spaced')
    fs.writeFileSync(path.join(dir, '.env'), 'TOKEN=HIDDEN-ENV')
    fs.writeFileSync(path.join(dir, '.git', 'config'), 'HIDDEN-GIT')
    site = await share({ kind: 'folder', root: 'home', path: 'site' })
    const { ctx, p, errors } = await viewer(site.link)
    const fr = await frameOf(p, '#h')
    ok(!!fr, 'its index.html opens first', fr?.url())
    ok((await fr.evaluate(() => getComputedStyle(document.getElementById('h')).color)) === 'rgb(255, 0, 0)', 'its relative links load (a stylesheet)')
    ok(!!(await until(() => fr.evaluate(() => getComputedStyle(document.getElementById('p')).color === 'rgb(0, 0, 255)'), 8000)), 'and its own absolute paths, as its own (/css/abs.css)')
    ok(!!(await until(() => fr.evaluate(() => document.getElementById('logo').complete && document.getElementById('logo').naturalWidth > 0), 8000)), 'a picture')
    await fr.click('#go')
    const sub = await until(async () => { const f = p.frames().find((x) => /\/sub\/page\.html$/.test(x.url())); return f && (await f.locator('#s').count()) ? f : null }, 10000, 200)
    ok(!!sub, 'a link to another page of it', p.frames().map((x) => x.url()))
    await sub.click('#abs')
    ok(!!(await until(async () => { const f = p.frames().find((x) => /\/_c\/[\w-]{22}\/index\.html$/.test(x.url())); return f && (await f.locator('#h').count()) }, 10000, 200)), 'and an absolute link back, under the share', p.frames().map((x) => x.url()))
    ok(!errors.length, 'no page errors', errors)
    await shot(p, `${tag}share-site`)
    await ctx.close()
    const v = await viewAs(site.link)
    const list = await v.request('GET', '/c/empty/')
    ok(list.status === 200 && /a%20b\.txt/.test(list.text) && /script-src 'none'/.test(list.headers['content-security-policy'] || '') && !/<script/i.test(list.text), 'a folder without an index.html: what\'s in it, listed, with nothing that runs', list.text.slice(0, 200))
    ok((await v.request('GET', '/c/empty/a%20b.txt')).text === 'spaced', 'a name with a space, as a link has it')
    const top = await v.request('GET', '/c/sub')
    ok(top.status === 302 && top.headers.location === `/_c/${site.id}/sub/`, 'a folder asked for without its /: sent there, so its links work', top.headers)
    const root = await v.request('GET', '/c/')
    ok(!/HIDDEN|\.env|\.git/.test(root.text), 'nothing hidden in what it serves')
    v.close()
  })

  // ---------- path escapes, links out, hidden files ----------
  await part('path escapes and symlinks', async () => {
    const v = await viewAs(site.link)
    const tries = ['/c/../outside.txt', '/c/%2e%2e/outside.txt', '/c/sub/..%2f..%2foutside.txt', '/c/%2e%2e%2f%2e%2e%2foutside.txt', '/c/sub/%2e%2e/%2e%2e/outside.txt', '/c/..%5coutside.txt', '/c/.env', '/c/.git/config', '/c/%2eenv', '/c/sub/../.env', '/c//etc/passwd', '/c/C:%5cWindows', '/c/%00', `/c/${enc(path.join(home, 'outside.txt'))}`]
    const got = []
    for (const u of tries) { const r = await v.request('GET', u); got.push([u, r.status]); if (/OUTSIDE-SECRET|HIDDEN/.test(r.text || '')) got.push([u, 'LEAKED']) }
    ok(got.every(([, s]) => s === 404), '.. (encoded or not), a backslash, a name starting with a dot, an absolute path: refused, and nothing outside it read', got)
    if (IS_WIN) skip('a link (symlink) out of the folder refused', 'making one on Windows needs more than a test has')
    else {
      fs.symlinkSync(path.join(home, 'outside.txt'), path.join(home, 'site', 'out.txt'))
      fs.symlinkSync(home, path.join(home, 'site', 'outdir'))
      fs.symlinkSync(path.join(home, 'site', 'css', 'a.css'), path.join(home, 'site', 'in.css'))
      const out = await v.request('GET', '/c/out.txt')
      const outDir = await v.request('GET', '/c/outdir/outside.txt')
      const inside = await v.request('GET', '/c/in.css')
      ok(out.status === 404 && outDir.status === 404 && !/OUTSIDE-SECRET/.test(out.text + outDir.text), 'a link (symlink) leading out of it, to a file or a folder: refused', [out.status, outDir.status])
      ok(inside.status === 200 && /255, 0, 0/.test(inside.text), 'one leading to something inside it: served', inside.status)
    }
    for (const bad of [{ kind: 'folder', root: 'home', path: '' }, { kind: 'folder', root: 'home', path: 'site/.git' }]) {
      const e = await kit.api('/shares', { ...bad, lasts: 'week', who: 'link' }).then(() => null, (x) => x.message)
      ok(!!e, `can't be shared: ${bad.path || 'the home folder'}`, e)
    }
    const kept = await kit.api('/shares', { kind: 'file', root: 'studio', path: '../../relay.json', lasts: 'week', who: 'link' }).then(() => null, (x) => x.message)
    ok(!!kept, 'nor anything of Bridge AI\'s own folder', kept)
    v.close()
  })

  // ---------- never /api ----------
  await part('never /api', async () => {
    const v = await viewAs(site.link)
    const asks = ['/api/config', '/api/relay', '/api/shares', '/c/../api/config', '/.share/../api/config', '/../api/config', 'http://127.0.0.1/api/config', `${kit.url}/api/config`, '/_preview/5173/', '/m/x/api/config', '/assets/index.js']
    const got = []
    for (const u of asks) { const r = await v.request('GET', u); got.push([u, r.status, /"(keepAgents|configured|shares|devices)"/.test(r.text || '')]) }
    ok(got.every(([, s, leak]) => s !== 200 && !leak), 'none of Bridge AI\'s API, pages or files, however it\'s asked', got)
    const wsId = 77
    await v.send(K.WS_OPEN, wsId, { u: '/api/events' })
    const closed = await until(async () => { const r = await v.next(3000); return r.kind === K.WS_CLOSE && r.id === wsId ? r : null }, 6000, 0)
    ok(!!closed, 'nor a socket to it', closed)
    v.close()
  })

  // ---------- the relay never sees what's shown ----------
  await part('the relay sees no plaintext', async () => {
    const t1 = await tap(relay.shareUrl)
    const s = await share({ kind: 'folder', root: 'home', path: 'site', password: 'open-sesame-42' })
    const secret = new URLSearchParams(new URL(s.link).hash.slice(1)).get('s')
    const v = await viewAs(s.link.replace(relay.shareUrl, t1.url))
    await v.request('POST', '/.share/password', { password: 'open-sesame-42' })
    const page1 = await v.request('GET', '/c/')
    ok(/MARKER-SITE/.test(page1.text), 'through the tap, the page opens')
    const all = Buffer.concat(t1.seen).toString('latin1')
    ok(t1.seen.length > 4 && !/MARKER-SITE|open-sesame-42|index\.html|css\/a\.css/.test(all) && !all.includes(secret), 'what the relay carries: no word of what\'s shown, nor what was asked for, nor the password, nor the link\'s secret', { messages: t1.seen.length })
    const hello = t1.seen.map((x) => x.toString('utf8')).find((x) => x.includes('"hello"')) || ''
    ok(/"view":1/.test(hello) && !hello.includes(secret), 'the hello in the clear has the share\'s id, never its secret', hello.slice(0, 200))
    v.close()
    t1.stop()
    await kit.api(`/shares/${s.id}/stop`, {})
  })

  // ---------- a password, and its lockout ----------
  await part('a password', async () => {
    const before = notes().length
    const s = await share({ kind: 'folder', root: 'home', path: 'site', password: 'right-horse-7' })
    const { ctx, p } = await viewer(s.link)
    await p.locator('#password-input').waitFor({ timeout: 15000 })
    ok(/Tester set a password/.test(await p.locator('#password-text').innerText()) && !(await p.locator('#view').isVisible()) && !(await p.locator('#top-title').innerText()), 'asked for first; nothing shown before, not even its name')
    await p.fill('#password-input', 'wrong-one')
    await p.click('#password-go')
    const said = await until(async () => { const x = await p.locator('#password-err').innerText(); return x ? x : null }, 10000)
    ok(/isn't the password\. 4 more tries/.test(said || ''), 'a wrong one: said, with the tries left', said)
    await p.fill('#password-input', 'right-horse-7')
    await p.click('#password-go')
    const fr = await frameOf(p, '#h')
    ok(!!fr, 'the right one: what\'s shared shows')
    await p.reload()
    ok(!!(await frameOf(p, '#h')), 'and a reload doesn\'t ask again (this tab\'s pass)')
    await ctx.close()
    // Five wrong in a row: locked, the right one too, for 15 minutes.
    const v = await viewAs(s.link)
    const r = []
    for (let i = 0; i < 5; i++) r.push((await v.request('POST', '/.share/password', { password: `nope-${i}` })).json?.error)
    const right = await v.request('POST', '/.share/password', { password: 'right-horse-7' })
    ok(/1 more try/.test(r[3] || '') && /locked for now/.test(r[4] || '') && /locked for now/.test(right.json?.error || ''), 'the fifth wrong try in a row locks it: the right one is refused while it\'s locked', { r, right: right.json })
    const c = await v.request('GET', '/c/')
    ok(c.status === 401 && !/MARKER/.test(c.text), 'and nothing is served meanwhile', c.status)
    v.close()
    const told = notes().slice(before)
    ok(told.some((n) => n.kind === 'share' && /wrong password 5 times/.test(n.title) && /locked for 15 minutes/.test(n.body)), 'your devices hear it was locked', told)
    const listed = (await kit.api('/shares')).shares.find((x) => x.id === s.id)
    ok(listed.locked > Date.now() && listed.opens.filter((o) => o.what === 'wrong password').length >= 5 && listed.opens.some((o) => o.what === 'locked') && listed.password === true, 'Settings › Sharing has each wrong try and the lock', listed.opens)
    const kept = fs.readFileSync(path.join(kit.data, 'shares.json'), 'utf8')
    ok(!kept.includes('right-horse-7') && /"N":/.test(kept), 'the password is kept only as a salted hash')
    await kit.api(`/shares/${s.id}/stop`, {})
  })

  // ---------- only these people ----------
  await part('named emails and their codes', async () => {
    await kit.api('/account/code', { email: 'owner@example.com' })
    await kit.api('/account/verify', { email: 'owner@example.com', code: await accounts.code('owner@example.com') })
    const s = await share({ kind: 'folder', root: 'home', path: 'site', who: 'people', emails: 'ana@example.com, Bo@Example.com' })
    ok(JSON.stringify(s.emails) === JSON.stringify(['ana@example.com', 'bo@example.com']) && s.who === 'people', 'the people it names, by email, as they\'re compared', s.emails)
    const mailed = (await accounts.mail()).length
    const { ctx, p } = await viewer(s.link)
    await p.locator('#email-input').waitFor({ timeout: 15000 })
    ok(!(await p.locator('#view').isVisible()), 'nothing shows before the email is proved')
    await p.fill('#email-input', 'ana@example.com')
    await p.click('#email-go')
    await p.locator('#code-input').waitFor({ timeout: 10000 })
    const said = await p.locator('#code-text').innerText()
    const code = await until(() => accounts.code('ana@example.com'), 10000)
    const mail = (await accounts.mail()).at(-1)
    ok(/^\d{6}$/.test(code || '') && /owner@example\.com/.test(mail?.subject || '') && !/site|MARKER|index/i.test(`${mail?.subject} ${mail?.text}`), 'a 6-digit code is emailed to it (by the accounts service, from the owner\'s account), saying whose link, nothing of what it shows', mail)
    await p.fill('#code-input', code === '000000' ? '111111' : '000000')
    await p.click('#code-go')
    ok(/isn't right\. 4 more tries/.test(await until(async () => (await p.locator('#code-err').innerText()) || null, 8000) || ''), 'a wrong code: said, with the tries left')
    await p.fill('#code-input', code)
    await p.click('#code-go')
    ok(!!(await frameOf(p, '#h')), 'the right code: what\'s shared shows')
    await ctx.close()
    // An email it doesn't name: the same answer, and nothing sent.
    const v = await viewAs(s.link)
    const n0 = (await accounts.mail()).length
    const no = await v.request('POST', '/.share/email', { email: 'eve@example.com' })
    const yes = await v.request('POST', '/.share/email', { email: 'bo@example.com' })
    ok(no.status === 200 && no.json.said.replace('eve@example.com', 'X') === yes.json.said.replace('bo@example.com', 'X') && !(await accounts.mail()).slice(n0).some((m) => m.to === 'eve@example.com'), 'an email it doesn\'t name: answered the same, and sent nothing', { no: no.json, yes: yes.json })
    const c0 = await v.request('GET', '/c/')
    ok(c0.status === 401, 'and nothing served before the code', c0.status)
    v.close()
    // The email can't go just now: your devices get the code, to pass on.
    await accounts.mailFails('unsent')
    try {
      const before = notes().length
      const v2 = await viewAs(s.link)
      await v2.request('POST', '/.share/email', { email: 'ana@example.com' })
      const told = await until(() => notes().slice(before).find((n) => /ana@example\.com asked to open/.test(n.title)), 8000)
      const passed = /Their code is (\d{6})/.exec(told?.body || '')?.[1]
      ok(!!passed, 'when it can\'t be emailed: your devices get the code, to pass on', told)
      const inNow = await v2.request('POST', '/.share/code', { email: 'ana@example.com', code: passed })
      ok(inNow.status === 200 && /MARKER-SITE/.test((await v2.request('GET', '/c/')).text), 'and it works', inNow.json)
      v2.close()
    } finally { await accounts.mailFails('') }
    const listed = (await kit.api('/shares')).shares.find((x) => x.id === s.id)
    ok(listed.opens.some((o) => o.what === 'opened' && o.email === 'ana@example.com') && listed.opens.some((o) => o.what === 'not on the list' && o.email === 'eve@example.com') && listed.opens.some((o) => o.what === 'wrong code'), 'Settings › Sharing has which email opened it, and the tries', listed.opens)
    ok(mailed >= 0, '(the owner\'s own sign-in code went first)')
    await kit.api(`/shares/${s.id}/stop`, {})
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

  // ---------- an agent's app ----------
  await part('an agent\'s app', async () => {
    const project = path.join(home, 'webapp')
    fs.mkdirSync(project, { recursive: true })
    fs.writeFileSync(path.join(project, 'app.mjs'), APP)
    kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
    await kit.api('/agents/catalog')
    const pane = (await kit.api('/agents/launch', { kind: 'claude', cwd: project, label: 'Web app', newSpace: 'Web app' })).paneId
    const port = await freePort()
    const term = (await kit.api('/agents/launch', { kind: 'shell', cwd: project, label: 'Dev server' })).paneId
    await sleep(800)
    const line = IS_WIN ? `& '${process.execPath}' '${path.join(project, 'app.mjs')}' ${port}` : `"${process.execPath}" "${path.join(project, 'app.mjs')}" ${port}`
    await kit.api(`/panes/${enc(term)}/text`, { text: line, enter: true })
    ok(!!(await until(async () => (await fetch(`http://127.0.0.1:${port}/count`).then((r) => r.ok, () => false)), 15000, 200)), 'an app runs from the agent\'s terminal')
    await until(async () => (await kit.api(`/agents/${enc(pane)}/servers`)).servers.find((x) => x.port === port), 15000, 500)
    // One started elsewhere (not from an agent's terminal) can't be shared, nor Bridge AI's own port.
    const oport = await freePort()
    const other = spawn(process.execPath, [path.join(project, 'app.mjs'), String(oport)], { cwd: home, stdio: 'ignore' })
    procs.push(other)
    await until(async () => (await fetch(`http://127.0.0.1:${oport}/count`).then((r) => r.ok, () => false)), 15000, 200)
    const no1 = await kit.api('/shares', { kind: 'app', port: oport, pane, lasts: 'week', who: 'link' }).then(() => null, (e) => e.message)
    const no2 = await kit.api('/shares', { kind: 'app', port: kit.port, pane, lasts: 'week', who: 'link' }).then(() => null, (e) => e.message)
    ok(/isn't an app one of your agents' terminals started/.test(no1 || '') && /isn't an app/.test(no2 || ''), 'an app started elsewhere, or Bridge AI\'s own port: can\'t be shared', [no1, no2])
    const s = await kit.api('/shares', { kind: 'app', port, pane, title: 'Counter App', lasts: 'week', who: 'link' }).then((r) => r.share)
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
    ok(!errors.length, 'no page errors', errors)
    await shot(p, `${tag}share-app`)
    await ctx.close()
    const v = await viewAs(s.link)
    const who = await v.request('GET', '/c/whoami', null, [['cookie', 'bridge-ai-1=x'], ['authorization', 'Bearer stolen'], ['x-bridge-relay', 'dev']])
    ok(who.json?.cookie === '' && who.json.auth === null && who.json.host === `localhost:${port}` && !who.json.bridge.length, 'the app gets no cookies, no Authorization and nothing of Bridge AI\'s', who.json)
    const first = await v.request('GET', '/c/')
    ok(!first.headers['set-cookie'] && /^sandbox allow-scripts allow-same-origin/.test(first.headers['content-security-policy'] || ''), 'its cookies aren\'t passed on, and it\'s sandboxed', first.headers)
    const go = await v.request('GET', '/c/go')
    ok(go.status === 302 && go.headers.location === `/_c/${s.id}/count`, 'a redirect to itself stays under the link', go.headers)
    // Stopped: the link says so.
    stopTree(other)
    await kit.api(`/panes/${enc(term)}/text`, { text: '\u0003', enter: false }).catch(() => {})
    v.close()
    await kit.api(`/shares/${s.id}/stop`, {})
  })

  // ---------- expiry, and Stop Sharing ----------
  await part('expiry and Stop Sharing', async () => {
    const s = await share({ kind: 'folder', root: 'home', path: 'site', lasts: 'hour' })
    const v = await viewAs(s.link)
    await v.request('GET', '/.share/about')
    const { ctx, p } = await viewer(s.link)
    await frameOf(p, '#h')
    const gone = await until(async () => { try { const r = await v.next(2000); return r.kind === K.GONE ? r : null } catch { return null } }, HOUR + 8000, 0)
    ok(!!gone, 'its hour (seconds here) ran out: an open page is told, sealed')
    ok(!!(await until(async () => /This link has ended/.test(await p.locator('#wait-title').innerText()) && /time ran out/.test(await p.locator('#wait-text').innerText()), 8000)) && !(await p.locator('#view').isVisible()), 'and the browser\'s page says so, what was shown gone')
    const again = await viewAs(s.link)
    ok(again.refused?.why === 'no-share', 'the link opens no more', again)
    const listed = (await kit.api('/shares')).shares.find((x) => x.id === s.id)
    ok(listed.ended === 'expired' && !listed.link && !fs.readFileSync(path.join(kit.data, 'shares.json'), 'utf8').includes(new URLSearchParams(new URL(s.link).hash.slice(1)).get('s')), 'listed as ended, its secret forgotten', listed)
    await ctx.close()
    // Stop Sharing, with a page open.
    const s2 = await share({ kind: 'folder', root: 'home', path: 'site' })
    const w = await viewer(s2.link)
    await frameOf(w.p, '#h')
    ok((await kit.api('/shares')).shares.find((x) => x.id === s2.id)?.open === 1, 'Settings › Sharing says it\'s open on one device')
    await kit.api(`/shares/${s2.id}/stop`, {})
    ok(!!(await until(async () => /This link has ended/.test(await w.p.locator('#wait-title').innerText()) && /Tester stopped sharing it/.test(await w.p.locator('#wait-text').innerText()), 5000)), 'Stop Sharing: the open page ends at once, saying so')
    ok((await viewAs(s2.link)).refused?.why === 'no-share', 'and the link opens no more')
    await w.ctx.close()
  })

  // ---------- the computer offline ----------
  await part('the computer offline', async () => {
    const s = await share({ kind: 'folder', root: 'home', path: 'site' })
    const w = await viewer(s.link)
    await frameOf(w.p, '#h')
    await kit.restart(async () => {
      const off = await viewer(s.link)
      const said = await until(async () => { const x = `${await off.p.locator('#wait-title').innerText()} ${await off.p.locator('#wait-text').innerText()}`; return /offline/.test(x) ? x : null }, 20000)
      ok(/Tester's computer is offline/.test(said || '') && /The link works when it's back/.test(said || ''), 'a link opened while the computer is off: said in the owner\'s words', said)
      ok(/offline/.test(await w.p.locator('#top-state').innerText()), 'and an open page says it above what it shows')
      await shot(off.p, `${tag}share-offline`)
      await off.ctx.close()
      const v = await viewAs(s.link)
      ok(!!v.offline, 'the relay says the computer is offline', v)
    })
    ok(!!(await until(async () => (await kit.api('/relay')).online, 20000)), 'back')
    ok(!!(await until(async () => !(await w.p.locator('#top-state').innerText()), 15000)) && !!(await frameOf(w.p, '#h')), 'the link works again by itself, the same link', await w.p.locator('#top-state').innerText())
    const v = await viewAs(s.link)
    ok(/MARKER-SITE/.test((await v.request('GET', '/c/')).text), 'and opens for anyone again')
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

  // ---------- phone parity ----------
  await part('phone parity', async () => {
    const code = (await kit.api('/relay/pair', {})).pairing.code
    const ph = await linkAs(relay.url, { code, name: 'Phone', about: { name: 'Phone' } })
    ok(!ph.refused && !!ph.deviceId, 'a phone pairs', ph.refused)
    const made = await ph.request('POST', '/api/shares', { kind: 'folder', root: 'home', path: 'site', who: 'link', lasts: 'day' })
    ok(made.status === 200 && /\/v\/[\w-]{22}#s=/.test(made.json?.share?.link || '') && made.json.share.by === 'Phone', 'the phone makes a link', made.json)
    const id = made.json.share.id
    const seen = await ph.request('GET', '/api/shares')
    ok(seen.json?.shares?.some((x) => x.id === id && x.link === made.json.share.link), 'and sees it')
    const w = await viewer(made.json.share.link, { phone: true })
    ok(!!(await frameOf(w.p, '#h')), 'a phone\'s browser opens it')
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
    const after = await ph.request('GET', '/api/shares')
    ok(after.json?.shares?.find((x) => x.id === id)?.ended === 'stopped', 'and the phone sees it stopped')
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
    await dlg.locator('input[type="password"]').fill('pw-1234')
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

  // ---------- Bridge AI's relay: an address for each link ----------
  await part('on Bridge AI\'s relay', async () => {
    const hosted = await startHostedRelay('share-links', {}, accounts)
    const hk = await startKit('share-links-hosted', { config: { account: accounts.accountConfig, relay: { hostedUrl: hosted.url } }, env: { BRIDGE_COMPUTER_NAME: 'Hosted' } })
    kits.push(hk)
    try {
      await hk.api('/setup', { name: 'Kim' })
      await hk.api('/account/code', { email: 'kim@example.com' })
      await hk.api('/account/verify', { email: 'kim@example.com', code: await accounts.code('kim@example.com') })
      const acct = (await hk.api('/account')).account
      await accounts.admin('POST', `/admin/accounts/${acct.id}`, { relay: 'approved' })
      await until(async () => (await hk.api('/account?fresh=1').catch(() => null))?.relay?.on, 15000)
      await hk.api('/relay/deploy', { method: 'hosted' })
      ok(!!(await until(async () => (await hk.api('/relay')).online, 20000)), 'a computer on Bridge AI\'s relay')
      fs.mkdirSync(path.join(hk.home, 'site'), { recursive: true })
      fs.writeFileSync(path.join(hk.home, 'site', 'index.html'), '<h1>HOSTED-SITE</h1>')
      const s1 = (await hk.api('/shares', { kind: 'folder', root: 'home', path: 'site', lasts: 'hour', who: 'link' })).share
      const s2 = (await hk.api('/shares', { kind: 'folder', root: 'home', path: 'site', lasts: 'hour', who: 'link' })).share
      const id = new URL((await hk.api('/relay')).url).hostname.split('.')[0]
      const h1 = new URL(s1.link).host
      ok(new RegExp(`^${id}-[a-z2-7]{8}\\.localhost:${hosted.port}$`).test(h1) && new URL(s2.link).host !== h1, 'each link opens at an address of its own, beside the computer\'s (each a site of its own to a browser)', [s1.link, s2.link])
      const v = await viewAs(s1.link)
      const c = await v.request('GET', '/c/')
      ok(/HOSTED-SITE/.test(c.text || ''), 'and opens there', c.status)
      v.close()
      // (As a browser asks: by the name, which Node's fetch won't set.)
      const get = (host, p2) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: hosted.port, path: p2, headers: { host } }, (r) => { let t = ''; r.on('data', (c) => { t += c }); r.on('end', () => resolve({ status: r.statusCode, text: t })) }).on('error', reject))
      const atLink = await get(h1, '/')
      const atComputer = await get(`${id}.localhost:${hosted.port}`, '/')
      ok(/share\.js/.test(atLink.text) && !/shell\.js/.test(atLink.text) && /shell\.js/.test(atComputer.text) && !/share\.js/.test(atComputer.text), 'a link\'s address serves only the page a link opens, and the computer\'s only the phone page', [atLink.text.slice(0, 120), atComputer.text.slice(0, 120)])
      const wrong = [await get(`${id}.localhost:${hosted.port}`, '/share.js'), await get(`${id}.localhost:${hosted.port}`, '/share-sw.js'), await get(h1, '/shell.js'), await get(h1, '/sw.js')]
      ok(wrong.every((r) => !/viewerHello|phoneHello|bridge-relay-assets/.test(r.text)), 'neither page\'s code is ever at the other\'s address', wrong.map((r) => r.status))
    } finally { hk.stop(); hosted.stop() }
  })

  const kept = fs.readFileSync(path.join(kit.data, 'shares.json'), 'utf8')
  ok(!/right-horse|open-sesame|pw-1234/.test(kept), 'no password is kept as it is')
  const log = kit.log()
  ok(!/#s=|right-horse|open-sesame/.test(log), 'nor is a link\'s secret or a password in the server\'s log')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-2000))
} finally {
  await b.close().catch(() => {})
  for (const p of procs) stopTree(p)
  for (const k of kits) k.stop()
  relay.stop()
  accounts.stop()
}
process.exit(done().fail ? 1 : 0)
