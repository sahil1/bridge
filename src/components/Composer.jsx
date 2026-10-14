import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api } from '../api.js'
import { usePersisted } from './layout.jsx'

// Drafts survive navigation and reloads: one per agent, kept in this browser.
const draftKey = (id) => `cc-draft-${id}`
const loadDraft = (id) => { try { return JSON.parse(localStorage.getItem(draftKey(id))) || { text: '', files: [] } } catch { return { text: '', files: [] } } }
// Sent messages per agent, newest last, for ↑/↓ recall like a terminal.
const histKey = (id) => `cc-hist-${id}`
const loadHist = (id) => { try { return JSON.parse(localStorage.getItem(histKey(id))) || [] } catch { return [] } }
const pushHist = (id, text) => {
  if (!text) return
  const h = loadHist(id).filter((t) => t !== text)
  h.push(text)
  try { localStorage.setItem(histKey(id), JSON.stringify(h.slice(-100))) } catch { /* storage full or blocked */ }
}
const saveDraft = (id, d) => {
  try {
    if (!d.text && !d.files.length) localStorage.removeItem(draftKey(id))
    else localStorage.setItem(draftKey(id), JSON.stringify(d))
  } catch { /* private mode */ }
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']) if (MediaRecorder.isTypeSupported(t)) return t
  return ''
}

// Tap to record, tap to stop; audio is transcribed on the Mac by whisper.cpp.
function useRecorder(onText, onError) {
  const [state, setState] = useState('idle') // idle | recording | transcribing
  const [secs, setSecs] = useState(0)
  const [level, setLevel] = useState(0)
  const rec = useRef(null)

  const stopTracks = () => {
    rec.current?.stream.getTracks().forEach((t) => t.stop())
    rec.current?.ctx?.close().catch(() => {})
    clearInterval(rec.current?.timer)
    cancelAnimationFrame(rec.current?.raf)
  }

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return onError('Microphone needs HTTPS (open the Tailscale address)')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickMime()
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks = []
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      mr.onstop = async () => {
        stopTracks()
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/mp4' })
        if (blob.size < 2000) { setState('idle'); return onError('Recording too short') }
        setState('transcribing')
        try {
          const res = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Transcription failed')
          if (data.text) onText(data.text)
          else onError('No speech detected')
        } catch (e) { onError(e.message) } finally { setState('idle') }
      }
      // Live input level for the meter.
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const an = ctx.createAnalyser()
      an.fftSize = 256
      ctx.createMediaStreamSource(stream).connect(an)
      const buf = new Uint8Array(an.frequencyBinCount)
      const tick = () => {
        an.getByteTimeDomainData(buf)
        let peak = 0
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
        setLevel(Math.min(1, peak / 64))
        rec.current.raf = requestAnimationFrame(tick)
      }
      rec.current = { mr, stream, ctx, timer: setInterval(() => setSecs((s) => s + 1), 1000) }
      rec.current.raf = requestAnimationFrame(tick)
      setSecs(0)
      mr.start()
      setState('recording')
      navigator.vibrate?.(15)
    } catch (e) {
      onError(e.name === 'NotAllowedError' ? 'Microphone permission was denied' : e.message)
    }
  }
  const stop = () => { if (rec.current?.mr.state === 'recording') rec.current.mr.stop(); navigator.vibrate?.(10) }
  const cancel = () => { if (rec.current?.mr) { rec.current.mr.onstop = () => stopTracks(); rec.current.mr.stop() } setState('idle') }
  useEffect(() => () => { try { cancel() } catch { /* unmounted */ } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return { state, secs, level, start, stop, cancel }
}


// "/" menu: built-ins, skills and plugin commands, with choices for commands that take one.
function useSlash(url) {
  const [cmds, setCmds] = useState(null)
  const load = () => { if (!cmds && url) api(url).then((d) => setCmds(d.commands || [])).catch(() => setCmds([])) }
  useEffect(() => { setCmds(null) }, [url])
  return { cmds, load }
}

// "@" menu: files and folders under the agent's folder, searched as you type.
function useMentions(url, query) {
  const [items, setItems] = useState(null)
  const [cwd, setCwd] = useState(null)
  useEffect(() => {
    if (!url || query == null) { setItems(null); return }
    let live = true
    const t = setTimeout(() => {
      api(`${url}?q=${encodeURIComponent(query)}`).then((d) => { if (live) { setItems(d.items || []); setCwd(d.cwd || null) } }).catch(() => { if (live) setItems([]) })
    }, query ? 90 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [url, query])
  return { items, cwd }
}
// Claude reads @path; a path with spaces needs quotes.
const mentionText = (p) => (/\s/.test(p) ? `@"${p}"` : `@${p}`)

const SOURCE_LABEL = { skill: 'skill', plugin: 'plugin', project: 'project' }

function SlashMenu({ items, sel, onPick, onHover, title, mention, jumps = [] }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.querySelector('.slash-item.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])
  if (!items.length && !jumps.length) return null
  return (
    <div className={`slash-menu ${mention ? 'mention-menu' : ''}`} role="listbox" ref={ref} onMouseDown={(e) => e.preventDefault()}>
      {jumps.length > 0 && (
        <div className="mention-jumps">
          <span>Go to</span>
          {jumps.map((j) => <button key={j.key} className="mention-jump" title={j.file.path} onClick={() => onPick(j)}><Icon name={j.label === '..' ? 'chevron' : 'folder'} size={11} className={j.label === '..' ? 'rot-up' : ''} />{j.label === '..' ? 'Up' : j.label}</button>)}
        </div>
      )}
      {title && <div className="slash-title">{title}</div>}
      {items.map((it, i) => (
        <button key={it.key} role="option" aria-selected={i === sel} className={`slash-item ${i === sel ? 'on' : ''}`} onMouseMove={() => onHover(i)} onClick={() => onPick(it)}>
          <b>{it.label}</b>
          <span className="slash-desc">{it.description}</span>
          {it.badge && <span className="slash-badge">{it.badge}</span>}
        </button>
      ))}
      <div className="slash-foot"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>⏎</kbd> or <kbd>Tab</kbd> pick · <kbd>Esc</kbd> close{mention && <> · <kbd>Space</kbd> after a folder to use it</>}</div>
    </div>
  )
}

export default function Composer({ id, placeholder, onSend, keysOpen, onToggleKeys, busy: agentBusy = false, onStop, queuedCount = 0, commandsUrl, filesUrl, onInteractive, historyUrl }) {
  const [draft, setDraft] = useState(() => loadDraft(id))
  const [note, setNote] = useState(null)
  const [uploading, setUploading] = useState(0)
  const taRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => { setDraft(loadDraft(id)); setNote(null); hist.current = null }, [id])
  // ↑ on the first line walks back through what you've sent here; ↓ on the last line comes forward.
  const hist = useRef(null) // { list, i, saved } while browsing
  // The agent's own past messages (typed anywhere), fetched when the box gets focus.
  const past = useRef(null)
  const pastAt = useRef(0)
  useEffect(() => { past.current = null; pastAt.current = 0 }, [historyUrl])
  const loadPast = () => {
    if (!historyUrl || Date.now() - pastAt.current < 30000) return
    pastAt.current = Date.now()
    api(historyUrl).then((d) => {
      past.current = (d.messages || []).filter((m) => m.role === 'user' && m.text && !m.text.startsWith('<') && !m.text.startsWith('[Request interrupted'))
        .map((m) => m.text.replace(/\n*\((Sent|Started) by .*chief of staff[^)]*\)$/, '').trim())
    }).catch(() => {})
  }
  const recall = (e) => {
    const el = e.currentTarget
    const up = e.key === 'ArrowUp'
    if (el.selectionStart !== el.selectionEnd) return false
    const before = el.value.slice(0, el.selectionStart)
    const after = el.value.slice(el.selectionStart)
    if (up ? before.includes('\n') : after.includes('\n')) return false
    if (!hist.current) {
      if (!up) return false
      // What you sent from here, plus what the agent's own history shows (sent from anywhere).
      const list = [...new Set([...(past.current || []), ...loadHist(id)])]
      if (!list.length || (draft.text && !list.includes(draft.text))) return false
      hist.current = { list, i: list.length, saved: draft.text }
    }
    const h = hist.current
    const i = h.i + (up ? -1 : 1)
    if (i < 0) return true
    if (i >= h.list.length) { hist.current = null; setDraft((d) => ({ ...d, text: h.saved })); return true }
    h.i = i
    setDraft((d) => ({ ...d, text: h.list[i] }))
    requestAnimationFrame(() => { const t = taRef.current; if (t) { const p = up ? 0 : t.value.length; t.setSelectionRange(p, p) } })
    return true
  }
  useEffect(() => { const t = setTimeout(() => saveDraft(id, draft), 250); return () => clearTimeout(t) }, [id, draft])
  // Height: grows with the text up to 200px, unless you've dragged the grip to set your own.
  const [manualH, setManualH] = usePersisted('cc-composer-h', null)
  const fit = () => {
    const el = taRef.current
    if (!el || !el.clientWidth) return
    if (manualH) { el.style.height = `${manualH}px`; return }
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }
  useEffect(fit, [draft.text, manualH]) // eslint-disable-line react-hooks/exhaustive-deps
  // A restored draft can arrive while the box is hidden or still 0 wide; size it once it shows.
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; fit() } })
    ro.observe(el)
    return () => ro.disconnect()
  }) // eslint-disable-line react-hooks/exhaustive-deps
  const grip = useRef(null)
  const onGripDown = (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    grip.current = { y: e.clientY, h: taRef.current?.offsetHeight || 40 }
  }
  const onGripMove = (e) => {
    if (!grip.current) return
    const h = Math.round(Math.max(40, Math.min(window.innerHeight * 0.7, grip.current.h + (grip.current.y - e.clientY))))
    setManualH(h)
  }
  const onGripUp = () => { grip.current = null }
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 4000); return () => clearTimeout(t) }, [note])

  const voice = useRecorder(
    (t) => setDraft((d) => ({ ...d, text: d.text ? `${d.text.replace(/\s+$/, '')} ${t}` : t })),
    (msg) => setNote(msg),
  )

  const upload = async (fileList) => {
    for (const f of Array.from(fileList || [])) {
      setUploading((n) => n + 1)
      try {
        const res = await fetch(`/api/upload?name=${encodeURIComponent(f.name || 'photo.jpg')}`, { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setDraft((d) => ({ ...d, files: [...d.files, { name: f.name, path: data.path, image: f.type.startsWith('image/'), size: f.size, preview: f.type.startsWith('image/') ? `/api/upload/raw?path=${encodeURIComponent(data.path)}` : null }] }))
      } catch (e) { setNote(`Upload failed: ${e.message}`) } finally { setUploading((n) => n - 1) }
    }
  }

  const send = async () => {
    const text = draft.text.trim()
    if (!text && !draft.files.length) return
    const attach = draft.files.length ? `\n\nAttached: ${draft.files.map((f) => f.path).join(' ')}` : ''
    const message = `${text}${attach}`.trim()
    const prev = draft
    pushHist(id, text)
    hist.current = null
    setDraft({ text: '', files: [] })
    saveDraft(id, { text: '', files: [] })
    const ok = await onSend(message)
    if (ok === false) setDraft(prev) // keep what you wrote if sending failed
  }

  // Pasted screenshots/photos and dropped files upload like the paperclip.
  const filesFrom = (dt) => {
    const out = [...(dt?.files || [])]
    if (!out.length) for (const it of dt?.items || []) if (it.kind === 'file') { const f = it.getAsFile(); if (f) out.push(f) }
    return out.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}${i ? `-${i}` : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })))
  }
  const onPaste = (e) => {
    const files = filesFrom(e.clipboardData)
    if (!files.length) return // plain text pastes normally
    e.preventDefault()
    upload(files)
  }
  const [dragging, setDragging] = useState(false)
  const dropProps = {
    onDragOver: (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragging(true) } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) },
    onDrop: (e) => { const files = filesFrom(e.dataTransfer); setDragging(false); if (files.length) { e.preventDefault(); upload(files) } },
  }

  // Slash menu state: shown while the box holds just "/word", or while picking an argument.
  const slash = useSlash(commandsUrl)
  const [slashSel, setSlashSel] = useState(0)
  const [argFor, setArgFor] = useState(null)
  const [slashOff, setSlashOff] = useState(false)
  const typed = /^\/([\w:.-]*)$/.exec(draft.text)
  useEffect(() => { if (typed) slash.load() }, [!!typed]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSlashSel(0); if (!draft.text.startsWith('/')) { setSlashOff(false); setArgFor(null) } }, [draft.text])
  let slashItems = []
  let slashTitle = null
  if (argFor) {
    slashTitle = `/${argFor.name}`
    slashItems = argFor.args.map((a) => ({ key: a.value || 'all', label: a.label, description: a.description, arg: a }))
  } else if (typed && !slashOff && slash.cmds) {
    const q = typed[1].toLowerCase()
    const rank = (c) => (c.name.startsWith(q) ? 0 : c.name.includes(q) ? 1 : q.length >= 3 && (c.description || '').toLowerCase().includes(q) ? 2 : 9)
    slashItems = slash.cmds.map((c) => ({ c, r: rank(c) })).filter((x) => x.r < 9).sort((a, b) => a.r - b.r).slice(0, 40)
      .map(({ c }) => ({ key: c.name, label: `/${c.name}`, description: c.hint ? `${c.description} · ${c.hint}` : c.description, badge: SOURCE_LABEL[c.source], cmd: c }))
  }
  const sendRaw = async (text, interactive) => {
    pushHist(id, text)
    setDraft({ text: '', files: draft.files })
    setArgFor(null)
    const ok = await onSend(text)
    if (ok !== false && interactive) onInteractive?.()
  }
  const pickSlash = (it) => {
    if (it.arg) return sendRaw(it.arg.value ? `/${argFor.name} ${it.arg.value}` : `/${argFor.name}`, argFor.terminal || !it.arg.value)
    const c = it.cmd
    if (c.mode === 'pick') { setArgFor(c); setSlashSel(0); return }
    if (c.mode === 'terminal') return sendRaw(`/${c.name}`, true)
    setDraft((d) => ({ ...d, text: `/${c.name} ` }))
    setSlashOff(true)
    taRef.current?.focus()
  }

  // "@" menu state: the word at the caret starting with @ (quoted paths allowed while typing).
  const [caret, setCaret] = useState(0)
  const [mentionOff, setMentionOff] = useState(null)
  const before = draft.text.slice(0, caret)
  const at = filesUrl && !slashItems.length ? /(^|\s)@("[^"]*|[^\s"@]*)$/.exec(before) : null
  const atStart = at ? at.index + at[1].length : -1
  const mentionQ = at && mentionOff !== atStart ? at[2].replace(/^"/, '') : null
  const { items: found, cwd: agentCwd } = useMentions(filesUrl, mentionQ)
  const cwdName = agentCwd ? agentCwd.split('/').pop() : null
  const [mentionSel, setMentionSel] = useState(0)
  useEffect(() => { setMentionSel(0) }, [mentionQ])
  const baseName = (p) => p.replace(/\/$/, '').split('/').pop()
  const parentOf = (p) => (p.replace(/\/$/, '').includes('/') ? p.replace(/[^/]+\/?$/, '') : '')
  const toItem = (f) => ({ key: `${f.label || ''}:${f.path}`, label: f.label || baseName(f.path) + (f.dir ? '/' : ''), description: f.hint || (mentionQ?.endsWith('/') ? '' : parentOf(f.path)), badge: f.dir && !f.label ? 'folder' : null, file: f })
  // With just "@", the way up and the usual places sit in a row above this folder's list.
  const isJump = (f) => f.place || (f.label === '..' && mentionQ === '')
  const mentionItems = mentionQ != null && found ? found.filter((f) => !isJump(f)).map(toItem) : []
  const mentionJumps = mentionQ != null && found ? found.filter(isJump).map(toItem) : []
  const pickMention = (it) => {
    const p = it.file.path
    const end = caret
    const ins = it.file.dir ? `@${/\s/.test(p) ? `"${p}` : p}` : `${mentionText(p)} `
    const text = draft.text.slice(0, atStart) + ins + draft.text.slice(end)
    setDraft((d) => ({ ...d, text }))
    const pos = atStart + ins.length
    setCaret(pos)
    // Folders keep the menu open so you can keep drilling in.
    requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(pos, pos) } })
  }
  const trackCaret = (e) => setCaret(e.currentTarget.selectionStart ?? 0)

  const onKeyDown = (e) => {
    if (mentionItems.length || mentionJumps.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionSel((i) => Math.min(i + 1, mentionItems.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionSel((i) => Math.max(i - 1, 0)); return }
      if (((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') && mentionItems[mentionSel]) { e.preventDefault(); pickMention(mentionItems[mentionSel]); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMentionOff(atStart); return }
    }
    if (slashItems.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSel((i) => Math.min(i + 1, slashItems.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSel((i) => Math.max(i - 1, 0)); return }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); pickSlash(slashItems[slashSel]); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSlashOff(true); setArgFor(null); return }
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.metaKey && recall(e)) { e.preventDefault(); return }
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }

  const recording = voice.state === 'recording'
  const busy = voice.state === 'transcribing'
  const canSend = !!(draft.text.trim() || draft.files.length) && !uploading
  const status = busy ? 'Transcribing on your Mac…' : uploading ? `Uploading ${uploading} file${uploading > 1 ? 's' : ''}…` : note

  return (
    <div className="composer-stack">
      <SlashMenu items={slashItems} sel={slashSel} onHover={setSlashSel} onPick={pickSlash} title={slashTitle} />
      {mentionQ != null && <SlashMenu items={mentionItems} sel={mentionSel} onHover={setMentionSel} onPick={pickMention} title={/^[~/]/.test(mentionQ) ? mentionQ.replace(/[^/]*$/, '') || '~/' : mentionQ.endsWith('/') ? mentionQ : mentionQ ? `Matching "${mentionQ}"` : `${cwdName || 'This folder'}/`}
        jumps={mentionJumps} mention />}
      <div className={`composer ${recording ? 'rec' : ''} ${dragging ? 'drop' : ''} ${manualH ? 'sized' : ''}`} {...dropProps} onPaste={onPaste}>
        <div className="comp-grip" role="separator" aria-orientation="horizontal" aria-label="Resize the message box" title={manualH ? 'Drag to resize · double-click to fit the text again' : 'Drag to make the box taller'}
          onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp} onDoubleClick={() => setManualH(null)}
          tabIndex={0} onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const cur = taRef.current?.offsetHeight || 40; setManualH(Math.max(40, Math.min(window.innerHeight * 0.7, cur + (e.key === 'ArrowUp' ? 40 : -40)))) }
            if (e.key === 'Escape' || e.key === 'Enter') setManualH(null)
          }}><span /></div>
        {draft.files.length > 0 && (
          <div className="attach-row">
            {draft.files.map((f) => (
              <span key={f.path} className="attach-chip" title={f.path}>
                {f.image && f.preview ? <img className="attach-thumb" src={f.preview} alt="" /> : <Icon name={f.image ? 'image' : 'file'} size={12} />} <span className="attach-name">{f.name}</span>
                <button aria-label={`Remove ${f.name}`} onClick={() => setDraft((d) => ({ ...d, files: d.files.filter((x) => x.path !== f.path) }))}><Icon name="x" size={11} /></button>
              </span>
            ))}
          </div>
        )}
        {recording ? (
          <div className="rec-bar" role="status" aria-live="polite">
            <span className="rec-dot" />
            <span className="rec-time">{Math.floor(voice.secs / 60)}:{String(voice.secs % 60).padStart(2, '0')}</span>
            <span className="rec-meter"><span style={{ transform: `scaleX(${0.08 + voice.level * 0.92})` }} /></span>
          </div>
        ) : (
          <textarea
            ref={taRef}
            value={draft.text}
            rows={1}
            placeholder={placeholder}
            onChange={(e) => { hist.current = null; setDraft((d) => ({ ...d, text: e.target.value })); trackCaret(e) }}
            onSelect={trackCaret}
            onFocus={loadPast}
            onKeyDown={onKeyDown}
          />
        )}
        <div className="comp-tools">
          {recording ? (
            <>
              <span className="comp-hint">Listening… tap ✓ when you're done</span>
              <button className="comp-text-btn" onClick={voice.cancel}>Cancel</button>
              <button className="send rec-stop" onClick={voice.stop} aria-label="Stop and transcribe" title="Stop and transcribe"><Icon name="check" size={16} /></button>
            </>
          ) : (
            <>
              <button className={`comp-btn ${keysOpen ? 'on' : ''}`} onClick={onToggleKeys} aria-label="Toggle keys" title="Keys (Esc, arrows, 1/2/3…)"><Icon name="keyboard" size={16} /></button>
              <button className="comp-btn" onClick={() => fileRef.current?.click()} aria-label="Attach photo or file" title="Attach a photo or file"><Icon name="paperclip" size={16} /></button>
              <button className={`comp-btn ${busy ? 'busy' : ''}`} onClick={voice.start} disabled={busy} aria-label="Dictate" title="Dictate (transcribed on your Mac)">
                <Icon name={busy ? 'refresh' : 'mic'} size={16} className={busy ? 'spin' : ''} />
              </button>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
              <span className={`comp-hint ${status ? 'status' : ''}`}>{status || (agentBusy
                ? <span className="busy-hint">Working{queuedCount ? ` · ${queuedCount} queued` : ''}<span className="hide-touch"> · <kbd>⏎</kbd> queues your message</span></span>
                : <span className="hide-touch"><kbd>⏎</kbd> send · <kbd>⇧⏎</kbd> new line</span>)}</span>
              {agentBusy && onStop && <button className="stop-btn" onClick={onStop} title="Interrupt the agent (sends Esc)" aria-label="Stop the agent"><Icon name="stop" size={11} /> Stop</button>}
              <button className={`send ${agentBusy ? 'queue' : ''}`} onClick={send} disabled={!canSend} aria-label={agentBusy ? 'Queue message' : 'Send'} title={agentBusy ? 'Queue: sends when the agent is free' : 'Send'}>
                <Icon name={agentBusy ? 'clock' : 'send'} size={15} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
