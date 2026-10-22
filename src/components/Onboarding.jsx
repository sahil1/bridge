import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import AgentMark from './settings/agentMark.jsx'
import LocationPicker from './settings/LocationPicker.jsx'
import { api, settingsChanged } from '../api.js'

// First run. Bridge AI looks at what's already on this computer (agent CLIs and their sign-ins,
// your name, your time zone) and proposes a setup you can accept with one click, or adjust.
const STARTERS = ['claude', 'codex', 'gemini', 'copilot']

export default function Onboarding({ onDone }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [step, setStep] = useState('welcome') // welcome | choose | working | done
  const [pick, setPick] = useState(null) // { name, location, defaultAgent, chiefKind }
  const [installing, setInstalling] = useState({})
  const [editing, setEditing] = useState(null) // which row on the welcome step is open: name | location | chief
  const load = () => api('/setup').then((r) => { setD(r); setPick((p) => p || r.suggested) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const finish = async (choice) => {
    setStep('working'); setErr(null)
    try {
      await api('/setup', { method: 'POST', body: choice })
      settingsChanged()
      let chief = null
      if (choice.chiefKind) chief = await api('/chief/launch', { method: 'POST' }).catch(() => null)
      setStep('done')
      setPick((p) => ({ ...p, chiefPane: chief?.paneId }))
    } catch (e) { setErr(e.message); setStep('welcome') }
  }
  const install = async (kind) => {
    setInstalling((x) => ({ ...x, [kind]: 'running' }))
    try { await api(`/setup/install/${kind}`, { method: 'POST' }); setInstalling((x) => ({ ...x, [kind]: 'started' })) } catch (e) { setErr(e.message); setInstalling((x) => ({ ...x, [kind]: null })) }
  }

  if (!d) {
    return (
      <div className="onb">
        <div className="onb-card">
          <img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" width="56" height="56" className="onb-logo" />
          <h1>Welcome to Bridge AI</h1>
          {err ? <p className="error-text">{err}</p> : <p className="muted">Looking at what's on this computer…</p>}
        </div>
      </div>
    )
  }

  const usable = d.usable || []
  const label = (k) => d.agents.find((a) => a.kind === k)?.label || k
  const none = !usable.length

  return (
    <div className="onb">
      <div className="onb-card">
        <img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" width="56" height="56" className="onb-logo" />
        {step === 'done' ? (
          <>
            <h1>You're set{pick?.name ? `, ${pick.name}` : ''}</h1>
            <p className="onb-lede">Here's how Bridge AI works:</p>
            <ol className="onb-tips">
              <li><Icon name="helm" size={16} /><span><b>Talk to your chief of staff.</b> Ask for anything; it sends the work to the right agent, starts new ones when needed, and tells you when it's done. The first time, it asks you to trust its folder: click Yes on the card.</span></li>
              <li><Icon name="plus" size={16} /><span><b>Start agents yourself</b> with <kbd>+</kbd> in the sidebar: a project agent in a folder, or a plain chat.</span></li>
              <li><Icon name="blocked" size={16} /><span><b>Watch the sidebar.</b> A pulsing dot means an agent needs you; open it to answer.</span></li>
              <li><Icon name="palette" size={16} /><span><b>Make it yours</b> in Settings (<kbd>⌘,</kbd> or <kbd>Ctrl+,</kbd>): default model, providers, MCP tools, theme.</span></li>
            </ol>
            <button className="btn primary onb-btn" onClick={() => onDone(pick?.chiefPane)}>Open Bridge AI</button>
          </>
        ) : step === 'working' ? (
          <>
            <h1>Setting things up…</h1>
            <p className="muted">Saving your settings and starting your chief of staff.</p>
          </>
        ) : (
          <>
            <h1>Welcome to Bridge AI</h1>
            <p className="onb-lede">One place to run all your AI agents and talk to them, with a chief of staff that sends each request to the right one.</p>

            {none ? (
              <div className="onb-box">
                <h3>First, an agent</h3>
                <p className="muted small">Bridge AI works with the agent CLIs you already use, signed in with your own subscriptions. None were found here; install one (it opens in a terminal tab so you can sign in), then check again.</p>
                <ul className="onb-install">
                  {STARTERS.map((k) => {
                    const a = d.agents.find((x) => x.kind === k)
                    if (!a) return null
                    return (
                      <li key={k}>
                        <AgentMark kind={k} label={a.label} size={28} /><b>{a.label}</b>
                        <code>{a.install}</code>
                        <button className="btn onb-btn sm" disabled={!!installing[k]} onClick={() => install(k)}>{installing[k] === 'started' ? 'Installing…' : 'Install'}</button>
                      </li>
                    )
                  })}
                </ul>
                <button className="ghost-btn strong" onClick={load}><Icon name="refresh" size={12} /> I've installed one, check again</button>
              </div>
            ) : step === 'welcome' ? (
              <div className="onb-box">
                <h3>Here's what I found</h3>
                <p className="muted small onb-hint">Check these, change anything that's off, then finish.</p>
                <ul className="onb-found">
                  <li>
                    <Icon name="bot" size={15} /><span className="onb-key">Agents</span>
                    <span className="onb-val onb-chips">{usable.map((a) => (
                      <span key={a.kind} className="onb-chip" title={a.signedIn === true ? `Signed in${a.method ? ` (${a.method})` : ''}` : a.signedIn === false ? 'Installed. Sign in the first time you open it.' : 'Installed'}>
                        <AgentMark kind={a.kind} label={a.label} size={16} />{a.label}
                        {a.signedIn === true ? <Icon name="check" size={11} /> : a.signedIn === false ? <small>sign in</small> : null}
                      </span>))}</span>
                  </li>
                  <Row icon="users" label="Your name" open={editing === 'name'} onToggle={() => setEditing(editing === 'name' ? null : 'name')}
                    value={<b>{pick?.name || <span className="muted">Not set</span>}</b>}>
                    <input className="st-input" autoFocus value={pick?.name || ''} placeholder="First name"
                      onChange={(e) => setPick({ ...pick, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(null) }} />
                  </Row>
                  <Row icon="sun" label="Weather for" open={editing === 'location'} onToggle={() => setEditing(editing === 'location' ? null : 'location')}
                    value={pick?.location ? <><b>{pick.location.label}</b>{pick.location.approximate && <span className="muted small">guessed from your time zone</span>}</> : <span className="muted">Not set</span>}
                    below>
                    <LocationPicker value={pick?.location} onChange={(loc) => { setPick({ ...pick, location: loc }); if (loc) setEditing(null) }} />
                  </Row>
                  <Row icon="helm" label="Chief of staff" open={editing === 'chief'} onToggle={() => setEditing(editing === 'chief' ? null : 'chief')}
                    value={<b>{pick?.chiefKind ? label(pick.chiefKind) : <span className="muted">Don't start one</span>}</b>}>
                    <select className="st-input" autoFocus value={pick?.chiefKind || ''} onChange={(e) => { setPick({ ...pick, chiefKind: e.target.value || null }); setEditing(null) }}>
                      {usable.map((a) => <option key={a.kind} value={a.kind}>{a.label}{a.caps?.chat ? '' : ' (terminal only)'}</option>)}
                      <option value="">Don't start one now</option>
                    </select>
                  </Row>
                  <li>
                    <Icon name="terminal" size={15} /><span className="onb-key">Agents run</span>
                    <span className="onb-val"><b>{d.runtime === 'herdr' ? 'In herdr' : 'Inside Bridge AI'}</b><span className="muted small">change later in Settings</span></span>
                  </li>
                </ul>
                <div className="onb-acts">
                  <button className="btn primary onb-btn" onClick={() => finish(pick)}>Finish setup</button>
                  <button className="btn onb-btn" onClick={() => setStep('choose')}>More options</button>
                </div>
              </div>
            ) : (
              <div className="onb-box">
                <h3>Your setup</h3>
                <label className="onb-field"><span>Your name</span><input className="st-input" value={pick.name || ''} onChange={(e) => setPick({ ...pick, name: e.target.value })} placeholder="First name" /></label>
                <div className="onb-field"><span>Default agent</span>
                  <div className="st-agent-grid">{usable.map((a) => (
                    <button key={a.kind} type="button" className={`st-agent ${pick.defaultAgent === a.kind ? 'on' : ''}`} onClick={() => setPick({ ...pick, defaultAgent: a.kind })}><AgentMark kind={a.kind} label={a.label} size={26} /><span>{a.label}</span></button>
                  ))}</div>
                </div>
                <label className="onb-field"><span>Chief of staff runs on</span>
                  <select className="st-input" value={pick.chiefKind || ''} onChange={(e) => setPick({ ...pick, chiefKind: e.target.value || null })}>
                    {usable.map((a) => <option key={a.kind} value={a.kind}>{a.label}{a.caps?.chat ? '' : ' (terminal only)'}</option>)}
                    <option value="">Don't start one now</option>
                  </select>
                </label>
                <div className="onb-field"><span>Location, for weather</span><LocationPicker value={pick.location} onChange={(loc) => setPick({ ...pick, location: loc })} /></div>
                <div className="onb-acts">
                  <button className="btn primary onb-btn" onClick={() => finish(pick)}>Finish setup</button>
                  <button className="btn onb-btn" onClick={() => setStep('welcome')}>Back</button>
                </div>
              </div>
            )}
            {err && <p className="error-text">{err}</p>}
            <button className="ghost-btn onb-skip" onClick={() => finish({})}>Skip setup for now</button>
            <p className="muted small onb-foot">Everything stays on this computer, in <code>{d.dataDir.replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^C:\\Users\\[^\\]+/i, '~')}</code>. Your agents keep using their own sign-ins.</p>
          </>
        )}
      </div>
    </div>
  )
}

// One line of the welcome summary: label, value, and a Change button that opens an editor in
// place (beside the value, or below it for bigger editors like the location search).
function Row({ icon, label, value, open, onToggle, below, children }) {
  return (
    <li className={open ? 'open' : ''}>
      <Icon name={icon} size={15} /><span className="onb-key">{label}</span>
      <span className="onb-val">{open && !below ? children : value}</span>
      <button type="button" className="ghost-btn onb-change" onClick={onToggle} aria-expanded={open}>{open ? 'Done' : 'Change'}</button>
      {open && below && <div className="onb-below">{children}</div>}
    </li>
  )
}
