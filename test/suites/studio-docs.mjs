// Studio's documents and its home, on any platform, in the browser named by BRIDGE_TEST_BROWSER.
// A Word file with most of what Word puts in one (lib/wordfile.mjs: headers and footers with page
// numbers, a comment, tracked changes, a footnote, lists, a table with a merged cell, a picture,
// a bookmark, a link) opened as pages, edited and saved back with everything it didn't change
// exactly as it was, part by part and paragraph by paragraph; its toolbar (styles, fonts, sizes,
// colours, highlight, alignment, spacing, lists), pictures put in and resized, tables, its header
// edited, find and replace, the outline, the word count; AI Assist on a Markdown file, by the words
// picked and at the right end of the header (the change shown before it's taken, and a model that
// can't answer saying why). Studio's Files: your
// files from wherever they are (Spotlight on a Mac, the recently used list on Linux, a look in the
// usual and cloud drive folders elsewhere, your places, your agents' folders and Studio's own),
// each with its folder, when it changed and Open, looked for only once Studio is opened; shown by
// Recent, by kind and by where they are, with a search through all of them; a project's code
// listing only its documents and decks; the newest of each kind; a folder added. Preview beside
// Files, as an agent's tab has them: the file open in its own editor, a whiteboard on its own page.
// Open in Word: which apps this computer has (Windows' registry, Linux's PATH and a Mac's
// Applications folders and Spotlight, each with stand-ins, run here whatever this computer is; then
// this computer's through the server), the app for each kind and none for a page, opening it there
// (open -a, LibreOffice), what's saved there shown and never saved over, a save that can't be made
// said in Focus, and in another computer's window said to open on the file's computer.
// On a phone: what to show picked from one list, the home and a Word file as one column, fitting.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startKit, startModel, checks, until, sleep, browser, page, shot, phoneFaults, solid, noServiceWorker, TEST, ROOT } from '../lib/harness.mjs'
import { richDocx, chartPng } from '../lib/wordfile.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const JSZip = require('jszip')
const { ok, skip, done } = checks('studio-docs')
const kit = await startKit('studio-docs', { env: { CLAUDE_STAND_IN_TYPED: '1' } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
// The apps that open what Studio edits (server/studioapps.js), as each system says where they are,
// and LibreOffice standing in for itself (what it was asked to open, in soffice.log). On a Mac: Word
// in /Applications (the kit's: BRIDGE_APPLICATIONS) found by its name, Excel in a folder in it found
// only by Spotlight (its bundle id), Keynote in ~/Applications, PowerPoint said by Spotlight to be
// where it isn't any more and Pages in the Trash, neither offered. On Windows: the registry's App
// Paths (a stand-in reg) with Word, and PowerPoint where it isn't. On Linux: LibreOffice on the PATH.
const SYS_APPS = path.join(kit.dir, 'Applications')
const MAC_APPS = { word: path.join(SYS_APPS, 'Microsoft Word.app'), excel: path.join(SYS_APPS, 'Microsoft Office', 'Microsoft Excel.app'), keynote: path.join(kit.home, 'Applications', 'Keynote.app') }
const SPOT_APPS = [`${MAC_APPS.excel}   kMDItemCFBundleIdentifier = com.microsoft.Excel`, `${path.join(SYS_APPS, 'Microsoft PowerPoint.app')}   kMDItemCFBundleIdentifier = com.microsoft.Powerpoint`, `${path.join(kit.home, '.Trash', 'Pages.app')}   kMDItemCFBundleIdentifier = com.apple.iWork.Pages`].join('\n')
const appsAsked = path.join(kit.home, 'mdfind-apps.log')
const winWord = path.join(kit.dir, 'Program Files', 'Microsoft Office', 'root', 'Office16', 'WINWORD.EXE')
const sofficeLog = path.join(kit.home, 'soffice.log')
if (process.platform === 'darwin') for (const a of Object.values(MAC_APPS)) fs.mkdirSync(path.join(a, 'Contents'), { recursive: true })
if (process.platform === 'win32') {
  fs.mkdirSync(path.dirname(winWord), { recursive: true })
  fs.writeFileSync(winWord, '')
  const key = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths'
  const said = ['', `${key}\\Winword.exe`, `    (Default)    REG_SZ    ${winWord}`, `    Path    REG_SZ    ${path.dirname(winWord)}\\`, '', `${key}\\POWERPNT.EXE`, `    (Default)    REG_SZ    "${path.join(path.dirname(winWord), 'POWERPNT.EXE')}"`, ''].join('\r\n')
  kit.program('reg', `if(/^HKLM\\\\SOFTWARE\\\\Microsoft/i.test(process.argv[3]||''))process.stdout.write(${JSON.stringify(said)});else process.exit(1)`)
}
if (process.platform === 'linux') kit.program('soffice', `require('fs').appendFileSync(${JSON.stringify(sofficeLog)},process.argv.slice(2).join(' | ')+'\\n')`)
// Spotlight, standing in: the kit's home's documents as mdfind prints them, each run noted. When
// each changed is the file's own time; one that changed in the last 60 days was opened yesterday,
// an older one not lately (as Spotlight has it: no date). A .key file is Keynote's only when it's a
// zip, as Spotlight tells by its kind.
const asked = path.join(kit.home, 'mdfind.log')
kit.program('mdfind', `const fs=require('fs'),path=require('path');if(process.argv.some((a)=>a.includes('kMDItemCFBundleIdentifier =='))){fs.appendFileSync(${JSON.stringify(appsAsked)},process.argv.slice(2).join(' | ')+'\\n');console.log(${JSON.stringify(SPOT_APPS)});process.exit(0)}fs.appendFileSync(${JSON.stringify(asked)},process.argv.slice(2).join(' ')+'\\n');const home=${JSON.stringify(kit.home)};const out=[];const at=(ms)=>new Date(ms).toISOString().replace('T',' ').replace(/\\.\\d+Z$/,' +0000');const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name.startsWith('.'))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\\.(docx|xlsx|pptx|pdf|doc|xls|ppt|odt|ods|odp|key)$/.test(e.name)&&!(/\\.key$/.test(e.name)&&fs.readFileSync(p).toString('latin1',0,2)!=='PK')){const m=fs.statSync(p).mtimeMs;out.push(p+'   kMDItemLastUsedDate = '+(Date.now()-m<60*864e5?at(Date.now()-864e5):'(null)')+'   kMDItemFSContentChangeDate = '+at(m))}}};walk(home);console.log(out.join('\\n'))`)
// Opening a file in its own app, standing in for macOS's open and Linux's xdg-open: what it was asked to open.
const opened = path.join(kit.home, 'opened.log')
for (const n of ['open', 'xdg-open']) kit.program(n, `require('fs').appendFileSync(${JSON.stringify(opened)},process.argv.slice(2).join(' ')+'\\n')`)
const model = await startModel('studio-docs')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const api = kit.api
const pages = []
let empty = null // a second Bridge AI, with no files at all
const partsOf = async (file) => { const z = await JSZip.loadAsync(fs.readFileSync(file)); const o = {}; for (const n of Object.keys(z.files)) if (!z.files[n].dir) o[n] = await z.file(n).async('string'); return o }
const changed = (a, c) => Object.keys({ ...a, ...c }).filter((k) => a[k] !== c[k]).sort()
// The caret put at the end of the paragraph with some words in it (or of the document), through the
// editor itself: a keyboard's way to the end of a document isn't the same in every browser a test runs.
const caret = (p, where, sel = '.sd-w') => p.evaluate(({ where, sel }) => {
  const e = document.querySelector(sel).editor
  let at = null
  if (where !== 'end') e.state.doc.descendants((n, pos) => { if (at == null && n.isTextblock && n.textContent.includes(where)) at = pos + n.nodeSize - 1; return at == null })
  // Focused now (the editor's own focus waits a frame, and a key pressed meanwhile goes elsewhere).
  e.view.focus()
  e.commands.focus(where === 'end' ? 'end' : at)
}, { where, sel })
// The words of the paragraph with some words in it, picked whole (two triple clicks in a row are
// counted on by the editor as more clicks, so a test picks them this way).
const pickAll = (p, where, sel = '.sd-w') => p.evaluate(({ where, sel }) => {
  const e = document.querySelector(sel).editor
  let r = null
  e.state.doc.descendants((n, pos) => { if (!r && n.isTextblock && n.textContent.includes(where)) r = { from: pos + 1, to: pos + n.nodeSize - 1 }; return !r })
  e.view.focus()
  e.commands.setTextSelection(r)
}, { where, sel })
const paras = (xml) => xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []
const bare = (p, scope = '.sd-file') => p.locator(scope).evaluateAll((els) => els.flatMap((root) => [...root.querySelectorAll('button, a[href], select, input')]
  .filter((x) => x.getClientRects().length && x.type !== 'file')
  .filter((x) => { const text = x.innerText?.trim(); return !(x.getAttribute('aria-label') || text) || (x.tagName === 'BUTTON' && !text && !x.title) })
  .map((x) => x.outerHTML.slice(0, 140))))
try {
  await api('/setup', { name: 'Tester' })
  await api('/settings', { trials: { studio: true } }, 'PATCH')
  const dir = path.join(kit.home, 'Work', 'plans')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'report.docx'), await richDocx({ pages: 3 }))
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\nThis is teh plan for the week.\n\nIt will fail on purpose here.\n')
  const downloads = path.join(kit.home, 'Downloads')
  fs.mkdirSync(downloads, { recursive: true })
  fs.writeFileSync(path.join(downloads, 'Contract.docx'), await richDocx({ pages: 1 }))
  fs.writeFileSync(path.join(downloads, 'Budget 2027.xlsx'), 'x')
  // Linux: the desktop's list of recently used files says so too.
  if (process.platform === 'linux') {
    fs.mkdirSync(path.join(kit.home, '.local', 'share'), { recursive: true })
    fs.writeFileSync(path.join(kit.home, '.local', 'share', 'recently-used.xbel'), `<?xml version="1.0"?>\n<xbel version="1.0"><bookmark href="file://${encodeURI(path.join(downloads, 'Contract.docx'))}" added="2026-11-04T09:00:00Z" modified="2026-11-04T09:00:00Z" visited="2026-11-05T10:00:00Z"></bookmark></xbel>\n`)
  }
  // A presentation in a cloud drive (where each system keeps one: ~/Library/CloudStorage on a Mac),
  // a deck Studio made from a meeting in its own folder, a project's code (a git repository) with
  // its README, a page and data beside a Word file and a Markdown deck, more PDFs in a place than
  // the home lists, and a whiteboard.
  const cloudName = process.platform === 'linux' ? 'Dropbox' : 'OneDrive'
  const cloud = path.join(kit.home, ...(process.platform === 'darwin' ? ['Library', 'CloudStorage', 'OneDrive-Test'] : process.platform === 'win32' ? ['OneDrive - Test'] : ['Dropbox']), 'Plans')
  fs.mkdirSync(cloud, { recursive: true })
  fs.writeFileSync(path.join(cloud, 'Pitch.pptx'), 'x')
  const own = path.join(kit.data, 'studio', 'files')
  fs.mkdirSync(own, { recursive: true })
  fs.writeFileSync(path.join(own, 'Weekly sync deck.md'), '---\nmarp: true\n---\n\n# Weekly sync\n')
  const code = path.join(kit.home, 'Code', 'app')
  fs.mkdirSync(path.join(code, '.git'), { recursive: true })
  fs.mkdirSync(path.join(code, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(code, 'README.md'), '# App\n')
  fs.writeFileSync(path.join(code, 'index.html'), '<!doctype html>\n<title>App</title>\n')
  fs.writeFileSync(path.join(code, 'data.csv'), 'a,b\n1,2\n')
  fs.writeFileSync(path.join(code, 'docs', 'Spec.docx'), await richDocx({ pages: 1 }))
  fs.writeFileSync(path.join(code, 'docs', 'Launch.md'), '---\nmarp: true\n---\n\n# Launch\n')
  const scans = path.join(kit.home, 'Scans')
  fs.mkdirSync(scans, { recursive: true })
  // Scanned over a year ago: not recent, but a kind's files all the same.
  const yearAgo = new Date(Date.now() - 400 * 86400_000)
  for (let i = 0; i < 104; i++) { fs.writeFileSync(path.join(scans, `Scan ${i}.pdf`), 'x'); fs.utimesSync(path.join(scans, `Scan ${i}.pdf`), yearAgo, yearAgo) }
  // Kinds Studio doesn't open: an older Word file (everywhere), and on a Mac Keynote, as a zip in the
  // project's docs and as a package (a folder) in a place; a key file that's named .key isn't one.
  fs.writeFileSync(path.join(downloads, 'Old notes.doc'), 'x')
  fs.mkdirSync(path.join(code, 'certs'), { recursive: true })
  fs.writeFileSync(path.join(code, 'certs', 'server.key'), 'a key, not a zip\n')
  fs.writeFileSync(path.join(code, 'docs', 'Talk.key'), Buffer.from('PK\x03\x04keynote', 'latin1'))
  fs.mkdirSync(path.join(dir, 'Plan.key'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Plan.key', 'Index.zip'), 'PK')
  const codeRoot = `place:${(await api('/places', { path: code })).place.id}`
  await api('/places', { path: scans })
  await api('/boards', { title: 'Roadmap' })
  const place = (await api('/places', { path: dir })).place
  const root = `place:${place.id}`
  const F = (p) => ({ root, path: p })
  const file = (n) => path.join(dir, n)

  // ---------- The server ----------
  // Your files: found only when asked, a place's through the place, others through their folder.
  ok(!fs.existsSync(asked), 'nothing is looked for before Studio asks (Spotlight not asked)')
  const found = await api('/studio/found')
  const contract = found.files.find((f) => f.name === 'Contract.docx')
  const report = found.files.find((f) => f.name === 'report.docx')
  // Its folder as the computer writes it (~\Downloads on Windows).
  const downloadsShown = `~${path.sep}Downloads`
  ok(!!contract && /^found:[0-9a-f]{12}$/.test(contract.root) && contract.dir === downloadsShown && contract.where === null && contract.kind === 'doc' && !Number.isNaN(Date.parse(contract.at)), 'Studio\'s home finds a document in Downloads, with its folder and when it changed, to open through its folder', contract)
  ok(!!report && report.root === root && report.path === 'report.docx', 'one in a place opens through the place', report)
  ok(found.sources.includes(process.platform === 'darwin' ? 'spotlight' : process.platform === 'linux' ? 'xbel' : 'folders') && (process.platform !== 'darwin' || fs.existsSync(asked)), `found by ${found.sources.join(', ')}`, found)
  ok((await api(`/studio/open?root=${encodeURIComponent(contract.root)}&path=${encodeURIComponent(contract.path)}`)).kind === 'doc', 'a file found in Downloads opens')
  if (process.platform === 'darwin') ok(/-attr kMDItemFSContentChangeDate \(kMDItemFSName == "\*\.docx"c \|\| [^)]*"\*\.pdf"c \|\| [^)]*"\*\.doc"c[^)]*\) \|\| \(kMDItemContentType == "com\.apple\.iwork\.\*" && \([^)]*"\*\.key"c\)\) \|\| \(/.test(fs.readFileSync(asked, 'utf8')), 'Spotlight is asked for every Word, Excel, PowerPoint and PDF file however long ago it changed, their older kinds too, and Keynote, Pages and Numbers by their kind', fs.readFileSync(asked, 'utf8'))
  const pitch = found.files.find((f) => f.name === 'Pitch.pptx')
  ok(pitch?.kind === 'deck' && pitch.area?.type === 'cloud' && pitch.area.name === cloudName && /^found:/.test(pitch.root), `a presentation in ${cloudName} is found, said to be there`, pitch)
  const weekly = found.files.find((f) => f.name === 'Weekly sync deck.md')
  ok(weekly?.root === 'studio' && weekly.path === 'Weekly sync deck.md' && weekly.kind === 'deck' && weekly.area?.type === 'studio', "a deck in Studio's own folder (made from a meeting) is found, as a deck", weekly)
  ok(contract.area?.type === 'folder' && contract.area.name === 'Downloads' && report.area?.type === 'place' && report.area.name === 'plans', 'each says where it is: a folder in your home, a place', { contract: contract.area, report: report.area })
  const inCode = found.files.filter((f) => f.root === codeRoot).map((f) => `${f.path}:${f.kind}`).sort()
  ok(JSON.stringify(inCode) === JSON.stringify(['docs/Launch.md:deck', 'docs/Spec.docx:doc', ...(process.platform === 'darwin' ? ['docs/Talk.key:deck'] : [])]) && found.skipped >= 3, "in a project's code only its Word file, its Markdown deck (and on a Mac its Keynote), not its README, page or data, which are counted", { inCode, skipped: found.skipped })
  const old = found.files.find((f) => f.name === 'Old notes.doc')
  ok(old?.kind === 'doc' && old.opens === false && !found.files.some((f) => f.name === 'server.key'), "an older Word file is listed as a document Studio doesn't open; a key file named .key isn't taken for Keynote", old)
  if (process.platform === 'darwin') {
    const talk = found.files.find((f) => f.name === 'Talk.key'), plan = found.files.find((f) => f.name === 'Plan.key')
    ok(talk?.kind === 'deck' && talk.opens === false && plan?.kind === 'deck' && plan.opens === false && plan.root === root && plan.path === 'Plan.key', "Keynote on a Mac, a file and a package (a folder): decks Studio doesn't open", { talk, plan })
  }
  const pdfs = found.files.filter((f) => f.kind === 'pdf').length
  ok(pdfs === found.perKind && found.capped.pdf >= 104, `the newest ${found.perKind} PDFs, saying there are ${found.capped?.pdf}`, { pdfs, capped: found.capped })
  ok(/didn't find that folder/.test((await api('/studio/open?root=found:000000000000&path=x.docx').catch((e) => e)).message || ''), 'a folder Studio never found doesn\'t open, saying so')
  // Edit in place: the model picked for Studio rewrites what's picked; a model that can't, says why.
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { studio: { model: 'openai:gpt-5' } }, 'PATCH')
  const rw = await api('/studio/rewrite', { text: 'teh plan', instruction: 'Fix the spelling.' })
  ok(rw.text === 'The plan' && rw.model === 'openai:gpt-5' && model.asked(/^Instruction: Fix the spelling/).length > 0, 'Edit in place: the words picked, rewritten by the model picked for Studio', rw)
  ok(/Pick the words/.test((await api('/studio/rewrite', { text: ' ', instruction: 'x' }).catch((e) => e)).message || ''), 'nothing picked: it says so')
  const writer = await api('/studio/writer')
  ok(writer.model?.id === 'openai:gpt-5' && writer.picked && writer.models.some((m) => m.id === 'openai:gpt-5'), 'which model writes, and the others to pick from', writer)

  // ---------- Which apps open what (server/studioapps.js) ----------
  // The look itself, for each kind of computer whatever this one is, with each system's stand-ins:
  // Windows' registry (reg, its default value named in German and one with %ProgramFiles% in
  // quotes), Linux's PATH, a Mac's Applications folders and Spotlight.
  const unit = path.join(kit.dir, 'apps-unit')
  fs.mkdirSync(path.join(unit, 'home', 'Applications'), { recursive: true })
  const homeWas = process.env.BRIDGE_HOME
  process.env.BRIDGE_HOME = path.join(unit, 'data')
  const studioApps = await import('../../server/studioapps.js')
  if (homeWas === undefined) delete process.env.BRIDGE_HOME; else process.env.BRIDGE_HOME = homeWas
  const office = path.join(unit, 'Program Files', 'Microsoft Office', 'root', 'Office16')
  fs.mkdirSync(office, { recursive: true })
  for (const n of ['WINWORD.EXE', 'POWERPNT.EXE']) fs.writeFileSync(path.join(office, n), '')
  const regKey = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths'
  const regSaid = ['', `${regKey}\\excel.exe`, `    (Standard)    REG_SZ    ${path.join(office, 'EXCEL.EXE')}`, '', `${regKey}\\Winword.exe`, `    (Standard)    REG_SZ    ${path.join(office, 'WINWORD.EXE')}`, `    Path    REG_SZ    ${office}`, '', `${regKey}\\POWERPNT.EXE`, `    (Default)    REG_EXPAND_SZ    "%OfficeHere%${path.sep}POWERPNT.EXE"`, ''].join('\r\n')
  ok(JSON.stringify(studioApps.registryApps(regSaid, { OfficeHere: office })) === JSON.stringify({ 'excel.exe': path.join(office, 'EXCEL.EXE'), 'winword.exe': path.join(office, 'WINWORD.EXE'), 'powerpnt.exe': path.join(office, 'POWERPNT.EXE') }), "Windows: the registry's App Paths read, whatever the default value is called and quoted or with %ProgramFiles% in it", studioApps.registryApps(regSaid, { OfficeHere: office }))
  fs.writeFileSync(path.join(unit, 'reg.cjs'), `if(/^HKLM\\\\SOFTWARE\\\\Microsoft/i.test(process.argv[3]||''))process.stdout.write(${JSON.stringify(regSaid)});else process.exit(1)`)
  const onWin = await studioApps.look({ platform: 'win32', env: { ...process.env, BRIDGE_REG: path.join(unit, 'reg.cjs'), OfficeHere: office } })
  ok(JSON.stringify(onWin) === JSON.stringify({ word: path.join(office, 'WINWORD.EXE'), powerpoint: path.join(office, 'POWERPNT.EXE') }), 'Windows: Word and PowerPoint, where the registry says they are; Excel, said but not there, not offered', onWin)
  ok(JSON.stringify(await studioApps.look({ platform: 'win32', env: { ...process.env, BRIDGE_REG: path.join(unit, 'nothing.cjs') } })) === '{}', 'Windows: no registry to ask, no app')
  const unitBin = path.join(unit, 'bin')
  fs.mkdirSync(unitBin, { recursive: true })
  // Named as Linux has it (no .cmd, whatever system this is), and soffice.cmd beside it, which
  // Linux wouldn't run.
  const lo = path.join(unitBin, 'libreoffice')
  fs.writeFileSync(lo, '#!/bin/sh\n', { mode: 0o755 })
  fs.writeFileSync(path.join(unitBin, 'soffice.cmd'), '@echo off\r\n', { mode: 0o755 })
  const onLinux = await studioApps.look({ platform: 'linux', PATH: [path.join(unit, 'none'), unitBin].join(path.delimiter) })
  ok(onLinux.libreoffice === lo && JSON.stringify(await studioApps.look({ platform: 'linux', PATH: path.join(unit, 'none') })) === '{}', 'Linux: LibreOffice on the PATH (as libreoffice, not a soffice.cmd), and none without it', onLinux)
  fs.mkdirSync(path.join(unit, 'Apps', 'Pages.app'), { recursive: true })
  fs.mkdirSync(path.join(unit, 'Apps', 'iWork', 'Numbers.app'), { recursive: true })
  const spotSaid = '/Applications/iWork/Numbers.app   kMDItemCFBundleIdentifier = com.apple.iWork.Numbers\n/Volumes/Backup/.Trashes/501/Keynote.app   kMDItemCFBundleIdentifier = com.apple.iWork.Keynote\n/Applications/Big.app/Contents/Microsoft Word.app   kMDItemCFBundleIdentifier = com.microsoft.Word\n'
  ok(JSON.stringify(studioApps.spotlightApps(spotSaid)) === JSON.stringify([{ path: '/Applications/iWork/Numbers.app', bundle: 'com.apple.iWork.Numbers' }]), "a Mac: Spotlight's apps read, not one in the Trash or inside another app", studioApps.spotlightApps(spotSaid))
  if (process.platform !== 'win32') {
    const spotUnit = `${path.join(unit, 'Apps', 'iWork', 'Numbers.app')}   kMDItemCFBundleIdentifier = com.apple.iWork.Numbers\n${path.join(unit, 'home', '.Trash', 'Keynote.app')}   kMDItemCFBundleIdentifier = com.apple.iWork.Keynote\n`
    fs.mkdirSync(path.join(unit, 'mdbin'), { recursive: true })
    fs.writeFileSync(path.join(unit, 'mdbin', 'mdfind'), `#!/bin/sh\nprintf '%s' '${spotUnit}'\n`, { mode: 0o755 })
    const onMac = await studioApps.look({ platform: 'darwin', home: path.join(unit, 'home'), env: { BRIDGE_APPLICATIONS: path.join(unit, 'Apps'), PATH: path.join(unit, 'mdbin') } })
    ok(JSON.stringify(onMac) === JSON.stringify({ pages: path.join(unit, 'Apps', 'Pages.app'), numbers: path.join(unit, 'Apps', 'iWork', 'Numbers.app') }), 'a Mac: Pages in Applications by its name, Numbers in a folder in it by Spotlight; nothing else', onMac)
  } else skip("a Mac's look with Spotlight standing in", 'the stand-in mdfind is a shell script')
  // This computer's, through the server: the app for each kind of file Studio opens.
  const appsHere = await until(async () => { const r = await api('/studio/apps'); return r.looked && r }, 10000, 200)
  const by = Object.fromEntries(Object.entries(appsHere?.apps || {}).map(([e, a]) => [e, a.name]))
  const wantApps = { darwin: { '.docx': 'Word', '.xlsx': 'Excel', '.xlsm': 'Excel', '.csv': 'Excel', '.tsv': 'Excel', '.pptx': 'Keynote' }, win32: { '.docx': 'Word' }, linux: { '.docx': 'LibreOffice', '.xlsx': 'LibreOffice', '.xlsm': 'LibreOffice', '.csv': 'LibreOffice', '.tsv': 'LibreOffice', '.pptx': 'LibreOffice' } }[process.platform]
  ok(JSON.stringify(by) === JSON.stringify(wantApps), { darwin: "a Mac: Word for documents, Excel (found by Spotlight) for sheets, and for decks Keynote, as PowerPoint isn't where Spotlight said and Pages is in the Trash", win32: 'Windows: Word for documents, from the registry; nothing for sheets or decks (PowerPoint isn\'t where it says)', linux: 'Linux: LibreOffice for documents, sheets and decks' }[process.platform], appsHere)
  if (process.platform === 'darwin') ok(fs.readFileSync(appsAsked, 'utf8').split('\n')[0].startsWith(`-onlyin | ${SYS_APPS} | -onlyin | ${path.join(kit.home, 'Applications')} | -attr | kMDItemCFBundleIdentifier`), 'Spotlight is asked only about the Applications folders', fs.readFileSync(appsAsked, 'utf8'))
  // Opening: only from a window on this computer, and only for a kind with an app.
  const openIn = (f, headers = {}) => fetch(`${kit.url}/api/studio/open-in`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(f) }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
  const logs = () => [opened, sofficeLog].map((x) => (fs.existsSync(x) ? fs.readFileSync(x, 'utf8') : '')).join('')
  const logsBefore = logs()
  const far = await openIn(F('report.docx'), { 'x-bridge-relay': 'far' })
  ok(far.status >= 400 && /on your computer/.test(far.error || '') && logs() === logsBefore, 'asked from another computer or a phone: refused, nothing opened', far)
  const noApp = await openIn(F('notes.md'))
  ok(noApp.status >= 400 && /No app on this computer opens this kind of file here/.test(noApp.error || '') && logs() === logsBefore, 'a kind with no app of its own (Markdown): refused, saying so', noApp)
  ok((await openIn(F('../../outside.docx'))).status >= 400 && logs() === logsBefore, 'nothing outside its folder')

  // ---------- Studio's home ----------
  const w = await page(b, kit.url, { width: 1440, height: 900 })
  pages.push(w)
  const p = w.p
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  const home = () => until(async () => { await p.locator('.rail-nav-btn', { hasText: 'Studio' }).click(); return p.locator('.sd-home').waitFor({ timeout: 1500 }).then(() => true, () => false) }, 20000, 300)
  ok(!!(await home()), 'Studio opens from the rail')
  // Files and Preview, as an agent's tab has them: Files first, and Preview with nothing open yet
  // saying how to open one.
  const tab = (name) => p.locator('.sd-tabs [role="tab"]', { hasText: name })
  ok(await tab('Files').getAttribute('aria-selected') === 'true' && await tab('Preview').count() === 1, 'Studio opens at Files, with Preview beside it')
  await tab('Preview').click()
  ok(!!(await until(async () => /Nothing open in Preview yet/.test(await p.locator('.sd-home-view .sd-empty').innerText().catch(() => '')), 3000, 100)), 'Preview with nothing open yet says how to open something')
  await p.locator('.sd-home-view .sd-empty button', { hasText: 'Show Files' }).click()
  const row = (name) => p.locator('.sd-files-row', { hasText: name })
  const group = (name) => p.locator('.sd-groups button', { hasText: name }).first()
  const listed = () => p.locator('.sd-files-row:not(.head) .sd-file-text b').allInnerTexts()
  ok(!!(await until(async () => (await row('Contract.docx').count()) === 1 && (await row('report.docx').count()) === 1, 10000)), 'its home lists your files from wherever they are, in Recent')
  const cells = await row('Contract.docx').evaluate((r) => ({ dir: r.querySelector('.sd-file-dir')?.innerText, when: r.querySelector('.sd-file-when')?.innerText, open: !!r.querySelector('.sd-file-acts .btn') }))
  ok(cells.dir === downloadsShown && !!cells.when && cells.open, 'each with its folder, when it changed, and Open', cells)
  const groups = await p.locator('.sd-groups').textContent()
  ok(['Recent', 'Kinds', 'Documents', 'Presentations', 'Sheets', 'PDFs', 'Pages', 'Whiteboards', 'Where', 'Bridge AI', cloudName, 'plans', 'Downloads'].every((w) => groups.includes(w)), 'shown by Recent, by kind and by where they are', groups)
  // New, in the header beside Files and Preview: no cards on a page that has files.
  ok(await p.locator('.sd-new-btn').count() === 0, "with files, New's cards aren't on the page")
  await p.locator('.sd-new-open').click()
  ok(JSON.stringify(await p.locator('.sd-new-menu [role="menuitem"]').allInnerTexts()) === '["Document","Markdown","Sheet","Deck","Page"]', 'New is a menu in the header: a document, Markdown, a sheet, a deck, a page')
  await p.locator('.sd-new-menu [role="menuitem"]', { hasText: 'Markdown' }).click()
  ok(!!(await until(async () => (await p.locator('.sd-new-sec h3').textContent().catch(() => '')) === 'New Markdown', 3000, 100)) && await p.locator('.sd-new-form input').count() === 1, 'one picked asks its name and folder at the top of Files')
  await p.locator('.sd-new-form button', { hasText: 'Cancel' }).click()
  await group('Sheets').click()
  ok(!!(await until(async () => (await row('Budget 2027.xlsx').count()) === 1 && (await row('report.docx').count()) === 0, 3000, 100)), 'by kind: Sheets')
  // A kind Studio doesn't open, among Documents, said so, and opened in its own app (stood in for).
  await group('Documents').click()
  const oldRow = row('Old notes.doc')
  ok(!!(await until(async () => /opened in its own app/.test(await oldRow.innerText().catch(() => '')) && (await oldRow.locator('button', { hasText: 'Open in app' }).count()) === 1 && (await oldRow.locator('button', { hasText: /^Open$/ }).count()) === 0, 3000, 100)), "an older Word file among Documents: said to open in its own app, with Open in app, not Studio's Open", await oldRow.innerText().catch(() => ''))
  if (process.platform !== 'win32') {
    await oldRow.locator('button', { hasText: 'Open in app' }).click()
    ok(!!(await until(() => fs.existsSync(opened) && fs.readFileSync(opened, 'utf8').includes('Old notes.doc'), 5000)) && /Opening Old notes\.doc in its own app/.test(await p.locator('.sd-files-note').innerText().catch(() => '')), 'Open in app: the system opens it, and Studio says so', fs.existsSync(opened) ? fs.readFileSync(opened, 'utf8') : '')
  } else skip('Open in app opens it', 'Windows opens it through Explorer, which has no stand-in here')
  await group('Presentations').click()
  ok(!!(await until(async () => { const n = await listed(); return ['Pitch.pptx', 'Weekly sync deck.md', 'Launch.md'].every((x) => n.includes(x)) && !n.includes('Contract.docx') && !n.includes('README.md') }, 3000, 100)), "Presentations: a PowerPoint in a cloud drive, the deck in Studio's own folder and a project's Markdown deck", await listed())
  await shot(p, `${tag}studio-docs-presentations`)
  await group(cloudName).click()
  ok(!!(await until(async () => JSON.stringify(await listed()) === '["Pitch.pptx"]', 3000, 100)), `by where: ${cloudName}`, await listed())
  await group('Bridge AI').click()
  ok(!!(await until(async () => { const n = await listed(); return n.includes('Weekly sync deck.md') && n.includes('Roadmap') }, 3000, 100)), "Bridge AI's own: the deck made from a meeting and the whiteboard", await listed())
  ok(await row('Weekly sync deck.md').locator('.sd-file-dir').innerText() === 'Bridge AI', "a file in Studio's own folder: its folder said as Bridge AI, not a path", await row('Weekly sync deck.md').locator('.sd-file-dir').innerText())
  await group('PDFs').click()
  ok(!!(await until(async () => /the newest 100 of 1(0[4-9]|[1-9]\d)/.test(await p.locator('.sd-list-head').innerText()), 3000, 100)), 'PDFs: the newest 100, saying how many there are', await p.locator('.sd-list-head').innerText())
  await group('Pages').click()
  ok(!!(await until(async () => /No pages found/.test(await p.locator('.sd-files-none').innerText().catch(() => '')), 3000, 100)), 'a kind with nothing in it says so')
  await group('Recent').click()
  await p.locator('.sd-files-search input').fill('contr')
  ok(!!(await until(async () => (await p.locator('.sd-files-row:not(.head)').count()) === 1, 3000, 100)), 'and by name')
  await group('Sheets').click()
  await p.locator('.sd-files-search input').fill('pitch')
  ok(!!(await until(async () => JSON.stringify(await listed()) === '["Pitch.pptx"]', 3000, 100)), 'a search looks through all your files, not only the kind picked', await listed())
  await p.locator('.sd-files-search input').fill('')
  await group('Recent').click()
  const src = await p.locator('.sd-files-src').innerText()
  ok(/Spotlight|recently used|folders/.test(src) && /Studio's own folder/.test(src) && /newest 100 of each kind/.test(src) && /projects' code/.test(src), 'it says where it looked, that only the newest of each kind are listed, and what a project\'s code leaves out', src)
  // Add a folder (a browser on this computer: typed), and its files are looked for.
  const extra = path.join(kit.home, 'Projects', 'site')
  fs.mkdirSync(extra, { recursive: true })
  fs.writeFileSync(path.join(extra, 'Brief.md'), '# Brief\n')
  await p.locator('.sd-add-folder button', { hasText: 'Add a folder' }).click()
  await p.locator('.sd-add-form input').fill(extra)
  await p.locator('.sd-add-form button', { hasText: 'Add' }).first().click()
  ok(!!(await until(async () => (await api('/places')).places.some((x) => /Projects[\\/]site$/.test(x.path)) && (await row('Brief.md').count()) === 1, 10000)), 'Add a folder: a place in Files, and its files in the list')
  await shot(p, `${tag}studio-docs-home`)
  ok(!(await bare(p, '.sd-home-view')).length, 'nothing on the home is a bare control', await bare(p, '.sd-home-view'))
  // A whiteboard opens in Preview as a board, Studio's tabs in its header; Files is a click back.
  await group('Whiteboards').click()
  await row('Roadmap').locator('.sd-file-name').click()
  ok(!!(await until(async () => (await p.locator('.wb-view .sd-tabs [role="tab"][aria-selected="true"]', { hasText: 'Preview' }).count()) === 1 && (await p.locator('.wb-view .pane-head h2').innerText().catch(() => '')).includes('Roadmap'), 20000)), 'a whiteboard opens in Preview, on its own page with Files and Preview')
  await p.locator('.wb-view .excalidraw').first().waitFor({ timeout: 20000 }).catch(() => {})
  await shot(p, `${tag}studio-docs-board`)
  await p.locator('.wb-view .sd-tabs [role="tab"]', { hasText: 'Files' }).click()
  ok(!!(await p.locator('.sd-home').waitFor({ timeout: 10000 }).then(() => true, () => false)), 'and Files goes back to your files')
  await group('Recent').click()

  // ---------- A Word file, as pages ----------
  await row('report.docx').locator('.sd-file-acts .btn').click()
  const doc = p.locator('.sd-w')
  ok(!!(await until(async () => (await p.locator('.sd-pb').count()) > 0, 20000)), 'a Word file opens as pages')
  // In Preview: Files goes back to your files, and Preview to the file again.
  ok(await tab('Preview').getAttribute('aria-selected') === 'true', 'it opens in Preview')
  await tab('Files').click()
  await p.locator('.sd-home').waitFor({ timeout: 10000 })
  await tab('Preview').click()
  ok(!!(await until(async () => (await p.locator('.sd-pb').count()) > 0 && /report\.docx/.test(await p.locator('.pane-head h2').first().innerText()), 20000)), 'Files, then Preview: back to the file last open')
  const look = await p.evaluate(() => ({
    head: document.querySelector('.sd-pb-top .sd-pb-head')?.innerText, foot: document.querySelector('.sd-pb-end .sd-pb-foot')?.innerText,
    comment: !!document.querySelector('.sd-w .sd-cmt'), ins: document.querySelector('.sd-w ins.sd-rev')?.innerText, del: document.querySelector('.sd-w del.sd-rev')?.innerText,
    note: !!document.querySelector('.sd-w .sd-x-fn'), merged: !!document.querySelector('.sd-w td[rowspan="2"]'), picture: !!document.querySelector('.sd-w img'),
    bullet: !!document.querySelector('.sd-w [data-mk="•"]'), number: !!document.querySelector('.sd-w [data-mk="1."]'), status: document.querySelector('.sd-status')?.innerText,
  }))
  ok(/Quarterly plan · internal/.test(look.head || '') && /^Page \d+ of \d+$/.test(look.foot || ''), 'its header on the page, its footer with the page number and the number of pages', look)
  ok(look.comment && /November/.test(look.ins || '') && /December/.test(look.del || '') && look.note && look.merged && look.picture && look.bullet && look.number, 'its comment, tracked changes, footnote, merged cell, picture and lists, as Word shows them', look)
  const status = await until(async () => { const x = await p.locator('.sd-status').innerText(); return /^Page 1 of [2-9]/.test(x) && x }, 5000, 100)
  ok(!!status && /Saved/.test(status), 'the status line: the page you\'re on of how many, and opened is not changed', status || await p.locator('.sd-status').innerText())
  await shot(p, `${tag}studio-docs-word`)
  // The toolbar: each control named, with its shortcut in its tooltip.
  const tb = p.locator('.sd-doc-tools')
  const names = await tb.locator('button').evaluateAll((bs) => bs.map((x) => x.getAttribute('aria-label')))
  const want = ['Undo', 'Redo', 'Text style', 'Font', 'Smaller', 'Bigger', 'Bold', 'Italic', 'Underline', 'More text formatting', 'Text colour', 'Highlight', 'Alignment', 'Line and paragraph spacing', 'Bulleted list', 'Numbered list', 'Decrease indent', 'Increase indent', 'Insert link', 'Insert picture', 'Table', 'Insert', 'Tracked changes', 'Comments', 'Outline', 'Find and replace', 'Zoom']
  ok(want.every((n) => names.includes(n)) && !names.includes('Inline code'), "a Word file's toolbar: styles, fonts and sizes, marks, colours, alignment and spacing, lists, links, pictures, tables, and the view", names)
  const tips = await tb.locator('button[aria-label="Bold"], button[aria-label="Numbered list"], button[aria-label="Find and replace"]').evaluateAll((bs) => bs.map((x) => x.title))
  ok(tips.every((x) => /\(.*(⌘|Ctrl)/.test(x)), 'with their shortcuts in their tooltips', tips)
  ok(!(await bare(p)).length, 'nothing on the page is a bare control', await bare(p))
  // The outline: its headings; one tapped is where you are.
  ok((await p.locator('.sd-outline-item').allInnerTexts()).join('|').startsWith('Summary|What we did|Numbers|Next steps'), 'the outline: the document\'s headings', await p.locator('.sd-outline-item').allInnerTexts())
  await p.locator('.sd-outline-item', { hasText: 'Next steps' }).click()
  ok(!!(await until(async () => (await p.locator('.sd-outline-item.on').innerText().catch(() => '')) === 'Next steps', 3000, 100)), 'a heading tapped in the outline is where you are')

  // ---------- Saved, exactly ----------
  // A document saves itself a moment after typing stops; ⌘S saves it at once, as here.
  const saveNow = () => p.keyboard.press(`${MOD}+s`)
  const was = await partsOf(file('report.docx'))
  await caret(p, 'We ship the pricing page')
  await p.keyboard.type(' Agreed.')
  ok(/Unsaved changes|Saving/.test(await p.locator('.sd-status').innerText()), 'typed: unsaved changes')
  await saveNow()
  const now = await until(async () => { const x = await partsOf(file('report.docx')); return /Agreed/.test(x['word/document.xml']) && x }, 10000)
  ok(!!now && changed(was, now).join() === 'word/document.xml', 'saved: only the document part changed; styles, numbering, comments, footnotes, header, footer, settings and the picture as they were, byte for byte', now && changed(was, now))
  const gone = paras(was['word/document.xml']).filter((x) => !now['word/document.xml'].includes(x))
  const edited = paras(now['word/document.xml']).find((x) => /Agreed/.test(x)) || ''
  ok(gone.length === 1 && /pricing page/.test(gone[0]) && /<w:ins /.test(edited) && /<w:del /.test(edited) && /footnoteReference/.test(edited), 'every paragraph but the one edited as it was; that one keeps its tracked changes and footnote', { gone: gone.length, edited: edited.slice(0, 600) })
  // Typed and taken back, saved: the file as it was before.
  await caret(p, 'Agreed.')
  for (let i = 0; i < 8; i++) await p.keyboard.press('Backspace')
  await saveNow()
  const back = await until(async () => { const x = await partsOf(file('report.docx')); return !/Agreed/.test(x['word/document.xml']) && x }, 10000)
  ok(!!back && !changed(was, back).length, 'the edit taken back and saved: every part exactly as it was', back && changed(was, back))

  // ---------- Formatting ----------
  await caret(p, 'end')
  await p.keyboard.press('Enter')
  await p.keyboard.type('Toggle me')
  const line = () => doc.locator(':is(p,h1,h2,h3)', { hasText: 'Toggle me' })
  const pick = () => pickAll(p, 'Toggle me')
  const drop = async (name, item) => { await tb.locator(`button[aria-label="${name}"]`).click(); await p.locator('.sd-drop .sd-item, .sd-drop .sd-sw', { hasText: item }).first().click() }
  await pick()
  const btn = (n) => tb.locator(`button[aria-label="${n}"]`)
  const marks = []
  for (const [n, sel] of [['Bold', 'strong'], ['Italic', 'em'], ['Underline', 'u']]) {
    await btn(n).click()
    const on = !!(await until(async () => (await line().locator(sel).count()) === 1 && (await btn(n).getAttribute('aria-pressed')) === 'true', 3000, 100))
    await btn(n).click()
    const off = !!(await until(async () => (await line().locator(sel).count()) === 0, 3000, 100))
    marks.push(`${n} ${on ? 'on' : 'NOT ON'} ${off ? 'off' : 'NOT OFF'}`)
  }
  ok(marks.every((x) => /on off$/.test(x)), 'Bold, Italic and Underline do what they say, shown on their buttons', marks)
  await pick()
  await btn('Text colour').click()
  await p.locator('.sd-drop .sd-sw[aria-label="#CC0000"]').click()
  await btn('Highlight').click()
  await p.locator('.sd-drop .sd-sw[aria-label="yellow"]').click()
  await btn('Bigger').click()
  await drop('Font', 'Calibri Light')
  await drop('Alignment', 'Center')
  await drop('Line and paragraph spacing', 'Double')
  await drop('More text formatting', 'Strikethrough')
  // Read where the words are: the innermost of the marks' elements around them.
  const st = await line().evaluate((e) => { const t = document.createTreeWalker(e, NodeFilter.SHOW_TEXT).nextNode(); const c = getComputedStyle(t.parentElement); return { color: c.color, bg: getComputedStyle(e.querySelector('mark') || e).backgroundColor, size: c.fontSize, font: c.fontFamily, align: getComputedStyle(e).textAlign, lh: e.style.lineHeight, strike: !!e.querySelector('s') } })
  ok(st.color === 'rgb(204, 0, 0)' && st.bg === 'rgb(255, 255, 0)' && st.size === '16px' && /Calibri Light/.test(st.font) && st.align === 'center' && !!st.lh && st.strike, 'colour, highlight, size, font, alignment, line spacing and strikethrough, on what\'s picked', st)
  await drop('Text style', 'Heading 2')
  ok(!!(await until(async () => (await doc.locator('h2', { hasText: 'Toggle me' }).count()) === 1, 3000, 100)), 'Text style: Heading 2')
  await line().click()
  await p.keyboard.press(`${MOD}+Alt+Digit0`)
  ok(!!(await until(async () => (await doc.locator('p', { hasText: 'Toggle me' }).count()) === 1, 3000, 100)), 'and back to Normal from the keyboard')
  await btn('Bulleted list').click()
  const bullet = !!(await until(async () => /^[•●◦▪■]$/.test(await line().getAttribute('data-mk') || ''), 3000, 100))
  await btn('Numbered list').click()
  ok(bullet && !!(await until(async () => /^\d+\.$/.test(await line().getAttribute('data-mk') || ''), 3000, 100)), 'a bulleted list, then numbered')
  await saveNow()
  const fmt = await until(async () => { const x = (await partsOf(file('report.docx')))['word/document.xml']; const q = paras(x).find((y) => /Toggle me/.test(y)); return q && /<w:numPr>/.test(q) && q }, 10000)
  ok(!!fmt && /<w:jc w:val="center"\/>/.test(fmt) && /w:line="480"/.test(fmt) && /<w:color w:val="CC0000"\/>/.test(fmt) && /<w:highlight w:val="yellow"\/>/.test(fmt) && /w:ascii="Calibri Light"/.test(fmt) && /<w:sz w:val="24"\/>/.test(fmt) && /<w:strike\/>/.test(fmt), 'saved as Word has them: alignment, spacing, colour, highlight, font, size, strikethrough and the list', fmt)

  // ---------- Pictures, tables, header ----------
  // The file as it is before them (each change saves itself as it's made).
  const before = await partsOf(file('report.docx'))
  await caret(p, 'Toggle me')
  await p.keyboard.press('Enter')
  await tb.locator('input[type="file"]').setInputFiles({ name: 'chart.png', mimeType: 'image/png', buffer: chartPng(120, 70) })
  ok(!!(await until(async () => (await doc.locator('img[src^="data:image/png"]').count()) === 1, 5000, 100)), 'a picture put in')
  // The chart already there, made smaller by its corner.
  const chart = doc.locator('img[src^="blob:"]').first()
  await chart.click()
  const box = await chart.boundingBox()
  const handle = p.locator('.sd-w [data-resize-container]:has(img[src^="blob:"])').first().locator('[data-resize-handle="bottom-right"]')
  const hb = await handle.boundingBox()
  if (hb) { await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down(); await p.mouse.move(hb.x - 80, hb.y - 40, { steps: 6 }); await p.mouse.up() }
  ok(!!hb && !!(await until(async () => ((await chart.boundingBox())?.width || box.width) < box.width - 40, 3000, 100)), 'a picture resized by its corner', { box, after: await chart.boundingBox() })
  await caret(p, 'end')
  await tb.locator('button[aria-label="Table"]').click()
  await p.locator('.sd-grid-cell[aria-label="2 by 3"]').click()
  const tables = await doc.locator('table').count()
  await p.keyboard.type('Cell one')
  await tb.locator('button[aria-label="Table"]').click()
  await p.locator('.sd-drop .sd-item', { hasText: 'Add a row below' }).click()
  // Its own rows: where a page ends inside a table (as it can with another computer's fonts), the
  // page's band is a row of its own between them.
  const rowsOf = () => doc.locator('table').last().locator('tr:not(.sd-pb-row)').count()
  ok(tables === 2 && (await rowsOf()) === 3, 'a table picked by its size from a grid, and a row added', { tables, rows: await rowsOf() })
  // The header, edited (a double click on it).
  await p.locator('.sd-desk').evaluate((e) => { e.scrollTop = 0 })
  await p.locator('.sd-pb-top').dblclick()
  const hed = p.locator('.sd-hf .ProseMirror').first()
  await hed.waitFor({ timeout: 5000 })
  await hed.click()
  await p.keyboard.press('End')
  await p.keyboard.type(' (draft)')
  await shot(p, `${tag}studio-docs-header`)
  await p.locator('.sd-hf button', { hasText: 'Done' }).click()
  ok(!!(await until(async () => /\(draft\)/.test(await p.locator('.sd-pb-top .sd-pb-head').innerText().catch(() => '')), 5000, 100)), 'the header changed, on every page')
  await saveNow()
  const after = await until(async () => { const x = await partsOf(file('report.docx')); return Object.values(x).some((v) => /\(draft\)/.test(v)) && x }, 10000)
  const parts = after ? changed(before, after) : []
  const stylesKept = after && (after['word/styles.xml'] === before['word/styles.xml'] || after['word/styles.xml'].replace(/<w:style [^>]*w:styleId="TableGrid"[\s\S]*?<\/w:style>/, '') === before['word/styles.xml'])
  ok(!!after && parts.includes('word/header1.xml') && !parts.some((k) => /footer|comments|footnotes|numbering|settings/.test(k)) && stylesKept && parts.some((k) => /^word\/media\/studio/.test(k)) && /Extension="png"/i.test(after['[Content_Types].xml']), 'saved: the header part, the document and the new picture (with its relationship and type); nothing else but the table style it now uses', parts)
  const drawn = after?.['word/document.xml'] || ''
  const made = (drawn.match(/<w:tbl>(?:(?!<\/w:tbl>)[\s\S])*Cell one[\s\S]*?<\/w:tbl>/) || [''])[0]
  const cols = [...made.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]))
  ok(!drawn.includes('cx="2286000"') && cols.length === 3 && cols.every((w) => w > 1000) && !/<w:tcW w:w="0"/.test(made) && /TableGrid/.test(after['word/styles.xml']), 'the picture\'s new size, and the new table in Word\'s Table Grid style, its columns sharing the page\'s width', { hasOldSize: drawn.includes('cx="2286000"'), cols })

  // ---------- Find and replace, word count ----------
  await doc.click()
  await p.keyboard.press(`${MOD}+f`)
  await p.locator('.sd-findbar input').first().fill('quarter')
  ok(!!(await until(async () => /of \d+/.test(await p.locator('.sd-find-count').innerText()), 3000, 100)) && (await doc.locator('.sd-find').count()) > 2, 'Find: every match marked, and which one of how many', await p.locator('.sd-find-count').innerText())
  await p.locator('.sd-findbar button[aria-label="Replace"]').click()
  await p.locator('.sd-findbar input').nth(1).fill('term')
  await p.locator('.sd-findbar button', { hasText: 'Replace all' }).click()
  ok(!!(await until(async () => /Replaced \d+/.test(await p.locator('.sd-findbar').innerText()) && !/quarter/.test(await doc.innerText()), 3000, 100)), 'Replace all, and how many it replaced')
  await p.keyboard.press('Escape')
  await doc.click()
  await p.keyboard.press(`${MOD}+z`)
  ok(!!(await until(async () => /quarter/.test(await doc.innerText()), 3000, 100)), 'and undone in one step')
  await p.locator('.sd-status button.sd-stat').click()
  ok(!!(await until(async () => /Words\s*[\d,]+/.test(await p.locator('.sd-count').innerText().catch(() => '')), 3000, 100)), 'the word count, from the status line', await p.locator('.sd-count').innerText().catch(() => ''))
  await p.keyboard.press('Escape')
  ok(w.errors.length === 0, 'no page errors', w.errors)

  // ---------- AI Assist, by the words picked and in the header (Markdown) ----------
  await p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'notes.md' } })), { root })
  const md = p.locator('.sd-page .ProseMirror')
  await until(async () => /teh plan/.test(await md.innerText().catch(() => '')), 15000)
  const wand = p.locator('.sd-file .pane-head .pane-extras button[aria-label="AI Assist"]')
  ok(await wand.evaluate((e) => !e.nextElementSibling), 'AI Assist at the right end of the header')
  await wand.click()
  const unpicked = await p.locator('.ai-menu').innerText()
  ok(/Pick the words to change first/.test(unpicked) && /Rewrite/.test(unpicked) && /Fix spelling and grammar/.test(unpicked) && await p.locator('.ai-menu .ai-item:not(:disabled)').count() === 0, 'a document\'s AI Assist: Rewrite, Shorten, Fix spelling and grammar… for the words picked, and says so while none are', unpicked)
  await p.keyboard.press('Escape')
  await md.locator('p', { hasText: 'teh plan' }).click({ clickCount: 3 })
  await p.mouse.move(5, 5)
  ok(/AI Assist/.test(await p.locator('.sd-bubble-ai').innerText()), 'by the words picked, inline: the wand and AI Assist')
  await p.locator('.sd-bubble-ai').click()
  ok(!!(await until(async () => (await p.locator('.sd-ask-model select').inputValue().catch(() => '')) === 'openai:gpt-5', 5000, 100)), 'AI Assist: which model writes, there to change')
  await p.locator('.sd-ask-menu .sd-item', { hasText: 'Fix spelling and grammar' }).click()
  ok(!!(await until(async () => (await p.locator('.sd-ask-diff del').count()) > 0 && /the/.test(await p.locator('.sd-ask-diff ins').allInnerTexts().then((x) => x.join(' '))), 15000)), 'AI Assist: the change shown against your words before it\'s taken', await p.locator('.sd-ask-card').innerText().catch(() => ''))
  ok(/gpt-5/.test(await p.locator('.sd-ask-card-head').innerText()), 'and which model wrote it')
  await shot(p, `${tag}studio-docs-ask`)
  await p.locator('.sd-ask-card button', { hasText: 'Replace' }).click()
  ok(!!(await until(async () => /This is the plan/.test(await md.innerText()), 3000, 100)) && /Unsaved/.test(await p.locator('.sd-status').innerText()), 'Replace: taken, as a change to save')
  await api('/settings', { studio: { model: 'anthropic:claude-test' } }, 'PATCH')
  await pickAll(p, 'fail on purpose', '.sd-page .ProseMirror')
  // From the header's AI Assist this time: the same change, for the words picked.
  await wand.click()
  await p.locator('.ai-menu button', { hasText: 'Shorten' }).click()
  ok(!!(await until(async () => /Anthropic key/.test(await p.locator('.sd-ask-card [role="alert"]').innerText().catch(() => '')), 10000)), 'a model that can\'t answer says why', await p.locator('.sd-ask-card').innerText().catch(() => ''))
  await p.locator('.sd-ask-card button', { hasText: 'Discard' }).click()

  // ---------- Open in Word ----------
  // The header offers the app this computer has for the file's kind, else its usual app, else
  // nothing. It opens on this computer, Studio keeps watching, and what's saved there comes back as
  // a change from outside, never saved over.
  const openBtn = p.locator('.sd-file .pane-head .sd-open-in')
  ok(!!(await until(async () => (await openBtn.innerText().catch(() => '')).trim() === 'Open in app', 5000, 100)) && await openBtn.getAttribute('aria-label') === 'Open in its usual app', 'Markdown: Open in app, its usual one', await openBtn.innerText().catch(() => ''))
  fs.writeFileSync(file('page.html'), '<!doctype html><title>Page</title><h1>Page</h1>')
  await p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'page.html' } })), { root })
  ok(!!(await until(async () => (await p.locator('.sd-page-ed').count()) === 1, 15000)) && await openBtn.count() === 0 && await p.locator('.sd-status .sd-open-in-narrow').count() === 0, 'a page: no app to open it in (it has Open on its own)')
  fs.writeFileSync(file('brief.docx'), await richDocx({ pages: 1 }))
  await p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'brief.docx' } })), { root })
  await until(async () => (await p.locator('.sd-pb').count()) > 0 && /brief\.docx/.test(await p.locator('.sd-file .pane-head h2').innerText().catch(() => '')), 20000)
  const appName = process.platform === 'linux' ? 'LibreOffice' : 'Word'
  ok(!!(await until(async () => (await openBtn.innerText().catch(() => '')).trim() === `Open in ${appName}`, 5000, 100)) && /Studio keeps watching it/.test(await openBtn.getAttribute('title')), `a Word file: Open in ${appName}, the app this computer has for it`, await openBtn.innerText().catch(() => ''))
  await shot(p, `${tag}studio-docs-open-in`)
  const briefReal = fs.realpathSync(file('brief.docx'))
  if (process.platform !== 'win32') {
    await openBtn.click()
    const said = await until(() => { const x = logs(); return x.includes('brief.docx') && x }, 5000)
    ok(!!said && said.includes(process.platform === 'darwin' ? `-a ${MAC_APPS.word} ${briefReal}` : `--writer | ${briefReal}`), process.platform === 'darwin' ? 'opened in Word itself (open -a, stood in for)' : 'opened in LibreOffice Writer (stood in for)', said)
    ok(!!(await until(async () => new RegExp(`Opening it in ${appName}\\. What you save there shows here`).test(await p.locator('.sd-note-bar').innerText().catch(() => '')), 3000, 100)), 'and Studio says so')
  } else skip(`Open in ${appName} opens it`, "Windows starts Word's own program, which has no stand-in here")
  // Word saves it: Studio shows that version, said to be another app's, and doesn't save over it.
  const wordSaves = async (text) => {
    const z = await JSZip.loadAsync(fs.readFileSync(file('brief.docx')))
    z.file('word/document.xml', (await z.file('word/document.xml').async('string')).replace('<w:body>', `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p>`))
    fs.writeFileSync(file('brief.docx'), await z.generateAsync({ type: 'nodebuffer' }))
    return fs.readFileSync(file('brief.docx'))
  }
  const fromWord = await wordSaves('Edited in Word.')
  ok(!!(await until(async () => /Edited in Word\./.test(await doc.innerText().catch(() => '')) && /Another app changed it: this is its new version/.test(await p.locator('.sd-note-bar').innerText().catch(() => '')), 15000)), `saved in ${appName}: Studio shows its version, saying another app changed it`)
  await sleep(2500)
  ok(Buffer.compare(fs.readFileSync(file('brief.docx')), fromWord) === 0, `and leaves the file as ${appName} saved it`)
  // In Focus a save that can't be made still says so: typed here while Word saved it again.
  await p.keyboard.press(`${MOD}+Alt+f`)
  ok(!!(await until(async () => (await p.locator('.sd-file.focus').count()) === 1, 3000, 100)), 'Focus, by its key')
  await caret(p, 'Edited in Word.')
  await p.keyboard.type(' And here.')
  const again = await wordSaves('Word again.')
  const barShown = await until(async () => {
    const c = p.locator('.sd-file.focus .sd-conflict')
    const r = await c.boundingBox().catch(() => null)
    if (!r) return false
    const onTop = await p.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.sd-conflict'), { x: r.x + 20, y: r.y + r.height / 2 })
    return onTop && r.y >= 0 && r.y + r.height <= 900 && /Changed elsewhere/.test(await p.locator('.sd-status .sd-state').innerText())
  }, 15000, 200)
  ok(!!barShown, 'in Focus: changed in Word while typed here, the bar saying so is on the page, and the status line says Changed elsewhere', await p.locator('.sd-status').innerText().catch(() => ''))
  await shot(p, `${tag}studio-docs-focus-conflict`)
  ok(Buffer.compare(fs.readFileSync(file('brief.docx')), again) === 0, "and Word's save isn't written over")
  await p.locator('.sd-conflict button', { hasText: 'Show theirs' }).click()
  ok(!!(await until(async () => /Word again\./.test(await doc.innerText()) && !/And here\./.test(await doc.innerText()), 10000)), "Show theirs: Word's version")
  await p.locator('.sd-focus-leave').click()
  ok(!!(await until(async () => (await p.locator('.sd-file.focus').count()) === 0 && await p.locator('.sd-file .pane-head').count() === 1, 3000, 100)), 'Leave Focus: the header back')

  // ---------- Another computer's window ----------
  // This computer's Studio seen in another one's window (/m/<id>/, its requests coming through that
  // computer, as the relay's do): the apps are this computer's, so Open in Word says it opens here,
  // on the file's computer, and nothing opens.
  const there = await page(b, `${kit.url}/m/far/`, {
    width: 1440, height: 900, before: async (ctx) => { await noServiceWorker(ctx); await ctx.route(/\/m\/far\//, async (r) => {
      if (r.request().headers().accept === 'text/event-stream') return r.abort()
      const u = new URL(r.request().url())
      const res = await r.fetch({ url: `${kit.url}${u.pathname.slice('/m/far'.length)}${u.search}`, headers: { ...r.request().headers(), 'x-bridge-relay': 'far' } })
      return r.fulfill({ response: res })
    }) },
  })
  pages.push(there)
  const logsThen = logs()
  await until(async () => { if (!(await there.p.locator('.sd-file .pane-head h2', { hasText: 'brief.docx' }).count())) await there.p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'brief.docx' } })), { root }); return there.p.locator('.sd-pb').first().waitFor({ timeout: 2000 }).then(() => true, () => false) }, 30000, 300)
  const farBtn = there.p.locator('.sd-file .pane-head .sd-open-in')
  ok(!!(await until(async () => (await farBtn.innerText().catch(() => '')).trim() === `Open in ${appName}`, 5000, 100)) && /opens on the computer it's on/.test(await farBtn.getAttribute('title').catch(() => '')), `another computer's window: Open in ${appName} (the file's computer has it), said to open there`, await farBtn.innerText().catch(() => ''))
  await farBtn.click()
  ok(!!(await until(async () => new RegExp(`${appName} opens it on the computer it's on`).test(await there.p.locator('.sd-note-bar').innerText().catch(() => '')), 3000, 100)), 'tapped: it says so, in place of opening it')
  await sleep(500)
  ok(logs() === logsThen, 'and nothing opens, there or here')
  await shot(there.p, `${tag}studio-docs-open-in-elsewhere`)

  // ---------- Dark ----------
  const dark = await page(b, kit.url, { width: 1440, height: 900, mode: 'dark' })
  pages.push(dark)
  await dark.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  // Asked again until it opens: a page can take the event before the app is listening.
  await until(async () => { await dark.p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'report.docx' } })), { root }); return dark.p.locator('.sd-pb').first().waitFor({ timeout: 2000 }).then(() => true, () => false) }, 25000, 300)
  ok(await dark.p.locator('.sd-w').evaluate((e) => getComputedStyle(e).backgroundColor) === 'rgb(255, 255, 255)', 'in the dark look, the page is still paper')
  await shot(dark.p, `${tag}studio-docs-word-dark`)
  // Files in the dark look too, from the file's Files tab.
  await dark.p.locator('.sd-file .sd-tabs [role="tab"]', { hasText: 'Files' }).click()
  await dark.p.locator('.sd-groups button', { hasText: 'Presentations' }).first().click({ timeout: 15000 })
  ok(!!(await until(async () => (await dark.p.locator('.sd-files-row', { hasText: 'Pitch.pptx' }).count()) === 1, 10000)), 'dark: Files, at Presentations')
  await shot(dark.p, `${tag}studio-docs-presentations-dark`)

  // ---------- No files yet ----------
  // New's cards on the page, as the way to start, only while Studio has no files at all: a Bridge AI
  // of its own with nothing in its home, its folder or Spotlight (stood in for, saying nothing).
  empty = await startKit('studio-docs-none', { config: { trials: { studio: true } } })
  empty.program('mdfind', '')
  await empty.api('/setup', { name: 'Tester' })
  const none = await page(b, empty.url, { width: 1440, height: 900 })
  pages.push(none)
  await none.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await until(async () => { await none.p.locator('.rail-nav-btn', { hasText: 'Studio' }).click(); return none.p.locator('.sd-home').waitFor({ timeout: 1500 }).then(() => true, () => false) }, 20000, 300)
  ok(!!(await until(async () => (await none.p.locator('.sd-new-btn').count()) === 5 && /No documents, sheets, decks or PDFs yet/.test(await none.p.locator('.sd-files-none').innerText().catch(() => '')), 10000)), "no files at all: New's cards on the page as the way to start, and the list says so")
  await shot(none.p, `${tag}studio-docs-empty`)

  // ---------- A phone ----------
  const ph = await page(b, kit.url, { phone: true })
  pages.push(ph)
  await ph.p.locator('nav.tabbar button', { hasText: 'More' }).first().click({ timeout: 20000 })
  await ph.p.locator('button, .m-more-row', { hasText: 'Studio' }).first().click({ timeout: 10000 })
  await ph.p.waitForSelector('.sd-home', { timeout: 15000 })
  await until(async () => (await ph.p.locator('.sd-files-row', { hasText: 'report.docx' }).count()) > 0, 10000)
  await sleep(400)
  let f = await phoneFaults(ph.p, '.sd-home-view')
  ok(!Object.keys(f).length, 'phone: Studio\'s home fits, Files and Preview and each control a whole target', f)
  await shot(ph.p, `${tag}studio-docs-home-phone`)
  await ph.p.locator('.sd-new-open').click()
  await ph.p.locator('.sd-new-menu').waitFor({ timeout: 3000 })
  await solid(ph.p, '.sd-new-menu')
  f = await phoneFaults(ph.p, '.sd-new-menu')
  ok(!Object.keys(f).length && await ph.p.locator('.sd-new-menu [role="menuitem"]').count() === 5, "phone: New's menu from the header, each a whole target", f)
  await shot(ph.p, `${tag}studio-docs-new-phone`)
  await ph.p.keyboard.press('Escape')
  // What to show is one list to pick from on a phone.
  await ph.p.locator('.sd-group-pick select').selectOption('kind:deck')
  ok(!!(await until(async () => (await ph.p.locator('.sd-files-row', { hasText: 'Pitch.pptx' }).count()) === 1 && (await ph.p.locator('.sd-files-row', { hasText: 'report.docx' }).count()) === 0, 3000, 100)), 'phone: Presentations picked from the list')
  f = await phoneFaults(ph.p, '.sd-home-view')
  ok(!Object.keys(f).length, 'phone: and it still fits', f)
  await shot(ph.p, `${tag}studio-docs-presentations-phone`)
  await ph.p.locator('.sd-group-pick select').selectOption('recent')
  await ph.p.locator('.sd-files-row', { hasText: 'report.docx' }).locator('.sd-file-name').click()
  await until(async () => (await ph.p.locator('.sd-word.flow .sd-w').count()) > 0, 15000)
  await sleep(600)
  f = await phoneFaults(ph.p, '.sd-file')
  ok(!Object.keys(f).length && (await ph.p.locator('.sd-pb').count()) === 0 && await ph.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone: a Word file as one column, no pages, fitting the screen', f)
  ok(await ph.p.locator('.sd-status .sd-open-in-narrow').isVisible() && !(await ph.p.locator('.sd-file .pane-head .sd-open-in').isVisible()) && /Open in (Word|LibreOffice)/.test(await ph.p.locator('.sd-status .sd-open-in-narrow').getAttribute('aria-label')), "phone: Open in Word in the status line (the header has no room), a whole target")
  await shot(ph.p, `${tag}studio-docs-word-phone`)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const x of pages) await x.ctx.close().catch(() => {})
  await b.close()
  kit.stop(); model.stop(); empty?.stop()
}
process.exit(done().fail ? 1 : 0)
