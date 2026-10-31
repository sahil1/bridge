import Icon from '../Icon.jsx'
import { apiUrl } from '../../api.js'
import { t, locale } from '../../i18n/index.js'

// What Dictations (the view) and the sidebar's list share: where each one went, said in a few words
// with the icon of the app it went into (or the agent's), its day and time, and opening one.

// The sidebar's list, and whether there's any at all (the row shows once there is).
export const RECENT = '/dictations?limit=40'
export const ANY = '/dictations?limit=1'

export const timeOf = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
export function dayOf(iso) {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const ago = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / 864e5)
  return ago === 0 ? t('Today') : ago === 1 ? t('Yesterday') : d.toLocaleDateString(locale(), { weekday: ago < 7 ? 'long' : undefined, month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}
export function byDay(list) {
  const groups = []
  for (const x of list) { const d = dayOf(x.at); if (groups.at(-1)?.d !== d) groups.push({ d, items: [] }); groups.at(-1).items.push(x) }
  return groups
}
export const length = (ms) => { const s = Math.max(1, Math.round((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

// Where it went, in a few words: pasted into an app, sent or typed to an agent, typed into a
// terminal or a box in Bridge AI, copied, or (nothing done with it) where it was said.
export function whereOf(r) {
  const app = r.app?.name || ''
  const agent = r.agent?.chief ? t('Chief of Staff') : r.agent?.name || ''
  if (r.how === 'pasted') return app ? t('Pasted into {app}', { app }) : t('Pasted')
  if (r.how === 'sent') return agent ? t('Sent to {name}', { name: agent }) : t('Sent to an agent')
  if (r.how === 'typed' && r.agent) return agent ? t('Typed for {name}', { name: agent }) : t('Typed for an agent')
  if (r.how === 'typed') return r.place === 'terminal' ? t('Typed into the terminal') : t('Typed in Bridge AI')
  if (r.how === 'copied') return app ? t('Copied, in {app}', { app }) : t('Copied')
  if (!r.how && r.place) return t('Said in {app}', { app: 'Bridge AI' })
  return app ? t('Said in {app}', { app }) : t('From another app')
}

// The icon: the agent's when it went to one, else the app's (kept by the desktop app), else what
// kind of place it was. bare: the icon alone, the size of the text around it (the sidebar).
export function Glyph({ r, size = 28, bare = false }) {
  const toAgent = (r.how === 'sent' || r.how === 'typed') && r.agent
  if (!toAgent && r.icon && r.app?.bundle) return <img className="dc-glyph" src={apiUrl(`/dictations/icons/${encodeURIComponent(r.app.bundle)}`)} alt="" width={size} height={size} draggable="false" />
  const name = toAgent ? (r.agent.chief ? 'helm' : 'bot') : r.place === 'terminal' ? 'terminal' : r.how === 'copied' ? 'copy' : r.how === 'typed' ? 'edit' : 'wave'
  if (bare) return <Icon name={name} size={size} className="dc-glyph muted" />
  return <span className="dc-glyph dc-glyph-icon" style={{ width: size, height: size }} aria-hidden="true"><Icon name={name} size={Math.round(size * 0.52)} /></span>
}

// Opens Dictations (App.jsx), with that one open when given.
let wanted = null
export const takeWanted = () => { const w = wanted; wanted = null; return w }
export function openDictations(id = null) {
  wanted = id
  window.dispatchEvent(new CustomEvent('bridge-open-dictations', { detail: { id } }))
}
