import { useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll } from '../../api.js'
import { t, locale } from '../../i18n/index.js'
import { More } from './Advanced.jsx'
import '../aiconsent.css'

// Settings › Devices & Access › Phone › AI Providers: the AI providers your phone has allowed what
// you send from it to go on to (server/aiconsent.js), each with when, from which device and through
// what, and Take Back, after which the phone asks again. Shown on the computer and on the phone
// alike; the computer itself is never asked (what you set up here, you set up here). local: Cloud
// Agents on the phone alone, which sends straight to each provider and keeps the answers there.
export default function AiProviders({ local = false }) {
  const { data, error, refresh } = usePoll('/ai-consent', 60_000)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const list = data?.allowed || []
  const takeBack = async (id) => {
    setBusy(id)
    setErr(null)
    try { await api(`/ai-consent/${encodeURIComponent(id)}`, { method: 'DELETE' }); refresh() } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  return (
    <section className="st-sec aip-sec" data-setting="ai-providers">
      <h4><Icon name="wand" size={14} /> {t('AI Providers')}</h4>
      <p className="muted small">{local
        ? t('Before a task goes to a cloud agent\'s provider, this phone asks you, once for each provider. The ones you allowed:')
        : t('Before what you send from your phone goes on to an AI provider, such as Anthropic for Claude Code or OpenAI for Codex, your phone asks you, once for each provider. The ones you allowed:')}</p>
      {error && !data && <p className="error-text small" role="alert">{error}</p>}
      {data && !list.length && <p className="muted small aip-none">{t('None yet.')}</p>}
      {list.length > 0 && (
        <ul className="aip-list">
          {list.map((p) => (
            <li key={p.id} className="aip-row">
              <span className="aip-text">
                <b>{p.name}</b>
                <span className="muted small">{[
                  p.via ? t('through {via}', { via: p.via }) : null,
                  t('allowed on {date}', { date: new Date(p.at).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) }),
                  p.device ? t('from {device}', { device: p.device }) : null,
                ].filter(Boolean).join(' · ')}</span>
              </span>
              <button type="button" className="ghost-btn small aip-back" disabled={busy === p.id} onClick={() => takeBack(p.id)}>{busy === p.id ? t('Taking back…') : t('Take Back')}</button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="error-text small" role="alert">{err}</p>}
      <More>
        {local
          ? <p className="muted small">{t('What goes is the task you write, with the repository and branch you pick, straight from this phone to the provider, under that provider\'s own terms. Take one back and nothing more goes to it until you allow it again; removing its key forgets this too.')}</p>
          : <p className="muted small">{t('What goes is what you give it: the message you write and the files and photos you attach, or for AI Assist the text it works on (a meeting\'s transcript, an email, a document, a dictation). It goes from your phone to this computer, end-to-end encrypted, and from this computer to the provider, under that provider\'s own terms. Take one back and nothing more goes to it from your phone until you allow it again. A model on this computer (Ollama, LM Studio, the local model built in) is never asked about: what it reads stays here. On this computer itself, nothing is asked.')}</p>}
      </More>
    </section>
  )
}
