// Bridge AI's manual (shared/manual.md, made by scripts/manual.js from README.md and the words in
// Settings) in parts, and the parts that answer a question. The same for the server (what Chief of
// Staff, your agents and a bot are given: server/manual.js), the app (Help, and ⌘K's Manual:
// src/components/Manual.jsx) and the script that makes and checks it. Plain functions, no I/O.
//
// A part is a heading of the manual (## or ###) with its words up to the next heading, or, under
// Settings, one setting's line: { id, title, path (the headings above it, then its own), text,
// setting (its id, for a setting's line) }.

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'part'
// A setting's line: "- [Its name](#setting-<id>): where it is…".
const SETTING_LINE = /^- \[([^\]]+)\]\(#setting-([\w-]+)\)(.*)$/

export function partsOf(md) {
  const out = []
  const used = new Set()
  const idOf = (p) => { let id = slug(p.join(' ')); for (let n = 2; used.has(id); n++) id = `${slug(p.join(' '))}-${n}`; used.add(id); return id }
  let h2 = null
  let cur = null
  const close = () => { if (cur) { cur.text = cur.lines.join('\n').trim(); delete cur.lines; out.push(cur) } cur = null }
  for (const line of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    const h = /^(#{2,3}) (.+)$/.exec(line)
    if (h) {
      close()
      const title = h[2].trim()
      if (h[1] === '##') h2 = title
      const path = h[1] === '##' ? [title] : [h2, title].filter(Boolean)
      cur = { id: idOf(path), title, level: h[1].length, path, lines: [] }
      continue
    }
    if (!cur) continue
    const s = h2 === 'Settings' && cur.level === 3 ? SETTING_LINE.exec(line) : null
    if (s) {
      out.push({ id: `setting-${s[2]}`, title: s[1], level: 4, path: [...cur.path, s[1]], text: line.replace(/^- /, '').trim(), setting: s[2] })
      used.add(`setting-${s[2]}`)
    }
    cur.lines.push(line)
  }
  close()
  return out
}

// ---------- Which parts answer a question ----------
// By the words they share with it, as a person would look: a word in a part's own heading counts
// most, then one in the headings above it, then one in its words (or, for a topic, in the parts
// under it). The question's everyday words
// (how, do, I, the…) don't count, nor words every part has ("Bridge", "settings").
const STOP = new Set(('a an the and or but of on in at by to for from with into onto over under about as is are was were be been being am do does did done doing have has had can could would should will shall may might must i me my mine we us our you your yours it its it\'s this that these those there here what which who whom whose when where why how not no yes so if then than too very just also please thanks thank want need get got make let tell show find use using way ways set up'
  + ' bridge bridge\'s ai app setting settings').split(' '))
const stem = (w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w)
export const wordsOf = (s) => [...new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}⌘⌥]+/u).filter((w) => w.length >= 2 && !STOP.has(w)).map(stem))]

// Each part's words, worked out once for a manual (they're asked many times: ⌘K as you type).
const index = new WeakMap()
function indexOf(parts) {
  let x = index.get(parts)
  if (!x) {
    // (A topic, ## …, has the words of the parts under it too, a little: it's about all of them.)
    x = parts.map((p) => ({ own: new Set(wordsOf(p.title)), above: new Set(wordsOf(p.path.slice(0, -1).join(' '))), body: new Set(wordsOf(p.text)),
      under: new Set(p.level === 2 ? wordsOf(parts.filter((y) => y.level === 3 && y.path[0] === p.title).map((y) => `${y.title} ${y.text}`).join(' ')) : []) }))
    index.set(parts, x)
  }
  return x
}

// The parts that best answer it, best first: [{ part, score, matched }], at most n, each sharing at
// least one of its words (and, with two words or more asked, two of them or one in its own heading).
export function search(parts, question, n = 5) {
  const asked = wordsOf(question)
  if (!asked.length || !parts?.length) return []
  const idx = indexOf(parts)
  const hits = []
  parts.forEach((p, i) => {
    const w = idx[i]
    let score = 0
    const matched = []
    for (const a of asked) {
      const s = (w.own.has(a) ? 6 : 0) + (w.above.has(a) ? 2 : 0) + (w.body.has(a) ? 1 : w.under.has(a) ? 0.5 : 0)
      if (s) { score += s; matched.push(a) }
    }
    if (!matched.length) return
    if (asked.length >= 2 && matched.length < 2 && !matched.some((a) => w.own.has(a))) return
    // All of it asked, and found: a little more. A long part, a little less (it says a bit of everything).
    if (matched.length === asked.length) score += 2
    score -= Math.min(2, p.text.length / 6000)
    // (A setting's line says where it is, not how it works: a little less than the words about it.)
    if (p.setting) score -= 1
    hits.push({ part: p, score, matched })
  })
  return hits.sort((a, b) => b.score - a.score || a.part.text.length - b.part.text.length).slice(0, n)
}

// A part's words cut to about n characters, at a line's end where it can be.
export function excerpt(part, n = 1500) {
  const t = String(part?.text || '')
  if (t.length <= n) return t
  const cut = t.lastIndexOf('\n', n)
  return `${t.slice(0, cut > n / 2 ? cut : n).trimEnd()}\n…`
}
