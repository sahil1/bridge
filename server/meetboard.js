// AI Assist's live board of a meeting (a Beta Feature, Live Meeting Board, src/trials.js): a
// whiteboard of its own, an .excalidraw file in the boards folder like any other (boards.js), named
// after the meeting and linked from it, that fills in while the meeting records. meetings.js asks
// the model what's new, a batch at a time (boardLook); this puts it on the board, in four columns
// under their headings: Decisions, Timeline, Who does what and Open questions.
//   Only ever added, below what's in each column already: nothing on the board is moved, changed
// or taken away, whoever put it there. Each note it adds is a suggestion, marked as AI Assist's
// other changes on a board are (customData.bridge.suggestion: dashed, with the wand, Keep and
// Discard on the board, src/components/whiteboard/suggest.js), and says which meeting and which
// item it is (customData.bridge.meeting), so the meeting's Board can list what's on it, kept or
// still suggested, and keep or discard it from there too. One discarded, here or on the board, is
// gone from the file; meetings.js keeps it in mind so it isn't suggested again.
//   The board's own link to the meeting lives on its elements, not beside them: the page saves a
// board as Excalidraw writes it, which keeps each element's customData and nothing else of ours.
//   The words are wrapped as the board's spec drawing guesses them (src/components/whiteboard/spec.js
// wide), a little roomy, since a server can't measure a font: none is cut off once it's drawn.
import crypto from 'node:crypto'
import * as boards from './boards.js'

// The four parts, left to right: each a column with its heading, in the board's soft colours
// (src/components/whiteboard/look.js SCHEMES: a start's green, a process's white, a note's yellow, a
// decision's amber), or outlines only when the whiteboard has learnt you like no fills.
export const PARTS = {
  decision: { col: 0, title: 'Decisions', soft: ['#e3f5ea', '#1f9d55'] },
  step: { col: 1, title: 'Timeline', soft: ['#ffffff', '#334155'] },
  action: { col: 2, title: 'Who does what', soft: ['#fff6bf', '#b59a00'] },
  question: { col: 3, title: 'Open questions', soft: ['#fff4d6', '#b7791f'] },
}
const INK = '#1f2733'
const COL = 300 // from one column to the next
const NOTE_W = 256
const HEAD_Y = 64 // the headings, under the board's name
const GAP = 52 // between notes: room for a suggestion's tag above each (Suggestions.jsx), zoomed out too
const LOOKS = { clean: { roughness: 0, font: 6, size: 14, head: 18, strokeWidth: 1 }, sketch: { roughness: 1, font: 5, size: 18, head: 22, strokeWidth: 2 } }

// What a note says: a timeline's step "What · who · when" and an action "Who: what · when", as the
// board's own Timeline and Action items write them (boards.js KIND_ASK, DrawPanel.jsx).
export function labelOf(it) {
  const text = String(it.text || '').trim()
  if (it.part === 'step') return [text, it.who, it.when].filter(Boolean).join(' · ')
  if (it.part === 'action') return `${it.who ? `${it.who}: ` : ''}${text}${it.when ? ` · ${it.when}` : ''}`
  return text
}

// ---------- Elements, as Excalidraw keeps them ----------
const rnd = () => crypto.randomInt(1, 2 ** 31 - 1)
const newId = () => crypto.randomBytes(15).toString('base64url').slice(0, 20)
function element(type, o) {
  return {
    id: o.id || newId(), type, x: Math.round(o.x), y: Math.round(o.y), width: Math.round(o.width), height: Math.round(o.height), angle: 0,
    strokeColor: o.stroke || INK, backgroundColor: o.fill || 'transparent', fillStyle: 'solid', strokeWidth: o.strokeWidth ?? 1, strokeStyle: o.strokeStyle || 'solid',
    roughness: o.roughness ?? 0, opacity: 100, groupIds: [], frameId: null, roundness: o.roundness ?? null, seed: rnd(), version: 1, versionNonce: rnd(), isDeleted: false,
    boundElements: o.boundElements ?? null, updated: Date.now(), link: null, locked: false, ...(o.customData ? { customData: o.customData } : {}),
  }
}
// About how wide words are at a size, as spec.js guesses them, and a little more.
const em = (c) => (/[⺀-鿿가-힯]/.test(c) ? 1 : /[A-Z@#%&MW]/.test(c) ? 0.68 : /[iljt.,:;'|! ]/.test(c) ? 0.3 : 0.52)
const wide = (s, size) => [...String(s)].reduce((w, c) => w + em(c), 0) * size * 1.1
// Words in lines that fit max wide; a word longer than a line is broken where it has to be.
export function wrap(text, size, max) {
  const out = []
  for (const para of String(text).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (wide(next, size) <= max) { line = next; continue }
      if (line) out.push(line)
      line = ''
      let rest = word
      while (wide(rest, size) > max) {
        let n = rest.length
        while (n > 1 && wide(rest.slice(0, n), size) > max) n--
        out.push(rest.slice(0, n))
        rest = rest.slice(n)
      }
      line = rest
    }
    out.push(line)
  }
  return out
}
function words(o) {
  const lines = wrap(o.text, o.size, o.max ?? 2000)
  return {
    ...element('text', { ...o, stroke: o.ink || INK, width: Math.max(1, ...lines.map((l) => wide(l, o.size))), height: lines.length * o.size * 1.25 }),
    text: lines.join('\n'), fontSize: o.size, fontFamily: o.font, textAlign: o.align || 'left', verticalAlign: o.valign || 'top', containerId: o.containerId || null, originalText: String(o.text), autoResize: true, lineHeight: 1.25,
  }
}
// A note: a box with its words in it, top left at x, y, as tall as its words need.
function note(it, { x, y, look, fill, stroke, mark, meeting }) {
  const l = LOOKS[look] || LOOKS.clean
  const id = newId(), tid = newId()
  const lines = wrap(labelOf(it), l.size, NOTE_W - 16)
  const th = lines.length * l.size * 1.25
  const h = Math.max(60, Math.ceil(th + 26))
  const data = { meeting: { id: meeting, key: it.key, part: it.part, text: it.text, ...(it.who ? { who: it.who } : {}), ...(it.when ? { when: it.when } : {}), t: it.t ?? null } }
  const box = element('rectangle', { id, x, y, width: NOTE_W, height: h, fill, stroke, strokeWidth: l.strokeWidth, roughness: l.roughness, roundness: { type: 3 }, strokeStyle: mark ? 'dashed' : 'solid', boundElements: [{ type: 'text', id: tid }], customData: { bridge: { item: 'note', ...data, ...(mark ? { suggestion: mark } : {}) } } })
  // In the box as Excalidraw places words in one: 5 from its left, in the middle of its height.
  const text = words({ id: tid, x: x + 5, y: y + (h - th) / 2, text: labelOf(it), size: l.size, font: l.font, max: NOTE_W - 16, containerId: id, valign: 'middle', roughness: l.roughness, customData: { bridge: mark ? { suggestion: mark } : {} } })
  return [box, text]
}

// ---------- The board of a meeting ----------
const live = (data) => (data?.elements || []).filter((e) => e && !e.isDeleted)
const markOf = (e) => e.customData?.bridge?.meeting || null
// The look the board is in, from its shapes (as look.js tells it), else the one you prefer.
function lookIn(data, prefer) {
  const shapes = live(data).filter((e) => e.type !== 'text' && e.type !== 'image' && typeof e.roughness === 'number')
  if (!shapes.length) return prefer === 'sketch' ? 'sketch' : 'clean'
  return shapes.filter((e) => e.roughness > 0).length > shapes.length / 2 ? 'sketch' : 'clean'
}
// Whether the board is this meeting's: one of its elements says so.
const ofMeeting = (data, mid) => live(data).some((e) => markOf(e)?.id === mid)

// The board a meeting's notes are going on: the one it was given (hint), unless it's gone or isn't
// this meeting's any more (renamed: then it's found by its elements). null: none yet.
const found = new Map() // meeting -> { id, mtime }: its board, as it was when last seen to be its
export async function find(mid, hint = null) {
  const had = found.get(mid)
  for (const id of [had?.id, hint].filter(Boolean)) {
    const st = await boards.stat(id).catch(() => null)
    if (!st) continue
    if (had?.id === id && had.mtime === st.mtime) return id
    const b = await boards.read(id).catch(() => null)
    if (b && ofMeeting(b.data, mid)) { found.set(mid, { id, mtime: b.mtime }); return id }
  }
  if (!hint && !had) return null
  const all = (await boards.list().catch(() => ({ boards: [] }))).boards
  for (const x of all.filter((b) => b.size < 20 * 1024 * 1024)) {
    const b = await boards.read(x.id).catch(() => null)
    if (b && ofMeeting(b.data, mid)) { found.set(mid, { id: x.id, mtime: b.mtime }); return x.id }
  }
  found.delete(mid)
  return null
}

// What's on it from the meeting, each item once (a note copied on the board is the same item): its
// words as they are now (changed on the board, too), and whether it's still a suggestion. other:
// what else is written on it, by hand or from somewhere else.
export function itemsOf(data, mid) {
  const els = live(data)
  const byId = new Map(els.map((e) => [e.id, e]))
  const wordsIn = (e) => String((e.boundElements || []).map((b) => byId.get(b.id)).find((x) => x?.type === 'text')?.originalText ?? '').trim()
  const items = [], other = [], seen = new Set()
  for (const e of els) {
    if (e.type === 'text' && e.containerId && byId.has(e.containerId)) continue
    const m = markOf(e)
    if (m?.id === mid && m.key) {
      if (seen.has(m.key)) continue
      seen.add(m.key)
      items.push({ key: m.key, part: PARTS[m.part] ? m.part : 'decision', text: m.text || '', ...(m.who ? { who: m.who } : {}), ...(m.when ? { when: m.when } : {}), label: wordsIn(e) || labelOf(m), t: m.t ?? null, state: e.customData?.bridge?.suggestion ? 'suggested' : 'kept' })
    } else if (!m) {
      const w = e.type === 'text' ? String(e.originalText ?? e.text ?? '').trim() : wordsIn(e)
      if (w) other.push(w)
    }
  }
  return { items, other }
}

// The board's name: the meeting's, and its day ("Pricing review, 10 Nov").
const nameFor = (title, at) => `${String(title || 'Meeting').slice(0, 60)}, ${new Date(at || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`

// What's new from the meeting, onto its board (made first, with its name and the four headings,
// when there's none yet): each item in its part's column, below what's in that column now. by: the
// model's name, for the suggestion's tag. { id, keys }.
export async function add(m, items, { by = '', hint = null } = {}) {
  const mid = m.id
  if (!items.length) return { id: await find(mid, hint), keys: [] }
  let id = await find(mid, hint)
  const p = await boards.prefs().catch(() => null)
  const plain = p?.on && p.prefs?.colours?.value === 'none'
  if (!id) id = (await boards.create({ title: nameFor(m.title, m.startedAt) })).id
  const keys = []
  await boards.edit(id, (data) => {
    const look = lookIn(data, p?.prefs?.look?.value)
    const l = LOOKS[look]
    const els = data.elements || (data.elements = [])
    // Its name and the headings, once: one you take away afterwards stays away.
    if (!ofMeeting(data, mid)) {
      const day = new Date(m.startedAt || Date.now()).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      els.push(words({ x: 0, y: 0, text: `${String(m.title || 'Meeting').slice(0, 120)} · ${day}`, size: l.head + 8, font: l.font, roughness: l.roughness, customData: { bridge: { meeting: { id: mid, head: true } } } }))
      for (const [part, x] of Object.entries(PARTS)) els.push(words({ x: x.col * COL, y: HEAD_Y, text: x.title, size: l.head, font: l.font, roughness: l.roughness, customData: { bridge: { meeting: { id: mid, heading: part } } } }))
    }
    const at = new Date().toISOString()
    for (const it of items) {
      const part = PARTS[it.part] ? it.part : 'decision'
      // The column: under its heading, where that is now; else where it was put.
      const head = live(data).find((e) => markOf(e)?.id === mid && markOf(e).heading === part)
      const x0 = head ? head.x : PARTS[part].col * COL
      const inCol = live(data).filter((e) => { const c = e.x + (e.width || 0) / 2; return c >= x0 - 20 && c < x0 + COL - 20 && !markOf(e)?.head })
      const below = inCol.length ? Math.max(...inCol.map((e) => e.y + (e.height || 0))) : (head ? head.y + head.height : HEAD_Y + 24)
      const [fill, stroke] = plain ? ['transparent', INK] : PARTS[part].soft
      const key = it.key || crypto.randomBytes(5).toString('hex')
      const mark = { id: `mb-${key}`, by, at, kind: 'add', style: 'solid' }
      els.push(...note({ ...it, part, key }, { x: x0, y: below + GAP, look, fill, stroke, mark, meeting: mid }))
      keys.push(key)
    }
    return data
  })
  found.set(mid, { id, mtime: null }) // looked at again next time, as it is then
  return { id, keys }
}

// An item kept (its mark off, its own line back) or discarded (off the board, with its words); key
// null: every one still suggested. Nothing else on the board changes. { kept, discarded }.
export async function settle(mid, id, key, state) {
  if (!['kept', 'dismissed'].includes(state)) throw new Error('Keep it or discard it')
  let kept = 0, discarded = 0
  await boards.edit(id, (data) => {
    const pick = (e) => { const m = markOf(e); return m?.id === mid && m.key && (key ? m.key === key : !!e.customData?.bridge?.suggestion) }
    const hit = new Set(live(data).filter(pick).map((e) => e.id))
    if (!hit.size) throw Object.assign(new Error(key ? 'That isn\'t on the board any more' : 'Nothing on the board waits to be kept'), { status: 404 })
    const theirs = (e) => hit.has(e.id) || hit.has(e.containerId)
    if (state === 'dismissed') {
      discarded = hit.size
      data.elements = data.elements.filter((e) => !theirs(e))
      return data
    }
    data.elements = data.elements.map((e) => {
      const s = e.customData?.bridge?.suggestion
      if (!theirs(e) || !s) return e
      if (hit.has(e.id)) kept++
      const { suggestion, ...bridge } = e.customData.bridge
      return { ...e, customData: { ...e.customData, bridge }, ...(e.type !== 'text' ? { strokeStyle: s.style || 'solid' } : {}), version: (e.version || 1) + 1, versionNonce: rnd(), updated: Date.now() }
    })
    return data
  })
  return { kept, discarded }
}

// For the meeting's page and the floating card: the board, what's on it from the meeting and how
// much of each, read again only when its file changed.
const briefs = new Map() // meeting -> { id, mtime, brief }
export async function brief(mid, hint = null) {
  const id = await find(mid, hint)
  if (!id) return { id: null, items: [], other: 0, counts: counts([]) }
  const st = await boards.stat(id).catch(() => null)
  const had = briefs.get(mid)
  if (had && st && had.id === id && had.mtime === st.mtime) return had.brief
  const b = await boards.read(id).catch(() => null)
  if (!b) return { id: null, items: [], other: 0, counts: counts([]) }
  const { items, other } = itemsOf(b.data, mid)
  const out = { id, items, other: other.length, counts: counts(items) }
  briefs.set(mid, { id, mtime: b.mtime, brief: out })
  return out
}
const counts = (items) => Object.fromEntries(Object.keys(PARTS).map((p) => [p, items.filter((x) => x.part === p).length]))

