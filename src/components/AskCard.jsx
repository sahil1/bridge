import { useEffect, useState } from 'react'
import { StatusDot } from './Icon.jsx'
import { api, usePoll } from '../api.js'

// A question Codex asked while it works (server/asks.js): its terminal folds it into one line and
// drops it when the turn ends, so here it's a card. One question: click an answer and it's sent.
// Several: pick or type an answer for each, then send them together, since Codex drops the rest
// once you send anything. The answer goes in as a message, which Codex takes while it works.
export default function AskCard({ agent, Rich, onOpenTerminal, onNote }) {
  const pid = encodeURIComponent(agent.paneId)
  const { data, refresh } = usePoll(`/agents/${pid}/asks`, 2000)
  const [picked, setPicked] = useState({}) // question key -> the answer chosen or typed
  const [typed, setTyped] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const qs = data?.questions || []
  const key = (q) => `${q.id}:${q.index}`
  const ids = qs.map(key).join(',')
  useEffect(() => { setPicked({}); setTyped({}); setError(null) }, [ids])
  if (!qs.length) return null
  const one = qs.length === 1
  const working = agent.asking?.working ?? data?.working

  const send = async (answers) => {
    setBusy(true); setError(null)
    try {
      const r = await api(`/agents/${pid}/asks`, { method: 'POST', body: { answers } })
      onNote?.(r.queued ? `Your answer is queued. It goes in when ${agent.kindLabel || 'Codex'}'s input box is back.` : `Sent your answer to ${agent.kindLabel || 'Codex'}.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false); refresh()
    }
  }
  const answerOf = (q) => (typed[key(q)] || '').trim() || picked[key(q)] || ''
  const ready = qs.filter((q) => answerOf(q))
  const sendAll = () => send(ready.map((q) => ({ id: q.id, index: q.index, answer: answerOf(q) })))

  return (
    <div className="blocked-card ask-card" role="alert">
      <div className="blocked-head">
        <StatusDot status="blocked" /> {one ? `${agent.kindLabel || 'Codex'} asks you` : `${agent.kindLabel || 'Codex'} asks you ${qs.length} things`}
        <span className="ask-sub">{working ? 'It keeps working meanwhile' : 'It\'s waiting for your answer'}</span>
        <button className="link" onClick={onOpenTerminal}>Open in Terminal</button>
      </div>
      <div className="qcard">
        {qs.map((q, i) => {
          const k = key(q)
          const typeIt = () => { const t = (typed[k] || '').trim(); if (t) (one ? send([{ id: q.id, index: q.index, answer: t }]) : setPicked({ ...picked, [k]: t })) }
          return (
            <div className="ask-q" key={k}>
              {!one && <div className="ask-n">{i + 1} of {qs.length}</div>}
              <div className="q-title ask-title">{Rich ? <Rich text={q.title} /> : q.title}</div>
              {q.options.length > 0 && (
                <div className="q-options">
                  {q.options.map((o, n) => (
                    <button key={n} className={`q-opt ${!one && picked[k] === o && !typed[k]?.trim() ? 'on' : ''}`} disabled={busy}
                      onClick={() => (one ? send([{ id: q.id, index: q.index, answer: o }]) : setPicked({ ...picked, [k]: o }))}>
                      <span className="q-key">{n + 1}</span>
                      <span className="q-text"><b>{o}</b>{n === 0 && q.options.length > 1 && <span>Recommended</span>}</span>
                    </button>
                  ))}
                </div>
              )}
              <form className="q-other" onSubmit={(e) => { e.preventDefault(); typeIt() }}>
                <input value={typed[k] || ''} onChange={(e) => setTyped({ ...typed, [k]: e.target.value })} disabled={busy}
                  placeholder={q.options.length ? 'Or type your own answer…' : 'Type your answer…'} aria-label={`Your answer to: ${q.title.slice(0, 80)}`} />
                {one && <button className="btn" disabled={busy || !(typed[k] || '').trim()}>Send</button>}
              </form>
            </div>
          )
        })}
        {!one && (
          <div className="q-actions">
            <button className="btn primary" disabled={busy || !ready.length} onClick={sendAll}>
              {ready.length === qs.length ? 'Send answers' : `Send ${ready.length} of ${qs.length} answers`}
            </button>
          </div>
        )}
        {!one && ready.length > 0 && ready.length < qs.length && <p className="ask-note muted">{agent.kindLabel || 'Codex'} drops the questions you don't answer once you send.</p>}
        {error && <p className="ask-note error-text">{error}</p>}
      </div>
    </div>
  )
}
