// Unfinished work after a restart, with a stand-in Claude Code (stand-ins/claude.cjs): Bridge AI
// stops with its agents' terminals (as an update that replaces the terminal host, a crash or the
// computer restarting does) and starts again. The agent that was working reopens its conversation
// and is told to carry on, once; the one that had finished reopens and waits. With Settings ›
// General › Pick up unfinished work off, a working one reopens and waits too. Then the computer shuts
// down: its terminals end one by one, after the terminal host is stopped from outside (a Mac or
// Linux shutting down) or after the desktop app says so (Windows warns background processes of
// nothing); the working agent stays on the list to reopen, and carries on after the restart.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, sleep, TEST, IS_WIN } from '../lib/harness.mjs'

const { ok, done } = checks('resume-work')
const kit = await startKit('resume-work')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
// What the resumed stand-ins were sent (both write to the same file).
const typed = () => { try { return fs.readFileSync(path.join(kit.home, 'claude-typed.log'), 'utf8') } catch { return '' } }
const carryOns = () => (typed().match(/Carry on from where you left off/g) || []).length
const agentOf = async (pred) => ((await kit.api('/fleet')).agents || []).find(pred)
try {
  await kit.api('/setup', { name: 'Tester' })
  // Look for agents again, as the app does after an install: the server looked before the stand-in was there.
  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed), 'the stand-in Claude Code is found')
  const dir = path.join(kit.home, 'billing')
  fs.mkdirSync(dir, { recursive: true })
  const busy = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Busy', newSpace: 'Busy', prompt: 'Check the billing code' })
  const calm = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Calm', newSpace: 'Calm', prompt: 'idle' })
  ok(!!(await until(() => agentOf((a) => a.paneId === busy.paneId && a.sessionId && a.status === 'working'), 60000, 500)), 'one agent is in the middle of something', await agentOf((a) => a.paneId === busy.paneId))
  ok(!!(await until(() => agentOf((a) => a.paneId === calm.paneId && a.sessionId && ['idle', 'done'].includes(a.status)), 60000, 500)), 'the other has finished', await agentOf((a) => a.paneId === calm.paneId))
  const saved = JSON.parse(fs.readFileSync(path.join(kit.data, 'runtime.json'), 'utf8'))
  ok(saved.panes.find((p) => p.paneId === busy.paneId)?.midTask === true && !saved.panes.find((p) => p.paneId === calm.paneId)?.midTask, 'the saved layout knows which one was mid-task', saved.panes)

  await kit.restart()
  const back = await until(() => agentOf((a) => a.paneId === busy.paneId), 60000, 500)
  ok(!!back && !!(await agentOf((a) => a.paneId === calm.paneId)), 'both come back after the restart, in their own conversations')
  ok(!!(await until(() => carryOns() === 1, 30000, 500)), 'the one that was working is told to carry on', typed())
  ok(/Bridge AI restarted while you were working on this/.test(typed()), 'and why it stopped', typed())
  await sleep(5000)
  ok(carryOns() === 1, 'the one that had finished is left waiting, and nothing is sent twice', typed())

  // Off: a working agent reopens and waits for you.
  await kit.api('/settings', { resumeWork: false }, 'PATCH')
  const busy2 = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Busy again', newSpace: 'Busy again', prompt: 'Check the billing code' })
  ok(!!(await until(() => agentOf((a) => a.paneId === busy2.paneId && a.sessionId && a.status === 'working'), 60000, 500)), 'with the setting off, another agent is working')
  await until(() => JSON.parse(fs.readFileSync(path.join(kit.data, 'runtime.json'), 'utf8')).panes.some((p) => p.paneId === busy2.paneId && p.midTask), 10000, 300)
  await kit.restart()
  ok(!!(await until(() => agentOf((a) => a.paneId === busy2.paneId), 60000, 500)), 'it comes back after the restart')
  await sleep(6000)
  ok(carryOns() === 1, 'and waits for you: nothing is sent', typed())

  // The computer shuts down.
  await kit.api('/settings', { resumeWork: true }, 'PATCH')
  const busy3 = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Busy at night', newSpace: 'Busy at night', prompt: 'Check the billing code' })
  ok(!!(await until(() => agentOf((a) => a.paneId === busy3.paneId && a.sessionId && a.status === 'working'), 60000, 500)), 'an agent is working when the computer shuts down')
  const midTask = () => JSON.parse(fs.readFileSync(path.join(kit.data, 'runtime.json'), 'utf8')).panes.some((p) => p.paneId === busy3.paneId && p.midTask)
  await until(midTask, 10000, 300)
  const host = JSON.parse(fs.readFileSync(path.join(kit.data, 'host', 'host.json'), 'utf8')).pid
  if (IS_WIN) { await kit.api('/system/stopping', {}); process.kill(host) } else process.kill(host, 'SIGTERM')
  ok(!!(await until(() => /The computer is shutting down/.test(kit.log()), 10000, 200)), 'Bridge AI hears the computer is shutting down', kit.log().slice(-600))
  await sleep(3000) // the terminals end meanwhile
  ok(midTask(), 'the agent stays on the list to reopen, with what it was doing', JSON.parse(fs.readFileSync(path.join(kit.data, 'runtime.json'), 'utf8')).panes)
  await kit.restart()
  ok(!!(await until(() => agentOf((a) => a.paneId === busy3.paneId), 60000, 500)), 'after the restart it\'s back')
  ok(!!(await until(() => carryOns() === 2, 30000, 500)), 'and told to carry on', typed())
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
