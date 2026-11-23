import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { Menu } from '../Rail.jsx'
import { api, usePoll, refetch } from '../../api.js'
import { t, locale } from '../../i18n/index.js'
import { store } from '../layout.jsx'
import { where } from '../settings/search.js'
import { Dialog } from './tools.jsx'
import { openMeeting, openMeetings } from './recording.jsx'
import { isMedia, pick, transcribe, stop, holds, readHere, canPickFolder } from './transcribefiles.js'
import './meetings.css'

// Transcribe a file or a folder (server/meetfiles.js, transcribefiles.js): the button in Meetings,
// the dialog that asks how (with which speech model, in which language, telling speakers apart),
// and the lines of the files going and done. Each file becomes a meeting of its own, opened from
// its line. Where files come from (a drop on the window, ⌘K) is transcribehost.jsx.

// Whisper's languages, named in yours by the browser (so none of them needs translating).
const WHISPER_LANGS = 'en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no th ur hr bg lt la mi ml cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be tg sd gu am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su yue'.split(' ')
const langNames = () => {
  let dn = null
  try { dn = new Intl.DisplayNames([locale() || 'en'], { type: 'language' }) } catch { /* named by code */ }
  return WHISPER_LANGS.map((c) => [c, (dn && dn.of(c === 'jw' ? 'jv' : c)) || c]).sort((a, b) => a[1].localeCompare(b[1], locale()))
}
const size = (b) => (b >= 1e9 ? t('{n} GB', { n: (b / 1e9).toFixed(1) }) : b >= 1e6 ? t('{n} MB', { n: Math.round(b / 1e6) }) : t('{n} KB', { n: Math.max(1, Math.round(b / 1e3)) }))
const mbSize = (mb) => (mb >= 1000 ? t('{n} GB', { n: (mb / 1000).toFixed(1) }) : t('{n} MB', { n: mb }))
const KEPT = 'cc-transcribe-with' // the last way picked, for next time

// ---------- How to transcribe them ----------
export function TranscribeDialog({ files, folder, picked, onClose }) {
  const media = files.filter(isMedia)
  const others = files.length - media.length
  const [sp, setSp] = useState(null)
  const [vs, setVs] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const kept = store.get(KEPT, {})
  const [lang, setLang] = useState(kept.language || 'auto')
  const [wanted, setPick] = useState('')
  const [speakers, setSpeakers] = useState(kept.speakers !== false)
  const langs = useRef(null)
  langs.current ||= langNames()
  useEffect(() => {
    api('/speech').then((d) => {
      setSp(d)
      const ok = (v) => v && (v.startsWith('local:') ? d.local.models.some((x) => `local:${x.id}` === v && x.usable) : v === 'apple' ? d.apple?.available : d.services.some((x) => x.id === v && x.ready))
      setPick(ok(kept.with) ? kept.with : d.engine === 'local' || !ok(d.engine) ? `local:${d.local.model}` : d.engine)
    }).catch((e) => setErr(e.message))
    api('/meetings/voices').then(setVs).catch(() => setVs(null))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const local = sp?.local.models.filter((x) => x.usable) || []
  const options = sp ? [
    ...local.map((x) => [`local:${x.id}`, x.have ? t('On this computer: {model}', { model: x.label }) : t('On this computer: {model} (downloads {size} first)', { model: x.label, size: mbSize(x.mb) })]),
    ...(sp.apple?.available ? [['apple', t("On this Mac: the Mac's own speech")]] : []),
    ...sp.services.filter((x) => x.ready).map((x) => [x.id, `${x.label}${x.model ? `, ${x.model}` : ''}`]),
  ] : []
  // What was picked, or the first way there is when that isn't one (a model that can't run here).
  const pickWith = options.some(([v]) => v === wanted) ? wanted : options[0]?.[0] || ''
  // The language picked isn't one the model hears: Whisper large turbo does, where it runs here.
  const model = pickWith.startsWith('local:') ? local.find((x) => `local:${x.id}` === pickWith) : null
  const deaf = model && lang !== 'auto' && Array.isArray(model.languages) && !model.languages.includes(lang)
  const turbo = local.find((x) => x.id === 'whisper-turbo') || local.find((x) => x.whisper)
  const langName = langs.current.find(([c]) => c === lang)?.[1] || lang
  const go = async () => {
    setBusy(true); setErr(null)
    const use = deaf && turbo ? `local:${turbo.id}` : pickWith
    const [engine, localModel] = use.startsWith('local:') ? ['local', use.slice(6)] : [use, undefined]
    store.set(KEPT, { with: pickWith, language: lang, speakers })
    try {
      await transcribe(media, { engine, localModel, language: lang === 'auto' ? null : lang, speakers })
      openMeetings()
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const total = media.reduce((n, f) => n + (f.size || 0), 0)
  const title = media.length === 1 ? t('Transcribe {name}', { name: media[0].name }) : t('Transcribe {n} files', { n: media.length })
  if (!media.length) {
    return (
      <Dialog title={t('Transcribe')} onClose={onClose}>
        <div className="mt-fix">
          <p className="small">{folder ? t('Nothing in that folder is audio or video.') : t('Nothing there is audio or video.')} <span className="muted">{t('Bridge AI transcribes sound and video files, such as MP3, M4A, WAV, MP4 and MOV.')}</span></p>
          <div className="mt-dialog-acts"><button type="button" className="btn small" onClick={onClose}>{t('OK')}</button></div>
        </div>
      </Dialog>
    )
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="mt-fix tf-ask" onSubmit={(e) => { e.preventDefault(); if (!busy && pickWith) go() }}>
        <p className="muted small">
          {media.length > 1 ? t('{n} files, {size}. Each one becomes a transcript of its own in Meetings, with who spoke and when.', { n: media.length, size: size(total) }) : t('{size}. It becomes a transcript in Meetings, with who spoke and when.', { size: size(total) })}
          {others > 0 && ` ${others === 1 ? t('{n} file that isn\'t audio or video is left out.', { n: others }) : t('{n} files that aren\'t audio or video are left out.', { n: others })}`}
          {picked > media.length + others ? ` ${t('Only the first {n} are taken.', { n: media.length + others })}` : ''}
        </p>
        {media.length > 1 && <ul className="tf-names small">{media.slice(0, 4).map((f, i) => <li key={`${f.name}-${i}`}>{f.webkitRelativePath || f.name}</li>)}{media.length > 4 && <li className="muted">{t('and {n} more', { n: media.length - 4 })}</li>}</ul>}
        <label><span>{t('With')}</span>
          <select value={pickWith} onChange={(e) => setPick(e.target.value)} aria-label={t('Transcribe with')}>
            {!sp && <option value="">{t('Loading…')}</option>}
            {sp && !options.length && <option value="">{t('Nothing set up: {place}', { place: where('voice') })}</option>}
            {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label><span>{t('Language')}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('Language spoken')}>
            <option value="auto">{t('Detect it')}</option>
            {langs.current.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {deaf && (turbo
          ? <p className="small tf-note"><Icon name="info" size={12} /> {t("{model} doesn't hear {language}, so {whisper} transcribes it.", { model: model.label, language: langName, whisper: turbo.label })}{!turbo.have && ` ${t('It downloads once first ({size}).', { size: mbSize(turbo.mb) })}`}</p>
          : <p className="small tf-note warn"><Icon name="alert" size={12} /> {t("{model} doesn't hear {language}, and no speech model on this computer does.", { model: model.label, language: langName })}</p>)}
        {vs?.offered && (
          <label className="st-check"><input type="checkbox" checked={speakers} onChange={(e) => setSpeakers(e.target.checked)} /><span><b>{t('Tell speakers apart')}</b> <span className="muted small">{vs.have ? t('By their voices, on this computer.') : t('By their voices, on this computer. The voice model downloads once ({size}).', { size: mbSize(vs.mb) })}</span></span></label>
        )}
        {err && <p className="error-text small" role="alert">{err}</p>}
        <div className="mt-dialog-acts">
          <button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="btn primary small" disabled={busy || !pickWith || (deaf && !turbo)}><Icon name="wave" size={12} /> {busy ? t('Starting…') : t('Transcribe')}</button>
        </div>
      </form>
    </Dialog>
  )
}

// Meetings' button: a file (or a folder, where one can be picked), from this device.
export function TranscribeButton({ compact = false }) {
  const [menu, setMenu] = useState(false)
  const folders = canPickFolder()
  const label = t('Transcribe a file')
  return (
    <span className="menu-anchor">
      <button type="button" className="btn small tf-btn" onClick={() => (folders ? setMenu(!menu) : pick())} aria-haspopup={folders ? 'menu' : undefined} aria-expanded={folders ? menu : undefined}
        aria-label={label} title={t('Audio or video from this device, as a transcript with who spoke and when. Or drop one anywhere in the window.')}>
        <Icon name="upload" size={13} />{!compact && <span> {label}</span>}
      </button>
      {menu && <Menu onClose={() => setMenu(false)} items={[
        { icon: 'file', label: t('Files…'), run: () => pick() },
        { icon: 'folder', label: t('A folder…'), run: () => pick({ folder: true }) },
      ]} />}
    </span>
  )
}

// ---------- The files going, and done ----------
const STATES = {
  waiting: () => t('Waiting to be sent'),
  sending: (x) => t('Sending: {n}%', { n: x.percent || 0 }),
  queued: () => t('Waiting its turn'),
  reading: () => t('Reading its sound'),
  'read-here': () => t('Reading it in this window…'),
  model: (x) => t('Downloading the speech model, once: {n}%', { n: x.percent || 0 }),
  held: () => t('Waiting for the meeting being recorded to end'),
  transcribing: (x) => t('Transcribing: {n}%', { n: x.percent || 0 }),
  speakers: (x) => t('Telling speakers apart: {n}%', { n: x.percent || 0 }),
  done: () => t('Done'),
}
// On Meetings: a line for each file sent to be transcribed (from this device or another), how far
// it's got, why one couldn't be, and Open once it's done. Shown while there are any.
export function FilesPanel() {
  const fast = useRef(false)
  const { data, refresh } = usePoll('/meetings/files', fast.current ? 1500 : 8000)
  const items = data?.items || []
  fast.current = !!data?.going
  // One this page holds that the computer can't read: read here, and its sound sent instead.
  useEffect(() => { for (const x of items) if (x.state === 'read-here' && holds(x.id)) readHere(x, data.piece) }, [items.map((x) => `${x.id}:${x.state}`).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  // One done: Meetings lists its transcript now, and the speech model it downloaded is here.
  const doneN = items.filter((x) => x.state === 'done').length
  const seenDone = useRef(doneN)
  useEffect(() => { if (doneN > seenDone.current) { refetch('/meetings'); refetch('/speech') } seenDone.current = doneN }, [doneN])
  if (!items.length) return null
  const going = items.filter((x) => !['done', 'failed'].includes(x.state))
  const finished = items.length - going.length
  const clear = () => api('/meetings/files/clear', { method: 'POST' }).then(refresh).catch(() => {})
  const head = going.length ? (items.length === 1 ? t('Transcribing a file') : t('Transcribing files: {done} of {n} done', { done: finished, n: items.length }))
    : doneN === items.length ? (items.length === 1 ? t('Transcribed') : t('{n} files transcribed', { n: items.length }))
      : items.length === 1 ? t("Couldn't transcribe it") : t('{done} of {n} files transcribed', { done: doneN, n: items.length })
  return (
    <section className="tf-panel" aria-label={t('Files to transcribe')}>
      <header>
        <Icon name="wave" size={14} />
        <b>{head}</b>
        <span className="mt-grow" />
        {finished > 0 && <button type="button" className="link-btn small" onClick={clear}>{t('Clear')}</button>}
      </header>
      <ul>
        {items.map((x) => {
          const failed = x.state === 'failed'
          const text = failed ? x.error || t("It couldn't be transcribed.") : x.state === 'read-here' && !holds(x.id) ? t('Waiting for the window it came from to read it') : (STATES[x.state] || STATES.queued)(x)
          const bar = !failed && x.percent != null && x.state !== 'done'
          return (
            <li key={x.id} className={`tf-item st-${failed ? 'failed' : x.state}`} data-state={failed ? 'failed' : x.state}>
              <span className="tf-main">
                <b title={x.name}>{x.name}</b>
                <span className={`small ${failed ? 'error-text' : 'muted'}`} role={failed ? 'alert' : undefined}>{text}{x.state === 'done' && x.seconds ? ` · ${clockOf(x.seconds)}` : ''}</span>
                {x.note && <span className="small tf-note">{x.note}</span>}
                {bar && <span className="vs-bar" role="progressbar" aria-valuenow={x.percent} aria-valuemin={0} aria-valuemax={100} aria-label={text}><span style={{ width: `${x.percent}%` }} /></span>}
              </span>
              {x.meeting && x.state === 'done' && <button type="button" className="btn small" onClick={() => openMeeting(x.id)}>{t('Open')}</button>}
              <button type="button" className="ghost-btn" onClick={() => stop(x.id).then(refresh, refresh)} aria-label={['done', 'failed'].includes(x.state) ? t('Take {name} off the list', { name: x.name }) : t('Stop {name}', { name: x.name })} title={['done', 'failed'].includes(x.state) ? t('Take it off the list (its transcript stays in Meetings)') : t("Stop it: it isn't transcribed")}><Icon name="x" size={12} /></button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
const clockOf = (s) => { const v = Math.round(s); const h = Math.floor(v / 3600); const m = Math.floor((v % 3600) / 60); const x = String(v % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}` }
