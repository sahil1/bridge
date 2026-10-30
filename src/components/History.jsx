// History: search every agent conversation on this computer, and the agents you closed. A
// running agent opens; a closed or old one resumes with its full history (in its old space
// when that's still open).
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import AgentMark from './settings/agentMark.jsx'
import { api } from '../api.js'
import { locale } from '../i18n/index.js'

const ago = (t) => {
  const s = (Date.now() - (typeof t === 'number' ? t : Date.parse(t))) / 1000
  if (!Number.isFinite(s)) return ''
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`
  return new Date(Date.now() - s * 1000).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' })
}

// The matched words in bold.
function Snip({ text, q }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0 || !q) return <>{text}</>
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

export default function History({ onClose, onOpen }) {
  const [q, setQ] = useState('')
  const [closed, setClosed] = useState(null)
  const [found, setFound] = useState(null) // { q, results, total }
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const seq = useRef(0)

  const loadClosed = () => api('/archive').then((d) => setClosed(d.items)).catch((e) => setErr(e.message))
  useEffect(() => { loadClosed() }, [])
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setFound(null); return }
    const n = ++seq.current
    const t = setTimeout(() => api(`/search?q=${encodeURIComponent(term)}`).then((d) => { if (n === seq.current) setFound({ q: term, ...d }) }).catch((e) => setErr(e.message)), 250)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const resume = async (r, key) => {
    setBusy(key); setErr(null)
    try {
      const out = await api('/sessions/resume', { method: 'POST', body: { kind: r.kind, sessionId: r.sessionId, cwd: r.fullCwd || r.cwd, label: r.label || r.title, workspace: r.workspace } })
      onOpen(out.paneId, !out.already)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  const forget = async (x) => { try { await api(`/archive/${x.id}`, { method: 'DELETE' }); loadClosed() } catch (e) { setErr(e.message) } }
  const Act = ({ r, k }) => (r.paneId
    ? <button className="btn small" onClick={() => { onOpen(r.paneId); onClose() }}>Open</button>
    : <button className="btn small primary" onClick={() => resume(r, k)} disabled={!!busy}>{busy === k ? 'Resuming…' : 'Resume'}</button>)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal history" role="dialog" aria-label="History">
        <header className="modal-head">
          <Icon name="clock" size={16} />
          <h3>History</h3>
          <button type="button" className="win-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button>
        </header>
        <div className="hist-search">
          <Icon name="search" size={14} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every conversation: a customer, a file, an error…" aria-label="Search conversations" />
        </div>
        {err && <p className="error-text small">{err}</p>}
        <div className="hist-list">
          {found ? (
            <>
              <p className="muted small hist-sub">{found.total ? `${found.total} conversation${found.total === 1 ? '' : 's'} mention "${found.q}"${found.total > found.results.length ? `; the ${found.results.length} most recent` : ''}` : `Nothing mentions "${found.q}".`}</p>
              {found.results.map((r) => (
                <div key={r.sessionId} className="hist-item">
                  <AgentMark kind={r.kind} size={18} />
                  <div className="hist-body">
                    <div className="hist-title">{r.label || r.title || 'Conversation'}{r.paneId && <span className="hist-live">running</span>}</div>
                    <div className="muted small mono hist-where">{[r.workspace, r.cwd].filter(Boolean).join(' › ')} · {ago(r.last)}</div>
                    {r.hits.map((h, i) => <div key={i} className="hist-hit"><span className="muted small">{h.role === 'user' ? 'You' : 'Agent'}:</span> <Snip text={h.text} q={found.q} /></div>)}
                  </div>
                  <Act r={r} k={r.sessionId} />
                </div>
              ))}
            </>
          ) : (
            <>
              <p className="muted small hist-sub">{closed?.length ? 'Agents you closed. Resume one to pick up with its full history.' : closed ? 'Agents you close show up here, to resume later. Search above finds any conversation.' : 'Loading…'}</p>
              {(closed || []).map((x) => (
                <div key={x.id} className="hist-item">
                  <AgentMark kind={x.kind} size={18} />
                  <div className="hist-body">
                    <div className="hist-title">{x.label || 'Agent'}{x.paneId && <span className="hist-live">running</span>}</div>
                    <div className="muted small mono hist-where">{[x.workspace, x.cwd].filter(Boolean).join(' › ')} · closed {ago(x.closedAt)}</div>
                    {x.preview && <div className="hist-hit muted">{x.preview}</div>}
                  </div>
                  <Act r={x} k={x.id} />
                  <button className="win-btn" onClick={() => forget(x)} title="Remove from this list (the conversation stays on disk)" aria-label="Remove from list"><Icon name="x" size={12} /></button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
