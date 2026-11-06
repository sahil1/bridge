// Jump to a Today tab from anywhere: openToday('mail', { mailId }) or openToday('calendar', { date }).
export function openToday(tab, detail = {}) {
  window.dispatchEvent(new CustomEvent('cc-today', { detail: { tab, ...detail } }))
}

// A mail action from ⌘K (done, later, reply, keys): Mail opens, and does it on the open message
// once it's there (MailView takes it when it mounts, or at once if it's open).
let pendingMail = null
export function mailDo(what) {
  pendingMail = what
  openToday('mail')
  window.dispatchEvent(new CustomEvent('bridge-mail-do', { detail: { what } }))
}
export const takeMailDo = () => { const w = pendingMail; pendingMail = null; return w }
