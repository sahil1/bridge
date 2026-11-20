import { usePoll, refetch } from '../../api.js'
import { useTrial } from '../../trials.js'
import { tx } from '../../i18n/index.js'

// Your bots (Bots, a beta feature, its id slack-bot), as the sidebar, the phone's More › Bots and a
// bot's page show them: one look at /bots every few seconds, shared by all of them, and only while
// Bots is on. refreshBots() after a change, so each shows it at once.
export function useBots() {
  const on = useTrial('slack-bot')
  const r = usePoll('/bots', 8000, { enabled: on })
  return { on, list: on ? r.data?.bots || null : null, deleted: on ? r.data?.deleted || [] : [], error: on ? r.error : null }
}
export const refreshBots = () => refetch('/bots')

// How a bot stands, at a glance, from the list: a draft (not made yet), answering, needing you (an
// answer waits for you, or its connection was turned down), paused, or not connected yet.
export function statusOf(b) {
  if (!b) return 'off'
  if (b.draft) return 'draft'
  if (b.waiting > 0 || b.state === 'error') return 'needs'
  if (b.paused) return 'paused'
  return b.connected || b.state === 'connected' ? 'on' : 'off'
}
export const STATUS = { on: tx('Answering'), needs: tx('Needs you'), paused: tx('Paused'), off: tx('Not connected yet'), draft: tx('Draft') }
// How many of your bots' answers, changes and questions wait for you, from the list.
export const needsCount = (list) => (list || []).reduce((n, b) => n + (b.draft ? 0 : (b.waiting || 0) + (b.state === 'error' ? 1 : 0)), 0)

// Where Bots shows in the main area (App.jsx), each a tab of its own there:
//   view:bots:<tab>      Bots (BotsHome.jsx), at Connections, Bots or Sessions; view:bots:new is
//                        Bots with a new bot's three questions open
//   view:bot:<id>        a bot's page (BotPage.jsx); view:bot:new a new one's chat with AI Assist
//   view:session:<sid>   a session (SessionView.jsx): its Thread and its Live pane
// Bots' own pages before Bots had its three tabs (view:bot:overview, view:bot:connections and a
// connection's view:bot:routing:<id>) go to the tab that has them now (botPlace).
export const BOT_VIEW = 'view:bot:'
export const BOTS_VIEW = 'view:bots:'
export const SESSION_VIEW = 'view:session:'
export const BOTS_TABS = ['connections', 'bots', 'sessions']
export const botView = (id) => `${BOT_VIEW}${id}`
export const botsView = (tab = 'bots') => `${BOTS_VIEW}${tab}`
export const sessionView = (sid) => `${SESSION_VIEW}${sid}`
export const isBotsPlace = (id) => typeof id === 'string' && (id.startsWith(BOT_VIEW) || id.startsWith(BOTS_VIEW) || id.startsWith(SESSION_VIEW))
export function botPlace(id) {
  if (typeof id !== 'string' || !id.startsWith(BOT_VIEW)) return id
  const rest = id.slice(BOT_VIEW.length)
  if (rest === 'overview') return botsView('bots')
  if (rest === 'connections' || rest.startsWith('routing:')) return botsView('connections')
  return id
}
// Opened from anywhere (App.jsx listens): a bot's page, Bots at a tab, a session.
export const openBot = (id) => window.dispatchEvent(new CustomEvent('bridge-open-bot', { detail: { id } }))
export const openBots = (tab = 'bots', o = {}) => window.dispatchEvent(new CustomEvent('bridge-open-bots', { detail: { tab, ...o } }))
export const openSession = (sid) => window.dispatchEvent(new CustomEvent('bridge-open-bots', { detail: { session: sid } }))

// The Sessions tab's filter, kept on this device: a bot's page's "All its sessions" sets it first.
export const FILTER_KEY = 'cc-bots-sessions-filter'
export function filterSessions(f) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)) } catch { /* private window */ }
  window.dispatchEvent(new CustomEvent('bridge-bots-filter', { detail: f }))
}

// A connection's Chief, by its bot's id: the server gives { id, name } (or null), an older one an id.
export const chiefIdOf = (c) => (c?.chief && typeof c.chief === 'object' ? c.chief.id || null : c?.chief || null)
