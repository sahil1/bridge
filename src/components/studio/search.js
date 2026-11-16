import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Find and replace in a document: every match marked, the one you're on more strongly, within a
// paragraph (a match doesn't run from one paragraph into the next, as in Word).
export const findKey = new PluginKey('sd-find')

// What's looked for, as a pattern: the words as typed, or a regular expression; whole words only
// (not inside a longer word), as Word's Whole words only. Null for a pattern that isn't one.
export function patternOf(q, { matchCase = false, whole = false, regex = false } = {}) {
  if (!q) return null
  const body = regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try { return new RegExp(whole ? `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])` : body, `gu${matchCase ? '' : 'i'}`) } catch { return null }
}

// Each match of q in the document, as positions: [{ from, to }]. Things that aren't text (a
// picture, a tab) count as one character no word matches.
export function matches(doc, q, o = {}) {
  const out = []
  const re = patternOf(q, o)
  if (!re) return out
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    const at = []
    node.forEach((child, offset) => {
      if (child.isText) { for (let i = 0; i < child.text.length; i++) at.push(pos + 1 + offset + i); text += child.text }
      else { at.push(pos + 1 + offset); text += '\uFFFC' }
    })
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (!m[0].length) { re.lastIndex++; continue }
      out.push({ from: at[m.index], to: at[m.index + m[0].length - 1] + 1 })
    }
    return false
  })
  return out
}

export function findPlugin() {
  const build = (doc, s) => {
    if (!s.q) return DecorationSet.empty
    return DecorationSet.create(doc, s.list.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.index ? 'sd-find on' : 'sd-find' })))
  }
  return new Plugin({
    key: findKey,
    state: {
      init: () => ({ q: '', matchCase: false, whole: false, regex: false, list: [], index: -1, set: DecorationSet.empty }),
      apply(tr, old) {
        const meta = tr.getMeta(findKey)
        if (!meta && !tr.docChanged) return old
        const s = { ...old, ...(meta || {}) }
        if (tr.docChanged || meta?.q !== undefined || meta?.matchCase !== undefined || meta?.whole !== undefined || meta?.regex !== undefined) s.list = matches(tr.doc, s.q, s)
        if (meta?.index === undefined) {
          // Still on the match nearest where it was.
          const was = old.list[old.index]
          const at = was ? tr.mapping.map(was.from) : tr.selection.from
          s.index = s.list.length ? Math.max(0, s.list.findIndex((m) => m.from >= at)) : -1
          if (s.list.length && s.list.findIndex((m) => m.from >= at) < 0) s.index = 0
        }
        s.set = build(tr.doc, s)
        return s
      },
    },
    props: { decorations: (st) => findKey.getState(st).set },
  })
}

// Commands for the find bar.
export const find = {
  state: (editor) => findKey.getState(editor.state),
  set(editor, o) { editor.view.dispatch(editor.state.tr.setMeta(findKey, o).setMeta('addToHistory', false)) },
  // To the next match (or the one before): picked and scrolled into view.
  step(editor, dir = 1) {
    const s = findKey.getState(editor.state)
    if (!s?.list.length) return
    const index = (s.index + dir + s.list.length) % s.list.length
    const m = s.list[index]
    editor.view.dispatch(editor.state.tr.setMeta(findKey, { index }).setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).scrollIntoView())
  },
  replace(editor, text) {
    const s = findKey.getState(editor.state)
    const m = s?.list[s.index]
    if (!m) return
    const tr = editor.state.tr.insertText(text, m.from, m.to)
    editor.view.dispatch(tr)
    find.step(editor, 0)
  },
  // Every match at once, one step to undo.
  all(editor, text) {
    const s = findKey.getState(editor.state)
    if (!s?.list.length) return 0
    const tr = editor.state.tr
    for (const m of [...s.list].reverse()) tr.insertText(text, m.from, m.to)
    editor.view.dispatch(tr)
    return s.list.length
  },
}
