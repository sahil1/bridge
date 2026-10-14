import { useEffect, useMemo, useRef, useState } from 'react'
import Icon, { StatusDot } from './Icon.jsx'
import { tildePath } from './Rail.jsx'
import { api } from '../api.js'

// ⌘K: jump to any agent or tab, run a routine, open a file in the current agent's
// folder, or run an action. Fuzzy, keyboard-first; full screen on the phone.
function score(q, text) {
  if (!q) return 1
  const t = text.toLowerCase()
  const i = t.indexOf(q)
  if (i >= 0) return 100 - Math.min(i, 40) / 2 + (i === 0 || /[\s/_\-›.]/.test(t[i - 1]) ? 20 : 0)
  // Every word of the query appears somewhere ("ops refresh")
  const words = q.split(/\s+/).filter(Boolean)
  if (words.length > 1 && words.every((w) => t.includes(w))) return 60
  // Loose letters-in-order match, only when they sit close together
  let pos = 0
  let gaps = 0
  for (const ch of q) {
    const j = t.indexOf(ch, pos)
    if (j < 0) return 0
    if (pos) gaps += j - pos
    pos = j + 1
  }
  return gaps <= q.length ? 30 - gaps : 0
}

export default function Palette({ fleet, activeId, onClose, onOpen, onOpenFile, actions }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [routines, setRoutines] = useState([])
  const [files, setFiles] = useState([])
  const [flash, setFlash] = useState(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  // Where file search looks: the open agent's folder, or the open shell tab's first pane.
  const active = (() => {
    const a = fleet?.agents?.find((x) => x.paneId === activeId)
    if (a) return { id: a.paneId, paneId: a.paneId, label: a.chief ? 'Chief of staff' : a.title || a.tab }
    const t = activeId?.startsWith('tab:') && fleet?.tabs?.find((x) => `tab:${x.tabId}` === activeId)
    const p = t && (t.panes.find((x) => !x.agent) || t.panes[0])
    return p ? { id: activeId, paneId: p.paneId, label: t.label } : null
  })()

  useEffect(() => { inputRef.current?.focus(); api('/routines').then((d) => setRoutines(d.routines || [])).catch(() => {}) }, [])
  useEffect(() => {
    if (!active || q.length < 2) { setFiles([]); return }
    const t = setTimeout(() => api(`/agents/${encodeURIComponent(active.paneId)}/find?q=${encodeURIComponent(q)}`).then((d) => setFiles((d.files || []).slice(0, 6))).catch(() => setFiles([])), 120)
    return () => clearTimeout(t)
  }, [q, active?.paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const out = []
    for (const a of fleet?.agents || []) {
      const label = a.chief ? 'Chief of staff' : a.title || a.tab
      out.push({ id: a.paneId, group: 'Agents', label, sub: `${a.workspace} › ${a.tab} · ${tildePath(a.cwd)}`, status: a.status, text: `${label} ${a.workspace} ${a.tab} ${a.cwd}`, run: () => onOpen(a.paneId) })
    }
    for (const t of fleet?.tabs || []) {
      if (!t.panes.some((p) => !p.agent) || t.panes.some((p) => p.agent)) continue
      out.push({ id: `tab:${t.tabId}`, group: 'Shells', label: t.label || 'shell', sub: `${t.workspace} · ${t.panes.length} pane${t.panes.length === 1 ? '' : 's'}`, icon: 'terminal', text: `${t.label} ${t.workspace} ${t.panes.map((p) => p.cwd).join(' ')}`, run: () => onOpen(`tab:${t.tabId}`) })
    }
    for (const r of routines) {
      out.push({ id: `r:${r.id}`, group: 'Routines', label: `Run ${r.name}`, sub: `${r.command} · ${r.state === 'ok' ? 'up to date' : r.note || r.state}`, icon: 'play', text: `run routine ${r.name} ${r.command}`,
        run: async () => { await api(`/routines/${r.id}/run`, { method: 'POST' }).then((o) => { setFlash(`${r.name} started`); if (o.paneId) setTimeout(() => onOpen(o.paneId), 1200) }).catch((e) => setFlash(e.message)); return 'keep' } })
    }
    for (const a of actions) out.push({ ...a, group: 'Actions', text: `${a.label} ${a.keywords || ''}` })
    for (const f of files) out.push({ id: `f:${f}`, group: `Files in ${active?.label || 'folder'}`, label: f.split('/').pop(), sub: f, icon: 'file', text: f, score: 30, run: () => onOpenFile(active.id, f) })
    const scored = out.map((it) => ({ ...it, s: it.score ?? score(ql, it.text) })).filter((it) => it.s > 0)
    if (!ql) return scored.slice(0, 60)
    // Keep each group together; groups with the best match come first.
    const best = {}
    for (const it of scored) best[it.group] = Math.max(best[it.group] || 0, it.s)
    return scored.sort((a, b) => (best[b.group] - best[a.group]) || (a.group === b.group ? b.s - a.s : a.group.localeCompare(b.group))).slice(0, 40)
  }, [fleet, routines, files, q, actions]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSel(0) }, [q])
  useEffect(() => { listRef.current?.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const run = async (it) => {
    if (!it) return
    const r = await it.run()
    if (r !== 'keep') onClose()
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[sel]) }
    else if (e.key === 'Escape') onClose()
  }

  let lastGroup = null
  return (
    <div className="modal-backdrop pal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="pal-input">
          <Icon name="search" size={15} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Jump to an agent, run a routine, find a file…" spellCheck="false" autoCapitalize="off" autoCorrect="off" />
          <button className="pal-close" onClick={onClose} aria-label="Close">Esc</button>
        </div>
        {flash && <div className="pal-flash">{flash}</div>}
        <div className="pal-list" ref={listRef} role="listbox">
          {items.length === 0 && <p className="muted small pad">Nothing matches “{q}”.</p>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="pal-group" key={`g-${it.group}`}>{it.group}</div> : null
            lastGroup = it.group
            return [head, (
              <button key={it.id} role="option" aria-selected={i === sel} className={`pal-item ${i === sel ? 'on' : ''}`} onMouseMove={() => setSel(i)} onClick={() => run(it)}>
                <span className="pal-ico">{it.status ? <StatusDot status={it.status} size={8} /> : <Icon name={it.icon || 'command'} size={13} />}</span>
                <span className="pal-text"><b>{it.label}</b>{it.sub && <span>{it.sub}</span>}</span>
                {it.hint && <kbd>{it.hint}</kbd>}
              </button>
            )]
          })}
        </div>
      </div>
    </div>
  )
}
