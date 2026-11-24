import { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll } from '../../api.js'
import PermissionFix, { useRecheck } from '../PermissionFix.jsx'
import { appSide } from '../../permissions.js'
import { CalendarSetup } from '../Agenda.jsx'
import { t } from '../../i18n/index.js'
import { where } from '../settings/search.js'

// Before you record: whether what you say will be turned into text, and if not, what it needs and
// the one step that fixes it (server/speech.js status: ready, needs). A meeting recorded meanwhile
// keeps its audio, so Transcribe again fills it in once it's set up. The first time, Meetings shows
// the whole setup instead, Granola style: speech to text, the mic, who writes the notes and the
// calendar, each a tick or one button.
const settings = (section) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section } }))

// What speech to text needs, in a sentence, and the buttons that do it.
function useSpeechStep(d, refresh) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const model = d?.local?.models?.find((x) => x.id === d.local.model)
  const dl = model?.downloading
  if (!d) return null
  const run = async (fn) => {
    setBusy(true); setErr(null)
    try { await fn(); refresh() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const service = d.services?.find((x) => x.id === d.engine)
  const label = model?.label
  const mb = model?.mb
  const what = {
    model: dl && !dl.error ? t('The speech model ({model}) is downloading: {percent}%.', { model: model.label, percent: dl.percent })
      : label ? (mb ? t('The speech model ({model}, {mb} MB) downloads once.', { model: label, mb }) : t('The speech model ({model}) downloads once.', { model: label }))
        : mb ? t('The speech model ({mb} MB) downloads once.', { mb }) : t('The speech model downloads once.'),
    apple: d.apple?.why ? t("The Mac's own speech isn't available here ({why}).", { why: d.apple.why.replace(/^\w/, (c) => c.toLowerCase()) }) : t("The Mac's own speech isn't available here."),
    key: service?.label ? t('{service} needs its key, in {place}.', { place: where('providers-speech'), service: service.label }) : t('That service needs its key, in {place}.', { place: where('providers-speech') }),
  }[d.needs] || t("Speech to text isn't set up yet.")
  const actions = (
    <>
      {d.needs === 'model' && !(dl && !dl.error) && model && <button type="button" className="btn small primary" disabled={busy} onClick={() => run(() => api(`/speech/models/${model.id}`, { method: 'POST' }))}>{dl?.error ? t('Try again') : t('Download it')}</button>}
      {d.needs === 'key' && <button type="button" className="btn small primary" onClick={() => settings('providers')}>{t('Add the key')}</button>}
      <button type="button" className="btn small" onClick={() => settings('meetings')} title={t('A speech service is quicker on an older computer, and costs a little per hour of audio')}>{d.needs === 'key' || d.needs === 'apple' ? t('Other ways') : t('Use a speech service')}</button>
    </>
  )
  const note = (
    <>
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
function useMic() {
  const can = !!window.bridgeApp?.mediaAccess && window.bridgeApp.platform === 'darwin'
  const [state, setState] = useState(null)
  const check = useCallback(async () => { if (can) setState(await window.bridgeApp.mediaAccess('microphone').catch(() => null)) }, [can])
  useEffect(() => { check() }, [check])
  useRecheck(check, 0, can)
  // macOS's own question, asked by the app (desktop/permissions.js); an app too old to ask opens the
  // mic for a moment, which asks the first time.
  const allow = async () => {
    const side = appSide('microphone')
    if (side?.ask) await side.ask().catch(() => null)
    else try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()) } catch { /* turned down: the step says how to allow it */ }
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
            {(mic.state === 'denied' || mic.state === 'restricted') && <PermissionFix pane="microphone" onCheck={mic.check}><p className="small">{t('The mic is turned off for Bridge AI in System Settings.')}</p></PermissionFix>}
          </Step>
        )}
        <Step ok={notesOk} title={t('Writing the notes')} detail={models == null ? t('Looking…') : notesOk ? t('The summary, decisions and action items, by your sign-in or key. Pick which in {place}.', { place: where('notes-model') }) : t('The summary needs a model: sign in to an agent like Claude Code, or add a key.')}>
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
