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
  { id: 'tab-groups', label: tx('Tab Groups'), hint: tx('The tabs above your agents kept together as the sidebar has them: each space in its own group, a chip in its color at its start, in the sidebar\'s order, and agents from your other computers at the end under each computer\'s name. A click on a group\'s chip folds it away, leaving the tab on screen; a right-click closes its tabs or starts an agent in it.') },
  { id: 'routines', label: tx('Scheduled Routines'), hint: tx('Routines that run by themselves at the time you set ("every weekday at 9"), on this computer, each run\'s result kept; Make a routine from any message you sent; and History › Commands, what you asked your agents and Chief of Staff, kept on this computer, with a routine suggested when you ask the same thing on a schedule.') },
  // On to start with, until it's turned off (config.example.json's trials).
  { id: 'back-forward', label: tx('Back and Forward'), hint: tx('‹ and › at the start of the top bar go back and forward through where you\'ve been in this window, as in a browser: each view and tab, and what it showed (an agent\'s Chat or Terminal, a folder in Files), a section of Settings, Today full size. So do ⌘[ and ⌘] on a Mac (Alt+← and Alt+→ on Windows and Linux), the mouse\'s back and forward buttons and the browser\'s own. Hold or right-click ‹ or › to see the places and pick one. A tab you close is passed over.') },
  { id: 'files', label: tx('Files'), hint: tx('Every folder on this computer and your others, as Finder shows them: your usual folders, cloud drives, projects and drives in a sidebar, a folder as a list, icons or columns, Quick Look, Get Info and a search. With AI Assist\'s Look over this folder beside it: duplicates, big and forgotten files and a tidier layout pointed out for the folder you\'re in. Read-only for now: nothing is renamed, moved or deleted.') },
  { id: 'recommended-settings', label: tx('Recommended Settings'), hint: tx('Claude Code started with the model and effort that suit your plan (Pro, Max, Team or an API key), shown in Settings › Agents with Use these or Keep Claude Code\'s defaults. And an effort for each task, from what you ask, as a chip you can change in New and Home\'s box, and for the agents Chief of Staff starts. Worked out on this computer; Claude Code\'s own settings are left as they are.') },
  { id: 'meeting-board', label: tx('Live Meeting Board'), hint: tx('While a meeting records, AI Assist keeps a whiteboard of it from what\'s said: what\'s decided, a timeline with owners and dates, who does what and the questions still open, each a suggestion you keep or discard. In any call app or a room, with the model that writes your notes, one on this computer too. Turned on under a meeting\'s Board, or for every meeting in Settings › Meetings.') },
  { id: 'mcp-server', label: tx('Bridge AI as an MCP Server'), hint: tx('Claude Code, Claude Desktop, Cursor and Codex on this computer read your whiteboards, Studio files in your Places and meeting summaries, make new boards and files, add tasks, and suggest changes you keep or discard in Needs You. Set up in Settings › MCP Servers. Transcripts, agents\' conversations, mail and calendar aren\'t shared.') },
  // needs: another beta feature it's part of, which must be on too.
  { id: 'signature-assist', label: tx('Sign PDFs'), needs: 'studio', hint: tx('In Studio, AI Assist\'s Sign this on a PDF you\'re asked to sign: what it says in plain words, read by the model you pick, then the signature you drew put where it goes, and a signed copy saved in a _signed folder beside it.') },
  { id: 'comments', label: tx('Comments and @bridge'), needs: 'studio', hint: tx('In Studio, comments on a Word file\'s words that you add, answer, resolve and delete, kept in the file itself so Word shows them too. And @bridge in a comment asks AI Assist: it answers in the thread, and a change it makes is a suggestion on the words, to keep or discard. A comment from someone else that mentions @bridge waits for you to send it.') },
]

// Whether a trial is on, from the config every part of the app shares (it's asked again when
// Settings change).
export function useTrial(id) {
  const { data } = usePoll('/config', 10 * 60 * 1000)
  return data?.trials?.[id] === true
}
