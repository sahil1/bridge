// A whiteboard written up, for AI Assist's Make a document and Make a deck: what the board's model
// wrote from it (server/boards.js writeUp) made into a file in Studio's own folder, where the decks
// made from meetings go, with a link back to the board's file. A document is a Word file, made as
// Studio's New makes one (docx.js); a deck is a Markdown deck as Studio draws them, to present or
// send as PowerPoint. Returns { root, path, name, model }, to open in Studio.
import { api } from '../../api.js'
import { t } from '../../i18n/index.js'

// The board's file from Studio's (<data>/studio/files to <data>/boards), which Word, a Markdown
// editor or git follow.
const back = (id) => `../../boards/${encodeURIComponent(id)}.excalidraw`

export async function writeUp(id, as, model) {
  const r = await api(`/boards/${encodeURIComponent(id)}/write`, { method: 'POST', body: { as, model } })
  if (as === 'deck') {
    // The link in the first slide's speaker notes, where it doesn't change how the deck looks.
    const slides = r.slides.map((s, i) => (i ? s : `${s}\n\n<!-- ${t('Made from the whiteboard "{name}"', { name: id })}: ${back(id)} -->`))
    const text = `---\nmarp: true\npaginate: true\n---\n\n${slides.join('\n\n---\n\n')}\n`
    const made = await api('/studio/new', { method: 'POST', body: { root: 'studio', dir: '', name: `${r.title} deck.md`, text } })
    return { root: 'studio', ...made, model: r.model }
  }
  // Under its title, a line back to the board; then made a Word file from its Markdown.
  const md = r.markdown.replace(/^(# [^\n]*\n)/, `$1\n_${t('Made from the whiteboard')} [${id.replace(/[[\]]/g, '')}](${back(id)})._\n`)
  const [{ markdownHtml }, { generateJSON }, { default: StarterKit }, { docxOf }, { base64 }] = await Promise.all([import('../../markdown.js'), import('@tiptap/core'), import('@tiptap/starter-kit'), import('../studio/docx.js'), import('../studio/files.js')])
  const data = base64(await docxOf(generateJSON(markdownHtml(md), [StarterKit])))
  const made = await api('/studio/new', { method: 'POST', body: { root: 'studio', dir: '', name: `${r.title}.docx`, data } })
  return { root: 'studio', ...made, model: r.model }
}
