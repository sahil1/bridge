import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { how, onVoices, prefs, setPrefs, say } from './speak.js'
import { t } from '../i18n/index.js'
import './voice.css'

// Settings › Voice › Spoken Answers: the voice that reads the Chief of Staff's answers aloud on this
// device (its own voices only; kept on this device, since each has different ones), how fast, and a
// Test. Where this device has none, the computer's eSpeak NG reads them, or, with neither, it says
// answers stay in the chat.
const RATES = [[0.9, '0.9×'], [1, '1×'], [1.15, '1.15×'], [1.3, '1.3×']]

export default function SpokenAnswers() {
  const [h, setH] = useState(null)
  const [p, setP] = useState(prefs)
  useEffect(() => {
    let on = true
    const check = () => how().then((x) => { if (on) setH(x) })
    check()
    const off = onVoices(check)
    return () => { on = false; off() }
  }, [])
  if (!h) return null
  const pick = (patch) => { setPrefs(patch); setP(prefs()) }
  const list = h.system || []
  const current = list.find((v) => v.name === p.voice) || list[0]
  return (
    <section className="st-sec st-voice-out">
      <h4>{t('Spoken Answers')}</h4>
      <p className="muted small">{t('Hold Ask out loud above the Chief of Staff\'s message box, ask "what\'s blocked?", and its answer is read to you by a voice on this device. What you ask goes to the Chief of Staff like any message; nothing else is sent anywhere.')}</p>
      {list.length > 0 && (
        <>
          <div className="st-row"><span>{t('Voice')}</span>
            <select className="st-input" value={current?.name || ''} onChange={(e) => pick({ voice: e.target.value })} aria-label={t('Voice')}>
              {list.map((v) => <option key={v.name} value={v.name}>{v.name}{v.lang ? ` (${v.lang})` : ''}</option>)}
            </select>
          </div>
          <div className="st-row"><span>{t('Speed')}</span>
            <select className="st-input" value={String(Number(p.rate) || 1)} onChange={(e) => pick({ rate: Number(e.target.value) })} aria-label={t('Speed')}>
              {RATES.map(([r, l]) => <option key={r} value={String(r)}>{l}</option>)}
            </select>
            <button type="button" className="btn small" onClick={() => say(t('Two agents need you. The payments agent is asking whether to run the migration.'))}><Icon name="play" size={12} /> {t('Test')}</button>
          </div>
        </>
      )}
      {!list.length && h.espeak && <p className="small">{t('This device has no voice of its own, so eSpeak NG on this computer reads them.')} <button type="button" className="btn small" onClick={() => say(t('Two agents need you. The payments agent is asking whether to run the migration.'))}><Icon name="play" size={12} /> {t('Test')}</button></p>}
      {!list.length && !h.espeak && <p className="st-note"><Icon name="info" size={13} /> {t('This device has no voice to read answers with, so they stay in the chat. On Linux, installing eSpeak NG (espeak-ng) adds one.')}</p>}
    </section>
  )
}
