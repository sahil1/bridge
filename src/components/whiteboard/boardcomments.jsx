import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../i18n/index.js'
import { api } from '../../api.js'
import { threadsOf, AI_AUTHOR } from '../studio/wordcomments.js'
import { mentions, requestOf, askOf } from '../studio/doccomments.jsx'
import { describe, applyOps } from './convert.js'
import { reroute } from './layout.js'
import { fontsReady } from './look.js'
import { before, mark, markOf, keep as keepIt, discard as discardIt } from './suggest.js'

// Comments on a whiteboard, as threads (Comments and @bridge, a beta feature): on the shapes
// picked, or on a place on the board when nothing is. Each thread is a pin on the board, a small
// round mark at the corner of what it's on, and lives in the .excalidraw file itself: the pin's
// customData.bridge.thread holds it ({ id, on: the shapes' ids, at: { x, y } the place, items: [{
// id, author, date, text, parent, done }] }), so it goes where the board goes. Pins are put on and
// changed outside the undo history (⌘Z is for the drawing), and a pin picked on the board opens
// its thread. The pane is doccomments.jsx's, with a board's words.
//
// @bridge in a comment you write asks AI Assist (POST /api/boards/comment) to change those shapes
// (or the part of the board the pin is on) as Change it does: what it draws or changes goes on
// the board marked as a suggestion (suggest.js), dashed, with Keep and Discard on the board and in
// the thread; its reply, signed AI Assist with the wand and the model, says what it did. With no
// model, the thread says how to add one; one that came in the file waits for you to send it.

const PIN = 26
export const pinOf = (e) => (e && !e.isDeleted ? e.customData?.bridge?.thread || null : null)
const initialsOf = (name) => (name === AI_AUTHOR ? 'AI' : String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?')
const short = (s, n = 60) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x }
const uid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`)

// board: { X, api }; look: the board's look (for what @bridge adds); author: your name.
export function useBoardThreads({ board, on, author, look = 'clean', onOpen }) {
  const { X, api: ex } = board
  const [pins, setPins] = useState([]) // [{ el, thread }]
  const [picked, setPicked] = useState(null)
  const [draft, setDraft] = useState(null) // { on, at, text }
  const [said, setSaid] = useState(null)
  const [jobs, setJobs] = useState({})
  const jobsRef = useRef(jobs)
  const setJob = (id, v) => { const n = { ...jobsRef.current }; if (v) n[id] = v; else delete n[id]; jobsRef.current = n; setJobs(n) }
  const made = useRef(new Set()) // the comments written here this time (yours, sent at once)
  const [, tick] = useState(0)

  // The pins on the board, read again each time it changes; one picked on the board opens its thread.
  useEffect(() => {
    if (!ex) return undefined
    // Only what the threads show: their pins, and the suggestions on the board (a change to
    // anything else, or the board's own state, draws nothing again).
    let sig = ''
    let marks = ''
    let chose = null
    const look = (els, st) => {
      const list = els.filter((e) => pinOf(e)).map((e) => ({ el: e, thread: pinOf(e) }))
      const s = list.map((p) => `${p.el.id}:${p.el.version}`).join('|')
      if (s !== sig) { sig = s; setPins(list) }
      const m = [...new Set(els.map((e) => markOf(e)?.id).filter(Boolean))].join('|')
      if (m !== marks) { marks = m; tick((n) => n + 1) }
      const chosen = Object.entries(st?.selectedElementIds || {}).filter(([, v]) => v).map(([k]) => k)
      const pin = chosen.length === 1 ? list.find((x) => x.el.id === chosen[0]) : null
      if (on && pin && pin.el.id !== chose) { setPicked(pin.thread.items.find((c) => !c.parent)?.id || pin.thread.id); onOpen?.() }
      chose = pin?.el.id || null
    }
    look(ex.getSceneElements(), ex.getAppState())
    return ex.onChange(look)
  }, [ex, on]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => pins.flatMap((p) => p.thread.items.map((x) => ({ ...x, initials: initialsOf(x.author), author: x.author || t('Someone'), made: made.current.has(x.id), pin: p.el.id, done: !!p.thread.done }))), [pins])
  const threads = useMemo(() => threadsOf(items).map((th) => ({ ...th, done: !!th.root.done })), [items])
  // A thread's pin, as the board has it now (a pin just put on is there before the board says so).
  // A thread is known by its first comment (as the pane has it), or by its own id.
  const isOf = (th, rootId) => !!th && (th.id === rootId || th.items.some((c) => c.id === rootId && !c.parent))
  const pinFor = (rootId) => { const el = ex?.getSceneElements().find((e) => isOf(pinOf(e), rootId)); return el ? { el, thread: pinOf(el) } : null }
  const shapesOf = (ids) => ex.getSceneElements().filter((e) => ids.includes(e.id) && !pinOf(e))
  const wordsOf = (rootId) => {
    const p = pinFor(rootId)
    if (!p) return null
    if (!p.thread.on?.length) return t('The board, here')
    const els = shapesOf(p.thread.on)
    if (!els.length) return null
    const s = describe(ex.getSceneElements(), new Set(p.thread.on))
    const words = [...s.shapes, ...s.texts, ...s.arrows].map((x) => x.text).filter(Boolean)
    return els.length === 1 ? (words[0] ? short(words[0]) : t('A shape')) : t('{n} shapes: {words}', { n: els.length, words: short(words.join(', ')) })
  }

  // A thread's pin changed (outside the undo history), or put on, or taken off.
  const setThread = (rootId, fn) => {
    const p = pinFor(rootId)
    if (!p) return
    const next = fn(p.thread)
    const els = ex.getSceneElementsIncludingDeleted().map((e) => (e.id !== p.el.id ? e : next ? X.newElementWith(e, { customData: { ...e.customData, bridge: { ...e.customData.bridge, thread: next } } }) : X.newElementWith(e, { isDeleted: true })))
    ex.updateScene({ elements: els, captureUpdate: X.CaptureUpdateAction.NEVER })
  }
  const start = () => {
    if (!on || !ex) return false
    const chosen = Object.entries(ex.getAppState().selectedElementIds || {}).filter(([, v]) => v).map(([k]) => k)
    const els = ex.getSceneElements().filter((e) => chosen.includes(e.id) && !pinOf(e))
    // What a container holds goes with it; the words in a shape are the shape's.
    const ids = [...new Set(els.map((e) => e.containerId || e.id))]
    let at
    if (ids.length) {
      const [, y1, x2] = X.getCommonBounds(shapesOf(ids))
      at = { x: x2 - PIN / 2, y: y1 - PIN / 2 }
    } else {
      const { width, height, scrollX, scrollY, zoom } = ex.getAppState()
      at = { x: -scrollX + width / 2 / zoom.value - PIN / 2, y: -scrollY + height / 2 / zoom.value - PIN / 2 }
    }
    setSaid(null)
    const s = ids.length ? describe(ex.getSceneElements(), new Set(ids)) : null
    const words = s ? [...s.shapes, ...s.texts].map((x) => x.text).filter(Boolean) : []
    setDraft({ on: ids, at, text: ids.length ? (ids.length === 1 ? short(words[0]) || t('A shape') : t('{n} shapes: {words}', { n: ids.length, words: short(words.join(', ')) })) : t('The board, here') })
    return true
  }
  const cancel = () => setDraft(null)
  const item = (o) => ({ id: uid(), author, date: new Date().toISOString(), parent: null, text: '', ...o })
  const post = (text) => {
    const body = String(text || '').trim()
    if (!draft || !body) return null
    const c = item({ text: body })
    made.current.add(c.id)
    const thread = { id: c.id, on: draft.on, at: draft.at, done: false, items: [c] }
    const [pin] = X.convertToExcalidrawElements([{ type: 'ellipse', x: draft.at.x, y: draft.at.y, width: PIN, height: PIN, strokeColor: '#7048e8', backgroundColor: '#e5dbff', fillStyle: 'solid', strokeWidth: 2, roughness: 0, customData: { bridge: { thread } } }])
    ex.updateScene({ elements: [...ex.getSceneElementsIncludingDeleted(), pin], captureUpdate: X.CaptureUpdateAction.NEVER })
    setDraft(null)
    setPicked(c.id)
    return { ...c, made: true }
  }
  const reply = (rootId, text, as = author, more = {}) => {
    const body = String(text || '').trim()
    if (!body || !pinFor(rootId)) return null
    const c = item({ text: body, parent: rootId, author: as, ...more })
    if (as !== AI_AUTHOR) made.current.add(c.id)
    setThread(rootId, (th) => ({ ...th, items: [...th.items, c] }))
    return { ...c, made: as !== AI_AUTHOR }
  }
  const postAndAsk = (text) => { const c = post(text); if (c && mentions(text)) ask(c.id, c); return c }
  const replyAndAsk = (rootId, text) => { const c = reply(rootId, text); if (c && mentions(text)) ask(rootId, c); return c }

  // ---------- AI Assist ----------
  const ask = async (rootId, c) => {
    const p = pinFor(rootId)
    const request = requestOf(c.text)
    jobsRef.current[rootId]?.ctl?.abort()
    if (!p) return
    if (!request) { setJob(rootId, { error: t('Say what you\'d like after @bridge: "@bridge add a cache after this", or a change to these shapes.'), code: 'no-request' }); return }
    const ids = (p.thread.on || []).filter((id) => shapesOf([id]).length)
    if (p.thread.on?.length && !ids.length) { setJob(rootId, { error: t('The shapes this comment was on aren\'t on the board any more, so there\'s nothing for AI Assist to change.') }); return }
    const ctl = new AbortController()
    setJob(rootId, { busy: true, ctl, by: c.id })
    const all = threadsOf(items).find((x) => x.id === rootId)?.items || []
    const thread = all.slice(0, Math.max(0, all.findIndex((x) => x.id === c.id))).map((x) => ({ who: x.author, text: x.text }))
    const live = ex.getSceneElements().filter((e) => !pinOf(e))
    try {
      const r = await api('/boards/comment', { method: 'POST', signal: ctl.signal, body: { request, scene: describe(live, ids.length ? new Set(ids) : null), selected: ids.length > 0, thread } })
      if (ctl.signal.aborted) return
      if (!pinFor(rootId)) { setJob(rootId, null); return }
      const n = r.ops.update.length + r.ops.add.length + r.ops.connect.length + r.ops.remove.length
      let sug = null
      if (n) {
        // As Change it puts one on: marked against the board as it was, one step ⌘Z takes back.
        await fontsReady(look)
        const s = { id: `ai-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, by: r.by || '' }
        const base = before(ex.getSceneElementsIncludingDeleted())
        const { elements, touched } = applyOps(X, ex.getSceneElementsIncludingDeleted(), r.ops, look)
        ex.updateScene({ elements: mark(X, base, elements, s), captureUpdate: X.CaptureUpdateAction.IMMEDIATELY })
        reroute(X, ex, elements.filter((e) => e.elbowed && touched.includes(e.id)).map((e) => e.id))
        sug = s.id
      }
      const words = n ? t('Made {n} changes here, as a suggestion: dashed on the board, to keep or discard there or here.', { n }) : t('Found nothing to change.')
      reply(rootId, `${words}${r.by ? `\n\n${t('AI Assist · {model}', { model: r.by })}` : ''}`, AI_AUTHOR, sug ? { sug } : {})
      setJob(rootId, null)
    } catch (e) {
      if (ctl.signal.aborted) return
      setJob(rootId, { error: e.message, code: e.code === 'noModel' ? 'no-model' : e.code || null })
    }
  }
  const stop = (rootId) => { jobsRef.current[rootId]?.ctl?.abort(); setJob(rootId, null) }
  // A thread's suggestion: the last one AI Assist made in it, while it's still on the board.
  const sugOf = (rootId) => {
    const p = pinFor(rootId)
    const id = p ? [...p.thread.items].reverse().find((x) => x.sug)?.sug : null
    if (!id) return null
    const els = ex.getSceneElements().filter((e) => markOf(e)?.id === id)
    return els.length ? { id, n: els.length } : null
  }
  const settle = (rootId, keep) => {
    const ids = rootId ? [sugOf(rootId)?.id].filter(Boolean) : threads.map((th) => sugOf(th.id)?.id).filter(Boolean)
    let els = ex.getSceneElementsIncludingDeleted()
    for (const id of ids) els = (keep ? keepIt : discardIt)(X, els, id)
    if (ids.length) ex.updateScene({ elements: els, captureUpdate: X.CaptureUpdateAction.IMMEDIATELY })
  }
  const suggestion = (rootId) => { const s = sugOf(rootId); return s ? { note: s.n === 1 ? t('1 shape, dashed on the board') : t('{n} shapes, dashed on the board', { n: s.n }) } : null }
  const suggestions = () => threads.filter((th) => sugOf(th.id)).length
  const resolve = (rootId, done) => { setThread(rootId, (th) => ({ ...th, done })); if (done && picked === rootId) setPicked(null) }
  const remove = (id) => {
    const p = pinFor(id)
    if (p) { stop(id); setThread(id, () => null); if (picked === id) setPicked(null); return }
    const root = ex.getSceneElements().map((e) => ({ el: e, thread: pinOf(e) })).find((x) => x.thread?.items.some((c) => c.id === id))
    if (root) setThread(root.thread.id, (th) => ({ ...th, items: th.items.filter((c) => c.id !== id) }))
  }
  // A thread picked: what it's on picked on the board (or its pin), and brought into view.
  const pick = (rootId) => {
    setPicked(rootId)
    const p = pinFor(rootId)
    if (!p) return
    const els = p.thread.on?.length ? shapesOf(p.thread.on) : []
    const show = els.length ? els : [p.el]
    ex.updateScene({ appState: { selectedElementIds: Object.fromEntries(show.map((e) => [e.id, true])) }, captureUpdate: X.CaptureUpdateAction.NEVER })
    try { ex.scrollToContent(show, { fitToContent: false, animate: true }) } catch { /* in view already */ }
  }
  return {
    threads, picked, pick, draft, start, cancel, post: postAndAsk, reply: replyAndAsk, resolve, remove, wordsOf, said, setSaid, on,
    jobs, ask, stop, settle, suggestion, suggestions, askOf,
    count: threads.filter((th) => !th.done).length,
  }
}
