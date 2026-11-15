import Icon from '../Icon.jsx'
import { onThisComputer } from '../../api.js'
import { t, locale } from '../../i18n/index.js'
import { canRecordScreen } from './videorec.js'
import { useScreenAccess, useAllowCall, allowSteps } from './allowcall.jsx'

// Record the screen too, while a meeting records (videorec.js makes the video, recording.jsx keeps
// the choice): the choice where a recording starts and where a screen is watched, and the video's
// size as it records. The video itself plays in the meeting (player.jsx).

// The choice, remembered on this device.
export const RECORD_SCREEN = 'cc-record-screen'

// A size in words: "48 MB", "1.2 GB".
export const size = (n) => {
  const b = Math.max(0, Number(n) || 0)
  return b >= 1e9 ? t('{n} GB', { n: (b / 1e9).toLocaleString(locale(), { maximumFractionDigits: 1 }) }) : t('{n} MB', { n: (b / 1e6).toLocaleString(locale(), { maximumFractionDigits: b < 10e6 ? 1 : 0 }) })
}
// About how big an hour of it comes to, once there's enough of it to tell (half a minute).
export const perHour = (bytes, seconds) => (seconds >= 30 && bytes > 0 ? size((bytes / seconds) * 3600) : null)
// What its sound has in it (server/meetvideo.js SOUNDS).
export const soundWords = (s) => (s === 'call' ? t("With your mic and the call's sound.") : s === 'screen' ? t("With your mic and the shared screen's sound.") : t('With your mic only.'))

// Record the screen too, a tick. Hidden where the screen can't be recorded (a phone, a browser that
// can't share a screen or make a video of it), as Watch a screen is. Ticked in the desktop app on a
// Mac that needs Screen Recording for it (before macOS 15, whose own picker needs none) and doesn't
// have it, it says what to turn on (VideoAllow; hint: beside it, where there's room for that).
export function VideoChoice({ m, hint = true, className = '' }) {
  if (!m?.recordScreen || !canRecordScreen()) return null
  return (
    <span className={`mt-video-choice small ${className}`}>
      <label title={t("Keep a video of the screen you pick, with the meeting's sound. It stays on this computer.")}>
        <input type="checkbox" checked={!!m.video} onChange={(e) => m.recordScreen(e.target.checked)} />
        <span>{t('Record the screen too')}</span>
      </label>
      {hint && <VideoAllow m={m} />}
    </span>
  )
}
export function VideoAllow({ m, className = '' }) {
  const mac = !!window.bridgeApp && window.bridgeApp.platform === 'darwin' && onThisComputer()
  if (!mac || !m?.video || !m.recordScreen || !canRecordScreen()) return null
  return <ScreenAllow recording={!!m.rec} className={className} />
}
function ScreenAllow({ recording, className }) {
  const { data, refresh } = useScreenAccess()
  const a = useAllowCall('screen', { recording, started: data?.started, onAsked: refresh })
  if (data?.allowed !== false || data?.picker !== false) return null
  const s = allowSteps('screen', a, { link: true })
  return <span className={`mt-video-allow small ${className}`} role="status">{t('Recording the screen needs Bridge AI turned on under System Settings › Privacy & Security › Screen & System Audio Recording, in Screen Recording.')}{s.say} {s.acts}</span>
}

// While the screen is recorded: how big the video is so far, about how big an hour of it comes to,
// and what's free on the disk; × stops the video and keeps watching the screen.
export function VideoChip({ m }) {
  const v = m?.screen?.video
  if (!v) return null
  const hour = perHour(v.bytes, v.seconds)
  const tip = [
    t('Recording {name} as a video on this computer.', { name: m.screen.label }),
    soundWords(v.sound),
    hour ? t('{size} so far, about {hour} an hour.', { size: size(v.bytes), hour }) : t('{size} so far.', { size: size(v.bytes) }),
    v.free != null ? t('{size} free on this disk.', { size: size(v.free) }) : null,
  ].filter(Boolean).join(' ')
  return (
    <span className="mt-video-chip small" title={tip}>
      <span className="rec-dot" aria-hidden="true" />
      <Icon name="video" size={12} />
      <span className="mt-video-size">{size(v.bytes)}</span>
      <button type="button" className="ghost-btn" onClick={m.stopVideo} aria-label={t('Stop recording the screen')} title={t('Stop recording the screen. It keeps watching it, and the video so far is kept.')}><Icon name="x" size={11} /></button>
    </span>
  )
}
