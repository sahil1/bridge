import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import AgentMark from './settings/agentMark.jsx'
import { api, settingsChanged, refetch, viaRelay } from '../api.js'
import SignInButton, { InstallAgentButton, canSignIn } from './SignIn.jsx'
import { SetupList, useSetupPlan, readyCount, alreadyLine } from './SetupAll.jsx'
import { t, tx } from '../i18n/index.js'

// First run, in three short steps: how much Bridge AI sets up by itself (just Node.js for the agents,
// which asks for no password and nothing to allow; everything it uses, in one go, while you carry on;
// or later, from Settings › General) and whether it stays awake for your phone, your AI
// (any plan you sign in with, what's on this computer signed in or not, with Install and Sign in
// right there; or an API key, or a model running on this computer: any one is enough), then your
// projects (the folders your agents already worked in, the likely ones ticked). Nothing has to be
// done to go on, and it can be closed at any step: name, weather and your phone keep their guessed
// defaults and live in Settings. It ends on Home, in your first project.
const STARTERS = [
  ['claude', tx('With a Claude Pro, Max or Team plan.')],
  ['codex', tx('With a ChatGPT Plus, Pro or Business plan.')],
  ['gemini', tx('With a Google account, free to start.')],
  ['copilot', tx('With a GitHub Copilot plan.')],
  ['cursor', tx('With a Cursor plan.')],
]
// An API key instead of a plan: the providers people most often have one for.
const KEYS = [['anthropic', 'Anthropic (Claude)', 'ANTHROPIC_API_KEY'], ['openai', 'OpenAI', 'OPENAI_API_KEY'], ['gemini', 'Google Gemini', 'GEMINI_API_KEY'], ['openrouter', 'OpenRouter', 'OPENROUTER_API_KEY'], ['xai', 'xAI (Grok)', 'XAI_API_KEY'], ['mistral', 'Mistral', 'MISTRAL_API_KEY']]

// A key pasted here, saved as in Settings › Model providers, and checked with the provider.
function KeyQuick() {
  const [id, setId] = useState(KEYS[0][0])
  const [key, setKey] = useState('')
  const [st, setSt] = useState(null) // { busy } | { ok, text } | { error }
  const [local, setLocal] = useState([]) // Ollama or LM Studio, running here
  useEffect(() => { api('/providers').then((d) => setLocal((d.providers || []).filter((p) => p.local && p.status === 'connected').map((p) => p.name))).catch(() => {}) }, [])
  const save = async (e) => {
    e.preventDefault()
    const [, label, env] = KEYS.find((k) => k[0] === id)
    if (!key.trim()) return
    setSt({ busy: true })
    try {
      await api(`/providers/${id}`, { method: 'PUT', body: { values: { [env]: key.trim() } } })
      const res = await api(`/providers/${id}/test`, { method: 'POST' }).catch((x) => ({ ok: false, message: x.message }))
      setKey('')
      setSt(res.ok === false ? { error: t('Saved, but {name} turned it down: {reason}.', { name: label, reason: res.message || t('check the key') }) } : { ok: true, text: t('{name} is connected. Any of its models works in New chat and New agent › Any model.', { name: label }) })
    } catch (x) { setSt({ error: x.message }) }
  }
  return (
    <div className="wiz-key">
      <p className="muted small wiz-note"><Icon name="chat" size={12} /> {t('No plan? An API key works too:')}</p>
      <form className="wiz-key-row" onSubmit={save}>
        <select className="wiz-select" value={id} onChange={(e) => setId(e.target.value)} aria-label={t('Provider')}>
          {KEYS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input className="st-input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('Paste the API key')} aria-label={t('API key')} />
        <button type="submit" className="btn small" disabled={!key.trim() || st?.busy}>{st?.busy ? t('Checking…') : t('Add')}</button>
      </form>
      {st?.ok && <p className="small wiz-ok"><Icon name="check" size={12} /> {st.text}</p>}
      {st?.error && <p className="error-text small">{st.error}</p>}
      {local.length > 0 && <p className="muted small wiz-note"><Icon name="laptop" size={12} /> {local.length === 1 ? t('{names} is running on this computer: its models work too.', { names: local.join(' and ') }) : t('{names} are running on this computer: their models work too.', { names: local.join(' and ') })}</p>}
    </div>
  )
}
const STEPS = [tx('Set up'), tx('Your AI'), tx('Your projects')]
// The recommended one asks for no password and nothing to allow: the rest waits until it's used.
const LEVELS = [
  ['basic', tx('Just what agents need (recommended)'), tx('Node.js, so any agent installs in one click. No password, nothing to allow. Meeting notes, voice notes and the calendar set themselves up the first time you use them.')],
  ['full', tx('Everything'), tx('Node.js, meeting notes, voice notes and your calendar, installed in one go while you carry on (the speech model is a 190 MB download). Asks for your password once, then for what macOS needs you to allow.')],
  ['later', tx('Later'), tx('Nothing now. Settings › General has it all in one place whenever you want it.')],
]
const HAVE_NODE = tx('Node.js is already here, so there\'s nothing to install. Meeting notes, voice notes and the calendar set themselves up the first time you use them.')
const ago = (t) => {
  const s = (Date.now() - t) / 1000
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`
}

export default function Onboarding({ onDone }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState(null) // the scan for step 2
  const [picked, setPicked] = useState(null) // Set of paths
  const [chief, setChief] = useState(undefined) // the chief of staff's agent; undefined: suggested
  const [level, setLevel] = useState('basic')
  const [awake, setAwake] = useState(null) // { can, on }: keep this computer awake for your phone (server/relay.js)
  const [started, setStarted] = useState(null) // the level set going
  const setup = useSetupPlan()
  const load = () => api('/setup').then(setD).catch((e) => setErr(e.message))
  const recheck = () => api('/subscriptions?refresh=1').then((list) => setD((x) => x && ({
    ...x, usable: x.usable.map((a) => ({ ...a, signedIn: list.find((s) => s.kind === a.kind)?.signedIn ?? a.signedIn })),
  }))).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => { if (!viaRelay) api('/relay').then((r) => setAwake({ can: !!r.canAwake, on: r.awake !== false })).catch(() => {}) }, [])
  // The scan starts at once, so step 2 is ready when you get there.
  useEffect(() => {
    api('/projects?scan=fresh').then((r) => {
      setFound(r.found || [])
      setPicked(new Set((r.found || []).filter((x) => x.suggested).map((x) => x.path)))
    }).catch(() => { setFound([]); setPicked(new Set()) })
  }, [])

  const usable = d?.usable || []
  // The chief of staff's agent: the one you picked, else the suggested one, else one that can chat.
  const chiefFor = (x) => {
    if (chief !== undefined) return chief
    const u = x?.usable || []
    return x?.suggested?.chiefKind || (u.filter((a) => a.signedIn !== false).find((a) => a.caps?.chat) || u.find((a) => a.caps?.chat))?.kind || null
  }
  const chiefKind = chiefFor(d)
  // The agents to show: Claude Code and Codex always, and any other one that's here.
  const cards = useMemo(() => {
    if (!d) return []
    const list = STARTERS.map(([k, plan]) => ({ kind: k, plan, a: d.agents.find((x) => x.kind === k), here: usable.find((x) => x.kind === k) }))
    for (const u of usable) if (!STARTERS.some(([k]) => k === u.kind)) list.push({ kind: u.kind, plan: null, a: d.agents.find((x) => x.kind === u.kind), here: u })
    return list.filter((c) => c.a)
  }, [d]) // eslint-disable-line react-hooks/exhaustive-deps

  // Done, from any step: settings saved (with the guessed name and weather), the projects you ticked
  // kept, the chief of staff started in the background. close: the X, which imports nothing.
  const finish = async ({ importing = false } = {}) => {
    setBusy(true); setErr(null)
    try {
      // Closed before its first look at this computer was back (a slow first start): that look
      // first, so its guesses are kept.
      const data = d || await api('/setup').catch(() => null)
      const s = data?.suggested || {}
      const chiefKind = chiefFor(data)
      await api('/setup', { method: 'POST', body: { name: s.name, location: s.location, defaultAgent: s.defaultAgent, chiefKind } })
      settingsChanged()
      // Always saved, an empty list too, so a later start doesn't fill it in for you.
      await api('/projects', { method: 'POST', body: { paths: importing && picked ? [...picked] : [] } }).then(() => refetch('/projects')).catch(() => {})
      if (chiefKind) api('/chief/launch', { method: 'POST' }).catch(() => {})
      // Homebrew asks for your password in its terminal tab: shown once setup is done.
      const brewing = setup.plan?.running && setup.plan.items.some((i) => i.id === 'homebrew' && i.state === 'running')
      onDone(brewing ? setup.plan.openId : undefined)
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  // The first step: set going what was picked (nothing for Later), shown going; then your AI.
  // Already on this computer: named once, and left as it is. With Node.js here, "Just what agents
  // need" has nothing to do (it says so, and Later goes); with everything here, there's nothing to choose.
  const have = setup.plan ? setup.plan.items.filter((i) => i.state === 'done').map((i) => i.id) : []
  const allHere = !!setup.plan && have.length === setup.plan.items.length
  const nodeHere = have.includes('node')
  const levels = LEVELS.filter(([id]) => !(id === 'later' && nodeHere))
  const nothing = level === 'later' || (level === 'basic' && nodeHere)
  const startSetup = async () => {
    // Only when it was changed: untouched, it follows the default (on once a phone can reach this computer).
    if (awake?.can && !awake.on) api('/relay/awake', { method: 'POST', body: { on: false } }).catch(() => {})
    if (started || nothing || allHere) { setStarted((x) => x || 'later'); setStep(1); return }
    setErr(null)
    try { await setup.run(level); setStarted(level) } catch (e) { setErr(e.message) }
  }

  const shown = found || []
  const n = picked?.size || 0
  return (
    <div className="onb wiz-back">
      <div className="wiz" role="dialog" aria-modal="true" aria-label={t('Set up Bridge AI')}>
        <header className="wiz-head">
          <img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" width="22" height="22" />
          <b>Bridge AI</b>
          <button type="button" className="win-btn wiz-x" onClick={() => finish()} disabled={busy} aria-label={t('Close setup')} title={t('Close: you can do all of this later')}><Icon name="x" size={14} /></button>
        </header>
        <ol className="wiz-steps">
          {STEPS.map((label, i) => (
            <li key={label} className={i === step ? 'now' : i < step ? 'did' : ''}>
              <button type="button" onClick={() => i < step && setStep(i)} disabled={i >= step}>
                <span className="wiz-num">{i < step ? <Icon name="check" size={11} /> : i + 1}</span>{t(label)}
              </button>
            </li>
          ))}
        </ol>

        {step === 0 ? (
          <div className="wiz-body">
            <h2>{t('How much should Bridge AI set up?')}</h2>
            <p className="muted">{t('It can install what it uses by itself, so there are no programs to look up and install one by one.')}</p>
            {!started && allHere ? <p className="sa-all"><Icon name="check" size={13} /> {t('Everything Bridge AI uses is already set up here.')}</p>
              : !started ? <>
              {have.length > 0 && <p className="muted small sa-kept">{alreadyLine(have)}</p>}
              <ul className="wiz-levels" role="radiogroup" aria-label={t('How much to set up')}>
                {levels.map(([id, label, note]) => (setup.plan && !setup.plan.mac && id === 'full' ? [id, label, tx('Node.js, meeting notes and voice notes, set up in one go while you carry on (the speech model is a 190 MB download).')] : id === 'basic' && nodeHere ? [id, label, HAVE_NODE] : [id, label, note])).map(([id, label, note]) => (
                  <li key={id} className={level === id ? 'on' : ''}>
                    <label><input type="radio" name="wiz-level" value={id} checked={level === id} onChange={() => setLevel(id)} /><b>{t(label)}</b><small>{t(note)}</small></label>
                  </li>
                ))}
              </ul>
              </>
              : <SetupList plan={setup.plan} reload={setup.load} only={started === 'basic' ? 'basic' : null} onRetry={() => setup.run(started).catch((e) => setErr(e.message))} />}
            {awake?.can && !started && (
              <label className="wiz-awake">
                <input type="checkbox" checked={awake.on} onChange={(e) => setAwake({ ...awake, on: e.target.checked })} />
                <b>{t('Keep this computer awake for your phone')}</b>
                <small>{t('Once your phone is connected, this computer doesn\'t go to sleep when you walk away, so your agents are still a tap away. The screen still turns off and locks.')}</small>
              </label>
            )}
          </div>
        ) : !d ? <div className="wiz-body"><p className="muted">{err || t('Looking at what\'s on this computer…')}</p></div>
          : step === 1 ? (
            <div className="wiz-body">
              <h2>{t('Connect your AI')}</h2>
              <p className="muted">{t('Any one is enough: the plan you already pay for, or an API key. You can add more later.')}</p>
              <ul className="wiz-agents">
                {cards.map((c) => {
                  const here = c.here
                  const out = here?.signedIn === false
                  return (
                    <li key={c.kind}>
                      <AgentMark kind={c.kind} label={c.a.label} size={28} />
                      <span className="wiz-agent-main">
                        <b>{c.a.label}</b>
                        <small>{here ? (out ? t('Installed. Sign in once with your account.') : t('Ready to work.')) : c.plan ? t(c.plan) : t('Not installed.')}</small>
                      </span>
                      {here && !out && <span className="wiz-ready"><Icon name="check" size={12} /> {t('Ready')}</span>}
                      {here && out && canSignIn(c.kind) && <SignInButton kind={c.kind} onCheck={recheck} terminalLink={false} className="btn small" />}
                      {!here && <InstallAgentButton kind={c.kind} needs={c.a.needs} onCheck={load} showLink={false} />}
                    </li>
                  )
                })}
              </ul>
              <KeyQuick />
              {usable.length > 0 && (
                <p className="muted small wiz-note"><Icon name="helm" size={12} /> Your chief of staff, the one you talk to, runs on{' '}
                  <select className="wiz-select" value={chiefKind || ''} onChange={(e) => setChief(e.target.value || null)} aria-label={t('Chief of staff')}>
                    {usable.map((a) => <option key={a.kind} value={a.kind}>{a.label}</option>)}
                    <option value="">{t('nothing for now')}</option>
                  </select>.
                </p>
              )}
            </div>
          ) : (
            <div className="wiz-body">
              <h2>{t('Import your projects')}</h2>
              <p className="muted">{t('The folders you work in, with their Claude Code and Codex conversations, ready to pick up again. Nothing is copied or moved.')}</p>
              {!found ? <p className="muted wiz-scan"><span className="aa-spin" /> {t('Looking for projects from Claude Code and Codex…')}</p>
                : !shown.length ? <p className="muted wiz-scan">{t("No projects yet. You'll pick a folder the first time you start work.")}</p>
                  : <>
                    <div className="wiz-listhead">
                      <span className="muted small">{t('{n} of {total} selected', { n, total: shown.length })}</span>
                      <span className="wiz-grow" />
                      <button type="button" className="link-btn small" onClick={() => setPicked(new Set(shown.map((x) => x.path)))}>{t('Select all')}</button>
                      <button type="button" className="link-btn small" onClick={() => setPicked(new Set())}>{t('Select none')}</button>
                    </div>
                    <ul className="wiz-projects">
                      {shown.map((x) => {
                        const on = picked.has(x.path)
                        return (
                          <li key={x.path}>
                            <label>
                              <input type="checkbox" checked={on} onChange={() => setPicked((p) => { const q = new Set(p); if (on) q.delete(x.path); else q.add(x.path); return q })} />
                              <b>{x.name}</b>
                              <code title={x.path}>{x.short}</code>
                              <span className="wiz-marks">{Object.keys(x.kinds).map((k) => <AgentMark key={k} kind={k} label={k} size={13} />)}</span>
                              <span className="wiz-count" title={x.count === 1 ? t('{n} conversation', { n: x.count }) : t('{n} conversations', { n: x.count })}>{x.count}</span>
                              <span className="wiz-age">{ago(x.last)}</span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </>}
            </div>
          )}

        {err && <p className="error-text wiz-err">{err}</p>}
        {step > 0 && started && started !== 'later' && setup.plan && (
          <p className="wiz-strip" aria-live="polite">
            {setup.plan.running ? <span className="aa-spin" /> : <Icon name="check" size={12} />}
            {setup.plan.running ? t('Setting up in the background: {n} of {total} ready', { n: readyCount(setup.plan), total: setup.plan.items.length }) : t('Set up: {n} of {total} ready. The rest is in Settings › General.', { n: readyCount(setup.plan), total: setup.plan.items.length })}
          </p>
        )}
        <footer className="wiz-foot">
          {step === 0
            ? <><span className="wiz-grow" /><button type="button" className="btn primary" autoFocus onClick={startSetup} disabled={busy}>{started || nothing || allHere ? t('Continue') : level === 'full' ? t('Set up everything') : t('Set up Node.js')}</button></>
            : step === 1
              ? <><span className="wiz-grow" /><button type="button" className="btn primary" autoFocus onClick={() => setStep(2)} disabled={!d || busy}>{t('Continue')}</button></>
            : <>
              <button type="button" className="ghost-btn" onClick={() => finish()} disabled={busy}>{shown.length ? t('Don\'t import') : t('Skip')}</button>
              <span className="wiz-grow" />
              <button type="button" className="btn primary" autoFocus onClick={() => finish({ importing: true })} disabled={busy || !found}>{busy ? t('Setting up…') : n ? (n === 1 ? t('Import {n} project', { n }) : t('Import {n} projects', { n })) : t('Start')}</button>
            </>}
        </footer>
      </div>
    </div>
  )
}
