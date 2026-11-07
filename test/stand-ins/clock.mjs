// Bridge AI's server at another time of day, for a test that tries one (node --import this, with
// BRIDGE_TEST_CLOCK_OFFSET in ms): Date and Date.now run that far from the real clock, flowing as it
// does, so the server can be at 03:00 or 21:30 whenever the test runs. Dates given in full are
// left as they are; only "now" moves. So do the times files say they were changed: a file saved a
// second ago is a second old by this clock too (a whiteboard an agent just drew is news), as it
// would be on a computer whose clock said that.
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

// A Date class that runs off ms from Real (the harness's testClock gives a test its own).
export function shiftedDate(off, Real = Date) {
  function FakeDate(...a) {
    if (!new.target) return new Real(Real.now() + off).toString()
    return a.length ? new Real(...a) : new Real(Real.now() + off)
  }
  Object.setPrototypeOf(FakeDate, Real)
  FakeDate.prototype = Real.prototype
  FakeDate.now = () => Real.now() + off
  return FakeDate
}

const off = Number(process.env.BRIDGE_TEST_CLOCK_OFFSET || 0)
if (off) {
  const Real = Date
  globalThis.Date = shiftedDate(off, Real)

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
