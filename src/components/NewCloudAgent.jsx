// New agent › In the cloud: pick a provider you've added a key for, a repo and a branch, and say
// what to do. With no keys yet, it says what this is and leads to Settings.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted } from './layout.jsx'
import { api, cloudOnly } from '../api.js'
import { CloudMark } from './cloudBits.jsx'

// A text box with suggestions under it (typed text always counts, so any repo or branch works).
function Pick({ value, onChange, options, placeholder, label, note, onOpen }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const q = value.trim().toLowerCase()
  const shown = options.filter((o) => !q || o.value.toLowerCase().includes(q)).slice(0, 40)
  useEffect(() => { setSel(0) }, [q])
  return (
    <div className="na-pick">
      <input className="mono" value={value} placeholder={placeholder} aria-label={label} spellCheck="false" autoCapitalize="off" autoCorrect="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true) }} onFocus={() => { setOpen(true); onOpen?.() }} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !shown.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, shown.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)) }
          if ((e.key === 'Enter' || e.key === 'Tab') && shown[sel] && shown[sel].value !== value) { e.preventDefault(); onChange(shown[sel].value); setOpen(false) }
          if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
        }} />
      {open && shown.length > 0 && (
        <ul className="na-pick-list" role="listbox">
          {shown.map((o, i) => (
            <li key={o.value}><button type="button" className={i === sel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setOpen(false) }}>{o.value}{o.note && <small>{o.note}</small>}</button></li>
          ))}
        </ul>
      )}
      {note && <span className="na-pick-note">{note}</span>}
    </div>
  )
}

export default function NewCloudAgent({ onLaunched, onClose, onSettings }) {
  const [providers, setProviders] = useState(null)
  const [pick, setPick] = usePersisted('cc-cloud-provider', null)
  const [recent, setRecent] = usePersisted('cc-cloud-recent', {}) // provider -> repos you used
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('')
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [planFirst, setPlanFirst] = useState(false)
  const [repos, setRepos] = useState({ list: [], loading: false, error: null })
  const [branches, setBranches] = useState([])
  const [models, setModels] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const asked = useRef({})

  useEffect(() => { api('/cloud').then((d) => setProviders(d.providers || [])).catch((e) => { setProviders([]); setError(e.message) }) }, [])
  const ready = (providers || []).filter((p) => p.saved?.set)
  const p = ready.find((x) => x.id === pick) || ready[0] || null
  useEffect(() => { setRepo(recent[p?.id]?.[0] || ''); setBranch(''); setModel(''); setBranches([]); setModels([]) }, [p?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Your repos, once per provider (listing is slow, and limited on some).
  const loadRepos = () => {
    if (!p || asked.current[p.id]) return
    asked.current[p.id] = true
    setRepos({ list: [], loading: true, error: null })
    api(`/cloud/${p.id}/repos`).then((r) => setRepos({ list: r.repos || [], loading: false, error: r.error || null }), (e) => setRepos({ list: [], loading: false, error: e.message }))
  }
  useEffect(() => { if (p) { asked.current = {}; loadRepos() } }, [p?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!p || !/^[\w.-]+\/[\w.-]+$|^https?:\/\//.test(repo.trim())) { setBranches([]); return }
    const t = setTimeout(() => api(`/cloud/${p.id}/branches?repo=${encodeURIComponent(repo.trim())}`).then((r) => setBranches(r.branches || []), () => setBranches([])), 350)
    return () => clearTimeout(t)
  }, [p?.id, repo])
  const loadModels = () => { if (p?.models && !models.length) api(`/cloud/${p.id}/models`).then((r) => setModels(r.models || []), () => {}) }

  const launch = async () => {
    if (!p || busy) return
    setBusy(true)
    setError(null)
    try {
      const out = await api('/cloud/launch', { method: 'POST', body: { provider: p.id, repo: repo.trim(), branch: branch.trim(), prompt, model: model.trim() || undefined, approvePlan: planFirst || undefined } })
      const r = repo.trim()
      if (r) setRecent((m) => ({ ...m, [p.id]: [r, ...(m[p.id] || []).filter((x) => x !== r)].slice(0, 8) }))
      onLaunched(out)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (!providers) return <div className="skeleton-rows pad"><div /><div /></div>
  if (!ready.length) {
    return (
      <>
        <div className="na-cloud-empty">
          <p>Run an agent on Cursor, GitHub Copilot, Jules or Claude's computers, on a repo they host. {cloudOnly ? 'You follow it here, with no computer of yours on.' : 'It keeps going while this computer sleeps, and you follow it here and on your phone.'}</p>
          <p>Add your key for one of them first. It stays on this {cloudOnly ? 'phone' : 'computer'}.</p>
          <button type="button" className="btn primary" onClick={onSettings}><Icon name="settings" size={13} /> Set up cloud agents</button>
        </div>
        {error && <p className="error-text">{error}</p>}
        <footer className="modal-foot"><button type="button" className="btn" onClick={onClose}>Cancel</button></footer>
      </>
    )
  }

  const repoOptions = [...new Set([...(recent[p.id] || []), ...repos.list.map((r) => r.name)])].map((name) => {
    const r = repos.list.find((x) => x.name === name)
    return { value: name, note: r ? [r.private ? 'private' : '', r.defaultBranch || ''].filter(Boolean).join(' · ') : 'recent' }
  })
  const defBranch = repos.list.find((x) => x.name === repo.trim())?.defaultBranch
  return (
    <>
      <div className="na-field">
        <span className="na-label">Provider</span>
        <div className="na-kinds">
          {ready.map((x) => (
            <button type="button" key={x.id} className={`na-kind ${p.id === x.id ? 'on' : ''}`} aria-pressed={p.id === x.id} onClick={() => setPick(x.id)}>
              <CloudMark provider={x.id} label={x.name} size={20} />{x.name}
            </button>
          ))}
          <button type="button" className="na-kind" onClick={onSettings} title="Add or change keys in Settings"><Icon name="plus" size={14} /> Add</button>
        </div>
        <span className={`na-cost ${p.perUse ? 'per-use' : ''}`}>{p.perUse && <b>Pay per use. </b>}{p.cost}</span>
      </div>

      <div className="na-row na-cloud-row">
        <label className="na-field">
          <span className="na-label">Repository</span>
          <Pick value={repo} onChange={setRepo} options={repoOptions} placeholder={p.repoPlaceholder || 'owner/repo'} label="Repository" onOpen={loadRepos}
            note={repos.loading ? 'Loading your repos…' : repos.error ? `Couldn't list repos (${repos.error}). Type one.` : p.hosts ? `On ${p.hosts}` : null} />
        </label>
        <label className="na-field">
          <span className="na-label">Branch <i>optional</i></span>
          <Pick value={branch} onChange={setBranch} options={branches.map((b) => ({ value: b, note: b === defBranch ? 'default' : '' }))} placeholder={defBranch || branches[0] || 'default branch'} label="Branch" />
        </label>
      </div>

      {p.models && (
        <label className="na-field">
          <span className="na-label">Model <i>optional</i></span>
          <Pick value={model} onChange={setModel} options={models.map((m) => ({ value: m.id, note: m.label !== m.id ? m.label : '' }))} placeholder="The provider's default" label="Model" onOpen={loadModels} />
        </label>
      )}

      <label className="na-field">
        <span className="na-label">What should it do?</span>
        <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Add tests for the login flow and fix anything they catch"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); launch() } }} />
      </label>

      {p.id === 'jules' && (
        <label className="na-check"><input type="checkbox" checked={planFirst} onChange={(e) => setPlanFirst(e.target.checked)} /><span>Show me the plan first <span className="muted">Jules waits for your OK before it starts</span></span></label>
      )}
      {p.id === 'copilot' && <p className="muted small na-hint">Bridge AI opens an issue in the repo with this task and assigns it to Copilot, which works in a draft pull request.</p>}
      {p.id === 'claude' && !p.github?.set && <p className="muted small na-hint">Without a GitHub token Claude can only read public repos, and can't push its branch. <button type="button" className="link-btn" onClick={onSettings}>Add one in Settings</button></p>}

      {error && <p className="error-text">{error}</p>}
      <footer className="modal-foot">
        <span className="muted small hide-touch">⌘⏎ to start</span>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" onClick={launch} disabled={busy || !prompt.trim() || !repo.trim()}>{busy ? 'Starting…' : `Start on ${p.name}`}</button>
      </footer>
    </>
  )
}
