// A recording (whatever the browser's MediaRecorder made: WebM/Opus, MP4/AAC) as a 16 kHz mono
// 16-bit WAV, what the computer's speech engine reads with nothing to install (server/voice.js).
// Decoded by the browser itself; each 16 kHz sample is the average of the stretch it stands for.
export async function toWav(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext
  const ctx = new Ctx()
  try {
    const audio = await new Promise((resolve, reject) => {
      blob.arrayBuffer().then((buf) => {
        const p = ctx.decodeAudioData(buf, resolve, reject) // Safari's older form takes callbacks
        if (p?.then) p.then(resolve, reject)
      }, reject)
    })
    const n = audio.length
    const mono = new Float32Array(n)
    for (let c = 0; c < audio.numberOfChannels; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / audio.numberOfChannels }
    const ratio = audio.sampleRate / 16000
    const out = new Int16Array(Math.floor(n / ratio))
    for (let i = 0; i < out.length; i++) {
      const a = Math.floor(i * ratio)
      const z = Math.max(a + 1, Math.floor((i + 1) * ratio))
      let s = 0
      for (let j = a; j < z && j < n; j++) s += mono[j]
      out[i] = Math.max(-32768, Math.min(32767, Math.round((s / (z - a)) * 32767)))
    }
    return wavBlob(out)
  } finally { ctx.close?.().catch(() => {}) }
}

export function wavBlob(pcm, rate = 16000) {
  const b = new DataView(new ArrayBuffer(44 + pcm.length * 2))
  const str = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); b.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, rate, true)
  b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) b.setInt16(44 + i * 2, pcm[i], true)
  return new Blob([b.buffer], { type: 'audio/wav' })
}
