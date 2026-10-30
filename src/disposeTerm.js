// xterm.js syncs its viewport on the next animation frame after open(); disposing the terminal
// before then throws "reading 'dimensions'". So dispose after that frame. This happens when a
// terminal closes as soon as it opens: switching tabs quickly, or React's dev-mode remount.
export default function disposeTerm(term) {
  const go = () => { try { term.dispose() } catch { /* already gone */ } }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0))
  else setTimeout(go, 0)
}
