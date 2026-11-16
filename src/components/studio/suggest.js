import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Mapping, ReplaceStep } from '@tiptap/pm/transform'

// Suggesting, as Google Docs has it and Word's Track Changes: while it's on, what you type is
// marked as inserted and what you delete stays, struck through, marked as deleted, each with who
// and when (a rev mark, which ooxml.js writes as Word's own w:ins and w:del). Taking out words that
// are themselves a suggested insertion takes them out for good, as Google Docs does. Formatting,
// lists and new paragraphs go in as they are. Each change is accepted or rejected on its own
// (changeAt, resolve), or all at once.
export const suggestKey = new PluginKey('sd-suggest')
// What a suggestion marks: the words and what's typed among them (a picture, a tab, a line break).
const MARKED = new Set(['text', 'image', 'tab', 'hardBreak', 'pbr'])
// When, to the minute, so a few minutes' typing is one change in Word rather than one a letter.
export const minute = (d = new Date()) => `${d.toISOString().slice(0, 16)}:00Z`

// on(): whether you're suggesting. who(): your name, as a comment of yours has it.
export function suggestPlugin({ on, who }) {
  return new Plugin({
    key: suggestKey,
    props: {
      // Backspace and Delete a letter at a time, done here rather than by the browser: over a letter
      // already struck through, the cursor just steps past it. (Joining paragraphs and words at a
      // time, ⌥⌫, are the editor's own, and tracked the same way.)
      handleKeyDown(view, e) {
        if (!on() || (e.key !== 'Backspace' && e.key !== 'Delete') || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return false
        const { state } = view
        const sel = state.selection
        if (!sel.empty) { if (!(sel instanceof TextSelection)) return false; view.dispatch(state.tr.deleteSelection().scrollIntoView()); return true }
        const $p = sel.$from
        const back = e.key === 'Backspace'
        if (!$p.parent.isTextblock || (back ? $p.parentOffset === 0 : $p.parentOffset === $p.parent.content.size)) return false
        const n = back ? $p.nodeBefore : $p.nodeAfter
        if (!n) return false
        // A letter made of two (an emoji), whole.
        const pair = n.isText && /[\uDC00-\uDFFF]/.test(back ? n.text.slice(-1) : n.text.slice(1, 2)) ? 2 : 1
        const width = n.isText ? Math.min(pair, n.text.length) : n.nodeSize
        const from = back ? $p.pos - width : $p.pos, to = from + width
        const struck = n.marks.some((m) => m.type.name === 'rev' && (m.attrs.k === 'del' || m.attrs.k === 'moveFrom'))
        if (struck) view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, back ? from : to)).scrollIntoView())
        else view.dispatch(state.tr.delete(from, to).scrollIntoView())
        return true
      },
    },
    appendTransaction(trs, before, state) {
      if (!on()) return null
      // Each replacement in what was just done, with the way from just after it to the document now.
      const steps = []
      // Not undo and redo (they put back what was), nor what isn't yours to undo (a picture brought in).
      trs.forEach((tr, j) => {
        if (!tr.docChanged || tr.getMeta(suggestKey) || tr.getMeta('history$') || tr.getMeta('addToHistory') === false) return
        tr.steps.forEach((step, i) => {
          if (!(step instanceof ReplaceStep)) return
          // (Step by step: a Mapping's slice, appended, brings its earlier steps along.)
          const rest = new Mapping()
          for (const s of tr.steps.slice(i + 1)) rest.appendMap(s.getMap())
          for (const later of trs.slice(j + 1)) for (const s of later.steps) rest.appendMap(s.getMap())
          steps.push({ doc: tr.docs[i], step, rest })
        })
      })
      if (!steps.length) return null
      const type = state.schema.marks.rev
      const mark = (k) => type.create({ k, tag: '', by: who(), at: minute() })
      const out = state.tr.setMeta(suggestKey, true).setMeta('addToHistory', true)
      const isRev = (n) => n.marks.some((m) => m.type === type)
      // What was put in: marked as inserted (typed into struck words, it's an insertion, not theirs).
      for (const { step, rest } of steps) {
        const size = step.slice.size
        if (!size) continue
        const from = rest.map(step.from, 1), to = rest.map(step.from + size, -1)
        if (to <= from) continue
        out.removeMark(from, to, type)
        state.doc.nodesBetween(from, to, (n, pos) => {
          if (MARKED.has(n.type.name)) out.addMark(Math.max(pos, from), Math.min(pos + n.nodeSize, to), mark('ins'))
          return true
        })
      }
      // What was taken out: put back where it was, struck through, from the last place back, so each
      // place before it is still where it was. A suggested insertion in it goes for good. Taking out
      // no words of the document's own (two paragraphs joined, a comment's ends, only words already
      // a change, as AI Assist's Keep does) is done as it is.
      const words = (slice) => { let yes = false; slice.content.descendants((n) => { if (MARKED.has(n.type.name) && !n.marks.some((m) => m.type === type)) yes = true; return !yes }); return yes }
      const dels = steps.filter(({ step }) => step.to > step.from).map(({ doc, step, rest }) => ({ at: rest.map(step.from, -1), slice: doc.slice(step.from, step.to) })).filter((d) => words(d.slice))
      dels.sort((a, b) => b.at - a.at)
      for (const { at, slice } of dels) {
        const n0 = out.steps.length
        out.replace(at, at, slice)
        if (out.steps.length === n0) continue
        const end = out.steps[out.steps.length - 1].getMap().map(at, 1)
        const gone = []
        out.doc.nodesBetween(at, end, (n, pos) => {
          if (!n.isInline) return true
          const from = Math.max(pos, at), to = Math.min(pos + n.nodeSize, end)
          const was = n.marks.find((m) => m.type === type)
          if (was?.attrs.k === 'ins' || was?.attrs.k === 'moveTo') gone.push([from, to])
          else if (!was && MARKED.has(n.type.name)) out.addMark(from, to, mark('del'))
          return false
        })
        for (const [from, to] of gone.reverse()) out.delete(from, to)
      }
      if (!out.docChanged) return null
      // The cursor where you'd look for it: before what Backspace struck through, after what Delete
      // did, after what's typed.
      const sel = state.selection
      if (sel.empty) {
        const one = steps.length === 1 ? steps[0].step : null
        const back = !!one && before.selection.empty && one.to > one.from && !one.slice.size && before.selection.head === one.to
        out.setSelection(TextSelection.create(out.doc, out.mapping.map(sel.head, back ? -1 : 1)))
      }
      return out
    },
  })
}

// The change at a place: the run of tracked words around it (a replacement, its deletion and its
// insertion side by side, is one change) as { from, to, by, at, ins, del }, or null.
export function changeAt(state, pos) {
  const type = state.schema.marks.rev
  const $p = state.doc.resolve(pos)
  const block = $p.parent
  if (!block.isTextblock) return null
  const start = $p.start()
  const parts = []
  block.forEach((n, off) => { parts.push({ from: start + off, to: start + off + n.nodeSize, m: n.marks.find((x) => x.type === type) || null }) })
  let i = parts.findIndex((x) => x.m && x.from <= pos && pos < x.to)
  if (i < 0) i = parts.findIndex((x) => x.m && x.to === pos)
  if (i < 0) return null
  const by = parts[i].m.attrs.by
  let a = i, b = i
  while (a > 0 && parts[a - 1].m && parts[a - 1].m.attrs.by === by) a--
  while (b < parts.length - 1 && parts[b + 1].m && parts[b + 1].m.attrs.by === by) b++
  const run = parts.slice(a, b + 1)
  const kind = (x) => (x.m.attrs.k === 'del' || x.m.attrs.k === 'moveFrom' ? 'del' : 'ins')
  return { from: run[0].from, to: run[run.length - 1].to, by, at: parts[i].m.attrs.at, ins: run.some((x) => kind(x) === 'ins'), del: run.some((x) => kind(x) === 'del') }
}

// Accepted (an insertion kept as written, a deletion's words gone) or rejected (the other way),
// between from and to, or in the whole document.
export function resolve(state, accept, from = 0, to = state.doc.content.size) {
  const type = state.schema.marks.rev
  const tr = state.tr
  const ranges = []
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isInline) return true
    const m = n.marks.find((x) => x.type === type)
    if (m) ranges.push({ from: Math.max(pos, from), to: Math.min(pos + n.nodeSize, to), ins: m.attrs.k === 'ins' || m.attrs.k === 'moveTo' })
    return false
  })
  for (const r of ranges.reverse()) { if (r.ins === accept) tr.removeMark(r.from, r.to, type); else tr.delete(r.from, r.to) }
  return tr.setMeta(suggestKey, true)
}

// Every change, in order: [{ from, to }], for going to the next or the one before.
export function changes(state) {
  const out = []
  let last = null
  state.doc.descendants((n, pos) => {
    if (!n.isTextblock) return true
    n.forEach((c, off) => {
      if (!c.marks.some((m) => m.type.name === 'rev')) { last = null; return }
      const at = pos + 1 + off
      const ch = changeAt(state, at)
      if (ch && (!last || last.from !== ch.from)) { out.push(ch); last = ch }
    })
    last = null
    return false
  })
  return out
}
