// Jump to a Today tab from anywhere: openToday('mail', { mailId }) or openToday('calendar', { date }).
// Today takes it at once if it's open, else as it opens: a phone's Today, shown for an event, can
// open after the jump was said (on a busy phone, the event's sheet didn't open).
let pendingToday = null
export function openToday(tab, detail = {}) {
  pendingToday = { tab, ...detail }
  window.dispatchEvent(new CustomEvent('cc-today', { detail: pendingToday }))
}
export const takeToday = () => { const d = pendingToday; pendingToday = null; return d }

// A mail action from ⌘K (done, later, reply, keys): Mail opens, and does it on the open message
// once it's there (MailView takes it when it mounts, or at once if it's open).
let pendingMail = null
export function mailDo(what) {
  pendingMail = what
  openToday('mail')
  window.dispatchEvent(new CustomEvent('bridge-mail-do', { detail: { what } }))
}
export const takeMailDo = () => { const w = pendingMail; pendingMail = null; return w }
