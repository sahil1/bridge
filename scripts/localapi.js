// The running Bridge AI's API, for the commands that ask it (cli.js, and mcp.js for `bridge-ai
// mcp`): where it is (BRIDGE_URL, or the port in your settings) and its key, read from the data
// folder each time (server/apitoken.js), so a key made after this started is found.
import { loadConfig } from '../server/paths.js'
import { authHeaders, readToken } from '../server/apitoken.js'

export const BASE = process.env.BRIDGE_URL || `http://127.0.0.1:${loadConfig().port || 7420}`
export const DOWN = `Bridge AI isn't running at ${BASE}. Start it with: bridge-ai start`

// The JSON back; a refusal throws with the server's own words and its code (hostedFull, apiKey…),
// for a way on to offer. Not running: says so (down: true).
export async function api(p, opts = {}) {
  let res
  try {
    res = await fetch(`${BASE}/api${p}`, { method: opts.method || 'GET', headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...authHeaders(readToken()) }, body: opts.body ? JSON.stringify(opts.body) : undefined, ...(opts.signal ? { signal: opts.signal } : {}) })
  } catch { throw Object.assign(new Error(DOWN), { down: true }) }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status }, data.code ? { code: data.code } : {})
  return data
}
export const wsHeaders = () => authHeaders(readToken())
