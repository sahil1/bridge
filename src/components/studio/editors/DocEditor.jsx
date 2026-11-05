import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
import Icon from '../../Icon.jsx'
import { t } from '../../../i18n/index.js'
import { textOf } from '../files.js'
import { docxOf } from '../docx.js'
import { lookOf, lookCss, lookColours } from '../look.js'

// A document: Markdown as Markdown (it's saved as Markdown, as written), a Word file read into
// headings, paragraphs, lists, tables and pictures (mammoth) and saved back as a Word file. A plain
// text file is edited as it is, and a Word file keeps its fonts, sizes and colours (look.js), shown
// here as they are. handle: save() gives the bytes to write, selection() what's picked, for Ask an
// agent, and the heading it's under.
export default function DocEditor({ file, data, onDirty, handle, readOnly = false }) {
  const md = file.ext === '.md' || file.ext === '.markdown'
  const plain = file.ext === '.txt'
  const [start, setStart] = useState(null) // { content, notes, look }
  useEffect(() => {
    let on = true
    if (md || plain) setStart({ content: textOf(data), notes: [] })
    else {
      Promise.all([import('mammoth/mammoth.browser.js').then((m) => (m.default || m).convertToHtml({ arrayBuffer: data })), lookOf(data)])
        .then(([r, look]) => on && setStart({ content: r.value, notes: (r.messages || []).filter((x) => x.type === 'warning'), look }), (e) => on && setStart({ error: e.message }))
    }
    return () => { on = false }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!start) return <p className="muted small sd-loading">{t('Opening…')}</p>
  if (start.error) return <p className="error-text">{t("Couldn't read this Word file: {error}", { error: start.error })}</p>
  if (plain) return <PlainText text={start.content} onDirty={onDirty} handle={handle} readOnly={readOnly} />
  return <Rich file={file} start={start} md={md} onDirty={onDirty} handle={handle} readOnly={readOnly} />
}

function PlainText({ text, onDirty, handle, readOnly }) {
  const [v, setV] = useState(text)
  handle.current = {
    save: async () => v,
    selection: () => { const el = document.activeElement; return el?.tagName === 'TEXTAREA' && el.selectionEnd > el.selectionStart ? { text: v.slice(el.selectionStart, el.selectionEnd) } : null },
  }
  return <textarea className="sd-plain" value={v} readOnly={readOnly} onChange={(e) => { setV(e.target.value); onDirty(true) }} spellCheck />
}

function Rich({ file, start, md, onDirty, handle, readOnly }) {
  // Changed once you change it (a key, a paste, a drop, a button), not when the editor sets itself
  // up with the file (a Markdown file read, a Word file's parts put in order), which it reports as
  // changes too.
  const touched = useRef(false)
  const touch = () => { touched.current = true; return false }
  const editor = useEditor({
    extensions: [StarterKit, Image.configure({ allowBase64: true }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell, ...(md ? [Markdown.configure({ html: false, tightLists: true, linkify: true })] : [])],
    content: start.content,
    editable: !readOnly,
    editorProps: { handleDOMEvents: { keydown: touch, paste: touch, drop: touch, cut: touch } },
    onUpdate: ({ transaction }) => { if (touched.current && transaction.docChanged) onDirty(true) },
  }, [start])
  useEffect(() => { editor?.setEditable(!readOnly) }, [editor, readOnly])
  handle.current = {
    save: async () => (md ? editor.storage.markdown.getMarkdown() : docxOf(editor.getJSON(), start.look)),
    // What's picked, and the heading it's under ("under Pricing"), so the agent finds the place.
    selection: () => {
      if (!editor) return null
      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to, '\n').trim()
      let heading = null
      editor.state.doc.nodesBetween(0, from, (n) => { if (n.type.name === 'heading') heading = n.textContent })
      return text ? { text, where: heading ? t('under "{heading}"', { heading }) : null } : null
    },
  }
  if (!editor) return null
  const btn = (name, icon, run, on) => <button type="button" className={`sd-tool${on ? ' on' : ''}`} onClick={run} title={name} aria-label={name} disabled={readOnly}>{icon}</button>
  const c = () => { touched.current = true; return editor.chain().focus() }
  return (
    <div className="sd-doc">
      {!readOnly && (
        <div className="sd-toolbar" role="toolbar" aria-label={t('Formatting')}>
          {btn(t('Heading'), <b>H</b>, () => c().toggleHeading({ level: 2 }).run(), editor.isActive('heading'))}
          {btn(t('Bold'), <b>B</b>, () => c().toggleBold().run(), editor.isActive('bold'))}
          {btn(t('Italic'), <i>I</i>, () => c().toggleItalic().run(), editor.isActive('italic'))}
          {btn(t('Bulleted list'), '•', () => c().toggleBulletList().run(), editor.isActive('bulletList'))}
          {btn(t('Numbered list'), '1.', () => c().toggleOrderedList().run(), editor.isActive('orderedList'))}
          {btn(t('Quote'), '“', () => c().toggleBlockquote().run(), editor.isActive('blockquote'))}
          {btn(t('Table'), <Icon name="grid" size={13} />, () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), false)}
          <span className="sd-grow" />
          {btn(t('Undo'), <Icon name="undo" size={13} />, () => c().undo().run(), false)}
        </div>
      )}
      {start.notes?.length > 0 && <p className="muted small sd-note">{t('Some of this Word file\'s formatting isn\'t shown here ({n} parts). Saving keeps its text, headings, lists, tables, pictures, fonts and colours; the file as it was stays in its versions.', { n: start.notes.length })}</p>}
      <EditorContent editor={editor} className={`sd-page${file.ext === '.docx' ? ' word' : ''}${lookColours(start.look) ? ' paper' : ''}`} style={lookCss(start.look)} />
    </div>
  )
}
