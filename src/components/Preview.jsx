// The Preview tab: the app an agent's project serves, like an editor's built-in browser. Lists the
// web servers running from the agent's folder; shows the one you pick, with an address bar. When
// none is running, offers the project's own start commands, run in a terminal tab you can watch.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted } from './layout.jsx'
import { api, usePoll, viaRelay, BASE } from '../api.js'

const enc = encodeURIComponent
// On this computer the app is at localhost; from a phone (over Tailscale) it's this computer's
// address, which works only if the server listens on more than localhost.
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/
const remote = typeof location !== 'undefined' && !LOOPBACK.test(location.hostname)
const urlOf = (port, p = '/') => `http://${remote ? location.hostname : 'localhost'}:${port}${p.startsWith('/') ? p : `/${p}`}`

// A picture of the preview, for the agent. The desktop app takes it from its own window; a
// browser asks to share this tab (once per picture) and crops a frame of it.
async function capture(el) {
  const r = el.getBoundingClientRect()
  if (window.bridgeApp?.capture) {
    const b64 = await window.bridgeApp.capture({ x: r.x, y: r.y, width: r.width, height: r.height })
    if (!b64) throw new Error("Couldn't take the picture")
    return (await fetch(`data:image/png;base64,${b64}`)).blob()
  }
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Pictures can't be taken here. Take a screenshot yourself and paste it into the message box.")
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
  } finally { stream.getTracks().forEach((t) => t.stop()) }
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
  const list = data?.servers || []
  const current = list.find((s) => s.port === picked) || list[0] || null

  // After Start: pick the first new server as soon as it answers (or give up after 90 seconds).
  useEffect(() => {
    if (!waiting || !data) return
    const fresh = list.find((s) => !waiting.known.includes(s.port))
    if (fresh) { setPicked(fresh.port); setWaiting(null); setMsg(null) } else if (Date.now() - waiting.since > 90_000) { setWaiting(null); setMsg({ text: "No server showed up yet. Check its terminal tab: it may need something first, or serve from another folder." }) }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAddress('/'); setShown('/') }, [current?.port])

  const start = async (c) => {
    setBusy(c.command); setMsg(null)
    try {
      const r = await api(`/agents/${enc(pane)}/servers/start`, { method: 'POST', body: { command: c.command } })
      setWaiting({ since: Date.now(), known: list.map((s) => s.port) })
      setMsg({ text: `Started ${c.label} in a terminal tab.`, openId: r.openId })
    } catch (e) { setMsg({ text: e.message, bad: true }) } finally { setBusy(null) }
  }
  const stop = async (s) => {
    if (!window.confirm(`Stop the server on port ${s.port}${s.program ? ` (${s.program})` : ''}?`)) return
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
      if (!res.ok) throw new Error(up.error || 'Upload failed')
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
        <div className="preview-servers" role="tablist" aria-label="Running servers">
          {list.map((s) => (
            <button key={s.port} role="tab" aria-selected={current?.port === s.port} className={`preview-chip ${current?.port === s.port ? 'on' : ''}`} onClick={() => setPicked(s.port)}
              title={`${s.program || 'server'}${s.cwd && s.cwd !== '.' ? ` in ${s.cwd}` : ''}, port ${s.port}`}>
              <span className="preview-dot" />:{s.port}<span className="muted">{s.title || s.program || ''}</span>
            </button>
          ))}
        </div>
        {current && <>
          <form className="preview-address" onSubmit={go}>
            <span className="muted mono small">:{current.port}</span>
            <input className="mono" value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Path" spellCheck={false} />
          </form>
          {onSendToAgent && current.framable !== false && !(remote && current.localOnly) && (
            <button className="btn small" onClick={sendPicture} disabled={busy === 'picture'} title="Take a picture of the app and attach it to a message for the agent">
              <Icon name="image" size={12} /> {busy === 'picture' ? 'Taking…' : 'Send to agent'}
            </button>
          )}
          <button className="win-btn" onClick={() => setReload((k) => k + 1)} title="Reload" aria-label="Reload"><Icon name="refresh" size={13} /></button>
          <a className="win-btn" href={urlOf(current.port, shown)} target="_blank" rel="noreferrer" title="Open in your browser" aria-label="Open in your browser"><Icon name="external" size={13} /></a>
          <button className="win-btn" onClick={() => stop(current)} title="Stop this server" aria-label="Stop this server"><Icon name="stop" size={13} /></button>
        </>}
      </div>
      {msg && (
        <div className={`preview-msg ${msg.bad ? 'bad' : ''}`} role="status">
          {waiting && <Icon name="refresh" size={12} className="spin" />}
          <span>{msg.text}{waiting ? ' Waiting for it to start serving…' : ''}</span>
          {msg.openId && <button className="link-btn" onClick={() => openTab(msg.openId)}>Show the terminal</button>}
        </div>
      )}
      <div className="preview-body" ref={bodyRef}>
        {error && !data && <div className="viewer-empty"><Icon name="alert" size={22} /><p>{error}</p></div>}
        {!data && !error && <div className="pad"><div className="skeleton-rows"><div /><div /></div></div>}
        {data && !current && (
          <div className="viewer-empty preview-empty">
            <Icon name="play" size={24} />
            <p><b>No server is running from this folder.</b></p>
            <p className="muted small">{data.commands?.length ? 'Start one the way this project does:' : "This project doesn't have a start script Bridge AI recognizes. Start its server in a terminal (or ask the agent to), and it shows up here."}</p>
            <Starters />
          </div>
        )}
        {current && (current.framable === false
          ? <div className="viewer-empty"><Icon name="external" size={22} /><p>This app doesn't allow being shown inside another page.</p><a className="btn small" href={urlOf(current.port, shown)} target="_blank" rel="noreferrer">Open it in your browser</a></div>
          : viaRelay
          ? <div className="viewer-empty"><Icon name="phone" size={22} /><p>Previews aren't sent through your relay yet.</p><p className="muted small">Open it on the computer, or through Tailscale.</p></div>
          : remote && current.localOnly
          ? <div className="viewer-empty"><Icon name="phone" size={22} /><p>This server only answers on the computer itself, so it can't be shown on this device.</p><p className="muted small">Restart it listening on all addresses (for Vite, <code>--host</code>), or open it on the computer.</p></div>
          : <Frame key={`${current.port}-${reload}`} src={urlOf(current.port, shown)} title={current.title || `Port ${current.port}`} />)}
      </div>
    </div>
  )
}

function Frame({ src, title }) {
  const ref = useRef(null)
  return <iframe ref={ref} className="preview-frame" src={src} title={title} allow="clipboard-read; clipboard-write; fullscreen" />
}
