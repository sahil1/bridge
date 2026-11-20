import { api } from './api.js'

// Usage stats the window counts itself (server/counts.js fromWindow): AI Assist's suggestions kept
// or dismissed, by where (assist.accepted.studio, assist.dismissed.mail…). The server counts only
// those, only while usage stats are on; nothing in the demo.
export function add(name) {
  if (import.meta.env.MODE === 'demo') return
  api('/counts/add', { method: 'POST', body: { name } }).catch(() => {})
}
// AI Assist's suggestion in `area` (studio, mail, meetings, dictation, board, files), kept or not.
export const assistKept = (area, kept) => add(`assist.${kept ? 'accepted' : 'dismissed'}.${area}`)
