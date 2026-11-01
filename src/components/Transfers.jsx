// Files and videos between your computers, and from your phone to one of them (server/transfers.js).
// In Files: Send to… and Copy to this computer on a file or a folder, a file dragged in from another
// device's Files, files sent from this device (a phone's photos and videos, or files dropped from
// the desktop), Places (folders you picked), and how each copy is doing, with where it landed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { api, apiUrl, hostApi, machineId, viaRelay, usePoll } from '../api.js'
import { t } from '../i18n/index.js'
import './transfers.css'

const MB = 1048576
const fmtSize = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= MB ? `${(n / MB).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)
const enc = encodeURIComponent
// Bridge AI's hosted relay carries this much a day for each computer (relay/HOSTED.md), with
// everything else that computer does; a copy bigger than BIG through it says so first.
const HOSTED_DAY = 512 * MB
const BIG = 64 * MB
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/
// This window is on the computer it comes from (the desktop app, or a browser there): "this
// computer" is the one in front of you, and what lands on it can be shown in Finder.
export const atHost = typeof location !== 'undefined' && !viaRelay && LOOPBACK.test(location.hostname)
// A file on another of your devices, shown in a computer's window: it can be copied to that one.
export const canCopyHere = !!machineId && !viaRelay
export const copyHereLabel = () => (atHost ? t('Copy to this computer') : t('Copy to the computer this window is on'))
const revealLabel = () => (/Mac/.test(navigator.userAgent) ? t('Show in Finder') : /Windows/.test(navigator.userAgent) ? t('Show in Explorer') : t('Show in file manager'))
export const changed = () => window.dispatchEvent(new Event('bridge-transfers'))
const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

// ---------- where it goes ----------
// The options for where a copy lands, from that computer's own list: its Downloads, its agents'
// folders, its Places. asks: macOS asks there before Bridge AI can put a file in Downloads the first
// time, which only works with someone at it (here: the person is).
function intoOptions(d, here) {
  if (!d) return []
  const out = []
  if (d.downloads) out.push({ v: 'downloads', label: t('Downloads'), sub: d.downloads.path, off: d.downloads.asks && !here })
  for (const a of d.agents || []) out.push({ v: `pane:${a.pane}`, label: a.label === a.folder ? a.folder : `${a.folder} · ${a.label}`, sub: a.path, group: 'agents' })
  for (const p of d.places || []) out.push({ v: `place:${p.id}`, label: p.name, sub: p.path, group: 'places' })
  return out
}
const intoBody = (v) => (v === 'downloads' ? { where: 'downloads' } : v.startsWith('pane:') ? { where: 'pane', pane: v.slice(5) } : { where: 'place', place: v.slice(6) })
// The first that needs nothing asked: Downloads, else the first agent's folder there.
const firstInto = (opts) => (opts.find((o) => !o.off) || {}).v || null

function IntoField({ opts, value, onChange, device, here, asks }) {
  return (
    <label className="na-field">
      <span className="na-label">{t('Into')}</span>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label={t('Into')}>
        {opts.filter((o) => !o.group).map((o) => <option key={o.v} value={o.v} disabled={o.off}>{o.off ? t('Downloads (macOS asks first, on {name})', { name: device }) : `${o.label} (${o.sub})`}</option>)}
        {opts.some((o) => o.group === 'agents') && <optgroup label={t('Agents\' folders')}>{opts.filter((o) => o.group === 'agents').map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</optgroup>}
        {opts.some((o) => o.group === 'places') && <optgroup label={t('Places')}>{opts.filter((o) => o.group === 'places').map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</optgroup>}
      </select>
      {asks && here && value === 'downloads' && <span className="muted small">{t('macOS asks once before Bridge AI can put files in Downloads.')}</span>}
    </label>
  )
}

function HostedNote({ hosted, total, device }) {
  if (!hosted || !(total > BIG)) return null
  return (
    <p className="xfer-note small" role="note"><Icon name="info" size={12} /> <span>
      {t('This goes through Bridge AI\'s relay, which carries 512 MB a day for {name}, with everything else it does.', { name: device })}
      {total > HOSTED_DAY ? ` ${t('At {size}, it stops when the day\'s allowance runs out and carries on after it resets.', { size: fmtSize(total) })}` : ''}
      {` ${t('For big files, use a relay on your own Cloudflare account (free, no daily limit), or Tailscale.')}`}
    </span></p>
  )
}

// ---------- Send to… and Copy to this computer ----------
// src: { pane, path, name, dir, size } on the device this page shows. here: copied to the computer
// this window is on (it runs the copy, from the device shown); otherwise sent from the device shown
// to one of its others (it runs the copy).
export function SendDialog({ src, here = false, onClose }) {
  const [devices, setDevices] = useState(null)
  const [to, setTo] = useState(null)
  const [plan, setPlan] = useState(null)
  const [err, setErr] = useState(null)
  const [into, setInto] = useState(null)
  const [move, setMove] = useState(false)
  const [busy, setBusy] = useState(false)
  // Its other devices (the one this page shows knows them), online first.
  useEffect(() => {
    if (here) return
    api('/machines').then((d) => {
      const l = (d.machines || []).filter((m) => m.state === 'linked').sort((a, b) => b.online - a.online)
      setDevices(l)
      setTo((x) => x || l.find((m) => m.online)?.id || null)
    }).catch((e) => setErr(e.message))
  }, [here])
  useEffect(() => {
    if (!here && !to) return
    setPlan(null); setErr(null); setInto(null)
    const q = `pane=${enc(src.pane)}&path=${enc(src.path)}`
    const p = here ? hostApi(`/transfers/plan?from=${enc(machineId)}&${q}`) : api(`/transfers/plan?to=${enc(to)}&${q}`)
    let live = true
    p.then((d) => { if (!live) return; setPlan(d); setInto(firstInto(intoOptions(d.destinations, d.here))) }).catch((e) => live && setErr(e.message))
    return () => { live = false }
  }, [here, to, src.pane, src.path])
  const opts = intoOptions(plan?.destinations, plan?.here)
  const device = plan?.device || devices?.find((m) => m.id === to)?.name || ''
  const what = plan?.what
  const total = what?.total ?? src.size ?? 0
  const submit = async (e) => {
    e.preventDefault()
    if (!into) return
    setBusy(true); setErr(null)
    try {
      const body = { src: { pane: src.pane, path: src.path }, into: intoBody(into), move }
      if (here) await hostApi('/transfers', { method: 'POST', body: { ...body, from: machineId } })
      else await api('/transfers', { method: 'POST', body: { ...body, to } })
      changed()
      onClose()
    } catch (x) { setErr(x.message); setBusy(false) }
  }
  const title = here ? t('Copy {name} to this computer', { name: src.name }) : t('Send {name}', { name: src.name })
  const noDevices = !here && devices && !devices.length
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <form className="modal xfer-dialog" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose() } }}>
        <header className="modal-head"><Icon name={here ? 'download' : 'send'} size={15} /><h3>{title}</h3></header>
        <p className="muted small xfer-what">
          {what ? (what.dir ? t('A folder: {n} files, {size}', { n: what.count, size: fmtSize(what.total) }) : fmtSize(what.total)) : src.size != null && !src.dir ? fmtSize(src.size) : ' '}
          {what?.links ? ` · ${t('{n} links in it are left out', { n: what.links })}` : ''}
        </p>
        {noDevices && <p className="small">{t('None of your other devices is linked to this one yet. Link one in Settings › Devices.')}</p>}
        {!here && devices?.length > 0 && (
          <label className="na-field">
            <span className="na-label">{t('To')}</span>
            <select value={to || ''} onChange={(e) => setTo(e.target.value)} aria-label={t('To')}>
              {devices.map((m) => <option key={m.id} value={m.id} disabled={!m.online}>{m.online ? m.name : t('{name} (offline)', { name: m.name })}</option>)}
            </select>
          </label>
        )}
        {plan && <IntoField opts={opts} value={into} onChange={setInto} device={device} here={plan.here} asks={!!plan.destinations?.downloads?.asks} />}
        {!plan && !err && (here || to) && <p className="muted small"><Icon name="refresh" size={11} className="spin" /> {t('Asking {name} where it can go…', { name: device || t('the other device') })}</p>}
        {plan && <HostedNote hosted={plan.hosted} total={total} device={device} />}
        {plan && <label className="xfer-move small"><input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} /> {t('Move it: the original goes to the Trash once the copy is checked')}</label>}
        {err && <p className="error-text small" role="alert">{err}</p>}
        <div className="modal-foot">
          <button type="button" className="btn small" onClick={onClose} disabled={busy}>{t('Cancel')}</button>
          <button type="submit" className="btn small primary" disabled={busy || !plan || !into}>{busy ? t('Starting…') : move ? t('Move') : t('Copy')}</button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

// ---------- files from this device (a phone's photos and videos) ----------
// Sent PIECE at a time, each with its SHA-256 (checked there before it's written), one file after
// another. A dropped connection waits and carries on from what's there; the file stays in this page
// until it's in, so a page that's closed or reloaded can't carry on (it's sent again).
const PIECE = 2 * MB
const uploads = new Map()
const subs = new Set()
const tell = () => { for (const f of subs) f() }
let line = Promise.resolve()
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
async function digest(buf) { try { return crypto?.subtle ? hex(await crypto.subtle.digest('SHA-256', buf)) : null } catch { return null } }

async function call(u, method, p, body) {
  const raw = body instanceof ArrayBuffer
  const r = await fetch(apiUrl(p), { method, signal: u.ctl.signal, headers: raw ? { 'Content-Type': 'application/octet-stream', ...(u.sha ? { 'X-Sha256': u.sha } : {}) } : { 'Content-Type': 'application/json' }, body: raw ? body : body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, code: j.code })
  return j
}
async function sendOne(u) {
  for (let tries = 0; ;) {
    try {
      Object.assign(u, { state: 'going', error: null }); tell()
      const b = await call(u, 'POST', '/transfers/in', { key: u.key, name: u.file.name, files: [{ size: u.file.size }], to: u.into })
      u.inc = b.id
      u.where = b.where
      let at = b.have[0]
      while (at < u.file.size) {
        const buf = await u.file.slice(at, Math.min(u.file.size, at + PIECE)).arrayBuffer()
        u.sha = await digest(buf)
        at = (await call(u, 'PUT', `/transfers/in/${enc(b.id)}/0?at=${at}`, buf)).have
        u.got = at
        tries = 0
        tell()
      }
      await call(u, 'POST', `/transfers/in/${enc(b.id)}/0/done`, {})
      u.result = await call(u, 'POST', `/transfers/in/${enc(b.id)}/done`, {})
      Object.assign(u, { state: 'done', got: u.file.size, file: null }); tell(); changed()
      return
    } catch (e) {
      if (u.ctl.signal.aborted) { u.state = 'stopped'; tell(); return }
      // Turned down there (no room, not allowed, gone): said. Anything else, the connection: again.
      const passing = !e.status || (e.status >= 500 && e.status !== 507) || e.code === 'damaged' || e.status === 408
      if (!passing || ++tries > 8) { Object.assign(u, { state: 'failed', error: e.message, code: e.code || null }); tell(); return }
      Object.assign(u, { state: 'waiting', error: e.message }); tell()
      await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** tries)))
      if (u.ctl.signal.aborted) { u.state = 'stopped'; tell(); return }
    }
  }
}
// files: a FileList or File[]; into: where (as the server takes it); device: what it's called.
export function sendFiles(list, into, device) {
  for (const file of [...list]) {
    const u = { key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, file, name: file.name, size: file.size, got: 0, into, device, state: 'queued', ctl: new AbortController(), at: Date.now() }
    uploads.set(u.key, u)
    line = line.then(() => (u.ctl.signal.aborted ? null : sendOne(u)))
  }
  tell()
}
const stopUpload = (u) => { u.ctl.abort(); if (u.inc) fetch(apiUrl(`/transfers/in/${enc(u.inc)}`), { method: 'DELETE' }).catch(() => {}); u.state = 'stopped'; tell() }
const againUpload = (u) => { if (!u.file) return; u.ctl = new AbortController(); u.state = 'queued'; line = line.then(() => sendOne(u)); tell() }
function useUploads() {
  const [, bump] = useState(0)
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => { subs.delete(f) } }, [])
  return [...uploads.values()]
}

// The sheet for files picked on this device: where they go on the computer (the folder you're in
// in Files, a project, or its Downloads), then Send. folder: { v: 'pane:<id>' | 'place:<id>', dir,
// label } for the folder Files shows.
export function UploadSheet({ list, folder, onClose }) {
  const [plan, setPlan] = useState(null)
  const [err, setErr] = useState(null)
  const [into, setInto] = useState(null)
  useEffect(() => {
    api('/transfers/plan').then((d) => { setPlan(d); setInto(folder?.v || firstInto(intoOptions(d.destinations, d.here))) }).catch((e) => setErr(e.message))
  }, [folder?.v])
  const files = [...list]
  const total = files.reduce((n, f) => n + f.size, 0)
  const device = plan?.device || ''
  // The folder you're in comes first, whether or not an agent works there (a shell's, a place).
  const listed = intoOptions(plan?.destinations, plan?.here)
  const opts = folder?.v && !listed.some((o) => o.v === folder.v) ? [{ v: folder.v, label: folder.label, sub: folder.label }, ...listed] : listed
  const roomy = plan?.destinations?.free == null || total < plan.destinations.free
  const go = (e) => {
    e.preventDefault()
    if (!into) return
    const body = intoBody(into)
    if (folder?.dir && into === folder.v) body.dir = folder.dir
    sendFiles(files, body, device)
    onClose()
  }
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="modal xfer-dialog" onSubmit={go} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
        <header className="modal-head"><Icon name="upload" size={15} /><h3>{files.length === 1 ? t('Send {name} to {device}', { name: files[0].name, device: device || t('the computer') }) : t('Send {n} files to {device}', { n: files.length, device: device || t('the computer') })}</h3></header>
        <p className="muted small xfer-what">{fmtSize(total)}</p>
        {plan && <IntoField opts={opts} value={into} onChange={setInto} device={device} here={plan.here} asks={!!plan.destinations?.downloads?.asks} />}
        {folder?.dir && into === folder.v && <p className="muted small xfer-what">{t('In {folder}', { folder: folder.dir })}</p>}
        {plan && <HostedNote hosted={plan.hosted} total={total} device={device} />}
        {plan && !roomy && <p className="error-text small">{t('There isn\'t room for it on {name}: {free} is free.', { name: device, free: fmtSize(plan.destinations.free) })}</p>}
        {err && <p className="error-text small" role="alert">{err}</p>}
        <div className="modal-foot">
          <button type="button" className="btn small" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="btn small primary" disabled={!plan || !into || !roomy}>{t('Send')}</button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

// ---------- how each copy is doing ----------
// The copies the device this page shows runs and takes in, and (on another device's page, in a
// computer's window) the ones that computer runs, with what this page sent itself.
export function useTransfers() {
  const [rows, setRows] = useState([])
  const busy = useRef(false)
  const load = useCallback(async () => {
    const [shown, host] = await Promise.all([api('/transfers').catch(() => null), canCopyHere ? hostApi('/transfers').catch(() => null) : null])
    const tag = (d, on) => [...(d?.jobs || []), ...(d?.incoming || [])].map((x) => ({ ...x, on }))
    const all = [...tag(host, 'host'), ...tag(shown, 'shown')]
    busy.current = all.some((x) => ['going', 'waiting', 'queued', 'coming'].includes(x.state))
    setRows(all)
  }, [])
  useEffect(() => {
    let timer
    let live = true
    const tick = () => { timer = setTimeout(async () => { if (!document.hidden) await load(); if (live) tick() }, busy.current ? 1000 : 6000) }
    load().then(tick)
    window.addEventListener('bridge-transfers', load)
    return () => { live = false; clearTimeout(timer); window.removeEventListener('bridge-transfers', load) }
  }, [load])
  return { rows, refresh: load }
}

const LIVE = new Set(['going', 'waiting', 'queued', 'coming'])
function Row({ x }) {
  const call = x.on === 'host' ? hostApi : api
  const [msg, setMsg] = useState(null)
  const act = (op) => call(`/transfers/${enc(x.id)}/${op}`, { method: 'POST' }).then((r) => { if (r?.dry) setMsg('shown'); changed() }).catch((e) => setMsg(e.message))
  const pct = x.total ? Math.min(100, Math.round(((x.got || 0) / x.total) * 100)) : 0
  const live = LIVE.has(x.state)
  const where = x.result?.where || x.into
  const name = x.result?.name || x.name || ''
  const sub = (() => {
    if (x.upload) {
      if (x.state === 'done') return t('Sent to {name}, in {where}', { name: x.device || t('the computer'), where: x.result?.where || x.where || '' })
      if (x.state === 'queued') return t('Waiting its turn')
      if (x.state === 'waiting') return t('Waiting for the computer…')
      if (x.state === 'failed') return x.error
      if (x.state === 'stopped') return t('Stopped')
      return t('{got} of {total}', { got: fmtSize(x.got), total: fmtSize(x.size) })
    }
    if (x.state === 'done' && x.kind === 'pull') return t('Copied from {name}, in {where}', { name: x.device, where })
    if (x.state === 'done' && x.kind === 'push') return t('Copied to {name}, in {where}', { name: x.device, where })
    if (x.state === 'done') return x.from || x.fromKind === 'phone' ? t('From {name}, in {where}', { name: x.from || t('your phone'), where }) : t('In {where}', { where })
    if (x.state === 'waiting') return t('Waiting for {name}. It carries on by itself.', { name: x.device })
    if (x.state === 'queued') return t('Waiting its turn')
    if (x.state === 'failed') return x.error
    if (x.state === 'stopped') return t('Stopped')
    if (!x.total) return t('Getting ready…')
    return `${x.kind === 'pull' ? t('From {name}', { name: x.device }) : x.kind === 'push' ? t('To {name}', { name: x.device }) : x.from ? t('From {name}', { name: x.from }) : ''} · ${t('{got} of {total}', { got: fmtSize(x.got || 0), total: fmtSize(x.total) })}`
  })()
  const canReveal = x.state === 'done' && x.here && atHost && (x.on === 'host' || !canCopyHere)
  return (
    <li className={`xfer-row s-${x.state}`} data-id={x.id}>
      <Icon name={x.state === 'done' ? 'check' : x.state === 'failed' ? 'alert' : x.upload ? 'upload' : x.kind === 'push' ? 'send' : 'download'} size={13} />
      <div className="xfer-main">
        <span className="xfer-name" title={x.result?.path || name}>{name}</span>
        <span className="xfer-sub small" role={x.state === 'failed' ? 'alert' : undefined} title={x.state === 'failed' ? sub : undefined}>{sub}</span>
        {x.state === 'done' && x.result?.renamed && <span className="xfer-sub small">{t('Saved as {name}: there was one with its name already.', { name: x.result.name })}</span>}
        {x.note && <span className="xfer-sub small">{x.note}</span>}
        {live && <div className="save-bar xfer-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={name}><span style={{ width: `${pct}%` }} /></div>}
        {msg && msg !== 'shown' && <span className="xfer-sub small error-text">{msg}</span>}
      </div>
      <div className="xfer-acts">
        {canReveal && <button type="button" className="link-btn small" onClick={() => act('reveal')}>{revealLabel()}</button>}
        {!x.upload && (x.state === 'failed' || x.state === 'stopped') && x.kind !== 'in' && <button type="button" className="link-btn small" onClick={() => act('retry')}>{t('Try again')}</button>}
        {x.upload && (x.state === 'failed' || x.state === 'stopped') && x.file && <button type="button" className="link-btn small" onClick={() => againUpload(x.u)}>{t('Try again')}</button>}
        {live && !x.upload && x.kind !== 'in' && <button type="button" className="win-btn" title={t('Stop')} aria-label={t('Stop')} onClick={() => act('stop')}><Icon name="x" size={11} /></button>}
        {live && x.upload && <button type="button" className="win-btn" title={t('Stop')} aria-label={t('Stop')} onClick={() => stopUpload(x.u)}><Icon name="x" size={11} /></button>}
      </div>
    </li>
  )
}

// At the foot of Files: what's going and what just came, a few at a time.
export function TransferStrip() {
  const { rows } = useTransfers()
  const ups = useUploads()
  const shown = useMemo(() => {
    const mine = new Set(ups.map((u) => u.inc).filter(Boolean))
    const list = [
      ...ups.map((u) => ({ id: u.key, upload: true, u, name: u.name, size: u.size, got: u.got, total: u.size, state: u.state, error: u.error, device: u.device, result: u.result, where: u.where, file: u.file, at: u.at })),
      ...rows.filter((x) => !mine.has(x.id)),
    ]
    const now = Date.now()
    return list.filter((x) => LIVE.has(x.state) || now - (x.endedAt || x.at || 0) < 3600e3 || x.upload).sort((a, b) => LIVE.has(b.state) - LIVE.has(a.state) || (b.at || 0) - (a.at || 0)).slice(0, 4)
  }, [rows, ups])
  const done = shown.filter((x) => !LIVE.has(x.state))
  if (!shown.length) return null
  const clear = () => {
    for (const u of ups) if (!LIVE.has(u.state)) uploads.delete(u.key)
    tell()
    Promise.all([api('/transfers/clear', { method: 'POST' }).catch(() => {}), canCopyHere ? hostApi('/transfers/clear', { method: 'POST' }).catch(() => {}) : null]).then(changed)
  }
  return (
    <div className="xfer-strip" aria-label={t('Copies')}>
      <ul>{shown.map((x) => <Row key={`${x.on || 'up'}-${x.id}`} x={x} />)}</ul>
      {done.length > 0 && done.length === shown.length && <button type="button" className="link-btn small xfer-clear" onClick={clear}>{t('Clear')}</button>}
    </div>
  )
}

// ---------- Places ----------
// The root of Files: the agent's folder, or a folder you picked. Added only on the computer itself:
// with the system's folder picker in the desktop app, else (a browser on it) typed, as for a new
// agent. Hidden on a phone and on another device's page, where neither picker is this computer's.
const picker = typeof window !== 'undefined' ? window.bridgeApp?.pickFolder : null
export const canAddPlace = atHost && !machineId
export function usePlaces() {
  const { data, refresh } = usePoll('/places', 30000)
  return { places: data?.places || [], refresh }
}
export function PlacesMenu({ x, y, agentName, agentPath, current, places, onPick, onAdded, onClose }) {
  const ref = useRef(null)
  const [typing, setTyping] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true) }
  }, [onClose])
  const add = async () => {
    setErr(null)
    if (!picker) return setTyping(true)
    const p = await picker(undefined, { place: true }).catch(() => null)
    if (!p) return
    try { const r = await api('/places', { method: 'POST', body: { path: p } }); onAdded(r.place); onClose() } catch (e) { setErr(e.message) }
  }
  const take = async (p) => { await api(`/places/${enc(p.id)}`, { method: 'DELETE' }).catch(() => {}); onAdded(null, p) }
  return createPortal(
    <div className="ctx-menu places-menu" ref={ref} role="menu" style={{ left: Math.max(8, Math.min(x, window.innerWidth - 268)), top: y }}>
      <button role="menuitemradio" aria-checked={!current} onClick={() => { onPick(null); onClose() }}><Icon name={!current ? 'check' : 'folder'} size={13} /><span>{agentName}<small className="muted">{agentPath}</small></span></button>
      {(places.length > 0 || canAddPlace) && <div className="ctx-sep" role="separator" />}
      {(places.length > 0 || canAddPlace) && <div className="places-head">{t('Places')}</div>}
      {places.map((p) => (
        <div key={p.id} className="places-item">
          <button role="menuitemradio" aria-checked={current === p.id} onClick={() => { onPick(p.id); onClose() }} title={p.path}><Icon name={current === p.id ? 'check' : 'folder'} size={13} /><span>{p.name}<small className="muted">{p.path}</small></span></button>
          <button className="places-x" title={t('Take {name} out of Places', { name: p.name })} aria-label={t('Take {name} out of Places', { name: p.name })} onClick={() => take(p)}><Icon name="x" size={11} /></button>
        </div>
      ))}
      {canAddPlace && !typing && <button role="menuitem" onClick={add}><Icon name="plus" size={13} /><span>{t('Add a place…')}</span></button>}
      {typing && <PlaceTyped onAdded={(p) => { onAdded(p); onClose() }} />}
      {err && <p className="error-text small places-err">{err}</p>}
    </div>,
    document.body,
  )
}
// In a browser on this computer (no folder picker that says where a folder is): typed, with this
// computer's folders as you type, as for a new agent.
function PlaceTyped({ onAdded }) {
  const [v, setV] = useState('~/')
  const [dirs, setDirs] = useState([])
  const [err, setErr] = useState(null)
  useEffect(() => { const tm = setTimeout(() => api(`/dirs?q=${enc(v)}`).then((d) => setDirs(d.dirs || [])).catch(() => {}), 150); return () => clearTimeout(tm) }, [v])
  const submit = async (e) => {
    e.preventDefault()
    try { onAdded((await api('/places', { method: 'POST', body: { path: v } })).place) } catch (x) { setErr(x.message) }
  }
  return (
    <form className="places-typed" onSubmit={submit}>
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} list="place-dirs" autoFocus spellCheck={false} aria-label={t('Folder on this computer')} />
      <datalist id="place-dirs">{dirs.map((d) => <option key={d} value={d} />)}</datalist>
      <button type="submit" className="btn small primary">{t('Add')}</button>
      {err && <p className="error-text small">{err}</p>}
    </form>
  )
}

// ---------- dragging between devices ----------
// A file or folder dragged from Files carries where it is: the device (as the computer this window
// is on knows it: null for that computer itself), its pane and path. Dropped on another device's
// Files, that computer copies it.
export const DRAG = 'application/x-bridge-file'
// A pointer drags; a finger's long press stays the phone's own.
export const canDrag = !touch
export const dragData = (e, entry, pane) => {
  e.dataTransfer.setData(DRAG, JSON.stringify({ machine: machineId, pane, path: entry.path, name: entry.name, dir: !!entry.dir, size: entry.size ?? null }))
  e.dataTransfer.setData('text/plain', entry.path)
  e.dataTransfer.effectAllowed = 'copy'
}
// Can a drop land here? Something from another device's Files, or files from the desktop.
export const dropOk = (e) => { const ts = [...(e.dataTransfer?.types || [])]; return ts.includes(DRAG) || ts.includes('Files') }
// A drop on this page's Files (pane, folder dir): from another device, the computer this window is
// on copies it in (when this page is that computer's) or sends it (when it's that computer's file,
// dropped on another device's page). Files from the desktop are sent from this page.
export async function onDrop(e, { pane, dir, device }) {
  const raw = e.dataTransfer.getData(DRAG)
  if (!raw) {
    const list = [...(e.dataTransfer.files || [])]
    if (!list.length) return null
    sendFiles(list, pane.startsWith('place:') ? { where: 'place', place: pane.slice(6), dir } : { where: 'pane', pane, dir }, device)
    return { ok: true }
  }
  let src
  try { src = JSON.parse(raw) } catch { return null }
  if ((src.machine || null) === (machineId || null)) return null // the same device
  const into = pane.startsWith('place:') ? { where: 'place', place: pane.slice(6), dir } : { where: 'pane', pane, dir }
  if (!machineId && src.machine) await hostApi('/transfers', { method: 'POST', body: { from: src.machine, src: { pane: src.pane, path: src.path }, into } })
  else if (machineId && !src.machine) await hostApi('/transfers', { method: 'POST', body: { to: machineId, src: { pane: src.pane, path: src.path }, into } })
  else throw new Error(t('Drag it into this computer\'s Files first, or use Send to… on it.'))
  changed()
  return { ok: true }
}
