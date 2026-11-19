import { usePoll, refetch } from '../../api.js'
import { useTrial } from '../../trials.js'
import { tx } from '../../i18n/index.js'

// Your bots (Bots, a beta feature, its id slack-bot), as the sidebar, the phone's More › Bots and a
// bot's page show them: one look at /bots every few seconds, shared by all of them, and only while
// Bots is on. refreshBots() after a change, so each shows it at once.
export function useBots() {
  const on = useTrial('slack-bot')
  const r = usePoll('/bots', 8000, { enabled: on })
  return { on, list: on ? r.data?.bots || null : null, error: on ? r.error : null }
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

// A bot's page, in the main area (App.jsx): view:bot:<id>, or view:bot:new for a new one's chat.
export const BOT_VIEW = 'view:bot:'
export const botView = (id) => `${BOT_VIEW}${id}`
export const openBot = (id) => window.dispatchEvent(new CustomEvent('bridge-open-bot', { detail: { id } }))
