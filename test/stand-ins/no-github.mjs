// Loaded into every test's server (startKit, NODE_OPTIONS=--import), and so into each program it
// starts on Node.js: GitHub is never reached from a test. A request to it (github.com, its API, its
// files on githubusercontent.com) is turned away at once, as if the name didn't resolve, and written
// to BRIDGE_TEST_GITHUB_LOG, which fails the suite (harness.mjs, checks()'s done()): a test gives a
// stand-in instead (the update check asks harness.mjs's, BRIDGE_RELEASES_API). Every request by name
// looks the name up first (fetch, http, https, WebSockets), which is where it's caught.
import dns from 'node:dns'
import fs from 'node:fs'

const GITHUB = /(^|\.)(github\.com|githubusercontent\.com|githubassets\.com|github\.io|ghcr\.io)\.?$/i
const LOG = process.env.BRIDGE_TEST_GITHUB_LOG
const refused = (host) => {
  try { if (LOG) fs.appendFileSync(LOG, `${host}\t${process.argv.slice(1, 2).join(' ')}\n`) } catch { /* the kit's folder is gone */ }
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${host} (no test reaches GitHub)`), { code: 'ENOTFOUND', hostname: host })
}

const real = dns.lookup
dns.lookup = function lookup(host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {} }
  if (GITHUB.test(String(host))) return process.nextTick(cb, refused(host))
  return real.call(this, host, opts, cb)
}
const realPromise = dns.promises.lookup
dns.promises.lookup = function lookup(host, opts) {
  if (GITHUB.test(String(host))) return Promise.reject(refused(host))
  return realPromise.call(this, host, opts)
}
