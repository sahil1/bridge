import { usePoll } from './api.js'
import { tx } from './i18n/index.js'

// Trial features: parts of Bridge AI still being finished, shipped hidden. Each stays out of sight
// (the sidebar, ⌘K, the phone's More, the buttons that lead to it) until it's turned on in
// Settings › About & Updates › Trial Features, and turning it off hides it again; what was made
// with it stays. The server says which are on (/config trials) and answers a trial's routes only
// then (server/index.js TRIALS).
export const TRIALS = [
  { id: 'studio', label: tx('Studio'), hint: tx('Documents, sheets, decks, PDFs and pages from any of your folders and computers, edited here or by your agents, with every version kept.') },
  { id: 'home', label: tx('Home'), hint: tx('Where Bridge AI opens: what needs you on every computer, answered right there, then what\'s ready to look at and what\'s coming up, with Everything a click away.') },
]

// Whether a trial is on, from the config every part of the app shares (it's asked again when
// Settings change).
export function useTrial(id) {
  const { data } = usePoll('/config', 10 * 60 * 1000)
  return data?.trials?.[id] === true
}
