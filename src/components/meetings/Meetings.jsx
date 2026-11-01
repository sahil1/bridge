import { useEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from '../Icon.jsx'
import Lightbox from '../Lightbox.jsx'
import { Menu } from '../Rail.jsx'
import { api, usePoll, onThisComputer, refetch } from '../../api.js'
import { t, tx, locale } from '../../i18n/index.js'
import { usePersisted, Handle, PaneHeader, useMedia } from '../layout.jsx'
import { useMeetings, clock, ScreenButton, SectionButton } from './recording.jsx'
import { byDay, timeOf, useSelection, BulkBar } from './bulk.jsx'
import { useMeetingMenu, foldersOf, ConfirmDelete, FolderPick, chiefSaid } from './actions.jsx'
import { AskPanel, md } from './ask.jsx'
import { FixWord, MemoryPanel, TranscribeAgain, useChatModels, NOTE_LANGS, Dialog } from './tools.jsx'
import { Menu as AtMenu } from '../FileExtras.jsx'
import { FilesPane, linkFiles } from './context.jsx'
import { AssistPane, setAssist } from './assist.jsx'
import PermissionFix from '../PermissionFix.jsx'
import { MicFix } from '../Composer.jsx'
import { sendPicture, pictureUrl } from './screen.js'
import './meetings.css'
import SpeechSetup, { MeetingsSetup } from './SpeechSetup.jsx'

// The meeting pages: the list of meetings, and one meeting with your notes beside its transcript, the
// summary, questions about it, and its action items for the Chief of Staff. The recording itself is
// kept by recording.jsx, so it goes on while you look at anything else.

function Meter({ level = 0, label }) {
  const bars = 5
  const on = Math.min(bars, Math.round(Math.sqrt(level) * bars * 1.4))
  return (
    <span className="mt-meter" title={label} aria-label={t('{label} level', { label })}>
      {Array.from({ length: bars }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}
      <small>{label}</small>
    </span>
  )
}

const span = (ms) => (ms < 90_000 ? t('{n} seconds', { n: Math.max(1, Math.round(ms / 1000)) }) : t('{n} minutes', { n: Math.round(ms / 60_000) }))

// The controls while this meeting records. The call's level comes from the server (data.levels).
// Assist turns AI Assist on or off (onAssist: then shows it).
function RecordingBar({ id, data, onAssist }) {
  const m = useMeetings()
  // A phone stops the mic of an app that isn't in front, or once its screen locks.
  const phone = useMedia('(pointer: coarse)') || !!window.bridgeNative || !!window.bridgeAndroid
  if (m?.rec?.id !== id) return null
  const r = m.rec
  const call = data?.call === 'on' ? 'on' : r.call
  return (
    <div className={`mt-recbar${r.paused ? ' paused' : ''}`} role="group" aria-label={t('Recording')}>
      <span className="rec-dot" aria-hidden="true" />
      <b className="mt-rectime">{clock(m.elapsed)}</b>
      <span className="mt-recstate">{r.paused ? t('Paused') : t('Recording')}</span>
      <Meter level={m.levels.you} label={t('You')} />
      {call === 'on' ? <Meter level={data?.levels?.them} label={t('Call')} /> : <span className="mt-nocall muted small" title={data?.callError || call || ''}>{t('Your mic only')}</span>}
      {m.screen && <span className="mt-watching small" title={t('A picture is kept each time {name} changes', { name: m.screen.label })}><Icon name="eye" size={12} /> {m.screen.label}</span>}
      {data?.sections?.length > 0 && <span className="mt-watching small" title={t("The part of the meeting it's in now")}><Icon name="flag" size={12} /> {data.sections[data.sections.length - 1].title}</span>}
      <span className="mt-grow" />
      <button type="button" className={`btn small mt-assist-btn${data?.assist ? ' on' : ''}`} aria-pressed={!!data?.assist} onClick={() => setAssist(id, !data?.assist).then(() => onAssist?.(!data?.assist), () => {})}
        title={data?.assist ? t('AI Assist is on: it suggests what to ask or check next. Click to turn it off') : t('Turn on AI Assist: while it records, it suggests what to ask or check next, from what\'s said and the files')}><Icon name="bulb" size={13} /> {t('Assist')}</button>
      <ScreenButton m={m} />
      <SectionButton m={m} />
      {r.paused
        ? <button type="button" className="btn small" onClick={m.resume}><Icon name="mic" size={13} /> {t('Resume')}</button>
        : <button type="button" className="btn small" onClick={m.pause}><Icon name="pause" size={13} /> {t('Pause')}</button>}
      <button type="button" className="btn small danger-soft" onClick={m.stop}><Icon name="stop" size={13} /> {t('Stop')}</button>
      {r.trouble && <p className="mt-trouble small" role="status">{r.trouble}</p>}
      {r.missed > 0 && <p className="mt-trouble small mt-missed" role="status">{phone ? t('Not recorded: {time}, while the phone was locked or another app was in front. It carried on after.', { time: span(r.missed) }) : t('Not recorded: {time}, while the computer was asleep or the mic was taken. It carried on after.', { time: span(r.missed) })}</p>}
      {phone && !r.missed && <p className="mt-hint-call muted small">{t('Keep Bridge AI in front while it records: a phone stops the mic of an app in the background.')}</p>}
      {data?.callError && <p className="mt-trouble small" role="status">{data.callError} {t('Your mic still records.')}</p>}
      {call === 'on' && data?.callQuiet && <p className="mt-hint-call muted small" role="status">{t('No sound from the call yet. If one is playing and this stays quiet, allow Bridge AI under System Settings › Privacy & Security › Screen & System Audio Recording, in System Audio Recording Only.')} <button type="button" className="link-btn" onClick={() => api('/fix/settings', { method: 'POST', body: { pane: 'audio' } }).catch(() => {})}>{t('Open it')}</button></p>}
    </div>
  )
}


// A calendar event happening now or starting within 10 minutes, to take notes for.
function useNextEvent() {
  const { data } = usePoll('/calendar', 60_000)
  const events = data?.events || data?.today || []
  const now = Date.now()
  return events.find((e) => e.start && !e.allDay && new Date(e.start).getTime() - now < 10 * 60_000 && (!e.end || new Date(e.end).getTime() > now)) || null
}

// Search: the words in a found meeting's line, marked.
function Marked({ text, terms }) {
  if (!terms?.length) return text
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return String(text).split(new RegExp(`(${esc.join('|')})`, 'gi')).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}
const WHERE = { people: tx('With'), summary: tx('Summary'), notes: tx('Your notes'), screen: tx('On the screen'), files: tx('Files') }

// Search finds words anywhere in a meeting (the server looks through transcripts, summaries and your
// notes), and shows the line it found them in. Archived meetings only when looking in the archive.
function useSearch(q, archived = false) {
  const [hits, setHits] = useState(null) // { results: Map(id -> hit), terms }
  useEffect(() => {
    if (!q.trim()) { setHits(null); return }
    let on = true
    const t = setTimeout(() => api(`/meetings/search?q=${encodeURIComponent(q.trim())}${archived ? '&archived=1' : ''}`).then((r) => on && setHits({ q, archived, results: new Map(r.results.map((x) => [x.id, x])), terms: r.terms || [] })).catch(() => {}), 200)
    return () => { on = false; clearTimeout(t) }
  }, [q, archived])
  return hits?.archived === archived ? hits : null
}

const SETUP = 'cc-meet-setup'
const ASK_ALL = [tx('What did I agree to do this week?'), tx("What's still open from this week?"), tx('Write my weekly update from these meetings')]
const ASK_ONE = [tx('Draft a follow-up email'), tx('What did I agree to do?'), tx("What's still open?")]

export function MeetingsHome({ onOpen }) {
  const m = useMeetings()
  const { data, error } = usePoll('/meetings', 5000)
  const [q, setQ] = useState('')
  const [err, setErr] = useState(null)
  const next = useNextEvent()
  // Which meetings: every one that isn't archived, one folder's, or the archived ones.
  const [place, setPlace] = useState('') // '' | a folder's name | ':archived'
  const all = data?.meetings || []
  const folders = foldersOf(all.filter((x) => !x.archived))
  const archivedN = all.filter((x) => x.archived).length
  useEffect(() => { if (data && place && (place === ':archived' ? !archivedN : !folders.includes(place))) setPlace('') }, [data, place, archivedN, folders.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const hits = useSearch(q, place === ':archived')
  const [memory, setMemory] = useState(false)
  const list = all.filter((x) => (place === ':archived' ? x.archived : !x.archived && (!place || x.folder === place))).filter((x) => !q.trim() || !hits || hits.results.has(x.id))
  // What was asked for last, to carry on once the mic is allowed (MicFix).
  const last = useRef(null)
  const go = async (o) => { setErr(null); last.current = o; try { const id = await m.start(o); onOpen?.(id) } catch (e) { setErr(e) } }
  const groups = byDay(list)
  const selection = useSelection(list)
  const { sel, toggle } = selection
  const menu = useMeetingMenu({ list: all, onOpen: (id) => onOpen?.(id), onGone: () => selection.clear() })
  const n = all.length - archivedN
  // The first time (no meetings yet): the setup, until Done or Later.
  const [setupDone, setSetupDone] = useState(() => { try { return localStorage.getItem(SETUP) === '1' } catch { return false } })
  const first = data && !all.length && !setupDone && !m?.rec
  const doneSetup = () => { setSetupDone(true); try { localStorage.setItem(SETUP, '1') } catch { /* no storage: it shows again next time */ } }
  return (
    <div className="mt-view">
      <PaneHeader icon="mic" title={t('Meetings')} subtitle={(
        <>
          <span className="sub-where mt-when">{data ? (n === 1 ? t('{n} meeting', { n }) : t('{n} meetings', { n })) : t('Meetings')}</span>
          {data?.folder && <button type="button" className="path-chip" onClick={() => api('/meetings/folder/open', { method: 'POST' }).catch((e) => setErr(e))} onContextMenu={(e) => { e.preventDefault(); navigator.clipboard?.writeText(data.folder) }} title={`${t('Where notes are saved: {path}', { path: data.folder })}\n${t('Click to open it; right-click to copy')}`}><Icon name="folder" size={10} /> <span>{data.folder.replace(/^\/Users\/[^/]+/, '~')}</span></button>}
        </>
      )}>
        <button type="button" className="btn small" onClick={() => setMemory(true)} title={t("The names and terms in your meetings: how they're spelled, how they get misheard, who they are")}><Icon name="book" size={13} /> {t('Memory')}</button>
        {!m?.rec && <button type="button" className="btn small primary" onClick={() => go({})}><Icon name="mic" size={13} /> {t('Start recording')}</button>}
      </PaneHeader>
    <div className="mt-home">
      {memory && <MemoryPanel onClose={() => setMemory(false)} />}
      {first ? <MeetingsSetup onDone={doneSetup} /> : <SpeechSetup recording={!!m?.rec} />}
      {next && !m?.rec && (
        <div className="mt-next">
          <Icon name="calendar" size={15} />
          <div><b>{next.title}</b><span className="muted small">{timeOf(next.start)}{next.attendees?.length ? ` · ${t('{n} people', { n: next.attendees.length })}` : ''}</span></div>
          <button type="button" className="btn small primary" onClick={() => go({ title: next.title, event: next })}>{t('Take notes')}</button>
        </div>
      )}
      {err && (err.code === 'mic' ? <MicFix stale={err.stale} onClose={() => setErr(null)} onAllowed={() => go(last.current || {})} /> : <p className="error-text small" role="alert">{err.message}</p>)}
      {error && !data && <p className="error-text small">{error}</p>}
      {data && !all.length && !first && (
        <div className="mt-empty">
          <Icon name="mic" size={22} />
          <p><b>{t('Record a meeting, get notes you can act on.')}</b></p>
          <p className="muted small">{t("Your mic and the call's sound, turned into a transcript as you talk, then a summary with decisions and action items. Write your own notes alongside if you like; they shape the summary.")}</p>
        </div>
      )}
      {n > 0 && (
        <AskPanel path="/meetings/ask" body={sel.size ? { ids: [...sel] } : null} onOpen={onOpen} className="mt-askall"
          placeholder={sel.size ? t('Ask about the {n} picked', { n: sel.size }) : t('Ask about your meetings')} suggestions={ASK_ALL} />
      )}
      {(folders.length > 0 || archivedN > 0) && (
        <div className="mt-places" role="tablist" aria-label={t('Which meetings')}>
          <button type="button" role="tab" aria-selected={!place} className={!place ? 'on' : ''} onClick={() => setPlace('')}>{t('All')}</button>
          {folders.map((f) => <button key={f} type="button" role="tab" aria-selected={place === f} className={place === f ? 'on' : ''} onClick={() => setPlace(f)}><Icon name="folder" size={12} /> {f}</button>)}
          {archivedN > 0 && <button type="button" role="tab" aria-selected={place === ':archived'} className={place === ':archived' ? 'on' : ''} onClick={() => setPlace(':archived')} title={t('Left out of search and of questions about your meetings')}><Icon name="archive" size={12} /> {t('Archived')} · {archivedN}</button>}
        </div>
      )}
      {all.length > 0 && <input className="mt-search" type="search" placeholder={place === ':archived' ? t('Search the archive') : t('Search what was said, your notes and summaries')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Search meetings')} />}
      {q.trim() && hits?.q === q && !list.length && <p className="muted small">{t('Nothing matches "{q}".', { q: q.trim() })}</p>}
      {list.length > 1 && (
        <div className="mt-pickbar muted small">
          <button type="button" className="link-btn" onClick={sel.size === list.length ? selection.clear : selection.all}>{sel.size === list.length ? t('Unpick all') : t('Pick all')}</button>
          {!sel.size && <span> · {t('or tick a few, to save, send, ask about or delete them together')}</span>}
        </div>
      )}
      {groups.map((g) => (
        <section key={g.d} className="mt-group">
          <h3>{g.d}</h3>
          {g.items.map((x) => {
            const hit = q.trim() && hits?.results.get(x.id)
            return (
              <div key={x.id} className={`mt-row${sel.has(x.id) ? ' picked' : ''}`}>
                <input type="checkbox" className="mt-pick" checked={sel.has(x.id)} onChange={(e) => toggle(x.id, { range: e.nativeEvent.shiftKey })} aria-label={t('Pick {title}', { title: x.title })} />
                <button type="button" className="mt-row-open" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) { toggle(x.id, { range: e.shiftKey }); return } onOpen?.(x.id) }} onContextMenu={(e) => menu.open(e, x)}>
                  <span className="mt-row-main">
                    <b>{hit?.where === 'title' ? <Marked text={x.title} terms={hits.terms} /> : x.title}</b>
                    <span className="muted small">{timeOf(x.startedAt)} · {x.status === 'recording' ? t('recording') : x.status === 'paused' ? t('paused') : clock(x.seconds || 0)}{x.event?.attendees?.length ? ` · ${t('{n} people', { n: x.event.attendees.length })}` : ''}{!place && x.folder ? <span className="mt-in"> · <Icon name="folder" size={10} /> {x.folder}</span> : null}</span>
                    {hit?.snippet && <span className="mt-hit small"><b>{hit.where === 'transcript' ? `${hit.who} ${hit.t}` : t(WHERE[hit.where])}</b> <Marked text={hit.snippet} terms={hits.terms} /></span>}
                  </span>
                  {x.status === 'recording' && <span className="rec-dot" aria-label={t('Recording')} />}
                  {x.status === 'transcribing' && <span className="muted small">{t('finishing…')}</span>}
                  {x.hasSummary && <Icon name="sparkle" size={13} className="muted" />}
                </button>
              </div>
            )
          })}
        </section>
      ))}
      <BulkBar selection={selection} list={all} />
      {menu.msg && <p className={`small ${menu.msg.error ? 'error-text' : 'muted'}`} role="status">{menu.msg.text}</p>}
      {menu.node}
    </div>
    </div>
  )
}

// One line of the transcript: who, when, what. Edit it in place; a line you edited, one meeting
// memory or the cleanup fixed, one with the call's words cut out of it (your mic heard the call), or
// one the cleanup left out says what was heard (and an edit or a fix can be undone). Click who said
// it to name them. me: your name, for your lines (You until Settings has it).
const markOf = (l) => (l.edited ? [tx('edited'), tx('Heard: {text}')]
  : l.dropped ? [tx('left out'), tx("Left out by the cleanup: nobody said it, or it's the call heard by your mic. Heard: {text}")]
    : l.cleaned ? [tx('cleaned up'), tx('Fixed by the cleanup, from what the meeting is about. Heard: {text}')]
      : l.fixed ? [tx('fixed'), tx('Heard: {text}')]
        : l.trimmed ? [tx('trimmed'), tx('Your mic heard the call too, so what they said is left out of your line. Heard: {text}')] : null)
function Line({ l, id, me, onSaved, onError, onWho }) {
  const [edit, setEdit] = useState(null)
  const [note, setNote] = useState(null) // a note at this line's time, while it's written
  const put = async (text) => {
    try { await api(`/meetings/${encodeURIComponent(id)}/lines`, { method: 'PATCH', body: { key: l.key, text } }); setEdit(null); onSaved() } catch (e) { onError(e.message) }
  }
  const unclean = async () => {
    try { await api(`/meetings/${encodeURIComponent(id)}/cleanup/undo`, { method: 'POST', body: { key: l.key } }); onSaved() } catch (e) { onError(e.message) }
  }
  const mark = markOf(l)
  const addNote = async () => {
    if (!note?.trim()) { setNote(null); return }
    try { await api(`/meetings/${encodeURIComponent(id)}/note`, { method: 'POST', body: { text: note, at: l.t0 } }); setNote(null); onSaved() } catch (e) { onError(e.message) }
  }
  return (
    <div className={`mt-line ${l.src}${l.edited ? ' edited' : ''}${l.dropped ? ' dropped' : ''}`}>
      <button type="button" className={`mt-who${l.name ? ' named' : ''}${l.guess ? ' guess' : ''}`} disabled={!l.key || !onWho} onClick={(e) => onWho?.(e, l)}
        title={l.name ? (l.byVoice ? t('{name}: known by their voice. Click to change', { name: l.name }) : l.guess ? t('{name}: worked out from the meeting. Click to change', { name: l.name }) : t('{name}. Click to change', { name: l.name })) : l.voice && !l.me ? t('Speaker {n}, told apart by voice. Click to name them, once for all their lines', { n: l.voice }) : t('Who said it? Click to name them')}>{l.name || (l.me ? me || t('You') : l.voice ? t('Speaker {n}', { n: l.voice }) : l.src === 'them' ? t('Them') : me || t('You'))}</button>
      <span className="mt-t">{clock(l.t0)}</span>
      {l.key && edit == null && (
        <span className="mt-line-acts">
          {l.edited && <button type="button" className="link-btn small" onClick={() => put(null)} title={t('Heard: {text}', { text: l.heard })}>{t('Undo')}</button>}
          {!l.edited && (l.cleaned || l.dropped) && <button type="button" className="link-btn small" onClick={unclean} title={t('Heard: {text}', { text: l.heard })}>{l.dropped ? t('Put back') : t('Undo')}</button>}
          <button type="button" className="ghost-btn" onClick={() => setNote('')} aria-label={t('Add a note here')} title={t('Add a note at {time}', { time: clock(l.t0) })}><Icon name="plus" size={12} /></button>
          <button type="button" className="ghost-btn" onClick={() => setEdit(l.text)} aria-label={t('Edit this line')} title={t('Edit this line')}><Icon name="edit" size={12} /></button>
        </span>
      )}
      {edit != null ? (
        <span className="mt-text mt-line-edit">
          <textarea value={edit} onChange={(e) => setEdit(e.target.value)} autoFocus rows={Math.min(6, Math.ceil(edit.length / 70) + 1)} aria-label={t('Line text')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); put(edit) } if (e.key === 'Escape') setEdit(null) }} />
          <span className="mt-line-edit-acts"><button type="button" className="btn small primary" onClick={() => put(edit)}>{t('Save')}</button><button type="button" className="ghost-btn" onClick={() => setEdit(null)}>{t('Cancel')}</button></span>
        </span>
      ) : (
        <span className="mt-text">{l.text}{mark && <span className="mt-fixed" title={t(mark[1], { text: l.heard })}>{t(mark[0])}</span>}</span>
      )}
      {note != null && (
        <input className="mt-line-note" value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder={t('A note at {time}, Enter to keep it', { time: clock(l.t0) })} aria-label={t('A note at {time}', { time: clock(l.t0) })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNote() } if (e.key === 'Escape') setNote(null) }} onBlur={() => { if (!note.trim()) setNote(null) }} />
      )}
    </div>
  )
}

// Your notes stamped with a time ("- [12:04] ..."), from a quick note or a note on a line.
const STAMP = /^\s*[-*]\s*\[((?:\d+:)?\d{1,2}:\d{2})\]\s+(.+)$/
const secs = (c) => c.split(':').map(Number).reduce((a, b) => a * 60 + b, 0)
const stamped = (notes) => String(notes || '').split('\n').map((x) => STAMP.exec(x)).filter(Boolean).map((x) => ({ t: secs(x[1]), text: x[2] }))
// The pictures your notes show ("![...](captures/...)").
const inNotes = (notes) => [...String(notes || '').matchAll(/!\[[^\]]*\]\(<?(captures\/[^)\s>]+)>?\)/g)].map((x) => x[1])

// Where a section starts in the transcript (New section, while it recorded): its name, changed in
// place, and x to take it out (what was said in it goes to the one before).
function SectionHead({ id, s, i, onChange, onError }) {
  const [name, setName] = useState(null)
  const cancel = useRef(false)
  const save = async () => {
    if (name == null) return
    if (cancel.current || !name.trim() || name.trim() === s.title) { cancel.current = false; setName(null); return }
    try { await api(`/meetings/${encodeURIComponent(id)}/sections/${i}`, { method: 'PATCH', body: { title: name } }); setName(null); onChange() } catch (e) { onError(e.message) }
  }
  const remove = async () => { try { await api(`/meetings/${encodeURIComponent(id)}/sections/${i}`, { method: 'DELETE' }); onChange() } catch (e) { onError(e.message) } }
  return (
    <div className="mt-sec">
      <Icon name="flag" size={12} />
      {name != null
        ? <input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label={t('Section name')} maxLength={120} onKeyDown={(e) => { if (e.key === 'Escape') cancel.current = true; if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }} onBlur={save} />
        : <button type="button" className="mt-sec-name" onClick={() => setName(s.title)} title={t('Click to rename')}>{s.title}</button>}
      <span className="mt-t">{clock(s.t)}</span>
      <span className="mt-grow" />
      <button type="button" className="ghost-btn" onClick={remove} aria-label={t('Take out {name}', { name: s.title })} title={t('Take this section out. What was said in it goes to the section before.')}><Icon name="x" size={12} /></button>
    </div>
  )
}

// A picture of the screen in the transcript, at its time: the words read on it, and its note.
function Picture({ id, c, onOpen, onChange, onError }) {
  const [note, setNote] = useState(null)
  const cancel = useRef(false)
  // Saved when the box loses focus (Enter does that); Escape leaves it as it was.
  const save = async () => {
    if (note == null) return
    if (cancel.current || note === c.note) { cancel.current = false; setNote(null); return }
    try { await api(`/meetings/${encodeURIComponent(id)}/captures/${c.id}`, { method: 'PATCH', body: { note } }); setNote(null); onChange() } catch (e) { onError(e.message) }
  }
  const remove = async () => { if (!window.confirm(t('Remove this picture from the meeting?'))) return; try { await api(`/meetings/${encodeURIComponent(id)}/captures/${c.id}`, { method: 'DELETE' }); onChange() } catch (e) { onError(e.message) } }
  return (
    <figure className="mt-pic">
      <button type="button" className="mt-pic-img" onClick={onOpen} aria-label={t('The screen at {time}, larger', { time: clock(c.t) })}><img src={pictureUrl(id, c)} alt={c.note || t('The screen at {time}', { time: clock(c.t) })} loading="lazy" /></button>
      <figcaption>
        <span className="mt-t">{clock(c.t)}</span>
        {note != null
          ? <input value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder={t('What it shows')} aria-label={t('A note on this picture')} onKeyDown={(e) => { if (e.key === 'Escape') cancel.current = true; if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }} onBlur={save} />
          : <button type="button" className="mt-pic-note" onClick={() => setNote(c.note || '')} title={t('Add a note on what it shows')}>{c.note || (c.kind === 'auto' ? t('The screen changed') : t('Captured'))}{c.source ? <small> · {c.source}</small> : null}</button>}
        <span className="mt-grow" />
        {c.read === 'reading' && <small className="muted">{t('Reading it…')}</small>}
        <button type="button" className="ghost-btn" onClick={remove} aria-label={t('Remove this picture')} title={t('Remove')}><Icon name="trash" size={12} /></button>
      </figcaption>
      {c.text && <details className="mt-pic-text"><summary className="small muted">{t('The words on it')}</summary><p className="small">{c.text}</p></details>}
    </figure>
  )
}

const modelName = (models, id) => models?.find((x) => x.id === id)?.label || id

// The summary up to the end of its action items, and the rest, so Send action items to Chief of
// Staff goes right under them: under ## Action items, or the first heading with a checklist when the
// notes are in another language (as the server finds them). n: how many there are.
function atActions(summary) {
  const parts = String(summary || '').split(/\n(?=##\s)/)
  let i = parts.findIndex((x) => /^\s*##\s*Action items/i.test(x))
  if (i < 0) i = parts.findIndex((x) => /^\s*##\s/.test(x) && /^\s*[-*]\s*\[ \]/m.test(x))
  const n = i < 0 ? 0 : (parts[i].match(/^\s*[-*]\s*\[ \]/gm) || []).length
  return n ? { head: parts.slice(0, i + 1).join('\n'), tail: parts.slice(i + 1).join('\n'), n } : null
}

// What a summary was written from (the server's summaryFrom), each opening where it is.
function WrittenFrom({ from, onView }) {
  const chips = [
    from.notes > 0 && { key: 'notes', label: `${t('Your notes')} · ${from.notes}`, view: 'mine', mine: true },
    from.screen > 0 && { key: 'screen', label: `${t('The screen')} · ${from.screen}`, view: 'files' },
    from.pictures > 0 && { key: 'pictures', label: `${t('Pictures')} · ${from.pictures}`, view: 'files' },
    from.files > 0 && { key: 'files', label: `${t('Files')} · ${from.files}`, view: 'files' },
    from.invite && { key: 'invite', label: t('The invite') },
    { key: 'transcript', label: t('Transcript'), view: 'transcript' },
  ].filter(Boolean)
  if (chips.length < 2) return null // the transcript alone: nothing to point out
  return (
    <p className="mt-from small" data-from={chips.map((c) => c.key).join(' ')}>
      <span className="muted">{t('Written from')}</span>
      {chips.map((c) => (c.view
        ? <button key={c.key} type="button" className={`mt-from-chip${c.mine ? ' mine' : ''}`} onClick={() => onView(c.view)}>{c.label}</button>
        : <span key={c.key} className="mt-from-chip">{c.label}</span>))}
    </p>
  )
}

// The meeting, in a tab: a header like an agent's (its name, then when, how long, who and where
// its notes are saved, each changed or opened in place; its state, the views, Save and the rest in
// ⋯), then the view: the summary, your notes, the transcript or its files, with the transcript
// beside the first three on a wide screen. Each has its own Copy. While it records, your notes stay
// in view whatever else you look at: beside it on a wide screen, above it on a phone.
const VIEWS = [['summary', 'sparkle', tx('Summary')], ['assist', 'bulb', tx('Assist')], ['mine', 'edit', tx('My notes')], ['transcript', 'chat', tx('Transcript')], ['files', 'paperclip', tx('Files')]]
const here = onThisComputer
const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~')
// For <input type="datetime-local">: the time where you are.
const localInput = (iso) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

export function MeetingPage({ id, onBack }) {
  const m = useMeetings()
  const live = m?.rec?.id === id
  const { data, refresh } = usePoll(`/meetings/${encodeURIComponent(id)}`, live ? 1500 : 4000)
  const { data: list } = usePoll('/meetings', 60_000)
  const models = useChatModels()
  const wide = useMedia('(min-width: 761px)')
  const touch = useMedia('(pointer: coarse)')
  const [view, setView] = useState(null) // summary | assist | mine | transcript | files
  const [showLeft, setShowLeft] = useState(false) // the lines the cleanup left out, shown
  const [calWhy, setCalWhy] = useState(null) // why the calendar couldn't be read: calendarAccess, ...
  const [calAgain, setCalAgain] = useState(0)
  const [split, setSplit] = usePersisted('cc-mt-split', true) // the transcript beside the view (wide)
  const [notes, setNotes] = useState(null)
  const [title, setTitle] = useState(null)
  const [when, setWhen] = useState(null) // the date and time, while it's changed
  const [people, setPeople] = useState(null) // who was there, while it's changed
  const [opts, setOpts] = useState(null) // { language, model, kind } for the next summary
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [menu, setMenu] = useState(false)
  const [fix, setFix] = useState(null) // { from } while fixing a word
  const [sel, setSel] = useState(null) // { text, top, left }: words picked in the transcript
  const [dialog, setDialog] = useState(null) // 'again' | 'memory' | 'delete' | 'folder'
  const [whoAt, setWhoAt] = useState(null) // { x, y, l }: the menu for who said a line
  const [naming, setNaming] = useState(null) // { l, name }: a name typed for a line
  const [events, setEvents] = useState(null) // calendar events around when it was recorded
  const [evMenu, setEvMenu] = useState(null) // { x, y }
  const [tw, setTw] = usePersisted('cc-mt-transcript-w', 0) // the transcript's width, once dragged
  const [big, setBig] = useState(null) // the picture shown full size (an index in pics)
  const [dropping, setDropping] = useState(false)
  const mineRef = useRef(null)
  const colsRef = useRef(null)
  const saveT = useRef(null)
  const known = useRef(null) // the notes as the server last had them
  const listRef = useRef(null)
  const tRef = useRef(null)
  const pinned = useRef(true)
  // What was last sent for the name, the time and who: a change is compared with that, not with
  // the page's copy of the meeting, which can be a moment behind.
  const sent = useRef({})
  const focused = useRef(null) // the meeting whose notes got the cursor as it recorded
  const wasRecording = useRef(false)
  // Voices in a room: whether they can be told apart here, and Who spoke's answer once it's done.
  const { data: vst } = usePoll(data && !(data.transcript || []).some((l) => l.src === 'them' && l.text) ? '/meetings/voices' : null, 60_000)
  const told = useRef(null) // when Who spoke was asked: the voices' time before
  useEffect(() => {
    if (!told.current || !data || data.voicesWork) return
    if ((data.voices?.at || null) === told.current.at) return
    told.current = null
    const n = data.voices?.speakers || 0
    setMsg({ text: n >= 2 ? t('Told {n} voices apart. Click Speaker on a line to name them, once for all their lines.', { n }) : t('Only one voice was heard clearly, so the lines stay as they are.') })
  }, [data?.voicesWork, data?.voices?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setNotes(null); setTitle(null); setWhen(null); setPeople(null); setView(null); setOpts(null); setSel(null); setMenu(false); setWhoAt(null); setNaming(null); known.current = null; sent.current = {} }, [id])
  // While it records, your notes are in view whatever else is (pinned); after, it leads with the
  // summary again, whatever was picked while it recorded (unless you're still writing your notes).
  const isRecording = data?.status === 'recording' || data?.status === 'paused'
  useEffect(() => {
    if (wasRecording.current && !isRecording) setView(mineRef.current && document.activeElement === mineRef.current ? 'mine' : null)
    wasRecording.current = isRecording
  }, [isRecording])
  // The cursor in your notes, ready to write, once as it records (not on a phone, where that would
  // bring up the keyboard over the meeting; nor while you're typing somewhere else).
  useEffect(() => {
    const el = mineRef.current
    if (!isRecording || !wide || touch || focused.current === id || !el || !el.offsetParent) return
    const a = document.activeElement
    if (a && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return
    focused.current = id
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [isRecording, wide, touch, id, data?.notes != null]) // eslint-disable-line react-hooks/exhaustive-deps
  // Recorded without the calendar event it was for: the events around then, to take its people from.
  const noPeople = !!data && !(data.event?.attendees || []).length
  // When the calendar can't be read (Bridge AI isn't allowed to yet), that's said, with Allow access.
  useEffect(() => {
    setEvents(null)
    setCalWhy(null)
    if (!noPeople) return
    let on = true
    api(`/meetings/${encodeURIComponent(id)}/events`).then((r) => on && setEvents(r.events || [])).catch((e) => { if (on) { setEvents([]); setCalWhy(e.code || null) } })
    return () => { on = false }
  }, [id, noPeople, calAgain])
  useEffect(() => { if (data && !opts) setOpts({ language: data.summaryLanguage || 'auto', model: data.summaryModelPick || '', kind: data.kind || 'general' }) }, [data, opts])
  // Notes added somewhere else (the floating card, the top bar) come in: as they are when you
  // haven't typed since, else added to the end of what you're writing.
  useEffect(() => {
    if (!data) return
    const server = data.notes || ''
    if (known.current === null) { known.current = server; setNotes(server); return }
    if (server === known.current) return
    const was = known.current
    known.current = server
    setNotes((n) => (n === was ? server : server.startsWith(was) ? n + server.slice(was.length) : n))
  }, [data?.notes]) // eslint-disable-line react-hooks/exhaustive-deps
  // The transcript follows along while you're at its end.
  useEffect(() => { const el = listRef.current; if (el && pinned.current) el.scrollTop = el.scrollHeight }, [data?.transcript?.length, view, split])

  const editNotes = (v) => {
    setNotes(v)
    clearTimeout(saveT.current)
    saveT.current = setTimeout(async () => {
      try {
        const r = await api(`/meetings/${encodeURIComponent(id)}/notes`, { method: 'PUT', body: { text: v, base: known.current } })
        known.current = r.notes
        if (r.notes !== v) setNotes((n) => (n === v ? r.notes : n))
      } catch { /* kept here; saved with the next change */ }
    }, 600)
  }
  const patch = (body) => api(`/meetings/${encodeURIComponent(id)}`, { method: 'PATCH', body }).then(() => { refresh(); refetch('/meetings') }).catch((e) => setMsg({ error: true, text: e.message }))
  const saveTitle = () => { if (title != null && title.trim() && title !== (sent.current.title ?? data?.title)) { sent.current.title = title; patch({ title }) } }
  const saveWhen = () => {
    const v = when
    setWhen(null)
    if (!v || !Date.parse(v)) return
    const iso = new Date(v).toISOString()
    if (iso !== new Date(sent.current.startedAt ?? data.startedAt).toISOString()) { sent.current.startedAt = iso; patch({ startedAt: iso }) }
  }
  const savePeople = () => {
    const v = people
    setPeople(null)
    if (v == null) return
    const list = v.split(',').map((x) => x.trim()).filter(Boolean).join(', ')
    if (list !== (sent.current.people ?? (data.event?.attendees || []).join(', '))) { sent.current.people = list; patch({ people: list.split(', ') }) }
  }
  const act = async (name, fn) => {
    setBusy(name); setMsg(null)
    try { const r = await fn(); refresh(); return r } catch (e) { setMsg({ error: true, text: e.message }) } finally { setBusy(null) }
  }
  const summarize = () => act('summary', () => api(`/meetings/${encodeURIComponent(id)}/summary`, { method: 'POST', body: { kind: opts?.kind, model: opts?.model || undefined, language: opts?.language } }).then(() => setView('summary')))
  const toChief = () => act('chief', async () => { const r = await api(`/meetings/${encodeURIComponent(id)}/chief`, { method: 'POST' }); setMsg({ text: chiefSaid(r) }) })
  const save = () => act('save', async () => { const r = await api(`/meetings/${encodeURIComponent(id)}/save`, { method: 'POST' }); setMsg({ text: r.files?.length > 1 ? t('Saved to {path} and its transcript', { path: tilde(r.file) }) : t('Saved to {path}', { path: tilde(r.file) }) }) })
  const reveal = () => act('reveal', () => api(`/meetings/${encodeURIComponent(id)}/reveal`, { method: 'POST' }))
  const copy = async (text, done) => { try { await navigator.clipboard.writeText(text); setMsg({ text: done }) } catch { setMsg({ error: true, text: t("Couldn't copy") }) } }
  const remove = () => setDialog('delete')
  const archive = (on) => act('archive', async () => { await api(`/meetings/${encodeURIComponent(id)}`, { method: 'PATCH', body: { archived: on } }); setMsg({ text: on ? t("Archived. It's under Archived in the list, and left out of search.") : t('Back in the list.') }) })
  // Who said a line: a name (null: back to You or Them). The first one named offers the same name
  // for every line from the call (a call with one other person).
  const nameLine = (l, name) => act('who', async () => {
    await api(`/meetings/${encodeURIComponent(id)}/speakers`, { method: 'PATCH', body: { key: l.key, name } })
    const others = lines.filter((x) => x.src === 'them' && x.key !== l.key && !x.name).length
    setMsg(name && l.src === 'them' && others ? { text: t('{name} said that.', { name }), act: { label: t('{name} said all {n} lines from the call', { name, n: others + 1 }), run: () => act('who', async () => { const r = await api(`/meetings/${encodeURIComponent(id)}/speakers`, { method: 'PATCH', body: { key: l.key, name, all: true } }); setMsg({ text: t('{name} said {n} lines.', { name, n: r.named }) }) }) } } : null)
  })
  // In a room: a voice named once names every line of theirs (null: back to Speaker n).
  const nameVoice = (n, who) => act('who', async () => {
    await api(`/meetings/${encodeURIComponent(id)}/voices/${n}`, { method: 'PATCH', body: who })
    const k = lines.filter((x) => x.voice === n).length
    setMsg({ text: who.me ? t('That was you: {n} lines.', { n: k }) : who.name ? t('{name} said {n} lines.', { name: who.name, n: k }) : t('Back to Speaker {n}.', { n }) })
  })
  // Who spoke, in a room: the voices told apart (the model downloaded first, once), then named.
  const tellVoices = () => act('who', async () => {
    told.current = { at: data.voices?.at || null }
    const r = await api(`/meetings/${encodeURIComponent(id)}/voices`, { method: 'POST' })
    setMsg({ text: r.working?.state === 'downloading' ? t("Downloading the voice model ({mb} MB, once), then telling the voices apart. It all stays on this computer.", { mb: vst?.mb || 30 }) : t('Telling the voices apart, on this computer…') })
  })
  const nameAll = () => act('who', async () => {
    setMsg({ text: t('Working out who said each line from the call…') })
    const r = await api(`/meetings/${encodeURIComponent(id)}/speakers`, { method: 'POST', body: { model: opts?.model || undefined } })
    setMsg({ text: r.named ? t("Named who said {n} of the {total} lines from the call. A line it couldn't place stays Them; click a name to change it.", { n: r.named, total: r.of }) : t("It couldn't tell who said which line. Click Them on a line to name them.") })
  })
  const cleanUp = () => act('clean', async () => {
    setMsg({ text: t('Cleaning up the transcript: fixing misheard words and names, and leaving out what nobody said…') })
    const r = await api(`/meetings/${encodeURIComponent(id)}/cleanup`, { method: 'POST', body: { model: opts?.model || undefined } })
    setMsg({ text: r.fixed || r.dropped ? t('Fixed {n} lines and left out {left}. Each says what was heard; Undo puts one back.', { n: r.fixed, left: r.dropped }) : t('Nothing needed fixing.') })
  })
  const uncleanAll = () => act('clean', async () => { await api(`/meetings/${encodeURIComponent(id)}/cleanup/undo`, { method: 'POST', body: {} }); setMsg({ text: t('The transcript is back to what was heard.') }) })
  const takeEvent = (ev) => act('event', async () => { await api(`/meetings/${encodeURIComponent(id)}/event`, { method: 'POST', body: { event: ev } }); setMsg({ text: ev.attendees?.length ? t('Took the {n} people invited to "{title}" from your calendar.', { n: ev.attendees.length, title: ev.title }) : t('Took the details of "{title}" from your calendar.', { title: ev.title }) }) })
  // Words picked in the transcript: a Fix button by them.
  const picked = () => setTimeout(() => {
    const s = window.getSelection()
    const text = s?.toString().replace(/\s+/g, ' ').trim()
    if (!text || text.length < 2 || text.length > 60 || !s.rangeCount || !listRef.current?.contains(s.anchorNode)) { setSel(null); return }
    const r = s.getRangeAt(0).getBoundingClientRect(), box = tRef.current.getBoundingClientRect()
    setSel({ text, top: r.bottom - box.top + 6, left: Math.max(0, Math.min(r.left - box.left, box.width - 180)) })
  }, 0)

  // Pictures pasted or dropped in your notes: kept with the meeting, and shown where you put them.
  const putPictures = async (files) => {
    let add = ''
    for (const f of files) {
      try { const c = await sendPicture(id, f, { kind: 'paste' }); add += `\n![${(f.name && !/^image\.\w+$/.test(f.name) ? f.name.replace(/\.\w+$/, '') : `Picture at ${clock(c.t)}`).replace(/[[\]]/g, '')}](${c.file})\n` } catch (e) { setMsg({ error: true, text: e.message }) }
    }
    if (!add) return
    // What's in the box now (you may have typed on while they went up), with them where the cursor is.
    const el = mineRef.current
    const cur = el ? el.value : notes ?? data?.notes ?? ''
    const at = el ? el.selectionStart : cur.length
    editNotes(cur.slice(0, at) + add + cur.slice(at))
    refresh()
  }
  const onPasteNotes = (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    putPictures(files)
  }
  // Files dropped on the meeting: pictures on your notes go in them; anything else is linked.
  const onDrop = (e) => {
    const files = [...(e.dataTransfer?.files || [])]
    setDropping(false)
    if (!files.length) return
    e.preventDefault()
    const onNotes = mineRef.current && (e.target === mineRef.current || mineRef.current.contains(e.target))
    const pics = onNotes ? files.filter((f) => f.type.startsWith('image/')) : []
    if (pics.length) putPictures(pics)
    const rest = files.filter((f) => !pics.includes(f))
    if (rest.length) linkFiles(id, rest).then((n) => { setMsg({ text: n === 1 ? t("Linked {n} file to this meeting. They're read when the notes are written.", { n }) : t("Linked {n} files to this meeting. They're read when the notes are written.", { n }) }); refresh() }, (err) => setMsg({ error: true, text: err.message }))
  }

  if (!data) return <div className="mt-view"><div className="mt-page"><p className="muted small mt-loading">{t('Loading…')}</p></div></div>
  const done = data.status === 'done'
  const recording = isRecording
  // While it records, your notes are always shown, so the views are what goes with them: the
  // transcript, or AI Assist's suggestions when it's on. After, the summary once it's being written.
  const showing = recording
    ? (view && view !== 'mine' ? view : data.assist ? 'assist' : 'transcript')
    : view || (data.summary || data.summarizing || data.summaryError ? 'summary' : 'mine')
  const views = VIEWS.filter(([v]) => (v !== 'assist' || recording || data.assist || data.assistItems?.length) && (v !== 'mine' || !recording))
  // The lines the cleanup left out are kept, and shown on request (Put back on one keeps it).
  const all = data.transcript || []
  const lines = all.filter((l) => !l.dropped)
  const left = all.length - lines.length
  // Heard by a light model on this computer: Large turbo would hear names and jargon better.
  const light = lines.find((l) => /^whisper\.cpp (Small|Base)\b/.test(l.engine || ''))?.engine?.replace(/^whisper\.cpp /, '') || null
  const again = data.status === 'transcribing' && data.again && !data.again.done
  const kinds = list?.kinds || [{ id: 'general', label: t('Any meeting') }]
  const o = opts || { language: 'auto', model: '', kind: 'general' }
  // The transcript as a timeline: what was said, with the screen's pictures and your stamped notes
  // where they happened.
  const caps = data.captures || []
  const shots = caps.filter((c) => c.kind !== 'paste')
  const marks = stamped(notes ?? data.notes)
  const parts = data.sections || []
  const timeline = [...parts.map((x, i) => ({ k: 'sec', t: x.t - 0.5, s: x, i })), ...(showLeft ? all : lines).map((l) => ({ k: 'line', t: l.t0, l })), ...shots.map((c) => ({ k: 'pic', t: c.t, c })), ...marks.map((n, i) => ({ k: 'note', t: n.t, n, i }))].sort((a, b) => a.t - b.t)
  const shown = inNotes(notes ?? data.notes).map((f) => caps.find((c) => c.file === f)).filter(Boolean)
  const pics = [...shots, ...caps.filter((c) => c.kind === 'paste')].map((c) => ({ c, src: pictureUrl(id, c), name: c.note ? t('{name} at {time}', { name: c.note, time: clock(c.t) }) : c.kind === 'paste' ? t('Picture at {time}', { time: clock(c.t) }) : t('The screen at {time}', { time: clock(c.t) }) }))
  const openPic = (c) => setBig(Math.max(0, pics.findIndex((p) => p.c.id === c.id)))
  // The transcript beside the view (wide); while it records, what's picked beside your notes.
  const beside = !recording && wide && split && showing !== 'transcript'
  const two = recording ? wide : beside
  // As text: who said what, and a heading where each section starts.
  const said = () => {
    const out = []
    let s = -1
    for (const l of lines.filter((x) => x.text)) {
      while (s + 1 < parts.length && l.t0 >= parts[s + 1].t - 0.5) out.push(`\n## ${parts[++s].title}\n`)
      out.push(`[${clock(l.t0)}] ${l.name || (l.src === 'them' ? 'Them' : data.me || 'You')}: ${l.text}`)
    }
    return out.join('\n').trim()
  }
  const heard = lines.some((l) => l.src === 'them' && l.text)
  // A room: your mic only. Its voices can be told apart where that runs (vst.offered).
  const room = !heard && lines.some((l) => l.src === 'you' && l.text)
  const voiced = room && data.voices?.speakers >= 2
  const canTell = room && done && !!vst?.offered
  const working = data.voicesWork
  const names = [...new Set([...(data.event?.attendees || []), ...lines.map((l) => l.name).filter(Boolean)])]
  const voiceItems = (l) => [
    ...names.filter((x) => x !== l.name && x !== data.me).slice(0, 12).map((x) => ({ icon: 'users', label: x, run: () => nameVoice(l.voice, { name: x }) })),
    !l.me && { icon: 'mic', label: t("That's me"), run: () => nameVoice(l.voice, { me: true }) },
    { icon: 'edit', label: t('Someone else…'), run: () => setNaming({ l, name: '', voice: l.voice }) },
    'sep',
    { icon: 'edit', label: t('Only this line…'), run: () => setNaming({ l, name: '' }) },
    (l.name || l.me) && { icon: 'undo', label: t('Back to Speaker {n}', { n: l.voice }), run: () => nameVoice(l.voice, { name: null }) },
    'sep',
    { icon: 'sparkle', label: t('Work out who each voice is'), run: nameAll },
  ]
  const whoItems = (l) => (l.voice ? voiceItems(l) : [
    ...names.filter((x) => x !== l.name).slice(0, 12).map((x) => ({ icon: 'users', label: x, run: () => nameLine(l, x) })),
    { icon: 'edit', label: t('Someone else…'), run: () => setNaming({ l, name: '' }) },
    l.name && 'sep',
    l.name && { icon: 'undo', label: l.src === 'them' ? t('Back to Them') : t('Back to You'), run: () => nameLine(l, null) },
    heard && 'sep',
    heard && { icon: 'sparkle', label: t('Work out who said each line'), run: nameAll },
    canTell && !voiced && 'sep',
    canTell && !voiced && { icon: 'users', label: t('Tell the voices apart'), run: tellVoices },
  ])
  const state = data.status === 'recording' ? ['rec', t('Recording')] : data.status === 'paused' ? ['paused', t('Paused')]
    : again ? ['working', data.progress != null ? t('Transcribing {n}%', { n: data.progress }) : t('Transcribing')] : data.status === 'transcribing' || data.waiting ? ['working', t('Finishing')] : data.cleaning ? ['working', t('Cleaning up')] : data.summarizing ? ['working', t('Writing notes')]
      : data.summaryError ? ['blocked', t('Notes later')] : ['done', t('Done')]
  const who = data.event?.attendees || []
  const savedDir = data.saved ? tilde(data.saved.replace(/\/[^/]+$/, '')) : null

  const head = (
    <PaneHeader icon="mic" title={<input className="mt-title" value={title ?? data.title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setTitle(null); e.currentTarget.blur() } }} aria-label={t('Meeting title')} title={t('Click to rename')} />}
      leading={onBack && <><button type="button" className="win-btn back" onClick={onBack} aria-label={t('All meetings')} title={t('All meetings')}><Icon name="chevron" size={16} className="flip" /></button><span className="pane-icon"><Icon name="mic" size={15} /></span></>}
      subtitle={(
        <>
          {when != null
            ? <input className="mt-inline" type="datetime-local" value={when} autoFocus onChange={(e) => setWhen(e.target.value)} onBlur={saveWhen} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setWhen(null) }} aria-label={t('When the meeting was')} />
            : <button type="button" className="sub-where mt-when" onClick={() => setWhen(localInput(data.startedAt))} title={t('When it was. Click to change')}>
              {new Date(data.startedAt).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{done || data.seconds ? ` · ${clock(data.seconds || 0)}` : ''}
            </button>}
          {people != null
            ? <input className="mt-inline mt-people-in" value={people} autoFocus placeholder={t('Names, with commas')} onChange={(e) => setPeople(e.target.value)} onBlur={savePeople} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setPeople(null) }} aria-label={t('Who was there')} />
            : <button type="button" className="path-chip mt-people" onClick={() => setPeople(who.join(', '))} title={who.length ? `${who.join(', ')}\n${t('Click to change')}` : t('Who was there? Click to add them')}><Icon name="users" size={10} /> <span>{who.length ? `${who.slice(0, 3).join(', ')}${who.length > 3 ? ` +${who.length - 3}` : ''}` : t('Add people')}</span></button>}
          {people == null && !who.length && calWhy === 'calendarAccess' && (
            <button type="button" className="path-chip mt-fromcal warn" onClick={() => setDialog('calendar')} title={t("Bridge AI isn't allowed to see your calendars, so it couldn't take this meeting's name and people from its invite. Click to allow it.")}>
              <Icon name="calendar" size={10} /> <span>{t('Allow calendar')}</span>
            </button>
          )}
          {people == null && !who.length && events?.length > 0 && (
            <button type="button" className="path-chip mt-fromcal" onClick={(e) => (events.length === 1 ? takeEvent(events[0]) : setEvMenu({ x: e.clientX, y: e.clientY }))} disabled={busy === 'event'}
              title={events.length === 1 ? t('Take the people and name from "{title}" in your calendar', { title: events[0].title }) : t('Pick the calendar event it was, for its people and name')}>
              <Icon name="calendar" size={10} /> <span>{events.length === 1 ? t('From "{title}"', { title: events[0].title }) : t('From the calendar')}</span>
            </button>
          )}
          <button type="button" className="path-chip mt-saved" onClick={() => (data.saved ? (here() ? reveal() : setMsg({ text: tilde(data.saved) })) : save())}
            onContextMenu={(e) => { if (!data.saved) return; e.preventDefault(); navigator.clipboard?.writeText(data.saved); setMsg({ text: t('Path copied') }) }}
            title={data.saved ? `${(data.savedFiles || [data.saved]).map(tilde).join('\n')}\n${t('Click to show in Finder; right-click to copy')}` : t('Not saved to your notes folder yet. Click to save it')}>
            <Icon name="folder" size={10} /> <span>{savedDir || t('Not saved yet')}</span>
          </button>
        </>
      )}>
      <span className={`state-tag mt-state st-${state[0]}`}>{state[0] === 'rec' ? <span className="rec-dot" aria-hidden="true" /> : <StatusDot status={state[0] === 'paused' ? 'idle' : state[0]} size={7} />}{state[1]}</span>
      {data.archived && <button type="button" className="state-tag mt-state mt-archived" onClick={() => archive(false)} title={t('Archived: left out of search and of questions about your meetings. Click to take it out of the archive.')}><Icon name="archive" size={11} /> {t('Archived')}</button>}
      <div className="seg" role="tablist" aria-label={t('Show')}>
        {views.map(([v, icon, label]) => (
          <button key={v} type="button" role="tab" data-view={v} aria-selected={showing === v} className={showing === v ? 'on' : ''} onClick={() => { setView(v); setSel(null) }}
            title={v === 'transcript' ? (lines.length === 1 ? t('{n} line', { n: lines.length }) : t('{n} lines', { n: lines.length })) : v === 'files' ? t('{n} files and links, {pictures} pictures', { n: (data.links || []).length, pictures: shots.length }) : t(label)}>
            <Icon name={icon} size={14} /><span>{t(label)}</span>
          </button>
        ))}
      </div>
      {wide && !recording && showing !== 'transcript' && <button type="button" className={`win-btn${split ? ' on' : ''}`} onClick={() => setSplit(!split)} aria-pressed={split} aria-label={split ? t('Hide the transcript beside it') : t('Show the transcript beside it')} title={split ? t('Hide the transcript beside it') : t('Show the transcript beside it')}><Icon name="panel-right" size={14} /></button>}
      <button type="button" className="win-btn mt-hb" onClick={save} disabled={busy === 'save'} aria-label={t('Save')} title={t('Save as Markdown in your notes folder')}><Icon name="download" size={14} /></button>
      <span className="menu-anchor">
        <button type="button" className="win-btn" onClick={() => setMenu(!menu)} aria-label={t('More actions')} title={t('More')}><Icon name="more" size={14} /></button>
        {menu && <Menu onClose={() => setMenu(false)} items={[
          { icon: 'download', label: t('Save as Markdown'), run: save },
          data.saved && here() && { icon: 'folder-open', label: t('Show saved notes in Finder'), run: reveal },
          atActions(data.summary) && { icon: 'helm', label: t('Send action items to Chief of Staff'), run: toChief },
          '-',
          { icon: 'edit', label: t('Fix a word everywhere'), run: () => setFix({ from: '' }) },
          done && { icon: 'refresh', label: t('Transcribe again…'), run: () => setDialog('again') },
          done && lines.length > 0 && { icon: 'sparkle', label: data.cleanedAt ? t('Clean up the transcript again') : t('Clean up the transcript'), run: cleanUp },
          done && data.cleanedAt && { icon: 'undo', label: t('Undo the cleanup'), run: uncleanAll },
          data.pending > 0 && { icon: 'refresh', label: t('Transcribe the missed parts again'), run: () => act('retry', () => api(`/meetings/${encodeURIComponent(id)}/retry`, { method: 'POST' })) },
          { icon: 'book', label: t('Meeting memory'), run: () => setDialog('memory') },
          heard && { icon: 'users', label: t('Work out who said each line'), run: nameAll },
          canTell && { icon: 'users', label: voiced ? t('Work out who each voice is') : t('Tell the voices apart'), run: voiced ? nameAll : tellVoices },
          '-',
          { icon: 'folder', label: data.folder ? t('In "{folder}": move…', { folder: data.folder }) : t('Move to a folder…'), run: () => setDialog('folder') },
          !live && data.status !== 'recording' && data.status !== 'paused' && (data.archived
            ? { icon: 'archive', label: t('Take out of the archive'), run: () => archive(false) }
            : { icon: 'archive', label: t('Archive'), run: () => archive(true) }),
          { icon: 'trash', label: t('Delete meeting…'), danger: true, run: remove },
        ]} />}
      </span>
    </PaneHeader>
  )

  const transcriptPane = (
    <section ref={tRef} className={`mt-transcript${beside || showing === 'transcript' ? '' : ' off'}`} aria-label={t('Transcript')}>
      <div className="mt-thead mt-phead">
        <span className="muted small">{again ? (data.progress != null ? t('Transcribing again: {n}%', { n: data.progress }) : t('Transcribing again…')) : lines.length ? `${lines.length === 1 ? t('{n} line', { n: lines.length }) : t('{n} lines', { n: lines.length })}${shots.length ? `, ${shots.length === 1 ? t('{n} picture', { n: shots.length }) : t('{n} pictures', { n: shots.length })}` : ''}` : t('Transcript')}</span>
        <span className="mt-grow" />
        {heard && <button type="button" className="ghost-btn" onClick={nameAll} disabled={busy === 'who'} aria-label={t('Who spoke')} title={t('Work out who said each line from the call: from names said, the screen and who was invited. Or click Them on a line to name them yourself.')}><Icon name="users" size={12} /><span className="lbl"> {t('Who spoke')}</span></button>}
        {canTell && <button type="button" className="ghost-btn mt-voices-btn" onClick={voiced ? nameAll : tellVoices} disabled={busy === 'who' || !!working} aria-label={t('Who spoke')} title={voiced ? t('Work out who each voice is: from names said and who was invited. Or click Speaker on a line to name them yourself.') : t('Tell the voices in the room apart, on this computer, then work out who each one is.')}><Icon name="users" size={12} /><span className="lbl"> {t('Who spoke')}</span></button>}
        {lines.length > 0 && <button type="button" className="ghost-btn" onClick={() => setFix({ from: '' })} aria-label={t('Fix a word')} title={t('Fix a misheard word or name everywhere in this meeting')}><Icon name="edit" size={12} /><span className="lbl"> {t('Fix a word')}</span></button>}
        {done && <button type="button" className="ghost-btn" onClick={() => setDialog('again')} aria-label={t('Transcribe again')} title={t('Transcribe it again from the recording')}><Icon name="refresh" size={12} /><span className="lbl"> {t('Transcribe again')}</span></button>}
        {lines.length > 0 && <button type="button" className="ghost-btn" onClick={() => copy(said(), t('Copied the transcript.'))} aria-label={t('Copy the transcript')} title={t('Copy the transcript')}><Icon name="copy" size={12} /><span className="lbl"> {t('Copy')}</span></button>}
        {beside && <button type="button" className="ghost-btn mt-thide" onClick={() => { setSplit(false); setSel(null) }} aria-label={t('Hide the transcript')} title={t('Hide the transcript (the view gets the room)')}><Icon name="panel-right" size={14} /></button>}
      </div>
      <div className="mt-lines" ref={listRef} onMouseUp={picked} onTouchEnd={picked} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; setSel(null) }}>
        {!lines.length && !(recording && data.partial) && <p className="muted small mt-hint">{recording ? t('The transcript appears here as people talk, a few seconds behind.') : data.waiting || again ? t('Transcribing…') : t('Nothing was transcribed.')}{done && !lines.length && <> <button type="button" className="link-btn" onClick={() => setDialog('again')}>{t('Transcribe it again')}</button></>}</p>}
        {timeline.map((x, i) => (x.k === 'line'
          ? <Line key={x.l.key || `${x.l.t0}-${x.l.src}-${i}`} l={x.l} id={id} me={data.me} onSaved={refresh} onError={(t) => setMsg({ error: true, text: t })} onWho={(e, l) => setWhoAt({ x: e.clientX, y: e.clientY, l })} />
          : x.k === 'sec'
            ? <SectionHead key={`sec-${x.i}-${x.s.t}`} id={id} s={x.s} i={x.i} onChange={refresh} onError={(t) => setMsg({ error: true, text: t })} />
          : x.k === 'pic'
            ? <Picture key={`pic-${x.c.id}`} id={id} c={x.c} onOpen={() => openPic(x.c)} onChange={refresh} onError={(t) => setMsg({ error: true, text: t })} />
            : <div key={`note-${x.i}`} className="mt-mark"><Icon name="edit" size={11} /><span className="mt-t">{clock(x.n.t)}</span><span>{x.n.text}</span></div>))}
        {/* Live words (server/livewords.js): what someone is still saying, before its line is in. */}
        {recording && ['you', 'them'].filter((src) => data.partial?.[src]?.text).map((src) => (
          <div key={`so-far-${src}`} className={`mt-line mt-so-far ${src}`} aria-live="off">
            <span className="mt-who">{src === 'them' ? t('Them') : data.me || t('You')}</span>
            <span className="mt-t">{clock(data.partial[src].t0)}</span>
            <span className="mt-text">{data.partial[src].cut ? '… ' : ''}{data.partial[src].text}</span>
          </div>
        ))}
        {data.waiting > 0 && lines.length > 0 && !again && <p className="muted small mt-hint">{live ? '…' : t('Finishing the transcript ({n} left)…', { n: data.waiting })}</p>}
        {working && !working.error && <p className="mt-working muted small mt-voices-work" role="status"><span className="aa-spin" /> {working.state === 'downloading' ? t('Downloading the voice model, once: {n}%', { n: working.percent || 0 }) : t('Telling the voices apart: {n}%', { n: working.percent || 0 })}</p>}
        {working?.error && <p className="muted small mt-hint" role="status">{t("The voices weren't told apart: {error}", { error: working.error })} <button type="button" className="link-btn" onClick={tellVoices}>{t('Try again')}</button></p>}
        {data.cleaning && <p className="mt-working muted small"><span className="aa-spin" /> {t('Cleaning up the transcript…')}</p>}
        {!data.cleaning && data.cleanError && done && <p className="muted small mt-hint">{t("The transcript wasn't cleaned up: {error}", { error: data.cleanError })} <button type="button" className="link-btn" onClick={cleanUp}>{t('Try again')}</button></p>}
        {done && !again && light && <p className="muted small mt-hint">{t('Transcribed with {engine}, a light speech model that mishears names and jargon more often. Large turbo hears them better.', { engine: light })} <button type="button" className="link-btn" onClick={() => setDialog('again')}>{t('Transcribe again')}</button></p>}
        {left > 0 && <p className="muted small mt-hint">{left === 1 ? t('{n} line left out by the cleanup: nobody said it, or it was the call heard by your mic.', { n: left }) : t('{n} lines left out by the cleanup: nobody said them, or they were the call heard by your mic.', { n: left })} <button type="button" className="link-btn" onClick={() => setShowLeft(!showLeft)}>{showLeft ? t('Hide them') : t('Show them')}</button></p>}
      </div>
      {sel && <button type="button" className="mt-selfix btn small" style={{ top: sel.top, left: sel.left }} onMouseDown={(e) => e.preventDefault()} onClick={() => { setFix({ from: sel.text }); setSel(null) }}><Icon name="edit" size={12} /> {t('Fix "{text}"', { text: sel.text.length > 24 ? `${sel.text.slice(0, 24)}…` : sel.text })}</button>}
    </section>
  )

  // Your notes: a view of its own after the meeting; while it records, always there (pinned), with
  // its name and what it's for over it.
  const mine = (
    <section className={`mt-notes mt-mynotes${recording ? ' pinned' : ''}`} aria-label={t('Your notes')}>
      <div className="mt-phead">
        {recording
          ? <label htmlFor={`mt-mine-${id}`} className="mt-mynotes-name"><Icon name="edit" size={14} /> <b>{t('My notes')}</b>{marks.length > 0 && <small className="muted"> · {t('{n} at a time in the meeting', { n: marks.length })}</small>}</label>
          : <span className="muted small">{marks.length ? t('Your notes, {n} at a time in the meeting', { n: marks.length }) : t('Your notes')}</span>}
        <span className="mt-grow" />
        <button type="button" className="ghost-btn" onClick={() => copy(notes ?? data.notes ?? '', t('Copied your notes.'))} disabled={!(notes ?? data.notes)} title={t('Copy your notes')}><Icon name="copy" size={12} /> {t('Copy')}</button>
      </div>
      {recording && <p className="muted small mt-shapes">{data.canRead ? t("What you write here, the slides it sees and the meeting's files shape the summary.") : t("What you write here and the meeting's files shape the summary.")}</p>}
      <textarea id={`mt-mine-${id}`} ref={mineRef} className="mt-mine" value={notes ?? data.notes ?? ''} onChange={(e) => editNotes(e.target.value)} onPaste={onPasteNotes} placeholder={recording ? t('Write as you go: a word or two is enough. Paste a picture to keep it here.') : t('Your notes. Paste or drop a picture to keep it here.')} aria-label={t('Your notes')} />
      {shown.length > 0 && <div className="mt-gallery small-thumbs" aria-label={t('Pictures in your notes')}>{shown.map((c) => <button key={c.id} type="button" className="mt-thumb" onClick={() => openPic(c)}><img src={pictureUrl(id, c)} alt="" loading="lazy" /></button>)}</div>}
    </section>
  )
  const todo = atActions(data.summary)
  const main = showing === 'summary' ? (
    <section className="mt-notes" aria-label={t('Summary')}>
      <div className="mt-phead mt-toolbar">
        {done && (
          <div className="mt-tools" role="group" aria-label={t('The summary')}>
            <button type="button" className="mt-tool lead" onClick={summarize} disabled={busy === 'summary' || data.summarizing}><Icon name="sparkle" size={13} /> {data.summary ? t('Regenerate') : t('Summarize')}</button>
            <label className="mt-tool" title={t('The language the notes are written in')}><small>{t('Language')}</small>
              <select value={o.language} onChange={(e) => setOpts({ ...o, language: e.target.value })} aria-label={t('Language of the notes')}>{NOTE_LANGS.map(([v, l]) => <option key={v} value={v}>{v === 'auto' ? t('Auto') : t(l)}</option>)}</select>
            </label>
            <label className="mt-tool" title={t('The model that writes the notes')}><small>{t('Model')}</small>
              <select value={o.model} onChange={(e) => setOpts({ ...o, model: e.target.value })} aria-label={t('Model for the notes')}>
                <option value="">{t('Automatic')}</option>
                {(models || []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
            <label className="mt-tool" title={t('What kind of meeting it was, for what the notes look for')}><small>{t('Template')}</small>
              <select value={o.kind} onChange={(e) => setOpts({ ...o, kind: e.target.value })} aria-label={t('Template')}>{kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
            </label>
          </div>
        )}
        <span className="mt-grow" />
        {data.summary && <button type="button" className="ghost-btn" onClick={() => copy(data.summary, t('Copied the summary.'))} title={t('Copy the summary')}><Icon name="copy" size={12} /> {t('Copy')}</button>}
      </div>
      {data.summary ? (todo ? (
        <>
          <div className="mt-summary md" dangerouslySetInnerHTML={{ __html: md(todo.head) }} />
          <div className="mt-chief" role="group" aria-label={t('Chief of Staff')}>
            <button type="button" className="btn small" onClick={toChief} disabled={busy === 'chief'}><Icon name="helm" size={13} /> {data.chief ? t('Send again') : t('Send action items to Chief of Staff')}</button>
            <span className="muted small">{data.chief
              ? t('Sent to Chief of Staff on {when}. It tracks them on its task list and follows up.', { when: new Date(data.chief.at).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })
              : t('Chief of Staff tracks them on its task list and follows up: it hands yours to an agent and drafts follow-ups for the rest.')}</span>
          </div>
          {todo.tail.trim() && <div className="mt-summary md" dangerouslySetInnerHTML={{ __html: md(todo.tail) }} />}
        </>
      ) : <div className="mt-summary md" dangerouslySetInnerHTML={{ __html: md(data.summary) }} />)
        : !data.summarizing && !data.summaryError && <p className="muted small mt-hint">{done ? t('No summary yet. Summarize writes one from the transcript, your notes, the screen and the files.') : t('The summary is written when the meeting ends. Meanwhile, My notes is yours to write in.')}</p>}
      {data.summary && data.summaryFrom && !data.summarizing && <WrittenFrom from={data.summaryFrom} onView={(v) => { setView(v); if (v === 'transcript') setSel(null) }} />}
      {shots.length > 0 && data.summary && (
        <div className="mt-gallery" aria-label={t('From the screen')}>
          <b className="mt-gallery-head">{t('From the screen')}</b>
          {shots.map((c) => <button key={c.id} type="button" className="mt-thumb" onClick={() => openPic(c)} title={c.note || t('The screen at {time}', { time: clock(c.t) })}><img src={pictureUrl(id, c)} alt="" loading="lazy" /><small>{clock(c.t)}{c.note ? ` · ${c.note}` : ''}</small></button>)}
        </div>
      )}
      {data.summarizing && <p className="mt-working muted small"><span className="aa-spin" /> {t('Writing the summary…')}</p>}
      {data.summaryError && !data.summarizing && (
        <div className="mt-sumerr" role="status">
          <p className="small"><b>{!data.summaryTried?.length ? t("The summary couldn't be written:") : data.summaryTried.length === 1 ? t("The summary couldn't be written with {model}:", { model: modelName(models, data.summaryTried[0]) }) : data.summaryTried.length === 2 ? t("The summary couldn't be written with {model} or the {n} other model you have:", { model: modelName(models, data.summaryTried[0]), n: data.summaryTried.length - 1 }) : t("The summary couldn't be written with {model} or the {n} other models you have:", { model: modelName(models, data.summaryTried[0]), n: data.summaryTried.length - 1 })}</b> {data.summaryError}</p>
          <p className="muted small">{data.saved ? t('Your notes and the transcript are kept and saved.') : t('Your notes and the transcript are kept.')} {data.summaryRetryAt ? `It tries again by itself at ${new Date(data.summaryRetryAt).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}, or ` : ''}<button type="button" className="link-btn" onClick={summarize}>{data.summaryRetryAt ? 'try now' : 'Try again'}</button>, or pick another model above.</p>
        </div>
      )}
      {data.summary && data.summaryNote && !data.summarizing && <p className="muted small">{data.summaryNote.replace(/[a-z]+:[\w./:-]+/gi, (x) => modelName(models, x))}</p>}
    </section>
  ) : showing === 'mine' ? mine : showing === 'assist' ? (
    <section className="mt-notes" aria-label={t('AI Assist')}><AssistPane id={id} data={data} onChange={refresh} onMsg={setMsg} /></section>
  ) : showing === 'files' ? (
    <section className="mt-notes" aria-label={t('Files')}><FilesPane id={id} data={data} onChange={refresh} onMsg={setMsg} shots={shots} pictureUrl={pictureUrl} onOpenPic={openPic} /></section>
  ) : null

  return (
    <div className="mt-view">
      {head}
      <div className={`mt-page${dropping ? ' dropping' : ''}`} onDragOver={(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDropping(true) } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false) }} onDrop={onDrop}>
        <RecordingBar id={id} data={data} onAssist={(on) => { refresh(); if (on) setView('assist') }} />
        {(data.status === 'recording' || data.status === 'paused') && <SpeechSetup recording />}
        {!live && (data.status === 'recording' || data.status === 'paused') && <p className="muted small">{t('This meeting is recording in another window.')}</p>}
        {msg && <p className={`small mt-msg ${msg.error ? 'error-text' : 'muted'}`} role="status">{msg.text}{msg.act && <> <button type="button" className="link-btn" onClick={msg.act.run}>{msg.act.label}</button></>}</p>}
        <div ref={colsRef} className={`mt-cols${two ? '' : ' single'}${two && tw ? ' sized' : ''}${recording ? ' pinned' : ''}`} style={two && tw ? { '--mt-tw': `${tw}px` } : undefined}>
          {recording ? mine : main}
          {two && <Handle axis="x" size={tw || Math.round((colsRef.current?.clientWidth || 900) * 0.44)} min={260} max={Math.max(320, (colsRef.current?.clientWidth || 900) - 320)} invert onSize={setTw} onToggle={recording ? undefined : () => setSplit(false)} label={recording ? t('Resize split') : t('Resize the transcript')} />}
          {recording && main}
          {transcriptPane}
        </div>
        {(lines.length > 0 || data.summary) && <AskPanel key={id} path={`/meetings/${encodeURIComponent(id)}/ask`} placeholder={t('Ask about this meeting')} suggestions={done ? ASK_ONE : []} />}
        {fix && <FixWord id={id} from={fix.from} onClose={() => setFix(null)} onDone={(t) => { setMsg({ text: t }); refresh() }} />}
        {dialog === 'again' && <TranscribeAgain ids={[id]} onClose={() => setDialog(null)} onDone={(t) => { setMsg({ text: t }); refresh() }} />}
        {dialog === 'memory' && <MemoryPanel onClose={() => { setDialog(null); refresh() }} />}
        {dialog === 'calendar' && (
          <Dialog title={t('Your calendar')} onClose={() => setDialog(null)}>
            <PermissionFix pane="calendars" onCheck={() => { setCalAgain((n) => n + 1); refetch('/calendar') }}><p className="small">{t('With your calendar, a meeting takes its name and people from its invite as it starts recording, so the transcript can say who said what. Your events stay on this Mac.')}</p></PermissionFix>
          </Dialog>
        )}
        {dialog === 'delete' && <ConfirmDelete items={[data]} onClose={() => setDialog(null)} onDone={(action) => { if (action === 'delete') onBack?.(); else { refresh(); setMsg({ text: t("Archived. It's under Archived in the list, and left out of search.") }) } }} />}
        {dialog === 'folder' && <FolderPick items={[data]} folders={foldersOf(list?.meetings)} onClose={() => setDialog(null)} onDone={(t) => { setMsg({ text: t }); refresh() }} />}
        {whoAt && <AtMenu x={whoAt.x} y={whoAt.y} items={whoItems(whoAt.l)} onClose={() => setWhoAt(null)} />}
        {evMenu && <AtMenu x={evMenu.x} y={evMenu.y} onClose={() => setEvMenu(null)} items={(events || []).map((ev) => ({ icon: 'calendar', label: `${ev.title} · ${timeOf(ev.start)}${ev.attendees?.length ? ` · ${t('{n} people', { n: ev.attendees.length })}` : ''}`, run: () => takeEvent(ev) }))} />}
        {naming && (
          <Dialog title={t('Who said it?')} onClose={() => setNaming(null)}>
            <form className="mt-fix" onSubmit={(e) => { e.preventDefault(); if (naming.name.trim()) { if (naming.voice) nameVoice(naming.voice, { name: naming.name.trim() }); else nameLine(naming.l, naming.name.trim()); setNaming(null) } }}>
              <p className="muted small mt-quote">"{naming.l.text.length > 160 ? `${naming.l.text.slice(0, 160)}…` : naming.l.text}"</p>
              <label><span>{t('Name')}</span><input value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} autoFocus maxLength={80} placeholder={t('Their name')} aria-label={t('Their name')} /></label>
              <div className="mt-dialog-acts"><button type="button" className="ghost-btn" onClick={() => setNaming(null)}>{t('Cancel')}</button><button type="submit" className="btn primary small" disabled={!naming.name.trim()}>{t('Name them')}</button></div>
            </form>
          </Dialog>
        )}
        {big != null && pics[big] && <Lightbox pics={pics} at={big} onAt={setBig} onClose={() => setBig(null)} />}
        {dropping && <div className="mt-drop" aria-hidden="true"><Icon name="paperclip" size={18} /> {t('Drop to link them to this meeting. A picture dropped on your notes goes in them.')}</div>}
      </div>
    </div>
  )
}
