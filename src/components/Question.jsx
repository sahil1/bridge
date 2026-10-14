import { useState } from 'react'
import Icon from './Icon.jsx'

// Turn what a blocked agent shows (Claude's question picker, a permission prompt, any numbered
// menu) into something you can click. Claude only writes the question to its log after it's
// answered, so this reads the screen. Each click sends the same keys you'd press in a terminal.

import { parseScreen } from './questionParse.js'

export { parseScreen }

export default function Question({ q, send, busy }) {
  const [text, setText] = useState('')
  if (q.kind === 'review') {
    return (
      <div className="qcard">
        <Tabs tabs={q.tabs} send={send} />
        <div className="q-title">Review your answers</div>
        <ul className="q-review">{q.review.map((r, i) => <li key={i}><span>{r.q}</span><b>{r.a || '—'}</b></li>)}</ul>
        <div className="q-actions">
          {q.options.map((o) => <button key={o.n} className={`btn ${/submit/i.test(o.label) ? 'primary' : ''}`} disabled={busy} onClick={() => send([{ keys: [o.n] }])}>{o.label}</button>)}
          <button className="btn ghost" disabled={busy} onClick={() => send([{ keys: ['left'] }])}>Back</button>
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
      {q.title && <div className="q-title">{q.title}</div>}
      <div className={`q-options ${q.multi ? 'multi' : ''}`}>
        {q.options.map((o) => (
          <button key={o.n} className={`q-opt ${o.checked ? 'on' : ''}`} disabled={busy} onClick={() => send([{ keys: [o.n] }])}>
            <span className="q-key">{q.multi ? (o.checked ? <Icon name="check" size={12} /> : '') : o.n}</span>
            <span className="q-text"><b>{o.label}</b>{o.desc && o.desc !== o.label && <span>{o.desc}</span>}</span>
          </button>
        ))}
      </div>
      {q.other && (
        <form className="q-other" onSubmit={(e) => { e.preventDefault(); useOther() }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type your own answer…" disabled={busy} />
          <button className="btn" disabled={busy || !text.trim()}>Use this</button>
        </form>
      )}
      <div className="q-actions">
        {q.multi && <button className="btn primary" disabled={busy} onClick={() => send([{ keys: [q.tabs.length ? 'right' : 'enter'] }])}>Next</button>}
        {q.chat && <button className="btn ghost" disabled={busy} onClick={() => send([{ keys: [q.chat.n] }])}>Chat about this instead</button>}
        <button className="btn ghost" disabled={busy} onClick={() => send([{ keys: ['esc'] }])}>Cancel</button>
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
