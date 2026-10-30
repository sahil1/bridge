// Bridge AI in your language. Text is written in English in the code and wrapped in t(); each
// language's pack here (es.json, ja.json…) maps that English to its own words, and anything a pack
// doesn't have yet shows in English, so the app is written in English and packs catch up later
// (CONTRIBUTING.md › Translations). {name} in a string is filled from the values given:
//   t('Continue on {name}', { name: 'Work' })
// English kept in a list (Settings' sections, say) is marked with tx(), which changes nothing, so
// scripts/i18n.js finds it too; it's translated with t() where it's shown, as the pack is only
// loaded once the app starts. The language is per browser, like the look (Settings › Appearance):
// English unless you pick another, or Match this computer.

// Every pack in this folder is a language: add ko.json and Korean is in the list, named in its own
// words. Each is loaded only when it's picked.
const files = import.meta.glob('./*.json')
function nameOf(id) {
  try {
    const loc = new Intl.Locale(id)
    // Chinese by its script (简体中文, 繁體中文) rather than its country.
    const tag = loc.language === 'zh' ? `zh-${loc.maximize().script}` : id
    const name = new Intl.DisplayNames([id], { type: 'language' }).of(tag)
    return name.charAt(0).toLocaleUpperCase(id) + name.slice(1)
  } catch { return id }
}
export const LANGS = [
  { id: 'en', name: 'English' },
  ...Object.keys(files).map((f) => f.slice(2, -5)).sort().map((id) => ({ id, name: nameOf(id) })),
]
export const KEY = 'cc-lang'
let words = null
let lang = 'en'

// What you picked: a language's id, or 'auto' (Match this computer). English until you pick.
export function chosen() {
  try { return JSON.parse(localStorage.getItem(KEY)) || 'en' } catch { return 'en' }
}
// The language that shows: yours, or the computer's first one Bridge AI has (Portuguese from
// Portugal gets Brazil's, Chinese gets Simplified), else English.
export function resolveLang(c = chosen()) {
  if (c !== 'auto') return LANGS.some((l) => l.id === c) ? c : 'en'
  const prefs = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []
  for (const p of prefs) {
    const x = String(p || '')
    const hit = LANGS.find((l) => l.id.toLowerCase() === x.toLowerCase()) || LANGS.find((l) => l.id.split('-')[0] === x.split('-')[0].toLowerCase())
    if (hit) return hit.id
  }
  return 'en'
}
// Before the app draws: the language's words, and the page's lang (screen readers, fonts).
let watching = false
export async function loadLang() {
  lang = resolveLang()
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  // Picked in another window (the floating card, another tab): this one starts again in it too.
  if (!watching && typeof window !== 'undefined') {
    watching = true
    window.addEventListener('storage', (e) => { if (e.key === KEY && resolveLang() !== lang) location.reload() })
  }
  words = null
  if (lang === 'en') return
  try { words = (await files[`./${lang}.json`]?.())?.default || null } catch { words = null }
}
export const currentLang = () => lang
// For dates and numbers: the language picked, or (English) the computer's own format, as before.
export const locale = () => (lang === 'en' ? undefined : lang)
// A new language: kept, and the app starts again in it.
export function setLang(c) {
  try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* no storage */ }
  location.reload()
}

// A value that's missing (a field the server left out) is left out, not shown as {name}.
const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m)) : s)
export function t(s, vars) {
  return fill((words && words[s]) || s, vars)
}
export const tx = (s) => s
// A word put in the middle of a sentence ("average cost"): lower case, but German keeps its nouns' capitals.
export const midSentence = (s) => (lang === 'de' ? String(s) : String(s).toLowerCase())
