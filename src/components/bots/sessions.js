import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api.js'
import { t, tx } from '../../i18n/index.js'

// Bot sessions (server/botsessions.js): each conversation with a bot (a thread, a direct message) is
// a session, a live Claude Code in the bot's folder that remembers the thread and picks it up again.
// Asked of the server as the Sessions tab, a session's page and a bot's Overview need them; a
// Bridge AI without sessions (404) is said once, never as an error over and over.

// A path looked at every few seconds while the page shows: { data, error, missing, reload }.
// missing: this Bridge AI has no such thing to ask (404), so nothing is asked again.
export function usePolled(path, ms = 4000) {
  const [state, setState] = useState({ data: null, error: null, missing: false })
  const live = useRef(true)
  const asked = useRef(0)
  const load = useCallback(() => {
    if (!path) return Promise.resolve()
    const n = ++asked.current
    return api(path).then(
      (data) => { if (live.current && n === asked.current) setState({ data, error: null, missing: false }) },
      (e) => { if (live.current && n === asked.current) setState((s) => ({ data: e.status === 404 ? null : s.data, error: e.status === 404 ? null : e.message, missing: e.status === 404 })) },
    )
  }, [path])
  useEffect(() => {
    live.current = true
    setState({ data: null, error: null, missing: false })
    if (!path) return undefined
    load()
    const every = setInterval(() => { if (!document.hidden) load() }, ms)
    return () => { live.current = false; clearInterval(every) }
  }, [path, ms, load])
  return { ...state, reload: load }
}

// How a session stands: working on a turn, waiting for you (a draft, a change, a push, a question at
// its time limit, a request held), idle (its pane open, nothing to do), or closed (resumable).
export const SESSION_STATE = { working: tx('Working'), waiting: tx('Waiting for you'), idle: tx('Idle'), closed: tx('Closed') }
export const stateOf = (s) => (s?.waiting || s?.state === 'waiting' ? 'waiting' : s?.state === 'working' ? 'working' : s?.state === 'closed' ? 'closed' : 'idle')
export const WAITING = () => ({ draft: t('a reply to check'), write: t('a change to approve'), push: t('a push to approve'), limit: t('whether to carry on'), screen: t('a request held for you') })

// Where a session is, as its platform calls it.
export function placeOf(p) {
  if (!p) return t('a channel')
  if (p.kind === 'dm') return t('a direct message')
  if (p.kind === 'test') return t('a test session')
  if (!p.name) return t('a channel')
  return String(p.id || '').startsWith('teams:') ? p.name : `#${p.name}`
}
// How long, short: 45 s, 12 min, 3 h 5 min.
export function span(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000))
  if (s < 60) return t('{n} s', { n: s })
  const m = Math.round(s / 60)
  if (m < 60) return t('{n} min', { n: m })
  const h = Math.floor(m / 60)
  return m % 60 ? t('{h} h {m} min', { h, m: m % 60 }) : t('{n} h', { n: h })
}
export const sinceOf = (s) => span((Date.parse(s?.lastAt || '') || Date.now()) - (Date.parse(s?.startedAt || '') || Date.now()))

// A session's name for its tab (App.jsx), as the last list or page that showed it called it.
const titles = new Map()
export const sessionTitle = (sid) => titles.get(sid) || null
export const noteTitle = (s) => { if (s?.id && (s.title || s.bot?.name)) titles.set(s.id, s.title || s.bot.name) }

// Something done to a session: open (start its pane again), steer (you type into it), stop (it
// stops the turn it's on, and stays), end (closed, its pane too).
export const sessionAct = (sid, act, body) => api(`/bots/sessions/${encodeURIComponent(sid)}/${act}`, { method: 'POST', body: body || {} })
