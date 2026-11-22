import { usePoll } from './api.js'
import { tx } from './i18n/index.js'

// Beta features: new parts of Bridge AI, shipped hidden. Each stays out of sight (the sidebar, ⌘K,
// the phone's More, the buttons that lead to it) until it's turned on, and turning it off hides it
// again; what was made with it stays. Its switch is at the top of its own place in Settings, marked
// Beta (setting: that switch's data-setting, search.js), and Settings › About & Updates › Beta
// Features lists them all, each with the way to its place. The server says which are on (/config
// trials) and answers a trial's routes only then (server/index.js TRIALS). card: what it is in a few
// words, on its card in Your Features while it's off; short: what it is in a line, beside its
// switch; hint: the rest, under More.
export const TRIALS = [
  { id: 'usage-everywhere', card: tx('Tokens and costs from every provider'), setting: 'beta-usage-everywhere', label: tx('Usage Across Every Provider'), short: tx('The tokens each provider and model used, in Today › Usage.'),
    hint: tx('In Today › Usage: the tokens each provider and model used, by day and by what in Bridge AI used them, with the cost where an API key has a price and the time a model took on this computer. It stays on this computer.') },
  { id: 'meeting-board', card: tx('A live whiteboard of each meeting'), setting: 'beta-meeting-board', label: tx('Live Meeting Board'), short: tx('A whiteboard of the meeting, kept by AI Assist while it records.'),
    hint: tx('While a meeting records, AI Assist keeps a whiteboard of it from what\'s said: what\'s decided, a timeline with owners and dates, who does what and the questions still open, each a suggestion you keep or discard. In any call app or a room, with the model that writes your notes, one on this computer too.') },
  { id: 'assist-answers', card: tx('Answers to questions raised in a meeting'), setting: 'beta-assist-answers', label: tx('Answers in AI Assist'), short: tx('A question raised in a meeting, answered on a card.'),
    hint: tx('While a meeting records with AI Assist on, a question raised that has a general or factual answer is answered on a card, from your past meetings, notes and files first, else from what the model knows; with a Perplexity key, one that needs current facts is looked up on the web, sending only the question. Kept, an answer goes in your notes.') },
  { id: 'slack-bot', card: tx('Your own bots in Slack, Discord and Teams'), setting: 'bots-beta', label: tx('Bots'), short: tx('Your own bots in Slack, Discord and Microsoft Teams.'),
    hint: tx('Your own bots in Slack, Discord and Microsoft Teams, each a Claude Code session in a folder you give it that remembers every thread, with a Chief that hands each question to the right one. People you choose ask them, a push waits for your OK, and everything they do is kept in their record. From this computer, never through Bold Bridge.') },
  { id: 'remote-screen', card: tx('See and control your other computers'), setting: 'beta-remote-screen', label: tx('Remote Screen and Preview'), short: tx('See your other computers\' screens, and control them once each allows it.'),
    hint: tx("See your other computers' screens, and control them once each one allows it, from a computer or your phone, peer-to-peer where the network allows and through your relay where it doesn't, end-to-end encrypted either way. An agent's Preview on another computer shows its app here too. Turn it on on each computer you want to see, at that computer. A computer being seen says so, with Stop, and keeps a record.") },
  // mac: only where the server runs on a Mac (Apple's Vision reads the pictures).
  { id: 'call-video', card: tx('Who spoke, from the call\'s video'), setting: 'beta-call-video', mac: true, label: tx("Speakers From the Call's Video"), short: tx('On a call, whose mouth moves on its video names who said what.'),
    hint: tx("While a call records and someone talks, a few pictures of the call's window are read on this Mac for whose mouth is moving and the name under that face, so the transcript says who said what, people sharing a room's camera too. Only who was seen talking, and when, is kept: never the pictures. It needs Screen Recording, as names from the screen do.") },
]

// Whether a trial is on, from the config every part of the app shares (it's asked again when
// Settings change).
export function useTrial(id) {
  const { data } = usePoll('/config', 10 * 60 * 1000)
  return data?.trials?.[id] === true
}

// Out of Beta Features in 3.22.0, each an ordinary setting in its own place (shared/places.js):
// home (Settings › You › Home), routines (Scheduled Routines, in Settings › Agents & Models ›
// Agents), meeting-insights (Settings › Meetings & Voice › Meetings), dictation-cleanup (Tidy what I
// say, in Settings › Meetings & Voice › Dictation) and mcp-server (Settings › Agents & Models › MCP
// Servers). Whether one is on here, as the server says (/config features: its default where unset).
export function useFeature(id) {
  const { data } = usePoll('/config', 10 * 60 * 1000)
  return data?.features?.[id] === true
}
