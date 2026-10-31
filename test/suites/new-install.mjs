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
import { startKit, startModel, checks, until, browser, page, shot, IS_WIN, IS_MAC, devToolsStandIn } from '../lib/harness.mjs'

const { ok, done } = checks('new-install')

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
  // installer, never the real one), the card shows how it's going, then moves on to signing in ----------
  const uninstall = async (n) => { for (const f of [n, `${n}.cjs`, `${n}.cmd`]) fs.rmSync(path.join(kit.bin, f), { force: true }); await kit.api('/agents/catalog') }
  for (const phone of [false, true]) {
    const t = phone ? 'phone' : 'desktop'
    const { ctx, p, errors } = await open(LOOKS[1][1], { phone })
    await later(p)
    await p.waitForSelector('.wiz-agents li')
    await p.locator('.wiz-agents li').first().locator('button', { hasText: 'Install' }).click()
    const li = await until(async () => { const x = await p.locator('.wiz-agents li').first().innerText(); return /Downloading 64%/.test(x) && x }, 30000)
    ok(!!li && /Installing…/.test(li) && /moves on by itself/.test(li), `${t}: Install shows it's going, with the installer's last lines`, li || (await p.locator('.wiz-agents li').first().innerText()))
    const ran = fs.readFileSync(path.join(kit.bin, 'installs.log'), 'utf8').trim().split('\n').pop()
    ok(IS_WIN ? /install\.ps1/.test(ran) : /curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash/.test(ran), `${t}: it's Claude Code's own installer for this computer (stood in for)`, ran)
    ok(!!(await until(async () => /Sign in once with your account/.test(await p.locator('.wiz-agents li').first().innerText()), 30000)), `${t}: once installed, the card moves on to signing in`, await p.locator('.wiz-agents li').first().innerText())
    ok(!!(await p.$('select[aria-label="Chief of Staff"]')), `${t}: and the chief can be picked`)
    await shot(p, `${tag}new-${t}-2-installed`)
    ok(errors.length === 0, `${t}: install: no page errors`, errors)
    await ctx.close()
    await uninstall('claude')
  }

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
    await gem.locator('button', { hasText: 'Install Node.js' }).click({ timeout: 8000 })
    const node = await until(async () => { const s = await kit.api('/tools/node'); return s.have && !s.job && s }, 90000)
    ok(node?.ours === NODE_V, 'Install Node.js: it\'s installed in Bridge AI\'s own folder, and found', node || (await kit.api('/tools/node')))
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
    ok(!!(await until(async () => /Sign in once/.test(await gem.innerText()), 30000)), 'and its card moves on to signing in', await gem.innerText())
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
