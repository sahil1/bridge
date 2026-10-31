// Small enough to sit in the app's first file: what tells a diagram apart, and opening one as a
// whiteboard. The whiteboard itself loads only when one is opened.
import { api } from '../../api.js'
import { t } from '../../i18n/index.js'

// Not in the demo or the phone apps' Cloud agents, which have no computer to keep boards on.
export const whiteboards = import.meta.env.MODE !== 'demo' && import.meta.env.MODE !== 'cloud'

// Diagrams the whiteboard turns into shapes you can move and edit.
export const isMermaid = (text) => /^\s*(%%[^\n]*\n\s*)*(flowchart|graph|sequenceDiagram|classDiagram)\b/.test(String(text || ''))
export const isDiagramFile = (name) => /\.(excalidraw|mmd|mermaid|drawio|dio)$/i.test(String(name || ''))

export const openBoard = (id, more = {}) => window.dispatchEvent(new CustomEvent('bridge-open-board', { detail: { id, ...more } }))
export const openBoards = (more = {}) => window.dispatchEvent(new CustomEvent('bridge-open-board', { detail: { list: true, ...more } }))

// Mermaid from a chat or a Markdown file, as a new whiteboard named after where it came from. It's
// drawn into shapes when the board opens.
export async function boardFromMermaid(text, title) {
  const b = await api('/boards', { method: 'POST', body: { title: title || t('Diagram'), source: { kind: 'mermaid', text } } })
  openBoard(b.id)
  return b
}

// Under each Mermaid block in rendered Markdown (the file viewer), a button that opens it as a
// whiteboard. Made here rather than in the Markdown's HTML, which is cleaned of buttons.
export function addMermaidButtons(root, title) {
  if (!root) return
  root.querySelectorAll('pre > code.language-mermaid').forEach((code, i) => {
    const pre = code.parentElement
    if (pre.nextElementSibling?.classList.contains('wb-open-mermaid')) return
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn small wb-open-mermaid'
    b.textContent = t('Open as a whiteboard')
    b.addEventListener('click', () => { b.disabled = true; boardFromMermaid(code.textContent || '', i ? `${title} ${i + 1}` : title).catch((e) => window.alert(e.message)).finally(() => { b.disabled = false }) })
    pre.after(b)
  })
}
