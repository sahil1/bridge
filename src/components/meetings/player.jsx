import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, onThisComputer } from '../../api.js'
import { t } from '../../i18n/index.js'
import { clock, length } from './recording.jsx'
import { videoUrl } from './videorec.js'
import { size, perHour, soundWords } from './video.jsx'

// A meeting's video of the screen (Record the screen too, server/meetvideo.js), beside its
// transcript: a line's time plays it from there (at), and the time it's at goes back (onTime) for
// the line being said then. A meeting recorded again, or a screen watched again, has more than one,
// each starting where it did in the meeting. One that ended early says why (VideoNotes).

const lengthOf = (v) => v.seconds || Infinity // not counted yet (Bridge AI closed): to its end
// The video a time in the meeting is in; else the next one after it; else the last.
export const videoAt = (vs, at) => vs.find((v) => at >= v.t && at < v.t + lengthOf(v)) || vs.find((v) => v.t > at) || vs.at(-1) || null

// Why a video of the screen ended early, or wasn't kept at all.
export function VideoNotes({ videos = [] }) {
  const why = videos.filter((v) => v.why)
  if (!why.length) return null
  return why.map((v) => (
    <p key={v.id} className="mt-stale mt-video-why small" role="status"><Icon name="alert" size={12} /> <span>{v.bytes ? t('The video of the screen ends at {time}. {why}', { time: clock(v.t + v.seconds), why: v.why }) : t("The screen wasn't recorded. {why}", { why: v.why })}</span></p>
  ))
}

// at: { t, n }, a time in the meeting to play from (n: asked again for the same time).
export function VideoPane({ id, videos = [], at, onTime, onChange, onMsg }) {
  const kept = videos.filter((v) => v.bytes > 0)
  const [cur, setCur] = useState(null)
  const v = kept.find((x) => x.id === cur) || kept[0] || null
  const ref = useRef(null)
  const want = useRef(null) // where to go in the video once it's loaded: { s, play }
  const told = useRef(-1)
  const [note, setNote] = useState(null)
  const [broken, setBroken] = useState(null) // the video that couldn't be played here
  const go = (s, play) => {
    const el = ref.current
    if (!el || el.readyState < 1) { want.current = { s, play }; return }
    el.currentTime = s
    if (play) el.play().catch(() => {})
  }
  const seek = (when) => {
    const w = videoAt(kept, when)
    if (!w) return
    const s = Math.max(0, Math.min(when - w.t, lengthOf(w) - 0.5))
    setNote(when < w.t ? t('The screen was recorded from {time}.', { time: clock(w.t) }) : when > w.t + lengthOf(w) ? t('The video ends at {time}.', { time: clock(w.t + w.seconds) }) : null)
    if (w.id !== v?.id) { want.current = { s, play: true }; setCur(w.id) } else go(s, true)
  }
  useEffect(() => { if (at) seek(at.t) }, [at?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  const reveal = () => api(`/meetings/${encodeURIComponent(id)}/videos/${v.id}/reveal`, { method: 'POST' }).catch((e) => onMsg?.({ error: true, text: e.message }))
  const remove = async () => {
    if (!window.confirm(t('Delete this video of the screen? The transcript, your notes and the pictures of the screen stay.'))) return
    try { await api(`/meetings/${encodeURIComponent(id)}/videos/${v.id}`, { method: 'DELETE' }); setCur(null); onChange?.() } catch (e) { onMsg?.({ error: true, text: e.message }) }
  }
  const hour = v && perHour(v.bytes, v.seconds)
  return (
    <div className="mt-video-pane">
      {kept.length > 1 && (
        <div className="seg mt-video-pick" role="tablist" aria-label={t('Videos of the screen')}>
          {kept.map((x, i) => <button key={x.id} type="button" role="tab" aria-selected={x.id === v?.id} className={x.id === v?.id ? 'on' : ''} onClick={() => setCur(x.id)} title={t('From {time} in the meeting', { time: clock(x.t) })}>{t('Video {n}', { n: i + 1 })} · {clock(x.t)}</button>)}
        </div>
      )}
      {v && (broken === v.id
        ? <p className="mt-stale small" role="status"><Icon name="alert" size={12} /> <span>{t("This browser can't play this video ({kind}). It plays in the desktop app, Chrome or Edge, and it's in this meeting's folder.", { kind: v.ext.toUpperCase() })}</span></p>
        : <video key={v.id} ref={ref} className="mt-video" src={videoUrl(id, v)} controls preload="metadata" playsInline aria-label={t('The screen, from {time} in the meeting', { time: clock(v.t) })}
          onLoadedMetadata={() => { const w = want.current; want.current = null; if (w) go(w.s, w.play) }}
          onTimeUpdate={(e) => { const s = Math.floor(v.t + e.currentTarget.currentTime); if (s !== told.current) { told.current = s; onTime?.(s) } }}
          onError={() => setBroken(v.id)} />)}
      {note && <p className="muted small mt-video-note" role="status">{note}</p>}
      {v && (
        <div className="mt-video-meta muted small">
          <span>{clock(v.t)}–{clock(v.t + v.seconds)} · {length(v.seconds)} · {v.ext.toUpperCase()} · {size(v.bytes)}{hour ? ` · ${t('about {size} an hour', { size: hour })}` : ''}</span>
          <span>{soundWords(v.sound)} {t('Kept on this computer.')}</span>
          <span className="mt-grow" />
          {onThisComputer() && <button type="button" className="ghost-btn" onClick={reveal} title={t('Where the video file is, in this meeting\'s folder')}><Icon name="folder-open" size={12} /> {/Mac/.test(navigator.userAgent) ? t('Show in Finder') : /Windows/.test(navigator.userAgent) ? t('Show in Explorer') : t('Show in file manager')}</button>}
          <button type="button" className="ghost-btn" onClick={remove} title={t('Delete this video to make room. The rest of the meeting stays.')}><Icon name="trash" size={12} /> {t('Delete video')}</button>
        </div>
      )}
      {!kept.length && !videos.some((x) => x.why) && <p className="muted small">{t('No video of the screen was kept.')}</p>}
      <VideoNotes videos={videos} />
    </div>
  )
}
