import { useSyncExternalStore } from 'react'
import { store } from './components/layout.jsx'

// Appearance, Slack style: a color mode, a theme that tints the window frame (top bar, sidebar,
// tab strip) and sets the accent, plus text size, density and font. Saved per browser.

export const KEY = 'cc-appearance'

// chrome = the window frame; accent = buttons, links, your message bubbles. A theme with one
// entry is used as is in both modes; with two, the second is the dark-mode version.
export const THEMES = [
  { id: 'bridge', name: 'Default', chrome: null, accent: null },
  { id: 'aubergine', name: 'Aubergine', chrome: ['#3f0e40', '#2b0a2c'], accent: ['#1264a3', '#3d8fd1'] },
  { id: 'midnight', name: 'Midnight', chrome: ['#1d2433', '#141924'], accent: ['#4e82ef'] },
  { id: 'ocean', name: 'Ocean', chrome: ['#0b4f6c', '#08374b'], accent: ['#1d9bd1', '#38b2e6'] },
  { id: 'forest', name: 'Forest', chrome: ['#1d4b3c', '#13342a'], accent: ['#1f9d6b', '#3cc48d'] },
  { id: 'indigo', name: 'Indigo', chrome: ['#2e2a6b', '#1f1c4a'], accent: ['#6d5dfc', '#8a7dff'] },
  { id: 'berry', name: 'Berry', chrome: ['#6b1f45', '#4a1530'], accent: ['#d6336c', '#ea5a8c'] },
  { id: 'ember', name: 'Ember', chrome: ['#b4441b', '#6e2a11'], accent: ['#c2410c', '#f07a3d'] },
  { id: 'graphite', name: 'Graphite', chrome: ['#2b2f36', '#1b1e23'], accent: ['#5b6474', '#8b95a7'] },
  { id: 'sand', name: 'Sand', chrome: ['#e9e1d3', '#2e2a24'], accent: ['#9a5b20', '#d49a5c'] },
  { id: 'mint', name: 'Mint', chrome: ['#d9f0e6', '#1c3129'], accent: ['#0f8a5f', '#3cc48d'] },
  { id: 'sky', name: 'Sky', chrome: ['#dbe9fb', '#1a2638'], accent: ['#2563eb', '#5b8ff5'] },
]

export const TEXT_SIZES = [
  { id: 's', name: 'Small', body: 12.5, chat: 13, input: 13.5, term: 12 },
  { id: 'm', name: 'Default', body: 13.5, chat: 14, input: 14.5, term: 13 },
  { id: 'l', name: 'Large', body: 14.5, chat: 15.5, input: 16, term: 14 },
  { id: 'xl', name: 'Larger', body: 15.5, chat: 17, input: 17, term: 15 },
]

export const FONTS = [
  { id: 'geist', name: 'Geist', css: '"Geist Variable", Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: 'system', name: 'System', css: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: 'rounded', name: 'Rounded', css: 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, sans-serif' },
]

// Older builds kept only the color mode, under cc-theme.
export const DEFAULTS = { mode: store.get('cc-theme', 'system'), theme: 'bridge', custom: { chrome: '#3f0e40', accent: '#1264a3' }, text: 'm', density: 'comfortable', font: 'geist' }

export const load = () => ({ ...DEFAULTS, ...store.get(KEY, {}) })

const darkMQ = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
export const isDark = (mode) => mode === 'dark' || (mode === 'system' && !!darkMQ?.matches)

const rgb = (hex) => {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16))
}
export const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const validHex = (s) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(s || '').trim())

// The colors a theme resolves to in the current mode, or null for the plain Bridge look.
export function resolve(a, dark = isDark(a.mode)) {
  const t = a.theme === 'custom'
    ? { chrome: [a.custom.chrome], accent: [a.custom.accent] }
    : THEMES.find((x) => x.id === a.theme) || THEMES[0]
  if (!t.chrome) return null
  const pick = (pair) => (dark && pair[1]) || pair[0]
  return { chrome: pick(t.chrome), accent: pick(t.accent) }
}

const FRAME_VARS = ['--chrome', '--chrome-ink', '--chrome-ink-2', '--chrome-ink-3', '--chrome-line', '--chrome-line-2', '--chrome-fill', '--chrome-fill-2', '--chrome-fill-3', '--accent', '--accent-soft', '--on-accent', '--user-bubble']

export function apply(a = load()) {
  const root = document.documentElement
  const s = root.style
  if (a.mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', a.mode)

  const c = resolve(a)
  FRAME_VARS.forEach((v) => s.removeProperty(v))
  if (c) {
    const lightFrame = luminance(c.chrome) > 0.4
    const ink = lightFrame ? '18 21 27' : '255 255 255'
    root.setAttribute('data-chrome', lightFrame ? 'light' : 'dark')
    s.setProperty('--chrome', c.chrome)
    s.setProperty('--chrome-ink', lightFrame ? '#12151b' : '#ffffff')
    s.setProperty('--chrome-ink-2', `rgb(${ink} / ${lightFrame ? 0.74 : 0.82})`)
    s.setProperty('--chrome-ink-3', `rgb(${ink} / ${lightFrame ? 0.52 : 0.6})`)
    s.setProperty('--chrome-line', `rgb(${ink} / .1)`)
    s.setProperty('--chrome-line-2', `rgb(${ink} / .18)`)
    s.setProperty('--chrome-fill', `rgb(${ink} / ${lightFrame ? 0.07 : 0.1})`)
    s.setProperty('--chrome-fill-2', `rgb(${ink} / ${lightFrame ? 0.05 : 0.07})`)
    s.setProperty('--chrome-fill-3', `rgb(${ink} / ${lightFrame ? 0.1 : 0.16})`)
    s.setProperty('--accent', c.accent)
    s.setProperty('--accent-soft', `color-mix(in srgb, ${c.accent} ${isDark(a.mode) ? 16 : 11}%, transparent)`)
    s.setProperty('--on-accent', luminance(c.accent) > 0.5 ? '#12151b' : '#ffffff')
    s.setProperty('--user-bubble', isDark(a.mode) ? `color-mix(in srgb, ${c.accent} 82%, #000)` : c.accent)
  } else {
    root.removeAttribute('data-chrome')
  }

  const size = TEXT_SIZES.find((x) => x.id === a.text) || TEXT_SIZES[1]
  s.setProperty('--text-size', `${size.body}px`)
  s.setProperty('--chat-size', `${size.chat}px`)
  s.setProperty('--input-size', `${size.input}px`)
  s.setProperty('--term-font', String(size.term))
  root.setAttribute('data-text', size.id)
  root.setAttribute('data-density', a.density)
  s.setProperty('--font', (FONTS.find((x) => x.id === a.font) || FONTS[0]).css)

  // The browser's own toolbar color (PWA, Safari) follows the frame.
  const frame = c?.chrome || (isDark(a.mode) ? '#0f1115' : '#eef0f3')
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', frame))
}

// Theme strings you can paste to share a look: "bridge-theme:#3f0e40,#1264a3".
export const themeString = (c) => `bridge-theme:${c.chrome},${c.accent}`
export function parseThemeString(s) {
  const m = String(s || '').trim().match(/^(?:bridge-theme:)?\s*(#[0-9a-f]{3,6})\s*,\s*(#[0-9a-f]{3,6})/i)
  return m && validHex(m[1]) && validHex(m[2]) ? { chrome: m[1].toLowerCase(), accent: m[2].toLowerCase() } : null
}

// Re-resolve when the OS flips between light and dark (themes have a dark-mode frame).
darkMQ?.addEventListener('change', () => apply(get()))

// One shared copy for every component that reads it; saving re-applies and re-renders them.
let current = null
const subs = new Set()
export function get() { return current || (current = load()) }
export function save(patch) {
  current = { ...get(), ...patch }
  store.set(KEY, current)
  apply(current)
  subs.forEach((fn) => fn())
}
export function useAppearance() {
  const a = useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn) }, get)
  return [a, save]
}
// Changed in another window of the app (the main one, while the floating card is open, say): here
// too. Each window applies it once when it opens, and the card stays open for hours.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== 'cc-theme' && e.key !== null) return
    current = null
    apply(get())
    subs.forEach((fn) => fn())
  })
}
