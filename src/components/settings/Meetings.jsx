import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll, onThisComputer } from '../../api.js'
import { useSettings, SaveNote } from './General.jsx'
import { useTrial } from '../../trials.js'
import { openMemory } from '../meetings/tools.jsx'
import { t } from '../../i18n/index.js'
import { MEETING_KEYS } from '../../../shared/mentions.js'
import { Advanced, Line } from './Advanced.jsx'
import '../meetings/meetings.css'

// Settings › Meetings: which engine turns speech into text (on this computer, or a service you have
// a key for), the language, names and terms, the model that writes the notes and what it does by
// itself (the summary, cleaning up, naming who spoke, preparing: on unless turned off, and what each
// reads goes to that model, so which and where it runs is said there), calls and their sound, and
// saving them as Markdown. Under Advanced: the other speech services, suggesting what to ask, who
// spoke, the key that mentions a meeting in a message, the floating card, and where and how notes
// are saved. Server: speech.js, meetings.js.
const LANGS = [['auto', 'Detect it'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['hi', 'Hindi'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ar', 'Arabic'], ['ru', 'Russian'], ['pl', 'Polish'], ['tr', 'Turkish'], ['sv', 'Swedish'], ['uk', 'Ukrainian']]
const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~')
const WHAT = [['both', 'The summary and the transcript, two linked notes'], ['one', 'One note with everything'], ['summary', 'The summary only'], ['transcript', 'The transcript only']]

// Where notes are saved, the way Granola's and Meetily's Obsidian plugins set it: for the summary
// note and the transcript note each, a folder, subfolders and a file name, from a pattern.
function SaveNotes({ set, pickFolder }) {
  const sv = usePoll('/meetings/saving', 30_000)
  const [f, setF] = useState(null)
  const [moving, setMoving] = useState(null)
  useEffect(() => { if (sv.data && !f) setF(sv.data) }, [sv.data, f])
  if (!f || !sv.data) return <div className="skeleton-rows"><div /></div>
  const d = sv.data
  const put = (key, setting, v) => { setF({ ...f, [key]: v }); if (v !== d[key]) set({ [setting]: typeof v === 'string' ? v.trim() : v }).then(() => sv.refresh()) }
  const field = (key, setting, label, ph) => (
    <label className="st-pattern"><span>{label}</span>
      <input className="st-input mono" value={f[key] ?? ''} placeholder={ph} onChange={(e) => setF({ ...f, [key]: e.target.value })} onBlur={(e) => e.target.value !== d[key] && put(key, setting, e.target.value)} aria-label={label} />
    </label>
  )
  const folderRow = (key, setting, label) => (
    <div className="st-pattern"><span>{label}</span>
      <div className="st-row">
        <input className="st-input mono" value={f[key] ?? ''} onChange={(e) => setF({ ...f, [key]: e.target.value })} onBlur={(e) => e.target.value.trim() && e.target.value !== d[key] && put(key, setting, e.target.value)} aria-label={label} />
        {pickFolder && <button type="button" className="btn small" onClick={async () => { const p = await pickFolder(d[key]).catch(() => null); if (p) put(key, setting, p) }}>Choose…</button>}
      </div>
    </div>
  )
  const move = async () => { setMoving('…'); try { const r = await api('/meetings/move-saved', { method: 'POST' }); setMoving(`Moved ${r.moved} meeting${r.moved === 1 ? '' : 's'}.${r.failed.length ? ` ${r.failed.length} couldn't be: ${r.failed[0].error}` : ''}`); sv.refresh() } catch (e) { setMoving(e.message) } }
  return (
    <>
      <div className="st-row"><span>Save</span>
        <select className="st-input" value={f.what} onChange={(e) => put('what', 'saveWhat', e.target.value)} aria-label="What to save">{WHAT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      {f.what !== 'transcript' && (
        <div className="st-group"><b className="small">{f.what === 'one' ? 'Notes' : 'Summary notes'}</b>
          {folderRow('folder', 'folder', 'Folder')}
          {field('noteSub', 'noteSub', 'Subfolders', 'none')}
          {field('noteName', 'noteName', 'File name', '{title}-summary')}
        </div>
      )}
      {(f.what === 'both' || f.what === 'transcript') && (
        <div className="st-group"><b className="small">Transcripts</b>
          {folderRow('transcriptFolder', 'transcriptFolder', 'Folder')}
          {field('transcriptSub', 'transcriptSub', 'Subfolders', 'none')}
          {field('transcriptName', 'transcriptName', 'File name', '{title}-transcript')}
        </div>
      )}
      <p className="muted small">In the patterns: {'{year} {month} {day} {quarter} {date} {time} {title} {kind}'}. Empty subfolders: none.</p>
      <p className="muted small mono mt-path">{d.example.map(tilde).join(' and ')}</p>
      <label className="st-check"><input type="checkbox" checked={f.frontmatter} onChange={(e) => put('frontmatter', 'frontmatter', e.target.checked)} />
        <span title="YAML at the top of each note: the meeting's id, date, length, kind, people, and the link between the two notes."><b>Front matter</b> <span className="muted small">{t("YAML at the top of each note: the meeting's date, people and more.")}</span></span></label>
      <div className="st-row st-speakers"><span>Speakers</span>
        <input className="st-input" value={f.you} onChange={(e) => setF({ ...f, you: e.target.value })} onBlur={(e) => e.target.value.trim() && e.target.value !== d.you && put('you', 'youLabel', e.target.value)} aria-label="Your mic, as" placeholder="You" />
        <input className="st-input" value={f.them} onChange={(e) => setF({ ...f, them: e.target.value })} onBlur={(e) => e.target.value.trim() && e.target.value !== d.them && put('them', 'themLabel', e.target.value)} aria-label="The call, as" placeholder="Them" />
      </div>
      <label className="st-check"><input type="checkbox" checked={f.keep} onChange={(e) => put('keep', 'keepSaved', e.target.checked)} />
        <span title="A new summary, title or notes save the meeting again, except a note you've changed in your notes app, which is left as you made it. Off: a meeting is written once, and later changes stay in Bridge AI."><b>Keep saved notes up to date</b> <span className="muted small">{t('Saved again when it changes, unless you changed the note yourself.')}</span></span></label>
      {d.misplaced > 0 && (
        <div className="st-note"><Icon name="folder" size={13} /> {d.misplaced} saved meeting{d.misplaced === 1 ? ' is' : 's are'} somewhere these settings don't put them now.
          <button type="button" className="btn small" disabled={moving === '…'} onClick={move}>Move {d.misplaced === 1 ? 'it' : 'them'} here</button></div>
      )}
      {moving && moving !== '…' && <p className="muted small" role="status">{moving}</p>}
    </>
  )
}
// Names from the call's window: Screen Recording, with why, and Allow (macOS asks once; after that
// it's turned on in System Settings). Only on the computer it's for, where it can be asked.
function ScreenNames() {
  const here = onThisComputer()
  const { data, refresh } = usePoll(here ? '/calls/screen' : null, 10_000)
  const [asked, setAsked] = useState(false)
  if (!here || data?.allowed == null) return null
  return (
    <div className="st-row st-screen-names">
      <span><b>{t('Names from the call')}</b> <span className="muted small">{data.allowed
        ? t('Screen Recording is on: the names your call shows go on the transcript. Only the words are kept, never the picture.')
        : asked ? t('Turn on Bridge AI under System Settings › Privacy & Security › Screen & System Audio Recording, in Screen Recording.')
          : t('Screen Recording puts the names your call shows on the transcript. Only the words are kept, never the picture.')}</span></span>
      {!data.allowed && (asked
        ? <button type="button" className="btn small" onClick={() => api('/fix/settings', { method: 'POST', body: { pane: 'audio' } }).catch(() => {})}>{t('Open it')}</button>
        : <button type="button" className="btn small" onClick={async () => { setAsked(true); await api('/calls/screen', { method: 'POST' }).catch(() => {}); refresh() }}>{t('Allow')}</button>)}
    </div>
  )
}
// Voices in a room (server/voices.js), only where it can run: told apart by the voice model, and,
// if you want, remembered by voice once named. Turning it on downloads the model (30 MB) with its
// progress here; otherwise it waits for the first Who spoke on a meeting.
function RoomVoices({ v, m, set, refresh }) {
  const [msg, setMsg] = useState(null)
  const on = (yes) => set({ roomVoices: yes }).then(() => { if (yes && !v.have) return api('/meetings/voices/download', { method: 'POST' }).then(refresh) }).catch((e) => setMsg(e.message))
  const forget = () => api('/meetings/voices/forget', { method: 'POST' }).then(() => { setMsg(t('Forgotten.')); refresh() }).catch((e) => setMsg(e.message))
  return (
    <section className="st-sec st-voices" data-setting="who-spoke">
      <h4>{t('Who Spoke')}</h4>
      <label className="st-check">
        <input type="checkbox" checked={m.roomVoices === true} onChange={(e) => on(e.target.checked)} />
        <span title={`${t('With your mic only (no call), each line says Speaker 1, Speaker 2 and so on, by voice, worked out on this computer. Name a speaker once and all their lines take the name.')}${v.live ? '' : ` ${t('On this computer it runs once a meeting ends, so the transcript keeps up while it records.')}`}`}><b>{t('Tell voices apart in a room')}</b> <span className="muted small">{t('Speaker 1, Speaker 2 and so on, worked out on this computer.')} {t('It uses a small voice model ({model}, {mb} MB, {license}), downloaded the first time.', { model: v.label, mb: v.mb, license: v.license })}</span></span>
      </label>
      <label className="st-check">
        <input type="checkbox" checked={m.callVoices !== false} onChange={(e) => set({ callVoices: e.target.checked })} />
        <span title={t("The call's sound is one for everyone on it, so each voice is told apart the same way, once the call ends, and named from what's said, who was invited and the names the call showed. By itself, on this computer: the model downloads after the first call with more than one other person.")}><b>{t('Tell voices apart on a call')}</b> <span className="muted small">{t('Once the call ends, on this computer.')}</span></span>
      </label>
      <label className="st-check">
        <input type="checkbox" checked={m.learnVoice !== false} onChange={(e) => set({ learnVoice: e.target.checked })} />
        <span title={t("From your mic on calls, where every line is yours, so a meeting in a room knows which voice is you without your naming it. It's a few hundred numbers for how your voice sounds, on this computer only.")}><b>{t('Learn my voice')}</b> <span className="muted small">{t('So a room knows which voice is you. Kept on this computer only.')} {v.mine ? t('Learned.') : ''}</span></span>
      </label>
      <ScreenNames />
      {v.downloading && <p className={`small ${v.downloading.error ? 'error-text' : 'muted'}`} role="status">{v.downloading.error || t('Downloading the voice model: {n}%', { n: v.downloading.percent })}</p>}
      <label className="st-check">
        <input type="checkbox" checked={m.rememberVoices === true} onChange={(e) => set({ rememberVoices: e.target.checked })} />
        <span title={t("Then someone you've named is named by their voice in the next meeting. What's kept is a few hundred numbers for how each voice sounds, with their name, on this computer only, and never sent anywhere.")}><b>{t('Remember voices you name')}</b> <span className="muted small">{t('Named by voice next time. Kept on this computer only.')}</span></span>
      </label>
      {v.known > 0 && <div className="st-row"><button type="button" className="btn small" onClick={forget}><Icon name="trash" size={12} /> {v.known === 1 ? t('Forget {n} voice', { n: v.known }) : t('Forget {n} voices', { n: v.known })}</button></div>}
      {msg && <p className="muted small" role="status">{msg}</p>}
    </section>
  )
}
// Settings › Model Providers at its speech services, where their keys go; Settings › Voice.
const openSpeechKeys = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers-speech' } }))
const openVoice = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'voice' } }))

export default function Meetings({ onOpenAgent }) {
  const { s, save, note } = useSettings()
  const sp = usePoll('/speech', 3000)
  const [models, setModels] = useState(null)
  const [auto, setAuto] = useState(null) // the model Automatic is, as the server picks it (server/index.js pickMeetingModel)
  const [vocab, setVocab] = useState(null)
  const [instr, setInstr] = useState(null)
  // Preparing for meetings needs the calendar: only where there's one (a Mac).
  const calendar = usePoll('/config', 10 * 60 * 1000).data?.calendar === true
  const home = useTrial('home') // Home, a beta feature: named only when it's there
  useEffect(() => { api('/chat/models').then((r) => { setModels(r.models || []); setAuto(r.automatic || null) }).catch(() => setModels([])) }, [])
  const m = s?.effective?.meetings || {}
  useEffect(() => { if (s) { setVocab(m.vocabulary || ''); setInstr(m.instructions || '') } }, [s]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || !sp.data) return <div className="skeleton-rows"><div /><div /><div /></div>
  const d = sp.data
  const set = (patch) => save({ meetings: patch }).then(() => sp.refresh())
  const mac = window.bridgeApp?.platform === 'darwin'
  const win = window.bridgeApp?.platform === 'win32'
  const hide = ['sharing', 'always', 'never'].includes(m.floatHide) ? m.floatHide : 'sharing'
  const card = !['off', 'menubar'].includes(m.floatCard) || (m.floatCard === 'menubar' && !mac)
  const model = d.local.models.find((x) => x.id === d.local.model)
  const pickFolder = window.bridgeApp?.pickFolder
  // A speech service: first when it's the one picked or its key is saved, else under Advanced.
  const service = (x) => (
    <label key={x.id} className={`mt-engine ${d.engine === x.id ? 'on' : ''}`}>
      <input type="radio" name="engine" checked={d.engine === x.id} onChange={() => set({ engine: x.id })} />
      <span className="mt-engine-main"><b>{x.label}</b><small>{x.custom ? 'Its address, key and model, in Settings › Model Providers' : `${x.model}${x.price[x.model] ? `, ${x.price[x.model]} an hour` : ''}`}</small></span>
      {x.ready ? <span className="mt-state good">Key saved</span> : <button type="button" className="link-btn" onClick={(e) => { e.preventDefault(); openSpeechKeys() }}>{x.custom ? 'Set it up' : 'Add a key'}</button>}
    </label>
  )
  const mine = d.services.filter((x) => x.ready || d.engine === x.id)
  const others = d.services.filter((x) => !mine.includes(x))
  // The model that writes the notes, and with it cleans up, names who spoke and prepares: which, and
  // where it runs, said where each is turned on (what it reads leaves this computer unless it's local).
  const notes = models && (m.model || auto) ? models.find((x) => x.id === (m.model || auto)) || null : null
  const by = notes ? (notes.via === 'local' ? t('{model}, on this computer', { model: notes.label }) : t('{model}, at {provider}', { model: notes.label, provider: notes.provider })) : null
  const prepWhy = home ? t("Fifteen minutes before a meeting with other people, AI Assist suggests goals and questions, with the model that writes your notes, from who's coming, last time with them, the invite and your mail with them. Off, it does this only when you ask, with AI Assist on the meeting in Calendar, or Prepare on Home.")
    : t("Fifteen minutes before a meeting with other people, AI Assist suggests goals and questions, with the model that writes your notes, from who's coming, last time with them, the invite and your mail with them. Off, it does this only when you ask, with AI Assist on the meeting in Calendar.")

  return (
    <div className="st-sections st-meet">
      <SaveNote note={note} />

      <section className="st-sec" data-setting="transcribe">
        <h4>Transcribe with</h4>
        <p className="muted small" title={t("Speech is turned into text as you talk, a few seconds at a time. On this computer it's free and never leaves your Mac; a service is quicker on an older computer and costs a little per hour of audio.")}>{t('On this computer it\'s free and private; a service costs a little per hour of audio.')}</p>
        {d.auto && <p className="small">{d.engine === 'apple' ? t("Using the Mac's own speech until the speech model is on this computer. Pick one to keep it.") : t("Using the speech model on this computer when it's ready, else the Mac's own speech. Pick one to keep it.")}</p>}
        <div className="mt-engines" role="radiogroup" aria-label="Speech engine">
          <label className={`mt-engine ${d.engine === 'local' ? 'on' : ''}`}>
            <input type="radio" name="engine" checked={d.engine === 'local'} onChange={() => set({ engine: 'local' })} />
            <span className="mt-engine-main"><b>On this computer</b><small>{t('{model}, the speech model picked in Settings › Voice. Free and private.', { model: model?.label || 'Parakeet' })}</small></span>
            <span className={`mt-state ${d.local.ready ? 'good' : ''}`}>{d.local.ready ? 'Ready' : d.needs === 'whisper' || d.needs === 'brew' ? t('Needs whisper.cpp') : t('Needs a download')}</span>
          </label>
          {(d.apple?.available || d.engine === 'apple') && (
            <label className={`mt-engine ${d.engine === 'apple' ? 'on' : ''}`}>
              <input type="radio" name="engine" checked={d.engine === 'apple'} onChange={() => set({ engine: 'apple' })} />
              <span className="mt-engine-main"><b>The Mac's own speech</b><small>Apple's transcriber, built into macOS 26 and later. Nothing to install, free and private.</small></span>
              <span className={`mt-state ${d.apple?.available ? 'good' : ''}`}>{d.apple?.available ? 'Ready' : 'Not on this Mac'}</span>
            </label>
          )}
          {mine.map(service)}
        </div>
        {d.engine === 'local' && (
          <div className="st-row" data-setting="meetings-speech-model">
            <span className="muted small">{model?.have
              ? t('{model}, the one voice notes and dictation use too.', { model: model.label })
              : d.standIn === 'apple' ? t("{model} isn't downloaded yet, so the Mac's own speech is used until it is.", { model: model?.label || 'Parakeet' })
                : t("{model} isn't downloaded yet. It downloads when your first meeting starts, or now from Settings › Voice.", { model: model?.label || 'Parakeet' })}</span>
            <button type="button" className="btn small" onClick={openVoice}><Icon name="mic" size={12} /> {t('Speech models')}</button>
          </div>
        )}
      </section>
      {others.length > 0 && (
        <Advanced order={10}>
          <section className="st-sec" data-setting="speech-services">
            <h4>{t('Speech Services')}</h4>
            <p className="muted small">{t('Quicker on an older computer. Each costs a little per hour of audio, with your own key.')}</p>
            <div className="mt-engines" role="radiogroup" aria-label={t('Speech services')}>{others.map(service)}</div>
          </section>
        </Advanced>
      )}

      <section className="st-sec" data-setting="meeting-language">
        <Line label={t('Language')} title={t('An English-only model always listens for English.')}>
          <select className="st-input" value={m.language || 'auto'} onChange={(e) => set({ language: e.target.value })} aria-label="Meeting language">
            {LANGS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Line>
        {d.engine === 'local' && Array.isArray(model?.languages) && m.language && m.language !== 'auto' && !model.languages.includes(m.language) && <p className="st-note warn small"><Icon name="info" size={13} /> {t("{model} doesn't hear this language. Pick Whisper in Settings › Voice, or a speech service above.", { model: model.label })}</p>}
      </section>

      <section className="st-sec" data-setting="names-terms">
        <h4>Names and terms</h4>
        <p className="muted small" title={t("Memory keeps the people, organizations and words from your meetings and dictations: how they're spelled, how they get misheard, who and what they are. The speech engine listens for them, transcripts show them fixed, and notes get them right. It grows as you fix words and as summaries are written.")}>{t("Memory keeps the names and words from your meetings and dictations, so they're heard and spelled right.")}</p>
        <div className="st-row"><button type="button" className="btn small" onClick={() => (onOpenAgent ? onOpenAgent('view:memory') : openMemory())}><Icon name="book" size={12} /> {t('Open Memory')}</button></div>
        <input className="st-input" value={vocab ?? ''} onChange={(e) => setVocab(e.target.value)} onBlur={() => vocab !== (m.vocabulary || '') && set({ vocabulary: vocab.trim() })} placeholder={t('More words to listen for, e.g. Kubernetes, OKRs')} aria-label="More words to listen for" title={t("The meeting's title and invitees are added by themselves.")} />
      </section>

      <section className="st-sec" data-setting="notes-model">
        <h4>Notes are written by</h4>
        <p className="muted small" data-notes-where>{!models ? '\u00a0' : m.model && !notes ? t("{model} can't be used just now, so the next model that can writes them.", { model: m.model })
          : !notes ? t('No model to write them yet: sign in to an agent, or add one in Settings › Model Providers.')
          : notes.via === 'local' ? t('{model} runs on this computer: what it reads stays here.', { model: notes.label })
            : t('{model}, at {provider}: the transcript, and what each one below reads, go there.', { model: notes.label, provider: notes.provider })}</p>
        <select className="st-input" value={m.model || ''} onChange={(e) => set({ model: e.target.value || null })} aria-label="Model for meeting notes">
          <option value="">Automatic (your Claude sign-in first, then a key or a local model)</option>
          {(models || []).map((x) => <option key={x.id} value={x.id}>{x.label} ({x.provider})</option>)}
        </select>
        <label className="st-check">
          <input type="checkbox" checked={m.autoSummary !== false} onChange={(e) => set({ autoSummary: e.target.checked })} />
          <span><b>Write the summary when a meeting ends</b> <span className="muted small">Otherwise, Summarize on the meeting when you want it.</span></span>
        </label>
        {/* On unless turned off, and each sends what it reads to that model: said here, not under Advanced. */}
        <label className="st-check" data-setting="transcript-cleanup">
          <input type="checkbox" checked={m.cleanup ?? m.autoSummary !== false} onChange={(e) => set({ cleanup: e.target.checked })} />
          <span title="The model fixes misheard words and names from what the meeting is about (its invite, files and Memory) and leaves out words nobody said. Each fixed line says what was heard, and Undo puts it back."><b>Clean up the transcript when a meeting ends</b> <span className="muted small">{t('Misheard words fixed from the invite, its files and Memory; Undo puts a line back.')}</span></span>
        </label>
        <label className="st-check" data-setting="name-speakers">
          <input type="checkbox" checked={m.nameSpeakers !== false} onChange={(e) => set({ nameSpeakers: e.target.checked })} />
          <span title="Before the first summary, the model works out who said each of Them's lines from names said, the invite and the screen. On a Mac, a watched screen is read while the call talks, and those pictures aren't kept. With one other person invited, it's them. In a room, the voices told apart are named the same way."><b>Name who spoke on the call</b> <span className="muted small">{t('From names said, the invite and what the call shows on screen, before the first summary.')}</span></span>
        </label>
        {calendar && <label className="st-check" data-setting="prep">
          <input type="checkbox" checked={m.prep !== false} onChange={(e) => set({ prep: e.target.checked })} />
          <span title={`${prepWhy}${window.bridgeApp?.desktop ? ` ${t('In the desktop app, the floating card shows them ten minutes before, with Join.')}` : ''}`}><b>{t('Prepare for each meeting')}</b> <span className="muted small">{by
            ? t('Fifteen minutes before, AI Assist reads the invite and your mail with the people invited, with {by}.', { by })
            : t('Fifteen minutes before, AI Assist reads the invite and your mail with the people invited, with the model above.')}</span></span>
        </label>}
      </section>

      <section className="st-sec" data-setting="calls">
        <h4>Calls</h4>
        <label className="st-check" data-setting="call-audio">
          <input type="checkbox" checked={m.callAudio !== false} onChange={(e) => set({ callAudio: e.target.checked })} disabled={!d.canRecordCall} />
          <span><b>Record the other side of calls</b> <span className="muted small">{d.canRecordCall ? t('What your Mac plays (Zoom, Meet, Teams), so the transcript says You or Them. macOS asks once.') : 'On a Mac with macOS 14.2 or later. Here your mic records the meeting, which still hears a call on speakers.'}</span></span>
        </label>
        <label className="st-check">
          <input type="checkbox" checked={m.detect !== false} onChange={(e) => set({ detect: e.target.checked })} disabled={!d.canWatchCalls} />
          <span title={d.canWatchCalls ? 'When Zoom, Teams, Meet, FaceTime, Slack or another call app starts using your mic, offer to take notes; when the call ends, offer to stop. Nothing is recorded until you say so.' : undefined}><b>Notice calls</b> <span className="muted small">{d.canWatchCalls ? t('Offer to take notes when a call starts. Nothing is recorded until you say so.') : 'In the desktop app on a Mac with macOS 14 or later.'}</span></span>
        </label>
        <label className="st-check">
          <input type="checkbox" checked={m.autoStop !== false} onChange={(e) => set({ autoStop: e.target.checked })} disabled={!d.canWatchCalls || m.detect === false} />
          <span><b>Stop by itself when the call ends</b> <span className="muted small">Two minutes after, unless you keep it going.</span></span>
        </label>
      </section>

      <section className="st-sec" data-setting="save-markdown">
        <label className="st-check">
          <input type="checkbox" checked={m.autoSave !== false} onChange={(e) => set({ autoSave: e.target.checked, ...(m.folder ? {} : { folder: d.folder }) })} />
          <span title={t('As it ends, and again with its summary once that\'s written.')}><b>{t('Save every meeting as Markdown')}</b> <span className="muted small">{t('In {folder}, for Obsidian or any notes app.', { folder: tilde(d.folder) })}</span></span>
        </label>
      </section>

      <Advanced order={20}>
        <section className="st-sec" data-setting="meeting-assist">
          <h4 className="st-wand"><Icon name="wand" size={13} /> {t('AI Assist')}</h4>
          <label className="st-check">
            <input type="checkbox" checked={m.assist === true} onChange={(e) => set({ assist: e.target.checked })} />
            <span title="While a meeting records, AI Assist reads along with the model that writes your notes and suggests what to ask or check next, from what's said, the invite and the files that go with it. AI Assist › Suggest what to ask on a meeting turns it on or off there, and for the meetings after."><b>Suggest what to ask, in every meeting</b> <span className="muted small">{t('While a meeting records, what to ask or check next.')}</span></span>
          </label>
          <label className="st-row" title="The slider on a meeting's Suggestions, while it records, changes it too">
            <span>How often it suggests something</span>
            <select className="st-input" value={['low', 'high'].includes(m.assistLevel) ? m.assistLevel : 'medium'} onChange={(e) => set({ assistLevel: e.target.value })} aria-label="How often AI Assist suggests something">
              <option value="low">Low: one thing, every few minutes, only when something stands out</option>
              <option value="medium">Medium: up to three, about once a minute</option>
              <option value="high">High: up to three, about every 30 seconds</option>
            </select>
          </label>
          <textarea className="st-input" rows={2} value={instr ?? ''} onChange={(e) => setInstr(e.target.value)} onBlur={() => instr !== (m.instructions || '') && set({ instructions: instr.trim() })} placeholder="e.g. Keep it under ten bullets. Note any numbers mentioned." aria-label={t('Your own instructions for every summary')} title={t('Your own instructions for every summary, if you like')} />
        </section>
      </Advanced>

      {d.voices?.offered && <Advanced order={30}><RoomVoices v={d.voices} m={m} set={set} refresh={() => sp.refresh()} /></Advanced>}

      <Advanced order={40}>
        <section className="st-sec" data-setting="mention-meeting">
          <Line label={t('Mention a Meeting')} hint={t('Type it in a message box to give an agent a meeting to read.')}
            title={`${t('In an agent\'s message box, type it and a few words of the meeting\'s name, and pick it: the agent gets the meeting as a file to read, with its summary and action items, your notes and the transcript.')} ${t('Meetings recorded on your other computers are offered too.')}`}>
            <select className="st-input" value={MEETING_KEYS.includes(m.mentionKey) ? m.mentionKey : '@'} onChange={(e) => set({ mentionKey: e.target.value === '@' ? null : e.target.value })} aria-label={t('The key that mentions a meeting')}>
              {MEETING_KEYS.map((k) => <option key={k} value={k}>{k === '@' ? t('@, with the files') : k}</option>)}
            </select>
          </Line>
        </section>
      </Advanced>

      {window.bridgeApp?.desktop && (
        <Advanced order={50}>
          <section className="st-sec" data-setting="float-card">
            <Line label={t('The floating card')} hint={card
              ? t('Over your other windows: the recording, with Pause and Stop, and Take notes when a call starts.')
              : m.floatCard === 'menubar' && mac ? t('The time in the menu bar while a meeting records. It stays out of a window you share.') : t('Nothing over your other windows.')}
>
              <select className="st-input" value={m.floatCard === 'menubar' && !mac ? 'meetings' : m.floatCard || 'meetings'} onChange={(e) => set({ floatCard: e.target.value })} aria-label="The floating card">
                <option value="meetings">During calls and meetings</option>
                <option value="always">Always, with what needs you</option>
                {mac && <option value="menubar">In the menu bar instead</option>}
                <option value="off">Off</option>
              </select>
            </Line>
            {card && (
              <label className="st-check">
                <input type="checkbox" checked={m.floatHover !== false} onChange={(e) => set({ floatHover: e.target.checked })} />
                <span><b>Open it when I point at it</b> <span className="muted small">Otherwise it stays a slim bar until you click it.</span></span>
              </label>
            )}
            {/* Kept out of pictures of the screen (desktop/main.js): on a Mac, only while something
                shares or records it, so a call doesn't see it and your screenshots do; elsewhere the
                app can't tell, so it's on or off. Linux can't keep a window out of them at all. */}
            {card && mac && (
              <Line label={t('Hide it from screen sharing')} hint={hide === 'sharing'
                ? t('While you share or record your screen, a call or a recording never sees it. Your screenshots do.')
                : hide === 'always' ? t('Never in a share, a recording or a screenshot.') : t('Anyone you share your screen with sees it.')}>
                <select className="st-input" value={hide} onChange={(e) => set({ floatHide: e.target.value })} aria-label={t('Hide it from screen sharing')}>
                  <option value="sharing">{t('While I share my screen')}</option>
                  <option value="always">{t('Always, screenshots too')}</option>
                  <option value="never">{t('Never')}</option>
                </select>
              </Line>
            )}
            {card && win && (
              <label className="st-check">
                <input type="checkbox" checked={hide !== 'never'} onChange={(e) => set({ floatHide: e.target.checked ? 'always' : 'never' })} />
                <span><b>{t('Keep it out of screenshots and screen sharing')}</b> <span className="muted small">{t("So a call you share your screen on doesn't see it. Turn this off to take a screenshot of it.")}</span></span>
              </label>
            )}
          </section>
        </Advanced>
      )}

      <Advanced order={60}>
        <section className="st-sec" data-setting="save-notes">
          <h4>Save notes as Markdown</h4>
          <p className="muted small" title={t("Save on a meeting writes it for Obsidian or any notes app, laid out like Granola's and Meetily's Obsidian plugins, so they sit side by side.")}>{t("Laid out like Granola's and Meetily's Obsidian plugins.")}</p>
          <SaveNotes set={set} pickFolder={pickFolder} />
        </section>
      </Advanced>
    </div>
  )
}
