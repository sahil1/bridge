import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { viaRelay } from '../api.js'
import { useFix } from './PermissionFix.jsx'

// The top bar's Restart to apply: something you allowed in System Settings (Full Disk Access, say)
// reaches Bridge AI only after it restarts. It stays until then, so you restart when it suits you.
// From a phone it shows, but the restart happens on the computer.
export default function RestartChip({ fleet, runtime }) {
  const { data } = useFix()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const ask = () => setOpen(true)
    window.addEventListener('bridge-restart', ask)
    return () => window.removeEventListener('bridge-restart', ask)
  }, [])
  useEffect(() => {
    if (!open) return
    const down = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key) }
  }, [open])
  const list = data?.restart || []
  if (!list.length) return null
  const allowed = list.filter((r) => !r.settings).map((r) => r.label)
  const changed = list.find((r) => r.settings)?.label
  const what = [allowed.length && `${allowed.join(' and ')} ${allowed.length === 1 ? 'is' : 'are'} on`, changed && `you changed ${changed}`].filter(Boolean).join(', and ')
  const sentence = what.charAt(0).toUpperCase() + what.slice(1)
  const working = (fleet?.agents || []).filter((a) => a.status === 'working').length
  const canRestart = !viaRelay && !!window.bridgeApp?.restart
  const desktopServer = !!data?.app?.desktop
  const restart = async () => { setBusy(true); try { await window.bridgeApp.restart() } catch { setBusy(false) } }
  const cmd = 'npm run stop && npm start'
  return (
    <div className="update-wrap" ref={ref}>
      <button className="top-chip update-chip" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={`${sentence}. Restart Bridge AI to apply it.`}>
        <Icon name="refresh" size={13} /><span className="hide-sm">Restart to apply</span>
      </button>
      {open && (
        <div className="update-pop" role="dialog" aria-label="Restart to apply">
          <div className="update-head"><b>Restart to apply</b></div>
          <p className="small">{sentence}. Bridge AI applies it when it restarts, which takes a few seconds.</p>
          {working > 0 && (runtime === 'herdr'
            ? <p className="small muted">Your agents keep running in herdr meanwhile.</p>
            : (
              <p className="small warn-text">
                {working} agent{working === 1 ? ' is' : 's are'} working and will be interrupted. Claude Code and Codex pick up their conversations after; others start again in the same folder.
              </p>
            ))}
          {viaRelay ? <p className="muted small">Restart Bridge AI on your computer to apply it.</p>
            : canRestart ? (
              <div className="update-acts">
                <button type="button" className="btn small primary" disabled={busy} onClick={restart}><Icon name="refresh" size={12} className={busy ? 'spin' : ''} /> {busy ? 'Restarting…' : 'Restart now'}</button>
                <button type="button" className="ghost-btn" onClick={() => setOpen(false)}>Later</button>
              </div>
            ) : desktopServer ? <p className="muted small">In the Bridge AI app, choose Bridge AI › Quit and Stop Agents, then open it again.</p>
            : (
              <div className="update-acts col">
                <p className="muted small">Restart it from a terminal, in your Bridge AI folder:</p>
                <code className="small">{cmd}</code>
                <div className="update-acts"><button type="button" className="ghost-btn" onClick={() => navigator.clipboard?.writeText(cmd).catch(() => {})}><Icon name="copy" size={12} /> Copy</button></div>
              </div>
            )}
        </div>
      )}
    </div>
  )
}
