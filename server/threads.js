// The chief of staff's threads: separate conversations with it, so a request about the launch and
// one about the budget don't run together in one long chat. Each thread is a chief of its own, in
// its own tab of the Chief of staff space and in the same folder, so they share the playbook, the
// ledger and the task list, and they can work at the same time. The first chief is Main; the
// others are named by topic (their tab's name). The agents a thread starts or sends work to are
// linked to it (`bridge new` and `bridge send` report them here), so its bar can show them.
// A thread's chief gets BRIDGE_THREAD=<id> in its environment, which is how `bridge` says which
// thread it speaks for. Kept in chief-threads.json in the data folder; with herdr, per session.
import fs from 'node:fs'
import { dataFile, writeFileAtomic } from './paths.js'

const FILE = dataFile('chief-threads.json')
const KEEP_AGENTS = 30
const GONE_AFTER = 3 * 60000 // a thread whose chief has been missing this long was closed

export function makeThreads() {
  let data = { next: 1, threads: [] } // threads: { id, session, paneId, tabId, sessionId, created, agents: [{ paneId, tabId, sessionId, at }] }
  try { data = { ...data, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) } } catch { /* none yet */ }
  const save = () => { try { writeFileAtomic(FILE, JSON.stringify(data, null, 2)) } catch { /* read-only disk */ } }
  const missing = new Map() // thread id -> when its chief was first missed
  let launching = 0 // a thread's chief can show up before its launch returns: don't take it for a stray one
  const ofSession = (f) => data.threads.filter((t) => (t.session || '') === (f.session || ''))
  const nameOf = (a) => (a.tab && !/^\d+$/.test(a.tab) && a.tab !== 'Chief of staff' ? a.tab : 'Thread')

  // Mark the chiefs with their thread (a.thread: { id, name, main }) and every agent with the
  // threads that handed it work (a.chiefThreads). A chief no thread knows yet (one resumed from
  // Closed agents, say) gets a thread of its own; the first one is Main.
  function decorate(f) {
    const chiefs = f.agents.filter((a) => a.chief)
    if (!chiefs.length && !data.threads.length) return
    const mine = ofSession(f)
    let dirty = false
    const claim = (t, a) => {
      a.thread = { id: t.id, name: t.id === 'main' ? 'Main' : nameOf(a), main: t.id === 'main' }
      if (!a.thread.main) a.title = a.thread.name
      if (t.paneId !== a.paneId || t.tabId !== a.tabId || (a.sessionId && t.sessionId !== a.sessionId)) {
        Object.assign(t, { paneId: a.paneId, tabId: a.tabId, sessionId: a.sessionId || t.sessionId || null })
        dirty = true
      }
    }
    // By pane first, then by conversation (a chief restarted on another model keeps it), then by tab.
    for (const same of [(t, a) => a.paneId === t.paneId, (t, a) => !!t.sessionId && a.sessionId === t.sessionId, (t, a) => !!t.tabId && a.tabId === t.tabId]) {
      for (const t of mine) {
        if (chiefs.some((a) => a.thread?.id === t.id)) continue
        const a = chiefs.find((x) => !x.thread && same(t, x))
        if (a) claim(t, a)
      }
    }
    const free = chiefs.filter((a) => !a.thread)
    if (free.length && launching) for (const a of free) a.thread = { id: null, name: nameOf(a), main: false }
    else if (free.length) {
      if (!chiefs.some((a) => a.thread?.main)) {
        let main = mine.find((t) => t.id === 'main')
        if (!main) { main = { id: 'main', session: f.session || '', created: new Date().toISOString(), agents: [] }; data.threads.push(main) }
        claim(main, free.find((a) => a.tab === 'Chief of staff') || free[0])
      }
      for (const a of chiefs.filter((x) => !x.thread)) {
        const t = { id: `t${data.next++}`, session: f.session || '', created: new Date().toISOString(), agents: [] }
        data.threads.push(t)
        claim(t, a)
      }
      dirty = true
    }
    // A thread's chief that stays gone was closed: forget the thread (Main keeps its agents).
    if (!f.down) {
      for (const t of ofSession(f)) {
        if (chiefs.some((a) => a.thread?.id === t.id)) { missing.delete(t.id); continue }
        if (t.id === 'main') continue
        if (!missing.has(t.id)) missing.set(t.id, Date.now())
        else if (Date.now() - missing.get(t.id) > GONE_AFTER) { data.threads = data.threads.filter((x) => x !== t); missing.delete(t.id); dirty = true }
      }
    }
    for (const t of ofSession(f)) {
      for (const l of t.agents) {
        const a = f.agents.find((x) => !x.chief && (x.paneId === l.paneId || (!!l.sessionId && x.sessionId === l.sessionId)))
        if (!a) continue
        if (a.paneId !== l.paneId || (a.sessionId && a.sessionId !== l.sessionId)) { Object.assign(l, { paneId: a.paneId, tabId: a.tabId, sessionId: a.sessionId || l.sessionId || null }); dirty = true }
        if (!(a.chiefThreads ||= []).includes(t.id)) a.chiefThreads.push(t.id)
      }
    }
    if (dirty) save()
  }

  return {
    decorate,
    // Around starting a thread's chief: its id first (for BRIDGE_THREAD), then where it landed.
    reserve() { launching++; return `t${data.next++}` },
    started(id, { paneId, session }) {
      data.threads.push({ id, session: session || '', paneId, tabId: null, sessionId: null, created: new Date().toISOString(), agents: [] })
      save()
    },
    release() { launching = Math.max(0, launching - 1) },
    // A thread's tab was closed: forget the thread now.
    closedTab(tabId, session) {
      const before = data.threads.length
      data.threads = data.threads.filter((t) => t.id === 'main' || !(t.tabId === tabId && (t.session || '') === (session || '')))
      if (data.threads.length !== before) save()
    },
    // `bridge new` or `bridge send` handed work to paneId: link it to the thread that did. The
    // thread is the one bridge names (BRIDGE_THREAD); without one (a chief started before threads
    // were), the only chief at work, since it's running the command; else Main.
    link(threadId, paneId, f) {
      const a = f.agents.find((x) => x.paneId === paneId)
      if (!a || a.chief) return null
      const mine = ofSession(f)
      let t = threadId && mine.find((x) => x.id === threadId)
      if (!t) {
        const busy = f.agents.filter((x) => x.chief && x.thread?.id && x.status === 'working')
        t = mine.find((x) => x.id === (busy.length === 1 ? busy[0].thread.id : 'main'))
      }
      if (!t) return null
      t.agents = [{ paneId: a.paneId, tabId: a.tabId, sessionId: a.sessionId || null, at: new Date().toISOString() }, ...t.agents.filter((l) => l.paneId !== a.paneId)].slice(0, KEEP_AGENTS)
      save()
      return { thread: t.id }
    },
  }
}
