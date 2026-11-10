// Copy, saying it did: Copied (a tick) for a moment, or Couldn't copy with how to do it by hand.
// label: its words (none: an icon alone, which says the same in its tick and its title).
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { t } from '../i18n/index.js'
import { copyText } from '../copy.js'

export default function CopyButton({ text, label = t('Copy'), title, className = 'ghost-btn', size = 12, disabled = false }) {
  const [said, setSaid] = useState(null) // 'ok' | 'no'
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    const done = await copyText(typeof text === 'function' ? text() : text)
    setSaid(done ? 'ok' : 'no')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaid(null), done ? 1500 : 4000)
  }
  const words = said === 'ok' ? t('Copied') : said === 'no' ? t("Couldn't copy") : label
  return (
    <button type="button" className={className} onClick={copy} disabled={disabled} aria-label={label ? undefined : title || t('Copy')}
      title={said === 'no' ? t("Couldn't copy. Select the text and copy it yourself.") : title}>
      <Icon name={said === 'ok' ? 'check' : said === 'no' ? 'alert' : 'copy'} size={size} />{label && <> {words}</>}
    </button>
  )
}
