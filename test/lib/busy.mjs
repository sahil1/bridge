// What the busy-agent and busy-queue suites share: a server with the stand-in Claude Code
// (stand-ins/claude.cjs "busy"), agents started on it, and the browser's view of a chat.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, until, sleep, browser, page, TEST } from './harness.mjs'

export const LIGHT = { mode: 'light', theme: 'sky' }
export const DARK = { mode: 'dark', theme: 'midnight' }
export const enc = encodeURIComponent
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export async function busyKit(name) {
  const kit = await startKit(name)
  kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  const { b, which } = await browser()
  // What a stand-in took in, as it got it: { session, text, how }, oldest first.
  const got = (session) => { try { return fs.readFileSync(path.join(kit.home, 'claude-got.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.session === session) } catch { return [] } }
  const agentOf = async (paneId) => ((await kit.api('/fleet')).agents || []).find((a) => a.paneId === paneId)
  const queueOf = async (paneId) => (((await kit.api('/fleet')).queue || {})[paneId] || []).map((x) => x.text)
  const dir = path.join(kit.home, 'billing')
  fs.mkdirSync(dir, { recursive: true })
  // An agent started on `prompt` ("busy ..."), once it has taken that in.
  const launch = async (label, prompt) => {
    const a = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label, newSpace: 'Billing', prompt })
    const x = await until(async () => { const y = await agentOf(a.paneId); return y?.sessionId && got(y.sessionId).length && y }, 40000, 300)
    return { ...a, sessionId: x?.sessionId, began: Date.now() }
  }
  const working = (ag) => until(async () => (await agentOf(ag.paneId))?.status === 'working', 20000, 200)
  // A turn of "hold" ends: the test has seen what it wanted to while the agent works.
  const release = (ag) => fs.writeFileSync(path.join(kit.home, `claude-go-${ag.sessionId}`), '')
  // Done with its first message (`secs` long).
  const settled = async (ag, secs) => {
    await sleep(Math.max(0, ag.began + secs * 1000 - Date.now()))
    return until(async () => ['done', 'idle'].includes((await agentOf(ag.paneId))?.status), 40000, 300)
  }
  const phone = async (look, width) => {
    const v = await page(b, kit.url, { ...look, phone: true })
    if (width !== 390) await v.p.setViewportSize({ width, height: 812 })
    await v.p.waitForSelector('.tabbar button', { timeout: 20000 })
    return v
  }
  // What the agent took in once all of `msgs` have gone in and nothing more waits for it (so nothing
  // more can come).
  const wentIn = async (ag, msgs, ms = 90000) => {
    await until(() => msgs.every((m) => got(ag.sessionId).some((x) => x.text === m)), ms, 500)
    await until(async () => !(await queueOf(ag.paneId)).length && ['done', 'idle'].includes((await agentOf(ag.paneId))?.status), 30000, 300)
    await sleep(1000)
    return got(ag.sessionId)
  }
  return { kit, b, tag: which === 'webkit' ? 'webkit-' : '', got, agentOf, queueOf, launch, working, release, settled, phone, wentIn }
}

export const openChat = async (p, paneId) => {
  await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } })), paneId)
  await p.locator('.composer textarea').waitFor({ timeout: 20000 })
}
// The page knows it's working (its fleet says so), so what's sent now is held.
export const seesWorking = (p) => until(async () => (await p.locator('.console .state-tag.st-working').count()) > 0, 20000, 100)
export const sendFrom = async (p, text, { touch }) => {
  await p.locator('.composer textarea').fill(text)
  if (touch) await p.locator('.composer-stack .send').click()
  else await p.locator('.composer textarea').press('Enter')
}
// The queued messages in the chat: their words, what each says, and whether that shows.
export const bubbles = (p) => p.evaluate(() => [...document.querySelectorAll('.msg.queued')].map((m) => ({ text: m.querySelector('.msg-text').innerText.trim(), says: m.querySelector('.msg-time').innerText.replace(/\s+/g, ' ').trim(), shown: getComputedStyle(m.querySelector('.msg-time')).opacity === '1' })))
export const userMsgs = (p) => p.evaluate(() => [...document.querySelectorAll('.chat .msg.user:not(.queued):not(.pending) .msg-text')].map((e) => e.innerText.trim()))
