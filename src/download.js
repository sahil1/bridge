// A file to the device you're on. Through the relay (a phone) it's downloaded by the relay's page
// itself: one started inside its frame doesn't happen in Safari, and a download from the computer's
// address would miss the relay's link. The iPhone app takes it from the computer to its share sheet
// (Save to Files); the Android app can't save a file from a page yet. Meetings' Save as Word or PDF
// (meetings/exporting.js) and Settings › Bots' files (its export, its Teams app, its record).
import { viaRelay } from './api.js'
import { t } from './i18n/index.js'

export const iosApp = (() => { try { return window.bridgeNative?.platform === 'ios' && typeof window.bridgeNative.post === 'function' ? window.bridgeNative : null } catch { return null } })()
export const androidApp = (() => { try { return typeof window.bridgeAndroid === 'object' && !!window.bridgeAndroid } catch { return false } })()
// Whether a file can come to this device at all (not in the Android app, through the relay).
export const canDownload = !(viaRelay && androidApp)

// To this device, from the relay's page when this is in its frame (see above).
export function download(data, name, type) {
  let w = window
  try { if (window.parent !== window && window.parent.document) w = window.parent } catch { /* not the relay's */ }
  const url = w.URL.createObjectURL(new w.Blob([data], { type }))
  const a = w.document.createElement('a')
  a.href = url
  a.download = name
  w.document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => w.URL.revokeObjectURL(url), 60_000)
}
// The iPhone app takes the file from the computer, then shows its share sheet: done, or why not.
export function toIphone(url, name) {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let quiet
    const off = () => { clearTimeout(quiet); window.removeEventListener('bridge-save', on) }
    const wait = () => { clearTimeout(quiet); quiet = setTimeout(() => { off(); reject(new Error(t("The iPhone app didn't answer. Update it from the App Store and try again."))) }, 30_000) }
    const on = (e) => {
      const d = e.detail || {}
      if (d.id !== id) return
      if (d.error) { off(); reject(new Error(d.error)) } else if (d.done) { off(); resolve() } else wait()
    }
    window.addEventListener('bridge-save', on)
    wait()
    iosApp.post({ type: 'save', id, url: new URL(url, location.href).href, name })
  })
}

// One of the computer's files (url: /api/..., as it's named there) to this phone, through the relay:
// to the iPhone app's share sheet, or downloaded by the relay's page, named as the computer names it.
// What was said: ready to save or share, or downloading.
export async function toPhone(url, name) {
  if (!canDownload) throw new Error(t("The Android app can't save files yet."))
  if (iosApp) { await toIphone(url, name); return t('{name} is ready to save or share.', { name }) }
  const r = await fetch(url)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
  const named = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || name
  download(await r.arrayBuffer(), named, r.headers.get('content-type') || 'application/octet-stream')
  return t('Downloading {name} to this device.', { name: named })
}
