// Files Assist, beside Files (a beta feature): what takes room in a folder and how it could be
// tidier, with nothing in the folder changed. A made-up folder ("Mess") with a bit of everything:
// the same photo in three places (and a hard link, which isn't a copy), two files of the same size
// that differ, big videos, a year-old tax return, installers and an unpacked archive in Downloads,
// a dozen screenshots, a folder of loose files of every kind with three versions of a report and a
// copy of a budget, empty folders, folders inside folders four deep, files only in the cloud (an
// iCloud stand-in, and two that take no room, never readable), a tool's folder, a hidden one, a link
// and a folder Bridge AI may not read. Checked:
//   each finding, with what it's based on; the folder's listing and every file's times exactly as
//   they were after every look and ask; the files in the cloud left out and said, never read;
//   a look kept (asked again, the same one), a fresh one, and Stop part way through a big folder;
//   Ask AI: the local model built in by default (stand-in llama-server), saying it's on this
//   computer; a model elsewhere only once picked, saying where the names go; names, sizes and dates
//   sent, never what's in a file;
//   another computer's folder through the link (Studio, its own server and relay): looked at there,
//   its beta switch said when off, its model said to be its own, a look that stops at its limit;
//   a folder macOS asks about (scripts/tcc-sim.mjs): the server never frozen, the look waiting and
//   saying why, then done;
//   the panel in Files: the findings with Open (which opens the file in Files), Ask AI, light, dark,
//   a phone, and the waiting message.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { startKit, startRelay, startModel, checks, until, sleep, browser, page, shot, phoneFaults, withoutCutOff, ROOT, TEST, IS_WIN, IS_MAC } from '../lib/harness.mjs'

const { ok, skip, done } = checks('files-assist')
const MB = 1024 * 1024
const YEAR = 365 * 24 * 3600 * 1000
const SECRET = 'SECRET-CONTENT-7f3a91'
const enc = encodeURIComponent
const root = (process.getuid?.() ?? 1) === 0
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: ${String(e.stack || e.message).split('\n').slice(0, 3).join(' | ')}`) } }

// A file in a made-up folder, its folders made first.
const put = (dir, rel, data) => { const f = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f }
// Every file and folder under dir, with its size, times and mode: the same before and after means
// nothing was written. A file's last-opened time too where reading leaves it alone (a Mac, and
// Linux as Bridge AI reads); Windows may note it by itself.
function snapshot(dir) {
  const out = {}
  const walk = (d, rel) => {
    let names = []
    try { names = fs.readdirSync(d) } catch { return }
    for (const n of names.sort()) {
      const p = path.join(d, n)
      const st = fs.lstatSync(p)
      out[`${rel}${n}`] = [st.size, st.mtimeMs, st.ctimeMs, st.mode, st.isFile() && !IS_WIN ? st.atimeMs : 0].join(' ')
      if (st.isDirectory()) walk(p, `${rel}${n}/`)
    }
  }
  walk(dir, '')
  return out
}
// A new file's last-opened time is before its last change, and a Mac notes the first read after
// that (Spotlight's, say): settled to its last change, as an older file's is, so only a read that
// shouldn't note it would.
function settle(dir) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name)
    if (n.isDirectory()) settle(p)
    else if (n.isFile()) { const st = fs.statSync(p); fs.utimesSync(p, st.mtime, st.mtime) }
  }
}
const same = (a, b) => { const k = new Set([...Object.keys(a), ...Object.keys(b)]); return [...k].filter((x) => a[x] !== b[x]).map((x) => `${x}: ${a[x]} -> ${b[x]}`) }

function makeMess(dir) {
  const beach = crypto.randomBytes(3 * MB)
  put(dir, 'Photos/beach.jpg', beach)
  put(dir, 'Backup/beach copy.jpg', beach)
  put(dir, 'Old Desktop/beach.jpg', beach)
  let hardLink = false
  try { fs.linkSync(path.join(dir, 'Photos', 'beach.jpg'), path.join(dir, 'Photos', 'beach again.jpg')); hardLink = true } catch { /* no hard links here */ }
  const notes = 'Meeting notes.\n'.repeat(150)
  put(dir, 'Notes/notes.txt', notes)
  put(dir, 'Backup/notes.txt', notes)
  put(dir, 'Same size/a.bin', crypto.randomBytes(MB))
  put(dir, 'Same size/b.bin', crypto.randomBytes(MB))
  put(dir, 'Videos/trip.mov', crypto.randomBytes(25 * MB))
  put(dir, 'Videos/raw.mov', crypto.randomBytes(15 * MB))
  const longAgo = new Date(Date.now() - 2 * YEAR)
  for (const [rel, n] of [['Archive/tax-2019.pdf', 2 * MB], ['Archive/letter.docx', 40_000]]) { const f = put(dir, rel, crypto.randomBytes(n)); fs.utimesSync(f, longAgo, longAgo) }
  put(dir, 'Downloads/Figma.dmg', crypto.randomBytes(500_000))
  put(dir, 'Downloads/Zoom.pkg', crypto.randomBytes(300_000))
  put(dir, 'Downloads/photos.zip', crypto.randomBytes(200_000))
  put(dir, 'Downloads/photos/IMG_0001.jpg', crypto.randomBytes(30_000))
  for (let i = 1; i <= 12; i++) put(dir, `Old Desktop/Screenshot 2025-03-${String(i).padStart(2, '0')} at 10.15.${String(i).padStart(2, '0')}.png`, crypto.randomBytes(20_000 + i))
  const kinds = [['docx', 6], ['pdf', 6], ['png', 5], ['mp3', 4], ['xlsx', 4], ['zip', 3], ['txt', 2]]
  for (const [ext, n] of kinds) for (let i = 1; i <= n; i++) put(dir, `Inbox/${ext} file ${i}.${ext}`, crypto.randomBytes(1000 + i * 37 + ext.length))
  put(dir, 'Inbox/Report.docx', crypto.randomBytes(11_000))
  put(dir, 'Inbox/Report final.docx', crypto.randomBytes(12_000))
  put(dir, 'Inbox/Report final_v2 (1).docx', crypto.randomBytes(13_000))
  put(dir, 'Inbox/Budget.xlsx', crypto.randomBytes(8_000))
  put(dir, 'Inbox/Budget copy.xlsx', crypto.randomBytes(8_500))
  put(dir, 'Inbox/private.txt', `Bank details: ${SECRET}\n`)
  fs.mkdirSync(path.join(dir, 'Empty folder'))
  fs.mkdirSync(path.join(dir, 'Projects', 'old'), { recursive: true })
  put(dir, 'Projects/site/index.html', '<h1>Hi</h1>')
  put(dir, 'Deep/a/b/c/d/plan.txt', 'the plan')
  // In the cloud only: iCloud's stand-in for a file, and two files that take no room (as OneDrive's
  // and iCloud's files on demand don't), which nobody may read: reading one would be an error.
  put(dir, 'Cloud/.Report.pdf.icloud', 'bplist00')
  let sparse = false
  put(dir, 'Code/app.js', 'console.log(1)\n')
  put(dir, 'Code/node_modules/left-pad/index.js', 'module.exports = 1\n')
  put(dir, '.cache/thing.bin', 'x')
  if (!IS_WIN) {
    for (const n of ['movie.mp4', 'movie 2.mp4']) { const f = path.join(dir, 'Cloud', n); fs.closeSync(fs.openSync(f, 'w')); fs.truncateSync(f, 8 * MB) }
    sparse = fs.statSync(path.join(dir, 'Cloud', 'movie.mp4')).blocks === 0
  }
  settle(dir)
  if (!IS_WIN && !root) for (const n of ['movie.mp4', 'movie 2.mp4']) fs.chmodSync(path.join(dir, 'Cloud', n), 0)
  // A link out to a folder beside it (not the system's temporary folder, which isn't the test's).
  let link = false
  fs.mkdirSync(path.join(path.dirname(dir), 'Elsewhere'), { recursive: true })
  try { fs.symlinkSync(path.join(path.dirname(dir), 'Elsewhere'), path.join(dir, 'Shortcut'), IS_WIN ? 'junction' : 'dir'); link = true } catch { /* no links here */ }
  let locked = false
  if (!IS_WIN && !root) { put(dir, 'Locked/secret.txt', 'x'); fs.chmodSync(path.join(dir, 'Locked'), 0); locked = true }
  return { hardLink, sparse, link, locked }
}
const notes = () => 'Meeting notes.\n'.repeat(150)
const unlock = (dir) => { for (const p of ['Locked', 'Cloud/movie.mp4', 'Cloud/movie 2.mp4']) { try { fs.chmodSync(path.join(dir, ...p.split('/')), 0o755) } catch { /* not made */ } } }

// The agent's Files in a page, at its folder ('' its root), with Files Assist opened from its bar.
async function openFiles(p, pane) {
  await p.waitForFunction(() => !!document.querySelector('.app'), null, { timeout: 30000 }).catch(() => {})
  const bar = p.locator('.tree-head button[aria-label="Files Assist"]')
  for (let i = 0; i < 15 && !(await bar.isVisible().catch(() => false)); i++) {
    await p.evaluate((id) => { window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } })); window.dispatchEvent(new CustomEvent('cc-set-view', { detail: { paneId: id, view: 'files' } })) }, pane)
    await bar.waitFor({ timeout: 1000 }).catch(() => {})
  }
  return bar
}

// No write path: nothing in Files Assist's server code could change a folder, whatever it's asked.
{
  const src = fs.readFileSync(path.join(ROOT, 'server', 'fileinsights.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const writes = src.match(/\b(?:fsp?|fs\.promises)\.(?:write\w*|append\w*|rename\w*|rm\w*|unlink\w*|mkdir\w*|copy\w*|cp\w*|utimes\w*|lutimes\w*|chmod\w*|chown\w*|truncate\w*|symlink\w*|link\w*|create\w*Stream)\b/g) || []
  const opens = [...src.matchAll(/\.open\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => !/,\s*(?:'r'|NOATIME)\s*$/.test(a))
  const imports = [...src.matchAll(/^import .* from '\.\/(\w+)\.js'$/gm)].map((m) => m[0])
  ok(!writes.length && !opens.length, 'Files Assist\'s server code has no call that writes, renames, removes or changes a file\'s times, and opens files only to read', { writes, opens })
  ok(imports.every((l) => /\{ safePath, hashFile \} from '\.\/files\.js'|\{ openToRead \} from '\.\/openread\.js'|\{ mayLook, noteAsked \} from '\.\/projects\.js'|\{ inPicked \} from '\.\/places\.js'/.test(l)), 'and uses only reading from the rest of the server (safePath, hashFile, openToRead)', imports)
}

const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const kits = []
const relays = []
const holds = []
let mess = null
try {
  // ---------- This computer ("Laptop"): the made-up folder, the local model built in, a key ----------
  const model = await startModel('files-assist')
  holds.push(model)
  const ra = await startRelay('files-assist-studio')
  const rb = await startRelay('files-assist-laptop')
  relays.push(ra, rb)
  const GEMMA = 'gemma-4-E2B-it-Q4_0.gguf'
  const kit = await startKit('files-assist', {
    config: { trials: { files: true } },
    env: ({ bin, data }) => {
      fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rb.relayFile))
      const models = path.join(path.dirname(bin), 'llm-models.json')
      fs.writeFileSync(models, JSON.stringify({ 'gemma-4-e2b': { files: [{ name: GEMMA, bytes: 1024, sha256: '0'.repeat(64) }] } }))
      fs.mkdirSync(path.join(data, 'models', 'llm', 'gemma-4-e2b'), { recursive: true })
      fs.writeFileSync(path.join(data, 'models', 'llm', 'gemma-4-e2b', GEMMA), Buffer.alloc(1024))
      return {
        BRIDGE_COMPUTER_NAME: 'Laptop', OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1`, OLLAMA_HOST: model.url,
        BRIDGE_MACHINE: JSON.stringify({ memGB: 16 }), BRIDGE_LLM_MODELS: models, BRIDGE_LLAMA_SERVER: path.join(TEST, 'stand-ins', 'llama-server.mjs'),
        BRIDGE_LLAMA_LOG: path.join(path.dirname(bin), 'llama.log'), BRIDGE_LLM_IDLE_MS: '1500',
      }
    },
  })
  kits.push(kit)
  await kit.api('/setup', { name: 'Tester' })
  const { api } = kit
  mess = path.join(kit.home, 'Mess')
  const made = makeMess(mess)
  const before = snapshot(mess)
  const place = (await api('/places', { path: mess })).place
  const R = `place:${place.id}`
  const view = (id) => api(`/files/insights/${id}`)
  const finished = (id, ms = 60000) => until(async () => { const v = await view(id); return v.state !== 'running' ? v : null }, ms, 200)

  let v = null
  await part('a look', async () => {
    const t = Date.now()
    const first = await api('/files/insights', { root: R, rel: '' })
    ok(Date.now() - t < 3000 && first.id && ['running', 'done'].includes(first.state), `asking answers at once, the look going on in the background (${Date.now() - t} ms)`, first)
    const seen = []
    v = await until(async () => { const x = await view(first.id); seen.push(x.progress.files); return x.state !== 'running' ? x : null }, 60000, 100)
    ok(v?.state === 'done', 'the look finishes', v && { state: v.state, error: v.error })
    ok(v?.progress.files >= 60 && v.progress.folders >= 15 && v.progress.bytes > 40 * MB, 'its progress: files, folders and bytes looked at', v?.progress)
    const f = v.found
    const g = f.duplicates.groups[0]
    ok(g && g.size === 3 * MB && g.count === 3 && g.wasted === 6 * MB && g.files.includes('Backup/beach copy.jpg') && g.files.includes('Old Desktop/beach.jpg') && g.files.filter((x) => x.startsWith('Photos/')).length === 1,
      `duplicates: the same photo in three places, the most room first (${made.hardLink ? 'its hard link not counted as a copy' : 'no hard links here'})`, g)
    ok(f.duplicates.groups.some((x) => x.count === 2 && x.files.includes('Notes/notes.txt') && x.files.includes('Backup/notes.txt')), 'and the same notes in two places', f.duplicates.groups)
    ok(!f.duplicates.groups.some((x) => x.files.some((r) => r.startsWith('Same size/') || r.startsWith('Cloud/'))), 'files of the same size that differ aren\'t duplicates, and files in the cloud aren\'t compared', f.duplicates.groups)
    ok(f.duplicates.wasted === 6 * MB + notes().length, 'the room the copies take, added up', f.duplicates.wasted)
    ok(f.large.files[0]?.rel === 'Videos/trip.mov' && f.large.files[1]?.rel === 'Videos/raw.mov' && f.large.files.length === 2, 'large files: the two videos, biggest first', f.large.files)
    ok(f.large.folders.some((x) => x.rel === 'Videos' && x.size === 40 * MB && x.files === 2), 'large folders: Videos, with its size and files', f.large.folders)
    ok(f.old.files.some((x) => x.rel === 'Archive/tax-2019.pdf' && x.last < Date.now() - YEAR) && f.old.count === 2 && !f.old.files.some((x) => x.rel.startsWith('Inbox/')), 'old and forgotten: the two files untouched for two years, by their own times, and nothing new', f.old)
    ok(f.old.installers.map((x) => x.rel).sort().join() === 'Downloads/Figma.dmg,Downloads/Zoom.pkg', 'installers in Downloads', f.old.installers)
    ok(f.old.archives.length === 1 && f.old.archives[0].rel === 'Downloads/photos.zip' && f.old.archives[0].unpacked === 'Downloads/photos', 'an archive already unpacked beside it', f.old.archives)
    ok(f.old.screenshots.length === 1 && f.old.screenshots[0].folder === 'Old Desktop' && f.old.screenshots[0].count === 12, 'screenshots piling up in one folder', f.old.screenshots)
    const inbox = f.organize.loose.find((x) => x.folder === 'Inbox')
    ok(inbox && inbox.files === 36 && inbox.mixed && ['document', 'image', 'audio', 'sheet', 'archive'].every((k) => inbox.suggest.some((s) => s.kind === k)), 'organization: a folder of loose files of every kind, with folders by kind suggested', inbox)
    ok(!f.organize.loose.some((x) => x.folder === 'Old Desktop'), 'a folder of screenshots isn\'t loose files of every kind', f.organize.loose.map((x) => x.folder))
    const rep = f.organize.versions.find((x) => x.folder === 'Inbox' && /^report$/i.test(x.name))
    ok(rep && rep.files.length === 3 && rep.files.map((x) => x.rel).includes('Inbox/Report final_v2 (1).docx'), 'three versions of one report ("final", "final_v2 (1)")', f.organize.versions)
    ok(f.organize.copies.some((x) => x.rel === 'Inbox/Budget copy.xlsx' && x.of === 'Inbox/Budget.xlsx' && x.same === false), 'a copy of the budget beside it, said to differ', f.organize.copies)
    ok(f.organize.empty.includes('Empty folder') && f.organize.empty.includes('Projects/old') && !f.organize.empty.some((x) => /^(Locked|Cloud|Code)$/.test(x)), 'empty folders, and not a folder it couldn\'t read or one with what it left out', f.organize.empty)
    ok(f.organize.chains.some((x) => x.from === 'Deep' && x.to === 'Deep/a/b/c/d' && x.depth === 4), 'folders inside folders, four deep, with the files at the bottom', f.organize.chains)
    const sk = Object.fromEntries(v.skipped.map((x) => [x.kind, x]))
    ok(sk.cloud?.count === (made.sparse ? 3 : 1) && sk.cloud.examples.includes('Cloud/Report.pdf'), `files only in the cloud said and left out (${made.sparse ? "iCloud's stand-in and two that take no room" : "iCloud's stand-in"})`, sk.cloud)
    ok(!(sk.unreadable?.paths || []).some((x) => x.rel.startsWith('Cloud/')), 'and never read: neither cloud file was opened (they can\'t be)', sk.unreadable)
    if (made.locked) ok(sk.unreadable?.paths.some((x) => x.rel === 'Locked' && x.why === 'denied'), 'a folder Bridge AI may not read, said', sk.unreadable)
    else skip('a folder Bridge AI may not read', 'no folder permissions here')
    ok(sk.tools?.names.includes('node_modules') && sk.hidden?.count >= 1 && (!made.link || sk.links?.count === 1), 'a tool\'s folder, hidden files and a link, each said and left out', v.skipped)
    ok(same(before, snapshot(mess)).length === 0, 'nothing in the folder changed: every file and folder, its size, times and permissions as they were', same(before, snapshot(mess)))
    const again = await api('/files/insights', { root: R, rel: '' })
    ok(again.id === first.id && again.state === 'done', 'asked again, the same look comes back, kept', { a: again.id, b: first.id })
    const fresh = await api('/files/insights', { root: R, rel: '', fresh: true })
    ok(fresh.id !== first.id, 'Look again starts a fresh one')
    const v2 = await finished(fresh.id)
    ok(v2?.state === 'done' && v2.found.duplicates.wasted === v.found.duplicates.wasted, 'and finds the same')
    const sub = await finished((await api('/files/insights', { root: R, rel: 'Inbox' })).id)
    ok(sub?.state === 'done' && sub.name === 'Inbox' && sub.found.totals.files === 36 && sub.found.duplicates.count === 0, 'a folder inside it, looked at on its own', sub && { name: sub.name, totals: sub.found?.totals })
    const out = await api('/files/insights', { root: R, rel: '../..' }).then((x) => finished(x.id)).catch((e) => ({ refused: e.message }))
    ok(out?.state === 'failed' && out.code === 'outside', 'a folder outside it, refused', out)
  })

  await part('stop', async () => {
    const many = path.join(kit.home, 'Many')
    for (let d = 0; d < 40; d++) { fs.mkdirSync(path.join(many, `d${d}`), { recursive: true }); for (let i = 0; i < 400; i++) fs.writeFileSync(path.join(many, `d${d}`, `f${i}.txt`), `${d}-${i}`) }
    const pl = (await api('/places', { path: many })).place
    const s = await api('/files/insights', { root: `place:${pl.id}`, rel: '' })
    await api(`/files/insights/${s.id}`, null, 'DELETE')
    const x = await finished(s.id, 30000)
    ok(x?.state === 'stopped' && x.partial === 'stopped' && x.progress.files < 16000, 'Stop part way through 16,000 files: stopped, with what it had seen', x && { state: x.state, partial: x.partial, files: x.progress.files })
    const gone = await api('/files/insights/nope').catch((e) => e)
    ok(gone.status === 404 && /no longer kept/.test(gone.message), 'a look no longer kept says so', gone.message)
  })

  await part('Ask AI', async () => {
    const m = await api('/files/assist/model')
    ok(m.model?.id === 'bridge:gemma-4-e2b' && m.model.local && m.model.builtin && !m.picked, 'Ask AI uses the local model built in by default, on this computer', m.model)
    const others = m.models.filter((x) => !x.builtin)
    ok(others.some((x) => x.local && x.id.startsWith('ollama:')) && others.some((x) => !x.local && x.id.startsWith('openai:')), 'the others offered, each said to be on this computer or not', others)
    const id = v.id
    let a = await api(`/files/insights/${id}/ask`, {})
    ok(a.ask?.state === 'running' && a.ask.model.id === 'bridge:gemma-4-e2b', 'asking starts at once, with the model it went to', a.ask)
    a = await until(async () => { const x = await view(id); return x.ask?.state !== 'running' ? x : null }, 30000, 200)
    ok(a?.ask?.state === 'done' && a.ask.plan?.summary === 'Sorted by the built-in model.' && a.ask.plan.folders[0]?.name === 'Documents', 'its suggestion, read from its answer', a?.ask)
    ok(a.ask.sent?.text.includes('Inbox/Report final.docx') && a.ask.sent.files > 30, 'what was sent, word for word, for the panel to show', a.ask.sent && { files: a.ask.sent.files })
    const log = fs.readFileSync(path.join(kit.dir, 'llama.log'), 'utf8')
    const sent = log.split('\n').filter((l) => l.includes('organize this folder')).join('\n')
    ok(sent.includes('Inbox/private.txt') && sent.includes('Videos/trip.mov') && !sent.includes(SECRET) && !sent.includes('Meeting notes.'), 'the model got names, sizes and dates, never what\'s in a file', sent.slice(0, 300))
    // A model elsewhere: only once it's picked, and the names go there.
    const cloud = others.find((x) => !x.local)
    const picked = await api('/files/assist/model', { model: cloud.id }, 'PUT')
    ok(picked.model?.id === cloud.id && picked.picked && !picked.model.local, `picked, ${cloud.label} is used and said not to be on this computer`, picked.model)
    a = await api(`/files/insights/${id}/ask`, {})
    a = await until(async () => { const x = await view(id); return x.ask?.state !== 'running' ? x : null }, 30000, 200)
    ok(a?.ask?.state === 'done' && a.ask.model.id === cloud.id && a.ask.plan?.folders.some((x) => x.name === 'Screenshots' && /^Old Desktop\/Screenshot /.test(x.examples[0])), 'its suggestion, from the names it was sent', a?.ask?.plan)
    const asked = model.asked(/organize this folder/).join('\n')
    ok(asked.includes('Old Desktop/Screenshot 2025-03-01') && !asked.includes(SECRET), 'and it got names, never contents', asked.slice(0, 200))
    const bad = await api(`/files/insights/${id}/ask`, { model: 'openai:nope' }).catch((e) => e)
    ok(bad.status === 400 && bad.j?.code === 'noModel', 'a model that isn\'t there is refused, saying so', bad.message)
    await api('/files/assist/model', { model: null }, 'PUT')
    ok((await api('/files/assist/model')).model?.builtin, 'back to the local model built in')
    ok(same(before, snapshot(mess)).length === 0, 'and still nothing in the folder changed', same(before, snapshot(mess)))
  })

  // ---------- The panel, in the agent's Files ----------
  await part('the panel', async () => {
    kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
    await api('/agents/catalog')
    const pane = (await api('/agents/launch', { kind: 'claude', cwd: mess, label: 'Mess', newSpace: 'Mess' })).paneId
    for (const look of [{ mode: 'light' }, { mode: 'dark' }, { mode: 'light', phone: true }]) {
      const name = `${look.mode}${look.phone ? ' phone' : ''}`
      const { ctx, p, errors } = await page(b, kit.url, look)
      try {
        const bar = await openFiles(p, pane)
        ok(await bar.isVisible(), `${name}: Files Assist is in Files' bar with the beta switch on`)
        await bar.click()
        const panel = p.locator('.fa-panel')
        await panel.locator('.fa-tiles').waitFor({ timeout: 30000 })
        const text = await panel.innerText()
        ok(/^Read-only\b/m.test(text), `${name}: it says at the top that it's read-only`, text.slice(0, 200))
        const heads = await panel.locator('h3').allInnerTexts()
        ok(['Duplicates', 'Large Files', 'Old and Forgotten', 'Organization', 'Ask AI', 'Not Looked At'].every((h) => heads.some((x) => x.trim() === h)) && /3 copies of beach/.test(text) && /trip\.mov/.test(text) && /Installers in Downloads/.test(text) && /12 screenshots in Old Desktop/.test(text) && /36 files straight in Inbox/.test(text) && /3 versions of Report/.test(text),
          `${name}: each finding in its section, with what to do`, text.slice(0, 600))
        ok(/only in the cloud, not on this computer/.test(text) && /node_modules/.test(text), `${name}: what it left out, and why`, text.slice(-600))
        const faults = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        ok(faults <= 1, `${name}: nothing wider than the window`, faults)
        if (look.phone) {
          const f = await phoneFaults(p, '.fa-panel')
          ok(!Object.keys(f).length, `${name}: on a phone the panel fills the screen, every control a whole 40 px target`, f)
        }
        await shot(p, `files-assist-${tag}${look.mode}${look.phone ? '-phone' : ''}`)
        if (!look.phone && look.mode === 'light') {
          for (const sec of ['old', 'organize', 'skipped']) { await panel.locator(`#fa-${sec}`).evaluate((e) => e.scrollIntoView({ block: 'start' })); await shot(p, `files-assist-${tag}${sec}`) }
          // Ask AI: which model, and that it's on this computer, before anything is sent.
          const ask = panel.locator('#fa-ask')
          await ask.locator('.fa-privacy').waitFor({ timeout: 15000 })
          const said = await ask.innerText()
          ok(/on this computer\. Nothing leaves it/.test(said) && /Ask Gemma/i.test(said), 'Ask AI says which model gets the names and that it\'s on this computer', said)
          await ask.locator('button.fa-ask').click()
          await ask.locator('.fa-answer').waitFor({ timeout: 30000 })
          const answer = await ask.innerText()
          ok(/Sorted by the built-in model/.test(answer) && /Documents/.test(answer) && /What was sent/.test(answer), 'its suggestion, with what was sent', answer)
          await ask.scrollIntoViewIfNeeded()
          await shot(p, `files-assist-${tag}ask`)
          // Open: the file in Files' viewer.
          await panel.locator('#fa-large .fa-row', { hasText: 'trip.mov' }).locator('button').first().click()
          ok(await p.locator('.viewer .crumbs b', { hasText: 'trip.mov' }).first().waitFor({ timeout: 10000 }).then(() => true, () => false), 'Open shows the file in Files')
          // A folder's own Files Assist, from its menu.
          await p.locator('.tree-row', { hasText: 'Inbox' }).first().click({ button: 'right' })
          await p.locator('.ctx-menu button, .ctx-menu [role=menuitem]', { hasText: 'Files Assist' }).first().click()
          await p.locator('.fa-where', { hasText: 'Inbox' }).waitFor({ timeout: 10000 })
          await panel.locator('.fa-tiles').waitFor({ timeout: 30000 })
          ok(/36 files straight in Inbox/.test(await panel.innerText()), 'a folder\'s menu opens Files Assist for that folder')
        }
        if (look.phone) {
          await panel.locator('#fa-large .fa-row', { hasText: 'raw.mov' }).locator('button').first().click()
          ok(await p.locator('.viewer .crumbs b', { hasText: 'raw.mov' }).first().waitFor({ timeout: 10000 }).then(() => true, () => false) && !(await panel.isVisible()), 'on a phone, Open closes the panel and shows the file')
        }
        ok(!withoutCutOff(errors).length, `${name}: no page errors`, errors)
      } finally { await ctx.close() }
    }
    ok(same(before, snapshot(mess)).length === 0, 'after the panel too, nothing in the folder changed', same(before, snapshot(mess)))
  })

  // ---------- Another computer ("Studio"), through the link ----------
  await part('another computer', async () => {
    const studio = await startKit('files-assist-studio', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(ra.relayFile)); return { BRIDGE_COMPUTER_NAME: 'Studio', BRIDGE_ASSIST_MAX_FILES: '40' } } })
    kits.push(studio)
    await studio.api('/setup', { name: 'Tester' })
    const shared = path.join(studio.home, 'Shared')
    const clip = crypto.randomBytes(2 * MB)
    put(shared, 'clip.mov', clip)
    put(shared, 'clip copy.mov', clip)
    for (let i = 0; i < 60; i++) put(shared, `Many/f${i}.txt`, `file ${i}`)
    settle(shared)
    const was = snapshot(shared)
    const spl = (await studio.api('/places', { path: shared })).place
    ok(!!(await until(async () => (await studio.api('/relay')).online && (await api('/relay')).online, 20000)), 'each is connected to its own relay')
    const p = (await studio.api('/relay/pair', {})).pairing
    await api('/machines', { link: `${ra.url} ${p.code}` })
    const m = await until(async () => (await api('/machines')).machines.find((x) => x.name === 'Studio' && x.online), 30000, 300)
    ok(!!m, 'Laptop is linked to Studio')
    const M = (p2, body, method) => fetch(`${kit.url}/m/${m.id}/api${p2}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }))
    let r = await M('/files/insights', { root: `place:${spl.id}`, rel: '' })
    ok(r.status === 404 && r.trial === 'files' && /beta feature/.test(r.error), 'with Files off on Studio, it says it\'s a beta feature there', r)
    await studio.api('/settings', { trials: { files: true } }, 'PATCH')
    r = await M('/files/insights', { root: `place:${spl.id}`, rel: '' })
    ok(r.status === 200 && r.computer === 'Studio', 'turned on there, the look runs on Studio', r)
    const x = await until(async () => { const y = await M(`/files/insights/${r.id}`); return y.state !== 'running' ? y : null }, 30000, 200)
    ok(x?.state === 'done' && x.found.duplicates.groups[0]?.files.join() === 'clip copy.mov,clip.mov', 'Studio\'s duplicates, found there', x?.found?.duplicates)
    ok(x.partial === 'limit' && x.skipped.some((s) => s.kind === 'limit' && s.files === 40), 'a look that reaches its limit stops there and says so', { partial: x.partial, skipped: x.skipped })
    const sm = await M('/files/assist/model')
    ok(sm.status === 200 && sm.model === null && sm.computer === 'Studio', 'Studio has no model of its own to ask: none picked for you, said to be Studio\'s', sm)
    const na = await M(`/files/insights/${r.id}/ask`, {})
    ok(na.status === 400 && na.code === 'pick', 'Ask AI there asks you to pick one first', na)
    ok(same(was, snapshot(shared)).length === 0, 'nothing in Studio\'s folder changed', same(was, snapshot(shared)))
    // Its Desktop, which macOS hasn't asked about there: not looked in from here, where nobody at
    // Studio would see the question; on Studio itself, it is.
    if (IS_MAC) {
      put(path.join(studio.home, 'Desktop'), 'note.txt', 'hi')
      studio.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
      await studio.api('/agents/catalog')
      const home = (await studio.api('/agents/launch', { kind: 'claude', cwd: studio.home, label: 'Home', newSpace: 'Home' })).paneId
      const far = await M('/files/insights', { root: home, rel: 'Desktop' })
      ok(far.status === 403 && far.code === 'ask' && /macOS asks before Bridge AI looks in Desktop on Studio/.test(far.error), 'its Desktop, not yet asked about there, isn\'t looked in from another computer, saying why', far)
      const near = await studio.api('/files/insights', { root: home, rel: 'Desktop' })
      ok(['running', 'done'].includes(near.state), 'on Studio itself it is')
    } else skip('a protected folder asked about from another computer', 'only a Mac protects folders')
  })

  // ---------- A folder macOS asks about (scripts/tcc-sim.mjs) ----------
  await part('a protected folder', async () => {
    // Held as a network drive or macOS's question holds a read; the app's waiting notice is the same
    // off a Mac (Linux here), so Windows has nothing more to show.
    if (IS_WIN) { skip('a folder whose first read is held', 'the slow-folder stand-in (scripts/tcc-sim.mjs) takes POSIX paths'); return }
    const HOLD = 4000
    const tk = await startKit('files-assist-tcc', {
      config: { trials: { files: true } },
      env: ({ home }) => ({ NODE_OPTIONS: `--import ${pathToFileURL(path.join(ROOT, 'scripts', 'tcc-sim.mjs')).href}`, SIM_PROTECTED: ['Documents', 'Downloads', 'Desktop'].map((d) => path.join(home, d)).join(':'), SIM_MS: String(HOLD) }),
    })
    kits.push(tk)
    await tk.api('/setup', { name: 'Tester' })
    const taxes = path.join(tk.home, 'Documents', 'Taxes')
    const tax = crypto.randomBytes(200_000)
    put(taxes, '2024.pdf', tax)
    put(taxes, '2024 copy.pdf', tax)
    put(taxes, 'receipts/one.jpg', crypto.randomBytes(5000))
    const pl = (await tk.api('/places', { path: taxes })).place
    let worst = 0
    let pinging = true
    const pings = (async () => { while (pinging) { const t = Date.now(); await fetch(`${tk.url}/api/version`).catch(() => {}); worst = Math.max(worst, Date.now() - t); await sleep(200) } })()
    const t = Date.now()
    const s = await tk.api('/files/insights', { root: `place:${pl.id}`, rel: '' })
    ok(Date.now() - t < 1500, `asking about it answers at once (${Date.now() - t} ms)`)
    const waiting = await until(async () => (await tk.api(`/files/insights/${s.id}`)).waiting, 8000, 200)
    ok(waiting && (IS_MAC ? waiting.macos === 'Documents' : waiting.macos === null), IS_MAC ? 'while macOS holds the first read, the look says it\'s waiting on macOS\'s question about Documents' : 'while the first read is held, the look says it\'s waiting', waiting)
    const x = await until(async () => { const y = await tk.api(`/files/insights/${s.id}`); return y.state !== 'running' ? y : null }, 120000, 300)
    pinging = false
    await pings
    ok(x?.state === 'done' && x.found.duplicates.count === 1, 'then it carries on and finishes', x && { state: x.state, error: x.error })
    ok(worst < 1500 && !/\[tcc-sim\] FROZE/.test(tk.log()), `the server never froze meanwhile (slowest answer ${worst} ms)`, tk.log().match(/\[tcc-sim\] FROZE.*/g))
    if (IS_MAC) {
      const asked = JSON.parse(fs.readFileSync(path.join(tk.data, 'asked-folders.json'), 'utf8'))
      ok(asked.includes(path.join(tk.home, 'Documents')), 'and Documents counts as asked from then on', asked)
    }
    // In the panel: a folder in Downloads, which macOS hasn't asked about yet.
    const old = path.join(tk.home, 'Downloads', 'Old')
    put(old, 'setup.dmg', crypto.randomBytes(9000))
    const dl = (await tk.api('/places', { path: old })).place
    tk.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
    await tk.api('/agents/catalog')
    const pane = (await tk.api('/agents/launch', { kind: 'claude', cwd: tk.home, label: 'Home', newSpace: 'Home' })).paneId
    const { ctx, p, errors } = await page(b, tk.url, { mode: 'light', store: { 'cc-files-where': { [`here\nagent:${pane}`]: { place: dl.id } } } })
    try {
      const bar = await openFiles(p, pane)
      await bar.click()
      const wait = p.locator('.fa-panel .fa-wait')
      ok(await wait.waitFor({ timeout: 15000 }).then(() => true, () => false), 'the panel says it\'s waiting')
      const said = await wait.innerText().catch(() => '')
      ok(IS_MAC ? /macOS is asking whether Bridge AI may look in Downloads/.test(said) : /Still waiting for Old to answer/.test(said), IS_MAC ? 'and that macOS is asking about Downloads, to answer its question' : 'and what for', said)
      await shot(p, `files-assist-${tag}waiting`)
      ok(await p.locator('.fa-panel .fa-tiles').waitFor({ timeout: 90000 }).then(() => true, () => false), 'then shows what it found')
      ok(!withoutCutOff(errors).length, 'no page errors', errors)
    } finally { await ctx.close() }
  })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  if (mess) unlock(mess)
  for (const k of kits) { try { k.stop() } catch { /* gone */ } }
  for (const r of [...relays, ...holds]) { try { r.stop() } catch { /* gone */ } }
  await b.close().catch(() => {})
}
const st = done()
process.exit(st.fail ? 1 : 0)
