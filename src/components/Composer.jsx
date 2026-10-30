import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api, BASE } from '../api.js'
import { usePersisted } from './layout.jsx'
import Lightbox from './Lightbox.jsx'
import { Menu } from './Rail.jsx'
import PermissionFix from './PermissionFix.jsx'
import { t, tx } from '../i18n/index.js'
import { keyLabel } from '../../shared/dictation/keys.js'
import { useDictation, registerBox, box, noteBoxFocus, press, release, finish, cancel, dismiss, retry, settings, keysPlatform, dictationKey, listeningHint } from '../dictation/controller.js'

// Drafts survive navigation and reloads: one per agent, kept in this browser.
const draftKey = (id) => `cc-draft-${id}`
const loadDraft = (id) => { try { return JSON.parse(localStorage.getItem(draftKey(id))) || { text: '', files: [] } } catch { return { text: '', files: [] } } }
// Attached images numbered in order (Image 1, Image 2), so you can refer to one in your message.
const numbered = (files) => {
  const imgs = files.filter((f) => f.image)
  return { count: imgs.length, of: (f) => imgs.indexOf(f) + 1 || null }
}
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

// Shown when voice notes need something first. The speech model: what it is and its size, in the
// server's words, one button to download it with progress, then what you said, kept meanwhile
// (audio), turned into text. whisper.cpp (a Whisper model picked in Settings › Voice): installed in
// a terminal tab, with Homebrew first on a Mac that has none.
export function VoiceSetup({ initial, onText, onClose }) {
  const [v, setV] = useState(initial)
  const [started, setStarted] = useState(!!initial.downloading)
  const [err, setErr] = useState(null)
  const [brewing, setBrewing] = useState(false) // Homebrew installing, in a terminal tab
  const [audio, setAudio] = useState(initial.audio || null) // what you said, waiting for the model
  const sent = useRef(false)
  useEffect(() => {
    if (v.ready && !audio) { const t = setTimeout(onClose, 5000); return () => clearTimeout(t) }
    if ((!started && !brewing) || v.error || v.ready) return
    const t = setInterval(() => api('/voice').then(setV).catch(() => {}), 1000)
    return () => clearInterval(t)
  }, [v.ready, v.error, started, brewing, audio, onClose])
  // The model's here: what you said, now.
  useEffect(() => {
    if (!v.ready || !audio || sent.current) return
    sent.current = true
    fetch(`${BASE}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': audio.type }, body: audio })
      .then(async (res) => { const d = await res.json(); if (!res.ok) throw new Error(d.error || t('Transcription failed')); if (d.text) onText(d.text); setAudio(null); onClose() })
      .catch((e) => { setErr(t("Couldn't transcribe: {error}", { error: e.message })); setAudio(null) })
  }, [v.ready, audio, onText, onClose])
  const setup = async () => {
    setErr(null)
    try { setV(await api('/voice/setup', { method: 'POST' })); setStarted(true) } catch (e) { setErr(e.message) }
  }
  const installBrew = async () => {
    setErr(null)
    try { await api('/fix/install', { method: 'POST', body: { what: 'homebrew' } }); setBrewing(true) } catch (e) { setErr(e.message) }
  }
  const model = v.model || {}
  const whisper = v.needs === 'whisper' || v.needs === 'brew'
  const touch = matchMedia('(pointer: coarse)').matches
  let text, actions = null
  if (v.ready && audio) text = t('Turning what you said into text…')
  else if (v.ready) text = t('Voice notes are ready. Tap the mic and talk.')
  else if (v.error) { text = t("The speech model didn't download: {error}", { error: v.error }); actions = <button className="btn small primary" onClick={setup}>{t('Try again')}</button> }
  else if (v.downloading) text = audio ? t("Downloading {model}… {percent}%. What you said is kept, and turned into text when it's done.", { model: model.label, percent: v.downloading.percent }) : t('Downloading {model}… {percent}%', { model: model.label, percent: v.downloading.percent })
  else if (whisper && brewing && v.installCommand) { text = t('Homebrew is in. One more step: whisper.cpp.'); actions = <button className="btn small primary" onClick={() => { setBrewing(false); setup() }}>{t('Set up')}</button> }
  else if (whisper && brewing) text = t('Installing Homebrew in a terminal tab, in the Setup space. It asks for your Mac password there.')
  else if (whisper && started && v.installCommand) text = t('Installing whisper.cpp in a terminal tab, in the Setup space. If it asks for your password, answer it there.')
  else if (whisper && v.needsBrew) { text = t("{model} needs whisper.cpp, which comes from Homebrew, and Homebrew isn't on this Mac yet. Or pick Parakeet in Settings › Voice: nothing to install.", { model: model.label }); actions = <button className="btn small primary" onClick={installBrew}>{t('Install Homebrew')}</button> }
  else if (whisper && !v.installCommand) text = t('{model} needs whisper.cpp: install whisper-cli on your computer, then tap the mic again. Or pick Parakeet in Settings › Voice: nothing to install.', { model: model.label })
  else if (whisper) { text = t('{model} needs whisper.cpp, a free program. It installs in a minute.', { model: model.label }); actions = <button className="btn small primary" onClick={setup}>{t('Install it')}</button> }
  else {
    // In your language from what's needed; else the server's own words from its answer.
    text = model.label ? t('Speech to text needs a one-time download: {model}, {mb} MB. It stays on this computer, and so does what you say.', { model: model.label, mb: model.mb }) : initial.ask || t('Speech to text needs a one-time download.')
    if (touch && !audio) text = `${text} ${t("Your keyboard's own mic works meanwhile.")}`
    actions = <button className="btn small primary" onClick={setup}><Icon name="download" size={12} /> {audio ? t('Download, then transcribe') : t('Download')}</button>
  }
  return (
    <div className="voice-setup" role="status" aria-live="polite">
      <p>{text}</p>
      {v.downloading && !v.ready && <span className="vs-bar" role="progressbar" aria-valuenow={v.downloading.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${v.downloading.percent}%` }} /></span>}
      {err && <p className="error-text small">{err}</p>}
      <div className="vs-actions">
        <button className="ghost-btn" onClick={onClose}>{v.ready || started ? t('Close') : t('Not now')}</button>
        {actions}
      </div>
    </div>
  )
}

// The desktop app with the mic turned off for it in System Settings: one button to allow it.
const micAccess = async () => ((await window.bridgeApp.mediaAccess('microphone')) === 'granted' ? 'ok' : 'denied')
export function MicFix({ onClose }) {
  const [ok, setOk] = useState(false)
  return (
    <div className="voice-setup" role="status" aria-live="polite">
      {ok ? <p>{t('The microphone is on. Tap the mic and talk.')}</p>
        : <PermissionFix pane="microphone" probe={micAccess} onCheck={() => setOk(true)}><p>{t('Bridge AI needs the microphone for voice notes. Your audio is turned into text on this computer.')}</p></PermissionFix>}
      <div className="vs-actions"><button className="ghost-btn" onClick={onClose}>{ok ? t('Close') : t('Not now')}</button></div>
    </div>
  )
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
// A file said in dictation (@payments.ts): the one file of that name in the agent's folder, by its
// path there. Left as said when there's none or more than one.
async function mentionFiles(text, url) {
  if (!url) return text
  let out = text
  for (const m of [...text.matchAll(/(^|\s)@([^\s@/"]+\.\w+)/g)].slice(0, 5)) {
    const name = m[2]
    const items = await Promise.race([api(`${url}?q=${encodeURIComponent(name)}`).then((d) => d.items || [], () => []), new Promise((r) => setTimeout(() => r([]), 1500))])
    const hits = items.filter((f) => !f.dir && !f.place && typeof f.path === 'string' && f.path.split('/').pop().toLowerCase() === name.toLowerCase())
    if (hits.length === 1) out = out.replace(`@${name}`, mentionText(hits[0].path))
  }
  return out
}

const SOURCE_LABEL = { skill: tx('skill'), plugin: tx('plugin'), project: tx('project') }

function SlashMenu({ items, sel, onPick, onHover, title, mention, jumps = [] }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.querySelector('.slash-item.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])
  if (!items.length && !jumps.length) return null
  return (
    <div className={`slash-menu ${mention ? 'mention-menu' : ''}`} role="listbox" ref={ref} onMouseDown={(e) => e.preventDefault()}>
      {jumps.length > 0 && (
        <div className="mention-jumps">
          <span>{t('Go to')}</span>
          {jumps.map((j) => <button key={j.key} className="mention-jump" title={j.file.path} onClick={() => onPick(j)}><Icon name={j.label === '..' ? 'chevron' : 'folder'} size={11} className={j.label === '..' ? 'rot-up' : ''} />{j.label === '..' ? t('Up') : j.label}</button>)}
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

// Saved prompts: pick one to put in the box, save what's in the box as one, rename or delete.
const BLANK = /\{\{[^{}\n]{0,40}\}\}/g
function SavedPrompts({ current, onPick, onClose }) {
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [naming, setNaming] = useState(null) // { id?, name } while saving or renaming
  const [err, setErr] = useState(null)
  const ref = useRef(null)
  const load = () => api('/prompts').then((d) => setList(d.prompts)).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [onClose])
  const shown = (list || []).filter((p) => !q || `${p.name}\n${p.text}`.toLowerCase().includes(q.toLowerCase()))
  const saveName = async (e) => {
    e.preventDefault()
    try {
      if (naming.id) await api(`/prompts/${naming.id}`, { method: 'PATCH', body: { name: naming.name } })
      else await api('/prompts', { method: 'POST', body: { name: naming.name, text: current } })
      setNaming(null); load()
    } catch (x) { setErr(x.message) }
  }
  return (
    <div className="saved-pop" ref={ref} role="dialog" aria-label={t('Saved prompts')} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="saved-head">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Saved prompts')} aria-label={t('Find a saved prompt')} />
      </div>
      <div className="saved-list">
        {list && !list.length && <p className="muted small pad">{t('Nothing saved yet. Write a message you send often, then save it below. Use {blank}-style blanks for the parts that change.', { blank: '{{week}}' })}</p>}
        {shown.map((p) => naming?.id === p.id ? (
          <form key={p.id} className="saved-name" onSubmit={saveName}><input autoFocus value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} aria-label={t('Prompt name')} /><button className="btn small">{t('Save')}</button></form>
        ) : (
          <div key={p.id} className="saved-item">
            <button className="saved-pick" onClick={() => { onPick(p); api(`/prompts/${p.id}/used`, { method: 'POST' }).catch(() => {}) }} title={p.text}>
              <b>{p.name}</b><span className="muted small">{p.text.replace(/\s+/g, ' ').slice(0, 90)}</span>
            </button>
            <button className="win-btn" onClick={() => setNaming({ id: p.id, name: p.name })} aria-label={t('Rename {name}', { name: p.name })} title={t('Rename')}><Icon name="edit" size={12} /></button>
            <button className="win-btn" onClick={async () => { if (window.confirm(t('Delete the saved prompt "{name}"?', { name: p.name }))) { await api(`/prompts/${p.id}`, { method: 'DELETE' }).catch(() => {}); load() } }} aria-label={t('Delete {name}', { name: p.name })} title={t('Delete')}><Icon name="trash" size={12} /></button>
          </div>
        ))}
      </div>
      {err && <p className="error-text small pad">{err}</p>}
      {naming && !naming.id
        ? <form className="saved-name saved-foot" onSubmit={saveName}><input autoFocus value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} placeholder={t('Name it, like Weekly update')} aria-label={t('Prompt name')} /><button className="btn small primary" disabled={!naming.name.trim()}>{t('Save')}</button></form>
        : <button className="saved-foot ghost-btn" disabled={!current.trim()} onClick={() => setNaming({ name: '' })} title={current.trim() ? t('Save what you wrote as a prompt') : t('Write something in the message box first')}><Icon name="plus" size={12} /> {t('Save the message box as a prompt')}</button>}
    </div>
  )
}

// tools: more controls for the tools row (the agent's model chip).
export default function Composer({ id, placeholder, onSend, keysOpen, onToggleKeys, busy: agentBusy = false, typeAhead = false, prefill = null, editing = null, onEditChange, onDraft, mirroring = false, onStop, queuedCount = 0, commandsUrl, filesUrl, onInteractive, historyUrl, tools = null }) {
  const [draft, setDraft] = useState(() => loadDraft(id))
  const [note, setNote] = useState(null)
  const [uploading, setUploading] = useState(0)
  const [viewing, setViewing] = useState(null) // index of the attached image shown full size
  const [savedOpen, setSavedOpen] = useState(false)
  const [more, setMore] = useState(false) // the + on a narrow box
  // A saved prompt goes in the box (after what's there); its first {{blank}} is selected to type over.
  const pickSaved = (p) => {
    setSavedOpen(false)
    const before = draft.text.trim() ? `${draft.text.replace(/\s+$/, '')}\n\n` : ''
    const text = before + p.text
    setDraft((d) => ({ ...d, text }))
    requestAnimationFrame(() => {
      const el = taRef.current
      if (!el) return
      el.focus()
      BLANK.lastIndex = before.length
      const m = BLANK.exec(text)
      if (m) { el.selectionStart = m.index; el.selectionEnd = m.index + m[0].length } else el.selectionStart = el.selectionEnd = text.length
    })
  }
  // Tab jumps to the next {{blank}} (wrapping around) while there is one.
  const nextBlank = (el) => {
    const all = [...el.value.matchAll(BLANK)]
    if (!all.length) return false
    const m = all.find((x) => x.index >= el.selectionEnd) || all[0]
    el.selectionStart = m.index
    el.selectionEnd = m.index + m[0].length
    return true
  }
  const taRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => { setDraft(loadDraft(id)); setNote(null); hist.current = null }, [id])
  // Editing a sent message: its text comes into the box; what you had typed is put back after.
  const stash = useRef(null)
  useEffect(() => {
    if (!prefill) return
    // Added to what you're writing (a picture from Preview), not an edit.
    if (prefill.append) {
      // add: goes after what you've written (a file mentioned from Files); otherwise only into an empty box.
      setDraft((d) => ({ text: !d.text.trim() ? prefill.text || '' : prefill.add ? `${d.text.replace(/\s*$/, ' ')}${prefill.text}` : d.text, files: [...d.files, ...(prefill.files || [])] }))
      requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length } })
      return
    }
    if (stash.current == null) stash.current = draft
    setDraft({ text: prefill.text, files: [] })
    requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length } })
  }, [prefill?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  const endEdit = (cancelled) => {
    if (stash.current) setDraft(stash.current)
    stash.current = null
    if (cancelled) onEditChange?.(null)
  }
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
  useEffect(() => { onDraft?.(draft.text) }, [draft.text]) // eslint-disable-line react-hooks/exhaustive-deps
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
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 6000); return () => clearTimeout(t) }, [note])

  // Dictation (dictation/controller.js): the mic button or the dictation key, held to talk or tapped
  // to keep listening. What's said goes in this box at its cursor; a file said as "at payments dot
  // ts" becomes a mention of the one file of that name in the agent's folder.
  const dict = useDictation()
  const mine = dict.target?.kind === 'composer' && dict.target.id === id
  const [voiceSetup, setVoiceSetup] = useState(null)
  const closeVoiceSetup = useCallback(() => { setVoiceSetup(null); dismiss() }, [])
  useEffect(() => { if (mine && dict.setup) setVoiceSetup(dict.setup) }, [mine, dict.setup])
  // What the setup panel turned into text once the model was here: in the box, as dictation does.
  const addSpoken = useCallback((said) => box(id)?.insert(said), [id])
  const [dictated, setDictated] = useState(false)
  useEffect(() => { if (!dictated) return; const t = setTimeout(() => setDictated(false), 1200); return () => clearTimeout(t) }, [dictated])
  const draftRef = useRef(draft)
  draftRef.current = draft
  const filesRef = useRef(filesUrl)
  filesRef.current = filesUrl
  const rootRef = useRef(null)
  useEffect(() => registerBox(id, {
    visible: () => !!rootRef.current?.getClientRects().length,
    insert: async (said, caret) => {
      const text = await mentionFiles(said, filesRef.current)
      const d = draftRef.current
      const a = Math.min(caret?.[0] ?? d.text.length, d.text.length)
      const b = Math.min(Math.max(caret?.[1] ?? a, a), d.text.length)
      const before = d.text.slice(0, a), after = d.text.slice(b)
      const ins = `${before && !/\s$/.test(before) ? ' ' : ''}${text}${after && !/^\s/.test(after) ? ' ' : ''}`
      hist.current = null
      setDraft({ ...draftRef.current, text: before + ins + after })
      setDictated(true)
      requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(a + ins.length, a + ins.length) } })
    },
  }), [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const caretNow = () => { const el = taRef.current; return el ? [el.selectionStart, el.selectionEnd] : null }
  // The mic button: held, it listens until let go (wherever the pointer is by then); a click or a
  // tap keeps listening until ✓.
  const micDown = (e) => {
    if (e.button !== 0 || dict.phase === 'working') return
    e.preventDefault()
    press({ kind: 'composer', id, caret: caretNow() })
    const up = () => { window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); release() }
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
  }
  const [, tick] = useState(0)

  const upload = async (fileList) => {
    for (const f of Array.from(fileList || [])) {
      setUploading((n) => n + 1)
      try {
        const res = await fetch(`${BASE}/api/upload?name=${encodeURIComponent(f.name || 'photo.jpg')}`, { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setDraft((d) => ({ ...d, files: [...d.files, { name: f.name, path: data.path, image: f.type.startsWith('image/'), size: f.size, preview: f.type.startsWith('image/') ? `${BASE}/api/upload/raw?path=${encodeURIComponent(data.path)}` : null }] }))
      } catch (e) { setNote(t('Upload failed: {error}', { error: e.message })) } finally { setUploading((n) => n - 1) }
    }
  }

  // now: while the agent is working, interrupt it and send this straight away instead of queueing.
  const send = async (now = false) => {
    const text = draft.text.trim()
    if (!text && !draft.files.length) return
    // Plain paths, in the order of the chips: Claude turns each into an image in that order, so
    // "image 2" means the same to it as the second chip. (Labels between the paths stop that.)
    const attach = draft.files.length ? `\n\nAttached: ${draft.files.map((f) => f.path).join(' ')}` : ''
    const message = `${text}${attach}`.trim()
    const prev = draft
    pushHist(id, text)
    hist.current = null
    setDraft({ text: '', files: [] })
    saveDraft(id, { text: '', files: [] })
    const wasEditing = !!editing
    const ok = await onSend(message, { now: now === true })
    if (ok === false) setDraft(prev) // keep what you wrote if sending failed
    else if (wasEditing) endEdit(false)
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
      .map(({ c }) => ({ key: c.name, label: `/${c.name}`, description: c.hint ? `${c.description} · ${c.hint}` : c.description, badge: SOURCE_LABEL[c.source] && t(SOURCE_LABEL[c.source]), cmd: c }))
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
  const toItem = (f) => ({ key: `${f.label || ''}:${f.path}`, label: f.label || baseName(f.path) + (f.dir ? '/' : ''), description: f.hint || (mentionQ?.endsWith('/') ? '' : parentOf(f.path)), badge: f.dir && !f.label ? t('folder') : null, file: f })
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
    if (editing && e.key === 'Escape') { e.preventDefault(); endEdit(true); return }
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
    if (e.key === 'Tab' && !e.shiftKey && nextBlank(e.currentTarget)) { e.preventDefault(); return }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.metaKey && recall(e)) { e.preventDefault(); return }
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) { e.preventDefault(); send(agentBusy && (e.metaKey || e.ctrlKey)) }
  }

  const recording = mine && (dict.phase === 'opening' || dict.phase === 'listening')
  const busy = mine && dict.phase === 'working'
  useEffect(() => { if (!recording) return; const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t) }, [recording])
  const secs = recording ? Math.max(0, Math.floor((Date.now() - dict.since) / 1000)) : 0
  const touch = matchMedia('(pointer: coarse)').matches
  const keyName = keyLabel(dictationKey(settings()), keysPlatform())
  const dictNote = mine && dict.phase === 'idle' && !dict.setup && dict.note
  const canSend = !!(draft.text.trim() || draft.files.length) && !uploading
  const attachNums = numbered(draft.files)
  const attachPics = draft.files.filter((f) => f.image && f.preview).map((f) => ({ path: f.path, src: f.preview, name: attachNums.count > 1 ? t('Image {n} · {name}', { n: attachNums.of(f), name: f.name }) : f.name }))
  const status = busy ? t('Transcribing on your computer…') : uploading ? (uploading > 1 ? t('Uploading {n} files…', { n: uploading }) : t('Uploading {n} file…', { n: uploading })) : null

  return (
    <div className="composer-stack">
      {editing && (
        <div className="edit-bar" role="status">
          <Icon name="edit" size={12} />
          <span>{t('Editing a sent message. Sending it takes back everything after it.')}</span>
          {editing.canUndoFiles && <label><input type="checkbox" checked={!!editing.undoFiles} onChange={(e) => onEditChange?.({ ...editing, undoFiles: e.target.checked })} /> {t('Also undo file changes since then')}</label>}
          <button className="link-btn" onClick={() => endEdit(true)}>{t('Cancel')} <kbd>Esc</kbd></button>
        </div>
      )}
      <SlashMenu items={slashItems} sel={slashSel} onHover={setSlashSel} onPick={pickSlash} title={slashTitle} />
      {mentionQ != null && <SlashMenu items={mentionItems} sel={mentionSel} onHover={setMentionSel} onPick={pickMention} title={/^[~/]/.test(mentionQ) ? mentionQ.replace(/[^/]*$/, '') || '~/' : mentionQ.endsWith('/') ? mentionQ : mentionQ ? t('Matching "{query}"', { query: mentionQ }) : `${cwdName || t('This folder')}/`}
        jumps={mentionJumps} mention />}
      {voiceSetup && (voiceSetup.mic ? <MicFix onClose={closeVoiceSetup} /> : <VoiceSetup initial={voiceSetup} onText={addSpoken} onClose={closeVoiceSetup} />)}
      {note && <div className="comp-note" role="status">{note}</div>}
      {dictNote && <div className="comp-note" role="status">{dictNote} {dict.retry && <button className="link-btn" onClick={retry}>{t('Try again')}</button>} <button className="link-btn" onClick={dismiss}>{t('Close')}</button></div>}
      <div ref={rootRef} className={`composer ${recording ? 'rec' : ''} ${dragging ? 'drop' : ''} ${manualH ? 'sized' : ''} ${dictated ? 'dictated' : ''}`} {...dropProps} onPaste={onPaste}>
        <div className="comp-grip" role="separator" aria-orientation="horizontal" aria-label={t('Resize the message box')} title={manualH ? t('Drag to resize · double-click to fit the text again') : t('Drag to make the box taller')}
          onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp} onDoubleClick={() => setManualH(null)}
          tabIndex={0} onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const cur = taRef.current?.offsetHeight || 40; setManualH(Math.max(40, Math.min(window.innerHeight * 0.7, cur + (e.key === 'ArrowUp' ? 40 : -40)))) }
            if (e.key === 'Escape' || e.key === 'Enter') setManualH(null)
          }}><span /></div>
        {draft.files.length > 0 && (
          <div className="attach-row">
            {draft.files.map((f) => {
              const n = attachNums.count > 1 ? attachNums.of(f) : null
              const label = f.image ? (n ? t('Image {n}', { n }) : f.name) : f.name
              return (
                <span key={f.path} className={`attach-chip ${f.image && f.preview ? 'pic' : ''}`} title={f.image ? (n ? t('{name} · click to view. Call it "image {n}" in your message.', { name: f.name, n }) : t('{name} · click to view', { name: f.name })) : f.path}>
                  {f.image && f.preview
                    ? <button type="button" className="attach-view" onClick={() => setViewing(attachPics.findIndex((p) => p.path === f.path))} aria-label={t('View {name}', { name: label })}><img className="attach-thumb" src={f.preview} alt="" />{n && <span className="pic-num">{n}</span>}</button>
                    : <Icon name={f.image ? 'image' : 'file'} size={12} />}
                  <span className="attach-name">{label}</span>
                  <button type="button" aria-label={t('Remove {name}', { name: label })} onClick={() => setDraft((d) => ({ ...d, files: d.files.filter((x) => x.path !== f.path) }))}><Icon name="x" size={11} /></button>
                </span>
              )
            })}
          </div>
        )}
        {viewing != null && attachPics[viewing] && <Lightbox pics={attachPics} at={viewing} onAt={setViewing} onClose={() => setViewing(null)} />}
        {recording ? (
          <div className="rec-bar" role="status" aria-live="polite">
            <span className="rec-dot" />
            <span className="rec-time">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
            <span className="rec-meter"><span style={{ transform: `scaleX(${0.08 + dict.level * 0.92})` }} /></span>
          </div>
        ) : (
          <textarea
            ref={taRef}
            value={draft.text}
            rows={1}
            placeholder={placeholder}
            onChange={(e) => { hist.current = null; setDraft((d) => ({ ...d, text: e.target.value })); trackCaret(e) }}
            onSelect={trackCaret}
            onFocus={() => { loadPast(); noteBoxFocus(id) }}
            onKeyDown={onKeyDown}
            data-composer={id}
          />
        )}
        <div className="comp-tools">
          {recording ? (
            <>
              <span className="comp-hint">{touch ? (dict.mode === 'free' ? t("Listening… tap ✓ when you're done") : t('Talking… let go to add it')) : listeningHint(dict.mode, keyName)}</span>
              <button className="comp-text-btn" onClick={cancel}>{t('Cancel')}</button>
              <button className="send rec-stop" onClick={finish} aria-label={t('Stop and transcribe')} title={t('Stop and transcribe')}><Icon name="check" size={16} /></button>
            </>
          ) : (
            <>
              {/* A narrow box (a phone): attach, saved prompts and the keys under one +. */}
              <span className="comp-more comp-narrow">
                <button className={`comp-btn ${more ? 'on' : ''}`} onClick={() => setMore((v) => !v)} aria-label={t('Attach, saved prompts and keys')} aria-haspopup="menu" aria-expanded={more} title={t('Attach, saved prompts, keys')}><Icon name="plus" size={17} /></button>
                {more && <Menu align="left up" onClose={() => setMore(false)} items={[
                  { icon: 'paperclip', label: t('Attach a photo or file'), run: () => fileRef.current?.click() },
                  { icon: 'star', label: t('Saved prompts'), run: () => setSavedOpen(true) },
                  onToggleKeys && { icon: 'keyboard', label: keysOpen ? t('Hide the keys') : t('Keys: Esc, arrows, 1, 2, 3'), run: onToggleKeys },
                ]} />}
              </span>
              <button className={`comp-btn comp-wide ${keysOpen ? 'on' : ''}`} onClick={onToggleKeys} aria-label={t('Toggle keys')} title={t('Keys (Esc, arrows, 1/2/3…)')}><Icon name="keyboard" size={16} /></button>
              <button className="comp-btn comp-wide" onClick={() => fileRef.current?.click()} aria-label={t('Attach photo or file')} title={t('Attach a photo or file')}><Icon name="paperclip" size={16} /></button>
              <span className="saved-wrap">
                <button className={`comp-btn comp-wide ${savedOpen ? 'on' : ''}`} onClick={() => setSavedOpen((v) => !v)} aria-label={t('Saved prompts')} title={t('Saved prompts')}><Icon name="star" size={16} /></button>
                {savedOpen && <SavedPrompts current={draft.text} onPick={pickSaved} onClose={() => setSavedOpen(false)} />}
              </span>
              <button className={`comp-btn mic-btn ${busy ? 'busy' : ''}`} onPointerDown={micDown} onContextMenu={(e) => e.preventDefault()} disabled={busy} aria-label={t('Dictate')}
                onClick={(e) => { if (e.detail === 0) { press({ kind: 'composer', id, caret: caretNow() }); release() } }}
                title={touch ? t('Hold to talk, or tap and talk. Turned into text on your computer.') : t('Hold to talk, or click and talk. {key} works too. Turned into text on your computer.', { key: keyName })}>
                <Icon name={busy ? 'refresh' : 'mic'} size={16} className={busy ? 'spin' : ''} />
              </button>
              {tools}
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
              <span className={`comp-hint ${status ? 'status' : ''}`}>{status || (agentBusy
                // typeAhead: the agent takes messages while it works, like typing in its terminal.
                ? <span className="busy-hint">{t('Working')}{queuedCount ? ` · ${t('{n} queued', { n: queuedCount })}` : ''}<span className="hide-touch"> · <kbd>⏎</kbd> {typeAhead ? t('send (it picks it up next)') : t('queue')} · <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}⏎</kbd> {t('interrupt and send')}</span></span>
                : mirroring ? <span className="hide-touch">{t("Shows in the agent's input line above as you type")} · <kbd>⏎</kbd> {t('send')}</span>
                : <span className="hide-touch"><kbd>⏎</kbd> {t('send')} · <kbd>⇧⏎</kbd> {t('new line')}</span>)}</span>
              {agentBusy && onStop && <button className="stop-btn" onClick={onStop} title={t('Interrupt the agent (sends Esc)')} aria-label={t('Stop the agent')}><Icon name="stop" size={11} /> {t('Stop')}</button>}
              {agentBusy && canSend && <button className="now-btn" onClick={() => send(true)} title={t('Stop what the agent is doing and send this now')}>{t('Send now')}</button>}
              <button className={`send ${agentBusy && !typeAhead ? 'queue' : ''}`} onClick={() => send(false)} disabled={!canSend} aria-label={editing ? t('Send edit') : agentBusy && !typeAhead ? t('Queue message') : t('Send')}
                title={agentBusy ? (typeAhead ? t('Send: the agent picks it up after its current step (/btw asks a side question)') : t('Queue: sends when the agent is free')) : t('Send')}>
                <Icon name={agentBusy && !typeAhead ? 'clock' : 'send'} size={15} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
