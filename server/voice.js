// Voice notes: speech to text on this computer with whisper.cpp, so audio never leaves it.
// Needs ffmpeg (to turn the browser's recording into a WAV), whisper-cli, and a speech model.
// The model is one download (Settings, or the first tap on the mic); the two programs come from
// a package manager, installed in a terminal tab you can watch.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { DATA, IS_MAC, expand } from './paths.js'
import { loginPath, which } from './agents.js'

const MODEL_NAME = 'ggml-small.en-q5_1.bin'
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`
const MODEL_MB = 190

let cfg = {}
export const configure = (c) => { cfg = c || {} }
const modelPath = () => (cfg.voice?.model ? expand(cfg.voice.model) : path.join(DATA, 'models', MODEL_NAME))
const exists = (p) => fs.promises.access(p).then(() => true, () => false)

// Looked up on the login PATH: opened at login, the app's own PATH has no Homebrew folders.
async function tools() {
  const PATH = await loginPath()
  const [ffmpeg, whisper] = await Promise.all([which('ffmpeg', PATH), which('whisper-cli', PATH)])
  return { ffmpeg, whisper, brew: IS_MAC ? await which('brew', PATH) : null }
}

let download = null // { got, total, error } while the model is downloading, or after it failed

export async function status() {
  const [t, model] = await Promise.all([tools(), exists(modelPath())])
  const missing = [!t.ffmpeg && 'ffmpeg', !t.whisper && 'whisper-cli'].filter(Boolean)
  return {
    ready: model && !missing.length,
    model,
    modelMB: MODEL_MB,
    missing,
    // What setup would type in a terminal for the programs, when we know how on this computer.
    installCommand: missing.length ? installCommand(t, missing) : null,
    downloading: download && !download.error ? { percent: download.total ? Math.floor((download.got / download.total) * 100) : 0 } : null,
    error: download?.error || null,
  }
}

// Homebrew on a Mac. Elsewhere package names vary, so the app just says what's needed.
function installCommand(t, missing) {
  if (!t.brew) return null
  return `brew install ${missing.map((m) => (m === 'whisper-cli' ? 'whisper-cpp' : m)).join(' ')}`
}

// Downloads the model in the background; status() reports progress. Written to a temporary name
// and renamed when complete, so a half-finished download never counts as the model.
export async function fetchModel() {
  if (download && !download.error) return
  const dest = modelPath()
  if (await exists(dest)) return
  download = { got: 0, total: 0, error: null }
  const tmp = `${dest}.part`
  ;(async () => {
    try {
      await fs.promises.mkdir(path.dirname(dest), { recursive: true })
      const res = await fetch(MODEL_URL, { signal: AbortSignal.timeout(30 * 60 * 1000) })
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
      download.total = Number(res.headers.get('content-length')) || 0
      const out = fs.createWriteStream(tmp)
      for await (const chunk of res.body) {
        download.got += chunk.length
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())))
      if (download.total && download.got !== download.total) throw new Error('Download was cut short; try again')
      await fs.promises.rename(tmp, dest)
      download = null
    } catch (e) {
      fs.promises.rm(tmp, { force: true }).catch(() => {})
      download = { got: 0, total: 0, error: e.message || 'Download failed' }
    }
  })()
}

const runBin = (bin, args, timeout = 120000) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).slice(-300))) : resolve(stdout)))
})

export async function transcribe(audio) {
  if (!audio?.length) throw new Error('No audio received')
  const [t, model] = await Promise.all([tools(), exists(modelPath())])
  if (!model || !t.ffmpeg || !t.whisper) throw new Error('Voice notes need a one-time setup on your computer')
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cc-voice-'))
  try {
    const input = path.join(dir, 'in')
    const wav = path.join(dir, 'in.wav')
    await fs.promises.writeFile(input, audio)
    await runBin(t.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
    // A vocabulary hint so tool names come out right; add your own words with voice.prompt.
    const hint = cfg.voice?.prompt || 'chief of staff, Claude, Codex, Gemini, Cursor, Grok, Copilot, GitHub, worktree, PR, repo.'
    const out = await runBin(t.whisper, ['-m', modelPath(), '-f', wav, '-nt', '-np', '-l', 'en', '-t', '6', '--prompt', hint])
    return { text: out.replace(/\[(BLANK_AUDIO|MUSIC|SOUND|NOISE)[^\]]*\]/gi, '').replace(/\s+/g, ' ').trim() }
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
