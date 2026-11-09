import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { api } from '../api.js'
import { how, onVoices, prefs, setPrefs, say, choice, keyOf, tier, quality, betterVoices } from './speak.js'
import { t } from '../i18n/index.js'
import './voice.css'

// Settings › Voice › Spoken Answers: the voice that reads the Chief of Staff's answers aloud on this
// device (its own voices, the most natural first and picked unless you pick another; kept on this
// device, since each has different ones), how fast, and a Test. Or the natural voice your computer
// makes, where it can run: one download, said with its size before it starts, then picked; which
// of its ten voices, and removing it, under Advanced. Where the device has only basic voices, where
// to get better ones. With no voice of its own, the computer's natural voice or eSpeak NG reads
// them, or, with neither, it says answers stay in the chat.
const RATES = [[0.9, '0.9×'], [1, '1×'], [1.15, '1.15×'], [1.3, '1.3×']]
const SAMPLE = () => t('Two agents need you. The payments agent is asking whether to run the migration.')

export default function SpokenAnswers() {
  const [h, setH] = useState(null)
  const [p, setP] = useState(prefs)
  const [asking, setAsking] = useState(false) // the natural voice's download, waiting for a yes
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let on = true
    const check = () => how({ fresh: true }).then((x) => { if (on) setH(x) })
    check()
    const off = onVoices(check)
    return () => { on = false; off() }
  }, [])
  // While it downloads, asked again every second and a half for how far it's got.
  const dl = h?.natural?.downloading
  const going = !!dl && !dl.error
  useEffect(() => {
    if (!going) return undefined
    const id = setInterval(() => how({ fresh: true }).then(setH), 1500)
    return () => clearInterval(id)
  }, [going])
  if (!h) return null
  const pick = (patch) => { setPrefs(patch); setP(prefs()) }
  const act = async (fn) => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false); setH(await how({ fresh: true })) } }
  const list = h.system || []
  const nat = h.natural
  const c = choice(h, p)
  const value = asking || (p.voice === 'natural' && (nat?.have || dl)) ? 'natural' : c?.kind === 'system' ? keyOf(c.voice) : c?.kind || ''
  const onPick = (v) => {
    setErr(null)
    if (v === 'natural' && !nat.have && !going) { setAsking(true); return }
    setAsking(false)
    pick({ voice: v })
  }
  const download = () => act(async () => { await api('/voice/natural', { method: 'POST' }); pick({ voice: 'natural' }); setAsking(false) })
  const remove = () => act(async () => { await api('/voice/natural', { method: 'DELETE' }); if (prefs().voice === 'natural') pick({ voice: null }) })
  const size = t('{n} MB', { n: nat?.mb })
  const usingNatural = value === 'natural'
  // Where to get a more natural voice, when this device's best is a basic one.
  const better = !usingNatural && list.length ? betterVoices(list) : null
  const basic = !usingNatural && list.length > 0 && quality(list[0]) >= 2
  const test = <button type="button" className="btn small" onClick={() => say(SAMPLE())}><Icon name="play" size={12} /> {t('Test')}</button>
  const label = (v) => `${v.name}${tier(v) && !v.name.includes(tier(v)) ? ` · ${t(tier(v))}` : ''}${v.lang ? ` (${v.lang})` : ''}`
  const options = [
    ...list.map((v) => <option key={keyOf(v)} value={keyOf(v)}>{label(v)}</option>),
    nat && <option key="natural" value="natural">{nat.have ? t('Natural voice, made on your computer') : t('Natural voice, made on your computer ({size} download)', { size })}</option>,
    !list.length && h.espeak && <option key="espeak" value="espeak">{t('eSpeak NG, on your computer')}</option>,
  ].filter(Boolean)
  return (
    <section className="st-sec st-voice-out">
      <h4>{t('Spoken Answers')}</h4>
      <p className="muted small">{t('Hold Ask out loud above the Chief of Staff\'s message box, ask "what\'s blocked?", and its answer is read to you by a voice on this device. What you ask goes to the Chief of Staff like any message; nothing else is sent anywhere.')}</p>
      {err && <p className="st-note bad"><Icon name="alert" size={13} /> {err}</p>}
      {options.length > 0 && (
        <>
          <div className="st-row"><span>{t('Voice')}</span>
            <select className="st-input" value={value} onChange={(e) => onPick(e.target.value)} aria-label={t('Voice')}>
              {/* Nothing reads here yet (only the natural voice, not downloaded): None, so it can be picked. */}
              {!c && !asking && <option value="">{t('None')}</option>}
              {options}
            </select>
          </div>
          {asking && nat && (
            <div className="st-note st-natural-ask" role="group" aria-label={t('Natural voice')}>
              <span>{t('The natural voice is made on your computer by {model}, so nothing you hear leaves it. It\'s one download of {size}, from Hugging Face.', { model: nat.label, size })}</span>
              <span className="muted small">{t('{license}, by {by}.', { license: nat.license, by: nat.by })}</span>
              <span className="st-natural-acts">
                <button type="button" className="btn small primary" disabled={busy} onClick={download}><Icon name="download" size={12} /> {t('Download')}</button>
                <button type="button" className="btn small" disabled={busy} onClick={() => setAsking(false)}>{t('Cancel')}</button>
              </span>
            </div>
          )}
          {going && <p className="small st-natural-dl"><span className="vs-bar" role="progressbar" aria-valuenow={dl.percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('Downloading {model}', { model: t('Natural voice') })}><span style={{ width: `${dl.percent}%` }} /></span> <span className="muted">{t('Downloading the natural voice: {n}%. This device\'s own voice reads answers until it\'s here.', { n: dl.percent })}</span></p>}
          {dl?.error && <p className="st-note bad"><Icon name="alert" size={13} /> {t('The natural voice didn\'t download: {why}', { why: dl.error })} <button type="button" className="btn small" disabled={busy} onClick={download}>{t('Try again')}</button></p>}
          {!c ? null : c.kind === 'espeak' ? <p className="small">{test}</p> : (
            <div className="st-row"><span>{t('Speed')}</span>
              <select className="st-input" value={String(Number(p.rate) || 1)} onChange={(e) => pick({ rate: Number(e.target.value) })} aria-label={t('Speed')}>
                {RATES.map(([r, l]) => <option key={r} value={String(r)}>{l}</option>)}
              </select>
              {test}
            </div>
          )}
          {better === 'mac' && <p className="muted small st-better">{t('This Mac has only its basic voices. For a more natural one, download one in System Settings › Accessibility › Read & Speak › System voice › Manage Voices (those marked Premium or Enhanced); it shows here once it\'s downloaded.')}{nat ? ` ${t('Or pick Natural voice, made on your computer.')}` : ''}</p>}
          {better === 'ios' && <p className="muted small st-better">{t('This device has only its basic voices. For a more natural one, download one in Settings › Accessibility › Read & Speak › Voices (those marked Premium or Enhanced).')}{nat ? ` ${t('Or pick Natural voice, made on your computer.')}` : ''}</p>}
          {!better && basic && nat && <p className="muted small st-better">{t('For a more natural voice, pick Natural voice, made on your computer.')}</p>}
          {!list.length && !nat?.have && h.espeak && <p className="muted small">{t('This device has no voice of its own, so eSpeak NG on this computer reads them.')}</p>}
        </>
      )}
      {!c && !going && <p className="st-note"><Icon name="info" size={13} /> {nat ? t('This device has no voice to read answers with, so they stay in the chat until you pick Natural voice.') : t('This device has no voice to read answers with, so they stay in the chat. On Linux, installing eSpeak NG (espeak-ng) adds one.')}</p>}
      {nat?.have && (
        <details className="st-adv st-natural">
          <summary>{t('Advanced')}</summary>
          <div className="st-row"><span>{t('Natural voice')}</span>
            <select className="st-input" value={String(Number(p.natural) || 0)} onChange={(e) => pick({ natural: Number(e.target.value) })} aria-label={t('Natural voice')}>
              {Array.from({ length: nat.voices || 10 }, (_, i) => <option key={i} value={String(i)}>{i < 5 ? t('Female {n}', { n: i + 1 }) : t('Male {n}', { n: i - 4 })}</option>)}
            </select>
            <button type="button" className="ghost-btn" aria-label={t('Remove {model}', { model: t('Natural voice') })} title={t('Remove the download')} disabled={busy} onClick={remove}><Icon name="trash" size={13} /></button>
          </div>
          <p className="muted small">{t('{model}, by {by}, made on your computer ({size}). {license}.', { model: nat.label, by: nat.by, size, license: nat.license })}</p>
        </details>
      )}
    </section>
  )
}
