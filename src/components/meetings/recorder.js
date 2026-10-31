// Records a meeting in the page: each source (your mic; on a Mac the server records the call's
// sound itself, meetings.js) is turned into 16 kHz mono 16-bit PCM by a small audio worklet
// (src/audio/pcm.js, which dictation shares), and sent to the server about
// once a second (meetings.js finds the speech and transcribes it). The audio context runs at 16 kHz,
// so the browser does the resampling, and nothing here encodes or analyses audio: it stays light
// for a three-hour meeting.
//
// A source that goes quiet (no call audio yet, a muted mic) is sent as silence, so both sources keep
// the same clock and the transcript lines up. A piece that doesn't get through (Wi-Fi dropped, the
// app restarting) is kept and sent again in order; each carries its number, so the server never
// counts one twice.
//
// On a phone the system takes the mic away while the screen is locked, another app is in front or a
// call rings (and a computer does when it sleeps). The recording carries on when it's back: the
// sound is started again, the mic asked for again if it was let go, and onGap says how long nothing
// could be heard. The server times the meeting by the sound it gets, so that stretch is left out,
// as a pause is.
import { BASE } from '../../api.js'
import { RATE, addWorklet, askMic } from '../../audio/pcm.js'

// streams: { you: MediaStream, them?: MediaStream }. onLevel({ you, them }) for the meters;
// onTrouble(message | null) when pieces aren't getting through, and when they are again;
// reopen: { you: () => a new MediaStream } for a source whose mic was let go; onGap(ms) after a
// stretch when nothing could be heard.
export async function record(meetingId, streams, { onLevel, onTrouble, reopen = {}, onGap } = {}) {
  const ctx = new AudioContext({ sampleRate: RATE })
  await addWorklet(ctx) // src/audio/pcm.js
  const levels = {}
  const sinks = []
  let paused = false
  let stopped = false
  const outbox = [] // { src, seq, buf }
  const seq = {}
  const last = {} // when each source's last piece came, to notice a stretch with none
  let sending = false
  let failing = 0

  const send = async () => {
    if (sending) return
    sending = true
    try {
      while (outbox.length) {
        const p = outbox[0]
        const res = await fetch(`${BASE}/api/meetings/${encodeURIComponent(meetingId)}/audio?src=${p.src}&seq=${p.seq}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: p.buf })
        if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}`)
        outbox.shift()
        if (failing) { failing = 0; onTrouble?.(null) }
      }
    } catch {
      failing++
      if (failing === 3) onTrouble?.('Audio isn\'t reaching Bridge AI. It\'s kept here and sent when it can be.')
      setTimeout(() => { sending = false; send() }, Math.min(10_000, 1000 * failing))
      return
    }
    sending = false
  }

  for (const [src, stream] of Object.entries(streams)) {
    if (!stream) continue
    const node = new AudioWorkletNode(ctx, 'bridge-pcm', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' })
    seq[src] = 0
    node.port.onmessage = (e) => {
      if (e.data.level != null) { levels[src] = e.data.level; onLevel?.({ ...levels }); return }
      if (paused || !e.data.pcm) return
      // A piece is a second of sound: much longer since the last one, and nothing was heard between.
      const now = Date.now()
      if (last[src] && now - last[src] > 3000) onGap?.(now - last[src] - 1000)
      last[src] = now
      outbox.push({ src, seq: seq[src]++, buf: e.data.pcm })
      // Hours offline would be a lot of memory: past ten minutes, the oldest go.
      if (outbox.length > 1200) outbox.splice(0, outbox.length - 1200)
      send()
    }
    const sink = { src, node, input: ctx.createMediaStreamSource(stream), stream }
    sink.input.connect(node)
    sinks.push(sink)
    watchTrack(sink)
  }

  // Back from a lock, a call or sleep: the sound starts again, and a mic that was let go is asked for again.
  let reopening = false
  async function wake() {
    if (stopped || document.hidden) return
    if (ctx.state !== 'running') await ctx.resume().catch(() => {})
    for (const s of sinks) if (s.stream.getAudioTracks().every((t) => t.readyState === 'ended')) await again(s)
  }
  async function again(s) {
    if (reopening || stopped || !reopen[s.src]) return
    reopening = true
    try {
      const stream = await reopen[s.src]()
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
      s.input.disconnect()
      const old = s.stream
      s.stream = stream
      old.getTracks().forEach((t) => t.stop()) // ended already, or swapped (swap)
      s.input = ctx.createMediaStreamSource(stream)
      s.input.connect(s.node)
      watchTrack(s)
    } catch { /* not now (still in the background): asked again when it's back */ } finally { reopening = false }
  }
  function watchTrack(s) {
    for (const t of s.stream.getAudioTracks()) t.addEventListener('ended', () => { if (!stopped && !document.hidden) again(s) })
  }
  ctx.onstatechange = () => { if (ctx.state !== 'running') wake() }
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)

  return {
    pause() { paused = true; for (const s of sinks) s.node.port.postMessage('flush') },
    // A pause isn't a gap: count from the first piece after it.
    resume() { paused = false; for (const k of Object.keys(last)) delete last[k] },
    get paused() { return paused },
    // The source's stream opened again from reopen, with the settings that fit now (a call started
    // or ended: microphone()'s room).
    async swap(src) { const s = sinks.find((x) => x.src === src); if (s) await again(s) },
    // Sends what's left, then lets the mic and the call's sound go.
    async stop() {
      if (stopped) return
      stopped = true
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      for (const s of sinks) s.node.port.postMessage('flush')
      await new Promise((r) => setTimeout(r, 300))
      for (const s of sinks) { s.input.disconnect(); s.stream.getTracks().forEach((t) => t.stop()) }
      await ctx.close().catch(() => {})
      const end = Date.now() + 15_000
      while (outbox.length && Date.now() < end) { send(); await new Promise((r) => setTimeout(r, 300)) }
    },
  }
}

// Your mic. On a call, with the browser's echo and noise handling on: it takes out much of the
// call's sound your mic picks up from the speakers. In a room (room: no call on this computer),
// without: that handling keeps the one voice close to the mic and drops the rest as noise, and in
// a room the rest are the people around the table.
export async function microphone(deviceId, { room = false } = {}) {
  await askMic()
  return navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: !room, noiseSuppression: !room, autoGainControl: true } })
}
