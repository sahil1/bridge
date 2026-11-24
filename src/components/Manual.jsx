import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { useMedia } from './layout.jsx'
import { markdownHtml } from '../markdown.js'
import { loadManual, findIn, topicOf } from './manualData.js'
import { t } from '../i18n/index.js'
import './manual.css'

// Help: Bridge AI's manual (shared/manual.md, made from its README and the words in Settings, and
// checked at each release), the same one Chief of Staff, your agents and your bots answer "how do
// I…" from. ⌘K's Help opens it, and so does a question typed there (Palette.jsx); on a phone, More ›
// Help. Its topics down the left (on a phone, a list, each opening full width under ‹ Help), a
// search over all of it, and a setting it names opens Settings at that setting. In English, as the
// manual is.
// at: a part to open at (its id, from ⌘K), or none.
export default function Manual({ at = null, onClose }) {
  const phone = useMedia('(max-width: 760px)')
  const [m, setM] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [topic, setTopic] = useState(null) // the topic showing (its id)
  const [list, setList] = useState(true) // on a phone: the topics, rather than one of them
  const [mark, setMark] = useState(null) // the part to bring into view in it
  const body = useRef(null)
  const load = () => { setError(null); loadManual().then(setM, (e) => setError(e.message || String(e))) }
  useEffect(load, [])
  // Opened at a part (from ⌘K): its topic, there.
  useEffect(() => {
    if (!m) return
    const part = at && m.parts.find((p) => p.id === at)
    const top = (part && topicOf(m, part)) || m.topics[0]
    setTopic(top?.id || null)
    if (part) { setList(false); setMark(part.level > 2 ? part : null) }
  }, [m, at])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest?.('input')) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const cur = m?.topics.find((x) => x.id === topic) || m?.topics[0] || null
  const html = useMemo(() => (cur ? markdownHtml(shown(cur)) : ''), [cur])
  const hits = useMemo(() => (m && q.trim().length >= 2 ? findIn(m, q, 12) : []), [m, q])
  // The part asked for, in view once its topic is drawn; the top of a topic otherwise.
  useEffect(() => {
    const el = body.current
    if (!el) return
    if (!mark) { el.scrollTop = 0; return }
    const find = [...el.querySelectorAll(mark.level === 4 ? 'a' : 'h3')].find((x) => x.textContent.trim() === mark.title)
    if (find) { find.scrollIntoView({ block: 'start' }); find.closest('li, h3')?.classList.add('mn-mark') }
  }, [html, mark])
  // A setting it names opens Settings at it.
  const openSetting = (id) => { onClose(); setTimeout(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: id } })), 0) }
  const onClick = (e) => {
    const a = e.target.closest?.('a[href^="#setting-"]')
    if (!a) return
    e.preventDefault()
    openSetting(a.getAttribute('href').slice('#setting-'.length))
  }
  const go = (part) => {
    if (part.setting) return openSetting(part.setting)
    const top = topicOf(m, part)
    setTopic(top?.id || null)
    setMark(part.level > 2 ? part : null)
    setQ('')
    setList(false)
  }
  const pick = (x) => { setTopic(x.id); setMark(null); setList(false) }

  const search = (
    <div className="mn-find">
      <Icon name="search" size={14} />
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search the manual')} aria-label={t('Search the manual')} autoFocus={!phone} spellCheck="false" />
    </div>
  )
  const found = q.trim().length >= 2 && (
    <div className="mn-hits" role="list" aria-label={t('Found in the manual')}>
      {!hits.length && <p className="muted small mn-none">{t('Nothing in the manual matches “{q}”.', { q: q.trim() })}</p>}
      {hits.map(({ part }) => (
        <button key={part.id} type="button" role="listitem" className="mn-hit" data-part={part.id} onClick={() => go(part)}>
          <b>{part.setting ? part.title : part.path.join(' › ')}</b>
          <span className="muted small">{part.setting ? t('In Settings: {where}', { where: whereOf(part) }) : plain(part.text).slice(0, 170)}</span>
        </button>
      ))}
    </div>
  )
  const topics = m && (
    <nav className="mn-topics" aria-label={t('Topics')}>
      {m.topics.map((x) => (
        <button key={x.id} type="button" className={`mn-topic${cur?.id === x.id && !(phone && list) ? ' on' : ''}`} data-topic={x.id} aria-current={cur?.id === x.id ? 'page' : undefined} onClick={() => pick(x)}>
          <span>{x.title}</span>{phone && <Icon name="chevron" size={13} className="muted" />}
        </button>
      ))}
    </nav>
  )
  const content = error ? (
    <div className="mn-cant" role="alert"><Icon name="alert" size={20} /><p><b>{t('The manual couldn\'t be opened.')}</b></p><p className="muted small">{error}</p><button type="button" className="btn small" onClick={load}><Icon name="refresh" size={12} /> {t('Try again')}</button></div>
  ) : !m ? <div className="skeleton-rows mn-wait"><div /><div /><div /></div>
    : <article className="md-view mn-page" ref={body} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />

  if (phone) {
    const showList = list && !q.trim()
    return (
      <div className="modal-backdrop manual-backdrop phone">
        <div className="modal manual phone" role="dialog" aria-label={t('Help')}>
          <header className="st-bar">
            {list ? <span /> : <button type="button" className="st-back" onClick={() => setList(true)} aria-label={t('Back to Help')}><Icon name="back" size={18} /><span>{t('Help')}</span></button>}
            <h3>{list ? t('Help') : cur?.title}</h3>
            <button type="button" className="win-btn st-close" onClick={onClose} aria-label={t('Close Help')}><Icon name="x" size={18} /></button>
          </header>
          {list ? (
            <div className="mn-scroll">
              <p className="muted small mn-lede">{t('Bridge AI\'s manual: how it works and where everything is. Chief of Staff, your agents and your bots answer "how do I…" from it too.')}</p>
              {search}
              {found || (showList && topics)}
              {!m && content}
            </div>
          ) : content}
        </div>
      </div>
    )
  }
  return (
    <div className="modal-backdrop manual-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal manual" role="dialog" aria-label={t('Help')}>
        <div className="mn-side">
          <div className="mn-title"><Icon name="help" size={15} /> {t('Help')}</div>
          {search}
          {found || topics}
        </div>
        <div className="mn-main">
          <div className="mn-bar">
            <span className="muted small">{t('Bridge AI\'s manual. Chief of Staff, your agents and your bots answer "how do I…" from it too.')}</span>
            <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close Help')}><Icon name="x" size={16} /></button>
          </div>
          {content}
        </div>
      </div>
    </div>
  )
}

// A topic as it shows: its words and the parts under it, without the words a setting is found by in
// ⌘K (those are for searching).
function shown(topic) {
  const out = [`## ${topic.title}`, '', topic.text, '']
  for (const x of topic.under) out.push(`### ${x.title}`, '', x.text, '')
  return out.join('\n').replace(/ Found by: [^\n]*\.$/gm, '')
}
const plain = (s) => String(s || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#>|]/g, '').replace(/\s+/g, ' ').trim()
// Where a setting is, as its line in the manual says it.
const whereOf = (part) => (/\): (Settings › .+?)\.(?:\s|$)/.exec(part.text)?.[1] || part.path.slice(1, -1).join(' › '))
