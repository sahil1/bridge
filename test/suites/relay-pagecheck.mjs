// The computer's check of the phone page Bridge AI's relay serves to browsers (server/relaycheck.js),
// against a stand-in for the computer's address on the relay and one for GitHub, both on this
// computer, so nothing reaches either. The relay saying this computer's version: its files compared
// with this computer's own copy, GitHub never asked; a changed shell.js, sw.js or link-sw.js said by
// name. A newer release: compared with that release's files from GitHub (asked once, then kept),
// fine when they match and said when they don't; a version with no release on GitHub, or one that
// isn't a version at all (GitHub not asked), said as not a release. A relay from before it said
// its version: compared with this computer's own. Nothing sent but GETs with no body, to the page's
// own files and /_relay/health. The relay not answering: said as not checked, and a finding from
// before isn't dropped for it. Settings opening checks again only when the last check is 10
// minutes old; Check again at once.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { ROOT, OUT, checks } from '../lib/harness.mjs'
import { pageFiles, TEXT } from '../../relay/build.js'

const { ok, done } = checks('relay-pagecheck')
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const files = pageFiles()
const listen = (srv) => new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)))

// The computer's address on the relay: the page's files, its health, and what it was asked.
let served = {} // name -> text, in place of the real one
let says = VERSION // the version /_relay/health says
let down = false
const asked = []
const relaySrv = http.createServer((req, res) => {
  let n = 0
  req.on('data', (c) => { n += c.length })
  req.on('end', () => {
    asked.push({ m: req.method, host: req.headers.host, u: req.url, body: n })
    if (down) { res.writeHead(503); return res.end() }
    if (req.url === '/_relay/health') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ok: true, build: 'abc', ...(says === undefined ? {} : { version: says }) })) }
    const name = req.url === '/' ? 'index.html' : req.url.slice(1)
    const text = served[name] ?? files[name]?.text
    if (text == null) { res.writeHead(404); return res.end() }
    res.end(text)
  })
})
// GitHub, at a release's tag: /v<version>/relay/web/<file>.
const releases = {}
const fromGitHub = []
const githubSrv = http.createServer((req, res) => {
  fromGitHub.push(req.url)
  const m = /^\/v([^/]+)\/relay\/web\/([\w.-]+)$/.exec(req.url)
  const text = m && releases[m[1]]?.[m[2]]
  if (text == null) { res.writeHead(404); return res.end() }
  res.end(text)
})

const home = path.join(OUT, 'kits', `relay-pagecheck-${process.pid}`)
try {
  const relayPort = await listen(relaySrv)
  const githubPort = await listen(githubSrv)
  // This computer, on Bridge AI's relay at <id>.localhost (as when it's tried on a computer).
  fs.rmSync(home, { recursive: true, force: true })
  fs.mkdirSync(home, { recursive: true })
  const id = 'abcdefgh2345'
  fs.writeFileSync(path.join(home, 'relay.json'), JSON.stringify({ url: `http://${id}.localhost:${relayPort}`, token: 'test', hosted: { id, at: new Date().toISOString() } }))
  Object.assign(process.env, { BRIDGE_HOME: home, BRIDGE_RELAY_SOURCE: `http://127.0.0.1:${githubPort}`, BRIDGE_HOSTED_URL: '', BRIDGE_ACCOUNTS_URL: '', BRIDGE_COUNTS_URL: '', BRIDGE_CRASHES_URL: '' })
  const pc = await import('../../server/relaycheck.js')
  const run = () => pc.check()
  const page = ['index.html', 'shell.js', 'sw.js', 'link.js', 'offline.js', 'manifest.webmanifest', 'link-sw.js']

  // ---------- This computer's version ----------
  let c = await run()
  ok(c.on && c.ok && c.version === VERSION && !c.why && !c.differs.length && !c.error, 'the relay says this computer\'s version and serves its page: fine', c)
  ok(!fromGitHub.length, 'compared with this computer\'s own copy: GitHub isn\'t asked', fromGitHub)
  ok(asked.every((a) => a.m === 'GET' && a.body === 0 && a.host === `${id}.localhost:${relayPort}`) && JSON.stringify([...new Set(asked.map((a) => a.u))].sort()) === JSON.stringify(['/', '/_relay/health', ...page.filter((n) => n !== 'index.html').map((n) => `/${n}`)].sort()), 'nothing sent but GETs with no body, to the page\'s own files and /_relay/health at this computer\'s address', asked)
  ok(JSON.stringify(pc.PAGE.slice().sort()) === JSON.stringify(page.slice().sort()), 'every file the page runs is checked (the icons are pictures)', pc.PAGE)
  for (const name of ['shell.js', 'sw.js', 'link-sw.js']) {
    served = { [name]: `${files[name].text}\n// changed for everyone\n` }
    c = await run()
    ok(!c.ok && c.why === 'differs' && JSON.stringify(c.differs) === JSON.stringify([name]) && c.version === VERSION, `${name} changed: said, by name`, c)
  }
  served = {}

  // ---------- Another version: the release's, from GitHub ----------
  says = '99.0.0'
  releases['99.0.0'] = Object.fromEntries(TEXT.map((n) => [n, n === 'shell.js' ? `${files[n].text}\n// 99.0.0's own\n` : files[n].text]))
  served = { 'shell.js': releases['99.0.0']['shell.js'] }
  fromGitHub.length = 0
  c = await run()
  ok(c.ok && c.version === '99.0.0' && c.own === VERSION && !c.why, 'a newer release: its files are compared with that release\'s, and match', c)
  ok(fromGitHub.length === TEXT.length && fromGitHub.every((u) => u.startsWith('/v99.0.0/relay/web/')), 'from GitHub at its tag, its source files (link-sw.js made from its link.js as the relay makes it)', fromGitHub)
  await run()
  ok(fromGitHub.length === TEXT.length, 'and kept: a release\'s files never change, so GitHub isn\'t asked again', fromGitHub.length)
  served = { 'shell.js': releases['99.0.0']['shell.js'], 'index.html': `${files['index.html'].text}<script src="https://example.com/x.js"></script>` }
  c = await run()
  ok(!c.ok && c.why === 'differs' && JSON.stringify(c.differs) === JSON.stringify(['index.html']) && c.version === '99.0.0', 'and a file that isn\'t that release\'s is said', c)
  says = '99.1.0'
  served = {}
  c = await run()
  ok(!c.ok && c.why === 'unreleased' && c.version === '99.1.0', 'a version with no release on GitHub: said as not a release', c)
  const before = fromGitHub.length
  says = '../../evil'
  c = await run()
  ok(!c.ok && c.why === 'unreleased' && fromGitHub.length === before, 'and one that isn\'t a version at all: the same, and GitHub isn\'t asked for it', { c, asked: fromGitHub.slice(before) })
  says = undefined
  c = await run()
  ok(c.ok && c.version === VERSION, 'a relay from before it said its version: compared with this computer\'s own', c)
  says = VERSION

  // ---------- The relay not answering ----------
  served = { 'shell.js': 'changed' }
  await run()
  down = true
  c = await run()
  ok(c.why === 'differs' && !!c.error, 'the relay not answering: said as not checked, and what the last check found isn\'t dropped', c)
  down = false
  served = {}
  c = await run()
  ok(c.ok && !c.error && !c.why, 'answering again, unchanged: fine again', c)
  down = true
  c = await run()
  ok(!c.why && c.version === VERSION && !!c.error && /answered 503/.test(c.error), 'and not answering after a good check: said, the last good check kept', c)
  down = false

  // ---------- When it checks ----------
  const n = asked.length
  const a = pc.ask()
  ok(a.on && !a.checking && asked.length === n, 'Settings › Devices opening right after a check: the last check, nothing asked again', { a, asked: asked.length - n })
  const now = pc.ask({ now: true })
  ok(now.checking, 'Check again: at once', now)
  await pc.check()
  ok(asked.length > n && pc.state().ok, 'and done', pc.state())
} catch (e) {
  ok(false, `the test ran to the end: ${e.stack}`)
} finally {
  relaySrv.close()
  githubSrv.close()
  fs.rmSync(home, { recursive: true, force: true })
}
process.exit(done().fail ? 1 : 0)
