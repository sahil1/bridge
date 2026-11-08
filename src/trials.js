import { usePoll } from './api.js'
import { tx } from './i18n/index.js'

// Beta features: new parts of Bridge AI, shipped hidden. Each stays out of sight
// (the sidebar, ⌘K, the phone's More, the buttons that lead to it) until it's turned on in
// Settings › About & Updates › Beta Features, and turning it off hides it again; what was made
// with it stays. The server says which are on (/config trials) and answers a trial's routes only
// then (server/index.js TRIALS).
export const TRIALS = [
  { id: 'studio', label: tx('Studio'), hint: tx('Documents, sheets, decks, PDFs and pages from any of your folders and computers, edited here or by your agents, with every version kept.') },
  { id: 'home', label: tx('Home'), hint: tx('Where Bridge AI opens: what needs you on every computer, answered right there, then what\'s ready to look at and what\'s coming up, with Everything a click away.') },
  { id: 'dictation-cleanup', label: tx('Tidy what I say'), hint: tx('Dictation from other apps tidied by a model before it\'s pasted: fillers and false starts out, punctuation fixed, your words kept. Turned on in Settings › Voice › Dictation.') },
  { id: 'usage-everywhere', label: tx('Usage Across Every Provider'), hint: tx('In Today › Usage: the tokens each provider and model used, by day and by what in Bridge AI used them, with the cost where an API key has a price and the time a model took on this computer. It stays on this computer.') },
  { id: 'meeting-insights', label: tx('Meeting Insights'), hint: tx('Your meetings added up (how much time, when in the week, which series, your share of the talk) and the people you meet, worked out on this computer. It turns on by itself once 5 meetings are recorded here, unless you turn it off.') },
  { id: 'tab-groups', label: tx('Tab Groups'), hint: tx('The tabs above your agents kept together as the sidebar has them: each space in its own group, in the sidebar\'s order, and agents from your other computers at the end under each computer\'s name. A group\'s name folds it away, leaving the tab on screen.') },
  { id: 'routines', label: tx('Scheduled Routines'), hint: tx('Routines that run by themselves at the time you set ("every weekday at 9"), on this computer, each run\'s result kept; Make a routine from any message you sent; and History › Commands, what you asked your agents and Chief of Staff, kept on this computer, with a routine suggested when you ask the same thing on a schedule.') },
  { id: 'files', label: tx('Files'), hint: tx('Every folder on this computer and your others, as Finder shows them: your usual folders, cloud drives, projects and drives in a sidebar, a folder as a list, icons or columns, Quick Look, Get Info and a search. With Files Assist beside it: duplicates, big and forgotten files and a tidier layout pointed out for the folder you\'re in. It only looks for now: nothing is renamed, moved or deleted.') },
  // needs: another beta feature it's part of, which must be on too.
  { id: 'signature-assist', label: tx('Signature Assist'), needs: 'studio', hint: tx('In Studio, a PDF to sign: what it says in plain words, read by the model you pick, then the signature you drew put where it goes, and a signed copy saved in a _signed folder beside it.') },
]

// Whether a trial is on, from the config every part of the app shares (it's asked again when
// Settings change).
export function useTrial(id) {
  const { data } = usePoll('/config', 10 * 60 * 1000)
  return data?.trials?.[id] === true
}
