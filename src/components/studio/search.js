import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Find and replace in a document: every match marked, the one you're on more strongly, within a
// paragraph (a match doesn't run from one paragraph into the next, as in Word).
export const findKey = new PluginKey('sd-find')

// Each match of q in the document, as positions: [{ from, to }]. Things that aren't text (a
// picture, a tab) count as one character no word matches.
export function matches(doc, q, { matchCase = false } = {}) {
  const out = []
  if (!q) return out
  const needle = matchCase ? q : q.toLocaleLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    const at = []
    node.forEach((child, offset) => {
      if (child.isText) { for (let i = 0; i < child.text.length; i++) at.push(pos + 1 + offset + i); text += child.text }
      else { at.push(pos + 1 + offset); text += '\uFFFC' }
    })
    const hay = matchCase ? text : text.toLocaleLowerCase()
    let i = hay.indexOf(needle)
    while (i >= 0 && needle) {
      out.push({ from: at[i], to: at[i + needle.length - 1] + 1 })
      i = hay.indexOf(needle, i + needle.length)
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
      init: () => ({ q: '', matchCase: false, list: [], index: -1, set: DecorationSet.empty }),
      apply(tr, old) {
        const meta = tr.getMeta(findKey)
        if (!meta && !tr.docChanged) return old
        const s = { ...old, ...(meta || {}) }
        if (tr.docChanged || meta?.q !== undefined || meta?.matchCase !== undefined) s.list = matches(tr.doc, s.q, s)
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
