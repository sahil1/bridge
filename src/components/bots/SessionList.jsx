import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { ago } from '../Machines.jsx'
import { TryResult } from '../settings/Bots.jsx'
import { usePolled, SESSION_STATE, WAITING, stateOf, placeOf, sinceOf, noteTitle } from './sessions.js'
import { FILTER_KEY, openSession, refreshBots } from './bots.js'
import { t } from '../../i18n/index.js'
import { useEnter, EnterAt } from '../EnterHint.jsx'
import './bots-home.css'

// Bots › Sessions: every conversation your bots are having, each a session (a live Claude Code in
// the bot's folder that remembers the thread): which bot, where, who, how it stands (working,
// waiting for you, idle, closed), how long and how many turns, and its first words; what waits for
// you first. Filtered by bot and by how it stands, kept on this device (a bot's page sets it to that
// bot). Start a test session: a question asked as you would in Slack, as a session of its own with
// nothing posted anywhere. Opening one shows its Thread and its Live pane (SessionView.jsx).

const ORDER = { waiting: 0, working: 1, idle: 2, closed: 3 }
const readFilter = () => { try { return { bot: '', state: '', ...JSON.parse(localStorage.getItem(FILTER_KEY) || '{}') } } catch { return { bot: '', state: '' } } }

export function SessionRow({ s, showBot = true }) {
  const st = stateOf(s)
  const who = (s.people || []).map((p) => p?.name || p).filter(Boolean)
  return (
    <li>
      <button type="button" className={`bh-sess st-${st}`} data-session={s.id} data-state={st} onClick={() => openSession(s.id)}>
        <span className={`bh-sdot s-${st}`} aria-hidden="true" />
        <span className="bh-sess-main">
          <span className="bh-sess-title">{s.title || t('(no words yet)')}</span>
          <span className="muted small bh-sess-meta">
            {[showBot ? s.bot?.name : null, placeOf(s.place), who.length ? who.slice(0, 3).join(', ') + (who.length > 3 ? ` +${who.length - 3}` : '') : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="bh-sess-side small">
          <span className={`bh-chip s-${st}`} title={st === 'waiting' && s.waiting?.kind ? t('Waiting for you: {what}', { what: WAITING()[s.waiting.kind] || s.waiting.kind }) : undefined}>{t(SESSION_STATE[st])}</span>
          <span className="muted">{[s.turns === 1 ? t('1 turn') : t('{n} turns', { n: s.turns || 0 }), sinceOf(s), s.lastAt ? ago(s.lastAt) : null].filter(Boolean).join(' · ')}</span>
        </span>
        <Icon name="chevron" size={12} className="muted bh-go" />
      </button>
    </li>
  )
}

export default function SessionList({ bots = [], phone = false }) {
  const [f, setF] = useState(readFilter)
  const [testing, setTesting] = useState(false)
  useEffect(() => {
    const on = (e) => setF({ bot: '', state: '', ...(e.detail || {}) })
    window.addEventListener('bridge-bots-filter', on)
    return () => window.removeEventListener('bridge-bots-filter', on)
  }, [])
  const set = (x) => { const n = { ...f, ...x }; setF(n); try { localStorage.setItem(FILTER_KEY, JSON.stringify(n)) } catch { /* private window */ } }
  // (Asked for by bot; how each stands is said by each, so that's filtered here.)
  const r = usePolled(`/bots/sessions${f.bot ? `?bot=${encodeURIComponent(f.bot)}` : ''}`, 4000)
  const live = bots.filter((b) => !b.draft)
  const all = (r.data?.sessions || []).filter((s) => !f.state || stateOf(s) === f.state)
  all.forEach(noteTitle)
  const list = [...all].sort((a, b) => (ORDER[stateOf(a)] - ORDER[stateOf(b)]) || (Date.parse(b.lastAt || 0) - Date.parse(a.lastAt || 0)))
  return (
    <div className={`bh-sessions${phone ? ' phone' : ''}`} data-setting="bots-sessions">
      <div className="bh-tools">
        <select className="st-input" value={f.bot} onChange={(e) => set({ bot: e.target.value })} aria-label={t('Which bot')}>
          <option value="">{t('Every bot')}</option>
          {live.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="st-input" value={f.state} onChange={(e) => set({ state: e.target.value })} aria-label={t('How it stands')}>
          <option value="">{t('Any state')}</option>
          {Object.entries(SESSION_STATE).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
        </select>
        <span className="sb-grow" />
        {live.length > 0 && <button type="button" className={`btn small${testing ? '' : ' primary'}`} aria-expanded={testing} onClick={() => setTesting(!testing)} data-setting="sessions-test"><Icon name="play" size={12} /> {t('Start a test session')}</button>}
      </div>
      {testing && <StartTest bots={live} bot={f.bot || live[0]?.id} onClose={() => setTesting(false)} />}
      {r.missing && <p className="muted small" role="status">{t('This Bridge AI doesn\'t keep sessions yet: update it to see each conversation here.')}</p>}
      {r.error && <p className="error-text small" role="alert">{r.error}</p>}
      {!r.data && !r.missing && !r.error && <div className="skeleton-rows"><div /><div /></div>}
      {r.data && !list.length && (
        <div className="bh-empty">
          <Icon name="chat" size={20} />
          <p className="small">{f.bot || f.state ? t('No session like that.') : t('No sessions yet. Each thread or direct message with a bot is one; ask one in Slack, or start a test session.')}</p>
        </div>
      )}
      {list.length > 0 && <ul className="bh-sess-list" aria-label={t('Sessions')}>{list.map((s) => <SessionRow key={s.id} s={s} showBot={!f.bot} />)}</ul>}
    </div>
  )
}

// Start a test session: a question as someone would ask it, answered by the bot as a session of its
// own (its Thread and Live, like any other), with nothing posted anywhere. Where this Bridge AI has
// no sessions, it's asked once instead and its answer shown here (Try It, as before).
// bots: which bots to pick from (one, on a bot's page); askers: who it may be asked as.
export function StartTest({ bots, bot = null, askers = [], owner = null, onClose = null }) {
  const [id, setId] = useState(bot || bots[0]?.id || '')
  const [as, setAs] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [once, setOnce] = useState(null) // { d, q }: asked once, where there are no sessions
  useEffect(() => { if (bot) setId(bot) }, [bot])
  const go = async (e) => {
    e?.preventDefault()
    if (!text.trim() || !id || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await api(`/bots/${encodeURIComponent(id)}/sessions`, { method: 'POST', body: { text: text.trim(), as: as || null } })
      const sid = r?.session?.id || r?.sid || null
      setText('')
      refreshBots()
      if (sid) { noteTitle({ id: sid, title: r?.session?.title || text.trim() }); openSession(sid); onClose?.() } else if (r?.q) {
        // (Answered by Codex or a model, which take one question at a time and keep no session: its
        // answer shown here, as Try It's was.)
        setOnce({ d: await api(`/bots/${encodeURIComponent(id)}`), q: r.q })
      } else onClose?.()
    } catch (err) {
      if (err.status !== 404) setError(err.message)
      else {
        try {
          const [x, d] = await Promise.all([api(`/bots/${encodeURIComponent(id)}/try`, { method: 'POST', body: { text: text.trim(), as: as || null } }), api(`/bots/${encodeURIComponent(id)}`)])
          setOnce({ d, q: x.q })
        } catch (err2) { setError(err2.message) }
      }
    }
    setBusy(false)
  }
  // Enter as Settings › You › Enter Key has it (src/enter.js); a phone's keyboard on the screen starts it, as before.
  const enter = useEnter(text, go)
  const one = bots.length === 1 ? bots[0] : null
  return (
    <form className="bh-test-sess" onSubmit={go} data-setting="test-session">
      {!one && (
        <label className="sb-field"><span>{t('Bot')}</span>
          <select className="st-input" value={id} onChange={(e) => { setId(e.target.value); setOnce(null) }} aria-label={t('Which bot')}>
            {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {askers.length > 0 && (
        <label className="sb-field"><span>{t('Ask as')}</span>
          <select className="st-input" value={as} onChange={(e) => setAs(e.target.value)}>
            <option value="">{owner ? t('{name} (you)', { name: owner }) : t('You')}</option>
            {askers.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
          </select>
        </label>
      )}
      <EnterAt show={enter.mid}><textarea className="st-input" rows={2} value={text} onChange={(e) => { setText(e.target.value); enter.box.onSelect(e) }} onKeyDown={enter.onKeyDown} {...enter.box} placeholder={t('A question, as it would be asked in Slack')} aria-label={t('The question')} /></EnterAt>
      <div className="st-row">
        <button type="submit" className="btn small primary" disabled={busy || !text.trim() || !id}><Icon name="play" size={12} /> {busy ? t('Starting…') : t('Start')}</button>
        {onClose && <button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button>}
        <span className="muted small">{t('Nothing is posted anywhere.')}</span>
      </div>
      {error && <p className="error-text small" role="alert">{error}</p>}
      {once && <TryResult key={once.q} d={once.d} q={once.q} onGone={() => setOnce(null)} />}
    </form>
  )
}
