import { relayScan, cloudOnly } from './api.js'

// Scan QR code, on a phone: the code Pair a device shows on a computer, read by the phone instead of
// its link copied across and typed or pasted. pair: this phone pairs with that computer, asking
// first as an opened pairing link does (the phone's menu, beside Add a computer). link: the link,
// for Link a device to use as if it had been pasted. In the iPhone and Android apps it's their own
// scanner, through the relay page (relay/web/shell.js bridgeRelay.scan), and the app keeps what a
// scan does: a page there can open the scanner and get back a pairing link someone scanned for it,
// no more. In a phone's browser, the camera in the page (ScanCamera.jsx). Not on a computer, where
// Copy link is the way across; not where the page can't have the camera (an address that isn't
// https); and an app whose relay page doesn't offer its scanner has Add a computer's instead.
const handheld = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const inApp = /BridgeAIApp\//.test(navigator.userAgent)
const camera = !cloudOnly && import.meta.env.MODE !== 'demo' && !inApp && handheld && window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function'
  && document.featurePolicy?.allowsFeature?.('camera') !== false // (a frame the camera isn't allowed in, where the browser says)

export const canScan = (kind) => (relayScan ? typeof relayScan[kind] === 'function' : camera)

// A Bridge AI pairing link (https://<relay>/#pair=<code>, or a relay on this computer at
// http://127.0.0.1, as the relay page takes one), or null for anything else a QR code says.
export function pairingLink(text) {
  try {
    const u = new URL(String(text || '').trim())
    const ours = u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))
    return ours && new URLSearchParams(u.hash.slice(1)).get('pair') ? u.href : null
  } catch { return null }
}

// Scans. link: what was scanned, or null (cancelled). pair: the scan pairs, and there's nothing to say.
export async function scan(kind) {
  if (relayScan) {
    if (kind === 'link') return relayScan.link()
    relayScan.pair()
    return null
  }
  const { openCamera } = await import('./components/ScanCamera.jsx')
  const link = await openCamera()
  if (!link || kind === 'link') return link
  // A browser opens it, as the phone's camera would: the relay page there asks first.
  try { window.top.location.assign(link) } catch { location.assign(link) }
  return null
}
