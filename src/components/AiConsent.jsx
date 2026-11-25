import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { consentAsk, answerConsent, consentSaid } from '../aiconsent.js'
import { t } from '../i18n/index.js'
import { where } from './settings/search.js'
import './aiconsent.css'

// The sheet a phone shows the first time what you give Bridge AI would go on to an AI provider
// (src/aiconsent.js, server/aiconsent.js): who gets it, what goes, how, and that nothing goes until
// you allow it. Allow and Not Now; Escape or a tap outside is Not Now. After Not Now, a line says
// nothing was sent, until it's closed or ten seconds pass. Mounted once in every window (App.jsx,
// the demo through it, Cloud Agents in its own), shown only when there's something to ask.

// Bridge AI's privacy policy, at its part about this (the App Store and Google Play listings link
// the same file).
export const PRIVACY_URL = 'https://github.com/sahil1/bridge/blob/main/PRIVACY.md#ai-providers-and-your-phone'
// Each provider's own privacy policy, where it's known.
const POLICY = {
  anthropic: 'https://www.anthropic.com/legal/privacy',
  openai: 'https://openai.com/policies/privacy-policy/',
  google: 'https://policies.google.com/privacy',
  xai: 'https://x.ai/legal/privacy-policy',
  microsoft: 'https://privacy.microsoft.com/privacystatement',
  aws: 'https://aws.amazon.com/privacy/',
  github: 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement',
  cursor: 'https://cursor.com/privacy',
  huggingface: 'https://huggingface.co/privacy',
}
export const policyOf = (id) => POLICY[id] || null

// What goes, for what it's for (the feature a request names; agents' own are 'agent', 'chief',
// 'bot').
export function whatGoes(feature) {
  switch (feature) {
    case 'agent': case 'chief': case 'chat':
      return t('The message you write, and the files and photos you attach to it.')
    case 'cloud':
      return t('The task you write, with the repository and branch you pick, and the messages you send it after.')
    case 'search':
      return t('A question asked in the meeting, on its own, to look up on the web.')
    case 'insights':
      return t("What your agents worked on in their recent sessions, for Insights to sum up.")
    case 'bot': case 'bots':
      return t('What you write to the bot, and the files you attach to it.')
    case 'meetings': case 'notes': case 'live':
      return t("The meeting's transcript and your notes, and what you ask about it.")
    case 'speech':
      return t('The sound you record for a meeting, or the file you have turned into text.')
    case 'mail':
      return t("The email you're working on, and what you ask AI Assist to write.")
    case 'dictation': case 'voice-edit':
      return t('What you dictate, as text, to be tidied or changed as you ask.')
    case 'studio':
      return t('The document, or the part of it you picked, and what you ask AI Assist to do with it.')
    case 'files':
      return t('The names and text of the files AI Assist looks at, and what you ask.')
    case 'pr':
      return t('The changes in your branch (the code diff and its commit messages), to write a pull request about them.')
    case 'consult':
      return t('The question you ask, with the text you add to it.')
    case 'assist':
      return t('The text you picked or wrote, and what you ask AI Assist to do with it.')
    case 'board': case 'diagrams':
      return t("What's on the whiteboard, and what you ask AI Assist to draw.")
    default:
      return t('The text AI Assist works on, and what you ask it to do.')
  }
}
// "Anthropic, through Claude Code"; for an agent that uses whichever provider it's set up with,
// that too.
export const whoGets = (p) => (p.setUp
  ? t('{name}, and the model provider it is set up to use', { name: p.name })
  : p.via ? t('{name}, through {via}', { name: p.name, via: p.via }) : p.name)

export default function AiConsent({ local = false, demo = false }) {
  const [ask, setAsk] = useState(() => consentAsk.get())
  const [said, setSaid] = useState(() => consentSaid.get())
  useEffect(() => consentAsk.subscribe(setAsk), [])
  useEffect(() => consentSaid.subscribe(setSaid), [])
  useEffect(() => {
    if (!said) return
    const id = setTimeout(() => consentSaid.clear(), 10_000)
    return () => clearTimeout(id)
  }, [said])
  return (
    <>
      {ask && <Sheet key={ask.provider.id} ask={ask} local={local} demo={demo} />}
      {said && !ask && (
        <p className="aic-said" role="status">
          <Icon name="info" size={14} />
          <span>{said.text}</span>
          <button type="button" className="win-btn" onClick={() => consentSaid.clear()} aria-label={t('Close')}><Icon name="x" size={14} /></button>
        </p>
      )}
    </>
  )
}

// local: kept on this phone (the demo, Cloud Agents), not on a computer.
function Sheet({ ask, local, demo }) {
  const p = ask.provider
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); answerConsent(false) } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])
  const policy = policyOf(p.id)
  return (
    <div className="aic-back" onMouseDown={(e) => { if (e.target === e.currentTarget) answerConsent(false) }}>
      <section className="aic-sheet" role="alertdialog" aria-modal="true" aria-labelledby="aic-title" aria-describedby="aic-intro" tabIndex={-1} ref={ref}>
        <h3 id="aic-title"><Icon name="wand" size={16} /> {t('Send this to {name}?', { name: p.name })}</h3>
        <p id="aic-intro">{t('To do this, Bridge AI sends what you give it to {who}, a third-party AI service outside Bridge AI.', { who: whoGets(p) })}</p>
        {demo && <p className="aic-demo small">{t('This is the demo: nothing is actually sent. Bridge AI on your own computer asks the same way.')}</p>}
        <dl className="aic-facts">
          <dt>{t("What's sent")}</dt>
          <dd>{whatGoes(ask.feature)}</dd>
          <dt>{t('Who gets it')}</dt>
          <dd>{local
            ? t('{name}, straight from this phone. {name} handles it under its own terms and privacy policy.', { name: p.name })
            : t('{name}. It goes from this phone to your computer, end-to-end encrypted, and from your computer to {name}, which handles it under its own terms and privacy policy.', { name: p.name })}</dd>
          <dt>{t('What Allow covers')}</dt>
          <dd>{t('What you send to {name} from this phone, for this and Bridge AI\'s other features, until you take it back. Each other provider is asked about on its own.', { name: p.name })}</dd>
          <dt>{t('Until you allow it')}</dt>
          <dd>{local
            ? t('Nothing is sent to {name}. Your answer is kept on this phone, for {name} only.', { name: p.name })
            : t('Nothing is sent to {name}. Your answer is kept on your computer, for {name} only, and you can take it back in {place}.', { name: p.name, place: where('ai-providers') })}</dd>
        </dl>
        <p className="aic-links">
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer">{t('Privacy policy')}</a>
          {policy && <a href={policy} target="_blank" rel="noreferrer">{t("{name}'s privacy policy", { name: p.name })}</a>}
        </p>
        <footer className="aic-acts">
          <button type="button" className="ghost-btn aic-no" onClick={() => answerConsent(false)}>{t('Not Now')}</button>
          <button type="button" className="btn primary aic-yes" onClick={() => answerConsent(true)}>{t('Allow')}</button>
        </footer>
      </section>
    </div>
  )
}
