// Which paired device a request is for, proven. The relay (relay.js) and the messages a phone left
// while the computer was offline (inbox.js) run a device's requests here over HTTP with this server's
// key, saying which device in x-bridge-relay; a program on this computer that reads the key could say
// the same. So they also send x-bridge-relay-proof: an HMAC of the device's id with a secret this
// server process makes as it starts and keeps only in memory, which no file holds. What only a
// device may do (answer Sign on Phone, sign with its PIN: signing.js) believes the device only with it.
import crypto from 'node:crypto'

const SECRET = crypto.randomBytes(32)
export const HEADER = 'x-bridge-relay-proof'
export const proofOf = (id) => crypto.createHmac('sha256', SECRET).update(`relay\n${id}`).digest('base64url')
// The device a request came through, when the relay or the inbox says so: its id, else null.
export function provenDevice(req) {
  const id = req.headers['x-bridge-relay']
  const said = req.headers[HEADER]
  if (!id || typeof id !== 'string' || typeof said !== 'string') return null
  const want = Buffer.from(proofOf(id)), got = Buffer.from(said)
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? id : null
}
