// Words put on the clipboard, and whether they got there, for the button that did it to say so (a
// Copy that showed nothing, or a tick when the browser had said no, left you pasting what was there
// before). The browser's clipboard first; where a page may not use it (an address that isn't secure,
// as another computer's by its IP, or no permission), the old way, a selection copied.
export async function copyText(text) {
  const words = String(text ?? '')
  try {
    await navigator.clipboard.writeText(words)
    return true
  } catch { /* the old way */ }
  const was = document.activeElement
  const box = document.createElement('textarea')
  try {
    box.value = words
    box.setAttribute('readonly', '')
    box.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0'
    document.body.appendChild(box)
    box.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    box.remove()
    was?.focus?.({ preventScroll: true })
  }
}
