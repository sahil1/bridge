// Bridge AI's server at another time of day, for a test that tries one (node --import this, with
// BRIDGE_TEST_CLOCK_OFFSET in ms): Date and Date.now run that far from the real clock, flowing as it
// does, so the server can be at 03:00 or 21:30 whenever the test runs. Dates given in full are
// left as they are; only "now" moves.
const off = Number(process.env.BRIDGE_TEST_CLOCK_OFFSET || 0)
if (off) {
  const Real = Date
  function FakeDate(...a) {
    if (!new.target) return new Real(Real.now() + off).toString()
    return a.length ? new Real(...a) : new Real(Real.now() + off)
  }
  Object.setPrototypeOf(FakeDate, Real)
  FakeDate.prototype = Real.prototype
  FakeDate.now = () => Real.now() + off
  globalThis.Date = FakeDate
}
