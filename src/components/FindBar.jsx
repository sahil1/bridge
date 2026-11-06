import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import Icon from './Icon.jsx'
import { keys } from './studio/keys.js'
import { listenForFind, isFindKey, isStepKey } from '../find.js'
import { t } from '../i18n/index.js'

// The bar over a chat or a terminal for finding in it (src/find.js): what to find, which match of
// how many, the one before and the next, Match case, and close. host: the element marked data-find
// that ⌘F is sent to; finder: what looks in it (find.js pageFinder, termFind.js), with search(text,
// matchCase), step(±1), clear(), seed() and onResults({ index, total, over, busy, note }).
export default function FindBar({ host, finder, label }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [res, setRes] = useState(null)
  const [asked, setAsked] = useState(0) // each ⌘F: the field gets focus, its text selected
  const input = useRef(null)
  const back = useRef(null) // what had focus before, given back on close
  const openRef = useRef(false)
  openRef.current = open

  useEffect(() => {
    if (!finder) return
    finder.onResults = setRes
    return () => { finder.onResults = null; finder.clear() }
  }, [finder])
  useEffect(() => {
    listenForFind()
    const on = (e) => {
      if (!host.current || e.target !== host.current || !finder) return
      if (e.type === 'bridge-find-step') { if (openRef.current) finder.step(e.detail?.dir || 1); return }
      const seed = finder.seed?.() || e.detail?.text || ''
      // Drawn and focused before this key or tap is over: what's typed next goes in the field, and
      // a phone's keyboard comes up.
      flushSync(() => {
        if (!openRef.current) {
          const a = document.activeElement
          back.current = a && a !== document.body ? a : null
          setOpen(true)
        }
        if (seed) setQ(seed)
        setAsked((n) => n + 1)
      })
    }
    document.addEventListener('bridge-find', on)
    document.addEventListener('bridge-find-step', on)
    return () => { document.removeEventListener('bridge-find', on); document.removeEventListener('bridge-find-step', on) }
  }, [host, finder])
  useLayoutEffect(() => { if (open && asked) { input.current?.focus({ preventScroll: true }); input.current?.select() } }, [open, asked])
  useEffect(() => { if (open) finder?.search(q, matchCase) }, [open, q, matchCase, finder])
  useEffect(() => { host.current?.toggleAttribute('data-find-open', open) }, [open, host])

  if (!open) return null
  const close = () => {
    finder?.clear()
    setOpen(false)
    setRes(null)
    const b = back.current
    back.current = null
    if (b?.isConnected) b.focus({ preventScroll: true })
  }
  const step = (dir) => finder?.step(dir)
  const onKey = (e) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Enter' && e.target === input.current) { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
    else if (isFindKey(e.nativeEvent)) { e.preventDefault(); input.current?.focus(); input.current?.select() }
    else if (isStepKey(e.nativeEvent)) { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
  }
  // Nothing typed: nothing said. Then which of how many, or that there are none.
  const total = res?.total || 0
  const count = !q || !res ? null
    : total ? (res.over && res.index < 0 ? t('More than {total} matches', { total: total.toLocaleString() }) : t('{n} of {total}', { n: res.index >= 0 ? (res.index + 1).toLocaleString() : '–', total: `${total.toLocaleString()}${res.over ? '+' : ''}` }))
      : res.busy ? t('Looking through earlier messages…') : t('No matches')
  return (
    <div className="find-bar" role="search" onKeyDown={onKey}>
      <div className="find-row">
        <Icon name="search" size={13} className="find-icon" />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={label} aria-label={label}
          autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck="false" enterKeyHint="search" />
        {count && <span className={`find-count ${q && res && !total && !res.busy ? 'none' : ''}`} role="status" aria-live="polite">{count}</span>}
        {res?.busy && total > 0 && <span className="find-busy" title={t('Looking through earlier messages…')}><Icon name="refresh" size={11} className="spin" /></span>}
        <button type="button" className="win-btn" onClick={() => step(-1)} disabled={!total} title={t('Previous match (Shift+Enter or {keys})', { keys: keys('mod', 'shift', 'g') })} aria-label={t('Previous match')}><Icon name="up" size={14} /></button>
        <button type="button" className="win-btn" onClick={() => step(1)} disabled={!total} title={t('Next match (Enter or {keys})', { keys: keys('mod', 'g') })} aria-label={t('Next match')}><Icon name="down" size={14} /></button>
        <button type="button" className={`win-btn find-case ${matchCase ? 'on' : ''}`} onClick={() => setMatchCase(!matchCase)} aria-pressed={matchCase} title={t('Match case')} aria-label={t('Match case')}>Aa</button>
        <button type="button" className="win-btn" onClick={close} title={t('Close (Esc)')} aria-label={t('Close find')}><Icon name="x" size={14} /></button>
      </div>
      {res?.note && <div className="find-note error-text">{t("Earlier messages couldn't be read, so they aren't searched: {error}", { error: res.note })}</div>}
    </div>
  )
}
