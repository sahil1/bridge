// What an update would lose in this window, for the desktop app to update by itself only while
// nothing would be (desktop/main.js asks each of its windows, through preload.js; one that doesn't
// answer counts as busy). Each part of the page holding something unsaved says so while it does
// (useBusy): Studio's document, a file being edited, a message being typed in a chat, a whiteboard.
// A dictation listening and a video or sound playing count too. The names are shared/autoupdate.js
// HELD.
import { useEffect } from 'react'
import { active as dictating } from './dictation/controller.js'

const held = new Map() // a token for each part saying it -> what it holds
export function useBusy(what, on) {
  useEffect(() => {
    if (!on) return
    const k = {}
    held.set(k, what)
    return () => { held.delete(k) }
  }, [what, on])
}

export function busyNow() {
  const out = new Set(held.values())
  if (dictating()) out.add('dictating')
  if ([...document.querySelectorAll('video, audio')].some((m) => !m.paused && !m.ended)) out.add('playing')
  return [...out]
}

// Answers the desktop app from now on (src/main.jsx, as the window opens).
export const answerBusy = () => { try { window.bridgeApp?.answerBusy?.(busyNow) } catch { /* not the desktop app */ } }
