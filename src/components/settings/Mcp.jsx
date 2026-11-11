import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, onThisComputer } from '../../api.js'
import { AgentIcon } from './ProviderIcon.jsx'
import { MCP_CATALOG, MCP_CATEGORIES } from './mcpCatalog.js'
import BridgeServer from './BridgeServer.jsx'
import { t, tn, tx } from '../../i18n/index.js'
import './mcp.css'

// Settings › MCP servers. One screen: what's installed across every agent, and an inline panel
// to add one (pick from popular servers, or enter your own). Env values go straight to the
// agents' configs and are never shown again; only their names come back.

const TRANSPORTS = [
  { id: 'stdio', name: tx('Local command') },
  { id: 'http', name: 'HTTP' },
  { id: 'sse', name: 'SSE' },
]
const isPlaceholder = (a) => /^<[^>]+>$/.test(a)
const scopeText = (a) => {
  if (a.scope === 'user') return t('all projects')
  const project = a.project?.split('/').pop() || ''
  return a.scope === 'local' ? t('local: {project}', { project }) : t('project: {project}', { project })
}

function Monogram({ name }) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return <span className="mcp-mono" style={{ '--h': h }} aria-hidden="true">{name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?'}</span>
}

function Agents({ list }) {
  return (
    <span className="mcp-agents">
      {list.map((a, i) => (
        <span key={`${a.kind}-${a.scope}-${a.project || ''}-${i}`} className={`mcp-agent ${a.scope !== 'user' ? 'scoped' : ''} ${a.disabled ? 'off' : ''}`}
          title={`${a.label}, ${scopeText(a)}${a.disabled ? ` ${t('(disabled)')}` : ''}${a.differs ? ` ${t('(set up differently)')}` : ''}\n${a.source}`}>
          <AgentIcon kind={a.kind} size={18} name={a.label} />
          {a.scope !== 'user' && <span className="mcp-scope">{a.scope === 'local' ? t('local') : t('proj')}</span>}
        </span>
      ))}
    </span>
  )
}

function Row({ s, agents, onAddMore, onRemoved }) {
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const ref = useRef(null)
  useEffect(() => {
    if (!menu) return
    const off = (e) => { if (!ref.current?.contains(e.target)) setMenu(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [menu])

  const userAgents = s.agents.filter((a) => a.scope === 'user')
  const scoped = s.agents.filter((a) => a.scope !== 'user')
  const have = new Set(userAgents.map((a) => a.kind))
  const canAddMore = agents.some((a) => !have.has(a.kind) && a.transports.includes(s.transport))
  const target = s.transport === 'stdio' ? [s.command, ...(s.args || [])].filter(Boolean).join(' ') : s.url

  const remove = async () => {
    setBusy(true)
    try {
      const r = await api(`/mcp/${encodeURIComponent(s.name)}?agents=${userAgents.map((a) => a.kind).join(',')}`, { method: 'DELETE' })
      setResult(r.results)
      setConfirm(false)
      if (r.results.some((x) => x.ok)) onRemoved()
    } catch (e) { setResult([{ kind: '', ok: false, error: e.message }]) }
    setBusy(false)
  }

  return (
    <li className="mcp-row">
      <div className="mcp-row-main">
        <Monogram name={s.name} />
        <div className="mcp-row-text">
          <div className="mcp-row-top">
            <span className="mcp-name">{s.name}</span>
            <span className="mcp-tag">{s.transport === 'stdio' ? t('local') : s.transport}</span>
            {s.agents.some((a) => a.differs) && <span className="mcp-tag warn" title={t('Agents have this name set up with different commands or URLs')}>{t('differs')}</span>}
          </div>
          <code className="mcp-target" title={target}>{target || t('(no command)')}</code>
          {(s.envKeys.length > 0 || s.headerKeys?.length > 0) && (
            <div className="mcp-keys">
              {s.envKeys.map((k) => <span key={k} className="mcp-key" title={t('Environment variable (value hidden)')}>{k}</span>)}
              {(s.headerKeys || []).map((k) => <span key={`h-${k}`} className="mcp-key hdr" title={t('HTTP header (value hidden)')}>{k}</span>)}
            </div>
          )}
        </div>
        <Agents list={s.agents} />
        <div className="mcp-menu-wrap" ref={ref}>
          <button type="button" className="icon-btn mcp-more" aria-label={t('Actions for {name}', { name: s.name })} aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name="more" size={16} /></button>
          {menu && (
            <div className="mcp-menu" role="menu">
              <button type="button" role="menuitem" disabled={!canAddMore} onClick={() => { setMenu(false); onAddMore(s) }}><Icon name="plus" size={13} />{t('Add to more agents')}</button>
              <button type="button" role="menuitem" className="danger" disabled={!userAgents.length} onClick={() => { setMenu(false); setConfirm(true); setResult(null) }}><Icon name="trash" size={13} />{t('Remove…')}</button>
            </div>
          )}
        </div>
      </div>
      {confirm && (
        <div className="mcp-confirm">
          <p>{tn('Remove {name} from {agents}?', { name: <b>{s.name}</b>, agents: userAgents.map((a) => a.label).join(', ') })}</p>
          {scoped.length > 0 && <p className="muted small">{t('Project copies stay: {copies}. Remove those in the project.', { copies: scoped.map((a) => `${a.label} (${scopeText(a)})`).join(', ') })}</p>}
          <div className="mcp-actions">
            <button type="button" className="btn small" onClick={() => setConfirm(false)} disabled={busy}>{t('Cancel')}</button>
            <button type="button" className="btn small mcp-danger" onClick={remove} disabled={busy}>{busy ? t('Removing…') : t('Remove')}</button>
          </div>
        </div>
      )}
      {result && <Results results={result} agents={agents} verb={t('Removed')} verbCli={t('Removed (with its CLI)')} onDismiss={() => setResult(null)} />}
    </li>
  )
}

// verb: what each agent's line says when it worked; verbCli: the same, done with the agent's own CLI.
function Results({ results, agents, verb, verbCli, onDismiss }) {
  const label = (r) => r.label || agents.find((a) => a.kind === r.kind)?.label || r.kind
  return (
    <ul className="mcp-results">
      {results.map((r, i) => (
        <li key={`${r.kind}-${i}`} className={r.ok ? 'ok' : 'bad'}>
          <Icon name={r.ok ? 'check' : 'alert'} size={13} />
          <span><b>{label(r)}</b> {r.ok ? r.note || (r.via === 'cli' ? verbCli : verb) : r.error}</span>
        </li>
      ))}
      {onDismiss && <li><button type="button" className="ghost-btn" onClick={onDismiss}>{t('Dismiss')}</button></li>}
    </ul>
  )
}

// The short form after picking a server: name, how to run it, env vars, which agents.
function ServerForm({ start, agents, onCancel, onDone }) {
  const [name, setName] = useState(start.name)
  const [transport, setTransport] = useState(start.transport)
  const [command, setCommand] = useState(start.command || '')
  const [args, setArgs] = useState((start.args || []).join('\n'))
  const [url, setUrl] = useState(start.url || '')
  const [env, setEnv] = useState(() => (start.env || []).map((e) => ({ key: e.key, value: '', hint: e.hint, fixed: true })))
  const supported = (a) => a.transports.includes(transport)
  const [picked, setPicked] = useState(() => new Set(agents.filter((a) => a.transports.includes(start.transport) && !start.have?.has(a.kind)).map((a) => a.kind)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)

  const argList = args.split('\n').map((a) => a.trim()).filter(Boolean)
  const kinds = [...picked].filter((k) => { const a = agents.find((x) => x.kind === k); return a && supported(a) && !start.have?.has(k) })
  const problem = !/^[A-Za-z0-9_.-]{1,64}$/.test(name) ? t('Name: letters, numbers, dots, dashes or underscores')
    : transport === 'stdio' && !command.trim() ? t('Enter the command')
    : transport === 'stdio' && argList.some(isPlaceholder) ? t('Replace {arg} in the arguments', { arg: argList.find(isPlaceholder) })
    : transport !== 'stdio' && !/^https?:\/\/\S+$/.test(url.trim()) ? t('Enter an http(s) URL')
    : env.some((e) => e.key && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.key)) ? t('Env var names: letters, numbers and _')
    : !kinds.length ? t('Pick at least one agent') : null

  const submit = async (e) => {
    e.preventDefault()
    if (problem) return
    setBusy(true); setError(null); setResults(null)
    try {
      const body = { name, transport, agents: kinds, env: Object.fromEntries(env.filter((x) => x.key && x.value).map((x) => [x.key, x.value])) }
      if (transport === 'stdio') Object.assign(body, { command: command.trim(), args: argList })
      else body.url = url.trim()
      const r = await api('/mcp', { method: 'POST', body })
      setResults(r.results)
      if (r.results.some((x) => x.ok)) onDone(r.results.every((x) => x.ok))
    } catch (err) { setError(err.message) }
    setBusy(false)
  }
  const toggle = (k) => setPicked((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  return (
    <form className="mcp-form" onSubmit={submit} autoComplete="off">
      <div className="mcp-form-head">
        {start.catalog ? <Monogram name={start.catalog.name} /> : <span className="mcp-mono custom"><Icon name="tool" size={15} /></span>}
        <div className="mcp-form-title">
          <b>{start.title}</b>
          {start.catalog?.auth && <span className="muted small">{start.catalog.auth}</span>}
          {start.catalog?.needs && <span className="muted small">{t('Needs {what}.', { what: start.catalog.needs })}</span>}
          {start.redacted && <span className="mcp-warn small">{t('Some arguments were hidden because they looked like secrets. Re-enter them.')}</span>}
          {start.headers?.length > 0 && <span className="mcp-warn small">{t("Headers ({names}) aren't copied. Add them in each agent's config, or sign in with OAuth if the server offers it.", { names: start.headers.join(', ') })}</span>}
        </div>
        {start.catalog?.docs && <a className="ghost-btn" href={start.catalog.docs} target="_blank" rel="noreferrer"><Icon name="external" size={12} />{t('Docs')}</a>}
      </div>

      <div className="mcp-fields">
        <label className="mcp-field">
          <span>{t('Name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} readOnly={!!start.have} spellCheck={false} />
        </label>
        <div className="mcp-field">
          <span>{t('Runs as')}</span>
          <div className="seg mcp-seg" role="radiogroup" aria-label={t('Transport')}>
            {TRANSPORTS.map((tr) => <button key={tr.id} type="button" role="radio" aria-checked={transport === tr.id} className={transport === tr.id ? 'on' : ''} disabled={!!start.have} onClick={() => setTransport(tr.id)}>{t(tr.name)}</button>)}
          </div>
        </div>
        {transport === 'stdio' ? (
          <>
            <label className="mcp-field">
              <span>{t('Command')}</span>
              <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" spellCheck={false} className="mono" />
            </label>
            <label className="mcp-field wide">
              <span>{t('Arguments')} <small className="muted">{t('one per line')}</small></span>
              <textarea value={args} onChange={(e) => setArgs(e.target.value)} rows={Math.min(7, Math.max(2, argList.length + 1))} spellCheck={false} className="mono" placeholder={'-y\n@scope/server-name'} />
            </label>
          </>
        ) : (
          <label className="mcp-field wide">
            <span>URL</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" spellCheck={false} className="mono" inputMode="url" />
          </label>
        )}
      </div>

      <div className="mcp-env">
        <div className="mcp-sub">{t('Environment variables')} {transport !== 'stdio' && <small className="muted">{t('(local commands only for some agents)')}</small>}</div>
        {env.map((v, i) => (
          <div className="mcp-env-row" key={i}>
            <input className="mono" value={v.key} readOnly={v.fixed} onChange={(e) => setEnv((l) => l.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} placeholder="NAME" spellCheck={false} aria-label={t('Variable name')} />
            <input type="password" value={v.value} onChange={(e) => setEnv((l) => l.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={v.hint || t('value')} aria-label={v.key ? t('Value for {name}', { name: v.key }) : t('Value for variable')} autoComplete="new-password" />
            <button type="button" className="icon-btn" aria-label={t('Remove variable')} onClick={() => setEnv((l) => l.filter((_, j) => j !== i))}><Icon name="x" size={13} /></button>
          </div>
        ))}
        <button type="button" className="ghost-btn mcp-env-add" onClick={() => setEnv((l) => [...l, { key: '', value: '' }])}><Icon name="plus" size={12} />{t('Add variable')}</button>
      </div>

      <div className="mcp-pick">
        <div className="mcp-sub">{t('Add to')}</div>
        {!agents.length && <p className="muted small">{t('No agent that Bridge can configure is installed.')}</p>}
        <div className="mcp-pick-grid">
          {agents.map((a) => {
            const already = start.have?.has(a.kind)
            const ok = supported(a) && !already
            return (
              <label key={a.kind} className={`mcp-check ${ok ? '' : 'dim'}`} title={already ? t('Already has it') : !supported(a) ? t("{agent} can't use {transport} servers", { agent: a.label, transport: transport.toUpperCase() }) : a.method === 'cli' ? t('Uses its CLI {file}', { file: a.file }) : t('Edits {file}', { file: a.file })}>
                <input type="checkbox" checked={ok && picked.has(a.kind)} disabled={!ok} onChange={() => toggle(a.kind)} />
                <AgentIcon kind={a.kind} size={18} name={a.label} />
                <span>{a.label}</span>
                {already && <small className="muted">{t('has it')}</small>}
              </label>
            )
          })}
        </div>
      </div>

      {error && <p className="mcp-error"><Icon name="alert" size={13} />{error}</p>}
      {results && <Results results={results} agents={agents} verb={t('Added')} verbCli={t('Added (with its CLI)')} />}
      <div className="mcp-actions">
        {problem && <span className="muted small mcp-problem">{problem}</span>}
        <button type="button" className="btn small" onClick={onCancel}>{results?.some((r) => r.ok) ? t('Close') : t('Cancel')}</button>
        <button type="submit" className="btn small primary" disabled={!!problem || busy || (results?.length > 0 && results.every((r) => r.ok))}>{busy ? t('Adding…') : t('Add')}</button>
      </div>
    </form>
  )
}

function AddPanel({ start, agents, installedNames, onClose, onAdded }) {
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState(start)
  useEffect(() => setChosen(start), [start])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return MCP_CATALOG.filter((c) => !s || `${c.name} ${c.blurb} ${c.id} ${c.category || ''}`.toLowerCase().includes(s))
  }, [q])
  // Cards grouped under small headings, in MCP_CATEGORIES order; anything uncategorised goes last.
  const groups = useMemo(() => {
    const order = [...MCP_CATEGORIES, ...new Set(list.map((c) => c.category || 'Other').filter((k) => !MCP_CATEGORIES.includes(k)))]
    return order.map((cat) => [cat, list.filter((c) => (c.category || 'Other') === cat)]).filter(([, l]) => l.length)
  }, [list])
  const pick = (c) => setChosen(c
    ? { key: c.id, title: c.name, catalog: c, name: c.id, transport: c.transport, command: c.command, args: c.args, url: c.url, env: c.env }
    : { key: 'custom', title: t('Custom server'), name: '', transport: 'stdio', command: '', args: [], url: '', env: [] })

  return (
    <div className="mcp-add">
      <div className="mcp-add-head">
        {chosen && !chosen.have ? <button type="button" className="ghost-btn" onClick={() => setChosen(null)}><Icon name="chevron" size={12} className="mcp-back" />{t('All servers')}</button> : <b>{chosen?.have ? t('Add to more agents') : t('Add a server')}</b>}
        <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      {chosen ? (
        <ServerForm key={chosen.key} start={chosen} agents={agents} onCancel={onClose} onDone={onAdded} />
      ) : (
        <>
          <label className="mcp-search">
            <Icon name="search" size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search popular servers')} autoFocus aria-label={t('Search servers')} />
          </label>
          <div className="mcp-grid">
            {groups.map(([cat, items]) => [
              <div key={`h-${cat}`} className="mcp-sub" role="heading" aria-level={5} style={{ gridColumn: '1 / -1', margin: '6px 0 0' }}>{t(cat)}</div>,
              ...items.map((c) => (
                <button key={c.id} type="button" className="mcp-card" onClick={() => pick(c)}>
                  <Monogram name={c.name} />
                  <span className="mcp-card-text">
                    <span className="mcp-card-name">{c.name}{installedNames.has(c.id) && <span className="mcp-tag good">{t('added')}</span>}</span>
                    <span className="mcp-card-desc">{c.blurb}</span>
                  </span>
                </button>
              )),
            ])}
            <div className="mcp-sub" role="heading" aria-level={5} style={{ gridColumn: '1 / -1', margin: '6px 0 0' }}>{t('Something else')}</div>
            <button type="button" className="mcp-card custom" onClick={() => pick(null)}>
              <span className="mcp-mono custom"><Icon name="plus" size={15} /></span>
              <span className="mcp-card-text">
                <span className="mcp-card-name">{t('Custom')}</span>
                <span className="mcp-card-desc">{t('Any server: a command to run, or a URL.')}</span>
              </span>
            </button>
          </div>
          {!list.length && <p className="muted small">{t('Nothing matches. Use Custom to add it by hand.')}</p>}
        </>
      )}
    </div>
  )
}

export default function Mcp() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(null) // null | { start }
  const load = async () => {
    try { setData(await api('/mcp')); setError(null) } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  const agents = data?.agents || []
  const servers = data?.servers || []
  const names = new Set(servers.map((s) => s.name))
  const counts = { n: servers.length, m: agents.length }
  const addMore = (s) => setAdding({
    start: {
      key: `more-${s.name}`, title: s.name, name: s.name, transport: s.transport, command: s.command, args: s.args, url: s.url,
      env: s.envKeys.map((k) => ({ key: k, hint: t('value (stored only in the agent configs)') })), redacted: s.redacted, headers: s.headerKeys,
      have: new Set(s.agents.filter((a) => a.scope === 'user').map((a) => a.kind)),
    },
  })

  return (
    <div className="mcp">
      <BridgeServer here={onThisComputer()} />
      <div className="mcp-intro">
        <p className="muted small" title={t("Tools your agents can call: browsers, GitHub, docs search, databases and more. Servers added here go to each agent's own config, for all projects.")}>{t("Tools your agents can call, added to each agent's own config for all projects.")}</p>
        {!adding && <button type="button" className="btn small primary" onClick={() => setAdding({ start: null })} disabled={!data}><Icon name="plus" size={13} />{t('Add server')}</button>}
      </div>

      {adding && (
        <AddPanel start={adding.start} agents={agents} installedNames={names} onClose={() => setAdding(null)} onAdded={() => load()} />
      )}

      <section className="mcp-sec">
        <div className="mcp-sec-head">
          <h4>{t('Installed')}</h4>
          {data && <span className="muted small">{servers.length === 1
            ? (agents.length === 1 ? t('{n} server across {m} agent', counts) : t('{n} server across {m} agents', counts))
            : (agents.length === 1 ? t('{n} servers across {m} agent', counts) : t('{n} servers across {m} agents', counts))}</span>}
          <button type="button" className="ghost-btn mcp-refresh" onClick={load} aria-label={t('Refresh')}><Icon name="refresh" size={12} /></button>
        </div>

        {error && (
          <div className="mcp-empty bad">
            <Icon name="alert" size={16} />
            <div><b>{t("Couldn't read your agents' MCP settings.")}</b><p className="muted small">{t('{error}. Check that Bridge AI is running, then try again.', { error })}</p></div>
            <button type="button" className="btn small" onClick={load}>{t('Retry')}</button>
          </div>
        )}
        {!data && !error && <div className="mcp-skel" aria-label={t('Loading')} />}
        {data && agents.map((a) => a.error && <p key={a.kind} className="mcp-error"><Icon name="alert" size={13} />{a.label}: {a.error}</p>)}
        {data && !agents.length && (
          <div className="mcp-empty">
            <Icon name="bot" size={16} />
            <div><b>{t('No agent that uses MCP is installed.')}</b><p className="muted small">{t('Install Claude Code, Codex, Gemini CLI, Cursor Agent, OpenCode or another agent CLI, then come back here.')}</p></div>
          </div>
        )}
        {data && agents.length > 0 && !servers.length && (
          <div className="mcp-empty">
            <Icon name="tool" size={16} />
            <div><b>{t('No MCP servers yet.')}</b><p className="muted small">{t('Add one to give your agents new tools, like a browser (Playwright) or your issue tracker.')}</p></div>
            {!adding && <button type="button" className="btn small" onClick={() => setAdding({ start: null })}>{t('Browse servers')}</button>}
          </div>
        )}
        {servers.length > 0 && (
          <ul className="mcp-list">
            {servers.map((s) => <Row key={s.name} s={s} agents={agents} onAddMore={addMore} onRemoved={load} />)}
          </ul>
        )}
        {data?.unsupported?.length > 0 && (
          <p className="muted small mcp-foot">{t('Not managed here yet: {agents}. Set those up in their own config.', { agents: data.unsupported.map((a) => a.label).join(', ') })}</p>
        )}
      </section>
    </div>
  )
}
