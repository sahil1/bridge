// The file viewer's files that aren't text: videos and sounds in the browser's own player, pictures,
// and anything else to save. The file comes from the computer it's on as it's watched (in parts,
// over the encrypted link from a phone or another device), so a long video starts at once and
// seeks anywhere without being downloaded first.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { t } from '../i18n/index.js'

const fmtSize = (n) => (n > 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)
const extOf = (name) => (/\.([^.]+)$/.exec(name)?.[1] || '').toUpperCase()

// Where a download goes, by what this browser has:
//   the iPhone app: the app saves it, then its share sheet (Save to Files, AirDrop, another app);
//   a browser that can write a file where you pick (Chrome, Edge, the desktop app): straight to
//   disk as it comes, with its progress here;
//   any other browser (Safari, Firefox, a phone's): the browser's own download, with its own progress.
// The Android app can't save a file from a page yet, so it isn't offered there.
const iosApp = (() => { try { return window.bridgeNative?.platform === 'ios' && typeof window.bridgeNative.post === 'function' ? window.bridgeNative : null } catch { return null } })()
const androidApp = (() => { try { return typeof window.bridgeAndroid === 'object' && !!window.bridgeAndroid } catch { return false } })()
const picker = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
export const canSave = !androidApp
export const saveLabel = () => (iosApp ? t('Save to Files…') : t('Download to this device'))
// A phone's share sheet (Save to Files and the like), for a file small enough to hold in memory.
const SHARE_MAX = 100 * 1024 * 1024
const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const canShare = (f) => touch && !iosApp && f.size <= SHARE_MAX && typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
  && (() => { try { return navigator.canShare({ files: [new File([''], f.name, { type: f.type || 'application/octet-stream' })] }) } catch { return false } })()

const absolute = (u) => new URL(u, location.href).href

// Download to this device: { state, start, cancel }. state: null, { got, total }, { done }, { error }.
export function useSave(f, src) {
  const [state, setState] = useState(null)
  const stop = useRef(null)
  useEffect(() => () => stop.current?.(), [])
  // The app's progress comes back as events, for this save only.
  useEffect(() => {
    if (!iosApp) return
    const on = (e) => {
      const d = e.detail || {}
      if (d.id !== stop.current?.id) return
      if (d.error) setState({ error: d.error })
      else if (d.done) setState({ done: true })
      else setState({ got: d.got || 0, total: d.total || f.size })
    }
    window.addEventListener('bridge-save', on)
    return () => window.removeEventListener('bridge-save', on)
  }, [f.size])
  const url = `${src}${src.includes('?') ? '&' : '?'}download=1`
  // The browser's own download, with its own progress.
  const hand = () => {
    const a = document.createElement('a')
    a.href = url
    a.download = f.name
    document.body.append(a)
    a.click()
    a.remove()
    setState({ handed: true })
  }
  const start = async () => {
    if (iosApp) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      stop.current = Object.assign(() => iosApp.post({ type: 'save', cancel: id }), { id })
      setState({ got: 0, total: f.size })
      iosApp.post({ type: 'save', id, url: absolute(url), name: f.name })
      return
    }
    if (!picker) return hand()
    // Where you picked; if this browser won't let the page write there after all, its own download.
    let handle
    try { handle = await window.showSaveFilePicker({ suggestedName: f.name }) } catch (e) { if (e.name !== 'AbortError') hand(); return }
    let out = null
    try { out = await handle.createWritable() } catch { return hand() }
    const ctl = new AbortController()
    stop.current = () => ctl.abort()
    setState({ got: 0, total: f.size })
    try {
      const r = await fetch(url, { signal: ctl.signal })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      const total = Number(r.headers.get('content-length')) || f.size
      const reader = r.body.getReader()
      let got = 0
      let shown = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        await out.write(value)
        got += value.byteLength
        if (got - shown > 256 * 1024 || got === total) { shown = got; setState({ got, total }) }
      }
      await out.close()
      out = null
      setState({ done: true })
    } catch (e) {
      await out?.abort?.().catch(() => {})
      setState(ctl.signal.aborted ? null : { error: e.message })
    } finally { stop.current = null }
  }
  const cancel = () => { stop.current?.(); stop.current = null; setState(null) }
  return { state, start, cancel }
}

// The phone's share sheet: the file read in first (with its progress), then a second tap shares it
// (a share has to follow a tap straight away, and the reading can take a while).
function useShare(f, src) {
  const [st, setSt] = useState(null)
  const ctl = useRef(null)
  useEffect(() => () => ctl.current?.abort(), [])
  const read = async () => {
    ctl.current = new AbortController()
    setSt({ got: 0, total: f.size })
    try {
      const r = await fetch(src, { signal: ctl.current.signal })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const reader = r.body.getReader()
      const parts = []
      let got = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
        got += value.byteLength
        setSt({ got, total: f.size })
      }
      setSt({ file: new File(parts, f.name, { type: f.type || r.headers.get('content-type') || 'application/octet-stream' }) })
    } catch (e) { if (!ctl.current?.signal.aborted) setSt({ error: e.message }) }
  }
  const share = async () => {
    try { await navigator.share({ files: [st.file], title: f.name }); setSt(null) } catch (e) { if (e.name !== 'AbortError') setSt({ error: e.message }) }
  }
  return { st, read, share, cancel: () => { ctl.current?.abort(); setSt(null) } }
}

function Progress({ got, total }) {
  const pct = total ? Math.min(100, Math.round((got / total) * 100)) : 0
  return (
    <div className="save-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('Downloading')}>
      <div className="save-bar"><span style={{ width: `${pct}%` }} /></div>
      <span className="muted small">{t('{got} of {total}', { got: fmtSize(got), total: fmtSize(total) })}</span>
    </div>
  )
}

// Download to this device (and, on a phone that can, its share sheet), with progress.
export function SaveFile({ f, src, compact = false }) {
  const { state, start, cancel } = useSave(f, src)
  const sh = useShare(f, src)
  const shareable = canShare(f)
  if (!canSave) return compact ? null : <p className="muted small">{t("The Android app can't save files yet.")}</p>
  const busy = state && state.got != null && !state.done && !state.error
  return (
    <div className={`save-file ${compact ? 'compact' : ''}`}>
      <div className="save-actions">
        {!busy && <button className="btn primary" onClick={start}><Icon name="download" size={14} /> {saveLabel()}</button>}
        {busy && <button className="btn" onClick={cancel}><Icon name="x" size={13} /> {t('Cancel')}</button>}
        {shareable && !sh.st && <button className="btn" onClick={sh.read}><Icon name="external" size={13} /> {t('Share…')}</button>}
        {shareable && sh.st?.file && <button className="btn primary" onClick={sh.share}><Icon name="external" size={13} /> {t('Share {name}', { name: f.name })}</button>}
        {shareable && sh.st?.got != null && <button className="btn" onClick={sh.cancel}><Icon name="x" size={13} /> {t('Cancel')}</button>}
      </div>
      {busy && <Progress got={state.got} total={state.total} />}
      {sh.st?.got != null && <Progress got={sh.st.got} total={sh.st.total} />}
      {state?.done && <p className="small save-ok" role="status"><Icon name="check" size={12} /> {iosApp ? t('Ready to save') : t('Downloaded')}</p>}
      {state?.handed && <p className="muted small" role="status">{t("Downloading in your browser. Its downloads show how far it's got.")}</p>}
      {(state?.error || sh.st?.error) && <p className="error-text small" role="alert">{state?.error || sh.st.error}</p>}
    </div>
  )
}

// Can't be shown here: says so plainly, and offers the file.
function CantShow({ f, src, text }) {
  return (
    <div className="viewer-empty media-cant" role="note">
      <Icon name="alert" size={22} />
      <p>{text}</p>
      <p className="muted small">{t('Download it to open it in another app.')}</p>
      <SaveFile f={f} src={src} />
    </div>
  )
}

// A video or a sound, in the browser's own player (full screen, picture in picture and AirPlay where
// the browser offers them). It asks the computer for the parts it needs as it plays.
export function MediaView({ f, src }) {
  const video = f.kind === 'video'
  const [why, setWhy] = useState(null)
  const [lost, setLost] = useState(false) // the connection dropped while it loaded
  const [tries, setTries] = useState(0)
  const [noPicture, setNoPicture] = useState(false)
  const el = useRef(null)
  useEffect(() => { setWhy(null); setLost(false); setNoPicture(false) }, [src])
  const cant = () => setWhy(t("This browser can't play {ext} files like this one.", { ext: extOf(f.name) || f.name }))
  if (why) return <CantShow f={f} src={src} text={why} />
  const Tag = video ? 'video' : 'audio'
  return (
    <div className={`media-view ${video ? 'is-video' : 'is-audio'}`}>
      {noPicture && <p className="media-lost small" role="note"><Icon name="alert" size={12} /> {t("This browser can't show the picture of this video ({ext}).", { ext: extOf(f.name) })} {t('Download it to open it in another app.')}</p>}
      {lost && <p className="media-lost small" role="alert"><Icon name="alert" size={12} /> {t('It stopped loading: the connection to the computer dropped.')} <button className="link-btn" onClick={() => { setLost(false); setTries((n) => n + 1) }}>{t('Try again')}</button></p>}
      <Tag ref={el} key={`${src}#${tries}`} src={src} controls playsInline preload="metadata" x-webkit-airplay="allow"
        onError={() => { const c = el.current?.error?.code; if (c === 3 || c === 4) cant(); else if (c === 2) setLost(true) }}
        // A video whose picture this browser can't decode (HEVC in Chrome on Windows, say) loads with
        // its sound only: it says so over a black box, and the sound still plays.
        onLoadedMetadata={() => { if (video && el.current && !el.current.videoWidth) setNoPicture(true) }}
        aria-label={f.name} />
      {!video && <div className="media-name"><Icon name="mic" size={14} /> {f.name}</div>}
      <div className="media-foot"><span className="muted small">{fmtSize(f.size)}</span><SaveFile f={f} src={src} compact /></div>
    </div>
  )
}

// A picture, or a plain line when this browser can't show its kind (HEIC outside Safari, say).
export function PictureView({ f, src }) {
  const [bad, setBad] = useState(false)
  useEffect(() => setBad(false), [src])
  if (bad) return <CantShow f={f} src={src} text={t("This browser can't show {ext} pictures.", { ext: extOf(f.name) })} />
  return <div className="img-view"><img src={src} alt={f.name} onError={() => setBad(true)} /></div>
}

// Anything else: what it is, and how to get it onto this device.
export function OtherFile({ f, src }) {
  return (
    <div className="viewer-empty other-file">
      <Icon name="file" size={26} />
      <p><b>{f.name}</b></p>
      <p className="muted small">{t('{size}, a kind of file this viewer doesn\'t show.', { size: fmtSize(f.size) })}</p>
      <SaveFile f={f} src={src} />
    </div>
  )
}
