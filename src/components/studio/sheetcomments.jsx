import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SheetInterceptorService, INTERCEPTOR_POINT, IRenderManagerService, IShortcutService, KeyCode, MetaKeys, whenSheetEditorFocused } from '@univerjs/preset-sheets-core'
import { InterceptorEffectEnum, ICommandService, CommandType } from '@univerjs/presets'
import { t } from '../../i18n/index.js'
import { api } from '../../api.js'
import { threadsOf, AI_AUTHOR } from './wordcomments.js'
import { mentions, requestOf, askOf } from './doccomments.jsx'

// Comments on a sheet's cells, as threads (Comments and @bridge, a beta feature): a comment on the
// cell or the cells picked, replies, resolved and opened again, deleted, all written into the Excel
// file itself as Excel 365 keeps them (xlsxbook.js: threaded comments, the persons who wrote them,
// and a placeholder note for older Excels), so Excel shows them as you left them. A cell with an
// open thread has a mark in its corner, as Excel draws one; picked, its thread is picked in the
// pane. Rows and columns added, removed or moved take a comment with its cell (one on a row
// removed goes with it, and comes back with undo). The pane is doccomments.jsx's, with a sheet's
// words.
//
// @bridge in a comment you write asks AI Assist about those cells only: the cells (with their
// column's heading), the sheet's name and size, the names of the others, the thread so far and
// what you asked, through the sheet's AI Assist (POST /api/studio/sheet/comment, the fast path of
// /studio/sheet/ai). While it works the thread says so and the cells are outlined; its reply goes
// in the thread, signed AI Assist with the wand and the model, and its change is put on the sheet
// as AI Assist's suggestions are, outlined, with what was there kept: Keep or Discard in the
// thread, or Keep all. With no model, or one that fails, the thread says why. A comment that came
// in the file mentioning @bridge waits for you to send it.

const colName = (c) => { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
const cellName = (r, c) => `${colName(c)}${r + 1}`
const rangeName = (x) => (x.range && (x.range.rows > 1 || x.range.cols > 1) ? `${cellName(x.r, x.c)}:${cellName(x.r + x.range.rows - 1, x.c + x.range.cols - 1)}` : cellName(x.r, x.c))
// An id as Excel gives a comment one: a GUID in braces.
const guid = () => {
  const u = globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => { const r = Math.floor(Math.random() * 16); return (ch === 'x' ? r : (r & 3) | 8).toString(16) })
  return `{${u.toUpperCase()}}`
}
const initialsOf = (name) => (name === AI_AUTHOR ? 'AI' : String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?')
// The mark in a commented cell's corner, as Excel draws a thread's.
const MARKER = { color: '#8a5cf5', size: 7 }
const BUSY = { stroke: '#8a5cf5', fill: 'rgba(138, 92, 245, 0.10)', strokeWidth: 2, strokeDash: 6 }
// One row or column change as a function on an index: the new index, or null when it was removed
// (as xlsxbook.js moves what the file keeps beside the cells).
function stepOf(op) {
  const { start = 0, count = 0, from = 0, to = 0 } = op
  if (/^insert/.test(op.op)) return (i) => (i >= start ? i + count : i)
  if (/^remove/.test(op.op)) return (i) => (i < start ? i : i >= start + count ? i - count : null)
  if (/^move/.test(op.op)) {
    return (i) => {
      if (to > from) { if (i >= from && i < from + count) return i + (to - from - count); if (i >= from + count && i < to) return i - count; return i }
      if (to < from) { if (i >= from && i < from + count) return i - (from - to); if (i >= to && i < from) return i + count; return i }
      return i
    }
  }
  return (i) => i
}

// ⌥⌘M (Ctrl+Alt+M) on the sheet: Comment, as in Excel and Google Sheets. Shown in Univer's list of keys.
export function commentKey(univer, run) {
  const injector = univer.__getInjector()
  const id = 'bridge.sheet.comment-key'
  const offs = [injector.get(ICommandService).registerCommand({ id, type: CommandType.COMMAND, handler: () => { run(); return true } })]
  offs.push(injector.get(IShortcutService).registerShortcut({ id, binding: KeyCode.M | MetaKeys.CTRL_COMMAND | MetaKeys.ALT, preconditions: whenSheetEditorFocused, description: t('Comment on the cells picked'), group: '9_bridge-google', groupTitle: t('Keys from Google Sheets') }))
  return { dispose: () => { for (const o of offs) { try { o.dispose() } catch { /* gone */ } } } }
}

// univer: the facade's ref; core: Univer itself (its services); initial: readSheet's threads, by
// sheet id; on: whether comments can be written (the beta feature, and not read-only); author:
// your name; file: { root, path, name }; dirty(): a change to save; gridText(sheet, range): the
// cells as the model reads them; change: the sheet's suggestions (put, keep, back), as AI Assist's
// panel has them.
export function useSheetThreads({ univer, core, ready, initial, on, author, file, dirty, gridText, change }) {
  const flat = (o) => Object.entries(o || {}).flatMap(([sheet, l]) => (l || []).map((x) => ({ ...x, sheet, initials: initialsOf(x.author), author: x.author || t('Someone') })))
  const [list, setList] = useState(() => flat(initial))
  const listRef = useRef(list)
  const seen = useRef(initial)
  if (seen.current !== initial) { seen.current = initial; const l = flat(initial); listRef.current = l; setList(l) }
  const [picked, setPicked] = useState(null)
  const [draft, setDraft] = useState(null) // { sheet, r, c, range, text }
  const [said, setSaid] = useState(null)
  const [jobs, setJobs] = useState({})
  const jobsRef = useRef(jobs)
  const setJob = (id, v) => { const n = { ...jobsRef.current }; if (v) n[id] = v; else delete n[id]; jobsRef.current = n; setJobs(n) }
  // AI Assist's change in each thread, by its first comment's id: on the sheet, to keep or discard.
  const [sugs, setSugs] = useState({})
  const sugsRef = useRef(sugs)
  const setSug = (id, v) => { const n = { ...sugsRef.current }; if (v) n[id] = v; else delete n[id]; sugsRef.current = n; setSugs(n) }
  const [, redraw] = useState(0)
  const set = (next, save = true) => { listRef.current = next; setList(next); if (save) dirty() }
  const wb = () => univer.current?.getActiveWorkbook()
  const sheetOf = (id) => { try { return wb()?.getSheetBySheetId(id) || null } catch { return null } }
  const alive = (x) => x.r != null && x.c != null && !x.gone

  // The marks in the corners of cells with an open thread, drawn with the sheet's cells.
  const marked = useRef(new Set())
  useEffect(() => {
    marked.current = new Set(on ? list.filter((x) => !x.parent && !x.done && alive(x)).map((x) => `${x.sheet}:${x.r}:${x.c}`) : [])
    try { const id = wb()?.getId(); if (id) core.current?.__getInjector().get(IRenderManagerService).getRenderUnitById(id)?.mainComponent?.makeForceDirty() } catch { /* drawn next time */ }
  }, [list, on, ready]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || !on || !core.current) return undefined
    let off = null
    try {
      off = core.current.__getInjector().get(SheetInterceptorService).intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
        effect: InterceptorEffectEnum.Style,
        priority: 101,
        handler: (cell, pos, next) => {
          if (!marked.current.has(`${pos.subUnitId}:${pos.row}:${pos.col}`)) return next(cell)
          const c = !cell || cell === pos.rawData ? { ...pos.rawData } : cell
          c.markers = { ...c.markers, tr: MARKER }
          return next(c)
        },
      })
    } catch { /* the threads are in the pane still */ }
    return () => { try { off?.dispose() } catch { /* gone */ } }
  }, [ready, on]) // eslint-disable-line react-hooks/exhaustive-deps

  // A row or column added, removed or moved (undo too): each comment stays with its cell. One whose
  // cell went is kept aside, and back where it was if that's undone straight after.
  const moved = useCallback((op) => {
    const rows = /-rows$/.test(op.op)
    const step = stepOf(op)
    const undo = /^insert/.test(op.op)
    let any = false
    const next = listRef.current.map((x) => {
      if (x.sheet !== op.sheet) return x
      if (x.gone) {
        const g = x.gone
        if (undo && g.op.sheet === op.sheet && /-rows$/.test(g.op.op) === rows && g.op.start === op.start && g.op.count === op.count) { any = true; const { gone, ...back } = x; return { ...back, r: g.r, c: g.c } }
        return x
      }
      if (x.r == null) return x
      const k = rows ? step(x.r) : step(x.c)
      if (k === (rows ? x.r : x.c)) return x
      any = true
      if (k == null) return { ...x, gone: { r: x.r, c: x.c, op } }
      return rows ? { ...x, r: k } : { ...x, c: k }
    })
    if (any) { listRef.current = next; setList(next) }
  }, [])

  // The threads, in the order of the sheets and their cells: those on the sheet in view first.
  const threads = useMemo(() => {
    const order = (() => { try { return wb()?.getSheets().map((s) => s.getSheetId()) || [] } catch { return [] } })()
    const rank = (x) => [order.indexOf(x.root.sheet), x.root.r ?? 1e9, x.root.c ?? 1e9]
    // One whose cell was removed isn't shown (as in Excel), unless that's undone.
    return threadsOf(list).filter((th) => !th.root.gone).map((th) => ({ ...th, done: !!th.root.done })).sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] })
  }, [list, ready]) // eslint-disable-line react-hooks/exhaustive-deps
  // What a thread is on, for its card: the cells (with their sheet when it's another), and what's in the first.
  const wordsOf = (id) => {
    const x = listRef.current.find((c) => c.id === id)
    if (!x || !alive(x)) return null
    const s = sheetOf(x.sheet)
    if (!s) return null
    let v = ''
    try { v = String(s.getRange(x.r, x.c).getDisplayValue() ?? '') } catch { v = '' }
    const here = wb()?.getActiveSheet()?.getSheetId() === x.sheet
    return `${here ? '' : `${s.getSheetName()} › `}${rangeName(x)}${v ? ` · ${v}` : ''}`
  }

  // A new comment, on the cell or cells picked.
  const start = () => {
    if (!on) return false
    try {
      const s = wb().getActiveSheet()
      const g = s.getSelection()?.getActiveRange()
      if (!g) { setSaid(t('Pick a cell to comment on first, then Comment.')); return false }
      const rows = Math.min(g.getHeight(), 1000), cols = Math.min(g.getWidth(), 100)
      const d = { sheet: s.getSheetId(), r: g.getRow(), c: g.getColumn(), range: rows > 1 || cols > 1 ? { rows, cols } : null }
      setSaid(null)
      setDraft({ ...d, text: `${rangeName(d)}${s.getRange(d.r, d.c).getDisplayValue() ? ` · ${s.getRange(d.r, d.c).getDisplayValue()}` : ''}` })
      return true
    } catch { setSaid(t('Pick a cell to comment on first, then Comment.')); return false }
  }
  const cancel = () => setDraft(null)
  const item = (o) => ({ id: guid(), author, initials: initialsOf(author), date: new Date().toISOString(), parent: null, done: false, made: true, ...o })
  const post = (text) => {
    const body = String(text || '').trim()
    if (!draft || !body) return null
    // A cell has one thread, as in Excel: a comment on a cell that has one answers it, opening it
    // again if it was resolved (and @bridge in it is about the cells picked now).
    const had = listRef.current.find((x) => !x.parent && alive(x) && x.sheet === draft.sheet && x.r === draft.r && x.c === draft.c)
    if (had) {
      setDraft(null)
      listRef.current = listRef.current.map((x) => (x.id === had.id ? { ...x, range: draft.range || x.range, done: false } : x.parent === had.id ? { ...x, done: false } : x))
      setPicked(had.id)
      return reply(had.id, body)
    }
    const c = item({ sheet: draft.sheet, r: draft.r, c: draft.c, range: draft.range, text: body })
    setDraft(null)
    setPicked(c.id)
    set([...listRef.current, c])
    return c
  }
  const reply = (rootId, text, as = author) => {
    const body = String(text || '').trim()
    const root = listRef.current.find((x) => x.id === rootId)
    if (!body || !root) return null
    const c = item({ sheet: root.sheet, r: root.r, c: root.c, text: body, parent: rootId, author: as, initials: initialsOf(as) })
    set([...listRef.current, c])
    return c
  }
  const postAndAsk = (text) => { const c = post(text); if (c && mentions(text)) ask(c.parent || c.id, c); return c }
  const replyAndAsk = (rootId, text) => { const c = reply(rootId, text); if (c && mentions(text)) ask(rootId, c); return c }

  // ---------- AI Assist ----------
  const ask = async (rootId, c) => {
    const root = listRef.current.find((x) => x.id === rootId)
    const s = root && alive(root) ? sheetOf(root.sheet) : null
    const request = requestOf(c.text)
    jobsRef.current[rootId]?.ctl?.abort()
    if (!s) { setJob(rootId, { error: t('The cell this comment was on isn\'t on the sheet any more, so there\'s nothing for AI Assist to work on.') }); return }
    if (!request) { setJob(rootId, { error: t('Say what you\'d like after @bridge: "@bridge total each row", or a question about these cells.'), code: 'no-request' }); return }
    const ctl = new AbortController()
    let lit = null
    const on = s.getRange(root.r, root.c, root.range?.rows || 1, root.range?.cols || 1)
    try { lit = s.highlightRanges([on], BUSY) } catch { /* said in the thread */ }
    setJob(rootId, { busy: true, ctl, by: c.id, lit })
    const items = threadsOf(listRef.current).find((x) => x.id === rootId)?.items || []
    const thread = items.slice(0, Math.max(0, items.findIndex((x) => x.id === c.id))).map((x) => ({ who: x.author, text: x.text }))
    const rows = (s.getLastRow() ?? -1) + 1, cols = (s.getLastColumn() ?? -1) + 1
    // A comment on one cell (as Excel keeps every comment) is asked about with the table it's in,
    // as Excel's ⌘A picks it, saying which cell it's on.
    let g = on
    if (!root.range) { try { const d = on.getDataRegion(); if (d.getWidth() * d.getHeight() > 1) g = d } catch { /* the cell alone */ } }
    const where = g === on ? t('{range} on {sheet}', { range: rangeName(root), sheet: s.getSheetName() }) : t('{cell} on {sheet}, in the table {range}', { cell: rangeName(root), sheet: s.getSheetName(), range: g.getA1Notation() })
    const done = () => { try { lit?.dispose() } catch { /* gone */ } }
    try {
      const r = await api('/studio/sheet/comment', { method: 'POST', signal: ctl.signal, body: { root: file.root, path: file.path, instruction: request, selection: gridText(s, g), where, sheet: s.getSheetName(), sheets: wb().getSheets().map((x) => x.getSheetName()), used: rows > 0 && cols > 0 ? `A1:${colName(cols - 1)}${rows}` : null, thread } })
      done()
      if (ctl.signal.aborted) return
      if (!listRef.current.some((x) => x.id === rootId)) { setJob(rootId, null); return }
      const p = r.proposal || {}
      let note = ''
      if (sugsRef.current[rootId]) { change.back(sugsRef.current[rootId]); setSug(rootId, null) }
      try {
        const sg = change.put(p, s.getSheetName())
        if (sg) setSug(rootId, sg)
      } catch (x) { note = `\n\n${t('Its change couldn\'t be put on the sheet: {error}.', { error: x.message })}` }
      const words = String(p.answer || p.summary || t('Suggested a change to these cells.')).trim()
      reply(rootId, `${words}${note}${r.by ? `\n\n${t('AI Assist · {model}', { model: r.by })}` : ''}`, AI_AUTHOR)
      setJob(rootId, null)
    } catch (e) {
      done()
      if (ctl.signal.aborted) return
      setJob(rootId, { error: e.message, code: e.code === 'noModel' ? 'no-model' : e.code || null })
    }
  }
  const stop = (rootId) => { const j = jobsRef.current[rootId]; j?.ctl?.abort(); try { j?.lit?.dispose() } catch { /* gone */ } setJob(rootId, null) }
  // Kept (it stays, no longer outlined; a chart goes in Charts) or discarded (as it was), in one
  // thread or all of them.
  const settle = (rootId, keep) => {
    const ids = rootId ? [rootId] : Object.keys(sugsRef.current)
    // The newest first, so each puts back what was there before it.
    for (const id of [...ids].reverse()) {
      const s = sugsRef.current[id]
      if (!s) continue
      if (keep) change.keep(s); else change.back(s)
      setSug(id, null)
    }
    dirty()
    redraw((n) => n + 1)
  }
  const suggestion = (rootId) => {
    const s = sugs[rootId]
    if (!s) return null
    return { cells: Object.entries(s.proposal?.cells || {}).slice(0, 6).map(([ref, v]) => [ref.toUpperCase(), String(v)]), n: s.before.length, chart: s.chart?.spec?.title || (s.chart ? t('Chart') : null) }
  }
  const suggestions = () => Object.keys(sugs).length

  const resolve = (rootId, done) => {
    set(listRef.current.map((x) => (x.id === rootId || x.parent === rootId ? { ...x, done } : x)))
    if (done && picked === rootId) setPicked(null)
  }
  const remove = (id) => {
    const gone = new Set([id, ...listRef.current.filter((x) => x.parent === id).map((x) => x.id)])
    if (sugsRef.current[id]) { change.back(sugsRef.current[id]); setSug(id, null) }
    stop(id)
    set(listRef.current.filter((x) => !gone.has(x.id)))
    if (gone.has(picked)) setPicked(null)
  }
  // A thread picked: its cells picked on the sheet, and brought into view.
  const pick = (id) => {
    setPicked(id)
    const x = listRef.current.find((c) => c.id === id)
    const s = x && alive(x) ? sheetOf(x.sheet) : null
    if (!s) return
    try {
      const book = wb()
      if (book.getActiveSheet().getSheetId() !== s.getSheetId()) book.setActiveSheet(s)
      s.getRange(x.r, x.c, x.range?.rows || 1, x.range?.cols || 1).activate()
      s.scrollToCell?.(Math.max(0, x.r - 3), Math.max(0, x.c - 1))
    } catch { /* picked in the pane */ }
  }
  // A cell picked on the sheet that has a thread: that thread, in the pane.
  const cellPicked = (sel) => {
    if (!sel) return
    const x = listRef.current.find((c) => !c.parent && alive(c) && c.sheet === sel.sheetId && c.r === sel.row && c.c === sel.col)
    if (x && x.id !== picked) setPicked(x.id)
  }
  // Each sheet's threads, for the writer (xlsxbook.js's writeBook threads).
  const save = () => {
    const out = {}
    for (const x of listRef.current) {
      if (!alive(x)) continue
      ;(out[x.sheet] ||= []).push({ id: x.id, r: x.r, c: x.c, author: x.author, date: x.date, text: x.text, parent: x.parent, done: !!x.done })
    }
    return out
  }
  return {
    list, threads, picked, pick, draft, start, cancel, post: postAndAsk, reply: replyAndAsk, resolve, remove, wordsOf, said, setSaid, on,
    jobs, ask, stop, settle, suggestion, suggestions, askOf, moved, cellPicked, save,
    count: list.filter((x) => !x.parent && !x.done && alive(x)).length,
  }
}
