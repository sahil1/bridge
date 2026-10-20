import { api } from './api.js'

// Bridge AI as an app on your phone (or in your browser): the service worker, push notifications
// for this device, and links from notifications. The desktop app has its own notifications, so
// none of this runs there.
const inDesktopApp = () => typeof window !== 'undefined' && !!window.bridgeApp

export function registerServiceWorker() {
  if (!import.meta.env.PROD || inDesktopApp() || !('serviceWorker' in navigator) || !window.isSecureContext) return
  navigator.serviceWorker.register('/sw.js').catch(() => {})
  // A tapped notification while the app is open: go where it points.
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open') openLink(e.data.url) })
}

// ?agent=<pane> opens that agent; ?card=<id> shows a Today card. Used by notifications.
export function openLink(href = location.href) {
  const url = new URL(href, location.origin)
  const agent = url.searchParams.get('agent')
  const card = url.searchParams.get('card')
  if (agent) window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: agent } }))
  if (card) window.dispatchEvent(new CustomEvent('bridge-open-card', { detail: { id: card } }))
  if (agent || card) history.replaceState(null, '', url.pathname)
}

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
// Through the relay, the app is a frame inside the relay's page: ask the page that was opened.
const topWin = () => { try { return window.top.matchMedia ? window.top : window } catch { return window } }
export const isStandalone = () => topWin().matchMedia?.('(display-mode: standalone)').matches || topWin().navigator.standalone === true

// Can this device get push notifications, and if not, why not.
export function pushSupport() {
  if (inDesktopApp()) return { ok: false, why: 'desktop' }
  if (!window.isSecureContext) return { ok: false, why: 'insecure' }
  if (isIOS() && !isStandalone()) return { ok: false, why: 'ios-home-screen' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, why: 'unsupported' }
  return { ok: true }
}

async function registration() {
  return navigator.serviceWorker.getRegistration('/') || navigator.serviceWorker.ready
}

export async function pushState() {
  if (!pushSupport().ok) return { on: false, permission: 'default' }
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  return { on: !!sub, permission: Notification.permission }
}

const fromBase64Url = (s) => {
  const b = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

export function deviceName() {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || isIOS() ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) && !/Edg\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  return isStandalone() ? `${os} (app)` : [os, browser].filter(Boolean).join(', ')
}

export async function enablePush() {
  const support = pushSupport()
  if (!support.ok) throw new Error('Notifications aren\'t available here')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.' : 'Notifications weren\'t allowed')
  const reg = await registration()
  const { publicKey } = await api('/push/key')
  // The browser's push service (Apple's, Google's) can be unreachable; don't spin forever.
  const subscribe = reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) })
  const timeout = new Promise((_, no) => setTimeout(() => no(new Error('Couldn\'t reach this browser\'s notification service. Check the connection and try again.')), 20000))
  const sub = (await reg.pushManager.getSubscription()) || (await Promise.race([subscribe, timeout]))
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), label: deviceName() } })
  return true
}

export async function disablePush() {
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  }
}
