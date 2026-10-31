import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll, viaRelay } from '../../api.js'
import PermissionFix, { useRecheck } from '../PermissionFix.jsx'
import { CalendarSetup } from '../Agenda.jsx'
import { t } from '../../i18n/index.js'

// Before you record: whether what you say will be turned into text, and if not, what it needs and
// the one step that fixes it (server/speech.js status: ready, needs). A meeting recorded meanwhile
// keeps its audio, so Transcribe again fills it in once it's set up. The first time, Meetings shows
// the whole setup instead, Granola style: speech to text, the mic, who writes the notes and the
// calendar, each a tick or one button.
const settings = (section) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section } }))
const showTab = (paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } }))

// What speech to text needs, in a sentence, and the buttons that do it. Install whisper.cpp also
// fetches the speech model once it's in, so it's one step.
function useSpeechStep(d, refresh) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState(null) // { id, what }: the terminal tab an install runs in
  const fetched = useRef(false)
  const model = d?.local?.models?.find((x) => x.id === d.local.model)
  const dl = model?.downloading
  // An install that's done: its note goes (Homebrew in, whisper.cpp is next; or all set).
  useEffect(() => { if ((tab?.what === 'homebrew' && d && d.needs !== 'brew') || (tab && d?.ready)) setTab(null) }, [tab, d])
  useEffect(() => {
    if (tab?.what !== 'whisper' || d?.needs !== 'model' || dl || fetched.current || !model) return
    fetched.current = true
    api(`/speech/models/${model.id}`, { method: 'POST' }).then(refresh, (e) => setErr(e.message))
  }, [tab, d?.needs, dl, model, refresh])
  if (!d) return null
  const run = async (what, fn) => {
    setBusy(true); setErr(null)
    try { const r = await fn(); if (r?.openId) setTab({ id: r.openId, what }); refresh() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const service = d.services?.find((x) => x.id === d.engine)
  const older = d.mac && !d.apple?.available && d.engine === 'local' && d.apple?.why ? `${t("This Mac doesn't transcribe on its own ({why}).", { why: d.apple.why.replace(/^\w/, (c) => c.toLowerCase()) })} ` : ''
  const label = model?.label
  const mb = model?.mb
  const what = {
    whisper: `${older}${t('whisper.cpp turns speech into text on this computer, free and private. It installs in a minute.')}`,
    brew: d.mac
      ? `${older}${t("whisper.cpp turns speech into text on this Mac, free and private. It installs with Homebrew, which isn't on this Mac yet.")}`
      : t('whisper.cpp turns speech into text on this computer, free and private. Install whisper-cpp with your package manager, or use a speech service.'),
    model: dl && !dl.error ? t('The speech model ({model}) is downloading: {percent}%.', { model: model.label, percent: dl.percent })
      : label ? (mb ? t('The speech model ({model}, {mb} MB) downloads once.', { model: label, mb }) : t('The speech model ({model}) downloads once.', { model: label }))
        : mb ? t('The speech model ({mb} MB) downloads once.', { mb }) : t('The speech model downloads once.'),
    apple: d.apple?.why ? t("The Mac's own speech isn't available here ({why}).", { why: d.apple.why.replace(/^\w/, (c) => c.toLowerCase()) }) : t("The Mac's own speech isn't available here."),
    key: service?.label ? t('{service} needs its key, in Settings › Model Providers.', { service: service.label }) : t('That service needs its key, in Settings › Model Providers.'),
  }[d.needs] || t("Speech to text isn't set up yet.")
  const here = !viaRelay
  const actions = (
    <>
      {here && d.needs === 'whisper' && <button type="button" className="btn small primary" disabled={busy || tab?.what === 'whisper'} onClick={() => run('whisper', () => api('/speech/install', { method: 'POST' }))}>{tab?.what === 'whisper' ? t('Installing…') : t('Install whisper.cpp')}</button>}
      {here && d.needs === 'brew' && d.mac && <button type="button" className="btn small primary" disabled={busy || tab?.what === 'homebrew'} onClick={() => run('homebrew', () => api('/fix/install', { method: 'POST', body: { what: 'homebrew' } }))}>{tab?.what === 'homebrew' ? t('Installing…') : t('Install Homebrew')}</button>}
      {d.needs === 'model' && !(dl && !dl.error) && model && <button type="button" className="btn small primary" disabled={busy} onClick={() => run('model', () => api(`/speech/models/${model.id}`, { method: 'POST' }))}>{dl?.error ? t('Try again') : t('Download it')}</button>}
      {d.needs === 'key' && <button type="button" className="btn small primary" onClick={() => settings('providers')}>{t('Add the key')}</button>}
      <button type="button" className="btn small" onClick={() => settings('meetings')} title={t('A speech service is quicker on an older computer, and costs a little per hour of audio')}>{d.needs === 'key' || d.needs === 'apple' ? t('Other ways') : t('Use a speech service')}</button>
    </>
  )
  const note = (
    <>
      {!here && (d.needs === 'whisper' || d.needs === 'brew') && <span className="muted small">{t('Install it in Bridge AI on your computer.')}</span>}
      {tab && <span className="muted small">{tab.what === 'homebrew' ? t('Installing Homebrew in a terminal tab. It asks for your Mac password there, then whisper.cpp is next.') : t("Installing in a terminal tab. The speech model downloads when it's done.")} <button type="button" className="link-btn" onClick={() => showTab(tab.id)}>{t('Show it')}</button></span>}
      {dl?.error && <span className="error-text small">{dl.error}</span>}
      {err && <span className="error-text small">{err}</span>}
    </>
  )
  return { what, actions, note }
}

// Not ready to transcribe: a line above the meetings (and on a meeting while it records).
export default function SpeechSetup({ recording = false }) {
  const { data: d, refresh } = usePoll('/speech', 5000)
  const step = useSpeechStep(d, refresh)
  if (!d || d.ready || !step) return null
  return (
    <div className="mt-setup" role="status">
      <Icon name="alert" size={15} />
      <div className="mt-setup-main">
        <b>{recording ? t("This meeting isn't being transcribed yet") : t("Meetings won't be transcribed yet")}</b>
        <span className="small">{step.what} {recording ? t("The audio is kept: once it's set up, Transcribe again fills in the transcript.") : t("You can still record: the audio is kept and transcribed once it's set up.")}</span>
        {step.note}
      </div>
      <span className="mt-setup-btns">{step.actions}</span>
    </div>
  )
}

// The mic, in the desktop app on a Mac: allowed, not asked yet, or turned off in System Settings.
const micAccess = async () => ((await window.bridgeApp.mediaAccess('microphone')) === 'granted' ? 'ok' : 'denied')
function useMic() {
  const can = !!window.bridgeApp?.mediaAccess && window.bridgeApp.platform === 'darwin'
  const [state, setState] = useState(null)
  const check = useCallback(async () => { if (can) setState(await window.bridgeApp.mediaAccess('microphone').catch(() => null)) }, [can])
  useEffect(() => { check() }, [check])
  useRecheck(check, 0, can)
  // macOS asks the first time the mic is used: open it for a moment, so it asks now.
  const allow = async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()) } catch { /* turned down: the step says how to allow it */ }
    check()
  }
  return can ? { state, check, allow } : null
}

const Step = ({ ok, title, detail, optional, children }) => (
  <li className={`mt-step${ok ? ' ok' : ''}`}>
    <span className="mt-step-mark" role="img" aria-label={ok ? t('Done') : t('To do')}>{ok ? <Icon name="check" size={12} /> : null}</span>
    <div className="mt-step-main">
      <b>{title}{optional && <span className="muted small">{` · ${t('optional')}`}</span>}</b>
      {detail && <span className="muted small">{detail}</span>}
      {children}
    </div>
  </li>
)

// The first time in Meetings: what it takes to get notes from a call, each a tick or one button.
// Nothing here records; Done (or Later) puts it away for good.
export function MeetingsSetup({ onDone }) {
  const sp = usePoll('/speech', 4000)
  const d = sp.data
  const cal = usePoll(d?.mac ? '/calendar' : null, 60_000)
  const [models, setModels] = useState(null)
  const [calOpen, setCalOpen] = useState(false)
  const mic = useMic()
  const step = useSpeechStep(d, sp.refresh)
  useEffect(() => { api('/chat/models').then((r) => setModels(r.models || []), () => setModels([])) }, [])
  if (!d || !step) return null
  const model = d.local?.models?.find((x) => x.id === d.local.model)
  const service = d.services?.find((x) => x.id === d.engine)
  const using = d.engine === 'apple' || d.standIn === 'apple' ? t("The Mac's own speech, on this Mac") : d.engine === 'local' ? (model ? t('{model}, on this computer', { model: model.label }) : t('A speech model, on this computer')) : service?.label
  const micOk = mic?.state === 'granted'
  const notesOk = !!models?.length
  const calOk = !!cal.data
  const done = d.ready && (!mic || micOk) && notesOk
  return (
    <section className="mt-first" aria-label={t('Set up meetings')}>
      <div className="mt-first-head">
        <Icon name="mic" size={16} />
        <div><b>{t('Set up meetings')}</b><span className="muted small">{t('Once, then Take notes is ready when a call starts. Nothing records until you say so.')}</span></div>
      </div>
      <ol className="mt-steps">
        <Step ok={d.ready} title={t('Speech to text')} detail={d.ready ? using : step.what}>
          {d.ready ? <button type="button" className="link-btn small" onClick={() => settings('meetings')}>{t('Change')}</button> : <span className="mt-step-acts">{step.actions}</span>}
          {step.note}
        </Step>
        {mic && (
          <Step ok={micOk} title={t('Your mic')} detail={d.canRecordCall ? t("And the call's sound, so the transcript knows who said what. macOS asks once to allow System Audio Recording, the first time you record a call.") : t('It hears a call on your speakers too.')}>
            {mic.state === 'not-determined' && <span className="mt-step-acts"><button type="button" className="btn small primary" onClick={mic.allow}>{t('Allow the mic')}</button></span>}
            {(mic.state === 'denied' || mic.state === 'restricted') && <PermissionFix pane="microphone" probe={micAccess} onCheck={mic.check}><p className="small">{t('The mic is turned off for Bridge AI in System Settings.')}</p></PermissionFix>}
          </Step>
        )}
        <Step ok={notesOk} title={t('Writing the notes')} detail={models == null ? t('Looking…') : notesOk ? t('The summary, decisions and action items, by your sign-in or key. Pick which in Settings › Meetings.') : t('The summary needs a model: sign in to an agent like Claude Code, or add a key.')}>
          {models && !notesOk && <span className="mt-step-acts"><button type="button" className="btn small primary" onClick={() => settings('providers')}>{t('Model Providers')}</button></span>}
        </Step>
        {d.mac && (
          <Step ok={calOk} optional title={t('Your calendar')} detail={calOk ? t('Notes are named after the meeting, with who was invited.') : t('To name notes after the meeting, and offer Take notes for the one about to start.')}>
            {!calOk && cal.error && (calOpen
              ? <CalendarSetup error={cal.error} code={cal.errorCode} onCheck={() => cal.refresh('?refresh=1')} />
              : <span className="mt-step-acts"><button type="button" className="btn small" onClick={() => setCalOpen(true)}>{t('Set it up')}</button></span>)}
          </Step>
        )}
      </ol>
      <div className="mt-first-foot">
        {done && <span className="small">{t("You're set.")}</span>}
        <button type="button" className={`btn small${done ? ' primary' : ''}`} onClick={onDone}>{done ? t('Done') : t('Later')}</button>
      </div>
    </section>
  )
}
