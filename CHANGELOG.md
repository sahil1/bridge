# Changelog

Each version's section here becomes its GitHub release notes (`npm run release`).

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
