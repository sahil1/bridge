import { createContext, Fragment, useContext, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from './Icon.jsx'
import { Terminal, FilesView, ChangesView, PreviewView } from '../lazy.jsx'
import Subagents from './Subagents.jsx'
import ChiefTasks from './ChiefTasks.jsx'
import ChiefThreads from './ChiefThreads.jsx'
import Question, { parseScreen } from './Question.jsx'
import AskCard from './AskCard.jsx'
import FirstRunCard, { showsFirstRun } from './FirstRun.jsx'
import { InstallAgentButton } from './SignIn.jsx'
import Composer from './Composer.jsx'
import ModelChip, { heldWhy } from './ModelChip.jsx'
import Lightbox from './Lightbox.jsx'
import { addAccount } from './AddAccount.jsx'
import { leftOf, nameOf } from './AccountMenu.jsx'
import CloudConsole from './CloudConsole.jsx'
import { PaneHeader } from './layout.jsx'
import { tildePath, Menu } from './Rail.jsx'
import { api, usePoll, useLive, fmtTime, openInTerminal, useOutbox, relayOutbox, BASE } from '../api.js'
import AskOutLoud from '../voice/AskOutLoud.jsx'
import { t, tx } from '../i18n/index.js'
import { whiteboards, isMermaid, boardFromMermaid } from './whiteboard/links.js'

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
    return <button className="path-link" onClick={() => openPath(text)} title={t('Open in Files')}><code>{text}</code></button>
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
    i % 2 === 1 ? <Fragment key={i}><pre className="code">{part.replace(/\n$/, '')}</pre>{whiteboards && isMermaid(part) && <MermaidBoard text={part} />}</Fragment> : <Prose key={i} text={part} />,
  )
}

// A diagram in Mermaid, opened as a whiteboard of shapes to move and edit.
function MermaidBoard({ text }) {
  const [busy, setBusy] = useState(false)
  return <button type="button" className="btn small wb-open-mermaid" disabled={busy} onClick={() => { setBusy(true); boardFromMermaid(text, t('Diagram from a chat')).catch((e) => window.alert(e.message)).finally(() => setBusy(false)) }}><Icon name="shapes" size={12} /> {t('Open as a whiteboard')}</button>
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
        <span>{items.length === 1 ? `${items[0].tool}${items[0].hint ? ` · ${items[0].hint}` : ''}` : t('{n} steps · {names}', { n: items.length, names: names.join(', ') })}</span>
        {items.length > 1 && <Icon name="chevron" size={11} className={open ? 'rot90' : ''} />}
      </button>
      {open && items.length > 1 && (
        <ul className="tool-list">{items.map((t, i) => <li key={i}><b>{t.tool}</b> {t.hint}</li>)}</ul>
      )}
    </div>
  )
}

// "[Request interrupted by user]" isn't a new message from you: what follows carries on the same reply.
const opensReply = (m) => m.role === 'user' && !/^\[Request interrupted/.test(m.text || '')

// The replies that changed files, by the index of each one's last part: the index of your message
// that started it (-1 when that's further back than Chat has loaded) and its edit steps.
function replyEdits(messages) {
  const out = new Map()
  let from = -1, last = -1, items = []
  const close = () => { if (items.length) out.set(last, { from, items }) }
  messages.forEach((m, i) => {
    if (opensReply(m)) { close(); from = i; items = []; return }
    last = i
    if (m.role === 'tools') items.push(...m.items.filter((t) => t.changes?.length))
  })
  close()
  return out
}

// What a reply changed: "Changed 3 files" under it, opening to each file with that reply's own
// diff. It comes from the agent's edits in its transcript, so other work in the folder doesn't mix in.
function ReplyChanges({ items, paneId, cwd, onUndo }) {
  const openPath = useContext(PathCtx)
  const [open, setOpen] = useState(false)
  const [got, setGot] = useState(null) // { files } or { error }
  const [undoing, setUndoing] = useState(false)
  const calls = items.map((t) => t.call).join(',')
  useEffect(() => {
    if (!open) return
    let live = true
    api(`/agents/${encodeURIComponent(paneId)}/transcript/diffs?calls=${encodeURIComponent(calls)}`).then((r) => live && setGot(r), (e) => live && setGot({ error: e.message }))
    return () => { live = false }
  }, [open, calls, paneId])
  const files = new Map()
  for (const c of items.flatMap((t) => t.changes)) {
    const f = files.get(c.path) || files.set(c.path, { path: c.path, add: 0, del: 0 }).get(c.path)
    f.add += c.add
    f.del += c.del
  }
  const all = [...files.values()]
  const sum = (k) => all.reduce((n, f) => n + f[k], 0)
  const rel = (p) => (p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p)
  return (
    <div className="reply-changes">
      <div className="rc-bar">
        <button className="tool-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="file" size={12} />
          <span>{all.length === 1 ? t('Changed {name}', { name: rel(all[0].path).split('/').pop() }) : t('Changed {n} files', { n: all.length })}</span>
          <span className="chg-n"><span className="plus">+{sum('add')}</span><span className="minus">−{sum('del')}</span></span>
          <Icon name="chevron" size={11} className={open ? 'rot90' : ''} />
        </button>
        {onUndo && <button className="msg-edit-btn rc-undo" disabled={undoing} onClick={async () => { setUndoing(true); try { await onUndo() } finally { setUndoing(false) } }}
          title={t('Put the files and the chat back to just before the message that started this reply')}><Icon name="undo" size={11} /> {undoing ? t('Undoing…') : t('Undo this reply')}</button>}
      </div>
      {open && (
        <div className="rc-files">
          {all.map((f) => {
            const d = got?.files?.find((x) => x.path === f.path)
            return (
              <div key={f.path} className="rc-file">
                <div className="rc-head">
                  <button className="path-link" onClick={() => openPath?.(f.path)} title={t('Open in Files')}><code>{rel(f.path)}</code></button>
                  <span className="chg-n"><span className="plus">+{f.add}</span><span className="minus">−{f.del}</span></span>
                </div>
                {d ? (
                  <div className="rc-diff">
                    <pre className="diff-view">
                      {d.lines.map((l, i) => <div key={i} className={`dl ${l.startsWith('@@') ? 'hunk' : l[0] === '+' ? 'plus' : l[0] === '-' ? 'minus' : ''}`}>{l === '@@' ? '⋯' : l || ' '}</div>)}
                      {d.cut > 0 && <div className="dl meta">{t('{n} more lines not shown; open the file to see it all', { n: d.cut })}</div>}
                    </pre>
                  </div>
                ) : <div className="rc-note muted small">{got?.error || (got ? t('No diff found for this file') : t('Loading…'))}</div>}
              </div>
            )
          })}
        </div>
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
// Claude turns an attached image path into "[Image #3]" and "[Image: source: /path]"; the image itself is shown separately.
const IMAGE_MARK = /\[Image (?:#\d+|: source: [^\]\n]+)\]\s*/g
// Claude Code wraps text you pasted in <pasted_content> tags; show the text alone.
const PASTE_TAG = /<\/?pasted_content\b[^>]*>\n?/g
const normMsg = (t) => splitAttached(String(t || '').replace(IMAGE_MARK, '').replace(PASTE_TAG, '')).body.replace(/\s+/g, ' ').trim()
// The agent's copy can differ from what was sent: Claude rewrites attachments, and text already
// in its input box could get merged in. Containment covers both.
const sameMsg = (a, b) => {
  const x = normMsg(a)
  const y = normMsg(b)
  if (!x || !y) return false
  return x === y || (y.length >= 40 && x.startsWith(y.slice(0, 80))) || (x.length >= 40 && y.startsWith(x.slice(0, 80))) || (y.length >= 12 && x.includes(y))
}

// A user message with its attachments shown as chips instead of raw markers and paths.
const IMG = /\.(png|jpe?g|gif|webp)$/i
const uploadUrl = (p) => `${BASE}/api/upload/raw?path=${encodeURIComponent(p)}`
// Your message, with what you attached still there to look at: images as thumbnails that open
// full size (pasted into the agent, read back from its transcript; or attached here), other
// files as chips that open them.
function UserText({ text, images = [], paneId }) {
  const [view, setView] = useState(null) // index into pics
  const split = splitAttached(String(text).replace(IMAGE_MARK, '').replace(PASTE_TAG, ''))
  const body = split.body.trim()
  const pics = [
    ...images.map((im) => ({ src: `${BASE}/api/agents/${encodeURIComponent(paneId)}/image?uuid=${encodeURIComponent(im.uuid)}&i=${im.i}`, name: t('Pasted image') })),
    ...split.files.filter((f) => IMG.test(f)).map((f) => ({ src: uploadUrl(f), name: f.split('/').pop() })),
  ].map((p, k, all) => ({ ...p, name: all.length > 1 ? t('Image {n} · {name}', { n: k + 1, name: p.name }) : p.name }))
  // "[Image #2]" with no image we can show (sent before Bridge AI kept them): a plain chip.
  const lost = images.length ? [] : [...String(text).matchAll(/\[Image #(\d+)\]/g)].map((m) => t('Image {n}', { n: m[1] }))
  const others = split.files.filter((f) => !IMG.test(f))
  return (
    <>
      {body && <RichText text={body} />}
      {pics.length > 0 && (
        <div className="msg-pics">
          {pics.map((p, i) => <button key={i} className="msg-pic" onClick={() => setView(i)} title={t('{name} (click to view)', { name: p.name })}><img src={p.src} alt={p.name} loading="lazy" />{pics.length > 1 && <span className="pic-num">{i + 1}</span>}</button>)}
        </div>
      )}
      {(others.length > 0 || lost.length > 0) && (
        <div className="msg-attach">
          {others.map((f) => <a key={f} className="msg-chip" href={uploadUrl(f)} target="_blank" rel="noreferrer" title={f}><Icon name="file" size={11} /> {f.split('/').pop()}</a>)}
          {lost.map((c) => <span key={c} className="msg-chip"><Icon name="image" size={11} /> {c}</span>)}
        </div>
      )}
      {view != null && <Lightbox pics={pics} at={view} onAt={setView} onClose={() => setView(null)} />}
    </>
  )
}

// While an agent works, what it's doing right now, read from its status line ("Reading files…",
// "Running tests (32s)"), so you see progress between messages instead of a bare spinner.
// eslint-disable-next-line no-control-regex
const plainText = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '')
function activityFrom(ansi) {
  const lines = plainText(ansi).split('\n').map((l) => l.trim()).filter(Boolean).slice(-16)
  const status = [...lines].reverse().find((l) => /esc to (interrupt|cancel)|ctrl\+c to (interrupt|cancel)/i.test(l) || /^[✻✳✶✢✽·*]\s+[A-Z][\w'-]*…/.test(l))
  if (!status) return null
  return status
    .replace(/^[^\p{L}\p{N}]+/u, '') // spinner glyphs
    .replace(/\s*[·•(]?\s*(esc|ctrl\+c) to (interrupt|cancel)\)?/i, '')
    .replace(/[(·•\s]+$/, '')
    .replace(/\(\s*\)$/, '')
    .replace(/\(([^()]*)$/, '($1)') // Codex: "Working (4s • esc to interrupt)"
    .trim()
}
function LiveActivity({ paneId }) {
  const { data } = usePoll(`/agents/${encodeURIComponent(paneId)}/screen?lines=24`, 700)
  const text = activityFrom(data?.ansi)
  return (
    <div className="live-activity" aria-live="polite" aria-label={t('Agent is working')}>
      <span className="typing"><span /><span /><span /></span>
      {text && <span className="live-text">{text}</span>}
    </div>
  )
}

function Chat({ agent, pending, queued = [], outbox = [], onCancelQueued, onEdit, onUndo, editingText, onOpenTerminal, accounts }) {
  const { data, error } = useLive(`/agents/${encodeURIComponent(agent.paneId)}/transcript`)
  const scrollRef = useRef(null)
  const stick = useRef(true)
  // Older messages, loaded on request: Chat starts with the end of the agent's log, which after
  // long work and a few /compacts holds only the latest part of the conversation.
  const [older, setOlder] = useState({ messages: [], more: undefined, busy: false, error: null })
  useEffect(() => { setOlder({ messages: [], more: undefined, busy: false, error: null }) }, [agent.paneId])
  const more = older.more === undefined ? data?.more : older.more
  const anchor = useRef(null) // scroll height before older messages went in above
  const loadEarlier = async () => {
    if (!more || older.busy) return
    setOlder((o) => ({ ...o, busy: true, error: null }))
    try {
      const r = await api(`/agents/${encodeURIComponent(agent.paneId)}/transcript/earlier?before=${more.before}${more.after ? `&after=${encodeURIComponent(more.after)}` : ''}`)
      anchor.current = scrollRef.current?.scrollHeight ?? null
      setOlder((o) => ({ messages: [...r.messages, ...o.messages], more: r.more, busy: false, error: null }))
    } catch (e) { setOlder((o) => ({ ...o, busy: false, error: e.message })) }
  }
  const recent = data?.messages || []
  const recentIds = new Set(recent.map((m) => m.id).filter(Boolean))
  const all = [...older.messages.filter((m) => !m.id || !recentIds.has(m.id)), ...recent]
  const messages = groupMessages(all)
  // Edit goes back through the agent's own rewind, which reaches only since its last /compact.
  const editFrom = messages.findLastIndex((m) => m.summary != null) + 1
  // Undo this reply uses the same rewind, so the same limit, and only while the agent is idle.
  const replies = replyEdits(messages)
  const canUndo = !!onUndo && agent.status !== 'working' && agent.status !== 'blocked'

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (anchor.current != null) { el.scrollTop += el.scrollHeight - anchor.current; anchor.current = null; return }
    if (stick.current) el.scrollTop = el.scrollHeight
  }, [data, pending, queued.length, outbox.length, older.messages.length])

  const shownPending = pending.filter((p) => !(data?.messages || []).some((m) => m.role === 'user' && sameMsg(m.text, p.text)))
  // Sent from the phone while your computer was offline: once delivered and in the chat, the
  // message there says so instead.
  const inChat = (o) => o.kind === 'say' && o.state === 'delivered' && recent.some((m) => m.role === 'user' && sameMsg(m.text, o.text))
  const delivered = outbox.filter(inChat)
  const shownOutbox = outbox.filter((o) => !inChat(o))
  const fromPhone = (m) => m.role === 'user' && delivered.some((o) => sameMsg(m.text, o.text))

  // No chat to show, or none yet (a new session): say so rather than leave the space blank.
  const nothing = data && (!data.supported || (!recent.length && !more && !isWorking(agent)))
  // A new agent still on its first-run screens (sign-in and so on): walk through them here.
  const firstRun = showsFirstRun(agent) && <FirstRunCard agent={agent} onOpenTerminal={onOpenTerminal} />
  if (nothing && !shownPending.length && !queued.length && !shownOutbox.length) {
    if (firstRun) return <div className="chat-empty firstrun-wrap">{firstRun}</div>
    if (agent.status === 'blocked') return null // its question card, below, says what's needed
    return (
      <div className="chat-empty">
        <Icon name={agent.chief ? 'helm' : 'chat'} size={28} />
        <p>{agent.caps?.chat
          ? agent.chief ? t('Tell it what you need. It sends the work to the right agent, starts new ones when nothing fits, and tells you when they finish.')
            : !agent.sessionId && data && !data.supported ? t('No messages here yet. Once it has started a conversation, it shows up here; the terminal always has everything.') : t('No messages yet.')
          : t("Chat isn't available for {name} yet. Use the terminal.", { name: agent.kindLabel || agent.kind })}</p>
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
        {more && (
          <div className="chat-earlier">
            <button className="ghost-btn" onClick={loadEarlier} disabled={older.busy}><Icon name={older.busy ? 'refresh' : 'up'} size={12} className={older.busy ? 'spin' : ''} /> {older.busy ? t('Loading…') : t('Show earlier messages')}</button>
            {older.error && <span className="error-text small">{older.error}</span>}
          </div>
        )}
        {data && !more && older.messages.length > 0 && <div className="chat-earlier muted small">{t('Start of the conversation')}</div>}
        {messages.flatMap((m, i) => { const k = m.id || m.items?.[0]?.id || i; const r = replies.get(i); return [(
          m.role === 'tools'
            ? <ToolGroup key={k} items={m.items} />
            : m.role === 'event'
            ? m.summary
              ? <details key={k} className="chat-summary"><summary className={`chat-event ev-${m.status}`}><span className="ev-dot" />{m.text}<time>{fmtTime(m.ts)}</time><Icon name="chevron" size={10} className="sum-caret" /></summary><div className="chat-summary-body"><RichText text={m.summary} /></div></details>
              : <div key={k} className={`chat-event ev-${m.status}`}><span className="ev-dot" />{m.text}<time>{fmtTime(m.ts)}</time></div>
            : (
              <div key={k} className={`msg ${m.role} ${editingText && m.role === 'user' && m.text === editingText ? 'editing' : ''} ${fromPhone(m) ? 'from-phone' : ''}`}>
                <div className="msg-text">{m.role === 'user' ? <UserText text={m.text} images={m.images} paneId={agent.paneId} /> : <RichText text={m.text} />}</div>
                <div className="msg-time">
                  {fmtTime(m.ts)}
                  {fromPhone(m) && <span className="msg-sent"><Icon name="check" size={11} /> {t('Delivered from your phone')}</span>}
                  {m.role === 'user' && onEdit && i >= editFrom && <button className="msg-edit-btn" onClick={() => onEdit({ original: m.text, back: messages.slice(i).filter((x) => x.role === 'user').length })}
                    aria-label={t('Edit this message')} title={t('Edit and resend: the agent goes back to this point')}><Icon name="edit" size={11} /> {t('Edit')}</button>}
                </div>
              </div>
            )),
          // Under a reply's last part: what it changed in files, and Undo (back through the agent's
          // rewind). Keyed by your message, so it stays open while the reply grows.
          r && <ReplyChanges key={`chg-${messages[r.from]?.id || r.from}`} items={r.items} paneId={agent.paneId} cwd={agent.cwd}
            onUndo={canUndo && r.from >= 0 && r.from >= editFrom ? () => onUndo({ id: messages[r.from].id, original: messages[r.from].text, back: messages.slice(r.from).filter(opensReply).length }) : null} />,
        ] })}
        {shownPending.map((p) => (
          <div key={p.id} className="msg user pending">
            <div className="msg-text"><UserText text={p.text} paneId={agent.paneId} /></div>
            <div className="msg-time">{p.error ? <span className="error-text">{p.error}</span>
              : Date.now() - p.id > 30000 ? <span className="warn-text">{t("Not in the agent's chat yet. Check the Terminal tab; ↑ in the message box brings it back to resend.")}</span>
              : t('sending…')}</div>
          </div>
        ))}
        {shownOutbox.map((o) => (
          <div key={o.id} className={`msg user outbox ${o.state}`}>
            <div className="msg-text">{o.kind === 'answer' ? t('Answer: {text}', { text: o.text }) : <UserText text={o.text} paneId={agent.paneId} />}</div>
            <div className="msg-time">
              <Icon name={o.state === 'waiting' ? 'clock' : o.state === 'delivered' ? 'check' : 'x'} size={11} /> {o.status}
              {o.state !== 'delivered' && relayOutbox && <button className="link" onClick={() => relayOutbox.dismiss(o.id)}>{o.state === 'waiting' ? t('Cancel') : t('Dismiss')}</button>}
            </div>
          </div>
        ))}
        {data?.limit && !isWorking(agent) && <LimitCard agent={agent} limit={data.limit} accounts={accounts} />}
        {isWorking(agent) && <LiveActivity paneId={agent.paneId} />}
        {firstRun}
        {queued.map((q) => (
          <div key={q.id} className="msg user queued">
            <div className="msg-text"><UserText text={q.text} paneId={agent.paneId} /></div>
            <div className="msg-time">
              <Icon name="clock" size={11} /> {agent.chief ? t('Queued, sends when Chief of Staff is free') : t('Queued, sends when the agent is free')}
              <button className="link" onClick={() => onCancelQueued(q.id)}>{t('Cancel')}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Stopped at a usage limit (its log says so, until it replies again): when that resets, whether
// it carries on by itself then, and the other accounts it can carry on with now. accounts:
// { others, onContinue } for an agent that can move (Claude Code, Codex), once they're read.
// The limits agents name most, as whole sentences in your language; any other is named as the agent said it.
const LIMIT_IN = { session: tx('{name} hit its session limit'), weekly: tx('{name} hit its weekly limit') }
function LimitCard({ agent, limit, accounts }) {
  const kindName = agent.kindLabel || agent.kind
  // All but those known to be out too.
  const room = (accounts?.others || []).filter((x) => !(x.usable && x.percentRemaining === 0))
  return (
    <div className="chat-limit" role="status">
      <div className="cl-head"><Icon name="clock" size={14} /><b>{limit.window ? (LIMIT_IN[limit.window] ? t(LIMIT_IN[limit.window], { name: kindName }) : t('{name} hit its {window} limit', { name: kindName, window: limit.window })) : t('{name} hit its usage limit', { name: kindName })}</b>{limit.resets && <span>{t('Resets {time}', { time: limit.resets })}</span>}</div>
      <p>{limit.auto ? t('It carries on by itself at {time}.', { time: limit.auto })
        : !limit.resets ? t("It won't carry on by itself.")
        : accounts ? t("It won't carry on by itself. Send it a message once it resets, or carry on with another account now.") : t("It won't carry on by itself. Send it a message once it resets.")}</p>
      {accounts && (room.length > 0
        ? <div className="cl-acts">{room.map((x) => {
          const l = leftOf(x)
          return <button key={x.id} className="btn" onClick={() => accounts.onContinue(x)}><Icon name="users" size={13} /> {l ? t('Continue now on {name} · {pct}% left', { name: nameOf(x), pct: l.pct }) : t('Continue now on {name}', { name: nameOf(x) })}</button>
        })}</div>
        : accounts.others.length > 0
          ? <p className="muted small">{t('Your other {name} accounts are out of usage too.', { name: kindName })}</p>
          : <div className="cl-acts"><button className="ghost-btn" onClick={() => addAccount(agent.kind)}><Icon name="plus" size={13} /> {t('Add another {name} account to carry on with', { name: kindName })}</button></div>)}
    </div>
  )
}

// Working, also under a question it asked while working (it shows as needing you then).
const isWorking = (a) => a.status === 'working' || !!a.asking?.working

function BlockedCard({ agent, onKey, onOpenTerminal }) {
  const [busy, setBusy] = useState(false)
  const { data, refresh } = usePoll(`/agents/${encodeURIComponent(agent.paneId)}/screen?lines=60`, 900)
  const q = parseScreen(data?.ansi)
  // eslint-disable-next-line no-control-regex
  const plain = (data?.ansi || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')
  const tail = plain.split('\n').filter((l) => l.trim() && !/^[─━\s]+$/.test(l)).slice(-12).join('\n')
  const send = async (steps, picked) => {
    setBusy(true)
    // Which question it answers, and what you picked: with your computer offline, the phone keeps
    // the answer for it, and it's only given if the same question is still waiting.
    const label = picked || steps.map((st) => st.text || (st.keys || []).map((k) => q?.options.find((o) => o.n === k)?.label || k).join(' ')).join(', ')
    // A menu without numbers is answered with arrows from where its pointer is: that has to match too.
    const expect = q && { title: q.title || '', ask: q.ask || [], options: q.options.map((o) => o.label), ...(q.arrows ? { at: q.at } : {}) }
    try { await api(`/panes/${encodeURIComponent(agent.paneId)}/input`, { method: 'POST', body: { steps, ...(expect ? { expect, label } : {}) } }) } catch { /* the screen poll shows what happened */ }
    setTimeout(() => { refresh?.(); setBusy(false) }, 450)
  }
  return (
    <div className="blocked-card" role="alert">
      <div className="blocked-head"><StatusDot status="blocked" /> {q?.kind === 'menu' || !q ? t('Waiting on you') : t('Question for you')} <button className="link" onClick={onOpenTerminal}>{t('Open in Terminal')}</button></div>
      {agent.setup === 'trust' && <p className="blocked-why">{t('{name} asks whether you trust the files in this folder. If you say yes, it can read and change them; say no to stop it.', { name: agent.kindLabel || t('The agent') })}</p>}
      {q ? <Question q={q} send={send} busy={busy} /> : (
        <>
          <pre className="blocked-screen">{tail || t('Loading…')}</pre>
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

export function MateEmpty({ onLaunch, launching, error, code }) {
  // Its agent isn't installed: install it here, and the chief starts once it's there.
  const missing = code?.startsWith('install:') ? code.slice(8) : null
  return (
    <div className="mate-hero">
      <div className="hero-mark"><Icon name="helm" size={30} /></div>
      <h3>{t('No chief of staff running')}</h3>
      <p>{t('Your chief of staff is the one agent you talk to. It sends each request to the agent already working on that topic, starts a new one in the right space when nothing fits, and reports back when the work is done.')}</p>
      <button className="btn primary" onClick={onLaunch} disabled={launching}><Icon name="helm" /> {launching ? t('Launching…') : t('Start Chief of Staff')}</button>
      {error && <p className={missing ? 'muted' : 'error-text'}>{error}</p>}
      {missing && <InstallAgentButton kind={missing} label={t('Install it')} onCheck={onLaunch} />}
    </div>
  )
}

const VIEWS = [['chat', 'chat', tx('Chat')], ['terminal', 'terminal', tx('Terminal')], ['files', 'folder', tx('Files')], ['changes', 'branch', tx('Changes')], ['preview', 'play', tx('Preview')]]

function readViews() { try { return JSON.parse(localStorage.getItem('cc-agent-views') || '{}') } catch { return {} } }
// Show an agent's Chat, where its question card is (opening a "needs you" notification).
export function showChat(paneId) {
  try { localStorage.setItem('cc-agent-views', JSON.stringify({ ...readViews(), [paneId]: 'chat' })) } catch { /* private mode */ }
  setTimeout(() => window.dispatchEvent(new CustomEvent('cc-set-view', { detail: { paneId, view: 'chat' } })), 60)
}

// Cloud agents (Cursor, Copilot, Jules, Claude in their own cloud) have a view of their own.
export default function Console(props) {
  return props.agent?.cloud ? <CloudConsole {...props} Rich={RichText} /> : <AgentConsole {...props} />
}

// agents and onThread (the chief of staff): the fleet's agents for its thread bar, and how to show
// another thread in its place.
function AgentConsole({ agent, variant = 'focus', simple = false, controls = {}, onBack, onOpenInHerdr, onPopOut, extraActions, queued = [], agents, onThread }) {
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
  const [btw, setBtw] = useState(null) // a /btw side question and its answer
  // Editing a sent message: it goes into the message box; sending it rewinds the agent to just
  // before it. { original, back, undoFiles }, and prefill puts the text in the box.
  const [editTarget, setEditTarget] = useState(null)
  const [prefill, setPrefill] = useState(null)
  // After Undo this reply: the message it went back to, offered to edit and send again.
  const [undone, setUndone] = useState(null)
  useEffect(() => { setEditTarget(null); setUndone(null) }, [agent?.paneId])
  const [keysOpen, setKeysOpen] = useState(false)
  const [termFocus, setTermFocus] = useState(0)
  const [menu, setMenu] = useState(false)
  const outbox = useOutbox(agent?.paneId)
  const places = usePoll('/places', 15000)
  // Continue on another account: Claude Code and Codex, once there's a conversation to resume.
  const movable = (agent?.kind === 'claude' || agent?.kind === 'codex') && !!agent?.sessionId
  const quota = usePoll('/quota', 5 * 60 * 1000, { enabled: movable })
  const accts = quota.data?.accounts?.find((g) => g.kind === agent?.kind)?.accounts || []
  // Not the one it's on (one started outside Bridge AI is taken to be on your usual login, which
  // may be off the list, and then every listed one is another).
  const others = movable ? accts.filter((x) => x.id !== (agent.accountId || `${agent.kind}-default`)) : []
  // The account it's on, in the header, when it isn't your usual login (as in the sidebar).
  const onAccount = agent?.account || null
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
  // Its first-run screens have their own card (FirstRun.jsx), so no raw keys for those.
  const firstRunNow = showsFirstRun(agent)
  useEffect(() => { if (agent?.status === 'blocked' && !agent.asking && !firstRunNow) setKeysOpen(true) }, [agent?.status, !!agent?.asking, firstRunNow]) // eslint-disable-line react-hooks/exhaustive-deps

  // In the Terminal tab, what you type below shows up live in the agent's own input line (only
  // the difference is sent: backspaces, then new text). Sending replaces that line with your
  // message as usual, so nothing doubles up. Only while the input box is showing (not a menu).
  const mirrored = useRef('')
  const mirrorTimer = useRef(null)
  const mirrorOn = view === 'terminal' && !!agent?.caps?.inputBox && agent?.status !== 'blocked'
  const draftNow = useRef('')
  const syncMirror = useCallback(() => {
    clearTimeout(mirrorTimer.current)
    mirrorTimer.current = setTimeout(() => {
      const want = mirrorOn ? draftNow.current : ''
      const have = mirrored.current
      if (want === have || !agent) return
      const a = Array.from(have)
      const b = Array.from(want)
      let p = 0
      while (p < a.length && p < b.length && a[p] === b[p]) p++
      const steps = []
      if (a.length > p) steps.push({ keys: Array(a.length - p).fill('backspace') })
      b.slice(p).join('').split('\n').forEach((part, i) => { if (i) steps.push({ keys: ['shift+enter'] }); if (part) steps.push({ text: part }) })
      mirrored.current = want
      // Not typed when a picker or menu covers the input box; it catches up on the next change.
      if (steps.length) api(`/panes/${encodeURIComponent(agent.paneId)}/input`, { method: 'POST', body: { steps, atPrompt: true } })
        .then((r) => { if (r?.notAtPrompt && mirrored.current === want) mirrored.current = have }).catch(() => {})
    }, 120)
  }, [mirrorOn, agent?.paneId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { syncMirror() }, [mirrorOn]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(mirrorTimer.current), [])
  useEffect(() => { mirrored.current = '' }, [agent?.paneId])

  if (!agent) return null
  const pid = encodeURIComponent(agent.paneId)
  const minimized = controls.minimized

  // review: a review from the Changes tab, always a new message (never the edit you have open).
  const send = async (text, { now = false, review = false } = {}) => {
    // Whatever was mirrored is replaced by this send (the agent's box is cleared first).
    clearTimeout(mirrorTimer.current)
    const wasMirrored = mirrored.current
    mirrored.current = ''
    draftNow.current = ''
    setUndone(null)
    if (editTarget && !review) {
      const ok = await editSent({ ...editTarget, text })
      if (ok) setEditTarget(null)
      return ok
    }
    // A side question (/btw): answered in a panel, not the chat; shown here as a card.
    if (agent.caps?.btw && /^\/btw\s/.test(text)) {
      setBtw({ q: text.replace(/^\/btw\s+/, ''), a: null })
      try {
        const r = await api(`/agents/${pid}/prompt`, { method: 'POST', body: { text } })
        if (r?.queued) { setBtw(null); setFlash(t('Held, not lost: {reason} in the agent.', { reason: heldWhy(r.reason) })); return true }
        setBtw({ q: text.replace(/^\/btw\s+/, ''), a: r?.btw || t('No answer came back. Check the Terminal tab.') })
        return true
      } catch (e) { setBtw(null); setFlash(e.message); return false }
    }
    // Busy agent: agents that take messages while they work (typeAhead) get it straight away, as
    // if typed in their terminal. Others: the server holds it and sends it when the agent is free.
    // "Send now" interrupts the agent and sends it as soon as it's back at its prompt.
    if (agent.status === 'working' && (now || !agent.caps?.typeAhead)) {
      try {
        await api(`/agents/${pid}/${now ? 'steer' : 'queue'}`, { method: 'POST', body: { text } })
        if (now) setFlash(t('Interrupted; sending your message'))
        return true
      } catch (e) { setFlash(e.message); return false }
    }
    const id = Date.now()
    setPending((p) => [...p, { id, text }])
    try {
      const r = await api(`/agents/${pid}/prompt`, { method: 'POST', body: { text } })
      // Your computer is offline: it waits for it (the phone shows how it's doing).
      if (r?.offline) { setPending((p) => p.filter((x) => x.id !== id)); return true }
      if (r?.queued) {
        // Something covered the agent's input box; the server holds the message until it's back.
        setPending((p) => p.filter((x) => x.id !== id))
        setFlash(t('Held, not lost: {reason} in the agent. It sends once that closes (Esc in the Terminal tab closes most panels).', { reason: heldWhy(r.reason) }))
        return true
      }
      if (r?.cleared && r.cleared !== wasMirrored.trim()) setFlash(t('Cleared "{text}" that was already typed in the agent\'s input box', { text: r.cleared.length > 60 ? `${r.cleared.slice(0, 60)}…` : r.cleared }))
      return true
    } catch (e) {
      setPending((p) => p.filter((x) => x.id !== id))
      setFlash(e.message === 'agent_blocked' || /blocked/.test(e.message) ? t('Agent is waiting on an answer; use the keys first') : e.message)
      return false
    }
  }

  // Edit a message you sent: the agent rewinds to just before it and gets the new text instead.
  const editSent = async ({ original, back, text, undoFiles }) => {
    try {
      await api(`/agents/${pid}/rewind`, { method: 'POST', body: { original, back, text, undoFiles } })
      setFlash(undoFiles ? t('Rewound (files too) and sent your edit') : t('Rewound and sent your edit'))
      return true
    } catch (e) { setFlash(e.message); return false }
  }
  // Undo a reply: the files and the chat go back to just before the message that started it,
  // through the agent's own rewind. Nothing is sent; the message is offered back to edit.
  const undoReply = async ({ id, original, back }) => {
    const short = original.length > 80 ? `${original.slice(0, 80)}…` : original
    const later = back > 2 ? `\n\n${t('Your {n} later messages and their replies go too.', { n: back - 1 })}` : back === 2 ? `\n\n${t('Your later message and its reply go too.')}` : ''
    if (!window.confirm(`${t('Undo this reply?')}\n\n${t('The files and the chat go back to just before "{text}". Nothing is sent to the agent.', { text: short })}${later}\n\n${t('Files changed by commands it ran (not by its edits) stay as they are.')}`)) return
    try {
      const r = await api(`/agents/${pid}/undo`, { method: 'POST', body: { id, original, back } })
      setEditTarget(null)
      setUndone({ text: original, files: r.files })
    } catch (e) { setFlash(e.message) }
  }
  const cancelQueued = async (qid) => { try { await api(`/agents/${pid}/queue/${qid}`, { method: 'DELETE' }) } catch (e) { setFlash(e.message) } }
  const stop = async () => {
    try { await api(`/agents/${pid}/keys`, { method: 'POST', body: { keys: ['esc'] } }); setFlash(t('Sent Esc to interrupt')) } catch (e) { setFlash(e.message) }
  }

  const sendKeys = async (keys) => {
    try { await api(`/agents/${pid}/keys`, { method: 'POST', body: { keys } }); setFlash(t('Sent {keys}', { keys: keys.join(' ') })) } catch (e) { setFlash(e.message) }
  }
  const mute = async (on) => {
    try { await api(`/agents/${pid}/mute`, { method: 'POST', body: { muted: on } }); setFlash(on ? t('Muted: no notifications from this agent until you unmute it') : t('Notifications are back on for this agent')) } catch (e) { setFlash(e.message) }
  }
  const canFork = !!(agent?.caps?.fork && agent?.sessionId)
  const fork = async () => {
    try {
      const r = await api(`/agents/${pid}/fork`, { method: 'POST' })
      setFlash(t('Forked into a new tab next to this one'))
      setTimeout(() => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: r.paneId } })), 1200)
    } catch (e) { setFlash(e.message) }
  }
  const inTerminal = async () => { try { setFlash(t('Opened in {app}. Ctrl+] detaches there.', { app: (await openInTerminal(agent.paneId)).app })) } catch (e) { setFlash(e.message) } }
  // nudge: it stopped at its usage limit, so it's told to carry on once it's back.
  const continueOn = async (x, { nudge = false } = {}) => {
    if (!window.confirm(`${t('Continue this conversation on {name}?', { name: nameOf(x) })}\n\n${nudge ? t('The agent stops and starts again signed in as {name}, with the same conversation, and is told to carry on from where it stopped.', { name: nameOf(x) }) : t('The agent stops and starts again signed in as {name}, with the same conversation.', { name: nameOf(x) })}`)) return
    try {
      const r = await api(`/agents/${pid}/continue`, { method: 'POST', body: { account: x.id, ...(nudge ? { nudge: true } : {}) } })
      setTimeout(() => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: r.paneId } })), 1200)
    } catch (e) { setFlash(e.message) }
  }

  const title = agent.chief ? t('Chief of Staff') : agent.title || agent.tab || agent.workspace
  const kindName = agent.kindLabel || agent.kind
  const where = agent.chief ? (agent.thread && !agent.thread.main ? t('{name} thread · {kind}', { name: agent.thread.name, kind: kindName }) : t('{kind} · sends work to your agents', { kind: kindName })) : `${agent.workspace}${agent.tab && !/^\d+$/.test(agent.tab) ? ` › ${agent.tab}` : ''} · ${kindName}`
  const g = places.data?.[agent.cwd]
  // The account it's on, in the message box's model chip, whose menu continues the conversation on
  // another one: there when there's another to go to, or it isn't on your usual login.
  const curId = agent.accountId || `${agent.kind}-default`
  const curAcct = onAccount || nameOf(accts.find((x) => x.id === curId)) || null
  // On your usual login after you took it off the list: still the one ticked, above the listed ones.
  const listWith = accts.some((x) => x.id === curId) ? accts : [{ id: curId, label: curAcct || t('Your usual login'), usable: false, status: 'pending', signedIn: true, windows: [] }, ...accts]
  const account = (onAccount || others.length > 0) ? { label: curAcct || t('Your usual login'), current: curId, list: others.length ? listWith : [], onContinue: continueOn } : null
  const subtitle = (
    <>
      <span className="sub-where">{where}</span>
      {/* The chief's and the chats' folders are Bridge AI's own: nothing to browse there. */}
      {!agent.chief && !agent.plainChat && (
        <button className="path-chip" onClick={() => setView('files')} title={`${tildePath(agent.cwd)}\n${t('Click to browse; right-click to copy')}`}
          onContextMenu={(e) => { e.preventDefault(); navigator.clipboard?.writeText(agent.cwd); setFlash(t('Path copied')) }}>
          <Icon name="folder" size={10} /> <span>{tildePath(agent.cwd)}</span>
          {g && <span className="pc-git"><Icon name="branch" size={10} />{g.branch}{g.dirty > 0 && <b>+{g.dirty}</b>}</span>}
        </button>
      )}
    </>
  )

  return (
    <section className={`pane console v-${variant} ${minimized ? 'is-min' : ''}`} aria-label={t('{name} console', { name: title })}>
      <PaneHeader icon={agent.chief ? 'helm' : 'bot'} title={title} subtitle={subtitle} {...controls}
        leading={onBack && <button className="win-btn back" onClick={onBack} aria-label={t('Back')}><Icon name="chevron" size={16} className="flip" /></button>}>
        <span className={`state-tag st-${agent.status}`}><StatusDot status={agent.status} size={7} />{{ blocked: t('Needs you'), done: t('Done'), working: t('Working'), idle: t('Idle') }[agent.status] || t('Unknown')}</span>
        {agent.muted && <span className="muted-tag" role="img" title={t('Notifications muted (⋯ to unmute)')} aria-label={t('Notifications muted')}><Icon name="bell-off" size={13} /></span>}
        {!minimized && (
          <div className="seg" role="tablist" data-tour="views">
            {/* A plain chat has no project; on the simple layout, neither has the chief of staff to show */}
            {VIEWS.filter(([id]) => !((agent.plainChat || (simple && agent.chief)) && (id === 'files' || id === 'changes' || id === 'preview'))).map(([id, icon, label]) => (
              <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} data-tour={id === 'changes' ? 'changes' : undefined} onClick={() => setView(id)} title={t(label)}><Icon name={icon} size={14} /><span>{t(label)}</span></button>
            ))}
          </div>
        )}
        {extraActions}
        {/* On a phone these two go in ⋯, so the header fits. */}
        {!minimized && canFork && variant !== 'mobile' && (
          <button className="win-btn" title={t('Fork: a copy of this conversation in a new tab, to try another way (this one stays as it is)')} aria-label={t('Fork this conversation')} onClick={fork}><Icon name="split" size={14} /></button>
        )}
        {!minimized && variant !== 'mobile' && (
          <button className="win-btn" onClick={inTerminal} title={t('Open in your terminal app')} aria-label={t('Open in your terminal app')}><Icon name="terminal" size={14} /></button>
        )}
        {onPopOut && !minimized && (
          <button className="win-btn" onClick={onPopOut} title={t('Open in its own window (bring it back from there)')} aria-label={t('Open in its own window')}><Icon name="popout" size={14} /></button>
        )}
        {onOpenInHerdr && !minimized && (
          <button className="win-btn" onClick={() => onOpenInHerdr(agent.paneId)} title={t('Open in Herdr view')} aria-label={t('Open in Herdr view')}><Icon name="external" size={14} /></button>
        )}
        {!minimized && (
          <span className="menu-anchor">
            <button className="win-btn" onClick={() => setMenu(!menu)} title={t('More')} aria-label={t('More actions')}><Icon name="more" size={14} /></button>
            {menu && <Menu onClose={() => setMenu(false)} items={[
              variant === 'mobile' && canFork && { icon: 'split', label: t('Fork this conversation'), run: fork },
              variant === 'mobile' && { icon: 'terminal', label: t('Open in the computer\'s terminal app'), run: inTerminal },
              agent.muted
                ? { icon: 'bell', label: t('Unmute notifications'), run: () => mute(false) }
                : { icon: 'bell-off', label: t('Mute notifications'), run: () => mute(true) },
            others.length > 0 && '-',
            ...others.map((x) => ({ icon: 'users', label: x.usable && x.percentRemaining != null ? t('Continue on {name} ({pct}% left)', { name: nameOf(x), pct: x.percentRemaining }) : t('Continue on {name}', { name: nameOf(x) }), run: () => continueOn(x) }))]} />}
          </span>
        )}
      </PaneHeader>

      {!minimized && (
        <>
          {agent.chief && agents && onThread && <ChiefThreads agent={agent} agents={agents} onSwitch={onThread} onNote={setFlash} />}
          <div className="console-body">
            <PathCtx.Provider value={openFromChat}>
              {view === 'chat' && <Chat agent={agent} pending={pending} queued={queued} outbox={outbox} onCancelQueued={cancelQueued} onEdit={agent.caps?.rewind ? (t) => { setEditTarget({ ...t, undoFiles: false, canUndoFiles: agent.kind === 'claude' }); setPrefill({ text: t.original, n: Date.now() }) } : null}
                onUndo={agent.caps?.undo ? undoReply : null} editingText={editTarget?.original} onOpenTerminal={() => setView('terminal')}
                accounts={movable && quota.data ? { others, onContinue: (x) => continueOn(x, { nudge: true }) } : null} />}
            </PathCtx.Provider>
            <div className="term-wrap" hidden={view !== 'terminal'}><Terminal paneId={agent.paneId} active={view === 'terminal'} focusKey={termFocus} onChat={() => setView('chat')} /></div>
            {view === 'files' && <FilesView agent={agent} openPath={openPath} onConsumed={() => setOpenPath(null)} onMention={(p) => setPrefill({ text: /\s/.test(p) ? `@"${p}" ` : `@${p} `, add: true, append: true, n: Date.now() })} />}
            {view === 'changes' && <ChangesView key={agent.paneId} agent={agent} onOpenFile={(p) => { setOpenPath(p); setView('files') }}
              onSendReview={async (t) => { const ok = await send(t, { review: true }); setView(agent.caps?.chat ? 'chat' : 'terminal'); return ok }} />}
            {view === 'preview' && <PreviewView agent={agent} onSendToAgent={({ text, files }) => { setView('chat'); setPrefill({ text, files, append: true, n: Date.now() }) }} />}
          </div>

          {agent.asking && view === 'chat' && <AskCard agent={agent} Rich={RichText} onNote={setFlash} onOpenTerminal={() => setView('terminal')} />}
          {agent.status === 'blocked' && !agent.asking && view === 'chat' && !showsFirstRun(agent) && !outbox.some((o) => o.kind === 'answer' && o.state === 'waiting') && (
            <BlockedCard agent={agent} onKey={sendKeys} onOpenTerminal={() => setView('terminal')} />
          )}

          <div className="composer-wrap" data-tour="composer" hidden={view === 'files' || view === 'changes' || view === 'preview' || (view === 'chat' && showsFirstRun(agent))}>
            {agent.chief && view === 'chat' && <ChiefTasks agent={agent} onOpenPath={(p) => { setOpenPath(p); setView('files') }} />}
            {agent.caps?.subagents && view === 'chat' && <Subagents paneId={agent.paneId} working={agent.status === 'working'} Rich={RichText} />}
            {agent.asking && view === 'terminal' && (
              <div className="ask-strip" role="status">
                <StatusDot status="blocked" />
                <span className="ask-strip-text"><b>{t('{name} asks you:', { name: agent.kindLabel })}</b> {agent.asking.title}</span>
                <button className="btn small primary" onClick={() => setView('chat')}>{t('Answer')}</button>
              </div>
            )}
            {keysOpen && (
              <div className="keybar" aria-label={t('Send keys')}>
                {KEYS.map(([k, label]) => <button key={k} className="key" onClick={() => sendKeys([k])}>{label}</button>)}
                {flash && <span className="flash">{flash}</span>}
              </div>
            )}
            {!keysOpen && flash && <div className="comp-note">{flash}</div>}
            {undone && view === 'chat' && (
              <div className="edit-bar undone-bar" role="status">
                <Icon name="undo" size={12} />
                <span>{undone.files ? t('Reply undone. The files and the chat are back to before your message.') : t('The chat is back to before your message. The agent had no file changes to restore.')}</span>
                <button className="link-btn" onClick={() => { setPrefill({ text: undone.text, append: true, add: true, n: Date.now() }); setUndone(null) }}>{t('Edit and send again')}</button>
                <button className="win-btn" onClick={() => setUndone(null)} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={12} /></button>
              </div>
            )}
            {btw && view === 'chat' && (
              <div className="btw-card" role="status">
                <div className="btw-head"><Icon name="chat" size={12} /><span>{t('Side question')}</span><button className="win-btn" onClick={() => setBtw(null)} aria-label={t('Close side answer')} title={t('Close')}><Icon name="x" size={12} /></button></div>
                <div className="btw-q">{btw.q}</div>
                <div className="btw-a">{btw.a ? <RichText text={btw.a} /> : <span className="muted"><Icon name="refresh" size={11} className="spin" /> {t('Thinking…')}</span>}</div>
              </div>
            )}
            {/* The Chief of Staff: ask it out loud, and hear the answer (voice/AskOutLoud.jsx). */}
            {agent.chief && view === 'chat' && <AskOutLoud agent={agent} onSend={send} />}
            <Composer id={agent.paneId} placeholder={agent.chief ? t('Tell your chief of staff what you need…') : t('Message {name}…', { name: title })}
              onSend={send} keysOpen={keysOpen} onToggleKeys={() => setKeysOpen(!keysOpen)}
              busy={isWorking(agent)} typeAhead={!!agent.caps?.typeAhead}
              prefill={prefill} editing={editTarget} onEditChange={(e) => setEditTarget(e)}
              mirroring={mirrorOn} onDraft={(t) => { draftNow.current = t; if (mirrorOn || mirrored.current) syncMirror() }} onStop={stop} queuedCount={queued.length}
              commandsUrl={agent.caps?.commands ? `/agents/${encodeURIComponent(agent.paneId)}/commands` : null}
              filesUrl={`/agents/${encodeURIComponent(agent.paneId)}/mentions`}
              historyUrl={agent.caps?.chat ? `/agents/${encodeURIComponent(agent.paneId)}/transcript` : null}
              tools={<ModelChip agent={agent} account={account} onNote={setFlash} onSent={() => { mirrored.current = ''; syncMirror() }} />}
              onInteractive={() => { setView('terminal'); setTermFocus(Date.now()) }} />
          </div>
        </>
      )}
    </section>
  )
}
