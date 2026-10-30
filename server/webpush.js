// Web Push on node:crypto alone: a VAPID key pair for this computer (RFC 8292), and a message sent
// to a subscription, encrypted to that device (aes128gcm, RFC 8291 and 8188). push.js uses it.
import crypto from 'node:crypto'

const b64u = (b) => Buffer.from(b).toString('base64url')
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url')
// Keys are fixed length: a shorter one had leading zeros dropped.
const fixed = (b, n) => (b.length >= n ? b : Buffer.concat([Buffer.alloc(n - b.length), b]))

export function generateVAPIDKeys() {
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  return { publicKey: b64u(fixed(ecdh.getPublicKey(), 65)), privateKey: b64u(fixed(ecdh.getPrivateKey(), 32)) }
}

const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len))
// The payload for one device (its p256dh key and auth secret), as one record. salt and local (a
// private key) are only given in tests, to check against the RFC's example.
export function encrypt(p256dh, auth, payload, { salt = crypto.randomBytes(16), local = null } = {}) {
  const ua = unb64u(p256dh)
  const secret = unb64u(auth)
  if (ua.length !== 65 || ua[0] !== 4) throw new Error('Not a push subscription key')
  if (secret.length < 16) throw new Error('Not a push subscription secret')
  const ecdh = crypto.createECDH('prime256v1')
  if (local) ecdh.setPrivateKey(unb64u(local))
  else ecdh.generateKeys()
  const as = ecdh.getPublicKey()
  const ikm = hkdf(secret, ecdh.computeSecret(ua), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32)
  const key = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
  const c = crypto.createCipheriv('aes-128-gcm', key, nonce)
  const text = Buffer.concat([Buffer.from(payload), Buffer.from([2])]) // 2: the last record, no padding
  const body = Buffer.concat([c.update(text), c.final(), c.getAuthTag()])
  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(4096)
  return Buffer.concat([salt, rs, Buffer.from([as.length]), as, body])
}

// The Authorization header: a token signed with this computer's key, for the push service's origin,
// good for 12 hours.
export function vapid(endpoint, { subject, publicKey, privateKey }) {
  const pub = unb64u(publicKey)
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }))
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' })
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${publicKey}`
}

// Sends one message. A push service that says no throws, with its status as statusCode (404 or
// 410: that device is gone).
export async function sendNotification(sub, payload, { vapidDetails, TTL = 3600, urgency, topic, timeout = 15000 } = {}) {
  const headers = {
    TTL: String(TTL), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    Authorization: vapid(sub.endpoint, vapidDetails),
    ...(urgency ? { Urgency: urgency } : {}), ...(topic ? { Topic: topic } : {}),
  }
  const r = await fetch(sub.endpoint, { method: 'POST', headers, body: encrypt(sub.keys.p256dh, sub.keys.auth, payload), signal: AbortSignal.timeout(timeout) })
  if (r.status < 200 || r.status > 299) throw Object.assign(new Error(`The push service said ${r.status}`), { statusCode: r.status })
  return { statusCode: r.status }
}
