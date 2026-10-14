// Jump to a Today tab from anywhere: openToday('mail', { mailId }) or openToday('calendar', { date }).
export function openToday(tab, detail = {}) {
  window.dispatchEvent(new CustomEvent('cc-today', { detail: { tab, ...detail } }))
}
