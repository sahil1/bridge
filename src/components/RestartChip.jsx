import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { viaRelay } from '../api.js'
import { useFix } from './PermissionFix.jsx'
import { keepReturn } from '../permissions.js'
import { t } from '../i18n/index.js'

// The top bar's Restart to apply: something you allowed in System Settings (Full Disk Access, say)
// reaches Bridge AI only after it restarts. It stays until then, so you restart when it suits you.
// From a phone it shows, but the restart happens on the computer. Agents keep running through it
// (keep: in the terminal host), unless Keep agents running is off. line: on a phone, a line under the
// top bar (TopNotes.jsx) that says what it's for.
export default function RestartChip({ fleet, runtime, keep, line = false }) {
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
  const on = allowed.length ? allowed.reduce((a, b) => t('{list} and {last}', { list: a, last: b })) : ''
  const what = allowed.length && changed
    ? (allowed.length === 1 ? t('{list} is on, and you changed {setting}', { list: on, setting: changed }) : t('{list} are on, and you changed {setting}', { list: on, setting: changed }))
    : allowed.length ? (allowed.length === 1 ? t('{list} is on', { list: on }) : t('{list} are on', { list: on }))
      : changed ? t('you changed {setting}', { setting: changed }) : ''
  const sentence = what.charAt(0).toUpperCase() + what.slice(1)
  const working = (fleet?.agents || []).filter((a) => a.status === 'working').length
  const canRestart = !viaRelay && !!window.bridgeApp?.restart
  const desktopServer = !!data?.app?.desktop
  // Where a permission was asked for, to come back to after (src/permissions.js).
  const restart = async () => { setBusy(true); keepReturn(); try { await window.bridgeApp.restart() } catch { setBusy(false) } }
  const cmd = 'npm run stop && npm start'
  return (
    <div className="update-wrap" ref={ref}>
      {line ? (
        <button type="button" className="top-note restart-note" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon name="refresh" size={14} /><span className="top-note-text">{t('{what}. Restart Bridge AI to apply it.', { what: sentence })}</span><Icon name="chevron" size={13} className="top-note-go" />
        </button>
      ) : (
        <button className="top-chip update-chip" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('{what}. Restart Bridge AI to apply it.', { what: sentence })}>
          <Icon name="refresh" size={13} /><span className="hide-sm">{t('Restart to apply')}</span>
        </button>
      )}
      {open && (
        <div className="update-pop" role="dialog" aria-label={t('Restart to apply')}>
          <div className="update-head"><b>{t('Restart to apply')}</b></div>
          <p className="small">{t('{what}. Bridge AI applies it when it restarts, which takes a few seconds.', { what: sentence })}</p>
          {working > 0 && (runtime === 'herdr' || keep
            ? <p className="small muted">{runtime === 'herdr' ? t('Your agents keep running in herdr meanwhile.') : t('Your agents keep running meanwhile.')}</p>
            : (
              <p className="small warn-text">
                {working === 1
                  ? t('{n} agent is working and will be interrupted. Claude Code and Codex pick up their conversations after; others start again in the same folder.', { n: working })
                  : t('{n} agents are working and will be interrupted. Claude Code and Codex pick up their conversations after; others start again in the same folder.', { n: working })}
              </p>
            ))}
          {viaRelay ? <p className="muted small">{t('Restart Bridge AI on your computer to apply it.')}</p>
            : canRestart ? (
              <div className="update-acts">
                <button type="button" className="btn small primary" disabled={busy} onClick={restart}><Icon name="refresh" size={12} className={busy ? 'spin' : ''} /> {busy ? t('Restarting…') : t('Restart now')}</button>
                <button type="button" className="ghost-btn" onClick={() => setOpen(false)}>{t('Later')}</button>
              </div>
            ) : desktopServer ? <p className="muted small">{t('Open the Bridge AI app and choose Restart now there.')}</p>
            : (
              <div className="update-acts col">
                <p className="muted small">{t('Restart it from a terminal, in your Bridge AI folder:')}</p>
                <code className="small">{cmd}</code>
                <div className="update-acts"><button type="button" className="ghost-btn" onClick={() => navigator.clipboard?.writeText(cmd).catch(() => {})}><Icon name="copy" size={12} /> {t('Copy')}</button></div>
              </div>
            )}
        </div>
      )}
    </div>
  )
}
