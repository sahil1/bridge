// Learning what the user likes from what they change after a model draws (server/boards.js keeps
// it, in preferences.json on this computer). After each drawing the panel takes a snapshot of what
// the model made; a few seconds after the user's last edit, it's compared with the board, and what
// the edits show goes to the server as evidence:
//   direction: the arrows now mostly run across (left to right) or down (top to bottom)
//   colours: fills changed to greys (muted), strong colours (vivid), or taken out (none)
//   labels: words renamed into Title Case or sentence case, or cut much shorter; and what a thing
//     is called ("Database" renamed "Postgres")
//   spacing: shapes pulled apart or pushed together
//   look and arrows: lines made sketchy or clean, arrows made straight, curved or right-angled
// Library picks (an AWS icon added, say) are told as they happen (Whiteboard.jsx).
import { api } from '../../api.js'
import { holderOf, nodeAround, box } from './holders.js'

const SHAPES = new Set(['rectangle', 'ellipse', 'diamond', 'image'])
const textOf = (e, byId) => String(((e.boundElements || []).map((b) => byId.get(b.id)).find((x) => x?.type === 'text' && !x.isDeleted)?.originalText) ?? (e.type === 'text' ? e.originalText : '') ?? '').trim()

// What a model just drew: its elements as they were. ids: theirs. direction: how it was laid out.
export function snapshot(elements, ids, { direction = null, board } = {}) {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const items = new Map()
  for (const id of ids) {
    const e = byId.get(id)
    if (!e || e.isDeleted || e.containerId) continue
    items.set(id, { type: e.type, x: e.x, y: e.y, w: e.width, h: e.height, fill: e.backgroundColor, rough: e.roughness, elbowed: !!e.elbowed, round: !!e.roundness, text: textOf(e, byId), node: !!holderOf(e) && holderOf(e) === 'node' })
  }
  return { at: Date.now(), board, direction, items, told: new Set() }
}

const hsl = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
  return { s, l }
}
const caseOf = (s) => {
  const words = s.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && w.length > 3)
  if (words.length < 2) return null
  const caps = words.filter((w) => /^[A-Z]/.test(w)).length
  return caps === words.length ? 'title' : caps <= 1 && /^[A-Z]/.test(s) ? 'sentence' : null
}

// What the edits since the snapshot show: [{ key, value, from?, to? }], each once per snapshot.
export function observe(snap, elements) {
  if (!snap?.items.size) return []
  const byId = new Map(elements.map((e) => [e.id, e]))
  const now = new Map()
  for (const [id] of snap.items) { const e = byId.get(id); if (e && !e.isDeleted) now.set(id, e) }
  const out = []
  const tell = (key, value, more = {}) => { const k = `${key}:${value}:${more.from || ''}`; if (!snap.told.has(k)) { snap.told.add(k); out.push({ key, value, ...more }) } }

  // Direction: the model's arrows between its shapes, which way they mostly run now.
  const arrows = [...now.values()].filter((e) => e.type === 'arrow' && e.startBinding && e.endBinding)
  if (arrows.length >= 2 && snap.direction) {
    let across = 0, down = 0
    for (const a of arrows) {
      const s = byId.get(a.startBinding.elementId), t = byId.get(a.endBinding.elementId)
      if (!s || !t) continue
      const dx = (t.x + t.width / 2) - (s.x + s.width / 2), dy = (t.y + t.height / 2) - (s.y + s.height / 2)
      if (Math.abs(dx) > Math.abs(dy) * 1.5) across++
      else if (Math.abs(dy) > Math.abs(dx) * 1.5) down++
    }
    const dir = across > down * 2 && across >= 2 ? 'LR' : down > across * 2 && down >= 2 ? 'TB' : null
    if (dir && dir !== snap.direction) tell('direction', dir, { from: snap.direction })
  }

  // Colours: the fills the user changed.
  const recoloured = [...now].filter(([id, e]) => SHAPES.has(e.type) && !holderOf(e) && e.backgroundColor !== snap.items.get(id).fill)
  if (recoloured.length) {
    const kinds = recoloured.map(([, e]) => { if (e.backgroundColor === 'transparent') return 'none'; const c = hsl(e.backgroundColor); return !c ? null : c.s < 0.15 ? 'muted' : c.s > 0.5 && c.l < 0.85 ? 'vivid' : 'soft' }).filter(Boolean)
    const top = Object.entries(kinds.reduce((m, k) => ({ ...m, [k]: (m[k] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0]
    if (top && top[1] >= Math.max(1, recoloured.length / 2)) tell('colours', top[0])
  }

  // Labels: renamed in a case, cut short, or called something else.
  for (const [id, e] of now) {
    const was = snap.items.get(id).text
    const is = textOf(e, byId)
    if (!was || !is || was === is) continue
    if (was.toLowerCase() === is.toLowerCase()) { const c = caseOf(is); if (c) tell('labels', c) } else if (is.length < was.length * 0.6 && was.length > 12) tell('labels', 'short')
    else if (is.split(/\s+/).length <= 4) tell('naming', 'pair', { from: was, to: is })
  }

  // Spacing: when several of the model's shapes moved, the gaps between them now and then.
  const shapes = [...now].filter(([, e]) => SHAPES.has(e.type) && !nodeAround(e, elements) && !(holderOf(e) && holderOf(e) !== 'node'))
  const moved = shapes.filter(([id, e]) => Math.hypot(e.x - snap.items.get(id).x, e.y - snap.items.get(id).y) > 20)
  if (moved.length >= 3 && shapes.length >= 3) {
    const gaps = (list) => { const bs = list.map(box); return bs.map((a, i) => Math.min(...bs.filter((_, j) => j !== i).map((b) => Math.hypot(Math.max(0, b.x1 - a.x2, a.x1 - b.x2), Math.max(0, b.y1 - a.y2, a.y1 - b.y2))))).reduce((s, x) => s + x, 0) / bs.length }
    const before = gaps(shapes.map(([id]) => { const s = snap.items.get(id); return { x: s.x, y: s.y, width: s.w, height: s.h } }))
    const after = gaps(shapes.map(([, e]) => e))
    if (before > 0 && after / before > 1.35) tell('spacing', 'roomy')
    else if (before > 0 && after / before < 0.7) tell('spacing', 'tight')
  }

  // Look and arrows.
  const lines = [...now].filter(([, e]) => typeof e.roughness === 'number' && e.type !== 'text' && e.type !== 'image')
  const roughNow = lines.filter(([, e]) => e.roughness > 0).length, roughWas = lines.filter(([id]) => snap.items.get(id).rough > 0).length
  if (lines.length >= 3 && roughNow > lines.length * 0.6 && roughWas < lines.length * 0.4) tell('look', 'sketch')
  if (lines.length >= 3 && roughNow < lines.length * 0.4 && roughWas > lines.length * 0.6) tell('look', 'clean')
  const changedArrows = arrows.filter((a) => { const s = snap.items.get(a.id); return s.elbowed !== !!a.elbowed || s.round !== !!a.roundness })
  if (changedArrows.length && changedArrows.length >= arrows.length / 2) {
    const a = changedArrows[0]
    tell('arrows', a.elbowed ? 'elbow' : a.roundness ? 'curved' : 'straight')
  }
  return out
}

// Sent to be kept (the server ignores them when learning is off).
export function tellServer(list, board) {
  return Promise.all(list.map((x) => api('/boards/preferences/learn', { method: 'POST', body: { ...x, board } }).catch(() => null)))
}
