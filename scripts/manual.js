#!/usr/bin/env node
// Bridge AI's manual (shared/manual.md): made from README.md and the words in Settings, for you (Help,
// ⌘K), Chief of Staff, your agents and your bots to answer "how do I…" from (server/manual.js).
//   node scripts/manual.js           make it again, from what's here now
//   node scripts/manual.js --check   say whether it's out of date, and fail if it is: README.md or
//                                    Settings changed since it was made, or what it says names a part
//                                    of Settings that isn't there (a section, or a tab in the wrong
//                                    section). The manual test runs this, and so does a release
//                                    (scripts/release.js), so a stale manual never ships.
//   --root <dir>                     another copy's files instead of this one's (the test's)
// What's in it: README.md's parts for people who use Bridge AI (not building it from source, the demo
// or building the app to share), its links to files of the repo as their words, then every section,
// tab and setting of Settings with what each section is for and where each setting is, as ⌘K finds
// them (src/components/settings/search.js), in English.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const ROOT = path.resolve(opt('--root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
export const OUT = 'shared/manual.md'
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')

// ---------- Settings' own words ----------
// A list in a source file, as it's written there (export const NAME = [ … ]), read as the data it is:
// its strings and objects, with tx() the words themselves. Nothing else of the file runs.
function literal(file, name, scope = {}) {
  const src = read(file)
  const at = src.indexOf(`export const ${name} = [`)
  if (at < 0) throw new Error(`${file} has no ${name} list to read`)
  let i = src.indexOf('[', at)
  const start = i
  let depth = 0
  let quote = null
  for (; i < src.length; i++) {
    const c = src[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue }
    if (c === '\'' || c === '"' || c === '`') quote = c
    else if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); if (nl < 0) break; i = nl - 1 }
    else if (c === '[' || c === '{' || c === '(') depth++
    else if (c === ']' || c === '}' || c === ')') { depth--; if (!depth) break }
  }
  return vm.runInNewContext(`(${src.slice(start, i + 1)})`, { tx: (s) => s, ...scope }, { timeout: 2000 })
}
async function settingsWords() {
  const places = await import(pathToFileURL(path.join(ROOT, 'shared', 'places.js')).href)
  const at = (section, list) => list.map(([id, label, keywords = '', o = {}]) => ({ section, id, label, keywords, ...o }))
  const settings = literal('src/components/settings/search.js', 'SETTINGS', { at })
  const sections = literal('src/components/Settings.jsx', 'SECTIONS')
  const trials = literal('src/trials.js', 'TRIALS')
  return { places, settings, sections, trials }
}

// Where a setting is, as the app says it (search.js where()): its section, its tab, its name.
function whereOf(places, x, accounts) {
  const parts = [...places.placePath(x.section, { accounts }), x.label].filter((p, i, l) => i < 2 || p !== l[i - 1])
  return parts.join(' › ')
}
// Only where it can be: the desktop app, a wide window, a Mac, a beta feature on (or one out of beta).
const FEATURES = { routines: 'Scheduled Routines' }
function onlyWhen(x, trials) {
  if (x.section === 'account') return 'Once Bold Bridge accounts are on.'
  if (x.section === 'mail') return 'Where Bridge AI reads Apple Mail (a Mac).'
  if (!x.when) return ''
  if (x.when === 'desktop') return 'In the desktop app.'
  if (x.when === 'wide') return 'In a wide window (the desktop\'s top bar).'
  if (x.when === 'mac') return 'On a Mac.'
  const trial = trials.find((t) => t.id === x.when)
  if (trial) return `With the beta feature ${trial.label} on (Settings › About & Updates › Beta Features).`
  return FEATURES[x.when] ? `With ${FEATURES[x.when]} on.` : ''
}

function settingsPart({ places, settings, sections, trials }) {
  const out = ['## Settings', '',
    'Settings opens with ⌘, (Ctrl+, on Windows and Linux), or from ⌘K (Ctrl+K), where typing a setting\'s name finds it and opens Settings at it. It opens on Your Features. On a phone it\'s a list of its sections, each opening full width.',
    'Each section below says what it\'s for, then each setting in it, with where it is and the words it\'s found by. Most sections show what people change first, with the rest under Advanced at its end.', '']
  const tabsOf = (sid) => Object.entries(places.TABS).filter(([, [s]]) => s === sid).map(([id, [, label]]) => ({ id, label }))
  const line = (x) => {
    const accounts = x.section === 'account'
    const words = String(x.keywords || '').trim()
    const only = onlyWhen(x, trials)
    const at = whereOf(places, x, accounts)
    return `- [${x.label}](#setting-${x.id}): ${at}${/[.…]$/.test(at) ? '' : '.'}${only ? ` ${only}` : ''}${words ? ` Found by: ${words}.` : ''}`
  }
  for (const [sid, label] of Object.entries(places.SECTIONS)) {
    const s = sections.find((x) => x.id === sid)
    const plain = places.NO_ACCOUNTS[sid]
    out.push(`### ${label}`, '')
    if (plain) out.push(`Called ${plain} until Bold Bridge accounts are on: its Account tab is theirs.`, '')
    if (s?.hint) out.push(`${s.hint}.`, '')
    if (s?.beta) out.push('A beta feature: its switch is at the top of this section, and nothing of it shows until it\'s on.', '')
    const own = settings.filter((x) => x.section === sid)
    if (own.length) out.push(...own.map(line), '')
    for (const tab of tabsOf(sid)) {
      const list = settings.filter((x) => x.section === tab.id)
      out.push(`Its ${tab.label} tab${tab.id === 'account' ? ' (once Bold Bridge accounts are on)' : ''}:`, '', ...(list.length ? list.map(line) : ['- Nothing here that ⌘K finds by name.']), '')
    }
  }
  const beta = trials.map((t) => `- **${t.label}**: ${t.short} ${t.hint}`)
  out.push('### Beta Features', '', 'New parts of Bridge AI that ship hidden until you turn them on, in Settings › About & Updates › Beta Features (each also at the top of its own place). Turning one off hides it again; what was made with it stays.', '', ...beta, '')
  return out.join('\n')
}

// ---------- README's parts ----------
// Not for someone using Bridge AI: building it from source, the demo, building the app to share.
const LEFT_OUT = new Set(['From source', 'The demo', 'Build it to share'])
function readmePart(md) {
  const lines = md.split('\n')
  const out = []
  let skip = 0 // the level of a heading being left out, with what's under it
  let intro = true
  for (const raw of lines) {
    const h = /^(#{1,6}) (.+)$/.exec(raw)
    if (h) {
      const level = h[1].length
      if (level === 1) continue
      intro = false
      if (skip && level > skip) continue
      skip = LEFT_OUT.has(h[2].trim()) ? level : 0
      if (skip) continue
      out.push(raw)
      continue
    }
    if (skip) continue
    // Pictures, the download and star lines, notes for GitHub.
    if (/!\[[^\]]*\]\(/.test(raw) || /^\*\*\[Download\]/.test(raw) || /a star helps/i.test(raw) || /^<!--.*-->$/.test(raw.trim())) continue
    // Links into the repo (and to a heading of the README) as their words; the web's kept. One in
    // brackets that only names a folder or file of the repo ("(mobile/)") goes: it's for its readers.
    let line = raw.replace(/ ?\(\[([^\]]+)\]\((?!https?:)([^)\s]+)\)\)/g, (m, text, to) => (text.replace(/\/$/, '') === to.replace(/\/$/, '').replace(/#.*$/, '') ? '' : m))
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, to) => (/^https?:/.test(to) ? m : text))
    if (intro && !out.length) { if (!line.trim()) continue; out.push('## What Bridge AI Is', '') }
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const HEAD = [
  '# Bridge AI\'s Manual',
  '',
  '<!-- Made by scripts/manual.js from README.md and the words in Settings (src/components/Settings.jsx, src/components/settings/search.js, src/trials.js, shared/places.js). Don\'t edit it here: change those, then run node scripts/manual.js. A test fails while it\'s out of date. -->',
  '',
  'How Bridge AI works and where everything is, for you, Chief of Staff, your agents and your bots. For a question about Bridge AI itself (how to do something in it, where a setting is), look here first. Every setting is under Settings, near the end, with where it is.',
  '',
].join('\n')

export async function make() {
  const words = await settingsWords()
  return { text: `${HEAD}\n${readmePart(read('README.md'))}\n\n${settingsPart(words)}`.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', words }
}

// ---------- Out of date? ----------
// The places in Settings the manual's words name ("Settings › Agents & Models › Agents › Advanced"):
// the section has to be one of Settings' own, and a tab named after it one of that section's. Settings
// of other apps it names: Windows' own, and a GitHub repository's.
const OTHER_APPS = new Set(['Apps', 'Deploy keys'])
export function wrongPlaces(text, places) {
  const names = [...new Set([...Object.values(places.SECTIONS), ...Object.values(places.NO_ACCOUNTS)])].sort((a, b) => b.length - a.length)
  const tabs = Object.values(places.TABS)
  const idOf = (label) => Object.entries(places.SECTIONS).find(([, l]) => l === label)?.[0] || Object.entries(places.NO_ACCOUNTS).find(([, l]) => l === label)?.[0]
  const starts = (seg, name) => seg === name || (seg.startsWith(name) && /^[\s*.,;:)|]/.test(seg.slice(name.length)))
  const bad = []
  for (const m of text.matchAll(/(?<!Account )\bSettings › ([^\n]+)/g)) {
    const segs = m[1].split(' › ').map((s) => s.replace(/\*\*/g, '').trim())
    const first = segs[0]
    if ([...OTHER_APPS].some((o) => starts(first, o))) continue
    const section = names.find((n) => starts(first, n))
    if (!section) { bad.push(`"Settings › ${first.slice(0, 60)}": no section of Settings is called that`); continue }
    if (segs.length < 2 || segs[0] !== section) continue
    const sid = idOf(section)
    const own = tabs.filter(([s]) => s === sid).map(([, l]) => l)
    const elsewhere = tabs.filter(([s]) => s !== sid).map(([, l]) => l).sort((a, b) => b.length - a.length).find((l) => starts(segs[1], l))
    if (elsewhere && !own.some((l) => starts(segs[1], l))) bad.push(`"Settings › ${section} › ${elsewhere}": ${elsewhere} isn't a tab of ${section}`)
  }
  return [...new Set(bad)]
}

export async function check() {
  const { text, words } = await make()
  const problems = []
  let was = null
  try { was = read(OUT) } catch { problems.push(`${OUT} isn't there`) }
  if (was != null && was !== text) {
    const a = was.split('\n')
    const b = text.split('\n')
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    problems.push(`${OUT} is out of date with README.md and Settings, from its line ${i + 1}:\n    it says:   ${(a[i] ?? '(nothing)').slice(0, 160)}\n    it'd say:  ${(b[i] ?? '(nothing)').slice(0, 160)}`)
  }
  for (const w of wrongPlaces(text, words.places)) problems.push(`it names a part of Settings that isn't there: ${w} (README.md says it)`)
  // (Every setting ⌘K finds has a place the manual can say.)
  for (const x of words.settings) if (words.places.placePath(x.section, { accounts: true }).length < 2) problems.push(`the setting ${x.id} is in ${x.section}, which isn't a part of Settings`)
  return problems
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (args.includes('--check')) {
    const problems = await check()
    if (problems.length) {
      console.error(`Bridge AI's manual is out of date:\n${problems.map((p) => `  - ${p}`).join('\n')}\nRun node scripts/manual.js to make it again from README.md and Settings, look it over, and commit it.`)
      process.exit(1)
    }
    console.log(`${OUT} is up to date.`)
  } else {
    const { text } = await make()
    fs.writeFileSync(path.join(ROOT, OUT), text)
    console.log(`Made ${OUT}: ${text.split('\n').filter((l) => /^#{2,3} /.test(l)).length} parts, ${Math.round(text.length / 1024)} KB.`)
  }
}
