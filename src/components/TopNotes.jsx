import Icon from './Icon.jsx'
import { Quiet } from './ErrorBoundary.jsx'
import SetupChip from './SetupChip.jsx'
import RestartChip from './RestartChip.jsx'
import { useShared } from './layout.jsx'
import { t } from '../i18n/index.js'

// A phone's top bar keeps to what needs you now (an agent waiting, a recording, search, Settings).
// What comes and goes besides (setup carrying on, a restart to apply, a new version) is one slim
// line under it instead, the most pressing first: setup, then the restart, then the update. Each
// is the same as the desktop's chip, one tap away. The update's line opens About & Updates, and can
// be put away; until you've been there, Settings has a dot and opens there too.

// What's been done about an update on this device: "3.7.0:hidden" (put away) or "3.7.0:seen"
// (About & Updates opened for it). A newer version shows again.
const NOTE = 'cc-update-note'
export function useUpdateNote(u) {
  const [note, setNote] = useShared(NOTE, '')
  const [v, state] = String(note || '').split(':')
  const fresh = !!u?.available && !!u.latest
  const mine = fresh && v === u.latest
  return {
    line: fresh && !mine,
    dot: fresh && !(mine && state === 'seen'),
    hide: () => setNote(`${u.latest}:hidden`),
    seen: () => fresh && setNote(`${u.latest}:seen`),
  }
}

export default function TopNotes({ update, onUpdate, fleet, conf }) {
  const note = useUpdateNote(update)
  return (
    <div className="top-notes">
      <Quiet name="Setting up"><SetupChip line /></Quiet>
      <Quiet name="Restart"><RestartChip line fleet={fleet} runtime={conf?.runtime?.name} keep={!!conf?.runtime?.keep} /></Quiet>
      {note.line && (
        <div className="top-note-row">
          <button type="button" className="top-note update-note" onClick={() => { note.seen(); onUpdate() }} title={t('Bridge AI {latest} is available (you have {current})', { latest: update.latest, current: update.current })}>
            <Icon name="download" size={14} /><span className="top-note-text">{t('Bridge AI {version} is available', { version: update.latest })}</span><Icon name="chevron" size={13} className="top-note-go" />
          </button>
          <button type="button" className="win-btn top-note-x" onClick={note.hide} aria-label={t('Not now')} title={t('Not now')}><Icon name="x" size={14} /></button>
        </div>
      )}
    </div>
  )
}
