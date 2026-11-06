// Bridge AI 3.10, standing in for an older one on another of your computers: loaded into a kit's
// server (NODE_OPTIONS=--import), it answers the routes of a meeting mentioned in a message as 3.10
// did. Its meetings to mention are its own, without agentText (it never asked your other computers,
// nor gave a meeting's words to one), and a meeting as a file for an agent comes without its text.
// Everything else is the server as it is.
import http from 'node:http'

const OLD = /^\/api\/meetings\/(mentions|[\w-]+\/for-agents)$/
const emit = http.Server.prototype.emit
http.Server.prototype.emit = function (ev, req, res, ...more) {
  if (ev === 'request' && OLD.test(String(req.url || '').split('?')[0])) {
    const end = res.end
    res.end = function (chunk, ...rest) {
      try {
        const j = JSON.parse(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
        for (const k of ['agentText', 'text', 'here', 'from', 'unreachable', 'update']) delete j[k]
        if (Array.isArray(j.meetings)) j.meetings = j.meetings.filter((m) => !m.machine).map(({ machine, device, ...m }) => m)
        chunk = JSON.stringify(j)
        if (!res.headersSent) res.setHeader('content-length', Buffer.byteLength(chunk))
      } catch { /* not JSON: as it was */ }
      return end.call(this, chunk, ...rest)
    }
  }
  return emit.call(this, ev, req, res, ...more)
}
