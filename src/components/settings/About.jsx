import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { useSettings } from './General.jsx'
import { startTour } from '../Tour.jsx'

const REPO = 'https://github.com/sahil1/bridge'

// Settings › About & Updates: which version you have, whether there's a newer one (and updating
// to it), the tour again, and what to include when you report a problem.
export default function About() {
  return (
    <div className="st-sections">
      <Updates />
      <section className="st-sec">
        <h4>Tour</h4>
        <p className="muted small">A quick look at the main parts of Bridge AI, the same one you saw after setup.</p>
        <div className="st-row"><button type="button" className="btn" onClick={startTour}><Icon name="sparkle" size={14} /> Take the tour</button></div>
      </section>
      <Report />
    </div>
  )
}

export function useUpdates(force = false) {
  const [u, setU] = useState(null)
  const load = (refresh) => api(`/updates${refresh ? '?refresh=1' : ''}`).then(setU).catch((e) => setU({ error: e.message }))
  useEffect(() => { load(force) }, [force])
  return [u, load]
}

function Updates() {
  const [u, load] = useUpdates()
  const { s, save } = useSettings()
  const [state, setState] = useState(null) // checking | installing | { error }
  const check = async () => { setState('checking'); await load(true); setState(null) }
  const install = async () => {
    setState('installing')
    try { await api('/updates/install', { method: 'POST' }) } catch (e) { setState({ error: e.message }) }
  }
  const auto = s ? s.effective.updates?.check !== false : true

  return (
    <section className="st-sec">
      <h4>Version</h4>
      {!u ? <div className="skeleton-rows"><div /></div> : (
        <>
          <div className="st-row">
            <span className="ab-version">Bridge AI {u.current}</span>
            {u.disabled ? <span className="muted small">Update checks are off</span>
              : u.error && !u.latest ? <span className="muted small">Couldn't check for updates ({u.error})</span>
              : u.available ? <span className="st-chip warn"><Icon name="download" size={11} /> {u.latest} is available</span>
              : <span className="st-chip good"><Icon name="check" size={11} /> Up to date</span>}
          </div>
          {u.available && (
            state === 'installing'
              ? <p className="st-note ok"><Icon name="refresh" size={13} /> Updating to {u.latest}. Bridge AI closes and reopens by itself in a few seconds; your agents carry on where they were.</p>
              : u.how === 'app'
                ? <div className="st-row"><button type="button" className="btn primary" onClick={install}><Icon name="download" size={14} /> Update to {u.latest}</button><a className="small" href={u.url} target="_blank" rel="noreferrer">What's new</a></div>
                : <div className="ab-cmd"><p className="muted small">{u.how === 'source' ? 'You run Bridge AI from a clone; update it in a terminal, in that folder:' : u.how === 'docker' ? 'Bridge AI runs in Docker; update it on that device, in the folder with docker-compose.yml:' : 'Update from a terminal (it asks for your password to install the package):'}</p><code>{u.command}</code><div className="st-row"><button type="button" className="ghost-btn" onClick={() => navigator.clipboard?.writeText(u.command).catch(() => {})}><Icon name="copy" size={12} /> Copy</button><a className="small" href={u.url} target="_blank" rel="noreferrer">What's new</a></div></div>
          )}
          {state?.error && <p className="st-note bad"><Icon name="alert" size={13} /> {state.error}</p>}
          <div className="st-row">
            {!u.disabled && <button type="button" className="ghost-btn" disabled={state === 'checking'} onClick={check}><Icon name="refresh" size={12} /> {state === 'checking' ? 'Checking…' : 'Check now'}</button>}
            <label className="ph-check small"><input type="checkbox" checked={auto} onChange={(e) => save({ updates: { check: e.target.checked } }).then(() => load(true))} /> Check for new versions (asks GitHub a few times a day; nothing about you is sent)</label>
          </div>
        </>
      )}
    </section>
  )
}

function Report() {
  const [d, setD] = useState(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => { api('/diagnostics').then(setD).catch(() => setD(null)) }, [])
  const text = d ? Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') || 'none' : v}`).join('\n') : ''
  const copy = () => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})
  const issue = `${REPO}/issues/new?template=bug.yml&diagnostics=${encodeURIComponent(text)}`
  return (
    <section className="st-sec">
      <h4>Report a problem or suggest something</h4>
      <p className="muted small">Bridge AI is open source. Problems and ideas go in GitHub issues. Include the details below; they say which version and system you have, and nothing about you (no names, emails, folders or location).</p>
      {d && <pre className="st-code ro ab-diag">{text}</pre>}
      <div className="st-row">
        <button type="button" className="ghost-btn" disabled={!d} onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? 'Copied' : 'Copy details'}</button>
        <a className="btn" href={issue} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Report a problem</a>
        <a className="ghost-btn" href={`${REPO}/issues/new?template=feature.yml`} target="_blank" rel="noreferrer">Suggest an idea</a>
      </div>
      <p className="muted small">Free and open source under the Apache License 2.0, as is, with no warranty. Not affiliated with Anthropic, OpenAI, Google, GitHub or the other companies whose tools it works with. <a href={`${REPO}/blob/main/TERMS.md`} target="_blank" rel="noreferrer">Terms</a> · <a href={`${REPO}/blob/main/PRIVACY.md`} target="_blank" rel="noreferrer">Privacy</a> · <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">License</a></p>
    </section>
  )
}
