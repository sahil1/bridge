// A shortcut as this computer writes it, for a tooltip: keys('mod', 'shift', 's') is ⇧⌘S on a Mac
// (its own order: ⌥ ⇧ ⌘, then the key) and Ctrl+Shift+S elsewhere.
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const SIGN = { alt: ['⌥', 0], shift: ['⇧', 1], mod: ['⌘', 2] }
const WORD = { alt: 'Alt', shift: 'Shift', mod: 'Ctrl' }
export function keys(...k) {
  if (MAC) return [...k].sort((a, b) => (SIGN[a]?.[1] ?? 3) - (SIGN[b]?.[1] ?? 3)).map((x) => SIGN[x]?.[0] || x.toUpperCase()).join('')
  return k.map((x) => WORD[x] || x.toUpperCase()).join('+')
}
// "Bold (⌘B)": a name with its shortcut, for a button's tooltip.
export const withKeys = (name, ...k) => (k.length ? `${name} (${keys(...k)})` : name)
