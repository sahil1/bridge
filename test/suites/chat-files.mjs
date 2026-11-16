// Files an agent names in its chat, opened where they are (server/filelinks.js, FileLinks.jsx). A
// Claude Code agent (stand-ins/claude.cjs) works in ~/Desktop/code/GIT and, as a real one does, in
// folders below it: it writes bridge-utils/html/roadmap.html by its full path and cds into
// bridge-utils/store/ios/review-env to make out/review-qr.png, then names them as html/roadmap.html
// and review-qr.png. Two Bridge AIs ("Desk", the agent's, and "Laptop"), each on its own relay,
// linked, and a phone paired with Desk. Checked:
//   the server: a path in full (from / and from ~), one in the agent's folder (with a line number
//   after it), one from the folders the conversation worked in (Claude Code's and Codex's logs),
//   one found by a search below the folder, several that end the same way, none (saying where it
//   looked), a path outside the folder (said, never looked at), a path up and out of it; the search
//   keeps out of node_modules, a cloud drive and, on a Mac, the folders macOS asks about (stood in
//   for by scripts/tcc-sim.mjs: nothing in them is touched), unless the agent's folder is in one;
//   the same answers through Laptop's link and the phone's;
//   the app: the names in a reply are links (in `code`, a Markdown link, the words themselves);
//   html/roadmap.html opens the page in Files, rendered in its sandbox; report.txt offers the two to
//   pick from; missing.txt says where it looked and offers Search, never a bare "Not found";
//   the pictures it names show small under the reply, open whole on a click and from there in Files;
//   in light and dark, on a desktop and a phone's width; and on Laptop (the agent on Desk) and on the
//   phone through its relay, the pictures and a link.
// Pictures in test/.out/shots (chat-files-*).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { startKit, startRelay, checks, until, browser, page, shot, sleep, browserNotice, phoneNotes, phoneSaw, ROOT, TEST, IS_MAC, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('chat-files')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const enc = encodeURIComponent

// A picture of one colour, made here.
function png(w, h, rgb) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]) }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}

const relays = []
const kits = []
const errors = []
try {
  const ra = await startRelay('chat-files-desk')
  const rb = await startRelay('chat-files-laptop')
  relays.push(ra, rb)
  // On a Mac, Documents and Downloads act like macOS's guarded folders (each look held, and logged).
  const kitWith = async (name, rel, more = () => ({})) => {
    const k = await startKit(`chat-files-${name.toLowerCase()}`, { env: (dirs) => { fs.writeFileSync(path.join(dirs.data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, ...more(dirs) } } })
    kits.push(k)
    await k.api('/setup', { name: 'Tester' })
    return k
  }
  const desk = await kitWith('Desk', ra, ({ home }) => (IS_MAC ? {
    NODE_OPTIONS: `--import ${pathToFileURL(path.join(ROOT, 'scripts', 'tcc-sim.mjs')).href}`, SIM_LOG: '1', SIM_MS: '1500',
    SIM_PROTECTED: ['Documents', 'Downloads', path.join('Library', 'CloudStorage')].map((d) => path.join(home, d)).join(':'),
  } : {}))
  const lap = await kitWith('Laptop', rb)
  ok(!!(await until(async () => (await desk.api('/relay')).online && (await lap.api('/relay')).online, 20000)), 'each is connected to its own relay')

  // ---------- the files ----------
  const h = desk.home
  const W = path.join(h, 'Desktop', 'code', 'GIT')
  const put = (abs, data = 'x\n') => { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, data) }
  const at = (rel) => path.join(W, ...rel.split('/'))
  put(at('bridge-utils/html/roadmap.html'), '<!doctype html><title>Roadmap</title><style>body{font:16px sans-serif;background:#fff}</style><h1 id="t">Roadmap</h1><p>Q1: chat file links</p>')
  put(at('bridge-utils/store/ios/review-env/out/review-qr.png'), png(240, 160, [30, 110, 200]))
  put(at('bridge-utils/store/ios/review-env/make-qr.js'), '// makes out/review-qr.png\n')
  put(at('notes/plan.md'), '# Plan\n')
  put(at('notes/todo.md'), '# To do\n')
  put(at('a/report.txt'), 'report a\n')
  put(at('b/report.txt'), 'report b\n')
  put(at('node_modules/pkg/report.txt'), 'not this one\n')
  put(at('node_modules/pkg/vendored-only.txt'), 'in node_modules only\n')
  put(at('deep/x/y/only-here.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#e8a33d"/></svg>')
  put(path.join(h, 'Documents', 'private', 'only-docs.txt'), 'in Documents\n')
  put(path.join(h, 'Downloads', 'only-downloads.txt'), 'in Downloads\n')
  put(path.join(h, 'Dropbox', 'only-cloud.txt'), 'on a cloud drive\n')
  put(path.join(h, 'outside.txt'), 'beside the agent\'s folder\n')

  // ---------- the agent, and what it did ----------
  desk.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await desk.api('/agents/catalog') // looked for again: the server looked before the stand-in was there
  const pane = (await desk.api('/agents/launch', { kind: 'claude', cwd: W, label: 'Roadmap', newSpace: 'Roadmap', prompt: 'idle' })).paneId
  ok(!!pane, 'a Claude Code agent starts in ~/Desktop/code/GIT (the stand-in)')
  const agent = await until(async () => (await desk.api('/fleet')).agents.find((a) => a.paneId === pane && a.sessionId), 30000)
  const logOf = () => {
    const root = path.join(h, '.claude', 'projects')
    for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) { const f = path.join(root, d, `${agent.sessionId}.jsonl`); if (fs.existsSync(f)) return f }
    return null
  }
  // The stand-in's own log, written whole (its last notice is the monitor's), then this conversation after it.
  const log = await until(() => { const f = logOf(); return f && fs.readFileSync(f, 'utf8').includes('Monitor event') && f }, 30000)
  ok(!!log, 'its session log is written', agent)
  const now = (s) => new Date(Date.now() - s * 1000).toISOString()
  const say = (o) => fs.appendFileSync(log, `${JSON.stringify({ sessionId: agent.sessionId, cwd: W, ...o })}\n`)
  say({ type: 'user', timestamp: now(60), message: { role: 'user', content: 'Make the roadmap page and the QR code for review' } })
  say({ type: 'assistant', timestamp: now(50), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_W1', name: 'Write', input: { file_path: at('bridge-utils/html/roadmap.html'), content: '<h1>Roadmap</h1>' } }] } })
  say({ type: 'user', timestamp: now(50), message: { role: 'user', content: [{ tool_use_id: 'toolu_W1', type: 'tool_result', content: 'File created' }] } })
  say({ type: 'assistant', timestamp: now(40), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_B1', name: 'Bash', input: { command: `cd "${at('bridge-utils/store/ios/review-env')}" && node make-qr.js`, description: 'Make the QR code' } }] } })
  say({ type: 'user', timestamp: now(40), message: { role: 'user', content: [{ tool_use_id: 'toolu_B1', type: 'tool_result', content: 'QR code written' }] } })
  const REPLY = [
    'Done. The page is `html/roadmap.html` and the QR code is `review-qr.png`; the sketch is only-here.svg.',
    `The plan is in [the plan](notes/plan.md) and \`${at('notes/plan.md')}\`, the to-do list in \`~/Desktop/code/GIT/notes/todo.md\`.`,
    'The numbers are in `report.txt`; `missing.txt` is gone.',
  ].join('\n')
  say({ type: 'assistant', timestamp: now(30), message: { role: 'assistant', content: [{ type: 'text', text: REPLY }] } })

  // ---------- the server ----------
  const locate = (base, p, root = pane) => fetch(`${base}/api/agents/${enc(root)}/locate?path=${enc(p)}`).then(async (r) => ({ s: r.status, ...(await r.json().catch(() => ({}))) }))
  const one = (r, rel, how) => r.s === 200 && r.found?.length === 1 && r.found[0].path === rel && (!how || r.how === how)
  let r = await locate(desk.url, at('notes/plan.md'))
  ok(one(r, 'notes/plan.md', 'path'), 'a path in full, inside the agent\'s folder: that file', r)
  r = await locate(desk.url, '~/Desktop/code/GIT/notes/todo.md')
  ok(one(r, 'notes/todo.md', 'path'), 'a path from ~: that file', r)
  r = await locate(desk.url, './notes/plan.md:12')
  ok(one(r, 'notes/plan.md', 'folder'), 'a path in the agent\'s folder, with a line number after it: that file', r)
  r = await locate(desk.url, 'html/roadmap.html')
  ok(one(r, 'bridge-utils/html/roadmap.html', 'conversation'), 'html/roadmap.html: where the conversation wrote it, three folders down', r)
  r = await locate(desk.url, 'review-qr.png')
  ok(one(r, 'bridge-utils/store/ios/review-env/out/review-qr.png', 'search'), 'review-qr.png: found by a search, from the folder the conversation cd\'d into', r)
  r = await locate(desk.url, 'only-here.svg')
  ok(one(r, 'deep/x/y/only-here.svg', 'search'), 'a file the conversation never named: found by a search below the folder', r)
  r = await locate(desk.url, 'report.txt')
  ok(r.found?.length === 2 && r.found.map((f) => f.path).sort().join() === 'a/report.txt,b/report.txt', 'report.txt: both that end in it, to pick from (not the one in node_modules)', r)
  r = await locate(desk.url, 'vendored-only.txt')
  ok(r.found?.length === 0, 'the search keeps out of node_modules', r)
  r = await locate(desk.url, 'missing.txt')
  ok(r.s === 200 && r.found?.length === 0 && !r.outside && r.looked?.root === '~/Desktop/code/GIT' && r.looked.used >= 2 && r.looked.folders > 5, 'none: says where it looked (the folder, the folders the conversation worked in, how many below it)', r)
  r = await locate(desk.url, path.join(h, 'outside.txt'))
  ok(r.found?.length === 0 && r.outside === '~/outside.txt', 'a path in full outside the agent\'s folder: said to be, not looked at', r)
  r = await locate(desk.url, '~/outside.txt')
  ok(r.found?.length === 0 && r.outside === '~/outside.txt', 'and from ~', r)
  r = await locate(desk.url, '../../../outside.txt')
  ok(r.s === 200 && r.found?.length === 0 && !JSON.stringify(r).includes('beside the agent'), 'a path up and out of the folder finds nothing', r)
  // The home folder as the root (Studio's home): the search keeps out of a cloud drive, and on a Mac
  // out of Desktop, Documents and Downloads, without so much as a look.
  const held = () => (desk.log().match(/\[tcc-sim\] (HELD|FROZE) .*/g) || []).filter((l) => ['Documents', 'Downloads', 'Library'].some((d) => l.includes(path.join(h, d))))
  const before = held().length
  r = await locate(desk.url, 'only-cloud.txt', 'home')
  ok(r.s === 200 && r.found?.length === 0 && r.looked?.skipped?.includes('Dropbox'), 'from your home folder, the search keeps out of a cloud drive, and says so', r)
  if (IS_MAC) {
    r = await locate(desk.url, 'only-docs.txt', 'home')
    const r2 = await locate(desk.url, 'only-downloads.txt', 'home')
    ok(r.found?.length === 0 && ['Desktop', 'Documents', 'Downloads'].every((d) => r.looked?.skipped?.includes(d)) && r2.found?.length === 0, 'and out of Desktop, Documents and Downloads, which macOS asks about, saying so', { r, r2 })
    ok(held().length === before, 'nothing in Documents or Downloads is touched, so macOS would have nothing to ask', held().slice(before))
  } else skip('the search keeps out of Desktop, Documents and Downloads', 'only macOS asks before an app looks in them')
  r = await locate(desk.url, 'review-qr.png')
  ok(one(r, 'bridge-utils/store/ios/review-env/out/review-qr.png'), 'with the agent\'s folder in Desktop, it\'s searched all the same', r)

  // Codex's log: a patch that adds site/pages/new.html, and a command run in site (its workdir)
  // that cds into docs. Read by the server's own modules, run on a home of their own.
  {
    const ch = path.join(desk.dir, 'codex-home')
    const cw = path.join(ch, 'work')
    put(path.join(cw, 'site', 'pages', 'new.html'), '<h1>New</h1>')
    put(path.join(cw, 'site', 'docs', 'guide.md'), '# Guide\n')
    const sid = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
    const day = new Date()
    const at2 = (n) => String(n).padStart(2, '0')
    const log2 = path.join(ch, '.codex', 'sessions', String(day.getFullYear()), at2(day.getMonth() + 1), at2(day.getDate()), `rollout-${day.getFullYear()}-${at2(day.getMonth() + 1)}-${at2(day.getDate())}T09-00-00-${sid}.jsonl`)
    const lines = [
      { type: 'session_meta', payload: { id: sid, cwd: cw } },
      { type: 'turn_context', payload: { cwd: cw, model: 'gpt-5-codex' } },
      { type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c1', input: '*** Begin Patch\n*** Add File: site/pages/new.html\n+<h1>New</h1>\n*** End Patch' } },
      { type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c2', arguments: JSON.stringify({ command: ['bash', '-lc', 'cd docs && make'], workdir: path.join(cw, 'site') }) } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Added `pages/new.html` and `guide.md`.' }] } },
    ]
    put(log2, lines.map((l) => JSON.stringify({ timestamp: new Date().toISOString(), ...l })).join('\n') + '\n')
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { locate } = await import(process.env.FL)
      const out = {}
      for (const q of ['pages/new.html', 'guide.md']) out[q] = await locate(process.env.CW, { kind: 'codex', sessionId: process.env.SID, cwd: process.env.CW }, q)
      console.log(JSON.stringify(out))
    `], { env: { ...process.env, HOME: ch, USERPROFILE: ch, BRIDGE_HOME: path.join(ch, '.bridge-ai'), FL: pathToFileURL(path.join(ROOT, 'server', 'filelinks.js')).href, CW: cw, SID: sid }, encoding: 'utf8', timeout: 30000 })
    let got = null
    try { got = JSON.parse(run.stdout.trim().split('\n').at(-1)) } catch { /* said below */ }
    ok(one({ s: 200, ...got?.['pages/new.html'] }, 'site/pages/new.html', 'conversation'), 'Codex: a file its patch added, named from a folder below', got?.['pages/new.html'] || run.stderr.slice(-600))
    ok(one({ s: 200, ...got?.['guide.md'] }, 'site/docs/guide.md', 'conversation'), 'Codex: a file in the folder a command cd\'d into from its workdir', got?.['guide.md'] || run.stderr.slice(-600))
  }

  // Through Laptop, linked to Desk, and through the phone's link.
  const p = (await desk.api('/relay/pair', {})).pairing
  await lap.api('/machines', { link: `${ra.url} ${p.code}` })
  const deskOnLap = await until(async () => (await lap.api('/machines')).machines.find((m) => m.name === 'Desk' && m.online), 30000, 300)
  ok(!!deskOnLap, 'Laptop is linked to Desk')
  const M = `${lap.url}/m/${deskOnLap?.id}`
  r = await locate(M, 'html/roadmap.html')
  ok(one(r, 'bridge-utils/html/roadmap.html', 'conversation'), 'through Laptop\'s link: the same answer', r)

  // ---------- the app ----------
  const reply = (pg) => pg.locator('.msg.assistant', { hasText: 'The page is' }).last()
  const openAgent = (pg) => pg.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } })), pane)
  const toChat = (pg) => pg.locator('.seg [role=tab]', { hasText: 'Chat' }).first().click()
  // Where the file in front is, each part of its path (a phone shows only the last).
  const crumbs = (pg) => pg.locator('.viewer-head .crumbs').first().evaluate((c) => [...c.querySelectorAll('.crumb')].map((x) => x.textContent.trim()).join(' › ')).catch(() => '')
  const picsLoaded = (pg) => pg.locator('.reply-pic img').evaluateAll((l) => l.map((i) => ({ src: decodeURIComponent(i.getAttribute('src')), w: i.naturalWidth })))
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = look.mode
    const { ctx, p: pg, errors: errs } = await page(b, desk.url, { ...look, height: 1300 })
    await pg.waitForSelector('.tab-main', { timeout: 20000 })
    await openAgent(pg)
    await toChat(pg).catch(() => {})
    await reply(pg).waitFor({ timeout: 20000 })
    const links = await reply(pg).locator('.path-link').allInnerTexts()
    ok(['html/roadmap.html', 'review-qr.png', 'only-here.svg', 'the plan', 'report.txt', 'missing.txt'].every((x) => links.includes(x)), `${t}: the names in the reply are links (in code, a Markdown link and the words)`, links)
    // The pictures it names, small under it.
    const pics = await until(async () => { const l = await picsLoaded(pg); return l.length === 2 && l.every((x) => x.w > 0) && l }, 15000)
    ok(!!pics && pics.some((x) => x.src.endsWith('review-env/out/review-qr.png') || x.src.includes('review-env/out/review-qr.png')) && pics.some((x) => x.src.includes('deep/x/y/only-here.svg')), `${t}: the two pictures it names show under the reply`, pics || await picsLoaded(pg))
    const box = await pg.locator('.reply-pic').first().boundingBox()
    ok(box && box.width <= 224 && box.height <= 154, `${t}: small`, box)
    await reply(pg).scrollIntoViewIfNeeded()
    await shot(pg, `${tag}chat-files-reply-${t}`)
    await shot(reply(pg), `${tag}chat-files-reply-close-${t}`)
    await pg.locator('.reply-pic').first().click()
    await pg.locator('.lightbox img').waitFor({ timeout: 5000 })
    ok(await pg.locator('.lightbox img').evaluate((i) => i.naturalWidth === 240), `${t}: a click shows it whole`)
    await pg.locator('.lightbox-bar button[aria-label="Open in Files"]').click()
    await until(async () => /^bridge-utils.*review-qr\.png$/.test(await crumbs(pg)), 10000)
    const shown = await until(() => pg.locator('.viewer .img-view img').evaluate((i) => i.naturalWidth).catch(() => 0), 10000)
    ok(/bridge-utils.*review-env.*out.*review-qr\.png$/.test(await crumbs(pg)) && shown === 240, `${t}: and from there, in Files`, { crumbs: await crumbs(pg), shown })
    // html/roadmap.html: the page in Files, rendered in its sandbox.
    await toChat(pg)
    await reply(pg).locator('.path-link', { hasText: 'html/roadmap.html' }).click()
    await until(async () => /^bridge-utils.*roadmap\.html$/.test(await crumbs(pg)), 10000)
    ok(/^bridge-utils.*html.*roadmap\.html$/.test(await crumbs(pg)), `${t}: html/roadmap.html opens bridge-utils/html/roadmap.html in Files`, await crumbs(pg))
    const frame = pg.locator('iframe.html-view')
    await frame.waitFor({ timeout: 10000 }).catch(() => {})
    ok((await frame.getAttribute('sandbox').catch(() => '')).includes('allow-scripts') && !(await frame.getAttribute('sandbox').catch(() => '')).includes('allow-same-origin'), `${t}: the page shows in a sandboxed frame`)
    const said = await until(() => pg.frameLocator('iframe.html-view').locator('#t').innerText().catch(() => null), 10000)
    ok(said === 'Roadmap', `${t}: and it's the page itself, rendered`, said)
    ok(!(await pg.locator('.viewer-body').innerText().catch(() => '')).includes('Not found'), `${t}: no "Not found"`)
    await shot(pg, `${tag}chat-files-html-${t}`)
    // report.txt: the two to pick from.
    await toChat(pg)
    await reply(pg).locator('.path-link', { hasText: 'report.txt' }).click()
    const pick = pg.locator('.find-file.pick')
    await pick.waitFor({ timeout: 15000 }).catch(() => {})
    const rows = await pick.locator('.ff-row').allInnerTexts().catch(() => [])
    ok(rows.length === 2 && rows.some((x) => /\ba\b/.test(x)) && rows.some((x) => /\bb\b/.test(x)) && /2 files end in report\.txt/.test(await pick.innerText().catch(() => '')), `${t}: report.txt: "2 files end in report.txt. Which one?", each with its folder`, rows)
    await shot(pg, `${tag}chat-files-pick-${t}`)
    await pick.locator('.ff-row').filter({ has: pg.locator('.ff-dir', { hasText: /^b$/ }) }).click()
    const body = await until(async () => /^b.*report\.txt$/.test(await crumbs(pg)) && /report b/.test(await pg.locator('.viewer-body').innerText().catch(() => '')), 10000)
    const tabs = await pg.locator('.file-tab-name').allInnerTexts()
    ok(body && tabs.filter((x) => /report\.txt/.test(x)).length === 1, `${t}: the one picked opens, in the same tab`, { crumbs: await crumbs(pg), tabs })
    // missing.txt: where it looked, and Search.
    await toChat(pg)
    await reply(pg).locator('.path-link', { hasText: 'missing.txt' }).click()
    const none = pg.locator('.find-file[role=alert]')
    await none.waitFor({ timeout: 15000 }).catch(() => {})
    const text = await none.innerText().catch(() => '')
    ok(/Couldn't find missing\.txt/.test(text) && /Where it looked/.test(text) && /~\/Desktop\/code\/GIT/.test(text) && /folders this conversation worked in/.test(text) && /folders below it/.test(text) && !/^Not found$/m.test(text), `${t}: missing.txt: says it couldn't find it and where it looked`, text)
    await shot(pg, `${tag}chat-files-none-${t}`)
    await none.locator('button', { hasText: 'Search for missing.txt' }).click()
    ok(await pg.locator('.quick-open input').inputValue().catch(() => '') === 'missing.txt', `${t}: Search opens Go to file with its name in`)
    await pg.keyboard.press('Escape')
    errors.push(...errs.filter((e) => !browserNotice(e)))
    await ctx.close()
  }

  // ---------- a phone's width ----------
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = `phone ${look.mode}`
    const { ctx, p: pg, errors: errs } = await page(b, desk.url, { ...look, phone: true })
    await pg.waitForSelector('.tabbar button', { timeout: 15000 })
    await openAgent(pg)
    await reply(pg).waitFor({ timeout: 20000 })
    await reply(pg).scrollIntoViewIfNeeded()
    const pics = await until(async () => { const l = await picsLoaded(pg); return l.length === 2 && l.every((x) => x.w > 0) && l }, 15000)
    ok(!!pics, `${t}: the pictures show under the reply`, await picsLoaded(pg))
    ok((await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, `${t}: nothing wider than the phone`)
    await shot(pg, `${tag}chat-files-phone-${look.mode}`)
    await reply(pg).locator('.path-link', { hasText: 'report.txt' }).click()
    const pick = pg.locator('.find-file.pick')
    await pick.waitFor({ timeout: 15000 }).catch(() => {})
    ok((await pick.locator('.ff-row').count().catch(() => 0)) === 2 && (await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, `${t}: the two to pick from, within the phone's width`)
    await shot(pg, `${tag}chat-files-phone-pick-${look.mode}`)
    errors.push(...errs.filter((e) => !browserNotice(e)))
    await ctx.close()
  }

  // ---------- Laptop's window, the agent on Desk in it ----------
  {
    const { ctx, p: pg, errors: errs } = await page(b, `${M}/`, { mode: 'light', theme: 'sky' })
    await pg.waitForSelector('.tab-main', { timeout: 30000 })
    await openAgent(pg)
    await toChat(pg).catch(() => {})
    await reply(pg).waitFor({ timeout: 30000 })
    const pics = await until(async () => { const l = await picsLoaded(pg); return l.length === 2 && l.every((x) => x.w > 0) && l }, 20000)
    ok(!!pics, 'on Laptop, the agent on Desk: the pictures show', pics || await picsLoaded(pg))
    await reply(pg).locator('.path-link', { hasText: 'html/roadmap.html' }).click()
    await until(async () => /^bridge-utils.*roadmap\.html$/.test(await crumbs(pg)), 15000)
    ok(/^bridge-utils.*html.*roadmap\.html$/.test(await crumbs(pg)), 'and html/roadmap.html opens the file on Desk', await crumbs(pg))
    await shot(pg, `${tag}chat-files-laptop`)
    errors.push(...errs.filter((e) => !browserNotice(e)))
    await ctx.close()
  }

  // ---------- the phone, paired with Desk through its relay ----------
  {
    const code = (await desk.api('/relay/pair', {})).pairing.code
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: which === 'chromium', hasTouch: true, deviceScaleFactor: 2 })
    await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-appearance', JSON.stringify({ mode: 'light', theme: 'sky', text: 'm' })) } catch { /* no storage */ } })
    await phoneNotes(ctx)
    const phone = await ctx.newPage()
    phone.on('pageerror', (e) => { if (!browserNotice(e.message)) errors.push(e.message) })
    await phone.goto(`${ra.url}/#pair=${code}`, { waitUntil: 'commit' })
    await phone.locator('#pair-go').click({ timeout: 15000 })
    const app = () => phone.frames().find((f) => f !== phone.mainFrame() && f.url().startsWith(ra.url))
    const opened = await until(() => app()?.evaluate(() => fetch('/api/version').then((x) => x.ok)), 30000, 200)
    ok(!!opened, 'the phone is paired and Bridge AI is open in it', opened ? undefined : await phoneSaw(phone))
    if (opened) {
      const viaPhone = await app().evaluate(async (u) => (await fetch(u)).json(), `/api/agents/${enc(pane)}/locate?path=${enc('review-qr.png')}`)
      ok(viaPhone.found?.length === 1 && viaPhone.found[0].path === 'bridge-utils/store/ios/review-env/out/review-qr.png', 'on the phone, through the encrypted link: the same answer', viaPhone)
      const f = app()
      await until(() => f.evaluate(() => !!document.querySelector('.tabbar button')), 20000)
      await f.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } })), pane)
      await f.locator('.msg.assistant', { hasText: 'The page is' }).last().waitFor({ timeout: 20000 }).catch(() => {})
      await f.locator('.msg.assistant', { hasText: 'The page is' }).last().scrollIntoViewIfNeeded().catch(() => {})
      const pics = await until(async () => { const l = await f.locator('.reply-pic img').evaluateAll((x) => x.map((i) => i.naturalWidth)); return l.length === 2 && l.every((w) => w > 0) && l }, 20000)
      ok(!!pics, 'on the phone: the pictures show under the reply, through the relay', pics)
      await shot(phone, `${tag}chat-files-relay-phone`)
      await f.locator('.msg.assistant', { hasText: 'The page is' }).last().locator('.path-link', { hasText: 'html/roadmap.html' }).click()
      const c = await until(async () => { const x = await crumbs(f); return /^bridge-utils.*roadmap\.html$/.test(x) && x }, 20000)
      ok(!!c, 'and html/roadmap.html opens the file on Desk', await crumbs(f))
    }
    await ctx.close()
  }
  await sleep(100)
  ok(!errors.length, 'no page errors', errors.slice(0, 3))
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  await b.close().catch(() => {})
}
process.exit(done().fail ? 1 : 0)
