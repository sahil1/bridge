#!/usr/bin/env node
// The words to translate, and how each language's pack stands. Every t('…') and tx('…') in src is a
// string to translate, keyed by its English (src/i18n/index.js). The app is written in English; a
// pack catches up whenever it's updated (CONTRIBUTING.md › Translations).
//   node scripts/i18n.js check              each pack: how much is translated, strings no longer used,
//                                           and a translation that drops or adds a {placeholder} (an error)
//   node scripts/i18n.js todo <lang> [file] what <lang> doesn't have yet, with where each shows, as JSON
//                                           ([{ en, where }]), to the file or the screen
//   node scripts/i18n.js add <lang> <file>  puts translations ({ english: translation }) into <lang>'s
//                                           pack, starting a new pack if there's none; checks each first
//   node scripts/i18n.js prune [lang]       drops strings the app no longer uses from the packs
//   node scripts/i18n.js keys               every string, as JSON
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const I18N = path.join(SRC, 'i18n')
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(jsx?|mjs)$/.test(e.name) ? [path.join(d, e.name)] : []))
const CALL = /(?<![\w.$])tx?\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`)/g
const literal = (s) => (s[0] === '`' ? s.slice(1, -1).replace(/\\(.)/g, '$1') : JSON.parse(s[0] === "'" ? `"${s.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"').replace(/\\\\"/g, '\\"')}"` : s))

// Each string and the files it shows in (src/components/Rail.jsx is "components/Rail.jsx").
export function strings() {
  const where = new Map()
  for (const f of walk(SRC)) {
    if (f.startsWith(I18N)) continue
    for (const m of fs.readFileSync(f, 'utf8').matchAll(CALL)) {
      let k
      try { k = literal(m[1]) } catch { continue } // not a plain string
      if (!where.has(k)) where.set(k, new Set())
      where.get(k).add(path.relative(SRC, f).replace(/\\/g, '/'))
    }
  }
  return where
}
export const keys = () => [...strings().keys()].sort()
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
const packs = () => fs.readdirSync(I18N).filter((x) => x.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
const packFile = (lang) => path.join(I18N, `${lang}.json`)
const readPack = (lang) => JSON.parse(fs.readFileSync(packFile(lang), 'utf8'))
// Sorted, so a pack's changes read as a plain diff.
const writePack = (lang, words) => fs.writeFileSync(packFile(lang), `${JSON.stringify(Object.fromEntries(Object.keys(words).sort().map((k) => [k, words[k]])), null, 2)}\n`)
// A language's code as browsers give it: es, pt-BR, zh-CN.
const okLang = (lang) => { try { return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang) && !!new Intl.Locale(lang) && lang !== 'en' } catch { return false } }

export function check() {
  const all = keys()
  const report = []
  let bad = 0
  for (const lang of packs()) {
    let words
    try { words = readPack(lang) } catch (e) { report.push(`${lang}: not valid JSON (${e.message})`); bad++; continue }
    const wrong = Object.entries(words).filter(([k, v]) => typeof v !== 'string' || (all.includes(k) && holes(k) !== holes(v)))
    const stale = Object.keys(words).filter((k) => !all.includes(k))
    const done = all.filter((k) => typeof words[k] === 'string' && words[k].trim())
    bad += wrong.length
    report.push(`${lang}: ${done.length} of ${all.length} translated${stale.length ? `, ${stale.length} no longer used` : ''}${wrong.length ? `, ${wrong.length} with the wrong {placeholders}: ${wrong.slice(0, 5).map(([k]) => JSON.stringify(k)).join(', ')}` : ''}`)
  }
  return { report, bad, total: all.length }
}

export function todo(lang) {
  const have = fs.existsSync(packFile(lang)) ? readPack(lang) : {}
  return [...strings()].filter(([en]) => !(typeof have[en] === 'string' && have[en].trim()))
    .map(([en, files]) => ({ en, where: [...files].sort().join(', ') }))
    .sort((a, b) => a.where.localeCompare(b.where) || a.en.localeCompare(b.en))
}

// Each translation checked before it goes in: one of the app's strings, the same {placeholders}.
export function add(lang, given) {
  const all = new Set(keys())
  const words = fs.existsSync(packFile(lang)) ? readPack(lang) : {}
  const problems = []
  let added = 0
  for (const [en, v] of Object.entries(given)) {
    if (!all.has(en)) problems.push(`not one of the app's strings: ${JSON.stringify(en)}`)
    else if (typeof v !== 'string' || !v.trim()) problems.push(`no translation for ${JSON.stringify(en)}`)
    else if (holes(en) !== holes(v)) problems.push(`{placeholders} differ (it needs ${holes(en) ? holes(en).split(',').map((h) => `{${h}}`).join(' ') : 'none'}, each as often): ${JSON.stringify(en)} -> ${JSON.stringify(v)}`)
    else { words[en] = v; added++ }
  }
  // A new pack only once it has words: an empty one would list the language with nothing in it.
  if (added || fs.existsSync(packFile(lang))) writePack(lang, words)
  return { added, problems }
}

export function prune(lang) {
  const all = new Set(keys())
  let gone = 0
  for (const l of lang ? [lang] : packs()) {
    const words = readPack(l)
    for (const k of Object.keys(words)) if (!all.has(k)) { delete words[k]; gone++ }
    writePack(l, words)
  }
  return gone
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd = 'check', lang, file] = process.argv.slice(2)
  const needLang = () => { if (!okLang(lang || '')) { console.error(`Which language? A code like es, pt-BR or zh-CN (not en, the app's own words).`); process.exit(2) } }
  if (cmd === 'keys') { process.stdout.write(`${JSON.stringify(keys(), null, 2)}\n`); process.exit(0) }
  if (cmd === 'todo') {
    needLang()
    const list = todo(lang)
    const out = `${JSON.stringify(list, null, 1)}\n`
    if (file) { fs.writeFileSync(file, out); console.log(`${list.length} strings for ${lang} to translate, in ${file}`) } else process.stdout.write(out)
    process.exit(0)
  }
  if (cmd === 'add') {
    needLang()
    if (!file) { console.error('Which file? JSON of { "English": "translation" }, like todo gives with each translated.'); process.exit(2) }
    let given = JSON.parse(fs.readFileSync(file, 'utf8'))
    // todo's own shape, with a translation added to each: [{ en, where, to }] (one without is said)
    if (Array.isArray(given)) given = Object.fromEntries(given.filter((x) => x && x.en != null).map((x) => [x.en, x.to ?? '']))
    const { added, problems } = add(lang, given)
    console.log(added ? `${lang}: ${added} added to src/i18n/${lang}.json` : `${lang}: nothing added`)
    for (const p of problems) console.log(`  left out: ${p}`)
    process.exit(problems.length ? 1 : 0)
  }
  if (cmd === 'prune') { console.log(`${prune(lang)} strings no longer used, taken out`); process.exit(0) }
  if (cmd !== 'check') { console.error(`Unknown: ${cmd}. node scripts/i18n.js check | todo <lang> [file] | add <lang> <file> | prune [lang] | keys`); process.exit(2) }
  const { report, bad, total } = check()
  console.log(`${total} strings to translate`)
  for (const r of report) console.log(r)
  process.exit(bad ? 1 : 0)
}
