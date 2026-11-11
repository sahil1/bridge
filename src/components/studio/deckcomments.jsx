import { useMemo, useRef, useState } from 'react'
import { t } from '../../i18n/index.js'
import { api } from '../../api.js'
import { threadsOf, AI_AUTHOR } from './wordcomments.js'
import { mentions, requestOf, askOf } from './doccomments.jsx'
import { deckComments, deckGuid } from './pptxdoc.js'

// Comments on a PowerPoint's slides, as threads (Comments and @bridge, a beta feature): a comment on
// the slide shown, or on the shape picked on it, replies, resolved and opened again, deleted, all
// written into the file as PowerPoint keeps its modern comments (pptxdoc.js), so PowerPoint shows
// them as you left them. The pane is doccomments.jsx's, with a deck's words.
//
// @bridge in a comment you write asks AI Assist (POST /api/studio/deck/comment) about that slide
// only: the shape's words (or the slide's, in Markdown), the thread so far and what you asked. Its
// reply goes in the thread, signed AI Assist with the wand and the model; what it suggests (the
// shape's words rewritten, the slide rewritten, or a new slide after it) waits in the thread, to
// Keep (an edit like any other, which undo takes back) or Discard. With no model the thread says
// how to add one; one that came in the file waits for you to send it.

const initialsOf = (name) => (name === AI_AUTHOR ? 'AI' : String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?')
const short = (s, n = 70) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x }

// doc: pptxdoc.js's; deck: what the editor has of it now ({ slides (in order), at (the one shown),
// shapePicked() (the shape id picked, or null), wordsOf(slide, shape), slideMd(slide), go(slide,
// shape), keepText(slide, shape, text), keepSlide(slide, md, how) }).
export function useDeckThreads({ doc, on, author, file, dirty, deck }) {
  const [list, setList] = useState(() => deckComments(doc).map(({ raw, ...x }) => ({ ...x, author: x.author || t('Someone') })))
  const listRef = useRef(list)
  const [picked, setPicked] = useState(null)
  const [draft, setDraft] = useState(null)
  const [said, setSaid] = useState(null)
  const [jobs, setJobs] = useState({})
  const jobsRef = useRef(jobs)
  const setJob = (id, v) => { const n = { ...jobsRef.current }; if (v) n[id] = v; else delete n[id]; jobsRef.current = n; setJobs(n) }
  const [sugs, setSugs] = useState({})
  const sugsRef = useRef(sugs)
  const setSug = (id, v) => { const n = { ...sugsRef.current }; if (v) n[id] = v; else delete n[id]; sugsRef.current = n; setSugs(n) }
  const set = (next) => { listRef.current = next; setList(next); dirty() }
  const indexOf = (key) => deck.slides.findIndex((s) => s.key === key)

  const threads = useMemo(() => threadsOf(list).map((th) => ({ ...th, at: indexOf(th.root.slide), done: !!th.root.done })).sort((a, b) => (a.at < 0 ? 1e9 : a.at) - (b.at < 0 ? 1e9 : b.at)), [list, deck.slides]) // eslint-disable-line react-hooks/exhaustive-deps
  const wordsOf = (id) => {
    const x = listRef.current.find((c) => c.id === id)
    const n = x ? indexOf(x.slide) : -1
    if (n < 0) return null
    const s = deck.slides[n]
    const w = x.shape != null ? deck.wordsOf(s, x.shape) : deck.slideTitle(s)
    return `${t('Slide {n}', { n: n + 1 })}${w ? ` · ${short(w)}` : ''}`
  }

  const start = () => {
    if (!on) return false
    const s = deck.slides[deck.at]
    if (!s) return false
    const shape = deck.shapePicked()
    const w = shape != null ? deck.wordsOf(s, shape) : deck.slideTitle(s)
    setSaid(null)
    setDraft({ slide: s.key, shape, text: `${t('Slide {n}', { n: deck.at + 1 })}${w ? ` · ${short(w)}` : ''}` })
    return true
  }
  const cancel = () => setDraft(null)
  const item = (o) => ({ id: deckGuid(), author, initials: initialsOf(author), date: new Date().toISOString(), parent: null, done: false, made: true, shape: null, ...o })
  const post = (text) => {
    const body = String(text || '').trim()
    if (!draft || !body) return null
    const c = item({ slide: draft.slide, shape: draft.shape, text: body })
    setDraft(null); setPicked(c.id)
    set([...listRef.current, c])
    return c
  }
  const reply = (rootId, text, as = author) => {
    const body = String(text || '').trim()
    const root = listRef.current.find((x) => x.id === rootId)
    if (!body || !root) return null
    const c = item({ slide: root.slide, text: body, parent: rootId, author: as, initials: initialsOf(as) })
    set([...listRef.current, c])
    return c
  }
  const postAndAsk = (text) => { const c = post(text); if (c && mentions(text)) ask(c.id, c); return c }
  const replyAndAsk = (rootId, text) => { const c = reply(rootId, text); if (c && mentions(text)) ask(rootId, c); return c }

  // ---------- AI Assist ----------
  const ask = async (rootId, c) => {
    const root = listRef.current.find((x) => x.id === rootId)
    const n = root ? indexOf(root.slide) : -1
    const request = requestOf(c.text)
    jobsRef.current[rootId]?.ctl?.abort()
    if (n < 0) { setJob(rootId, { error: t('The slide this comment was on isn\'t in the deck any more, so there\'s nothing for AI Assist to work on.') }); return }
    if (!request) { setJob(rootId, { error: t('Say what you\'d like after @bridge: "@bridge make this shorter", "@bridge add a slide on next steps", or a question.'), code: 'no-request' }); return }
    const s = deck.slides[n]
    const shapeWords = root.shape != null ? deck.wordsOf(s, root.shape) : ''
    const md = deck.slideMd(s)
    const ctl = new AbortController()
    setJob(rootId, { busy: true, ctl, by: c.id })
    const items = threadsOf(listRef.current).find((x) => x.id === rootId)?.items || []
    const thread = items.slice(0, Math.max(0, items.findIndex((x) => x.id === c.id))).map((x) => ({ who: x.author, text: x.text }))
    try {
      const r = await api('/studio/deck/comment', { method: 'POST', signal: ctl.signal, body: { request, text: shapeWords || md, shape: root.shape != null && !!shapeWords, before: shapeWords ? md : '', name: file.name, slide: n + 1, thread } })
      if (ctl.signal.aborted) return
      if (!listRef.current.some((x) => x.id === rootId)) { setJob(rootId, null); return }
      const sg = r.slide ? { kind: 'add', md: r.slide, slide: s.key } : r.change && shapeWords ? { kind: 'text', text: r.change, was: shapeWords, slide: s.key, shape: root.shape } : r.change ? { kind: 'replace', md: r.change, was: md, slide: s.key } : null
      setSug(rootId, sg)
      reply(rootId, `${r.reply}${r.by ? `\n\n${t('AI Assist · {model}', { model: r.by })}` : ''}`, AI_AUTHOR)
      setJob(rootId, null)
    } catch (e) {
      if (ctl.signal.aborted) return
      setJob(rootId, { error: e.message, code: e.code || null })
    }
  }
  const stop = (rootId) => { jobsRef.current[rootId]?.ctl?.abort(); setJob(rootId, null) }
  const settle = (rootId, keep) => {
    const ids = rootId ? [rootId] : Object.keys(sugsRef.current)
    for (const id of ids) {
      const sg = sugsRef.current[id]
      if (!sg) continue
      if (keep) {
        if (sg.kind === 'text') deck.keepText(sg.slide, sg.shape, sg.text)
        else {
          const key = deck.keepSlide(sg.slide, sg.md, sg.kind === 'add' ? 'after' : 'replace')
          // The slide rewritten is a new one: its comments go with it.
          if (sg.kind === 'replace' && key) set(listRef.current.map((x) => (x.slide === sg.slide ? { ...x, slide: key, shape: null } : x)))
        }
      }
      setSug(id, null)
    }
  }
  const suggestion = (rootId) => {
    const sg = sugs[rootId]
    if (!sg) return null
    if (sg.kind === 'text') return { del: short(sg.was, 400), note: sg.text }
    const title = /^#\s+(.+)$/m.exec(sg.md)?.[1] || short(sg.md, 60)
    return { note: sg.kind === 'add' ? t('A new slide after this one: {title}', { title }) : t('This slide rewritten: {title}', { title }) }
  }
  const suggestions = () => Object.keys(sugs).length
  const resolve = (rootId, done) => { set(listRef.current.map((x) => (x.id === rootId || x.parent === rootId ? { ...x, done } : x))); if (done && picked === rootId) setPicked(null) }
  const remove = (id) => {
    const gone = new Set([id, ...listRef.current.filter((x) => x.parent === id).map((x) => x.id)])
    setSug(id, null); stop(id)
    set(listRef.current.filter((x) => !gone.has(x.id)))
    if (gone.has(picked)) setPicked(null)
  }
  const pick = (id) => {
    setPicked(id)
    const x = listRef.current.find((c) => c.id === id)
    if (x && indexOf(x.slide) >= 0) deck.go(x.slide, x.shape)
  }
  // For the writer (writePptx's threads): every comment on a slide still in the deck.
  const save = () => listRef.current.filter((x) => indexOf(x.slide) >= 0).map(({ id, slide, shape, author, date, text, parent, done }) => ({ id, slide, shape, author, date, text, parent, done: !!done }))
  return {
    list, threads, picked, pick, draft, start, cancel, post: postAndAsk, reply: replyAndAsk, resolve, remove, wordsOf, said, setSaid, on,
    jobs, ask, stop, settle, suggestion, suggestions, askOf, save,
    count: list.filter((x) => !x.parent && !x.done && indexOf(x.slide) >= 0).length,
  }
}
