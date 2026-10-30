import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { useSettings, SaveNote } from './General.jsx'
import { keyLabel, keyFromEvent } from '../../../shared/dictation/keys.js'
import { pause, keysPlatform, dictationKey } from '../../dictation/controller.js'
import { t, tx } from '../../i18n/index.js'
import '../../dictation/dictation.css'

// Settings › Voice › Dictation (dictation/controller.js): on or off, the key, whether it works from
// other apps too (the desktop app, where this computer lets it: desktop/dictation.js says how), where
// the text goes from there, and the light cleanup. Saved as `dictation` in config.json; the desktop
// app is told at once.
const TO = [['last', tx('The agent I looked at last')], ['chief', tx('The chief of staff')], ['ask', tx('Ask each time')]]

export default function Dictation() {
  const { s, save, note } = useSettings()
  const app = window.bridgeApp
  const [status, setStatus] = useState(null) // the desktop app's: { mode, key, label, background, taken, fallback, error, asks, why }
  const [picking, setPicking] = useState(false)
  useEffect(() => { app?.dictateStatus?.().then(setStatus, () => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const plat = keysPlatform()
  const d = s?.effective?.dictation || {}
  const key = dictationKey(d)
  const label = keyLabel(key, plat)
  const touch = matchMedia('(pointer: coarse)').matches
  const set = async (patch) => {
    const next = { ...d, ...patch }
    await save({ dictation: patch })
    if (app?.dictateConfigure) setStatus(await app.dictateConfigure(next).catch(() => status))
  }
  // A new key: the next combination pressed (Esc keeps the one there is).
  useEffect(() => {
    if (!picking) return
    pause(true)
    const down = (e) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setPicking(false); return }
      const k = keyFromEvent(e, plat)
      if (k) { setPicking(false); set({ key: k }) }
    }
    window.addEventListener('keydown', down, true)
    return () => { window.removeEventListener('keydown', down, true); pause(false) }
  }, [picking]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <div className="skeleton-rows"><div /><div /></div>

  const on = d.on !== false
  const mode = status?.mode || null
  const background = d.background === true
  return (
    <section className="st-sec st-dictation">
      <h4>{t('Dictation')}</h4>
      <SaveNote note={note} />
      <label className="st-check"><input type="checkbox" checked={on} onChange={(e) => set({ on: e.target.checked })} />
        <span><b>{t('Talk to your agents')}</b> <span className="muted small">{touch ? t('Hold the mic button in a message box and talk; let go and the words are there. Tap it instead to keep listening.') : t('Hold {key} and talk; let go and the words are where you were typing (a message box, a terminal, a search). Tap it instead to keep listening. Esc cancels.', { key: label })}</span></span></label>
      {on && (
        <>
          {!touch && (
            <div className="st-row"><span>{t('Key')}</span>
              <kbd className="dict-key">{picking ? t('Press the keys…') : label}</kbd>
              <button type="button" className="btn small" onClick={() => setPicking((v) => !v)}>{picking ? t('Cancel') : t('Change')}</button>
              {d.key && !picking && <button type="button" className="link-btn" onClick={() => set({ key: null })}>{t('Back to {key}', { key: keyLabel(dictationKey({}), plat) })}</button>}
            </div>
          )}
          {status?.taken && <p className="st-note warn"><Icon name="alert" size={13} /> {status.taken === 'macOS' ? t('{key} is one of macOS\'s own shortcuts. Pick another key, or turn that one off in System Settings › Keyboard › Keyboard Shortcuts.', { key: label }) : t('{key} is taken by another app. Pick another key.', { key: label })}</p>}
          {status?.fallback && <p className="st-note"><Icon name="info" size={13} /> {t('This Mac didn\'t take {key} from other apps, so {other} works there instead.', { key: label, other: keyLabel(status.fallback, plat) })}</p>}
          {mode && (
            <label className="st-check"><input type="checkbox" checked={background} onChange={(e) => set({ background: e.target.checked })} />
              <span><b>{t('Works while Bridge AI is in the background')}</b> <span className="muted small">{mode === 'hold'
                ? t('Hold {key} in any app: a small window shows what you said, to send to an agent or copy.', { key: label })
                : t('Tap {key} in any app to start listening, and again when you\'re done: a small window shows what you said, to send to an agent or copy.', { key: label })}
              {status?.asks ? ` ${t('Your desktop asks once to allow the key.')}` : ''}</span></span></label>
          )}
          {/* A setting from another computer that can't work on this one: said once here. */}
          {status && !mode && d.background === true && <p className="st-note"><Icon name="info" size={13} /> {t('From other apps, the key can\'t be heard on this computer, so it works inside Bridge AI only.')}</p>}
          {mode && background && (
            <div className="st-row st-radios" role="radiogroup" aria-label={t('Send what I say to')}><span>{t('Send what I say to')}</span>
              <span className="st-choices">{TO.map(([v, l]) => (
                <label key={v}><input type="radio" name="dict-to" checked={(d.to || 'last') === v} onChange={() => set({ to: v })} /> {t(l)}</label>
              ))}</span>
            </div>
          )}
          <label className="st-check"><input type="checkbox" checked={d.cleanup !== false} onChange={(e) => set({ cleanup: e.target.checked })} />
            <span><b>{t('Light cleanup')}</b> <span className="muted small">{t('Drops "um" and "uh" and words said twice, starts with a capital and ends with a full stop, and spells the names of your agents, projects, branches and meeting memory the way they\'re written. No AI model, nothing sent anywhere.')}</span></span></label>
          <label className="st-check"><input type="checkbox" checked={d.atFiles !== false} onChange={(e) => set({ atFiles: e.target.checked })} />
            <span><b>{t('Mention files by saying them')}</b> <span className="muted small">{t('"at payments dot ts" becomes @payments.ts in the message box.')}</span></span></label>
          {!app?.desktop && !touch && <p className="muted small">{t('In the desktop app, the key works from other apps too.')}</p>}
        </>
      )}
      <p className="muted small"><Icon name="laptop" size={12} /> {t('Your voice is turned into text on this computer. Nothing is sent anywhere.')}</p>
    </section>
  )
}
