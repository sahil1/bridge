import { useState } from 'react'
import { cloudOnly, usePoll } from '../api.js'
import { t, tn } from '../i18n/index.js'
import { atEnd, enterDoes, enterKeyOf, keyboardOnScreen, modKey } from '../enter.js'

// Settings › You › Enter Key, as the computer shown has it (src/enter.js).
export const useEnterKey = () => enterKeyOf(usePoll(cloudOnly ? null : '/config', 10 * 60 * 1000).data?.enterKey)

// A message box's Enter, by src/enter.js. onKeyDown sends (send(e)) or leaves the new line to the
// box, and says which it was ('send', 'newline', or null for any other key, which the box handles
// itself); a box can say where its caret counts as being (at). onScreen: what the box does with a
// phone's keyboard on the screen ('send' or 'newline').
// mid: Smart, the caret back in what's written (or words selected), so Enter makes a new line, and
// the hint says ⌘⏎ sends. box: what the textarea takes for that (onSelect, onFocus, onBlur).
export function useEnter(value, send, { onScreen = 'send' } = {}) {
  const mode = useEnterKey()
  const [at, setAt] = useState(null) // the selection, while the box has the focus
  const track = (e) => { const el = e.currentTarget; setAt({ start: el.selectionStart, end: el.selectionEnd }) }
  const onKeyDown = (e, at = e.currentTarget) => {
    const how = enterDoes(e, at, { mode, onScreen: keyboardOnScreen() ? onScreen : null })
    if (how === 'send') { e.preventDefault(); send(e) }
    return how
  }
  const mid = mode === 'smart' && !!at && !!String(value ?? '').trim() && !atEnd(value, at.start, at.end)
  return { mode, mid, onKeyDown, box: { onSelect: track, onFocus: track, onBlur: () => setAt(null) } }
}

// The quiet words by a box while Enter there makes a new line: ⌘⏎ to send (or to save, in an
// edit). Never on a touch screen, where it's the send button (styles.css).
export function EnterHint({ show, save = false }) {
  if (!show) return null
  const keys = <kbd>{modKey()}⏎</kbd>
  return <span className="enter-hint">{save ? tn('{keys} to save', { keys }) : tn('{keys} to send', { keys })}</span>
}

// A box with no line of its own for the hint: it shows in the box's corner, so nothing around the
// box moves (a row of buttons under it wrapping, say) as the caret comes and goes.
export const EnterAt = ({ show, children }) => <div className="enter-at">{children}<EnterHint show={show} /></div>

// The keys a chat's box says it takes (an agent's, a cloud agent's), as Enter Key has them: with the
// caret back in what's written, Enter is a new line there, so only ⌘⏎ is said.
export function SendKeys({ enter }) {
  const mod = <kbd>{modKey()}⏎</kbd>
  if (enter.mode === 'mod') return <>{mod} {t('send')} · <kbd>⏎</kbd> {t('new line')}</>
  if (enter.mid) return tn('{keys} to send', { keys: mod })
  return <><kbd>⏎</kbd> {t('send')} · <kbd>⇧⏎</kbd> {t('new line')}</>
}
