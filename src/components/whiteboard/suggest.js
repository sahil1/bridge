// What a model draws or changes on a board is a suggestion until it's kept. Each of its shapes,
// arrows and words carries a mark, customData.bridge.suggestion, so the mark travels in the
// .excalidraw file and is there when the board opens again (here, or another of your computers).
// While they're suggested, shapes and arrows are drawn dashed, and the board draws a dashed outline
// around each suggestion with the wand, Keep and Discard (Suggestions.jsx); Keep all and Discard
// all do every one. Keep takes the mark off (their own lines back). Discard takes what was added
// off the board, and puts back what was changed or taken away as it was.
//   A mark: { id, by, at, kind, style, was }. kind: 'add' (new), 'change' (was: the element as it
//   was, and its words when they were replaced: was.label), 'remove' (shown faded until it's kept:
//   Keep takes it off the board, Discard leaves it). style: its own line style, put back on Keep.

const LINED = (e) => e.type !== 'text' && e.type !== 'image' && e.type !== 'freedraw'
export const markOf = (e) => (e && !e.isDeleted ? e.customData?.bridge?.suggestion || null : null)
const withMark = (e, m) => ({ ...(e.customData || {}), bridge: { ...(e.customData?.bridge || {}), suggestion: m } })
const without = (e) => {
  const { suggestion, ...bridge } = e.customData?.bridge || {}
  return { ...(e.customData || {}), bridge }
}
// What's kept of an element to put it back: all but what Excalidraw keeps by itself.
const OWN = new Set(['id', 'version', 'versionNonce', 'updated', 'seed', 'isDeleted'])
const plain = (e) => Object.fromEntries(Object.entries(e).filter(([k]) => !OWN.has(k)))
const shown = (e) => (e.customData?.bridge?.suggestion ? { ...e, customData: without(e) } : e)
// Changed in what it shows: not only an arrow joined to it, or a mark of its own.
const looks = (e) => JSON.stringify(Object.entries(plain(shown(e))).filter(([k]) => k !== 'boundElements' && k !== 'strokeStyle'))
const changed = (prev, e) => prev.version !== e.version && looks(prev) !== looks(e)

// The board as it was before a model's change: each live element by its id.
export const before = (elements) => new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]))

// One element of a model's: marked as part of suggestion s ({ id, by }) on top of what it was
// (an element suggested before, changed again, keeps what it first was and how it first came).
export function markOne(X, e, s, base = null) {
  const had = e.customData?.bridge?.suggestion
  const prev = base?.get(e.id)
  const kind = had?.kind === 'add' || !prev ? 'add' : 'change'
  const m = { id: s.id, by: s.by, at: had?.at || new Date().toISOString(), kind, style: had?.style ?? e.strokeStyle, ...(kind === 'change' ? { was: had?.was || plain(shown(prev)) } : {}) }
  return X.newElementWith(e, { customData: withMark(e, m), ...(LINED(e) ? { strokeStyle: 'dashed' } : {}) })
}

// A board's elements after a model's change, each one it added, changed or took away marked as
// suggestion s. base: before(), from before the change. Words it replaced on a shape go with the
// shape's mark (was.label), to put back; what it took away stays, faded, until kept.
export function mark(X, base, elements, s) {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const label = new Map() // a shape -> the words it had, when the model gave it new ones
  for (const e of elements) {
    const prev = base.get(e.id)
    if (e.isDeleted && prev && e.type === 'text' && e.containerId && byId.get(e.containerId) && !byId.get(e.containerId).isDeleted) label.set(e.containerId, { id: prev.id, ...plain(shown(prev)) })
  }
  return elements.map((e) => {
    const prev = base.get(e.id)
    if (e.isDeleted) {
      if (!prev || label.has(e.containerId)) return e
      const had = prev.customData?.bridge?.suggestion
      if (had?.kind === 'add') return e // a suggestion taken away again: gone
      const m = { id: s.id, by: s.by, at: new Date().toISOString(), kind: 'remove', style: had?.style ?? prev.strokeStyle, was: { opacity: had?.was?.opacity ?? prev.opacity } }
      return X.newElementWith(prev, { isDeleted: false, opacity: 25, customData: withMark(prev, m), ...(LINED(prev) ? { strokeStyle: 'dashed' } : {}) })
    }
    if (prev && !changed(prev, e) && !label.has(e.id)) return e
    const out = markOne(X, e, s, base)
    if (!label.has(e.id) || out.customData.bridge.suggestion.kind !== 'change') return out
    const m = out.customData.bridge.suggestion
    return m.was.label ? out : X.newElementWith(out, { customData: withMark(out, { ...m, was: { ...m.was, label: label.get(e.id) } }) })
  })
}

// The suggestions on a board, oldest first: { id, by, at, ids, elements }.
export function suggestions(elements) {
  const out = new Map()
  for (const e of elements) {
    const m = markOf(e)
    if (!m?.id) continue
    if (!out.has(m.id)) out.set(m.id, { id: m.id, by: m.by || '', at: m.at || '', ids: [], elements: [] })
    out.get(m.id).ids.push(e.id)
    out.get(m.id).elements.push(e)
  }
  return [...out.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)))
}

// Kept: the marks off suggestion id's elements (every suggestion's, with no id), their own lines
// back; what it took away, off the board.
export function keep(X, elements, id = null) {
  const gone = new Set()
  const out = elements.map((e) => {
    const m = markOf(e)
    if (!m || (id && m.id !== id)) return e
    if (m.kind === 'remove') { gone.add(e.id); return X.newElementWith(e, { isDeleted: true, customData: without(e) }) }
    return X.newElementWith(e, { customData: without(e), ...(LINED(e) && m.style ? { strokeStyle: m.style } : {}) })
  })
  // The words in a shape taken away go with it.
  return gone.size ? out.map((e) => (!e.isDeleted && e.containerId && gone.has(e.containerId) ? X.newElementWith(e, { isDeleted: true, customData: without(e) }) : e)) : out
}

// Discarded: what suggestion id added taken off the board, what it changed put back as it was (its
// old words too), and what it took away left as it was. With no id, every suggestion.
export function discard(X, elements, id = null) {
  const back = [] // words put back on a shape
  const out = elements.map((e) => {
    const m = markOf(e)
    if (!m || (id && m.id !== id)) return e
    if (m.kind === 'add') return X.newElementWith(e, { isDeleted: true, customData: without(e) })
    if (m.kind === 'remove') return X.newElementWith(e, { customData: without(e), opacity: m.was?.opacity ?? 100, ...(LINED(e) && m.style ? { strokeStyle: m.style } : {}) })
    const { label, ...was } = m.was || {}
    if (label) back.push(label)
    return X.newElementWith(e, { ...was, customData: was.customData || without(e) })
  })
  if (!back.length) return out
  const byId = new Map(out.map((e, i) => [e.id, i]))
  for (const l of back) {
    const i = byId.get(l.id)
    if (i != null) out[i] = X.newElementWith(out[i], { ...l, isDeleted: false })
    else { const [made] = X.restoreElements([{ ...l, isDeleted: false }], null); if (made) out.push(made) }
  }
  return out
}

// Where a suggestion is on the board: its elements' bounds, in the board's own coordinates.
export function boundsOf(X, s) {
  const live = s.elements.filter((e) => !e.isDeleted)
  if (!live.length) return null
  const [x1, y1, x2, y2] = X.getCommonBounds(live)
  return { x1, y1, x2, y2 }
}
