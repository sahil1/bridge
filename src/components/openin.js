import { usePoll, onThisComputer } from '../api.js'

// Open in Mail and Open in Calendar (server/openin.js): which of the two this Mac has, asked only
// from a window on it ({ mail: { name }, calendar: { name } }, either left out when it isn't here).
// On a phone or in another computer's window, neither shows: the app would open on the computer,
// out of sight, and a phone's own can't be pointed at it (Calendar's id for an event is this Mac's
// own; an iPhone's Mail finds a message by its Message-ID only once it has downloaded it, and says
// nothing when it hasn't; Android has no such link).
const HERE = typeof window !== 'undefined' && onThisComputer()
export function useOpenIn() {
  const { data } = usePoll('/open-in', 30 * 60_000, { enabled: HERE })
  return (HERE && data) || {}
}
