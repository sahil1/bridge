// A Cloudflare Worker run in Node, as the tests and stand-ins run account/worker.js: what Cloudflare
// gives it, stood in for. Importing this first makes `cloudflare:workers` the stand-in's
// (stand-ins/cloudflare-workers.mjs).
//   d1()            D1 on SQLite in memory: prepare(sql).bind(...).run() / first() / all(), and batch()
//   mailbox(file)   the Email Service's send_email binding: what's sent is kept (and written to file,
//                   a line of JSON each), and fail(code) makes the next sends fail as Cloudflare's do
import fs from 'node:fs'
import { register } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const stub = pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'stand-ins', 'cloudflare-workers.mjs')).href
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) { return s === 'cloudflare:workers' ? { url: ${JSON.stringify(stub)}, shortCircuit: true } : next(s, c) }`)}`)

export function d1() {
  const db = new DatabaseSync(':memory:')
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } } },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  })
  return {
    sql: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN')
      try { const out = []; for (const s of list) out.push(await s.run()); db.exec('COMMIT'); return out } catch (e) { db.exec('ROLLBACK'); throw e }
    },
  }
}

export function mailbox(file = null) {
  const sent = []
  let failing = null
  return {
    sent,
    fail: (code) => { failing = code },
    async send(m) {
      if (failing) throw Object.assign(new Error(`${failing}: sending failed`), { code: failing })
      const one = { to: m.to, from: m.from, subject: m.subject, text: m.text, at: Date.now() }
      sent.push(one)
      if (file) fs.appendFileSync(file, `${JSON.stringify(one)}\n`)
      return { messageId: `test-${sent.length}` }
    },
  }
}
