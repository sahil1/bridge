import { useEffect, useRef, useState } from 'react'
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import sheetsEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import '@univerjs/preset-sheets-core/lib/index.css'
import Icon from '../../Icon.jsx'
import { t } from '../../../i18n/index.js'
import { workbookOf, bytesOf } from '../xlsx.js'

// A sheet: Univer (Apache-2.0), the spreadsheet GenOffice's Sheets is built on, with formulas,
// formats and every sheet of the file. Read from and written back to the file's own kind (xlsx.js).
// It follows the app's light or dark look. handle: save() gives the bytes, selection() the cells
// picked ("B2:D9 on Budget") with their values, for Ask an agent. onStats: how many sheets.
const dark = () => { const m = document.documentElement.getAttribute('data-theme'); return m ? m === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches }

export default function SheetEditor({ file, data, onDirty, onStats, handle, readOnly = false }) {
  const host = useRef(null)
  const api = useRef(null)
  const [lost, setLost] = useState([])
  const [err, setErr] = useState(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let on = true
    let univer = null
    let off = null
    workbookOf(data, file.name, file.ext).then((wb) => {
      if (!on || !host.current) return
      setLost(wb.lost)
      const n = wb.data.sheetOrder.length
      onStats?.({ text: n === 1 ? t('1 sheet') : t('{n} sheets', { n }) })
      const made = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(sheetsEnUS) },
        darkMode: dark(),
        presets: [UniverSheetsCorePreset({ container: host.current, header: !readOnly, toolbar: !readOnly, footer: { sheetBar: true, statisticBar: true, menus: false, zoomSlider: true } })],
      })
      univer = made.univer
      api.current = made.univerAPI
      made.univerAPI.createWorkbook(wb.data)
      setReady(true)
      if (readOnly) made.univerAPI.getActiveWorkbook()?.setEditable?.(false)
      // Changed once the workbook itself changes after it opened: a mutation (type 2) to it, as an
      // edit, a format or an undo make. Not Univer's own: its setting up as it opens, its cell
      // editor's scratch document (doc.*, which a cell picked fills), or a formula's result worked
      // out again (onlyLocal). Univer's Facade gives these as its CommandExecuted event.
      let ready = false
      setTimeout(() => { ready = true }, 600)
      off = made.univerAPI.addEvent(made.univerAPI.Event.CommandExecuted, (cmd) => {
        if (ready && cmd.type === 2 && !cmd.options?.onlyLocal && !String(cmd.id).startsWith('doc.')) onDirty(true)
      })
    }, (e) => on && setErr(e.message))
    return () => { on = false; try { off?.dispose?.() } catch { /* gone */ } try { univer?.dispose() } catch { /* gone */ } api.current = null }
  }, [data, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps
  handle.current = {
    save: async () => bytesOf(api.current.getActiveWorkbook().save(), file.ext),
    selection: () => {
      try {
        const sheet = api.current.getActiveWorkbook().getActiveSheet()
        const range = sheet.getSelection()?.getActiveRange()
        if (!range) return null
        const values = range.getValues().map((r) => r.map((v) => (v == null ? '' : v)).join('\t')).join('\n')
        return { text: values, where: t('{range} on {sheet}', { range: range.getA1Notation(), sheet: sheet.getSheetName() }) }
      } catch { return null }
    },
  }
  if (err) return <div className="sd-empty" role="alert"><Icon name="alert" size={18} /><b>{t("Couldn't read this sheet: {error}", { error: err })}</b><span className="muted small">{t('The file is as it was. Download it to open it in Excel, or put back an earlier version.')}</span></div>
  return (
    <div className="sd-sheet">
      {lost.length > 0 && <p className="muted small sd-note">{t('This file has {what}, which aren\'t shown here and aren\'t kept if you save it here; the file as it was stays in its versions.', { what: lost.join(', ') })}</p>}
      <div ref={host} className="sd-univer" />
      {!ready && <div className="sd-empty sd-loading sd-over" role="status"><Icon name="refresh" size={16} className="spin" /><span className="muted">{t('Opening {name}…', { name: file.name })}</span></div>}
    </div>
  )
}
