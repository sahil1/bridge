// Another of your computers' screen, here (Remote Screen and Preview, a Beta Feature): live,
// peer-to-peer when the network allows it, else as pictures through the relay (said, as it's
// slower), and controlled from here once that computer allows it and you choose Control. That
// computer shows it's being seen the whole time, with Stop, and keeps a record of it.
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { useMedia } from '../layout.jsx'
import { t, tn } from '../../i18n/index.js'
import { baseFor, remoteStatus, connect, pointOn } from './remote.js'
import { SWAP, swapsKeys, RATE } from '../../../shared/remote.js'
import './remote.css'

const HERE = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'mac' : /Win/.test(navigator.platform || '') ? 'windows' : 'linux'

export default function ScreenView({ machine, name, onClose }) {
  const phone = useMedia('(max-width: 760px)')
  const base = baseFor(machine)
  const [st, setSt] = useState(null) // that computer's word on its screen (GET /api/remote)
  const [err, setErr] = useState(null) // { why, code }: nothing to show, and why
  const [source, setSource] = useState('') // 'screen:<id>' | 'window:<id>' | '' (its main screen)
  const [run, setRun] = useState(0)
  const [sess, setSess] = useState({ phase: 'loading' }) // phase: loading | connecting | live | ended; mode: p2p | relay; hello
  const [paused, setPaused] = useState(false)
  const [note, setNote] = useState(null) // { text, bad }
  const [controlling, setControlling] = useState(false)
  const [swap, setSwap] = useState(null) // null: as the two systems differ
  const [size, setSize] = useState({ w: 0, h: 0 })
  const video = useRef(null)
  const img = useRef(null)
  const stage = useRef(null)
  const conn = useRef(null)
  const lastUrl = useRef(null)
  const held = useRef(new Set())
  const buttons = useRef(new Set())

  useEffect(() => {
    let live = true
    setErr(null)
    remoteStatus(base, { sources: true }).then((d) => { if (!live) return; setSt(d); if (!d.screen?.can) setErr({ why: d.screen?.why || t("{name}'s screen can't be seen from here.", { name }), code: d.screen?.code }) },
      (e) => live && setErr({ why: e.message === 'update' ? t('Update Bridge AI on {name} to see its screen from here.', { name }) : e.message }))
    return () => { live = false }
  }, [base, name, run])

  const show = (f) => {
    const el = img.current
    if (!el) return
    const url = URL.createObjectURL(new Blob([f.bytes], { type: f.type || 'image/jpeg' }))
    el.onload = () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); lastUrl.current = url; conn.current?.ack() }
    el.onerror = () => { URL.revokeObjectURL(url); conn.current?.ack() }
    el.src = url
    if (f.w && f.h) setSize((s) => (s.w === f.w && s.h === f.h ? s : { w: f.w, h: f.h }))
  }
  const onMessage = (m) => {
    if (m.t === 'size' && m.w && m.h) setSize({ w: m.w, h: m.h })
    else if (m.t === 'paused') { setPaused(true); clearTimeout(onMessage.pause); onMessage.pause = setTimeout(() => setPaused(false), Number(m.ms) || 3000) }
    else if (m.t === 'control') { setSess((x) => ({ ...x, hello: x.hello && { ...x.hello, control: { on: !!m.on, allowed: !!m.allowed, why: m.why || null } } })); if (!m.allowed) setControlling(false) }
    else if (m.t === 'clip') {
      const text = String(m.text ?? '')
      navigator.clipboard?.writeText(text).then(() => setNote({ text: t("Copied {name}'s clipboard here ({n} characters).", { name, n: text.length }) }), () => setNote({ text: t("This browser didn't let Bridge AI write to the clipboard. {name}'s clipboard says: {text}", { name, text: text.slice(0, 200) }) }))
    } else if (m.t === 'clip-sent') setNote({ text: t("This clipboard is on {name}'s now ({n} characters).", { name, n: Number(m.n) || 0 }) })
    else if (m.t === 'error') { if (m.keep) setNote({ text: m.why, bad: true }); else { setErr({ why: m.why, code: m.code }); setSess((x) => ({ ...x, phase: 'ended' })) } }
    else if (m.t === 'ended') setSess((x) => ({ ...x, phase: 'ended', text: m.text }))
  }

  // The session: as long as this is open, and again for another screen.
  const can = !!st?.screen?.can
  useEffect(() => {
    if (!can) return
    setSess({ phase: 'connecting' })
    setPaused(false)
    setControlling(false)
    const c = connect({
      base, source: source || 'screen:', control: !!st.control?.on,
      on: {
        hello: (m) => { setSess((x) => ({ ...x, phase: 'live', hello: m })); if (m.source?.w && m.source?.h) setSize({ w: m.source.w, h: m.source.h }) },
        mode: (mode) => setSess((x) => ({ ...x, mode })),
        track: (stream) => { const v = video.current; if (v) { v.srcObject = stream; v.play().catch(() => {}) } },
        frame: show,
        message: onMessage,
        closed: () => setSess((x) => (x.phase === 'ended' ? x : { ...x, phase: 'ended' })),
      },
    })
    conn.current = c
    return () => { c.close(); conn.current = null; if (lastUrl.current) { URL.revokeObjectURL(lastUrl.current); lastUrl.current = null } }
  }, [can, base, source, run]) // eslint-disable-line react-hooks/exhaustive-deps

  const hello = sess.hello
  const allowed = !!hello?.control?.allowed
  const live = sess.phase === 'live'
  const media = () => (sess.mode === 'p2p' ? video.current : img.current)
  const doSwap = swap ?? swapsKeys(HERE, hello?.os)
  const send = (evs) => conn.current?.input(evs)
  const releaseAll = () => {
    const evs = [...held.current].map((code) => ({ t: 'key', code, down: false }))
    held.current.clear()
    if (evs.length) send(evs)
  }
  useEffect(() => { if (!controlling) releaseAll() }, [controlling]) // eslint-disable-line react-hooks/exhaustive-deps
  // The wheel, kept from scrolling this page while you control that one.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const wheel = (e) => {
      if (!controlling || !allowed) return
      e.preventDefault()
      const p = pointOn(media(), size.w, size.h, e.clientX, e.clientY)
      send([{ t: 'wheel', dx: e.deltaX, dy: e.deltaY, ...(p || {}) }])
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  })
  // Escape closes, unless it's going to that computer.
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && !controlling && !e.target.closest?.('input, select')) onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [controlling, onClose])

  const at = (e) => pointOn(media(), size.w, size.h, e.clientX, e.clientY)
  const pointer = (kind) => (e) => {
    if (!controlling || !allowed) return
    const p = at(e)
    if (kind === 'down') {
      if (!p) return
      e.preventDefault()
      stage.current?.focus({ preventScroll: true })
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not here */ }
      buttons.current.add(e.button)
      send([{ t: 'move', ...p }, { t: 'down', b: Math.min(2, e.button), ...p }])
    } else if (kind === 'up') {
      if (!buttons.current.delete(e.button)) return
      send([{ t: 'up', b: Math.min(2, e.button), ...(p || { x: 0.5, y: 0.5 }) }])
    } else if (p) send([{ t: 'move', ...p }])
  }
  const key = (down) => (e) => {
    if (!controlling || !allowed || e.target !== stage.current) return
    e.preventDefault()
    let code = e.code
    if (!code) return
    if (doSwap && SWAP[code]) code = SWAP[code]
    if (down) held.current.add(code)
    else held.current.delete(code)
    send([{ t: 'key', code, down }])
  }
  // A phone's keyboard: each letter typed goes as it's typed, Return, Delete and Tab as keys.
  const typed = (e) => { const v = e.target.value; if (v) send([{ t: 'text', s: v }]) }
  const typedKey = (e) => {
    const code = { Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab' }[e.key]
    if (!code) return
    e.preventDefault()
    send([{ t: 'key', code, down: true }, { t: 'key', code, down: false }])
  }
  const clipSend = async () => {
    setNote(null)
    try { const text = await navigator.clipboard.readText(); conn.current?.send({ t: 'clip', text }) } catch { setNote({ text: t("This browser didn't let Bridge AI read the clipboard. Paste into {name} with the keyboard instead.", { name }), bad: true }) }
  }
  const sources = hello?.sources || st?.screen?.sources || []
  const rate = st && sess.mode === 'relay' ? (hello?.rate || RATE.own) : null

  return (
    <div className={`rs-view ${phone ? 'phone' : ''}`} role="dialog" aria-label={t("{name}'s Screen", { name })}>
      <header className="rs-bar">
        <button type="button" className="win-btn" onClick={onClose} aria-label={t('Stop viewing')} title={t('Stop viewing')}><Icon name="x" size={16} /></button>
        <b className="rs-title"><Icon name="screen" size={14} /> {t("{name}'s Screen", { name })}</b>
        {sources.length > 1 && (
          <select className="st-input rs-source" value={source || `${hello?.source?.kind || 'screen'}:${sources.find((x) => x.name === hello?.source?.name)?.id || ''}`} onChange={(e) => setSource(e.target.value)} aria-label={t('What to show')}>
            {sources.map((x) => <option key={`${x.kind}:${x.id}`} value={`${x.kind}:${x.id}`}>{x.kind === 'window' ? t('Window: {name}', { name: x.name }) : x.name}</option>)}
          </select>
        )}
        {live && sess.mode && (
          <span className={`rs-mode m-${sess.mode}`} title={sess.mode === 'p2p' ? t('Straight between the two devices, end-to-end encrypted.') : t("The network between the two doesn't allow a direct connection, so the screen comes through the relay as pictures, end-to-end encrypted. It's slower: about {n} a second.", { n: rate })}>
            {sess.mode === 'p2p' ? t('Direct') : t('Through the relay (slower)')}
          </span>
        )}
        <span className="grow" />
        {live && (allowed
          ? <button type="button" className={`btn small ${controlling ? 'primary' : ''}`} aria-pressed={controlling} onClick={() => { setControlling(!controlling); if (!controlling) setTimeout(() => stage.current?.focus({ preventScroll: true }), 0) }} title={t('Use your mouse and keyboard on {name}. Anyone at {name} moving its mouse or pressing a key pauses you for a moment.', { name })}>
            <Icon name="keyboard" size={12} /> {controlling ? t('Controlling') : t('Control')}
          </button>
          : hello?.control?.why && <span className="muted small rs-why" title={hello.control.why}><Icon name="info" size={12} /> {t('View only')}</span>)}
        {live && allowed && controlling && <>
          {swapsKeys(HERE, hello?.os) || swap != null ? (
            <label className="st-check rs-swap" title={t('⌘ here is Ctrl there, so copy, paste and undo work as you\'d expect.')}>
              <input type="checkbox" checked={doSwap} onChange={(e) => setSwap(e.target.checked)} /> <span>{HERE === 'mac' ? t('⌘ as Ctrl') : t('Ctrl as ⌘')}</span>
            </label>
          ) : null}
          <button type="button" className="ghost-btn small" onClick={clipSend} title={t("Put this device's clipboard on {name}'s", { name })}><Icon name="upload" size={12} /> {t('Send clipboard')}</button>
          <button type="button" className="ghost-btn small" onClick={() => { setNote(null); conn.current?.send({ t: 'clip?' }) }} title={t("Copy {name}'s clipboard here", { name })}><Icon name="download" size={12} /> {t('Get clipboard')}</button>
        </>}
      </header>
      {(note || paused || (live && hello?.control?.why && !allowed && !phone)) && (
        <div className={`rs-note ${note?.bad ? 'bad' : ''}`} role="status">
          {paused ? <><Icon name="pause" size={12} /> {t('Paused: someone at {name} is using it. You can carry on in a moment.', { name })}</>
            : note ? <><span>{note.text}</span><button type="button" className="win-btn" onClick={() => setNote(null)} aria-label={t('Dismiss')}><Icon name="x" size={12} /></button></>
              : <><Icon name="info" size={12} /> {hello.control.why}</>}
        </div>
      )}
      <div className={`rs-stage ${controlling && allowed ? 'controlling' : ''}`} ref={stage} tabIndex={0}
        onPointerDown={pointer('down')} onPointerUp={pointer('up')} onPointerMove={pointer('move')} onPointerCancel={pointer('up')}
        onKeyDown={key(true)} onKeyUp={key(false)} onBlur={releaseAll} onContextMenu={(e) => { if (controlling) e.preventDefault() }}>
        <video ref={video} className="rs-media" muted playsInline autoPlay hidden={sess.mode !== 'p2p'} />
        <img ref={img} className="rs-media" alt="" hidden={sess.mode === 'p2p' || !live} draggable={false} />
        {!err && sess.phase !== 'live' && sess.phase !== 'ended' && (
          <div className="rs-wait"><Icon name="refresh" size={18} className="spin" /><p>{st ? t('Connecting to {name}…', { name }) : t('Asking {name}…', { name })}</p></div>
        )}
        {err && (
          <div className="rs-wait"><Icon name="alert" size={20} /><p>{err.why}</p>
            {err.code !== 'trial' && <button type="button" className="btn small" onClick={() => { setErr(null); setRun((n) => n + 1) }}>{t('Try again')}</button>}</div>
        )}
        {!err && sess.phase === 'ended' && (
          <div className="rs-wait"><Icon name="stop" size={18} /><p>{sess.text || t('Not showing {name} any more.', { name })}</p>
            <button type="button" className="btn small" onClick={() => setRun((n) => n + 1)}>{t('View again')}</button></div>
        )}
      </div>
      {phone && live && allowed && controlling && (
        <div className="rs-type">
          <input className="st-input" value="" onChange={typed} onKeyDown={typedKey} enterKeyHint="enter" autoCapitalize="off" autoCorrect="off"
            placeholder={t('Type on {name}', { name })} aria-label={t('Type on {name}', { name })} />
        </div>
      )}
      <footer className="rs-foot muted small">{tn('{name} shows that its screen is being seen, with Stop, and keeps a record of it.', { name: <b>{name}</b> })}</footer>
    </div>
  )
}
