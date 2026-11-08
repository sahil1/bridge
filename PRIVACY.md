# Privacy

Bridge AI is an open-source app (https://github.com/sahil1/bridge) made of three parts: the app on
your computer, a relay on your own Cloudflare account, and the phone apps for iPhone and Android.
The app on your computer sends the project anonymous usage stats and crash reports (below), which
you can turn off in Settings › About & Updates; nothing else goes to the project or its author. The
relay and the phone apps send the project nothing. There is no account and no ads.

Last updated: November 2026.

## On your computer

Bridge AI runs on your computer and keeps its data there, in `~/.bridge-ai`. It listens only on
your computer (`127.0.0.1`). Your agents (Claude Code, Codex and the others) talk to their own
providers with your own sign-ins, under those providers' terms; Bridge AI reads their screens and
transcripts on your computer and types into them for you.

The outside requests Bridge AI makes itself are for what it shows you: the weather (Open-Meteo,
with only the coordinates you picked), market prices and news headlines (Yahoo Finance, the Federal
Reserve and public news feeds), speech models when you download one, the first time you use the
mic or a meeting or from Settings › Voice (one download each from Hugging Face; what you say is
turned into text on your computer and never sent anywhere, unless you pick a speech service for
meetings), the local model (Gemma 4 E2B, 2.8 GB) only when you click Download for it in Settings ›
Model Providers (one download from Hugging Face; what you give it is read on your computer by
llama.cpp, which runs there and answers only Bridge AI, and is never sent anywhere), a check on
GitHub for a newer version, which you can turn off in Settings › About &
Updates (and, when you choose to update, the new version from GitHub; with an early-access code,
the check asks for the list of recent releases, and the code is checked on your computer and never
sent), and, unless you turn them off, usage stats and crash reports to the project (below). Its fonts and icons are part of the app, so nothing is fetched to draw
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
Bridge AI uses it to check the key and, when you or the chief of staff ask, to put a question to
that model. Both go straight from your computer to that provider.

Who said what in a room (a meeting with your mic only) is worked out on your computer by a small
voice model you download from Hugging Face the first time you ask for it. What it works out from
each line stays in that meeting's folder and goes with it when it's deleted. If you turn on Remember
voices you name (Settings › Meetings, off to start with), the voices you name are kept as a few hundred
numbers each, with the name you gave, in `~/.bridge-ai/meetings/voices.json`, readable by you only;
they're never sent anywhere, not to your other devices either, and Forget voices deletes them.

Dictation and voice notes are turned into text on your computer, and the recording isn't kept
(unless you ask for it, below). With "Show the words as you talk" (Settings › Voice, on where your
computer keeps up), the sound goes to your computer as you talk, a moment at a time, rather than all
at once when you let go; it's heard there the same way and goes nowhere else. The dictation key from other apps (Settings › Voice) is heard for
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

When you ask the Chief of Staff out loud, what you said goes to it as any message you type does,
and its answer is read to you by a voice on the device you're using (its own voices, never one
fetched from the internet), or, on a device with none, by eSpeak NG on your computer.

What you dictate is kept on your computer, in `~/.bridge-ai/dictations`, so you can find it again
under Dictations: the words as they were put in and as they were heard, when, for how long, and
where they went (the name and bundle ID of the app you were in, and its icon; or the agent; and
whether they were pasted, sent, typed or copied). It's kept for always unless you pick 30 days or a
year, and never leaves your computer (a paired phone shows it end-to-end encrypted, as it shows
everything else). The recording itself is only kept if you turn on "Keep the recordings too".
Settings › Voice › Dictation turns the history off (then nothing new is kept) and deletes all of it;
deleting one deletes it from the disk, not just from the list. A dictation refused because a
password field had the keyboard isn't kept.

With Scheduled Routines on (a beta feature), what you type into Bridge AI's boxes (an agent's or the
Chief of Staff's message box, New, the Tasks panel, an answer in Needs You) is kept on your computer,
in `~/.bridge-ai/commands`, for History › Commands and to suggest a routine when you ask the same
thing on a schedule: the words, when, and where they went (the agent, its folder, or the Chief of
Staff). Not the files you attached, only how many. It's kept for 90 days unless you pick 30 days or
a year, never leaves your computer, and Settings › General › Command History turns it off (then
nothing new is kept) and deletes all of it. What agents send each other isn't kept.

Mail (on a Mac) is read from Apple Mail's own files on your computer: its index (in
`~/Library/Mail`, opened read only) for the list, and a message's file when you open it or when it's
next in the list (read ahead, so it opens at once). Bridge AI only reads mail. It never sends,
archives, flags, moves or deletes anything, never puts a draft in your mailbox, and talks to no mail
server. What you mark Done or set aside with Remind me (including "remind me if nobody answers"),
and the senders you mark Always important or mute, are kept in `~/.bridge-ai` (`mail/marks.json`,
`cache/mail-rules.json`), and Mail is left as it is. An agent you start on an email (Summarize, Action
items, Ticket, Triage) reads that message's file on your computer, works under its own provider's
terms, and is told your mail is read only.

Reply Assist writes a draft only when you ask for one. Then the open email (with the earlier messages
it quotes), your How You Write profile with a few of your own replies as examples, and any free times
you put in, go to the model you picked for meeting notes (Settings › Meetings); a model on your
computer keeps them there. Reply Assist names that model and shows exactly what it was sent. How You
Write is learnt the first time you agree to it, and again now and then while you use Reply Assist
(Settings › Mail turns that off): up to 40 of your own replies from Mail's Sent folders and up to 40
of the lines Who spoke marks as yours in recorded meetings, from the last four months, go to that
same model. Only the short profile and a few examples are kept, in `~/.bridge-ai/mail/voice.json`,
which Settings › Mail shows, lets you change and clears. Scheduling Assist reads your calendar on
your computer and holds or adds nothing; the times reach a model only if you put them in a draft.
Copy and Open in your mail app hand the draft to you and your mail app; you send it.

Files shows your agents' folders, and only the other folders you add to it yourself (Places, with
the folder picker); it keeps each place's path in `~/.bridge-ai/places.json`, not what's in it, and
looks in none of them until you open it. A file you copy to another of your computers, or send from
your phone, goes end-to-end encrypted over the same link as everything else (the relay sees only
how much goes), and lands only in the folder you pick on the computer it goes to.

Signature Assist (a beta feature in Studio, off until you turn it on) keeps the signature and
initials you draw as two pictures in `~/.bridge-ai/studio/signatures`, readable by you only; they're
never sent to a model or anywhere else, and removing one deletes it from the disk. A PDF you sign
is read on your computer to find where to sign. Only when you press Explain it does the PDF's text go
to the model you pick, as any other request to that model does (one on your computer keeps it
there); a scan with no text in it is read on a Mac first, on your computer. The signed copy is a new
file in a `_signed` folder beside the PDF, and the PDF itself isn't changed.

The calendar reads macOS Calendar on your computer, once you allow it: each event's title, time,
place and calendar (and that calendar's colour), who's invited (their names and addresses), who
organised it, your answer to it, and its notes, from which it keeps the join link, a short agenda
and the files the invite links to. It only reads: Bridge AI never adds, changes, deletes or answers
an event. How you have it shown (the day your week starts, your working hours, the calendars you
hide) is kept in `~/.bridge-ai/config.json`.

Prep Assist, before a meeting with other people, puts together what's already on your computer:
who's coming and which of them are in your recorded meetings, the summary and the action items still
open from the last meeting like it, the invite's agenda and files, and on a Mac your mail with them
from Mail's own index (the last ten days' subjects, senders and Mail's short previews, read only).
When it suggests goals and questions (when you ask, or by itself fifteen minutes before, unless you
turn that off in Settings › Meetings), all of that goes to the model that writes your meeting notes,
as your meeting notes do: a model on your computer keeps it there; any other gets it. What it
suggests is kept in `~/.bridge-ai/cache/meeting-prep.json` until two days after the meeting.

If you run Bridge AI on a server or in Docker, all of this applies to that machine instead of your
computer.

## Usage stats (on unless you turn them off)

Bridge AI on your computer sends the project anonymous usage stats, to see what to build and fix
and which versions are out there. They're on unless you turn them off: **Share anonymous usage
counts** in Settings › About & Updates, beside **Send crash reports by themselves**. `DO_NOT_TRACK=1` or `BRIDGE_TELEMETRY=0` in the
environment keeps them off, and turning them off stops them at once and forgets what was counted
and not yet sent. The phone apps and the relay send nothing of the kind.

Two reports go to the project's server, `counts.boldbridge.ai`, run on Cloudflare; its code is
[counts/worker.js](counts/worker.js) in this repo:

- **Once a week**, after the week is over: Bridge AI's version; its update channel (Stable, or
  Early Access for testers) and, on Early Access, who the code is for: the first name or nickname
  the project gave that tester when it made the code; its rollout bucket, a number from 0 to 99
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
  ranges ("2-5").
- **Once a day**, after the day is over: the version it ran, the one it updated from that day if it
  did, its update channel, rollout bucket and early-access tester as above, the operating system and
  how it's installed, how many times it started (a range), and whether something crashed.

Neither has your name (on Early Access, the tester's name is the one the project chose for the
code it gave them), an ID for you or your computer (a random number new with each report lets the
server count a report once; the rollout bucket is shared with about one computer in a hundred), a
file, folder, project, repo or branch name, anything you typed or said, anything from your agents,
an email address, a host name, or an exact time. The full list of
what can be sent, with every value it can take, is `shared/telemetry-schema.json`; adding to it is
a public change. **See exactly what would be sent** shows the next report as it would go, and a
copy of each report sent is kept in `~/.bridge-ai/telemetry/sent`.

The server sees your IP address when a report arrives, as any website does; it doesn't read or
store it, and its logs are off. It keeps only totals: how many reports said each thing (a version, a
system, a feature on, a count's range), each answer counted on its own rather than together (the
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
crashed, the error and where in Bridge AI's code, its version and update channel (on Early Access,
with the tester's name the project chose), your system, the settings that change how it runs, and
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
runs, use the iPhone app, which has the page built in. It stores when your computer was last online, and the messages you send from your phone
while your computer is offline (to an agent, or an answer to its question), until your computer is
back to take them. Each of those is sealed on the phone for your computer, so the relay can't read
or change it, and it's deleted once your computer has it, or after 7 days. The relay also keeps,
until your phone picks it up, a receipt for each one (sealed for your phone: whether it was
delivered), and which phones are paired with your computer, as ids made from each phone's key, so
no one else can leave messages there.

What Cloudflare can see, as with any site it serves: the IP addresses of your phone and computer,
when they connect and how much they send, your relay's address, and the user agent of the browser
or app (the iPhone and Android apps add `BridgeAIApp` and its version). That's under your Cloudflare account
and Cloudflare's privacy policy, not the project's. The project never sees it.

If you use Tailscale instead, your phone reaches your computer over your own tailnet, under
Tailscale's privacy policy.

## The phone apps

The iPhone and Android apps show Bridge AI from your computer, through your relay. They have no
account. Apart from Cloud Agents (below), they send nothing anywhere but to your relay and, through
it, end to end to your computer.

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
  computer, like the message.
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
