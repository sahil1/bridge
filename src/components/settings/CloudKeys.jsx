// Settings › Model providers › Cloud agents: a key for each provider that runs agents in its own
// cloud (Cursor, GitHub Copilot, Jules, Claude Managed Agents). Add, test and remove; the server
// keeps them in the data folder and only ever says whether one is saved and its last 4 characters.
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api.js'
import Icon from '../Icon.jsx'
import { CloudMark } from '../cloudBits.jsx'
import '../cloud.css'

function Secret({ id, value, onChange, saved, placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div className="pv-secret">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={saved?.set ? (saved.last4 ? `Saved, ends in ${saved.last4}` : 'Saved') : placeholder || 'Paste key'}
        autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" />
      <button type="button" className="pv-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide' : 'Show'} title={show ? 'Hide' : 'Show'}>
        <Icon name={show ? 'eye-off' : 'eye'} size={14} />
      </button>
    </div>
  )
}

function chip(p) {
  if (p.status === 'connected') return { tone: 'good', text: p.account ? `Connected · ${p.account}` : 'Connected' }
  if (p.status === 'rejected') return { tone: 'warn', text: 'Key rejected' }
  return { tone: 'off', text: 'Not set' }
}

function Card({ p, open, onToggle, onChange }) {
  const [key, setKey] = useState('')
  const [gh, setGh] = useState('')
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [cli, setCli] = useState(null) // the GitHub CLI's sign-in: { signedIn }
  useEffect(() => { if (open && p.ghLogin) api('/cloud/gh').then(setCli, () => setCli(null)) }, [open, p.ghLogin])
  const c = chip(p)
  const act = async (what, fn) => {
    setBusy(what); setMsg(null)
    try {
      const r = await fn()
      if (r?.test) setMsg({ ok: r.test.ok, text: r.test.ok ? `Saved. ${r.test.message}` : `Saved, but the test failed: ${r.test.message}` })
      else if (r && 'ok' in r && 'message' in r) setMsg({ ok: r.ok, text: r.message })
      setKey(''); setGh('')
      onChange()
    } catch (e) { setMsg({ ok: false, text: e.message }) } finally { setBusy(null) }
  }
  const save = () => act('save', () => api(`/cloud/keys/${p.id}`, { method: 'PUT', body: { key } }))
  const test = () => act('test', () => api(`/cloud/keys/${p.id}/test`, { method: 'POST' }))
  const remove = () => {
    if (!window.confirm(`Remove your ${p.name} key from Bridge AI?${p.agents ? `\n\nIts ${p.agents} cloud agent${p.agents === 1 ? '' : 's'} leave the sidebar until you add a key again. They keep running at ${p.name}.` : ''}`)) return
    act('remove', () => api(`/cloud/keys/${p.id}`, { method: 'DELETE' }))
  }
  const useCli = () => act('gh', () => api('/cloud/keys/copilot/gh', { method: 'POST' }))
  const saveGithub = (value) => act('github', () => api(`/cloud/keys/${p.id}`, { method: 'PUT', body: { github: value } }))

  return (
    <div className={`cl-card ${p.saved ? 'on' : ''} ${open ? 'open' : ''}`}>
      <button type="button" className="cl-main" onClick={onToggle} aria-expanded={open}>
        <CloudMark provider={p.id} label={p.name} size={40} />
        <span className="cl-text">
          <span className="cl-name">{p.name}<span className={`pv-chip pv-chip-${c.tone}`}>{c.text}</span></span>
          <span className="cl-desc">{p.description}</span>
          <span className={`cl-cost ${p.perUse ? 'per-use' : ''}`}>{p.perUse && <b>Pay per use. </b>}{p.cost}</span>
        </span>
        <Icon name="down" size={14} className="pv-caret" />
      </button>
      {open && (
        <form className="cl-body" onSubmit={(e) => { e.preventDefault(); if (key.trim()) save() }}>
          <label className="cl-field" htmlFor={`cl-${p.id}`}><span>{p.keyLabel}{p.keyHint ? <span className="muted"> · {p.keyHint}</span> : null}</span></label>
          <div className="cl-row">
            <Secret id={`cl-${p.id}`} value={key} onChange={setKey} saved={p.saved} />
            <button type="submit" className="btn small primary" disabled={!key.trim() || !!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          </div>
          {p.ghLogin && cli?.signedIn && (
            <div className="cl-row">
              <span className="cl-or">or</span>
              <button type="button" className="btn small" onClick={useCli} disabled={!!busy} title="Reads the token from the GitHub CLI (gh auth token), only now">{busy === 'gh' ? 'Reading…' : 'Use my GitHub CLI sign-in'}</button>
            </div>
          )}
          {p.permissions && (
            <div>
              <span className="muted small">A fine-grained token needs:</span>
              <ul className="cl-perms">{p.permissions.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
          {p.github && (
            <div className="cl-field">
              <span>GitHub token <span className="muted">(optional) · lets Claude clone private repos and push its branch. Needs Contents: Read and write.</span></span>
              <div className="cl-row">
                <Secret value={gh} onChange={setGh} saved={p.github} placeholder="github_pat_..." />
                <button type="button" className="btn small" onClick={() => saveGithub(gh)} disabled={!gh.trim() || !!busy}>Save</button>
                {p.github.set && <button type="button" className="btn small" onClick={() => saveGithub('')} disabled={!!busy}>Remove token</button>}
              </div>
              {!p.github.set && p.github.copilot && <div className="cl-row"><span className="cl-or">or</span><button type="button" className="btn small" onClick={() => saveGithub('copilot')} disabled={!!busy}>Use the same token as GitHub Copilot</button></div>}
            </div>
          )}
          <div className="pv-actions">
            <a className="ghost-btn strong" href={p.keyUrl} target="_blank" rel="noreferrer"><Icon name="external" size={12} />Get a key</a>
            <span className="pv-spacer" />
            {msg && <span className={`pv-msg ${msg.ok ? 'ok' : 'bad'}`} role="status"><Icon name={msg.ok ? 'check' : 'alert'} size={12} />{msg.text}</span>}
            {p.saved && <button type="button" className="btn small" onClick={remove} disabled={!!busy}>{busy === 'remove' ? 'Removing…' : 'Remove'}</button>}
            {p.saved && <button type="button" className="btn small" onClick={test} disabled={!!busy}>{busy === 'test' ? 'Testing…' : 'Test'}</button>}
          </div>
          {p.error && p.status !== 'not set' && !msg && <p className="pv-note pv-err">{p.error}</p>}
        </form>
      )}
    </div>
  )
}

export default function CloudKeys({ focus }) {
  const ref = useRef(null)
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(null)
  const load = () => api('/cloud').then((d) => { setList(d.providers || []); setErr(null) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])
  useEffect(() => { if (focus === 'cloud' && list) setTimeout(() => ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120) }, [focus, !!list]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="pv-sec" id="pv-cloud" ref={ref}>
      <div className="pv-head">
        <h4>Cloud agents</h4>
        <span className="muted small">Agents that run on the provider's computers, on a repo it hosts. Start one from New agent › In the cloud.</span>
      </div>
      {err && <p className="pv-note pv-err">Couldn't load cloud agents: {err}</p>}
      {!list && !err && <div className="pv-agents pv-loading" aria-busy="true"><span className="pv-skel" /><span className="pv-skel" /></div>}
      {list && (
        <div className="cl-list">
          {list.map((p) => <Card key={p.id} p={p} open={open === p.id} onToggle={() => setOpen((o) => (o === p.id ? null : p.id))} onChange={load} />)}
        </div>
      )}
      <p className="pv-note">Keys stay on this computer, in your Bridge AI data folder (readable only by you). Bridge AI talks to the provider with your key; the agents it starts on this computer don't get these keys.</p>
    </section>
  )
}
