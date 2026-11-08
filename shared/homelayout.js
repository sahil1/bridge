// How Home's sections are arranged: their order, and which you've hidden. Edit Home sets it, as an
// iPhone's home screen is arranged, and the computer keeps it (server/home.js), one for its own
// window and one for phones, as a phone's screen wants another order. The page and the server both
// read a kept one through arrange(), so one kept by an older or newer Bridge AI is still whole.
//
// This computer's things come first by default: what waits on you, what's ready to look at, what's
// coming up and the Chief of Staff's tasks; your other computers last. Hidden is never left out of a
// count: what needs you counts wherever its section is.
export const SECTIONS = ['waiting', 'ready', 'coming', 'chief', 'away']
export const FOR = ['computer', 'phone']

// A kept arrangement made whole: known sections only, each once, and one it doesn't name (a section
// added since) where it goes by default, after the one before it there.
export function arrange(kept) {
  const known = (x) => SECTIONS.includes(x)
  const order = [...new Set((Array.isArray(kept?.order) ? kept.order : []).filter(known))]
  for (const id of SECTIONS) {
    if (order.includes(id)) continue
    const before = SECTIONS.slice(0, SECTIONS.indexOf(id)).reverse().find((x) => order.includes(x))
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id)
  }
  const hidden = Array.isArray(kept?.hidden) ? kept.hidden : []
  return { order, hidden: SECTIONS.filter((x) => hidden.includes(x)) }
}

export const isDefault = (a) => a.order.join() === SECTIONS.join() && !a.hidden.length
export const equal = (a, b) => a.order.join() === b.order.join() && a.hidden.join() === b.hidden.join()

// The sections shown while arranging (ids) in a new order. One that isn't shown (hidden, or not for
// this computer) goes with the one before it, so brought back it's after the same one as it was.
export function reorder(order, ids) {
  const lead = []
  const after = new Map(ids.map((id) => [id, []]))
  let last = null
  for (const id of order) {
    if (after.has(id)) last = id
    else if (last) after.get(last).push(id)
    else lead.push(id)
  }
  return [...lead, ...ids.flatMap((id) => [id, ...after.get(id)])]
}
