// Settings › Providers: which agents are signed in, and the model providers Bridge AI can hand
// keys for. Cards in a grid by group; clicking one opens its editor in place.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api.js'
import Icon from '../Icon.jsx'
import ProviderIcon, { AgentIcon } from './ProviderIcon.jsx'
import { GROUPS, AGENT_LABEL, providerChip, agentChip } from './providerCatalog.js'
import './providers.css'

function Chip({ tone, children, title }) {
  return <span className={`pv-chip pv-chip-${tone}`} title={title}>{children}</span>
}

function AgentsStrip({ subs, error, onRefresh, refreshing }) {
  const [showAll, setShowAll] = useState(false)
  if (error) return <p className="pv-note pv-err">Couldn't check agent sign-ins: {error}</p>
  if (!subs) return <div className="pv-agents pv-loading" aria-busy="true"><span className="pv-skel" /><span className="pv-skel" /><span className="pv-skel" /></div>
  const inst = subs.filter((s) => s.installed)
  const list = showAll ? subs : inst
  return (
    <section className="pv-sec">
      <div className="pv-head">
        <h4>Your agents</h4>
        <span className="muted small">{inst.length ? `${inst.filter((s) => s.signedIn).length} of ${inst.length} installed signed in` : 'No agent CLIs found on your PATH'}</span>
        <button type="button" className="ghost-btn pv-head-btn" onClick={onRefresh} disabled={refreshing} aria-label="Check sign-ins again">
          <Icon name="refresh" size={12} className={refreshing ? 'spin' : ''} />Recheck
        </button>
      </div>
      <ul className="pv-agents">
        {list.map((s) => {
          const c = agentChip(s)
          return (
            <li key={s.kind} className={`pv-agent ${s.installed ? '' : 'pv-dim'}`}>
              <AgentIcon kind={s.kind} size={26} name={s.label} />
              <div className="pv-agent-text">
                <span className="pv-agent-name">{s.label}</span>
                {s.installed
                  ? <Chip tone={c.tone} title={s.signedIn === null ? "Bridge AI couldn't tell from this computer's files" : undefined}>{c.text}</Chip>
                  : <span className="muted small">Not installed</span>}
                {s.installed && s.signedIn !== true && s.hint && <span className="pv-hint">{s.hint}</span>}
              </div>
            </li>
          )
        })}
      </ul>
      {subs.length > inst.length && (
        <button type="button" className="ghost-btn pv-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show installed only' : `Show all ${subs.length} agents`}
        </button>
      )}
    </section>
  )
}

function SecretInput({ field, value, onChange, id }) {
  const [show, setShow] = useState(false)
  const saved = field.saved?.set
  const placeholder = saved ? (field.saved.last4 ? `Saved, ends in ${field.saved.last4}` : 'Saved') : field.environment ? 'Set in the environment' : (field.placeholder || 'Paste key')
  return (
    <div className="pv-secret">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" />
      <button type="button" className="pv-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide' : 'Show'} title={show ? 'Hide' : 'Show'}>
        <Icon name={show ? 'eye-off' : 'eye'} size={14} />
      </button>
    </div>
  )
}

function Editor({ p, labels, installedSet, onSaved }) {
  const initial = useMemo(() => Object.fromEntries(p.fields.map((f) => [f.env, f.type === 'secret' ? '' : f.type === 'flag' ? !!f.saved?.set : (f.saved?.value || '')])), [p])
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  useEffect(() => setDraft(initial), [initial])

  const changes = Object.fromEntries(p.fields.flatMap((f) => {
    const v = draft[f.env]
    if (f.type === 'secret') return v ? [[f.env, v]] : []
    return v !== initial[f.env] ? [[f.env, f.type === 'flag' ? (v ? '1' : '') : v]] : []
  }))
  const dirty = Object.keys(changes).length > 0
  const anySaved = p.fields.some((f) => f.saved?.set)

  const act = async (kind) => {
    setBusy(kind); setMsg(null)
    try {
      if (kind === 'save') {
        const next = await api(`/providers/${p.id}`, { method: 'PUT', body: { values: changes } })
        onSaved(next); setMsg({ ok: true, text: 'Saved' })
      } else if (kind === 'remove') {
        const next = await api(`/providers/${p.id}`, { method: 'DELETE' })
        onSaved(next); setMsg({ ok: true, text: 'Removed from Bridge AI' })
      } else {
        if (dirty) { const next = await api(`/providers/${p.id}`, { method: 'PUT', body: { values: changes } }); onSaved(next) }
        const r = await api(`/providers/${p.id}/test`, { method: 'POST' })
        setMsg({ ok: r.ok, text: r.message })
      }
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally { setBusy(null) }
  }

  const can = p.agents.filter((k) => installedSet.has(k))
  const other = p.agents.filter((k) => !installedSet.has(k))
  const name = (k) => labels[k] || AGENT_LABEL[k] || k

  return (
    <form className="pv-editor" onSubmit={(e) => { e.preventDefault(); if (dirty) act('save') }}>
      <div className="pv-fields">
        {p.fields.map((f) => {
          const id = `pv-${p.id}-${f.env}`
          if (f.type === 'flag') {
            return (
              <label key={f.env} className="pv-flag">
                <input type="checkbox" checked={!!draft[f.env]} onChange={(e) => setDraft((d) => ({ ...d, [f.env]: e.target.checked }))} />
                <span>{f.label}</span>
                <code>{f.env}=1</code>
                {f.environment && !f.saved && <span className="muted small">set in the environment</span>}
              </label>
            )
          }
          return (
            <div key={f.env} className="pv-field">
              <label htmlFor={id}>
                <span>{f.label}{f.optional && <span className="muted"> (optional)</span>}</span>
                <code>{f.env}</code>
              </label>
              {f.type === 'secret'
                ? <SecretInput id={id} field={f} value={draft[f.env]} onChange={(v) => setDraft((d) => ({ ...d, [f.env]: v }))} />
                : <input id={id} value={draft[f.env]} onChange={(e) => setDraft((d) => ({ ...d, [f.env]: e.target.value }))}
                    placeholder={f.environment && !f.saved ? 'Set in the environment' : f.placeholder} spellCheck={false} autoComplete="off" />}
            </div>
          )
        })}
      </div>

      {p.models?.length > 0 && (
        <div className="pv-models">
          <span className="muted small">Models</span>
          <div>{p.models.slice(0, 12).map((m) => <code key={m}>{m}</code>)}{p.models.length > 12 && <span className="muted small"> and {p.models.length - 12} others</span>}</div>
        </div>
      )}

      <div className="pv-actions">
        <a className="ghost-btn strong" href={p.keyUrl} target="_blank" rel="noreferrer">
          <Icon name="external" size={12} />{p.local ? 'Download' : p.group === 'clouds' ? 'Open console' : 'Get a key'}
        </a>
        <span className="pv-spacer" />
        {msg && <span className={`pv-msg ${msg.ok ? 'ok' : 'bad'}`} role="status"><Icon name={msg.ok ? 'check' : 'alert'} size={12} />{msg.text}</span>}
        {anySaved && <button type="button" className="btn small" onClick={() => act('remove')} disabled={!!busy}>{busy === 'remove' ? 'Removing…' : 'Remove'}</button>}
        {p.testable && <button type="button" className="btn small" onClick={() => act('test')} disabled={!!busy}>{busy === 'test' ? 'Testing…' : 'Test'}</button>}
        <button type="submit" className="btn small primary" disabled={!dirty || !!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
      </div>

      <p className="pv-note">
        {can.length
          ? <>Usable by your <b>{can.map(name).join(', ')}</b>{other.length ? <span className="muted">; also {other.map(name).join(', ')} if installed</span> : null}.</>
          : <>Usable by {p.agents.map(name).join(', ')}. None of them are installed yet.</>}
        {!p.local && <> Keys saved here go to agents Bridge AI starts itself (built-in runtime); agents you start in your own terminal won't see them.</>}
      </p>
    </form>
  )
}

function Card({ p, open, onToggle, children }) {
  const c = providerChip(p)
  return (
    <div className={`pv-card ${open ? 'open' : ''} ${p.status === 'connected' ? 'on' : ''}`}>
      <button type="button" className="pv-card-main" onClick={onToggle} aria-expanded={open}>
        <ProviderIcon id={p.id} name={p.name} size={44} />
        <span className="pv-card-text">
          <span className="pv-name">{p.name}</span>
          <span className="pv-desc">{p.description}</span>
          <span className="pv-status">
            <Chip tone={c.tone}>{c.text}</Chip>
            {c.sub && <span className="pv-sub">{c.sub}</span>}
          </span>
        </span>
        <Icon name="down" size={14} className="pv-caret" />
      </button>
      {open && children}
    </div>
  )
}

export default function Providers() {
  const [providers, setProviders] = useState(null)
  const [subs, setSubs] = useState(null)
  const [err, setErr] = useState(null)
  const [subsErr, setSubsErr] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(null)

  const loadProviders = useCallback(() => api('/providers').then((d) => { setProviders(d.providers); setErr(null) }).catch((e) => setErr(e.message)), [])
  const loadSubs = useCallback((refresh) => {
    setRefreshing(true)
    return api(`/subscriptions${refresh ? '?refresh=1' : ''}`).then((d) => { setSubs(d); setSubsErr(null) }).catch((e) => setSubsErr(e.message)).finally(() => setRefreshing(false))
  }, [])
  useEffect(() => { loadProviders(); loadSubs() }, [loadProviders, loadSubs])

  const labels = useMemo(() => Object.fromEntries((subs || []).map((s) => [s.kind, s.label])), [subs])
  const installedSet = useMemo(() => new Set((subs || []).filter((s) => s.installed).map((s) => s.kind)), [subs])
  const onSaved = (next) => { setProviders((list) => list.map((p) => (p.id === next.id ? next : p))); loadSubs(true) }
  const connected = providers?.filter((p) => p.status === 'connected').length || 0

  return (
    <div className="pv">
      <p className="pv-intro muted small">
        Sign in to an agent with its own subscription, or add API keys for the providers below. Keys are stored
        on this computer in your Bridge AI data folder (readable only by you) and handed to the agents Bridge AI starts.
      </p>

      <AgentsStrip subs={subs} error={subsErr} onRefresh={() => loadSubs(true)} refreshing={refreshing} />

      {err && <p className="pv-note pv-err">Couldn't load providers: {err} <button type="button" className="ghost-btn" onClick={loadProviders}>Retry</button></p>}
      {!providers && !err && <div className="pv-grid" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="pv-card pv-skel-card" />)}</div>}

      {providers && (
        <>
          <p className="pv-count muted small">{connected} of {providers.length} providers connected</p>
          {GROUPS.map((g) => {
            const items = providers.filter((p) => p.group === g.id)
            if (!items.length) return null
            return (
              <section key={g.id} className="pv-sec">
                <h4 className="pv-group">{g.name}</h4>
                <div className="pv-grid">
                  {items.map((p) => (
                    <Card key={p.id} p={p} open={open === p.id} onToggle={() => setOpen((o) => (o === p.id ? null : p.id))}>
                      <Editor p={p} labels={labels} installedSet={installedSet} onSaved={onSaved} />
                    </Card>
                  ))}
                </div>
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
