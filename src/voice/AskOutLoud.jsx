import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { api } from '../api.js'
import { useDictation, press, release, registerAsk } from '../dictation/controller.js'
import { how, onVoices, forEar, say, unlock } from './speak.js'
import { t } from '../i18n/index.js'
import './voice.css'

// The voice Chief of Staff: hold Ask out loud (or tap it, and again when you're done), say what you
// want to know ("what's blocked?"), and hear the answer. What you said goes to the Chief of Staff as
// any message does (dictation/controller.js turns it into text on your computer), marked "(Asked out
// loud)" so it answers for the ear (chief/INSTRUCTIONS.md); its answer, once it's done working, is
// read aloud by a voice on this device (speak.js). Nothing goes anywhere the Chief of Staff's own
// messages don't. Shown only where this device has a voice to read with.
const QUIET = { phase: 'idle' }
const WAIT_MS = 10 * 60_000
export const MARK = '(Asked out loud)'

export default function AskOutLoud({ agent, onSend }) {
  const pid = agent.paneId
  const [voice, setVoice] = useState(null) // how(): { system } or { espeak } or {}
  useEffect(() => {
    let on = true
    const check = () => how().then((h) => { if (on) setVoice(h) })
    check()
    const off = onVoices(check)
    return () => { on = false; off() }
  }, [])
  const dict = useDictation((s) => (s.target?.kind === 'ask' && s.target.id === pid ? s : QUIET))
  const [state, setState] = useState(null) // null | 'sending' | 'waiting' | 'speaking' | 'heard' | { error }
  const [answer, setAnswer] = useState(null) // the last one heard, to hear again
  const speaking = useRef(null)
  const status = useRef(agent.status)
  status.current = agent.status
  const run = useRef(0) // each question: a later one replaces it

  const speak = (text) => {
    speaking.current?.stop()
    let s
    try { s = say(forEar(text, t('There\'s more in the chat.'))) } catch { setState({ error: t('Couldn\'t read it aloud. It\'s in the chat.') }); return }
    speaking.current = s
    setState('speaking')
    s.done.then(() => { if (speaking.current === s) { speaking.current = null; setState('heard') } })
  }
  const stop = () => { speaking.current?.stop(); speaking.current = null; setState(answer ? 'heard' : null) }
  // What was said: sent, then the answer waited for (its last reply after the question, once it's
  // done working) and read aloud.
  const ask = async (text) => {
    const me = ++run.current
    speaking.current?.stop()
    setState('sending')
    const ok = await onSend(`${MARK} ${text}`)
    if (me !== run.current) return
    if (ok === false) { setState({ error: t('It didn\'t go to the Chief of Staff. Try again.') }); return }
    setState('waiting')
    const end = Date.now() + WAIT_MS
    while (Date.now() < end && me === run.current) {
      await new Promise((r) => setTimeout(r, 1500))
      if (me !== run.current) return
      const tr = await api(`/agents/${encodeURIComponent(pid)}/transcript`).catch(() => null)
      const msgs = tr?.messages || []
      let q = -1
      for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user' && String(msgs[i].text || '').includes(text)) { q = i; break }
      if (q < 0) continue
      const reply = msgs.slice(q + 1).filter((m) => m.role === 'assistant' && String(m.text || '').trim()).at(-1)
      if (!reply || status.current === 'working') continue
      setAnswer(reply.text)
      speak(reply.text)
      return
    }
    if (me === run.current) setState({ error: t('No answer yet. It\'s in the chat when it comes.') })
  }
  useEffect(() => registerAsk(pid, (text) => ask(text)), [pid]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { run.current++; speaking.current?.stop() }, [])

  if (!voice?.system && !voice?.espeak) return null
  const listening = dict.phase === 'opening' || dict.phase === 'listening'
  const down = (e) => {
    if (e.button !== 0 || dict.phase === 'working') return
    e.preventDefault()
    unlock()
    press({ kind: 'ask', id: pid })
    const up = () => { window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); release() }
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
  }
  const line = listening ? t('Listening… let go when you\'re done')
    : dict.phase === 'working' ? t('Turning it into text…')
      : state === 'sending' ? t('Asking…')
        : state === 'waiting' ? t('The Chief of Staff is working on it…')
          : state === 'speaking' ? t('Reading the answer aloud…')
            : state?.error ? state.error
              : t('Hold and ask, say "what\'s blocked?", and hear the answer.')
  return (
    <div className={`ask-bar${listening ? ' on' : ''}`} role="group" aria-label={t('Ask out loud')}>
      <button type="button" className={`ask-btn${listening ? ' on' : ''}`} onPointerDown={down}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); unlock(); press({ kind: 'ask', id: pid }); release(Date.now()) } }}
        aria-pressed={listening} title={t('Hold to ask the Chief of Staff out loud; the answer is read to you')}>
        <Icon name={listening ? 'wave' : 'mic'} size={14} /> <span>{t('Ask out loud')}</span>
      </button>
      <span className={`ask-line${state?.error ? ' error' : ''}`} role="status">{(state === 'waiting' || state === 'sending') && <Icon name="refresh" size={11} className="spin" />} {line}</span>
      {state === 'speaking' && <button type="button" className="ghost-btn ask-act" onClick={stop}><Icon name="stop" size={12} /> {t('Stop')}</button>}
      {state === 'heard' && answer && <button type="button" className="ghost-btn ask-act" onClick={() => speak(answer)}><Icon name="repeat" size={12} /> {t('Again')}</button>}
    </div>
  )
}
