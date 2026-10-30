// Voice notes and dictation: speech to text on this computer, so audio never leaves it. The speech
// model is the one picked in Settings › Voice (Parakeet unless you pick another), shared with
// meetings (speech.js runs it); until it's downloaded, the Mac's own speech answers on macOS 26.
// The model is one download, asked for the first time you use the mic (or from Settings), never
// by itself.
//
// The page sends a 16 kHz mono WAV, which goes to the engine as it is. A WAV of another rate or
// with more channels is turned into that here. Other recordings (an older page's compressed audio)
// need ffmpeg to read them; without it, the answer says so.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { IS_MAC, brewInstall } from './paths.js'
import { tool } from './fixes.js'
import * as speech from './speech.js'

let cfg = {}
export const configure = (c) => { cfg = c || {} }

// What voice notes use and need, for the mic and Settings › Voice. The fields the page has always
// read (ready, model, modelMB, missing, installCommand, needsBrew, downloading, error) are kept.
export async function status() {
  const s = await speech.voiceStatus(cfg)
  const m = s.model
  const brew = IS_MAC && s.needs ? await tool('brew') : null
  const dl = m.downloading
  return {
    ...s,
    modelMB: m.mb,
    missing: s.needs === 'whisper' || s.needs === 'brew' ? ['whisper-cli'] : [],
    installCommand: (s.needs === 'whisper' || s.needs === 'brew') && brew ? brewInstall(brew, 'whisper-cpp') : null,
    needsBrew: s.needs === 'brew',
    downloading: dl && !dl.error ? { percent: dl.percent } : null,
    error: dl?.error || null,
  }
}

// The one step voice notes need: the model's download (with progress in status()), or for a
// Whisper model, whisper.cpp too (its install command, for a terminal tab).
export async function setup() {
  const s = await status()
  if (!s.model.have) speech.fetchModel(s.model.id)
  return { ...(await status()), install: s.installCommand }
}

// ---------- The recording, as 16 kHz mono 16-bit PCM in a WAV ----------
export function wavOf(pcm, rate = 16000) {
  const b = Buffer.alloc(44 + pcm.length * 2)
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii'); b.writeUInt32LE(pcm.length * 2, 40)
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i], 44 + i * 2)
  return b
}
// A WAV's samples as 16 kHz mono 16-bit, whatever its rate and channels (16-bit, 24-bit or float),
// or null when it isn't a WAV this reads.
export function readWav(buf) {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.length)
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null
  let fmt = null
  let at = 12
  while (at + 8 <= b.length) {
    const id = b.toString('ascii', at, at + 4)
    const n = b.readUInt32LE(at + 4)
    if (id === 'fmt ') {
      let format = b.readUInt16LE(at + 8)
      if (format === 0xfffe && n >= 40) format = b.readUInt16LE(at + 8 + 24) // extensible: its sub-format
      fmt = { format, channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) }
    } else if (id === 'data' && fmt) {
      const { format, channels, rate, bits } = fmt
      const read = format === 1 && bits === 16 ? (o) => b.readInt16LE(o) / 32768
        : format === 1 && bits === 24 ? (o) => b.readIntLE(o, 3) / 8388608
          : format === 3 && bits === 32 ? (o) => b.readFloatLE(o) : null
      if (!read || !channels || !rate) return null
      const step = (bits / 8) * channels
      const frames = Math.floor(Math.min(n, b.length - at - 8) / step)
      const mono = new Float32Array(frames)
      for (let i = 0; i < frames; i++) { let s = 0; for (let c = 0; c < channels; c++) s += read(at + 8 + i * step + c * (bits / 8)); mono[i] = s / channels }
      // To 16 kHz: each sample the average of the stretch it stands for (which keeps out what's
      // too high to keep), or as it is when it's 16 kHz already.
      const ratio = rate / 16000
      const out = new Int16Array(Math.floor(frames / ratio))
      for (let i = 0; i < out.length; i++) {
        const a = Math.floor(i * ratio)
        const z = Math.max(a + 1, Math.floor((i + 1) * ratio))
        let s = 0
        for (let j = a; j < z && j < frames; j++) s += mono[j]
        out[i] = Math.max(-32768, Math.min(32767, Math.round((s / (z - a)) * 32767)))
      }
      return out
    }
    at += 8 + n + (n % 2)
  }
  return null
}

const runBin = (bin, args, timeout = 120000) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).slice(-300))) : resolve(stdout)))
})
const kindOf = (type) => (String(type || '').split(';')[0].trim() || 'audio of an unknown kind')
// Anything else the page sent (an older page's MediaRecorder audio), read by ffmpeg.
async function viaFfmpeg(audio, type) {
  const ff = await tool('ffmpeg')
  if (!ff) throw Object.assign(new Error(`This recording came as ${kindOf(type)}, which Bridge AI reads with ffmpeg, and ffmpeg isn't on this computer. Update Bridge AI on the device you recorded with (it sends audio Bridge AI reads itself), or install ffmpeg.`), { code: 'needs-ffmpeg', status: 415 })
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cc-voice-'))
  try {
    const input = path.join(dir, 'in')
    const wav = path.join(dir, 'in.wav')
    await fs.promises.writeFile(input, audio)
    await runBin(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
    return await fs.promises.readFile(wav)
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// The answer when voice notes can't run yet: what's needed, in a sentence the page can show as it
// is, and what to download (the page offers it in one click, then sends the recording again).
function notYet(s) {
  const m = s.model
  if (s.needs === 'model') return Object.assign(new Error(`Speech to text needs a one-time download: ${m.label}, ${m.mb} MB. It stays on this computer, and so does what you say.`), { code: 'needs-model', status: 409, model: m })
  return Object.assign(new Error(`${m.label} needs whisper.cpp, which isn't on this computer. Set it up in Settings › Voice, or pick Parakeet there.`), { code: s.needs === 'brew' ? 'needs-brew' : 'needs-whisper', status: 409, model: m })
}

// The names Parakeet listens for in a voice note, besides yours: the agents' and what they work in.
const WORDS = ['Claude', 'Claude Code', 'Codex', 'Gemini', 'Cursor', 'Copilot', 'GitHub', 'worktree']

// Speech to text for a voice note: { text, engine }. Throws with code and status when it can't
// (needs-model: the page offers the download). more: names Bridge AI knows (dictation.js: your
// agents, projects and branches), listened for after the ones here.
export async function transcribe(audio, type, { more = [] } = {}) {
  if (!audio?.length) throw Object.assign(new Error('No audio received'), { status: 400 })
  const s = await status()
  if (!s.ready) throw notYet(s)
  const pcm = readWav(audio)
  const wav = pcm ? wavOf(pcm) : await viaFfmpeg(audio, type)
  // So tool names come out right: whisper takes a hint, Parakeet names to listen for (with the
  // words in Settings › Meetings and meeting memory). Add your own with voice.prompt.
  const prompt = cfg.voice?.prompt || 'chief of staff, Claude, Codex, Gemini, Cursor, Grok, Copilot, GitHub, worktree, PR, repo.'
  const words = [...(cfg.voice?.prompt ? prompt.split(',') : WORDS), ...String(cfg.meetings?.vocabulary || '').split(','), ...more]
  const r = await speech.voice(wav, { cfg, prompt, words })
  return { text: r.text, engine: r.engine }
}
