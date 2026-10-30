// Settings › Providers: which agents are signed in, and the model providers Bridge AI can hand
// keys for. Cards in a grid by group; clicking one opens its editor in place.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, refetch, settingsChanged } from '../../api.js'
import Icon from '../Icon.jsx'
import { AllowKeychain, Left, nameOf, makeDefault, removeAccount, signOut, DefaultTag, weekResets } from '../AccountMenu.jsx'
import { t } from '../../i18n/index.js'
import { addAccount } from '../AddAccount.jsx'
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

// Auto: new agents start on whichever account has the most left at the time. Turned off, your
// default is the one Auto had picked, until you make another one default.
function AutoRow({ k, onChange }) {
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const on = k.setting === 'auto'
  const pick = k.accounts.find((a) => a.id === k.pick)
  const use = async (want) => {
    setErr(null); setBusy(true)
    try { await makeDefault(k.kind, want ? 'auto' : k.pick || k.accounts[0].id); onChange() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="pv-acct-autorow">
      <label className="pv-acct-auto-toggle">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => use(e.target.checked)} />
        <span>{t('Auto: start new agents on the one with the most left')}{on && pick ? <span className="muted"> · {t('now {name}', { name: nameOf(pick) })}</span> : null}</span>
      </label>
      {err && <span className="pv-msg bad" role="status"><Icon name="alert" size={12} />{err}</span>}
    </div>
  )
}

// One account: its name (the pencil renames it, your usual login too), whether it's signed in, how
// much of each window is left and when the week starts again, and what you can do: Make default,
// Sign in (again), Sign out, Remove, and move it up or down the list (every list of accounts
// follows this order). auto: Auto is on (its pick gets the auto tag, no row the star). only: the
// one listed, which stays. onMove(-1 | 1): up or down; null at that end.
function AccountRow({ a, kind, auto, only, onChange, onUp, onDown }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(a.named === false ? '' : a.label)
  const act = async (what) => {
    setBusy(what); setErr(null)
    try {
      if (what === 'default') await makeDefault(kind, a.id)
      if (what === 'login') { addAccount(kind, { id: a.id, kind, label: nameOf(a) }); return }
      if (what === 'logout' && !(await signOut(kind, a))) return
      if (what === 'remove' && !(await removeAccount(kind, a))) return
      if (what === 'rename') { await api(`/accounts/${a.id}`, { method: 'PATCH', body: { label: name } }); refetch('/quota'); setRenaming(false) }
      onChange()
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  const plan = a.statusPlan || a.plan
  const chip = a.signedIn ? { tone: 'good', text: plan ? t('Signed in · {plan}', { plan }) : t('Signed in') } : a.signedIn === false ? { tone: 'off', text: t('Not signed in') } : { tone: 'unknown', text: t('Unknown') }
  const isDefault = a.active && !auto
  const shown = nameOf(a)
  const under = [a.isDefault && (a.named !== false || a.account?.email) && t('your usual login'), weekResets(a)].filter(Boolean).join(' · ')
  return (
    <li className={`pv-acct ${isDefault ? 'on' : ''}`}>
      {renaming
        ? <form className="pv-acct-rename" onSubmit={(e) => { e.preventDefault(); act('rename') }}>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={40} aria-label={t('Account name')} placeholder={a.isDefault ? t('Your usual login') : undefined} />
            <button className="btn small" type="submit" disabled={!!busy}>{t('Save')}</button>
            <button className="ghost-btn" type="button" onClick={() => { setRenaming(false); setName(a.named === false ? '' : a.label) }}>{t('Cancel')}</button>
          </form>
        : <span className="pv-acct-name">
            <span className="pv-acct-title">
              <span className="pv-acct-label">{shown}</span>
              <button type="button" className="ghost-btn pv-acct-edit" onClick={() => setRenaming(true)} aria-label={t('Rename {name}', { name: shown })} title={t('Rename')}><Icon name="edit" size={11} /></button>
              {isDefault && <DefaultTag />}{auto && a.active && <span className="best-tag" title={t('Auto starts new agents here now: it has the most left')}>{t('auto')}</span>}
            </span>
            {under && <small className="muted">{under}</small>}
          </span>}
      <span className="pv-acct-state"><Chip tone={chip.tone}>{chip.text}</Chip></span>
      <span className="pv-acct-left">{a.signedIn !== false && <Left a={a} />}</span>
      <span className="pv-acct-acts">
        {!isDefault && <button type="button" className="btn small" onClick={() => act('default')} disabled={!!busy} title={t('New agents start on {name}', { name: shown })}><Icon name="star" size={11} />{t('Make default')}</button>}
        <button type="button" className="btn small" onClick={() => act('login')} disabled={!!busy} title={t("Runs the agent's own sign-in for this account, in a terminal tab you can follow")}>
          {a.signedIn ? t('Sign in again') : t('Sign in')}
        </button>
        {a.signedIn !== false && <button type="button" className="ghost-btn" onClick={() => act('logout')} disabled={!!busy} title={a.isDefault ? t('Signs the agent itself out on this computer, in the terminal too') : t("Signs it out. It stays here, to sign in again.")}>{busy === 'logout' ? t('Signing out…') : t('Sign out')}</button>}
        <span className="pv-acct-move">
          <button type="button" className="ghost-btn" onClick={onUp} disabled={!onUp || !!busy} aria-label={t('Move {name} up', { name: shown })} title={t('Up the list (the top bar lists them in this order)')}><Icon name="up" size={12} /></button>
          <button type="button" className="ghost-btn" onClick={onDown} disabled={!onDown || !!busy} aria-label={t('Move {name} down', { name: shown })} title={t('Down the list')}><Icon name="down" size={12} /></button>
        </span>
        <button type="button" className="ghost-btn pv-acct-remove" onClick={() => act('remove')} disabled={!!busy || only} aria-label={t('Remove {name}', { name: shown })}
          title={only ? t("It's your only account here, so it stays. Add another one first.") : a.isDefault ? t("Takes it off Bridge AI's list. Nothing is signed out.") : t('Signs it out and removes it')}><Icon name="trash" size={12} /></button>
      </span>
      {err && <span className="pv-msg bad pv-acct-err" role="status"><Icon name="alert" size={12} />{err}</span>}
      {a.allow && <span className="pv-acct-err"><AllowKeychain id={a.id} onDone={onChange} /></span>}
    </li>
  )
}

function AccountsSection({ focus, ready }) {
  const ref = useRef(null)
  const [kinds, setKinds] = useState(null)
  const [err, setErr] = useState(null)
  // Only the newest check counts: one that started before a Remove can answer after it.
  const seq = useRef(0)
  const load = useCallback((refresh) => {
    const n = ++seq.current
    return api(`/accounts${refresh ? '?refresh=1' : ''}`).then((d) => { if (n === seq.current) { setKinds(d); setErr(null) } }).catch((e) => { if (n === seq.current) setErr(e.message) })
  }, [])
  useEffect(() => { load() }, [load])
  // Signing in happens in a terminal; check again when you come back to this window, and when
  // the Add another account dialog (or Usage, or the top bar) changes something.
  useEffect(() => {
    const f = () => load(true)
    window.addEventListener('focus', f)
    window.addEventListener('bridge-accounts-changed', f)
    return () => { window.removeEventListener('focus', f); window.removeEventListener('bridge-accounts-changed', f) }
  }, [load])
  // Opened from Add account: scroll here once this list and the agents above it are in.
  const shown = !!kinds && ready
  useEffect(() => { if (focus === 'accounts' && shown) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [focus, shown])
  const [showErr, setShowErr] = useState(null)
  const showUsual = async (kind) => {
    setShowErr(null)
    try { await api(`/accounts/show/${kind}`, { method: 'POST' }); refetch('/quota'); window.dispatchEvent(new CustomEvent('bridge-accounts-changed', { detail: {} })) } catch (e) { setShowErr(e.message) }
  }
  // Up or down the list: the new order is kept, and every list of accounts shows it.
  const move = async (k, i, by) => {
    const ids = k.accounts.map((a) => a.id)
    ;[ids[i], ids[i + by]] = [ids[i + by], ids[i]]
    setKinds((all) => all.map((x) => (x.kind === k.kind ? { ...x, accounts: ids.map((id) => x.accounts.find((a) => a.id === id)) } : x)))
    try { await api(`/accounts/order/${k.kind}`, { method: 'POST', body: { ids } }); refetch('/quota') } catch (e) { setShowErr(e.message); load(true) }
  }
  if (err) return <p className="pv-note pv-err">Couldn't load accounts: {err}</p>
  const list = (kinds || []).filter((k) => k.installed)
  if (!list.length) return null
  return (
    <section className="pv-sec" id="pv-accounts" ref={ref}>
      <div className="pv-head">
        <h4>{t('Accounts')}</h4>
        <span className="muted small">{t('Your sign-ins for each agent, each with its own name. New agents start on your default (the star), or with Auto on, on the one with the most left.')}</span>
        <button type="button" className="ghost-btn pv-head-btn" onClick={() => load(true)} aria-label={t('Check accounts again')}><Icon name="refresh" size={12} />{t('Recheck')}</button>
      </div>
      {list.map((k) => (
        <div key={k.kind} className="pv-acct-group">
          <div className="pv-acct-kind"><AgentIcon kind={k.kind} size={20} name={k.label} /><b>{k.label}</b></div>
          {k.accounts.length > 1 && <AutoRow k={k} onChange={() => load(true)} />}
          <ul className="pv-accts">
            {k.accounts.map((a, i) => <AccountRow key={a.id} a={a} kind={k.kind} auto={k.setting === 'auto' && k.accounts.length > 1} only={k.accounts.length < 2} onChange={() => load(true)}
              onUp={i > 0 ? () => move(k, i, -1) : null} onDown={i < k.accounts.length - 1 ? () => move(k, i, 1) : null} />)}
          </ul>
          <div className="pv-acct-more">
            <button type="button" className="ghost-btn pv-more" onClick={() => addAccount(k.kind)}><Icon name="plus" size={12} />{t('Add another {agent} account', { agent: k.label })}</button>
            {k.usualHidden && <button type="button" className="ghost-btn pv-more" onClick={() => showUsual(k.kind)} title={t('Puts your usual {agent} login back on this list', { agent: k.label })}><Icon name="eye" size={12} />{t('Show your usual login')}</button>}
          </div>
          {showErr && <p className="pv-msg bad" role="status"><Icon name="alert" size={12} />{showErr}</p>}
        </div>
      ))}
      <p className="pv-note">{t("Sign in uses whichever account your browser is signed in to, so switch accounts there first (or open the link it prints in a private window). Each account keeps only its own login; settings, skills and session history are shared with your usual setup, so cost and token history in Usage covers every account together. Removing your usual login only takes it off this list: the agent stays signed in to it for the terminal. Agents already running keep the account they started with; the model chip in an agent's message box can continue its conversation on another account.")}</p>
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
        onSaved(next)
        setMsg(!next.test ? { ok: true, text: 'Saved' } : next.test.ok ? { ok: true, text: 'Saved. The key works.' } : { ok: false, text: `Saved, but ${p.name} turned it down: ${next.test.message}` })
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
        {p.keyUrl && <a className="ghost-btn strong" href={p.keyUrl} target="_blank" rel="noreferrer">
          <Icon name="external" size={12} />{p.local ? 'Download' : p.group === 'clouds' ? 'Open console' : 'Get a key'}
        </a>}
        <span className="pv-spacer" />
        {msg && <span className={`pv-msg ${msg.ok ? 'ok' : 'bad'}`} role="status"><Icon name={msg.ok ? 'check' : 'alert'} size={12} />{msg.text}</span>}
        {anySaved && <button type="button" className="btn small" onClick={() => act('remove')} disabled={!!busy}>{busy === 'remove' ? 'Removing…' : 'Remove'}</button>}
        {p.testable && <button type="button" className="btn small" onClick={() => act('test')} disabled={!!busy}>{busy === 'test' ? 'Testing…' : 'Test'}</button>}
        <button type="submit" className="btn small primary" disabled={!dirty || !!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
      </div>

      <p className="pv-note">
        {p.chat && <><b>Chat with it now:</b> New chat, then Any model. </>}
        {can.length
          ? <>Your <b>{can.map(name).join(', ')}</b> can use it too{other.length ? <span className="muted">; so can {other.map(name).join(', ')} if you install them</span> : null}.</>
          : p.agents.length ? <>Agents that can use it: {p.agents.map(name).join(', ')} (none installed yet).</> : null}
        {!p.local && <> Keys saved here reach the agents Bridge AI starts; agents you start in your own terminal won't see them.</>}
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

export default function Providers({ focus }) {
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
  // More models (server/labs.js): off to start with.
  const [more, setMore] = useState(null)
  useEffect(() => { api('/settings').then((s) => setMore(s.effective?.moreModels === true)).catch(() => {}) }, [])
  const showMore = async (on) => {
    setMore(on)
    try { await api('/settings', { method: 'PATCH', body: { moreModels: on } }); settingsChanged(); await Promise.all([loadProviders(), loadSubs(true)]) } catch (e) { setMore(!on); setErr(e.message) }
  }

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
      <AccountsSection focus={focus} ready={!!subs || !!subsErr} />
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
                {g.id === 'labs' && more != null && (
                  <div className="pv-extra">
                    <label className="ph-check small"><input type="checkbox" checked={more} onChange={(e) => showMore(e.target.checked)} /><span>Show more models (Qwen Code, DeepSeek, Kimi, GLM)</span></label>
                    <p className="muted small">{more ? 'They show as agents, providers and models you can pick.' : 'Off: they\'re left out of the agents, providers and models you can pick, and keys saved for them aren\'t used.'}</p>
                  </div>
                )}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
