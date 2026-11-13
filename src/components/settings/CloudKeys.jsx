// Settings › Model Providers › Cloud Agents: a key for each provider that runs agents in its own
// cloud (Cursor, GitHub Copilot, Jules, Claude Managed Agents). Add, test and remove; the server
// keeps them in the data folder and only ever says whether one is saved and its last 4 characters.
// In the phone apps' Cloud agents (cloudOnly) the app keeps them instead, and says no more.
import { useEffect, useRef, useState } from 'react'
import { api, cloudOnly, keyStore } from '../../api.js'
import Icon from '../Icon.jsx'
import { CloudMark } from '../cloudBits.jsx'
import { t } from '../../i18n/index.js'
import '../cloud.css'
import './providers.css'

function Secret({ id, value, onChange, saved, placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div className="pv-secret">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={saved?.set ? (saved.last4 ? t('Saved, ends in {last4}', { last4: saved.last4 }) : t('Saved')) : placeholder || t('Paste key')}
        autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" />
      <button type="button" className="pv-eye" onClick={() => setShow((v) => !v)} aria-label={show ? t('Hide') : t('Show')} title={show ? t('Hide') : t('Show')}>
        <Icon name={show ? 'eye-off' : 'eye'} size={14} />
      </button>
    </div>
  )
}

function chip(p) {
  if (p.status === 'connected') return { tone: 'good', text: p.account ? t('Connected · {account}', { account: p.account }) : t('Connected') }
  if (p.status === 'rejected') return { tone: 'warn', text: t('Key rejected') }
  return { tone: 'off', text: t('Not set') }
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
      if (r?.test) setMsg({ ok: r.test.ok, text: r.test.ok ? t('Saved. {message}', { message: r.test.message }) : t('Saved, but the test failed: {message}', { message: r.test.message }) })
      else if (r && 'ok' in r && 'message' in r) setMsg({ ok: r.ok, text: r.message })
      setKey(''); setGh('')
      onChange()
    } catch (e) { setMsg({ ok: false, text: e.message }) } finally { setBusy(null) }
  }
  const save = () => act('save', () => api(`/cloud/keys/${p.id}`, { method: 'PUT', body: { key } }))
  const test = () => act('test', () => api(`/cloud/keys/${p.id}/test`, { method: 'POST' }))
  const remove = () => {
    const vars = { n: p.agents, name: p.name }
    const what = cloudOnly
      ? (p.agents === 1 ? t('This phone stops following its {n} cloud agent and forgets it. It keeps running at {name}.', vars) : t('This phone stops following its {n} cloud agents and forgets them. They keep running at {name}.', vars))
      : (p.agents === 1 ? t('Its {n} cloud agent leaves the sidebar until you add a key again. It keeps running at {name}.', vars) : t('Its {n} cloud agents leave the sidebar until you add a key again. They keep running at {name}.', vars))
    const ask = `${cloudOnly ? t('Remove your {name} key from this phone?', vars) : t('Remove your {name} key from Bridge AI?', vars)}${p.agents ? `\n\n${what}` : ''}`
    if (!window.confirm(ask)) return
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
          <span className={`cl-cost ${p.perUse ? 'per-use' : ''}`}>{p.perUse && <b>{t('Pay per use.')} </b>}{p.cost}</span>
        </span>
        <Icon name="down" size={14} className="pv-caret" />
      </button>
      {open && (
        <form className="cl-body" onSubmit={(e) => { e.preventDefault(); if (key.trim()) save() }}>
          <label className="cl-field" htmlFor={`cl-${p.id}`}><span>{p.keyLabel}{p.keyHint ? <span className="muted"> · {p.keyHint}</span> : null}</span></label>
          <div className="cl-row">
            <Secret id={`cl-${p.id}`} value={key} onChange={setKey} saved={p.saved} />
            <button type="submit" className="btn small primary" disabled={!key.trim() || !!busy}>{busy === 'save' ? t('Saving…') : t('Save')}</button>
          </div>
          {p.ghLogin && cli?.signedIn && (
            <div className="cl-row">
              <span className="cl-or">{t('or')}</span>
              <button type="button" className="btn small" onClick={useCli} disabled={!!busy} title={t('Reads the token from the GitHub CLI ({command}), only now', { command: 'gh auth token' })}>{busy === 'gh' ? t('Reading…') : t('Use my GitHub CLI sign-in')}</button>
            </div>
          )}
          {p.permissions && (
            <div>
              <span className="muted small">{t('A fine-grained token needs:')}</span>
              <ul className="cl-perms">{p.permissions.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
          {p.github && (
            <div className="cl-field">
              <span>{t('GitHub token')} <span className="muted">{t('(optional) · lets Claude clone private repos and push its branch. Needs Contents: Read and write.')}</span></span>
              <div className="cl-row">
                <Secret value={gh} onChange={setGh} saved={p.github} placeholder="github_pat_..." />
                <button type="button" className="btn small" onClick={() => saveGithub(gh)} disabled={!gh.trim() || !!busy}>{t('Save')}</button>
                {p.github.set && <button type="button" className="btn small" onClick={() => saveGithub('')} disabled={!!busy}>{t('Remove token')}</button>}
              </div>
              {!p.github.set && p.github.copilot && <div className="cl-row"><span className="cl-or">{t('or')}</span><button type="button" className="btn small" onClick={() => saveGithub('copilot')} disabled={!!busy}>{t('Use the same token as GitHub Copilot')}</button></div>}
            </div>
          )}
          <div className="pv-actions">
            <a className="ghost-btn strong" href={p.keyUrl} target="_blank" rel="noreferrer"><Icon name="external" size={12} />{t('Get a key')}</a>
            <span className="pv-spacer" />
            {msg && <span className={`pv-msg ${msg.ok ? 'ok' : 'bad'}`} role="status"><Icon name={msg.ok ? 'check' : 'alert'} size={12} />{msg.text}</span>}
            {p.saved && <button type="button" className="btn small" onClick={remove} disabled={!!busy}>{busy === 'remove' ? t('Removing…') : t('Remove')}</button>}
            {p.saved && <button type="button" className="btn small" onClick={test} disabled={!!busy}>{busy === 'test' ? t('Testing…') : t('Test')}</button>}
          </div>
          {p.error && p.status !== 'not set' && !msg && <p className="pv-note pv-err">{p.error}</p>}
        </form>
      )}
    </div>
  )
}

// bare: just the providers, under a heading of the caller's (the phone's first screen).
// onChange: after a key is saved or removed.
export default function CloudKeys({ focus, bare = false, onChange }) {
  const ref = useRef(null)
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(null)
  const load = () => api('/cloud').then((d) => { setList(d.providers || []); setErr(null); onChange?.(d) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])
  useEffect(() => { if (focus === 'cloud' && list) setTimeout(() => ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120) }, [focus, !!list]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className={`pv-sec ${bare ? 'bare' : ''}`} id="pv-cloud" data-setting="cloud" ref={ref}>
      {!bare && (
        <div className="pv-head">
          <h4>{t('Cloud Agents')}</h4>
          <span className="muted small">{t("Agents that run on the provider's computers, on a repo it hosts. Start one from {where}.", { where: cloudOnly ? t('New cloud agent') : `${t('New agent')} › ${t('In the cloud')}` })}</span>
        </div>
      )}
      {err && <p className="pv-note pv-err">{t("Couldn't load cloud agents: {error}", { error: err })} <button type="button" className="ghost-btn" onClick={load}>{t('Retry')}</button></p>}
      {!list && !err && <div className="pv-agents pv-loading" aria-busy="true"><span className="pv-skel" /><span className="pv-skel" /></div>}
      {list && (
        <div className="cl-list">
          {list.map((p) => <Card key={p.id} p={p} open={open === p.id} onToggle={() => setOpen((o) => (o === p.id ? null : p.id))} onChange={load} />)}
        </div>
      )}
      {cloudOnly
        ? <p className="pv-note">{t('Keys stay on this phone, in {store}, and go only to their own provider: the app adds the key to each request itself. Bridge AI on a computer keeps keys of its own.', { store: keyStore })}</p>
        : <p className="pv-note" title={t("Keys stay on this computer, in your Bridge AI data folder (readable only by you). Bridge AI talks to the provider with your key; the agents it starts on this computer don't get these keys.")}>{t('Keys stay on this computer, readable only by you, and go only to their own provider.')}</p>}
    </section>
  )
}
