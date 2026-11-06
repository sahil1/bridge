import { useEffect, useRef, useState } from 'react'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
import Icon from '../../Icon.jsx'
import { t, locale } from '../../../i18n/index.js'
import { textOf } from '../files.js'
import { docxOf } from '../docx.js'
import { lookOf, lookCss, lookColours } from '../look.js'
import { keys, withKeys } from '../keys.js'

// A document: Markdown as Markdown (it's saved as Markdown, as written), a Word file read into
// headings, paragraphs, lists, tables and pictures (mammoth) and saved back as a Word file. A plain
// text file is edited as it is, and a Word file keeps its fonts, sizes and colours (look.js), shown
// here as they are. handle: save() gives the bytes to write, selection() what's picked, for Ask an
// agent, and the heading it's under. onStats: its words and characters, for the page's status line.
//
// The toolbar offers only what the file's format keeps when it's saved: Markdown has no underline,
// and a Word file here has no code (docx.js would write it as plain text in Menlo, which reads back
// as plain text). What mammoth leaves out by default is asked for, so a Word file's underlines and
// quotes (Word's Quote style, which docx.js writes) come back as they went.
const MAMMOTH_STYLES = ['u => u', "p[style-name='Quote'] => blockquote > p:fresh", "p[style-name='Intense Quote'] => blockquote > p:fresh"]

export default function DocEditor({ file, data, onDirty, onStats, handle, readOnly = false }) {
  const md = file.ext === '.md' || file.ext === '.markdown'
  const plain = file.ext === '.txt'
  const [start, setStart] = useState(null) // { content, notes, look }
  useEffect(() => {
    let on = true
    if (md || plain) setStart({ content: textOf(data), notes: [] })
    else {
      Promise.all([import('mammoth/mammoth.browser.js').then((m) => (m.default || m).convertToHtml({ arrayBuffer: data }, { styleMap: MAMMOTH_STYLES })), lookOf(data)])
        .then(([r, look]) => on && setStart({ content: r.value, notes: (r.messages || []).filter((x) => x.type === 'warning'), look }), (e) => on && setStart({ error: e.message }))
    }
    return () => { on = false }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!start) return <p className="muted small sd-loading">{t('Opening…')}</p>
  if (start.error) return <div className="sd-empty" role="alert"><Icon name="alert" size={18} /><b>{t("Couldn't read this Word file: {error}", { error: start.error })}</b><span className="muted small">{t('The file is as it was. Download it to open it in Word, or put back an earlier version.')}</span></div>
  if (plain) return <PlainText text={start.content} onDirty={onDirty} onStats={onStats} handle={handle} readOnly={readOnly} />
  return <Rich file={file} start={start} md={md} onDirty={onDirty} onStats={onStats} handle={handle} readOnly={readOnly} />
}

// Words (as the language counts them, where the browser can) and characters, for the status line.
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(locale(), { granularity: 'word' }) : null
function statsOf(text) {
  let words = 0
  if (segmenter) for (const s of segmenter.segment(text)) { if (s.isWordLike) words++ } else words = text.match(/\S+/g)?.length || 0
  const n = (x) => x.toLocaleString(locale())
  return { text: words === 1 ? t('1 word') : t('{n} words', { n: n(words) }), title: t('{n} characters', { n: n(text.replace(/\s/g, '').length) }) }
}
// Told a moment after typing stops, not on every key.
function useStats(text, onStats) {
  useEffect(() => {
    if (!onStats) return undefined
    const id = setTimeout(() => onStats(statsOf(text)), 250)
    return () => clearTimeout(id)
  }, [text, onStats])
}

function PlainText({ text, onDirty, onStats, handle, readOnly }) {
  const [v, setV] = useState(text)
  useStats(v, onStats)
  handle.current = {
    save: async () => v,
    selection: () => { const el = document.activeElement; return el?.tagName === 'TEXTAREA' && el.selectionEnd > el.selectionStart ? { text: v.slice(el.selectionStart, el.selectionEnd) } : null },
  }
  return <textarea className="sd-plain" value={v} readOnly={readOnly} onChange={(e) => { setV(e.target.value); onDirty(true) }} spellCheck aria-label={t('The text')} placeholder={t('Write here…')} />
}

// A link's address as typed: a web address without its https://, or an email address, made whole.
const hrefOf = (s) => {
  const v = s.trim()
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('#') || v.startsWith('/')) return v
  return /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v) ? `mailto:${v}` : `https://${v}`
}

function Rich({ file, start, md, onDirty, onStats, handle, readOnly }) {
  // Changed once you change it (a key, a paste, a drop, a button), not when the editor sets itself
  // up with the file (a Markdown file read, a Word file's parts put in order), which it reports as
  // changes too.
  const touched = useRef(false)
  const touch = () => { touched.current = true; return false }
  const editor = useEditor({
    extensions: [
      // A link is followed from the link bar (Open), not by a click while you're writing in it.
      StarterKit.configure({ link: { openOnClick: false, enableClickSelection: true, defaultProtocol: 'https' }, ...(md ? { underline: false } : { code: false, codeBlock: false }) }),
      Image.configure({ allowBase64: true }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
      ...(md ? [Markdown.configure({ html: false, tightLists: true, linkify: true })] : []),
    ],
    content: start.content,
    editable: !readOnly,
    editorProps: { handleDOMEvents: { keydown: touch, paste: touch, drop: touch, cut: touch }, attributes: { 'aria-label': t('The document') } },
    onUpdate: ({ transaction }) => { if (touched.current && transaction.docChanged) onDirty(true) },
    // A document that doesn't end in a paragraph (a new one ends in its title) gets an empty one
    // under it to write in, as the editor adds once you type: not a change of yours, nothing to undo.
    onCreate: ({ editor: e }) => {
      const last = e.state.doc.lastChild
      if (last && last.type.name !== 'paragraph') e.view.dispatch(e.state.tr.insert(e.state.doc.content.size, e.schema.nodes.paragraph.create()).setMeta('addToHistory', false))
    },
  }, [start])
  useEffect(() => { editor?.setEditable(!readOnly) }, [editor, readOnly])
  // What the toolbar shows: the text style where the cursor is, which marks are on, and whether
  // there's anything to undo or redo (worked out again after each change and each move).
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null
      const level = e.isActive('heading') ? e.getAttributes('heading').level : null
      return {
        style: level ? `h${level}` : e.isActive('codeBlock') ? 'code' : 'p',
        bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'), code: e.isActive('code'),
        bulletList: e.isActive('bulletList'), orderedList: e.isActive('orderedList'), blockquote: e.isActive('blockquote'), codeBlock: e.isActive('codeBlock'),
        link: e.isActive('link'), href: e.getAttributes('link').href || '', table: e.isActive('table'),
        undo: e.can().undo(), redo: e.can().redo(),
      }
    },
  })
  useEffect(() => {
    if (!editor || !onStats) return undefined
    let id = null
    const tell = () => { clearTimeout(id); id = setTimeout(() => onStats(statsOf(editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ', ' '))), 250) }
    tell()
    editor.on('update', tell)
    return () => { clearTimeout(id); editor.off('update', tell) }
  }, [editor, onStats])
  const [linking, setLinking] = useState(null) // the address being typed in the link bar
  const [tableMenu, setTableMenu] = useState(false)
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
  if (!editor || !s) return null
  const c = () => { touched.current = true; return editor.chain().focus() }
  // A button: its name and shortcut in its tooltip, on or off shown (aria-pressed) where it's a
  // mark or a block you turn on and off. A press keeps the cursor in the document.
  const tool = (name, icon, run, { on, k = [], tip = name, disabled = false, ...more } = {}) => (
    <button type="button" className={`sd-tool${on ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={run} title={withKeys(tip, ...k)} aria-label={name} {...(on !== undefined ? { 'aria-pressed': !!on } : {})} disabled={readOnly || disabled} {...more}>
      <Icon name={icon} size={15} />
    </button>
  )
  const setStyle = (v) => (v === 'p' ? c().setParagraph().run() : /^h\d$/.test(v) ? c().setHeading({ level: Number(v[1]) }).run() : null)
  const applyLink = (e) => {
    e.preventDefault()
    const href = hrefOf(linking || '')
    if (!href) c().extendMarkRange('link').unsetLink().run()
    else if (editor.state.selection.empty && !s.link) c().insertContent({ type: 'text', text: href.replace(/^mailto:/, ''), marks: [{ type: 'link', attrs: { href } }] }).run()
    else c().extendMarkRange('link').setLink({ href }).run()
    setLinking(null)
  }
  const tableAct = (run) => { setTableMenu(false); run(c()).run() }
  const word = !md
  return (
    <div className={`sd-doc${md ? ' md' : ''}`}>
      <div className="sd-doc-head">
        {!readOnly && (
          <div className="sd-toolbar sd-doc-tools" role="toolbar" aria-label={t('Formatting')}>
            <span className="sd-group">
              <select className="sd-style" value={s.style} onChange={(e) => setStyle(e.target.value)} aria-label={t('Text style')}
                title={t('Text style: {paragraph} for a paragraph, {heading} for a heading', { paragraph: keys('mod', 'alt', '0'), heading: `${keys('mod', 'alt', '1')}–3` })}>
                <option value="p">{t('Paragraph')}</option>
                {[1, 2, 3].map((n) => <option key={n} value={`h${n}`}>{t('Heading {n}', { n })}</option>)}
                {/^h[4-6]$/.test(s.style) && <option value={s.style}>{t('Heading {n}', { n: s.style[1] })}</option>}
                {s.style === 'code' && <option value="code" disabled>{t('Code block')}</option>}
              </select>
            </span>
            <span className="sd-group">
              {tool(t('Bold'), 'bold', () => c().toggleBold().run(), { on: s.bold, k: ['mod', 'b'] })}
              {tool(t('Italic'), 'italic', () => c().toggleItalic().run(), { on: s.italic, k: ['mod', 'i'] })}
              {word && tool(t('Underline'), 'underline', () => c().toggleUnderline().run(), { on: s.underline, k: ['mod', 'u'] })}
              {tool(t('Strikethrough'), 'strike', () => c().toggleStrike().run(), { on: s.strike, k: ['mod', 'shift', 's'] })}
              {md && tool(t('Inline code'), 'code', () => c().toggleCode().run(), { on: s.code, k: ['mod', 'e'] })}
            </span>
            <span className="sd-group">
              {tool(t('Bulleted list'), 'list', () => c().toggleBulletList().run(), { on: s.bulletList, k: ['mod', 'shift', '8'] })}
              {tool(t('Numbered list'), 'list-ordered', () => c().toggleOrderedList().run(), { on: s.orderedList, k: ['mod', 'shift', '7'] })}
              {tool(t('Quote'), 'quote', () => c().toggleBlockquote().run(), { on: s.blockquote, k: ['mod', 'shift', 'b'] })}
              {md && tool(t('Code block'), 'code-block', () => c().toggleCodeBlock().run(), { on: s.codeBlock, k: ['mod', 'alt', 'c'] })}
            </span>
            <span className="sd-group">
              {tool(t('Insert link'), 'link', () => setLinking(linking == null ? s.href || '' : null), { on: s.link || linking != null, tip: s.link ? t('Link: change it, open it or remove it') : t('Insert link') })}
              <span className="menu-anchor">
                {s.table
                  ? tool(t('Table'), 'table', () => setTableMenu((x) => !x), { tip: t('Table: add or delete rows and columns'), 'aria-haspopup': 'menu', 'aria-expanded': tableMenu })
                  : tool(t('Table'), 'table', () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
                {tableMenu && s.table && (
                  <ToolMenu label={t('Table')} onClose={() => setTableMenu(false)} items={[
                    { label: t('Add a row above'), icon: 'plus', run: () => tableAct((x) => x.addRowBefore()) },
                    { label: t('Add a row below'), icon: 'plus', run: () => tableAct((x) => x.addRowAfter()) },
                    { label: t('Add a column on the left'), icon: 'plus', run: () => tableAct((x) => x.addColumnBefore()) },
                    { label: t('Add a column on the right'), icon: 'plus', run: () => tableAct((x) => x.addColumnAfter()) },
                    '-',
                    { label: t('Delete the row'), icon: 'minus', danger: true, run: () => tableAct((x) => x.deleteRow()) },
                    { label: t('Delete the column'), icon: 'minus', danger: true, run: () => tableAct((x) => x.deleteColumn()) },
                    { label: t('Delete the table'), icon: 'trash', danger: true, run: () => tableAct((x) => x.deleteTable()) },
                  ]} />
                )}
              </span>
            </span>
            <span className="sd-grow" />
            <span className="sd-group">
              {tool(t('Undo'), 'undo', () => c().undo().run(), { k: ['mod', 'z'], disabled: !s.undo })}
              {tool(t('Redo'), 'redo', () => c().redo().run(), { k: ['mod', 'shift', 'z'], disabled: !s.redo })}
            </span>
          </div>
        )}
        {linking != null && (
          <form className="sd-linkbar" onSubmit={applyLink} aria-label={t('Link address')}>
            <Icon name="link" size={13} />
            <input autoFocus value={linking} onChange={(e) => setLinking(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setLinking(null); editor.commands.focus() } }} placeholder={t('A web address, like example.com')} aria-label={t('Link address')} spellCheck={false} />
            <button type="submit" className="btn small primary">{s.link ? t('Change') : t('Add link')}</button>
            {s.link && s.href && <a className="btn small" href={s.href} target="_blank" rel="noreferrer" title={s.href}><Icon name="external" size={12} /> {t('Open')}</a>}
            {s.link && <button type="button" className="btn small" onClick={() => { c().extendMarkRange('link').unsetLink().run(); setLinking(null) }}>{t('Remove link')}</button>}
            <button type="button" className="win-btn" onClick={() => { setLinking(null); editor.commands.focus() }} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={13} /></button>
          </form>
        )}
      </div>
      {start.notes?.length > 0 && <p className="muted small sd-note">{t('Some of this Word file\'s formatting isn\'t shown here ({n} parts). Saving keeps its text, headings, lists, tables, pictures, fonts and colours; the file as it was stays in its versions.', { n: start.notes.length })}</p>}
      <EditorContent editor={editor} className={`sd-page${md ? ' md' : file.ext === '.docx' ? ' word' : ''}${lookColours(start.look) ? ' paper' : ''}`} style={{ ...lookCss(start.look), '--sd-ph': JSON.stringify(t('Write here…')) }} />
    </div>
  )
}

// A small menu under a toolbar button: a click outside or Escape closes it.
function ToolMenu({ label, items, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [onClose])
  return (
    <div className="menu left sd-tool-menu" ref={ref} role="menu" aria-label={label}>
      {items.map((it, i) => (it === '-' ? <div key={i} className="menu-sep" /> : (
        <button type="button" key={it.label} role="menuitem" className={`menu-item${it.danger ? ' danger' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={it.run}><Icon name={it.icon} size={13} /> {it.label}</button>
      )))}
    </div>
  )
}
