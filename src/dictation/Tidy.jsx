import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { api } from '../api.js'
import { t } from '../i18n/index.js'

// Tidy what I say (a trial: dictation-cleanup): what you say from another app, tidied by a model
// before the dictation window pastes it (controller.js tidyWords, server/dictation.js tidy). What
// Settings › Voice › Dictation and the dictation window both say about it.

// Why what you said went as you said it, in a few words (after "Pasted into Slack", or on the card).
export function untidiedWhy(u) {
  if (!u) return null
  if (u.code === 'slow') return t('Not tidied: the model took too long.')
  if (u.code === 'changed') return t('Not tidied: the model\'s answer wasn\'t what you said.')
  if (u.code === 'no-model') return t('Not tidied: there\'s no model to tidy with yet.')
  if (u.code === 'long') return t('Not tidied: that\'s more than tidying takes.')
  return t('Not tidied: {error}', { error: u.error || t('the model couldn\'t be reached') })
}

const gb = (mb) => `${(mb / 1000).toFixed(1)} GB`
// With no model to tidy with: what's needed. Where the local model built in runs, it, in one click
// (never on its own, never at setup), with its progress and a download that stopped saying why;
// elsewhere, a model of your own in Settings › Model Providers. local: /dictation/tidy's local
// ({ offered, have, downloading, mb, label }); onReady: once it's in. on: tidying is turned on, so
// it says what happens meanwhile (your words go as you said them). onProviders: the way to Model
// Providers, where there's one (Settings).
export function TidyNeeds({ local, onReady, className = '', on = false, onProviders = null }) {
  const [l, setL] = useState(local)
  const [err, setErr] = useState(null)
  useEffect(() => { setL(local) }, [local])
  const going = !!l?.downloading && !l.downloading.error
  useEffect(() => {
    if (!going) return
    const id = setInterval(async () => {
      const s = await api('/llm').catch(() => null)
      if (!s) return
      setL((x) => ({ ...x, have: s.have, downloading: s.downloading }))
      if (s.have) onReady?.()
    }, 1000)
    return () => clearInterval(id)
  }, [going]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!l) return null
  const meanwhile = on && !l.have ? ` ${t('Until then, what you say goes as you said it.')}` : ''
  if (!l.offered) {
    return (
      <div className={`st-note tidy-needs${on ? ' warn' : ''} ${className}`} role="status">
        <p><Icon name={on ? 'alert' : 'info'} size={13} /> {t('Tidying needs a model: add one in Settings › Model Providers (Ollama, LM Studio or a key).')}{meanwhile}</p>
        {onProviders && <button type="button" className="btn small" onClick={onProviders}>{t('Open Model Providers')}</button>}
      </div>
    )
  }
  const get = async () => {
    setErr(null)
    try { const s = await api('/llm/download', { method: 'POST' }); setL((x) => ({ ...x, have: s.have, downloading: s.downloading || { percent: 0 } })); if (s.have) onReady?.() } catch (e) { setErr(e.message) }
  }
  const stopped = l.downloading?.error || err
  return (
    <div className={`tidy-needs ${className}`} role="status">
      {l.have ? <p className="small"><Icon name="check" size={12} /> {t('The local model is ready: what you say is tidied on this computer from now on.')}</p>
        : going ? <p className="small">{t('Downloading the local model… {n}%', { n: l.downloading.percent || 0 })} {t('What you say is tidied once it\'s in.')}</p>
          : (
            <>
              <p className="small">{stopped ? t('The download stopped: {error}', { error: stopped }) : t('Tidying needs a model. The local model runs on this computer, so what you say stays here.')}{meanwhile}</p>
              <button type="button" className="btn small primary" onClick={get}><Icon name="download" size={12} /> {stopped ? t('Try again') : t('Download the local model ({size})', { size: gb(l.mb || 0) })}</button>
            </>
          )}
    </div>
  )
}
