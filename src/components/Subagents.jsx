import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { usePoll } from '../api.js'
import { usePersisted } from './layout.jsx'
import { t, tx } from '../i18n/index.js'

// What the agent has going on in the background, live, in a tray that sits on the message box at
// the same width: its subagents, the shells it left running and its monitors, one row each with
// what it's doing now. Open a row for more: a subagent's steps, brief and report; a shell's
// command and latest output; a monitor's latest news.
const LABEL = { running: tx('Running'), done: tx('Done'), failed: tx('Failed'), killed: tx('Stopped'), stopped: tx('Stopped'), ended: tx('Ended') }
const label = (s) => (LABEL[s] ? t(LABEL[s]) : s)
const KIND = { agent: [tx('{n} subagent'), tx('{n} subagents')], shell: [tx('{n} shell'), tx('{n} shells')], monitor: [tx('{n} monitor'), tx('{n} monitors')] }
const ICON = { agent: 'layers', shell: 'terminal', monitor: 'eye' }
const since = (iso) => {
  if (!iso) return ''
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
const ago = (iso) => { const time = since(iso); return !time || /^\d+s$/.test(time) ? t('just now') : t('{time} ago', { time }) }
const lastLine = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean).pop() || ''
const exitCode = (summary) => /exit code (\d+)/.exec(summary || '')?.[1]
const counted = (n, kind) => t(KIND[kind][n === 1 ? 0 : 1], { n })
const listed = (parts) => (parts.length < 2 ? parts.join('') : t('{list} and {last}', { list: parts.slice(0, -1).join(', '), last: parts.at(-1) }))
const tally = (rows) => listed(['agent', 'shell', 'monitor'].map((k) => [rows.filter((r) => r.kind === k).length, k]).filter(([n]) => n).map(([n, k]) => counted(n, k)))

// What a row says it's doing now: { tool, text, code }
function doing(it) {
  if (it.kind === 'shell') { const l = lastLine((it.output || []).join('\n')); return { text: l || t('No output yet'), code: !!l } }
  if (it.kind === 'monitor') return { text: lastLine(it.event) || t('Watching, nothing yet') }
  if (it.fromScreen) return { tool: it.type, text: it.description }
  const last = it.steps.at(-1)
  if (!last) return { text: t('Starting…') }
  return last.kind === 'tool' ? { tool: last.tool, text: last.hint, code: true } : { text: last.text.split('\n')[0] }
}
function finished(it) {
  const code = exitCode(it.summary)
  if (it.kind === 'agent') return `${label(it.status)} · ${t('{n} steps', { n: it.tools })}`
  return `${label(it.status)}${code != null ? ` · ${t('exit code {code}', { code })}` : ''}`
}

// Output, kept scrolled to its newest line unless you've scrolled up to read.
function Out({ text }) {
  const ref = useRef(null)
  const pinned = useRef(true)
  useLayoutEffect(() => { const e = ref.current; if (e && pinned.current) e.scrollTop = e.scrollHeight }, [text])
  return <pre className="sa-out" ref={ref} onScroll={(ev) => { const e = ev.currentTarget; pinned.current = e.scrollHeight - e.scrollTop - e.clientHeight < 8 }}>{text}</pre>
}

function Step({ s }) {
  return s.kind === 'tool'
    ? <li className="sa-step"><span className="sa-tool">{s.tool}</span><span className="sa-hint">{s.hint}</span><time>{ago(s.ts)}</time></li>
    : <li className="sa-step say"><span className="sa-say">{s.text}</span><time>{ago(s.ts)}</time></li>
}

function Detail({ it, Rich }) {
  if (it.fromScreen) {
    return <div className="sa-detail"><p className="sa-note">{t("Only its terminal shows this one; its steps aren't in Claude's logs. Open the terminal view to follow it.")}</p></div>
  }
  if (it.kind !== 'agent') {
    return (
      <div className="sa-detail">
        {it.by && <p className="sa-note">{t('Started by its subagent “{name}”.', { name: it.by })}</p>}
        {it.summary && it.status !== 'running' && <p className="sa-note">{it.summary}</p>}
        {it.kind === 'shell' && (
          <section>
            <h5>{it.status === 'running' ? t('Latest output') : t('Last output')}</h5>
            {it.output?.length ? <Out text={it.output.join('\n')} /> : <p className="sa-note">{t('Nothing yet.')}</p>}
          </section>
        )}
        {it.kind === 'monitor' && (
          <section>
            <h5>{t('Latest news')}</h5>
            {it.event ? <Out text={it.event} /> : <p className="sa-note">{t('Nothing yet.')}</p>}
          </section>
        )}
        {it.command && (
          <details className="sa-brief">
            <summary>{t('The command')}</summary>
            <pre className="sa-out">{it.command}</pre>
          </details>
        )}
      </div>
    )
  }
  return (
    <div className="sa-detail">
      {it.result && (
        <section>
          <h5>{it.status === 'done' ? t('What it reported') : t('Last message')}</h5>
          <div className="sa-result"><Rich text={it.result} /></div>
        </section>
      )}
      <section>
        <h5>{it.status === 'running' ? t('Latest steps') : t('Last steps')} <span>· {t('{n} tool calls in all', { n: it.tools })}</span></h5>
        <ol className="sa-steps">{it.steps.map((s, i) => <Step key={i} s={s} />)}</ol>
      </section>
      {it.brief && (
        <details className="sa-brief">
          <summary>{t('The brief it was given')}</summary>
          <p>{it.brief}</p>
        </details>
      )}
    </div>
  )
}

export default function Subagents({ paneId, working, Rich = ({ text }) => <p>{text}</p> }) {
  const [openId, setOpenId] = useState(null)
  const [showDone, setShowDone] = useState(false)
  const [collapsed, setCollapsed] = usePersisted('cc-sa-collapsed', false)
  // A shell can keep running after the agent's turn ends: keep up with it while anything runs.
  const [busy, setBusy] = useState(false)
  const { data } = usePoll(`/agents/${encodeURIComponent(paneId)}/subagents`, working || busy ? 3000 : 15000)
  useEffect(() => setBusy(!!data?.running), [data?.running])
  const items = [...(data?.items || []).map((i) => ({ ...i, kind: 'agent' })), ...(data?.tasks || [])]
  // The tray grows upward into the chat; cap it so some of the conversation stays visible (on a
  // phone, where it took most of the screen, at a third of it).
  const trayRef = useRef(null)
  const [maxH, setMaxH] = useState(320)
  useLayoutEffect(() => {
    const fit = () => {
      const c = trayRef.current?.closest('.console')
      if (c) setMaxH(Math.max(120, Math.round((c.clientHeight - 230) * (window.innerWidth < 600 ? 0.35 : 0.6))))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [openId, collapsed, items.length])

  if (!items.length) return null
  const running = items.filter((i) => i.status === 'running')
  const recentDone = items.filter((i) => i.status !== 'running' && Date.now() - new Date(i.updatedAt) < 15 * 60 * 1000)
  const rows = showDone || !running.length ? items : [...running, ...recentDone]
  const hidden = items.length - rows.length

  // Nothing running and nothing asked for: one quiet line.
  if (!running.length && !showDone) {
    return (
      <div className="sa-tray quiet" ref={trayRef}>
        <button className="sa-head" onClick={() => setShowDone(true)}>
          <Icon name="layers" size={13} />
          <span className="sa-title">{t('Recently: {list}', { list: tally(items) })}</span>
          <span className="sa-sub">{t('none running')}</span>
          <Icon name="chevron" size={11} className="sa-caret rot-up" />
        </button>
      </div>
    )
  }

  const summary = `${t('{list} running', { list: tally(running) })}${recentDone.length ? ` · ${t('{n} just finished', { n: recentDone.length })}` : ''}`
  return (
    <div className={`sa-tray ${collapsed ? 'collapsed' : ''}`} ref={trayRef}>
      <div className="sa-head">
        <button className="sa-head-main" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          <span className="sa-dots">{running.slice(0, 5).map((r) => <span key={r.id} className="sa-dot s-running" />)}</span>
          <span className="sa-title">{t('In the background')}</span>
          <span className="sa-sub">{summary}</span>
          {collapsed && running[0] && <span className="sa-peek">{running.map((r) => r.description).join(' · ')}</span>}
        </button>
        {!collapsed && hidden > 0 && <button className="sa-link" onClick={() => setShowDone(true)}>{t('Show {n} finished', { n: hidden })}</button>}
        {!collapsed && showDone && running.length > 0 && <button className="sa-link" onClick={() => setShowDone(false)}>{t('Hide finished')}</button>}
        <button className="sa-icon" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? t('Show what runs in the background') : t('Hide what runs in the background')} title={collapsed ? t('Show') : t('Hide')}>
          <Icon name="chevron" size={12} className={collapsed ? 'rot-up' : 'rot90'} />
        </button>
      </div>
      {!collapsed && (
        <ul className="sa-list" style={{ maxHeight: maxH }}>
          {rows.map((it) => {
            const d = doing(it)
            const key = `${it.kind}:${it.id}`
            const open = openId === key
            return (
              <li key={key} className={`sa-item k-${it.kind} ${open ? 'open' : ''}`}>
                <button className="sa-row" onClick={() => setOpenId(open ? null : key)} aria-expanded={open}>
                  <span className={`sa-dot s-${it.status}`} title={label(it.status)} />
                  <span className="sa-name"><Icon name={ICON[it.kind]} size={12} className="sa-kind" />{it.fromScreen ? it.type : it.description}</span>
                  <span className="sa-now">
                    {it.status === 'running'
                      ? <>{d.tool && !it.fromScreen && <b>{d.tool}</b>}<span className={d.code ? 'code' : 'prose'}>{d.text}</span></>
                      : <span className={`sa-state s-${it.status}`}>{finished(it)}</span>}
                  </span>
                  <span className="sa-time">{it.fromScreen ? it.elapsed || '' : it.status === 'running' ? since(it.startedAt) : ago(it.updatedAt)}</span>
                  <Icon name="chevron" size={11} className={`sa-caret ${open ? 'rot90' : ''}`} />
                </button>
                {open && <Detail it={it} Rich={Rich} />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
