// The old website address, https://sahil1.github.io/bridge/ (site/, which pages.yml publishes):
// Bridge AI's website moved to https://boldbridge.ai, and every old link goes there. Served as
// GitHub Pages serves it (under /bridge/, 404.html for any other path), with boldbridge.ai stood
// in for and nothing else reaching the internet: the home page, with what's after the # kept (the
// app's old link to #android), the demo, any other old path to the same path there, and, with
// scripts off, a refresh (each of the three pages) and a plain link. The README sends people to
// boldbridge.ai, keeps the README's poster, and its Install section links the APK the build makes
// (android.yml), with the same steps as the website.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, checks, until, browser, freePort } from '../lib/harness.mjs'

const { ok, done } = checks('site')
const SITE = path.join(ROOT, 'site')
const APK = 'https://github.com/sahil1/bridge/releases/latest/download/Bridge-AI-android.apk'
const NEW = 'https://boldbridge.ai/'
const TYPES = { '.html': 'text/html', '.jpg': 'image/jpeg' }

// GitHub Pages, for a project site: the repo's site/ under /bridge/, and 404.html (with a 404) for
// anything that isn't there.
const port = await freePort()
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let f = p.startsWith('/bridge/') ? path.join(SITE, p.slice('/bridge/'.length)) : null
  if (f && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html')
  if (!f || !f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404, { 'content-type': 'text/html' }); fs.createReadStream(path.join(SITE, '404.html')).pipe(res); return }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
}).listen(port, '127.0.0.1')
const old = `http://127.0.0.1:${port}/bridge/`

const { b } = await browser()
// Where an old link ends up, with boldbridge.ai answering with a page of its own.
async function lands(url, { scripts = true } = {}) {
  const ctx = await b.newContext({ javaScriptEnabled: scripts })
  const reached = []
  await ctx.route('**/*', (r) => {
    const u = r.request().url()
    if (u.startsWith(`http://127.0.0.1:${port}/`)) return r.continue()
    if (u.startsWith(NEW)) { reached.push(u); return r.fulfill({ status: 200, contentType: 'text/html', body: '<title>boldbridge.ai</title>' }) }
    return r.abort()
  })
  const p = await ctx.newPage()
  await p.goto(url).catch(() => {})
  await until(async () => { try { return (await p.title()) === 'boldbridge.ai' } catch { return false } }, 5000, 100)
  const at = p.url()
  await ctx.close()
  return { at, reached }
}

try {
  for (const [from, to, what] of [
    ['', NEW, 'the old home page goes to boldbridge.ai'],
    ['#android', `${NEW}#android`, 'with what\'s after the # kept: the app\'s old link to #android lands on the Android section'],
    ['demo/', `${NEW}demo/`, 'the old demo goes to boldbridge.ai/demo/'],
    ['demo/#/agents', `${NEW}demo/#/agents`, 'a link into the demo keeps its place'],
    ['privacy?ref=x#top', `${NEW}privacy?ref=x#top`, 'any other old address goes to the same path on boldbridge.ai (GitHub Pages\' 404 page)'],
  ]) {
    const { at } = await lands(old + from)
    ok(at === to, what, { from: old + from, at })
  }
  // The refresh is in <noscript>, so it can't go before the script and drop what it keeps.
  for (const [from, to, what] of [['', NEW, 'the page'], ['demo/', `${NEW}demo/`, 'the demo'], ['privacy', NEW, 'GitHub Pages\' 404 page']]) {
    const off = await lands(old + from, { scripts: false })
    ok(off.at === to, `with scripts off, ${what} refreshes to boldbridge.ai`, off)
  }
  for (const f of ['index.html', 'demo/index.html', '404.html']) {
    const html = fs.readFileSync(path.join(SITE, f), 'utf8')
    ok(/<a href="https:\/\/boldbridge\.ai\/(demo\/)?">/.test(html) && /noindex/.test(html) && (f === '404.html' || /<link rel="canonical" href="https:\/\/boldbridge\.ai\//.test(html)), `${f}: a plain link to boldbridge.ai, and search engines told where the page is now`)
  }
  ok(!fs.existsSync(path.join(SITE, 'bridge-ai.mp4')) && fs.existsSync(path.join(SITE, 'poster.jpg')), 'the video moved with the website; the README\'s poster stays')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
}

// ---------- The README ----------
// Line ends as written, whatever git checked out (CRLF on Windows).
const read = (...p) => { try { return fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
const android = read('.github', 'workflows', 'android.yml')
const readme = read('README.md')
const top = readme.split('\n## ')[0]
ok(top.includes('](https://boldbridge.ai/)') && top.includes('(https://boldbridge.ai/demo/)') && top.includes('(site/poster.jpg)') && !/github\.io/.test(top), 'the README sends Download and Try the demo to boldbridge.ai, with its poster', top.slice(-500))
const install = readme.split('\n## Install\n')[1]?.split('\n## ')[0] || ''
const section = install.split('\n### Android\n')[1]?.split('\n### ')[0] || ''
ok(/--out Bridge-AI-android\.apk/.test(android) && /name: bridge-ai-android\n\s+path: Bridge-AI-android\.apk/.test(android) && section.includes(`(${APK})`), 'its Install section links the APK the build makes and publishes (android.yml)')
ok(/Allow from this source/.test(section) && /Pair a device/.test(section) && /isn't on Google Play yet/.test(section) && /newer APK over it/.test(section) && /SHA256SUMS\.txt/.test(section), 'with the same steps and notes as the website', section.slice(0, 300))

await b.close()
srv.close()
process.exit(done().fail ? 1 : 0)
