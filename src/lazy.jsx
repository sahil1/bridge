import { lazy, Suspense } from 'react'

// Views that aren't on the first screen load on demand, so the app opens faster: the terminal
// (xterm), the file viewer (highlighter, markdown), Settings, onboarding, calendar and usage stats.
// preloadViews() fetches them all once the app is idle, so opening one later is still instant.
// Each export is a drop-in for the component it wraps.
const LOADERS = {
  Settings: () => import('./components/Settings.jsx'),
  Onboarding: () => import('./components/Onboarding.jsx'),
  HerdrView: () => import('./components/HerdrView.jsx'),
  Terminals: () => import('./components/Terminals.jsx'),
  ShellTab: () => import('./components/ShellTab.jsx'),
  Terminal: () => import('./components/Terminal.jsx'),
  Files: () => import('./components/Files.jsx'),
  CalendarView: () => import('./components/CalendarView.jsx'),
  UsageStats: () => import('./components/UsageStats.jsx'),
}

// Once a view's code is loaded (by preloadViews, or the first time it's opened) it renders
// directly. Only a view that isn't loaded yet goes through Suspense, which React holds back for a
// few hundred milliseconds before showing.
const loaded = new Map() // loader -> module
const ensure = (load) => (loaded.has(load) ? Promise.resolve(loaded.get(load)) : load().then((m) => { loaded.set(load, m); return m }))

function wrap(load, name = 'default') {
  const C = lazy(() => ensure(load).then((m) => ({ default: m[name] })))
  return function Lazy(props) {
    const Ready = loaded.get(load)?.[name]
    if (Ready) return <Ready {...props} />
    return <Suspense fallback={null}><C {...props} /></Suspense>
  }
}

export const Settings = wrap(LOADERS.Settings)
export const Onboarding = wrap(LOADERS.Onboarding)
export const HerdrView = wrap(LOADERS.HerdrView)
export const Terminals = wrap(LOADERS.Terminals)
export const ShellTab = wrap(LOADERS.ShellTab)
export const Terminal = wrap(LOADERS.Terminal)
export const FilesView = wrap(LOADERS.Files, 'FilesView')
export const ChangesView = wrap(LOADERS.Files, 'ChangesView')
export const CalendarView = wrap(LOADERS.CalendarView)
export const UsageStats = wrap(LOADERS.UsageStats)

let preloaded = false
export function preloadViews() {
  if (preloaded) return
  preloaded = true
  const go = () => Object.values(LOADERS).forEach((load) => ensure(load).catch(() => { preloaded = false }))
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 2500 })
  else setTimeout(go, 1200)
}
