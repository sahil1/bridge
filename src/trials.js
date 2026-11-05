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
  { id: 'dictation-cleanup', label: tx('Tidy what I say'), hint: tx('Dictation from other apps tidied by a model before it\'s pasted: fillers and false starts out, punctuation fixed, your words kept. Turned on in Settings › Voice › Dictation.') },
  { id: 'usage-everywhere', label: tx('Usage Across Every Provider'), hint: tx('In Today › Usage: the tokens each provider and model used, by day and by what in Bridge AI used them, with the cost where an API key has a price and the time a model took on this computer. It stays on this computer.') },
  { id: 'meeting-insights', label: tx('Meeting Insights'), hint: tx('Your meetings added up by week and kind (how many, how long, your share of the talk), and the people you meet, worked out on this computer.') },
]

// Whether a trial is on, from the config every part of the app shares (it's asked again when
// Settings change).
export function useTrial(id) {
  const { data } = usePoll('/config', 10 * 60 * 1000)
  return data?.trials?.[id] === true
}
