import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { t, locale } from '../../i18n/index.js'
import { usePoll } from '../../api.js'
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

// The comments' list and what's done to it, for a Word file's editor. on: whether comments can be
// written here (the beta feature, and the file not read-only); author: the name they're signed
// with; dirty(): the file now has changes to save. save(w, put): the comment parts written
// (writeDocx's more).
export function useThreads({ editor, model, on, author, dirty }) {
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
  useEffect(() => { mark({}) }, [list, mark])
  // The file's comments as the page's tooltips have them (wordschema.js), kept as they are now.
  useEffect(() => { model.comments.clear(); for (const c of list) model.comments.set(c.id, { author: c.author, date: c.date, initials: c.initials, text: c.text }) }, [list, model])
  const change = (next) => { listRef.current = next; setList(next); dirty() }
  const tr = () => editor.state.tr.setMeta('addToHistory', false)

  const threads = useMemo(() => {
    const pos = (th) => { let p = Infinity; for (const c of th.items) { const a = anchors.get(c.id); if (a) p = Math.min(p, a.cs ?? a.cr ?? Infinity) } return p }
    return threadsOf(list).map((th) => ({ ...th, at: pos(th), done: !!th.root.done })).sort((a, b) => a.at - b.at)
  }, [list, anchors])
  const wordsOf = (id) => {
    const a = anchors.get(id)
    if (!a || a.cs == null || a.ce == null || a.ce <= a.cs) return null
    return editor.state.doc.textBetween(a.cs + 1, a.ce, '\n', ' ').trim()
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
  // A reply: a comment of its own, its marks beside its thread's, as Word puts a reply's.
  const reply = (rootId, text) => {
    const body = String(text || '').trim()
    if (!body) return null
    const c = newComment({ list: listRef.current, used, author, text: body, parent: rootId })
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
    list, threads, picked, pick, draft, start, cancel, post, reply, resolve, remove, wordsOf, said, setSaid, on,
    skip: (id) => hide.current.has(id),
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
const isAi = (c) => c.author === AI_AUTHOR

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

// A box to write in: a comment, or a reply. ⌘↩ sends it, Esc leaves it.
function Box({ label, placeholder, send, onCancel, autoFocus, cta }) {
  const [v, setV] = useState('')
  const go = (e) => { e?.preventDefault(); const s = v.trim(); if (!s) return; if (send(s) !== false) setV('') }
  return (
    <form className="sd-thread-box" onSubmit={go} onClick={(e) => e.stopPropagation()}>
      <textarea value={v} onChange={(e) => setV(e.target.value)} rows={v.includes('\n') || v.length > 40 ? 3 : 1} autoFocus={autoFocus} aria-label={label} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(e); else if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel() } }} />
      <div className="sd-thread-box-acts">
        <button type="submit" className="btn small primary" disabled={!v.trim()} title={`${cta} (${keys('mod', 'enter')})`}>{cta}</button>
        {onCancel && <button type="button" className="ghost-btn" onClick={onCancel}>{t('Cancel')}</button>}
      </div>
    </form>
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
          <span className="sd-comment-text">{c.text}</span>
        </div>
      ))}
      {on && !readOnly && confirm && (
        <div className="sd-thread-confirm" role="alert" onClick={(e) => e.stopPropagation()}>
          <span>{th.items.length > 1 ? t('Delete this comment and its {n} replies?', { n: th.items.length - 1 }) : t('Delete this comment?')}</span>
          <button type="button" className="btn small danger" onClick={() => { setConfirm(false); threads.remove(th.id) }}>{t('Delete')}</button>
          <button type="button" className="ghost-btn" onClick={() => setConfirm(false)}>{t('Cancel')}</button>
        </div>
      )}
      {on && !readOnly && !th.done && (picked
        ? <Box label={t('Reply')} placeholder={t('Reply…')} cta={t('Reply')} send={(s) => threads.reply(th.id, s)} />
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
  return (
    <aside className="sd-comments-pane sd-threads" aria-label={t('Comments')}>
      <div className="sd-pane-head"><b>{t('Comments')}</b><span className="muted small">{open.length}</span><span className="sd-grow" />
        {on && !readOnly && <button type="button" className="btn small sd-thread-add" onMouseDown={(e) => e.preventDefault()} onClick={onComment} title={`${t('Comment on the words picked')} (${keys('mod', 'alt', 'm')})`}><Icon name="plus" size={12} /> {t('Comment')}</button>}
        <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close the comments')} title={t('Close the comments')}><Icon name="x" size={13} /></button>
      </div>
      {threads.said && <p className="sd-pane-none small sd-thread-said" role="status">{threads.said}</p>}
      {threads.draft && (
        <div className="sd-thread sd-thread-new on">
          <div className="sd-thread-quote"><span>{threads.draft.text}</span></div>
          <Box label={t('Comment')} placeholder={t('Comment…')} cta={t('Comment')} autoFocus send={(s) => !!threads.post(s)} onCancel={threads.cancel} />
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
