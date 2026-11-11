// A brand-new computer, in the browser named by BRIDGE_TEST_BROWSER, on a desktop and a phone:
// setup's first step (how much to set up: Just what agents need, picked, as it asks for no password
// and nothing to allow, Everything, or Later; Later here, setup-all tries Everything; and keeping the
// computer awake for your phone, ticked), then setup with nothing installed (each agent can be installed from there, or an API key used), an
// agent's install (the kit's stand-in installer runs, never the real one) moving its card on to
// signing in, Node.js installed with one click from a stand-in nodejs.org, on Windows too (and a
// download that doesn't match its checksum turned away), the recommended Just what agents need
// itself (on a Mac without Apple's developer tools, simulated: still no password, no terminal,
// nothing to allow, never the developer tools; Node.js's progress on the Install of an agent that
// waits for it, and in the top bar once setup is closed, until it's in), closing setup, Home with
// nothing to talk to, New agent, a chat with any model once a key is in, and a key the provider
// turns down.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { startKit, startModel, checks, until, browser, page, shot, IS_WIN, IS_MAC, TEST, devToolsStandIn } from '../lib/harness.mjs'
import { signInScreen, firstRun, SIGN_IN_ENDED } from '../../server/firstrun.js'

const { ok, skip, done } = checks('new-install')

// Signing in as Claude Code and Codex do (stand-ins/claude.cjs, stand-ins/codex.cjs), signed out,
// with the stand-in open first on the PATH (bin/opened.log): no real browser opens. Their sign-in
// pages are never reached from the test's browser either (noSignInPages).
const logOf = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean) } catch { return [] } }
const openedBy = (k) => logOf(k.bin, 'opened.log')
const signedOut = (k) => {
  fs.mkdirSync(path.join(k.home, '.claude'), { recursive: true })
  fs.writeFileSync(path.join(k.home, '.claude', 'stand-in-signed-out'), '')
  fs.rmSync(path.join(k.home, '.claude', '.credentials.json'), { force: true })
}
const standInSignIns = (k) => { k.program('open', fs.readFileSync(path.join(TEST, 'stand-ins', 'open.cjs'), 'utf8')); fs.writeFileSync(path.join(k.home, 'claude-login.json'), '{}'); signedOut(k) }
const noSignInPages = (c) => c.route(/^https:\/\/(claude\.com|claude\.ai|platform\.claude\.com|auth\.openai\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>A sign-in page (a test)</title>' }))
const signInTabs = async (k) => ((await k.api('/fleet')).tabs || []).filter((x) => /^Sign in: /.test(x.label))
// What a sign-in's tab shows last (when it didn't close as it should have).
// eslint-disable-next-line no-control-regex
const tabsSay = async (k) => Promise.all((await signInTabs(k)).map(async (x) => (await k.api(`/agents/${encodeURIComponent(x.panes?.[0]?.paneId)}/screen?lines=12`).catch(() => ({}))).ansi?.replace(/\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/).filter((l) => l.trim()).slice(-6)))

// A stand-in nodejs.org: one long-term-support release, built for this computer, as nodejs.org
// packs it: a .tar.gz with bin/node on macOS and Linux, whose "node" only says its version; a .zip
// with node.exe at its top on Windows, a copy of the Node.js running this test (so that's the
// version). bad: the checksum it publishes is wrong. slow: the download takes about sixteen seconds.
const NODE_V = IS_WIN ? process.version : 'v22.99.0'
const dist = { bad: false, slow: false }
const OSN = { darwin: 'darwin', linux: 'linux', win32: 'win' }[process.platform]
const tarName = `node-${NODE_V}-${OSN}-${process.arch}.${IS_WIN ? 'zip' : 'tar.gz'}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-node-'))
const top = path.join(tmp, `node-${NODE_V}-${OSN}-${process.arch}`)
if (IS_WIN) {
  fs.mkdirSync(top, { recursive: true })
  fs.copyFileSync(process.execPath, path.join(top, 'node.exe'))
  for (const n of ['npm', 'npx']) fs.writeFileSync(path.join(top, `${n}.cmd`), '@echo 10.0.0\r\n')
  execFileSync('tar', ['-a', '-cf', path.join(tmp, tarName), '-C', tmp, path.basename(top)])
} else {
  fs.mkdirSync(path.join(top, 'bin'), { recursive: true })
  for (const [n, say] of [['node', NODE_V], ['npm', '10.0.0'], ['npx', '10.0.0']]) fs.writeFileSync(path.join(top, 'bin', n), `#!/bin/sh\necho ${say}\n`, { mode: 0o755 })
  // Its npm's global folder is ~/npm-global, which (below) only an administrator could write to, as
  // with Node.js from nodejs.org's Mac installer.
  fs.writeFileSync(path.join(top, 'bin', 'npm'), '#!/bin/sh\nif [ "$1" = prefix ]; then echo "$HOME/npm-global"; else echo 10.0.0; fi\n', { mode: 0o755 })
  execFileSync('tar', ['-czf', path.join(tmp, tarName), '-C', tmp, path.basename(top)])
}
const tarball = fs.readFileSync(path.join(tmp, tarName))
fs.rmSync(tmp, { recursive: true, force: true })
const nodeOrg = http.createServer((req, res) => {
  const send = (type, body) => { res.writeHead(200, { 'content-type': type, 'content-length': Buffer.byteLength(body) }); res.end(body) }
  if (req.url === '/index.json') return send('application/json', JSON.stringify([{ version: NODE_V, lts: 'Test', files: ['osx-arm64-tar', 'osx-x64-tar', 'linux-x64', 'linux-arm64', 'win-x64-zip', 'win-arm64-zip'] }]))
  if (req.url === `/${NODE_V}/SHASUMS256.txt`) return send('text/plain', `${dist.bad ? '0'.repeat(64) : crypto.createHash('sha256').update(tarball).digest('hex')}  ${tarName}\n`)
  if (req.url === `/${NODE_V}/${tarName}` && dist.slow) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': tarball.length })
    const step = Math.ceil(tarball.length / 40)
    let at = 0
    const more = () => { res.write(tarball.subarray(at, at + step)); at += step; if (at < tarball.length) setTimeout(more, 400); else res.end() }
    return more()
  }
  if (req.url === `/${NODE_V}/${tarName}`) return send('application/octet-stream', tarball)
  res.writeHead(404).end()
}).listen(0, '127.0.0.1')
await new Promise((r) => nodeOrg.once('listening', r))

// On Windows, without BRIDGE_PATH, so where it looks for programs is the app's own way there: the
// kit's PATH (its stand-ins and Windows' own folders), plus Node.js once it's installed.
const kit = await startKit('new-install', { env: { BRIDGE_NODE_DIST: `http://127.0.0.1:${nodeOrg.address().port}`, ...(IS_WIN ? { BRIDGE_PATH: '' } : {}) } })
const model = await startModel('new-install')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const LOOKS = [['bridge', { mode: 'light', theme: 'bridge' }], ['sky', { mode: 'light', theme: 'sky' }], ['midnight', { mode: 'dark', theme: 'midnight' }]]
const sideways = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
const open = async (look, o = {}) => { const x = await page(b, kit.url, { ...look, ...o }); x.p.on('dialog', (d) => d.accept()); return x }
// Setup's first step: Later (setup-all tries the others).
const later = async (p) => { await p.waitForSelector('.wiz-levels', { timeout: 15000 }); await p.check('input[name="wiz-level"][value="later"]'); await p.click('.wiz-foot button:has-text("Continue")') }
const rowsOf = (p) => p.$$eval('.wiz-agents li', (l) => l.map((li) => ({ name: li.querySelector('b')?.innerText, note: li.querySelector('small')?.innerText, btn: li.querySelector('.signin')?.innerText.replace(/\s+/g, ' ').trim() })))

try {
  // ---------- Claude Code 2.1.311's and Codex's own sign-in screens, as the app reads them ----------
  {
    // claude auth login, in a terminal 60 columns wide: the link it prints wraps, inside a link of the terminal's own.
    const link = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=s'
    const rows = (s) => s.match(/.{1,60}/g).join('\r\n')
    const login = `Last login: Mon Nov 10 on ttys001\r\n$ claude auth login; echo '${SIGN_IN_ENDED}'\r\nOpening browser to sign in…\r\n${rows(`If the browser didn't open, visit: \x1b]8;;${link}\x07\x1b[94m${link}\x1b[39m\x1b]8;;\x07`.replace(/\x1b\][^\x07]*\x07|\x1b\[\d+m/g, ''))}\r\nPaste code here if prompted > \r\n\r\n`
    const waits = signInScreen('claude', login)
    ok(waits.codeUrl === link && waits.asksCode && !waits.ended, 'Claude Code\'s sign-in: the link it prints (to the page that shows a code) is read whole, and that it waits for a code', waits)
    const failed = signInScreen('claude', `${login}abc\r\nLogin failed: that code isn't valid.\r\n${SIGN_IN_ENDED}\r\n$ `)
    ok(failed.ended && !failed.success && failed.problem === 'Login failed: that code isn\'t valid.', 'and that it ended without signing in, in its own words', failed)
    ok(signInScreen('claude', `${login}\r\nLogin successful.\r\n${SIGN_IN_ENDED}\r\n$ `).success, 'or that it signed in')
    const device = signInScreen('codex', `$ codex login --device-auth; echo '${SIGN_IN_ENDED}'\r\n\r\n1. Open this link in your browser and sign in to your account\r\n   https://auth.openai.com/codex/device\r\n\r\n2. Enter this one-time code (expires in 15 minutes)\r\n   ABCD-12345\r\n`)
    ok(device.device?.url === 'https://auth.openai.com/codex/device' && device.device.code === 'ABCD-12345', 'Codex with a one-time code: its page and the code', device)
    const tui = firstRun('claude', ['', " Browser didn't open? Use the url below to sign in (c to copy)", '', link.slice(0, 120), link.slice(120), '', ' Paste code here if prompted > '])
    ok(tui?.step === 'browser' && tui.url === link, 'a new Claude Code\'s sign-in screen: its link at claude.com, where 2.1.311 signs in, is offered', tui)
  }

  // ---------- First run, nothing installed ----------
  for (const phone of [false, true]) for (const [name, look] of LOOKS) {
    const t = `${phone ? 'phone' : 'desktop'} ${name}`
    const { ctx, p, errors } = await open(look, { phone })
    await p.waitForSelector('.wiz-levels', { timeout: 15000 })
    const levels = await p.$$eval('.wiz-levels li', (l) => l.map((li) => `${li.querySelector('input').checked ? '*' : ''}${li.querySelector('b').innerText}`))
    ok(levels.join('|') === '*Just what agents need (recommended)|Everything|Later', `${t}: setup starts with how much to set up, the one with no password or permissions picked`, levels)
    ok(/^Set up Node\.js$/.test((await p.innerText('.wiz-foot .btn.primary')).trim()), `${t}: and says what Continue does`)
    // Off a Mac, Everything installs nothing that asks (no Homebrew), so it doesn't say it will.
    ok(/No password, nothing to allow/.test(await p.innerText('.wiz-levels li.on')) && (!IS_MAC || /Asks for your password once/.test(await p.innerText('.wiz-levels li:not(.on)'))), `${t}: each says whether it asks for anything`)
    ok(await p.isChecked('.wiz-awake input'), `${t}: keeping this computer awake for your phone is offered, ticked`)
    ok(!(await sideways(p)), `${t}: the first step: nothing wider than the screen`)
    await shot(p, `${tag}new-${phone ? 'phone' : 'desktop'}-${name}-0-how-much`)
    await later(p)
    await p.waitForSelector('.wiz-agents li', { timeout: 15000 })
    ok(!(await p.$('.wiz-strip')), `${t}: Later sets nothing going`)
    const rows = await rowsOf(p)
    ok(rows.map((r) => r.name).join('|') === 'Claude Code|Codex|Gemini CLI|GitHub Copilot CLI|Cursor Agent' && /Pro, Max or Team/.test(rows[0].note) && /ChatGPT Plus/.test(rows[1].note), `${t}: setup offers the plans you might pay for, Claude Code and Codex first`, rows)
    ok(rows.every((r) => /^(Install|Get Node\.js)/.test(r.btn || '')), `${t}: each can be installed from here (Node.js first where it's needed)`, rows.map((r) => r.btn))
    ok(/An API key works too/.test(await p.innerText('.wiz-body')) && !!(await p.$('.wiz-key input[aria-label="API key"]')) && !(await p.$('select[aria-label="Chief of Staff"]')), `${t}: or an API key, and no chief to pick yet`)
    ok(!(await sideways(p)), `${t}: nothing wider than the screen`)
    await shot(p, `${tag}new-${phone ? 'phone' : 'desktop'}-${name}-1-setup`)
    await p.click('.wiz-foot button:has-text("Continue")')
    await p.waitForSelector('.wiz-scan:not(:has(.aa-spin))', { timeout: 15000 })
    ok(/No projects yet/.test(await p.innerText('.wiz-body')) && /^Start$/.test((await p.innerText('.wiz-foot .btn.primary')).trim()), `${t}: no projects yet says so, and Start`)
    ok(errors.length === 0, `${t}: no page errors`, errors)
    await ctx.close()
  }

  // ---------- Installing an agent: the server runs its installer in a tab (the kit's stand-in
  // installer, never the real one), the card shows how it's going, then signs in by itself. The
  // Claude Code it leaves signs in as Claude Code 2.1.311 does (stand-ins/claude.cjs): it opens the
  // browser (the stand-in open, into bin/opened.log) to come back to it on localhost, and prints a
  // link to a page that shows a code to paste instead. On the desktop the browser can't come back
  // (a code it is); on the phone it does ----------
  // Its sign-in's tab closed first, so nothing is running it, and tried again a moment later while
  // Windows still holds it (it can't delete a .cmd file cmd.exe has open).
  const uninstall = async (n) => {
    for (const x of await signInTabs(kit)) await kit.api(`/tabs/${x.tabId}/close`, {}).catch(() => {})
    for (const f of [n, `${n}.cjs`, `${n}.cmd`]) fs.rmSync(path.join(kit.bin, f), { force: true, maxRetries: 10, retryDelay: 200 })
    await kit.api('/agents/catalog')
  }
  standInSignIns(kit)
  fs.writeFileSync(path.join(kit.bin, 'claude.standin.cjs'), fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  for (const phone of [false, true]) {
    const t = phone ? 'phone' : 'desktop'
    const { ctx, p, errors } = await open(LOOKS[1][1], { phone, before: noSignInPages })
    await later(p)
    await p.waitForSelector('.wiz-agents li')
    const card = p.locator('.wiz-agents li').first()
    const was = openedBy(kit).length
    await card.locator('button', { hasText: 'Install' }).click()
    const li = await until(async () => { const x = await card.innerText(); return /Downloading 64%/.test(x) && x }, 30000)
    ok(!!li && /Installing…/.test(li) && /Then the sign-in starts by itself/.test(li), `${t}: Install shows it's going, with the installer's last lines, and that signing in comes next by itself`, li || (await card.innerText()))
    const ran = fs.readFileSync(path.join(kit.bin, 'installs.log'), 'utf8').trim().split('\n').pop()
    ok(IS_WIN ? /install\.ps1/.test(ran) : /curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash/.test(ran), `${t}: it's Claude Code's own installer for this computer (stood in for)`, ran)
    const waiting = await until(async () => { const x = await card.innerText(); return /Installed\. Now sign in once/.test(x) && /Your browser opened to sign in with your Claude account/.test(x) && x }, 40000)
    ok(!!waiting, `${t}: once installed, its sign-in starts by itself, and the card says the browser opened for it`, waiting || (await card.innerText()))
    ok(!!(await until(async () => (await signInTabs(kit)).length === 1 && openedBy(kit).slice(was).some((u) => /redirect_uri=http%3A%2F%2Flocalhost%3A\d+%2Fcallback/.test(u)), 10000)), `${t}: it's Claude Code's own sign-in, which opened the browser to come back to it on localhost`, openedBy(kit))
    await shot(p, `${tag}new-${t}-2-signing-in`)
    if (!phone) {
      // The browser can't get back to it: the page that shows a code, and the code pasted here.
      const link = card.locator('a', { hasText: 'Sign in with a code' })
      const href = (await link.getAttribute('href').catch(() => null)) || ''
      ok(/^https:\/\/claude\.com\/cai\/oauth\/authorize\?/.test(href) && href.includes(encodeURIComponent('https://platform.claude.com/oauth/code/callback')), 'desktop: "Browser says it can\'t connect to localhost" offers the link Claude Code printed, to the page that shows a code', href)
      await link.click()
      await card.locator('input[aria-label="Sign-in code"]').fill('good-code#stand-in-state')
      await shot(p, `${tag}new-desktop-2b-code`)
      await card.locator('button', { hasText: /^Sign in$/ }).click()
      ok(!!(await until(() => logOf(kit.home, 'claude-codes.log').includes('good-code#stand-in-state'), 10000)), 'desktop: the code is typed at Claude Code\'s "Paste code here" prompt', logOf(kit.home, 'claude-codes.log'))
    } else {
      // The browser comes back to it on localhost: signed in, nothing to paste.
      const port = fs.readFileSync(path.join(kit.home, 'claude-login-port.txt'), 'utf8').trim()
      await fetch(`http://127.0.0.1:${port}/callback?code=stand-in&state=stand-in-state`).catch(() => {})
    }
    ok(!!(await until(async () => /Ready to work/.test(await card.innerText()), 30000)), `${t}: signed in, the card says it's ready`, await card.innerText())
    ok(!!(await until(async () => !(await signInTabs(kit)).length, 30000)), `${t}: and the sign-in's tab closes by itself`, await tabsSay(kit))
    ok(!!(await p.$('select[aria-label="Chief of Staff"]')), `${t}: and the chief can be picked`)
    await shot(p, `${tag}new-${t}-2-installed`)
    ok(errors.length === 0, `${t}: install: no page errors`, errors)
    await ctx.close()
    await uninstall('claude')
    signedOut(kit)
    await kit.api('/subscriptions?refresh=1')
  }
  fs.rmSync(path.join(kit.bin, 'claude.standin.cjs'), { force: true })
  const codexLine = (await kit.api('/agents/catalog')).find((a) => a.kind === 'codex')?.install || ''
  ok(IS_WIN ? codexLine.startsWith("$env:CODEX_NON_INTERACTIVE='1'; ") : /\| CODEX_NON_INTERACTIVE=1 sh$/.test(codexLine), 'Codex installs without its installer stopping to ask whether to start it, in a tab nobody watches', codexLine)

  // ---------- Node.js, for agents that only come through npm, installed with one click ----------
  {
    // A download that doesn't match the checksum nodejs.org publishes is turned away.
    dist.bad = true
    await kit.api('/tools/node', {})
    const bad = await until(async () => (await kit.api('/tools/node')).job?.error, 30000)
    ok(/doesn't match the checksum/.test(bad || ''), 'a Node.js download that doesn\'t match its checksum is turned away', bad)
    ok(!(await kit.api('/tools/node')).ours, 'and nothing is kept')
    dist.bad = false
    const { ctx, p, errors } = await open(LOOKS[1][1])
    await later(p)
    await p.waitForSelector('.wiz-agents li')
    const gem = p.locator('.wiz-agents li', { hasText: 'Gemini CLI' })
    // The card asks how it's going every second, and an answer with nothing going and no Node.js
    // says "Node.js is installed, but Bridge AI can't find it". Asked here many times at once, from
    // once the install is under way: none may say so.
    const asked = { going: 0, lost: [], on: true }
    const watch = (async () => {
      while (asked.on) {
        await Promise.all(Array.from({ length: 4 }, async () => {
          const at = Date.now()
          const s = await kit.api('/tools/node').catch(() => null)
          if (s?.job) asked.going ||= Date.now()
          else if (s && asked.going && at > asked.going && !s.have) asked.lost.push(s)
        }))
      }
    })()
    await gem.locator('button', { hasText: 'Install Node.js' }).click({ timeout: 8000 })
    const node = await until(async () => { const s = await kit.api('/tools/node'); return s.have && !s.job && s }, 90000)
    asked.on = false
    await watch
    ok(node?.ours === NODE_V, 'Install Node.js: it\'s installed in Bridge AI\'s own folder, and found', node || (await kit.api('/tools/node')))
    ok(!!asked.going && !asked.lost.length, 'and while it installs, it never says it\'s done and can\'t find it', { going: !!asked.going, lost: asked.lost.slice(0, 2) })
    ok(!!(await until(async () => /^Install\b(?! Node)(?! ·)/.test((await gem.locator('.signin').innerText().catch(() => '')).trim()), 12000)), 'and the agent\'s card moves on to installing it', await gem.innerText())
    await shot(p, `${tag}new-desktop-2b-node`)
    // Then the agent, through npm: with Bridge AI's own download cache (npm's shared one can hold
    // files you can't change), and, where npm's global folder needs an administrator, into ~/.local.
    if (!IS_WIN) { const g = path.join(kit.home, 'npm-global', 'lib', 'node_modules'); fs.mkdirSync(g, { recursive: true }); fs.chmodSync(g, 0o555) }
    await gem.locator('button', { hasText: /^\s*Install\s*$/ }).click({ timeout: 8000 })
    const ran = await until(() => (fs.existsSync(path.join(kit.bin, 'installs.log')) ? fs.readFileSync(path.join(kit.bin, 'installs.log'), 'utf8') : '').split('\n').find((l) => /gemini-cli/.test(l)), 30000)
    const cache = /--cache '?([^' ]+)'?/.exec(ran || '')?.[1] || ''
    ok(/^npm install -g /.test(ran || '') && path.resolve(cache).startsWith(path.resolve(kit.data) + path.sep), "Gemini CLI installs through npm with Bridge AI's own cache", ran)
    ok(IS_WIN ? !/--prefix/.test(ran) : (ran || '').includes(`--prefix ${path.join(kit.home, '.local')}`), IS_WIN ? 'in npm\'s own folder (yours on Windows)' : 'into ~/.local, since npm\'s global folder needs an administrator', ran)
    ok(!!(await until(async () => /Now sign in once/.test(await gem.innerText()) && !!(await gem.locator('.signin-wait').count()), 30000)), 'and its card moves on to signing in, which starts by itself', await gem.innerText())
    ok(errors.length === 0, 'Node.js: no page errors', errors)
    await ctx.close()
    await uninstall('gemini')
  }

  // ---------- The recommended path, Just what agents need: Node.js, and nothing that asks ----------
  // On a Mac without Apple's developer tools too: they're for Everything, never this. Node.js's
  // download (slow here) shows where it's needed: the Install of an agent that waits for it, and,
  // once setup is closed, the top bar, until it's in.
  {
    dist.slow = true
    const k = await startKit('new-install-basic', { env: ({ bin }) => { if (IS_MAC) devToolsStandIn(bin); return { BRIDGE_NODE_DIST: `http://127.0.0.1:${nodeOrg.address().port}`, ...(IS_WIN ? { BRIDGE_PATH: '' } : {}) } } })
    const { ctx, p, errors } = await page(b, k.url, LOOKS[1][1])
    try {
      await p.waitForSelector('.wiz-levels', { timeout: 15000 })
      ok(await p.isChecked('input[name="wiz-level"][value="basic"]'), 'recommended: Just what agents need is picked')
      await p.click('.wiz-foot button:has-text("Set up Node.js")')
      await p.waitForSelector('.sa-list', { timeout: 10000 })
      const listed = await p.$$eval('.sa-item b', (l) => l.map((x) => x.innerText))
      ok(listed.join('|') === 'Node.js', 'it sets up Node.js alone (never the developer tools, even on a Mac without them)', listed)
      const plan = await k.api('/setup/plan')
      ok(plan.run?.ids.join('|') === 'node' && !plan.needsYou && !plan.openId, 'nothing waiting for you, no terminal', plan.run)
      if (IS_MAC) ok(plan.items.some((i) => i.id === 'devtools' && i.state === 'todo'), 'though Everything would offer the developer tools here', plan.items.map((i) => i.id))
      const row = await until(async () => { const x = await p.locator('.sa-item', { hasText: 'Node.js' }).innerText(); return /Downloading \d+%/.test(x) && x }, 15000)
      ok(!!row, 'Node.js says how far its download is', row || (await p.locator('.sa-item', { hasText: 'Node.js' }).innerText()))
      await p.click('.wiz-foot button:has-text("Continue")')
      await p.waitForSelector('.wiz-agents li', { timeout: 15000 })
      const gem = p.locator('.wiz-agents li', { hasText: 'Gemini CLI' })
      const waits = await until(async () => { const x = (await gem.locator('.signin').innerText().catch(() => '')).replace(/\s+/g, ' '); return /Install · waiting for Node\.js( \d+%)?/.test(x) && x }, 15000)
      ok(!!waits, 'an agent that needs Node.js: its Install says it\'s waiting for Node.js, with how far it is', waits || (await gem.innerText()))
      ok(await gem.locator('button[disabled]', { hasText: 'waiting for Node.js' }).count() === 1, 'and can\'t be pressed until then')
      ok(/^Install$/.test((await p.locator('.wiz-agents li', { hasText: 'Claude Code' }).locator('button').first().innerText()).trim()), 'one that doesn\'t need it can be installed straight away')
      await shot(p, `${tag}new-basic-waiting-for-node`)
      await p.click('.wiz-foot button:has-text("Continue")')
      await p.waitForSelector('.wiz-foot .btn.primary:not([disabled])', { timeout: 15000 })
      await p.click('.wiz-foot .btn.primary')
      ok(!!(await until(async () => !(await p.$('.wiz')), 10000)), 'setup closed while Node.js still downloads')
      const chip = await until(async () => { const x = await p.innerText('.setup-chip', { timeout: 1000 }).catch(() => ''); return /^Setting up · 0 of 1$/.test(x) && x }, 10000)
      ok(!!chip, 'the top bar says it\'s still setting up: 0 of 1', await p.innerText('.setup-chip', { timeout: 1000 }).catch(() => ''))
      await shot(p, `${tag}new-basic-top-bar`)
      ok(!!(await until(async () => { const s = await k.api('/tools/node'); return s.have && !s.job }, 60000)), 'Node.js arrives')
      ok(!!chip && !!(await until(async () => !(await p.$('.setup-chip')), 15000)), 'and the top bar\'s Setting up goes by itself')
      // Nothing that asks: no terminal, no password, no installer, nothing of macOS's opened.
      ok(!((await k.api('/fleet')).tabs || []).some((x) => x.label === 'Set up Bridge AI') && !fs.existsSync(path.join(k.bin, 'installs.log')) && !fs.existsSync(path.join(k.bin, 'passwords.log')), 'it never opened a terminal, ran an installer or asked for a password')
      ok(!/\[fix dry-run\]/.test(k.log()) && !fs.existsSync(path.join(k.bin, 'xcode-select.log')), 'nor opened System Settings, or macOS\'s window for the developer tools', k.log().split('\n').filter((l) => /dry-run|xcode/.test(l)))
      ok(errors.length === 0, 'Just what agents need: no page errors', errors)
    } finally { await ctx.close(); k.stop(); dist.slow = false }
  }

  // ---------- Setup closed with its X: the guesses are kept, Home, nothing in the way ----------
  {
    let saved = null
    // A slow first start: its first look at this computer takes a while, and you close it before then.
    let held = false
    const { ctx, p } = await open(LOOKS[0][1], { phone: true, before: (c) => c.route(/\/api\/setup$/, async (r) => {
      if (r.request().method() === 'GET' && !held) { held = true; await new Promise((ok) => setTimeout(ok, 2500)) }
      r.continue()
    }) })
    p.on('request', (r) => { if (/\/api\/setup$/.test(r.url()) && r.method() === 'POST') saved = r.postDataJSON() })
    await p.waitForSelector('.wiz-x')
    await p.click('.wiz-x')
    ok(!!(await until(() => saved, 8000)) && 'name' in saved && 'location' in saved, 'closing setup, even before its first look is back, saves the guessed defaults', saved)
    ok(!!(await until(async () => !(await p.$('.wiz')) && (await p.$('.home-title')), 8000)), 'the setup goes, and Home is there')
    ok(!(await p.$('.tour-card')) && !(await kit.api('/fleet')).agents.some((a) => a.chief), 'no tour, no chief started')
    await shot(p, `${tag}new-phone-3-closed`)
    await ctx.close()
  }

  // ---------- After setup, nothing to talk to yet; then a key ----------
  for (const phone of [false, true]) {
    const t = phone ? 'phone' : 'desktop'
    const { ctx, p, errors } = await open(LOOKS[1][1], { phone })
    await p.waitForTimeout(1500)
    if (phone) { await p.click('.tabbar button:has-text("Agents")'); await p.waitForTimeout(400); if (await p.$('.m-view-back')) { await p.click('.tabbar button:has-text("Agents")'); await p.waitForTimeout(400) } }
    await p.locator('[data-tour="new-agent"]:visible, button[aria-label="Start something new"]:visible').first().click()
    await p.waitForSelector('.home-title', { timeout: 8000 })
    ok(!!(await until(async () => /Add a project to start/.test(await p.innerText('.home-title')), 8000)) && /More options/.test(await p.innerText('.home-sub')), `${t}: Home with no projects: Add a project to start`)
    await p.click('.home-chip-wrap:first-child .home-chip')
    // Its models load once it's open.
    const menu = (await until(async () => { const x = await p.innerText('.home-pop'); return /No model yet/.test(x) && x }, 8000)) || (await p.innerText('.home-pop'))
    ok(/No agents installed yet/.test(menu) && /Install one/.test(menu) && /No model yet/.test(menu), `${t}: Home's chip: no agents yet, Install one, no model yet`, menu)
    await p.keyboard.press('Escape')
    await p.fill('.home-box textarea', 'hello')
    await p.keyboard.press('Enter')
    ok(/Add an API key or start a local model first/.test(await p.innerText('.home-err').catch(() => '')), `${t}: Enter with nothing to talk to says what to add`)
    ok(!(await sideways(p)), `${t}: Home: nothing wider than the screen`)
    await shot(p, `${tag}new-${t}-3b-home`)
    await p.click('.home-more')
    ok(!!(await p.waitForSelector('.new-agent', { timeout: 5000 }).catch(() => null)), `${t}: More options opens New agent`)
    await p.click('.na-mode button:has-text("In a project folder")')
    await p.waitForTimeout(300)
    let text = await p.innerText('.new-agent')
    ok(/No AI agents on this computer yet/.test(text) && /Install Claude Code/.test(text) && /Install Codex/.test(text) && !/your usual login/.test(text) && await p.$eval('.new-agent button[type=submit]', (x) => x.disabled), `${t}: in a project, nothing installed: install choices, no account, Start off`, text.slice(0, 500))
    ok(/In the sidebar/i.test(text) && /A new space called/.test(text) && !(await p.$('.new-agent select:not([aria-label="Model"])')), `${t}: where it goes is one line`)
    await p.click('.na-where .link-btn')
    ok(!!(await p.$('.new-agent .na-row select')), `${t}: Change shows the space and tab`)
    ok(await p.$eval('.new-agent .modal-foot', (el) => { const r = el.getBoundingClientRect(); return r.bottom <= window.innerHeight + 1 && r.top >= 0 }), `${t}: Start stays in view`)
    // A chat, with nothing to talk to yet.
    await p.click('.na-mode button:has-text("Plain chat")')
    await p.waitForTimeout(1200)
    text = await p.innerText('.new-agent')
    ok((await p.$eval('.na-kind.on', (x) => x.innerText)).includes('Any model') && /No model to talk to yet/.test(text) && await p.$eval('.new-agent button[type=submit]', (x) => x.disabled), `${t}: a chat: Any model, and it says there's nothing to talk to yet`, text.slice(0, 300))
    await shot(p, `${tag}new-${t}-4-newchat-empty`)
    // A key (to the stand-in provider), then Check again: its models to pick from.
    await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
    await p.click('.new-agent button:has-text("Check again")')
    await p.waitForSelector('.new-agent select[aria-label="Model"]', { timeout: 8000 }).catch(() => {})
    const opts = await p.$$eval('.new-agent select[aria-label="Model"] option', (l) => l.map((o) => o.value))
    ok(opts.includes('openai:gpt-5'), `${t}: the key's model is offered`, opts)
    await p.fill('.new-agent textarea', `Hi from ${t}`)
    await p.click('.new-agent button[type=submit]')
    ok(!!(await until(async () => (await p.innerText('body')).includes(`echo: Hi from ${t}`), 20000)), `${t}: the chat starts and the answer shows in Chat`)
    const tabs = await p.$$eval('[role=tablist][data-tour="views"] [role=tab]', (l) => l.map((x) => x.title || x.innerText.trim()))
    ok(!tabs.some((x) => /Files|Changes|Preview/.test(x)) && tabs.some((x) => /Chat/.test(x)), `${t}: a chat has no Files, Changes or Preview`, tabs)
    const sub = await p.$eval('.sub-where', (x) => x.innerText).catch(() => '')
    ok(/Any model/.test(sub) && !(await p.$('.path-chip')), `${t}: its header says Any model, no folder`, sub)
    const chip = await until(async () => { const c = await p.$eval('.model-chip .mc-name', (x) => x.innerText).catch(() => ''); return c === 'gpt-5 (OpenAI)' && c }, 6000)
    ok(!!chip, `${t}: the model button names the model in use`, await p.$eval('.model-chip .mc-name', (x) => x.innerText).catch(() => ''))
    ok(!!(await until(async () => !(await p.$('.state-tag.st-working')), 6000)), `${t}: done answering, not shown as working`)
    await shot(p, `${tag}new-${t}-5-chat`)
    await kit.api('/providers/openai', {}, 'DELETE')
    ok(errors.length === 0, `${t}: no page errors`, errors)
    await ctx.close()
  }

  // ---------- Model providers: a key the provider turns down, then a good one ----------
  {
    const { ctx, p, errors } = await open(LOOKS[1][1])
    // Settings › Model Providers, asked for again until it's open: on a slow machine the app may not
    // be listening yet the first time.
    await p.waitForSelector('.rail-nav-btn', { timeout: 30000 }).catch(() => {})
    await until(async () => {
      if (!(await p.locator('.modal.settings').count())) await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } })))
      return (await p.locator('.pv-card').count()) > 0
    }, 45000, 1500)
    await p.waitForSelector('.pv-card')
    const card = p.locator('.pv-card', { hasText: 'OpenAI' }).first()
    await card.locator('.pv-card-main').click()
    await card.locator('input').nth(0).fill('sk-bad')
    await card.locator('input').nth(1).fill(`${model.url}/v1`)
    await card.locator('button[type=submit]').click()
    let text = await until(async () => { const x = await card.innerText(); return /turned it down/.test(x) && x }, 8000)
    ok(/Saved, but OpenAI turned it down: HTTP 401/.test(text || '') && /Key turned down/.test(text || ''), 'a key turned down: it says so on Save, and its chip says so', text || (await card.innerText()))
    ok(/Chat with it now/.test(text || ''), 'and chat is still offered for it')
    await shot(p, `${tag}new-desktop-6-key-turned-down`)
    await card.locator('input').nth(0).fill('sk-test')
    await card.locator('button[type=submit]').click()
    text = await until(async () => { const x = await card.innerText(); return /The key works/.test(x) && x }, 8000)
    ok(/Saved\. The key works\./.test(text || '') && /Connected/.test(text || ''), 'a good key: "The key works", Connected', text || (await card.innerText()))
    ok(errors.length === 0, 'providers: no page errors', errors)
    await kit.api('/providers/openai', {}, 'DELETE')
    await ctx.close()
  }
  // ---------- Signing in always has a way through: Claude Code and Codex here, signed out ----------
  // In setup: Claude Code giving up on the browser, a code that doesn't work, its tab closed, each
  // said with Try again; Codex's one-time code instead of the browser. Then each one's own first
  // run in Chat, where the same ways through are on its card.
  {
    const k = await startKit('new-install-signin')
    for (const n of ['claude', 'codex']) k.program(n, fs.readFileSync(path.join(TEST, 'stand-ins', `${n}.cjs`), 'utf8'))
    standInSignIns(k)
    fs.writeFileSync(path.join(k.home, 'claude-login.json'), JSON.stringify({ endAfter: 2500 }))
    await k.api('/agents/catalog')
    const { ctx, p, errors } = await page(b, k.url, { ...LOOKS[1][1], before: noSignInPages })
    try {
      await later(p)
      await p.waitForSelector('.wiz-agents li', { timeout: 15000 })
      const claude = p.locator('.wiz-agents li', { hasText: 'Claude Code' })
      const codex = p.locator('.wiz-agents li', { hasText: 'Codex' })
      const says = (card, re) => until(async () => { const x = await card.innerText(); return re.test(x) && x }, 20000)
      // Claude Code gives up waiting for the browser.
      await claude.locator('button', { hasText: 'Sign in' }).click()
      let x = await says(claude, /The sign-in ended before you signed in/)
      // (Not said: what the sign-in's terminal showed, and how the server read it.)
      const seen = async () => { const out = []; for (const t of await signInTabs(k)) { const pane = t.panes?.[0]?.paneId; if (!pane) continue; out.push({ read: await k.api(`/signins/${encodeURIComponent(pane)}`).catch((e) => e.message), screen: String((await k.api(`/agents/${encodeURIComponent(pane)}/screen?lines=40`).catch(() => ({})))?.ansi || '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').split('\n').slice(-14) }) } return out }
      if (!ok(/timed out waiting for the browser/.test(x || '') && await claude.locator('button', { hasText: 'Try again' }).count() === 1, 'the sign-in ending without signing in says so, and why, with Try again', x || (await claude.innerText()))) console.log('the sign-in tabs then:', JSON.stringify(await seen(), null, 1))
      await shot(p, `${tag}new-signin-ended`)
      fs.writeFileSync(path.join(k.home, 'claude-login.json'), '{}')
      await claude.locator('button', { hasText: 'Try again' }).click()
      ok(!!(await says(claude, /Your browser opened to sign in/)) && (await signInTabs(k)).length === 1, 'Try again starts it again, in place of the one that ended', (await signInTabs(k)).map((t) => t.label))
      // A code that doesn't work.
      await claude.locator('a', { hasText: 'Sign in with a code' }).click()
      await claude.locator('input[aria-label="Sign-in code"]').fill('not-a-code')
      await claude.locator('button', { hasText: /^Sign in$/ }).click()
      x = await says(claude, /The sign-in ended before you signed in/)
      ok(/that code isn't valid/.test(x || '') && await claude.locator('button', { hasText: 'Try again' }).count() === 1, 'a code that doesn\'t work: Claude Code\'s words for it, and Try again', x || (await claude.innerText()))
      // Its tab closed while it waits.
      await claude.locator('button', { hasText: 'Try again' }).click()
      await says(claude, /Your browser opened to sign in/)
      for (const t of await signInTabs(k)) await k.api(`/tabs/${t.tabId}/close`, {})
      x = await says(claude, /The sign-in was closed before you signed in/)
      ok(!!x && await claude.locator('button', { hasText: 'Try again' }).count() === 1, 'its tab closed before signing in: said so, with Try again', x || (await claude.innerText()))
      // Codex: the browser's way, or a one-time code instead. A computer with no screen (Linux with no
      // display, as on CI) has no browser to open: there it's the one-time code from the start
      // (server/accounts.js NO_BROWSER).
      await codex.locator('button', { hasText: 'Sign in' }).click()
      if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        skip('Codex: its browser sign-in, and a way out when the browser can\'t come back to it', 'no screen here: Codex signs in with a one-time code from the start')
      } else {
        x = await says(codex, /Your browser opened to sign in with your ChatGPT account/)
        ok(!!x && /can't connect to localhost/.test(x) && openedBy(k).some((u) => /auth\.openai\.com\/oauth\/authorize\?.*redirect_uri=http%3A%2F%2Flocalhost/.test(u)), 'Codex: its browser sign-in, and a way out when the browser can\'t come back to it', x || (await codex.innerText()))
        await codex.locator('button', { hasText: 'Sign in with a code instead' }).click()
      }
      x = await says(codex, /ABCD-12345/)
      const where = await codex.locator('a', { hasText: 'Open the sign-in page' }).getAttribute('href').catch(() => null)
      const tabs = (await signInTabs(k)).filter((t) => /Codex/.test(t.label))
      ok(!!x && /enter this code there/.test(x) && where === 'https://auth.openai.com/codex/device' && tabs.length === 1, 'Sign in with a code instead: Codex\'s page and its one-time code, in place of the browser\'s sign-in', { x, where, tabs: tabs.map((t) => t.label) })
      await shot(p, `${tag}new-signin-codex-code`)
      fs.writeFileSync(path.join(k.home, 'codex-device-ok'), '')
      ok(!!(await says(codex, /Ready to work/)), 'signed in on that page: Codex is ready', await codex.innerText())
      ok(errors.length === 0, 'signing in: no page errors', errors)
    } finally { await ctx.close() }

    // Each one's own first run in Chat (Claude Code 2.1.311's and Codex's sign-in screens).
    await k.api('/setup', {})
    signedOut(k)
    fs.rmSync(path.join(k.home, '.codex'), { recursive: true, force: true })
    fs.rmSync(path.join(k.home, 'codex-device-ok'), { force: true })
    for (const n of ['claude', 'codex']) fs.writeFileSync(path.join(k.home, `${n}-first-run.json`), '{}')
    const work = path.join(k.home, 'work')
    fs.mkdirSync(work, { recursive: true })
    const agent = async (kind) => {
      const a = await k.api('/agents/launch', { kind, cwd: work, label: `First ${kind}`, newSpace: 'Work' })
      await until(async () => (await k.api('/fleet')).agents.find((x) => x.paneId === a.paneId)?.setup, 15000)
      return a
    }
    const step = async (a) => (await k.api('/fleet')).agents.find((x) => x.paneId === a.paneId)?.setup || null
    for (const phone of [false, true]) {
      const t = phone ? 'phone' : 'desktop'
      const { ctx: c2, p: q, errors: errs } = await page(b, k.url, { ...LOOKS[1][1], phone, before: noSignInPages })
      try {
        await q.waitForSelector('.rail-nav-btn, .tabbar', { timeout: 30000 }).catch(() => {})
        const show = (a) => q.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), a.paneId)
        const card = q.locator('.firstrun')
        // Claude Code: Sign in, the browser opens; the page that shows a code, and the code here.
        const c = await agent('claude')
        await show(c)
        await card.locator('button', { hasText: 'Sign in with Claude account' }).click({ timeout: 15000 })
        const x = await until(async () => { const s = await card.innerText().catch(() => ''); return /can't connect to localhost/.test(s) && s }, 15000)
        const href = await card.locator('a', { hasText: 'Sign in with a code' }).getAttribute('href').catch(() => null)
        ok(!!x && /Your browser opened to sign in/.test(x) && /^https:\/\/claude\.com\/cai\/oauth\/authorize\?/.test(href || ''), `${t}: a new Claude Code's sign-in in Chat: the browser opened, and a code instead when it can't come back`, { x, href })
        await shot(q, `${tag}new-${t}-firstrun-claude`)
        await card.locator('a', { hasText: 'Sign in with a code' }).click()
        await card.locator('input[aria-label="Sign-in code"]').fill(`good-${t}`)
        await card.locator('button', { hasText: /^Sign in$/ }).click()
        ok(!!(await until(async () => logOf(k.home, 'claude-codes.log').includes(`good-${t}`) && !(await step(c)) && !(await q.$('.firstrun')), 20000)), `${t}: the code goes in at its prompt, it's signed in, and the card is gone`, { codes: logOf(k.home, 'claude-codes.log'), step: await step(c) })
        // Codex: waiting for the browser; a one-time code instead.
        const o = await agent('codex')
        await show(o)
        const y = await until(async () => { const s = await card.innerText().catch(() => ''); return /Sign in with a code instead/.test(s) && s }, 15000)
        ok(!!y, `${t}: a new Codex waiting for the browser offers a one-time code instead`, y)
        await card.locator('button', { hasText: 'Sign in with a code instead' }).click()
        const z = await until(async () => { const s = await card.innerText().catch(() => ''); return /ABCD-12345/.test(s) && s }, 15000)
        const devicePage = await card.locator('a', { hasText: 'Open the sign-in page' }).getAttribute('href').catch(() => null)
        ok(!!z && devicePage === 'https://auth.openai.com/codex/device', `${t}: which goes to its own Sign in with Device Code, and shows the page and the code`, { z, devicePage, typed: logOf(k.home, 'codex-typed.log') })
        await shot(q, `${tag}new-${t}-firstrun-codex-code`)
        fs.writeFileSync(path.join(k.home, 'codex-device-ok'), '')
        ok(!!(await until(async () => !(await step(o)) && !(await q.$('.firstrun')), 20000)), `${t}: signed in on that page, Codex carries on and the card is gone`, await step(o))
        ok(errs.length === 0, `${t}: first runs: no page errors`, errs)
        for (const a of [c, o]) { const tab = (await k.api('/fleet')).agents.find((x) => x.paneId === a.paneId)?.tabId; if (tab) await k.api(`/tabs/${tab}/close`, {}).catch(() => {}) }
        fs.rmSync(path.join(k.home, 'codex-device-ok'), { force: true })
        fs.rmSync(path.join(k.home, '.codex'), { recursive: true, force: true })
        signedOut(k)
      } finally { await c2.close() }
    }
    k.stop()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
  model.stop()
  nodeOrg.close()
}
process.exit(done().fail ? 1 : 0)
