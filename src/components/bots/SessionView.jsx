import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Console from '../Console.jsx'
import { ago } from '../Machines.jsx'
import { SlackItem, PushItem } from '../NeedsYou.jsx'
import { WriteRow } from '../settings/Bots.jsx'
import { api } from '../../api.js'
import { usePolled, SESSION_STATE, WAITING, stateOf, placeOf, sinceOf, noteTitle, sessionAct } from './sessions.js'
import { openBot, openBots, refreshBots } from './bots.js'
import { t } from '../../i18n/index.js'
import './bots-home.css'

// A session (view:session:<sid>): one conversation with a bot, a live Claude Code in its folder that
// remembers the thread. Over it, which bot, where, who, how it stands and for how long; Stop (the
// turn it's on; the session stays) and End session. Then two views:
//   Thread: its turns, oldest first: who said what, what it answered and how that went, and right
//     there what waits for you (a reply to Send, Edit or Discard; a change to Approve or Deny, and
//     Undo once it's made; a push to approve; whether to carry on at its time limit; a request held
//     before it started), the same cards as Needs You.
//   Live: the session's pane as any agent's Chat and Terminal (Console.jsx), where typing is Step
//     in (the session is told the owner stepped in), and Stop interrupts the turn. Closed, Open it
//     starts it again with what it remembers.
// The same on a phone, through the relay.

const isWaiting = (x) => ['draft', 'screened'].includes(x.state) || x.limit?.phase === 'asking' || x.push?.state === 'waiting'
const asItem = (x, s) => ({ ...x, id: x.q || x.id, bot: s.bot, place: s.place, inSession: true, draft: typeof x.draft === 'string' ? x.draft : '', ...(x.push?.state === 'waiting' ? { kind: 'push' } : {}) })
const viewKey = (sid) => `cc-session-view-${sid}`

export default function SessionView({ sid, phone = false, fleet = null }) {
  const r = usePolled(`/bots/sessions/${encodeURIComponent(sid)}`, 2500)
  const [view, setView] = useState(() => { try { return localStorage.getItem(viewKey(sid)) === 'live' ? 'live' : 'thread' } catch { return 'thread' } })
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(null)
  const pick = (v) => { setView(v); try { localStorage.setItem(viewKey(sid), v) } catch { /* private window */ } }
  const s = r.data?.session || null
  useEffect(() => { if (s) noteTitle(s) }, [s?.title]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!note) return undefined; const x = setTimeout(() => setNote(null), 6000); return () => clearTimeout(x) }, [note])
  const act = async (what, body) => {
    setBusy(what)
    try {
      await sessionAct(sid, what, body)
      setNote({ text: what === 'stop' ? t('Stopped: the session stays, and its next message picks it up.') : what === 'end' ? t('Ended. Its thread stays here.') : what === 'open' ? t('Opening its pane…') : t('Sent: it knows you stepped in.') })
      refreshBots()
      await r.reload()
      return true
    } catch (e) { setNote({ bad: true, text: e.message }); return false } finally { setBusy(null) }
  }
  if (r.missing) {
    return (
      <div className={`bh bh-sv${phone ? ' phone' : ''}`}>
        <div className="trial-off"><Icon name="chat" size={22} /><b>{t('This session isn\'t here')}</b><p className="muted">{t('It ended long ago, or this Bridge AI doesn\'t keep sessions yet.')}</p><button type="button" className="btn small" onClick={() => openBots('sessions')}>{t('Sessions')}</button></div>
      </div>
    )
  }
  if (r.error && !s) return <div className={`bh bh-sv${phone ? ' phone' : ''}`}><p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {r.error}</p></div>
  if (!s) return <div className={`bh bh-sv${phone ? ' phone' : ''}`}><div className="skeleton-rows"><div /><div /><div /></div></div>
  const st = stateOf(s)
  const pane = r.data?.pane || null
  const turns = r.data?.turns || []
  const who = (s.people || []).map((p) => p?.name || p).filter(Boolean)
  const working = st === 'working' || pane?.status === 'working'
  return (
    <div className={`bh bh-sv${phone ? ' phone' : ''} v-${view}`} data-setting="bot-session" data-session={sid}>
      <header className="bh-sv-head">
        <div className="bh-sv-title">
          <span className={`bh-sdot s-${st}`} aria-hidden="true" />
          <h2 className="bp-name">{s.title || s.bot?.name || t('Session')}</h2>
        </div>
        <p className="muted small bh-sv-meta">
          {s.bot && <button type="button" className="link-btn" onClick={() => openBot(s.bot.id)}><Icon name="bot" size={11} /> {s.bot.name}</button>}
          <span>{placeOf(s.place)}{s.connection ? ` · ${s.connection.name}` : ''}</span>
          {who.length > 0 && <span>{who.join(', ')}</span>}
          <span className={`bh-state s-${st}`}>{st === 'waiting' && s.waiting?.kind ? t('Waiting for you: {what}', { what: WAITING()[s.waiting.kind] || s.waiting.kind }) : t(SESSION_STATE[st])}</span>
          <span>{[s.turns === 1 ? t('1 turn') : t('{n} turns', { n: s.turns || turns.length }), sinceOf(s), s.ran != null && s.longest ? t('{ran} of {longest} min this turn', { ran: s.ran, longest: s.longest }) : null].filter(Boolean).join(' · ')}</span>
        </p>
        <div className="bh-sv-acts">
          <div className="seg" role="tablist" aria-label={t('Session')}>
            <button type="button" role="tab" aria-selected={view === 'thread'} className={view === 'thread' ? 'on' : ''} onClick={() => pick('thread')} data-view="thread"><Icon name="chat" size={13} /> {t('Thread')}</button>
            <button type="button" role="tab" aria-selected={view === 'live'} className={view === 'live' ? 'on' : ''} onClick={() => pick('live')} data-view="live"><Icon name="terminal" size={13} /> {t('Live')}{s.live || pane?.live ? <span className="bh-live-dot" aria-label={t('live')} /> : null}</button>
          </div>
          <span className="sb-grow" />
          {view === 'thread' && st !== 'closed' && <button type="button" className="btn small" onClick={() => pick('live')} data-setting="session-step-in"><Icon name="edit" size={12} /> {t('Step in')}</button>}
          {working && <button type="button" className="btn small" disabled={!!busy} onClick={() => act('stop')} data-setting="session-stop"><Icon name="stop" size={12} /> {t('Stop')}</button>}
          {st !== 'closed' && <button type="button" className="ghost-btn danger" disabled={!!busy} onClick={() => { if (window.confirm(t('End this session? Its pane closes; the thread stays here, and a new message in it starts a new session.'))) act('end') }} data-setting="session-end"><Icon name="x" size={12} /> {t('End session')}</button>}
        </div>
      </header>
      {note && <p className={`st-note ${note.bad ? 'bad' : 'ok'} bh-sv-note`} role={note.bad ? 'alert' : 'status'}><Icon name={note.bad ? 'alert' : 'check'} size={13} /><span>{note.text}</span></p>}
      {view === 'thread'
        ? <Thread s={s} turns={turns} reload={r.reload} setNote={setNote} pane={pane} />
        : <LivePane s={s} pane={pane} fleet={fleet} phone={phone} act={act} busy={busy} />}
    </div>
  )
}

// ---------- Thread ----------
function Thread({ s, turns, reload, setNote, pane }) {
  const done = () => { refreshBots(); reload() }
  return (
    <div className="bh-thread sb">
      {!turns.length && <p className="muted small">{t('Nothing said yet.')}</p>}
      <ol className="bh-turns" aria-label={t('Thread')}>
        {turns.map((x, i) => (
          <li key={x.q || i} className={`bh-turn${isWaiting(x) ? ' waiting' : ''}`} data-turn={x.q || i} data-state={x.state || ''}>
            {isWaiting(x)
              ? (x.push?.state === 'waiting' ? <PushItem it={asItem(x, s)} onDone={done} setNote={setNote} /> : <SlackItem it={asItem(x, s)} onDone={done} setNote={setNote} />)
              : <TurnBody x={x} s={s} onDone={done} setNote={setNote} />}
          </li>
        ))}
      </ol>
      {pane?.doing && <p className="muted small bh-doing" role="status"><Icon name="working" size={12} /> {pane.doing}</p>}
      {pane?.asking && <p className="small bh-doing" role="status"><Icon name="alert" size={12} /> {t('Its agent asks: {what}', { what: pane.asking.title || pane.asking })}</p>}
    </div>
  )
}

// One turn that waits for nothing: who said what, and what came of it.
const OUTCOME = () => ({ sent: t('Sent'), edited: t('Sent, as you edited it'), auto: t('Sent without asking'), discarded: t('Discarded'), refused: t('Refused'), failed: t('Failed'), answering: t('Working…'), received: t('Working…'), queued: t('Waiting its turn'), stopped: t('Stopped'), 'passed-on': t('Passed on to you'), sending: t('Sending') })
function TurnBody({ x, s, onDone, setNote }) {
  const [busy, setBusy] = useState(false)
  const you = x.from?.owner || x.from?.you || x.steer
  const who = x.steer ? t('You stepped in') : you ? t('You') : x.from?.name || t('Someone')
  const reply = typeof x.sent === 'string' ? x.sent : x.draft
  const state = x.sent && x.auto ? 'auto' : x.sent && x.state !== 'edited' ? 'sent' : x.state
  const undo = async () => {
    setBusy(true)
    try { await api(`/bots/${encodeURIComponent(s.bot?.id || '')}/writes/${encodeURIComponent(x.write.id)}/undo`, { method: 'POST' }); setNote({ text: t('Undone: the files are back as they were.') }); onDone() } catch (e) { setNote({ bad: true, text: e.message }) }
    setBusy(false)
  }
  return (
    <>
      <div className="bh-turn-head">
        <b className="small">{who}</b>
        {x.at && <span className="muted small" title={new Date(x.at).toLocaleString()}>{ago(x.at)}</span>}
      </div>
      {x.text && <p className="bh-said">{x.text}</p>}
      {x.files?.length > 0 && <p className="muted small"><Icon name="paperclip" size={11} /> {x.files.map((f) => f.name || f).join(', ')}</p>}
      {reply && (
        <div className="bh-reply">
          <span className="muted small"><Icon name="bot" size={11} /> {s.bot?.name}{OUTCOME()[state] ? ` · ${OUTCOME()[state]}` : ''}</span>
          <p>{reply}</p>
        </div>
      )}
      {!reply && OUTCOME()[state] && <p className="muted small">{OUTCOME()[state]}</p>}
      {x.write && <ul className="sb-writes"><WriteRow w={x.write} busy={busy} onUndo={x.write.state === 'applied' ? undo : null} /></ul>}
      {x.push && x.push.state !== 'waiting' && <p className="muted small" data-push={x.push.state}><Icon name="branch" size={11} /> {x.push.state === 'approved' || x.push.pr ? t('Pushed as a draft pull request.') : x.push.state === 'denied' ? t('Its push was denied.') : t('A push: {state}', { state: x.push.state })}{x.push.pr?.url && <> <a href={x.push.pr.url} target="_blank" rel="noreferrer">{x.push.pr.url}</a></>}</p>}
      {x.limit?.carried && <p className="muted small"><Icon name="clock" size={11} /> {t('Nobody answered at its time limit, so it carried on.')}</p>}
      {x.limit?.phase === 'stopped' && <p className="muted small"><Icon name="clock" size={11} /> {t('Stopped at its Longest Run. Say “carry on” in the thread to go on.')}</p>}
    </>
  )
}

// ---------- Live ----------
// Its pane, as the fleet has it (fleet.botSessions: live session panes, never in the sidebar), shown
// as any agent's; what you type is Step in, and Stop interrupts the turn.
function LivePane({ s, pane, fleet, phone, act, busy }) {
  const paneId = pane?.paneId || s.paneId || null
  const known = Array.isArray(fleet?.botSessions)
  const a = known && paneId ? fleet.botSessions.find((x) => x.paneId === paneId) || null : null
  if (a) {
    return (
      <div className="bh-live" data-setting="session-live">
        <Console agent={a} variant={phone ? 'mobile' : 'focus'} steer={{
          send: (text) => act('steer', { text }),
          stop: () => act('stop'),
          placeholder: t('Step in: type to {bot}…', { bot: s.bot?.name || '' }),
        }} />
      </div>
    )
  }
  const open = s.live || pane?.live
  return (
    <div className="bh-live bh-live-off" data-setting="session-live">
      <Icon name="terminal" size={22} />
      {open && !known
        ? <p className="small">{t('Its pane is open on this computer, but this Bridge AI can\'t show it here yet.')}</p>
        : open
          ? <p className="small">{t('Its pane is starting…')}</p>
          : <p className="small">{t('Its pane is closed. It opens again with the next message in the thread, and remembers everything so far.')}</p>}
      {!open && stateOf(s) !== 'closed' && <button type="button" className="btn small primary" disabled={!!busy} onClick={() => act('open')} data-setting="session-open"><Icon name="play" size={12} /> {t('Open it now')}</button>}
    </div>
  )
}
