// Push notifications to phones and browsers (Web Push). Each device that turns notifications on
// subscribes with the browser's push service (Apple's, Google's, Mozilla's); the subscription is
// kept in DATA/push.json with this computer's own key pair (VAPID), made on first use. Messages are
// end-to-end encrypted to the device, so the push service can't read them.
// iPhone: works once Bridge AI is added to the Home Screen (iOS 16.4 or later).
import fs from 'node:fs'
import * as webpush from './webpush.js'
import path from 'node:path'
import { dataFile, ensureDir, writeFileAtomic } from './paths.js'

const FILE = dataFile('push.json')
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} } }
const write = (d) => { ensureDir(path.dirname(FILE)); writeFileAtomic(FILE, JSON.stringify(d, null, 2), { mode: 0o600 }) }

function state() {
  const d = read()
  if (!d.keys) {
    d.keys = webpush.generateVAPIDKeys()
    d.devices = []
    write(d)
  }
  d.devices ||= []
  return d
}

export const publicKey = () => state().keys.publicKey

// Devices on this computer (its browser) still get notified while you're at it; phones don't.
// Those added before this was noted: a computer's name says so ("Mac, Chrome").
const isHere = (dev) => dev.here ?? /^(Mac|Windows|Linux)\b/.test(dev.label)

export function devices() {
  return state().devices.map((dev) => ({ id: dev.id, label: dev.label, addedAt: dev.addedAt, lastOk: dev.lastOk, here: isHere(dev) }))
}

export function subscribe(sub, label, here = false) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('Not a push subscription')
  if (!/^https:\/\//.test(sub.endpoint)) throw new Error('Push endpoints must be https')
  const d = state()
  const id = Buffer.from(sub.endpoint).toString('base64url').slice(-16)
  d.devices = d.devices.filter((x) => x.sub.endpoint !== sub.endpoint)
  d.devices.push({ id, label: String(label || 'Device').slice(0, 60), here: !!here, addedAt: new Date().toISOString(), sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } } })
  write(d)
  return { id }
}

export function unsubscribe({ id, endpoint }) {
  const d = state()
  const before = d.devices.length
  d.devices = d.devices.filter((x) => x.id !== id && x.sub.endpoint !== endpoint)
  write(d)
  return { removed: before - d.devices.length }
}

// The notification channel (see notify.js).
export const channel = {
  name: 'push',
  ready: () => (read().devices || []).length > 0,
  async send(note) {
    const d = state()
    const opts = { vapidDetails: { subject: 'https://github.com/sahil1/bridge', publicKey: d.keys.publicKey, privateKey: d.keys.privateKey }, TTL: 60 * 60, urgency: note.kind === 'needs-you' ? 'high' : 'normal', topic: (note.tag || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined }
    const payload = JSON.stringify({ title: note.title, body: note.body, url: note.url || '/', tag: note.tag, kind: note.kind, actions: note.actions?.length ? note.actions : undefined })
    let sent = 0
    const gone = []
    await Promise.all(d.devices.filter((dev) => !note.onlyHere || isHere(dev)).map(async (dev) => {
      try {
        await webpush.sendNotification(dev.sub, payload, opts)
        dev.lastOk = new Date().toISOString()
        sent++
      } catch (e) {
        // 404/410: the device unsubscribed or the app was removed; forget it.
        if (e.statusCode === 404 || e.statusCode === 410) gone.push(dev.id)
      }
    }))
    d.devices = d.devices.filter((x) => !gone.includes(x.id))
    write(d)
    return { sent, removed: gone.length }
  },
}
