import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import AgentMark from './agentMark.jsx'
import LocationPicker from './LocationPicker.jsx'
import { USAGE_OFF_WHY } from '../Usage.jsx'
import { api, settingsChanged } from '../../api.js'

// Settings › General: who you are, which agent and model to use by default, where you are.
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
  if (note.restart) return <p className="st-note warn"><Icon name="refresh" size={13} /> Saved. {note.restart.join(', ')} take{note.restart.length === 1 ? 's' : ''} effect when Bridge AI restarts (<code>npm run stop</code>, then <code>npm start</code>).</p>
  return <p className="st-note ok"><Icon name="check" size={13} /> Saved</p>
}

export default function General({ onGo }) {
  const { s, save, note } = useSettings()
  const [agents, setAgents] = useState(null)
  const [name, setName] = useState('')
  useEffect(() => { api('/agents/catalog').then(setAgents).catch(() => setAgents([])) }, [])
  useEffect(() => { if (s) setName(s.effective.name || '') }, [s])
  if (!s) return <div className="skeleton-rows"><div /><div /><div /></div>

  const eff = s.effective
  const installed = (agents || []).filter((a) => a.installed)
  const def = eff.defaultAgent || 'claude'
  const defAgent = (agents || []).find((a) => a.kind === def)
  const model = eff.agents?.[def]?.model || ''

  return (
    <div className="st-sections">
      <SaveNote note={note} />

      <section className="st-sec">
        <h4>Your name</h4>
        <p className="muted small">What the chief of staff and the morning brief call you.</p>
        <input className="st-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== (eff.name || '') && save({ name: name.trim() })}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} placeholder="First name" maxLength={60} />
      </section>

      <section className="st-sec">
        <h4>Default agent</h4>
        <p className="muted small">Used for new agents, chats, routines and mail tasks unless you pick another.</p>
        {agents && !installed.length && <p className="st-note warn">No agent CLIs found. <button className="link-btn" onClick={() => onGo('agents')}>Install one</button> to get started.</p>}
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
      </section>

      {defAgent && (
        <section className="st-sec">
          <h4>Default model for {defAgent.label}</h4>
          {defAgent.modelFlag ? (
            <>
              <p className="muted small">Leave empty to use {defAgent.label}'s own default. Any model name the CLI accepts works.</p>
              <ModelField key={def} value={model} models={defAgent.models} onSave={(v) => save({ agents: { ...(eff.agents || {}), [def]: { ...(eff.agents?.[def] || {}), model: v || undefined } } })} />
              {s.effective.runtime !== 'builtin' && <p className="muted small">With herdr, agents herdr starts itself (Claude, Codex, Gemini, Grok, Cursor) use the model set in the agent's own settings.</p>}
            </>
          ) : <p className="muted small">{defAgent.label} picks its model in its own settings; Bridge AI can't set it from here yet.</p>}
        </section>
      )}

      <section className="st-sec">
        <h4>Chief of staff runs on</h4>
        <p className="muted small">The agent you talk to, which hands work to the others. One with a chat view (Claude Code or Codex) works best.</p>
        <select className="st-input" value={eff.chief?.kind || 'claude'} onChange={(e) => save({ chief: { kind: e.target.value } })}>
          {installed.map((a) => <option key={a.kind} value={a.kind}>{a.label}{a.caps?.chat ? '' : ' (terminal only)'}</option>)}
        </select>
      </section>

      <section className="st-sec">
        <h4>Location</h4>
        <p className="muted small">For the weather and the morning brief. Only the coordinates you pick are saved, on this computer.</p>
        <LocationPicker value={eff.location} onChange={(loc) => save({ location: loc })} />
      </section>

      <section className="st-sec">
        <h4>Plan usage</h4>
        <p className="muted small">{USAGE_OFF_WHY}</p>
        <div className="seg ap-seg" role="radiogroup" aria-label="Plan usage">
          {[[false, 'Off'], [true, 'On']].map(([on, label]) => (
            <button key={label} type="button" role="radio" aria-checked={!!eff.quota?.read === on} className={!!eff.quota?.read === on ? 'on' : ''} onClick={() => save({ quota: { read: on } })}>{label}</button>
          ))}
        </div>
      </section>

      <TerminalApp value={eff.terminal?.app || 'auto'} onSave={(app) => save({ terminal: { ...(eff.terminal || {}), app } })} />

      <section className="st-sec">
        <h4>Where agents run</h4>
        <p className="muted small">Built in needs nothing else. herdr (optional, installed separately) adds its own terminal UI and keeps agents running when Bridge AI stops; your agents then share your herdr session. Applies after a restart.</p>
        <div className="seg ap-seg" role="radiogroup" aria-label="Runtime">
          {[['builtin', 'Built in'], ['herdr', 'herdr']].map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={(eff.runtime === 'herdr' ? 'herdr' : 'builtin') === id} className={(eff.runtime === 'herdr' ? 'herdr' : 'builtin') === id ? 'on' : ''} onClick={() => save({ runtime: id })}>{label}</button>
          ))}
        </div>
        {eff.runtime === 'herdr' && <HerdrSession value={eff.herdr?.session || ''} onSave={(session) => save({ herdr: { ...(eff.herdr || {}), session: session || null } })} />}
      </section>
    </div>
  )
}

// With several herdr sessions (`herdr --session work`), pick the one Bridge AI shows and drives.
function HerdrSession({ value, onSave }) {
  const [d, setD] = useState(null)
  useEffect(() => { api('/herdr/sessions').then(setD).catch(() => setD({ sessions: [] })) }, [])
  if (!d) return null
  if (!d.installed) return <p className="muted small">herdr isn't installed or didn't answer. Install it from herdr.dev, start it once, then come back here.</p>
  const names = d.sessions.map((s) => s.name)
  if (value && !names.includes(value)) names.push(value)
  return (
    <div className="st-row">
      <label className="small" htmlFor="st-herdr-session">Session</label>
      <select id="st-herdr-session" className="st-input" value={value} onChange={(e) => onSave(e.target.value)}>
        <option value="">Automatic{d.current && !value ? ` (now ${d.current})` : ''}: main, else the latest one running</option>
        {names.map((n) => { const s = d.sessions.find((x) => x.name === n); return <option key={n} value={n}>{n}{s ? (s.running ? ' · running' : ' · stopped') : ' · not found'}</option> })}
      </select>
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
    <section className="st-sec">
      <h4>Terminal app</h4>
      <p className="muted small">For "Open in terminal" on an agent. From any terminal you can also run <code>bridge-ai attach</code> (after <code>npm link</code> in the repo); Ctrl+] detaches.</p>
      <select className="st-input" value={value} onChange={(e) => onSave(e.target.value)}>
        <option value="auto">Automatic{found?.[0] ? ` (${found[0].name})` : ''}</option>
        {(found || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </section>
  )
}
