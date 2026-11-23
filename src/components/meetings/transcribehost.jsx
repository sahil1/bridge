import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import { t } from '../../i18n/index.js'
import { offer, dropped, mayBeMedia, hasFiles } from './transcribefiles.js'

// Mounted once (App.jsx), in every window that has this computer's Meetings: the dialog for files
// offered from anywhere (transcribefiles.js offer: Meetings' button, ⌘K, the desktop app), and audio
// or video dropped anywhere in the window that nothing there takes (a message box takes its files,
// as do a meeting's Files and Studio), with a sign while it's over the window. The dialog itself
// (TranscribeFiles.jsx, with Meetings' styles) loads the first time it's wanted.
const TranscribeDialog = lazy(() => import('./TranscribeFiles.jsx').then((m) => ({ default: m.TranscribeDialog })))

export default function TranscribeHost() {
  const [ask, setAsk] = useState(null) // { files, folder, picked }
  const [over, setOver] = useState(false)
  useEffect(() => {
    const on = (e) => setAsk({ files: e.detail?.files || [], folder: !!e.detail?.folder, picked: e.detail?.picked || 0 })
    let hide = null
    const dragover = (e) => {
      if (e.defaultPrevented || !hasFiles(e.dataTransfer) || !mayBeMedia(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setOver(true)
      clearTimeout(hide)
      hide = setTimeout(() => setOver(false), 250)
    }
    const drop = (e) => {
      if (e.defaultPrevented || !hasFiles(e.dataTransfer) || !mayBeMedia(e.dataTransfer)) return
      e.preventDefault()
      setOver(false)
      dropped(e.dataTransfer).then(({ files, folder }) => offer(files, { folder, picked: files.length }))
    }
    window.addEventListener('bridge-transcribe', on)
    window.addEventListener('dragover', dragover)
    window.addEventListener('drop', drop)
    return () => { window.removeEventListener('bridge-transcribe', on); window.removeEventListener('dragover', dragover); window.removeEventListener('drop', drop); clearTimeout(hide) }
  }, [])
  return (
    <>
      {over && createPortal(<div className="tf-over" aria-hidden="true"><div><Icon name="wave" size={22} /><b>{t('Drop to transcribe')}</b><span className="small">{t('Audio or video, or a folder of them')}</span></div></div>, document.body)}
      {ask && <Suspense fallback={null}><TranscribeDialog files={ask.files} folder={ask.folder} picked={ask.picked} onClose={() => setAsk(null)} /></Suspense>}
    </>
  )
}
