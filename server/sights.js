// Who's talking, from the call's video (a beta feature, Settings › About & Updates › Beta Features).
// While a call records and someone talks, on the call or on your mic (a room on the call), Bridge AI
// takes a burst of pictures of the call's window now and then: six, a sixth of a second apart
// (callwatch faces). Apple's Vision, on this Mac, finds the faces on them and how open each mouth
// is, and reads the names on the tiles. A mouth that opens and closes while the others keep still is
// the one talking. Only that's kept, in the meeting's sights.jsonl: when, and each face's place, the
// name under it and how much its mouth moved. The pictures are never written anywhere, so no faces
// from the call are kept. It needs Screen Recording, as the names on the screen do (calls.js), and
// stops with those turned off (Settings › Meetings).
//
// What it's used for: each line's "seen talking", the face seen talking most while it was said.
// voices.js checks the voices against it (a voice seen as two people is two, two seen as one are
// one) and the model naming who said what is told it (meetings.js nameSpeakers), so a call whose
// camera shows the room, or each person in it on a tile of their own, names them as they talk.
import fs from 'node:fs'
import path from 'node:path'
import { DATA } from './paths.js'

let cfg = {}
export const configure = (c) => { cfg = c || {} }
export const on = () => cfg.trials?.['call-video'] === true && cfg.meetings?.nameSpeakers !== false

const DIR = path.join(DATA, 'meetings')
const fileOf = (id) => {
  if (!/^[\w-]+$/.test(String(id || ''))) throw new Error('No such meeting')
  return path.join(DIR, id, 'sights.jsonl')
}

// A mouth that moved this much (the inner lips' height, as a share of the face's, from its most
// shut to its most open in a burst) is talking. On a press briefing's video a speaker's moved 0.07
// to 0.08 in a second; faces keeping still, 0.004 at most.
export const MOVE = Number(process.env.BRIDGE_SIGHT_MOVE) || 0.03
const moved = (f) => (Array.isArray(f.open) && f.open.length >= 3 ? Math.max(...f.open) - Math.min(...f.open) : 0)

// The call's own buttons and words, which aren't anyone's name.
const CHROME = /^(mute|unmute|start video|stop video|video|camera|mic|share|share screen|chat|participants|people|record|recording|reactions|react|raise|apps|more|leave|end|view|rooms|breakout rooms|security|captions|live|you|me)$/i
// The words read on a picture that could be a tile's name: a few words with letters in them, the
// dots and bars round them gone.
function names(labels) {
  return (labels || []).map((l) => ({ ...l, text: String(l.text || '').replace(/^[\s.,:;|•·\-–—]+|[\s.,:;|•·\-–—]+$/g, '').replace(/\s+/g, ' ') }))
    .filter((l) => l.text.length >= 2 && l.text.length <= 40 && /\p{L}/u.test(l.text) && l.text.split(' ').length <= 5 && !CHROME.test(l.text))
}
const ORDER = ['on the left', 'in the middle', 'on the right']
const nth = (i) => `${i + 1}${['st', 'nd', 'rd'][i] || 'th'} from the left`
// Each face with the name under it: calls put a tile's name at its bottom left, so it's the nearest
// row of words below the face, and in that row the nearest starting to its left. Faces under one
// name (a room's camera) say where each is: on the left, in the middle, on the right. A face with
// no name says which part of the window it's in. faces and labels: as callwatch faces says them.
export function place(faces, labels) {
  const ls = names(labels)
  const out = (faces || []).filter((f) => f && f.w > 0 && f.h > 0).map((f) => {
    const cx = f.x + f.w / 2
    const below = ls.filter((l) => l.y >= f.y + f.h / 2 && l.y - (f.y + f.h) <= 0.6 && l.x <= cx + f.w / 2)
    const row = Math.min(...below.map((l) => l.y))
    const near = below.filter((l) => l.y - row <= 0.03).sort((a, b) => (cx - a.x) - (cx - b.x))[0] || null
    return { x: f.x, y: f.y, w: f.w, h: f.h, m: Math.round(moved(f) * 1000) / 1000, label: near?.text || null }
  })
  const by = new Map()
  for (const f of out) if (f.label) by.set(f.label, [...(by.get(f.label) || []), f])
  for (const fs of by.values()) {
    if (fs.length < 2) continue
    fs.sort((a, b) => a.x - b.x).forEach((f, i) => { f.where = fs.length <= 3 ? (fs.length === 2 ? ORDER[i * 2] : ORDER[i]) : nth(i) })
  }
  for (const f of out) if (!f.label) f.where = ORDER[Math.min(2, Math.floor((f.x + f.w / 2) * 3))]
  return out
}

// The face talking in a look: the one whose mouth moved, clearly more than any other's (two
// talking at once, or everyone nodding, isn't anyone).
export function talker(faces) {
  const [a, b] = [...(faces || [])].sort((x, y) => y.m - x.m)
  if (!a || a.m < MOVE) return null
  return !b || b.m < MOVE / 2 || a.m >= 2 * b.m ? a : null
}
// Who a face is, the same from look to look: its name, and where under it when the name's a room's.
const whoOf = (f) => (f.label ? `${f.label}${f.where ? `|${f.where}` : ''}` : null)

// A burst's faces, kept: t, seconds into the meeting; raw: what callwatch faces said. Says how many
// faces it saw and who was talking.
export function keep(id, t, raw) {
  const faces = place(raw?.faces, raw?.labels)
  if (faces.length) {
    const r = (v) => Math.round(v * 1000) / 1000
    fs.appendFileSync(fileOf(id), `${JSON.stringify({ t: Math.round(t * 10) / 10, faces: faces.map((f) => ({ x: r(f.x), y: r(f.y), w: r(f.w), h: r(f.h), m: f.m, label: f.label, where: f.where || null })) })}\n`)
  }
  const who = talker(faces)
  return { faces: faces.length, talking: who ? whoOf(who) || who.where : null }
}
export function of(id) {
  try { return fs.readFileSync(fileOf(id), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter((x) => x?.faces) } catch { return [] }
}

// Each line's face seen talking: { key: { who, label, where } }, from the looks taken while it was
// said (and a moment either side), when most of those that saw someone talking saw the same one.
// Only faces with a name under them: a place in the window alone moves when the call's layout does.
const AROUND = 0.6
export function seen(id, lines) {
  const looks = of(id).map((s) => ({ t: s.t, who: talker(s.faces) })).filter((s) => s.who?.label)
  const out = new Map()
  if (!looks.length) return out
  for (const l of lines) {
    if (!l.text || !(l.t1 > l.t0)) continue
    const votes = new Map()
    for (const s of looks) if (s.t >= l.t0 - AROUND && s.t <= l.t1 + AROUND) { const k = whoOf(s.who); votes.set(k, { n: (votes.get(k)?.n || 0) + 1, f: s.who }) }
    const all = [...votes.values()].reduce((n, v) => n + v.n, 0)
    const [best] = [...votes.entries()].sort((a, b) => b[1].n - a[1].n)
    if (best && best[1].n * 2 > all) out.set(`${l.src}:${l.t0}`, { who: best[0], label: best[1].f.label, where: best[1].f.where || null })
  }
  return out
}
// How a model's told it: "Priya Shah", or the person on the left in "Huddle Room".
export const hint = (s) => (s.where ? `the person ${s.where} in "${s.label}"` : `"${s.label}"`)
