import { usePoll } from './api.js'
import { tx } from './i18n/index.js'

// Beta features: new parts of Bridge AI, shipped hidden. Each stays out of sight
// (the sidebar, ⌘K, the phone's More, the buttons that lead to it) until it's turned on in
// Settings › About & Updates › Beta Features, and turning it off hides it again; what was made
// with it stays. The server says which are on (/config trials) and answers a trial's routes only
// then (server/index.js TRIALS).
export const TRIALS = [
  { id: 'home', label: tx('Home'), hint: tx('Where Bridge AI opens: what needs you on every computer, answered right there, then what\'s ready to look at and what\'s coming up, with Everything a click away.') },
  { id: 'dictation-cleanup', label: tx('Tidy what I say'), hint: tx('Dictation from other apps tidied by a model before it\'s pasted: fillers and false starts out, punctuation fixed, your words kept. Turned on in Settings › Voice & Meetings › Dictation.') },
  { id: 'usage-everywhere', label: tx('Usage Across Every Provider'), hint: tx('In Today › Usage: the tokens each provider and model used, by day and by what in Bridge AI used them, with the cost where an API key has a price and the time a model took on this computer. It stays on this computer.') },
  { id: 'meeting-insights', label: tx('Meeting Insights'), hint: tx('Your meetings added up (how much time, when in the week, which series, your share of the talk) and the people you meet, worked out on this computer. It turns on by itself once 5 meetings are recorded here, unless you turn it off.') },
  { id: 'routines', label: tx('Scheduled Routines'), hint: tx('Routines that run by themselves at the time you set ("every weekday at 9"), on this computer, each run\'s result kept; Make a routine from any message you sent; and History › Commands, what you asked your agents and Chief of Staff, kept on this computer, with a routine suggested when you ask the same thing on a schedule.') },
  { id: 'meeting-board', label: tx('Live Meeting Board'), hint: tx('While a meeting records, AI Assist keeps a whiteboard of it from what\'s said: what\'s decided, a timeline with owners and dates, who does what and the questions still open, each a suggestion you keep or discard. In any call app or a room, with the model that writes your notes, one on this computer too. Turned on under a meeting\'s Board, or for every meeting in Settings › Voice & Meetings.') },
  { id: 'assist-answers', label: tx('Answers in AI Assist'), hint: tx('While a meeting records with AI Assist on, a question raised that has a general or factual answer is answered on a card, from your past meetings, notes and files first, else from what the model knows; with a Perplexity key, one that needs current facts is looked up on the web, sending only the question. Kept, an answer goes in your notes.') },
  { id: 'slack-bot', label: tx('Bots'), hint: tx('Your own bots in Slack, Discord and Microsoft Teams, each with the name you give it: people you choose ask it, and an agent that can only read answers from the folders you give it, each answer waiting for you to send or discard, and everything it does kept in its record. From this computer, never through Bold Bridge. To start: Settings › Bots › Set up your first bot.') },
  { id: 'mcp-server', label: tx('Bridge AI as an MCP Server'), hint: tx('Claude Code, Claude Desktop, Cursor and Codex on this computer read your whiteboards, Studio files in your Places and meeting summaries, make new boards and files, add tasks, and suggest changes you keep or discard in Needs You. Set up in Settings › MCP Servers. Transcripts, agents\' conversations, mail and calendar aren\'t shared.') },
  { id: 'remote-screen', label: tx('Remote Screen and Preview'), hint: tx("See your other computers' screens, and control them once each one allows it, from a computer or your phone, peer-to-peer where the network allows and through your relay where it doesn't, end-to-end encrypted either way. An agent's Preview on another computer shows its app here too. Start with View screen in Settings › Account & Devices › Computers, or the devices menu in the top bar; turn it on on each computer you want to see, at that computer. A computer being seen says so, with Stop, and keeps a record. A device you untick in its Which Devices May Connect can't use that computer at all, with this on or off.") },
  // mac: only where the server runs on a Mac (Apple's Vision reads the pictures).
  { id: 'call-video', mac: true, label: tx("Speakers From the Call's Video"), hint: tx("While a call records and someone talks, a few pictures of the call's window are read on this Mac for whose mouth is moving and the name under that face, so the transcript says who said what, people sharing a room's camera too. Only who was seen talking, and when, is kept: never the pictures. It needs Screen Recording, as names from the screen do (Settings › Voice & Meetings).") },
]

// Whether a trial is on, from the config every part of the app shares (it's asked again when
// Settings change).
export function useTrial(id) {
  const { data } = usePoll('/config', 10 * 60 * 1000)
  return data?.trials?.[id] === true
}
