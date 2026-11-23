import { useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll } from '../../api.js'
import { useSettings, SaveNote } from './General.jsx'
import SpokenAnswers from '../../voice/SpokenAnswers.jsx'
import { More } from './Advanced.jsx'
import { t, tx } from '../../i18n/index.js'
import '../meetings/meetings.css'

// Settings › Meetings & Voice › Speech Models (listening): the speech models this computer can run
// (the ones it can't aren't listed), the one voice notes, dictation and meetings use, and their
// downloads. Parakeet first; Whisper, for the languages Parakeet doesn't hear, folded away until
// it's wanted. Both run inside Bridge AI (sherpa-onnx), each one download. What earlier versions
// downloaded for whisper.cpp, which nothing uses now, can be removed. Server: speech.js (status,
// and what this computer can run), voice.js. The voice that
// reads the Chief of Staff's answers aloud (speaking) is the next tab, Spoken Answers (Spoken,
// below: voice/SpokenAnswers.jsx). Dictation's own settings are the tab before (Dictation.jsx).
const size = (mb) => (mb >= 1000 ? t('{n} GB', { n: (mb / 1000).toFixed(1) }) : t('{n} MB', { n: mb }))
// What the server says of each speech model (server/speech.js), marked here so it's translated.
tx('Accurate and quick on any computer. English and 24 more European languages, which it tells apart itself.'); tx('The best at tool names and jargon (worktree, Claude Code).')
tx("For the languages Parakeet doesn't hear. Accurate and still quick."); tx('Light and quick.'); tx('The lightest that does the job.'); tx('The most accurate Whisper, and the slowest.')
const heard = (l) => (l === 'auto' ? t('about 100 languages') : l?.length === 1 ? t('English only') : t('{n} languages', { n: l?.length || 0 }))

export default function Voice() {
  const { s, save, note } = useSettings()
  const sp = usePoll('/speech', 3000)
  const vo = usePoll('/voice', 3000)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  if (!s || !sp.data || !vo.data) return <div className="skeleton-rows"><div /><div /><div /></div>
  const d = sp.data
  const v = vo.data
  const act = async (name, fn) => { setBusy(name); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(null); sp.refresh(); vo.refresh() } }
  // One pick for everything: an older pick in the Meetings tab gives way to it.
  const use = (id) => act(`use:${id}`, () => save({ speech: { model: id }, meetings: { localModel: null } }))
  const using = v.engine === 'apple' ? 'apple' : v.model.id
  const fell = d.fellBack || v.fellBack
  const parakeets = d.local.models.filter((x) => !x.whisper)
  const whispers = d.local.models.filter((x) => x.whisper)
  const whisperOpen = whispers.some((x) => x.have || x.downloading || x.id === using) || !parakeets.length
  const earlier = d.local.earlier?.files > 0 ? d.local.earlier : null

  const row = (x) => {
    const on = using === x.id
    const dl = x.downloading
    return (
      <li className={on ? 'on' : ''} data-model={x.id}>
        <span className="mt-model-main">
          <b>{x.label}{x.best && <span className="best-tag">{t('recommended')}</span>}</b>
          <small>{x.note ? t(x.note) : ''} {t('{size}, {languages}. {license}, by {by}.', { size: size(x.mb), languages: heard(x.languages), license: x.license, by: x.by })}</small>
          {dl && !dl.error && <span className="vs-bar" role="progressbar" aria-valuenow={dl.percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('Downloading {model}', { model: x.label })}><span style={{ width: `${dl.percent}%` }} /></span>}
          {dl?.error && <span className="error-text small">{dl.error}</span>}
        </span>
        {dl && !dl.error ? <span className="muted small">{t('Downloading {n}%', { n: dl.percent })}</span>
          : x.have ? (
            <span className="mt-model-acts">
              {on ? <span className="mt-state good"><Icon name="check" size={12} /> {t('In use')}</span>
                : <button type="button" className="btn small" disabled={!!busy || !x.usable} onClick={() => use(x.id)}>{t('Use')}</button>}
              <button type="button" className="ghost-btn" aria-label={t('Remove {model}', { model: x.label })} title={t('Remove the download')} disabled={!!busy} onClick={() => act(`rm:${x.id}`, () => api(`/speech/models/${x.id}`, { method: 'DELETE' }))}><Icon name="trash" size={13} /></button>
            </span>
          ) : (
            <span className="mt-model-acts">
              {on && <span className="muted small">{t('Picked')}</span>}
              <button type="button" className={`btn small${on ? ' primary' : ''}`} disabled={!!busy} onClick={() => act(`get:${x.id}`, () => api(`/speech/models/${x.id}`, { method: 'POST' }))}>
                <Icon name="download" size={12} /> {dl?.error ? t('Try again') : t('Download')}
              </button>
            </span>
          )}
      </li>
    )
  }

  return (
    <div className="st-sections st-voice">
      <SaveNote note={note} />
      {err && <p className="st-note bad"><Icon name="alert" size={13} /> {err}</p>}
      {fell && (
        <p className="st-note warn" role="status"><Icon name="info" size={13} /> {!fell.toLabel
          ? t("{from} can't run on this computer ({why}), nor can another speech model. Meetings can use a speech service.", { from: fell.fromLabel || fell.from, why: String(fell.why || '').replace(/^\w/, (c) => c.toLowerCase()) })
          : fell.why
            ? t("{from} can't run on this computer ({why}), so {to} is used here.", { from: fell.fromLabel || fell.from, to: fell.toLabel, why: fell.why.replace(/^\w/, (c) => c.toLowerCase()) })
            : t("{from} can't run on this computer, so {to} is used here.", { from: fell.fromLabel || fell.from, to: fell.toLabel })}</p>
      )}

      <section className="st-sec" data-setting="speech-model">
        <h4>{t('Speech Model')}</h4>
        <p className="muted small">{t('Voice notes, dictation and meetings are turned into text here: what you say never leaves this computer.')} <More>{t('Voice notes, dictation and meetings are turned into text on this computer by the speech model you pick here. What you say never leaves it. Each model is one download, from Hugging Face.')}</More></p>
        {v.standIn === 'apple' && <p className="small">{t("Until {model} is downloaded, the Mac's own speech turns what you say into text.", { model: v.model.label })}</p>}
        <ul className="mt-models" aria-label={t('Speech models')}>
          {parakeets.map(row)}
          {d.apple?.available && (
            <li className={using === 'apple' ? 'on' : ''} data-model="apple">
              <span className="mt-model-main"><b>{t("The Mac's own speech")}</b><small>{t('Built into macOS 26 and later. Nothing for Bridge AI to download: macOS fetches its language once.')}</small></span>
              <span className="mt-model-acts">{using === 'apple' ? <span className="mt-state good"><Icon name="check" size={12} /> {t('In use')}</span> : <button type="button" className="btn small" disabled={!!busy} onClick={() => use('apple')}>{t('Use')}</button>}</span>
            </li>
          )}
        </ul>
        {whispers.length > 0 && (
          <details className="st-fold st-whisper" open={whisperOpen} data-setting="whisper">
            <summary><Icon name="chevron" size={12} />{t('Whisper, for other languages')}</summary>
            <p className="muted small">{t('Whisper hears about 100 languages and tells which one it hears. It runs in Bridge AI, on this computer: each model is one download, with nothing to install.')}</p>
            <ul className="mt-models" aria-label={t('Whisper models')}>{whispers.map(row)}</ul>
          </details>
        )}
        {earlier && (
          <p className="muted small st-earlier">{t("Whisper models downloaded by earlier versions ({size}) aren't used any more.", { size: size(earlier.mb) })} <button type="button" className="link-btn" disabled={!!busy} onClick={() => act('earlier', () => api('/speech/earlier', { method: 'DELETE' }))}>{t('Remove them')}</button></p>
        )}
        {d.hidden?.length > 0 && <p className="muted small">{t('More speech models are offered on other computers.')}</p>}
      </section>
    </div>
  )
}

// Settings › Meetings & Voice › Spoken Answers (speaking): the voice that reads the Chief of Staff's
// answers aloud, where a robotic one is swapped for a natural one.
export function Spoken() {
  return <div className="st-sections st-spoken"><div data-setting="spoken-answers"><SpokenAnswers /></div></div>
}
