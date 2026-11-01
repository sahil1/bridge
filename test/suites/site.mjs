// The download page (site/index.html, which pages.yml publishes), served as files, with GitHub's
// answer about the latest release stood in for and nothing else reaching the internet. The Android
// app: its button links Bridge-AI-android.apk from the latest release, with the three steps to
// install it, that it isn't on Google Play yet, that a newer APK installs over it, and where its
// SHA-256 is; shown only once the latest release has the APK, so never a link to a file that isn't
// there (a release from before it, or GitHub not answering). On an Android phone the main button
// downloads it. At phone width nothing scrolls sideways, and the box is dark in dark mode. The file
// name is the one the build makes (android.yml) and the README links.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, checks, until, browser, shot, freePort } from '../lib/harness.mjs'

const { ok, done } = checks('site')
const SITE = path.join(ROOT, 'site')
const APK = 'https://github.com/sahil1/bridge/releases/latest/download/Bridge-AI-android.apk'
const SUMS = 'https://github.com/sahil1/bridge/releases/latest/download/SHA256SUMS.txt'
const API = 'https://api.github.com/repos/sahil1/bridge/releases/latest'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const TYPES = { '.html': 'text/html', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' }
const desktop = ['Bridge-AI-mac-arm64.dmg', 'Bridge-AI-mac-x64.dmg', 'Bridge-AI-win-x64.exe', 'Bridge-AI-linux-x86_64.AppImage', 'Bridge-AI-linux-amd64.deb', 'SHA256SUMS.txt']
const asset = (name) => ({ name, browser_download_url: `https://github.com/sahil1/bridge/releases/download/v0/${name}` })
const RELEASES = {
  withApk: { status: 200, body: { tag_name: 'v3.9.0', assets: [...desktop, 'Bridge-AI-android.apk'].map(asset) } },
  withoutApk: { status: 200, body: { tag_name: 'v3.8.1', assets: desktop.map(asset) } },
  limited: { status: 403, body: { message: 'API rate limit exceeded' } },
}

const port = await freePort()
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  // pages.yml copies the mark in from public/; the video isn't needed here.
  const f = p === '/mark.svg' ? path.join(ROOT, 'public', 'mark.svg') : path.join(SITE, p === '/' ? 'index.html' : p)
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory() || f.endsWith('.mp4')) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
}).listen(port, '127.0.0.1')
const local = `http://127.0.0.1:${port}/`

const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
// The page with GitHub answering as given; phone: an Android phone's screen and browser.
async function open(release, { phone = false, mode = 'light' } = {}) {
  const ctx = await b.newContext({ colorScheme: mode, ...(phone ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, userAgent: ANDROID_UA } : { viewport: { width: 1280, height: 900 } }) })
  const asked = []
  await ctx.route('**/*', (r) => {
    const u = r.request().url()
    if (u.startsWith(local)) return r.continue()
    if (u === API) { asked.push(u); const { status, body } = RELEASES[release]; return r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }) }
    return r.abort()
  })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(local)
  // GitHub has answered (the version shows), or, when it said no, had its chance.
  if (RELEASES[release].status === 200) await until(async () => /^version /.test(await p.innerText('#ver')), 5000, 100)
  else { await until(() => asked.length > 0, 5000, 100); await p.waitForTimeout(500) }
  return { ctx, p, errors, asked }
}
const shown = (p, sel) => p.locator(sel).isVisible()
const attr = (p, sel, name) => p.getAttribute(sel, name, { timeout: 2000 }).catch(() => null)
const text = (p, sel) => p.innerText(sel, { timeout: 2000 }).catch(() => '')
const there = async (p, sel) => (await p.locator(sel).count()) === 1
// Every link on the page to the APK that can be seen and clicked.
const apkLinks = (p) => p.$$eval('a', (as) => as.filter((a) => /Bridge-AI-android\.apk/.test(a.href) && a.getClientRects().length > 0).map((a) => a.id || a.textContent.trim()))
// Page errors, and GitHub asked other than once, are reported when they happen.
const clean = (errors, asked, where) => {
  if (errors.length) ok(false, `no page errors ${where}`, errors)
  if (asked.length !== 1) ok(false, `GitHub is asked about the latest release once ${where}`, asked)
}

try {
  // ---------- The latest release has the APK ----------
  {
    const { ctx, p, errors, asked } = await open('withApk')
    ok(await shown(p, '#android') && !/android\.apk/.test(await attr(p, '#dl', 'href')), 'with the APK in the latest release, the Android app shows under Install (on a computer the main button stays the computer\'s download)', await attr(p, '#dl', 'href'))
    ok(await attr(p, '#apk', 'href') === APK && /Download for Android/.test(await text(p, '#apk')), 'its button downloads Bridge-AI-android.apk from the latest release', await attr(p, '#apk', 'href'))
    const steps = await p.$$eval('#android ol li', (l) => l.map((x) => x.innerText))
    ok(steps.length === 3 && /browser or Files/.test(steps[0]) && /Allow from this source/.test(steps[0]) && /Open .*Bridge-AI-android\.apk.* Install/.test(steps[1]) && /QR code from your computer/.test(steps[2]) && /Settings › Devices › Pair a device/.test(steps[2]), 'three steps: allow installs from the browser or Files, open the APK, pair with the QR code from the computer', steps)
    const note = await text(p, '#android .note')
    ok(/isn't on Google Play yet/.test(note) && /install a newer APK over it/.test(note), 'it says it isn\'t on Google Play yet, and that a newer APK installs over it', note)
    ok(/SHA-256/.test(note) && await attr(p, '#android .note a[href*="SHA256SUMS"]', 'href') === SUMS, 'and where its SHA-256 is: the latest release\'s SHA256SUMS.txt', note)
    clean(errors, asked, 'on a computer')
    if (await there(p, '#android')) { await p.locator('#android').scrollIntoViewIfNeeded(); await shot(p, `${tag}site-android`) }
    await ctx.close()
  }
  {
    const { ctx, p, errors, asked } = await open('withApk', { phone: true })
    ok(await text(p, '#dl') === 'Download for Android' && await attr(p, '#dl', 'href') === APK, 'on an Android phone the main button downloads the APK', { text: await text(p, '#dl'), href: await attr(p, '#dl', 'href') })
    ok(/The phone app/.test(await text(p, '#dl-lead')), 'and says it\'s the phone app, for Bridge AI on the computer', await text(p, '#dl-lead'))
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    ok(await shown(p, '#android') && wide <= 0, 'with the steps under Install, and nothing scrolling sideways at phone width', wide)
    clean(errors, asked, 'on the phone')
    if (await there(p, '#android')) { await p.locator('#android').scrollIntoViewIfNeeded(); await shot(p, `${tag}site-android-phone`) }
    await ctx.close()
  }
  {
    const { ctx, p } = await open('withApk', { mode: 'dark' })
    const bg = await p.$eval('#android', (e) => getComputedStyle(e).backgroundColor).catch(() => '')
    const [r, g, bl] = (bg.match(/\d+/g) || []).map(Number)
    ok(!!bg && r + g + bl < 150, 'in dark mode its box is dark, like the page\'s others', bg)
    await ctx.close()
  }

  // ---------- Not yet (a release from before it), or GitHub not answering ----------
  for (const [release, what] of [['withoutApk', 'with no APK in the latest release'], ['limited', 'when GitHub doesn\'t answer']]) {
    const { ctx, p, errors, asked } = await open(release)
    ok(await there(p, '#android') && !(await shown(p, '#android')) && (await apkLinks(p)).length === 0, `${what}, the Android box stays hidden and nothing links to the APK`, await apkLinks(p))
    clean(errors, asked, what)
    await ctx.close()
    const ph = await open(release, { phone: true })
    ok(await there(ph.p, '#apk') && await text(ph.p, '#dl') === 'Get it for your computer' && (await attr(ph.p, '#dl', 'href')) === '#install' && (await apkLinks(ph.p)).length === 0, `${what}, an Android phone's main button leads to the computer's install, as before`, { text: await text(ph.p, '#dl'), links: await apkLinks(ph.p) })
    await ph.ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
}

// ---------- One name everywhere ----------
// Line ends as written, whatever git checked out (CRLF on Windows).
const read = (...p) => { try { return fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
const page = read('site', 'index.html')
const android = read('.github', 'workflows', 'android.yml')
const readme = read('README.md')
const install = readme.split('\n## Install\n')[1]?.split('\n## ')[0] || ''
ok(page.includes(`href="${APK}"`) && /--out Bridge-AI-android\.apk/.test(android) && /name: bridge-ai-android\n\s+path: Bridge-AI-android\.apk/.test(android), 'the page links the file the build makes and publishes (android.yml)')
const section = install.split('\n### Android\n')[1]?.split('\n### ')[0] || ''
ok(section.includes(`(${APK})`) && /Allow from this source/.test(section) && /Pair a device/.test(section) && /isn't on Google Play yet/.test(section) && /newer APK over it/.test(section) && /SHA256SUMS\.txt/.test(section), 'and so does the README\'s Install section, with the same steps and notes', section.slice(0, 300))

await b.close()
srv.close()
process.exit(done().fail ? 1 : 0)
