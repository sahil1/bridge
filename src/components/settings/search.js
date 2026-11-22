import { t, tx } from '../../i18n/index.js'
import { cloudOnly, peek } from '../../api.js'
import { placePath } from '../../../shared/places.js'

// Every setting ⌘K finds (Palette.jsx), first in its section or under Advanced: where it is, its
// name and the words it's looked for by. Its id is its data-setting there, and a link to it opens
// Settings at it, Advanced too (Settings.jsx; bridge-open-settings with section: its id). Every
// data-setting Settings shows is one of these (test/suites/settings-ui.mjs checks), so nothing in
// Settings is out of ⌘K's reach. near: what to show instead when it isn't there just now. when:
// only in the desktop app ('desktop'), with the desktop's top bar ('wide'), or with a beta feature
// on (its id, src/trials.js), or a feature out of beta (Scheduled Routines: routines; /config
// features). Where it is: a section, or the tab it's in (shared/places.js).
const at = (section, list) => list.map(([id, label, keywords = '', o = {}]) => ({ section, id, label, keywords, ...o }))

export const SETTINGS = [
  ...at('features', [
    ['setup', tx('Set up'), 'setup install node homebrew developer tools speech model calendar mail full disk'],
  ]),
  ...at('you', [
    ['name', tx('Your name'), 'first name call me morning brief'],
    ['location', tx('Location'), 'city weather morning brief place where'],
    ['layout', tx('Layout'), 'simple everything panels today board'],
    ['home', tx('Home'), 'home where bridge ai opens needs you start page open where you were'],
    ['enter-key', tx('Enter Key'), 'enter return key send new line line break message box smart command ctrl shift typing'],
    ['color-mode', tx('Color Mode'), 'dark light system mode appearance'],
    ['theme', tx('Theme'), 'theme colors accent frame appearance'],
    ['text-size', tx('Text Size'), 'text size zoom bigger smaller'],
    ['language', tx('Language'), 'language translate'],
    ['density', tx('Density'), 'compact comfortable'],
    ['font', tx('Font'), 'font typeface'],
    ['share-theme', tx('Share a Theme'), 'copy paste theme'],
    ['topbar', tx('In the Top Bar'), 'pin unpin top bar status weather clock usage sounds', { when: 'wide' }],
    ['permissions', tx('Permissions'), 'allow access microphone accessibility calendars full disk files automation notifications privacy macos', { near: 'name' }],
  ]),
  ...at('agents', [
    ['default-agent', tx('Default agent'), 'claude codex gemini new agents chats routines'],
    ['default-model', tx('Default model'), 'model opus sonnet gpt flag', { near: 'default-agent' }],
    ['resume-work', tx('Pick up unfinished work after an update, a crash or a restart'), 'resume continue crash restart update', { near: 'default-agent' }],
    ['chief', tx('Chief of Staff runs on'), 'chief of staff agent'],
    ['chief-helpers', tx('Helpers at once'), 'chief of staff helpers delegate parallel queue queued at once', { near: 'chief' }],
    ['chief-helpers-edit', tx('Helpers may edit in their own work folder'), 'chief of staff helpers edit permission ask work folder', { near: 'chief' }],
    ['scheduled-routines', tx('Scheduled Routines'), 'routines schedule scheduled every weekday run by itself time history commands'],
    ['consult', tx('Your Chief of Staff can consult'), 'consult second opinion bridge ask models', { near: 'chief' }],
    ['agent-list', tx('Install an agent'), 'agents install sign in claude codex gemini copilot cursor opencode cli'],
    ['plan-usage', tx('Plan usage'), 'quota limits read sign-in anthropic'],
    ['commands', tx('Command History'), 'history commands asked keep delete', { when: 'routines' }],
    ['terminal', tx('Terminal app'), 'open in terminal iterm ghostty warp attach'],
    ['runtime', tx('Where agents run'), 'herdr built in runtime session'],
    ['keep-agents', tx('Keep agents running when Bridge AI quits'), 'quit stop agents running', { near: 'runtime' }],
  ]),
  ...at('providers', [
    ['beta-usage-everywhere', tx('Usage Across Every Provider'), 'beta usage tokens cost every provider today'],
    ['providers-labs', tx('API keys'), 'api key anthropic openai gemini xai grok mistral cohere perplexity meta'],
    ['accounts', tx('Accounts'), 'account switch work personal sign in login auto default', { near: 'providers-labs' }],
    ['providers-local', tx('Models on this computer'), 'local model ollama lm studio gemma offline download'],
    ['cloud', tx('Cloud Agents'), 'cloud agents cursor copilot jules claude managed keys'],
    ['providers-clouds', tx('Clouds'), 'azure aws bedrock vertex google cloud'],
    ['providers-hosted', tx('Hosted open models'), 'openrouter groq together fireworks cerebras hugging face'],
    ['more-models', tx('More Models'), 'show more models qwen code deepseek kimi glm'],
    ['providers-speech', tx('Speech to text services'), 'deepgram assemblyai elevenlabs speech transcription keys'],
  ]),
  ...at('models', [
    ['models-agents', tx('Agents and the Chief of Staff'), 'which model default agent model chief of staff runs on'],
    ['model-jobs', tx('Models for Each Task'), 'model task job meeting notes ai assist mail titles diagrams live fallback auto cloud first together groq openrouter fireworks cerebras hugging face'],
    ['models-elsewhere', tx('Speech and Dictation'), 'speech model parakeet whisper edit by voice tidy rewritten tidied'],
  ]),
  ...at('mcp', [
    ['mcp-server', tx('Bridge AI as an MCP Server'), 'mcp server claude desktop cursor codex boards files meeting summaries other apps'],
    ['mcp-list', tx('MCP Servers'), 'mcp servers tools add install playwright github browser'],
  ]),
  ...at('meetings', [
    ['beta-meeting-board', tx('Live Meeting Board'), 'beta live board whiteboard decisions timeline'],
    ['beta-assist-answers', tx('Answers in AI Assist'), 'beta answers questions perplexity web'],
    ['beta-call-video', tx("Speakers From the Call's Video"), 'beta video speakers faces mouth names', { when: 'mac' }],
    ['transcribe', tx('Transcribe with'), 'speech engine transcription service local apple'],
    ['meetings-speech-model', tx('Speech models'), 'parakeet whisper download speech model', { near: 'transcribe' }],
    ['speech-services', tx('Speech Services'), 'openai groq deepgram assemblyai elevenlabs gemini service', { near: 'transcribe' }],
    ['meeting-language', tx('Meeting language'), 'language detect english spanish french'],
    ['names-terms', tx('Names and terms'), 'memory vocabulary words names spelling misheard'],
    ['notes-model', tx('Notes are written by'), 'model summary notes automatic write summary'],
    ['transcript-cleanup', tx('Clean up the transcript when a meeting ends'), 'clean up fix misheard words transcript'],
    ['name-speakers', tx('Name who spoke on the call'), 'speakers names them who said'],
    ['prep', tx('Prepare for each meeting'), 'prepare prep goals questions mail invite calendar', { near: 'notes-model' }],
    ['meeting-board', tx('Keep a live board, in every meeting'), 'live board whiteboard every meeting', { when: 'meeting-board' }],
    ['assist-answers', tx('Answers in AI Assist'), 'answers perplexity web questions', { when: 'assist-answers' }],
    ['calls', tx('Calls'), 'notice calls zoom meet teams record other side system audio stop'],
    ['meeting-remind', tx('Remind me before meetings'), 'remind reminder before meeting snooze later floating card join turn off', { when: 'desktop', near: 'calls' }],
    ['call-audio', tx('Record the other side of calls'), 'system audio zoom meet teams them', { near: 'calls' }],
    ['crop-shots', tx("Crop pictures of a call to what's shared"), 'crop pictures screenshots slide shared', { near: 'calls' }],
    ['meeting-insights', tx('Meeting Insights'), 'insights time people talk share added up week series'],
    ['save-markdown', tx('Save every meeting as Markdown'), 'markdown obsidian save notes folder'],
    ['meeting-assist', tx('AI Assist in meetings'), 'ai assist suggest what to ask how often instructions summary'],
    ['who-spoke', tx('Who Spoke'), 'speakers voices room learn my voice remember voices names from the call screen recording', { near: 'meeting-assist' }],
    ['mention-meeting', tx('Mention a Meeting'), 'mention meeting key @ message'],
    ['float-card', tx('The floating card'), 'floating card menu bar pause stop hover screenshot screen sharing recording hidden', { when: 'desktop' }],
    ['save-notes', tx('Save notes as Markdown'), 'folder subfolders file name pattern front matter yaml speakers obsidian granola'],
  ]),
  ...at('dictation', [
    ['dictation', tx('Dictation'), 'dictation key talk hold fn background paste where typing'],
    ['dictation-more', tx('Cleanup and Mentions'), 'cleanup mentions dictation extras', { near: 'dictation' }],
    ['edit-by-voice', tx('Edit by voice'), 'rewrite selection voice edit', { when: 'desktop', near: 'dictation' }],
    ['tidy', tx('Tidy what I say'), 'tidy cleanup filler um false starts model local', { when: 'desktop', near: 'dictation' }],
    ['light-cleanup', tx('Light cleanup'), 'um uh capital full stop names', { near: 'dictation' }],
    ['mention-files', tx('Mention files by saying them'), 'at file mention say', { near: 'dictation' }],
    ['live-words', tx('Show the words as you talk'), 'live words as you talk', { near: 'dictation' }],
    ['dictation-history', tx('Dictation History'), 'history keep recordings delete dictations', { near: 'dictation' }],
  ]),
  ...at('voice', [
    ['speech-model', tx('Speech Model'), 'speech to text model parakeet whisper transcribe download voice notes listening'],
    ['whisper', tx('Whisper, for other languages'), 'whisper whisper.cpp languages', { near: 'speech-model' }],
  ]),
  ...at('spoken', [
    ['spoken-answers', tx('Spoken Answers'), 'read aloud voice speed speak answers ask out loud speaking'],
  ]),
  ...at('mail', [
    ['how-you-write', tx('How You Write'), 'tone voice profile replies drafts learn'],
    ['mail-learn', tx('Learn it again now and then'), 'learn how you write again weekly profile'],
    ['find-a-time', tx('Find a Time'), 'working days hours schedule meeting times calendar'],
    ['find-a-time-more', tx('Kept clear around meetings'), 'buffer travel how many times offer'],
    ['mail-read-only', tx('Read-Only'), 'mail never changes send'],
  ]),
  ...at('bots', [
    ['bots-beta', tx('Bots'), 'beta bots slack discord teams bot'],
    ['bots-open', tx('Open Bots'), 'bots connections who can ask instructions reads from answers limits channels scheduled posts export activity memory pause tokens socket mode manifest'],
    ['beta-bots-start', tx('Set up a bot'), 'set up a bot first bot', { when: 'slack-bot' }],
  ]),
  ...at('phone', [
    ['relay', tx('From anywhere'), 'relay phone cloudflare pair a device remote away'],
    ['tailscale', tx('Tailscale'), 'tailscale phone access vpn'],
    ['keep-awake', tx('Keep this computer awake while your phone can reach it'), 'awake sleep lid', { near: 'relay' }],
  ]),
  ...at('machines', [
    ['machines', tx('Your Devices'), 'devices computers other computers'],
    ['link-device', tx('Link a device'), 'link pair computer address code'],
  ]),
  ...at('remote', [
    ['beta-remote-screen', tx('Remote Screen and Preview'), 'beta remote screen view control preview'],
    ['remote-devices', tx('Which Devices May Connect'), 'which devices may connect allow untick keep out block phone computer kept out'],
    ['remote-screen', tx("This Computer's Screen"), 'screen viewing who is looking stop screen recording', { when: 'remote-screen' }],
    ['remote-access', tx('Remote Access'), 'remote access password screen control lock locked out unlock', { when: 'remote-screen' }],
    ['remote-password', tx('Remote Access Password'), 'password remote set change remove', { when: 'remote-screen', near: 'remote-access' }],
    ['remote-control', tx('Let my other devices control this computer'), 'control mouse keyboard accessibility', { when: 'remote-screen', near: 'remote-access' }],
    ['remote-ask-first', tx('Ask Here First'), 'ask here first allow deny', { when: 'remote-screen', near: 'remote-access' }],
    ['remote-sessions', tx('Screen Activity'), 'screen activity record sessions who viewed controlled lockout denied', { when: 'remote-screen' }],
  ]),
  ...at('sharing', [
    ['beta-share-links', tx('Share Links'), 'beta share link sharing shared public url outside people file folder document app'],
    ['shares', tx('Links You Shared'), 'share link sharing shared public url outside people password email code expire stop qr', { when: 'share-links' }],
  ]),
  ...at('notifications', [
    ['this-device', tx('Notifications on this device'), 'notifications push turn on test'],
    ['notify', tx('What to notify about'), 'notify needs you finished usage low'],
    ['notify-sounds', tx('Notification sounds'), 'sound sounds silent mute speaker'],
    ['remote-notify', tx('Screen Sharing Notifications'), 'screen sharing notifications notify phone told stop block remote'],
    ['notify-more', tx('Answer buttons for simple questions (yes or no, or two short choices)'), 'answer buttons phone at computer muted unmute', { near: 'notify' }],
    ['notify-devices', tx('Devices getting notifications'), 'devices notifications remove', { near: 'notify' }],
  ]),
  ...at('account', [
    ['bold-bridge', tx('Bold Bridge account'), 'account sign in sign out email code bold bridge'],
    ['hosted-relay', tx('Bridge AI\'s Relay'), 'relay hosted phone allowance request access use it on this computer pair a phone', { near: 'bold-bridge' }],
    ['delete-account', tx('Delete account…'), 'delete account bold bridge'],
  ]),
  ...at('backup', [
    ['backup', tx('Back Up & Move'), 'backup back up restore move new computer migrate transfer passphrase bots connections tokens'],
    ['backup-what', tx('What Goes'), 'what goes backup included keys settings', { near: 'backup' }],
  ]),
  ...at('about', [
    ['version', tx('Check for new versions'), 'version update check'],
    ['auto-update', tx("Update by itself while you're away"), 'auto update automatic', { when: 'desktop', near: 'version' }],
    ['channel', tx('Update Channel'), 'channel stable early access beta pre-release nightly testers'],
    ['beta', tx('Beta Features'), 'beta trials usage board answers slack bots remote screen video speakers share links'],
    ['usage-counts', tx('Usage Counts'), 'telemetry analytics anonymous share privacy', { near: 'privacy' }],
    ['crash-reports', tx('Crash Reports'), 'crash reports send privacy', { near: 'privacy' }],
    ['privacy', tx('Privacy'), 'privacy usage counts crash reports what is sent'],
    ['report', tx('Report a problem'), 'bug issue github idea feedback'],
    ['report-details', tx('Details for a Report'), 'diagnostics details version system', { near: 'report' }],
    ['tour', tx('Take the tour'), 'tour help'],
    ['license', tx('License and Credits'), 'license terms privacy notices star'],
    ['config-file', tx('Config File'), 'json config file edit config.json'],
    ['config-effective', tx('Effective Settings and Defaults'), 'effective defaults json'],
  ]),
]

// The ones that show when they can't be seen from anywhere else: the agents' rows and the provider
// groups, by the start of their data-setting.
export const FAMILIES = ['agent-', 'providers-']

// Bold Bridge accounts exist (so Account & Backup has its Account tab), as the app last heard.
const accountsNow = () => !!peek('/config')?.accounts

// Where something is in Settings, in your language, for a sentence that sends you there:
// where('remote-devices') is "Settings › Devices & Access › Remote Access › Which Devices May
// Connect". By a section's, a tab's or a setting's id (shared/places.js); a setting the server
// never names comes from SETTINGS above.
export function where(id, { accounts = accountsNow() } = {}) {
  let parts = placePath(id, { accounts })
  const own = parts.length === 1 && SETTINGS.find((x) => x.id === id)
  if (own) parts = [...placePath(own.section, { accounts }), own.label].filter((x, i, l) => i < 2 || x !== l[i - 1])
  return parts.map((x) => t(x)).join(' › ')
}
// The same, without "Settings ›": a setting's section and tab, as ⌘K says it (Settings › {section}).
export const placeOf = (x) => placePath(x.section, { accounts: !!x.accounts }).slice(1).map((p) => t(p)).join(' › ')

// The ones that can show here: Mail's where Mail is read, Account's once Bold Bridge accounts exist,
// the desktop app's in it, the top bar's with it, a Mac's on one, and a beta feature's (or one out of
// beta's) while it's on.
// (Each says whether there are accounts, for its section's name.)
export const findable = (conf) => (cloudOnly ? [] : SETTINGS.filter((x) => (x.section !== 'mail' || conf?.mail) && (x.section !== 'account' || conf?.accounts)
  && (x.when !== 'desktop' || !!window.bridgeApp?.desktop) && (x.when !== 'wide' || matchMedia('(min-width: 900px)').matches) && (x.when !== 'mac' || conf?.platform === 'darwin')
  && (!x.when || ['desktop', 'wide', 'mac'].includes(x.when) || conf?.trials?.[x.when] === true || conf?.features?.[x.when] === true)).map((x) => ({ ...x, accounts: !!conf?.accounts })))
