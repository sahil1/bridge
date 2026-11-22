import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, apiUrl } from '../../api.js'
import { download } from '../../download.js'
import { t } from '../../i18n/index.js'
import { where } from './search.js'
import { grantFor } from '../studio/pdf/grant.jsx'
import { Advanced, More } from './Advanced.jsx'
import './backup.css'

// Settings › Back Up & Move (server/backup.js): this computer's setup to another computer. Move sends
// it straight to a linked one, which shows what's coming and asks there; Back Up makes one file
// sealed with a passphrase, and Restore opens one here. What came is shown before anything is
// applied, and the connections it brings stay paused until the computer it came from has stopped its
// bots (a move asks it to), or you Start them. On a phone, or another computer's window, it's Move
// and what's coming or paused: a file is made and opened on the computer itself. Exactly what goes
// and what's left out is under Advanced.
const PLATFORM = { slack: 'Slack', discord: 'Discord', teams: 'Microsoft Teams' }
const PARTS = () => [['bots', t('Bots')], ['connections', t('Connections')], ['routines', t('Routines')], ['chief', t('Chief of Staff')], ['mcp', t('MCP Servers')], ['settings', t('Settings')], ['signatures', t('Your Signatures')]]
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
// What a bot's file asks for that would let it act for you or say more than it's asked, in words.
const asksOf = (a = {}) => [
  a.answerers?.length > 0 && t('answered by {list}', { list: a.answerers.join(', ') }),
  a.changes === 'pr' && t('opens draft pull requests in {repo}', { repo: a.repo || t('its repository') }),
  a.changes === 'suggest' && t('suggests changes in {repo}', { repo: a.repo || t('its repository') }),
  a.mcp?.length > 0 && t('uses your MCP servers {names}', { names: a.mcp.join(', ') }),
  a.agentCopies && t('answers from copies of your agents\' conversations'),
  a.agentsStatus && t('says what your agents are doing'),
  a.memory === 'auto' && t('keeps what it learns without asking'),
].filter(Boolean)

// What a backup or a move would add here, each part to tick, and Apply. Shown in full, as a file
// could have been made by someone else: what each bot reads and who may ask it, each routine's
// command, folder and agent, each MCP server's whole command and its env's names (those that make a
// program run more than it's asked marked), each setting's value. What would let a bot act for you
// (changes, your MCP servers, copies of your agents' conversations, saying what they're doing,
// keeping what it learns) is shown as the file asks, and from a file it's off here until you turn it
// on. From a file, routines and MCP servers (they run things on this computer) and settings are
// unticked until you tick them.
function Plan({ plan, onApply, onCancel, busy, cancelLabel }) {
  const [parts, setParts] = useState(Object.fromEntries(PARTS().map(([k]) => [k, !(plan.optIn || []).includes(k)])))
  const has = { bots: plan.bots.length, connections: plan.connections.length, routines: plan.routines.length, chief: plan.chief.length, mcp: plan.mcp.length, settings: plan.settings.keys.length, signatures: plan.signatures?.length || 0 }
  const box = (k, label) => (has[k] ? <label className="bk-part" data-part={k}><input type="checkbox" checked={parts[k]} onChange={(e) => setParts((p) => ({ ...p, [k]: e.target.checked }))} /> <b>{label}</b>{(plan.optIn || []).includes(k) && <span className="muted small"> · {k === 'signatures' ? t('off unless you tick it') : t('off unless you tick it: it runs things on this computer')}</span>}</label> : null)
  const sub = (text, bad = false) => <span className={`bk-sub ${bad ? 'is-bad' : ''}`}>{text}</span>
  return (
    <div className="bk-plan" role="region" aria-label={t('What comes')}>
      <p className="small">{t('From {name}, as it was on {date}. Nothing changes here until you apply it.', { name: plan.from, date: when(plan.madeAt) })}</p>
      {!Object.values(has).some(Boolean) && <p className="muted small">{t('There\'s nothing in it to add.')}</p>}
      {box('bots', t('Bots'))}
      {parts.bots && plan.bots.length > 0 && (
        <ul className="bk-list small">
          {plan.bots.map((b) => (
            <li key={b.key} data-bot={b.as}>
              {b.renamed ? t('{name}, as {as}: there\'s a bot called {name} here already', { name: b.name, as: b.as }) : b.name}
              {b.reads.filter((f) => !f.refused).length > 0 && sub(t('reads {folders}', { folders: b.reads.filter((f) => !f.refused).map((f) => f.path).join(', ') }))}
              {b.reads.filter((f) => f.refused).map((f) => <span key={f.path}>{sub(t('won\'t read {folder}: {why}', { folder: f.path, why: f.refused }), true)}</span>)}
              {sub(b.who === 'channels' ? t('who can ask: everyone in its channels') : b.askers.length ? t('who can ask: {people}', { people: b.askers.join(', ') }) : t('who can ask: no one yet'))}
              {b.owners.length > 0 && sub(t('you there: {people}', { people: b.owners.join(', ') }))}
              {b.ownersLeft?.length > 0 && sub(t('you there, in the file: {people}. Not taken from a file: set it again here', { people: b.ownersLeft.join(', ') }), true)}
              {b.auto && sub(b.autoHere ? t('answers without asking') : t('answered without asking there: here it waits for you until you turn that on'), !b.autoHere)}
              {asksOf(b.asks).map((what) => <span key={what}>{sub(b.held ? t('{what}: asked for in the file, off here until you turn it on', { what }) : what, b.held)}</span>)}
              {b.people && sub(t('with what it keeps about each person'))}
            </li>
          ))}
        </ul>
      )}
      {box('connections', t('Connections'))}
      {parts.connections && plan.connections.length > 0 && (
        <ul className="bk-list small">
          {plan.connections.map((c) => (
            <li key={c.key} className={c.skip ? 'muted' : ''}>
              {t('{name} ({platform})', { name: c.name, platform: PLATFORM[c.platform] || c.platform })}{c.skip ? ` · ${t('not added: {why}', { why: c.skip })}` : c.tokens ? ` · ${t('with its tokens, paused until you Start it')}` : ''}
              {!c.skip && c.owner && sub(t('you there: {people}', { people: c.owner }))}
            </li>
          ))}
        </ul>
      )}
      {box('routines', t('Routines'))}
      {parts.routines && plan.routines.length > 0 && (
        <ul className="bk-list small">
          {plan.routines.map((r) => (
            <li key={r.key} className={r.skip ? 'muted' : ''} data-routine={r.name}>
              {r.renamed ? t('{name}, as {as}', { name: r.name, as: r.as }) : r.name}{r.skip ? ` · ${t('not added: {why}', { why: r.skip })}` : r.scheduled ? ` · ${t('runs by itself: paused until you Start it')}` : ''}
              {sub(t('runs {command}', { command: r.command }))}
              {r.to?.chief ? sub(t('for the Chief of Staff')) : r.to?.bot ? sub(t('posted by {bot} in {channel}', { bot: r.to.bot, channel: r.to.channel || '' })) : r.folder ? sub(r.agent ? t('in {folder}, with {agent}', { folder: r.folder, agent: r.agent }) : t('in {folder}', { folder: r.folder })) : null}
            </li>
          ))}
        </ul>
      )}
      {box('chief', t('Chief of Staff'))}
      {parts.chief && plan.chief.length > 0 && <p className="muted small bk-list">{plan.chief.map((c) => (c.differs ? t('{file}, replacing the one here (kept beside it)', { file: c.file }) : c.file)).join(' · ')}</p>}
      {box('mcp', t('MCP Servers'))}
      {parts.mcp && plan.mcp.length > 0 && (
        <ul className="bk-list small">
          {plan.mcp.map((s) => (
            <li key={`${s.kind}-${s.name}`} className={s.skip ? 'muted' : ''} data-server={s.name}>
              {t('{name} for {agent}', { name: s.name, agent: s.agent })}{s.skip ? ` · ${t('not added: {why}', { why: s.skip })}` : ''}
              {s.command ? sub(t('runs {command}', { command: s.command })) : s.url ? sub(t('at {url}', { url: s.url })) : null}
              {s.envKeys?.length > 0 && sub(t('with {keys} set', { keys: s.envKeys.join(', ') }))}
              {s.risky?.length > 0 && sub(t('{keys} can make it run more than its command', { keys: s.risky.join(', ') }), true)}
            </li>
          ))}
        </ul>
      )}
      {box('settings', t('Settings'))}
      {parts.settings && has.settings > 0 && (
        <>
          <p className="muted small bk-list">{plan.settings.changes.length ? t('{n} of its settings differ from this computer\'s: {keys}', { n: plan.settings.changes.length, keys: plan.settings.changes.join(', ') }) : t('The same as this computer\'s')}</p>
          <ul className="bk-list small bk-values">
            {plan.settings.keys.map((k) => <li key={k} data-setting-key={k} className={plan.settings.changes.includes(k) ? '' : 'muted'}><code>{k}</code>: {plan.settings.values?.[k]}</li>)}
          </ul>
        </>
      )}
      {box('signatures', t('Your Signatures'))}
      {parts.signatures && has.signatures > 0 && <p className="muted small bk-list">{plan.signatures.map((x) => `${x.name} (${x.kind === 'initials' ? t('initials') : t('signature')})`).join(' · ')}. {t('Sealed again here, with this computer\'s key.')}</p>}
      <div className="st-row">
        <button type="button" className="btn small primary" disabled={busy} onClick={() => onApply(parts)}><Icon name="check" size={12} /> {busy ? t('Applying…') : t('Apply')}</button>
        <button type="button" className="btn small" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      </div>
    </div>
  )
}

// What was applied: each part, what's paused, and (a move) whether the computer it came from has
// stopped its bots.
function Applied({ r, from, onStart, onAgain, busy }) {
  const n = (k) => r[k]?.length || 0
  const mcpOk = r.mcp?.filter((s) => s.ok).length || 0
  const done = [[n('bots'), t('Bots')], [n('connections'), t('Connections')], [n('routines'), t('Routines')], [n('chief'), t('Chief of Staff')], [mcpOk, t('MCP Servers')], [n('settings'), t('Settings')], [r.signatures || 0, t('Your Signatures')]].filter(([k]) => k)
  return (
    <div className="bk-plan" role="status">
      <p className="small"><Icon name="check" size={13} /> {done.length ? t('Added: {list}', { list: done.map(([k, l]) => `${l} ${k}`).join(' · ') }) : t('Nothing was added.')}</p>
      {r.mcp?.filter((s) => !s.ok).map((s) => <p key={`${s.kind}-${s.name}`} className="muted small">{t('{name} wasn\'t added: {why}', { name: s.name, why: s.error })}</p>)}
      {r.problems?.map((p, i) => <p key={i} className="st-note bad small"><Icon name="alert" size={13} /><span>{p}</span></p>)}
      {r.handoff === 'done' && <p className="st-note ok small"><Icon name="check" size={13} /><span>{t('{name} has paused its bots, connections and scheduled routines, so they answer here now.', { name: from })}</span></p>}
      {r.handoff === 'failed' && (
        <div className="st-note bad small">
          <Icon name="alert" size={13} />
          <span>{t('{name} couldn\'t be reached to pause its bots ({why}), so the connections here stay paused: both answering at once would split each app\'s questions between them. Stop them on {name}, then Start here.', { name: from, why: r.error || '' })}</span>
          <button type="button" className="btn small" disabled={busy} onClick={onAgain}>{t('Try Again')}</button>
        </div>
      )}
      {!r.handoff && n('connections') > 0 && <p className="st-note small"><Icon name="pause" size={13} /><span>{t('Its connections are paused. Stop the bots on {name} first, then Start them here.', { name: from })}</span></p>}
      {(r.paused?.length > 0 && r.handoff !== 'done') && <button type="button" className="btn small" disabled={busy} onClick={onStart}><Icon name="play" size={12} /> {t('Start Them Here')}</button>}
    </div>
  )
}

export default function BackUp() {
  const [s, setS] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [to, setTo] = useState('')
  const [pass, setPass] = useState({ a: '', b: '' })
  const [made, setMade] = useState(null)
  const [file, setFile] = useState(null)
  const [openPass, setOpenPass] = useState('')
  const [opened, setOpened] = useState(null) // { id, plan, kind, from }
  const [applied, setApplied] = useState(null)
  // Your saved signatures go too only when ticked (they're opened from this computer's key, and
  // sealed again with the other's).
  const [sigs, setSigs] = useState(false)
  const fileIn = useRef(null)
  const load = () => api('/backup').then((x) => { setS(x); setTo((v) => v || x.linked.find((m) => m.online)?.id || '') }, (e) => setErr(e.message))
  useEffect(() => { load(); const id = setInterval(() => { if (!document.hidden) load() }, 5000); return () => clearInterval(id) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (what, fn) => { setBusy(what); setErr(null); try { await fn() } catch (e) { setErr(e.message) } setBusy(null); load() }
  if (!s) return err ? <p className="error-text small">{err}</p> : <div className="skeleton-rows"><div /><div /></div>

  const backUp = () => run('file', async () => {
    if (pass.a !== pass.b) throw new Error(t('The two passphrases aren\'t the same'))
    // (Your signatures go only once it's asked that it's you: Touch ID, or your PIN.)
    const grant = sigs ? await grantFor('export') : null
    const r = await fetch(apiUrl('/backup/file'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: pass.a, signatures: sigs, grant }) })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
    const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'Bridge-AI.bridge-backup'
    download(await r.arrayBuffer(), name, 'application/json')
    setPass({ a: '', b: '' })
    setMade(name)
  })
  const openFile = () => run('open', async () => {
    const text = await file.text()
    const r = await api('/backup/open', { method: 'POST', body: { file: text, passphrase: openPass } })
    setOpenPass('')
    setApplied(null)
    setOpened({ ...r, kind: 'file', from: r.plan.from })
  })
  const seeMove = (m) => run(`see-${m.id}`, async () => { const r = await api(`/backup/pending/${m.id}`); setApplied(null); setOpened({ ...r, from: r.from }) })
  const apply = (parts) => run('apply', async () => {
    // (Your signatures added here are a change to them: asked first while Ask Before Signing is on.
    // Not asked, or not from here: the rest is restored, and it says why they weren't.)
    const sigs = opened.plan?.signatures?.length && (opened.kind === 'file' ? parts.signatures === true : parts.signatures !== false)
    const grant = sigs ? await grantFor('change').catch(() => null) : null
    const r = await api('/backup/apply', { method: 'POST', body: { id: opened.id, parts, grant } })
    setApplied({ ...r, from: opened.from })
    setOpened(null)
  })
  const cancel = () => run('cancel', async () => { if (opened.kind === 'move') await api('/backup/discard', { method: 'POST', body: { id: opened.id } }); setOpened(null) })
  const start = (ids) => run('start', async () => { await api('/backup/start', { method: 'POST', body: ids ? { connections: ids } : {} }); setApplied(null) })
  const again = () => run('handoff', async () => { const r = await api('/backup/handoff', { method: 'POST', body: {} }); setApplied((a) => (a ? { ...a, ...r } : a)) })
  const move = () => run('move', async () => api('/backup/move', { method: 'POST', body: { to, signatures: sigs, grant: sigs ? await grantFor('export') : null } }))
  const withSigs = <label className="st-check bk-sigs" data-setting="backup-signatures"><input type="checkbox" checked={sigs} onChange={(e) => setSigs(e.target.checked)} /> <span><b>{t('With your signatures')}</b> <span className="muted small">{t('Your saved signatures and initials too ({place}). Off, they stay only here.', { place: where('signatures') })}</span></span></label>
  const undo = (id) => run(`undo-${id}`, () => api(`/backup/moves/${id}/undo`, { method: 'POST', body: {} }))
  const linked = s.linked || []
  const moveLine = (m) => (m.state === 'moved' ? t('Moved to {name} on {date}: the bots, connections and scheduled routines here are paused.', { name: m.toName, date: when(m.pausedAt) })
    : m.state === 'sent' ? t('Sent to {name}: waiting for it to be applied there.', { name: m.toName })
      : m.state === 'declined' ? t('{name} turned it down.', { name: m.toName })
        : m.state === 'undone' ? t('Moved to {name}, then started here again.', { name: m.toName })
          : m.state === 'failed' ? t('Couldn\'t send it to {name}: {why}', { name: m.toName, why: m.error || '' }) : t('Sending to {name}…', { name: m.toName }))

  return (
    <div className="bk" data-setting="backup">
      <p className="st-note small"><Icon name="info" size={13} /><span>{t('Bots arrive paused, until the computer they came from has stopped them.')} <More>{t('One app can\'t be connected from two computers at once (Slack would hand each computer some of its questions), so what comes arrives paused until the computer it came from has stopped its bots.')}</More></span></p>

      {s.incoming.length > 0 && (
        <section className="st-sec bk-incoming">
          <h4>{t('Coming In')}</h4>
          {s.incoming.map((m) => (
            <div key={m.id} className="st-row">
              <span className="small"><Icon name="download" size={12} /> {t('{name} is moving its setup here.', { name: m.from })}</span>
              {opened?.id !== m.id && <button type="button" className="btn small primary" disabled={!!busy} onClick={() => seeMove(m)}>{t('See What Comes')}</button>}
            </div>
          ))}
          {opened?.kind === 'move' && <Plan plan={opened.plan} busy={busy === 'apply'} onApply={apply} onCancel={cancel} cancelLabel={t('Turn Down')} />}
        </section>
      )}

      {applied && (
        <section className="st-sec">
          <h4>{t('Applied')}</h4>
          <Applied r={applied} from={applied.from} busy={!!busy} onStart={() => start(null)} onAgain={again} />
        </section>
      )}

      {s.paused.connections.length > 0 && !applied && (
        <section className="st-sec bk-paused">
          <h4>{t('Paused Here')}</h4>
          {s.last?.handoff === 'failed' && (
            <p className="st-note bad small"><Icon name="alert" size={13} /><span>{t('{name} couldn\'t be reached to pause its bots: {why}', { name: s.last.from, why: s.last.error || '' })}</span> <button type="button" className="btn small" disabled={!!busy} onClick={again}>{t('Try Again')}</button></p>
          )}
          {s.paused.connections.map((c) => (
            <div key={c.id} className="st-row bk-conn">
              <span className="small"><b>{t('{name} ({platform})', { name: c.name, platform: PLATFORM[c.platform] || c.platform })}</b>{c.why ? <span className="muted"> · {c.why}</span> : null}</span>
              {c.movedTo ? <button type="button" className="btn small" disabled={!!busy} onClick={() => undo(c.move)}><Icon name="play" size={12} /> {t('Start Here Again')}</button> : c.takenBack || c.by === 'move' ? null : <button type="button" className="btn small" disabled={!!busy} onClick={() => start([c.id])}><Icon name="play" size={12} /> {t('Start')}</button>}
            </div>
          ))}
          {s.paused.connections.filter((c) => !c.movedTo && !c.takenBack && c.by !== 'move').length > 1 && <button type="button" className="btn small" disabled={!!busy} onClick={() => start(null)}><Icon name="play" size={12} /> {t('Start All')}</button>}
        </section>
      )}

      <section className="st-sec">
        <h4>{t('Move to Another Computer')}</h4>
        {!linked.length ? <p className="muted small">{t('Link the other computer first, in {place}.', { place: where('machines') })}</p> : (
          <>
            <div className="st-row">
              <select className="st-input" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('Move to')}>
                {linked.map((m) => <option key={m.id} value={m.id} disabled={!m.online}>{m.online ? m.name : t('{name} (offline)', { name: m.name })}</option>)}
              </select>
              <button type="button" className="btn small primary" disabled={!!busy || !to} onClick={move}><Icon name="send" size={12} /> {busy === 'move' ? t('Sending…') : t('Move')}</button>
            </div>
            {withSigs}
            <p className="muted small">{t('Sent straight over the end-to-end encrypted link between them, with no passphrase. The other computer shows what\'s coming and asks before applying it; once it has, the bots, connections and scheduled routines here pause, so nothing answers twice.')}</p>
          </>
        )}
        {s.moves.length > 0 && (
          <ul className="bk-list small">
            {s.moves.slice(0, 5).map((m) => (
              <li key={m.id} className={m.state === 'failed' ? 'bad' : ''}>
                {moveLine(m)}
                {m.state === 'moved' && <> <button type="button" className="link-btn small" disabled={!!busy} onClick={() => undo(m.id)}>{t('Start Here Again')}</button></>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!s.here ? (
        <section className="st-sec">
          <h4>{t('Back Up to a File')}</h4>
          <p className="muted small">{t('Back up to a file, and restore from one, on the computer itself.')}</p>
        </section>
      ) : (
        <>
          <section className="st-sec">
            <h4>{t('Back Up to a File')}</h4>
            <p className="muted small">{t('One file, sealed with a passphrase you pick. Keep the passphrase safe: it isn\'t kept anywhere.')} <More>{t('One file, everything in it sealed with a passphrase you pick (AES-256): without the passphrase nothing in it can be read, and it isn\'t kept anywhere, so keep it somewhere safe.')}</More></p>
            <div className="st-row bk-pass">
              <input type="password" className="st-input" autoComplete="new-password" value={pass.a} onChange={(e) => setPass((p) => ({ ...p, a: e.target.value }))} placeholder={t('Passphrase, {n} characters or more', { n: s.passMin })} aria-label={t('Passphrase')} />
              <input type="password" className="st-input" autoComplete="new-password" value={pass.b} onChange={(e) => setPass((p) => ({ ...p, b: e.target.value }))} placeholder={t('The same again')} aria-label={t('The passphrase again')} />
              <button type="button" className="btn small primary" disabled={!!busy || [...pass.a].length < s.passMin || !pass.b} onClick={backUp}><Icon name="archive" size={12} /> {busy === 'file' ? t('Sealing…') : t('Back Up')}</button>
            </div>
            {withSigs}
            {made && <p className="st-note ok small" role="status"><Icon name="check" size={13} /><span>{t('Saved {name}.', { name: made })}</span></p>}
          </section>
          <section className="st-sec">
            <h4>{t('Restore From a File')}</h4>
            <div className="st-row bk-pass">
              <input ref={fileIn} type="file" accept=".bridge-backup,application/json" hidden onChange={(e) => { setFile(e.target.files?.[0] || null); setOpened(null) }} />
              <button type="button" className="btn small" onClick={() => fileIn.current?.click()}><Icon name="file" size={12} /> {file ? file.name : t('Choose a Backup…')}</button>
              <input type="password" className="st-input" autoComplete="off" value={openPass} onChange={(e) => setOpenPass(e.target.value)} placeholder={t('Its passphrase')} aria-label={t('Its passphrase')} />
              <button type="button" className="btn small primary" disabled={!!busy || !file || !openPass} onClick={openFile}><Icon name="upload" size={12} /> {busy === 'open' ? t('Opening…') : t('Open')}</button>
            </div>
            <p className="muted small">{t('Stop the bots on the computer it came from first: its connections arrive paused here, with Start.')}</p>
            {opened?.kind === 'file' && <Plan plan={opened.plan} busy={busy === 'apply'} onApply={apply} onCancel={() => setOpened(null)} cancelLabel={t('Cancel')} />}
          </section>
        </>
      )}
      {err && <p className="st-note bad small" role="alert"><Icon name="alert" size={13} /><span>{err}</span></p>}
      <Advanced order={50}>
        <section className="st-sec bk" data-setting="backup-what">
          <h4>{t('What Goes')}</h4>
          <p className="small"><b>{t('In it:')}</b> {t('your bots (their settings, instructions and what they remember); their connections, with their tokens; your routines; the Chief of Staff\'s playbook, ledger and task list; your agents\' MCP servers; and the settings that mean the same on another computer (your name and location, beta features, models picked for each job, Meetings and Dictation).')} {t('Your saved signatures and initials too, only when you tick them.')}</p>
          <p className="small muted"><b>{t('Left out:')}</b> {t('what\'s this computer\'s own (its name and keys, its relay, the phones and computers linked with it, your Bold Bridge sign-in, the agents\' and model providers\' sign-ins, its port, update channel and caches); meetings and recordings, which are often gigabytes (Files › Send to… copies them); and each bot\'s Activity, the files it made and drafts waiting.')}</p>
        </section>
      </Advanced>
    </div>
  )
}
