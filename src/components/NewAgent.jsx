import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted } from './layout.jsx'
import { tildePath } from './Rail.jsx'
import { api } from '../api.js'
import AgentMark from './settings/agentMark.jsx'
import { AccountPicker } from './AccountMenu.jsx'
import NewCloudAgent from './NewCloudAgent.jsx'

// Start any installed agent in a project folder (in an existing space or a new one), or as a
// plain chat with no project, like talking to Claude or Codex directly. Optionally with a first message.
// Or in the cloud: on Cursor, Copilot, Jules or Claude's computers, with your key (NewCloudAgent).
export default function NewAgent({ fleet, initial = {}, onClose, onLaunched, onAddAccount, onCloudSettings }) {
  const [kinds, setKinds] = useState(null)
  const [recent, setRecent] = usePersisted('cc-recent-dirs', [])
  const [kind, setKind] = usePersisted('cc-new-kind', 'claude')
  const [savedMode, saveMode] = usePersisted('cc-new-mode', 'project')
  const [mode, setModeNow] = useState(initial.mode || savedMode)
  const setMode = (m) => { setModeNow(m); saveMode(m) }
  const [cwd, setCwd] = useState(tildePath(initial.cwd) || recent[0] || '~/')
  const [space, setSpace] = useState(initial.workspaceId || '__new')
  const [spaceName, setSpaceName] = useState('')
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  // Compare: the same first message to a second agent, side by side.
  const [also, setAlso] = useState('')
  const [dirs, setDirs] = useState({ dirs: [], exists: true })
  const [showDirs, setShowDirs] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const dirRef = useRef(null)
  // Agents with more than one sign-in (Settings › Providers › Accounts): which one to use. Starts
  // at your choice for that agent (an account, or Auto), for this agent only.
  const [accts, setAccts] = useState([])
  const [account, setAccount] = useState({}) // kind -> 'auto' or an account id
  useEffect(() => { api('/accounts').then(setAccts).catch(() => {}) }, [])
  const group = accts.find((k) => k.kind === kind)
  const kindAccts = group?.accounts || []
  const pickedAccount = account[kind] || group?.setting
  // Own branch, for a folder in a git repo: off unless you turned it on there last time.
  const [repo, setRepo] = useState(null)
  const [own, setOwn] = useState(false)
  const [branch, setBranch] = useState('')
  const [base, setBase] = useState('')
  const [setup, setSetup] = useState('')
  const repoSeen = useRef(null)

  // Installed agents; if the last one you used isn't installed here, start from your default.
  useEffect(() => {
    Promise.all([api('/agent-kinds'), api('/config').catch(() => ({}))]).then(([ks, c]) => {
      setKinds(ks)
      if (!ks.some((k) => k.kind === kind)) setKind(ks.find((k) => k.kind === c.defaultAgent)?.kind || ks[0]?.kind || 'claude')
    }).catch(() => setKinds([{ kind: 'claude', label: 'Claude Code' }]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => api(`/dirs?q=${encodeURIComponent(cwd)}`).then(setDirs).catch(() => {}), 120)
    return () => clearTimeout(t)
  }, [cwd])
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const folderName = cwd.replace(/\/$/, '').split('/').pop() || 'agent'
  // The repo the folder is in, and the branch name a launch would use (a number added if taken).
  useEffect(() => {
    if (mode !== 'project') return
    const t = setTimeout(() => api(`/repo?dir=${encodeURIComponent(cwd)}&label=${encodeURIComponent(name || folderName)}&branch=${encodeURIComponent(branch)}`).then((r) => {
      setRepo(r.repo ? r : null)
      if (r.repo && r.repo !== repoSeen.current) { setOwn(r.own); setSetup(r.setup); setBase('') }
      repoSeen.current = r.repo
    }).catch(() => setRepo(null)), 250)
    return () => clearTimeout(t)
  }, [cwd, name, branch, mode, folderName])
  const ownOn = mode === 'project' && !!repo && own
  // Folders agents already work in (the repo, for one on its own branch), then ones you've launched into before.
  const suggestions = [...new Set([...recent, ...(fleet?.agents || []).filter((a) => !a.cloud).map((a) => tildePath(a.worktree?.repo || a.cwd))])].slice(0, 8)

  const launch = async (e) => {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'chat') {
        onLaunched(await api('/chats', { method: 'POST', body: { kind, prompt, account: pickedAccount } }))
        return
      }
      const out = await api('/agents/launch', { method: 'POST', body: {
        kind, cwd, label: name || folderName, prompt, account: pickedAccount,
        workspaceId: space === '__new' ? null : space,
        newSpace: space === '__new' ? (spaceName || name || folderName) : null,
        alsoKind: also && prompt.trim() ? also : undefined,
        ...(repo ? { remember: true, ownBranch: own, ...(own ? { branch: branch.trim() || undefined, base: base || undefined, setup } : {}) } : {}),
      } })
      const clean = tildePath(dirs.path || cwd).replace(/\/$/, '')
      setRecent([clean, ...recent.filter((r) => r !== clean)].slice(0, 8))
      if (out.setupError) window.alert(`The agent started, but the setup command failed:\n\n${out.setupError}`)
      onLaunched(out)
    } catch (x) { setError(x.message) } finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="modal new-agent" onSubmit={(e) => { if (mode === 'cloud') e.preventDefault(); else launch(e) }} role="dialog" aria-label={mode === 'chat' ? 'New chat' : mode === 'cloud' ? 'New cloud agent' : 'New agent'}>
        <header className="modal-head">
          <Icon name={mode === 'chat' ? 'chat' : mode === 'cloud' ? 'cloud' : 'bot'} size={16} />
          <h3>{mode === 'chat' ? 'New chat' : mode === 'cloud' ? 'New cloud agent' : 'New agent'}</h3>
          <button type="button" className="win-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button>
        </header>

        <div className="seg na-mode" role="radiogroup" aria-label="Kind of agent">
          <button type="button" role="radio" aria-checked={mode === 'project'} className={mode === 'project' ? 'on' : ''} onClick={() => setMode('project')}><Icon name="folder" size={13} /> In a project folder</button>
          <button type="button" role="radio" aria-checked={mode === 'chat'} className={mode === 'chat' ? 'on' : ''} onClick={() => setMode('chat')}><Icon name="chat" size={13} /> Plain chat</button>
          <button type="button" role="radio" aria-checked={mode === 'cloud'} className={mode === 'cloud' ? 'on' : ''} onClick={() => setMode('cloud')}><Icon name="cloud" size={13} /> In the cloud</button>
        </div>
        {mode === 'chat' && <p className="muted small na-hint">Just talk to the agent, like its own app: no project folder, saved in a "Chats" space.</p>}

        {mode === 'cloud' ? <NewCloudAgent onLaunched={onLaunched} onClose={onClose} onSettings={onCloudSettings} /> : <>

        <div className="na-field">
          <span className="na-label">Agent</span>
          <div className="na-kinds">
            {(kinds || [{ kind: 'claude', label: 'Claude Code' }]).map((k) => (
              <button type="button" key={k.kind} className={`na-kind ${kind === k.kind ? 'on' : ''}`} aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}><AgentMark kind={k.kind} label={k.label} size={20} />{k.label}</button>
            ))}
          </div>
        </div>

        {kindAccts.length > 1 && (
          <div className="na-field">
            <span className="na-label">Account</span>
            <AccountPicker group={group} value={pickedAccount} onChange={(id) => setAccount((m) => ({ ...m, [kind]: id }))} onAdd={onAddAccount} />
          </div>
        )}

        {mode === 'project' && <>
        <div className="na-field">
          <span className="na-label">Folder</span>
          <div className={`na-dir ${dirs.exists ? '' : 'bad'}`}>
            <Icon name="folder" size={13} />
            <input ref={dirRef} className="mono" value={cwd} onChange={(e) => { setCwd(e.target.value); setShowDirs(true) }}
              onFocus={() => setShowDirs(true)} onBlur={() => setTimeout(() => setShowDirs(false), 150)}
              onKeyDown={(e) => { if (e.key === 'Tab' && dirs.dirs[0] && showDirs) { e.preventDefault(); setCwd(dirs.dirs[0]) } }}
              spellCheck="false" autoCapitalize="off" autoCorrect="off" placeholder="~/code/…" />
            {showDirs && dirs.dirs.length > 0 && (
              <ul className="na-dirs" role="listbox">
                {dirs.dirs.map((d) => <li key={d}><button type="button" onMouseDown={(e) => { e.preventDefault(); setCwd(d); dirRef.current?.focus() }}>{d}</button></li>)}
              </ul>
            )}
          </div>
          {!dirs.exists && <span className="na-warn">That folder doesn't exist yet</span>}
          {suggestions.length > 0 && (
            <div className="na-recent">
              {suggestions.map((d) => <button type="button" key={d} className="fchip" onClick={() => setCwd(d)} title={d}>{d.split('/').pop()}</button>)}
            </div>
          )}
        </div>

        <div className="na-row">
          <label className="na-field">
            <span className="na-label">Space</span>
            <select value={space} onChange={(e) => setSpace(e.target.value)}>
              <option value="__new">New space…</option>
              {(fleet?.workspaces || []).map((w, i) => <option key={w.id} value={w.id}>{i + 1} · {w.label}</option>)}
            </select>
          </label>
          {space === '__new'
            ? <label className="na-field"><span className="na-label">Space name</span><input value={spaceName} onChange={(e) => setSpaceName(e.target.value)} placeholder={name || folderName} /></label>
            : <label className="na-field"><span className="na-label">Tab name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={folderName} /></label>}
        </div>
        {space === '__new' && (
          <label className="na-field"><span className="na-label">Tab name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={folderName} /></label>
        )}

        {repo && (
          <div className={`na-own ${own ? 'on' : ''}`}>
            <label className="na-check">
              <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
              <span><b>Own branch</b> <span className="muted">A new branch in its own copy of {repo.name}, so it can't clash with other agents</span></span>
            </label>
            {own && <>
              <div className="na-row">
                <label className="na-field">
                  <span className="na-label">Branch</span>
                  <input className="mono" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={repo.branch || 'bridge/…'} spellCheck="false" autoCapitalize="off" autoCorrect="off" />
                </label>
                <label className="na-field">
                  <span className="na-label">From</span>
                  <select value={base || repo.current || ''} onChange={(e) => setBase(e.target.value)}>
                    {!repo.current && <option value="">This commit</option>}
                    {[...new Set([repo.current, ...repo.branches].filter(Boolean))].map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </label>
              </div>
              {!repo.branch && <span className="na-warn">That can't be a branch name</span>}
              {repo.branch && branch.trim() && repo.branch !== branch.trim() && <span className="na-warn">{branch.trim()} exists, so it'll be {repo.branch}</span>}
              <label className="na-field">
                <span className="na-label">Setup command <i>optional, runs first, saved for this repo</i></span>
                <input className="mono" value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="e.g. npm install" spellCheck="false" autoCapitalize="off" autoCorrect="off" />
              </label>
              <span className="muted small">{repo.include ? 'Ignored files listed in .worktreeinclude (like .env) are copied in.' : 'To copy ignored files like .env, list them in .worktreeinclude.'} When you close the agent, its folder goes if nothing would be lost; the branch stays.</span>
            </>}
          </div>
        )}
        </>}

        <label className="na-field">
          <span className="na-label">First message <i>optional</i></span>
          <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={mode === 'chat' ? 'What do you want to talk about?' : 'e.g. /review, or describe the task'}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) launch(e) }} />
        </label>

        {mode === 'project' && (kinds || []).length > 1 && (
          <label className="na-field na-also">
            <span className="na-label">Compare with <i>optional</i></span>
            <select value={also} onChange={(e) => setAlso(e.target.value)} aria-label="Also run with">
              <option value="">No, just this agent</option>
              {(kinds || []).filter((k) => k.kind !== kind).map((k) => <option key={k.kind} value={k.kind}>{k.label}, same first message, side by side</option>)}
            </select>
            {also && !prompt.trim() && <span className="muted small">Write a first message to compare their answers.</span>}
          </label>
        )}

        {error && <p className="error-text">{error}</p>}
        <footer className="modal-foot">
          <span className="muted small hide-touch">⌘⏎ to start</span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || (mode === 'project' && !dirs.exists) || (ownOn && !repo.branch)}>{busy ? 'Starting…' : mode === 'chat' ? 'Start chat' : 'Start agent'}</button>
        </footer>
        </>}
      </form>
    </div>
  )
}
