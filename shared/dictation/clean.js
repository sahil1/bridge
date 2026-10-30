// What you said, tidied before it lands (Settings › Voice › Dictation): no model, a few
// milliseconds, the same in the desktop app, a browser and on the phone (whose words are turned into
// text on the computer, and tidied by the page it serves).
//   Light cleanup (on unless turned off): "um" and "uh" go, a word said twice is kept once, the
//     first letter is a capital and the end has a full stop. The fillers and doubled words are
//     English rules, so only for what reads as English ("um" is a word in German).
//   sentence: false for a search box or a terminal, where a capital and a full stop get in the way.
//   Names: words Bridge AI knows (agents, models, projects, branches, meeting memory) spelled the way
//     they're written: "work tree" is worktree, "payments api" is payments-api, "claude code" is
//     Claude Code. A plain word is only ever joined up or given its hyphens, never just capitalised
//     ("notes" stays notes, even with a project called Notes). Meeting memory's "heard as" pairs are
//     replaced as they are in transcripts.
//   atFiles: "at payments dot ts" is @payments.ts, a file to mention (the message box then looks it
//     up in the agent's folder).

const EXT = 'ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|kts|swift|m|c|h|cc|cpp|hpp|cs|php|css|scss|sass|less|html|htm|vue|svelte|astro|json|jsonc|yaml|yml|toml|md|mdx|txt|csv|sh|bash|zsh|ps1|sql|xml|ini|env|lock|gradle|dart|lua|ex|exs|erl|hs|scala|clj|r|ipynb|tf|proto|graphql|gql'
const SEG = '[\\p{L}\\p{N}_-]+'
const SEP = '(?:\\s+(?:dot|point)\\s+|\\s+slash\\s+|\\.|/)'
const FILE = new RegExp(`(^|[\\s(])(?:at|@)\\s*((?:${SEG}${SEP})*?${SEG})(?:\\s+(?:dot|point)\\s+|\\.)(${EXT})(?![\\p{L}\\p{N}])`, 'giu')
export function spokenFiles(text) {
  return text.replace(FILE, (all, pre, name, ext) => `${pre}@${name.replace(/\s+(?:dot|point)\s+/gi, '.').replace(/\s+slash\s+/gi, '/').replace(/\s+/g, '')}.${ext.toLowerCase()}`)
}

// English or not, from its commonest little words.
const EN = new Set('the a an and or but to of in on at for with is are was were be it this that i you we they he she my your our me not do does did can will would should have has had what how why when where please just so if then there here'.split(' '))
const OTHER = new Set('der die das und ist nicht ich ein eine zu mit den dem des le la les et est une un pas je vous nous que qui dans el los las y es una lo por para con pero il di che non per una sono het een en van ik je niet dat wij os um uma não com para por eu você'.split(' '))
export function looksEnglish(text) {
  let en = 0, other = 0
  for (const w of text.toLowerCase().match(/[\p{L}']+/gu) || []) { if (EN.has(w)) en++; if (OTHER.has(w)) other++ }
  return en > 0 && en >= other
}

const FILLER = /(^|[\s,;])(?:u+m+|u+h+|uhm+|e+rm+|hmm+|mhm)(?=$|[\s,.;!?])[,]?/giu
const ONLY_FILLERS = /^(?:[\s,.!?]*(?:u+m+|u+h+|uhm+|e+rm+|hmm+|mhm))+[\s,.!?]*$/iu
const KEEP_TWICE = new Set(['that', 'had', 'is', 'do', 'bye', 'no', 'yes', 'very', 'really', 'so', 'ha', 'go'])
function light(text, english) {
  let s = text
  if (english) {
    s = s.replace(FILLER, '$1')
    // ", you know," as a filler, not "do you know".
    s = s.replace(/,\s*you know\s*,/gi, ',').replace(/^you know,\s*/i, '')
    // A word said twice in a row ("the the"), kept once.
    s = s.replace(/(?<![\p{L}\p{N}])([\p{L}']+)(\s+\1)+(?![\p{L}\p{N}])/giu, (m, w) => (KEEP_TWICE.has(w.toLowerCase()) ? m : w))
    s = s.replace(/(?<![\p{L}\p{N}])i(?=$|[\s,.;!?']|'m|'ve|'ll|'d)/gu, 'I')
  }
  // What the fillers left: doubled spaces, a space before a comma, a comma at the start.
  return s.replace(/\s+([,.;!?])/g, '$1').replace(/,{2,}/g, ',').replace(/^[\s,;.!?]+/, '').replace(/[\s,;]+$/, '').replace(/\s{2,}/g, ' ')
}
function sentence(s) {
  if (!s) return s
  // A capital to start, and after a full stop, a question or an exclamation; not on a mention, a
  // command or a path.
  s = s.replace(/^([\s"'(]*)(\p{Ll})/u, (m, pre, c) => pre + c.toUpperCase()).replace(/([.!?]\s+)(\p{Ll})/gu, (m, pre, c) => pre + c.toUpperCase())
  const last = s.split(/\s+/).pop() || ''
  // A full stop at the end of words in a Latin, Greek or Cyrillic script, not after a file, a path
  // or a link (it would become part of it).
  if (/[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{N}"')]$/u.test(s) && !/^@|[/\\]|:\/\/|\.\w+$/.test(last)) s += '.'
  return s
}

// Words Bridge AI knows, by their letters and digits alone ("payments-api" and "Payments API" are
// both paymentsapi).
const squash = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '')
// Worth fixing as one word: it has more than letters (payments-api, gpt-5, feature/retry) or capitals
// inside (GitHub, OpenCode).
const shaped = (t) => /[^\p{L}\s]/u.test(t) || /\p{Ll}\p{Lu}/u.test(t) || /^\p{Lu}{2,}\p{Ll}/u.test(t)
export function makeNames(terms = []) {
  const map = new Map()
  for (const t of terms) {
    const term = String(t || '').trim()
    const k = squash(term)
    if (k.length < 4 || k.length > 40 || /\s{2}/.test(term)) continue
    // The first one given wins: yours (meeting memory) first, then the rest.
    if (!map.has(k)) map.set(k, term)
  }
  return map
}
// A name in capitals (Claude Code, Chief of Staff), not a phrase that happens to start with one.
const proper = (t) => t.split(' ').every((w) => /^[\p{Lu}\p{N}]/u.test(w) || /^(of|the|and|for|to|a|an|in|on|de|du|la|le|von|van)$/.test(w))
function names(text, map) {
  if (!map?.size) return text
  const words = text.split(' ').map((tok) => { const m = /^([^\p{L}\p{N}@/]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(tok); return { pre: m[1], core: m[2], post: m[3] } })
  const out = []
  for (let w = 0; w < words.length;) {
    let took = 0
    for (let n = Math.min(4, words.length - w); n >= 1 && !took; n--) {
      const run = words.slice(w, w + n)
      // Words of one phrase: no punctuation between them, and no mention, path or link.
      if (run.some((x, j) => !x.core || (j < n - 1 && x.post) || (j > 0 && x.pre) || /^@|[/\\]|:\/\//.test(x.core))) continue
      const said = run.map((x) => x.core).join(' ')
      const term = map.get(squash(said))
      if (!term) continue
      const asIs = said === term
      // Only its case differs: a shaped word (github -> GitHub), or a name in capitals.
      const caseOnly = !asIs && said.toLowerCase() === term.toLowerCase()
      if (!asIs && (n === 1 || caseOnly) && !shaped(term) && !(caseOnly && n > 1 && proper(term))) continue
      out.push(`${run[0].pre}${asIs ? said : term}${run[n - 1].post}`)
      took = n
    }
    if (!took) { const x = words[w]; out.push(x.pre + x.core + x.post); took = 1 }
    w += took
  }
  return out.join(' ')
}
// Meeting memory's mishearings: each "heard" version, whole words, any case, spaces or hyphens
// between its words, as the term.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function heardFix(text, heard) {
  if (!heard?.length) return text
  const map = new Map(heard.filter(([h, t]) => h && t).map(([h, t]) => [String(h).toLowerCase().replace(/[\s-]+/g, ' '), t]))
  if (!map.size) return text
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...map.keys()].sort((a, b) => b.length - a.length).map((h) => h.split(' ').map(esc).join('[\\s-]+')).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
  return text.replace(re, (m) => map.get(m.toLowerCase().replace(/[\s-]+/g, ' ')) ?? m)
}

// opts: { cleanup = true, sentence = true, atFiles = true, names: Map from makeNames, heard: [[heard, term]] }
export function clean(text, opts = {}) {
  let s = String(text || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (opts.atFiles !== false) s = spokenFiles(s)
  if (opts.cleanup !== false) s = light(s, looksEnglish(s) || ONLY_FILLERS.test(s))
  s = heardFix(s, opts.heard)
  s = names(s, opts.names)
  if (opts.cleanup !== false && opts.sentence !== false) s = sentence(s)
  return s
}
