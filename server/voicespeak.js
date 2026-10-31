// Reading an answer aloud where the device has no voice of its own (src/voice/speak.js): eSpeak NG
// on this computer, when it's installed (most Linux desktops have it, for their screen reader),
// making a WAV the page plays. Nothing is downloaded and nothing leaves the computer. Elsewhere (a
// Mac, Windows, a phone) the page uses the device's own voices and never asks for this.
import { execFile } from 'node:child_process'
import { tool } from './fixes.js'
import { NODE } from './paths.js'

// BRIDGE_ESPEAK (tests): a script standing in for eSpeak NG, run on the app's own Node.
let found = null // { at, bin }
async function espeak() {
  if (process.env.BRIDGE_ESPEAK) return process.env.BRIDGE_ESPEAK
  if (found && Date.now() - found.at < 5 * 60_000) return found.bin
  found = { at: Date.now(), bin: (await tool('espeak-ng')) || (await tool('espeak')) || null }
  return found.bin
}

export async function status() { return { espeak: !!(await espeak()) } }

// The text read by eSpeak NG, as a WAV (its own 22 kHz). lang: the app's language ('de', 'pt-BR').
export async function speak(text, { lang = 'en' } = {}) {
  const bin = await espeak()
  if (!bin) throw Object.assign(new Error('Nothing on this computer can read it aloud (eSpeak NG isn\'t installed)'), { status: 409 })
  const words = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 4000)
  if (!words) throw Object.assign(new Error('Nothing to read'), { status: 400 })
  const voice = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang) ? lang.toLowerCase() : 'en'
  // The words as an argument after --, so none is ever taken for an option; no shell.
  const args = ['-v', voice, '--stdout', '--', words]
  const script = /\.c?js$/.test(bin)
  return new Promise((resolve, reject) => {
    execFile(script ? NODE.bin : bin, script ? [bin, ...args] : args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 60_000, windowsHide: true, env: { ...process.env, ...(script ? NODE.env : {}) } }, (err, out) => {
      if (err || !out?.length) reject(Object.assign(new Error('eSpeak NG couldn\'t read it'), { status: 502 }))
      else resolve(out)
    })
  })
}
