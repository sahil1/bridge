// Settings › Providers: which agents are signed in, and the model providers Bridge AI can hand
// keys for. Cards in a grid by group; clicking one opens its editor in place.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, refetch } from '../../api.js'
import Icon from '../Icon.jsx'
import { AllowKeychain, leftOf, level } from '../AccountMenu.jsx'
import ProviderIcon, { AgentIcon } from './ProviderIcon.jsx'
import { GROUPS, AGENT_LABEL, providerChip, agentChip } from './providerCatalog.js'
import CloudKeys from './CloudKeys.jsx'
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

// Auto: new agents start on whichever account has the most left at the time.
function AutoRow({ k, onChange }) {
  const [err, setErr] = useState(null)
  const on = k.setting === 'auto'
  const pick = k.accounts.find((a) => a.id === k.pick)
  const use = async () => {
    setErr(null)
    try { await api(`/accounts/active/${k.kind}`, { method: 'POST', body: { id: 'auto' } }); refetch('/quota'); onChange() } catch (e) { setErr(e.message) }
  }
  return (
    <li className={`pv-acct ${on ? 'on' : ''}`}>
      <label className="pv-acct-use" title="New agents start on the account with the most left">
        <input type="radio" name={`acct-${k.kind}`} checked={on} onChange={use} />
      </label>
      <span className="pv-acct-name">Auto</span>
      <span className="muted small">The account with the most left{pick ? `, now ${pick.label}` : ''}</span>
      {err && <span className="pv-msg bad" role="status"><Icon name="alert" size={12} />{err}</span>}
    </li>
  )
}

// More than one sign-in per agent (work and personal, say). The active one is used by new agents.
function AccountRow({ a, kind, setting, pick, onChange, onOpenAgent }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(a.label)
  const act = async (what) => {
    setBusy(what); setErr(null)
    try {
      if (what === 'use') { await api(`/accounts/active/${kind}`, { method: 'POST', body: { id: a.id } }); refetch('/quota') }
      if (what === 'login') { const r = await api(`/accounts/${a.id}/login`, { method: 'POST' }); onOpenAgent?.(r.openId || r.paneId) }
      if (what === 'remove') { if (!window.confirm(`Sign out of ${a.label} and remove it from Bridge AI?`)) return; await api(`/accounts/${a.id}`, { method: 'DELETE' }) }
      if (what === 'rename') { await api(`/accounts/${a.id}`, { method: 'PATCH', body: { label: name } }); setRenaming(false) }
      onChange()
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  const plan = a.statusPlan || a.plan
  const chip = a.signedIn ? { tone: 'good', text: plan ? `Signed in · ${plan}` : 'Signed in' } : a.signedIn === false ? { tone: 'off', text: 'Not signed in' } : { tone: 'unknown', text: 'Unknown' }
  const on = setting === a.id
  const left = leftOf(a)
  return (
    <li className={`pv-acct ${on ? 'on' : ''}`}>
      <label className="pv-acct-use" title={on ? 'New agents use this account' : 'Use this account for new agents'}>
        <input type="radio" name={`acct-${kind}`} checked={on} onChange={() => act('use')} disabled={!!busy} />
      </label>
      {renaming
        ? <form className="pv-acct-rename" onSubmit={(e) => { e.preventDefault(); act('rename') }}>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={40} aria-label="Account name" />
            <button className="btn small" type="submit" disabled={!!busy}>Save</button>
            <button className="ghost-btn" type="button" onClick={() => { setRenaming(false); setName(a.label) }}>Cancel</button>
          </form>
        : <span className="pv-acct-name">{a.label}{a.isDefault && <span className="muted small"> (your usual login)</span>}</span>}
      <Chip tone={chip.tone}>{chip.text}</Chip>
      {left && <span className={`small t-${level(left.pct)}`} title="Left of the tighter of its 5-hour and weekly windows">{left.pct}% left <span className="muted">{left.win}</span></span>}
      {setting === 'auto' && pick === a.id && <span className="best-tag">auto</span>}
      <span className="pv-spacer" />
      {err && <span className="pv-msg bad" role="status"><Icon name="alert" size={12} />{err}</span>}
      <button type="button" className="btn small" onClick={() => act('login')} disabled={!!busy} title="Opens the sign-in flow in a terminal tab (Setup space)">
        {busy === 'login' ? 'Opening…' : a.signedIn ? 'Sign in again' : 'Sign in'}
      </button>
      {!a.isDefault && !renaming && <button type="button" className="ghost-btn" onClick={() => setRenaming(true)} aria-label={`Rename ${a.label}`} title="Rename"><Icon name="edit" size={12} /></button>}
      {!a.isDefault && <button type="button" className="ghost-btn" onClick={() => act('remove')} disabled={!!busy} aria-label={`Remove ${a.label}`} title="Sign out and remove"><Icon name="trash" size={12} /></button>}
      {a.allow && <AllowKeychain id={a.id} onDone={onChange} />}
    </li>
  )
}

function AccountsSection({ onOpenAgent, focus, ready }) {
  const ref = useRef(null)
  const [kinds, setKinds] = useState(null)
  const [err, setErr] = useState(null)
  const [adding, setAdding] = useState(null) // kind
  const [label, setLabel] = useState('')
  const [addErr, setAddErr] = useState(null)
  const load = useCallback((refresh) => api(`/accounts${refresh ? '?refresh=1' : ''}`).then((d) => { setKinds(d); setErr(null) }).catch((e) => setErr(e.message)), [])
  useEffect(() => { load() }, [load])
  // Signing in happens in a terminal; check again when you come back to this window.
  useEffect(() => { const f = () => load(true); window.addEventListener('focus', f); return () => window.removeEventListener('focus', f) }, [load])
  // Opened from Add account: scroll here once this list and the agents above it are in.
  const shown = !!kinds && ready
  useEffect(() => { if (focus === 'accounts' && shown) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [focus, shown])
  const add = async (kind) => {
    setAddErr(null)
    try {
      const a = await api('/accounts', { method: 'POST', body: { kind, label } })
      setAdding(null); setLabel('')
      await load()
      const r = await api(`/accounts/${a.id}/login`, { method: 'POST' })
      onOpenAgent?.(r.openId || r.paneId)
    } catch (e) { setAddErr(e.message) }
  }
  if (err) return <p className="pv-note pv-err">Couldn't load accounts: {err}</p>
  const list = (kinds || []).filter((k) => k.installed)
  if (!list.length) return null
  return (
    <section className="pv-sec" id="pv-accounts" ref={ref}>
      <div className="pv-head">
        <h4>Accounts</h4>
        <span className="muted small">Several sign-ins per agent, like work and personal. New agents use the one you pick, or Auto picks the one with the most left.</span>
        <button type="button" className="ghost-btn pv-head-btn" onClick={() => load(true)} aria-label="Check accounts again"><Icon name="refresh" size={12} />Recheck</button>
      </div>
      {list.map((k) => (
        <div key={k.kind} className="pv-acct-group">
          <div className="pv-acct-kind"><AgentIcon kind={k.kind} size={20} name={k.label} /><b>{k.label}</b></div>
          <ul className="pv-accts">
            {k.accounts.length > 1 && <AutoRow k={k} onChange={() => load(true)} />}
            {k.accounts.map((a) => <AccountRow key={a.id} a={a} kind={k.kind} setting={k.setting} pick={k.pick} onChange={() => load(true)} onOpenAgent={onOpenAgent} />)}
          </ul>
          {adding === k.kind
            ? <form className="pv-acct-add" onSubmit={(e) => { e.preventDefault(); add(k.kind) }}>
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name it, like Work or Personal" autoFocus maxLength={40} aria-label="Account name" />
                <button className="btn small primary" type="submit" disabled={!label.trim()}>Add and sign in</button>
                <button className="ghost-btn" type="button" onClick={() => { setAdding(null); setAddErr(null) }}>Cancel</button>
                {addErr && <span className="pv-msg bad" role="status"><Icon name="alert" size={12} />{addErr}</span>}
              </form>
            : <button type="button" className="ghost-btn pv-more" onClick={() => { setAdding(k.kind); setLabel('') }}><Icon name="plus" size={12} />Add {k.label} account</button>}
        </div>
      ))}
      <p className="pv-note">Sign in uses whichever account your browser is signed in to, so switch accounts there first (or open the link it prints in a private window). Each account keeps only its own login; settings, skills and session history are shared with your usual setup, so cost and token history in Usage covers every account together. Agents already running keep the account they started with; the ⋯ menu on a Claude or Codex agent can continue its conversation on another account.</p>
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

export default function Providers({ onOpenAgent, focus }) {
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
      <AccountsSection onOpenAgent={onOpenAgent} focus={focus} ready={!!subs || !!subsErr} />
      <CloudKeys focus={focus} />

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
