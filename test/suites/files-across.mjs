// Files and videos between your computers, and from your phone to one of them. Two Bridge AIs
// ("Studio", where an agent renders videos, and "Laptop", where one writes notes), each on its own
// relay (stand-ins/relay.mjs), linked both ways; and a phone paired with Studio. Checked:
//   a copy from Studio to Laptop (Copy to this computer): the same bytes and SHA-256, its progress
//   along the way, a dropped connection halfway that it carries on from (not from the start), a name
//   that's taken there ("final 2.mp4", nothing replaced), a folder with its files and an empty
//   folder in it, and a copy that can't fit (said before anything is written);
//   a copy from Laptop to Studio (Send to): the same, the other way, in pieces;
//   Places stay opt-in: nothing in Laptop's Movies or Downloads (guarded like macOS's, by
//   scripts/tcc-sim.mjs) is looked at until a folder is picked, a phone or another device can't add
//   one, and once picked it's read like an agent's folder;
//   on a Mac, a copy from elsewhere into Downloads waits for macOS's question to have been asked
//   there instead of bringing it up on a screen nobody may be at;
//   a big copy through Bridge AI's hosted relay says so first (512 MB a day);
//   in the app: Copy to this computer and Send to… from Files, a file dragged in from another
//   device's Files, the copy's progress and where it landed (Show in Finder), Places in Files, and
//   on a phone (390 wide) photos and videos sent from it into the project, with their progress and
//   nothing wider than the screen;
//   a notification about a video an agent made opens it in Files, where it plays.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { startKit, startRelay, checks, until, browser, sleep, shot, ROOT, TEST, IS_WIN, IS_MAC } from '../lib/harness.mjs'

const { ok, skip, done } = checks('files-across')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const say = (...a) => console.log(...a)
const MB = 1024 * 1024
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const shaFile = (f) => sha(fs.readFileSync(f))
// Bytes that differ everywhere, so a part written in the wrong place shows.
const pattern = (n, seed = 1) => { const out = Buffer.alloc(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out[i] = x >>> 24 } return out }
const enc = encodeURIComponent

const relays = []
const kits = []
// Each part on its own: one that breaks (a route that isn't there) is a failed check, and the rest go on.
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: ${String(e.message).split('\n')[0]}`) } }
try {
  const ra = await startRelay('files-across-studio')
  const rb = await startRelay('files-across-laptop')
  relays.push(ra, rb)
  const kitWith = async (name, rel, more = () => ({}), config = {}) => {
    const k = await startKit(`files-across-${name.toLowerCase()}`, { config, env: (dirs) => { fs.writeFileSync(path.join(dirs.data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, ...more(dirs) } } })
    kits.push(k)
    await k.api('/setup', { name: 'Tester' })
    return k
  }
  // Laptop's Movies and Downloads act like macOS's guarded folders: each look into them is held a
  // moment and written down (tcc-sim), so the test sees whether anything looked before you asked.
  // Bridge AI's hosted relay is, for Laptop, the relay Studio is on: a copy with Studio goes through it.
  const sim = !IS_WIN
  const a = await kitWith('Studio', ra)
  const lap = await kitWith('Laptop', rb, ({ home }) => (sim ? { NODE_OPTIONS: `--import ${pathToFileURL(path.join(ROOT, 'scripts', 'tcc-sim.mjs')).href}`, SIM_PROTECTED: ['Movies', 'Downloads'].map((d) => path.join(home, d)).join(':'), SIM_MS: '200', SIM_LOG: '1' } : {}), { relay: { hostedUrl: ra.url } })
  ok(!!(await until(async () => (await a.api('/relay')).online && (await lap.api('/relay')).online, 20000)), 'each is connected to its own relay')
  const looked = (dir) => (lap.log().match(/\[tcc-sim\] (HELD|FROZE) .*/g) || []).filter((l) => l.includes(path.join(lap.home, dir)))
  const relayNet = (rel, q = '') => fetch(`${rel.url}/_test/net${q}`, { method: 'POST' }).then((r) => r.json())

  // An agent rendering videos on Studio, and one writing notes on Laptop.
  const work = path.join(a.home, 'renders')
  fs.mkdirSync(path.join(work, 'shots', 'empty'), { recursive: true })
  const files = {
    'final.mp4': pattern(24 * MB, 7),
    'shots/one.png': pattern(300 * 1024, 2),
    'shots/two.png': pattern(500 * 1024, 3),
    'shots/notes.txt': Buffer.from('take two is the one\n'),
  }
  for (const [n, buf] of Object.entries(files)) fs.writeFileSync(path.join(work, n), buf)
  fs.copyFileSync(path.join(TEST, 'fixtures', 'clip.mp4'), path.join(work, 'clip.mp4'))
  fs.closeSync(fs.openSync(path.join(work, 'big.mov'), 'w'))
  fs.truncateSync(path.join(work, 'big.mov'), 100 * MB) // sparse where it can be: nothing written
  const notes = path.join(lap.home, 'notes')
  fs.mkdirSync(notes, { recursive: true })
  const memo = pattern(18 * MB, 11)
  fs.writeFileSync(path.join(notes, 'memo.mov'), memo)
  fs.mkdirSync(path.join(lap.home, 'Movies', 'Trips'), { recursive: true })
  fs.writeFileSync(path.join(lap.home, 'Movies', 'Trips', 'beach.mp4'), pattern(2 * MB, 5))
  for (const k of [a, lap]) { k.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8')); await k.api('/agents/catalog') }
  const pane = (await a.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Renders', newSpace: 'Renders' })).paneId
  const lpane = (await lap.api('/agents/launch', { kind: 'claude', cwd: notes, label: 'Notes', newSpace: 'Notes' })).paneId

  // ---------- linked, both ways ----------
  const p = (await a.api('/relay/pair', {})).pairing
  await lap.api('/machines', { link: `${ra.url} ${p.code}` })
  const studio = await until(async () => (await lap.api('/machines')).machines.find((m) => m.name === 'Studio' && m.online), 30000, 300)
  const laptop = await until(async () => (await a.api('/machines')).machines.find((m) => m.name === 'Laptop' && m.online), 30000, 300)
  ok(!!studio && !!laptop, 'Laptop and Studio are linked, each way', { studio: !!studio, laptop: !!laptop })

  // ---------- Places: opt-in ----------
  await part('places and where a copy can go', async () => {
    ok((await lap.api('/places')).places.length === 0, 'a new install has no places')
    const dest = await lap.api('/transfers/here')
    ok(!!dest.downloads && /Downloads$/.test(dest.downloads.path) && dest.agents.some((x) => x.pane === lpane) && dest.free > 0, 'where a copy can go on Laptop: its Downloads, its agent\'s folder, with the room there', dest)
    if (sim) ok(!looked('Movies').length && !looked('Downloads').length, 'nothing in Laptop\'s Movies or Downloads has been looked at (no place picked, nothing copied there)', [...looked('Movies'), ...looked('Downloads')].slice(0, 3))
    else skip('nothing looked into a folder before it was picked', 'the stand-in for macOS\'s guarded folders takes POSIX paths')
  })

  // ---------- Studio to Laptop: Copy to this computer ----------
  // Through Studio's relay (Laptop's link to Studio), at 40 Mbit/s, so it takes a few seconds, and
  // every connection dropped a third of the way.
  const waitJob = (k, id, ms = 60000, step = 150) => until(async () => { const j = (await k.api('/transfers')).jobs.find((x) => x.id === id); return j && ['done', 'failed', 'stopped'].includes(j.state) ? j : null }, ms, step)
  const pullBody = { from: studio.id, src: { pane, path: 'final.mp4' }, into: { where: 'pane', pane: lpane } }
  const landed = path.join(notes, 'final.mp4')
  let job = null
  let dropped = false
  await part('Copy to this computer', async () => {
    await relayNet(ra, '?ms=10&host=5&kbps=40000')
    job = await lap.api('/transfers', pullBody)
    const seen = []
    const watch = until(async () => {
      const j = (await lap.api('/transfers')).jobs.find((x) => x.id === job.id)
      if (j) seen.push({ got: j.got, total: j.total, state: j.state })
      if (!dropped && j?.got > 8 * MB) { dropped = true; await ra.drop() }
      return j && ['done', 'failed', 'stopped'].includes(j.state) ? j : null
    }, 90000, 120)
    job = await watch
    await relayNet(ra)
    ok(job?.state === 'done' && fs.existsSync(landed) && shaFile(landed) === sha(files['final.mp4']), 'Copy to this computer: final.mp4 is on Laptop, the same bytes (SHA-256) as on Studio', { state: job?.state, error: job?.error })
    const ups = seen.filter((x) => x.got > 0 && x.got < x.total)
    ok(ups.length >= 3 && ups.every((x, i) => i === 0 || x.got >= ups[i - 1].got) && seen.every((x) => !x.total || x.total === files['final.mp4'].length), `its progress, along the way (${ups.length} looks between the start and the end)`, seen.slice(0, 6))
    ok(dropped && job?.resumes >= 1 && job.resumedAt > 4 * MB, `the connection dropped at ${(8).toFixed(0)} MB and it carried on from ${((job?.resumedAt || 0) / MB).toFixed(1)} MB, not from the start`, { resumes: job?.resumes, resumedAt: job?.resumedAt })
    ok(job?.checked === 'sha256' && job.result?.where === 'notes' && job.result.path.endsWith('final.mp4'), 'checked against Studio\'s SHA-256, and it says where it landed', job?.result)
    ok(!fs.readdirSync(notes).some((n) => n.endsWith('.part')), 'nothing half-copied is left in the folder')
  })

  // The same again: the name is taken, so it's "final 2.mp4", and the first is untouched.
  await part('a name that\'s taken', async () => {
    job = await waitJob(lap, (await lap.api('/transfers', pullBody)).id)
    ok(job?.state === 'done' && job.result?.name === 'final 2.mp4' && job.result.renamed && shaFile(path.join(notes, 'final 2.mp4')) === sha(files['final.mp4']) && shaFile(landed) === sha(files['final.mp4']), 'the name is taken there: it lands as "final 2.mp4", and the first one is untouched', job?.result || job)

  })
  // A folder: its files, and the empty folder in it.
  await part('a folder', async () => {
    job = await waitJob(lap, (await lap.api('/transfers', { from: studio.id, src: { pane, path: 'shots' }, into: { where: 'pane', pane: lpane } })).id)
    const got = path.join(notes, 'shots')
    const same = ['one.png', 'two.png', 'notes.txt'].every((n) => fs.existsSync(path.join(got, n)) && shaFile(path.join(got, n)) === sha(files[`shots/${n}`]))
    ok(job?.state === 'done' && job.dir && job.count === 3 && same && fs.statSync(path.join(got, 'empty')).isDirectory(), 'a folder: its three files, the same bytes, and the empty folder in it', job)

  })
  // No room: said before anything is written, with how much is needed and free.
  await part('no room', async () => {
    const r = await fetch(`${lap.url}/api/transfers/in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'big-one', name: 'huge.mov', files: [{ size: 2 ** 52 }], to: { where: 'pane', pane: lpane } }) })
    const j = await r.json()
    ok(r.status === 507 && j.code === 'space' && /isn't room for huge\.mov on Laptop: it needs .* and .* is free/.test(j.error) && !fs.readdirSync(notes).some((n) => n.includes('huge')), 'a copy that can\'t fit on Laptop: turned down first, saying how much it needs and how much is free, nothing written', { s: r.status, j })

  })

  // ---------- Laptop to Studio: Send to ----------
  await part('Send to', async () => {
    await relayNet(ra, '?ms=10&host=5&kbps=40000')
    job = await lap.api('/transfers', { to: studio.id, src: { pane: lpane, path: 'memo.mov' }, into: { where: 'pane', pane } })
    dropped = false
    job = await until(async () => {
      const x = (await lap.api('/transfers')).jobs.find((y) => y.id === job.id)
      if (!dropped && x?.got > 6 * MB) { dropped = true; await ra.drop() }
      return x && ['done', 'failed', 'stopped'].includes(x.state) ? x : null
    }, 90000, 120)
    await relayNet(ra)
    ok(job?.state === 'done' && fs.existsSync(path.join(work, 'memo.mov')) && shaFile(path.join(work, 'memo.mov')) === sha(memo), 'Send to Studio: memo.mov is there, the same bytes', { state: job?.state, error: job?.error })
    ok(dropped && job?.resumes >= 1 && job.resumedAt > 0 && job.checked === 'sha256', `the connection dropped on the way and it carried on from ${((job?.resumedAt || 0) / MB).toFixed(1)} MB, checked against Laptop's SHA-256 there`, job)
    const inStudio = (await a.api('/transfers')).incoming.find((x) => x.name === 'memo.mov')
    ok(inStudio?.state === 'done' && inStudio.from === 'Laptop' && inStudio.into === 'renders', 'Studio lists it, from Laptop, in its renders folder', inStudio)
  })

  // ---------- Downloads, on a Mac, from elsewhere ----------
  if (IS_MAC) {
    await part('Downloads on a Mac, from elsewhere', async () => {
      job = await waitJob(a, (await a.api('/transfers', { to: laptop.id, src: { pane, path: 'clip.mp4' }, into: { where: 'downloads' } })).id)
      ok(job?.state === 'failed' && job.code === 'ask' && /macOS hasn't let Bridge AI put files in Downloads on Laptop/.test(job.error), 'a copy from Studio into Laptop\'s Downloads, which macOS hasn\'t asked about there yet: it says so instead of bringing up the question with nobody there', job)
      if (sim) ok(!looked('Downloads').length, 'and nothing looked into Laptop\'s Downloads', looked('Downloads'))
      const plan = await a.api(`/transfers/plan?to=${laptop.id}&pane=${enc(pane)}&path=clip.mp4`)
      ok(plan.destinations.downloads?.asks === true && plan.here === false, 'the dialog for it is told Downloads asks first on Laptop', plan.destinations.downloads)
    })
  } else skip('a copy from elsewhere into Downloads waits for macOS\'s question', 'only a Mac guards Downloads')

  // ---------- the hosted relay ----------
  await part('the hosted relay', async () => {
    let plan = await lap.api(`/transfers/plan?from=${studio.id}&pane=${enc(pane)}&path=final.mp4`)
    ok(plan.hosted === true && plan.what?.total === files['final.mp4'].length && plan.here === true, 'Laptop\'s link to Studio goes through Bridge AI\'s relay: the dialog is told so, with the size, and that it\'s for this computer', plan)
    plan = await a.api(`/transfers/plan?to=${laptop.id}&pane=${enc(pane)}&path=final.mp4`)
    ok(plan.hosted === false, 'Studio\'s link to Laptop doesn\'t (Laptop\'s own relay)', plan.hosted)
  })

  // ---------- Places: added only here ----------
  const movies = path.join(lap.home, 'Movies')
  await part('places added only here', async () => {
    const r = await fetch(`${lap.url}/m/${studio.id}/api/places`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: path.join(a.home, 'renders') }) })
    ok(r.status === 403 && !(await a.api('/places')).places.length, 'another device can\'t add a place on Studio (through its link)', r.status)
  })
  // (The phone's try, and adding one in the app with the folder picker, are below.)

  // In Docker (stood in for), Downloads isn't somewhere you'd find a file: it isn't offered, and a
  // copy there is turned down.
  await part('Docker', async () => {
    const dock = await startKit('files-across-docker', { env: { BRIDGE_DOCKER: '1', BRIDGE_COMPUTER_NAME: 'Box' } })
    try {
      const here = await dock.api('/transfers/here')
      const r = await fetch(`${dock.url}/api/transfers/in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'dock', name: 'a.mov', files: [{ size: 10 }], to: { where: 'downloads' } }) })
      const j = await r.json()
      ok(here.downloads === null && r.status === 400 && /Docker/.test(j.error) && !fs.existsSync(path.join(dock.home, 'Downloads')), 'in Docker, Downloads isn\'t offered, and a copy there is turned down', { here: here.downloads, s: r.status, j })
    } finally { dock.stop() }
  })

  // ---------- the app ----------
  // Laptop's window: Studio's Files in it (/m/), Copy to this computer.
  const ctx = await b.newContext({ viewport: { width: 1280, height: 820 } })
  await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-appearance', JSON.stringify({ mode: 'light', theme: 'sky', text: 'm' })) } catch { /* no storage */ } })
  // The desktop app's folder picker, stood in for: it picks Laptop's Movies.
  await ctx.addInitScript((movies) => { if (!/^\/m\//.test(location.pathname)) window.bridgeApp = { desktop: true, platform: 'darwin', pickFolder: async (start, o) => { window.__picked = o; return movies } } }, movies)
  const errors = []
  const pg = await ctx.newPage()
  // (WebKit reports a request cut off by going to another page as an error of the page's.)
  pg.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errors.push(e.message) })
  // The agent's Files (at a file), asked again until it's there: the page may still be loading its agents.
  const filesAt = async (pgOrFrame, paneId, file) => {
    await pgOrFrame.waitForFunction(() => !!document.querySelector('.app'), null, { timeout: 30000 }).catch(() => {})
    return until(async () => {
      await pgOrFrame.evaluate((p) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: p } })), paneId)
      await sleep(400)
      await pgOrFrame.evaluate(({ p, f }) => window.dispatchEvent(new CustomEvent('cc-set-view', { detail: { paneId: p, view: 'files', path: f } })), { p: paneId, f: file })
      await sleep(400)
      return pgOrFrame.evaluate((f) => !!document.querySelector('.files-view .tree-scroll') && (!f || [...document.querySelectorAll('.viewer .crumbs b')].some((b) => b.textContent.includes(f))), file)
    }, 25000, 200)
  }
  await part('Copy to this computer, in the app', async () => {
    await pg.goto(`${lap.url}/m/${studio.id}/`)
    await filesAt(pg, pane, 'clip.mp4')
    const head = pg.locator('.viewer .copy-here')
    ok(await head.waitFor({ timeout: 20000 }).then(() => true, () => false) && /Copy to this computer/.test(await head.innerText()), 'Studio\'s video in Laptop\'s window: the viewer offers Copy to this computer, beside its player')
    ok(await pg.locator('.media-view video').waitFor({ timeout: 10000 }).then(() => true, () => false), 'and plays it, as it is on Studio')
    await head.click()
    const dlg = pg.locator('.xfer-dialog')
    await dlg.waitFor({ timeout: 10000 })
    await dlg.locator('select').first().waitFor({ timeout: 15000 })
    const intoText = await dlg.innerText()
    ok(/Copy clip\.mp4 to this computer/.test(intoText) && /Into/i.test(intoText) && /Downloads/.test(intoText) && /notes/.test(await dlg.locator('select').first().innerHTML()), 'the dialog: Copy clip.mp4 to this computer, Into: Laptop\'s Downloads or its agent\'s folder', intoText.slice(0, 300))
    await dlg.locator('select').first().selectOption(`pane:${lpane}`)
    await shot(pg, `${tag}files-across-copy-dialog`)
    await dlg.locator('button[type=submit]').click()
    const row = pg.locator('.xfer-row', { hasText: 'clip.mp4' }).first()
    ok(await row.locator('.xfer-sub', { hasText: /Copied from Studio, in notes/ }).waitFor({ timeout: 30000 }).then(() => true, () => false), 'it shows below the tree as it goes, then "Copied from Studio, in notes"', await row.innerText().catch(() => ''))
    ok(fs.existsSync(path.join(notes, 'clip.mp4')) && shaFile(path.join(notes, 'clip.mp4')) === shaFile(path.join(work, 'clip.mp4')), 'and it\'s in Laptop\'s notes folder, the same bytes')
    const reveal = row.locator('button', { hasText: /Show in (Finder|Explorer|file manager)/ })
    ok(await reveal.isVisible().catch(() => false), 'with Show in Finder (Explorer, the file manager): it\'s on this computer')
    await reveal.click().catch(() => {})
    await shot(pg, `${tag}files-across-copied`)

    // Send to…, from the right-click menu.
    await pg.locator('.tree-row', { hasText: 'final.mp4' }).first().click({ button: 'right' })
    const items = await pg.locator('.ctx-menu').innerText()
    ok(/Copy to this computer/.test(items) && /Send to…/.test(items), 'a file\'s menu has Copy to this computer and Send to…', items)
    await pg.keyboard.press('Escape')

    // A big one through Bridge AI's hosted relay: the dialog says so first, and what to use instead.
    await pg.locator('.tree-row', { hasText: 'big.mov' }).first().click({ button: 'right' })
    await pg.locator('.ctx-menu button', { hasText: 'Copy to this computer' }).click()
    const note = pg.locator('.xfer-dialog .xfer-note')
    const said = await note.innerText({ timeout: 15000 }).catch(() => '')
    ok(/Bridge AI's relay, which carries 512 MB a day for Studio/.test(said) && /your own Cloudflare account/.test(said) && /Tailscale/.test(said) && /100\.0 MB/.test(await pg.locator('.xfer-dialog .xfer-what').innerText()), 'a 100 MB copy through Bridge AI\'s hosted relay: the dialog says it carries 512 MB a day, and suggests your own relay or Tailscale', said)
    await shot(pg, `${tag}files-across-hosted`)
    await pg.locator('.xfer-dialog button', { hasText: 'Cancel' }).click()
  })

  // Laptop's own Files, with Studio's agent in a tab beside it: a file dragged from Studio's Files
  // into Laptop's is copied here.
  await part('a file dragged in from another device', async () => {
    await pg.goto(`${lap.url}/`)
    await filesAt(pg, lpane, null)
    await pg.locator('.files-view .tree-scroll').first().waitFor({ timeout: 15000 })
    const drop = await pg.evaluate(({ machine, pane }) => {
      const dt = new DataTransfer()
      dt.setData('application/x-bridge-file', JSON.stringify({ machine, pane, path: 'shots/two.png', name: 'two.png', dir: false, size: 512000 }))
      const el = document.querySelector('.files-view .tree-scroll')
      const taken = !el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
      return { taken }
    }, { machine: studio.id, pane })
    const dragged = await until(() => fs.existsSync(path.join(notes, 'two.png')) && shaFile(path.join(notes, 'two.png')) === sha(files['shots/two.png']), 30000, 200)
    ok(drop.taken && dragged, 'a file dragged in from Studio\'s Files is copied into Laptop\'s, the same bytes', { drop, toast: await pg.locator('.tree-toast').innerText().catch(() => ''), jobs: (await lap.api('/transfers')).jobs.slice(0, 2) })

  })

  // Places in Files: the menu at the top of the tree, the picker, and the folder's files.
  await part('Places in the app', async () => {
    await filesAt(pg, lpane, null)
    if (sim) ok(!looked('Movies').length, 'until a place is picked, Movies is never looked at', looked('Movies'))
    await pg.locator('.tree-root-pick').click()
    const pm = pg.locator('.places-menu')
    ok(/Add a place…/.test(await pm.innerText()), 'the top of the tree: the agent\'s folder, and Add a place…', await pm.innerText())
    await pm.locator('button', { hasText: 'Add a place…' }).click()
    await pg.locator('.tree-root-pick', { hasText: 'Movies' }).waitFor({ timeout: 10000 })
    await pg.locator('.tree-row', { hasText: 'Trips' }).click()
    const beach = await pg.locator('.tree-row', { hasText: 'beach.mp4' }).waitFor({ timeout: 10000 }).then(() => true, () => false)
    ok(beach && (await lap.api('/places')).places.some((x) => x.name === 'Movies') && (await pg.evaluate(() => window.__picked?.place)) === true, 'Add a place… opens the folder picker; Movies is a place, and its files show in Files', await lap.api('/places'))
    if (sim) ok(looked('Movies').length > 0, 'and only now is Movies looked at', looked('Movies').length)
    await pg.locator('.tree-root-pick').click()
    const ph = await pg.locator('.places-menu .places-head').textContent().catch(() => '')
    ok(ph === 'Places' && /Movies/.test(await pg.locator('.places-menu').innerText()), 'the menu lists it under Places (Title Case)', ph)
    await shot(pg, `${tag}files-across-places`)
    await pg.keyboard.press('Escape')
    const wide = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(wide <= 1, 'nothing wider than the window', wide)
  })

  // A notification about a video an agent made: its words name the file, and the link opens it in
  // Files, where it plays.
  await part('a notification about a video', async () => {
    const { mediaNamed } = await import(pathToFileURL(path.join(ROOT, 'shared', 'media.js')).href)
    const named = [mediaNamed('Rendered the cut to out/final.mp4 (3 min).', '/w'), mediaNamed('Saved it as /w/renders/take two.mov', '/w'), mediaNamed('Wrote /w/clips/a.webm.', '/w'), mediaNamed('Done: see notes.md', '/w'), mediaNamed('Copied it to /tmp/x.mp4', '/w')]
    ok(JSON.stringify(named) === JSON.stringify(['out/final.mp4', null, 'clips/a.webm', null, null]), 'the video or sound an agent\'s last words name, inside its folder (nothing else)', named)
    await pg.goto(`${lap.url}/?agent=${enc(lpane)}&file=clip.mp4`)
    const opened = await pg.locator('.viewer .crumbs b', { hasText: 'clip.mp4' }).waitFor({ timeout: 20000 }).then(() => true, () => false)
    const plays = opened && await pg.locator('.media-view video').waitFor({ timeout: 10000 }).then(() => true, () => false)
    ok(opened && plays && !/[?&]file=/.test(pg.url()), 'the notification\'s link (?agent=…&file=clip.mp4) opens the agent\'s Files at the video, in its player', { opened, plays, url: pg.url() })
  })

  // ---------- the phone ----------
  await part('the phone', async () => {
    const code = (await a.api('/relay/pair', {})).pairing.code
    const pctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: which === 'chromium', hasTouch: true, deviceScaleFactor: 2 })
    await pctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-appearance', JSON.stringify({ mode: 'light', theme: 'sky', text: 'm' })) } catch { /* no storage */ } })
    const phone = await pctx.newPage()
    phone.on('pageerror', (e) => errors.push(e.message))
    await phone.goto(`${ra.url}/#pair=${code}`, { waitUntil: 'commit' })
    const app = () => phone.frames().find((f) => f !== phone.mainFrame() && f.url().startsWith(ra.url))
    ok(!!(await until(() => app()?.evaluate(() => fetch('/api/version').then((x) => x.ok)), 30000, 200)), 'the phone is paired with Studio, Bridge AI open in it')
    const fromPhone = await app().evaluate(() => fetch('/api/places', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '~' }) }).then((x) => x.status))
    ok(fromPhone === 403, 'a phone can\'t add a place to Studio', fromPhone)
    await filesAt(app(), pane, null)
    const up = app().locator('.tree-head button[aria-label="Send files from this device"]')
    ok(await up.waitFor({ timeout: 20000 }).then(() => true, () => false), 'on the phone, Files has Send files from this device')
    // A video and a photo from the phone's library (the file input, as the picker hands them over).
    const vid = pattern(5 * MB + 12345, 21)
    const pic = pattern(700 * 1024, 22)
    await app().locator('input[data-testid="send-files"]').setInputFiles([{ name: 'IMG_0042.MOV', mimeType: 'video/quicktime', buffer: vid }, { name: 'IMG_0043.HEIC', mimeType: 'image/heic', buffer: pic }])
    const sheet = app().locator('.xfer-dialog')
    await sheet.locator('select').waitFor({ timeout: 15000 })
    const sheetText = await sheet.innerText()
    ok(/Send 2 files to Studio/.test(sheetText) && (await sheet.locator('select').inputValue()) === `pane:${pane}`, 'the sheet: Send 2 files to Studio, into the project Files shows', { sheetText: sheetText.slice(0, 200), v: await sheet.locator('select').inputValue() })
    const sheetWide = await app().evaluate(() => { const d = document.querySelector('.xfer-dialog').getBoundingClientRect(); return { r: d.right, w: window.innerWidth, s: document.documentElement.scrollWidth - window.innerWidth } })
    ok(sheetWide.r <= sheetWide.w && sheetWide.s <= 1, 'it fits the phone\'s screen', sheetWide)
    await shot(phone, `${tag}files-across-phone-sheet`)
    // At a phone's speed (16 Mbit/s), so its progress shows along the way.
    await relayNet(ra, '?ms=30&host=10&kbps=16000')
    await sheet.locator('button[type=submit]').click()
    const prog = []
    const sent = await until(async () => {
      const t = await app().locator('.xfer-strip').innerText().catch(() => '')
      const m = /(\d+(?:\.\d+)?) (MB|KB) of 5\.0 MB/.exec(t)
      if (m) prog.push(m[1])
      return fs.existsSync(path.join(work, 'IMG_0043.HEIC')) && /Sent to Studio, in renders/.test(t) ? t : null
    }, 60000, 100)
    ok(!!sent && shaFile(path.join(work, 'IMG_0042.MOV')) === sha(vid) && shaFile(path.join(work, 'IMG_0043.HEIC')) === sha(pic), 'from the phone: the video and the photo are in the project on Studio, the same bytes', sent)
    await relayNet(ra)
    ok(prog.length >= 1, `with their progress as they went (${prog.length} looks)`, prog)
    const phoneWide = await app().evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(phoneWide <= 1, 'nothing wider than the phone\'s screen', phoneWide)
    await shot(phone, `${tag}files-across-phone-sent`)
    const viaPhone = (await a.api('/transfers')).incoming.find((x) => x.name === 'IMG_0042.MOV')
    ok(viaPhone?.state === 'done' && viaPhone.fromKind === 'phone', 'Studio lists it as from the phone', viaPhone)
  })

  ok(!errors.length, 'no page errors', errors.slice(0, 3))
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-2500))
} finally {
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  await b.close().catch(() => {})
}
process.exit(done().fail ? 1 : 0)
