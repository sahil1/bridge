// The Preview tab: the app an agent's project serves, like an editor's built-in browser. Lists the
// web servers running from the agent's folder; shows the one you pick, with an address bar. When
// none is running, offers the project's own start commands, run in a terminal tab you can watch.
// An agent on another of your computers serves its app on that computer's localhost, never this
// one's: its app is shown through the link (Remote Screen and Preview, server/devpreview.js).
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted } from './layout.jsx'
import { api, hostApi, usePoll, viaRelay, machineId, BASE } from '../api.js'
import PageView, { dropped } from './remote/PageView.jsx'
import Gate, { gateOf } from './remote/Gate.jsx'
import { connect } from './remote/remote.js'
import { t, tn } from '../i18n/index.js'
import { ShareDialog } from './Share.jsx'
import { useTrial } from '../trials.js'

const enc = encodeURIComponent
// On this computer the app is at localhost; from a phone (over Tailscale) it's this computer's
// address, which works only if the server listens on more than localhost.
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/
const remote = typeof location !== 'undefined' && !LOOPBACK.test(location.hostname)
const urlOf = (port, p = '/') => `http://${remote ? location.hostname : 'localhost'}:${port}${p.startsWith('/') ? p : `/${p}`}`
// How the app is shown:
//   here    this computer's own, at its address (localhost here; its name through Tailscale)
//   port    another computer's (this page shows one of your other computers): at an address of its
//           own on this computer, through the link, as if it ran here (server/devpreview.js)
//   frames  through a phone's relay, or where that address can't be reached (Tailscale, Docker): drawn
//           by the computer that runs it and shown as pictures (remote/PageView.jsx)
const HOW = viaRelay ? 'frames' : machineId ? (remote ? 'frames' : 'port') : 'here'
const path1 = (p) => (p.startsWith('/') ? p.slice(1) : p)

// A picture of the preview, for the agent. The desktop app takes it from its own window; a
// browser asks to share this tab (once per picture) and crops a frame of it.
async function capture(el) {
  const r = el.getBoundingClientRect()
  if (window.bridgeApp?.capture) {
    const b64 = await window.bridgeApp.capture({ x: r.x, y: r.y, width: r.width, height: r.height })
    if (!b64) throw new Error(t("Couldn't take the picture"))
    return (await fetch(`data:image/png;base64,${b64}`)).blob()
  }
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error(t("Pictures can't be taken here. Take a screenshot yourself and paste it into the message box."))
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, preferCurrentTab: true, selfBrowserSurface: 'include', audio: false })
  try {
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    await new Promise((res) => setTimeout(res, 200))
    const sx = video.videoWidth / window.innerWidth
    const sy = video.videoHeight / window.innerHeight
    const c = document.createElement('canvas')
    c.width = Math.round(r.width * sx)
    c.height = Math.round(r.height * sy)
    c.getContext('2d').drawImage(video, r.x * sx, r.y * sy, r.width * sx, r.height * sy, 0, 0, c.width, c.height)
    return await new Promise((res) => c.toBlob(res, 'image/png'))
  } finally { stream.getTracks().forEach((track) => track.stop()) }
}

export default function PreviewView({ agent, onSendToAgent }) {
  const pane = agent.paneId
  const [waiting, setWaiting] = useState(null) // { since, known: [ports] } after Start
  const { data, error, refresh } = usePoll(`/agents/${enc(pane)}/servers`, waiting ? 1500 : 5000)
  const [picked, setPicked] = usePersisted(`cc-preview-port-${pane}`, null)
  const [address, setAddress] = useState('/')
  const [shown, setShown] = useState('/')
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [sharing, setSharing] = useState(false) // making a Share Link for the app (Share.jsx)
  const shareOn = useTrial('share-links') // Share Links, a beta feature (src/trials.js)
  const list =data?.servers || []
  const current = list.find((s) => s.port === picked) || list[0] || null
  // That computer's name, where the app runs elsewhere.
  const comp = usePoll(HOW === 'here' ? null : '/version', 10 * 60 * 1000).data?.computer || t('that computer')
  // Another computer's app: its address here (asked of the computer this page comes from).
  const [addr, setAddr] = useState(null)
  // That computer asks for its password (or Allow) before it shows its apps: a session for the app,
  // open while it shows here (Granted).
  const [gated, setGated] = useState(false)
  useEffect(() => { setGated(false) }, [current?.port])
  useEffect(() => {
    if (HOW !== 'port' || !current) return
    let live = true
    setAddr(null)
    hostApi(`/machines/${encodeURIComponent(machineId)}/preview`, { method: 'POST', body: { port: current.port } }).then((a) => live && setAddr(a), (e) => { if (!live) return; setAddr({ error: e.message, code: e.code }); if (e.code === 'gate') setGated(true) })
    return () => { live = false }
  }, [current?.port, reload]) // eslint-disable-line react-hooks/exhaustive-deps
  const hrefOf = (p) => (HOW === 'here' ? urlOf(current.port, p) : HOW === 'port' && addr?.url ? `${addr.url}${path1(p)}` : null)

  // After Start: pick the first new server as soon as it answers (or give up after 90 seconds).
  useEffect(() => {
    if (!waiting || !data) return
    const fresh = list.find((s) => !waiting.known.includes(s.port))
    if (fresh) { setPicked(fresh.port); setWaiting(null); setMsg(null) } else if (Date.now() - waiting.since > 90_000) { setWaiting(null); setMsg({ text: t("No server showed up yet. Check its terminal tab: it may need something first, or serve from another folder.") }) }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAddress('/'); setShown('/') }, [current?.port])

  const start = async (c) => {
    setBusy(c.command); setMsg(null)
    try {
      const r = await api(`/agents/${enc(pane)}/servers/start`, { method: 'POST', body: { command: c.command } })
      setWaiting({ since: Date.now(), known: list.map((s) => s.port) })
      setMsg({ text: t('Started {name} in a terminal tab.', { name: c.label }), openId: r.openId })
    } catch (e) { setMsg({ text: e.message, bad: true }) } finally { setBusy(null) }
  }
  const stop = async (s) => {
    if (!window.confirm(s.program ? t('Stop the server on port {port} ({program})?', { port: s.port, program: s.program }) : t('Stop the server on port {port}?', { port: s.port }))) return
    try { await api(`/agents/${enc(pane)}/servers/${s.port}/stop`, { method: 'POST' }); setTimeout(refresh, 800) } catch (e) { setMsg({ text: e.message, bad: true }) }
  }
  const openTab = (id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } }))
  const go = (e) => { e.preventDefault(); setShown(address.trim() || '/'); setReload((k) => k + 1) }
  const bodyRef = useRef(null)
  const sendPicture = async () => {
    setBusy('picture'); setMsg(null)
    try {
      const blob = await capture(bodyRef.current)
      const name = `preview-${current.port}.png`
      const res = await fetch(`${BASE}/api/upload?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob })
      const up = await res.json()
      if (!res.ok) throw new Error(up.error || t('Upload failed'))
      onSendToAgent({ text: `In the app at ${urlOf(current.port, shown)}: `, files: [{ name, path: up.path, image: true, size: blob.size, preview: `${BASE}/api/upload/raw?path=${encodeURIComponent(up.path)}` }] })
    } catch (e) { if (e?.name !== 'NotAllowedError') setMsg({ text: e.message, bad: true }) } finally { setBusy(null) }
  }

  const Starters = () => (data?.commands?.length ? (
    <div className="pv-starts">
      {data.commands.map((c) => (
        <button key={c.command} className="pv-start" onClick={() => start(c)} disabled={!!busy || !!waiting} title={c.detail || c.command}>
          <Icon name="play" size={12} /><span className="mono">{c.label}</span>{c.detail && <span className="muted small">{c.detail}</span>}
        </button>
      ))}
    </div>
  ) : null)

  return (
    <div className="preview-view">
      <div className="preview-bar">
        <div className="preview-servers" role="tablist" aria-label={t('Running servers')}>
          {list.map((s) => (
            <button key={s.port} role="tab" aria-selected={current?.port === s.port} className={`preview-chip ${current?.port === s.port ? 'on' : ''}`} onClick={() => setPicked(s.port)}
              title={s.cwd && s.cwd !== '.' ? t('{program} in {folder}, port {port}', { program: s.program || t('server'), folder: s.cwd, port: s.port }) : t('{program}, port {port}', { program: s.program || t('server'), port: s.port })}>
              <span className="preview-dot" />:{s.port}<span className="muted">{s.title || s.program || ''}</span>
            </button>
          ))}
        </div>
        {current && <>
          <form className="preview-address" onSubmit={go}>
            <span className="muted mono small">:{current.port}</span>
            <input className="mono" value={address} onChange={(e) => setAddress(e.target.value)} aria-label={t('Path')} spellCheck={false} />
          </form>
          {onSendToAgent && HOW !== 'frames' && current.framable !== false && !(HOW === 'here' && remote && current.localOnly) && (
            <button className="btn small" onClick={sendPicture} disabled={busy === 'picture'} title={t('Take a picture of the app and attach it to a message for the agent')}>
              <Icon name="image" size={12} /> {busy === 'picture' ? t('Taking…') : t('Send to agent')}
            </button>
          )}
          <button className="win-btn" onClick={() => setReload((k) => k + 1)} title={t('Reload')} aria-label={t('Reload')}><Icon name="refresh" size={13} /></button>
          {shareOn && <button className="win-btn pv-share" onClick={() => setSharing(true)} title={t('Share Link: the app, usable by whoever opens it, for people outside your devices')} aria-label={t('Share Link')}><Icon name="link" size={13} /></button>}
          {hrefOf(shown) && <a className="win-btn" href={hrefOf(shown)} target="_blank" rel="noreferrer" title={HOW === 'port' ? t('Open in a browser on this computer') : t('Open in your browser')} aria-label={HOW === 'port' ? t('Open in a browser on this computer') : t('Open in your browser')}><Icon name="external" size={13} /></a>}
          <button className="win-btn" onClick={() => stop(current)} title={t('Stop this server')} aria-label={t('Stop this server')}><Icon name="stop" size={13} /></button>
        </>}
      </div>
      {sharing && current && <ShareDialog what={{ kind: 'app', port: current.port, pane, name: current.title || current.program || t('Port {port}', { port: current.port }) }} onClose={() => setSharing(false)} />}
      {msg && (
        <div className={`preview-msg ${msg.bad ? 'bad' : ''}`} role="status">
          {waiting && <Icon name="refresh" size={12} className="spin" />}
          <span>{msg.text}{waiting ? ` ${t('Waiting for it to start serving…')}` : ''}</span>
          {msg.openId && <button className="link-btn" onClick={() => openTab(msg.openId)}>{t('Show the terminal')}</button>}
        </div>
      )}
      <div className="preview-body" ref={bodyRef}>
        {error && !data && <div className="viewer-empty"><Icon name="alert" size={22} /><p>{error}</p></div>}
        {!data && !error && <div className="pad"><div className="skeleton-rows"><div /><div /></div></div>}
        {data && !current && (
          <div className="viewer-empty preview-empty">
            <Icon name="play" size={24} />
            <p><b>{t('No server is running from this folder.')}</b></p>
            <p className="muted small">{data.commands?.length ? t('Start one the way this project does:') : t("This project doesn't have a start script Bridge AI recognizes. Start its server in a terminal (or ask the agent to), and it shows up here.")}</p>
            <Starters />
          </div>
        )}
        {current && (current.framable === false && HOW !== 'frames'
          ? <div className="viewer-empty"><Icon name="external" size={22} /><p>{t('This app doesn\'t allow being shown inside another page.')}</p>{hrefOf(shown) && <a className="btn small" href={hrefOf(shown)} target="_blank" rel="noreferrer">{t('Open it in your browser')}</a>}</div>
          : HOW === 'frames'
          ? <PageView key={`${current.port}-${reload}`} base={BASE} port={current.port} path={shown} name={comp} />
          : HOW === 'port'
          ? (() => {
            const shownHere = addr?.url ? <Frame key={`${current.port}-${reload}`} src={hrefOf(shown)} title={current.title || t('Port {port}', { port: current.port })} />
              : addr?.error && addr.code !== 'gate' ? <div className="viewer-empty"><Icon name="alert" size={22} /><p>{addr.error}</p><button type="button" className="btn small" onClick={() => setReload((k) => k + 1)}>{t('Try again')}</button></div>
                : <div className="viewer-empty"><Icon name="refresh" size={20} className="spin" /><p>{t('Asking {name} for the app…', { name: comp })}</p></div>
            return gated ? <Granted key={current.port} port={current.port} name={comp} onOpen={() => setReload((k) => k + 1)}>{shownHere}</Granted> : shownHere
          })()
          : remote && current.localOnly
          ? <div className="viewer-empty"><Icon name="phone" size={22} /><p>{t('This server only answers on the computer itself, so it can\'t be shown on this device.')}</p><p className="muted small">{tn('Restart it listening on all addresses (for Vite, {flag}), or open it on the computer.', { flag: <code>--host</code> })}</p></div>
          : <Frame key={`${current.port}-${reload}`} src={urlOf(current.port, shown)} title={current.title || t('Port {port}', { port: current.port })} />)}
      </div>
    </div>
  )
}

// An app of a computer that asks for its password (or someone there to allow it) first: a session
// for it (server/remote.js view, source=preview:<port>), open as long as it shows here; its requests
// are let through while it is (mayPreview). onOpen: let in, so its address can be asked for again.
function Granted({ port, name, onOpen, children }) {
  const conn = useRef(null)
  const [st, setSt] = useState({ phase: 'connecting' })
  const [run, setRun] = useState(0)
  useEffect(() => {
    let mine = true // (one closed since, for another, is closed once that one has started)
    setSt({ phase: 'connecting' })
    const c = connect({
      base: BASE, source: `preview:${port}`, page: { w: 390, h: 800 },
      on: {
        hello: () => { setSt({ phase: 'open' }); onOpen() },
        message: (m) => { if (m.t === 'error') setSt({ phase: 'error', why: m.why }); else if (gateOf(m)) setSt({ phase: 'gate', gate: gateOf(m) }) },
        // Closed with nothing said: the link to that computer dropped.
        closed: () => { if (mine) setSt((x) => (x.phase === 'error' || x.phase === 'ended' ? x : { phase: 'ended', why: dropped(name) })) },
      },
    })
    conn.current = c
    return () => { mine = false; c.close(); conn.current = null }
  }, [port, run]) // eslint-disable-line react-hooks/exhaustive-deps
  if (st.phase === 'open') return children
  if (st.phase === 'gate') return <div className="viewer-empty"><Gate gate={st.gate} name={name} onPassword={(p) => conn.current?.send({ t: 'password', p })} onCancel={() => { conn.current?.close(); setSt({ phase: 'ended' }) }} /></div>
  if (st.phase === 'connecting') return <div className="viewer-empty"><Icon name="refresh" size={20} className="spin" /><p>{t('Asking {name} for the app…', { name })}</p></div>
  return <div className="viewer-empty"><Icon name="alert" size={22} /><p>{st.why || t('Not showing the app any more.')}</p><button type="button" className="btn small" onClick={() => setRun((n) => n + 1)}>{st.phase === 'ended' ? t('View again') : t('Try again')}</button></div>
}

function Frame({ src, title }) {
  const ref = useRef(null)
  return <iframe ref={ref} className="preview-frame" src={src} title={title} allow="clipboard-read; clipboard-write; fullscreen" />
}
