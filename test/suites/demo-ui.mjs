// The demo build (dist-demo: npm run demo:build), served as files with no server behind it, the way
// Try the demo and the website show it: Home, Meetings with its made-up meetings, search, folders and
// the archive (kept in the tab), what needs a computer saying so instead of failing, and the
// needs-you inbox with the made-up agent that waits on you, answered from its own card.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, checks, until, browser, page, shot, freePort } from '../lib/harness.mjs'

const { ok, done } = checks('demo-ui')
const DIR = path.join(ROOT, 'dist-demo')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
if (!fs.existsSync(path.join(DIR, 'index.html'))) { ok(false, 'dist-demo is built (npm run demo:build)'); process.exit(done().fail ? 1 : 0) }
const port = await freePort()
const srv = http.createServer((req, res) => {
  let f = path.join(DIR, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIR, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
}).listen(port, '127.0.0.1')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  const { ctx, p, errors } = await page(b, `http://127.0.0.1:${port}/?clean=1&m=studio`, { mic: false })
  await p.waitForTimeout(2500)
  await p.click('[data-tour="new-agent"]')
  ok(!!(await until(async () => /What should we build in acme-shop\?/.test(await p.innerText('.home-title')), 5000)), 'Home asks about a made-up project')
  await p.click('.rail-nav-btn:has-text("Meetings")')
  await p.waitForSelector('.mt-row', { timeout: 6000 }).catch(() => {})
  ok((await p.$$eval('.mt-row b', (l) => l.map((x) => x.innerText))).join('|') === 'Checkout launch sync|1:1 with Dana', 'Meetings lists the two made-up meetings')
  await p.fill('.mt-search', 'redirect')
  ok(!!(await until(async () => (await p.locator('.mt-row').count()) === 1, 4000)), 'search finds the line that was said')
  await p.fill('.mt-search', '')
  // Folders and the archive work in the demo, in this tab.
  await p.locator('.mt-row-open', { hasText: '1:1 with Dana' }).click({ button: 'right' })
  await p.locator('.ctx-menu button', { hasText: 'Archive' }).click()
  ok(!!(await until(async () => (await p.locator('.mt-places button', { hasText: 'Archived' }).count()) === 1 && (await p.locator('.mt-row').count()) === 1, 5000)), 'archiving one puts it under Archived')
  await p.click('button:has-text("Start recording")')
  ok(!!(await until(async () => /needs Bridge AI on your computer/.test(await p.innerText('.mt-home .error-text')), 4000)), 'Start recording says it needs the computer')
  await p.locator('.rail-nav-row .rail-rec').click()
  ok(!!(await until(async () => /needs Bridge AI on your computer/.test(await p.innerText('.rail-rec-err')), 4000)), 'so does the record button in the sidebar')
  await p.click('.mt-row:has-text("Checkout launch sync")')
  ok(!!(await until(async () => /Ship the new checkout on Thursday/.test(await p.innerText('.mt-summary')), 5000)), 'a meeting shows its summary')
  await shot(p, `${tag}demo-meeting`)
  // The needs-you inbox: the agent waiting on you, on the Studio Mac, with its question's own card.
  await p.locator('.top-right .needs-chip').click()
  const ask = p.locator('.ny-panel .ny-item.t-question')
  await ask.first().waitFor({ timeout: 5000 }).catch(() => {})
  ok(await ask.count() === 1 && /Studio Mac/.test(await ask.innerText()), 'the needs-you inbox lists the agent waiting on you, on the Studio Mac', await p.locator('.ny-panel').innerText().catch(() => ''))
  await ask.locator('button', { hasText: 'Answer here…' }).click()
  ok(!!(await until(async () => (await ask.locator('.qcard .q-opt').count()) > 1, 6000)), 'Answer here… shows its question with the choices it has')
  await shot(p, `${tag}demo-needs-you`)
  await p.keyboard.press('Escape')
  ok(errors.length === 0, 'no page errors', errors)
  await ctx.close()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await b.close()
  srv.close()
}
process.exit(done().fail ? 1 : 0)
