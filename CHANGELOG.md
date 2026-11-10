# Changelog

Each version's section here becomes its GitHub release notes (`npm run release`).

## 3.13.4

Fixes: the meeting card is whole when the app is zoomed, and resizes as any window does; a PowerPoint shows its own background in Studio; the tabs all stay on screen, as in Chrome; the sidebar folds and scrolls as one; scroll bars only when you need them; Studio takes a phone's photo; a setting found in Settings stays where it shows; and what can't load in Settings › Model Providers can be tried again.

### Fixes

- **The meeting card is whole when the app is zoomed**: zoomed in with ⌘+ in the main window, the card zoomed too but its window didn't, so its right side and bottom were cut off (Stop, Watch screen, the last buttons). Its window now fits it at every zoom, on any screen; the dictation pill's too. And on a short screen, the card no longer runs past it: what's under the bar, or a meeting's prep before it starts, scrolls.
- **The meeting card resizes as any window does**: drag an edge or a corner. Its width holds for every card; open while recording, its height too, and a taller card shows more of what's been said, the newest line at the bottom. It keeps that size on this computer; double-click an edge for its usual size.
- **A PowerPoint's background shows as it does in PowerPoint**: a picture on its master, layout or slide showed as white in Studio. Tiled pictures, the theme's background styles, gradients, patterns and see-through colours are drawn as PowerPoint draws them too, and a picture a browser can't show (TIFF, EMF) shows the colour under it, and Studio says so.
- **A PowerPoint's subtitles use its master's body style**: they were drawn in the title's font, bold and big.
- **A PowerPoint's lighter and darker theme colours match PowerPoint's**: a table's banded rows and the theme's shape and background styles were a shade off.
- **A PowerPoint saved as a Markdown deck keeps its colours**, a dark one dark, instead of turning white; AI Assist shows the slides it writes for a PowerPoint in the deck's own colours.
- **The tabs above your agents all stay on screen**, as in Chrome: they share the strip's width and narrow evenly as more open, the one you're on keeping its name and ×; past that, Search tabs (the ⌄ at the end) says how many are out of sight and finds any tab as you type. Close a tab with the pointer and the next one's × is right under it; hover a tab for a moment to see its whole name and its space.
- **Tab Groups look and work like Chrome's** (Beta Features): each group starts with a chip in its own colour, with a line in that colour under its tabs; click the chip to fold the group, right-click to fold it, start an agent in that space or close its tabs.
- **The top bar's chips match**: the same size and look, quiet until you point at one, with only what needs you filled in colour; in a smaller window the time and the weather go first, then words give way to icons.
- **The sidebar folds**: Views (Home to Files) folds to one row of icons and Spaces to how many there are, each kept on this computer. The sidebar scrolls as one, with both headings always in sight, and a long day or month of meetings has Show more instead of a list scrolling on its own.
- **Scroll bars show only when you need them**, as macOS draws them: thin, with no track, while the pointer is over that area or you scroll it, in light and dark. They no longer show in every pane at once when your Mac is set to always show them.
- **A meeting in a short panel scrolls as one page** (a small window, or the Agents panel under it), rather than the page scrolling and each column inside it scrolling too.
- **Studio takes a picture over 1 MB**, as most phones' photos are, in a document or a deck, and a Word copy or a deck for AI Assist over 1 MB: they were turned away as "HTTP 413".
- **A setting found in Settings stays where it shows** while the rest of its section comes: on a busy computer, what came above it a few seconds later (Set up's list, Permissions) slid it down, off the window, and a click meant for it could land on something else.
- **Settings › Model Providers has Retry** when your agents' sign-ins, your accounts or the cloud agents couldn't be checked (Bridge AI starting again after an update, say): they stayed so until you left the window and came back.
- **A request too big for Bridge AI says so**, with how much it takes, rather than "HTTP 413"; and a window closed or reloaded while it sends something no longer leaves an error in Bridge AI's log.

## 3.13.2

Fixes: dictation keeps all of what you said and says when to wait; the phone opens Bridge AI sooner; Home and the calendar keep what you set; Studio never loses a version on Windows; meeting notes never half written; Insights quick on a busy computer; and pairing that only you decide: a code adds one device, which your computer asks you to keep, and nothing the relay says can unpair it.

### Fixes

- **Dictation keeps all of what you said when the computer is busy as you let go**: the end of it, or all of a short one ("Recording too short"), could be lost, mostly in Safari and the iPhone app.
- **Dictation says to wait when you press it again before the last words are in**, rather than doing nothing while what you say is lost. In the dictation window, those last words still go where you said them, not to the app or window of the new press.
- **Dictation for another computer's agent in a tab never lands in this computer's Chief of Staff**: in a window's first moments, the words are shown and kept instead.
- **Ask out loud says to press it again once it's listening hands-free**, after a tap or a let go before the mic was on, instead of telling you to let go.
- **The phone opens Bridge AI sooner**: after a pairing link, it gets ready and connects while it asks "Pair with …?", so Pair goes straight through; opened again, it no longer waits on what the phone keeps before connecting.
- **Studio never loses a file's versions on Windows**: a look at them while one was being kept could come back empty, and a version kept then could be written over the others.
- **A meeting's saved notes are never half written**: your notes app could read an empty note while it saved, and a note saved twice at once could stop being kept up to date.
- **Edit Home keeps what you arrange**: hiding a section and bringing it straight back could leave it hidden, or put back an order you had changed.
- **Working hours set right after the week's start are kept** in the calendar: the start went back to 9 AM.
- **A meeting opened from Home or the floating card opens in its sheet on a busy phone**, not just at its day.
- **Insights opens quickly on a busy computer**: its first look over your agents' logs could take seconds while other windows were opening.
- **Meeting Insights says when it's still loading another range**: the last range's numbers showed as if they were the new one's until those came; now they're dimmed, and the range says Loading….
- **A chat keeps its end in view when what the agent has running opens under it**: its last card could sit out of sight until the next message, then jump up under the pointer.
- **A chat with any model names its model from the start**: its model button said Default until the first reply.
- **An agent's old shells show as ended** once its terminal no longer counts them, not running now and then.
- **Files' sidebar comes whole**: Locations no longer shows alone first and then jumps down under the rest.
- **Settings › Model Providers' accounts don't move down as the page loads.**
- **Saying you're at the computer still gets through as you leave or reload the page**, so your phone knows when you've gone.
- **Leaving a page while a view is still loading no longer reports a crash**: switching a window to another computer, or reloading, before a view's code had come showed its error and wrote it down (and could send it) as if the app had crashed.

### Pairing and the Relay

- **A pairing code adds one device**, and your computer says so, with Keep and Remove. Another phone takes a new code (Add another device). A pairing link asks "Pair with <name>?" first, and a computer linked with this one's code meets your other computers only once you keep it.
- **Only your computer can unpair a device**: an answer from the relay that can't be checked is said, and tried again, rather than removing the pairing from your phone or unlinking a computer.
- **What a device says about itself comes inside the encryption**: its name, whether it's a phone or a computer, and its relay. A relay can't rename a device, make a phone look like a computer, or move it to another relay.
- **Removing a device stops its notifications at once**, and the six digits for linking a computer never show in a notification.
- **The Android app carries its own copy of the phone page**, as the iPhone app does, so the code that does the encrypting comes with the app, never from the relay.
- **A relay on your own Cloudflare account offers an update** in Settings › Devices, for these changes.

## 3.13.1

What you told us about 3.13.0, made better: the floating meeting card redone, Memory where you use it, Settings in fewer words, dictation that goes where you are, voices that sound like people, Studio's toolbars, switching computers in a moment, and another computer's pages kept apart from this one.

### What's new

- **The floating meeting card, redone:** while recording, one slim bar (the dot, the time, the meeting and Pause) that stays put when it opens. Open, it shows what's being said, one row for how loud each side is and how much each has talked, your note, Suggest what to ask, and New section beside a red Stop. A meeting about to start is half the height, with Join under its title and its goals and questions in one panel.
- **The card hides from screen sharing only while you share:** on a Mac it stays out of a screen you share or record, and your screenshots show it (Settings › Meetings › Hide it from screen sharing: While I share my screen, Always, or Never). On Windows, where the app can't tell, it's on or off.
- **Switching to another computer is quicker:** the app's own files come from this computer when it has them, rather than through the relay, and what's on screen is asked for first. With a relay 150 ms away, the other computer's page shows in about a third of a second instead of a second and a half. The devices menu says it's switching the moment you pick.
- **Memory is in Meetings and Dictations**, no longer in the sidebar: each shows what came up there, with All memory beside it.
- **Settings in fewer words:** each section shows what most people change first, in a line each, and the rest under Advanced at its end. ⌘K finds any setting. What's on by itself and sends what it reads off the computer, or costs money, is never under Advanced.
- **Dictation goes where you are:** to the agent you looked at last on any of your computers ("To Chief of Staff on Desk"), into another computer's agent in a tab, and into a window showing another computer, never to this computer's Chief of Staff in their place.
- **Spoken answers in a natural voice:** the most natural voice the device has (Premium, then Enhanced), and on the computer, Supertonic 3, when you ask for it (a 145 MB download, only then). It stops the moment you talk.
- **Open in Mail and Open in Calendar** show the very message or event in the Mac's own app, and say why when they can't. "Open in" always means another app now, so Home's Coming Up says View Calendar.
- **Studio's headers and toolbars look and behave as one app:** Present and New slide as one split button, Saved said in words, every toolbar one height.

### Fixes

- **Security:** another computer's pages shown here (a tab, a window switched to it, one of its agents popped out) are at an address of their own, a port on 127.0.0.1, and reach nothing of this computer but what it passes them: not its powers in the desktop app, its microphone, its API, its terminals or what it saves in the browser.
- **Security:** an old Studio version of a page or an SVG opens sandboxed: it ran its script as the app, with everything the app can do there.
- **Edit Home opens as Home was left**, waiting for the computer's arrangement: on a slow computer or a phone it could open in the first order and save over yours.
- **A sheet opened after a document starts at its top**, not under a blank band.
- **A suspended account is said the same way in Settings › Devices**, however the computer heard it first.
- **A long folder path wraps on a phone** in Settings.

## 3.13.0

AI Assist, one wand wherever a model helps; Memory for everyone; Home that puts what needs you now first, with this computer ahead and arranged your way; Studio's documents, sheets and decks doing what Google's do, with Focus and Open in Word, Excel or PowerPoint; and Files, a Finder for all your computers, a new beta feature.

<!-- rollout: 10 -->

### What's new

- **AI Assist, the same everywhere:** wherever a model can help, one button with a magic wand at the right end of the header or toolbar, and what it can do there in plain words. In a meeting: Suggest what to ask, Write the summary, Clean up the transcript, Work out who said each line, Ask about this meeting. In Mail: Draft a reply and Find a time. In the calendar: Prepare for this meeting. In Studio: Rewrite, Write a formula, Make a chart, Write the deck, Sign this. On a whiteboard: Draw this. In Files: Look over this folder. Ask an agent, which hands a file to a coding agent, stays its own button.
- **Memory is for everyone**, no longer a beta feature: a page of its own, never a dialog, from the sidebar, Meetings, a meeting's menu, ⌘K and Settings › Meetings. Collections and search come first, About You and the review beside them, and it keeps its place after a reload. About You is on unless you switch it off: a few lines made on this computer from your memory, given to the models you use for meetings and dictation (which may be cloud models), and read by Chief of Staff.
- **What needs you now comes first** (Home, a beta feature, and every count). A permission or a question first, then failed runs, then tasks, the ones you were on most recently ahead; the top three say why. Anything quiet for 3 days or more is folded away by project and left out of every count (the badge, the window title, the Dock, the phone), and Yes to all never answers one of them.
- **Home puts this computer first, and you can arrange it:** your other computers come last, and Edit Home (a long press on a phone) lets you drag sections into your own order and hide the ones you don't use, as on an iPhone's home screen. A hidden section's items still count, and Home says so.
- **Studio's documents work as Google Docs does** (a beta feature): they save as you type; lists, checklists and pictures paste in from Google Docs, Word and the web; list shortcuts, ⌘K for a link, with a bubble to open, copy, change or remove it, Print and PDF, and page setup saved into a Word file.
- **Studio's sheets too:** a CSV's amounts, percents and dates are numbers, so totals add up, and they're saved as they show; about 20 of the keys Google Sheets users reach for; undo goes 500 steps back; Insert › Chart, saved as a real Excel chart; Print; and Paste and Paste Special in the desktop app.
- **A PowerPoint is edited as itself**, its masters, layouts, shapes, charts and fonts kept, and only the slides you change are written back, so there's no copy to save it as. Shapes, text, pictures and tables, align and group, skip a slide, find and replace, zoom, and present.
- **Focus** in every Studio editor (⌥⌘F, or Ctrl+Alt+F): the page alone, and the desktop app full screen; Esc leaves.
- **Open in Word, Excel or PowerPoint** when one is installed (otherwise Pages, Numbers or Keynote, then LibreOffice). What you save there comes back to Studio, never written over.
- **Files** (a new beta feature): every folder on your computers as Finder shows them, in a list, icons or columns, with Quick Look, Get Info and search. Read-only for now: nothing is renamed, moved or deleted. On a Mac, Desktop, Documents, Downloads and iCloud Drive aren't read until you open them. AI Assist's Look over this folder finds duplicates, large and forgotten files, installers, piles of screenshots and messy folders, read-only; Suggest how to organize it sends names, sizes and dates, never what's in a file, to the model you pick, and says where it runs first.
- **Usage on a phone has its own row in More**, with what the desktop's usage chip shows: the account new agents start on, the limit closest to running out and when it resets, each model's own limits, and switching the account.
- **Usage stats and crash reports say the update channel**, and usage stats a rollout bucket, a number picked at random once: a release can go out to a few computers at a time, and Check now gets it anyway.
- **Standard words:** Read-only, Restore, Unarchive, Remove and Review where the app had its own phrases, section names in Title Case, and a meeting's length as "16 min".

### Fixes

- **Text reads in every theme, light and dark**: 4.5:1 or more against what's behind it, quiet text, links, buttons and badges included.
- **The sidebar's top scrolls on its own** when Meetings' and Dictations' lists make it taller than the window. On a 1280x800 screen, Studio, Files and your spaces were out of reach, and bringing one into view pushed the window up past the top bar.
- **A Markdown list of plain and checklist items is kept as written** in Studio: each plain item opened as an empty checkbox, and was saved so.
- **Dictation's Not now never hides the next dictation** started straight after it, losing its words.
- **A meeting's live words listen for the names of the people invited** and your own words, as its full transcript does.
- **Node.js finishing its install is found:** the agent's card no longer said it couldn't find what had just been installed.
- **The need-you chip opens Home** right after a reload, and the calendar no longer shows an empty week for a moment.
- **The server answers while Insights reads months of conversations**, a piece at a time.
- **Memory fits a phone** with meetings that have long names, and Everything says "on this computer" with one computer, not "on 1 computers".
- **Redo is Ctrl+Shift+Z in a sheet on Windows and Linux** too, and a heading pasted into a Word file looks like its own headings.
- **Security:** image-size, KaTeX and uuid are on their fixed versions.

## 3.12.0

The parts you use every day, made right: edit what you dictated on its card, Studio finds your documents and presentations wherever they are, Memory as a page of its own, routines that run by themselves, Home that keeps to the computer you're on, and a usage chip half the width.

### What's new

- **Edit what you said right on the dictation card.** Click the words or Edit, change them, then ⌘↩ (Ctrl+Enter) to send or paste, or Esc to put them back. A dictation you kept can be edited in Dictations too; it's marked Edited and what was heard stays a click away. Put a name right ("ack me" to "Acme") and you're asked whether to remember it, so it's written that way from then on, in dictation and in meetings. Nothing is kept until you say so, and Undo takes it back.
- **Dictation knows your names.** Whisper now listens for the names in meeting memory, as Parakeet already did, and Tidy what I say and edit by voice are told who and what the names you said are.
- **Studio finds your documents and presentations wherever they are** (a beta feature): Word, PowerPoint, Excel and PDF files of any age, in iCloud Drive and your cloud drives (OneDrive, Google Drive, Dropbox, Box) too. Before, it looked only at recent files and skipped every cloud drive, so a project's code could fill the list. They're listed by kind and by where they are, with search. Studio has Files and Preview, as an agent's tab has; Preview opens a file in its own editor, New is in the header, and files Studio can't open (.doc, .xls, .ppt, Keynote, Pages, Numbers) are listed with Open in app.
- **Memory, a page of its own** (a new beta feature): the people, organizations, projects and words from your meetings and dictations, in collections, each with the meetings and dictations it came from. Names written alike are offered to merge, and a tidy lists the entries that add little for you to look over. About You is a few lines made from it on this computer (who you are, what you work on, who you deal with most), given to the models writing your notes and tidying your dictation, and to Chief of Staff; edit it or switch it off.
- **Meeting memory keeps the names worth keeping.** Summaries no longer add places, languages, days, months or everyday words, and a name is kept only when there's something to know about it or speech to text gets it wrong.
- **Routines run by themselves** (a new beta feature, Scheduled Routines): set when in words ("every weekday at 9") or pick it, with the next runs shown. Make a routine from any message you sent, Run now, Pause, and see each run's result; one that fails, or couldn't run, says why. History › Commands keeps what you asked your agents and Chief of Staff, on this computer for 90 days, and when you ask the same thing at a steady time it offers to make it a routine.
- **Home keeps to the computer you're on** (a beta feature). The "need you" count, the Home badge and Home itself count this computer; each other computer is one line you can open. Opening something on another computer says the window switched, with Back.
- **Switching computers opens what you were on there**, instead of Home every time.
- **Tab Groups** (a new beta feature): the tabs above your agents grouped as the sidebar has them, each space under its name and other computers' agents at the end. A group's name folds it away.
- **The usage chip is half the width**: the provider's mark, the account new agents use and the limit closest to running out. A model's own limit (Fable's week) shows only once it's running out, and each account's model limits are listed in its menu.

### Fixes

- **Opening Chief of Staff when it isn't running starts it**, from Home, the calendar or another computer's Home; it used to do nothing on a computer.
- **An agent's tab is named as the sidebar names it** (Windows): a tab could read "Administrator: C:\Windows\…\powershell.exe".
- **The calendar, Open brief, a meeting and a whiteboard open on the computer on screen**, not the one the page came from, when you're looking at another computer.
- **Home's count stays the same when you pick a kind** (Agents, Meetings…).
- **The usage chip showed the wrong limit** on a plan without a five-hour window, and didn't say when a model's own limit was running out.

## 3.11.1

Fixes: Studio no longer takes its own save for someone else's, which could reload the editor and lose what you were doing; views that closed as they opened; dictation's first press on a busy computer; agents forgotten on a quick restart; and views that couldn't load while your computer was out of reach.

### Fixes

- **Studio never takes its own save for someone else's.** Saving while Studio was looking at whether the file had changed on disk could load the editor again (a deck back on its first slide, a picture being added or what you'd typed meanwhile lost, and "Another app changed it" said), or offer a conflict that wasn't one; a big file could even be kept as a version "from outside" half written. Whiteboards had the same fault ("This drawing was changed somewhere else"). A real change from an agent or another app is still shown as before.
- **A view opened just as your agents' list updated stays open.** Everything, the Agent Map, Dictations, Meetings, a whiteboard or another computer's agent, opened in that moment, closed again at once: See everything or the map from the devices menu did nothing, now and then, on a busy computer.
- **Dictation listens from the first sound.** It said it was listening before the microphone's sound came, so a key held on a busy computer, or with a Bluetooth headset that takes a moment to switch to its mic, ended as "Recording too short". A tap and a hold are told apart by when you let go, even when the page is busy.
- **Agents still reopening when Bridge AI stops again come back next time.** Quitting or restarting in the first moments after a start forgot the agents not yet reopened, without a word.
- **A view that couldn't load while your computer was out of reach opens once it's back.** On a phone or in Safari, a dropped link at the wrong moment left Settings (or another view) broken until a reload, and Try again showed the same error.
- **Meeting Insights' 90 days are 90 days after a clock change.** For the three months after the clocks went back or forward, for an hour of each day, the range was a day short or long, and the weekday averages with it.
- **A message to an agent that's free isn't held while its screen redraws** (Windows).
- **A slide dropped in the deck's strip goes where you dropped it**, however quickly.
- **Links to Bridge AI's old website address keep the page they pointed at** (they could land on boldbridge.ai's front page).

## 3.11.0

Studio for real work: Word files as pages and saved exactly, sheets like Excel, a slides editor, PDFs with Signature Assist, and the files you use from anywhere on its home. The calendar and mail stay read only and gain Assist: Prep before a meeting, replies in your own voice, and free times from your calendar. Meeting Insights for months of meetings, Usage split by account, a Home that's easier to follow, and whiteboards that draw Mermaid as written.

### What's new

- **Studio edits Word files as Word has them**: real pages with headers, footers and page numbers; styles, fonts, colours, lists, tables and pictures; comments and tracked changes; find and replace, an outline, a word count, and Ask AI to rewrite what you pick, shown before you take it. Saving changes only what you changed, so everything else in the file stays exactly as it was (it used to lose headers, footers, comments and tracked changes).
- **Studio's home lists the files you use**: recent documents, sheets, decks and PDFs from anywhere on your computer (Spotlight on a Mac, Recent items on Windows, the desktop's recent files on Linux, and your agents' folders), looked for only once Studio is open, with Add a folder.
- **Studio's sheets**: Excel's ribbon and formula bar, with sort, filter, conditional formatting, validation, notes and links. Saving keeps everything else in the file exactly as it was (charts, pictures, pivot tables and macros included). CSV files keep their separator, encoding and line endings. Ask AI on the cells you pick: a formula, a cleaned-up column, a summary or a chart, shown on the sheet before it's made.
- **Studio's decks are edited as slides**, typing right on each one: a slide strip and grid, layouts and themes, pictures, speaker notes, presenting with a presenter view, and Write with AI, which shows a whole deck, a rewritten slide or a new one before you keep it. PowerPoint files open in the same editor, and saving one makes a copy beside it unless you choose to replace it, so the original's design stays as it was. Exported PowerPoints get real layouts, placeholders, notes and your theme.
- **Signature Assist** (a new beta feature, in Studio): open a PDF you're asked to sign and press Sign. It explains in plain words what you're signing, using the model you pick, then finds where your signature goes; you approve each place, and a signed copy is saved in a `_signed` folder beside the original. Your drawn signature stays on your computer. PDFs in Studio now also have thumbnails, zoom, find and text to select, on phones too.
- **Meeting Insights for months of meetings.** Tiles against the weeks before, time by week split into series and one-off, when in the week you meet, and where the time goes: by day, by series and by person. People finds anyone as you type, and each person has a page with your meetings together over time and the action items open either way. Meeting memory folds into groups by series or month, with a search. Rooms, mailing lists and mailboxes like schedule@ are no longer counted as people. It turns itself on once 5 meetings are recorded on a computer, unless you've turned it off, and says so.
- **The calendar, finished and read only, with Prep Assist.** Each calendar keeps its own colour and hides with a click; your answer to each invite shows; the week starts when you like and the grid shows your working hours; Chief of Staff's tasks with a day sit on their day. An event's panel has the invite's files and a recorded meeting's notes. Before a meeting with other people, Prep Assist puts together who's coming (who you've met and who's new), last time's summary and what's still open both ways, your mail with them, and goals and questions from the model that writes your notes, saying what they're based on: in the calendar, on Home and on the floating card ten minutes before. Bridge AI never adds, changes or answers an event.
- **Mail helps you answer, and never changes your mail.** Every action has a key (? lists them, ⌘K teaches them). Done and Remind me, including "remind me if nobody answers", leave Mail as it is. The next message opens at once and new mail shows as it arrives. Reply Assist drafts a reply in your own voice and language, learnt from your sent mail and what you say in meetings (Settings › Mail), with the model you picked for meeting notes; it shows exactly what it sent the model, and you send the reply from your own mail app. When someone asks to meet, Scheduling Assist offers free times from your calendar, in both time zones.
- **Usage by account**: each account has a colour, which you can change from the swatch on its card, and which shows wherever the account does. With several accounts, the daily bars, today's cost and Insights' By account are split by account wherever Bridge AI can tell which account ran what; the rest shows as Not known instead of being counted under your usual login.
- **Home is easier to follow.** Every note sits in line with the rest of the page, every button on a card has an icon, and cards side by side are the same height with their buttons along the bottom. One Sort control orders it all: what needs you first, newest, oldest, by computer or by kind. Pin anything to the top and it stays there on that computer, its phone included. The heading counts everything that needs you on every computer; its ring shows how much you can answer now, and pointing at it shows how many are on each computer and of each kind.
- **Whiteboards draw Mermaid as written.** Class diagrams keep their UML arrow ends, a line stays a line, an arrow back between two boxes no longer sits on top of the first, sequence diagrams keep their messages in order, and no text is cut off when a diagram is the first board opened.

### Fixes

- **Messages to a busy agent all arrive, one at a time.** Two messages sent close together while an agent worked could clear or merge into each other, so one went missing. Every message sent while it works is now held by Bridge AI, shown queued with Edit and Remove, and delivered in order, each exactly as you wrote it, on your phone and your computer, across a dropped connection too. Send now still interrupts. Whatever reports a send says "Queued for" when it waits, naming the agent as the sidebar does. On Windows, a message to an agent that's free no longer waits as if a menu were open.
- **Needs you keeps each computer's things apart.** Two computers can number their agents alike, so one item showed twice and answering it hid the other; and an answer given from another computer shows at once.
- **Subagents show everywhere, phones included.** Subagents an agent sends off in the background were only in its chat, and the agent read as done while they worked. The Agents cards, the sidebar, the Agent Map and the lock screen now show them until they finish.
- **The floating card stays where you put it.** Opened with AI Assist, taller than half the screen, it flipped its details above the bar, and closed again it went to the other end of the screen. It now opens from its bar and closes back to it.
- **A sheet you edit shows as unsaved.** Typing in a cell left the status at Saved and Save off, so only ⌘S saved it.
- **Usage's heatmap has squares again.** With Home's styles loaded, its days were stretched into thin black bars.
- **An invite's agenda and Prep's suggestions end at a whole word**, with "…" (they could stop mid-word).
- **Mail's agent tasks don't put drafts into Mail any more**: mail is read only, and Reply Assist drafts in the reader.
- **Mail is hidden on Windows and Linux**, where it can't read mail (a Mail tab and an Inbox card said so).
- **A table made in Studio opens in Word without a repair**: it was saved with no column widths.

## 3.10.1

Beta Features (were Trial Features), each finished: Home, Studio, Meeting Insights, usage across every provider and Tidy what I say. Find in a chat or a terminal (⌘F); Bridge AI updates itself while you're away; meetings from any of your computers in the @ menu, and every meeting saved by itself. The top bar shows what you pin; meeting dropdowns that open in a smaller window; AI Assist with room to read, how often it suggests, and a sort; the floating card whole with Assist on; and no warning about a call's sound in a room.

### What's new

- **Beta Features, finished.** Trial Features are now **Beta Features**, last on Settings › About & Updates, and each of them had a finishing pass:
  - **Home**: one row for each thing (a task that was twice on Chief of Staff's list, or on two computers, shows once). **Coming Up** goes a day at a time: the meetings left today and tomorrow, and the tasks that name a day; Chief of Staff's other tasks are in a section of their own, the ones with no day folded. **Ready to Look At** is short rows that end at a word, the project said once, the newest first, with Show all and the ones older than a day folded away; Reply, Clear and Open come up when you point at a row or open it. Loading, nothing there and a failed refresh each say so.
  - **Studio**: a toolbar of real buttons, each saying what it does and its shortcut: Paragraph and Heading 1 to 3, bold, italic, underline, strikethrough, lists, quote, a link, a table (with rows and columns to add or take out) and undo and redo. It offers only what the file keeps when it's saved, and a Word file now keeps quotes and underline. A Word file is a page on a desk; under every file, its words (or sheets, or slides), its kind, its versions and whether it's saved. A deck shows its Markdown, its slides or both. A PDF that can't be shown inside a page says so, with Open it and Download. Its home, Versions and Ask an agent fit a phone.
  - **Meeting Insights**: you're never one of the people you meet (an invite with your email address made you one); a person's action items once each, not once per summary; the chart by week has a scale; the columns say what they are; times and counts in words you'd use ("24 s", "none").
  - **Usage across every provider**: names in full, not cut off; minutes and seconds as words; the chart titled, with a scale; picking a provider says so, with Show every provider.
  - **Tidy what I say**: on with no model to tidy with, Settings says your words go as you said them, with Open Model Providers; Dictations marks the tidied ones.
- **Find in a chat or a terminal**: ⌘F on a Mac, Ctrl+F on Windows and Linux. A small bar at the top of the chat or terminal you're in finds what you type, "3 of 12", every match marked and the current one scrolled to: in a chat, the whole conversation (older messages too, and inside code); in a terminal, its scrollback too. Enter and Shift+Enter (or ⌘G and ⇧⌘G) go to the next and the one before, Match case is a button, and Esc closes it. ⌘K is still search across everything. On a phone, Find is in the chat's and the terminal's menu.
- **Update by itself while you're away**, on unless turned off (Settings › About & Updates), in the Mac and Windows app: once a new version has been out 4 hours, Bridge AI updates itself while you're away (no keyboard or mouse for 20 minutes, or the screen locked), only with nothing running or unsaved (no agent working or waiting on you, no meeting or dictation, no unsaved document or message) and plugged in. Nothing pops up; Settings says when it did, and what it's waiting for if it's waited more than a day.
- **Mention a meeting from any of your computers.** In an agent's message box, @ starts with **Meetings**: your latest meetings, recorded on this computer or another of yours, found as you type; and a word after @ shows the meetings it matches above the files. A meeting from another computer is copied here for the agent to read. A computer that's off, or on an older Bridge AI, is said at the foot of the menu.
- **Every meeting saved by itself**, on unless turned off (Settings › Meetings): to your notes folder as it ends, and again with its summary.
- **Pin what you want in the top bar.** 3.10.0 moved the weather, the clock, usage and updates into the Status menu, even with room to spare. Now each item in Status has a pin (and Settings › Appearance › **In the Top Bar** has the same switches): pinned, it's in the bar as an icon and its value (☀ 20°, the time, usage's ring, the update), and pointing at it shows the details. The weather, the clock, usage, updates, a restart to apply and setup are pinned to start with, as before 3.10.0; notification sounds aren't. As the window narrows, pinned items drop their words first, then leave the bar one at a time, counted on the Status button. The choice is this computer's, the same in each of its windows. With no city picked, the weather says so (and opens the city picker); when it can't be fetched, its chip shows —, with why when you point at it.
- **Meeting dropdowns that open in a smaller window.** In a narrower window the summary's tools (Regenerate, the language, the model and the template) wrap onto two lines, and the summary under them covered the second, so its dropdowns didn't open. They're whole again.
- **AI Assist keeps room to read.** On a short meeting panel (a smaller window, a banner, the Agents panel under it), your notes and Assist were squeezed to a sliver and its suggestions scrolled inside it. They keep their room, and the page scrolls instead.
- **How often AI Assist suggests**: Low, Medium or High, a slider on Assist while it records, and in Settings › Meetings, for every meeting. Low looks every few minutes and says one thing, only when something stands out; Medium is as before, about once a minute; High about every 30 seconds. A change while it records counts at once.
- **Sort Assist's suggestions** newest first, oldest first or by kind (questions to ask first).
- **The floating card fits the screen with AI Assist on.** Open, with Assist's suggestion under the bar, the card was taller than its window could be, and its bottom was cut off. The window now grows to the screen's height, and what's under the bar scrolls past that, with the bar and the suggestion always in view.
- **A meeting in a room isn't a silent call.** On a Mac every meeting records what the computer plays too, in case a call starts. In a room nothing plays, so after half a minute it kept warning to allow Bridge AI in System Settings, and a quiet room meeting never ended by itself. Both now wait for a call to be on (an app like Teams, Zoom or a browser using the mic).
- **One Who spoke** on a transcript with the other side in it, where there were two.
- **Send action items to Chief of Staff again, without copies.** With nothing left unsent, sending a meeting's action items again added every one to Chief of Staff's list again. The ones already on it are now the same tasks.
- **No card about usage stats.** Usage stats and crash reports are as they were (on unless turned off); the card that said so is gone. Their switches are in Settings › About & Updates, and what's sent is in PRIVACY.md.
- **Bold Bridge is the publisher.** The Windows installer, Apps & features and the Linux package name Bold Bridge, the company behind Bridge AI (they said "Bridge AI contributors").
- **A link to star Bridge AI on GitHub** at the foot of Settings › About & Updates' Report a problem. No pop-up and no count.
- **A failed update on Windows says why.** The Windows installer says what went wrong and ends without an error, so Update now showed "Updating…" with no end. It now says the installer's own words.
- **The @ menu names the agent's folder on Windows** (it showed the whole path).

## 3.10.0

A top bar that fits any window; Bridge AI's website at boldbridge.ai; anonymous usage stats and crash reports, on unless you turn them off; and four new parts to try: Home, Meeting Insights with the people you meet, usage across every provider, and dictation tidied before it's pasted.

### What's new

- **The top bar fits any window.** On a smaller window, or with a lot going on, chips were squeezed or cut off at the right edge: the weather's °F and °C stacked on top of each other, the clock half out of sight. Two reasons: the bar didn't check again when its words got wider after a font loaded or changed, and some chips (setup, restart, update, the devices menu) had no way to give way. Now the bar keeps three things always in view: which computer, search (⌘K), and what's happening now (what needs you, a recording or the meeting on now, the next meeting). Usage, setup, updates, a restart to apply, sounds, the weather and the clock are in one **Status** menu, which shows your usage. The news among them stays in the bar while there's room, and the Status button counts what folded into it. A long computer name ends in …, and the whole of it shows on hover.
- **The website is boldbridge.ai.** The old address sends every link there, and the README, the app's Android page and the phone app's notes point to it.
- **Anonymous usage stats and crash reports, on unless you turn them off.** Once a week: the version, the OS and chip family, memory and cores as ranges, how many phones and computers are linked, which features are on, which coding agents are installed, time in use and running as ranges, and counts of what was used. Never your code, prompts, voice, meetings, files or names, and no ID. Crash reports are the crash window's own text, with names, projects, folders, emails and keys taken out, at most five a day. A card after setup (or after this update) says what's sent and turns both off in one click; Settings › About & Updates has both switches, and `DO_NOT_TRACK=1` keeps everything off. What's sent, and where, is in PRIVACY.md. A fork or a company can send them to its own server with one setting (`stats.url`; counts/README.md).
- **Home**, a trial feature (Settings › About & Updates › **Trial Features**): Bridge AI opens at what needs you on every one of your computers, answered in place (yes, no, the agent's own choices, a reply to Chief of Staff), then what's ready to look at (finished work and its pull request, meeting notes with action items not handed off, a whiteboard an agent changed) and what's coming up (the next meeting with a brief from the last one in its series, and the tasks Chief of Staff is on). **Everything** shows every item on every computer, by device or by kind. On the phone, Home is the first tab.
- **Meeting Insights**, a trial feature: Meetings adds up your meetings by week and kind (how many, how long, your share of the talk, words spoken and heard), and **People** shows who you meet, how often, when last and next, and what you talk about, each with a page linking their meetings and open action items. Every number says what it's based on, and all of it is worked out on your computer.
- **Usage across every provider**, a trial feature: Today › Usage shows the tokens every provider and model used, by day and by what in Bridge AI used them (chat, meeting notes, AI Assist, whiteboards, dictation, pull requests), from Claude Code and Codex, the other agents' own logs, and every model Bridge AI calls itself. It shows the cost where an API key has a price, and the time models took on this computer. It stays on this computer, and is never part of the usage stats.
- **Tidy what I say**, a trial feature: dictation into another app is tidied by Bridge AI's local model (or one you pick) before it's pasted, with fillers and false starts taken out and punctuation fixed, keeping your words. If it's slow or anything goes wrong, your words go as you said them and the dictation window says why. Dictations keeps what you said, too.
- **Ready for Bridge AI's relay.** The hosted relay, which will let a phone reach its computer away from home with no setup, now gives each computer a plan with a daily allowance (shown in Settings › Devices), says plainly when a limit is reached and when it ends, and counts its own use for whoever runs it. It switches on in a later version.
- **PRIVACY.md names everything Bridge AI contacts**, including installs, update downloads and links that open in your browser, and a test keeps it complete.

## 3.9.3

Studio to try (documents, sheets, decks and pages, edited by you or your agents with every version kept); AI Assist and meeting notes that carry on on your other account when one is at its limit; quicker with two windows open; notes named after the right meeting when two are on; names for who's talking on a call; meetings that end by themselves once they're over and save as they end; and agents that go by the name you give them.

### What's new

- **Studio**, a trial feature (turn it on in Settings › About & Updates › **Trial Features**; until then it stays out of sight): beside Meetings and Whiteboards, your documents (Word and Markdown), sheets (Excel and CSV), decks (Markdown slides, and PowerPoint), PDFs and pages (HTML, like an artifact), edited in Bridge AI. Open one from Files with **Open in Studio**, from any agent's folder or place, on this computer or another of yours, and on your phone. Or start one from Studio's home. Every change is kept as a version: yours, an agent's (with its name), and one from another app. **Compare** shows what changed since, and **Put back** restores it. **Ask an agent** sends what you picked (a paragraph, a range of cells, a slide) and what to change to the agent you choose, which edits the file itself. Studio shows the change once the agent saves it, and a save of yours never goes over one made meanwhile. A Word file keeps its text, headings, lists, tables, pictures, fonts and colours when saved here, and an Excel file its values, formulas, formats, merged cells and sheets. Before the first save, Studio says what isn't kept; the file as it was stays a version. A deck is written on the left and drawn on the right as you type, presented full screen, and saved as a PDF or a PowerPoint whose titles, bullets and notes you can edit. **Make a deck** in a meeting's ⋯ menu writes one from its summary. **Design packs** (your colours, fonts and logo) give your decks, their PowerPoints and new documents and pages your look, and a deck can name another pack with **Look**. Built on open parts: Univer, Tiptap, Marp, PptxGenJS, ExcelJS, mammoth and docx.
- **The right meeting, when two are on.** Joining the next Teams call a few minutes early, while the last meeting's time isn't up, named the notes after the one ending. Now it's the meeting that starts nearest to when the call began, not to when you pressed record. When macOS already lets Bridge AI read windows (Accessibility, which dictation's typing uses, or Screen Recording), the meeting Teams names in its window wins, and so does a Meet tab's code. Join in Bridge AI's calendar says which one too. Bridge AI never asks for anything new for this.
- **Another meeting?** A meeting named after one event while another was on says so beside its people. Pick the other, and its name, people and invite's files take the first one's place.
- **A meeting that's over ends by itself, and one that runs over doesn't.** As when its call ends: once its time on the calendar is up and nobody's said anything for a minute and a half, the floating card comes up to ask whether to stop; after 5 minutes of quiet, it stops 2 minutes later. While its time lasts, quiet changes nothing. With no calendar time to go by, it asks after 10 minutes of quiet, and stops after 30. Someone talking again takes the question back. For a meeting in a room, and for a call whose app keeps the mic once it's over.
- **Saved as it ends.** With "Save every meeting there by itself" on, a meeting is saved to your notes folder as soon as its transcript is in, and again with its summary. Before, one whose summary wasn't written (no model, or it failed) stayed "Not saved yet". A folder Bridge AI can't write to now says so on the meeting, with why, and Save tries again.
- **Quicker with two windows open.** A terminal is now drawn by the GPU, not row by row as page elements: a terminal printing fast takes half as much of its window's time on a Mac's GPU (7% of a core, from 15%). With herdr, everything that asks for your agents at the same moment (each window's lists, notifications, the queue) shares one read of herdr, where before each ran herdr itself, twice. And a window looks at your devices once, not once for every part of it that shows them. Bridge AI now measures itself too (how long the server was held up, its CPU, its slowest requests), and the tests fail when two busy windows go over budget.
- **Antigravity CLI** (`agy`) is an agent like the others: found when it's installed, installed from New agent when it isn't, and started with what to do first, with Ask first, Edits or Full access. Google's AI plans moved to it from Gemini CLI on 18 June; Gemini CLI stays for API keys and Code Assist licences.
- **A question says what it's about.** When an agent asks to run a command, write a file or make an edit, the card (in its chat, Needs you and on your phone) now shows what it wants to do above the question: the command, the file's lines, or the edit with its removed and added lines coloured. Before, it showed only "Do you want to proceed?" and Yes or No, so you had to open the terminal to see what you were agreeing to.
- **A call's prompt never hangs.** Not now always closes it, at once, even while Take notes is still starting. A mic that never answers (macOS asking somewhere out of sight) says so after 20 seconds, rather than leaving Take notes greyed out, and a calendar slow to read no longer holds it up.
- **Each window says which computer it shows.** With another computer linked, a window's title ends with its name ("Bridge AI · Studio"), so the Dock's and the Window menu's lists tell two windows apart.
- **Names for who's talking, with nothing for you to do.** On a call, the voices on it are now told apart by themselves once it ends, the same way a room's are: Speaker 1, 2, 3, named from what's said, who was invited and the names the call showed. Once Screen Recording is allowed, Bridge AI looks at the call's window by itself as people talk and reads the names it shows, with no Watch a screen. The meeting asks the first time, saying why: it keeps only the words, never the picture. All of it happens on this computer.
- **It learns your voice.** From your mic on calls, where every line is yours, so a meeting in a room knows which voice is you without your naming it. It's a few hundred numbers on this computer only. Settings › Meetings › Who Spoke turns it off, and Forget voices removes it.
- **Who spoke how much**, above each meeting's transcript.
- **The floating card's buttons are easier to see** over a busy screen, and while a screen is watched, **To the menu bar** says what it does.
- **Your accounts by their names, and limits that say what's left.** An agent still on Claude Code's own login after you took it off the list goes by the account it's signed in as (Personal, say), or its email, not "Your usual login". Each limit now reads "75% wk left", and the numbers line up down the list. A plan with no 5-hour window leaves that place empty, and the top bar shows its week once rather than twice. Under each name is when its tightest window starts again.
- **Add a provider from Usage**: another Claude Code or Codex account, another agent's plan (Cursor, Copilot, Gemini), an API key, or a model on this computer.
- **Agents go by the name you give them.** Rename a tab, or double-click an agent's name in its header (or ⋯ › Rename), and that's its name in the header, the tabs and notifications, over the title Claude Code gives its session ("✳ ..."). It stays after Bridge AI opens again.
- **Trial features** in Settings › About & Updates: new parts of Bridge AI that are still being finished ship hidden, each turned on there, and hidden again when it's turned off. Studio is the first. The page's buttons are now one size and style, and its words are translated like the rest of Settings.
- **AI Assist and meeting notes carry on when Claude Code is at its limit.** With Claude Code writing your notes and your usual login at its weekly limit, Bridge AI took Claude Code's "You've hit your weekly limit" for its answer. So AI Assist showed nothing all meeting, without saying why, and that message was saved as the meeting's notes. Now Bridge AI moves to your next Claude Code account with room (the same for Codex) and says so plainly when none has any. AI Assist says when it last looked, and when it can't read an answer. Notes that were only the limit's message are written again once you update.
- **An agent stopped at its usage limit can move to another account**, even when its screen still shows it working. Claude Code can leave its working line up after "You've hit your weekly limit". Bridge AI then counted the agent as busy, so the account menu wouldn't switch it and its chat showed it working instead of the limit. Now the chat says it hit its limit and when that resets, and the account menu moves it to your other account, which carries on from where it stopped.

## 3.9.2

A computer that drops off the network is noticed in seconds, with another of yours a tap away; meetings you can mention to an agent; several files open in Files; a top bar that fits a laptop's window; and a speaker to turn notification sounds off.

### What's new

- **A computer that drops off the network is noticed in seconds.** When a Mac's Wi-Fi went, or its lid closed on the move, nothing told its relay, and the phone waited on it: no word, and everything you tapped hung. Now the phone asks the computer itself. Within about 10 seconds a banner says it isn't answering, shows what it last sent, and has **Open** for another of your computers that's on, beside Start screen. Once it's been quiet for 40 seconds, its relay says it's offline, and since when. Your linked computers notice each other the same way.
- **Back as soon as the network is.** A computer with no network tries its relay again every few seconds, not up to a minute apart, and your other computers link to it again as soon as it's back.
- **A speaker in the top bar** turns notification sounds off on all your devices: the Mac app's, a browser's and your phone's. Notifications still come, without a sound. Click it again to turn sounds back on.
- **A top bar that fits.** With a lot going on, its chips give way a step at a time (the clock, then usage's details, the weather, the meeting, the rest of usage), so Settings is never pushed off a laptop's window. The meeting you're recording no longer shows twice.
- **Mention a meeting to an agent.** In an agent's message box, type @ and a word of a meeting's name, and pick it: the agent gets the meeting to read, with its summary and action items, your notes and the transcript. Settings › Meetings › Mention a Meeting changes the key (# lists only meetings, the latest first).
- **Several files open in Files**, a tab each above the file: click one to bring it back, × to close it. Each agent's Files remembers where you were (the folders open, the files open, the one in front, the place picked) when you leave and come back, or reload, on this computer and when you look at another one.

### Fixes

- **Switching to another computer that went quiet**, from the devices menu or in a window, no longer waits up to a minute and a half: the first thing you ask that gets no answer checks the link, and within seconds it connects again and what you asked comes. The phone coming back from the background no longer cuts its own link to your computer either (it sent with the old connection's keys on the new one).
- **Another computer in a window of its own** no longer shows an error as its page, or stays white, when the link between your computers drops as it opens: what was on its way is asked for again once the link is back. When that computer isn't reachable, the window says so and opens it by itself as soon as it's back.

### After this update

- **Update Bridge AI on each of your computers.** One on an older version can't answer the phone's question, so the phone notices it's gone only when its relay does.
- **The iPhone app** gets the phone's side of this with its next App Store version. Until then, its relay already says when a computer has gone quiet.

## 3.9.1

A model that runs on your computer with one download, local models that read a whole meeting, whiteboards for architecture and network diagrams that look over their own drawing, and a phone that keeps up with the desktop. (3.9.0 never went out: its Mac build stopped at a check before anything was published.)

### What's new

- **A model on this computer, one download.** Settings › Model Providers › Run locally has **Local model on this computer**: Gemma 4 E2B by Google (2.8 GB, Apache-2.0), for rewriting text, edit by voice, questions about a meeting and notes for short ones. Nothing downloads until you click **Download**; then it's in every model list. Bridge AI still prefers Claude and your other models, and picks it by itself only for edit by voice with no model chosen, or when there's no other model. It runs with llama.cpp on the GPU where there is one, on a Mac, Windows or Linux computer with 8 GB of memory or more, and nothing it reads leaves the computer.
- **Ollama and LM Studio read the whole meeting.** Ollama used to keep only the start and end of a long meeting without saying so; Bridge AI now asks it for a context that fits, splits long meetings into parts the model reads whole ("it read the meeting in 3 parts"), and says when a model is too small for meeting notes. Thinking is off for Bridge AI's own jobs (a chat can still think), and an answer that should be JSON is asked for once more when it doesn't parse.
- **"local" is the model you picked.** The Chief of Staff, Insights and pull requests use the local model picked in Settings › Model Providers (Ollama's or LM Studio's), which now lists each model on this computer: how much it reads at a time, whether it thinks, how fast it's been, and whether it's big enough for meeting notes.
- **Whiteboards look like Bridge AI.** Clean thin lines, the app's font and colours, arrows that turn at right angles and snap to shapes, in light and dark. Hand-drawn is still there in Whiteboard Settings.
- **Architecture and network diagrams.** A searchable **Shapes** panel: routers, switches, firewalls, load balancers, servers, databases, queues, caches, CDNs and more; containers for regions, VPCs, subnets, clusters and swimlanes; and AWS, Azure and Google Cloud sets. A container carries what's in it when you drag it, connectors take labels, and **Auto-layout** lines up the board or the selection. Describe "a 3-tier web app on AWS" and Draw this answers with these shapes.
- **Refine.** After the first draft the model looks over its own drawing (overlaps, crossing arrows, missing labels, uneven gaps) and improves it, up to 5 rounds (2 unless you change it), each a version you can pick, with what it changed and why.
- **Whiteboards learn what you like.** What you change after a model draws (direction, colours, names, spacing, the icons you use) is kept on this computer and goes into every drawing's prompt. Whiteboard Settings shows it in words; change it, add notes, or Forget.
- **Export as PDF**, beside PNG and SVG, with real text, of the whole board or only what's selected. **Rename** a board by clicking its name.
- **Draw this, Change it and Refine on Ollama and LM Studio**, sent only as much as the model reads at a time, and with a picture of the board for a model that can see.
- **Every place, on the phone.** The phone's tabs are Chief, Agents, Meetings, Today and **More**, which has Whiteboards, Terminals, Agent Map, Dictations, Needs you, History and Settings. Whiteboards open on the phone, with Draw this.
- **Meetings fit a phone.** The name and time are no longer cut off, a finished meeting is one page, every button and tick is a whole target, the transcript's buttons show once you tap a line, and nothing sits under the notch or the Home indicator.
- **Settings on a phone** is a list of its sections, each opening full screen with **‹ Settings** to go back.
- **The message box on a phone**: +, the mic, the model and send, each a whole target, with the model's full name; while an agent works, Working, Stop and Send now sit on a line above it.
- **The phone gets the new version.** After your computer updates, a phone that kept Bridge AI open loads the new version by itself at a quiet moment (never in the middle of a recording or dictation), or says **Bridge AI on your computer was updated** with Reload.

### Fixes

- **Whiteboards** made elsewhere with a web page or video embedded load nothing from the internet.
- **An older phone app** says when the page needs a newer one, with where to get it.

### After this update

- **Terminals moved into More** on the phone; each agent's own chat is still in Agents.
- **Boards are drawn clean.** Pick Hand-drawn in Whiteboard Settings for the old look.

## 3.8.2

One inbox for everything waiting on you, a map of what's running on each of your computers, meetings that turn into work, dictation you can keep, edit and talk back to, whiteboards that draw what you describe, and another computer's videos and files, played here or copied over. (3.8.0 and 3.8.1 never went out: their builds stopped at checks before anything was published.)

### What's new

- **Needs you, in one place.** Everything waiting on you across this computer, your other computers and Cloud Agents: questions and permission prompts (Yes, No, or the agent's own answers), failed runs and finished work to review, answered right there. The top bar's needs-you chip, ⌘K and the phone notification open it.
- **Agent Map: what's running where.** Each of your computers (and Cloud Agents) with its agents grouped by project: working, waiting or done, for how long, what it's doing, its model and account, and which Chief of Staff thread handed it the work. Offline computers show what they last said. One click opens any agent, wherever it runs. From the devices menu, the sidebar, the Agents board, ⌘K, and the phone's Agents tab.
- **Meetings turn into work.** Each action item can **Start an agent** in the project it's about (picked for you, with why), told what was said, or go **To Chief of Staff**; under it you see what came of it: the agent working, its pull request, or the Chief's task. A meeting in a series shows what happened since the last one.
- **Who said what in a room.** When several people share one mic, their lines are told apart by voice on your computer (Speaker 1, 2…) and you name each voice once. Remembering voices for next time is off unless you turn it on, and stays on this computer. The voice model (26 MB) downloads the first time you use it.
- **Your dictations, kept.** Every dictation is listed under **Dictations** in the sidebar, by day, with the app it went into: search them, copy, paste again, or send one to an agent. Settings › Voice › Dictation History says how long they're kept, or turns it off.
- **A calm recording pill.** While dictation listens, a small pill shows the level, the time and where the words go, then "Pasted into Slack" and it's gone. From other apps it sits at the top of the screen.
- **The words as you talk.** While you dictate or a meeting records, the words appear as they're said; the final text is still the whole recording, at full accuracy. A computer too slow for it turns it off by itself.
- **Edit by voice** (Mac). Select text in any app, hold the key and say what to change ("make this shorter"): the model you pick rewrites it in place.
- **Ask Chief of Staff out loud.** Hold **Ask out loud** above its message box and hear a short answer, read in your device's own voice.
- **Fn or the right ⌥ on its own** as the dictation key (Right Alt on Windows and on Linux with X11).
- **Whiteboards.** Draw by hand, or describe a flowchart, an architecture or a sequence (or draw it from a meeting, a project or an agent's chat) and get shapes you can move and edit; **Change it** edits them by description. Diagram files your agents write (Mermaid, `.excalidraw`, `.drawio`) open as boards, and Chief of Staff can make them too.
- **Another computer's videos, here.** A video or a sound on another of your computers plays in the file viewer as it arrives, seeking included, from a computer or your phone; PDFs and pictures show, anything else downloads (Save to Files on the iPhone). A big file no longer holds up everything else on the link.
- **Files between your computers and your phone.** **Copy to this computer** or **Send to…** another of your computers, from Files, the viewer or by dragging between devices: it goes over the same encrypted link, carries on after a dropped connection, is checked against the original before it takes its name, and never replaces a file (a name that's taken gets a number). **Places** adds folders you pick, beside your agents' folders. From a phone, **Send files from this device** puts photos and videos on a computer.
- **Permissions that just work.** Bridge AI asks macOS's own question first, notices by itself when you've allowed something, and carries on what you were doing. A permission left over from an old version gets **Reset and ask again**. Settings › General › Permissions lists them all.
- **Report a crash on GitHub.** After a crash, read the whole report (with nothing personal in it), change what you like, and open it as a GitHub issue. Bridge AI sends nothing by itself.

### Fixes

- **Whiteboards** leave Excalidraw's own online services (and their key) out of the app; Bridge AI never used them.
- **Try the demo** on an iPhone: its top strip fits, so Pair a computer is always there.
- **Updates:** the update offer goes by the desktop app's own version, a failed update says why with Try again, and after a few days the chip says "Update to x".
- **Windows:** agents are told apart by their tab's name in Needs you and the Agent Map (they all shared the shell's title before).

### After this update

- **The Mac app needs macOS 14 or later.** A Mac on macOS 13 stays on 3.7.1 and isn't offered a version it can't open.
- **Dictation history is on.** Turn it off in Settings › Voice › Dictation History; recordings aren't kept unless you ask.

## 3.7.1

Dictation's key works from other apps on GNOME now, and the desktop app is on Electron 45.

### What's new

- **Dictation from any app on GNOME.** On GNOME 48 or later with Wayland, the dictation key works in other apps too, once you say yes: tap it to start listening and tap it again to stop (Wayland doesn't tell an app when a key is let go). GNOME asks once to allow it. It needs Bridge AI's menu entry, which the `.deb` and the installer put in place, so with an AppImage opened as it is the key stays inside Bridge AI.
- **The desktop app is on Electron 45.1** (Chromium 156, Node.js 24.22).

### Fixes

- **Linux: Bridge AI's menu entry is matched to its windows.** The app's ID is now `dev.bridge-ai.app`, the same as on a Mac and Windows, and its menu entry is named for it (`dev.bridge-ai.app.desktop`) and says which windows are its own. An update replaces the old `bridge-ai.desktop` rather than adding a second entry; if you had Bridge AI pinned to the dock, pin it again once.

## 3.7.0

Talk to your agents: hold a key, say it, and let go. Your words are turned into text on your computer by Parakeet, a speech model that runs wherever Bridge AI does, and can go straight into any app. Setup carries on in the background, and the microphone works again on Macs that updated from 3.4.

### What's new

- **Talk to your agents.** Hold ⌥Space (Ctrl+Alt+Space on Windows and Linux), talk, and let go: the words are where you were typing, in an agent's message box, the Chief of Staff, a meeting's notes, a search box, or an agent's terminal (typed there without Enter). Tap the key instead to keep listening until you press it again or Enter; Esc throws it away. The mic button in the message box works the same way, held or clicked, and on your phone you hold it with a finger. Settings › Voice changes the key.
- **From any app, if you want it.** In the desktop app, after your first words in Bridge AI, it asks once whether the key should work in other apps too. Say yes, and holding it anywhere brings up a small window with what you said, to send to the agent you last looked at, the Chief of Staff or any agent, or to copy. On Linux with Wayland the key is tapped rather than held (KDE, Hyprland), and it isn't offered where the desktop can't pass it on (sway, and GNOME for now).
- **Words come out tidy.** No "um" or words said twice, a capital and a full stop (not in a terminal or a search box), and the names of your agents, projects, branches and meeting memory spelled the way they're written. Say "at payments dot ts" for a mention of that file. No AI model, nothing sent anywhere; Settings › Voice turns each off.
- **Parakeet turns speech into text on your computer.** Voice notes, dictation and meetings now use NVIDIA's Parakeet (25 European languages): more accurate than the Whisper models before, quick on the processor alone, and the same on Macs with either chip, Windows, Linux and the Docker image, which had no speech to text before. Nothing to install (no Homebrew, ffmpeg or whisper.cpp), only a one-time 670 MB download that stays on your computer. The first time you use the mic, Bridge AI offers it and turns what you already said into text once it's in.
- **Settings › Voice** lists the speech models this computer can run, each with its size and languages, to download, use or remove: Parakeet, Parakeet English (best with words like worktree and Claude Code), and Whisper for other languages. Meetings use the same one, and setup's Everything downloads it instead of installing whisper.cpp and ffmpeg.
- **Paste it where you're typing.** From another app, dictation can put your words where your cursor is: pick Where I'm typing (paste it) in Settings › Voice. On a Mac, macOS asks for Accessibility when you pick it; Windows and Linux ask nothing. It never pastes into a password field, puts back what you had copied, and when it can't paste (another app came to the front, a key was still held) the words wait in the dictation window to send or copy.
- **Setup carries on in the background.** Everything starts Node.js first, and the agents' Install buttons show it coming, while the rest installs behind you. A small Setting up in the top bar shows how far along it is and when something needs you: your password, or something macOS wants you to allow. On a Mac without Apple's developer tools, Everything installs them too (about 1 GB), under the same one password, so git works for your agents without macOS stopping to ask. The calendar now uses Bridge AI's own calendar helper, so Homebrew is installed only if you pick a Whisper model.
- **Spelling suggestions in the desktop app.** Right-click an underlined word in a message box for suggestions and Add to Dictionary, as well as Cut, Copy and Paste.
- **Your notes beside the meeting as it records.** While a meeting records, My notes sits beside the live transcript (or Assist), ready to type in; on a phone it's a big box under the recording bar. What you write, the slides it sees and the meeting's files shape the summary: your notes are its backbone, in your words and under your headings, notes with a time are placed where they were said, and a Written from row shows what went in. When the meeting ends it opens on the Summary.
- **Send action items to Chief of Staff** is a labelled button under the action items, saying what happens: Chief of Staff keeps them on its task list and follows up. It replaces an unexplained icon in the meeting's header.
- **A calm top bar on your phone.** It keeps what you need right now (a recording, what needs you, search, Settings), and nothing is cut off any more. Setup, Restart to apply and a new version show as one line under it, and usage, the next meeting and the weather are in Today.
- **Your other computers, from your phone.** The devices menu at the top left lists your computers, with which are online, one tap to switch; in the iPhone and Android apps it also has Cloud Agents and the start screen.
- **Your phone when a computer is away.** The phone's start screen no longer waits on a computer that's offline. Within a few seconds it says whether the computer is offline, can't be reached or isn't answering, keeps trying, and lists your other computers (with which are online), what the computer last sent you, Cloud Agents and Try the demo. Your relay is updated with Bridge AI, so this reaches your phone's browser with this update.
- **The sidebar keeps up as meetings pile up.** Each of the last few days folds, and older meetings fold under Earlier by week and month. The one recording and the one open always show.
- **Chief of Staff in one place:** its row in the sidebar (and ⌘K), with a line saying what it does, instead of three buttons across the window.

### Fixes

- **The microphone on a Mac that updated from 3.4.** macOS doesn't carry over what you allowed for versions signed before 3.5.0, and could go on listing Bridge AI as allowed while blocking the mic, and the message box said to allow it in your browser's settings. Bridge AI now asks macOS itself the first time, and when an old answer still blocks the mic it says so, with Reset and ask again.
- **Meetings:** the invite's agenda reaches the summary and Assist (it was dropped when a meeting started), and action items are found when the summary is written in another language.
- **Plan usage on Intel Macs.** The Intel app carried only Apple Silicon's usage reader, so plan usage didn't show. Each Mac app now has its own.
- **Settings' names are in Title Case,** like About & Updates: Model Providers, MCP Servers, Config File and Cloud Agents.

### After this update

- **A Whisper model you already use stays in use** for voice notes and meetings. Pick Parakeet in Settings › Voice when you like.
- **The dictation key works inside Bridge AI** until you say yes to it working in other apps.

## 3.6.0

AI Assist in your meetings and a transcript that cleans itself up, agents that pick up where they left off after an update, a crash or a restart, a phone that gets back to your computer at once, and setup that asks for nothing.

### What's new

- **AI Assist while a meeting records.** Turn on Assist (on the meeting or the floating card) and your notes model reads along and, about once a minute, suggests what to ask, raise or check next, from what's been said, the invite, the files that go with the meeting and your notes. In an interview it compares what the candidate says with their resume; on a customer call it suggests discovery questions and next steps. Each suggestion says what it's based on; ✓ puts one in your notes, ✕ waves it away, and the newest shows on the floating card. **Suggest now** asks straight away. Settings › Meetings turns it on for every meeting.
- **A transcript cleaned up when the meeting ends.** The notes model fixes what speech to text misheard (names, jargon, a word cut in two) from what the meeting is about, and leaves out words nobody said ("Thanks for watching"). Each fixed line says what was heard, Undo puts one back, and lines left out can be shown and put back. Your own edits always win. It runs when the summary does (Settings › Meetings), or from a meeting's ⋯ menu.
- **Your lines keep only your words.** When you're not on headphones your mic hears the call too; a line of yours now drops what the call said in it, and says what was heard.
- **Files you got for a meeting, one click away.** A resume before an interview, a deck named after the meeting, or a file that came in while it recorded: offered on the Files tab and in Assist from Downloads and the Desktop. On a Mac, macOS asks once whether Bridge AI may look there, when you press Look in Downloads and on the Desktop, never by itself in the middle of a call. The names in a meeting's files help the speech engine spell them.
- **Who said it, more often.** Every meeting where the call was heard gets its lines named before the first summary, from names said ("Hi, Priya"), the invite and the meeting's name; with one other person invited, it's them. Meeting memory now notes who or what a name is, when a meeting makes it clear (never over a note of yours). A meeting called "Interview - …", "… standup" or "… 1:1" gets that kind of notes, and one recorded without its calendar event says when Bridge AI isn't allowed to see your calendar yet.
- **Unfinished work carries on.** When an update, a crash or the computer restarting stops an agent in the middle of something, Bridge AI already reopened its conversation, but then it waited for you. Now it's told why it stopped and to carry on from where it left off, starting again anything it had running in the background. An agent that had finished just reopens. Settings › General › Pick up unfinished work turns it off.
- **Agents working when the computer shuts down come back.** At a shutdown the terminals end one by one, and Bridge AI took each agent off its list as it went, so after a restart some didn't return. Now Bridge AI hears first and keeps them all, on Windows too.
- **Your phone gets back to your computer at once.** After the phone slept or changed networks, its connection could be gone without either side noticing, and Bridge AI on the phone waited, sometimes for good, while your computer took up to a minute and a half to notice and reconnect. Now both check the connection (the phone whenever you come back to it or the network returns) and start a new one in seconds, and a page the phone was loading as the connection dropped loads anyway. Opening Bridge AI on the phone is quicker too: the app's files come over compressed, a third of the size, and the phone's own page isn't downloaded again when nothing changed.
- **Your computer stays awake for your phone.** Once a phone or another of your computers can reach this one, it doesn't go to sleep when you walk away, so your agents are still a tap away. The screen still turns off and locks; closing a laptop's lid can still put it to sleep. It's offered in setup and in Settings › Devices, for the relay and for Tailscale, and now works on a Mac on battery and on Windows too.
- **Setup asks for nothing.** Its first step recommends Just what agents need: Node.js, with no password and nothing for macOS to ask. Everything (meeting and voice notes, the calendar, Mail) is one choice away and says it asks for your password and permissions. And a first start no longer makes macOS ask for your Desktop or Documents folder because a project of yours is there: those projects are listed from your agents' history until you start work in one.
- **Mac disk images are signed and notarized by Apple,** like the app inside, so a downloaded .dmg opens without a warning even offline, and both open as "Bridge AI <version>".
- **herdr:** long opening prompts arrive whole (herdr 0.9.4 refuses long ones on a Mac), a start herdr refuses no longer leaves an empty tab, and with a herdr older than 0.9.0 your agents run in Bridge AI itself, with a note saying why. An out-of-date herdr integration (Codex, after herdr 0.9.5) is named with the command that updates it.

### Fixes

- **Saved files are written whole or not at all.** Settings, accounts, devices, projects, meeting notes and the rest can no longer be left unreadable by a crash or a power cut in the middle of a save.
- **Linux:** outside Debian and Ubuntu (Fedora, say) Bridge AI opens again instead of showing "Not Found", and installs without FUSE or sudo. On Debian or Ubuntu without sudo it installs for you alone instead of failing after the download, and an install from `curl | sh` no longer stops at a question from the system's own installer.
- **Updating a Mac app opened straight from the disk image** puts the new version in Applications instead of failing.
- **An agent you just installed is found.** Looking for it again while Bridge AI was still looking (slow on Windows) gave the answer from before the install, so it seemed not to be there.
- **Windows:** the checks Bridge AI runs in the background (git, the usage reader) no longer flash a console window.
- **Option+arrow still jumps a word** in terminals, with the newer terminal (xterm 6), which scrolls by itself now, with a thin scrollbar that shows as you scroll.
- **Chief of Staff** is called that wherever it's named, and the button that starts it says just that. Settings › About & Updates is capitalized to match.

### Security

- **Electron 44.10,** with Node.js's security fixes, Brotli decompression among them (CVE-2026-111497).
- The Docker image is on Node.js 24 LTS, and the app builds with Vite 8.

### After this update

- **Your computer stays awake while your phone can reach it,** where it used to be off unless you turned it on. Turn it off in Settings › Devices.
- **macOS doesn't ask again for what you allowed.** Up to 3.4.2 every update made it ask for your folders, the mic and Calendar again, because the app's signature changed with each version. Since 3.5.0 it's signed with the same Developer ID every time, so from this update on your answers stay. A release can no longer go out signed any other way.

## 3.5.0

The Mac app is signed and notarized by Apple, so it opens without a warning.

### What's new

- **Opens with no warning.** The Mac app is signed with a Developer ID and notarized by Apple. A download from the browser no longer stops at "Apple could not verify Bridge AI", with no trip to System Settings › Privacy & Security › Open Anyway. macOS still asks once whether to open an app downloaded from the Internet, as it does for any app from outside the App Store.

### After this update

- **macOS asks once more for what you'd allowed.** It remembers permissions by the app's signature, and the signature is new, so the mic, Calendar, screen recording, your Desktop, Documents and Downloads folders, and Finder (for moving a discarded file to the Trash) are asked for again the first time Bridge AI needs them. Later updates keep your answers. If a meeting can't see the screen even though Bridge AI is ticked in System Settings › Privacy & Security › Screen & System Audio Recording, untick it and tick it again.

## 3.4.2

Meeting notes without installing anything on a recent Mac, your calendar once you've allowed it, installs that don't wait on a question nobody sees, and a message to an agent that can't stop its work.

### Fixes

- **Meeting notes without installing anything.** With whisper.cpp picked but not on the Mac yet, meetings went without a transcript. Now the Mac's own speech writes them down meanwhile (macOS 26 or later, in the languages it has), and Settings › Meetings says so and still offers whisper.cpp.
- **Your calendar shows once you've allowed it.** After Allow access the calendar still said Bridge AI wasn't allowed. icalBuddy, which read it, sees no calendars on current macOS even once Bridge AI may, and the check took its empty answer for a yes. Bridge AI now reads your calendars itself, through macOS's own calendar store, so what it asks for and what it reads agree. icalBuddy is only used on a Mac without Bridge AI's helper.
- **Installs don't wait forever.** Homebrew now stops to ask "Do you want to proceed with the installation? [y/n]" before installing anything that brings other packages along, and in the Setup space's terminal tab nobody saw it, so whisper.cpp, ffmpeg and Set up everything waited for good. They go ahead now.
- **Install it in Settings › Meetings says where it's installing,** with Show it, instead of opening a terminal tab out of sight, and another each time you pressed it again.
- **A message to an agent can't stop its work.** With something already typed in an agent's input box, Bridge AI cleared it with Ctrl+C, which stopped the agent if it was working and left the text there ("couldn't be cleared"). It's cleared with Backspace now, and given a moment to redraw. What's typed is seen while the agent works too, so your message doesn't run into it.

## 3.4.0

A security checkup, far fewer meeting pictures, calendar access that works, and accounts you can set as default and put in order.

### What's new

- **Set as default.** Any account in the accounts menu has Set as default under it, so new agents start on it. The default says so under its name.
- **Your usual login has a name.** The account you're signed in with outside Bridge AI shows its email (partly hidden) instead of "Your usual login".
- **Usage and order in Settings › Accounts.** Each account shows how much is left and when its week resets. The up and down arrows put them in the order you like, and the menu follows it.
- **Stop watching** is a button with its name on it, in the meeting and on the floating card.

### Fixes

- **Far fewer meeting pictures.** Watching a call's screen used to keep a picture every few seconds, even with nobody sharing: 171 in a 25-minute Meet call. Now it keeps one when what's shared shows something new and stays put, like a new slide or a page you've stopped scrolling. Faces, cameras going on and off, whoever's talking lighting up, a cursor or a notification don't count, and a picture with the same words as the last one is dropped.
- **Calendar access works.** Allow access now asks macOS for your calendars, so Bridge AI shows up in System Settings › Privacy & Security › Calendars. Before, the button did nothing and Bridge AI never appeared there.
- **Long account names fit.** In the accounts and model menus a long name is cut short and the plan tag stays whole.
- **Meetings on a phone aren't squished.** The meeting's name is left out of the top bar on a narrow screen, and the transcript isn't cut off at the side, there or in the sidebar.

### Security

- **Only your own pages, only you.** A request from another site, or from another port on this computer, is turned away, and no other site can show Bridge AI in a frame. Through Tailscale, only your own Tailscale login gets in.
- **Asking to link checks properly.** The six digits you compare when one of your computers asks to link can't be matched by a relay in between any more. A computer on 3.3 or earlier can't ask one on 3.4.0: update it, or link it with a code.
- **A notification for every new pairing,** so a device you didn't pair doesn't go unnoticed. A device that connects through your relay can't change its name or address until it has proved its key.
- **Checked downloads.** Installs and updates check each download against the release's checksums, take the installer from that version's tag, and only over HTTPS. Releases have build attestations ([SECURITY.md](SECURITY.md) says how to check one).
- **Safer things to show.** Markdown from agents, files and meetings is cleaned before it's shown. News links open only if they're web links. A link in a meeting note to a file that would run, a script say, shows it in Finder instead of opening it. Discard never throws away a file outside the project through a link.
- **The desktop app keeps its controls to itself.** A page an agent made, or a project's app in Preview, can't use the desktop app's controls, screen capture or microphone. Another device's pages get its windows and nothing more. Links it opens outside are only web and mail links.
- **Electron 44,** with its security fixes. The Mac app now needs macOS 13 Ventura or later.
- **Windows:** a question asked through an agent's .cmd launcher is passed on safely, whatever it has in it.
- **Your data folder** (`~/.bridge-ai`) is readable only by you, and the dependencies are up to date with no known issues.

## 3.3.1

Meeting notes put real names on who said what: yours on your lines, and the people on the call from the invite and the screen you're watching.

### What's new

- **Your name, not You.** Your lines show the name from Settings › General › Your name, in the meeting, on the floating card and in saved notes.
- **One other person invited?** Their lines get their name straight away, as a guess you can change.
- **Names from the screen.** On a Mac, while you watch a call's screen, Bridge AI reads it when someone starts talking: the names on tiles, Talking: labels and captions. Only the text is kept and the picture is deleted at once. With the invite and names said in the call, that names Them's lines before the first summary, even when there's no calendar event.
- **Names catch up.** Linking a calendar event or changing who was there works out the names again.

## 3.3.0

Set up everything in one go when you start, a window for each of your devices, and agents from your other devices right in the window you're in.

### What's new

- **How much should Bridge AI set up?** The first step of onboarding now asks. Everything (recommended) sets up Node.js, meeting notes, voice notes and your calendar in one go while you carry on, then shows what macOS asks you to allow (Calendar, and Full Disk Access for Mail) with an Allow button for each. On a Mac, Homebrew, whisper.cpp, ffmpeg and icalBuddy install together in one Set up Bridge AI tab, so you type your password once. Just what agents need sets up Node.js only, and Nothing now leaves it all in Settings › General, as one list with Set up everything that's left.
- **Only what's missing.** Setup checks what's already on the computer first. Anything you already have, Node.js or ffmpeg say, isn't listed or installed again, and is named once at the bottom as left as it is. Voice notes on a computer with ffmpeg says it adds only whisper.cpp and the speech model.
- **Rename your devices.** Settings › Devices › Details renames any of your devices. The name is changed on that device itself, so it's the same on all of them. If it's offline, it says to rename it once it's back.
- **Device details.** The same panel shows its system, chip, host name, how long it's been on, when it was last seen, where its agents run and its security code.
- **A window for each device.** New window opens one of your devices in a window of its own, beside this one, from its row in Settings › Devices, the devices list in the sidebar, or the bar of one of its agents. Each keeps its own tabs and layout, and in the desktop app it opens again at the size and place you left it. In a browser it's a new browser tab.
- **Agents on your other devices, here.** An agent on another of your devices opens in a tab of the window you're in, with the device's name on it, so you can work across your devices without switching.
- **A shorter accounts menu.** Sign in and Allow are now buttons on the account's own row, with a few words under its name saying why ("In use: sign in to see its usage"), not a paragraph for each account. Two accounts that are the same one get a single line under the extra one, with Remove. Auto just says who has the most left. On a phone the numbers have room ("66% 5h", not "66%5h").

### Fixes

- **A failed download says why.** "Can't reach … Check your internet connection and try again." instead of "fetch failed", and setup has a Try again button.
- **Closing the Set up Bridge AI tab** before it finished no longer leaves Installing… on screen.
- **The Devices arrow in the sidebar** points down when the list is open.
- **An account you remove stays gone** from Settings › Accounts. On a slow computer, a check of the list that started just before Remove could answer after it and put the account back on screen.

## 3.2.2

No more "Bridge AI hit an error" after an update on a computer linked to your other devices.

### Fixes

- **"Cannot read properties of null (reading 'blocked')" after an update.** Just after Bridge AI started, a linked device showed as online before its agents were in, and the Devices list in the sidebar broke the whole window over it. It now reads as nothing to say yet, and Bridge AI asks a device for its agents as soon as it reconnects instead of up to 15 seconds later.
- **A small piece can't take the whole window down.** The devices menu, the chips in the top bar, the link requests banner, and the Devices and Meetings lists in the sidebar now step aside if they break and try again by themselves a little later, while everything else keeps working. A section of Settings that breaks says so in place, and the other sections still open. Each is written down once in `~/.bridge-ai/logs/ui-errors.log`, not on every try.

## 3.2.1

Accounts are one plain list: add or remove any, sign in or out, and make one your default.

### What's new

- **One list of your accounts.** Your usual Claude Code (or Codex) login is one of them, called "Your usual login" until you rename it, instead of a row called Default. Each account has Make default, Sign in (again), Sign out and Remove, in Usage (open its row) and in Settings › Model providers › Accounts.
- **Your default has a star.** New agents start on it. Auto is still there: new agents start on the account with the most left, and the one it would pick says auto. If you remove your default, the first account on the list takes over.
- **Remove works on every account.** An added one is signed out and deleted, as before. Your usual login only comes off Bridge AI's list: Claude Code stays signed in to it in the terminal, and Settings › Model providers › Accounts can show it again. The last account always stays.
- **Sign out** runs the agent's own logout for that account. On your usual login it asks first, as that signs Claude Code itself out on this computer.

### Fixes

- **"Default and Personal are the same account. Sign Default in…"** When two rows are the same account, Bridge AI now offers to remove the extra one in one click: your usual login comes off the list (nothing is signed out), or of two added accounts, the one that isn't your default. If the one going was your default, the other one is your default now.
- **Two things called Default.** The button that picks which agent the top bar shows now says In top bar / Show in top bar.

## 3.2.0

One Pair a device for phones and computers, links between your devices that put themselves right, and the Inbox on any Mac.

### What's new

- **Pair a device:** one button for a phone or another computer. It shows a QR code, the link, and the address and code to type, for 15 minutes and up to 3 devices. On another computer, Link a device takes the link, or the address and code typed in.
- **Your phone links your computers:** scan a new computer's code with the Bridge AI app on a phone paired with another of yours, and it offers to link the two. You allow it on the other one, from the phone, after checking both show the same six digits.
- **Fix:** when one of your devices is offline, Fix checks each step between the two, says where it stops in plain words, and connects again.
- **Language packs:** each language is a file of its own in `src/i18n`, named in its own words in Settings › Appearance, and the app is written in English and the packs catch up. `node scripts/i18n.js todo` and `add` update a pack or start a new language (CONTRIBUTING.md › Translations).

### Fixes

- **"Failed to connect" until you removed the device and restarted.** A link between your computers that went quiet (a Mac that slept, a network that changed) looked open for ever; it now starts over by itself. A device that moved to a new relay is followed there. One whose key changed (set up again) says so and links again with a new code, instead of failing over and over. Pasting an old link for a linked device no longer stops the link, and one that forgot this device offers Link again.
- **Removing a computer from the paired phones left it half linked.** Your computers are listed under Your devices, where unlinking tells both; the paired list has your phones.
- **"Error: in prepare, no such column" in the Inbox.** Mail keeps its index differently on different versions of macOS, and the inbox asked for a column one Mac's Mail doesn't have. It now asks each Mac's Mail what it has, and reads the rest without it.
- **Stuck on "Already working on it".** A Cloudflare sign-in that failed or timed out while updating the relay left it busy until Bridge AI restarted.
- **A phone or device showed "connected now" after the relay reconnected,** and a crash while saving the relay's settings could lose them (they're now saved whole or not at all).

## 3.1.0

Bridge AI speaks your language, and Phone & machines is now just Devices.

### What's new

- **Seven more languages:** Español, Français, Deutsch, Português (Brasil), 日本語, 简体中文 and हिन्दी. Pick one in Settings › Appearance › Language, or Match this computer. The main screens are translated: the sidebar, top bar and tabs, the Agents panel, Settings' sections, New agent, the message box, Chat and its cards, the chief of staff's tasks and threads, Meetings and the floating card, Today, Usage and accounts, setup and the error screen. Dates and times follow the language too. The rest stays in English for now. Agents and what they write aren't affected.
- **Devices:** Settings › Phone & machines is now Settings › Devices, and your phone and other computers are called devices everywhere, the sidebar included.

### Fixes

- **"The call call ended."** When Bridge AI couldn't tell which app a call was on, the prompt after it ended said "call" twice. It now says "The call ended."

## 3.0.12

When the window breaks, there's a way back, and a newer version is offered straight away.

### Fixes

- **"Bridge AI hit an error" left you stuck.** The message sat in a corner with Try again and Reload, and when those didn't help there was nowhere to go, not even to the update that might fix it. It's now in the middle of the window and says your agents keep running and nothing is lost. Just after the window opens (as an update restarts the app), it first tries again by itself, twice, which clears a crash that's over a moment later. If a newer version is out, it offers Update right away. And it offers Try again, Reload, Reset this window's layout (it forgets open tabs and panel sizes, which a new version can trip over; your look, settings, agents and meetings stay), and Copy details. When the same error comes back after a reload, it starts with Reset this window's layout. Each one is also written down in ~/.bridge-ai/logs/ui-errors.log, so it can be fixed.
- **From the menu too:** Bridge AI › Check for Updates…, and View › Reset This Window's Layout, for when the window can't show anything at all.

## 3.0.11

The floating recording card follows dark mode and moves more smoothly, it tells you when Bridge AI can't hear the call, accounts say more plainly which one is in use, how much is left and what to do, and Chat reads better on a phone.

### What's new

- **Both windows for every account:** the account menu and Usage show each account's 5-hour and weekly usage, not just the tighter one, and when its week resets.
- **Usage tab:** starts with each account's plan usage, the same list as the Usage card in Today.
- **Sign in where you see it:** an account that needs signing in has its Sign in button on its row in Usage, without opening it first.

### Fixes

- **The floating card stayed light in dark mode.** It took the look once, when it opened. It now follows a change in the main window while it's open. It also lost its thin dark edge (its shadow was cut off at the edge of its window), drags more smoothly, stays as it is while you move it, and settles against a screen edge when you let go near one.
- **No warning when Bridge AI couldn't hear the call.** macOS gives Bridge AI silence until you allow System Audio Recording, and one Mac gave a few steps off silence, which counted as sound, so the warning never showed and the call was missing from the transcript. A call now counts as heard only with real sound, and the floating card shows the warning too, with a button to the setting.
- **"New: Personal" in the top bar.** The account there is where new agents start, not the one the agent you're looking at is on (that's in its message box). It now says so.
- **"Sign-in expired" for an account an agent was working on.** Its saved sign-in had run out, but the agent's own still works, so only its usage can't be read. It now says it's in use.
- **Two accounts signed in as one.** Claude Code's /login inside an agent switches your usual login (Default), which can make it the same account as another one. Bridge AI now says so, and offers to sign Default in to the account it should be.
- **A mark under the usage bars sat at 0.** It shows where even use over the window would leave you, which is 0 at the end of a window. It's now only in a window's own row, mid-window, and says what it is.
- **Tables in Chat on a phone** squeezed a column down to one letter a line. Words now stay whole, and a table too wide for the screen scrolls sideways.
- **The "In the background" tray on a phone:** its summary ran under "Show 13 finished", and open, it took most of the screen. The summary is cut short, and the tray leaves most of the screen to the conversation.

## 3.0.10

Meetings in a room, with nobody on a call, are heard properly.

### Fixes

- **A meeting in a room came out as a few words or nothing.** Bridge AI opened the mic the way it does for a call, with the browser's echo and noise handling on. That handling keeps the one voice close to the mic and treats the rest as noise, and in a room the rest are the people around the table. With no Zoom, Teams or browser call on your computer, the mic is now opened for the room, and it switches to the call settings by itself when a call starts while it records (and back when it ends). For room meetings, the Large turbo speech model (Settings › Meetings) also does noticeably better than Small with voices far from the mic.

## 3.0.9

Sign in with Cloudflare works when Node.js came from Bridge AI, a meeting's transcript no longer fills up with "[END]", meetings get their own tab on the phone and keep recording after the screen locks, and Chat tells you when an agent hits its usage limit.

### What's new

- **Meetings on the phone:** Meetings is now its own tab in the phone app, next to Agents, with a red dot while it records. Before, it was a button inside Agents.
- **Recording on a phone carries on:** while it records, the phone's screen stays on. If the phone locks anyway, or another app takes the mic, the recording picks up again when you're back and says how long wasn't recorded. It also reminds you to keep Bridge AI in front, since a phone stops the mic of an app in the background.
- **Usage limits in Chat:** when an agent stops at its usage limit, Chat says which limit, when it resets, and whether the agent carries on by itself then (Claude Code does for its 5-hour limit, not for its weekly one). With another account that has room left, Continue now moves the conversation there and tells the agent to carry on from where it stopped.

### Fixes

- **Sign in with Cloudflare failed with "Unknown arguments: …/wrangler-dist/cli.js, login"** on some Macs, such as one where Bridge AI had installed Node.js while it was running. Cloudflare's sign-in tool ran on Bridge AI's own stand-in for Node.js instead of the real one. It now always runs on the real Node.js, and the stand-in always comes last for everything else Bridge AI runs, agents installed through npm included.
- **A meeting's transcript could fill up with "[END]".** When the speech engine wrote a note about sound instead of words, such as whisper's "[END]" or "(keyboard clicking)", Bridge AI kept it as a line and also passed it on as the last thing said, so whisper went on writing "[END]" for everything after. Those notes are now left out, also in meetings recorded before (Transcribe again gets you the words) and in dictation.

## 3.0.8

Signing in to Cloudflare works on a Mac whose npm download folder was left in a bad state, agents that come through npm install without an administrator, and you switch a conversation's account where you switch its model.

### What's new

- **The account in the message box:** the model button in the message box shows which account the conversation is on, and its menu moves the conversation to another account the same way it switches models. The account switcher in the agent's header is gone, and the usage chip's menu in the top bar now says what it's for: the account new agents start on.

### Fixes

- **Sign in with Cloudflare failed on some new Macs,** showing only where npm wrote its log. npm's shared download folder (~/.npm) can hold files your account can't change, left behind by an earlier `sudo npm`, and npm stopped before Cloudflare's sign-in could start. Bridge AI now gives it a download folder of its own, still uses your ~/.npmrc (a proxy, your company's registry), and when npm does fail, says why in plain words.
- **Installing Gemini CLI or Qwen Code could fail with "permission denied"** when Node.js came from nodejs.org's Mac installer or a Linux package, whose npm folder needs an administrator. They now install into your own ~/.local, which Bridge AI looks in, with Bridge AI's own download folder.

## 3.0.7

A brand-new computer gets set up more reliably, and on Windows Bridge AI can now install Node.js itself.

### What's new

- **Node.js on Windows, with one click:** as on a Mac or Linux, Bridge AI can now install Node.js for you on Windows: the official version from nodejs.org, checked against the checksums it publishes, just for Bridge AI. Signing in to Cloudflare for Phone & machines, and agents that come through npm such as Gemini CLI, no longer need you to install it yourself first, or to restart Bridge AI after.

### Fixes

- **Closing setup right away lost its guesses.** If you closed setup before it had finished looking at your computer, your name, location and default agent weren't saved. It now finishes that look first.
- **A command typed into a new terminal could go missing.** Installing an agent, signing in, a fix or a project's start command typed into a terminal 1.2 seconds after opening it, before a slow PC's PowerShell was ready, and on Windows an Enter sent together with the text was sometimes dropped. Bridge AI now waits for the terminal's prompt and presses Enter a moment after the text, also when you type into a terminal from the box under it.
- Bridge AI is now tested as a brand-new computer on macOS, Windows and Linux before every release.

## 3.0.5

Chat shows what Claude Code is running in the background again, now with its shells and monitors too, and the usage readout works on long sessions.

### What's new

- **In the background:** the tray above the message box now lists the shells Claude Code and its subagents leave running, next to the subagents themselves. Open a shell for its latest output, or a monitor for its latest news. Which ones are still running comes from Claude Code's own footer ("4 shells, 2 monitors"), so the tray and the terminal agree.

### Fixes

- **Subagents stopped showing in Chat on long sessions.** Newer Claude Code versions log every request they make, so a busy session's log can pass 500 MB, more than Bridge AI could read in one go. It now reads logs a piece at a time without holding anything up: all of it once, then only what's new.
- **The usage readout failed on the same long sessions**, and so did images you pasted into them. Both read logs the same way now.

## 3.0.4

Signing in to Cloudflare works again after a try that didn't finish, your phone and your other machines are set up in one place, and terminals open on every Windows PC.

### What's new

- **Phone & machines:** Settings › Phone & notifications and Settings › Machines are one tab now. Linking your machines needs the same relay your phone uses, so it's all in one place, in order: your relay (or Tailscale), your phone, your machines, then notifications. **Manage machines** in the machine menu opens it at your machines.

### Fixes

- **Sign in with Cloudflare kept failing** with a message that only said where a log was written. A sign-in that wasn't finished in the browser was left waiting in the background, holding the port Cloudflare's sign-in uses, so every later try failed. Bridge AI now stops it, with everything it started, and checks for one left from an earlier try. If the port is still taken (by a try from before this update, say), the sign-in uses another. When a sign-in does fail, you see why, in plain words.
- **On Windows, a terminal could fail to open** ("Couldn't start shell: File not found") when PowerShell's folder came last in PATH. Bridge AI now starts PowerShell by its full path.
- Bridge AI is now tested on macOS, Windows and Linux before every release, and in Safari's engine on the Mac.

## 3.0.3

Meetings in parts, with a heading for each part, and the names of who said what. A record button in the sidebar, Pause on the floating card, and folders, an archive and a right-click menu for your meetings.

### What's new

- **New section:** split a recording into parts as it goes, like laps on a stopwatch or the sections of a long presentation. The transcript, your notes and the summary get a heading for each part, and what came before the first is Section 1. It's beside Pause on the meeting, in the recording menu at the top and on the floating card. Click a section's name in the transcript to rename it; its heading in your notes changes with it.
- **Who said it:** the call is one sound for everyone on it, so the transcript used to say Them for all of them. **Who spoke**, on the transcript, has your notes model work out who said each line from the names people use, the words on the shared screen and who was invited. A line it can't place stays Them, and its guesses are in italics. Click a name, or Them, to set it yourself: anyone invited, or someone else. With one other person on the call, one click names all their lines. Meetings with people invited get this before their first summary (Settings › Meetings turns it off), so the summary can say who agreed to what.
- **People from your calendar:** a meeting recorded without its calendar event offers the event from around that time, with its people (and its name, if you haven't named the meeting).
- **Record now:** the record button beside Meetings in the sidebar starts a meeting straight away, named after the calendar event on now, if there is one. While one records, it offers to stop that one and record a new one.
- **Right-click a meeting** in the sidebar or on Meetings for what its own menu has: open it, save it, show the saved notes, send its action items to the chief, fix a word, transcribe it again and meeting memory.
- **Folders and the archive:** put meetings in folders from that menu, the meeting's menu or the bar under picked meetings. In the sidebar a folder sits under the days, closed until you open it; on Meetings, each folder is a filter beside All. **Archive** keeps a meeting but puts it away: it's under Archived, and search and questions about your meetings leave it out until you take it out again.

### Fixes

- **The floating card had no Pause once open.** Pause was only a small button on its bar; the open card's buttons now have Pause (or Resume) beside Stop.
- **Deleting a meeting didn't really warn you.** It now asks in the app, says what goes, and offers **Archive instead**.

## 3.0.2

Meeting notes hear the other side of a call again, even on headphones. Plus a terminal of your own on any of your machines, more terminal history, Node.js in one click, and Claude Code's new trust question answered from Chat.

### What's new

- **New terminal:** a plain terminal you type straight into, for the things you'd run yourself (`brew upgrade claude-code`, a dev server, a quick look around). It opens on whichever machine the window is showing, so another of your computers is a click away too. Find it as the terminal button at the top of the spaces, in ⌘K, or in a space's menu as **New terminal here**, which opens it in that space's folder. A tab with one shell, like the ones that install your agents, is now a terminal you type into as well.
- **Scroll back further in a terminal:** like Chat, reaching the top of an agent's Terminal reads further back, 5,000 lines at a time and up to 20,000, and keeps you on the line you were reading. A terminal you open shows what it printed before you opened it. The built-in runtime now keeps 10,000 lines per terminal.
- **Install Node.js:** signing in to Cloudflare with your browser needs Node.js, and so do a few agents. On a computer without it, **Install Node.js** now puts the official version from nodejs.org in Bridge AI's own folder, checked against the checksums nodejs.org publishes. No password, no Homebrew, and a Node.js of your own still comes first. The Cloudflare sign-in carries on by itself once it's there.

### Fixes

- **Meeting notes missed what the other side said.** The call's sound reaches Bridge AI about 10 ms at a time, and anything shorter than the 30 ms the transcript works in was dropped, so after the first few seconds none of it was written down. On speakers your mic picked the call up anyway, which hid it; on headphones only you were in the notes. Every piece counts now. The audio was always kept, so **Transcribe again** on a past meeting fills in the other side.
- **The recording menu at the top spilled out of its box:** Capture and its count broke over two lines, and the note and the links ran past the edge. Clicking the recording pill to open the meeting also left the menu open on top of the meeting's own Stop button; it closes now.
- **Bridge AI could stop when git quit early,** for example on a folder that had just gone, before Bridge AI finished handing it its input. That's now just git's answer.
- **Claude Code's trust question couldn't be answered from Chat.** Newer Claude Code asks "Is this a project you created or one you trust?" with **No, exit** first and no numbers, so the card only offered 1, 2, 3, Enter and Esc. It now shows both answers as buttons, and a notification's buttons can answer it too.
- **The chief of staff could quit on that same question.** Bridge AI trusts the chief's own folder for you, and pressing Enter now meant **No, exit**. It picks **Yes, I trust this folder** wherever it sits.

## 3.0.1

Bridge AI opens again after a restart on a new Mac, your chief of staff is a click away, and the demo starts simple.

### What's new

- **Chief of staff at the top of the sidebar,** beside New and Meetings, and in the narrow sidebar too: it opens your chief of staff, or starts one.
- **The demo starts as a new install:** the chief of staff and one agent at work, in the simple layout. **See everything** (or the Studio Mac, at the top left) switches to a machine with every agent, meeting and cloud agent going, and back.

### Fixes

- **On a new Mac, Bridge AI could stop opening after a restart,** for example the one it asks for once you allow access in System Settings: macOS said the app can't be opened, until you logged out. macOS was mistaking the app's terminal host, still running in the background, for the app itself. It runs as a background helper now, so the app always opens. If your Mac is stuck like that, run the install command again (it stops the old terminal host), or log out and back in.
- **The machines menu at the top left was see-through** in a colour theme, so the sidebar showed through it.
- **Continue on another account didn't show** when an agent's tab was narrow, for example with Today open beside it.

## 3.0.0

All your computers in one window, and meetings that notice your calls, keep what was on the shared screen and read the files and emails that go with them. Speech to text built into the Mac, a short setup the first time, a transcript you can fix as it goes, a floating card you can tuck into the menu bar, notes that get written even when no model answers and are saved where and how you like, and questions across all your meetings.

### What's new

- **Your other machines:** link your other computers running Bridge AI (Mac, Windows or Linux) and switch between them from the top left. Each one's Bridge AI opens in the same window, its agents, chats, terminals and files, as if you were at it, and the sidebar's **Machines** lists them with their agents and what needs you. In the desktop app, open one in a window of its own. Link with a one-time link (Settings › Machines › **Copy this machine's link**, then paste it on the other), or ask with its relay address and allow it there after checking both show the same six digits. They link both ways, a third machine is introduced to the others, and a phone paired with any of them reaches them all. Machines talk end-to-end encrypted through each other's relay, like a phone.
- **The Mac's own speech:** on macOS 26 or later, meetings are transcribed by Apple's own transcriber, with nothing to install and nothing leaving your Mac. It's picked by itself when whisper.cpp isn't set up, and Settings › Meetings has it as an engine of its own.
- **Meetings set up the first time:** Meetings opens on a short setup, each step a tick or one button. Speech to text: done on macOS 26 or later; on an older Mac it says why, and **Install whisper.cpp** (or **Install Homebrew** first) gets it, with the speech model fetched right after, or **Use a speech service**. Your mic, with **Allow the mic**. A model to write the notes. Your calendar, if you'd like notes named after your meetings. **Done** or **Later** puts it away.
- **Meetings say when they won't be transcribed:** until speech to text is set up, Meetings says so before you record and on the meeting while it records, with the one step that fixes it. The audio is kept, so **Transcribe again** fills in the transcript afterwards.
- **The floating card your way,** in Settings › Meetings: open it when you point at it (as before) or only when you click it; or put the meeting **in the menu bar** instead, with the time and, in its menu, Pause, Resume, Stop, Open the meeting and All meetings, and Take notes when a call starts. About to share your screen? Most sharing apps show windows like the card, so its **Move to the menu bar** button puts that meeting up there, out of the way, and **Show the card** brings it back.
- **Switch accounts mid-chat:** click the account in an agent's header and **Continue on** another of your accounts, like switching models.
- **Pick your AI the first time:** the first screen offers Claude Code, Codex, Gemini CLI, Copilot and Cursor, a key from Anthropic, OpenAI, Google Gemini, OpenRouter, xAI or Mistral (checked as you save it), or a model already running on your computer (Ollama, LM Studio).
- **Accounts lined up:** in Settings › Model providers each account's state, name and buttons sit in columns, and it fits a narrow window.
- **A tidier message box on a phone:** Attach, saved prompts and the keys row are under one **+**.
- **The download page picks your download:** Apple Silicon or Intel on a Mac, a .deb or an AppImage on Linux, with the other one a click away.

- **Calls noticed:** when Zoom, Teams, FaceTime, Slack, Webex, Discord or a call in your browser (Meet, Teams on the web) starts using your mic, Bridge AI asks "Zoom call started. Take notes?", naming the calendar event on now if there is one. When the call ends it asks whether to stop, and stops by itself two minutes later unless you say **Keep recording**. A recording you start during a call is tied to it too. This is in the desktop app on a Mac with macOS 14 or later, with nothing to allow: it only looks at which apps have the mic, never at what they hear. **Notice calls** and **Stop by itself** are in Settings › Meetings.
- **What was on the screen:** while a meeting records, **Watch a screen** and pick the window where someone is sharing slides. A picture is kept each time what's shown changes (the next slide, even in the same template, or another page), not for a speaker's video or a cursor, and **Capture** keeps one now. The pictures sit in the transcript at their time and with the summary under "From the screen", open full size, and take a note. The words on them are read on your Mac, so the summary and answers know what was shown and search finds it. In the desktop app on macOS 15 or later, macOS's own picker asks which window; before that, it watches the main screen, and macOS asks to allow Screen Recording the first time.
- **Files, links and emails that go with a meeting,** on its **Files** tab. Document links in the calendar invite (a deck on SharePoint, a Google Doc) come by themselves. **Attach** takes a link or a file's path, files picked in Finder or dropped on the meeting, and the emails about the meeting in Mail with their files, like the follow-up with the deck. Each one is linked where it is, not copied, and read when the notes are written or a question is asked: Word, PowerPoint, Excel, CSV, PDF, Markdown and text. A file that's moved says so. Click one to open it, or show it in Finder.
- **Notes where they happened:** **+** on any line of the transcript adds a note at that moment, and your notes with a time show in the transcript. Paste or drop a picture into your notes and it's kept there. Fold the transcript away to give your notes the room, or drag the line between them; it stays how you leave it.
- **A floating card** in the desktop app: a small window over your other apps, on every desktop and over a full-screen call. While a meeting records it's a slim bar with the time, the meeting and **Pause** (or **Resume**) right on it. Point at it and it opens: how loud you and the call are, who's talked how much, the last twelve minutes as bars, the last few things said, when the meeting ends, Stop, **Watch a screen** and **Capture**, a quick note, **Open the meeting** and **All meetings**. Pin it to keep it open, and drag it from anywhere on it. It stays in its corner as it opens and closes. When a call starts it offers Take notes. Settings › Meetings › The floating card: during calls and meetings (to start with), always (with what needs you between meetings), or off. Closing the main window while it records hides the window instead, so the recording goes on.
- **A meeting's tab has the same header as an agent's:** its name, when it was, who was in it and where its notes are saved, each changed right there. Click the time to fix the date or time, the people to change who was there, the saved path to show the notes in Finder (right-click copies it). **Summary**, **My notes**, **Transcript** and **Files** are tabs in the header, the transcript can sit beside the one you're on, and ⋯ has the rest.
- **More models when you want them:** Qwen Code, DeepSeek, Kimi and Z.ai's GLM, and their models on OpenRouter, Together, Hugging Face or Ollama, can be turned on in Settings › Model providers › **Show more models**.
- **The recording bar** in the top bar is squarer, and pointing at it opens Pause, Stop, Capture, a quick note, **Open the meeting** and **All meetings**.
- **The sidebar's collapse** is at the top left now, beside the mark, in the same place whether it's open or not.
- **Fix the transcript while the meeting runs:** point at a line and edit it, or select a word and **Fix a word** ("Ack me" should be "Acme"). It's fixed everywhere in that meeting: the transcript, your notes, the summary and the title. Tick **Remember it** and it goes in meeting memory, so it's fixed in every meeting and the speech engine listens for it from then on. An edited line says so, shows what was heard, and Undo puts it back. The recording's own transcript is kept as heard.
- **Meeting memory:** the names and terms across your meetings (your company, people, products), how each one gets misheard, and a note on each. The speech engine listens for them, transcripts show them fixed, and summaries and answers know who and what they are. Each summary adds the names it finds, marked "learned"; change or remove any of them. **Memory** on Meetings, or Settings › Meetings › Names and terms.
- **Your notes, even when no model answers:** keep jotting notes while it records, on the meeting or as a quick note from the recording bar or the floating card, stamped with the time in the meeting. Notes written in two places at once both stay. When the model writing the summary can't be reached, it tries again, then the other models you have, and if none answer, the meeting keeps its transcript and your notes and writes the summary by itself later (every 10 minutes, for an hour). It says which models it tried and when it tries next, with **Try now**. Asking about a meeting also tries again and then your other models, instead of answering "API Error: Connection dropped".
- **Regenerate the notes your way:** the bar over the notes has **Regenerate**, the language to write them in, the model and the template (any meeting, 1:1, standup, customer call, interview, brainstorm). **Save** and **To the chief** sit at the top of the meeting, and the summary, your notes and the transcript each have their own **Copy**.
- **Transcribe again:** from the meeting's audio, start to end, with another speech model on this computer or a service you have a key for, and the language spoken. It shows how far along it is, keeps the transcript it had beside the new one, and writes the summary again after. Pick several meetings on Meetings and **Transcribe again** does them all.
- **Ask about your meetings:** a box at the top of Meetings answers from all of them. "What did I agree to do this week?", "What's still open?", "Write my weekly update". It picks the meetings the question is about, by its words and by "today", "yesterday", "this week", "last week" or "this month", or just the ones you've ticked. The answer cites them as [1], [2]: click one to open that meeting. Copy takes the answer.
- **Search what was said:** search on Meetings looks through transcripts, summaries and your notes, not just titles, and shows the line it found, who said it and when.
- **Quick asks on a meeting:** Draft a follow-up email, What did I agree to do?, What's still open?, each answer with Copy.
- **Meetings in the sidebar:** click **Meetings** and its list opens under it, like a space's tabs: by day, newest first, with a red dot on the one recording. Click one to open it. ⌘-click (Ctrl-click on Windows and Linux) picks several and Shift-click a run of them, then save them, send their action items to the chief, summarize them again or delete them from the bar under the list. The chevron folds it away. The Meetings page has the same, with a box on each meeting and **Pick all**.
- **Notes saved where and how you like,** like the Granola and Meetily plugins for Obsidian. To start with, the way Granola's sync saves them: year, month and day folders (2026/10/26), and each meeting as two notes, the summary with your notes and the transcript, linked to each other, with front matter (the date, how long, the kind of meeting, who was invited). Settings › Meetings › Save: the two linked notes, one note with everything, or just one of them. For each, its folder, subfolders and file name, as patterns ({year}/{month}/{day}, {quarter}, {date}, {time}, {title}, {kind}), with an example of where the next one goes. Front matter on or off, what to call the two speakers, and whether a saved meeting is saved again when it changes. A note you've changed in your notes app isn't written over by itself; Save still writes it. Change where they go and it offers to move the notes already saved, leaving any you've changed where they are. Pictures go in an attachments folder beside the note, and the meeting's files, links and emails are listed as links.

### Fixes

- **Pictures from the screen showed as broken images,** and so did a PDF's preview and an agent's raw file: files in `~/.bridge-ai` weren't served, because the folder's name starts with a dot. Pictures already kept show again.
- **macOS asked again after every update** for the mic, Calendar, your Desktop and Documents folders and the call's sound. It remembers those by the app's signature, and the app was signed ad hoc, which changes with every build. The Mac app is now signed with Bridge AI's own certificate, the same one every time, so macOS sees an update as the same app. It asks once more after this update, then keeps your answers. Opening a download for the first time works as before (Open Anyway, or the install command).
- **Notifications on your phone** are sent by Bridge AI's own code now, instead of the web-push package (MPL-2.0). Phones already set up keep working.
- **"API Error: Connection dropped (ECONNRESET)" came back as the answer** when an agent's CLI (Claude Code, Codex) lost its connection while answering a question about a meeting or writing its summary. It's now an error, so it's tried again or another model answers.

## 2.9.0

Meeting notes, with speech to text on your computer or any service you like; Home, one message box to start anything; and setup in two steps that brings in your projects.

### What's new

- **Meeting notes:** **Meetings** in the sidebar (on a phone, on the Agents tab), then **Start recording**. Bridge AI records your mic and, in the desktop app on macOS 14.2 or later, the call's sound (Zoom, Meet, Teams, anything your Mac plays), so the transcript says who spoke: You or Them. The transcript comes in as people talk, a few seconds behind, and you can jot your own notes beside it. Recording keeps going while you use the rest of the app: the top bar shows how long, and Pause, Resume and Stop are on the meeting. The first time, macOS asks to allow System Audio Recording for the call's sound; until Bridge AI is signed by its developer it can ask again after an update. Without it, your mic still records the meeting.
- **A summary you can act on:** when a meeting ends, the model you pick writes a summary with decisions and action items, and your notes shape it. Pick what kind of meeting it was (1:1, standup, customer call, interview, brainstorm) and **Again** writes it for that. **Ask about this meeting** answers from the transcript. **To the chief** puts the action items on the chief of staff's task list; it takes the ones that are yours and drafts follow-ups for the ones that are other people's, without sending anything. **Save** writes it as Markdown (the summary, your notes and the transcript) in a folder you pick, ~/Documents/Meeting notes to start with, ready for Obsidian or any notes app, and Settings can save every meeting there by itself. A calendar event starting in the next ten minutes shows **Take notes**, which names the meeting after it and spells its people's names right.
- **Long meetings:** the audio is transcribed in short pieces as you go and silence is skipped, so an hour-long meeting is ready a few seconds after you stop. A long transcript is summarized in parts, then as a whole. Each meeting keeps its audio as Opus (about 11 MB an hour for each side), and one that was still recording when the app closed keeps everything transcribed up to then.
- **Speech to text your way,** in Settings › Meetings. **On this computer** uses whisper.cpp on the graphics chip: free, and the audio never leaves your Mac. Pick its model there (Large turbo is the best; Small and Base are lighter, and Small, English is the one voice notes use), each one download from Hugging Face, and **Install it** gets whisper.cpp with Homebrew. Or use a service you have a key for, with its price per hour beside it: OpenAI, Groq (from $0.04), Mistral Voxtral, Together AI, Deepgram, ElevenLabs Scribe, AssemblyAI, Google Gemini, or any service with OpenAI-style speech to text, online or on your computer (Speaches, LocalAI). Names and terms you add there help it spell them right.
- **Light on your computer:** the speech engine starts with your first meeting, uses two to four cores, and stops after ten idle minutes. Nothing runs between meetings, and the app sends your mic's audio to it in one-second pieces.
- **Home:** **New** in the sidebar opens one message box, "What should we build in shop?", where the project's name is the picker. Small chips on the box pick the agent or any model, how much it may do without asking, and, in a git project, this folder or its own branch. Enter starts it and opens it; **or start without a project** makes it a chat. Cloud agents, comparing two agents, an account and the space it goes in are under **More options**, the full New agent dialog. With nothing open, Home is what you see.
- **How much an agent may do:** **Ask first** (as before), **Edit freely** (changes files without asking, asks before commands) or **Full access** (changes files and runs commands without asking), for Claude Code, Codex, Gemini CLI and Any model on your files.
- **Setup in two steps:** **Your AI** (what's on this computer, with Install and Sign in right there, and which one runs the chief of staff), then **Your projects**: the folders your Claude Code and Codex conversations were in, with the likely ones ticked (a git repo with a few conversations in the last 30 days), brought in with one click. Nothing is copied or moved. Close it at any step and it keeps sensible defaults (your name, the weather and your phone are in Settings). It ends on Home, in your first project, and the tour waits until you ask for it (Take the tour, in search). Already set up? Home starts with the projects setup would have ticked.

### Fixes

- **The chief of staff's first-run screens** (its look, trusting its own folder) were answered only while its chat was on screen. They're answered wherever you are, so a chief started during setup is ready when you open it.
- **Allow access for Calendar did nothing in the desktop app:** Bridge AI never said why it wanted your calendars, so macOS turned it down without asking and left it out of the Calendars list, where it can't be added by hand. It now asks properly: Allow access shows macOS's own question, and opens System Settings only if you'd said no before. The questions about your Desktop and Documents folders now say why, too.

## 2.8.1

An account whose sign-in expired renews by itself, and Sign in again is right there when it can't.

### Fixes

- **An account whose sign-in had expired showed "No Data"** in Usage, with "Couldn't read its usage (Claude access token expired)" and nothing to do about it. Claude Code renews an account's sign-in when it runs on it, so an extra account you hadn't used in a while stayed expired. Bridge AI now renews it by itself when no agent is on that account, with no browser (it runs `claude doctor` for that account, which renews it). When that can't be done, the account says **sign-in expired** and offers **Sign in again**, in Usage and in the account menu at the top (the top chip says "sign in" for it too). Sign in again tries the same quick renewal first, then opens your browser; the sign-in tab closes once the account's usage can be read again, and Usage updates without a reload.

## 2.8.0

Any model, with nothing to install, that can also work on your files; Insights and Usage across every agent and account; a simpler start and a simple layout for people new to coding agents; Chat and sign-in for Gemini, Copilot, Cursor and more; threads with the chief of staff; an easier Agents view on a phone; accounts named as you like; and fixes.

### What's new

- **Chat with any model, nothing to install:** New chat, then **Any model**. It talks to whatever you have: a plan you're signed in to through an agent (Claude, ChatGPT, Gemini and others), an API key (OpenAI, Anthropic, Google, OpenRouter, xAI, Mistral, DeepSeek, Groq, Perplexity, Meta, Moonshot, Together, Fireworks, Cerebras, Cohere, Z.ai, Hugging Face), your cloud (Azure OpenAI, AWS Bedrock, Google Vertex AI), or a model on your computer (Ollama, LM Studio). Switch models mid-chat from the model button in the message box. It works from your phone like any agent, in the built-in runtime and in herdr, and closed chats open again from Closed agents with the whole conversation.
- **Any model works on your files too:** New agent, pick a folder, then **Any model**. It reads and searches the project, changes files and runs commands, and asks before each change or command, as a card in Chat (yes, yes for the rest of this chat, or no). Chat shows what it changed, and so does Changes. Models through an API key, a cloud or your computer can do this; a plan you're signed in to works on files through its own agent (Claude Code, Codex).
- **Chat for Gemini CLI, Qwen Code, GitHub Copilot CLI and Cursor Agent:** their conversations, read from their own logs, with the files they changed, instead of only a terminal. They also open again from Closed agents with their history.
- **Sign in from Bridge AI** to Gemini CLI (with your Google account), GitHub Copilot, Cursor, OpenCode, Amp, Goose and Crush: **Sign in** in Settings › Agents or during setup runs the agent's own login in a terminal tab that closes once you're signed in.
- **Usage across every account and agent:** Today › Usage opens on **All**, Claude Code and Codex together, and **By account** shows how much each account used in the last 30 days (Work, Personal), one you haven't used yet included. Every account was always in the totals; now it says so.
- **Insights across every agent and account:** the Insights card now covers the last 30 days of all your agents, not just Claude Code: sessions, hours, the time agents waited on you, and the split by agent, by account and by project. The numbers cost nothing. **Write insights** has the agent or API key you pick read them and write up what's working, what's in your way and what to try next. Agents without logs Bridge AI can read (Gemini CLI, Copilot and the rest) are counted from Bridge AI's own record of them.
- **A simpler start:** the first screen shows only what Bridge AI found (your AI and the chief of staff) and **Start**; your name, the weather and your phone are under **More details**. New installs get the **simple layout**: the Today panel waits behind one button, the Agents board appears once you have agents, the chief of staff shows just Chat and Terminal, and the tour is four steps. Settings › General › Layout switches to **Everything**. Claude Code's first-run screens with one sensible answer (its look, the offer to change your terminal, the notes after signing in, trusting Bridge AI's own folders) are answered for you.
- **An easier start:** setup now asks which AI you pay for (Claude, ChatGPT, Google Gemini, GitHub Copilot) instead of showing install commands. **Install** shows the installer's progress and moves on by itself when it's done; one that needs Node.js first says so, with a link, instead of a button that can't work. With only an API key or a local model, **Use that instead** takes you to adding the key, then to a chat.
- **New agent is simpler:** where it goes in the sidebar is one line you can change, **Choose…** picks the folder in Finder (desktop app), and Start stays in view. With no agent installed it offers to install one, and a chat can still be with any model.
- **Start a chat or agent from your phone:** **New** on the phone's Agents tab.

- **Threads with the chief of staff:** keep separate topics from running together in one long chat. **New thread** in the bar at the top of the chief's chat starts another conversation with it, named for its topic (Q4 launch, hiring); the first one is Main. Threads run at the same time and share the chief's playbook, ledger and task list. Each thread lists the agents it handed work to, with their status, so you can see which work came from which conversation; click one to open it. On a computer a thread opens in the chief's tab, and in the sidebar each one is a tab of the Chief of staff space. **Close thread** sends its conversation to Closed agents, and its agents keep running.
- **The Agents view on a phone** shows every state at a glance: All, Needs you, Working, Done and Idle in one row with their counts, nothing to scroll. Tap one to see just those agents. All lists the agents grouped by state, the ones that need you first.
- **Accounts named as you like:** add as many Claude or Codex accounts as you want (Work main, Work backup, Personal), and rename your usual login too, in Settings › Model providers (it no longer has to be called Default).

### Fixes

- **Codex in Usage showed $0 and no models**, because ccusage reports Codex days differently from Claude Code's. Its cost and its models now show, and **All** adds them to Claude Code's.
- **A question card showed only its choices**, not what it was asking, for Claude Code's permission prompts too. The card now starts with the question ("Do you want to make this edit to cart.js?").
- **The tour skipped the chief of staff** when it was already running, which is how setup leaves it. It now points at the chief's chat.
- **Copilot showed as signed out** after signing in with a newer Copilot CLI, which changed how it saves the login, and **Cursor's sign-in couldn't be checked** from the app, which looked for it where a Dock-launched app can't see it. Both are read the way the current versions write them, from where they're installed.
- **A key the provider turned down showed as Connected** in Settings › Model providers. Keys are checked when you save them, and a refused one says so ("Key turned down") until you fix it. A chat picks up a fixed key from its next message.
- **The sign-in terminal tab stayed open** in a Setup space after you'd signed in. It closes once you're signed in, and so does an install's tab once it's done. One that failed stays, so you can read why.
- **A plain chat asked to trust its folder without saying what it was asking.** Its folder is Bridge AI's own, so it gets the same one-click card as the chief of staff, and a project folder's trust question now says what it means.
- **The tour opened on top of the chief of staff's setup card.** It waits until that's done.
- Plain chats no longer show Files, Changes and Preview tabs or a folder path, and the chief of staff's header names its agent ("Claude Code", not "claude") without the data folder's path.
- Settings › General keeps the terminal app and where agents run under **Advanced**, and a few other places lost words like "pane", "CLI" and "quota-axi".
- **A new account's usage said "couldn't read"** after you signed in, because it was read while the sign-in was still going on. It's read again once the sign-in finishes. When macOS needs your permission before Bridge AI can read an account's usage, the account menu now says so and offers **Show its usage** right there.
- **Refresh on the Claude Code insights card said "No such routine"** unless you had made a routine for it. Insights is now written by any agent or key you have (see above), and Claude Code's own /insights report is linked when you've run one.

## 2.7.2

A fix for the Agents filters on a phone.

### Fixes

- **On a phone, the Agents list showed only the All filter** (and Needs you, when something needed you), so there was no way to see just the working, done or idle agents. On a narrow screen the filters now sit on a row of their own under the title, with every state that has agents: All, Needs you, Working, Done and Idle. The row scrolls sideways when they don't fit. The phone app picks this up after Bridge AI on your computer updates and the app reloads.

## 2.7.1

A fix for the herdr session menu with a colour theme.

### Fixes

- **The herdr session menu in the sidebar was see-through with a colour theme** (Sky, Midnight and the others in Settings › Appearance), so the spaces under it showed through and it was hard to read. It's solid now, like the sidebar's other menus.

## 2.7.0

Agents that keep running when Bridge AI restarts, handing work from one agent to another, herdr sessions in the sidebar, and Codex's questions as cards you can answer.

### What's new

- **Agents keep running when Bridge AI quits, restarts or updates,** without herdr. The built-in runtime now keeps its terminals in a small background process, and Bridge AI picks them up again with their screens and scrollback when it's back, so Restart to apply and updates no longer cut an agent off mid-task. Turn off **Keep agents running when Bridge AI quits** in Settings › General to stop them with the app instead; **Quit and Stop Agents** stops them either way. After a reboot, Claude Code and Codex reopen their conversations as before. On Windows an update still stops them, and they resume after it.
- **Hand off to another agent:** the model chip's menu lists the other agents you're signed in to. Pick one and it starts in the same folder and branch with a summary of the conversation so far: the goal, files changed, recent messages and the open to-do list. You can preview it, or ask the current agent to write it first. The old agent goes to Closed agents, or stays open next to the new one. The chief of staff can switch itself to another agent the same way and keeps its playbook, ledger and tasks.
- **herdr sessions in the sidebar:** with herdr, the top of the sidebar shows which session you're in and how many agents wait on you in the others. Switch in one click, start a new session or a stopped one, stop one (not while its agents are busy), or open it in your terminal. Each session keeps its own tabs, queued messages and muted agents.
- **Codex's questions as cards:** Codex can ask you something and keep working (its "? 1 question, ⇧← to answer" line). Bridge AI now shows that agent as needing you, says what it asks in the notification, and puts the question in Chat with its answers to click and a box for your own. With several questions, answer them all and send once. The card stays after Codex's turn ends, when Codex's own screen drops the question. The Terminal tab shows the question too, with a button to answer it.

### Fixes

- **A message to Codex could merge with keys left in its input box**, such as a "1" typed in the Terminal tab for a menu, and arrive as "1your message". Bridge AI now clears what's left there first, without stopping a turn that's running.
- **Codex's name** showed its whole terminal title, such as "[ ! ] Action Required | Fix the login page | shop". It's now just "Fix the login page".
- **Codex's live status** under the chat read "Working (4s" with the bracket left open.
- **Picking a herdr session in Settings** took effect only after a restart. It now applies at once.
- **A Codex agent restarted on another model** showed its old model again after Bridge AI restarted, until its next reply.
- **Claude Code's model menu** listed each model twice, by name and by full id. It now lists Opus, Sonnet, Haiku and Fable once, so the menu fits on screen with the hand-off list under it. A pinned version is still under Other….

## 2.6.0

Two accounts side by side, a model picker in the message box, and a chief of staff that does work itself.

### What's new

- **A work and a personal account, side by side:** **Add another account** is in the usage menu in the top bar, in New agent and in `⌘K`, even when you have only one. One dialog takes you through it: pick Claude Code or Codex, name it, sign in right there, then start an agent on it. Each agent shows the account it's on in its header, the sidebar and the board, and keeps it when you fork it, reopen it or restart it on another model.
- **Switch models from the message box:** a chip next to the mic shows the model the agent is on. Pick another one, Default, or type any name. Claude Code and Aider switch in place (Claude Code also keeps it as your default for new sessions, as `/model` does in its terminal), and Codex restarts on it with the same conversation. The chief of staff can switch an agent's model too (`bridge model`).
- **The chief of staff does work itself:** questions, research, drafts, plans and comparisons it now does on its own, in its own folder, while project work still goes to an agent. It keeps its own task list, shown in a Tasks panel above its message box: add a task there to send it over, mark one done or reopen it, and open what it produced. The morning brief mentions its open tasks. Your playbook and ledger stay as they were.

### Fixes

- **With herdr,** Bridge AI now remembers which account each agent was started on, also after it restarts. On either runtime, forks and agents reopened from Closed agents start on their own account instead of the active one.
- **Agent headers** with the Today panel open squeezed the agent's name to a letter or two. The view buttons show as icons at that width, so the name fits.

## 2.5.0

A much smoother first run: one-click fixes wherever a new Mac needs something, agents that install without Node, Claude Code and Codex set up from the chat, and cloud agents straight from your phone.

### What's new

- **Allow access, in one click:** when Mail needs Full Disk Access, **Allow access** opens the right page of System Settings and puts a Bridge AI tile at the bottom of the screen to drag into the list. Bridge AI notices when it's on, and **Restart to apply** waits in the top bar, like Update, until you're ready. The same goes for Calendars, your Desktop and Documents folders, the microphone and notifications.
- **Agents set themselves up:** a Claude Code or Codex that has never run used to sit at its own first-run questions where Chat couldn't show them. Its chat now walks you through them (theme, sign-in, trusting the folder) with one button each, then carries on. First-run setup also checks the agent is signed in before starting the chief of staff.
- **Install without Node:** Install buttons use each agent's own installer where it has one (Claude Code, Codex, Copilot), so a new Mac doesn't need Node or npm first. Gemini CLI uses Homebrew when npm isn't there.
- **A button wherever something's missing:** Homebrew, icalBuddy, Mail not set up yet, signing in to an agent, the GitHub CLI, Apple's developer tools for git, herdr, an agent that isn't installed, and a city for the weather. Each fixes itself once it's done.
- **Cloud agents on your phone, with no computer:** the iPhone and Android apps run Cursor, Copilot, Jules and Claude agents on their own, with your keys kept in the phone's Keychain or Keystore, never shown to the page. Android checks on them in the background and notifies you.
- **The demo** shows cloud agents too, and `?clean=1` hides its Demo strip for recording.
- **Your phone, free, from the walkthrough:** its phone step says how to put Bridge AI on your phone with a free Cloudflare account (or Tailscale), and **Set up phone** takes you there.
- **A website to share:** [sahil1.github.io/bridge](https://sahil1.github.io/bridge/) has the right download for your computer, the install commands, and the demo running in your browser.

### Fixes

- **Android app keyboard:** on Android 15 and later the keyboard covered the message box, dialogs and the fields you type in. The app now makes room for it, a long question card scrolls instead of pushing the message box away, and the start screen scrolls when it needs to.
- **Turning a phone sideways,** or widening a narrow window into the full layout, crashed the page with "hit an error". Fixed.
- **New agent with herdr:** starting an agent in a new space could fail with "agent_pane_busy … is not an available shell", because the new tab's shell was still starting. Bridge AI now waits for its prompt, and herdr's errors read as sentences instead of raw JSON.
- **Calendar on a new Mac:** icalBuddy wasn't found when the app couldn't see Homebrew's folder, and denied Calendar access showed an empty calendar with no reason.
- **git without Apple's developer tools:** checking a repo's branch every 15 seconds popped macOS's install dialog over and over.
- **The greeting** no longer includes tags from your Mac account name, like "[Apple]".
- **"You're set"** now shows after Finish setup.
- **The privacy check** skips itself on Windows too.

## 2.4.0

Several accounts with a quick switcher, agents in the cloud, a phone that keeps working while your computer sleeps, Bridge AI on an always-on machine, a demo, a walkthrough for your first run, and one-click fixes for what macOS asks you to allow.

### What's new

- **Several accounts:** add a work and a personal Claude or Codex account, then switch from the usage chip in the top bar or in New agent. **Auto** starts each new agent on the account with the most left. Usage shows each account and the total, and **Continue on** (in an agent's ⋯ menu) picks up the same conversation on another account when one runs low. Each extra Claude account needs one Allow in the macOS Keychain before its numbers show.
- **Cloud agents:** start and follow agents that run in Cursor's, GitHub Copilot's, Jules' or Claude's cloud, on a repo on GitHub (Cursor also takes GitLab, Bitbucket and Azure DevOps), with your own key in Settings › Model providers › Cloud agents. They show up in a Cloud space next to your other agents, and notify you when they finish or need you. Claude cloud agents use an API key and are billed per use, not by your Pro or Max plan.
- **Your phone, while your computer sleeps:** the phone keeps what it last saw and opens it when your computer is offline. Messages and answers you send wait in your relay, sealed so it can't read them, and go out when the computer is back.
- **Try the demo:** the phone apps open a demo with made-up agents before you pair anything, and `npm run demo:build` makes the same demo as a web page you can host anywhere.
- **Run it on an always-on machine:** a Docker image, plus `bridge-ai relay setup`, `bridge-ai pair` and `bridge-ai status` for a machine with no screen, so your agents keep working with your laptop closed. See "Run it on an always-on machine" in the README.
- **A walkthrough** the first time you open Bridge AI, on the computer and on the phone. Take it again from Settings or ⌘K.
- **Voice notes set themselves up:** the first tap on the mic offers to download the speech model and install what's missing. Your audio still never leaves your computer.
- **Allow what macOS asks for in one click:** when Inbox needs Full Disk Access, its card opens the right page of System Settings, shows Bridge AI in Finder so you can drag it into the list, and restarts Bridge AI so it takes effect. The Calendar card installs icalBuddy for you.
- **Android app ready for Google Play:** it targets Android 16, the lock-screen card shows by default, and pairings are left out of backups.

### Changed

- **Plan usage is off until you turn it on:** reading how much of a plan is left means asking each provider with the sign-in your agents use, and some providers, Anthropic among them, don't allow other apps to use their sign-ins. Turn it on in the Usage card or Settings › General if you're comfortable with that. Cost and token stats don't need it.
- **No more Google Fonts:** the fonts ship inside the app, so opening Bridge AI no longer contacts Google.
- **Terms of use:** [TERMS.md](TERMS.md) says plainly what the license means (as is, no warranty), that you're in charge of your agents and your accounts with other services, and that Bridge AI isn't affiliated with any of them. The privacy policy ([PRIVACY.md](PRIVACY.md)) now covers everything above.

### Fixes

- **Mic on the phone:** it listened, then nothing happened, because the speech model was missing and the error was hidden. It now says what's needed and offers to set it up.
- **Send now** no longer wraps onto two lines on a phone.
- **Chat for new Claude Code users:** with no `~/.claude/projects` folder yet, Chat showed an error instead of an empty conversation.
- **Choosing a Cloudflare account** while setting up the relay could never finish. Fixed.
- **Codex sign-in on Linux with no desktop** now shows a code to enter on another device.

## 2.3.0

Review and ship from Changes, undo one reply, an optional branch of its own for each agent, notifications that take you to the answer, and no more freezes while macOS asks for access to your folders.

### What's new

- **Review and ship:** in Changes, click lines of a diff to comment, then send all your comments to the agent as one message. Commit & push, and open a GitHub pull request (with `gh`) with a title and description drafted from your commits, then follow its checks there. Nothing is ever force-pushed, and no tool credits are added.
- **What each reply changed:** "Changed 3 files" under a reply opens that reply's own diff, file by file. With Claude Code, **Undo this reply** puts the files and the chat back to just before your message, without sending anything.
- **Own branch (optional):** start an agent on a new branch in its own git worktree, so agents in the same repo can't overwrite each other's files. Files listed in `.worktreeinclude` (like `.env`) are copied in, and your setup command (like `npm install`) runs first. Closing the agent removes the folder only if nothing would be lost; the branch stays. The chief of staff can do it too (`bridge new --own-branch`).
- **Notifications that take you to the answer:** "needs you" says what the agent is asking, and tapping it opens the agent with the question ready. Your phone stays quiet while you're at the computer (Settings › Phone & notifications can change that), and any agent can be muted from its ⋯ menu. On Android and in Chrome on a computer, simple yes or no questions get answer buttons that work without opening the app; a button only answers if the agent is still asking the same thing.

### Fixes

- **No more freezes while macOS asks for access:** the first time Bridge AI reads your Desktop or Documents folder, macOS asks for permission and holds the read until you answer. Bridge AI waited with everything stopped, so the app and your phone got nothing until someone clicked Allow (after an update, say, or with the screen locked). Now only the request that needed the folder waits, and with the built-in runtime Bridge AI starts right away and your agents come back once macOS lets it see their folders.
- **Resume and fork with herdr:** resuming a closed agent or forking one failed with herdr. Fixed.
- **Changes:** switching agents no longer flashes the previous agent's file, and committing no longer leaves the old diff on screen.
- Question cards no longer pick up a numbered list from the chat above the agent's menu.

## 2.2.4

Update from your phone.

### Fixes

- **Update on a phone:** tapping Update did nothing, because its window opened off the edge of the screen. On a phone it now drops down under the top bar, full width, and Update now works from there.

## 2.2.3

A tidier Update window.

### Fixes

- **Update window:** with a theme on, the window under the Update button was see-through, so the page showed through it. It also listed the install commands from the release notes as if they were changes. It's now solid in every theme and shows just what's new, each change with its name in bold.

## 2.2.2

Your agents show up again when Bridge AI opens at login.

### Fixes

- **Opened at login, no agents:** when Bridge AI started with your Mac while it was still busy (right after a macOS update, say), it couldn't find herdr or your agent tools until you restarted it. The board showed 0 agents, starting an agent said it wasn't installed, and the Herdr view said "detached". It now looks in the usual folders (`~/.local/bin`, Homebrew) straight away and checks your shell's settings again a minute later.

### Install

- **macOS and Linux:** `curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh`
- **Windows (PowerShell):** `irm https://raw.githubusercontent.com/sahil1/bridge/main/install.ps1 | iex`

On 2.0 or later? Settings › About & updates updates it in one click.

## 2.2.1

Your phone from anywhere, apps for iPhone and Android, all of a long conversation in Chat, agents in their own windows, and updates in one click.

### What's new

- **Your phone, from anywhere, through your own relay:** in Settings › Phone & notifications, sign in with Cloudflare and Bridge AI puts a small relay on your own free Cloudflare account. Pair a phone with a QR code and it reaches this computer from anywhere: no VPN, nothing to keep connected, no port opened. Everything between phone and computer is end-to-end encrypted, so the relay can't read it. Remove a phone any time. Tailscale still works as before, and neither is needed to use Bridge AI on the computer.
- **Keep the computer awake:** an option to stop it sleeping while it's plugged in (macOS and Linux), so your phone can always reach it.
- **Apps for iPhone and Android (early, build them yourself):** the same Bridge AI through your relay, in an app that scans the pairing code itself. One app can be paired with several computers; switch between them in Settings or from the "offline" screen. They aren't in the App Store or Google Play yet: `mobile/README.md` says how to build them with Xcode or Android Studio.
- **Your agents on the lock screen (in the apps):** while agents work, the iPhone app shows them on the lock screen and in the Dynamic Island, and the Android app in a notification: which are working, which need you and which finished. An agent that starts waiting on you gets its own alert, and tapping opens it. On iPhone it updates while the app is open; once the phone is locked it says how old it is.

- **Earlier messages in Chat:** "Show earlier messages" at the top of Chat goes back through the whole conversation, across every /compact, a page at a time (a long agent's log can be hundreds of MB, so it's never read all at once). "Earlier conversation summarized" opens to show Claude's summary.
- **An agent in its own window:** the ⧉ button in an agent's header opens it in a window of its own, to put on another screen. Its tab in Bridge AI says so, with Show window and Bring back here; Bring back in the window does the same.
- **Update from the top bar:** when a new version is out, the Update button shows what's new and updates in one click (Bridge AI closes, installs it and reopens; your agents carry on).

### Fixes

- After an update or a reinstall, the app could keep talking to the background server of the version before, so some changes didn't show until the server was restarted. The app now checks which build the running server is and replaces one left over from another build. A server you run yourself from source is left alone.
- **Terminal tab:** after switching the same panel to another agent, keys you pressed in the Terminal tab went to the agent it showed first, so a picker like /model looked stuck. They now go to the agent on screen.
- **Terminal tab:** what you type in the message box no longer lands in a picker or menu open over the agent's input line (the "s" in /fast picked "this session only" in the /model picker). It catches up once the input line is back.
- **Terminal tab:** the empty rows Claude Code leaves between its output and its input box are shortened, so the view no longer looks blank after a command.
- **Relay setup:** a new Cloudflare account without a workers.dev address is now set up in one go (Cloudflare refused the relay before the address existed), and Pair a phone turns on by itself once the relay connects.
- **Relay security:** the relay's address is public, so connections that don't prove they're a paired phone within 15 seconds are dropped, and strangers can't fill the relay and lock your phone out. Its public status says only that it's up. New relays get a random name instead of your computer's.
- **On a phone:** after picking "Needs you" in Agents, the other filters disappeared, leaving no way back to all agents. All now stays next to it, and tapping the chosen filter again shows every agent.
- A conversation with no messages yet (a new chief of staff session, say) showed a blank screen. It now says so.
- **Phone page:** Bridge AI no longer leaves a doubled gap under the iPhone notch, and keeps clear of the Home indicator and Android's gesture bar.

### Install

- **macOS and Linux:** `curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh`
- **Windows (PowerShell):** `irm https://raw.githubusercontent.com/sahil1/bridge/main/install.ps1 | iex`

On 2.0 or later? Settings › About & updates updates it in one click.

## 2.2.0

See your app running, keep talking while agents work, and edit what you sent.

### What's new

- **Preview tab:** next to Files and Changes, it shows the web servers running from the agent's folder (port, program, page title) and the app itself, with an address bar, reload, open in your browser and stop. Nothing running? It offers the project's own way to start one (`./start.sh`, `npm run dev`, `make dev` and others), in a terminal tab you can watch, and shows the app as soon as it answers. An `index.html` that needs its dev server now says so in the file viewer.
- **Type while the agent works:** with Claude Code and Codex, Enter sends straight to the agent, the way typing in its terminal does (it picks it up after its current step). ⌘/Ctrl+Enter still interrupts and sends now.
- **/btw side questions:** ask Claude something while it keeps working; the answer appears in a card above the message box.
- **Edit a sent message (Claude Code and Codex):** hover your message and choose Edit. It goes into the message box; send it and the agent goes back to just before it and answers your edit instead. Your files stay as they are unless you also choose to undo the agent's file changes since then (Claude Code).
- **Send what you see to the agent:** in the Preview tab, Send to agent attaches a picture of the app to a message, with its address.
- **History (⌘/Ctrl+Shift+F):** search every Claude Code and Codex conversation on this computer, and open or resume the one you find. Agents you close are kept there too, to resume later with their full history.
- **Fork:** copy an agent's conversation into a new tab next to it, to try another way while the original stays as it is.
- **Undo and commit in the Changes tab:** undo one change or a whole file, and commit all changes or just the file you're looking at.
- **Compare two agents:** in New agent, send the same first message to a second kind of agent and see both side by side.
- **Saved prompts:** the star in the message box keeps messages you send often. {{Blanks}} like {{week}} are selected for you to fill in; Tab goes to the next.
- **Terminal tab:** the cursor sits where you type (the agent's input line), and what you type in the message box shows up there as you type. The agent's screen now fits the pane's width (no cut-off lines or sideways scrolling), scrollbars match the terminal, and a short screen no longer leaves the view scrolled down to empty space.
- **Images stay in your messages:** pictures you attached or pasted show as thumbnails after sending; click one to see it full size. In the message box, attached images are bigger, numbered (Image 1, Image 2) so you can refer to one, and open full size with a click.
- **Word, PowerPoint and Excel in Files:** spreadsheets and CSV files show as a table with a tab per sheet. Documents and decks show laid out page by page when LibreOffice is installed (Bridge AI uses it in the background); without it, you see the text in them. "Open in app" opens one in Word, Excel or PowerPoint.
- **File menu in Files:** right-click a file or folder (or use ⋯ in the viewer) for Reveal in Finder, Open in its app, Mention to the agent, Copy path, Copy relative path, Duplicate, Rename, Move to Trash, and New file or folder. The + at the top of the tree adds a file or folder there.

### Fixes

- Claude Code showed as idle while working on the built-in runtime with newer Claude Code versions.
- Chat no longer shows messages that were rewound away (also when you rewind in the terminal).
- The file viewer no longer opens every file in Edit after you edited one.
- Chat's live activity line works again with newer Claude Code versions, and Chat follows Codex after you rewind it in its terminal.

### Install

- **macOS and Linux:** `curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh`
- **Windows (PowerShell):** `irm https://raw.githubusercontent.com/sahil1/bridge/main/install.ps1 | iex`

On 2.0 or later? Settings › About & updates updates it in one click.

## 2.1.0

Edit files in place, more than one account per agent, and spaces you can arrange.

### What's new

- **Spaces you can arrange:** make a new space from the sidebar (the layers button), and drag an agent or terminal tab from one space to another, onto a tab to place it there, or onto **Drop here for a new space**. Each tab's menu also has **Move to space…**. Terminals keep running while they move, in the built-in runtime and in herdr.
- **Pick the herdr session:** with more than one herdr session running, Settings › General chooses which one Bridge AI shows and drives.
- **Edit files in the Files tab:** Markdown, HTML and other text files now have an Edit mode, with a live preview next to the text for Markdown and HTML. ⌘/Ctrl+S saves. If an agent changed the file while you were editing, Bridge AI asks before overwriting it.
- **HTML preview:** HTML files open as the page itself, with its styles, scripts and images, in a sandbox that can't reach Bridge AI.
- **Several accounts per agent:** add a work and a personal Claude account, or two ChatGPT logins for Codex, in Settings › Model providers › Accounts. Sign in opens the agent's own login flow in a terminal tab. Pick which account new agents use there, or per agent in New agent. Settings, skills and session history are shared between accounts.
- **Privacy check:** `npm run check:private` keeps personal data (keys, logins, transcripts, your name and paths) out of the repo. It runs before every commit and push from a source clone (`npm install` turns the hooks on), before releases and app builds, and in CI.

### Install

- **macOS and Linux:** `curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh`
- **Windows (PowerShell):** `irm https://raw.githubusercontent.com/sahil1/bridge/main/install.ps1 | iex`

On 2.0? Settings › About & updates updates it in one click.

## 2.0.0

Bridge AI on your phone, with notifications.

### What's new

- **On your phone, no app store:** Settings › Phone & notifications turns on phone access through Tailscale (free, private to your own devices) and shows a QR code. Add Bridge AI to your Home Screen and it opens like an app.
- **Notifications** on your phone or in your browser when an agent needs you, when it finishes, and when a usage quota runs low (you pick the threshold). They're end-to-end encrypted to your device. Tapping one opens that agent.
- **Send now:** while an agent is working, Enter still queues your message; **Send now** (or ⌘/Ctrl+Enter) interrupts the agent and sends it straight away.
- **Updates:** Bridge AI tells you when a new version is out (a chip in the top bar) and the desktop app updates itself in one click. Settings › About & updates.
- **Reporting problems:** Settings › About & updates › Copy details gives the version and system details for a bug report, and nothing personal.
- **Works offline gracefully:** if your phone can't reach your computer, it says so instead of a blank page.
- **Faster everywhere:** finding installed agents no longer starts a process per agent (much faster on Windows), and the GitHub sign-in check only runs when Copilot is installed.

### Install

- **macOS and Linux:** `curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh`
- **Windows (PowerShell):** `irm https://raw.githubusercontent.com/sahil1/bridge/main/install.ps1 | iex`

Already on 1.24? Run the install command again. From 2.0 on, Bridge AI updates itself from Settings › About & updates.

## 1.24.0

Bridge AI for Windows and Linux.

### Install

- **macOS and Linux:** `curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh`
- **Windows (PowerShell):** `irm https://raw.githubusercontent.com/sahil1/bridge/main/install.ps1 | iex`

Or download the file for your system below:

| System | File |
|---|---|
| macOS, Apple Silicon | `Bridge-AI-mac-arm64.dmg` |
| macOS, Intel | `Bridge-AI-mac-x64.dmg` |
| Windows | `Bridge-AI-win-x64.exe` |
| Linux, Debian and Ubuntu | `Bridge-AI-linux-amd64.deb` |
| Linux, other | `Bridge-AI-linux-x86_64.AppImage` |

The apps aren't signed yet, so macOS and Windows ask before the first open of a downloaded file (macOS: System Settings › Privacy & Security › **Open Anyway**; Windows: **More info › Run anyway**). The install commands skip that.

### What's new

- **Windows and Linux apps**, with one-line installers. Windows installs for your user with no admin rights; Linux installs the .deb on Debian and Ubuntu, or the AppImage elsewhere.
- Every platform is built and tested automatically before a release is published.

## 1.23.1

Faster to install and faster to use.

### Install

Paste this in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh
```

It downloads the right app for your Mac, puts it in Applications and opens it, in a few seconds, with no security prompt. Run it again any time to update.

Or download a file below: `Bridge-AI-mac-arm64.dmg` for Apple Silicon (M1 and later), `Bridge-AI-mac-x64.dmg` for Intel. The app isn't signed by Apple yet, so the first open asks for confirmation: click Done, then System Settings › Privacy & Security › **Open Anyway**.

### What's new

- **One-line install** for Mac, with no "can't check this app" step.
- **Opens faster:** the first screen loads less than half as much code. Terminals, the file viewer, Settings and other views load in the background once the app is idle, so they still open instantly. A repeat launch draws in about a second.
- **Snappier while you use it:** views share data instead of each fetching it, and a view you reopen shows its last state right away.
- **Smaller app:** 227 MB instead of 270 MB, and a smaller, faster-opening .dmg.
- **Onboarding:** change your name, location and chief of staff right on the welcome screen; consistent buttons; the "You're set" tips stay until you close them.

## 1.23.0

The first public release: one place to run your AI coding agents and talk to them, with a chief of staff that sends each request to the right one.

- **Chief of staff:** one agent you talk to that routes work to the right agent, starts new ones when needed, learns your preferences, and can consult other models for a second opinion (`bridge ask`).
- **Every agent in one window:** chat view, live activity, subagents, slash commands, questions you can answer inline, and the full terminal when you want it.
- **Onboarding** that detects your agents and sign-ins and sets everything up in one click.
- **Settings:** default agent and model, 22 model providers, MCP servers for all your agents from one list, themes and appearance, and the config file itself.
- **Usage:** quotas and token stats per provider.
- **Terminal access:** `bridge-ai attach` or "Open in terminal" in your own terminal app.
- **Runs agents itself**; herdr is supported but optional.
- **Private by default:** everything stays on your computer in `~/.bridge-ai`, the server only listens on 127.0.0.1, and there is no telemetry.
