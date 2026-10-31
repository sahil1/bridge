import { useCallback, useEffect, useState } from 'react'
import { api, refetch } from '../../api.js'
import { RECENT, ANY } from '../dictations/shared.jsx'
import Icon from '../Icon.jsx'
import { useSettings, SaveNote } from './General.jsx'
import PermissionFix, { UpdateApp } from '../PermissionFix.jsx'
import { keyLabel, keyFromEvent } from '../../../shared/dictation/keys.js'
import { pause, keysPlatform, dictationKey } from '../../dictation/controller.js'
import { t, tx } from '../../i18n/index.js'
import '../../dictation/dictation.css'

// Settings › Voice › Dictation (dictation/controller.js): on or off, the key, whether it works from
// other apps too (the desktop app, where this computer lets it: desktop/dictation.js says how), where
// the text goes from there, and the light cleanup. Saved as `dictation` in config.json; the desktop
// app is told at once.
//
// "Where I'm typing" pastes it into the app you were in, and is offered only where this computer can
// (shared/dictation/platform.js pasteInto). On a Mac it needs Accessibility, asked for the moment you
// pick it (macOS's own question, then the Allow access tile beside System Settings: PermissionFix,
// which notices when it's on and offers Reset and ask again when it doesn't take), and until it's
// on, the dictation window shows what you said to copy, as before. A desktop app too old to say
// any of this (before 3.7) is told to update, rather than leaving the options out unsaid.
//
// Live words: the words shown as you talk, where the speech model and this computer allow it
// (server/livewords.js), on unless you turn them off.
//
// History: each dictation kept on this computer (Dictations, under Meetings), on until you turn it
// off, for always or less; the recordings only if you ask; Delete all, after asking.
const TO = [['last', tx('The agent I looked at last')], ['chief', tx('The chief of staff')], ['ask', tx('Ask each time')]]
// How long dictations are kept (server/dictations.js): always unless you pick less.
const KEEP = [['30d', tx('30 days')], ['1y', tx('1 year')], ['always', tx('Always')]]
const PASTE = ['paste', tx('Where I\'m typing (paste it)')]

export default function Dictation() {
  const { s, save, note } = useSettings()
  const app = window.bridgeApp
  const [status, setStatus] = useState(null) // the desktop app's: { mode, key, label, background, taken, fallback, error, asks, why, paste }
  const [picking, setPicking] = useState(false)
  const [asking, setAsking] = useState(0) // "Where I'm typing" just picked: Accessibility asked for then
  // Accessibility turned on: the desktop app's status again, so pasting is on.
  const refresh = useCallback(async () => {
    const st = await app?.dictateStatus?.().catch(() => null)
    if (st) setStatus(st)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { app?.dictateStatus?.().then(setStatus, () => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Live words: whether they can work on this computer (server/livewords.js), asked again after a
  // change here (a new speech model, say).
  const [live, setLive] = useState(null) // { can, why, off }
  useEffect(() => { api('/dictation/live').then(setLive, () => setLive(null)) }, [s?.effective?.dictation?.liveWords, s?.effective?.speech?.model]) // eslint-disable-line react-hooks/exhaustive-deps
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
  const on = d.on !== false
  const mode = status?.mode || null
  const background = d.background === true
  const paste = status?.paste?.can ? status.paste : null
  const pasting = on && !!mode && background && d.to === 'paste'
  // Picked, on a Mac without Accessibility yet: the card asks, and notices by itself when it's on.
  const needsAccess = pasting && paste?.asks === 'accessibility' && !paste.allowed
  const [cleared, setCleared] = useState(null)
  if (!s) return <div className="skeleton-rows"><div /><div /></div>

  const pickTo = async (v) => {
    await set({ to: v })
    if (v === 'paste' && paste?.asks === 'accessibility' && !paste.allowed) setAsking((n) => n + 1)
  }
  return (
    <>
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
              <span className="st-choices">{(paste ? [...TO, PASTE] : TO).map(([v, l]) => (
                <label key={v}><input type="radio" name="dict-to" checked={(d.to === 'paste' && !paste ? 'last' : d.to || 'last') === v} onChange={() => pickTo(v)} /> {t(l)}</label>
              ))}</span>
            </div>
          )}
          {needsAccess && (
            <div className="dict-paste-access">
              <PermissionFix pane="accessibility" ask={asking} onCheck={refresh}>
                <p className="small">{t('Pasting needs Accessibility, so Bridge AI can press ⌘V in the app you\'re typing in. Until it\'s on, the small window shows what you said, to copy.')}</p>
              </PermissionFix>
            </div>
          )}
          {/* wtype (Wayland) types it in, with no clipboard to put back. */}
          {pasting && paste && !needsAccess && paste.via !== 'wtype' && <p className="muted small">{paste.limit === 'admin'
            ? t('What you had copied is put back after. It can\'t paste into an app running as administrator.')
            : t('What you had copied is put back after.')}</p>}
          {/* Picked on another computer, and pasting can't work on this one: said once here. */}
          {pasting && status && !paste && <p className="st-note"><Icon name="info" size={13} /> {t('Pasting where you\'re typing can\'t work on this computer, so what you say goes to the agent you looked at last.')}</p>}
          <label className="st-check"><input type="checkbox" checked={d.cleanup !== false} onChange={(e) => set({ cleanup: e.target.checked })} />
            <span><b>{t('Light cleanup')}</b> <span className="muted small">{t('Drops "um" and "uh" and words said twice, starts with a capital and ends with a full stop, and spells the names of your agents, projects, branches and meeting memory the way they\'re written. No AI model, nothing sent anywhere.')}</span></span></label>
          <label className="st-check"><input type="checkbox" checked={d.atFiles !== false} onChange={(e) => set({ atFiles: e.target.checked })} />
            <span><b>{t('Mention files by saying them')}</b> <span className="muted small">{t('"at payments dot ts" becomes @payments.ts in the message box.')}</span></span></label>
          {/* Shown where a speech model sherpa-onnx runs is picked (Parakeet): hidden with Whisper or
              the Mac's own speech, which hear a recording whole. Too slow here: said once. */}
          {live && ['off', 'model', null].includes(live.why) && (
            <label className="st-check"><input type="checkbox" checked={d.liveWords !== false} onChange={(e) => set({ liveWords: e.target.checked })} />
              <span><b>{t('Show the words as you talk')}</b> <span className="muted small">{t('While it listens, and under a meeting\'s transcript while someone is talking. Heard on this computer as you go; the finished text is the same as before.')}</span></span></label>
          )}
          {live?.why === 'slow' && d.liveWords !== false && <p className="st-note"><Icon name="info" size={13} /> {t('This computer turns speech into text too slowly to show the words as you talk, so they come when you let go.')}</p>}
          {!app?.desktop && !touch && <p className="muted small">{t('In the desktop app, the key works from other apps too.')}</p>}
          {app?.desktop && !app.dictateStatus && !touch && <UpdateApp why={t('The key from other apps needs a newer Bridge AI desktop app.')} />}
        </>
      )}
      <p className="muted small"><Icon name="laptop" size={12} /> {t('Your voice is turned into text on this computer. Nothing is sent anywhere.')}</p>
    </section>
    <History d={d} set={set} cleared={cleared} onClear={async () => {
      if (!window.confirm(`${t('Delete every dictation kept on this computer?')}\n\n${t('Their words, their recordings and the apps\' icons go. This can\'t be undone.')}`)) return
      try { await api('/dictations', { method: 'DELETE' }); setCleared(t('Deleted.')); refetch(RECENT); refetch(ANY) } catch (e) { setCleared(e.message) }
    }} />
    </>
  )
}

// Keep a history: on or off, for how long, the recordings too, and Delete all.
function History({ d, set, cleared, onClear }) {
  const on = d.history !== false
  const keep = KEEP.some(([v]) => v === d.keepFor) ? d.keepFor : 'always'
  return (
    <section className="st-sec st-dict-history">
      <h4>{t('Dictation History')}</h4>
      <label className="st-check"><input type="checkbox" checked={on} onChange={(e) => set({ history: e.target.checked })} />
        <span><b>{t('Keep a history of what you dictate')}</b> <span className="muted small">{t('In Dictations, under Meetings: what you said, when, and where it went (the app or the agent), to find, copy or send again. Only on this computer.')}</span></span></label>
      {on && (
        <>
          <div className="st-row st-radios" role="radiogroup" aria-label={t('Keep them for')}><span>{t('Keep them for')}</span>
            <span className="st-choices st-choices-row">{KEEP.map(([v, l]) => (
              <label key={v}><input type="radio" name="dict-keep" checked={keep === v} onChange={() => set({ keepFor: v })} /> {t(l)}</label>
            ))}</span>
          </div>
          <label className="st-check"><input type="checkbox" checked={d.keepAudio === true} onChange={(e) => set({ keepAudio: e.target.checked })} />
            <span><b>{t('Keep the recordings too')}</b> <span className="muted small">{t('To play back what you said. About 2 MB for each minute you talk.')}</span></span></label>
        </>
      )}
      <div className="st-row">
        <button type="button" className="btn small danger-soft" onClick={onClear}><Icon name="trash" size={12} /> {t('Delete all dictations…')}</button>
        {cleared && <span className="muted small" role="status">{cleared}</span>}
      </div>
    </section>
  )
}
