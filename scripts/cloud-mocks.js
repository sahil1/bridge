// Stand-in Cursor, GitHub, Jules and Claude APIs on this computer, for trying the phone apps'
// Cloud agents without real keys or real agents: the demo's made-up providers (src/demo/clouds.js)
// on 127.0.0.1 ports 7701 (Cursor), 7702 (GitHub), 7703 (Jules) and 7704 (Claude). Any key works,
// except one with "bad" in it. Debug builds of the apps use them when launched with cloudMock
// (mobile/README.md). Usage: npm run cloud:mocks [-- <pace>], pace 1 being the demo's speed.
import http from 'node:http'
import { createClouds } from '../src/demo/clouds.js'

const pace = Number(process.argv[2]) || 1
const clouds = createClouds({ pace })
const PORTS = { cursor: 7701, copilot: 7702, jules: 7703, claude: 7704 }

for (const [provider, port] of Object.entries(PORTS)) {
  http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`)
      let body = null
      try { body = raw ? JSON.parse(raw) : null } catch { body = raw }
      const r = clouds.handle(provider, { method: req.method, path: u.pathname, query: u.searchParams, headers: req.headers, body })
      console.log(`${provider} ${req.method} ${u.pathname}${u.search} ${r.status}`)
      res.writeHead(r.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(r.body))
    })
  }).listen(port, '127.0.0.1')
}
console.log(`Stand-in providers on 127.0.0.1: Cursor ${PORTS.cursor}, GitHub ${PORTS.copilot}, Jules ${PORTS.jules}, Claude ${PORTS.claude}`)
