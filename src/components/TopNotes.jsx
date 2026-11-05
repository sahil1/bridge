import Icon from './Icon.jsx'
import { Quiet } from './ErrorBoundary.jsx'
import SetupChip from './SetupChip.jsx'
import RestartChip from './RestartChip.jsx'
import { useShared } from './layout.jsx'
import { usePoll } from '../api.js'
import { ANDROID_PAGE } from '../fresh.js'
import { t } from '../i18n/index.js'

// A phone's top bar keeps to what needs you now (an agent waiting, a recording, search, Settings).
// What comes and goes besides (setup carrying on, a restart to apply, a new version) is one slim
// line under it instead, the most pressing first: setup, then the restart, then the update. Each
// is the same as the desktop's chip, one tap away. The update's line opens About & Updates, and can
// be put away; until you've been there, Settings has a dot and opens there too.
// Above them all: this page is out of date, the computer having updated while it was open (fresh,
// from useFresh in src/fresh.js), with Reload; then the phone app itself being older than this page
// needs (app, from oldApp there), with where to get the new one.

// What's been done about an update on this device: "3.7.0:hidden" (put away) or "3.7.0:seen"
// (About & Updates opened for it). A newer version shows again. One this Mac's macOS can't open
// (held) is said the same way, once.
const NOTE = 'cc-update-note'
export function useUpdateNote(u) {
  const [note, setNote] = useShared(NOTE, '')
  const [v, state] = String(note || '').split(':')
  const fresh = (!!u?.available || !!u?.held) && !!u.latest
  const mine = fresh && v === u.latest
  return {
    line: fresh && !mine,
    dot: fresh && !(mine && state === 'seen'),
    hide: () => setNote(`${u.latest}:hidden`),
    seen: () => fresh && setNote(`${u.latest}:seen`),
  }
}

// The computer's name, for saying which Bridge AI.
const computerOf = (v) => v?.computer || null
const APP_HIDE = 'cc-app-note' // the app version asked for when that line was put away

export default function TopNotes({ update, onUpdate, fleet, conf, fresh, app }) {
  const note = useUpdateNote(update)
  const [appHidden, setAppHidden] = useShared(APP_HIDE, '')
  const showApp = !!app && appHidden !== app.need
  const name = computerOf(usePoll(showApp ? '/version' : null, 60 * 60 * 1000).data) || fresh?.stale?.computer
  return (
    <div className="top-notes">
      {fresh?.stale && (
        <button type="button" className="top-note fresh-note" onClick={fresh.reload}>
          <Icon name="refresh" size={14} />
          <span className="top-note-text">{fresh.stale.computer ? t('Bridge AI on {computer} was updated', { computer: fresh.stale.computer }) : t('Bridge AI on your computer was updated')}</span>
          <span className="top-note-act">{t('Reload')}</span>
        </button>
      )}
      {showApp && (
        <div className="top-note-row app-note">
          {app.platform === 'android'
            ? <a className="top-note wrap" href={ANDROID_PAGE} target="_blank" rel="noopener noreferrer">
              <Icon name="download" size={14} /><span className="top-note-text">{t('This Android app is older than Bridge AI on {computer} needs ({need} or later). Get the new one from the website.', { computer: name || t('your computer'), need: app.need })}</span><Icon name="external" size={13} className="top-note-go" />
            </a>
            : <div className="top-note wrap" role="status">
              <Icon name="download" size={14} /><span className="top-note-text">{t('This iPhone app is older than Bridge AI on {computer} needs ({need} or later). Update it from the App Store, or TestFlight if you test it.', { computer: name || t('your computer'), need: app.need })}</span>
            </div>}
          <button type="button" className="win-btn top-note-x" onClick={() => setAppHidden(app.need)} aria-label={t('Not now')} title={t('Not now')}><Icon name="x" size={14} /></button>
        </div>
      )}
      <Quiet name="Setting up"><SetupChip line /></Quiet>
      <Quiet name="Restart"><RestartChip line fleet={fleet} runtime={conf?.runtime?.name} keep={!!conf?.runtime?.keep} /></Quiet>
      {note.line && (
        <div className="top-note-row">
          {update.held
            ? <button type="button" className="top-note update-note" onClick={() => { note.seen(); onUpdate() }}>
              <Icon name="info" size={14} /><span className="top-note-text">{t('Bridge AI {version} needs macOS {macos}', { version: update.latest, macos: update.held.macos })}</span><Icon name="chevron" size={13} className="top-note-go" />
            </button>
            : <button type="button" className="top-note update-note" onClick={() => { note.seen(); onUpdate() }} title={t('Bridge AI {latest} is available (you have {current})', { latest: update.latest, current: update.current })}>
              <Icon name="download" size={14} /><span className="top-note-text">{t('Bridge AI {version} is available', { version: update.latest })}</span><Icon name="chevron" size={13} className="top-note-go" />
            </button>}
          <button type="button" className="win-btn top-note-x" onClick={note.hide} aria-label={t('Not now')} title={t('Not now')}><Icon name="x" size={14} /></button>
        </div>
      )}
    </div>
  )
}

// The same news on a wide screen: a chip in the top bar, with Reload (row: a row of the Status menu).
export function FreshChip({ fresh, row = false }) {
  if (!fresh?.stale) return null
  const what = fresh.stale.computer ? t('Bridge AI on {computer} was updated', { computer: fresh.stale.computer }) : t('Bridge AI on your computer was updated')
  if (row) return (
    <button type="button" className="status-row fresh-row" onClick={fresh.reload} title={t('Reload to use the new version.')}>
      <Icon name="refresh" size={14} /><span className="status-row-text">{what}</span><span className="top-note-act">{t('Reload')}</span>
    </button>
  )
  return (
    <button type="button" className="top-chip fresh-chip" onClick={fresh.reload} title={`${what}. ${t('Reload to use the new version.')}`}>
      <Icon name="refresh" size={13} /><span className="hide-sm">{t('Updated')}</span><b>{t('Reload')}</b>
    </button>
  )
}
