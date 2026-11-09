import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import AgentMark from './agentMark.jsx'
import LocationPicker from './LocationPicker.jsx'
import { USAGE_OFF_WHY } from '../Usage.jsx'
import { t, tx } from '../../i18n/index.js'
import { api, settingsChanged, refetch } from '../../api.js'
import { useTrial } from '../../trials.js'
import { askRestart, useRecheck } from '../PermissionFix.jsx'
import SetupAll from '../SetupAll.jsx'
import Permissions from './Permissions.jsx'
import { Advanced, Line } from './Advanced.jsx'

// Settings › General: who you are, which agent and model to use by default, the layout and where
// you are; under Advanced, the Chief of Staff's agent, plan usage, what Bridge AI is allowed on this
// computer (Permissions), Command History, and the terminal and where agents run.
export function useSettings() {
  const [s, setS] = useState(null)
  const [note, setNote] = useState(null)
  const load = () => api('/settings').then(setS).catch((e) => setNote({ error: e.message }))
  useEffect(() => { load() }, [])
  const save = async (patch) => {
    try {
      const r = await api('/settings', { method: 'PATCH', body: patch })
      setS(r.settings)
      settingsChanged()
      setNote(r.restart.length ? { restart: r.restart } : { saved: true })
      return r
    } catch (e) { setNote({ error: e.message }) }
  }
  return { s, save, note, reload: load }
}

export function SaveNote({ note }) {
  if (!note) return null
  if (note.error) return <p className="st-note bad"><Icon name="alert" size={13} /> {note.error}</p>
  if (note.restart) {
    return (
      <p className="st-note warn"><Icon name="refresh" size={13} /> Saved. {note.restart.join(', ')} take{note.restart.length === 1 ? 's' : ''} effect when Bridge AI restarts.
        <button type="button" className="link-btn" onClick={() => { refetch('/fix'); setTimeout(askRestart, 300) }}>Restart to apply…</button></p>
    )
  }
  return <p className="st-note ok"><Icon name="check" size={13} /> Saved</p>
}

export default function General({ onGo, onOpenAgent }) {
  const { s, save, note } = useSettings()
  const [agents, setAgents] = useState(null)
  const [name, setName] = useState('')
  useEffect(() => { api('/agents/catalog').then(setAgents).catch(() => setAgents([])) }, [])
  useEffect(() => { if (s) setName(s.effective.name || '') }, [s])
  const commandsOn = useTrial('routines')
  if (!s) return <div className="skeleton-rows"><div /><div /><div /></div>

  const eff = s.effective
  const installed = (agents || []).filter((a) => a.installed)
  const def = eff.defaultAgent || 'claude'
  const defAgent = (agents || []).find((a) => a.kind === def)
  const model = eff.agents?.[def]?.model || ''
  const seg = (label, value, options, onPick) => (
    <div className="seg ap-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => <button key={l} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onPick(v)}>{t(l)}</button>)}
    </div>
  )

  return (
    <div className="st-sections">
      <SaveNote note={note} />
      <SetupAll onOpen={onOpenAgent} />

      <section className="st-sec" data-setting="name">
        <Line label={t('Your name')} hint={t('What the Chief of Staff and the morning brief call you.')}>
          <input className="st-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== (eff.name || '') && save({ name: name.trim() })}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} placeholder="First name" aria-label={t('Your name')} maxLength={60} />
        </Line>
      </section>

      <section className="st-sec" data-setting="default-agent">
        <h4>{t('Default agent')}</h4>
        <p className="muted small">{t('New agents, chats, routines and mail tasks start with it unless you pick another.')}</p>
        {agents && !installed.length && <p className="st-note warn">No agents installed yet. <button className="link-btn" onClick={() => onGo('agents')}>Install one</button> to get started, or chat with any model through an API key: New chat, then Any model.</p>}
        <div className="st-agent-grid">
          {installed.map((a) => (
            <button key={a.kind} type="button" className={`st-agent ${def === a.kind ? 'on' : ''}`} aria-pressed={def === a.kind} onClick={() => save({ defaultAgent: a.kind })}>
              <AgentMark kind={a.kind} label={a.label} size={30} />
              <span>{a.label}</span>
              {def === a.kind && <Icon name="check" size={13} className="st-agent-check" />}
            </button>
          ))}
          <button type="button" className="st-agent ghost" onClick={() => onGo('agents')}><Icon name="plus" size={14} /><span>More agents</span></button>
        </div>
        {defAgent && (defAgent.modelFlag
          ? <Line setting="default-model" label={t('Default model for {agent}', { agent: defAgent.label })} hint={t("Empty: {agent}'s own default.", { agent: defAgent.label })}
              title={s.effective.runtime === 'herdr' ? t("Any model name the CLI accepts works. With herdr, agents herdr starts itself (Claude, Codex, Gemini, Grok, Cursor) use the model set in the agent's own settings.") : t('Any model name the CLI accepts works.')}>
              <ModelField key={def} value={model} models={defAgent.models} onSave={(v) => save({ agents: { ...(eff.agents || {}), [def]: { ...(eff.agents?.[def] || {}), model: v || undefined } } })} />
            </Line>
          : <p className="muted small">{t("{agent} picks its model in its own settings; Bridge AI can't set it from here yet.", { agent: defAgent.label })}</p>)}
      </section>

      <section className="st-sec" data-setting="layout">
        <Line label={t('Layout')} hint={t('Simple: your Chief of Staff and your agents. Everything: every panel.')}
          title={t('Simple keeps the screen to your chief of staff and your agents: the Today panel waits behind one button, and the Agents board shows up once you have agents. Everything shows every panel.')}>
          {seg('Layout', !!eff.simple, [[true, 'Simple'], [false, 'Everything']], (on) => save({ simple: on }))}
        </Line>
      </section>

      <section className="st-sec" data-setting="location">
        <h4>{t('Location')}</h4>
        <p className="muted small">{t('For the weather and the morning brief. Only the place you pick is saved, on this computer.')}</p>
        <LocationPicker value={eff.location} onChange={(loc) => save({ location: loc })} />
      </section>

      <Advanced order={10}>
        <section className="st-sec" data-setting="chief">
          <Line label={t('Chief of Staff runs on')} hint={t('One with a chat view (Claude Code or Codex) works best.')} title={t('The agent you talk to, which hands work to the others.')}>
            <select className="st-input" value={eff.chief?.kind || 'claude'} onChange={(e) => save({ chief: { kind: e.target.value } })} aria-label={t('Chief of Staff runs on')}>
              {installed.map((a) => <option key={a.kind} value={a.kind}>{a.label}{a.caps?.chat ? '' : ' (terminal only)'}</option>)}
            </select>
          </Line>
        </section>
        <section className="st-sec" data-setting="plan-usage">
          <Line label={t('Plan usage')} hint={t("Read with your agents' own sign-ins, which some providers, Anthropic among them, don't allow.")} title={t(USAGE_OFF_WHY)}>
            {seg('Plan usage', !!eff.quota?.read, [[false, 'Off'], [true, 'On']], (on) => save({ quota: { read: on } }))}
          </Line>
        </section>
      </Advanced>
      <Advanced order={20}><Permissions /></Advanced>
      {commandsOn && <Advanced order={30}><CommandHistory value={eff.commands || {}} save={save} /></Advanced>}
      {/* For people who live in a terminal. */}
      <Advanced order={40}>
        <TerminalApp value={eff.terminal?.app || 'auto'} onSave={(app) => save({ terminal: { ...(eff.terminal || {}), app } })} />
        <section className="st-sec" data-setting="runtime">
          <Line label={t('Where agents run')} hint={t('herdr, installed separately, adds its own terminal and split panes. Applies after a restart.')}
            title={t('Built in needs nothing else. herdr (optional, installed separately) adds its own terminal UI, split panes and the live Herdr view; your agents then share your herdr session. Applies after a restart.')}>
            {seg('Runtime', eff.runtime === 'herdr' ? 'herdr' : 'builtin', [['builtin', 'Built in'], ['herdr', 'herdr']], (id) => save({ runtime: id }))}
          </Line>
          {eff.runtime === 'herdr' && <HerdrSession value={eff.herdr?.session || ''} onSave={(session) => save({ herdr: { ...(eff.herdr || {}), session: session || null } })} />}
          {eff.runtime !== 'herdr' && (
            <>
              <label className="ph-check small" data-setting="keep-agents" title={t('They carry on through updates and restarts, and Bridge AI picks them up as they are when it starts. Off: they stop with it, and Claude Code and Codex resume their conversations next time.')}>
                <input type="checkbox" checked={eff.keepAgents !== false} onChange={(e) => save({ keepAgents: e.target.checked })} /> {t('Keep agents running when Bridge AI quits')}</label>
              <label className="ph-check small" data-setting="resume-work" title={t('An agent stopped in the middle of something (an update that had to restart its terminal, a crash, the computer restarting) reopens its conversation and is told to carry on from where it left off. Off: it reopens and waits for you.')}>
                <input type="checkbox" checked={eff.resumeWork !== false} onChange={(e) => save({ resumeWork: e.target.checked })} /> {t('Pick up unfinished work after an update, a crash or a restart')}</label>
            </>
          )}
        </section>
      </Advanced>
    </div>
  )
}

// With several herdr sessions (`herdr --session work`), pick the one Bridge AI shows and drives.
function HerdrSession({ value, onSave }) {
  const [d, setD] = useState(null)
  const load = () => api('/herdr/sessions').then(setD).catch(() => setD({ sessions: [] }))
  useEffect(() => { load() }, [])
  // Installed or started meanwhile: noticed when you come back to the window.
  useRecheck(load, 0, d?.installed === false)
  if (!d) return null
  if (!d.installed) {
    return (
      <p className="st-note warn"><Icon name="alert" size={13} /> herdr isn't installed, or isn't running. Install it from <a href="https://herdr.dev" target="_blank" rel="noreferrer">herdr.dev</a> and start it once, or choose Built in above.
        <button type="button" className="link-btn" onClick={load}>Check again</button></p>
    )
  }
  const names = d.sessions.map((s) => s.name)
  if (value && !names.includes(value)) names.push(value)
  return (
    <div className="st-row">
      <label className="small" htmlFor="st-herdr-session">Session</label>
      <select id="st-herdr-session" className="st-input" value={value} onChange={(e) => onSave(e.target.value)}>
        <option value="">Automatic{d.current && !value ? ` (now ${d.current})` : ''}: main, else the latest one running</option>
        {names.map((n) => { const s = d.sessions.find((x) => x.name === n); return <option key={n} value={n}>{n}{s ? (s.running ? ' · running' : ' · stopped') : ' · not found'}</option> })}
      </select>
      <p className="muted small" style={{ flexBasis: '100%', margin: 0 }}>Switches at once. The session menu at the top of the sidebar also starts, stops and opens sessions.</p>
    </div>
  )
}

function ModelField({ value, models, onSave }) {
  const [v, setV] = useState(value)
  const id = 'st-models'
  return (
    <div className="st-row">
      <input className="st-input mono" list={id} value={v} onChange={(e) => setV(e.target.value)} placeholder={models[0] ? `e.g. ${models[0]}` : 'model name'}
        onBlur={() => v.trim() !== value && onSave(v.trim())} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} spellCheck={false} />
      <datalist id={id}>{models.map((m) => <option key={m} value={m} />)}</datalist>
      {value && <button type="button" className="ghost-btn" onClick={() => { setV(''); onSave('') }}>Use agent default</button>}
    </div>
  )
}

// "Open in terminal" uses this app; `bridge-ai attach` works in any terminal too.
function TerminalApp({ value, onSave }) {
  const [found, setFound] = useState(null)
  useEffect(() => { api('/terminals').then((r) => setFound(r.found)).catch(() => setFound([])) }, [])
  return (
    <section className="st-sec" data-setting="terminal">
      <Line label={t('Terminal app')} hint={t('For "Open in terminal" on an agent.')} title={t('If you installed Bridge AI with npm, bridge-ai attach in any terminal works too; Ctrl+] leaves.')}>
        <select className="st-input" value={value} onChange={(e) => onSave(e.target.value)} aria-label={t('Terminal app')}>
          <option value="auto">Automatic{found?.[0] ? ` (${found[0].name})` : ''}</option>
          {(found || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Line>
    </section>
  )
}

// Command History (Scheduled Routines, a beta feature): what you asked in Bridge AI's boxes, kept on
// this computer for History › Commands and routine suggestions. On or off, for how long, Delete all.
const KEEP = [['30d', tx('30 days')], ['90d', tx('90 days')], ['1y', tx('1 year')]]
function CommandHistory({ value, save }) {
  const [cleared, setCleared] = useState(null)
  const [mine, setMine] = useState({}) // as you set it, at once; saved behind it
  const set = (patch) => { setMine((m) => ({ ...m, ...patch })); save({ commands: patch }) }
  const on = (mine.history ?? value.history) !== false
  const keep = KEEP.some(([v]) => v === (mine.keepFor ?? value.keepFor)) ? mine.keepFor ?? value.keepFor : '90d'
  const clear = async () => {
    if (!window.confirm(`${t('Delete everything in Command History?')}\n\n${t('What you asked, and the routine suggestions you dismissed, go from this computer. This can\'t be undone.')}`)) return
    try { await api('/command-history', { method: 'DELETE' }); setCleared(t('Deleted.')) } catch (e) { setCleared(e.message) }
  }
  return (
    <section className="st-sec" id="commands" data-setting="commands">
      <h4>{t('Command History')}</h4>
      <label className="st-check"><input type="checkbox" checked={on} onChange={(e) => set({ history: e.target.checked })} />
        <span title={t('In History › Commands: what you send your agents and Chief of Staff from their message boxes, New and the Tasks panel, to find again or make a routine of, and to suggest a routine when you ask the same thing on a schedule. Only on this computer; what agents send each other isn\'t kept.')}><b>{t('Keep a history of what you ask')}</b> <span className="muted small">{t('In History › Commands, on this computer only.')}</span></span></label>
      {on && (
        <div className="st-row st-radios" role="radiogroup" aria-label={t('Keep them for')}><span>{t('Keep them for')}</span>
          <span className="st-choices st-choices-row">{KEEP.map(([v, l]) => (
            <label key={v}><input type="radio" name="cmd-keep" checked={keep === v} onChange={() => set({ keepFor: v })} /> {t(l)}</label>
          ))}</span>
        </div>
      )}
      <div className="st-row">
        <button type="button" className="btn small danger-soft" onClick={clear}><Icon name="trash" size={12} /> {t('Delete all commands…')}</button>
        {cleared && <span className="muted small" role="status">{cleared}</span>}
      </div>
    </section>
  )
}
