// Studio's home (src/components/files/, server/explorer.js): every folder on your computers, as
// Finder shows them, with Studio's own lists beside them. Two Bridge AIs ("Desk" and "Laptop"), each
// on its own relay, linked. On Desk
// Desktop, Documents and iCloud Drive act like macOS's guarded folders (scripts/tcc-sim.mjs: each
// look into one is held a moment and written down) and Downloads like one you said no to. Checked:
//   the server: with no Beta Feature on (and with one saved off from before), the home folder and the drives are roots
//   to read, and the sidebar names your usual folders, cloud drives, projects, places and drives
//   without looking into any folder macOS asks about; a folder as Finder lists it (hidden ones
//   only when asked for); what's refused (a path up, a link out, Bridge AI's own folder and your
//   keys from any root, a drive that isn't there, a root that isn't one); nothing written through
//   these roots (a save, a rename, Trash, a git change, a copy into them); Open in its app and Show
//   in Finder (stand-ins); Get Info and a folder's size; a search below a folder, bounded and
//   stopped when it's no longer wanted; from another computer, a folder macOS hasn't asked about
//   isn't read; and another site can't load a page's files through these roots;
//   the app: Studio in the sidebar (no Folders or Files row), its home's own sidebar (Studio's
//   lists, then the folders); the list, sorted by name and size; one click picking a file or a
//   folder in the list, icons, columns and Studio's lists, with Studio's bar and the path as they
//   were, and a double-click or Enter opening it; the path you
//   click and back and forward (buttons and keys); Quick Look with Space and the arrow keys; Get
//   Info and a folder's size; renaming and Trash shown as coming; hidden files; icons with pictures
//   of pictures and PDFs, at a size each folder keeps (⌘+, ⌘−, ⌘0, the slider, Use as Defaults);
//   Arrange By and Group by Kind; folders marked as a Mac marks them (Desktop, a cloud drive, a
//   project) and documents' first pages and decks' first slides as their icons, but none on a cloud
//   drive; columns with a file's preview; a search and its Stop; a document opened
//   in Studio's editor, a page of code in Quick Look and a picture in its own app (a stand-in); Recent
//   and New on the home (a new file in the folder shown); Assist's panel; macOS asking about a folder
//   you open (said, with nothing frozen meanwhile) and one it was refused (said, with how to allow
//   it); Laptop's files from Desk, through the link; Folders' old places (a tab, a link, the phone's
//   More) landing in Studio's home at the folder; and on a phone, one column at a time, with Studio
//   the one entry in More.
// Pictures in light and dark and at a phone's width are in test/.out/shots (files-ui-*): icons at
// three sizes, the list and groups at 1440 and 390 px wide in each.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import JSZip from 'jszip'
import { startKit, startRelay, checks, until, browser, page, shot, phoneFaults, sleep, noServiceWorker, ROOT, TEST, IS_MAC, IS_WIN } from '../lib/harness.mjs'
import { richDocx } from '../lib/wordfile.mjs'
import { deckPptx, boardSlides } from '../lib/deckfile.mjs'

const { ok, skip, done } = checks('files-ui')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const enc = encodeURIComponent
const MOD = IS_MAC ? 'Meta' : 'Control'
const HOME = 'home' // the home folder's root, as the file routes name it

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
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 40 100 Td (Hello PDF) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
// What a stand-in for macOS's open (xdg-open on Linux) was asked to open, a line each.
const OPENER = "const fs = require('fs'); const path = require('path'); fs.appendFileSync(path.join(__dirname, 'opened.log'), JSON.stringify(process.argv.slice(2)) + '\\n')\n"

const relays = []
const kits = []
// Each part on its own: one that breaks is a failed check, and the rest go on.
const part = async (name, fn) => {
  try { await fn() } catch (e) {
    // What it was waiting for, and where in this file.
    const lines = String(e.message).split('\n')
    const waiting = lines.find((l) => /waiting for /.test(l))?.trim().replace(/\x1b\[\d+m/g, '')
    const at = /files-ui\.mjs:(\d+)/.exec(e.stack || '')?.[1]
    ok(false, `${name}: ${lines[0]}${waiting ? ` (${waiting})` : ''}${at ? ` at files-ui.mjs:${at}` : ''}`)
  }
}
// The answer to a request as it came: its status and JSON.
const ask = async (base, p, opts = {}) => { const r = await fetch(`${base}/api${p}`, opts); return { s: r.status, j: await r.json().catch(() => ({})) } }
try {
  const ra = await startRelay('files-ui-desk')
  const rb = await startRelay('files-ui-laptop')
  relays.push(ra, rb)
  const kitWith = async (name, rel, more = () => ({}), config = {}) => {
    const k = await startKit(`files-ui-${name.toLowerCase()}`, { config, env: (dirs) => { fs.writeFileSync(path.join(dirs.data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, BRIDGE_FILES_WAIT_MS: '800', ...more(dirs) } } })
    kits.push(k)
    await k.api('/setup', { name: 'Tester' })
    return k
  }
  // The guarded folders: each look held HOLD ms (a real Mac holds the first until you answer). Off a
  // Mac nothing is guarded: there, a folder that's slow to answer (Far/Slow, as a network drive can be).
  const sim = !IS_WIN
  const HOLD = 1500
  const desk = await kitWith('Desk', ra, ({ home }) => (sim ? {
    NODE_OPTIONS: `--import ${pathToFileURL(path.join(ROOT, 'scripts', 'tcc-sim.mjs')).href}`, SIM_LOG: '1', SIM_MS: String(HOLD),
    ...(IS_MAC ? { SIM_PROTECTED: ['Desktop', 'Documents', path.join('Library', 'Mobile Documents')].map((d) => path.join(home, d)).join(':'), SIM_DENY: path.join(home, 'Downloads') }
      : { SIM_PROTECTED: path.join(home, 'Far', 'Slow') }),
  } : {}))
  const lap = await kitWith('Laptop', rb, () => ({}))
  const looked = (dir) => (desk.log().match(/\[tcc-sim\] (HELD|FROZE) .*/g) || []).filter((l) => l.includes(path.join(desk.home, dir)))
  const opened = () => { try { return fs.readFileSync(path.join(desk.bin, 'opened.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
  desk.program(IS_MAC ? 'open' : 'xdg-open', OPENER)

  // ---------- the files ----------
  const h = desk.home
  const put = (rel, data) => { fs.mkdirSync(path.dirname(path.join(h, rel)), { recursive: true }); fs.writeFileSync(path.join(h, rel), data) }
  put('Desktop/todo.txt', 'call the bank\n')
  put('Far/Slow/todo.txt', 'call the bank\n')
  put('Documents/Taxes/notes-2025.txt', 'receipts\n')
  put('Downloads/setup.dmg', 'x'.repeat(100))
  put('Projects/site/index.html', '<!doctype html><link rel="stylesheet" href="style.css"><h1>Site</h1>')
  put('Projects/site/style.css', 'h1 { color: teal }\n')
  put('Projects/site/notes.md', '# Site notes\n\nLaunch on *Friday*.\n')
  put('Projects/site/img/logo.png', png(64, 64, [200, 80, 40]))
  put('Projects/budget.csv', 'item,cost\nhosting,12\n')
  put('Pictures/sky.png', png(400, 300, [40, 120, 200]))
  put('Pictures/sea.png', png(300, 400, [20, 160, 120]))
  put('Pictures/scan.pdf', PDF)
  put('big.bin', Buffer.alloc(2 * 1024 * 1024))
  put('notes.txt', 'hello there\n')
  put('.secret-note', 'shh')
  put('.ssh/id_test', 'PRIVATE KEY')
  for (let i = 0; i < 330; i++) put(`Archive/batch${i % 6}/match-${String(i).padStart(3, '0')}.txt`, `${i}`)
  // Names as a Mac's own apps often write them, decomposed (é as e and its accent, デ as テ and its mark).
  put('Archive/Café menu.txt'.normalize('NFD'), 'soup\n')
  put('Archive/データ分析レポート.xlsx'.normalize('NFD'), 'x')
  const DEEP = 'Clients/Very long folder name for the first level/Another quite long folder name here/Third level folder with a long name/Fourth/Site visit photos'
  put(`${DEEP}/leaf.txt`, 'leaf\n')
  for (let i = 0; i < 1500; i++) fs.mkdirSync(path.join(h, 'Deep', `a${i % 30}`, `b${i}`), { recursive: true }) // a search that takes a moment
  fs.mkdirSync(path.join(h, 'Music'), { recursive: true })
  fs.mkdirSync(path.join(h, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), { recursive: true })
  fs.mkdirSync(path.join(h, 'Library', 'CloudStorage', 'OneDrive-Personal'), { recursive: true })
  fs.mkdirSync(path.join(h, 'Library', 'CloudStorage', 'GoogleDrive-Work'), { recursive: true })
  // Documents of each kind, for their icons: a Word file's first page, one with Office's own picture
  // of itself in it, a deck's first slide, a Markdown file's first lines; and one on a cloud drive
  // (Dropbox, in the home folder anywhere), never read for its icon.
  const pictured = await JSZip.loadAsync(await richDocx({ pages: 1 }))
  pictured.file('docProps/thumbnail.png', png(120, 160, [200, 40, 160]))
  put('Docs/Plan.docx', await richDocx({ pages: 1 }))
  put('Docs/Pictured.docx', await pictured.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  put('Docs/Review.pptx', await deckPptx({ slides: boardSlides(2) }))
  put('Docs/Readme.md', '# Read me first\n\nWhat this folder is for, and who keeps it.\n')
  put('Docs/scan.pdf', PDF)
  put('Docs/budget.csv', 'item,cost\nhosting,12\n')
  put('Docs/song.mp3', 'x')
  put('Docs/backup.zip', 'x')
  put('Docs/data.json', '{}\n')
  fs.mkdirSync(path.join(h, 'Docs', 'Drafts'), { recursive: true })
  put('Dropbox/Away.md', '# Away\n\nOnly in the cloud.\n')
  let linked = false
  try { fs.symlinkSync(desk.data, path.join(h, 'escape'), IS_WIN ? 'junction' : 'dir'); linked = true } catch { /* no links here */ }
  const sizeOf = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? sizeOf(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0)
  const siteBytes = sizeOf(path.join(h, 'Projects', 'site'))
  fs.mkdirSync(path.join(lap.home, 'Notes'), { recursive: true })
  fs.writeFileSync(path.join(lap.home, 'Notes', 'todo.md'), '# Laptop todo\n\nBuy *milk*.\n')

  // An agent at work in the site, and Pictures added as a place.
  desk.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await desk.api('/agents/catalog')
  await desk.api('/agents/launch', { kind: 'claude', cwd: path.join(h, 'Projects', 'site'), label: 'Site', newSpace: 'Site' })
  await desk.api('/places', { path: path.join(h, 'Pictures') })

  // Linked: Laptop to Desk, and so each way.
  const pairing = (await desk.api('/relay/pair', {})).pairing
  await lap.api('/machines', { link: `${ra.url} ${pairing.code}` })
  const deskOnLap = await until(async () => (await lap.api('/machines')).machines.find((m) => m.name === 'Desk' && m.online), 30000, 300)
  const lapOnDesk = await until(async () => (await desk.api('/machines')).machines.find((m) => m.name === 'Laptop' && m.online), 30000, 300)
  ok(!!deskOnLap && !!lapOnDesk, 'Desk and Laptop are linked, each way')

  // ---------- the server ----------
  await part('part of the app', async () => {
    // A Files switch saved off from before it was part of the app: read by nothing.
    await desk.api('/settings', { trials: { files: false } }, 'PATCH')
    // (Asked as Folders' page asks: its own listing doesn't look into a folder macOS asks about.)
    const side = await ask(desk.url, '/files/sidebar')
    const home = await ask(desk.url, `/files/list?root=${HOME}&path=`)
    ok(side.s === 200 && home.s === 200 && !('files' in ((await desk.api('/config')).trials || {})), 'with no Beta Feature on (Files saved off from before, read by nothing), its routes and its roots answer', { side: side.s, home: home.s })
  })
  let side = null
  await part('the sidebar', async () => {
    side = await desk.api('/files/sidebar')
    const names = (l) => (l || []).map((x) => x.label)
    ok(side.home.root === 'home' && side.home.path === '' && side.drives.length > 0 && side.drives.some((d) => d.boot), 'the sidebar: Home, and this computer\'s drives (its startup disk among them)', { home: side.home, drives: side.drives })
    ok(side.projects.some((x) => x.label === 'Site' || /site$/.test(x.full)) && names(side.places).includes('Pictures'), 'your projects (an agent\'s folder) and places (Pictures)', { projects: side.projects, places: side.places })
    if (IS_MAC) {
      const fav = Object.fromEntries(side.favorites.map((x) => [x.label, x]))
      ok(['Desktop', 'Documents', 'Downloads'].every((f) => fav[f]?.root === 'home' && fav[f]?.path === f && fav[f]?.guard === f && fav[f]?.asked === false), 'on a Mac: Desktop, Documents and Downloads, each said to be one macOS asks about', side.favorites)
      const clouds = Object.fromEntries(side.clouds.map((x) => [x.label, x]))
      ok(clouds['iCloud Drive']?.guard === 'iCloud Drive' && clouds.OneDrive?.account === 'Personal' && clouds['Google Drive']?.account === 'Work', 'iCloud Drive and the cloud drives in ~/Library/CloudStorage, named from their folders', side.clouds)
      ok(!looked('Desktop').length && !looked('Documents').length && !looked('Library/Mobile Documents').length && !looked('Downloads').length, 'and none of the folders macOS asks about was looked into to make it', [...looked('Desktop'), ...looked('Documents'), ...looked('Downloads')].slice(0, 3))
    } else skip('Desktop, Documents, Downloads and iCloud Drive as macOS guards them', 'a Mac\'s')
  })
  await part('a folder', async () => {
    const home = await desk.api('/files/list?root=home&path=')
    const names = home.entries.map((e) => e.name)
    // Finder hides your Library; elsewhere a folder named Library is any other folder.
    ok(['Projects', 'Pictures', 'notes.txt', 'big.bin'].every((n) => names.includes(n)) && !names.includes('.secret-note') && !names.includes('.ssh') && names.includes('Library') === !IS_MAC, `the home folder, as ${IS_MAC ? 'Finder' : 'the file manager'} lists it: no hidden files (${IS_MAC ? 'nor your Library' : 'a folder named Library shown'})`, names)
    const txt = home.entries.find((e) => e.name === 'notes.txt')
    ok(txt && txt.size === 12 && txt.mtime > 0 && txt.dir === false && home.top && home.full, 'each with its size and when it changed', txt)
    if (IS_MAC) { const d = home.entries.find((e) => e.name === 'Desktop'); ok(d?.dir && d.size == null && d.mtime == null && d.guard === 'Desktop', 'Desktop listed without a look into it (no size or date until it\'s opened)', d) }
    const all = (await desk.api('/files/list?root=home&path=&hidden=1')).entries.map((e) => e.name)
    ok(all.includes('.secret-note') && all.includes('.ssh'), 'hidden files when they\'re asked for', all)
    const drive = side.drives.find((d) => d.boot) || side.drives[0]
    const top = await ask(desk.url, `/files/list?root=${enc(drive.root)}&path=`)
    ok(top.s === 200 && top.j.entries.length > 0, `a drive is a root too (${drive.label})`, { s: top.s, n: top.j.entries?.length, e: top.j.error })
  })
  await part('what\'s refused', async () => {
    const r = {
      up: await ask(desk.url, '/files/list?root=home&path=..%2F..'),
      keys: await ask(desk.url, '/files/list?root=home&path=.ssh&hidden=1'),
      keyFile: await fetch(`${desk.url}/api/agents/${HOME}/raw?path=${enc('.ssh/id_test')}`).then(async (x) => ({ s: x.status, t: await x.text() })),
      noDrive: await ask(desk.url, '/files/list?root=drive%3Anope&path='),
      notARoot: await ask(desk.url, `/files/list?root=${enc(path.join(h, 'Projects'))}&path=`),
    }
    if (linked) r.link = await ask(desk.url, '/files/list?root=home&path=escape')
    const drive = side.drives.find((d) => d.boot)
    const own = drive && path.relative(drive.full, desk.data)
    if (own && !own.startsWith('..')) {
      r.own = await ask(desk.url, `/files/list?root=${enc(drive.root)}&path=${enc(own.split(path.sep).join('/'))}`)
      r.ownFile = await fetch(`${desk.url}/api/agents/${enc(drive.root)}/raw?path=${enc(`${own.split(path.sep).join('/')}/config.json`)}`).then(async (x) => ({ s: x.status, t: await x.text() }))
    }
    ok(r.up.s === 403 && r.up.j.code === 'outside', 'a path up and out of the home folder is refused', r.up)
    ok(r.keys.s === 403 && r.keys.j.code === 'keptOut' && r.keyFile.s === 404 && !r.keyFile.t.includes('PRIVATE KEY'), 'your keys (.ssh) are kept out, listed or read', { keys: r.keys, file: r.keyFile.s })
    ok(r.noDrive.s === 404 && r.notARoot.s === 404, 'a drive that isn\'t here, or a folder that isn\'t a root, is refused', { noDrive: r.noDrive, notARoot: r.notARoot })
    if (linked) ok(r.link.s === 403 && r.link.j.code === 'outside', 'a link out of the home folder is refused', r.link)
    if (r.own) ok(r.own.s === 403 && r.own.j.code === 'keptOut' && r.ownFile.s === 404 && !r.ownFile.t.includes('keepAgents'), 'Bridge AI\'s own folder is kept out, from the drive\'s root too', { own: r.own, file: r.ownFile.s })
  })
  await part('nothing written', async () => {
    const send = (p, method, body) => ask(desk.url, p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const tries = {
      save: await send(`/agents/${HOME}/file`, 'PUT', { path: 'notes.txt', text: 'changed' }),
      rename: await send(`/agents/${HOME}/fileop`, 'POST', { op: 'rename', path: 'notes.txt', name: 'gone.txt' }),
      trash: await send(`/agents/${HOME}/fileop`, 'POST', { op: 'trash', path: 'notes.txt' }),
      folder: await send(`/agents/${HOME}/fileop`, 'POST', { op: 'newFolder', path: '', name: 'New' }),
      discard: await send(`/agents/${HOME}/discard`, 'POST', { path: 'notes.txt' }),
    }
    ok(Object.values(tries).every((x) => x.s === 403 && x.j.code === 'readOnly'), 'nothing is saved, renamed, moved to the Trash, made or undone through Files\' roots', tries)
    ok(fs.readFileSync(path.join(h, 'notes.txt'), 'utf8') === 'hello there\n' && !fs.existsSync(path.join(h, 'New')), 'and the files are as they were')
    // Nor copied into: a copy from Laptop into Desk's home folder stops, saying so.
    const job = await desk.api('/transfers', { from: lapOnDesk.id, src: { pane: 'home', path: 'Notes/todo.md' }, into: { where: 'pane', pane: 'home' } })
    const after = await until(async () => (await desk.api('/transfers')).jobs?.find((j) => j.id === job.id && j.state !== 'going'), 15000, 300)
    ok(after && after.state !== 'done' && /read-only/.test(after.error || '') && !fs.existsSync(path.join(h, 'todo.md')), 'nor is a copy made into them', after)
  })
  await part('open in its app, show in Finder', async () => {
    if (IS_WIN) { skip('Open in its app and Show in Explorer', 'Explorer can\'t be stood in for'); return }
    const o = await ask(desk.url, `/agents/${HOME}/fileop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'open', path: 'Pictures/sky.png' }) })
    const r = await ask(desk.url, `/agents/${HOME}/fileop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'reveal', path: 'notes.txt' }) })
    const got = opened()
    ok(o.s === 200 && got.some((a) => a.at(-1) === fs.realpathSync.native(path.join(h, 'Pictures', 'sky.png'))), 'Open in its app opens it on this computer (a stand-in)', { o, got })
    ok(r.s === 200 && got.some((a) => (IS_MAC ? a[0] === '-R' && a[1] === fs.realpathSync.native(path.join(h, 'notes.txt')) : a[0] === fs.realpathSync.native(h))), 'Show in Finder shows it there', { r, got })
  })
  await part('Get Info and a folder\'s size', async () => {
    const i = await desk.api('/files/info?root=home&path=notes.txt')
    ok(i.name === 'notes.txt' && i.size === 12 && i.dir === false && i.modified > 0 && i.where === '~' && i.writable === true && i.full === fs.realpathSync.native(path.join(h, 'notes.txt')), 'Get Info: its size, where, when it changed, and that you can change it', i)
    const s = await desk.api('/files/size?root=home&path=Projects%2Fsite')
    ok(s.size === siteBytes && s.files === 4 && s.folders === 1 && !s.partial, `a folder's size, worked out when asked: ${siteBytes} bytes in 4 files`, s)
    const all = await desk.api('/files/size?root=home&path=')
    if (IS_MAC) ok(['Desktop', 'Documents', 'Downloads', 'Library'].every((n) => all.skipped.includes(n)), 'the home folder\'s size doesn\'t go into a folder macOS would ask about, nor your Library, and says so', all)
    else ok(all.size > 2 * 1024 * 1024 && !all.partial, 'the home folder\'s size, all of it', all)
  })
  await part('a search', async () => {
    const s = await desk.api('/files/search?root=home&path=&q=notes')
    const found = s.results.map((x) => x.path)
    ok(found.includes('Projects/site/notes.md') && found.includes('notes.txt') && s.results.find((x) => x.path === 'Projects/site/notes.md')?.where === 'Projects/site', 'a search finds names in a folder and below it, with where each is', s.results)
    if (IS_MAC) ok(!found.some((x) => x.startsWith('Documents/')) && s.skipped.includes('Documents') && !looked('Documents').length, 'and doesn\'t go into a folder macOS hasn\'t asked about (Documents), saying so', { found, skipped: s.skipped })
    // Typed composed (as a keyboard types them), found in names written decomposed.
    const accents = await desk.api(`/files/search?root=home&path=Archive&q=${encodeURIComponent('café')}`)
    const kana = await desk.api(`/files/search?root=home&path=Archive&q=${encodeURIComponent('データ')}`)
    ok(accents.results.length === 1 && kana.results.length === 1, 'a search finds "café" and "データ" in names a Mac wrote decomposed', { accents: accents.results.map((x) => x.name), kana: kana.results.map((x) => x.name) })
    const many = await desk.api('/files/search?root=home&path=Archive&q=match-')
    ok(many.results.length === 300 && many.partial, 'bounded: the first 300, said to be only part', { n: many.results.length, partial: many.partial })
    const ctl = new AbortController()
    const left = fetch(`${desk.url}/api/files/search?root=home&path=Deep&q=zzz`, { signal: ctl.signal }).catch((e) => e.name)
    setTimeout(() => ctl.abort(), 20)
    const t0 = Date.now()
    const gone = await left
    const after = await ask(desk.url, '/version')
    ok(gone === 'AbortError' && after.s === 200 && Date.now() - t0 < 2000, 'a search left part way is let go, and the server carries on', { left: typeof gone === 'string' ? gone : `answered ${gone?.status}`, version: after.s, ms: Date.now() - t0 })
  })
  await part('from another computer', async () => {
    const M = `${lap.url}/m/${deskOnLap.id}`
    const site = await ask(M, '/files/list?root=home&path=Projects%2Fsite')
    ok(site.s === 200 && site.j.entries.some((e) => e.name === 'notes.md'), 'Laptop lists Desk\'s folders through the link', site.s)
    if (IS_MAC) {
      const before = looked('Desktop').length
      const d = await ask(M, '/files/list?root=home&path=Desktop')
      const raw = await fetch(`${M}/api/agents/${HOME}/raw?path=${enc('Desktop/todo.txt')}`).then((x) => x.status)
      ok(d.s === 403 && d.j.code === 'notAsked' && /Allow/.test(d.j.error) && raw === 403 && looked('Desktop').length === before, 'but not one macOS hasn\'t asked about yet: nobody\'s at Desk to answer, so it isn\'t looked into, and it says so', { d, raw })
    } else skip('a folder macOS hasn\'t asked about, from another computer', 'a Mac\'s')
  })
  await part('another site', async () => {
    const at = `${desk.url}/api/agents/${HOME}/site/Projects/site/style.css`
    const cross = await fetch(at, { headers: { 'sec-fetch-site': 'cross-site' } }).then((x) => x.status)
    const own = await fetch(at, { headers: { 'sec-fetch-site': 'cross-site', referer: `${desk.url}/api/agents/${HOME}/site/Projects/site/index.html` } }).then((x) => x.status)
    ok(cross === 403 && own === 200, 'a page\'s files load into Bridge AI\'s own preview, not into another site\'s page', { cross, own })
  })

  // ---------- the app ----------
  const rows = (p) => p.locator('.fx-body .fx-row').evaluateAll((els) => els.map((e) => e.dataset.name))
  const crumbs = (p) => p.locator('.fx-path .fx-crumb').allInnerTexts()
  // Without the app's service worker: in WebKit, the requests of a page it's in charge of pass the
  // test's routes by (a search held to be stopped wasn't held).
  const { p, errors } = await page(b, desk.url, { width: 1440, height: 900, before: noServiceWorker })
  const shots = []
  // (After what's opening has faded in.)
  const snap = async (name) => { await sleep(300); await shot(p, `${tag}files-ui-${name}`); shots.push(name) }
  await part('Studio in the sidebar', async () => {
    await p.locator('.rail-nav-btn', { hasText: 'Studio' }).waitFor({ timeout: 15000 })
    const navs = await p.locator('.rail-nav-btn').allInnerTexts()
    ok(navs.some((x) => x.trim() === 'Studio') && !navs.some((x) => /^\s*(Files|Folders)\s*$/.test(x)), 'the sidebar has Studio, and no Folders or Files row', navs)
    await p.locator('.rail-nav-btn', { hasText: 'Studio' }).click()
    ok(await p.locator('.fx.sd-home .fx-side-row[data-shelf="recent"][aria-current="location"]').waitFor({ timeout: 15000 }).then(() => true, () => false), 'Studio opens at Recent, its first list, in the sidebar of its home')
    ok((await p.locator('.sd-home > .pane-head h2').innerText().catch(() => '')).trim() === 'Studio' && /Studio/.test(await p.locator('.ws-tab.main').innerText().catch(() => '')), 'its page and its tab are called Studio', { head: await p.locator('.sd-home > .pane-head h2').innerText().catch(() => ''), tab: await p.locator('.ws-tab.main').innerText().catch(() => '') })
    // Its sidebar comes on its own (/api/files/sidebar), after the folder now and then (Windows in
    // CI): whole, with a placeholder until then, never Locations alone to jump down under the rest.
    const early = await p.locator('.fx-side-sec h3').allInnerTexts()
    ok(!early.filter((h) => h !== 'Studio').length || early.includes('Favorites'), 'its sidebar comes whole, not Locations first and the rest above it after', early)
    await p.locator('.fx-side-sec h3', { hasText: 'Favorites' }).waitFor({ timeout: 15000 }).catch(() => {})
    const sections = await p.locator('.fx-side-sec h3').allInnerTexts()
    const shelves = await p.locator('.fx-side-row[data-shelf]').evaluateAll((els) => els.map((e) => e.dataset.shelf))
    ok(sections[0] === 'Studio' && JSON.stringify(shelves) === JSON.stringify(['recent', 'kind:doc', 'kind:deck', 'kind:sheet', 'kind:pdf', 'kind:page', 'kind:board', 'packs', 'signature', 'shared']), 'Studio\'s lists first: Recent, each kind, Design Packs, Your Signature and Shared', { sections, shelves })
    await p.locator('.fx-side-row[data-label="Home"]').click()
    ok(await p.locator('.fx .fx-row[data-name="Projects"]').waitFor({ timeout: 15000 }).then(() => true, () => false), 'Home in its sidebar: your home folder')
    const sideRows = await p.locator('.fx-side-row').evaluateAll((els) => els.map((e) => e.dataset.label || e.dataset.computer))
    ok(['Favorites', 'Projects', 'Places', 'Locations'].every((s) => sections.includes(s)) && sideRows.includes('Home') && sideRows.includes('Pictures') && sideRows.includes('Laptop') && (!IS_MAC || ['Desktop', 'Documents', 'Downloads', 'iCloud Drive', 'OneDrive'].every((n) => sideRows.includes(n))), 'then the folders: Favorites, cloud drives, Projects, Places and Locations (drives, and Laptop)', { sections, sideRows })
    if (IS_MAC) ok(!looked('Desktop').length && !looked('Documents').length && !looked('Downloads').length && !looked('Library/Mobile Documents').length, 'nothing macOS asks about has been looked into: the page, the sidebar and the home folder never read them')
    await snap('home')
  })
  await part('the list, sorted', async () => {
    const byName = await rows(p)
    ok(byName.indexOf('Archive') < byName.indexOf('Projects') && byName.indexOf('big.bin') < byName.indexOf('notes.txt') && byName.indexOf('Projects') < byName.indexOf('big.bin'), 'by name, folders first', byName)
    await p.locator('.fx-th', { hasText: 'Size' }).click()
    const bySize = await rows(p)
    const files = bySize.filter((n) => ['big.bin', 'notes.txt'].includes(n))
    ok(files[0] === 'big.bin' && (await p.locator('.fx-th[aria-sort="descending"]', { hasText: 'Size' }).count()) === 1, 'by size, biggest first, the header saying so', bySize)
    await p.locator('.fx-th', { hasText: 'Name' }).click()
    await p.locator('.fx-th', { hasText: 'Name' }).click()
    const desc = await rows(p)
    ok(desc.indexOf('Projects') < desc.indexOf('Archive') && desc.indexOf('notes.txt') < desc.indexOf('big.bin'), 'by name the other way', desc)
    await p.locator('.fx-th', { hasText: 'Name' }).click()
  })
  // Studio's bar (its header: Studio, Files and Preview, New), the folder's bar and its path, and
  // whether a file is open in the editor: what a click mustn't change.
  const barNow = async () => JSON.stringify({
    head: await p.locator('.sd-home > .pane-head').innerText().catch(() => null), crumbs: await crumbs(p),
    tools: await p.locator('.fx-bar button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.innerText.trim())), editor: await p.locator('.sd-file').count(),
  })
  const picked = (sel) => p.locator(sel).getAttribute('aria-selected').catch(() => null)
  await part('one click picks, and the bar stays put', async () => {
    const was = await barNow()
    await p.locator('.fx-row[data-name="notes.txt"]').click()
    ok(await picked('.fx-row[data-name="notes.txt"]') === 'true' && await barNow() === was, 'the list: one click picks a file, and Studio\'s bar, the folder\'s and its path stay as they were', { was, now: await barNow() })
    await p.locator('.fx-row[data-name="Projects"]').click()
    ok(await picked('.fx-row[data-name="Projects"]') === 'true' && await picked('.fx-row[data-name="notes.txt"]') === 'false' && await barNow() === was, 'a folder too: picked, not opened')
    await p.keyboard.press('Enter')
    ok(!!(await until(async () => (await crumbs(p)).join(' › ') === 'Home › Projects', 6000)), 'Enter opens the one picked', await crumbs(p))
    await p.keyboard.press(`${MOD}+ArrowUp`)
    await p.locator('.fx-row[data-name="Projects"][aria-selected="true"]').waitFor({ timeout: 6000 })
  })
  await part('the path, back and forward', async () => {
    await p.locator('.fx-row[data-name="Projects"]').dblclick()
    await p.locator('.fx-row[data-name="site"]').dblclick()
    await p.locator('.fx-row[data-name="notes.md"]').waitFor({ timeout: 8000 })
    ok((await crumbs(p)).join(' › ') === 'Home › Projects › site', 'a double-click opens a folder, and the path says where you are', await crumbs(p))
    await p.locator('.fx-path .fx-crumb', { hasText: 'Home' }).click()
    await p.locator('.fx-row[data-name="Projects"]').waitFor()
    ok((await crumbs(p)).join(' › ') === 'Home', 'a click on the path goes there')
    await p.locator('.fx-bar button[aria-label="Back"]').click()
    await p.locator('.fx-row[data-name="notes.md"]').waitFor({ timeout: 8000 })
    await p.locator('.fx-bar button[aria-label="Forward"]').click()
    await p.locator('.fx-row[data-name="Projects"]').waitFor({ timeout: 8000 })
    ok((await crumbs(p)).join(' › ') === 'Home', 'Back and Forward')
    await p.locator('.fx-body').focus()
    await p.keyboard.press(`${MOD}+BracketLeft`)
    await p.locator('.fx-row[data-name="notes.md"]').waitFor({ timeout: 8000 })
    await p.keyboard.press(`${MOD}+ArrowUp`)
    await p.locator('.fx-row[data-name="site"]').waitFor({ timeout: 8000 })
    ok((await crumbs(p)).join(' › ') === 'Home › Projects' && (await p.locator('.fx-row[data-name="site"][aria-selected="true"]').count()) === 1, 'and as Finder\'s keys: ⌘[ back, ⌘↑ up to the folder it\'s in, with the one you were in picked', await crumbs(p))
    await p.locator('.fx-row[data-name="site"]').dblclick()
  })
  await part('Quick Look', async () => {
    await p.locator('.fx-row[data-name="notes.md"]').click()
    await p.keyboard.press('Space')
    ok(await p.locator('.fx-ql .md-view h1', { hasText: 'Site notes' }).waitFor({ timeout: 8000 }).then(() => true, () => false), 'Space: Quick Look, the Markdown as it reads')
    await snap('quicklook')
    await p.keyboard.press('ArrowDown')
    ok(!!(await until(async () => /style\.css/.test(await p.locator('.fx-ql-title b').innerText().catch(() => '')) && (await p.locator('.fx-ql .code-view').count()) === 1, 8000)), 'the arrow keys: the next one, shown as it is (code)')
    await p.keyboard.press('ArrowUp')
    await p.keyboard.press('ArrowUp')
    ok(!!(await until(async () => /index\.html/.test(await p.locator('.fx-ql-title b').innerText().catch(() => '')) && (await p.locator('.fx-ql iframe.html-view').count()) === 1, 8000)), 'and back up: a page in its sandbox')
    await p.keyboard.press('Space')
    ok(!!(await until(async () => (await p.locator('.fx-ql').count()) === 0, 4000)), 'Space again closes it')
  })
  await part('Get Info', async () => {
    await p.locator('.fx-row[data-name="notes.md"]').click()
    await p.keyboard.press(`${MOD}+i`)
    const info = p.locator('.fx-info')
    ok(!!(await until(async () => { const x = await info.innerText().catch(() => ''); return /34 bytes/.test(x) && /Modified/.test(x) && /Where/.test(x) && /Markdown document/.test(x) }, 8000)), 'Get Info (⌘I): its kind, size, where it is, when it changed', await info.innerText().catch(() => ''))
    ok(await info.locator('button:disabled').count() === 0 && !/coming/i.test(await info.innerText()), 'no buttons that can\'t be used yet (nothing "coming")', await info.innerText().catch(() => ''))
    // Esc closes it, opened from the keyboard (focus still on the folder), as its Close says.
    await p.keyboard.press('Escape')
    ok(!!(await until(async () => !(await info.count()), 3000)) && await p.locator('.fx-row[data-name="notes.md"][aria-selected="true"]').count() === 1, 'Esc closes Get Info opened with ⌘I (what\'s picked stays picked)', await info.count())
    await p.keyboard.press(`${MOD}+i`)
    await info.waitFor({ timeout: 4000 })
    await info.locator('button[aria-label="Close Info"]').click()
    await p.locator('.fx-path .fx-crumb', { hasText: 'Projects' }).click()
    await p.locator('.fx-row[data-name="site"]').click()
    await p.locator('.fx-bar button[aria-label="Get Info"]').click()
    await info.locator('button', { hasText: 'Work out its size' }).click()
    const said = await until(async () => info.locator('[data-size]').getAttribute('data-size').catch(() => null), 10000)
    ok(Number(said) === siteBytes, `a folder's size when you ask for it (${siteBytes} bytes)`, said)
    await snap('info')
    await info.locator('button[aria-label="Close Info"]').click()
  })
  await part('the menu', async () => {
    await p.locator('.fx-row[data-name="budget.csv"]').click({ button: 'right' })
    const menu = p.locator('.ctx-menu')
    await menu.waitFor({ timeout: 4000 })
    const items = await menu.locator('button').evaluateAll((els) => els.map((e) => `${e.querySelector('span')?.innerText.trim()}${e.disabled ? ' (off)' : ''}`))
    ok(items.includes('Get Info') && items.includes('Copy path') && !items.some((x) => / \(off\)$|coming/.test(x)), 'right-click: Get Info, Copy path, and nothing that can\'t be used yet', items)
    await p.keyboard.press('Escape')
  })
  await part('hidden files', async () => {
    await p.locator('.fx-side-row[data-label="Home"]').click()
    await p.locator('.fx-row[data-name="notes.txt"]').waitFor()
    ok((await p.locator('.fx-row[data-name=".secret-note"]').count()) === 0, 'hidden files aren\'t shown at first')
    await p.locator('.fx-bar button[aria-label="Show hidden files"]').click()
    ok(await p.locator('.fx-row[data-name=".secret-note"]').waitFor({ timeout: 8000 }).then(() => true, () => false), 'shown when you ask')
    await p.locator('.fx-bar button[aria-label="Hide hidden files"]').click()
    ok(!!(await until(async () => (await p.locator('.fx-row[data-name=".secret-note"]').count()) === 0, 8000)), 'and hidden again')
  })
  await part('icons', async () => {
    await p.locator('.fx-side-row[data-label="Pictures"]').first().click()
    await p.locator('.fx-bar button[aria-label="As icons"]').click()
    const pic = await until(() => p.locator('.fx-tile[data-name="sky.png"] img').evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false), 10000)
    const pdf = await until(() => p.locator('.fx-tile[data-name="scan.pdf"] canvas').evaluate((c) => c.width > 0).catch(() => false), 15000)
    ok(!!pic && !!pdf, 'as icons: a picture of each picture and of the PDF', { pic, pdf })
    await snap('icons')
  })
  // The icons' size, as each folder keeps it (its View Options), from their box.
  const iconSize = () => p.locator('.fx-icons').evaluate((e) => parseFloat(getComputedStyle(e).getPropertyValue('--fx-icon'))).catch(() => null)
  const tiles = () => p.locator('.fx-icons .fx-tile').evaluateAll((els) => els.map((e) => e.dataset.name))
  const options = p.locator('.fx-vo')
  await part('icons: a click picks, and each folder keeps its size', async () => {
    const was = await barNow()
    await p.locator('.fx-tile[data-name="sea.png"]').click()
    ok(await picked('.fx-tile[data-name="sea.png"]') === 'true' && await barNow() === was && (await p.locator('.fx-ql').count()) === 0, 'icons: one click picks one, and the bars stay as they were', { was, now: await barNow() })
    await p.keyboard.press('ArrowLeft')
    ok(await picked('.fx-tile[data-name="scan.pdf"]') === 'true', 'the arrow keys go from icon to icon')
    ok(await iconSize() === 64 && await p.locator('.fx-bar .fx-size input').inputValue().catch(() => null) === '64', 'at first the usual size, 64 px, with Finder\'s slider in the bar', await iconSize())
    await p.keyboard.press(`${MOD}+Equal`)
    await p.keyboard.press(`${MOD}+Equal`)
    ok(!!(await until(async () => await iconSize() === 96, 3000)) && await p.locator('.fx-bar .fx-size input').inputValue() === '96', '⌘+ twice: 96 px, the slider with it', await iconSize())
    await p.locator('.fx-side-row[data-label="Home"]').click()
    await p.locator('.fx-tile[data-name="Projects"]').waitFor({ timeout: 8000 })
    ok(await iconSize() === 64, 'another folder keeps its own (the defaults\'): 64 px', await iconSize())
    await p.locator('.fx-side-row[data-label="Pictures"]').first().click()
    await p.locator('.fx-tile[data-name="sky.png"]').waitFor({ timeout: 8000 })
    ok(await iconSize() === 96, 'and Pictures is still 96 px', await iconSize())
    // Use as Defaults: every folder without its own size shows Pictures' now.
    await p.locator('.fx-bar button[aria-label="View Options"]').click()
    ok(await options.waitFor({ timeout: 4000 }).then(() => true, () => false) && /Arrange By/.test(await options.innerText()) && /Group by Kind/.test(await options.innerText()) && await options.locator('input[type="range"]').count() === 1 && /Text Size/.test(await options.innerText()),
      'View Options: Arrange By, Group by Kind, the icon size and the text size', await options.innerText().catch(() => ''))
    await options.locator('button', { hasText: 'Use as Defaults' }).click()
    ok(await options.locator('button', { hasText: 'These Are the Defaults' }).isDisabled().catch(() => false), 'Use as Defaults: it says these are the defaults now')
    await p.keyboard.press('Escape')
    ok(!!(await until(async () => (await options.count()) === 0, 3000)), 'Esc closes View Options')
    await p.locator('.fx-side-row[data-label="Home"]').click()
    await p.locator('.fx-tile[data-name="Projects"]').waitFor({ timeout: 8000 })
    ok(!!(await until(async () => await iconSize() === 96, 3000)), 'Home, with no size of its own: the defaults, 96 px', await iconSize())
    // ⌘0: the usual size, for this folder alone.
    await p.locator('.fx-tile[data-name="Projects"]').click()
    await p.keyboard.press(`${MOD}+0`)
    ok(!!(await until(async () => await iconSize() === 64, 3000)), '⌘0 back to 64 px here', await iconSize())
    await p.locator('.fx-bar .fx-size input').fill('160')
    ok(!!(await until(async () => await iconSize() === 160, 3000)), 'the slider: 160 px', await iconSize())
    const kept = await p.evaluate(() => ({ folders: JSON.parse(localStorage.getItem('cc-fx-folders') || '{}'), look: JSON.parse(localStorage.getItem('cc-fx-look') || '{}') }))
    ok(kept.folders['\nhome\n']?.icon === 160 && kept.look.icon === 96, 'kept on this device: Home\'s own size, and the defaults', kept)
    // (Home back to the defaults, as the rest of the test expects it.)
    await p.locator('.fx-bar button[aria-label="View Options"]').click()
    await options.locator('button', { hasText: 'Use the Defaults' }).click()
    await p.keyboard.press('Escape')
    ok(!!(await until(async () => await iconSize() === 96, 3000)), 'Use the Defaults: Home lets go of its own size', await iconSize())
  })
  await part('Arrange By and Group by Kind', async () => {
    await p.locator('.fx-row[data-name="Docs"], .fx-tile[data-name="Docs"]').first().dblclick()
    await p.locator('.fx-tile[data-name="Plan.docx"]').waitFor({ timeout: 8000 })
    ok(JSON.stringify(await tiles()) === '["Drafts","backup.zip","budget.csv","data.json","Pictured.docx","Plan.docx","Readme.md","Review.pptx","scan.pdf","song.mp3"]', 'by name at first, folders first', await tiles())
    await p.locator('.fx-bar button[aria-label="View Options"]').click()
    const arrange = options.locator('select').first()
    const offered = await arrange.evaluate((s) => [...s.options].map((o) => o.value))
    const made = (await desk.api('/files/list?root=home&path=Docs')).entries.some((e) => e.btime)
    ok(['name', 'kind', 'mtime', 'size'].every((x) => offered.includes(x)) && (made ? offered.includes('btime') : !offered.includes('btime') && /Date Created isn't offered/.test(await options.innerText())),
      made ? 'Arrange By: Name, Kind, Date Modified, Date Created and Size' : 'Arrange By: Name, Kind, Date Modified and Size; Date Created isn\'t offered, and it says why (this disk doesn\'t keep it)', offered)
    await arrange.selectOption('kind')
    ok(!!(await until(async () => JSON.stringify(await tiles()) === '["Drafts","song.mp3","budget.csv","data.json","Readme.md","scan.pdf","Review.pptx","Pictured.docx","Plan.docx","backup.zip"]', 3000)), 'Arrange By Kind: folders, then each kind by its name', await tiles())
    await arrange.selectOption('size')
    const bySize = await tiles()
    ok(bySize[0] === 'Drafts' && bySize.indexOf('Review.pptx') < bySize.indexOf('data.json') && bySize.indexOf('Plan.docx') < bySize.indexOf('song.mp3'), 'Arrange By Size: the biggest first', bySize)
    await arrange.selectOption('kind')
    await options.locator('label', { hasText: 'Group by Kind' }).click()
    const groups = () => p.locator('.fx-icons .fx-icon-group').evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-label')}:${e.querySelectorAll('.fx-tile').length}`))
    ok(!!(await until(async () => JSON.stringify(await groups()) === '["Folder:1","Audio:1","CSV table:1","JSON:1","Markdown document:1","PDF document:1","PowerPoint presentation:1","Word document:2","ZIP archive:1"]', 3000))
      && /Word document\s*2/.test(await p.locator('.fx-icon-group[aria-label="Word document"] .fx-group-h').innerText()), 'Group by Kind: a section for each kind, under its name, folders first', await groups())
    await p.keyboard.press('Escape')
    await snap('grouped')
    // Down a row from the only folder: into the next group.
    await p.locator('.fx-tile[data-name="Drafts"]').click()
    await p.keyboard.press('ArrowDown')
    ok(await picked('.fx-tile[data-name="Drafts"]') === 'false' && (await p.locator('.fx-tile[aria-selected="true"]').count()) === 1, '↓ goes down a row, across groups', await p.locator('.fx-tile[aria-selected="true"]').getAttribute('data-name').catch(() => null))
    // The list in the same groups, each under its kind's name.
    await p.locator('.fx-bar button[aria-label="As list"]').click()
    const heads = await p.locator('.fx-list .fx-group .fx-group-h').evaluateAll((els) => els.map((e) => e.firstChild.textContent))
    ok(JSON.stringify(heads) === '["Folder","Audio","CSV table","JSON","Markdown document","PDF document","PowerPoint presentation","Word document","ZIP archive"]' && (await p.locator('.fx-list [role="rowgroup"]').count()) === 9, 'as a list, the same groups, each under its kind\'s name', heads)
    await snap('grouped-list')
    // Kept for Docs alone.
    await p.locator('.fx-path .fx-crumb', { hasText: 'Home' }).click()
    await p.locator('.fx-row[data-name="Projects"]').waitFor({ timeout: 8000 })
    ok((await p.locator('.fx-list .fx-group').count()) === 0, 'another folder isn\'t grouped: Docs keeps its own')
    await p.locator('.fx-row[data-name="Docs"]').dblclick()
    ok(await p.locator('.fx-list .fx-group').first().waitFor({ timeout: 8000 }).then(() => true, () => false), 'and Docs is still grouped, back in it')
    await p.locator('.fx-bar button[aria-label="As icons"]').click()
  })
  await part('folders as a Mac draws them, and documents\' first pages', async () => {
    const asked = []
    const watch = (r) => { if (/\/raw\?path=Dropbox/.test(r.url())) asked.push(r.url()) }
    p.on('request', watch)
    // Docs, as icons (from the part before): each document's first page or slide, made once it's on
    // screen (each scrolled to: the groups go on below).
    const see = (name) => p.locator(`.fx-tile[data-name="${name}"]`).scrollIntoViewIfNeeded().catch(() => {})
    const page = (name) => p.locator(`.fx-tile[data-name="${name}"] .fx-sk-page`).innerText().catch(() => '')
    await see('Plan.docx')
    ok(!!(await until(async () => /Quarterly plan/.test(await page('Plan.docx')), 10000)), 'a Word file: its first page, in words', await page('Plan.docx'))
    await see('Review.pptx')
    ok(!!(await until(async () => /Northwind Annual Review/.test(await p.locator('.fx-tile[data-name="Review.pptx"] .fx-sk-slide b').innerText().catch(() => '')), 10000)), 'a deck: its first slide')
    await see('Pictured.docx')
    ok(!!(await until(() => p.locator('.fx-tile[data-name="Pictured.docx"] img').evaluate((i) => i.complete && i.naturalWidth === 120 && i.src.startsWith('blob:')).catch(() => false), 10000)), 'a Word file with its own picture of itself (Office\'s): that picture')
    await see('Readme.md')
    ok(!!(await until(async () => /Read me first/.test(await page('Readme.md')), 10000)), 'a Markdown file: its first lines')
    await see('budget.csv')
    ok(await p.locator('.fx-tile[data-name="budget.csv"] .fx-page.k-sheet .fx-page-ext').textContent() === 'CSV' && await p.locator('.fx-tile[data-name="Drafts"] .fx-fold .fx-fold-front').count() === 1, 'anything else: a page of its kind, with its extension; a folder, filled with its tab')
    // Home: Desktop, Documents and Downloads marked as a Mac marks them, Dropbox as a cloud drive.
    await p.locator('.fx-path .fx-crumb', { hasText: 'Home' }).click()
    await p.locator('.fx-tile[data-name="Projects"]').waitFor({ timeout: 8000 })
    const marked = await p.locator('.fx-tile').evaluateAll((els) => els.filter((e) => e.querySelector('.fx-fold-glyph')).map((e) => e.dataset.name))
    ok(['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Dropbox'].every((n) => marked.includes(n)) && !marked.includes('Archive') && !marked.includes('Docs'), 'the usual folders and a cloud drive marked, any other plain', marked)
    if (IS_MAC) ok(!looked('Desktop').length && !looked('Documents').length && !looked('Downloads').length, 'and drawn without a look into a folder macOS asks about')
    await p.locator('.fx-tile[data-name="Projects"]').dblclick()
    ok(await p.locator('.fx-tile[data-name="site"] .fx-fold-glyph').waitFor({ timeout: 8000 }).then(() => true, () => false), 'a project (an agent works in it): marked as one')
    await snap('marks')
    // A cloud drive: its documents aren't read for their icons (reading one would download it).
    await p.locator('.fx-path .fx-crumb', { hasText: 'Home' }).click()
    await p.locator('.fx-tile[data-name="Dropbox"]').dblclick()
    await p.locator('.fx-tile[data-name="Away.md"]').waitFor({ timeout: 8000 })
    await sleep(800)
    ok(await p.locator('.fx-tile[data-name="Away.md"] .fx-sketch').count() === 0 && await p.locator('.fx-tile[data-name="Away.md"] .fx-page').count() === 1 && !asked.length, 'on a cloud drive, a document\'s icon is its kind\'s, and nothing in it is read', asked)
    p.off('request', watch)
    await p.locator('.fx-path .fx-crumb', { hasText: 'Home' }).click()
  })
  await part('columns', async () => {
    await p.locator('.fx-side-row[data-label="Home"]').click()
    await p.locator('.fx-bar button[aria-label="As columns"]').click()
    await p.locator('.fx-col .fx-crow[data-name="Projects"]').click()
    await p.locator('.fx-col .fx-crow[data-name="site"]').click()
    await p.locator('.fx-col.last .fx-crow[data-name="notes.md"]').click()
    const cols = await until(async () => { const n = await p.locator('.fx-col:not(.fx-col-preview)').count(); return n === 3 && (await p.locator('.fx-col-preview', { hasText: 'notes.md' }).count()) === 1 && n }, 8000)
    ok(cols === 3 && (await crumbs(p)).join(' › ') === 'Home › Projects › site', 'as columns: each folder on the way beside the next, and the file picked shown at the end', { cols, crumbs: await crumbs(p) })
    ok(await picked('.fx-col.last .fx-crow[data-name="notes.md"]') === 'true' && await p.locator('.sd-file').count() === 0, 'one click picks the file there, and nothing opens')
    await snap('columns')
    await p.locator('.fx-body').focus()
    await p.keyboard.press('ArrowLeft')
    ok(!!(await until(async () => (await crumbs(p)).join(' › ') === 'Home › Projects', 6000)), '← goes up a column')
    await p.locator('.fx-bar button[aria-label="As list"]').click()
  })
  await part('a search', async () => {
    await p.locator('.fx-side-row[data-label="Home"]').click()
    await p.locator('.fx-search input').fill('notes')
    const found = await until(async () => { const r = await rows(p); return r.includes('notes.md') && r.includes('notes.txt') && r }, 10000)
    const where = await p.locator('.fx-row[data-name="notes.md"] .fx-c-where').innerText().catch(() => '')
    ok(!!found && where === 'Projects/site', 'a search in the folder and below it, with where each one is', { found, where })
    if (IS_MAC) ok(/Not looked in: .*Documents/.test(await p.locator('.fx-search-note').innerText()), 'and it says which folders it didn\'t go into (macOS would ask first)', await p.locator('.fx-search-note').innerText())
    await p.locator('.fx-row[data-name="notes.md"]').dblclick()
    ok(!!(await until(async () => /Launch on/.test(await p.locator('.sd-page .ProseMirror').innerText().catch(() => '')), 15000)), 'a double-click on a document opens it in Studio\'s editor')
    const tabs = await p.evaluate(() => JSON.parse(localStorage.getItem('cc-ws') || '{}').tabs || [])
    ok(tabs.length === 1 && tabs[0] === `view:studio:home:${enc('Projects/site/notes.md')}`, 'in the same place: Studio\'s tab, now the document', tabs)
    // Files, in its header: back to the folder it was opened from.
    await p.locator('.sd-file .sd-tabs [role="tab"]', { hasText: 'Files' }).click()
    ok(await p.locator('.fx.sd-home .fx-row[data-name="notes.txt"]').waitFor({ timeout: 8000 }).then(() => true, () => false) && (await crumbs(p)).join(' › ') === 'Home', 'Files in its header: back to the folder, as it was', await crumbs(p))
    await p.locator('.fx-search input').fill('')
    // Stop: a search that takes its time (held here until it's stopped), stopped.
    let letGo
    const held = new Promise((r) => { letGo = r })
    await p.route(/\/api\/files\/search/, async (r) => { await held; await r.continue().catch(() => {}) })
    await p.locator('.fx-search input').fill('match')
    const stop = p.locator('.fx-search-note button', { hasText: 'Stop' })
    ok(await stop.waitFor({ timeout: 5000 }).then(() => true, () => false), 'a search under way says so, with Stop')
    await stop.click()
    ok(/stopped part way/.test(await p.locator('.fx-search-note').innerText().catch(() => '')), 'Stop stops it, and says it stopped part way', await p.locator('.fx-search-note').innerText().catch(() => ''))
    letGo()
    await p.unroute(/\/api\/files\/search/)
    await p.locator('.fx-search input').fill('')
    await p.locator('.fx-row[data-name="notes.txt"]').waitFor()
  })
  await part('anything else in Quick Look', async () => {
    await p.locator('.fx-side-row[data-label="Home"]').click()
    await p.locator('.fx-row[data-name="Projects"]').dblclick()
    await p.locator('.fx-row[data-name="site"]').dblclick()
    await p.locator('.fx-row[data-name="style.css"]').dblclick()
    ok(await p.locator('.fx-ql .code-view').waitFor({ timeout: 8000 }).then(() => true, () => false) && /style\.css/.test(await p.locator('.fx-ql-title b').innerText()) && (await p.locator('.sd-file').count()) === 0,
      'a double-click on a file Studio doesn\'t edit (a stylesheet) shows it in Quick Look, over the folder', await p.locator('.fx-ql-title').innerText().catch(() => ''))
    await p.keyboard.press('Escape')
    ok(!!(await until(async () => (await p.locator('.fx-ql').count()) === 0, 4000)), 'and Esc closes it')
  })
  await part('Studio\'s lists: a click picks, a double-click or Enter opens', async () => {
    await p.locator('.fx-side-row[data-shelf="recent"]').click()
    const row = p.locator('.sd-shelf .sd-files-row', { hasText: 'notes.md' }).first()
    await row.waitFor({ timeout: 10000 })
    const was = await barNow()
    await row.locator('.sd-file-name').click()
    ok(await row.getAttribute('aria-selected') === 'true' && await barNow() === was && /notes\.md picked/.test(await p.locator('.sd-list-head').innerText()),
      'Recent: one click picks a file, says so, and Studio\'s bar and what\'s on screen stay as they were', { was, now: await barNow() })
    await snap('recent-picked')
    await p.keyboard.press('Space')
    ok(await p.locator('.fx-ql .md-view h1', { hasText: 'Site notes' }).waitFor({ timeout: 8000 }).then(() => true, () => false) && await barNow() === was, 'Space: Quick Look on it, over the list')
    await p.keyboard.press('Escape')
    await until(async () => (await p.locator('.fx-ql').count()) === 0, 4000)
    const rowsNow = await p.locator('.sd-shelf .sd-files-row[data-key]').count()
    if (rowsNow > 1) {
      const at = await p.locator('.sd-shelf .sd-files-row[data-key]').evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-selected') === 'true'))
      await p.keyboard.press(at ? 'ArrowUp' : 'ArrowDown')
      ok(await row.getAttribute('aria-selected') === 'false' && (await p.locator('.sd-shelf .sd-files-row[aria-selected="true"]').count()) === 1, 'the arrow keys go up and down the list')
      await p.keyboard.press(at ? 'ArrowDown' : 'ArrowUp')
    } else skip('the arrow keys in Studio\'s lists', 'Recent has one file here')
    ok(await row.getAttribute('aria-selected') === 'true', 'and back to it')
    await p.keyboard.press('Enter')
    ok(!!(await until(async () => /Launch on/.test(await p.locator('.sd-page .ProseMirror').innerText().catch(() => '')), 15000)), 'Enter opens it in Studio\'s editor')
    await p.locator('.sd-file .sd-tabs [role="tab"]', { hasText: 'Files' }).click()
    await row.waitFor({ timeout: 10000 })
    await row.locator('.sd-file-when').dblclick()
    ok(!!(await until(async () => /Launch on/.test(await p.locator('.sd-page .ProseMirror').innerText().catch(() => '')), 15000)), 'a double-click opens it too')
    await p.locator('.sd-file .sd-tabs [role="tab"]', { hasText: 'Files' }).click()
    await row.waitFor({ timeout: 10000 })
  })
  await part('Recent and New on the home', async () => {
    // Recent, in Studio's own lists: the document opened from the folder, with its folder said.
    await p.locator('.fx-side-row[data-shelf="recent"]').click()
    const row = p.locator('.sd-shelf .sd-files-row', { hasText: 'notes.md' }).first()
    ok(await row.waitFor({ timeout: 10000 }).then(() => true, () => false) && /~[/\\]Projects[/\\]site/.test(await row.locator('.sd-file-dir').innerText()), 'Recent lists the document opened from a folder, with where it is', await row.innerText().catch(() => ''))
    ok((await crumbs(p)).join(' › ') === 'Recent' && await p.locator('.fx-bar .fx-views').count() === 0 && await p.locator('.fx-bar button[aria-label="AI Assist"]').count() === 0, 'a list has its name in the path, without a folder\'s views or AI Assist', await crumbs(p))
    // Find a file, in the bar: through all of them.
    await p.locator('.fx-search input').fill('notes')
    ok(!!(await until(async () => /Matching “notes”/.test(await p.locator('.sd-list-head').innerText().catch(() => '')), 4000)), 'the bar\'s search finds a file by its name, through all of them')
    await p.locator('.fx-search input').fill('')
    // New, in the header: in the folder shown, which it offers first.
    await p.locator('.fx-side-row[data-label="Home"]').click()
    await p.locator('.fx-row[data-name="Projects"]').dblclick()
    await p.locator('.fx-row[data-name="site"]').waitFor({ timeout: 8000 })
    await p.locator('.sd-new-open').click()
    ok(JSON.stringify(await p.locator('.sd-new-menu [role="menuitem"]').allInnerTexts()) === '["Document","Markdown","Sheet","Deck","Page","Whiteboard"]', 'New, in Studio\'s header, from a folder: what it makes')
    await p.locator('.sd-new-menu [role="menuitem"]', { hasText: 'Markdown' }).click()
    const where = p.locator('.sd-new-form select')
    ok(await where.waitFor({ timeout: 4000 }).then(() => true, () => false) && /This folder \(Projects\)/.test(await where.evaluate((s) => s.options[s.selectedIndex]?.text || '')), 'its name and where, over the folder: this folder first', await where.evaluate((s) => [...s.options].map((o) => o.text)).catch(() => []))
    await p.locator('.sd-new-form input').fill('Plan')
    await p.locator('.sd-new-form button', { hasText: 'Make it' }).click()
    ok(!!(await until(() => fs.existsSync(path.join(h, 'Projects', 'Plan.md')), 10000)) && await p.locator('.sd-file').waitFor({ timeout: 15000 }).then(() => true, () => false), 'Make it: made in that folder, and open in the editor')
    await p.locator('.sd-file .sd-tabs [role="tab"]', { hasText: 'Files' }).click()
    ok(await p.locator('.fx-row[data-name="Plan.md"]').waitFor({ timeout: 8000 }).then(() => true, () => false), 'and there in the folder, back on the home')
  })
  await part('in its own app', async () => {
    if (IS_WIN) { skip('a picture opened in its own app', 'Explorer can\'t be stood in for'); return }
    const before = opened().length
    await p.locator('.fx-side-row[data-label="Pictures"]').first().click()
    await p.locator('.fx-row[data-name="sea.png"]').dblclick()
    const got = await until(() => opened().slice(before).find((a) => a.at(-1) === fs.realpathSync.native(path.join(h, 'Pictures', 'sea.png'))), 8000)
    ok(!!got && /Opened sea\.png in its app/.test(await p.locator('.fx-toast').innerText().catch(() => '')), 'a double-click on a picture opens it in its own app (a stand-in), and says so', opened())
  })
  await part('AI Assist', async () => {
    await p.locator('.fx-side-row[data-label="Home"]').click()
    await p.locator('.fx-row[data-name="Projects"]').dblclick()
    const wand = p.locator('.fx-bar button[aria-label="AI Assist"]')
    ok(await wand.evaluate((e) => !e.nextElementSibling), 'AI Assist is at the right end of the folder\'s bar')
    await wand.click()
    const items = await p.locator('.ai-menu button').allInnerTexts()
    ok(items.some((x) => /^Look over this folder/.test(x)) && items.some((x) => /^Suggest how to organize it/.test(x)), 'its menu: Look over this folder and Suggest how to organize it', items)
    await p.locator('.ai-menu button', { hasText: 'Look over this folder' }).click()
    const a = p.locator('.fx-assist')
    ok(await a.waitFor({ timeout: 4000 }).then(() => true, () => false) && (await a.getAttribute('data-root')) === 'home' && (await a.getAttribute('data-rel')) === 'Projects' && /Projects/.test(await a.locator('.fa-where').innerText().catch(() => '')) && await a.locator('.fa-promise').isVisible(), 'Assist opens beside the folder, for the folder on screen, saying it only looks', { root: await a.getAttribute('data-root').catch(() => null), rel: await a.getAttribute('data-rel').catch(() => null) })
    await until(async () => (await a.locator('.fa-state').count()) === 0, 8000)
    await snap('assist')
    // Beside it, the folder drops columns to fit, as it does on a narrow window, rather than scrolling sideways.
    for (const width of [1280, 1440]) {
      await p.setViewportSize({ width, height: 900 })
      await sleep(300)
      const fit = await p.locator('.fx-body').evaluate((e) => ({ sideways: e.scrollWidth - e.clientWidth, width: e.clientWidth }))
      ok(fit.sideways <= 1, `${width} wide: beside it, the folder's columns fit, with nothing to scroll sideways to`, fit)
    }
    await wand.click()
    await p.locator('.ai-menu button', { hasText: 'Look over this folder' }).click()
    ok(!!(await until(async () => (await p.locator('.fx-assist').count()) === 0, 4000)), 'picked again, Look over this folder closes it')
  })
  await part('a folder macOS asks about', async () => {
    if (!sim) { skip('a folder macOS asks about, or slow to answer', 'the stand-in for macOS\'s guarded folders takes POSIX paths'); return }
    // Every ping to the server while it's held: none waits.
    let worst = 0
    let pinging = true
    const pings = (async () => { while (pinging) { const t0 = Date.now(); await fetch(`${desk.url}/api/version`).catch(() => {}); worst = Math.max(worst, Date.now() - t0); await sleep(100) } })()
    if (IS_MAC) await p.locator('.fx-side-row[data-label="Desktop"]').click()
    else { await p.locator('.fx-side-row[data-label="Home"]').click(); await p.locator('.fx-row[data-name="Far"]').dblclick() }
    if (IS_MAC) {
      const said = await p.locator('.fx-asking').innerText({ timeout: 2000 }).catch(() => '')
      ok(/macOS is asking whether Bridge AI may open your Desktop folder/.test(said) && /Allow/.test(said) && /only to show it to you here/.test(said), 'opening Desktop: it says macOS is asking, and why Bridge AI wants in', said)
      await snap('asking')
    } else {
      ok(await p.locator('.fx-state[data-state="waiting"]').waitFor({ timeout: 6000 }).then(() => true, () => false), 'a folder slow to answer says so (no macOS here to ask)')
      await p.locator('.fx-row[data-name="Slow"]').dblclick({ timeout: HOLD * 6 + 8000 })
    }
    ok(await p.locator('.fx-row[data-name="todo.txt"]').waitFor({ timeout: HOLD * 6 + 8000 }).then(() => true, () => false), 'once it\'s answered, the folder')
    pinging = false
    await pings
    ok(worst < 1000 && !/\[tcc-sim\] FROZE/.test(desk.log()), `and nothing froze meanwhile (the slowest answer from the server took ${worst} ms)`, desk.log().match(/\[tcc-sim\] FROZE.*/g))
    if (!IS_MAC) return
    await p.locator('.fx-side-row[data-label="Downloads"]').click()
    const refused = p.locator('.fx-state[data-state="refused"]')
    const text = await refused.innerText({ timeout: 8000 }).catch(() => '')
    ok(/macOS didn't let Bridge AI into your Downloads folder/.test(text) && /System Settings › Privacy & Security › Files and Folders/.test(text), 'one macOS was refused: it says so, and where to allow it, rather than an empty folder', text)
    await snap('refused')
  })
  await part('Laptop\'s files', async () => {
    await p.locator('.fx-side-row[data-computer="Laptop"]').click()
    ok(await p.locator('.fx-side-on', { hasText: 'On Laptop' }).waitFor({ timeout: 10000 }).then(() => true, () => false), 'Laptop in Locations: its own sidebar, saying so')
    await p.locator('.fx-row[data-name="Notes"]').dblclick({ timeout: 15000 })
    await p.locator('.fx-row[data-name="todo.md"]').click({ timeout: 10000 })
    await p.keyboard.press('Space')
    ok(await p.locator('.fx-ql .md-view h1', { hasText: 'Laptop todo' }).waitFor({ timeout: 10000 }).then(() => true, () => false) && /Laptop/.test(await p.locator('.fx-path').innerText()), 'Laptop\'s files, through the link: a folder there, and Quick Look on a file there')
    await p.keyboard.press('Escape')
    await snap('laptop')
    await p.locator('.fx-side-on button', { hasText: 'Back to' }).click()
    ok(await p.locator('.fx-row[data-name="Projects"]').waitFor({ timeout: 8000 }).then(() => true, () => false), 'and back to this computer')
  })
  await part('a link to Folders', async () => {
    // From where Studio's home is now (one of its lists): your home folder, as Folders opened.
    await p.locator('.fx-side-row[data-shelf="kind:doc"]').click()
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: 'view:files' } })))
    ok(await p.locator('.fx.sd-home .fx-row[data-name="Projects"]').waitFor({ timeout: 8000 }).then(() => true, () => false) && (await crumbs(p)).join(' › ') === 'Home', 'a link to Folders, with Studio at a list: Studio\'s home at your home folder', await crumbs(p))
    const tabs = await p.evaluate(() => JSON.parse(localStorage.getItem('cc-ws') || '{}').tabs || [])
    ok(JSON.stringify(tabs) === '["view:studio"]', 'in Studio\'s tab, not one of its own', tabs)
    // From a folder: that folder stays.
    await p.locator('.fx-row[data-name="Pictures"]').dblclick()
    await p.locator('.fx-row[data-name="sky.png"]').waitFor({ timeout: 8000 })
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: 'view:files' } })))
    await sleep(500)
    ok((await crumbs(p)).join(' › ') === 'Home › Pictures', 'with Studio at a folder, it stays there', await crumbs(p))
  })
  ok(!errors.length, 'no page errors', errors.slice(0, 3))
  await p.context().close()

  // ---------- Folders' places from before it was Studio's home ----------
  await part('a tab kept from before', async () => {
    // A window that had Folders in a tab, pinned, at a folder: Studio's home in that tab, at it.
    const ws = { tabs: ['view:files'], active: 'view:files', side: null, split: false, group: 'main', pinned: ['view:files'] }
    const o = await page(b, desk.url, { store: { 'cc-ws': ws, 'cc-fx-view': 'list', 'cc-fx-where:here': { root: 'home', path: 'Projects/site' } } })
    ok(await o.p.locator('.fx.sd-home .fx-row[data-name="notes.md"]').waitFor({ timeout: 15000 }).then(() => true, () => false) && (await o.p.locator('.fx-path .fx-crumb').allInnerTexts()).join(' › ') === 'Home › Projects › site', 'a window that kept Folders in a tab opens Studio\'s home there, at the folder Folders was in')
    const kept = await o.p.evaluate(() => JSON.parse(localStorage.getItem('cc-ws') || '{}'))
    ok(JSON.stringify(kept.tabs) === '["view:studio"]' && kept.active === 'view:studio' && JSON.stringify(kept.pinned) === '["view:studio"]' && /Studio/.test(await o.p.locator('.ws-tab.main').innerText().catch(() => '')), 'its tab is Studio\'s now, still pinned, and no blank page', kept)
    ok(!o.errors.length, 'no page errors', o.errors.slice(0, 3))
    await o.ctx.close()
    // One that never went into a folder (Folders opened at your home folder): there.
    const n = await page(b, desk.url, { store: { 'cc-ws': ws } })
    ok(await n.p.locator('.fx.sd-home .fx-row[data-name="Projects"]').waitFor({ timeout: 15000 }).then(() => true, () => false) && (await n.p.locator('.fx-path .fx-crumb').allInnerTexts()).join(' › ') === 'Home', 'one that kept Folders at your home folder opens Studio there, not at a list')
    await n.ctx.close()
  })

  // ---------- a deep folder's path ----------
  await part('a deep folder\'s path', async () => {
    // Six folders down, long names: the one you're in shows whole at the bar's end, the ones above
    // cut to fit (the bar showed its start, the folder you're in out of sight past its right edge).
    for (const width of [1440, 950]) {
      const o = await page(b, desk.url, { width, store: { 'cc-mtab': 'more', 'cc-more-view': 'view:studio', 'cc-ws': { tabs: ['view:studio'], active: 'view:studio', side: null, split: false, group: 'main' }, 'cc-fx-view': 'list', 'cc-fx-where:here': { root: 'home', path: DEEP } } })
      await o.p.locator('.fx-row[data-name="leaf.txt"]').waitFor({ timeout: 15000 })
      await sleep(300)
      const at = await o.p.locator('.fx-path').evaluate((nav) => {
        const here = nav.querySelector('.fx-crumb[aria-current="location"]')
        const n = nav.getBoundingClientRect(), r = here.getBoundingClientRect()
        return { text: here.textContent, whole: here.scrollWidth <= here.clientWidth + 1, inside: r.left >= n.left - 1 && r.right <= n.right + 1, crumbs: [...nav.querySelectorAll('.fx-crumb')].length }
      })
      ok(at.text === 'Site visit photos' && at.whole && at.inside && at.crumbs === 7, `${width} px: the path bar shows the folder you're in whole, six folders down`, at)
      if (width === 950) await shot(o.p, `${tag}files-ui-deep-path-950`)
      await o.ctx.close()
    }
  })

  // ---------- dark, and a phone ----------
  await part('dark', async () => {
    const d = await page(b, desk.url, { mode: 'dark', store: { 'cc-fx-view': 'list', 'cc-fx-where:here': { root: 'home', path: 'Projects/site' } } })
    await d.p.locator('.rail-nav-btn', { hasText: 'Studio' }).click()
    await d.p.locator('.fx-row[data-name="notes.md"]').click({ timeout: 15000 })
    await shot(d.p, `${tag}files-ui-dark-list`)
    await d.p.keyboard.press('Space')
    await d.p.locator('.fx-ql .md-view').waitFor({ timeout: 8000 })
    await sleep(300)
    await shot(d.p, `${tag}files-ui-dark-quicklook`)
    await d.p.keyboard.press('Escape')
    await d.p.locator('.fx-bar button[aria-label="As columns"]').click()
    await d.p.locator('.fx-col.last .fx-crow[data-name="notes.md"]').waitFor({ timeout: 8000 })
    await d.p.locator('.fx-col .fx-crow[data-name="Projects"]').waitFor({ timeout: 8000 })
    await sleep(300)
    await shot(d.p, `${tag}files-ui-dark-columns`)
    const bg = await d.p.locator('.fx').evaluate((e) => getComputedStyle(e).backgroundColor)
    ok(/^rgb\((\d+), (\d+), (\d+)\)$/.test(bg) && bg.match(/\d+/g).slice(0, 3).every((v) => Number(v) < 60), 'in dark, a dark page', bg)
    ok(!d.errors.length, 'no page errors in dark', d.errors.slice(0, 3))
    await d.p.context().close()
  })
  await part('a phone', async () => {
    const ph = await page(b, desk.url, { phone: true, store: { 'cc-fx-where:here': { root: 'home', path: '' }, 'cc-fx-view': 'list' } })
    const q = ph.p
    await q.locator('.tabbar button', { hasText: 'More' }).click()
    const more = await q.locator('.m-more-row').evaluateAll((els) => els.map((e) => e.dataset.id))
    ok(more.includes('studio') && !more.includes('files') && !(await q.locator('.m-more-row', { hasText: /^Folders/ }).count()), 'on a phone, More has Studio, one entry for your files, and no Folders row', more)
    await q.locator('.m-more-row[data-id="studio"]').click()
    ok(await q.locator('.fx.narrow .fx-row[data-name="Projects"]').waitFor({ timeout: 15000 }).then(() => true, () => false), 'More › Studio: your home folder in one column, where it was')
    const tall = await q.locator('.fx-row[data-name="Projects"]').evaluate((e) => Math.round(e.getBoundingClientRect().height))
    ok(tall >= 44, `a row is a whole target (${tall} px)`)
    await q.locator('.fx-row[data-name="Projects"]').click()
    ok(await q.locator('.fx-row[data-name="site"]').waitFor({ timeout: 8000 }).then(() => true, () => false) && /Projects/.test(await q.locator('.fx-path-title').innerText()), 'a tap opens a folder, its name over it')
    let f = await phoneFaults(q, '.fx')
    const off = await q.locator('.fx-bar button').evaluateAll((els) => els.filter((e) => e.getClientRects().length && (e.getBoundingClientRect().right > innerWidth + 1 || e.getBoundingClientRect().left < -1)).map((e) => e.getAttribute('aria-label') || e.innerText))
    ok(!f.wider && !f.past && !f.sideways && !f.small && !f.covered && !f.zooms && !off.length, 'it fits the phone: nothing wider or past its edge (every tool on the screen), no sideways scrolling, each target 40 px', { f, off })
    await shot(q, `${tag}files-ui-phone-folder`)
    await q.locator('.fx-bar button[aria-label="Up to the folder it\'s in"]').click()
    await q.locator('.fx-row[data-name="Projects"]').waitFor({ timeout: 8000 })
    await q.locator('.fx-bar button[aria-label="All locations"]').click()
    ok(await q.locator('.fx.narrow .fx-side-row[data-label="Home"]').waitFor({ timeout: 4000 }).then(() => true, () => false) && await q.locator('.fx.narrow .fx-side-row[data-shelf="recent"]').isVisible(), 'back from the top: the sidebar, a screen of its own, Studio\'s lists first')
    f = await phoneFaults(q, '.fx')
    ok(!f.wider && !f.past && !f.sideways && !f.small, 'and it fits too', f)
    await shot(q, `${tag}files-ui-phone-sidebar`)
    await q.locator('.fx-side-row[data-label="Home"]').click()
    await q.locator('.fx-row[data-name="big.bin"]').click()
    ok(await q.locator('.fx-ql .other-file').waitFor({ timeout: 8000 }).then(() => true, () => false), 'a tap on a file shows it (Quick Look, the whole screen)')
    await sleep(300)
    await shot(q, `${tag}files-ui-phone-quicklook`)
    await q.locator('.fx-ql button[aria-label="Close"]').click()
    ok(!ph.errors.length, 'no page errors on the phone', ph.errors.slice(0, 3))
    await ph.p.context().close()
    // And in dark, a phone left at More's old Folders row: Studio there, at the folder it was in.
    const dk = await page(b, desk.url, { phone: true, mode: 'dark', store: { 'cc-mtab': 'more', 'cc-more-view': 'view:files', 'cc-fx-where:here': { root: 'home', path: 'Projects/site' }, 'cc-fx-view': 'list' } })
    ok(await dk.p.locator('.m-more-view .fx.sd-home .fx-row[data-name="notes.md"]').waitFor({ timeout: 15000 }).then(() => true, () => false) && await dk.p.evaluate(() => JSON.parse(localStorage.getItem('cc-more-view'))) === 'view:studio', 'a phone left at More\'s Folders: Studio, at the folder it was in')
    await shot(dk.p, `${tag}files-ui-phone-dark`)
    ok(!dk.errors.length, 'no page errors on the phone in dark', dk.errors.slice(0, 3))
    await dk.p.context().close()
  })
  // ---------- icons, the list and groups, in light and dark, on a computer and a phone ----------
  const looks = []
  await part('pictures of the icons, the list and groups', async () => {
    for (const mode of ['light', 'dark']) {
      for (const phone of [false, true]) {
        const at = `${mode}-${phone ? 390 : 1440}`
        const o = await page(b, desk.url, { mode, phone, store: { 'cc-fx-view': 'icons', 'cc-fx-where:here': { root: 'home', path: 'Docs' }, 'cc-fx-folders': {}, 'cc-fx-look': { group: false, icon: 64, text: 13 } } })
        const q = o.p
        if (phone) { await q.locator('.tabbar button', { hasText: 'More' }).click(); await q.locator('.m-more-row[data-id="studio"]').click() } else await q.locator('.rail-nav-btn', { hasText: 'Studio' }).click()
        await q.locator('.fx-tile[data-name="Plan.docx"]').waitFor({ timeout: 15000 })
        const opts = q.locator('.fx-vo')
        for (const size of [48, 96, 176]) {
          if (phone) await q.locator('.fx-bar button[aria-label="View Options"]').click()
          await (phone ? opts : q.locator('.fx-bar')).locator('.fx-size input').fill(String(size))
          if (phone) { await sleep(150); if (size === 96) { const f = await phoneFaults(q, '.fx'); ok(!f.wider && !f.past?.length && !f.small?.length && !f.zooms?.length, `${at}: View Options fits the phone, each control a whole target`, f) } await q.keyboard.press('Escape') }
          await until(() => q.locator('.fx-tile[data-name="Plan.docx"] .fx-sk-page').count(), 8000)
          await sleep(300)
          await shot(q, `${tag}files-ui-icons-${size}-${at}`)
          looks.push(`icons-${size}-${at}`)
        }
        await q.locator('.fx-bar button[aria-label="As list"]').click()
        await q.locator('.fx-row[data-name="Plan.docx"]').waitFor({ timeout: 8000 })
        await sleep(200)
        const oneByte = await q.locator('.fx-row[data-name="backup.zip"] .fx-c-size').innerText().catch(() => '')
        ok(oneByte === '1 byte', `${at}: a file of one byte says "1 byte" (not "1 bytes")`, oneByte)
        await shot(q, `${tag}files-ui-list-${at}`)
        looks.push(`list-${at}`)
        await q.locator('.fx-bar button[aria-label="As icons"]').click()
        await q.locator('.fx-bar button[aria-label="View Options"]').click()
        await opts.locator('.fx-size input').fill('64')
        await opts.locator('label', { hasText: 'Group by Kind' }).click()
        await q.keyboard.press('Escape')
        await q.locator('.fx-icon-group').first().waitFor({ timeout: 8000 })
        await sleep(300)
        await shot(q, `${tag}files-ui-grouped-${at}`)
        looks.push(`grouped-${at}`)
        if (phone) { const f = await phoneFaults(q, '.fx'); ok(!f.wider && !f.past?.length && !f.sideways?.length, `${at}: icons in groups fit the phone`, f) }
        ok(!o.errors.length, `${at}: no page errors`, o.errors.slice(0, 3))
        await o.ctx.close()
      }
    }
  })
  // ---------- Laptop away ----------
  await part('Laptop offline', async () => {
    // Laptop gone (closed, asleep): Desk knows it's offline; its files, gone to from the sidebar,
    // say so at once, in this window's language, with Try again (grey rows for 12 s, then
    // "Laptop is offline" in English from the link).
    lap.stop()
    const away = await until(async () => (await desk.api('/machines')).machines.find((m) => m.name === 'Laptop' && !m.online), 30000, 300)
    ok(!!away, 'Laptop stopped: Desk sees it offline')
    const o = await page(b, desk.url, { store: { 'cc-fx-view': 'list', 'cc-fx-where:here': { root: 'home', path: '' } } })
    await o.p.locator('.rail-nav-btn', { hasText: 'Studio' }).click()
    await o.p.locator('.fx-row[data-name="Projects"]').waitFor({ timeout: 15000 })
    const t0 = Date.now()
    await o.p.locator('.fx-side-row[data-computer="Laptop"]').click()
    const sideSaid = await o.p.locator('.fx-side-err').innerText({ timeout: 2000 }).catch(() => '')
    ok(/Laptop is offline/.test(sideSaid) && Date.now() - t0 < 2000 && await o.p.locator('.fx-side-row[data-computer="here"]').count() === 1, 'its sidebar says so at once, with the way back to this computer', await o.p.locator('.fx-side').innerText().catch(() => ''))
    const said = await o.p.locator('.fx-state[data-state="offline"]').innerText({ timeout: 2000 }).catch(() => '')
    ok(/Laptop is offline/.test(said) && /once it's on and connected again/.test(said) && Date.now() - t0 < 4000 && await o.p.locator('.fx-state[data-state="offline"] button', { hasText: 'Try again' }).count() === 1, `an offline computer's files: "Laptop is offline", at once (${Date.now() - t0} ms), with Try again`, said)
    await o.ctx.close()
  })
  console.log(`pictures: test/.out/shots/${tag}files-ui-{${[...shots, ...looks].join(',')},dark-list,dark-quicklook,dark-columns,phone-folder,phone-sidebar,phone-quicklook,phone-dark}.png`)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  await b.close().catch(() => {})
}
process.exit(done().fail ? 1 : 0)
