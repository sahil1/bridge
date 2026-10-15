import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from './Icon.jsx'
import { Terminal, FilesView, ChangesView } from '../lazy.jsx'
import Subagents from './Subagents.jsx'
import Question, { parseScreen } from './Question.jsx'
import Composer from './Composer.jsx'
import { PaneHeader } from './layout.jsx'
import { tildePath } from './Rail.jsx'
import { api, usePoll, useLive, fmtTime, openInTerminal } from '../api.js'

const KEYS = [
  ['1', '1'], ['2', '2'], ['3', '3'], ['enter', '⏎ Enter'], ['esc', 'Esc'],
  ['up', '↑'], ['down', '↓'], ['tab', 'Tab'], ['shift+tab', '⇧Tab'], ['ctrl+c', '⌃C'],
]

// Paths in chat open in the Files view of the same agent.
const PathCtx = createContext(null)
// Linkify only things that are clearly paths: a file with an extension, or a folder
// path anchored at / ~/ ./ ../  ("owner/repo" style names stay plain text).
const FILE_RE = /^(~\/|\/|\.{1,2}\/)?([\w@.+-]+\/)*[\w@+-][\w@.+-]*\.[A-Za-z][A-Za-z0-9]{0,7}$/
const DIR_RE = /^(~\/|\/|\.{1,2}\/)[\w@.+-]+(\/[\w@.+-]+)*\/?$/
function looksLikePath(s) {
  if (s.length > 240 || /\s/.test(s) || /^https?:/.test(s)) return false
  if (/^[\w-]+\.(com|org|io|ai|dev|net|app|co)(\/|$)/i.test(s)) return false // domains
  if (/^v?\d+(\.\d+)+$/.test(s)) return false // versions
  if (/^\/[\w-]+\/?$/.test(s)) return false // slash commands like /cos
  return FILE_RE.test(s) || DIR_RE.test(s)
}

function CodeSpan({ text }) {
  const openPath = useContext(PathCtx)
  if (openPath && looksLikePath(text)) {
    return <button className="path-link" onClick={() => openPath(text)} title="Open in Files"><code>{text}</code></button>
  }
  return <code>{text}</code>
}

// Minimal, safe markdown: code fences, headings, **bold** and `code`. No HTML is injected.
function Inline({ text }) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/).map((s, j) => {
    if (s.length > 2 && s.startsWith('`') && s.endsWith('`')) return <CodeSpan key={j} text={s.slice(1, -1)} />
    if (s.length > 4 && s.startsWith('**') && s.endsWith('**')) return <strong key={j}>{s.slice(2, -2)}</strong>
    return s
  })
}

const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

function Table({ rows }) {
  const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r))
  const [head, ...rest] = body.map(cells)
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead><tr>{head.map((c, i) => <th key={i}><Inline text={c} /></th>)}</tr></thead>
        <tbody>{rest.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}><Inline text={c} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

// Split prose into runs of plain lines and markdown table blocks.
function Prose({ text }) {
  const lines = text.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\|.*\|\s*$/.test(lines[i]) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const rows = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++])
      i--
      out.push(<Table key={i} rows={rows} />)
      continue
    }
    const h = lines[i].match(/^#{1,4}\s+(.*)/)
    out.push(<Fragment key={i}>{h ? <strong className="md-h"><Inline text={h[1]} /></strong> : <Inline text={lines[i]} />}{i < lines.length - 1 ? '\n' : ''}</Fragment>)
  }
  return out
}

function RichText({ text }) {
  const parts = text.split(/```[^\n]*\n?/)
  return parts.map((part, i) =>
    i % 2 === 1 ? <pre key={i} className="code">{part.replace(/\n$/, '')}</pre> : <Prose key={i} text={part} />,
  )
}

function groupMessages(messages) {
  const out = []
  for (const m of messages) {
    const last = out.at(-1)
    if (m.role === 'tool' && last?.role === 'tools') last.items.push(m)
    else if (m.role === 'tool') out.push({ role: 'tools', items: [m], ts: m.ts })
    else out.push(m)
  }
  return out
}

function ToolGroup({ items }) {
  const [open, setOpen] = useState(false)
  const names = [...new Set(items.map((t) => t.tool))]
  return (
    <div className="tool-group">
      <button className="tool-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="tool" size={12} />
        <span>{items.length === 1 ? `${items[0].tool}${items[0].hint ? ` · ${items[0].hint}` : ''}` : `${items.length} steps · ${names.join(', ')}`}</span>
        {items.length > 1 && <Icon name="chevron" size={11} className={open ? 'rot90' : ''} />}
      </button>
      {open && items.length > 1 && (
        <ul className="tool-list">{items.map((t, i) => <li key={i}><b>{t.tool}</b> {t.hint}</li>)}</ul>
      )}
    </div>
  )
}

// Claude Code rewrites attached image paths as "[Image #N]", so compare messages without
// attachment markers when matching a "sending…" bubble to the message the agent received.
// Paths on an "Attached:" line become chips; any other words there are just text.
const isPath = (w) => /^(~|\/|\.{1,2}\/)/.test(w) || /\/[^/\s]+\.\w{1,5}$/.test(w)
const splitAttached = (text) => {
  const files = []
  const body = String(text || '').replace(/(^|\n)[ \t]*Attached:[ \t]*([^\n]*)/g, (_, pre, list) => {
    const words = list.trim().split(/\s+/).filter(Boolean)
    files.push(...words.filter(isPath))
    const rest = words.filter((w) => !isPath(w)).join(' ')
    return rest ? `${pre}${rest}` : pre
  })
  return { body, files }
}
const normMsg = (t) => splitAttached(String(t || '').replace(/\[Image #\d+\]/g, '')).body.replace(/\s+/g, ' ').trim()
// The agent's copy can differ from what was sent: Claude rewrites attachments, and text already
// in its input box could get merged in. Containment covers both.
const sameMsg = (a, b) => {
  const x = normMsg(a)
  const y = normMsg(b)
  if (!x || !y) return false
  return x === y || (y.length >= 40 && x.startsWith(y.slice(0, 80))) || (x.length >= 40 && y.startsWith(x.slice(0, 80))) || (y.length >= 12 && x.includes(y))
}

// A user message with its attachments shown as chips instead of raw markers and paths.
function UserText({ text }) {
  const images = [...String(text).matchAll(/\[Image #(\d+)\]/g)].map((m) => `Image ${m[1]}`)
  const split = splitAttached(String(text).replace(/\[Image #\d+\]\s*/g, ''))
  const body = split.body.trim()
  const chips = [...images, ...split.files.map((f) => f.split('/').pop())]
  return (
    <>
      {body && <RichText text={body} />}
      {chips.length > 0 && <div className="msg-attach">{chips.map((c, i) => <span key={i} className="msg-chip"><Icon name={/\.(png|jpe?g|gif|webp|heic)$/i.test(c) || c.startsWith('Image') ? 'image' : 'file'} size={11} /> {c}</span>)}</div>}
    </>
  )
}

// While an agent works, what it's doing right now, read from its status line ("Reading files…",
// "Running tests (32s)"), so you see progress between messages instead of a bare spinner.
// eslint-disable-next-line no-control-regex
const plainText = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '')
function activityFrom(ansi) {
  const lines = plainText(ansi).split('\n').map((l) => l.trim()).filter(Boolean).slice(-16)
  const status = [...lines].reverse().find((l) => /esc to (interrupt|cancel)|ctrl\+c to (interrupt|cancel)/i.test(l))
  if (!status) return null
  return status
    .replace(/^[^\p{L}\p{N}]+/u, '') // spinner glyphs
    .replace(/\s*[·•(]?\s*(esc|ctrl\+c) to (interrupt|cancel)\)?/i, '')
    .replace(/[(·•\s]+$/, '')
    .replace(/\(\s*\)$/, '')
    .trim()
}
function LiveActivity({ paneId }) {
  const { data } = usePoll(`/agents/${encodeURIComponent(paneId)}/screen?lines=24`, 700)
  const text = activityFrom(data?.ansi)
  return (
    <div className="live-activity" aria-live="polite" aria-label="Agent is working">
      <span className="typing"><span /><span /><span /></span>
      {text && <span className="live-text">{text}</span>}
    </div>
  )
}

function Chat({ agent, pending, queued = [], onCancelQueued }) {
  const { data, error } = useLive(`/agents/${encodeURIComponent(agent.paneId)}/transcript`)
  const scrollRef = useRef(null)
  const stick = useRef(true)
  const messages = groupMessages(data?.messages || [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [data, pending, queued.length])

  const shownPending = pending.filter((p) => !(data?.messages || []).some((m) => m.role === 'user' && sameMsg(m.text, p.text)))

  if (data && !data.supported && !shownPending.length && !queued.length) {
    return (
      <div className="chat-empty">
        <Icon name={agent.chief ? 'helm' : 'chat'} size={28} />
        <p>{agent.caps?.chat
          ? agent.chief ? 'Tell it what you need. It sends the work to the right agent, starts new ones when nothing fits, and tells you when they finish.' : 'No messages yet.'
          : `Chat isn't available for ${agent.kindLabel || agent.kind} yet. Use the terminal.`}</p>
      </div>
    )
  }

  return (
    <div className="chat" ref={scrollRef} onScroll={(e) => {
      const el = e.currentTarget
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }}>
      <div className="chat-col">
        {!data && !error && <div className="skeleton-rows"><div /><div /><div /></div>}
        {error && <div className="error-text">{error}</div>}
        {messages.map((m, i) =>
          m.role === 'tools'
            ? <ToolGroup key={i} items={m.items} />
            : m.role === 'event'
            ? <div key={i} className={`chat-event ev-${m.status}`}><span className="ev-dot" />{m.text}<time>{fmtTime(m.ts)}</time></div>
            : (
              <div key={i} className={`msg ${m.role}`}>
                <div className="msg-text">{m.role === 'user' ? <UserText text={m.text} /> : <RichText text={m.text} />}</div>
                <div className="msg-time">{fmtTime(m.ts)}</div>
              </div>
            ))}
        {shownPending.map((p) => (
          <div key={p.id} className="msg user pending">
            <div className="msg-text"><UserText text={p.text} /></div>
            <div className="msg-time">{p.error ? <span className="error-text">{p.error}</span>
              : Date.now() - p.id > 30000 ? <span className="warn-text">Not in the agent's chat yet. Check the Terminal tab; ↑ in the message box brings it back to resend.</span>
              : 'sending…'}</div>
          </div>
        ))}
        {agent.status === 'working' && <LiveActivity paneId={agent.paneId} />}
        {queued.map((q) => (
          <div key={q.id} className="msg user queued">
            <div className="msg-text"><UserText text={q.text} /></div>
            <div className="msg-time">
              <Icon name="clock" size={11} /> Queued, sends when {agent.chief ? 'Chief of staff' : 'the agent'} is free
              <button className="link" onClick={() => onCancelQueued(q.id)}>Cancel</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BlockedCard({ agent, onKey, onOpenTerminal }) {
  const [busy, setBusy] = useState(false)
  const { data, refresh } = usePoll(`/agents/${encodeURIComponent(agent.paneId)}/screen?lines=60`, 900)
  const q = parseScreen(data?.ansi)
  // eslint-disable-next-line no-control-regex
  const plain = (data?.ansi || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')
  const tail = plain.split('\n').filter((l) => l.trim() && !/^[─━\s]+$/.test(l)).slice(-12).join('\n')
  const send = async (steps) => {
    setBusy(true)
    try { await api(`/panes/${encodeURIComponent(agent.paneId)}/input`, { method: 'POST', body: { steps } }) } catch { /* the screen poll shows what happened */ }
    setTimeout(() => { refresh?.(); setBusy(false) }, 450)
  }
  return (
    <div className="blocked-card" role="alert">
      <div className="blocked-head"><StatusDot status="blocked" /> {q?.kind === 'menu' || !q ? 'Waiting on you' : 'Question for you'} <button className="link" onClick={onOpenTerminal}>Open in Terminal</button></div>
      {q ? <Question q={q} send={send} busy={busy} /> : (
        <>
          <pre className="blocked-screen">{tail || 'Loading…'}</pre>
          <div className="blocked-actions">
            {['1', '2', '3'].map((k) => <button key={k} className="btn" onClick={() => onKey([k])}>{k}</button>)}
            <button className="btn primary" onClick={() => onKey(['enter'])}>Enter</button>
            <button className="btn" onClick={() => onKey(['esc'])}>Esc</button>
          </div>
        </>
      )}
    </div>
  )
}

export function MateEmpty({ onLaunch, launching, error }) {
  return (
    <div className="mate-hero">
      <div className="hero-mark"><Icon name="helm" size={30} /></div>
      <h3>No chief of staff running</h3>
      <p>Your chief of staff is the one agent you talk to. It sends each request to the agent already working on that topic, starts a new one in the right space when nothing fits, and reports back when the work is done.</p>
      <button className="btn primary" onClick={onLaunch} disabled={launching}><Icon name="helm" /> {launching ? 'Launching…' : 'Start chief of staff'}</button>
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

const VIEWS = [['chat', 'chat', 'Chat'], ['terminal', 'terminal', 'Terminal'], ['files', 'folder', 'Files'], ['changes', 'branch', 'Changes']]

function readViews() { try { return JSON.parse(localStorage.getItem('cc-agent-views') || '{}') } catch { return {} } }

export default function Console({ agent, variant = 'focus', controls = {}, onBack, onOpenInHerdr, extraActions, queued = [] }) {
  const [view, setViewRaw] = useState('chat')
  const [openPath, setOpenPath] = useState(null)
  const setView = (v) => {
    setViewRaw(v)
    try { localStorage.setItem('cc-agent-views', JSON.stringify({ ...readViews(), [agent.paneId]: v })) } catch { /* private mode */ }
  }
  const openFromChat = (raw) => {
    const home = (agent.cwd.match(/^\/Users\/[^/]+/) || [''])[0]
    let p = raw.replace(/^~(?=\/)/, home)
    if (p.startsWith(agent.cwd + '/')) p = p.slice(agent.cwd.length + 1)
    else if (p.startsWith('/')) p = p // absolute outside root: the server will say so
    p = p.replace(/^\.\//, '').replace(/\/$/, '')
    setOpenPath(p)
    setView('files')
  }
  const [pending, setPending] = useState([])
  const [flash, setFlash] = useState(null)
  const [keysOpen, setKeysOpen] = useState(false)
  const [termFocus, setTermFocus] = useState(0)
  const places = usePoll('/places', 15000)
  // The sidebar's "Browse folder" asks an open agent to switch views.
  useEffect(() => {
    const on = (e) => { if (e.detail?.paneId === agent?.paneId) { setView(e.detail.view); if (e.detail.path) setOpenPath(e.detail.path) } }
    window.addEventListener('cc-set-view', on)
    return () => window.removeEventListener('cc-set-view', on)
  })

  useEffect(() => {
    setPending([]); setFlash(null)
    const saved = agent && readViews()[agent.paneId]
    setViewRaw(saved || (agent?.caps?.chat ? 'chat' : 'terminal'))
  }, [agent?.paneId, agent?.kind])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), flash.length > 60 ? 8000 : 3000); return () => clearTimeout(t) }, [flash])
  useEffect(() => { if (agent?.status === 'blocked') setKeysOpen(true) }, [agent?.status])

  if (!agent) return null
  const pid = encodeURIComponent(agent.paneId)
  const minimized = controls.minimized

  const send = async (t, { now = false } = {}) => {
    // Busy agent: the server holds the message and sends it when the agent is free, or with
    // "send now", interrupts the agent and sends it as soon as it's back at its prompt.
    if (agent.status === 'working') {
      try {
        await api(`/agents/${pid}/${now ? 'steer' : 'queue'}`, { method: 'POST', body: { text: t } })
        if (now) setFlash('Interrupted; sending your message')
        return true
      } catch (e) { setFlash(e.message); return false }
    }
    const id = Date.now()
    setPending((p) => [...p, { id, text: t }])
    try {
      const r = await api(`/agents/${pid}/prompt`, { method: 'POST', body: { text: t } })
      if (r?.queued) {
        // Something covered the agent's input box; the server holds the message until it's back.
        setPending((p) => p.filter((x) => x.id !== id))
        setFlash(`Held, not lost: ${r.reason} in the agent. It sends once that closes (Esc in the Terminal tab closes most panels).`)
        return true
      }
      if (r?.cleared) setFlash(`Cleared "${r.cleared.length > 60 ? `${r.cleared.slice(0, 60)}…` : r.cleared}" that was already typed in the agent's input box`)
      return true
    } catch (e) {
      setPending((p) => p.filter((x) => x.id !== id))
      setFlash(e.message === 'agent_blocked' || /blocked/.test(e.message) ? 'Agent is waiting on an answer; use the keys first' : e.message)
      return false
    }
  }

  const cancelQueued = async (qid) => { try { await api(`/agents/${pid}/queue/${qid}`, { method: 'DELETE' }) } catch (e) { setFlash(e.message) } }
  const stop = async () => {
    try { await api(`/agents/${pid}/keys`, { method: 'POST', body: { keys: ['esc'] } }); setFlash('Sent Esc to interrupt') } catch (e) { setFlash(e.message) }
  }

  const sendKeys = async (keys) => {
    try { await api(`/agents/${pid}/keys`, { method: 'POST', body: { keys } }); setFlash(`Sent ${keys.join(' ')}`) } catch (e) { setFlash(e.message) }
  }

  const title = agent.chief ? 'Chief of staff' : agent.title || agent.tab || agent.workspace
  const where = agent.chief ? `${agent.kind} · routes work to your agents` : `${agent.workspace}${agent.tab && !/^\d+$/.test(agent.tab) ? ` › ${agent.tab}` : ''} · ${agent.kind}`
  const g = places.data?.[agent.cwd]
  const subtitle = (
    <>
      <span className="sub-where">{where}</span>
      <button className="path-chip" onClick={() => setView('files')} title={`${tildePath(agent.cwd)}\nClick to browse; right-click to copy`}
        onContextMenu={(e) => { e.preventDefault(); navigator.clipboard?.writeText(agent.cwd); setFlash('Path copied') }}>
        <Icon name="folder" size={10} /> <span>{tildePath(agent.cwd)}</span>
        {g && <span className="pc-git"><Icon name="branch" size={10} />{g.branch}{g.dirty > 0 && <b>+{g.dirty}</b>}</span>}
      </button>
    </>
  )

  return (
    <section className={`pane console v-${variant} ${minimized ? 'is-min' : ''}`} aria-label={`${title} console`}>
      <PaneHeader icon={agent.chief ? 'helm' : 'bot'} title={title} subtitle={subtitle} {...controls}
        leading={onBack && <button className="win-btn back" onClick={onBack} aria-label="Back"><Icon name="chevron" size={16} className="flip" /></button>}>
        <span className={`state-tag st-${agent.status}`}><StatusDot status={agent.status} size={7} />{{ blocked: 'Needs you', done: 'Done', working: 'Working', idle: 'Idle' }[agent.status] || 'Unknown'}</span>
        {!minimized && (
          <div className="seg" role="tablist">
            {VIEWS.map(([id, icon, label]) => (
              <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)} title={label}><Icon name={icon} size={14} /><span>{label}</span></button>
            ))}
          </div>
        )}
        {extraActions}
        {!minimized && (
          <button className="win-btn" onClick={async () => { try { setFlash(`Opened in ${(await openInTerminal(agent.paneId)).app}. Ctrl+] detaches there.`) } catch (e) { setFlash(e.message) } }}
            title="Open in your terminal app" aria-label="Open in your terminal app"><Icon name="terminal" size={14} /></button>
        )}
        {onOpenInHerdr && !minimized && (
          <button className="win-btn" onClick={() => onOpenInHerdr(agent.paneId)} title="Open in Herdr view" aria-label="Open in Herdr view"><Icon name="external" size={14} /></button>
        )}
      </PaneHeader>

      {!minimized && (
        <>
          <div className="console-body">
            <PathCtx.Provider value={openFromChat}>
              {view === 'chat' && <Chat agent={agent} pending={pending} queued={queued} onCancelQueued={cancelQueued} />}
            </PathCtx.Provider>
            <div className="term-wrap" hidden={view !== 'terminal'}><Terminal paneId={agent.paneId} active={view === 'terminal'} focusKey={termFocus} onChat={() => setView('chat')} /></div>
            {view === 'files' && <FilesView agent={agent} openPath={openPath} onConsumed={() => setOpenPath(null)} />}
            {view === 'changes' && <ChangesView agent={agent} onOpenFile={(p) => { setOpenPath(p); setView('files') }} />}
          </div>

          {agent.status === 'blocked' && view === 'chat' && (
            <BlockedCard agent={agent} onKey={sendKeys} onOpenTerminal={() => setView('terminal')} />
          )}

          <div className="composer-wrap" hidden={view === 'files' || view === 'changes'}>
            {agent.caps?.subagents && view === 'chat' && <Subagents paneId={agent.paneId} working={agent.status === 'working'} Rich={RichText} />}
            {keysOpen && (
              <div className="keybar" aria-label="Send keys">
                {KEYS.map(([k, label]) => <button key={k} className="key" onClick={() => sendKeys([k])}>{label}</button>)}
                {flash && <span className="flash">{flash}</span>}
              </div>
            )}
            {!keysOpen && flash && <div className="comp-note">{flash}</div>}
            <Composer id={agent.paneId} placeholder={agent.chief ? 'Tell your chief of staff what you need…' : `Message ${title}…`}
              onSend={send} keysOpen={keysOpen} onToggleKeys={() => setKeysOpen(!keysOpen)}
              busy={agent.status === 'working'} onStop={stop} queuedCount={queued.length}
              commandsUrl={agent.caps?.commands ? `/agents/${encodeURIComponent(agent.paneId)}/commands` : null}
              filesUrl={`/agents/${encodeURIComponent(agent.paneId)}/mentions`}
              historyUrl={agent.caps?.chat ? `/agents/${encodeURIComponent(agent.paneId)}/transcript` : null}
              onInteractive={() => { setView('terminal'); setTermFocus(Date.now()) }} />
          </div>
        </>
      )}
    </section>
  )
}
