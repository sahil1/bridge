// Editing a message you already sent, like ChatGPT: Bridge AI drives the agent's own rewind
// (Claude Code: Esc Esc opens Rewind, which restores the conversation to just before a message
// and puts that message back in the input box), then sends your edited text in its place.
// Also /btw: Claude answers a side question in a panel over its input box, never in the
// transcript, so Bridge AI reads the answer off the screen and closes the panel.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { draftIn, promptSafe } from './promptsafe.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// eslint-disable-next-line no-control-regex
const plain = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '').replace(/\r/g, '')
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const screenOf = async (rt, paneId) => rt.read(paneId, 60)

// Wait until check(screen) is truthy; returns the screen, or null after `ms`.
async function waitFor(rt, paneId, check, ms = 4000, every = 200) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const s = await screenOf(rt, paneId)
    if (check(s)) return s
    await sleep(every)
  }
  return null
}

const key = (rt, paneId, k) => rt.input(paneId, [{ keys: [k] }])
const pickerOpen = (s) => /Rewind/.test(plain(s)) && /Enter to continue/i.test(plain(s))
// The message the Rewind picker has selected: the "❯ " line in it.
const selected = (s) => {
  const lines = plain(s).split('\n')
  const top = lines.findLastIndex((l) => /^\s*Rewind\s*$/.test(l))
  return (lines.slice(top).find((l) => /^\s*❯\s/.test(l)) || '').replace(/^\s*❯\s/, '').trim()
}

// In a numbered menu ("❯ 1. Restore conversation"), move to the option whose label matches and
// press Enter. Checks what's selected before pressing; false if it couldn't get there.
async function choose(rt, paneId, label) {
  const options = (scr) => plain(scr).split('\n').map((l) => l.match(/^\s*(❯)?\s*(\d+)\.\s+(.*?)\s*$/)).filter(Boolean).map((m) => ({ on: !!m[1], n: Number(m[2]), text: m[3] }))
  for (let tries = 0; tries < 8; tries++) {
    const list = options(await screenOf(rt, paneId))
    const target = list.find((o) => label.test(o.text))
    const at = list.find((o) => o.on)
    if (!target || !at) return false
    if (target.n === at.n) { await key(rt, paneId, 'enter'); return true }
    await key(rt, paneId, target.n > at.n ? 'down' : 'up')
    await sleep(150)
  }
  return false
}

// Rewind to just before the message `original` (back: how many of your messages from the end it
// is, 1 = the last) and send `text` instead. undoFiles also restores the files the agent changed
// since then (Claude's own checkpoints; edits made with shell commands aren't covered).
export async function rewindAndSend(rt, agent, { original, back = 1, text, undoFiles = false }) {
  await rewindTo(rt, agent, { original, back, undoFiles })
  // Back at the prompt with the old message in the box; send the new text (promptSafe clears it).
  return promptSafe(rt, agent.paneId, text, agent)
}

// Undo a reply: back to just before the message that started it, files and conversation, and
// nothing sent. Claude puts that message back in its input box; clear it, so it can't end up in
// front of the next thing you send. files: whether Claude restored them too.
export async function undoReply(rt, agent, { original, back = 1 }) {
  const { files } = await rewindTo(rt, agent, { original, back, undoFiles: true, needFiles: true })
  const paneId = agent.paneId
  if (draftIn(await screenOf(rt, paneId))) await key(rt, paneId, 'ctrl+c')
  if (!(await waitFor(rt, paneId, (s) => draftIn(s) === '', 3000))) throw new Error("The agent went back, but its input box still has your old message in it; clear it in the Terminal tab")
  return { ok: true, files }
}

// Opens the agent's Rewind list, picks the message and what to restore, and waits for the input
// box to come back (with the old message in it). needFiles: if Claude offers no file restore for
// that point, back out and change nothing rather than rewind the conversation alone. (With no
// file changes at all Claude may skip the question and go straight back; files is false then.)
async function rewindTo(rt, agent, { original, back = 1, undoFiles = false, needFiles = false }) {
  const paneId = agent.paneId
  // Interrupt a turn in progress; the picker only opens at the prompt.
  if (agent.status === 'working') {
    await key(rt, paneId, 'esc')
    await waitFor(rt, paneId, (s) => draftIn(s) !== null && !/esc to interrupt/i.test(plain(s)), 8000)
  }
  // An empty input box: Esc Esc with text in it would clear the text instead.
  const s0 = await screenOf(rt, paneId)
  if (draftIn(s0) === null) throw new Error("The agent's input box isn't showing (a menu or question is open). Close it, then try again.")
  if (draftIn(s0)) { await key(rt, paneId, 'ctrl+c'); await sleep(300) }
  await key(rt, paneId, 'esc'); await sleep(250); await key(rt, paneId, 'esc')
  if (!(await waitFor(rt, paneId, pickerOpen, 3000))) throw new Error("Couldn't open the agent's rewind list")

  // Walk up to the message: by position first, then check the text (in case the agent counts
  // messages differently, e.g. slash commands).
  // The list shows each message on one line, cut to the window's width: compare the start.
  const want = norm(original).slice(0, 30)
  const matches = (s) => { const got = norm(selected(s)).replace(/…$/, '').slice(0, 30); return !!want && !!got && (want.startsWith(got) || got.startsWith(want)) }
  let found = false
  for (let i = 0; i < back + 8; i++) {
    await key(rt, paneId, 'up'); await sleep(140)
    if (i + 1 >= back && matches(await screenOf(rt, paneId))) { found = true; break }
  }
  if (!found) { await key(rt, paneId, 'esc'); throw new Error("Couldn't find that message in the agent's rewind list; nothing was changed") }

  await key(rt, paneId, 'enter')
  // Usually Claude then asks what to restore. The options differ (with file changes: code and
  // conversation, conversation, code, summarize...; without: conversation, summarize...), so
  // pick by name, never by position: a wrong pick could summarize or undo files.
  const next = await waitFor(rt, paneId, (s) => /Restore conversation/.test(plain(s)) || draftIn(s) !== null, 4000)
  const menu = next && /Restore conversation/.test(plain(next))
  const files = !!menu && undoFiles && /Restore code and conversation/.test(plain(next))
  const backOut = async (why) => { await key(rt, paneId, 'esc'); await sleep(200); await key(rt, paneId, 'esc'); throw new Error(why) }
  if (needFiles && menu && !files) await backOut('The agent has no saved copy of the files from before that message, so nothing was undone')
  if (menu && !(await choose(rt, paneId, files ? /^Restore code and conversation\b/ : /^Restore conversation\b/))) await backOut("Couldn't pick the restore option in the agent's rewind; nothing was changed")
  if (!(await waitFor(rt, paneId, (s) => draftIn(s) !== null, 5000))) throw new Error('The agent rewound, but its input box didn\'t come back; check the Terminal tab')
  return { files }
}

// After sending "/btw ...": the answer, once it stops changing, then close the panel.
export async function btwAnswer(rt, paneId, question, ms = 90000) {
  const end = Date.now() + ms
  let last = null
  let stableSince = 0
  while (Date.now() < end) {
    await sleep(500)
    const lines = plain(await screenOf(rt, paneId)).split('\n')
    const hint = lines.findLastIndex((l) => /Esc to close/i.test(l))
    if (hint < 0) continue
    const q = lines.slice(0, hint).findLastIndex((l) => /^\s*\/btw\b/.test(l))
    if (q < 0) continue
    const answer = lines.slice(q + 1, hint).map((l) => l.replace(/^ {4,6}/, '')).join('\n').trim()
    if (!answer || /^[·✻✳✶✢*]\s/.test(answer)) { last = null; continue } // still thinking
    if (answer !== last) { last = answer; stableSince = Date.now(); continue }
    if (Date.now() - stableSince > 1200) {
      await key(rt, paneId, 'esc')
      return answer
    }
  }
  return last
}

// ---------- Codex ----------
// Esc Esc opens "Browsing transcript": ←/→ move between your messages (the selected one is drawn
// in reverse video), Enter reverts the conversation to it and puts it back in the input box.
// Codex then continues as a new session (a fork of the old one), so the caller follows that id.
const ROLLOUT = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/
const browsing = (s) => /Browsing transcript/.test(plain(s))
// The message Codex has selected: a "› " line whose text is in reverse video (SGR 7).
function codexSelected(s) {
  for (const raw of String(s || '').replace(/\r/g, '').split('\n').reverse()) {
    if (/^(\x1b\[[0-9;]*m)*›/.test(raw) && /\x1b\[[0-9;]*\b7m/.test(raw.slice(raw.indexOf('›')))) return plain(raw).replace(/^›\s*/, '').trim()
  }
  return ''
}
// Codex's input box: the last "› " line near the bottom; empty when only its dim placeholder shows.
function codexBox(s) {
  const lines = String(s || '').replace(/\r/g, '').split('\n')
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
    const raw = lines[i]
    if (!/^(\x1b\[[0-9;]*m)*›/.test(raw)) continue
    const after = raw.slice(raw.indexOf('›') + 1).replace(/^(\x1b\[0m)?\s?/, '')
    return /^\x1b\[[0-9;]*\b2m/.test(after) ? '' : plain(raw).replace(/^›\s*/, '').trim()
  }
  return null
}

export async function codexRewindAndSend(rt, agent, { original, back = 1, text }) {
  const paneId = agent.paneId
  const sessionsDir = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions')
  if (agent.status === 'working') {
    await key(rt, paneId, 'esc')
    await waitFor(rt, paneId, (s) => !/esc to interrupt/i.test(plain(s)) && codexBox(s) !== null, 10000)
  }
  const s0 = await screenOf(rt, paneId)
  if (codexBox(s0) === null) throw new Error("Codex's input box isn't showing (a menu or question is open). Close it, then try again.")
  if (codexBox(s0)) { await key(rt, paneId, 'ctrl+c'); await sleep(300) }
  // Esc twice opens the transcript (after an interrupt, one is enough).
  await key(rt, paneId, 'esc'); await sleep(250)
  if (!browsing(await screenOf(rt, paneId))) await key(rt, paneId, 'esc')
  if (!(await waitFor(rt, paneId, browsing, 3000))) throw new Error("Couldn't open Codex's message list")

  const want = norm(original).slice(0, 30)
  const matches = (s) => { const got = norm(codexSelected(s)).slice(0, 30); return !!want && !!got && (want.startsWith(got) || got.startsWith(want)) }
  let found = matches(await screenOf(rt, paneId))
  for (let i = 0; !found && i < back + 8; i++) { await key(rt, paneId, 'left'); await sleep(160); found = matches(await screenOf(rt, paneId)) }
  if (!found) { await key(rt, paneId, 'esc'); throw new Error("Couldn't find that message in Codex's list; nothing was changed") }

  const since = Date.now()
  await key(rt, paneId, 'enter')
  const after = await waitFor(rt, paneId, (s) => /Conversation reverted|Failed to edit/i.test(plain(s)) || (!browsing(s) && codexBox(s)), 5000)
  const failed = plain(after || '').match(/Failed to edit[^\n]*/)
  if (failed) { if (codexBox(await screenOf(rt, paneId))) await key(rt, paneId, 'ctrl+c'); throw new Error(`Codex couldn't edit that message: ${failed[0].replace(/^Failed to edit the selected prompt:?\s*/i, '')}`) }
  // The old text is back in the box: clear it, then send the new one.
  if (codexBox(await screenOf(rt, paneId))) { await key(rt, paneId, 'ctrl+c'); await sleep(300) }
  if (codexBox(await screenOf(rt, paneId)) !== '') throw new Error("Codex reverted, but its input box didn't clear; check the Terminal tab")
  await rt.prompt(paneId, text)
  // The new session: rollout-<time>-<old id>_<new id>.jsonl, written since the revert.
  let sessionId = null
  for (let i = 0; i < 20 && !sessionId; i++) {
    await sleep(300)
    sessionId = newestFork(sessionsDir, agent.sessionId, since - 2000)
  }
  return { ok: true, sessionId }
}

function newestFork(root, oldId, since) {
  if (!oldId) return null
  const day = (d) => [String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')]
  let best = null
  for (const d of [new Date(), new Date(Date.now() - 864e5)]) {
    const dir = path.join(root, ...day(d))
    let names = []
    try { names = fs.readdirSync(dir) } catch { continue }
    for (const n of names) {
      if (!n.includes(`${oldId}_`) || !n.endsWith('.jsonl')) continue
      const t = fs.statSync(path.join(dir, n)).mtimeMs
      if (t >= since && (!best || t > best.t)) best = { t, id: n.match(ROLLOUT)?.[1] }
    }
  }
  return best?.id || null
}
