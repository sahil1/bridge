import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll } from '../../api.js'
import { useSettings, SaveNote } from './General.jsx'
import { MemoryPanel } from '../meetings/tools.jsx'
import '../meetings/meetings.css'

// Settings › Meetings: which engine turns speech into text (on this computer, or a service you have
// a key for), the language, recording the call's sound, the model that writes the notes, and where
// they're saved. Server: speech.js, meetings.js.
const LANGS = [['auto', 'Detect it'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['hi', 'Hindi'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ar', 'Arabic'], ['ru', 'Russian'], ['pl', 'Polish'], ['tr', 'Turkish'], ['sv', 'Swedish'], ['uk', 'Ukrainian']]
const home = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~')
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
      <p className="muted small mono mt-path">{d.example.map(home).join(' and ')}</p>
      <label className="st-check"><input type="checkbox" checked={f.frontmatter} onChange={(e) => put('frontmatter', 'frontmatter', e.target.checked)} />
        <span><b>Front matter</b> <span className="muted small">YAML at the top of each note: the meeting's id, date, length, kind, people, and the link between the two notes.</span></span></label>
      <div className="st-row st-speakers"><span>Speakers</span>
        <input className="st-input" value={f.you} onChange={(e) => setF({ ...f, you: e.target.value })} onBlur={(e) => e.target.value.trim() && e.target.value !== d.you && put('you', 'youLabel', e.target.value)} aria-label="Your mic, as" placeholder="You" />
        <input className="st-input" value={f.them} onChange={(e) => setF({ ...f, them: e.target.value })} onBlur={(e) => e.target.value.trim() && e.target.value !== d.them && put('them', 'themLabel', e.target.value)} aria-label="The call, as" placeholder="Them" />
      </div>
      <label className="st-check"><input type="checkbox" checked={f.keep} onChange={(e) => put('keep', 'keepSaved', e.target.checked)} />
        <span><b>Keep saved notes up to date</b> <span className="muted small">A new summary, title or notes save the meeting again, except a note you've changed in your notes app, which is left as you made it. Off: a meeting is written once, and later changes stay in Bridge AI.</span></span></label>
      {d.misplaced > 0 && (
        <div className="st-note"><Icon name="folder" size={13} /> {d.misplaced} saved meeting{d.misplaced === 1 ? ' is' : 's are'} somewhere these settings don't put them now.
          <button type="button" className="btn small" disabled={moving === '…'} onClick={move}>Move {d.misplaced === 1 ? 'it' : 'them'} here</button></div>
      )}
      {moving && moving !== '…' && <p className="muted small" role="status">{moving}</p>}
    </>
  )
}
const openProviders = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))

export default function Meetings() {
  const { s, save, note } = useSettings()
  const sp = usePoll('/speech', 3000)
  const [models, setModels] = useState(null)
  const [vocab, setVocab] = useState(null)
  const [instr, setInstr] = useState(null)
  const [memory, setMemory] = useState(false)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [installing, setInstalling] = useState(null) // the terminal tab whisper.cpp installs in
  useEffect(() => { api('/chat/models').then((r) => setModels(r.models || [])).catch(() => setModels([])) }, [])
  const m = s?.effective?.meetings || {}
  useEffect(() => { if (s) { setVocab(m.vocabulary || ''); setInstr(m.instructions || '') } }, [s]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || !sp.data) return <div className="skeleton-rows"><div /><div /><div /></div>
  const d = sp.data
  const set = (patch) => save({ meetings: patch }).then(() => sp.refresh())
  const mac = window.bridgeApp?.platform === 'darwin'
  const card = !['off', 'menubar'].includes(m.floatCard) || (m.floatCard === 'menubar' && !mac)
  const act = async (name, fn) => { setBusy(name); setErr(null); try { await fn(); sp.refresh() } catch (e) { setErr(e.message) } finally { setBusy(null) } }
  const pickFolder = window.bridgeApp?.pickFolder

  return (
    <div className="st-sections st-meet">
      <SaveNote note={note} />
      {err && <p className="st-note bad"><Icon name="alert" size={13} /> {err}</p>}

      <section className="st-sec">
        <h4>Transcribe with</h4>
        <p className="muted small">Speech is turned into text as you talk, a few seconds at a time. On this computer it's free and never leaves your Mac; a service is quicker on an older computer and costs a little per hour of audio.</p>
        {d.auto && <p className="small">{d.engine === 'apple' ? 'Using the Mac\'s own speech, since whisper.cpp isn\'t set up.' : 'Using whisper.cpp when it\'s ready, else the Mac\'s own speech.'} Pick one to keep it.</p>}
        <div className="mt-engines" role="radiogroup" aria-label="Speech engine">
          <label className={`mt-engine ${d.engine === 'local' ? 'on' : ''}`}>
            <input type="radio" name="engine" checked={d.engine === 'local'} onChange={() => set({ engine: 'local' })} />
            <span className="mt-engine-main"><b>On this computer</b><small>whisper.cpp, on the graphics chip. Free and private.</small></span>
            <span className={`mt-state ${d.local.ready ? 'good' : ''}`}>{d.local.ready ? 'Ready' : d.local.program ? 'Needs a model' : 'Needs whisper.cpp'}</span>
          </label>
          {(d.apple?.available || d.engine === 'apple') && (
            <label className={`mt-engine ${d.engine === 'apple' ? 'on' : ''}`}>
              <input type="radio" name="engine" checked={d.engine === 'apple'} onChange={() => set({ engine: 'apple' })} />
              <span className="mt-engine-main"><b>The Mac's own speech</b><small>Apple's transcriber, built into macOS 26 and later. Nothing to install, free and private.</small></span>
              <span className={`mt-state ${d.apple?.available ? 'good' : ''}`}>{d.apple?.available ? 'Ready' : 'Not on this Mac'}</span>
            </label>
          )}
          {d.services.map((x) => (
            <label key={x.id} className={`mt-engine ${d.engine === x.id ? 'on' : ''}`}>
              <input type="radio" name="engine" checked={d.engine === x.id} onChange={() => set({ engine: x.id })} />
              <span className="mt-engine-main"><b>{x.label}</b><small>{x.custom ? 'Its address, key and model, in Settings › Model providers' : `${x.model}${x.price[x.model] ? `, ${x.price[x.model]} an hour` : ''}`}</small></span>
              {x.ready ? <span className="mt-state good">Key saved</span> : <button type="button" className="link-btn" onClick={(e) => { e.preventDefault(); openProviders() }}>{x.custom ? 'Set it up' : 'Add a key'}</button>}
            </label>
          ))}
        </div>
      </section>

      {d.engine === 'local' && (
        <section className="st-sec">
          <h4>Speech model</h4>
          {!d.local.program && (
            <div className="st-note warn">
              <Icon name="download" size={13} /> Transcribing on this computer needs whisper.cpp, a free program.{d.standIn === 'apple' && ' Until it\'s in, the Mac\'s own speech is used.'}
              {d.local.installCommand
                ? <button type="button" className="btn small" disabled={busy === 'install' || !!installing} onClick={() => act('install', async () => setInstalling((await api('/speech/install', { method: 'POST' })).openId))}>{busy === 'install' || installing ? 'Installing…' : 'Install it'}</button>
                : <span> Install Homebrew from brew.sh first, or pick a service above.</span>}
              {installing && <span className="muted small"> Installing in a terminal tab, in the Setup space. <button type="button" className="link-btn" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: installing } }))}>Show it</button></span>}
            </div>
          )}
          <p className="muted small">Bigger is more accurate and slower. Each is one download, from Hugging Face.</p>
          <ul className="mt-models">
            {d.local.models.map((x) => {
              const on = d.local.model === x.id
              return (
                <li key={x.id} className={on ? 'on' : ''}>
                  <span className="mt-model-main"><b>{x.label}{x.best && <span className="best-tag">best</span>}</b><small>{x.note} {x.mb >= 1000 ? `${(x.mb / 1000).toFixed(1)} GB` : `${x.mb} MB`}.</small></span>
                  {x.downloading && !x.downloading.error ? <span className="muted small">Downloading {x.downloading.percent}%</span>
                    : x.have ? (on ? <span className="mt-state good"><Icon name="check" size={12} /> In use</span>
                      : <span className="mt-model-acts"><button type="button" className="btn small" onClick={() => set({ localModel: x.id })}>Use</button><button type="button" className="ghost-btn" aria-label={`Remove ${x.label}`} title="Remove the download" onClick={() => act(`rm:${x.id}`, () => api(`/speech/models/${x.id}`, { method: 'DELETE' }))}><Icon name="trash" size={13} /></button></span>)
                      : <button type="button" className="btn small" onClick={() => act(`get:${x.id}`, async () => { await api(`/speech/models/${x.id}`, { method: 'POST' }); await set({ localModel: x.id }) })}><Icon name="download" size={12} /> {on ? 'Download' : 'Download and use'}</button>}
                  {x.downloading?.error && <span className="error-text small">{x.downloading.error}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="st-sec">
        <h4>Language</h4>
        <select className="st-input" value={m.language || 'auto'} onChange={(e) => set({ language: e.target.value })} aria-label="Meeting language">
          {LANGS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <p className="muted small">An English-only model always listens for English.</p>
      </section>

      <section className="st-sec">
        <h4>Names and terms</h4>
        <p className="muted small">Meeting memory keeps the people, companies and jargon from your meetings: how they're spelled, how they get misheard, who they are. The speech engine listens for them, transcripts show them fixed, and notes get them right. It grows as you fix words and as summaries are written.</p>
        <div className="st-row"><button type="button" className="btn small" onClick={() => setMemory(true)}><Icon name="book" size={12} /> Meeting memory</button></div>
        {memory && <MemoryPanel onClose={() => setMemory(false)} />}
        <p className="muted small">More words to listen for, if you like (the meeting's title and invitees are added by themselves):</p>
        <input className="st-input" value={vocab ?? ''} onChange={(e) => setVocab(e.target.value)} onBlur={() => vocab !== (m.vocabulary || '') && set({ vocabulary: vocab.trim() })} placeholder="e.g. Kubernetes, OKRs" aria-label="More words to listen for" />
      </section>

      <section className="st-sec">
        <h4>The call's sound</h4>
        <label className="st-check">
          <input type="checkbox" checked={m.callAudio !== false} onChange={(e) => set({ callAudio: e.target.checked })} disabled={!d.canRecordCall} />
          <span><b>Record the other side of calls</b> <span className="muted small">{d.canRecordCall ? 'What your Mac plays (Zoom, Meet, Teams), so the transcript says who said what: You, or Them. macOS asks once to allow System Audio Recording.' : 'On a Mac with macOS 14.2 or later. Here your mic records the meeting, which still hears a call on speakers.'}</span></span>
        </label>
      </section>

      <section className="st-sec">
        <h4>Notes are written by</h4>
        <select className="st-input" value={m.model || ''} onChange={(e) => set({ model: e.target.value || null })} aria-label="Model for meeting notes">
          <option value="">Automatic (your Claude sign-in first, then a key or a local model)</option>
          {(models || []).map((x) => <option key={x.id} value={x.id}>{x.label} ({x.provider})</option>)}
        </select>
        <label className="st-check">
          <input type="checkbox" checked={m.autoSummary !== false} onChange={(e) => set({ autoSummary: e.target.checked })} />
          <span><b>Write the summary when a meeting ends</b> <span className="muted small">Otherwise, Summarize on the meeting when you want it.</span></span>
        </label>
        <label className="st-check">
          <input type="checkbox" checked={m.cleanup ?? m.autoSummary !== false} onChange={(e) => set({ cleanup: e.target.checked })} />
          <span><b>Clean up the transcript when a meeting ends</b> <span className="muted small">The model fixes misheard words and names from what the meeting is about (its invite, files and meeting memory) and leaves out words nobody said. Each fixed line says what was heard, and Undo puts it back.</span></span>
        </label>
        <label className="st-check">
          <input type="checkbox" checked={m.assist === true} onChange={(e) => set({ assist: e.target.checked })} />
          <span><b>AI Assist in every meeting</b> <span className="muted small">While a meeting records, the model reads along and suggests what to ask or check next, from what's said, the invite and the files that go with it. Assist on a meeting turns it on or off there, and for the meetings after.</span></span>
        </label>
        <label className="st-check">
          <input type="checkbox" checked={m.nameSpeakers !== false} onChange={(e) => set({ nameSpeakers: e.target.checked })} />
          <span><b>Name who spoke on the call</b> <span className="muted small">Before the first summary, the model works out who said each of Them's lines from names said, the invite and the screen. On a Mac, a watched screen is read while the call talks, and those pictures aren't kept. With one other person invited, it's them.</span></span>
        </label>
        <p className="muted small">Your own instructions for every summary, if you like:</p>
        <textarea className="st-input" rows={2} value={instr ?? ''} onChange={(e) => setInstr(e.target.value)} onBlur={() => instr !== (m.instructions || '') && set({ instructions: instr.trim() })} placeholder="e.g. Keep it under ten bullets. Note any numbers mentioned." />
      </section>

      <section className="st-sec">
        <h4>Calls</h4>
        <label className="st-check">
          <input type="checkbox" checked={m.detect !== false} onChange={(e) => set({ detect: e.target.checked })} disabled={!d.canWatchCalls} />
          <span><b>Notice calls</b> <span className="muted small">{d.canWatchCalls ? 'When Zoom, Teams, Meet, FaceTime, Slack or another call app starts using your mic, offer to take notes; when the call ends, offer to stop. Nothing is recorded until you say so.' : 'In the desktop app on a Mac with macOS 14 or later.'}</span></span>
        </label>
        <label className="st-check">
          <input type="checkbox" checked={m.autoStop !== false} onChange={(e) => set({ autoStop: e.target.checked })} disabled={!d.canWatchCalls || m.detect === false} />
          <span><b>Stop by itself when the call ends</b> <span className="muted small">Two minutes after, unless you keep it going.</span></span>
        </label>
        {window.bridgeApp?.desktop && (
          <div className="st-row">
            <span>The floating card</span>
            <select className="st-input" value={m.floatCard === 'menubar' && !mac ? 'meetings' : m.floatCard || 'meetings'} onChange={(e) => set({ floatCard: e.target.value })} aria-label="The floating card">
              <option value="meetings">During calls and meetings</option>
              <option value="always">Always, with what needs you</option>
              {mac && <option value="menubar">In the menu bar instead</option>}
              <option value="off">Off</option>
            </select>
          </div>
        )}
        {window.bridgeApp?.desktop && card && (
          <label className="st-check">
            <input type="checkbox" checked={m.floatHover !== false} onChange={(e) => set({ floatHover: e.target.checked })} />
            <span><b>Open it when I point at it</b> <span className="muted small">Otherwise it stays a slim bar until you click it.</span></span>
          </label>
        )}
        {window.bridgeApp?.desktop && <p className="muted small">{card
          ? `A small card over your other windows: the recording, with Pause and Stop, and Take notes when a call starts. Drag it anywhere.${mac ? ' Sharing your screen? Most sharing apps show it, so move it to the menu bar from the card first.' : ''}`
          : m.floatCard === 'menubar' && mac ? 'The time in the menu bar while a meeting records, with Pause, Stop and the meeting in its menu, and Take notes when a call starts. It stays out of a window you share.' : 'Nothing over your other windows. While a meeting records, it shows at the top of Bridge AI.'}</p>}
      </section>

      <section className="st-sec">
        <h4>Save notes as Markdown</h4>
        <p className="muted small">Save on a meeting writes it for Obsidian or any notes app, laid out like Granola's and Meetily's Obsidian plugins, so they sit side by side.</p>
        <SaveNotes set={set} pickFolder={pickFolder} />
        <label className="st-check">
          <input type="checkbox" checked={!!m.autoSave} onChange={(e) => set({ autoSave: e.target.checked, ...(m.folder ? {} : { folder: d.folder }) })} />
          <span><b>Save every meeting there by itself</b> <span className="muted small">Once its summary is written.</span></span>
        </label>
      </section>
    </div>
  )
}
