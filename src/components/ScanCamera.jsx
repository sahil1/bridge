import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Icon from './Icon.jsx'
import { t } from '../i18n/index.js'
import { pairingLink } from '../scan.js'
import './scan.css'

// Scan QR code in a phone's browser (src/scan.js): the back camera, full screen, until it sees a
// Bridge AI pairing link. Read with the browser's own BarcodeDetector where it has one (Chrome on
// Android), and otherwise with jsQR, fetched the first time it's needed. Any other QR code is said
// to be the wrong one, and it keeps looking. Nothing leaves the phone: the picture is read here.
// openCamera(): the link, or null once it's closed.
let showing = null
export function openCamera() {
  if (showing) return showing
  const box = document.body.appendChild(document.createElement('div'))
  const root = createRoot(box)
  showing = new Promise((done) => {
    root.render(<ScanCamera onDone={(link) => {
      root.unmount()
      box.remove()
      showing = null
      done(link)
    }} />)
  })
  return showing
}

// What reads a frame of the video: the QR codes it sees, as text.
async function reader() {
  try {
    if (typeof window.BarcodeDetector === 'function' && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
      const d = new window.BarcodeDetector({ formats: ['qr_code'] })
      return async (video) => (await d.detect(video)).map((x) => x.rawValue)
    }
  } catch { /* jsQR, then */ }
  const { default: jsQR } = await import('jsqr')
  const canvas = document.createElement('canvas')
  const c = canvas.getContext('2d', { willReadFrequently: true })
  return async (video) => {
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return []
    // At most 720 px on its long side: enough for a code on a screen, and quick to read on a phone.
    const k = Math.min(1, 720 / Math.max(w, h))
    canvas.width = Math.round(w * k)
    canvas.height = Math.round(h * k)
    c.drawImage(video, 0, 0, canvas.width, canvas.height)
    const img = c.getImageData(0, 0, canvas.width, canvas.height)
    // Both ways round: Bridge AI's code can be light on dark.
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
    return code ? [code.data] : []
  }
}

// Why the camera can't be used, in words.
function cameraWhy(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return t("The camera wasn't allowed. Allow it for this page in the browser's settings, or use Copy link on the computer instead.")
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return t('This phone has no camera Bridge AI can use. Use Copy link on the computer instead.')
  if (e?.name === 'NotReadableError') return t('Another app is using the camera. Close it and try again, or use Copy link on the computer instead.')
  return t("The camera couldn't start ({why}). Use Copy link on the computer instead.", { why: e?.message || e?.name || String(e) })
}

function ScanCamera({ onDone }) {
  const video = useRef(null)
  const close = useRef(null)
  const [why, setWhy] = useState(null) // the camera can't be used
  const [other, setOther] = useState(false) // it saw a QR code that isn't a pairing link
  useEffect(() => {
    let stream = null
    let timer = null
    let over = false
    const stop = () => { over = true; clearTimeout(timer); stream?.getTracks().forEach((x) => x.stop()) }
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      } catch (e) { if (!over) setWhy(cameraWhy(e)); return }
      if (over) return stop()
      const v = video.current
      v.srcObject = stream
      // Not waited for: frames are read as soon as they come (until then there are none).
      v.play().catch(() => {})
      let read
      try { read = await reader() } catch (e) { if (!over) { stop(); setWhy(cameraWhy(e)) } return }
      const look = async () => {
        if (over) return
        try {
          for (const text of await read(v)) {
            const link = pairingLink(text)
            if (link) { stop(); return onDone(link) }
            setOther(true)
          }
        } catch { /* not ready yet: the next frame */ }
        timer = setTimeout(look, 150)
      }
      look()
    })()
    return stop
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    close.current?.focus()
    const key = (e) => { if (e.key === 'Escape') onDone(null) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`scan-cam ${why ? 'off' : ''}`} role="dialog" aria-modal="true" aria-label={t('Scan QR code')}>
      <video ref={video} playsInline muted autoPlay />
      <div className="scan-frame" aria-hidden="true" />
      <button ref={close} type="button" className="scan-close" onClick={() => onDone(null)} aria-label={t('Cancel')} title={t('Cancel')}><Icon name="x" size={20} /></button>
      <p className="scan-hint" role="status">
        {why || (other ? t("That isn't a Bridge AI pairing code. Point at the one Pair a device shows on the computer.") : t('Point at the QR code Pair a device shows on the computer.'))}
      </p>
    </div>
  )
}
