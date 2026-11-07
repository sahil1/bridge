// Make a routine of something you asked (Scheduled Routines, a beta feature): the New Routine
// dialog, filled in from it (App.jsx shows it). From a message in an agent's chat or the Chief of
// Staff's, History › Commands and a suggestion. Small, so the chat needn't load Routines to offer it.
import { toText } from '../../shared/schedule.js'

// A folder to show (the routine keeps it whole: this page doesn't know where home is on the
// computer that runs it): its last two parts, with that computer's own separator (C:\…\code\shop
// on Windows).
export function shortDir(p) {
  const s = String(p || '')
  const sep = /^[A-Za-z]:\\|^\\\\/.test(s) || (s.includes('\\') && !s.includes('/')) ? '\\' : '/'
  const parts = s.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `…${sep}${parts.slice(-2).join(sep)}` : s
}

// A routine's name from what was asked: its first words (a slash command by its name).
export function nameFrom(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim().replace(/^\/([\w:-]+).*/, '/$1')
  const short = s.length > 40 ? `${s.slice(0, 40).replace(/\s+\S*$/, '')}…` : s
  return short.charAt(0).toUpperCase() + short.slice(1)
}

// What a message sent at a time would repeat as: every weekday (or that day each week, at a weekend)
// at that time to the quarter hour, so the form starts from what you did.
export function scheduleNear(iso) {
  const d = iso ? new Date(iso) : new Date()
  const m = Math.round((d.getHours() * 60 + d.getMinutes()) / 15) * 15 % 1440
  const at = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const dow = d.getDay()
  return toText(dow >= 1 && dow <= 5 ? { every: 'weekday', at } : { every: 'week', days: [dow], at })
}

export const makeRoutine = (detail) => window.dispatchEvent(new CustomEvent('bridge-new-routine', { detail }))

// A message you sent an agent (or the Chief of Staff), as a routine: the same words to the same
// kind of agent in the same folder (the repo, for one on a branch of its own), or to the Chief of Staff.
export function fromMessage(agent, text, at) {
  const words = String(text || '').replace(/\n*\s*Attached: \S[^\n]*$/, '').replace(/\n*\((Sent|Started) by .*chief of staff[^)]*\)$/i, '').trim()
  const chief = !!agent?.chief
  // Any model (a chat) has no agent of its own to start: your default agent then.
  const kind = chief || ['chat', 'shell'].includes(agent?.kind) ? '' : agent?.kind || ''
  return { name: nameFrom(words), command: words, to: chief ? 'chief' : 'agent', cwd: chief ? '' : agent?.worktree?.repo || agent?.cwd || '~/', kind, workspace: chief ? '' : agent?.workspace || '', schedule: scheduleNear(at) }
}
