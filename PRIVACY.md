# Privacy

Bridge AI is an open-source app (https://github.com/sahil1/bridge) made of three parts: the app on
your computer, a relay (on your own Cloudflare account, or Bridge AI's relay, run by the project),
and the phone apps for iPhone and Android. The app on your computer sends the project anonymous
usage stats and crash reports (below), which you can turn off in Settings › About & Updates. If you
choose Bridge AI's relay, your phone and computer talk through it, end-to-end encrypted, and it
keeps only what it needs to work (below). Nothing else goes to the project or its author. A relay of
your own and the phone apps send the project nothing. There are no ads, and there's no account unless you want Bridge AI's relay, or Early Access from a Bold
Bridge account (below); anyone can pick Early Access in Settings › About & Updates without one.

Last updated: November 2026.

## On your computer

Bridge AI runs on your computer and keeps its data there, in `~/.bridge-ai`. It listens only on
your computer (`127.0.0.1`). Your agents (Claude Code, Codex and the others) talk to their own
providers with your own sign-ins, under those providers' terms; Bridge AI reads their screens and
transcripts on your computer and types into them for you.

The outside requests Bridge AI makes itself are for what it shows you: the weather (Open-Meteo,
with only the coordinates you picked), market prices and news headlines (Yahoo Finance, the Federal
Reserve and public news feeds), speech models when you download one, the first time you use the
mic, a meeting or a file you transcribe, or from Settings › Voice & Meetings
(one download each from Hugging Face; what you say, and the files you transcribe, are turned into
text on your computer and never sent anywhere, unless you pick a speech service for meetings or
for those files), a local model (Gemma 4 E2B, 2.8 GB; E4B, 4.6 GB; or 26B-A4B, 14.6 GB, as fits your
computer) only when you click Download for it in Settings › Model Providers or where Tidy what I
say needs one (one download from Hugging Face; what you give it is read on your computer by
llama.cpp, which runs there and answers only Bridge AI, and is never sent anywhere), a check on
GitHub for a newer version, which you can turn off in Settings › About &
Updates (and the new version from GitHub, when you update, or by itself while you're away in the
desktop app on a Mac or Windows unless you turn that off there too; on Early Access or Nightly,
the check asks for the list of recent releases, and an early-access code from your Bold Bridge
account is checked on your computer and never sent), and, unless you turn them off, usage stats and crash reports to the project (below). Its fonts and icons are part of the app, so nothing is fetched to draw
it. On Windows and Linux, the desktop app's spell check gets the dictionaries for your languages
once, from Google, as Chrome does; nothing you type goes with them (a Mac uses its own).

When you install something from Bridge AI, it comes from where it's published, under that
publisher's terms: Node.js from nodejs.org, a coding agent from its maker's own installer or from
npm, Homebrew from GitHub, and on a Mac, Apple's developer tools from Apple. Links in Bridge AI (where
to get a key, a provider's documentation, a pull request, a stock's quote) open in your browser;
Bridge AI doesn't fetch them itself. Claude Code's own /insights report, which Bridge AI shows as
Claude Code wrote it, may load its fonts from Google Fonts in that view. A picture in what you paste
into a Studio document from a web page or Google Docs is copied in from where it is, as the page
you copied from loads it, so the file keeps it.

When something in Bridge AI crashes, it keeps a note of it on your computer (in `~/.bridge-ai`; the
desktop app also keeps what its server printed, in `logs/server.log`) and offers **Report on
GitHub**. That shows you the whole issue it would fill in, with names, folders, emails and keys taken
out, for you to read and change; it reaches GitHub only if you open it there and send it yourself,
under GitHub's terms. Unless you turn crash reports off
(below), the same report also goes to the project by itself.

How much of your plan is left is off until you turn it on (the Usage card, or Settings › General).
Then Bridge AI asks each agent's own provider, with the sign-in that agent uses on your computer,
through quota-axi. If you add an API key for a model provider (Settings › Model Providers),
Bridge AI uses it to check the key and the provider's list of models (asked again every few hours)
and, when you or the chief of staff ask, to put a question to that model.
Both go straight from your computer to that provider.

Who said what in a room (a meeting with your mic only) is worked out on your computer by a small
voice model you download from Hugging Face the first time you ask for it. What it works out from
each line stays in that meeting's folder and goes with it when it's deleted. If you turn on Remember
voices you name (Settings › Voice & Meetings, off to start with), the voices you name are kept as a few hundred
numbers each, with the name you gave, in `~/.bridge-ai/meetings/voices.json`, readable by you only;
they're never sent anywhere, not to your other devices either, and Forget voices deletes them.

Speakers from the call's video (a beta feature, on a Mac, off until you turn it on) takes a few
pictures of the call's window while someone talks, as your Screen Recording permission allows, and
reads them on your Mac with Apple's Vision: where the faces are, how much each mouth moved and the
names under them. The pictures stay in memory and are never written to disk; only those numbers and
names are kept, in that meeting's folder (`sights.jsonl`), and they go with it when it's deleted.

Record the screen too (off until you tick it) keeps a video of the window or screen you pick while a
meeting records, with the meeting's sound. It goes only to Bridge AI on your computer as it records,
which keeps it in that meeting's folder (`video-1.mp4`, or `.webm`); it's never sent anywhere else,
and it goes with the meeting when that's deleted, or on its own with Delete video.

Dictation and voice notes are turned into text on your computer, and the recording isn't kept
(unless you ask for it, below). With "Show the words as you talk" (Settings › Voice & Meetings, on where your
computer keeps up), the sound goes to your computer as you talk, a moment at a time, rather than all
at once when you let go; it's heard there the same way and goes nowhere else. The dictation key from other apps (Settings › Voice & Meetings) is heard for
that one key only: on a Mac it's registered with macOS, which tells Bridge AI when it's pressed and
let go; on Windows and Linux a keyboard hook runs only while the key is held, and until Ctrl, Alt,
Shift and the Windows key are let go too (a few seconds at most), to hear them let go, and ignores
every other key. If you pick one key on its own instead (Fn or the right ⌥ on a Mac, Right Alt on
Windows and Linux), it can't be registered that way, so Bridge AI listens to the keyboard while
that's your key: on a Mac with a listen-only event tap (macOS asks to allow Input Monitoring), on
Windows and Linux with the keyboard hook. It looks for that key going down and up, and only notes
that some other key was pressed while it's held (which cancels); it never records which key, or
anything you type.
Nothing is pasted into other apps unless you pick "Where I'm typing" there. Then, after you let go
of the key, the text is put on the clipboard for a moment (marked so clipboard managers skip it on a
Mac), ⌘V or Ctrl+V is pressed in the app you were in, and what you had copied is put back; on
Wayland it's typed in by wtype instead. On a Mac pressing ⌘V needs Accessibility, which you're asked
for when you pick it, and Bridge AI uses it for that paste only.
Edit by voice (a Mac, off until you turn it on) reads the text you have selected in that app as you
let go of the key, through Accessibility (asking the app for its selection; ⌘C only in an app that
can't say, with what you had copied put back). That text and what you said go to the model you pick
for it: one on your computer (the local model built in, which it uses when you haven't picked one,
Ollama, LM Studio) keeps them there; any other gets them, and Settings says so where you pick it. With nothing selected, nothing is sent anywhere, and with it off, nothing
is read.
Tidy what I say (in the desktop app; on to start with where the local model built in fits your
computer, off where it doesn't) gives what you said from another app, before it's pasted, to the
model picked for it: one on your computer (the local model built in, which it uses when you haven't
picked one, Ollama, LM Studio) keeps it there; any other gets it, and Settings says so where you
pick it. It never picks one that sends your words out by itself. With no model yet, or one that's
slow, your words go as you said them.

When you ask the Chief of Staff out loud, what you said goes to it as any message you type does,
and its answer is read to you by a voice on the device you're using (its own voices, never one
fetched from the internet), by the natural voice made on your computer if you pick it in Settings ›
Voice & Meetings (Supertonic 3, one download from Hugging Face when you ask for it; the answer is read on your
computer and its sound goes only to the device you're using), or, on a device with none, by eSpeak
NG on your computer.

What you dictate is kept on your computer, in `~/.bridge-ai/dictations`, so you can find it again
under Dictations: the words as they were put in and as they were heard, when, for how long, and
where they went (the name and bundle ID of the app you were in, and its icon; or the agent; and
whether they were pasted, sent, typed or copied). It's kept for always unless you pick 30 days or a
year, and never leaves your computer (a paired phone shows it end-to-end encrypted, as it shows
everything else). The recording itself is only kept if you turn on "Keep the recordings too".
Settings › Voice & Meetings › Dictation turns the history off (then nothing new is kept) and deletes all of it;
deleting one deletes it from the disk, not just from the list. A dictation refused because a
password field had the keyboard isn't kept.

Memory keeps the names and terms from your meetings and dictations on your computer, in
`~/.bridge-ai/meetings/memory.json`: how each is spelled and misheard, a note on who or what it is,
and the meetings and dictations it came up in. About You is a few lines made from it on your
computer (your name, your organization, what you work on, the people and organizations that come up
most), or written by you. Until you switch it off on the Memory page, it goes with what the models
you use for meetings are told (writing notes, Who spoke, cleaning up the transcript, AI Assist and
your questions about meetings), and its names with what the model that tidies your dictation is
told: a model on your computer keeps them there; any other gets them. It's also put in
the Chief of Staff's folder (`about-you.md`) for it to read, so its agent's provider gets it as it
gets the rest of what the Chief of Staff reads. Switched off, no model is given it and that file is
deleted.

With Scheduled Routines on (unless you turn it off in Settings › Agents & Models › Agents), what you type into Bridge AI's boxes (an agent's or the
Chief of Staff's message box, New, the Tasks panel, an answer in Needs You) is kept on your computer,
in `~/.bridge-ai/commands`, for History › Commands and to suggest a routine when you ask the same
thing on a schedule: the words, when, and where they went (the agent, its folder, or the Chief of
Staff). Not the files you attached, only how many. It's kept for 90 days unless you pick 30 days or
a year, never leaves your computer, and Settings › Agents & Models › Agents › Command History (under
Advanced) turns it off (then nothing new is kept) and deletes all of it. What agents send each other isn't kept.

Mail (on a Mac) is read from Apple Mail's own files on your computer: its index (in
`~/Library/Mail`, opened read-only) for the list, and a message's file when you open it or when it's
next in the list (read ahead, so it opens at once). Bridge AI only reads mail. It never sends,
archives, flags, moves or deletes anything, never puts a draft in your mailbox, and talks to no mail
server. What you mark Done or set aside with Remind me (including "remind me if nobody answers"),
and the senders you mark Always important or mute, are kept in `~/.bridge-ai` (`mail/marks.json`,
`cache/mail-rules.json`), and Mail is left as it is. An agent you start on an email (Summarize, Action
items, Ticket, Triage) reads that message's file on your computer, works under its own provider's
terms, and is told your mail is read-only.

AI Assist drafts a reply only when you ask it to (Draft a reply). Then the open email (with the
earlier messages it quotes), your How You Write profile with a few of your own replies as examples,
and any free times you put in, go to the model you picked for meeting notes (Settings › Voice & Meetings); a
model on your computer keeps them there. AI Assist names that model and shows exactly what it was
sent. How You Write is learnt the first time you agree to it, and again now and then while AI Assist
drafts your replies (Settings › Mail turns that off): up to 40 of your own replies from Mail's Sent
folders and up to 40 of the lines Who spoke marks as yours in recorded meetings, from the last four
months, go to that same model. Only the short profile and a few examples are kept, in
`~/.bridge-ai/mail/voice.json`, which Settings › Mail shows, lets you change and clears. AI Assist's
Find a time reads your calendar on your computer and holds or adds nothing; the times reach a model
only if you put them in a draft. Copy and Open in your mail app hand the draft to you and your mail
app; you send it.

Bots (a beta feature, off until you turn it on) answer in Slack through apps you make yourself, in
your own workspace: a connection is one such app, with the name you give it. One shared connection
reaches all your bots (each answer posted with that bot's name and icon, which Slack lets the app do
with its `chat:write.customize` scope), and a bot can have a connection of its own, an app with its
name. Each talks to Slack only from your computer: through Slack's Socket Mode, a connection your
computer opens to `slack.com` and then to the `wss-*.slack.com` address Slack gives it. None of it
goes through Bold Bridge or your relay, and no app of Bold Bridge's is involved. A connection's two
tokens are kept in `~/.bridge-ai/connections/<connection>/slack.json`, readable by you only, never
in your settings, never shown back but by their last four, and never given to an agent or a model;
Disconnect deletes them. (A bot made before connections had its tokens in its own folder; they moved
to a connection of its own, unchanged.) Test this connection asks Slack, with the connection's own
tokens, about the connection (its app, tokens, scopes, channels and you there), on `slack.com`, and
posts a test message in your direct messages with the app, deleted once it's seen. A connection's
card links to its app's pages on `api.slack.com` (its manifest and its settings, or a new app made
from its manifest, the manifest in the link): they open in your browser when you click them, and
Bridge AI sends nothing there itself.

On a shared connection, which bot a question is for is decided on your computer: a bot's own slash
command, the bot you set for that channel, a bot's name at the start, the bot that answered in that
thread, or in a direct message the bot that person asked last. When none of those says, and more
than one bot may answer that person there, AI Assist's model (the one Bridge AI already uses for AI
Assist, which you chose) is sent the question's words and the names and descriptions of those bots,
nothing else, and only one of those bots can come of it; with no model, or when it can't tell, the
person is asked which, with a button for each. The connection keeps a record of where each question
went and why, with who asked and where but not what, in
`~/.bridge-ai/connections/<connection>/routing.jsonl` (its latest thousand), and the bot each person
asked last in a direct message, in `state.json` beside it.

What a bot reads from Slack, and when:
- Slack sends your computer the messages in the conversations the bot is in: its direct messages,
  and every message in a channel it was invited to (Slack sends those for the replies in its
  threads). Bridge AI keeps only a mention of the bot, a direct message to it, and a reply or an
  edit in a thread it answered in; the rest is dropped as it arrives, kept nowhere and sent nowhere.
- When it takes a question from someone it answers, it reads the conversation the question was
  asked in, then and only then: in a thread, that thread's earlier messages (at most 50); at the top
  of a channel, the channel's latest 20 messages and what's pinned there; in a direct message, its
  latest 20. When it goes on in a thread it answered in, only what was said there since. Of those,
  its agent is given only the words of people who may ask that bot (never a guest's, someone's from
  another company, or an integration's); at the top of a channel, only the asker's own and the bot's
  own, and the message a shortcut was used on; for a scheduled post, the channel's latest messages
  from people who may ask it.
- When it connects again after being away (your computer asleep, Bridge AI closed), it reads its
  conversations, and the threads it's answering in, from the last message it saw (three days at
  most) for what was asked meanwhile.
- Besides those, it asks Slack for your workspace's members' names, and whether someone is a guest
  or from another company (to pick who may ask, and to turn away guests and other companies), and
  its channels' names.

A question from someone it doesn't answer goes to no agent: it gets a polite no, or nothing, as you
choose. One from someone it answers goes to an agent on your computer, started read-only with only
the folders you gave the bot (or an empty folder of its own), with the bot's instructions and the
conversation read for it, which it sends, with what it reads in those folders, to its own provider,
as any agent does; none of it is ever sent to the Chief of Staff. What goes to Slack is only what you
send from Needs You, or, with Answer without asking on, an answer from an agent held to the bot's
folders; a short note when a question is passed on to you, or, if you chose it, that it only answers
people you added; and its reactions on a question (👀 while it answers, ✅ once answered).

Each bot keeps a record of everything it sees and does, on your computer only, in
`~/.bridge-ai/bots/<bot>/trace/` (a file a month, readable by you only): each message it took in,
the conversation it read for each question, each run of an agent with the names of the files it
opened, each draft, your edits, what was sent and discarded, its reactions, edits and deletions in its
threads, its settings' changes (and which of your devices each was made on) and its connection. Never
a token. It's kept for a year unless you choose 90 days or always (Settings › Bots › Activity), older
months deleted whole; it's never in usage counts or crash reports; your phone and your other
computers show it in Settings › Bots through their end-to-end encrypted link, which the relay passes
on without being able to read; and Activity exports it only when you ask. A bot's
settings and instructions are in the same folder, `~/.bridge-ai/bots/<bot>/`. Deleting a bot deletes
its settings, its instructions and its own connections' tokens (a shared connection stays, for your
other bots), and keeps its record, to look at and export in Settings › Bots, until the time it's kept
for runs out. If you also delete its activity history, its record keeps only that it was deleted,
when and by whom. An app stays in Slack until you delete it there; so does a bot's own app after you
move it to the shared connection, which deletes its tokens here.

What else a bot sends to Slack, and keeps:
- With "You in Slack" set (Settings › Bots), each draft waiting for you, and each thing it proposes to
  remember, goes to your own direct messages with the bot, with its buttons: the question, who asked
  and where, the draft, the files it read and, for a change, its diff. What you press there, and what
  you write in its Edit box, comes back to your computer through the same Socket Mode connection.
- While its agent answers, Slack's "working" status and Stop button on the question's thread; an
  answer sent without asking is streamed into its thread. Its Home tab in Slack says whose bot it is,
  that it answers from Bridge AI on your computer, and whether it's online, paused or offline.
- A file attached to a question is downloaded from the address Slack gives for it (on
  `files.slack.com`), with the bot's token, into `~/.bridge-ai/front-desk/files/` for its agent to
  read, and deleted once the question is done. A file its answer sends back (a chart or a table it
  made, or a file in the folders it reads, such as a PDF, as it is), and a long answer as a file, go
  up to the address Slack gives for each upload; until they're sent they're kept in
  `~/.bridge-ai/front-desk/out/`. A file from its folders goes only from the folders you gave it (and
  only while each still leads where it did when you picked it: one that leads somewhere else since,
  through a link, isn't read until you say Keep reading it), never a hidden one, one reached through
  a link, one whose name says it holds keys, passwords or credentials, or one that looks like it
  holds a key, a password or a token. It sends documents and pictures (PDFs, Word, Excel and PowerPoint files,
  pictures, CSV, text and Markdown); data and config files (JSON, YAML, XML, HTML) only once you turn
  on "Data and config files too" (Settings › Bots). Whoever gets the answer gets the whole file, so
  an answer with a file from its folders waits for you in Needs You, which says where the file is
  from, even when it answers without asking, unless you change Send Files From Its Folders Without
  Asking: to people you named, in a direct message with them; or to everyone who may ask, in a direct
  message or a private channel where everyone may ask it (Slack is asked who's in it: no guest, no
  one from another organization), since everyone in that channel gets the file. Never without asking
  in a public channel.
- In a channel you pick for it to answer without a mention, Bridge AI keeps the top-level messages
  of the people who may ask it; everyone else's are dropped as they arrive, as in any channel.

What a bot remembers is kept in `~/.bridge-ai/bots/<bot>/memory.json`, readable by you only: notes
about the bot itself, a channel or a person, each from its answers, your edits to its drafts or
someone telling it "remember that…", and each kept only once you keep it (unless you chose straight
away). Settings › Bots › Memory shows, edits and deletes every one; only kept ones go with a question
to its agent, and only the bot's, that channel's and that person's. Someone who says "!forget me" has
what it remembers about them deleted, their words in its record blanked (each replaced by a hash,
so the record still shows it wasn't changed otherwise), and the kept transcripts of conversations
they were in deleted; that they asked something, and when, stays in the record.

Each answering agent's whole conversation is kept beside its record (`trace/runs/`), and each change's
diff (`trace/changes/`), readable by you only, gzipped once they're a month old, and deleted with
their month. A brief too long for this computer's command line (Windows) is written to a file in
`~/.bridge-ai/front-desk/briefs/` for its agent to read, and deleted with the question.

If you let a bot make changes (Settings › Bots › Changes, for the people you named), its agent edits
only its own copy of the repository, a git worktree in `~/.bridge-ai/front-desk/changes/`. Bridge AI
commits what it changed with your git name, pushes that branch (`bot/<bot>/<thread>`, and only that
branch) to the repository's own remote, and opens a draft pull request there with your own GitHub CLI
(`gh`) sign-in: the branch, the commit and the pull request (with the question and the answer in its
description) are then on GitHub, as any pull request you open is. It never merges and never pushes to
your default branch. With Suggest, none of that happens until you approve the diff.

If you let a bot edit files in its folders (Settings › Bots › Changes › Edits Files in Its Folders),
its agent edits only a copy of the folders you picked for it, in `~/.bridge-ai/front-desk/writes/`
(deleted when it's done), with no commands and no network. Bridge AI takes what changed there and
makes it in your folders itself, on your computer: at once when everyone whose words it worked from
is you or someone you listed, and otherwise once you approve it, from Needs You or your direct
messages. What waits for you is shown there with its diff, all of it before you approve; where it
was asked, only how many files it changes is said until then. Each change, and the files before and after it, are kept with the bot's
record in `~/.bridge-ai/bots/<bot>/writes/`, readable by you only, for Undo, and deleted with its
record. A request to such a bot may be read first by AI Assist's model, if you have one, to say
whether it looks odd; it goes nowhere else for that.

A bot's file (Settings › Bots › Export, or `bridge-ai bots export`) holds its instructions, the
settings you gave it (with the Slack names and ids of the people who may ask) and what it remembers,
never its tokens; it goes where you save it. A scheduled post is a routine in
`~/.bridge-ai/routines.json`, its words put to the bot as from you. Bridge AI's health check, asked
on the computer it runs on (the Docker image's), lists each bot's name and whether it's connected.
A bot can also answer in Discord and in Microsoft Teams, each through a connection there (one shared
by your bots, or one of the bot's own), an app you make there yourself, its secrets kept in the
connection's folder (`discord.json`, `teams.json`), readable by you only, never in your settings, a
log or its record, and never given to an agent or a model. Neither goes through Bold Bridge or your
relay. On a shared Discord connection, an answer goes through a webhook the app makes in that channel
(with Discord's Manage Webhooks permission, which its invite link asks for), posted with the bot's
name and picture; the webhook's token is kept with the app's. Where it can't make one, and in direct
messages, an answer starts with the bot's name. In Teams an app has one name, so on a shared
connection each answer starts with the bot's name.
- Discord: the bot connects from your computer to Discord's Gateway, through `discord.com` and then
  the `gateway.discord.gg` address Discord gives it, as Slack's Socket Mode does; nothing reaches
  your computer from the internet. Discord sends it the messages in the servers it was added to and
  its direct messages (its Message Content intent, which you turn on in Discord, is what lets it
  read their words). Bridge AI keeps only a mention of the bot, a direct message to it, a reply to
  one of its messages, and a message or an edit in a thread it answered in; the rest is dropped as
  it arrives. For a question it answers, it reads the conversation as it does in Slack (a thread's
  earlier messages, at most 50; a channel's latest 20 and what's pinned; a direct message's latest
  20); after being away, what was put to it in the last three days; and your server's members'
  names, and whether someone is a member, a guest or still to pass its screening, to pick who may
  ask and to turn the rest away.
- Microsoft Teams reaches a bot only from the internet, so the bot listens on your computer
  (`127.0.0.1`, a port of its own) at one address, with nothing else of Bridge AI behind it, and you
  make that address reachable with a tunnel of your own (Cloudflare Tunnel, or Microsoft's dev
  tunnels). Teams sends each message there, signed: Bridge AI checks the signature against the keys
  Microsoft publishes at `login.botframework.com` before it does anything with a message, and turns
  away any that fails. To reply, the bot signs in to Microsoft Entra ID (`login.microsoftonline.com`)
  with its app ID and client secret, the only place the secret goes, and posts to the Teams address
  the message came from, only if it's Microsoft's. Its Teams app asks to be sent the messages of a
  channel or chat it's added to, for the replies in its threads: Bridge AI keeps them in memory only
  (the last 50 in each conversation, for three days, gone when Bridge AI closes), as a question's
  context, and takes in only a mention of the bot, a message in a chat with it, and a reply or an
  edit in a thread it answered in. It asks Teams for the members of the teams and chats it's in, and
  whether someone is a guest or from another organization, to pick who may ask and to turn the rest
  away. Checking your tunnel asks its address for an answer only this computer gives.
What goes to Discord or Teams, for a question asked there, is what goes to Slack for one asked in
Slack: what you send, the answers you let it send without asking, its short notes, what it remembers
about someone (sent only to them, in a direct message, when they ask), a post you scheduled for a
channel there, and in Discord its reactions (Teams has none for bots: it shows that the bot is typing
instead). Slack's own stay in Slack: drafts in your Slack direct messages with their buttons, its
working status and Stop, streamed answers and files. A file sent with a question in Discord or Teams
is named in its record, never downloaded or read. Its record says which of them each question came
from, and keeps people and channels there by their Discord or Teams ids. Disconnect, under
Connections, deletes a Discord token or a Teams app's secret from your computer.

Files shows your agents' folders, and only the other folders you add to it yourself (Places, with
the folder picker); it keeps each place's path in `~/.bridge-ai/places.json`, not what's in it, and
looks in none of them until you open it. A file you copy to another of your computers, or send from
your phone, goes end-to-end encrypted over the same link as everything else (the relay sees only
how much goes), and lands only in the folder you pick on the computer it goes to.

With Remote Screen and Preview on (a beta feature, off until you turn it on, on each computer), one
of your devices can see another computer's screen and the apps its agents serve there, and control
it once you turn that on at that computer. Only devices paired with it can, over the same link as
everything else. The screen goes straight between the two devices where the network allows it
(WebRTC, encrypted end to end), each finding its own public address by asking Cloudflare's STUN
server, `stun.cloudflare.com`, which sees that address and nothing else; where it doesn't, it goes as
pictures over the end-to-end encrypted link, so the relay sees only how big each one is. What the two
devices say to set that up, what you press and type while you control it, and the clipboard text
you send either way go over that link too. A project's app goes over it to an address of its own on
127.0.0.1 of the computer looking (only an app an agent's terminal started, never Bridge AI itself), or
on a phone as pictures of it drawn on the computer that runs it. None of it goes to the project. The
computer being seen shows that it is, and keeps who looked, from which device, at what, when, for
how long, whether they controlled it and how it came (the last 200), and each one it turned away and
why (the last 100) in `~/.bridge-ai/remote.json`, readable by you only, shown in Settings. A Remote Access Password,
when you set one at that computer, is kept there only as a salted scrypt hash in that same file: the
password you type on the device looking goes to that computer over the end-to-end encrypted link to
be checked, and is never kept, logged or sent anywhere else. On a Mac, macOS asks about Screen
Recording the first time one of your devices looks, and about Accessibility when you turn control on;
never when you install. While a session lasts, the device looking can ask for a small still of each of
that computer's screens, to pick one; they go over the same encrypted link and aren't kept. Unless
you turn it off at that computer, your other devices are told when a session starts, when control is
taken and when Ask Here First is waiting: a notification to the devices that get that computer's
notifications (and, through each of your linked computers, to theirs), naming the computer and the
device, and a card in each open Bridge AI window. Your linked computers hear who is viewing which of
your computers and since when (never what's on the screen), keep it in memory while it lasts, and
pass Stop or Block This Device back to that computer, which does it. Each notification, and how many
of your devices it reached, is kept with that session's record.

Studio, in the sidebar, also shows your home folder, your cloud drives and this computer's drives,
read-only, to you and to your own linked computers and paired phones over that same encrypted link. Bridge AI's own folder and your keys' folders (`~/.ssh`,
`~/.gnupg`, Keychains) are never shown, and on a Mac, Desktop, Documents, Downloads and iCloud Drive
aren't read until you open one. AI Assist in an agent's Files and in Studio's folders looks at the folder you ask it about on your computer,
and reads a file's contents only to tell whether two files of the same size are the same; nothing
about it leaves the computer unless you choose Suggest how to organize it, which sends that folder's file and folder
names, sizes and dates (never what's in a file) to the model you pick for it, and says which model
and where it runs first. A model on your computer keeps them there.

AI Assist's Sign this (Sign PDFs, in Studio) keeps the
signatures and initials you draw in `~/.bridge-ai/studio/signatures`, readable by you only and
encrypted (AES-256-GCM) with a key the desktop app keeps in your computer's keychain (the Mac's
Keychain, Windows' DPAPI, a Linux secret service) and gives only to the server it starts; a server
started without the app keeps a key file beside them, readable by you only, and Settings › Studio
says so. That keeps them from a copy of the folder read anywhere else; programs running as you are
kept from them by Bridge AI itself, which uses them only in its own windows and your phones
(SECURITY.md says how far that goes). They're never sent to a model, a bot, an MCP client, a Share Link or a crash report,
and removing one deletes it from the disk. Back Up & Move carries them only when you tick them and
confirm it's you (Touch ID, your password or Windows Hello, or your signing PIN where the computer has none of these), inside its own sealed file or encrypted link. Signing on the trackpad reads
where your finger is on it only while the pad is listening, on your computer. Sign on Phone sends
the request to your own phones paired with this computer through your relay (and a notification to
them), and what you draw there comes back the same way, end-to-end encrypted. Ask Before Signing asks
macOS for Touch ID or your password (or Windows Hello) on your computer; Bridge AI only learns
whether you confirmed, and keeps your signing PIN as a salted hash. Each signing is noted in the
document's versions, on your computer: which of your devices, how it was confirmed, the places, the
time and the fingerprints (SHA-256) of the original and the signed copy; the signed copy itself
isn't copied into Bridge AI's data folder, wherever it's moved. A signed copy carries a mark in its
own information (BridgeAISigned) that says it is one. A PDF you sign is read on your computer to find where to sign. Only when you press Explain it does the
PDF's text go to the model you pick, as any other request to that model does (one on your computer
keeps it there); a scan with no text in it is read on a Mac first, on your computer. The signed copy
is a new file in a `_signed` folder beside the PDF, and the PDF itself isn't changed.

The calendar reads macOS Calendar on your computer, once you allow it: each event's title, time,
place and calendar (and that calendar's colour), who's invited (their names and addresses), who
organised it, your answer to it, and its notes, from which it keeps the join link, a short agenda
and the files the invite links to. It only reads: Bridge AI never adds, changes, deletes or answers
an event. How you have it shown (the day your week starts, your working hours, the calendars you
hide) is kept in `~/.bridge-ai/config.json`.

AI Assist's Prepare for this meeting, before a meeting with other people, puts together what's
already on your computer: who's coming and which of them are in your recorded meetings, the summary
and the action items still open from the last meeting like it, the invite's agenda and files, and on
a Mac your mail with them from Mail's own index (the last ten days' subjects, senders and Mail's
short previews, read-only). When it suggests goals and questions (when you ask, or by itself fifteen
minutes before, unless you turn that off in Settings › Voice & Meetings), all of that goes to the model that
writes your meeting notes, as your meeting notes do: a model on your computer keeps it there; any
other gets it. What it suggests is kept in `~/.bridge-ai/cache/meeting-prep.json` until two days
after the meeting.

With Answers in AI Assist on (a beta feature, off until you turn it on), while a meeting records
with AI Assist on, the questions asked since AI Assist last looked go to the model that writes your
meeting notes, with what AI Assist reads already and parts of the past meetings they may be about
(their summaries and your notes, or the lines of their transcripts with the question's words): a
model on your computer keeps them there; any other gets them. Only once you've saved a Perplexity
key in Settings › Model Providers is a question looked up on the web, and only one the model
answered from its own knowledge and says depends on facts that change: the question alone, in a
sentence of its own, goes to Perplexity, never the transcript, your notes, your files or the
meeting's name. The answers are kept in the meeting's folder (`assist.json`), and one you keep goes
in your notes.

If you run Bridge AI on a server or in Docker, all of this applies to that machine instead of your
computer.

## Usage stats (on unless you turn them off)

Bridge AI on your computer sends the project anonymous usage stats, to see what to build and fix
and which versions are out there. They're on unless you turn them off: **Share anonymous usage
counts** in Settings › About & Updates, beside **Send crash reports by themselves**. `DO_NOT_TRACK=1` or `BRIDGE_TELEMETRY=0` in the
environment keeps them off, and turning them off stops them at once and forgets what was counted
and not yet sent. The phone apps and a relay of your own send nothing of the kind; Bridge AI's relay counts its own
use (below).

Two reports go to the project's server, `counts.boldbridge.ai`, run on Cloudflare; its code is
[counts/worker.js](counts/worker.js) in this repo:

- **Once a week**, after the week is over: Bridge AI's version; its update channel (Stable,
  Early Access for betas, or Nightly for nightly builds of main, as picked in Settings › About &
  Updates) and, with Early Access from your Bold Bridge account, that account's id (below; picked
  in Settings, with no code, Early Access names no one); its rollout bucket, a number from 0 to 99
  picked at random once and kept in your settings, which decides how soon a release that goes out
  a few computers at a time reaches yours; your operating system and its
  version (macOS 15.1, Windows 11, Ubuntu 24.04); your chip's family (Apple M2 Pro, Intel Core i7,
  never the exact part); memory and CPU cores, as ranges; how it's installed; its layout; how many
  phones are paired and other computers linked, as counts; which features are on (the agent the
  chief of staff uses, meeting detection, dictation's editing, the local model, your relay's kind,
  the window's language and theme, and the others listed in `shared/telemetry-schema.json`); which
  coding agents are installed; how long Bridge AI has been on your computer, on how many days of
  the week it was used, how long it was in use (a window of it in front on that computer, with you
  typing, clicking, scrolling or touching it in the last two minutes; phones aren't counted) and how
  long it was running, as ranges ("1-5 hours"); and the counts of what you used (agents started by
  kind, meetings recorded, dictations, files sent between your computers, crashes and the rest), as
  ranges ("2-5"). Among them, the models used: for the answers Bridge AI asks a model for itself (a
  chat, AI Assist, meeting notes, tidying a dictation and the rest), each model's family on the
  list ("claude-sonnet", "gpt-5", "llama"; a model of your own is only "other"), how it was reached
  (an agent's sign-in, a key, a cloud, a model server on your computer, or the local model built
  in) and which part of Bridge AI asked; and for agents, the family of the model each started on or
  was switched to, or that none was picked. Never a model's name, and nothing from a prompt or an
  answer. And amounts, each as a range: the tokens Claude Code and Codex used for Bridge AI ("1-10M":
  read from their own logs on your computer, only for the conversations Bridge AI ran and while it
  ran them), the tokens in the answers Bridge AI got from a model itself, the hours of meetings
  recorded, how many words were dictated (never the words), and how long it was in use in each part
  of Bridge AI (Home, an agent, the chief of staff, Meetings, Dictations, Studio, Today, Mail,
  Calendar, Usage, Bots, Settings), as the part you last typed, clicked or scrolled in; the tokens
  by the vendor of the model (Anthropic, OpenAI, Google, xAI, open-weight models, other), and the
  minutes of speech turned into text by each engine (Parakeet or Whisper on your computer, the
  Mac's own, or a service such as Deepgram). The tokens, hours, words and minutes of speech also go
  as numbers rounded to two significant figures (3,417,882 tokens as 3,400,000), so the project can
  see totals: the server only adds each to that week's total for its name and keeps nothing else of
  it. Among the counts are also: what didn't work, by why (an agent that couldn't start because it
  wasn't installed, needed signing in or was at its limit; an answer refused for its key, at a
  limit or too slow; speech, the relay or an update that failed), an agent stopping at its plan's
  limit and agents moved to another account, how often an agent needed you and how fast it was
  answered (within a minute, ten, an hour, or later) and whether on this computer or a phone, what
  was done from a phone (visits, approvals, messages, agents started; counted by this computer, the
  phone apps still send nothing), whether AI Assist's suggestions were kept or dismissed, bots'
  answers by platform and whether you approved, edited or turned them down, and first times on this
  computer (the first agent, meeting, dictation, phone paired, Chief of Staff, Studio file, bot
  answer), each counted once. And how many of the last four weeks Bridge AI was used (1 to 4): your
  computer keeps the weeks it was used to say so, and never sends them.
- **Once a day**, after the day is over: the version it ran, the one it updated from that day if it
  did, its update channel, rollout bucket and account's id as above, the operating system and
  how it's installed, how many times it started (a range), whether something crashed, and how long
  it was in use that day, as a range ("15-30 minutes").
- **Once, a couple of minutes after Bridge AI first runs on a computer**: that there's a new
  install, the day it was installed, its version and update channel, the operating system, the
  chip and how it's installed. Turn usage stats off before then and it never goes.

Neither has your name (with Early Access from your Bold Bridge account, that account's id goes
with them), an ID for your computer (a random number new with each report lets the
server count a report once; the rollout bucket is shared with about one computer in a hundred), a
file, folder, project, repo or branch name, anything you typed or said, anything from your agents,
an email address, a host name, or an exact time. The full list of
what can be sent, with every value it can take, is `shared/telemetry-schema.json`; adding to it is
a public change. **See exactly what would be sent** shows the next report as it would go, and a
copy of each report sent is kept in `~/.bridge-ai/telemetry/sent`.

The server sees your IP address when a report arrives, as any website does; it doesn't read or
store it, and its logs are off. It keeps only totals: how many reports said each thing (a version, a
system, a feature on, a count's range), the week's sum of each number sent as a total and how many
reports sent one, each answer counted on its own rather than together (the
update channel, tester and rollout bucket are kept with the version, and with whether it crashed
that day, and nothing else), never a report as it came, and each report's random number for ten weeks, so one sent twice counts once.
Because reports carry no ID, one already sent can't be found again to delete. If the project stops
collecting, Bridge AI turns them off and says so.

When you add a key for a cloud agent (Cursor, GitHub Copilot, Jules or Claude), Bridge AI on your
computer talks to that provider with your key: to list your repos, start the agents you ask for,
check on them and send your follow-ups. The key stays on your computer, in `~/.bridge-ai`, readable
only by you, and isn't given to the agents Bridge AI starts there. Your code and what the agent does
with it are under that provider's terms. If you give Claude a GitHub token, it goes to Anthropic
with each task so the agent can reach your repo. "Use my GitHub CLI sign-in" reads the GitHub CLI's
token once, when you click it.

## Crash reports (on unless you turn them off)

When something in Bridge AI crashes, its report (the same text **Report on GitHub** shows you: what
crashed, the error and where in Bridge AI's code, its version and update channel (with Early
Access from your Bold Bridge account, that account's id), your system, the settings that change how it runs, and
the last lines of its log, with your name, your projects' and computers' names,
folders, emails, keys and network addresses taken out on your computer) can go to the project, to
help fix it. That happens by itself unless you turn off **Send crash reports by themselves** in
Settings › About & Updates, and when you click **Send
to Bold Bridge** on a crash's report after reading and changing it as you like. By themselves, at
most five go in a day, and the same crash once. `DO_NOT_TRACK=1` or `BRIDGE_TELEMETRY=0` keeps it off, and there's nothing to
send to while the project has no crash server.

Reports go to `crashes.boldbridge.ai`, the same server as the usage counts
([counts/worker.js](counts/worker.js)), which takes out what it can again (emails, keys, home
folders, addresses), keeps each report for 90 days with the day it arrived, and groups reports of the
same crash. It doesn't read or store your IP address, and its logs are off. A report has no ID for
you or your computer, so one already sent can't be found again to delete. A copy of each report sent
is kept in `~/.bridge-ai/telemetry/crashes`, and Settings lists them. If the project stops
collecting, Bridge AI turns crash reports off and says so.

## Your Bold Bridge account (optional)

Bridge AI's relay comes with a Bold Bridge account, and Early Access can too (anyone can also pick
it in Settings › About & Updates, with no account). Nothing else needs one, and Bridge AI never asks
you to make one. You sign in in Settings › Account & Devices (its Account tab,
or its Phone tab for the relay) with your email and a 6-digit code it's sent (there's no password), at `accounts.boldbridge.ai`, run by the project on
Cloudflare; its code is [account/worker.js](account/worker.js) in this repo.

**What it keeps**: your email; your devices (five at most): the name each was given (your
computer's name in Bridge AI), whether it's a computer or a phone, its system, when it was added
and last used, and a hash of its sign-in token; whether you asked for or have Early Access and the
relay, and whether the account is suspended; your requests and their notes; what was changed on
the account and by whom; and, if you use Bridge AI's relay, its counts for your account (messages
in each 8-hour window and each week, and each day's total, kept 90 days). To limit codes, it keeps
for an hour how many were sent to each email and from each network, and for a day the wrong codes
entered for each email, under a hash of each. Never
anything from your computer: your agents, meetings, mail, files and what you type stay there.

**What goes with it**: your email, when you sign in or ask for something; the codes and notices
emailed to you, sent with Cloudflare's Email Service; and, on Early Access, your account's id in the
usage stats and crash reports (above), so the project can tell testers' reports apart.

**Your other computers**: once one of your computers is signed in, it can sign in the others linked
to it (Settings › Account & Devices), over the end-to-end encrypted link between them. One that would rather
not says so, and is left alone.

**Leaving**: Sign out, or remove a device, in Settings › Account & Devices. Delete account there deletes the
account, its devices, requests, history and counts at once (Bridge AI's relay forgets its own within
a day). Bold Bridge's admins see what's kept, to answer requests, and can suspend an account that
misuses Early Access or the relay.

## The website

The website, [boldbridge.ai](https://boldbridge.ai), is served by Cloudflare. It counts visits with
Cloudflare Web Analytics, which uses no cookies and keeps nothing that identifies you. Its download
buttons count each download: which file, the day, and the page or site the click came from (as your
browser tells it), never your IP address; then they hand you the file from GitHub, under GitHub's
terms. The page asks GitHub for the latest version number, so your browser contacts GitHub as well.
Bridge AI itself (the app) doesn't use the website, except to open it when you click a link to it.

## Your relay

To reach your computer from your phone, Bridge AI can set up a relay: a small Cloudflare Worker on
your own Cloudflare account, with your Cloudflare sign-in, which stays on your computer. Your
computer keeps one connection open to it, and your phone connects to it too.

Everything between your phone and your computer is end-to-end encrypted. Each paired phone has its
own key, kept on the phone, and each connection makes fresh keys. The relay passes on bytes it
can't read. In a phone's browser, the page that does the encrypting comes from the relay itself, so
this rests on the relay serving it unchanged: on your own relay that's you; on a relay someone else
runs, use the iPhone or Android app, which have the page built in. It stores when your computer was last online, and the messages you send from your phone
while your computer is offline (to an agent, or an answer to its question), until your computer is
back to take them. Each of those is sealed on the phone for your computer, so the relay can't read
or change it, and it's deleted once your computer has it, or after 7 days. The relay also keeps,
until your phone picks it up, a receipt for each one (sealed for your phone: whether it was
delivered), and which phones are paired with your computer, as ids made from each phone's key, so
no one else can leave messages there.

What Cloudflare can see, as with any site it serves: the IP addresses of your phone and computer,
when they connect and how much they send, your relay's address, and the user agent of the browser
or app (the iPhone and Android apps add `BridgeAIApp` and its version). The relay Bridge AI sets up
is two Workers: the one your phone uses, and one beside it (`<name>-share`) where Share Links open
(below), with the same code. That's under your Cloudflare account
and Cloudflare's privacy policy, not the project's. The project never sees it.

If you use Tailscale instead, your phone reaches your computer over your own tailnet, under
Tailscale's privacy policy.

## Bridge AI's relay (optional)

If you'd rather not set up a relay of your own, you can choose Bridge AI's relay in Settings ›
Account & Devices. It comes with a Bold Bridge account (above), by request. It's the same relay
([relay/worker.js](relay/worker.js)), run by the project on its own Cloudflare account at
`boldbridge.app`, so the project's Cloudflare account carries your traffic instead of yours. Cloudflare
processes it for the project.

Once your account has it, a computer signed in to it with nothing else set up for your phone (no
relay, no Tailscale) starts using it by itself, and Settings says so; one you stopped using it on
doesn't. While a request waits, Bridge AI asks your account about it every half hour, rather than
every 6 hours, so this happens soon after the yes.

**What it can read: nothing past the handshake.** Everything between your phone and your computer
is end-to-end encrypted, so the relay passes on bytes it can't read. That holds as long as the page
doing the encrypting is the one Bridge AI wrote: the iPhone and Android apps have it built in, and
a pairing link opens them when they're installed, but in a phone's browser the page comes from the
relay, so whoever runs the relay could change it (the page says so before pairing). On a relay
that isn't yours, use the iPhone or Android app. Your computer checks the page the relay serves
once a day, and when you open Settings › Account & Devices, against Bridge AI's own for the version the
relay says it runs (its own copy, or that release's from GitHub), and Settings says so
if they differ; nothing is sent but those requests. What it sees, as any server does: the IP
addresses of your phone and computer, when they connect, and how much they send.

**What it keeps for your computer**: a random id (its address there), a hash of the token your
computer uses to connect (never the token), your account's and this device's ids, the Bridge AI
version it was set up with, when it registered and last connected, today's message and data counts,
and, as any relay does, your paired phones as ids made from their keys (and which of them connected
this week), and messages from your phone waiting for your computer, sealed so it can't read them,
for 7 days at most. **For your account**: its messages in each 8-hour window and each week, across
your computers (for its limits), which it reports to your Bold Bridge account every few minutes
while you use it. And because it takes a limited number of accounts at once, it keeps a list of the
computers on it, by their random ids and their accounts' ids, with when each was set up and last
used.

**What it counts, for the project**: when a computer registers and connects (with its Bridge AI
version), how many paired phones connect each week, how much data passes, when a limit is reached,
and each day's totals with the day's busiest computers' use, kept 35 days. Each is by your
computer's random id only: no IP addresses, no content, no names. The full list is in
[relay/HOSTED.md](relay/HOSTED.md).

**Its limits**: it's free, with an allowance for each account, across its computers: so many
messages in each 8-hour window and each week, like Claude's (Settings › Account & Devices
shows them), and limits that stop floods (how big one message can be, how many come at
once, how many phones and tabs are connected at once). It takes a limited number of accounts, and
when it's full, Bridge AI says so and offers the other ways (a relay of your own, or Tailscale). It
also has a daily limit for all the computers on it together; if that's reached, it stops for
everyone until 00:00 UTC. When a limit is reached, your phone and Settings › Account & Devices say which, and
when it ends. The limits may change, and paid plans with higher ones may come; anything a paid plan
would keep or send elsewhere (to take payment) will be said here first.

**Stop using it** (Settings › Account & Devices › Phone › Stop using the relay) and your computer's data there is
deleted at once (should that message not arrive, its id leaves the list of computers within a few
days). Move your computer to a relay of your own instead and its address here stays for up to two
weeks, while your phones paired there move with it, and is then deleted the same way. A computer
that hasn't connected for 90 days is deleted the same way, and deleting your Bold
Bridge account deletes your account's counts and its computers there within a day. Everything else
in this policy, including what Cloudflare sees, applies to it as to a relay of your own, except
that it's the project's Cloudflare account.

## Share Links

A Share Link gives someone outside your devices one file, folder, Studio document or app from your
computer (Settings › Sharing lists them). It goes through your relay (your own, or Bridge AI's), end
to end encrypted the same way your phone's link is: the link's secret is in the part of the link
after `#`, which browsers never send, so the relay passes on bytes it can't read (the page takes it
out of the address once it has read it, and keeps it only in memory). As with your
phone's page in a browser, the page the link opens comes from the relay, so this rests on the relay
serving it unchanged (on Bridge AI's relay, your computer checks it with the phone's page). The
relay, and Cloudflare, see what they see of any connection: the viewer's IP address, when they
connect and how much passes, and the link's id (made from its secret, not the secret). The relay
tells your computer the country Cloudflare says a viewer is in, and nothing else about them; while
a viewer's page is connecting, the relay keeps a hash of their IP address with that connection (to
limit how many connect from one address), and nothing of it once it closes. On
Bridge AI's relay, once a viewer is let in (the password or code given), what a link carries counts
towards your account's allowance there, and what a link shows is at an address of its own under
Bridge AI's share domain.

For a link that names people, a person proves their email with an 8-digit code first. With your
computer signed in to your Bold Bridge account, the accounts service emails it to them from your
account. When the link is made, your computer tells it the emails the link names, which it keeps
only as hashes (keyed with a secret of its own, with the link's id) until the link ends, so it sends
codes to those and nobody else. For each code, their email address and the code go to it, never
what's shared, and it keeps neither (it counts the codes sent to each address for an hour, as a
keyed hash, to limit them). Otherwise your devices get the code in a notification, to pass on
yourself.

On your computer, in `~/.bridge-ai/shares.json` (only you can read it): each link, its secret until
it ends, a hash of its password, the emails it names, and each open and try (when, the country, and
the email, for a link that names people). A link that ends forgets its secret at once, and is
forgotten 30 days later. Nothing about a link or who opened it goes to the project.

## The phone apps

The iPhone and Android apps show Bridge AI from your computer, through your relay. Each carries its
own copy of the relay's phone page, so the code that does the encrypting never comes from the relay.
They have no account. Apart from Cloud Agents (below), they send nothing anywhere but to your relay
and, through it, end to end to your computer.

- **What they keep**: the list of computers you paired and each one's pairing (the phone's key),
  on the phone only. iPhone keeps them in the Keychain, on this device only. Android keeps them in
  the app's own storage and leaves them out of backups and transfers to a new phone. Delete the
  app, or Forget a computer, and they're gone.
- **While your computer is offline**: each app keeps a copy of what your computer last showed it
  (your agents, the chats you opened lately, usage and the brief, up to 24 MB per computer), so
  Bridge AI still opens, and the messages you sent until they're delivered. They're on the phone
  only, left out of backups, and go when you Forget that computer or it removes the phone. The
  relay's page in Safari or Chrome keeps the same in the browser, for that relay's site.
- **The demo**: Try the demo runs inside the app on made-up data and sends nothing anywhere.
- **Camera**: to scan the pairing QR code, and to take a photo when you attach one to a message.
  The scanner's pictures stay on the phone; a photo you attach goes end-to-end encrypted to your
  computer, like the message. Bridge AI in a phone's browser uses the camera only while you Scan QR
  code, after the browser asks, and reads the code on the phone too.
- **Microphone**: only while you dictate a message, record a voice note or take notes in a
  meeting. The sound goes end-to-end encrypted to your computer, which turns it into text there
  (or, for a meeting, with the speech service you picked on it). The phone asks for the microphone
  the first time you use one of them.
- **Lock screen**: the agents notification on Android and the Live Activity on iPhone are made on
  the phone from what your computer sends over the encrypted link.

### Cloud Agents on the phone

Cloud Agents in the phone apps runs agents on Cursor, GitHub Copilot, Jules or Claude with no
computer, with keys you add on the phone.

- **Your keys** stay on the phone. iPhone keeps them in the Keychain, on this device only, so they
  aren't in backups or moved to a new phone. Android encrypts them with a key from the Android
  Keystore, which can't be taken off the phone, and leaves them out of backups and transfers. The
  page you see in the app never gets a key: the app adds it to each request itself, and only to
  requests for that provider's own address.
- **Where things go**: the app talks to each provider directly, over HTTPS: Cursor
  (api.cursor.com), GitHub (api.github.com), Jules (jules.googleapis.com) and Anthropic
  (api.anthropic.com). Nothing goes through your relay, your computer or the project. A provider
  gets your key, the repo and branch you pick, and what you ask its agent to do, under that
  provider's terms. If you give Claude a GitHub token, it goes to Anthropic with each task so the
  agent can reach your repo. Like any site, a provider also sees your IP address and the app's
  user agent (`BridgeAI` and its version).
- **What the phone keeps**: the agents you started from it, what you sent them and what they last
  said, in the app's own storage, left out of backups. Remove a provider's key and the phone
  forgets its agents too. They stay with the provider, in your account there.
- **Checking in the background**: on Android, once you've added a key and allowed notifications,
  the app checks on your agents about every 15 minutes while it's closed, talking only to those
  providers, and tells you when one finishes, fails or needs you. Remove your keys and it stops.
  The iPhone app checks only while it's open.

## Notifications from the Home Screen page

If you add the relay's page to your Home Screen and turn on notifications, your computer sends them
through your browser's push service (Google for Chrome, Apple for Safari, Mozilla for Firefox).
Each one is encrypted for your phone. The push service sees your phone's push address, when a
notification is sent and how big it is, and a short label used to replace an older one (which
agent, or which provider's usage).

## Terms

Using Bridge AI is covered by its license and [TERMS.md](TERMS.md): it's provided as is, and you're
responsible for your agents and for following the terms of the services you connect.

## Children

Bridge AI is a tool for software developers and isn't meant for children.

## Changes and contact

Changes to this policy are made in this file, and its history is in the repo. Questions: open an
issue on GitHub, or for something private, the repo's Security tab › Report a vulnerability.
