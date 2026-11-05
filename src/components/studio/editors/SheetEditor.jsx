import { useEffect, useRef, useState } from 'react'
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import sheetsEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import '@univerjs/preset-sheets-core/lib/index.css'
import { t } from '../../../i18n/index.js'
import { workbookOf, bytesOf } from '../xlsx.js'

// A sheet: Univer (Apache-2.0), the spreadsheet GenOffice's Sheets is built on, with formulas,
// formats and every sheet of the file. Read from and written back to the file's own kind (xlsx.js).
// It follows the app's light or dark look. handle: save() gives the bytes, selection() the cells
// picked ("B2:D9 on Budget") with their values, for Ask an agent.
const dark = () => { const m = document.documentElement.getAttribute('data-theme'); return m ? m === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches }

export default function SheetEditor({ file, data, onDirty, handle, readOnly = false }) {
  const host = useRef(null)
  const api = useRef(null)
  const [lost, setLost] = useState([])
  const [err, setErr] = useState(null)
  useEffect(() => {
    let on = true
    let univer = null
    let off = null
    workbookOf(data, file.name, file.ext).then((wb) => {
      if (!on || !host.current) return
      setLost(wb.lost)
      const made = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(sheetsEnUS) },
        darkMode: dark(),
        presets: [UniverSheetsCorePreset({ container: host.current, header: !readOnly, toolbar: !readOnly, footer: { sheetBar: true, statisticBar: true, menus: false, zoomSlider: true } })],
      })
      univer = made.univer
      api.current = made.univerAPI
      made.univerAPI.createWorkbook(wb.data)
      if (readOnly) made.univerAPI.getActiveWorkbook()?.setEditable?.(false)
      // Changed once something's edited after it opened (the first mutations are its own setting up).
      let ready = false
      setTimeout(() => { ready = true }, 600)
      off = made.univerAPI.onCommandExecuted?.((cmd) => { if (ready && cmd?.type === 2) onDirty(true) })
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
  if (err) return <p className="error-text">{t("Couldn't read this sheet: {error}", { error: err })}</p>
  return (
    <div className="sd-sheet">
      {lost.length > 0 && <p className="muted small sd-note">{t('This file has {what}, which aren\'t shown here and aren\'t kept if you save it here; the file as it was stays in its versions.', { what: lost.join(', ') })}</p>}
      <div ref={host} className="sd-univer" />
    </div>
  )
}
