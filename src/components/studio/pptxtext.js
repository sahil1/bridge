// Changes to a PowerPoint shape's words, on its text model (pptxdoc.js's textModel: paragraphs of
// runs, each piece its own XML): words typed, put in or taken out, a paragraph split or joined,
// a run's look or a paragraph's set over a stretch of them, words found and replaced. A place in
// the words is { p, o }: the paragraph, and how many characters into it (a line break is one).
// Plain functions, no page, so the tests use them as they are.
import { withRun, withPara } from './pptxdoc.js'

export const paraText = (p) => p.runs.map((r) => (r.br ? '\n' : r.text)).join('')
const lenOf = (r) => (r.br ? 1 : r.text.length)
const before = (a, b) => a.p < b.p || (a.p === b.p && a.o <= b.o)
export const order = (a, b) => (before(a, b) ? [a, b] : [b, a])
// The look a paragraph's end has, as a run's (for words typed into an empty one).
export const endRun = (end) => (end ? end.replace(/^<a:endParaRPr\b/, '<a:rPr').replace(/<\/a:endParaRPr>$/, '</a:rPr>') : '')
const runEnd = (rPr) => (rPr ? rPr.replace(/^<a:rPr\b/, '<a:endParaRPr').replace(/<\/a:rPr>$/, '</a:endParaRPr>') : '')
const copy = (t) => ({ ...t, paras: t.paras.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r })) })) })
// Runs side by side in the same look made one, as PowerPoint keeps them.
function tidy(t) {
  for (const p of t.paras) p.runs = p.runs.reduce((out, r) => { const last = out[out.length - 1]; if (last && !last.br && !r.br && !last.fld && !r.fld && last.rPr === r.rPr) last.text += r.text; else if (r.br || r.fld || r.text) out.push({ ...r }); return out }, [])
  return t
}

// A paragraph's runs split so one starts at character o: the index of that run.
function splitAt(p, o) {
  let at = 0
  for (let i = 0; i < p.runs.length; i++) {
    const r = p.runs[i], n = lenOf(r)
    if (o <= at) return i
    if (o < at + n && !r.br && !r.fld) {
      p.runs.splice(i, 1, { ...r, text: r.text.slice(0, o - at) }, { ...r, text: r.text.slice(o - at) })
      return i + 1
    }
    at += n
  }
  return p.runs.length
}
// Words taken out from a to b (a paragraph's end joins it to the next).
export function deleteRange(t0, a0, b0) {
  const [a, b] = order(a0, b0)
  const t = copy(t0)
  if (a.p === b.p && a.o === b.o) return { t, caret: a }
  const pa = t.paras[a.p], pb = t.paras[b.p]
  const ia = splitAt(pa, a.o)
  const ib = splitAt(pb, b.o)
  const tail = pb.runs.slice(ib)
  pa.runs = [...pa.runs.slice(0, ia), ...tail]
  if (b.p !== a.p) { pa.end = pb.end || pa.end; t.paras.splice(a.p + 1, b.p - a.p) }
  pa.runs = pa.runs.filter((r) => r.br || r.fld || r.text)
  return { t: tidy(t), caret: a }
}
// Words put in at a (over what's from a to b), in the look of what's before them; a new line
// starts a new paragraph.
export function insertText(t0, a0, b0, text) {
  let { t, caret } = deleteRange(t0, a0, b0 || a0)
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  lines.forEach((line, i) => {
    if (i) ({ t, caret } = splitPara(t, caret, caret))
    if (!line) return
    const p = t.paras[caret.p]
    const at = splitAt(p, caret.o)
    const prev = p.runs[at - 1] && !p.runs[at - 1].br ? p.runs[at - 1] : p.runs[at] && !p.runs[at].br ? p.runs[at] : null
    const rPr = prev?.fld ? prev.rPr : prev ? prev.rPr : endRun(p.end)
    if (prev && !prev.fld && at > 0 && p.runs[at - 1] === prev) prev.text += line
    else p.runs.splice(at, 0, { rPr, text: line })
    caret = { p: caret.p, o: caret.o + line.length }
  })
  return { t: tidy(t), caret }
}
// Enter: the paragraph split at a (what's from a to b taken out first), the new one in its look.
export function splitPara(t0, a0, b0) {
  const { t, caret } = deleteRange(t0, a0, b0 || a0)
  const p = t.paras[caret.p]
  const at = splitAt(p, caret.o)
  const rest = p.runs.slice(at)
  const lastRun = p.runs[at - 1] || p.runs[at]
  p.runs = p.runs.slice(0, at)
  const next = { pPr: p.pPr, runs: rest, end: p.end || runEnd(lastRun?.rPr) }
  if (!p.runs.length && !p.end && lastRun) p.end = runEnd(lastRun.rPr)
  t.paras.splice(caret.p + 1, 0, next)
  return { t, caret: { p: caret.p + 1, o: 0 } }
}
// ⇧Enter: a line break in the paragraph.
export function lineBreak(t0, a0, b0) {
  const { t, caret } = deleteRange(t0, a0, b0 || a0)
  const p = t.paras[caret.p]
  const at = splitAt(p, caret.o)
  const near = p.runs[at - 1] || p.runs[at]
  p.runs.splice(at, 0, { rPr: near?.rPr || endRun(p.end), text: '', br: true })
  return { t, caret: { p: caret.p, o: caret.o + 1 } }
}
// Backspace at the start of a paragraph: joined to the one before.
export function joinBack(t0, i) {
  if (i <= 0) return { t: t0, caret: { p: 0, o: 0 } }
  const t = copy(t0)
  const prev = t.paras[i - 1], me = t.paras[i]
  const o = paraText(prev).length
  prev.runs = [...prev.runs, ...me.runs]
  prev.end = me.end || prev.end
  t.paras.splice(i, 1)
  return { t, caret: { p: i - 1, o } }
}
// A run's look set over a to b: set is withRun's ({ b, i, u, strike, sz, color, font }). An empty
// stretch sets the word the caret's in, as PowerPoint does; with none, the paragraph's end too, so
// what's typed next has it.
export function formatRange(t0, a0, b0, set) {
  let [a, b] = order(a0, b0)
  const t = copy(t0)
  if (a.p === b.p && a.o === b.o) {
    const text = paraText(t.paras[a.p])
    let s = a.o, e = a.o
    while (s > 0 && /[\p{L}\p{N}_'’-]/u.test(text[s - 1])) s--
    while (e < text.length && /[\p{L}\p{N}_'’-]/u.test(text[e])) e++
    if (s === e) { const p = t.paras[a.p]; p.end = runEnd(withRun(endRun(p.end) || p.runs.at(-1)?.rPr, set)); return t }
    a = { p: a.p, o: s }; b = { p: a.p, o: e }
  }
  for (let i = a.p; i <= b.p; i++) {
    const p = t.paras[i]
    const s = i === a.p ? a.o : 0, e = i === b.p ? b.o : paraText(p).length
    // Split at the start, then the end (which is after it, so the start's index holds).
    const k = splitAt(p, s), j = splitAt(p, e)
    for (let r = k; r < j; r++) if (!p.runs[r].br) p.runs[r] = { ...p.runs[r], rPr: withRun(p.runs[r].rPr, set) }
    if (i < b.p || e === paraText(p).length) p.end = runEnd(withRun(endRun(p.end) || p.runs.at(-1)?.rPr, set))
  }
  return tidy(t)
}
// Every run's look set (a shape picked, not typed in).
export const formatAll = (t, set) => formatRange(t, { p: 0, o: 0 }, { p: t.paras.length - 1, o: paraText(t.paras.at(-1) || { runs: [] }).length || 0 }, set)
// The paragraphs from a to b changed by fn(pPr, paragraph) (withPara's set, or a function).
export function formatParas(t0, a0, b0, set) {
  const [a, b] = order(a0, b0)
  const t = copy(t0)
  for (let i = a.p; i <= b.p; i++) t.paras[i] = { ...t.paras[i], pPr: typeof set === 'function' ? set(t.paras[i].pPr, t.paras[i]) : withPara(t.paras[i].pPr, set) }
  return t
}
// A run's own formatting taken off (⌘\): back to its paragraph's.
export function clearFormat(t0, a0, b0) {
  return formatRange(t0, a0, b0, { b: null, i: null, u: null, strike: null, sz: null, color: null, font: null, highlight: null, baseline: null })
}

// ---------- Find and replace ----------
const flags = (o) => (o?.matchCase ? 'g' : 'gi')
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Where q is in the words: [{ p, start, end }].
export function findIn(t, q, opts = {}) {
  if (!q || !t) return []
  const out = []
  t.paras.forEach((p, i) => { const re = new RegExp(escRe(q), flags(opts)); let m; const s = paraText(p); while ((m = re.exec(s))) { out.push({ p: i, start: m.index, end: m.index + m[0].length }); if (!m[0].length) re.lastIndex++ } })
  return out
}
// One found stretch replaced, in the look of its first character.
export function replaceAt(t, m, text) {
  const { t: t1 } = deleteRange(t, { p: m.p, o: m.start }, { p: m.p, o: m.end })
  const p = t1.paras[m.p]
  const at = splitAt(p, m.start)
  const near = t.paras[m.p].runs.find((r, i, all) => { const s = all.slice(0, i).reduce((n, x) => n + lenOf(x), 0); return !r.br && s <= m.start && m.start < s + lenOf(r) })
  if (text) p.runs.splice(at, 0, { rPr: near?.rPr || p.runs[at - 1]?.rPr || endRun(p.end), text })
  return t1
}
export function replaceAll(t, q, text, opts = {}) {
  const found = findIn(t, q, opts)
  let out = t
  for (const m of [...found].reverse()) out = replaceAt(out, m, text)
  return { t: out, n: found.length }
}
