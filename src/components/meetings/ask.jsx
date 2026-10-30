import { useEffect, useRef, useState } from 'react'
import { markdownHtml } from '../../markdown.js'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { day } from './bulk.jsx'
import { t } from '../../i18n/index.js'

// Asking about meetings: one meeting (its page), or several (the Meetings page: the picked ones, or
// the ones the question is likely about). The answer cites the meetings it came from as [1], [2]:
// those open the meeting. Copy takes the answer as written, for a follow-up email say.

export const md = markdownHtml
// [n] in the answer as a link to meeting n (only numbers it was given, so nothing else changes). Done
// in the cleaned answer's text, never its markup, so an [n] inside a link or picture stays as it is.
const cited = (html, sources) => {
  const box = document.createElement('template')
  box.innerHTML = html
  const walk = document.createTreeWalker(box.content, NodeFilter.SHOW_TEXT)
  const texts = []
  while (walk.nextNode()) texts.push(walk.currentNode)
  for (const node of texts) {
    const parts = node.data.split(/\[(\d{1,2})\]/)
    if (parts.length < 2) continue
    node.replaceWith(...parts.map((p, i) => {
      if (i % 2 === 0) return p
      if (!sources.some((s) => s.n === Number(p))) return `[${p}]`
      const b = document.createElement('button')
      Object.assign(b, { type: 'button', className: 'mt-cite', title: t('Open the meeting'), textContent: p })
      b.dataset.n = p
      return b
    }))
  }
  return box.innerHTML
}

function Answer({ a, onOpen }) {
  const [copied, setCopied] = useState(false)
  const sources = a.sources || []
  const open = (n) => { const s = sources.find((x) => x.n === Number(n)); if (s) onOpen?.(s.id) }
  const copy = async () => { try { await navigator.clipboard.writeText(a.a); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* not allowed */ } }
  return (
    <div className="mt-qa">
      <p className="mt-q">{a.q}</p>
      {!a.a ? <p className="muted small"><span className="aa-spin" /> {t('Thinking…')}</p> : (
        <>
          <div className={`mt-a md${a.error ? ' error-text' : ''}`} onClick={(e) => { const b = e.target.closest?.('.mt-cite'); if (b) open(b.dataset.n) }} dangerouslySetInnerHTML={{ __html: sources.length && onOpen ? cited(md(a.a), sources) : md(a.a) }} />
          {!a.error && (
            <div className="mt-a-foot">
              {sources.length > 0 && <span className="muted small">{t('From')}</span>}
              {sources.map((s) => (
                <button type="button" key={s.n} className="chip mt-source" onClick={() => onOpen?.(s.id)} title={t('Open "{title}"', { title: s.title })}>
                  <b>{s.n}</b> {s.title} · {day(s.startedAt)}
                </button>
              ))}
              <span className="mt-grow" />
              <button type="button" className="ghost-btn" onClick={copy} aria-label={t('Copy the answer')}><Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? t('Copied') : t('Copy')}</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// The answers so far, per place asked, so they're still there when you open a cited meeting and
// come back (until the page reloads).
const kept = new Map()
let asked = 0

// path: where to ask (/meetings/<id>/ask or /meetings/ask), body: what else to send (the picked
// ids). suggestions: questions to tap before anything's been asked.
export function AskPanel({ path, body, placeholder, suggestions = [], onOpen, className = '' }) {
  const [q, setQ] = useState('')
  const [answers, show] = useState(() => kept.get(path) || [])
  const here = useRef(true)
  useEffect(() => { here.current = true; return () => { here.current = false } }, [])
  const setAnswers = (v) => { const next = typeof v === 'function' ? v(kept.get(path) || []) : v; kept.set(path, next); if (here.current) show(next) }
  const ask = async (question) => {
    question = question.trim()
    if (!question) return
    const key = ++asked
    setQ('')
    setAnswers((a) => [...a, { key, q: question }])
    const put = (p) => setAnswers((a) => a.map((x) => (x.key === key ? { ...x, ...p } : x)))
    try {
      const r = await api(path, { method: 'POST', body: { ...(body || {}), question } })
      put({ a: r.answer || t('No answer came back.'), sources: r.sources })
    } catch (e) { put({ a: e.message, error: true }) }
  }
  return (
    <div className={`mt-ask ${className}`}>
      {answers.map((a) => <Answer key={a.key} a={a} onOpen={onOpen} />)}
      <form onSubmit={(e) => { e.preventDefault(); ask(q) }} className="mt-askbox">
        <Icon name="sparkle" size={14} className="muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
        <button type="submit" className="ghost-btn" disabled={!q.trim()} aria-label={t('Ask')}><Icon name="send" size={14} /></button>
      </form>
      {!answers.length && suggestions.length > 0 && (
        <div className="mt-suggest">
          {suggestions.map((s) => <button type="button" key={s} className="chip" onClick={() => ask(t(s))}>{t(s)}</button>)}
        </div>
      )}
      {answers.length > 0 && <button type="button" className="link-btn small mt-ask-clear" onClick={() => setAnswers([])}>{t('Clear')}</button>}
    </div>
  )
}
