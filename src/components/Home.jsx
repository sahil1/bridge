import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import AgentMark from './settings/agentMark.jsx'
import { usePersisted } from './layout.jsx'
import { api, usePoll } from '../api.js'
import { openSettings } from './SignIn.jsx'
import { t, tx } from '../i18n/index.js'
import './home.css'

// Home: "What should we build in <project>?" and one message box, like starting a thread in T3
// Code. The project's name is the picker; the agent (or any model), how much it may do without
// asking, and where it works are small chips on the box; Enter starts it in that project and opens
// it. With no project, it's a chat. The full New agent dialog (cloud agents, comparing two agents,
// an account, the space it goes in) is under More options.

// How much it may do without asking (server: agents.js access()).
const ACCESS = [
  { id: 'ask', label: tx('Ask first'), icon: 'eye', note: tx('Asks before it changes a file or runs a command.') },
  { id: 'edits', label: tx('Edit freely'), icon: 'edit', note: tx('Changes files without asking; asks before commands.') },
  { id: 'full', label: tx('Full access'), icon: 'unlock', note: tx('Changes files and runs commands without asking.') },
]
const ANY = { kind: 'chat', label: tx('Any model'), access: true }

// A small menu under a chip: Escape or a click outside closes it.
function Pop({ open, onClose, children, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const down = (e) => { if (!ref.current?.parentElement?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [open, onClose])
  if (!open) return null
  return <div ref={ref} className={`home-pop ${className}`} role="menu">{children}</div>
}

export default function Home({ fleet, onLaunched, onMore, autoFocus = true }) {
  const { data: pj, refresh: reloadProjects } = usePoll('/projects', 60_000)
  const projects = pj?.projects || []
  const [kinds, setKinds] = useState(null)
  const [pref, setPref] = usePersisted('cc-home', { project: null, kind: null, model: '', access: 'ask' })
  const [noProject, setNoProject] = useState(false)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(null) // which chip's menu: project | agent | access | where
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [models, setModels] = useState(null)
  const [repo, setRepo] = useState(null)
  const [own, setOwn] = useState(false)
  const box = useRef(null)
  const pickFolder = window.bridgeApp?.pickFolder

  useEffect(() => { api('/agent-kinds').then(setKinds).catch(() => setKinds([])) }, [])
  const project = noProject ? null : projects.find((p) => p.path === pref.project) || projects[0] || null
  const choices = [...(kinds || []), ANY]
  const kind = choices.find((k) => k.kind === pref.kind)?.kind || kinds?.find((k) => k.kind === 'claude')?.kind || kinds?.[0]?.kind || 'chat'
  const agent = choices.find((k) => k.kind === kind) || ANY
  // Any model: in a project it needs a model that can use tools (not a sign-in's one-shot mode).
  useEffect(() => { if (kind === 'chat' && !models) api('/chat/models').then((r) => setModels(r.models || [])).catch(() => setModels([])) }, [kind, models])
  const usable = (models || []).filter((m) => noProject || !project || m.via !== 'sign-in')
  const model = usable.find((m) => m.id === pref.model)?.id || usable[0]?.id || ''
  const access = agent.access && project ? (ACCESS.find((a) => a.id === pref.access) || ACCESS[0]) : ACCESS[0]
  useEffect(() => {
    setRepo(null)
    if (!project) return
    api(`/repo?dir=${encodeURIComponent(project.path)}`).then((r) => { setRepo(r.repo ? r : null); setOwn(!!r.own) }).catch(() => {})
  }, [project?.path]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (autoFocus) box.current?.focus() }, [autoFocus, project?.path])

  // The space it goes in: the one already working in this project, else a new one named for it.
  const space = useMemo(() => {
    if (!project) return null
    const a = (fleet?.agents || []).find((x) => !x.chief && !x.cloud && (x.cwd === project.path || x.worktree?.repo === project.path))
    return a?.workspaceId || null
  }, [fleet, project])

  const addProject = async (dir) => {
    try { await api('/projects', { method: 'POST', body: { path: dir } }); reloadProjects(); setPref((p) => ({ ...p, project: dir })); setNoProject(false) } catch (e) { setErr(e.message) }
  }
  const go = async (e) => {
    e?.preventDefault()
    const prompt = text.trim()
    if (!prompt || busy) return
    if (kind === 'chat' && !model) { setErr(t('Add an API key or start a local model first (Settings › Model providers).')); return }
    setBusy(true); setErr(null)
    try {
      const out = project
        ? await api('/agents/launch', { method: 'POST', body: {
          kind, cwd: project.path, prompt, access: access.id, ...(kind === 'chat' ? { model } : {}),
          workspaceId: space, newSpace: space ? null : project.name.split('/').pop(), label: prompt.replace(/\s+/g, ' ').slice(0, 40),
          ...(repo ? { remember: true, ownBranch: own } : {}),
        } })
        : await api('/chats', { method: 'POST', body: kind === 'chat' ? { kind, prompt, model } : { kind, prompt } })
      setText('')
      onLaunched?.(out)
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }

  const name = project?.name?.split('/').pop()
  return (
    <section className="pane home" aria-label={t('Start something new')}>
      <div className="home-center">
        <h1 className="home-title">
          {project ? <>What should we build in{' '}
            <span className="home-proj">
              <button type="button" className="home-proj-btn" onClick={() => setOpen(open === 'project' ? null : 'project')} aria-haspopup="menu" aria-expanded={open === 'project'} title={project.short}>{name}</button>
              <Pop open={open === 'project'} onClose={() => setOpen(null)} className="home-pop-proj">
                {projects.map((p) => (
                  <button type="button" key={p.path} role="menuitemradio" aria-checked={p.path === project.path} className={p.path === project.path ? 'on' : ''} onClick={() => { setPref((x) => ({ ...x, project: p.path })); setOpen(null) }}>
                    <Icon name="folder" size={13} /><span className="home-pop-main"><b>{p.name}</b><small>{p.short}</small></span>
                  </button>
                ))}
                {pickFolder && <button type="button" onClick={async () => { setOpen(null); const d = await pickFolder().catch(() => null); if (d) addProject(d) }}><Icon name="plus" size={13} /><span className="home-pop-main"><b>{t('Add a project…')}</b></span></button>}
              </Pop>
            </span>?</>
            : !pj && !noProject ? '\u00a0' : projects.length || noProject ? t('What should we work on?') : t('Add a project to start')}
        </h1>
        {project
          ? <button type="button" className="link-btn home-sub" onClick={() => setNoProject(true)}>{t('or start without a project')}</button>
          : noProject && projects.length > 0
            ? <button type="button" className="link-btn home-sub" onClick={() => setNoProject(false)}>{t('or work in a project')}</button>
            : pj && !projects.length && <p className="muted small home-sub">{pickFolder ? <button type="button" className="link-btn" onClick={async () => { const d = await pickFolder().catch(() => null); if (d) addProject(d) }}>Choose a folder</button> : 'Start an agent in a folder from More options'}, or just start a chat below.</p>}

        <form className="home-box" onSubmit={go}>
          <textarea ref={box} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={project ? t('Ask for a change, a fix, a plan, anything') : t('Ask anything')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) go(e) }} aria-label={t('Your message')} />
          <div className="home-chips">
            <span className="home-chip-wrap">
              <button type="button" className="home-chip" onClick={() => setOpen(open === 'agent' ? null : 'agent')} aria-haspopup="menu" aria-expanded={open === 'agent'}>
                <AgentMark kind={kind} label={agent.label} size={15} /><span>{kind === 'chat' ? (usable.find((m) => m.id === model)?.label || t('Any model')) : agent.label}</span><Icon name="down" size={11} />
              </button>
              <Pop open={open === 'agent'} onClose={() => setOpen(null)}>
                {(kinds || []).map((k) => (
                  <button type="button" key={k.kind} role="menuitemradio" aria-checked={kind === k.kind} className={kind === k.kind ? 'on' : ''} onClick={() => { setPref((x) => ({ ...x, kind: k.kind })); setOpen(null) }}>
                    <AgentMark kind={k.kind} label={k.label} size={16} /><span className="home-pop-main"><b>{k.label}</b></span>
                  </button>
                ))}
                {kinds && !kinds.length && <p className="muted small home-pop-note">{t('No agents installed yet.')} <button type="button" className="link-btn" onClick={() => openSettings('agents')}>Install one</button>, or use any model below.</p>}
                <div className="home-pop-sep">{t('Any model')}</div>
                {models === null && kind !== 'chat' && <button type="button" onClick={() => api('/chat/models').then((r) => setModels(r.models || [])).catch(() => setModels([]))}><Icon name="chat" size={13} /><span className="home-pop-main"><b>{t('Show models…')}</b></span></button>}
                {usable.map((m) => (
                  <button type="button" key={m.id} role="menuitemradio" aria-checked={kind === 'chat' && model === m.id} className={kind === 'chat' && model === m.id ? 'on' : ''} onClick={() => { setPref((x) => ({ ...x, kind: 'chat', model: m.id })); setOpen(null) }}>
                    <Icon name="chat" size={13} /><span className="home-pop-main"><b>{m.label}</b><small>{m.provider}</small></span>
                  </button>
                ))}
                {models && !usable.length && <p className="muted small home-pop-note">No model {project ? 'that can work on files ' : ''}yet: <button type="button" className="link-btn" onClick={() => openSettings('providers')}>add an API key</button> or start Ollama or LM Studio.</p>}
              </Pop>
            </span>
            {project && (
              <span className="home-chip-wrap">
                <button type="button" className="home-chip" onClick={() => agent.access && setOpen(open === 'access' ? null : 'access')} aria-haspopup="menu" aria-expanded={open === 'access'} disabled={!agent.access} title={agent.access ? t(access.note) : t('{agent} asks before it acts', { agent: agent.label })}>
                  <Icon name={access.icon} size={13} /><span>{t(access.label)}</span>{agent.access && <Icon name="down" size={11} />}
                </button>
                <Pop open={open === 'access'} onClose={() => setOpen(null)}>
                  {ACCESS.map((a) => (
                    <button type="button" key={a.id} role="menuitemradio" aria-checked={access.id === a.id} className={access.id === a.id ? 'on' : ''} onClick={() => { setPref((x) => ({ ...x, access: a.id })); setOpen(null) }}>
                      <Icon name={a.icon} size={13} /><span className="home-pop-main"><b>{t(a.label)}</b><small>{t(a.note)}</small></span>
                    </button>
                  ))}
                </Pop>
              </span>
            )}
            <span className="home-grow" />
            <button type="submit" className="home-send" disabled={!text.trim() || busy} aria-label={t('Start')}><Icon name={busy ? 'refresh' : 'up'} size={15} className={busy ? 'spin' : ''} /></button>
          </div>
        </form>
        <div className="home-under">
          {project && repo && (
            <span className="home-chip-wrap">
              <button type="button" className="home-where" onClick={() => setOpen(open === 'where' ? null : 'where')} aria-haspopup="menu" aria-expanded={open === 'where'}>
                <Icon name={own ? 'branch' : 'folder'} size={12} />{own ? t('Its own branch') : t('This folder')}{repo.current && !own ? <span className="muted"> · {repo.current}</span> : null}<Icon name="down" size={10} />
              </button>
              <Pop open={open === 'where'} onClose={() => setOpen(null)} className="home-pop-up">
                <button type="button" role="menuitemradio" aria-checked={!own} className={!own ? 'on' : ''} onClick={() => { setOwn(false); setOpen(null) }}><Icon name="folder" size={13} /><span className="home-pop-main"><b>{t('This folder')}</b><small>{t('Works on {branch} as it is.', { branch: repo.current || t('the checkout') })}</small></span></button>
                <button type="button" role="menuitemradio" aria-checked={own} className={own ? 'on' : ''} onClick={() => { setOwn(true); setOpen(null) }}><Icon name="branch" size={13} /><span className="home-pop-main"><b>{t('Its own branch')}</b><small>{t("A copy on a new branch, so it can't clash with other agents.")}</small></span></button>
              </Pop>
            </span>
          )}
          <span className="home-grow" />
          <button type="button" className="link-btn home-more" onClick={() => onMore?.(project ? { mode: 'project', cwd: project.short, kind: kind === 'chat' ? undefined : kind } : { mode: 'chat' })}>{t('More options')}</button>
        </div>
        {err && <p className="error-text small home-err" role="alert">{err}</p>}
      </div>
    </section>
  )
}
