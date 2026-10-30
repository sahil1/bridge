import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted } from './layout.jsx'
import { tildePath } from './Rail.jsx'
import { api, cloudOnly } from '../api.js'
import PermissionFix, { protectedFolder } from './PermissionFix.jsx'
import { InstallAgentButton, openSettings } from './SignIn.jsx'
import AgentMark from './settings/agentMark.jsx'
import { AccountPicker, nameOf } from './AccountMenu.jsx'
import NewCloudAgent from './NewCloudAgent.jsx'
import { t } from '../i18n/index.js'

// Start any installed agent in a project folder (in an existing space or a new one), or as a
// plain chat with no project, like talking to Claude or Codex directly. Optionally with a first message.
// Or in the cloud: on Cursor, Copilot, Jules or Claude's computers, with your key (NewCloudAgent).
export default function NewAgent({ fleet, initial = {}, onClose, onLaunched, onAddAccount, onCloudSettings }) {
  const [kinds, setKinds] = useState(null)
  const [recent, setRecent] = usePersisted('cc-recent-dirs', [])
  const [kind, setKind] = usePersisted('cc-new-kind', 'claude')
  const [savedMode, saveMode] = usePersisted('cc-new-mode', 'project')
  // The phone's Cloud agents start cloud agents only.
  const [mode, setModeNow] = useState(cloudOnly ? 'cloud' : initial.mode || savedMode)
  const setMode = (m) => { setModeNow(m); saveMode(m) }
  const [cwd, setCwd] = useState(tildePath(initial.cwd) || recent[0] || '~/')
  const [space, setSpace] = useState(initial.workspaceId || '__new')
  const [spaceName, setSpaceName] = useState('')
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  // Compare: the same first message to a second agent, side by side.
  const [also, setAlso] = useState('')
  const [dirs, setDirs] = useState({ dirs: [], exists: true })
  const [dirsVer, setDirsVer] = useState(0) // look at the folder again (after Allow access)
  const [showDirs, setShowDirs] = useState(false)
  const [placeOpen, setPlaceOpen] = useState(false) // where it goes in the sidebar: shown as one line until you change it
  const pickFolder = window.bridgeApp?.pickFolder
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [errorCode, setErrorCode] = useState(null)
  const dirRef = useRef(null)
  // Agents with more than one sign-in (Settings › Providers › Accounts): which one to use. Starts
  // at your choice for that agent (an account, or Auto), for this agent only.
  const [accts, setAccts] = useState([])
  const [account, setAccount] = useState(initial.kind && initial.account ? { [initial.kind]: initial.account } : {}) // kind -> 'auto' or an account id
  useEffect(() => { if (initial.kind) setKind(initial.kind) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // An account added meanwhile (Add another account, over this dialog): list it, and once it's
  // signed in, start on it.
  useEffect(() => {
    const load = (e) => {
      api('/accounts').then(setAccts).catch(() => {})
      const d = e?.detail
      if (d?.ready && d.kind && d.id) { setKind(d.kind); setAccount((m) => ({ ...m, [d.kind]: d.id })) }
    }
    load()
    window.addEventListener('bridge-accounts-changed', load)
    return () => window.removeEventListener('bridge-accounts-changed', load)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Any model (Bridge AI's own chat, kind 'chat'): nothing to install. In a project folder it reads
  // and changes files and runs commands, asking first, through models that can use tools (an API
  // key or a model on this computer; a sign-in's models work through their own agent instead).
  const ANY = { kind: 'chat', label: t('Any model') }
  const shown = [...(kinds || []), ANY]
  const none = mode !== 'chat' && !!kinds && !kinds.length && kind !== 'chat' // no agent installed here yet
  const [chatModels, setChatModels] = useState(null) // { models, runtime }
  const [chatModel, setChatModel] = usePersisted('cc-chat-model', '')
  const loadModels = (fresh) => api(`/chat/models${fresh ? '?refresh=1' : ''}`).then(setChatModels).catch(() => setChatModels({ models: [], runtime: null }))
  useEffect(() => { if (kind === 'chat' && !chatModels) loadModels() }, [mode, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  // To a project folder with nothing installed: installing an agent comes first, and Any model is
  // the link under it (it stays picked when you pick it there).
  const anyHere = useRef(false)
  const pickKind = (k) => { if (mode === 'project') anyHere.current = k === 'chat'; setKind(k) }
  useEffect(() => { if (mode === 'project' && kinds && !kinds.length && kind === 'chat' && !anyHere.current) setKind('claude') }, [mode, kinds]) // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing installed: a chat can still be with any model.
  useEffect(() => { if (mode === 'chat' && kinds && !kinds.length && kind !== 'chat') setKind('chat') }, [mode, kinds]) // eslint-disable-line react-hooks/exhaustive-deps
  const modelList = (chatModels?.models || []).filter((m) => mode === 'chat' || m.via !== 'sign-in')
  const pickedModel = modelList.some((m) => m.id === chatModel) ? chatModel : modelList[0]?.id || ''
  const anyBlocked = kind === 'chat' && (!chatModels || !modelList.length)
  const reloadKinds = () => api('/agent-kinds').then((ks) => { setKinds(ks); if (ks.length && !ks.some((k) => k.kind === kind)) setKind(ks[0].kind) }).catch(() => {})
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
      if (kind !== 'chat' && !ks.some((k) => k.kind === kind)) setKind(ks.find((k) => k.kind === c.defaultAgent)?.kind || ks[0]?.kind || 'claude')
    }).catch(() => setKinds([{ kind: 'claude', label: 'Claude Code' }]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => api(`/dirs?q=${encodeURIComponent(cwd)}`).then(setDirs).catch(() => {}), 120)
    return () => clearTimeout(t)
  }, [cwd, dirsVer])
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
  // Not the chief of staff's or the chats' folders: those are Bridge AI's own.
  const suggestions = [...new Set([...recent, ...(fleet?.agents || []).filter((a) => !a.cloud && !a.chief && !a.plainChat).map((a) => tildePath(a.worktree?.repo || a.cwd))])].slice(0, 8)

  const launch = async (e) => {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'chat') {
        onLaunched(await api('/chats', { method: 'POST', body: kind === 'chat' ? { kind, prompt, model: pickedModel } : { kind, prompt, account: pickedAccount } }))
        return
      }
      const out = await api('/agents/launch', { method: 'POST', body: {
        kind, cwd, label: name || folderName, prompt, account: pickedAccount, ...(kind === 'chat' ? { model: pickedModel } : {}),
        workspaceId: space === '__new' ? null : space,
        newSpace: space === '__new' ? (spaceName || name || folderName) : null,
        alsoKind: also && prompt.trim() ? also : undefined,
        ...(repo ? { remember: true, ownBranch: own, ...(own ? { branch: branch.trim() || undefined, base: base || undefined, setup } : {}) } : {}),
      } })
      const clean = tildePath(dirs.path || cwd).replace(/\/$/, '')
      setRecent([clean, ...recent.filter((r) => r !== clean)].slice(0, 8))
      if (out.setupError) window.alert(t('The agent started, but the setup command failed:\n\n{error}', { error: out.setupError }))
      onLaunched(out)
    } catch (x) { setError(x.message); setErrorCode(x.code || null) } finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="modal new-agent" onSubmit={(e) => { if (mode === 'cloud') e.preventDefault(); else launch(e) }} role="dialog" aria-label={mode === 'chat' ? t('New chat') : mode === 'cloud' ? t('New cloud agent') : t('New agent')}>
        <header className="modal-head">
          <Icon name={mode === 'chat' ? 'chat' : mode === 'cloud' ? 'cloud' : 'bot'} size={16} />
          <h3>{mode === 'chat' ? t('New chat') : mode === 'cloud' ? t('New cloud agent') : t('New agent')}</h3>
          <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={14} /></button>
        </header>

        {!cloudOnly && <div className="seg na-mode" role="radiogroup" aria-label={t('Kind of agent')}>
          <button type="button" role="radio" aria-checked={mode === 'project'} className={mode === 'project' ? 'on' : ''} onClick={() => setMode('project')}><Icon name="folder" size={13} /> {t('In a project folder')}</button>
          <button type="button" role="radio" aria-checked={mode === 'chat'} className={mode === 'chat' ? 'on' : ''} onClick={() => setMode('chat')}><Icon name="chat" size={13} /> {t('Plain chat')}</button>
          <button type="button" role="radio" aria-checked={mode === 'cloud'} className={mode === 'cloud' ? 'on' : ''} onClick={() => setMode('cloud')}><Icon name="cloud" size={13} /> {t('In the cloud')}</button>
        </div>}
        {mode === 'chat' && <p className="muted small na-hint">{kind === 'chat' ? t('Talk to any model you have: a plan you\'re signed in to, an API key, or a model on this computer. Saved in a "Chats" space.') : t('Just talk to the agent, like its own app: no project folder, saved in a "Chats" space.')}</p>}

        {mode === 'cloud' ? <NewCloudAgent onLaunched={onLaunched} onClose={onClose} onSettings={onCloudSettings} /> : <>

        <div className="na-field">
          <span className="na-label">{t('Agent')}</span>
          {none ? (
            <div className="na-none">
              <p className="muted small">{t("No AI agents on this computer yet. Install the one you pay for; it shows up here when it's done.")}</p>
              {[['claude', 'Claude', 'Claude Code'], ['codex', 'ChatGPT', 'Codex']].map(([k, plan, app]) => (
                <div key={k} className="na-none-row"><AgentMark kind={k} label={app} size={20} /><span className="na-none-name"><b>{plan}</b> <span className="muted small">{t('with {app}', { app })}</span></span><InstallAgentButton kind={k} label={t('Install {app}', { app })} onCheck={reloadKinds} /></div>
              ))}
              <button type="button" className="link-btn" onClick={() => openSettings('agents')}>{t('Gemini, Copilot and more in Settings › Agents')}</button>
              <button type="button" className="link-btn" onClick={() => pickKind('chat')}>{t('Or work with any model through an API key')}</button>
            </div>
          ) : (
            <div className="na-kinds">
              {(shown || [{ kind: 'claude', label: 'Claude Code' }]).map((k) => (
                <button type="button" key={k.kind} className={`na-kind ${kind === k.kind ? 'on' : ''}`} aria-pressed={kind === k.kind} onClick={() => pickKind(k.kind)}><AgentMark kind={k.kind} label={k.label} size={20} />{k.label}</button>
              ))}
            </div>
          )}
        </div>

        {kind === 'chat' && (
          <div className="na-field">
            <span className="na-label">{t('Model')}</span>
            {!chatModels ? <span className="muted small">{t('Looking for models you can use…')}</span>
              : modelList.length ? (<>
                  <select value={pickedModel} onChange={(e) => setChatModel(e.target.value)} aria-label={t('Model')}>
                    {[...new Set(modelList.map((m) => m.provider))].map((p) => (
                      <optgroup key={p} label={p}>{modelList.filter((m) => m.provider === p).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
                    ))}
                  </select>
                  {mode !== 'chat' && <span className="muted small na-sub">{t('It reads and changes files in this folder and runs commands. It asks you before it changes a file or runs anything.')}</span>}
                </>) : (
                  <div className="na-none">
                    <p className="muted small">{mode === 'chat' ? t('No model to talk to yet. Add an API key (OpenAI, Anthropic, Google, OpenRouter and more), start Ollama or LM Studio, or sign in to an agent.') : t('To work on files it needs a model that can use tools: add an API key (OpenAI, Anthropic, Google, OpenRouter and more), or start Ollama or LM Studio. Your Claude and ChatGPT plans work through Claude Code and Codex.')}</p>
                    <div className="na-none-row">
                      <button type="button" className="btn small primary" onClick={() => openSettings('providers')}><Icon name="layers" size={12} /> {t('Add an API key')}</button>
                      <button type="button" className="ghost-btn" onClick={() => loadModels(true)}><Icon name="refresh" size={12} /> {t('Check again')}</button>
                    </div>
                  </div>
                )}
          </div>
        )}

        {!none && kindAccts.length > 1 && (
          <div className="na-field">
            <span className="na-label">{t('Account')}</span>
            <AccountPicker group={group} value={pickedAccount} onChange={(id) => setAccount((m) => ({ ...m, [kind]: id }))} onAdd={() => onAddAccount(kind)} />
          </div>
        )}
        {!none && kindAccts.length === 1 && (
          <div className="na-field">
            <span className="na-label">{t('Account')}</span>
            <div className="na-acct-one">
              <b>{nameOf(kindAccts[0])}</b>{kindAccts[0].isDefault && kindAccts[0].named !== false && <span className="muted">{t('your usual login')}</span>}
              <button type="button" className="link-btn" onClick={() => onAddAccount(kind)} title={t('Another account for this agent, named as you like')}>{t('Add another…')}</button>
            </div>
          </div>
        )}

        {mode === 'project' && <>
        <div className="na-field">
          <span className="na-label">{t('Folder')}</span>
          <div className={`na-dir ${dirs.exists ? '' : 'bad'}`}>
            <Icon name="folder" size={13} />
            <input ref={dirRef} className="mono" value={cwd} onChange={(e) => { setCwd(e.target.value); setShowDirs(true) }}
              onFocus={() => setShowDirs(true)} onBlur={() => setTimeout(() => setShowDirs(false), 150)}
              onKeyDown={(e) => { if (e.key === 'Tab' && dirs.dirs[0] && showDirs) { e.preventDefault(); setCwd(dirs.dirs[0]) } }}
              spellCheck="false" autoCapitalize="off" autoCorrect="off" placeholder="~/code/…" />
            {pickFolder && <button type="button" className="btn small na-pick" onClick={async () => { const p = await pickFolder(dirs.path || undefined).catch(() => null); if (p) { setCwd(tildePath(p)); setShowDirs(false) } }}>{t('Choose…')}</button>}
            {showDirs && dirs.dirs.length > 0 && (
              <ul className="na-dirs" role="listbox">
                {dirs.dirs.map((d) => <li key={d}><button type="button" onMouseDown={(e) => { e.preventDefault(); setCwd(d); dirRef.current?.focus() }}>{d}</button></li>)}
              </ul>
            )}
          </div>
          {!dirs.exists && (dirs.denied && protectedFolder(cwd)
            ? <PermissionFix pane="files" folder={protectedFolder(cwd)} onCheck={() => setDirsVer((v) => v + 1)}><p>{t("This folder is in your {folder} folder, and macOS hasn't let Bridge AI in yet.", { folder: protectedFolder(cwd) })}</p></PermissionFix>
            : <span className="na-warn">{t("That folder doesn't exist yet")}</span>)}
          {suggestions.length > 0 && (
            <div className="na-recent">
              {suggestions.map((d) => <button type="button" key={d} className="fchip" onClick={() => setCwd(d)} title={d}>{d.split('/').pop()}</button>)}
            </div>
          )}
        </div>

        {!placeOpen ? (
          <div className="na-field">
            <span className="na-label">{t('In the sidebar')}</span>
            <div className="na-where">
              <span>{space === '__new' ? <>A new space called <b>{spaceName || name || folderName}</b></> : <>In <b>{fleet?.workspaces?.find((w) => w.id === space)?.label || 'that space'}</b>, as <b>{name || folderName}</b></>}</span>
              <button type="button" className="link-btn" onClick={() => setPlaceOpen(true)}>{t('Change')}</button>
            </div>
          </div>
        ) : <>
        <div className="na-row">
          <label className="na-field">
            <span className="na-label">{t('Space')}</span>
            <select value={space} onChange={(e) => setSpace(e.target.value)}>
              <option value="__new">{t('New space…')}</option>
              {(fleet?.workspaces || []).map((w, i) => <option key={w.id} value={w.id}>{i + 1} · {w.label}</option>)}
            </select>
          </label>
          {space === '__new'
            ? <label className="na-field"><span className="na-label">{t('Space name')}</span><input value={spaceName} onChange={(e) => setSpaceName(e.target.value)} placeholder={name || folderName} /></label>
            : <label className="na-field"><span className="na-label">{t('Tab name')}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={folderName} /></label>}
        </div>
        {space === '__new' && (
          <label className="na-field"><span className="na-label">{t('Tab name')}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={folderName} /></label>
        )}
        </>}

        {repo && (
          <div className={`na-own ${own ? 'on' : ''}`}>
            <label className="na-check">
              <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
              <span><b>{t('Own branch')}</b> <span className="muted">{t("A new branch in its own copy of {repo}, so it can't clash with other agents", { repo: repo.name })}</span></span>
            </label>
            {own && <>
              <div className="na-row">
                <label className="na-field">
                  <span className="na-label">{t('Branch')}</span>
                  <input className="mono" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={repo.branch || 'bridge/…'} spellCheck="false" autoCapitalize="off" autoCorrect="off" />
                </label>
                <label className="na-field">
                  <span className="na-label">{t('From')}</span>
                  <select value={base || repo.current || ''} onChange={(e) => setBase(e.target.value)}>
                    {!repo.current && <option value="">{t('This commit')}</option>}
                    {[...new Set([repo.current, ...repo.branches].filter(Boolean))].map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </label>
              </div>
              {!repo.branch && <span className="na-warn">{t("That can't be a branch name")}</span>}
              {repo.branch && branch.trim() && repo.branch !== branch.trim() && <span className="na-warn">{t("{branch} exists, so it'll be {next}", { branch: branch.trim(), next: repo.branch })}</span>}
              <label className="na-field">
                <span className="na-label">{t('Setup command')} <i>{t('optional, runs first, saved for this repo')}</i></span>
                <input className="mono" value={setup} onChange={(e) => setSetup(e.target.value)} placeholder={t('e.g. npm install')} spellCheck="false" autoCapitalize="off" autoCorrect="off" />
              </label>
              <span className="muted small">{repo.include ? t('Ignored files listed in .worktreeinclude (like .env) are copied in.') : t('To copy ignored files like .env, list them in .worktreeinclude.')} {t('When you close the agent, its folder goes if nothing would be lost; the branch stays.')}</span>
            </>}
          </div>
        )}
        </>}

        <label className="na-field">
          <span className="na-label">{t('First message')} <i>{t('optional')}</i></span>
          <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={mode === 'chat' ? t('What do you want to talk about?') : t('e.g. /review, or describe the task')}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) launch(e) }} />
        </label>

        {mode === 'project' && (kinds || []).length > 1 && (
          <label className="na-field na-also">
            <span className="na-label">{t('Compare with')} <i>{t('optional')}</i></span>
            <select value={also} onChange={(e) => setAlso(e.target.value)} aria-label={t('Also run with')}>
              <option value="">{t('No, just this agent')}</option>
              {(kinds || []).filter((k) => k.kind !== kind).map((k) => <option key={k.kind} value={k.kind}>{t('{agent}, same first message, side by side', { agent: k.label })}</option>)}
            </select>
            {also && !prompt.trim() && <span className="muted small">{t('Write a first message to compare their answers.')}</span>}
          </label>
        )}

        {error && errorCode === 'EPERM' && protectedFolder(cwd)
          ? <PermissionFix pane="files" folder={protectedFolder(cwd)} onCheck={() => { setError(null); setErrorCode(null) }}><p>{t("This folder is in your {folder} folder, and macOS hasn't let Bridge AI in yet.", { folder: protectedFolder(cwd) })}</p></PermissionFix>
          : error && <p className="error-text">{error}</p>}
        {error && errorCode?.startsWith('install:') && <InstallAgentButton kind={errorCode.slice(8)} onCheck={() => api('/agent-kinds').then((ks) => { setKinds(ks); if (ks.some((k) => k.kind === errorCode.slice(8))) { setError(null); setErrorCode(null) } }).catch(() => {})} />}
        <footer className="modal-foot">
          <span className="muted small hide-touch">{t('⌘⏎ to start')}</span>
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="btn primary" disabled={busy || none || anyBlocked || (mode === 'project' && !dirs.exists) || (ownOn && !repo.branch)}>{busy ? t('Starting…') : mode === 'chat' ? t('Start chat') : t('Start agent')}</button>
        </footer>
        </>}
      </form>
    </div>
  )
}
