// Where to sign a PDF, as the PDF says: its form's own signature, initials and date fields first,
// then the words around a line ("Signature: ______", "Date" under a drawn line, "Sign here"). Each
// place is a box in the page's own points ({ x, y, w, h } from its bottom left), proposed for you
// to move, resize and approve. Plain data in, plain data out (pageData reads it from pdf.js), so
// the tests can check it as it is.
import { SIZES } from '../../../../shared/signmarks.js'

// The words that mark a place, in the languages Bridge AI speaks and a few more; "by" (By: ____)
// and the dates only next to a line, where they can't be part of a sentence.
const L = '(?<![\\p{L}\\p{N}])'
const R = '(?![\\p{L}])'
const WORDS = [
  ['initials', new RegExp(`${L}(initials?(?: here)?|paraphe|iniciales|rubrica|kürzel|paraph)${R}|(イニシャル|简签|小签)`, 'giu')],
  ['signature', new RegExp(`${L}(sign(?:ed|ature)?(?: here)?|signatory|unterschrift|firma|assinatura|signé)${R}|(署名|签名|签字|हस्ताक्षर)`, 'giu')],
  ['date', new RegExp(`${L}(date(?: signed)?|dated|datum|fecha|data)${R}|(日付|日期|दिनांक|तारीख)`, 'giu')],
  ['by', new RegExp(`${L}by${R}(?=\\s*[:：])`, 'giu')],
]
const kindOfName = (s) => (/initial|paraph|kürzel|rubrica/i.test(s) ? 'initials' : /date|datum|fecha|日付|日期/i.test(s) ? 'date' : /sign|unterschrift|firma|assinatura|署名|签/i.test(s) ? 'signature' : null)

// Helvetica's widths (thousandths of its size) for the printable ASCII letters: where in a run of
// text a word starts, as a share of the run's measured width (most fonts' shares are close).
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const charW = (c) => { const k = c.charCodeAt(0); return k >= 32 && k <= 126 ? HELV[k - 32] : k > 0x2e80 ? 1000 : 556 }

// The page's text as lines, each its string and where each letter starts (xs), on its baseline.
function linesOf(items) {
  const runs = items.filter((it) => it.str && it.w > 0 && it.h > 0).sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  for (const it of runs) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(l.h, it.h) * 0.45)
    if (line) line.runs.push(it)
    else lines.push({ y: it.y, h: it.h, runs: [it] })
  }
  return lines.map((l) => {
    l.runs.sort((a, b) => a.x - b.x)
    let str = ''
    const xs = []
    for (const r of l.runs) {
      // A gap between runs reads as a space.
      if (str && xs.length && r.x - (xs.at(-1).x + xs.at(-1).w) > r.h * 0.15 && !/\s$/.test(str)) { str += ' '; xs.push({ x: xs.at(-1).x + xs.at(-1).w, w: r.x - (xs.at(-1).x + xs.at(-1).w) }) }
      const ws = [...r.str].map(charW)
      const total = ws.reduce((a, b) => a + b, 0) || 1
      let at = r.x
      for (let i = 0; i < ws.length; i++) { const w = (ws[i] / total) * r.w; xs.push({ x: at, w }); at += w }
      str += r.str
    }
    return { y: l.y, h: Math.max(...l.runs.map((r) => r.h)), str, xs: [...xs], x0: l.runs[0].x, x1: Math.max(...l.runs.map((r) => r.x + r.w)) }
  })
}
// Index in a line's string to x (letters can be more than one code unit: the xs follow [...str]).
const unitsToChars = (str) => { const map = []; let c = 0; for (const ch of str) { for (let k = 0; k < ch.length; k++) map.push(c); c++ } map.push(c); return map }

// Lines to write on: runs of underscores (or dots) in the text, and lines drawn on the page.
function blanksOf(lines, shapes) {
  const out = []
  for (const l of lines) {
    const map = unitsToChars(l.str)
    for (const m of l.str.matchAll(/_{4,}|\.{8,}|…{3,}/g)) {
      const a = l.xs[map[m.index]], b = l.xs[map[m.index + m[0].length] - 1]
      if (a && b) out.push({ x0: a.x, x1: b.x + b.w, y: l.y - l.h * 0.12, text: true, line: l })
    }
  }
  for (const s of shapes) if (s[3] - s[1] <= 2.5 && s[2] - s[0] >= 40) out.push({ x0: s[0], x1: s[2], y: (s[1] + s[3]) / 2, text: false })
  return out
}

const area = (a) => Math.max(0, a.w) * Math.max(0, a.h)
const overlap = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? (w * h) / Math.min(area(a), area(b)) : 0
}

// A box standing on a line from x0 to x1 at height y, for this kind: as wide as the line (a date
// or initials no wider than they need), as high as the kind needs.
function onLine(kind, x0, x1, y) {
  const max = { signature: 260, initials: 90, date: 160 }[kind]
  return { x: x0, y: y + 0.5, w: Math.max(Math.min(x1 - x0, max), Math.min(SIZES[kind].w, 60)), h: SIZES[kind].h }
}

// One page's places: { kind, page, x, y, w, h, align, source, label, field?, fieldType? }.
// page: { n, view: [x0, y0, x1, y1], items: [{ str, x, y, w, h }], shapes: [[x0, y0, x1, y1]],
// fields: [{ name, type, rect, label, value, readOnly, hidden }] }
export function placesOnPage(page) {
  const found = []
  // The form's own fields.
  for (const f of page.fields || []) {
    if (f.hidden || f.readOnly || (f.value && String(f.value).trim())) continue
    const named = kindOfName(`${f.label || ''} ${f.name || ''}`)
    const kind = f.type === 'Sig' ? (named === 'initials' ? 'initials' : 'signature') : f.type === 'Tx' ? named : null
    if (!kind) continue
    const [x0, y0, x1, y1] = f.rect
    found.push({ kind, page: page.n, x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), align: 'center', source: 'field', label: f.label || f.name || '', field: f.name || null, fieldType: f.type })
  }
  // The words, next to or under a line.
  const lines = linesOf(page.items || [])
  const blanks = blanksOf(lines, page.shapes || [])
  const used = new Set()
  for (const l of lines) {
    const map = unitsToChars(l.str)
    const hits = WORDS.flatMap(([kind, re]) => [...l.str.matchAll(re)].map((m) => ({ kind, at: map[m.index], end: map[m.index + m[0].length], word: m[0] }))).sort((a, b) => a.at - b.at)
    // "Signature" in "Date of signature" is one place: the first word wins where two overlap.
    const words = hits.filter((h, i) => !hits.slice(0, i).some((g) => h.at < g.end))
    words.forEach((w, i) => {
      const kind = w.kind === 'by' ? 'signature' : w.kind
      // What's written between the word before (or the line's start) and this one, blanks aside:
      // "Tenant signature" is a place; "Start date" isn't a date to sign on, and a sentence isn't.
      const lead = [...l.str].slice(i ? words[i - 1].end : 0, w.at).join('').replace(/[_.…:：\s\-–/|]+/g, ' ').trim()
      if (lead.length > (w.kind === 'date' ? 0 : w.kind === 'signature' ? 40 : 24)) return
      // What it's known by in the list: its own words ("Tenant signature:"), not the whole line.
      const label = `${lead} ${w.word}`.trim().slice(0, 60)
      const x0 = l.xs[w.at]?.x ?? l.x0
      const xEnd = (l.xs[w.end - 1] ? l.xs[w.end - 1].x + l.xs[w.end - 1].w : l.x1)
      const nextAt = words[i + 1] ? l.xs[words[i + 1].at]?.x ?? Infinity : Infinity
      const near = Math.max(6, l.h * 0.6)
      // On the same line, after the word and before the next one.
      let blank = blanks.find((b) => !used.has(b) && b.x0 >= xEnd - 2 && b.x0 < nextAt && b.x0 - xEnd < 250 && Math.abs(b.y - l.y) <= near)
      // Else the line it's written under (a caption: the line, then "Signature" below it).
      if (!blank) blank = blanks.find((b) => !used.has(b) && b.y - l.y >= 2 && b.y - l.y <= Math.max(30, l.h * 2.6) && b.x0 <= xEnd + 10 && b.x1 >= x0 - 10 && !(b.text && b.line === l))
      if (blank) {
        used.add(blank)
        const box = onLine(kind, blank.x0, blank.x1, blank.y)
        found.push({ kind, page: page.n, ...box, align: 'left', source: 'text', label })
        return
      }
      // A word with nothing after it on a line of its own ("Signature:", "Sign here"), not a
      // sentence that mentions signing: a box right after it.
      const rest = [...l.str].slice(w.end).join('').replace(/^[\s:：.\-–]+/, '')
      if (w.kind === 'by' || w.kind === 'date' || rest.length > 3 || lead.length > 24) return
      const right = page.view ? page.view[2] - 24 : xEnd + 200
      const wBox = Math.min(SIZES[kind].w, right - (xEnd + 6))
      if (wBox < 40) return
      found.push({ kind, page: page.n, x: xEnd + 6, y: l.y - l.h * 0.25, w: wBox, h: SIZES[kind].h, align: 'left', source: 'text', label })
    })
  }
  // A place found twice (a field, and the words beside it) is one: the field's.
  const out = []
  for (const p of found) if (!out.some((q) => overlap(p, q) > 0.3)) out.push(p)
  return out
}

// Every page's, in reading order, each with an id.
export function findPlaces(pages) {
  return pages.flatMap((pg) => placesOnPage(pg).sort((a, b) => (b.y + b.h) - (a.y + a.h) || a.x - b.x)).map((p, i) => ({ ...p, id: `found-${i + 1}` }))
}
