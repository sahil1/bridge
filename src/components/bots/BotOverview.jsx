import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { usePoll } from '../../api.js'
import { platName } from '../settings/Bots.jsx'
import Conversations from './Conversations.jsx'
import { SessionRow, StartTest } from './SessionList.jsx'
import { usePolled, noteTitle } from './sessions.js'
import { chiefIdOf, filterSessions, openBots } from './bots.js'
import { t } from '../../i18n/index.js'
import './bots-home.css'

// A bot's Overview (its page's first tab): what it's for, its folder, where it's reached and whether
// it's a connection's Chief, whether it edits files, its latest sessions (All its sessions: Bots ›
// Sessions for it) and Start a test session; and its conversations by person and by place
// (Conversations.jsx), with what it keeps of each person's, open by itself where there are no sessions.
export default function BotOverview({ d, onTab }) {
  const r = usePolled(`/bots/sessions?bot=${encodeURIComponent(d.id)}`, 5000)
  const conns = usePoll('/connections', 15000).data?.connections || []
  const chiefOf = conns.filter((c) => chiefIdOf(c) === d.id)
  const via = Object.entries(d.connections || {}).filter(([, c]) => c)
  const folders = (d.folders || []).map((f) => f.shown)
  const sessions = (r.data?.sessions || []).slice(0, 5)
  sessions.forEach(noteTitle)
  const edits = d.settings.changes === 'edit'
  const [convs, setConvs] = useState(false)
  useEffect(() => { if (r.missing) setConvs(true) }, [r.missing])
  return (
    <div className="bo-ov" data-setting="bot-overview">
      <section className="st-sec bo-facts">
        <p className={d.description ? 'bo-for' : 'muted small'}>{d.description || t('No line on what it\'s for yet: the Chief has only its name to go by.')}{!d.description && <> <button type="button" className="link-btn small" onClick={() => onTab('settings')}>{t('Add one')}</button></>}</p>
        <dl className="bo-dl">
          <div><dt>{t('Folder')}</dt><dd>{folders.length ? folders.map((f) => <code key={f}>{f}</code>) : <span className="muted">{t('None: it answers from what it knows')}</span>}</dd></div>
          <div><dt>{t('Reached Through')}</dt><dd>{via.length ? via.map(([p, c]) => <span key={p} className="bo-via"><span className={`sb-plat p-${p}`}>{platName(p)}</span> {p === 'teams' ? c.name : `@${c.name}`}{c.shared ? '' : ` (${t('its own')})`}</span>) : <button type="button" className="link-btn" onClick={() => openBots('connections')}>{t('No connection yet: make one')}</button>}</dd></div>
          {chiefOf.length > 0 && <div><dt>{t('Chief Of')}</dt><dd>{chiefOf.map((c) => <span key={c.id} className="bo-via">{c.platform === 'teams' ? c.name : `@${c.name}`}</span>)}</dd></div>}
          <div><dt>{t('Edits Files')}</dt><dd>{edits ? t('Yes, in its folder; a push waits for you') : t('No, it only answers')}</dd></div>
        </dl>
      </section>
      {!r.missing && (
        <section className="st-sec" data-setting="bot-sessions">
          <div className="st-row">
            <h4>{t('Sessions')}</h4>
            <span className="sb-grow" />
            <button type="button" className="link-btn small" onClick={() => { filterSessions({ bot: d.id, state: '' }); openBots('sessions') }}>{t('All its sessions')}</button>
          </div>
          {!r.data
            ? (r.error ? <p className="error-text small" role="alert">{r.error}</p> : <div className="skeleton-rows"><div /></div>)
            : sessions.length
              ? <ul className="bh-sess-list">{sessions.map((s) => <SessionRow key={s.id} s={s} showBot={false} />)}</ul>
              : <p className="small sb-none">{t('No sessions yet.')}</p>}
        </section>
      )}
      <section className="st-sec" data-setting="bot-test">
        <h4>{t('Start a Test Session')}</h4>
        <p className="muted small">{t('Ask {bot} here as someone would in Slack: the same folders, instructions and memory. Nothing is posted anywhere.', { bot: d.name })}</p>
        <StartTest bots={[{ id: d.id, name: d.name }]} bot={d.id} askers={(d.settings.askers || []).filter((a) => a.id !== d.settings.owner?.id)} owner={d.settings.owner?.name || null} />
      </section>
      <details className="sb-how bo-convs" data-setting="bot-conversations" open={convs} onToggle={(e) => setConvs(e.currentTarget.open)}>
        <summary><Icon name="chevron" size={11} />{t('Conversations by Person and Place')}</summary>
        {convs && <Conversations d={d} />}
      </details>
      {!r.missing && <p className="muted small"><Icon name="info" size={11} /> {t('Each thread or direct message with {bot} is a session: it remembers the thread, picks up where it left off, and you can watch it, step in or stop it.', { bot: d.name })}</p>}
    </div>
  )
}
