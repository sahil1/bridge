// Loaded into a test's server (NODE_OPTIONS=--import): names under localhost (<id>.localhost) don't
// resolve, as on macOS and Windows, where only "localhost" itself does (some Linux resolvers answer
// for them all). So a test that reaches a relay at <id>.localhost runs the same on every computer,
// and Bridge AI has to find such an address on its own (server/relay.js).
import dns from 'node:dns'

const real = dns.lookup
dns.lookup = function lookup(host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {} }
  if (/\.localhost\.?$/i.test(String(host))) return process.nextTick(cb, Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND', hostname: host }))
  return real.call(this, host, opts, cb)
}
