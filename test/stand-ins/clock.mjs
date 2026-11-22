// Bridge AI's server at another time of day, for a test that tries one (node --import this, with
// BRIDGE_TEST_CLOCK_OFFSET in ms): Date and Date.now run that far from the real clock, flowing as it
// does, so the server can be at 03:00 or 21:30 whenever the test runs. Dates given in full are
// left as they are; only "now" moves. So do the times files say they were changed: a file saved a
// second ago is a second old by this clock too (a whiteboard an agent just drew is news), as it
// would be on a computer whose clock said that.
// BRIDGE_TEST_CLOCK_FILE: a file of more ms ahead, which the test writes as it goes (read every
// tenth of a second at most), so what's timed by the clock (a wait of 15 minutes) passes in a moment.
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

// A Date class that runs off ms from Real (the harness's testClock gives a test its own), and more()
// ms on top of that.
export function shiftedDate(off, Real = Date, more = () => 0) {
  const now = () => Real.now() + off + more()
  function FakeDate(...a) {
    if (!new.target) return new Real(now()).toString()
    return a.length ? new Real(...a) : new Real(now())
  }
  Object.setPrototypeOf(FakeDate, Real)
  FakeDate.prototype = Real.prototype
  FakeDate.now = now
  return FakeDate
}

const off = Number(process.env.BRIDGE_TEST_CLOCK_OFFSET || 0)
const file = process.env.BRIDGE_TEST_CLOCK_FILE || ''
const Real = Date
if (off || file) {
  let ahead = 0
  let looked = 0
  const more = () => {
    if (!file || Real.now() - looked < 100) return ahead
    looked = Real.now()
    try { ahead = Number(fs.readFileSync(file, 'utf8')) || 0 } catch { ahead = 0 }
    return ahead
  }
  globalThis.Date = shiftedDate(off, Real, more)
}
if (off) {
  // A file's times as read (stat, lstat, fstat; with a callback, synchronously or as a promise).
  const shift = (st) => {
    if (st && typeof st.mtimeMs === 'number') for (const k of ['atime', 'mtime', 'ctime', 'birthtime']) { st[`${k}Ms`] += off; st[k] = new Real(st[`${k}Ms`]) }
    return st
  }
  for (const name of ['stat', 'lstat', 'fstat']) {
    const sync = fs[`${name}Sync`]
    fs[`${name}Sync`] = (...a) => shift(sync(...a))
    const cb = fs[name]
    fs[name] = (...a) => { const done = a.pop(); return cb(...a, (e, st) => done(e, shift(st))) }
    const pr = fs.promises[name]
    if (pr) fs.promises[name] = (...a) => pr(...a).then(shift)
  }
  syncBuiltinESMExports()
}
