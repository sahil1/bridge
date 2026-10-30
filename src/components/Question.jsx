import { useState } from 'react'
import Icon from './Icon.jsx'
import { t } from '../i18n/index.js'

// Turn what a blocked agent shows (Claude's question picker, a permission prompt, any numbered
// menu) into something you can click. Claude only writes the question to its log after it's
// answered, so this reads the screen. Each click sends the same keys you'd press in a terminal.

import { parseScreen } from './questionParse.js'

// A menu's question ("Do you want to make this edit to cart.js?") sits just above it: its last line
// that asks something, without what's in the box above it. A menu without numbers may run on
// past its "?" ("…one you trust? (Like your own code…"): up to the "?".
function asked(q) {
  if (q.kind !== 'menu') return ''
  const lines = [...(q.ask || [])].reverse()
  return lines.find((l) => /\?\s*$/.test(l)) || (q.arrows && lines.map((l) => /^(.*?\?)\s/.exec(l)?.[1]).find(Boolean)) || ''
}

// The keys for an answer: its number, or in a menu without numbers, the arrows to it and Enter.
function pickKeys(q, o) {
  if (!q.arrows) return [{ keys: [o.n] }]
  const d = o.i - Math.max(0, q.at)
  return [...(d ? [{ keys: Array(Math.abs(d)).fill(d > 0 ? 'down' : 'up') }] : []), { keys: ['enter'] }]
}

export { parseScreen }

export default function Question({ q, send, busy }) {
  const [text, setText] = useState('')
  if (q.kind === 'review') {
    return (
      <div className="qcard">
        <Tabs tabs={q.tabs} send={send} />
        <div className="q-title">{t('Review your answers')}</div>
        <ul className="q-review">{q.review.map((r, i) => <li key={i}><span>{r.q}</span><b>{r.a || '—'}</b></li>)}</ul>
        <div className="q-actions">
          {q.options.map((o) => <button key={o.n} className={`btn ${/submit/i.test(o.label) ? 'primary' : ''}`} disabled={busy} onClick={() => send([{ keys: [o.n] }])}>{o.label}</button>)}
          <button className="btn ghost" disabled={busy} onClick={() => send([{ keys: ['left'] }])}>{t('Back')}</button>
        </div>
      </div>
    )
  }
  const useOther = () => {
    if (!text.trim() || !q.other) return
    // Pick "Type something", type the answer, confirm. A checkbox list then waits for Next.
    send([{ keys: [q.other.n] }, { text: text.trim() }, ...(q.multi ? [] : [{ keys: ['enter'] }])])
    setText('')
  }
  return (
    <div className="qcard">
      <Tabs tabs={q.tabs} send={send} />
      {(q.title || asked(q)) && <div className="q-title">{q.title || asked(q)}</div>}
      <div className={`q-options ${q.multi ? 'multi' : ''}`}>
        {q.options.map((o) => (
          <button key={o.n ?? o.i} className={`q-opt ${o.checked ? 'on' : ''}`} disabled={busy} onClick={() => send(pickKeys(q, o), o.label)}>
            <span className="q-key">{q.multi ? (o.checked ? <Icon name="check" size={12} /> : '') : o.n ?? o.i + 1}</span>
            <span className="q-text"><b>{o.label}</b>{o.desc && o.desc !== o.label && <span>{o.desc}</span>}</span>
          </button>
        ))}
      </div>
      {q.other && (
        <form className="q-other" onSubmit={(e) => { e.preventDefault(); useOther() }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Or type your own answer…')} disabled={busy} />
          <button className="btn" disabled={busy || !text.trim()}>{t('Use this')}</button>
        </form>
      )}
      <div className="q-actions">
        {q.multi && <button className="btn primary" disabled={busy} onClick={() => send([{ keys: [q.tabs.length ? 'right' : 'enter'] }])}>{t('Next')}</button>}
        {q.chat && <button className="btn ghost" disabled={busy} onClick={() => send([{ keys: [q.chat.n] }])}>{t('Chat about this instead')}</button>}
        <button className="btn ghost" disabled={busy} onClick={() => send([{ keys: ['esc'] }])}>{t('Cancel')}</button>
      </div>
    </div>
  )
}

function Tabs({ tabs, send }) {
  if (!tabs?.length) return null
  const at = tabs.findIndex((t) => t.active)
  return (
    <div className="q-tabs">
      {tabs.map((t, i) => (
        <button key={t.label} className={`q-tab ${t.active ? 'on' : ''} ${t.done ? 'done' : ''}`}
          onClick={() => { if (at >= 0 && i !== at) send([{ keys: Array(Math.abs(i - at)).fill(i > at ? 'right' : 'left') }]) }}>
          {t.submit ? <Icon name="send" size={11} /> : t.done ? <Icon name="check" size={11} /> : <span className="q-tab-dot" />}{t.label}
        </button>
      ))}
    </div>
  )
}
