import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { t, locale } from '../../i18n/index.js'
import { api, usePoll } from '../../api.js'
import { keys } from './keys.js'
import { commentKey } from './docview.js'
import { commentsOf, threadsOf, newComment, usedIds, anchor, writeComments, AI_AUTHOR } from './wordcomments.js'
import './threads.css'

// Comments in a Word file, as threads (Comments, a beta feature): a comment on the words you pick,
// replies, resolved and opened again, deleted, all written into the file itself (wordcomments.js),
// so Word shows them as you left them, and comments from Word read as Word made them: who wrote
// each, when, which answers which, and which are resolved. The comments live in the document's
// own marks (a comment's start, end and reference, as Word puts them) and in the list the pane
// shows; the marks are put in and taken out outside the undo history, so ⌘Z changes the words, not
// the comments. The pane is the comments pane beside the page: open threads in the order their
// words come, resolved ones folded away under them.
//
// @bridge in a comment you write here asks AI Assist (server/commentassist.js), about that place
// only: the words the comment is on, the document around them, the thread so far and what you
// asked. While it works the thread says so and its words pulse; its reply goes in the thread,
// signed AI Assist with the wand (in the file too), saying what it did and why and which model did
// it; a change it makes is a suggestion on the words, a tracked change by AI Assist (as Word shows
// one), kept or discarded from the thread (or all at once), and nothing else changes until it's
// kept. With no model, or one that fails, the thread says why and how to fix it. A comment that
// came in the file (someone else's, or one of yours from before) that mentions @bridge isn't sent
// by itself: the thread says it's waiting, with Send to AI Assist, so words in a file you were sent
// can't set AI Assist to work.

// Where each comment's marks are in the document: { cs, ce, cr } positions by its id.
function anchorsOf(doc) {
  const at = new Map()
  doc.descendants((n, pos) => {
    if (n.type.name !== 'xin' || !['cs', 'ce', 'cr'].includes(n.attrs.k)) return true
    const id = String(n.attrs.id)
    const a = at.get(id) || {}
    if (a[n.attrs.k] == null) a[n.attrs.k] = pos
    at.set(id, a)
    return false
  })
  return at
}
const sameAnchors = (a, b) => a.size === b.size && [...a].every(([id, x]) => { const y = b.get(id); return y && y.cs === x.cs && y.ce === x.ce && y.cr === x.cr })

// @bridge, as a word of its own; what's asked is the rest of the comment.
const MENTION = /(^|[^\w@.])@bridge\b/i
export const mentions = (text) => MENTION.test(String(text || ''))
const requestOf = (text) => String(text || '').replace(/(^|[^\w@.])@bridge\b[,:]?/gi, '$1').replace(/\s{2,}/g, ' ').trim()
const isAi = (c) => c.author === AI_AUTHOR
// The comment in a thread AI Assist hasn't answered yet: the last one mentioning @bridge with no
// reply from AI Assist after it.
function askOf(items) {
  let ask = null
  for (const c of items) { if (isAi(c)) ask = null; else if (mentions(c.text)) ask = c }
  return ask
}
// AI Assist's suggestions on the words between from and to: the tracked changes it made.
function suggestionsIn(doc, from, to) {
  const out = []
  if (to <= from) return out
  doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isInline) return true
    const m = n.marks.find((x) => x.type.name === 'rev' && x.attrs.by === AI_AUTHOR)
    if (m) out.push({ from: Math.max(from, pos), to: Math.min(to, pos + n.nodeSize), ins: m.attrs.k === 'ins', mark: m, text: n.text || '' })
    return false
  })
  return out
}
const stamp = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, 'Z')
// A comment's words as they stand: without what AI Assist suggests adding (still to keep).
function plainWords(doc, from, to) {
  if (to <= from) return ''
  let s = ''
  doc.nodesBetween(from, to, (n, pos) => {
    if (n.isBlock && pos >= from && s) s += '\n'
    if (!n.isText) return true
    if (!n.marks.some((m) => m.type.name === 'rev' && m.attrs.by === AI_AUTHOR && m.attrs.k === 'ins')) s += n.text.slice(Math.max(0, from - pos), Math.max(0, to - pos))
    return false
  })
  return s
}

// The comments' list and what's done to it, for a Word file's editor. on: whether comments can be
// written here (the beta feature, and the file not read-only); author: the name they're signed
// with; name: the file's, for AI Assist; dirty(): the file now has changes to save. save(w, put):
// the comment parts written (writeDocx's more).
export function useThreads({ editor, model, on, author, dirty, name = '' }) {
  const [list, setList] = useState(() => commentsOf(model))
  const listRef = useRef(list)
  const seen = useRef(model)
  // Read again for a file read again (changed elsewhere, and opened as it is now).
  if (seen.current !== model) { seen.current = model; const l = commentsOf(model); listRef.current = l; setList(l) }
  const used = useMemo(() => usedIds(model), [model])
  const [picked, setPicked] = useState(null) // the thread picked: its words marked more strongly
  const [draft, setDraft] = useState(null) // the words a comment's being written for: { from, to, text }
  const [anchors, setAnchors] = useState(() => new Map())
  const [said, setSaid] = useState(null)
  // AI Assist at work in a thread, by its first comment's id: { busy, ctl } while it works, then
  // { error, code } if it couldn't answer.
  const [jobs, setJobs] = useState({})
  const jobsRef = useRef(jobs)
  const setJob = (id, v) => { const n = { ...jobsRef.current }; if (v) n[id] = v; else delete n[id]; jobsRef.current = n; setJobs(n) }
  // A tracked change's id, as Word numbers them: on from the highest in the file.
  const revAt = useRef(null)
  const revOf = useRef(null)
  if (revOf.current !== model) { revOf.current = model; let n = 0; for (const m of String(model.main?.xml || '').matchAll(/\sw:id="(\d+)"/g)) n = Math.max(n, Number(m[1])); revAt.current = n }
  // What the page marks (and doesn't) for the threads now: a reply's marks are its thread's, and a
  // resolved thread's words aren't marked.
  const hide = useRef(new Set())
  hide.current = new Set(list.filter((c) => c.parent || (!c.parent && c.done)).map((c) => c.id))
  useEffect(() => {
    if (!editor) return undefined
    const look = () => setAnchors((was) => { const now = anchorsOf(editor.state.doc); return sameAnchors(was, now) ? was : now })
    look()
    editor.on('update', look)
    return () => editor.off('update', look)
  }, [editor])
  const mark = useCallback((meta) => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(commentKey, meta).setMeta('addToHistory', false)) }, [editor])
  useEffect(() => { mark({}) }, [list, jobs, mark])
  // The file's comments as the page's tooltips have them (wordschema.js), kept as they are now.
  useEffect(() => {
    if (!on) return
    model.comments.clear()
    for (const c of list) model.comments.set(c.id, { author: c.author, date: c.date, initials: c.initials, text: c.text })
  }, [list, model, on])
  const change = (next) => { listRef.current = next; setList(next); dirty() }
  const tr = () => editor.state.tr.setMeta('addToHistory', false)

  const threads = useMemo(() => {
    const pos = (th) => { let p = Infinity; for (const c of th.items) { const a = anchors.get(c.id); if (a) p = Math.min(p, a.cs ?? a.cr ?? Infinity) } return p }
    return threadsOf(list).map((th) => ({ ...th, at: pos(th), done: !!th.root.done })).sort((a, b) => a.at - b.at)
  }, [list, anchors])
  const wordsOf = (id) => {
    const a = anchors.get(id)
    if (!a || a.cs == null || a.ce == null || a.ce <= a.cs || !editor || a.ce > editor.state.doc.content.size) return null
    return plainWords(editor.state.doc, a.cs + 1, a.ce).trim()
  }

  // A new comment, for the words picked; said when none are.
  const start = () => {
    if (!on || !editor) return
    const { from, to, empty, $from, $to } = editor.state.selection
    const text = empty ? '' : editor.state.doc.textBetween(from, to, '\n', ' ').trim()
    if (!text || !$from.parent.inlineContent || !$to.parent.inlineContent) { setDraft(null); setSaid(t('Pick the words to comment on first, then Comment.')); return false }
    setSaid(null)
    setDraft({ from, to, text })
    mark({ draft: { from, to } })
    return true
  }
  const cancel = () => { setDraft(null); mark({ draft: null }); editor?.commands.focus() }
  // The draft's words, where they are now (the document may have changed meanwhile).
  const draftRange = () => editor && commentKey.getState(editor.state)?.draft
  const post = (text) => {
    const r = draftRange()
    const body = String(text || '').trim()
    if (!r || !body) return null
    const c = newComment({ list: listRef.current, used, author, text: body })
    const s = editor.schema
    const x = tr()
    x.insert(r.to, [s.nodeFromJSON(anchor('ce', c.id)), s.nodeFromJSON(anchor('cr', c.id))])
    x.insert(r.from, s.nodeFromJSON(anchor('cs', c.id)))
    x.setMeta(commentKey, { draft: null, on: c.id })
    editor.view.dispatch(x)
    setDraft(null)
    setPicked(c.id)
    change([...listRef.current, c])
    return c
  }
  // A reply: a comment of its own, its marks beside its thread's, as Word puts a reply's. as: who
  // it's from (AI Assist's own).
  const reply = (rootId, text, as = author) => {
    const body = String(text || '').trim()
    if (!body || !listRef.current.some((c) => c.id === rootId)) return null
    const c = newComment({ list: listRef.current, used, author: as, text: body, parent: rootId })
    const at = anchorsOf(editor.state.doc)
    const ids = [rootId, ...listRef.current.filter((x) => x.parent === rootId).map((x) => x.id)]
    const root = at.get(rootId)
    const last = Math.max(-1, ...ids.map((id) => at.get(id)?.cr ?? at.get(id)?.ce ?? -1))
    if (root?.cs != null && last >= 0) {
      const s = editor.schema
      const x = tr()
      x.insert(last + 1, [s.nodeFromJSON(anchor('ce', c.id)), s.nodeFromJSON(anchor('cr', c.id))])
      x.insert(root.cs + 1, s.nodeFromJSON(anchor('cs', c.id)))
      editor.view.dispatch(x)
    }
    change([...listRef.current, c])
    return c
  }
  // Written here and mentioning @bridge: sent to AI Assist at once (yours, as you post it).
  const postAndAsk = (text) => { const c = post(text); if (c && mentions(text)) ask(c.id, c); return c }
  const replyAndAsk = (rootId, text) => { const c = reply(rootId, text); if (c && mentions(text)) ask(rootId, c); return c }

  // ---------- AI Assist ----------
  // Asked in a thread: about its words, the document around them and the thread so far, by the
  // comment c (its request is the rest of what it says).
  const ask = async (rootId, c) => {
    const a = anchorsOf(editor.state.doc).get(rootId)
    const words = a?.cs != null && a?.ce != null ? plainWords(editor.state.doc, a.cs + 1, a.ce) : ''
    const request = requestOf(c.text)
    jobsRef.current[rootId]?.ctl?.abort()
    if (!words.trim()) { setJob(rootId, { error: t('The words this comment was on aren\'t in the document any more, so there\'s nothing for AI Assist to work on.') }); return }
    if (!request) { setJob(rootId, { error: t('Say what you\'d like after @bridge: "@bridge make this shorter", or a question about these words.'), code: 'no-request' }); return }
    const ctl = new AbortController()
    setJob(rootId, { busy: true, ctl, by: c.id })
    const doc = editor.state.doc
    const items = threadsOf(listRef.current).find((x) => x.id === rootId)?.items || []
    const thread = items.slice(0, Math.max(0, items.findIndex((x) => x.id === c.id))).map((x) => ({ who: x.author, text: x.text }))
    try {
      const r = await api('/studio/comment-assist', { method: 'POST', signal: ctl.signal, body: { request, text: words, before: doc.textBetween(Math.max(0, a.cs - 1500), a.cs, '\n\n', ' '), after: doc.textBetween(a.ce, Math.min(doc.content.size, a.ce + 1000), '\n\n', ' '), name, thread } })
      if (ctl.signal.aborted || editor.isDestroyed) return
      // Gone meanwhile (deleted): its answer has nowhere to go.
      if (!listRef.current.some((x) => x.id === rootId)) { setJob(rootId, null); return }
      const changed = r.change ? suggest(rootId, r.change) : false
      const by = r.by ? `\n\n${t('AI Assist · {model}', { model: r.by })}` : ''
      reply(rootId, `${r.reply}${r.change && !changed ? `\n\n${t('Its change couldn\'t be put on the words: they changed while it worked.')}` : ''}${by}`, AI_AUTHOR)
      setJob(rootId, null)
    } catch (e) {
      if (ctl.signal.aborted) return
      setJob(rootId, { error: e.message, code: e.code || null })
    }
  }
  const stop = (rootId) => { jobsRef.current[rootId]?.ctl?.abort(); setJob(rootId, null) }
  // AI Assist's change, on the words: what's there marked deleted and the new words after it marked
  // inserted, both by AI Assist (a tracked change, as Word shows one), in the look of the words
  // they replace. Out of the undo history: Keep or Discard settles it.
  const suggest = (rootId, text) => {
    // One it made before in these words gives way to the new one.
    const old = anchorsOf(editor.state.doc).get(rootId)
    if (old?.cs != null && old?.ce != null) {
      const spans = suggestionsIn(editor.state.doc, old.cs + 1, old.ce)
      if (spans.length) { const x = tr(); for (const r of spans.reverse()) { if (r.ins) x.delete(r.from, r.to); else x.removeMark(r.from, r.to, r.mark) } editor.view.dispatch(x) }
    }
    const a = anchorsOf(editor.state.doc).get(rootId)
    if (a?.cs == null || a?.ce == null || a.ce <= a.cs + 1) return false
    const { schema, doc } = editor.state
    const from = a.cs + 1, to = a.ce
    const at = stamp()
    const rev = (k) => schema.marks.rev.create({ k, by: AI_AUTHOR, at, tag: `<w:${k} w:id="${++revAt.current}" w:author="${AI_AUTHOR}" w:date="${at}">` })
    const x = tr()
    const del = rev('del')
    let look = null
    doc.nodesBetween(from, to, (n, pos) => {
      if (!n.isText) return true
      look = n.marks
      if (!n.marks.some((m) => m.type.name === 'rev')) x.addMark(Math.max(from, pos), Math.min(to, pos + n.nodeSize), del)
      return false
    })
    const marks = (look || []).filter((m) => !['rev', 'link'].includes(m.type.name)).concat(rev('ins'))
    x.insert(to, schema.text(String(text).replace(/\s*\n+\s*/g, ' ').trim(), marks))
    editor.view.dispatch(x)
    return true
  }
  // Kept (the new words stay, the old go) or discarded (as it was), in a thread's words or all of
  // them. In the undo history: ⌘Z after Keep puts the suggestion back.
  const settle = (rootId, keep) => {
    const doc = editor.state.doc
    let from = 0, to = doc.content.size
    if (rootId) { const a = anchorsOf(doc).get(rootId); if (a?.cs == null || a?.ce == null) return; from = a.cs + 1; to = a.ce }
    const spans = suggestionsIn(doc, from, to)
    if (!spans.length) return
    const x = editor.state.tr
    for (const r of spans.reverse()) { if (r.ins === keep) x.removeMark(r.from, r.to, r.mark); else x.delete(r.from, r.to) }
    editor.view.dispatch(x)
    dirty()
  }
  const suggestion = (rootId) => {
    const a = anchors.get(rootId)
    if (a?.cs == null || a?.ce == null || !editor) return null
    const size = editor.state.doc.content.size
    const spans = suggestionsIn(editor.state.doc, Math.min(a.cs + 1, size), Math.min(a.ce, size))
    return spans.length ? { del: spans.filter((x) => !x.ins).map((x) => x.text).join(''), ins: spans.filter((x) => x.ins).map((x) => x.text).join('') } : null
  }
  const suggestions = () => (editor ? suggestionsIn(editor.state.doc, 0, editor.state.doc.content.size).filter((x) => x.ins).length : 0)

  // Resolved, or opened again: the whole thread, as Word marks it.
  const resolve = (rootId, done) => {
    change(listRef.current.map((c) => (c.id === rootId || c.parent === rootId ? { ...c, done } : c)))
    if (done && picked === rootId) { setPicked(null); mark({ on: null }) }
  }
  // Deleted: a thread with its replies, or one reply; their marks out of the document.
  const remove = (id) => {
    const gone = new Set([id, ...listRef.current.filter((c) => c.parent === id).map((c) => c.id)])
    const x = tr()
    const del = []
    editor.state.doc.descendants((n, pos) => { if (n.type.name === 'xin' && ['cs', 'ce', 'cr'].includes(n.attrs.k) && gone.has(String(n.attrs.id))) del.push(pos); return true })
    for (const pos of del.reverse()) x.delete(pos, pos + 1)
    if (x.docChanged) editor.view.dispatch(x)
    change(listRef.current.filter((c) => !gone.has(c.id)))
    if (gone.has(picked)) { setPicked(null); mark({ on: null }) }
  }
  // A thread picked: its words marked and brought into view.
  const pick = (id) => {
    setPicked(id)
    mark({ on: id })
    const a = anchorsOf(editor.state.doc).get(id)
    const pos = a?.cs ?? a?.cr
    if (pos != null) { try { const d = editor.view.domAtPos(pos + 1).node; (d.nodeType === 1 ? d : d.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* not drawn yet */ } }
  }
  return {
    list, threads, picked, pick, draft, start, cancel, post: postAndAsk, reply: replyAndAsk, resolve, remove, wordsOf, said, setSaid, on,
    jobs, ask, stop, settle, suggestion, suggestions, askOf,
    skip: (id) => hide.current.has(id),
    busy: (id) => !!jobsRef.current[id]?.busy,
    save: (w, put) => writeComments(model, w, put, listRef.current),
  }
}

// The name comments are signed with: yours, as Bridge AI has it (Settings), else Me.
export function useAuthor() {
  const { data } = usePoll('/config', 10 * 60 * 1000)
  return (data?.name || '').trim() || t('Me')
}

// ---------- The pane ----------
const when = (d) => { const x = d ? new Date(d) : null; return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) : '' }

// A comment's words; AI Assist's last line (which model wrote it) quieter.
const MODEL_LINE = /\n\n(AI Assist · [^\n]+)$/
function Words({ c }) {
  const m = isAi(c) ? MODEL_LINE.exec(c.text) : null
  return <span className="sd-comment-text">{m ? c.text.slice(0, m.index) : c.text}{m && <small className="sd-thread-by muted">{m[1]}</small>}</span>
}

function Who({ c, onDelete }) {
  return (
    <span className="sd-comment-who">
      {isAi(c) ? <i className="sd-who-ai" aria-hidden="true"><Icon name="wand" size={11} /></i> : <i aria-hidden="true">{(c.initials || c.author || '?').slice(0, 2).toUpperCase()}</i>}
      <b>{c.author || t('Someone')}</b>
      {c.date && <small className="muted">{when(c.date)}</small>}
      {onDelete && <button type="button" className="win-btn sd-thread-x" onClick={(e) => { e.stopPropagation(); onDelete() }} aria-label={t('Delete this reply')} title={t('Delete this reply')}><Icon name="trash" size={11} /></button>}
    </span>
  )
}

// A box to write in: a comment, or a reply. ⌘↩ sends it, Esc leaves it. @ (or the start of
// @bridge) offers @bridge, AI Assist, to finish it with a click or Tab.
const PARTIAL = /(^|\s)@(b|br|bri|brid|bridg)?$/i
function Box({ label, placeholder, send, onCancel, autoFocus, cta }) {
  const [v, setV] = useState('')
  const ref = useRef(null)
  const go = (e) => { e?.preventDefault(); const s = v.trim(); if (!s) return; if (send(s) !== false) setV('') }
  const partial = PARTIAL.test(v)
  const finish = () => { setV((x) => x.replace(/@\w*$/, '@bridge ')); ref.current?.focus() }
  return (
    <form className="sd-thread-box" onSubmit={go} onClick={(e) => e.stopPropagation()}>
      <textarea ref={ref} value={v} onChange={(e) => setV(e.target.value)} rows={v.includes('\n') || v.length > 40 ? 3 : 1} autoFocus={autoFocus} aria-label={label} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(e); else if (e.key === 'Tab' && partial) { e.preventDefault(); finish() } else if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel() } }} />
      {partial && <button type="button" className="sd-mention" onMouseDown={(e) => e.preventDefault()} onClick={finish} title={t('Ask AI Assist in this comment')}><Icon name="wand" size={12} /><b>@bridge</b><span>{t('AI Assist')}</span></button>}
      <div className="sd-thread-box-acts">
        <button type="submit" className="btn small primary" disabled={!v.trim()} title={`${cta} (${keys('mod', 'enter')})`}>{cta}</button>
        {onCancel && <button type="button" className="ghost-btn" onClick={onCancel}>{t('Cancel')}</button>}
      </div>
    </form>
  )
}

// AI Assist in a thread: at work (with Stop), what went wrong (and how to fix it), or a request
// that came in the file, waiting to be sent.
function Assist({ th, threads }) {
  const job = threads.jobs[th.id]
  const ask = threads.askOf(th.items)
  const stop = (e) => e.stopPropagation()
  if (job?.busy) {
    return (
      <div className="sd-thread-ai busy" role="status" onClick={stop}>
        <Icon name="wand" size={12} className="sd-thread-wand" /><span>{t('AI Assist is working…')}</span>
        <button type="button" className="ghost-btn" onClick={() => threads.stop(th.id)}>{t('Stop')}</button>
      </div>
    )
  }
  if (job?.error) {
    return (
      <div className="sd-thread-ai bad" role="alert" onClick={stop}>
        <Icon name="wand" size={12} className="sd-thread-wand" /><span>{job.error}</span>
        <div className="sd-thread-ai-acts">
          {job.code === 'no-model' && <button type="button" className="btn small" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))}>{t('Open Model Providers')}</button>}
          {ask && job.code !== 'no-request' && <button type="button" className="btn small" onClick={() => threads.ask(th.id, ask)}><Icon name="refresh" size={12} /> {t('Try again')}</button>}
          <button type="button" className="ghost-btn" onClick={() => threads.stop(th.id)}>{t('Close')}</button>
        </div>
      </div>
    )
  }
  if (ask && !ask.made && !th.done) {
    return (
      <div className="sd-thread-ai wait" onClick={stop}>
        <Icon name="wand" size={12} className="sd-thread-wand" />
        <span>{t('{name} asked @bridge in the file. It waits for you: AI Assist acts on a comment from a file only when you send it.', { name: ask.author || t('Someone') })}</span>
        <div className="sd-thread-ai-acts"><button type="button" className="btn small" onClick={() => threads.ask(th.id, ask)}><Icon name="wand" size={12} /> {t('Send to AI Assist')}</button></div>
      </div>
    )
  }
  return null
}

// AI Assist's change on a thread's words, to keep or discard: what goes, struck out, and what comes.
function Suggestion({ th, threads }) {
  const sg = threads.suggestion(th.id)
  if (!sg) return null
  return (
    <div className="sd-thread-sug" onClick={(e) => e.stopPropagation()}>
      <div className="sd-thread-sug-text" aria-label={t('The suggested change')}>{sg.del && <del>{sg.del}</del>}{sg.del && sg.ins && ' '}{sg.ins && <ins>{sg.ins}</ins>}</div>
      <div className="sd-thread-ai-acts">
        <button type="button" className="btn small primary" onClick={() => threads.settle(th.id, true)}><Icon name="check" size={12} /> {t('Keep')}</button>
        <button type="button" className="btn small" onClick={() => threads.settle(th.id, false)}>{t('Discard')}</button>
      </div>
    </div>
  )
}

function Thread({ th, threads, on, readOnly }) {
  const [confirm, setConfirm] = useState(false)
  const words = threads.wordsOf(th.id)
  const picked = threads.picked === th.id
  return (
    <li className={`sd-thread${picked ? ' on' : ''}${th.done ? ' done' : ''}`} onClick={() => !picked && threads.pick(th.id)}>
      <div className="sd-thread-top">
        <button type="button" className="sd-thread-quote" onClick={(e) => { e.stopPropagation(); threads.pick(th.id) }} title={t('Show the words it\'s on')}>
          {words ? <span>{words}</span> : <span className="muted">{t('The words it was on aren\'t in the document any more.')}</span>}
        </button>
        {on && !readOnly && (<>
          <button type="button" className="win-btn" onClick={(e) => { e.stopPropagation(); threads.resolve(th.id, !th.done) }} aria-label={th.done ? t('Open it again') : t('Resolve')} title={th.done ? t('Open it again') : t('Resolve: done with, kept in the file')}><Icon name={th.done ? 'undo' : 'check'} size={13} /></button>
          <button type="button" className="win-btn" onClick={(e) => { e.stopPropagation(); setConfirm(true) }} aria-label={t('Delete the comment')} title={t('Delete the comment')}><Icon name="trash" size={13} /></button>
        </>)}
      </div>
      {th.items.map((c, i) => (
        <div key={c.id} className={`sd-thread-entry${isAi(c) ? ' ai' : ''}`}>
          <Who c={c} onDelete={on && !readOnly && i > 0 ? () => threads.remove(c.id) : null} />
          <Words c={c} />
        </div>
      ))}
      {on && !readOnly && <Suggestion th={th} threads={threads} />}
      {on && !readOnly && <Assist th={th} threads={threads} />}
      {on && !readOnly && confirm && (
        <div className="sd-thread-confirm" role="alert" onClick={(e) => e.stopPropagation()}>
          <span>{th.items.length > 1 ? t('Delete this comment and its {n} replies?', { n: th.items.length - 1 }) : t('Delete this comment?')}</span>
          <button type="button" className="btn small danger" onClick={() => { setConfirm(false); threads.remove(th.id) }}>{t('Delete')}</button>
          <button type="button" className="ghost-btn" onClick={() => setConfirm(false)}>{t('Cancel')}</button>
        </div>
      )}
      {on && !readOnly && !th.done && (picked
        ? <Box label={t('Reply')} placeholder={t('Reply, or @bridge to ask AI Assist…')} cta={t('Reply')} send={(s) => threads.reply(th.id, s)} />
        : <div className="sd-thread-acts"><button type="button" className="link-btn small" onClick={(e) => { e.stopPropagation(); threads.pick(th.id) }}>{t('Reply')}</button></div>)}
    </li>
  )
}

// The comments beside the page: a new one's box (for the words picked), the open threads in the
// order their words come, and the resolved ones under them.
export function Threads({ threads, readOnly, onComment, onClose }) {
  const open = threads.threads.filter((x) => !x.done)
  const done = threads.threads.filter((x) => x.done)
  const [showDone, setShowDone] = useState(false)
  const on = threads.on
  const sugs = threads.suggestions()
  return (
    <aside className="sd-comments-pane sd-threads" aria-label={t('Comments')}>
      <div className="sd-pane-head"><b>{t('Comments')}</b><span className="muted small">{open.length}</span><span className="sd-grow" />
        {on && !readOnly && <button type="button" className="btn small sd-thread-add" onMouseDown={(e) => e.preventDefault()} onClick={onComment} title={`${t('Comment on the words picked')} (${keys('mod', 'alt', 'm')})`}><Icon name="plus" size={12} /> {t('Comment')}</button>}
        <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close the comments')} title={t('Close the comments')}><Icon name="x" size={13} /></button>
      </div>
      {threads.said && <p className="sd-pane-none small sd-thread-said" role="status">{threads.said}</p>}
      {on && !readOnly && sugs > 0 && (
        <div className="sd-thread-sugbar">
          <Icon name="wand" size={12} className="sd-thread-wand" /><span>{sugs === 1 ? t('1 suggestion from AI Assist') : t('{n} suggestions from AI Assist', { n: sugs })}</span><span className="sd-grow" />
          <button type="button" className="btn small" onClick={() => threads.settle(null, true)}><Icon name="check" size={12} /> {t('Keep all')}</button>
        </div>
      )}
      {threads.draft && (
        <div className="sd-thread sd-thread-new on">
          <div className="sd-thread-quote"><span>{threads.draft.text}</span></div>
          <Box label={t('Comment')} placeholder={t('Comment, or @bridge to ask AI Assist…')} cta={t('Comment')} autoFocus send={(s) => !!threads.post(s)} onCancel={threads.cancel} />
        </div>
      )}
      {!threads.threads.length && !threads.draft && !threads.said && <p className="muted small sd-pane-none">{on && !readOnly ? t('No comments yet. Pick some words, then Comment ({keys}).', { keys: keys('mod', 'alt', 'm') }) : t('No comments.')}</p>}
      <ol className="sd-thread-list">{open.map((th) => <Thread key={th.id} th={th} threads={threads} on={on} readOnly={readOnly} />)}</ol>
      {done.length > 0 && (
        <div className="sd-thread-done">
          <button type="button" className="link-btn small" onClick={() => setShowDone((x) => !x)} aria-expanded={showDone}><Icon name="check" size={12} /> {done.length === 1 ? t('1 resolved') : t('{n} resolved', { n: done.length })}</button>
          {showDone && <ol className="sd-thread-list">{done.map((th) => <Thread key={th.id} th={th} threads={threads} on={on} readOnly={readOnly} />)}</ol>}
        </div>
      )}
      <p className="muted small sd-pane-none sd-thread-foot">{t('Kept in the Word file itself, so Word shows them too.')}</p>
    </aside>
  )
}
