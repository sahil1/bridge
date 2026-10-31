import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from './Icon.jsx'
import { api, hostApi, machineId, relayComputers, phoneApp } from '../api.js'
import { t, tx, locale } from '../i18n/index.js'

// Your other devices (server/machines.js): Macs, Windows and Linux computers running Bridge AI,
// linked to this one. The top bar's machine menu switches the window to one (its own Bridge AI,
// at /m/<id>/, through this device), the sidebar lists each one's agents, and Settings › Devices
// links and unlinks them. Lists come from the device this page is served from, which knows where
// each one is, whichever machine the page shows.

const OS_LABEL = { mac: 'Mac', windows: 'Windows', linux: 'Linux' }
export const ago = (iso) => {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  return s < 90 ? t('just now') : s < 3600 ? t('{n} min ago', { n: Math.round(s / 60) }) : s < 86400 ? t('{n} h ago', { n: Math.round(s / 3600) }) : new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })
}
export const machinesChanged = () => window.dispatchEvent(new Event('bridge-machines'))

// Your devices, as the device this page comes from knows them. on: whether to look at all.
export function useMachines(ms = 10000, on = true) {
  const [data, setData] = useState(null)
  const load = useCallback(() => hostApi('/machines').then(setData).catch(() => {}), [])
  useEffect(() => {
    if (!on) return
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, ms)
    window.addEventListener('bridge-machines', load)
    return () => { clearInterval(t); window.removeEventListener('bridge-machines', load) }
  }, [load, ms, on])
  return { data, refresh: load }
}

// An agent on another of your devices, in a tab of this window (RemoteAgent.jsx). Tab ids:
// remote:<device id, or "here" for the device this page comes from>:<its pane id>.
export const isRemote = (id) => typeof id === 'string' && id.startsWith('remote:')
export const remoteId = (machine, pane) => `remote:${machine || 'here'}:${pane}`
export function remoteOf(id) {
  const [, machine, ...pane] = id.split(':')
  return { machine: machine === 'here' ? null : machine, pane: pane.join(':') }
}
// Opens it there (App.jsx), or on a phone, shows that device at the agent.
export const openRemote = (m, a) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: remoteId(m.id, a.paneId), remote: { title: a.title, device: m.name, kind: a.kind } } }))

// The demo (a static site): the same page with ?m=<id>, keeping its other settings (?clean=1).
const demoUrl = (id, agent) => {
  const q = new URLSearchParams(location.search)
  q.delete('m'); q.delete('agent')
  if (id) q.set('m', id)
  if (agent) q.set('agent', agent)
  return `${location.pathname}${q.size ? `?${q}` : ''}`
}

// Show one of your devices (id), or the one this page comes from (null). In a window of its own
// when asked, or while a meeting records here (the page changing would stop it).
export function goMachine(id, { agent, own = false } = {}) {
  const url = import.meta.env.MODE === 'demo' ? demoUrl(id, agent) : `${id ? `/m/${id}` : ''}/${agent ? `?agent=${encodeURIComponent(agent)}` : ''}`
  const recording = document.documentElement.dataset.recording === '1'
  if (own || recording) {
    if (window.bridgeApp?.openMachine) return window.bridgeApp.openMachine(id, agent || null)
    return window.open(url, '_blank')
  }
  location.assign(url)
}

// A device's agents in a few words. Its counts are null until its summary is in (a device that has
// just connected, or one on an older version), which reads as nothing to say.
const counts = (c) => {
  const { blocked, working } = c || {}
  return [blocked && (blocked === 1 ? t('{n} needs you', { n: blocked }) : t('{n} need you', { n: blocked })), working && t('{n} working', { n: working })].filter(Boolean).join(' · ')
}

// ---------- the top bar ----------
// On a phone it's also the way around the phone itself. In the iPhone and Android apps: the other
// computers the phone is paired with, each opened through its own relay (with whether it's online
// when this computer knows it: they're linked), and On this phone, the app's Cloud Agents and its
// start screen. In a browser there's neither (the relay's page is one computer's, and Cloud Agents
// keep their keys in the app), so it's your devices alone, as on a computer.
const bare = (u) => String(u || '').replace(/\/+$/, '')
export function MachineMenu({ phone = false }) {
  const { data } = useMachines()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const down = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  const app = phone ? phoneApp : null
  const linked = (data?.machines || []).filter((m) => m.state === 'linked')
  if (!data || (!linked.length && !machineId && !app)) return null
  const cur = machineId ? linked.find((m) => m.id === machineId) : null
  const needs = linked.filter((m) => m.id !== machineId).reduce((n, m) => n + (m.counts?.blocked || 0), 0)
  // The computers this phone is paired with, besides the one it's connected to.
  const paired = app ? (relayComputers.list?.() || []).filter((c) => !c.current && bare(c.relay) !== bare(data.here.relay)) : []
  const pairedTo = (m) => paired.find((c) => bare(c.relay) === bare(m.relay))
  const pick = (id, own) => { setOpen(false); if (own || id !== machineId) goMachine(id, { own }) }
  const go = (m) => { const c = pairedTo(m); if (c && m.id !== machineId) { setOpen(false); relayComputers.open(c.relay) } else pick(m.id) }
  const row = (key, name, sub, on, here, onClick, id) => (
    <div key={key} className={`mc-row ${here ? 'on' : ''}`}>
      <button type="button" role="menuitem" className="mc-item" onClick={onClick}>
        <span className={`mc-dot ${on === true ? 'on' : on == null ? 'unknown' : ''}`} />
        <span className="mc-text"><b>{name}</b><small>{sub}</small></span>
        {here && <Icon name="check" size={13} />}
      </button>
      {!here && id && window.bridgeApp?.openMachine && <button type="button" className="win-btn" onClick={() => pick(id, true)} aria-label={t('Open {name} in a window of its own', { name })} title={t('In a window of its own')}><Icon name="popout" size={13} /></button>}
    </div>
  )
  const close = (fn) => () => { setOpen(false); fn() }
  return (
    <div className="mc-wrap" ref={ref}>
      <button type="button" className={`mc-chip ${machineId ? 'remote' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={t('Your devices')}>
        <Icon name="laptop" size={phone ? 16 : 13} />
        <span className="mc-name">{cur ? cur.name : data.here.name}</span>
        {needs > 0 && <span className="mc-needs" title={needs === 1 ? t('{n} on your other devices needs you', { n: needs }) : t('{n} on your other devices need you', { n: needs })}>{needs}</span>}
        <Icon name="down" size={11} />
      </button>
      {open && (
        <div className={`menu left mc-menu ${phone ? 'phone' : ''}`} role="menu" aria-label={t('Your devices')}>
          <div className="mc-head">{t('Your devices')}</div>
          {row('here', data.here.name, `${OS_LABEL[data.here.os] || ''}${machineId ? '' : ` · ${t('this one')}`}`, true, !machineId, () => pick(null))}
          {linked.map((m) => row(m.id, m.name, [OS_LABEL[m.os], m.online ? counts(m.counts) || t('Online') : m.lastSeen ? t('Offline, seen {when}', { when: ago(m.lastSeen) }) : t('Offline')].filter(Boolean).join(' · '), m.online, m.id === machineId, () => go(m), m.id))}
          {paired.filter((c) => !linked.some((m) => bare(m.relay) === bare(c.relay))).map((c) => row(c.relay, c.name, t('Paired on this phone'), null, false, close(() => relayComputers.open(c.relay))))}
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={close(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'machines' } })))}>
            <Icon name="link" size={13} /> {t('Link a device…')}
          </button>
          {app && (
            <>
              <div className="menu-sep" />
              <div className="mc-head">{t('On this phone')}</div>
              {app.cloud && <button type="button" role="menuitem" className="menu-item" onClick={close(app.cloud)}><Icon name="cloud" size={13} /> {t('Cloud Agents')}</button>}
              <button type="button" role="menuitem" className="menu-item" onClick={close(app.start)} title={t('Back to the start: pair or open a computer')}><Icon name="phone" size={13} /> {t('Start screen')}</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- the sidebar ----------
const rank = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 }
export function RailMachines() {
  const { data } = useMachines()
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('cc-rail-machines') !== '0' } catch { return true } })
  const [own, setOwn] = useState(null) // the device this page comes from, while it shows another
  useEffect(() => {
    if (!machineId) return
    const load = () => hostApi('/machines/summary').then(setOwn).catch(() => {})
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, 15000)
    return () => clearInterval(t)
  }, [])
  const fold = (v) => { setOpen(v); try { localStorage.setItem('cc-rail-machines', v ? '1' : '0') } catch { /* no storage */ } }
  const rows = [
    ...(machineId && own ? [{ id: null, name: own.name, os: own.os, online: true, state: 'linked', counts: own.counts, agents: own.agents }] : []),
    ...(data?.machines || []).filter((m) => m.state === 'linked' && m.id !== machineId),
  ]
  if (!rows.length) return null
  const needs = rows.reduce((n, m) => n + (m.counts?.blocked || 0), 0)
  return (
    <div className="rail-machines">
      <div className="rail-nav-row">
        <button type="button" className="rail-nav-btn" onClick={() => fold(!open)}>
          <Icon name="laptop" size={14} /> {t('Devices')}{needs > 0 && <span className="rm-badge" title={needs === 1 ? t('{n} needs you', { n: needs }) : t('{n} need you', { n: needs })}>{needs}</span>}
        </button>
        <button type="button" className="rail-nav-fold" onClick={() => fold(!open)} aria-expanded={open} aria-label={open ? t('Hide your devices') : t('Show your devices')}>
          <Icon name="down" size={12} className={open ? '' : 'rot-up'} />
        </button>
      </div>
      {open && rows.map((m) => {
        const agents = [...(m.agents || [])].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)).slice(0, 6)
        const total = m.agents?.length || 0
        return (
          <div key={m.id || 'here'} className={`rmc ${m.online ? '' : 'off'}`}>
            <div className="rmc-top">
              <button type="button" className="rmc-head" onClick={() => goMachine(m.id)} title={m.online ? t('Show {name}', { name: m.name }) : t('{name} is offline', { name: m.name })}>
                <span className={`mc-dot ${m.online ? 'on' : ''}`} />
                <span className="rmc-name">{m.name}</span>
                <span className="rmc-sub muted">{m.online ? counts(m.counts) || (total ? (total === 1 ? t('{n} agent', { n: total }) : t('{n} agents', { n: total })) : t('No agents')) : t('Offline')}</span>
              </button>
              {m.online && <button type="button" className="rmc-win" onClick={() => goMachine(m.id, { own: true })} aria-label={t('Open {name} in a window of its own', { name: m.name })} title={t('Open {name} in a window of its own, beside this one', { name: m.name })}><Icon name="popout" size={12} /></button>}
            </div>
            {m.online && agents.map((a) => (
              <button type="button" key={a.paneId} className="rmc-agent" onClick={() => openRemote(m, a)} title={t('{title} · {kind} on {name}. Opens in a tab here', { title: a.title, kind: a.kindLabel || a.kind, name: m.name })}>
                <StatusDot status={a.status} size={7} />
                <span className="rmc-title">{a.title}</span>
              </button>
            ))}
            {m.online && total > agents.length && <button type="button" className="rmc-more link-btn small" onClick={() => goMachine(m.id)}>{t('All {n} agents', { n: total })}</button>}
          </div>
        )
      })}
    </div>
  )
}

// ---------- another device asking to link with the one shown ----------
export function AskBanner() {
  const [asks, setAsks] = useState([])
  const [err, setErr] = useState(null)
  useEffect(() => {
    const load = () => api('/machines').then((d) => setAsks(d.asks || [])).catch(() => {})
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, 5000)
    window.addEventListener('bridge-machines', load)
    return () => { clearInterval(t); window.removeEventListener('bridge-machines', load) }
  }, [])
  if (!asks.length) return relayComputers ? <LinkOffer /> : null
  const answer = async (id, allow) => {
    setErr(null)
    try { setAsks((await api(`/machines/asks/${encodeURIComponent(id)}`, { method: 'POST', body: { allow } })).asks || []); machinesChanged() } catch (e) { setErr(e.message) }
  }
  return (
    <div className="ask-banner" role="alert">
      {asks.map((a) => (
        <div key={a.id} className="ask-row">
          <Icon name="link" size={14} />
          <span><b>{a.name}</b> asks to link with this device. Allow it only if {a.name} shows <b className="ask-code">{a.code}</b>.</span>
          <span className="ask-btns">
            <button type="button" className="btn small primary" onClick={() => answer(a.id, true)}>{t('Allow')}</button>
            <button type="button" className="btn small" onClick={() => answer(a.id, false)}>{t('Turn down')}</button>
          </span>
        </div>
      ))}
      {err && <p className="error-text small">{err}</p>}
    </div>
  )
}

// ---------- a phone paired with two computers: link them in a tap ----------
// In the iPhone and Android apps, which know every computer they're paired with: scan a new
// computer's Pair a device code, and the app offers to link it with the others. The computer shown
// asks the other one; you open that one here and allow it, after checking both show the same digits.
const SKIP = 'cc-link-offer-skip'
function LinkOffer() {
  const { data } = useMachines(8000)
  const [skip, setSkip] = useState(() => { try { return JSON.parse(localStorage.getItem(SKIP)) || [] } catch { return [] } })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  if (!data?.here?.relay || machineId) return null
  const mine = data.machines || []
  const phone = relayComputers.list() || []
  // Asked already: open the other one here to allow it.
  const waiting = mine.find((m) => m.state === 'asking' && phone.some((c) => c.relay === m.relay))
  if (waiting) {
    return (
      <div className="ask-banner" role="status">
        <div className="ask-row">
          <Icon name="link" size={14} />
          <span>{waiting.code ? t('Asked {name} to link. Open {name} on this phone and allow it there: both show {code}.', { name: waiting.name, code: waiting.code }) : t('Asked {name} to link. It shows there as soon as {name} is online.', { name: waiting.name })}</span>
          <span className="ask-btns"><button type="button" className="btn small primary" onClick={() => relayComputers.open(waiting.relay)}>{t('Open {name}', { name: waiting.name })}</button></span>
        </div>
      </div>
    )
  }
  const c = phone.find((x) => !x.current && x.relay !== data.here.relay && !skip.includes(x.relay) && !mine.some((m) => m.relay === x.relay && ['linked', 'asking'].includes(m.state)))
  if (!c) return null
  const link = async () => {
    setBusy(true)
    setErr(null)
    try { await hostApi('/machines/ask', { method: 'POST', body: { relay: c.relay, name: c.name } }); machinesChanged() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const later = () => { const next = [...skip, c.relay]; setSkip(next); try { localStorage.setItem(SKIP, JSON.stringify(next)) } catch { /* no storage */ } }
  return (
    <div className="ask-banner" role="status">
      <div className="ask-row">
        <Icon name="link" size={14} />
        <span>{t('This phone is paired with {name} too. Link {name} and {here}, so each shows the other\'s agents?', { name: c.name, here: data.here.name })}</span>
        <span className="ask-btns">
          <button type="button" className="btn small primary" disabled={busy} onClick={link}>{busy ? t('Asking…') : t('Link them')}</button>
          <button type="button" className="btn small" onClick={later}>{t('Not now')}</button>
        </span>
      </div>
      {err && <p className="error-text small">{err}</p>}
    </div>
  )
}

// ---------- a device's details ----------
const RUNTIME = { herdr: 'herdr', builtin: tx("Bridge AI's own terminals") }
const onFor = (s) => (s >= 86400 ? (Math.floor(s / 86400) === 1 ? t('{n} day', { n: 1 }) : t('{n} days', { n: Math.floor(s / 86400) }))
  : s >= 3600 ? (Math.floor(s / 3600) === 1 ? t('{n} hour', { n: 1 }) : t('{n} hours', { n: Math.floor(s / 3600) }))
    : t('{n} min', { n: Math.max(1, Math.round(s / 60)) }))
// What's known about a device (its system, chip, memory, versions, relay, security code), and its
// name to change. The name is changed on that device itself, so it's the same everywhere: in its
// own Bridge AI, on your other devices and on your phones. here: this device.
function DeviceDetails({ m, here = false, onChanged }) {
  const [name, setName] = useState(m.name)
  const [st, setSt] = useState(null) // 'saving' | 'saved' | { error }
  useEffect(() => { if (st !== 'saving') setName(m.name) }, [m.name]) // eslint-disable-line react-hooks/exhaustive-deps
  const a = m.about || {}
  const canRename = here || (m.state === 'linked' && m.online)
  const save = async (e) => {
    e.preventDefault()
    setSt('saving')
    try {
      await hostApi(here ? '/machines/name' : `/machines/${encodeURIComponent(m.id)}/name`, { method: 'POST', body: { name: name.trim() } })
      setSt('saved')
      onChanged?.()
    } catch (x) { setSt({ error: x.message }) }
  }
  const date = (iso) => new Date(iso).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' })
  const rows = [
    [t('System'), [a.system, a.arch].filter(Boolean).join(' · ')],
    [t('Chip'), a.chip && (a.cores ? `${a.chip} · ${t('{n} cores', { n: a.cores })}` : a.chip)],
    [t('Memory'), a.memory && `${Math.round(a.memory / 2 ** 30)} GB`],
    [t('On for'), a.uptime && onFor(a.uptime)],
    ['Bridge AI', m.version],
    [t('Agents run in'), a.runtime && t(RUNTIME[a.runtime] || a.runtime)],
    [t('Host name'), a.host],
    [t('Relay'), m.relay && <code>{m.relay}</code>],
    [t('Linked'), !here && m.addedAt && date(m.addedAt)],
    [t('Last seen'), !here && !m.online && m.lastSeen && ago(m.lastSeen)],
    [t('Security code'), m.safety && <code>{m.safety}</code>],
  ].filter(([, v]) => v)
  return (
    <div className="mch-about">
      <form className="mch-name" onSubmit={save}>
        <label htmlFor={`mch-name-${m.id || 'here'}`}>{t('Name')}</label>
        <input id={`mch-name-${m.id || 'here'}`} className="st-input" value={name} maxLength={60} disabled={!canRename || st === 'saving'} placeholder={m.systemName || ''}
          onChange={(e) => { setName(e.target.value); setSt(null) }} />
        <button type="submit" className="btn small" disabled={!canRename || st === 'saving' || name.trim() === m.name}>{st === 'saving' ? t('Saving…') : t('Rename')}</button>
      </form>
      <p className="muted small">
        {!canRename ? t('{name} is offline. Rename it once it\'s back, or in Bridge AI on {name}.', { name: m.name })
          : st === 'saved' ? t('Renamed. Your other devices show the new name within a few seconds.')
            : here ? t('How your other devices and phones show this one. Leave it empty for the computer\'s own name.') : t('Changed on {name} itself, so it\'s the same everywhere. Leave it empty for the computer\'s own name.', { name: m.name })}
      </p>
      {st?.error && <p className="error-text small">{st.error}</p>}
      {rows.length > 0 && <dl className="mch-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {m.safety && <p className="muted small">{here ? t('Your other devices show this security code for this one. If one shows a different code, it isn\'t linked to this device.') : t('On {name}, Settings › Devices › Details shows the same code. If it doesn\'t, link again.', { name: m.name })}</p>}
    </div>
  )
}

// ---------- Settings › Devices: your devices ----------
// embedded: its sections go straight into the Devices tab. focus: scrolled to on opening
// (from the devices menu's Link a device…).
export function MachinesSettings({ embedded = false, focus = false }) {
  const { data, refresh } = useMachines(4000)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [fixes, setFixes] = useState({}) // device id -> what Fix found ({ steps, online }), or 'checking'
  const [shown, setShown] = useState(null) // the device whose details are open ('here': this one)
  // Opened at your devices: in view at the top, and kept there while what's above it (the relay,
  // Tailscale) loads and grows, until you scroll yourself.
  const [top, setTop] = useState(null)
  useEffect(() => {
    if (!focus || !top) return
    const box = top.closest('.st-scroll')
    const go = () => top.scrollIntoView({ block: 'start' })
    go()
    const ro = new ResizeObserver(go)
    ro.observe(top.parentElement)
    const stop = () => ro.disconnect()
    const t = setTimeout(stop, 3000)
    box?.addEventListener('wheel', stop, { once: true })
    box?.addEventListener('touchstart', stop, { once: true })
    return () => { clearTimeout(t); ro.disconnect(); box?.removeEventListener('wheel', stop); box?.removeEventListener('touchstart', stop) }
  }, [focus, top])
  const run = async (what, fn) => {
    setBusy(what); setMsg(null)
    try { const r = await fn(); refresh(); machinesChanged(); return r } catch (e) { setMsg({ error: true, text: e.message }) } finally { setBusy(null) }
  }
  if (!data) return <div className="skeleton-rows pad"><div /><div /></div>
  const Wrap = embedded ? Fragment : 'div'
  const list = data.machines || []
  const add = (e) => {
    e.preventDefault()
    const v = link.trim()
    if (!v) return
    run('add', async () => {
      const r = await hostApi('/machines', { method: 'POST', body: { link: v } })
      setLink('')
      setMsg({ text: r.machine?.state !== 'asking' ? t('Linked with {name}.', { name: r.machine?.name }) : r.machine.code ? t('Asked. Allow it on {name} if it shows {code}.', { name: r.machine.name, code: r.machine.code }) : t('Asked. It shows on {name} as soon as it\'s online; allow it there.', { name: r.machine.name }) })
    })
  }
  // The phone's other computers (the iPhone and Android apps): link them in one tap.
  const phoneOthers = (relayComputers?.list?.() || []).filter((c) => !c.current && c.relay !== data.here.relay && !list.some((m) => m.relay === c.relay && m.state === 'linked'))
  const askAgain = (m) => run('ask', () => hostApi('/machines/ask', { method: 'POST', body: { relay: m.relay, name: m.name } }))
  // Fix: where the connection stops, starting it over on the way.
  const fix = async (m) => {
    setFixes((f) => ({ ...f, [m.id]: 'checking' }))
    try { const r = await hostApi(`/machines/${encodeURIComponent(m.id)}/check`, { method: 'POST' }); setFixes((f) => ({ ...f, [m.id]: r })) } catch (e) { setFixes((f) => ({ ...f, [m.id]: { steps: [{ ok: false, text: e.message }] } })) }
    refresh()
    machinesChanged()
  }
  const strays = data.strays || []
  return (
    <Wrap {...(embedded ? {} : { className: 'st-sections' })}>
      <section className="st-sec" id="st-machines" ref={setTop}>
        <h4>{t('Your devices')}</h4>
        {machineId && <p className="small">{t('These are the links of {name}, the device this window runs on.', { name: data.here.name })}</p>}
        <p className="muted small">{t("Link your other computers running Bridge AI (Mac, Windows or Linux) and switch between them from the top bar, with each one's agents in the sidebar. A phone paired with any of them reaches them all. Each device is reached through its own relay, end-to-end encrypted.")}</p>
        <div className="mch-list">
          <div className="mch-row here">
            <span className="mc-dot on" />
            <div className="mch-main"><b>{data.here.name}</b><small className="muted">{OS_LABEL[data.here.os]} · Bridge AI {data.here.version} · {t('this device')}</small></div>
            <span className="mch-btns"><button type="button" className="ghost-btn small" aria-expanded={shown === 'here'} onClick={() => setShown(shown === 'here' ? null : 'here')}>{t('Details')}</button></span>
            {shown === 'here' && <DeviceDetails m={data.here} here onChanged={() => { refresh(); machinesChanged() }} />}
          </div>
          {list.map((m) => (
            <div key={m.id} className="mch-row">
              <span className={`mc-dot ${m.online ? 'on' : ''}`} />
              <div className="mch-main">
                <b>{m.name}</b>
                <small className="muted">
                  {[OS_LABEL[m.os], m.version && `Bridge AI ${m.version}`,
                    m.state === 'linked' ? (m.online ? counts(m.counts) || t('Online') : m.lastSeen ? t('Offline, seen {when}', { when: ago(m.lastSeen) }) : t('Offline'))
                      : m.state === 'asking' ? t('Waiting for you to allow it there')
                        : m.state === 'denied' ? t('Turned down there')
                          : m.state === 'removed' ? t('It unlinked this device') : m.state === 'changed' ? t('Its key changed') : m.state === 'expired' ? t('The ask expired') : t('Linking…')].filter(Boolean).join(' · ')}
                </small>
                {m.state === 'asking' && m.code && <small>On {m.name}, allow it if it shows <b className="ask-code">{m.code}</b>.</small>}
                {m.error && m.state === 'linked' && !m.online && !fixes[m.id] && <small className="muted">{m.error}</small>}
                {m.state === 'changed' && <small className="muted">{t('{name} doesn\'t have the key it was linked with: it was set up again, or something is in between. On {name}, choose Pair a device and paste its link in Link a device below, to check it\'s really {name}.', { name: m.name })}</small>}
                {m.state === 'removed' && <small className="muted">{t('{name} forgot this device. Link again asks it; allow it there after checking both show the same six digits.', { name: m.name })}</small>}
                {fixes[m.id] === 'checking' && <small className="muted"><Icon name="refresh" size={11} className="spin" /> {t('Checking each step to {name}…', { name: m.name })}</small>}
                {fixes[m.id] && fixes[m.id] !== 'checking' && (
                  <ul className="mch-fix" aria-label={t('What Fix found')}>
                    {fixes[m.id].steps.map((x, i) => <li key={i} className={x.ok ? 'ok' : 'no'}><Icon name={x.ok ? 'check' : 'alert'} size={11} /> <span>{x.text}</span></li>)}
                    {fixes[m.id].online && <li className="ok"><b>{t('Back online.')}</b></li>}
                  </ul>
                )}
              </div>
              <span className="mch-btns">
                {m.state === 'linked' && <button type="button" className="btn small" disabled={!m.online} onClick={() => goMachine(m.id)}>{t('Open')}</button>}
                {m.state === 'linked' && <button type="button" className="btn small" disabled={!m.online} onClick={() => goMachine(m.id, { own: true })} title={t('Open {name} in a window of its own, beside this one', { name: m.name })}><Icon name="popout" size={12} /> {t('New window')}</button>}
                {m.state === 'linked' && <button type="button" className="ghost-btn small" aria-expanded={shown === m.id} onClick={() => setShown(shown === m.id ? null : m.id)}>{t('Details')}</button>}
                {m.state === 'asking' && relayComputers?.list?.().some((c) => c.relay === m.relay) && <button type="button" className="btn small" onClick={() => relayComputers.open(m.relay)}>{t('Go to {name}', { name: m.name })}</button>}
                {m.state === 'linked' && !m.online && <button type="button" className="btn small" disabled={fixes[m.id] === 'checking'} onClick={() => fix(m)}>{t('Fix')}</button>}
                {['denied', 'expired'].includes(m.state) && <button type="button" className="btn small" disabled={!!busy} onClick={() => askAgain(m)}>{t('Ask again')}</button>}
                {m.state === 'removed' && <button type="button" className="btn small primary" disabled={!!busy} onClick={() => askAgain(m)}>{t('Link again')}</button>}
                <button type="button" className="ghost-btn small" disabled={!!busy} onClick={() => run('remove', () => hostApi(`/machines/${encodeURIComponent(m.id)}`, { method: 'DELETE' }))}>{m.state === 'linked' ? t('Unlink') : t('Remove')}</button>
              </span>
              {shown === m.id && <DeviceDetails m={m} onChanged={() => { refresh(); machinesChanged() }} />}
            </div>
          ))}
          {strays.map((d) => (
            <div key={d.id} className="mch-row">
              <span className={`mc-dot ${d.connected ? 'on' : ''}`} />
              <div className="mch-main">
                <b>{d.name}</b>
                <small className="muted">{t('Reaches this device, but this one isn\'t linked back')}</small>
              </div>
              <span className="mch-btns">
                <button type="button" className="btn small" disabled={!!busy} onClick={() => askAgain(d)}>{t('Link back')}</button>
                <button type="button" className="ghost-btn small" disabled={!!busy} onClick={() => run('remove', () => hostApi(`/relay/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE' }))}>{t('Remove')}</button>
              </span>
            </div>
          ))}
        </div>
      </section>

      {phoneOthers.length > 0 && (
        <section className="st-sec">
          <h4>{t('Also on this phone')}</h4>
          <p className="muted small">{t('This phone is paired with these computers too. Link one and it asks there; allow it on that computer (open it from here) after checking both show the same six digits.')}</p>
          {phoneOthers.map((c) => (
            <div key={c.relay} className="mch-row">
              <span className="mc-dot" />
              <div className="mch-main"><b>{c.name}</b></div>
              <button type="button" className="btn small primary" disabled={!!busy} onClick={() => run('ask', () => hostApi('/machines/ask', { method: 'POST', body: { relay: c.relay, name: c.name } }))}>{t('Link')}</button>
            </div>
          ))}
        </section>
      )}

      <section className="st-sec">
        <h4>{t('Link a device')}</h4>
        <p className="muted small">{t('On the other device, open Settings › Devices and choose Pair a device. Paste its link here, or type its address and code. Its address alone asks instead, and waits for you to allow it there.')}</p>
        <form className="mch-add" onSubmit={add}>
          <input className="st-input" value={link} onChange={(e) => setLink(e.target.value)} placeholder={t('Link, or address and code')} aria-label={t("The other device's link")} />
          <button type="submit" className="btn primary" disabled={!link.trim() || !!busy}>{busy === 'add' ? t('Linking…') : t('Link')}</button>
        </form>
        {data.canBeLinked && !machineId
          ? <p className="muted small">{t('To link this device from another one, choose Pair a device at the top of this page and use its link or code there.')}</p>
          : !data.canBeLinked && <p className="muted small">{t("Other devices reach this one through its relay, which isn't set up yet: sign in to Cloudflare (or use Bridge AI's relay) at the top of this page. It can still link to them.")}</p>}
        {msg && <p className={`small ${msg.error ? 'error-text' : 'muted'}`}>{msg.text}</p>}
      </section>
    </Wrap>
  )
}
