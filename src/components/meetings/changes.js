// Whether a watched screen shows something new, worth a picture (screen.js keeps it). It's given a
// small greyscale copy of the screen (W by H, in BX by BY blocks) at each look, two seconds apart.
// A picture is worth keeping when enough of the screen's still parts show something other than
// the last picture kept, and have done for three looks in a row. What's left out:
//   - video: a block that keeps changing (a face on a call, a clip playing) is video for two minutes
//     after, and nothing in it is new;
//   - a call's own view: while much of the screen is video, nothing is kept however its tiles
//     change (a camera turning on, the border of whoever's talking). When someone shares, their
//     slides fill the window and the faces are a strip beside them;
//   - what's still changing, or there only a moment: a slide sliding in, a notification;
//   - small things: a cursor, a laser pointer, a name under a tile.
// And it keeps to one picture in ten seconds, and six in any three minutes.
// The server then keeps one only if its words aren't the last one's (meetings.js addCapture).
export const W = 160, H = 90, BX = 16, BY = 9

const MOVING = 4 // a block's mean change between two looks, in grey levels, that's movement
const NEW = 7 // and its change from the last picture kept that's new content
const WHOLE = 0.35 // a look where this much of what isn't video moves is the screen changing (a new slide, a scroll)
const DECAY = 0.95 // how fast a block's movement is forgotten, a look at a time
const LIVELY = 0.6 // movement score (moved in the last ten looks or so) that keeps the blocks round it from counting as new
const VIDEO = 3 // movement score (moving on most looks) that makes a block video
const VIDEO_FOR = 120000 // ms a block stays video after it last was
const CALL_VIEW = 0.25 // this much of the screen video: a call's own view, not something shared
const ENOUGH = 6 // blocks of new content for a picture
const STILL_LOOKS = 3 // looks in a row the new content has to stay still
const WARM = 5 // looks before the first picture, so video can show itself first
const GAP = 10000, BUSY = 6, BUSY_FOR = 180000

// Each block's mean change from one copy to another (all of them when there's nothing to compare).
function blocks(a, b) {
  const out = new Float32Array(BX * BY)
  if (!a || !b) return out.fill(255)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; out[Math.floor(y / (H / BY)) * BX + Math.floor(x / (W / BX))] += Math.abs(a[i] - b[i]) }
  const n = (W / BX) * (H / BY)
  for (let k = 0; k < out.length; k++) out[k] /= n
  return out
}
// Nothing on it: a blank or one-colour screen.
export const blank = (g) => { let lo = 255, hi = 0; for (const v of g) { if (v < lo) lo = v; if (v > hi) hi = v } return hi - lo < 14 }

export function judge() {
  const n = BX * BY
  const score = new Float32Array(n)
  const videoAt = new Float64Array(n).fill(-Infinity)
  let prev = null
  let kept = null
  let looks = 0
  let still = 0 // looks in a row with enough new, still content
  const keptAt = []
  const took = (g, now) => { kept = g; still = 0; keptAt.push(now); while (keptAt.length && now - keptAt[0] > BUSY_FOR) keptAt.shift() }
  return {
    // g: this look; now: its time in ms. True when it's worth a picture (then it's the last kept).
    look(g, now) {
      const moved = blocks(g, prev)
      const since = blocks(g, kept)
      const first = !prev
      prev = g
      looks++
      const isVideo = (k) => now - videoAt[k] < VIDEO_FOR
      const m = (k) => !first && moved[k] > MOVING
      let other = 0, moving = 0
      for (let k = 0; k < n; k++) if (!isVideo(k)) { other++; if (m(k)) moving++ }
      // Most of it changing at once is the screen changing, which is never video.
      const whole = moving >= other * WHOLE
      for (let k = 0; k < n; k++) {
        score[k] = score[k] * DECAY + (!whole && m(k) ? 1 : 0)
        if (score[k] >= VIDEO) videoAt[k] = now
      }
      // New content: still now, different from the last picture, and nothing round it moving lately
      // (the room behind a face that just came on camera).
      const calm = (k) => {
        const x = k % BX, y = Math.floor(k / BX)
        for (let j = Math.max(0, y - 1); j <= Math.min(BY - 1, y + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(BX - 1, x + 1); i++) if (score[j * BX + i] >= LIVELY) return false
        return true
      }
      let video = 0, fresh = 0
      for (let k = 0; k < n; k++) {
        if (isVideo(k)) video++
        else if (!m(k) && since[k] > NEW && calm(k)) fresh++
      }
      still = !whole && fresh >= ENOUGH ? still + 1 : 0
      if (looks <= WARM || blank(g) || video >= n * CALL_VIEW || still < STILL_LOOKS) return false
      if (now - (keptAt.at(-1) ?? -Infinity) < GAP || keptAt.filter((t) => now - t < BUSY_FOR).length >= BUSY) return false
      took(g, now)
      return true
    },
    // A picture kept by hand (Capture): what's new is measured from it.
    byHand(g) { kept = g; still = 0 },
    // How much of the screen is video now, for a call's own view (0 to 1).
    videoShare(now) { let v = 0; for (let k = 0; k < n; k++) if (now - videoAt[k] < VIDEO_FOR) v++; return v / n },
  }
}
