# Tests

```sh
npm test                      # the tests for what you changed since the last commit
npm test -- --all             # every test
npm test -- meetings-ui       # one, by name
npm test -- --browser both    # the app's tests in Chromium and in WebKit (Safari, the iPhone app)
```

Each test starts a Bridge AI server of its own, on a free port, with an empty data folder and home
under `test/.out/kits`. Only stand-ins and the system's own folders are on its PATH, so no real
agent, model, account or calendar is ever reached: models and speech to text are
`stand-ins/model.mjs`. No installer ever runs for real either: whatever a test installs (an agent,
Homebrew, whisper.cpp), `stand-ins/installer.cjs` runs instead, and the Node.js download points
nowhere unless a test gives it a stand-in nodejs.org. Three run at once (`--lanes N`). The app is built first when its source is
newer than the build. A test that fails is run once more on its own; if it passes then, it's
reported as flaky, not failed. Logs and screenshots are in `test/.out`.

GitHub Actions runs every test on macOS, Windows and Linux on each push to main and each pull
request (`.github/workflows/test.yml`), and a release is only built once they pass.

| Test | What it checks |
| --- | --- |
| `server` | The server starts on an empty folder, setup and settings stick, a model provider's models are offered, a terminal runs a command |
| `relay-signin` | Signing in to Cloudflare with the browser, with a stand-in for its tool: the error shown is the tool's own, a sign-in left waiting is stopped with everything it started, a port taken by something else doesn't stop it; npx gets Bridge AI's own npm cache and your ~/.npmrc, and npm's own failures (a cache it can't write, no network) are said in plain words. Inside the app (the server on the app itself as Node, when Electron is installed in `desktop/` or `BRIDGE_TEST_ELECTRON` names it): the tool runs on a real Node.js, not the app's own `node` stand-in |
| `meetings-api` | A recording transcribed by a speech service (an engine's notes about sound, like "[END]", left out and not passed on to the next stretch), a call only a few steps off silence said to be silent (on a Mac, with a stand-in for the call's sound), sections, who said what, the summary's prompt, saved Markdown, folders, the archive, search and questions across meetings. The calendar part is Mac-only |
| `meetings-ui` | Record now, New section (the recording bar, the top bar's menu, the floating card), the mic set for the room with no call on the computer and for a call while one is on, the floating card following dark mode while open (no border, a shadow that fits) and warning when the call has no sound, Pause on the card, the right-click menu, folders, the archive, deleting after a warning, naming who said a line, in a light and a dark theme. Recording needs Chromium's fake mic, so WebKit skips that part |
| `app-ui` | The app loads in a light and a dark theme and at phone width, with no page errors or sideways scrolling; the sidebar, ⌘K and Settings; a New terminal runs what you type. When the whole window breaks (a crash made on cue): a brief one just after opening gone by itself, one that stays tried twice and then the way back in the middle, a newer version offered straight away, the crash written down, Reset this window's layout first when it comes back after a reload, and the app back after it, on a desktop and a phone |
| `chat-background` | Chat's tray of what a Claude Code agent runs in the background, with a stand-in Claude Code: its subagents, the shells it and its subagents left running with their output, its monitors' news, which are still running by the terminal's footer, the footer's subagents when its logs have none, and a log too big to read in one go; on a phone, the tray's head on one line and a third of the screen at most, and a reply's wide table keeping its words whole |
| `chat-account` | Two Claude Code accounts and a stand-in Claude Code: the message box's chip says which account a conversation is on and continues it on the other (not while it's working), no second switcher in the agent's header, the top bar's menu is for new agents. At a usage limit, Chat says when it resets and whether it carries on by itself, and Continue now moves it to the other account and tells it to carry on |
| `no-prompts` | A first start on a Mac asks macOS for nothing, with a Claude Code project in Documents and Documents acting like a protected folder (`scripts/tcc-sim.mjs`): setup's look for projects answers at once and lists it without looking in, picking it and a restart don't look either, and work starting there lets Bridge AI look from then on |
| `agents-found` | An agent installed while Bridge AI is still looking for agents is found when it looks again, with a folder on PATH that takes seconds to answer (`scripts/tcc-sim.mjs`). Not on Windows (the stand-in takes POSIX paths). |
| `resume-work` | Unfinished work after a restart, with a stand-in Claude Code: Bridge AI stops with its agents' terminals and starts again; the agent that was working reopens its conversation and is told to carry on (once, saying why it stopped), the one that had finished just reopens, and with Pick up unfinished work off a working one reopens and waits |
| `accounts-ui` | Four Claude Code accounts with made-up readings laid over the server's own list (your usual login switched to the same sign-in as Personal, one whose saved sign-in ran out while an agent works on it): one plain list with "Your usual login" until it's named, the top bar says its account is where new agents start, its menu gives both windows and when the week resets, puts the star on the default and says the one in use is in use; Usage has the same list with Sign in on the row and the pace mark only where it means something, and the Usage tab has the list too. Then: Make default moves the star and a new agent starts there; Auto shows its pick with no star; the same-account offer takes your usual login off every list in one click and new agents don't fall back to it; Settings shows it again; Sign out runs the stand-in Claude Code's own logout for that account's folder (asking first for your usual login); Remove signs an added account out and deletes its folder; the last account stays |
| `new-install` | A brand-new computer, on a desktop and a phone: setup with nothing installed, installing an agent (its card moving on to signing in), installing Node.js with one click, on Windows too (and a download that doesn't match its checksum turned away), then an agent through npm (Bridge AI's own cache, and ~/.local when npm's global folder needs an administrator), closing setup, Home with nothing to talk to, New agent, a chat with any model once a key is in, a key the provider turns down |
| `phone-meetings` | Meetings on a phone: its own tab, recording from it with the screen kept on and a red dot on the tab, the recording carrying on after the phone was locked (saying how long wasn't recorded) and after the mic was taken, then its transcript. Recording needs Chromium's fake mic, so WebKit checks the tab only |
| `i18n-ui` | Each language's file (`src/i18n/`) is valid, keeps every string's {placeholders} and covers what's marked for translation; then in each of the seven languages the page says which it is, the sidebar, Settings' sections and Appearance are in its words, nothing is wider than the window (German and Hindi on a phone too), Match this computer follows the browser's language, and picking one in Settings › Appearance switches to it, in another open window too |
| `devices` | Two Bridge AIs, each on its own relay (`stand-ins/relay.mjs`: the real relay, run on this computer), link with the address and code typed in and link back by themselves. Then each of what used to need a restart puts itself right: a link that goes quiet, one that drops, an old link pasted for a linked device, a device that moves to a new relay, one whose key changed (a new code links it again), one that forgot this device (Link again asks, with the same six digits on both). Fix says where a connection stops |
| `devices-ui` | Settings › Devices with two Bridge AIs on their own relays: Pair a device shows a QR code, the address and the code (on a phone too); the phone app, paired with both, offers to link them, asks, and opens the other to allow it with the same six digits; computers are listed under Your devices, not among phones; Fix with a device closed says it isn't there, and that it's back once it opens |
| `mail` | The inbox from Apple Mail's own index (made up, in the server's home folder) on two Macs that keep it differently, every column or an older macOS's: both list and rank the inbox and open a message, with no "no such column". Off a Mac, the inbox says it's Mac only |
| `demo-ui` | The demo build (`npm run demo:build`) with no server: Home, meetings, search, the archive, and what needs a computer saying so |
| `herdr` | The herdr runtime. A herdr older than 0.9.0 (a stand-in): agents run in Bridge AI itself and the app says why. Then the real herdr, when there is one (`BRIDGE_TEST_HERDR` names it, else `herdr` on your PATH; CI downloads a release on Linux), in a home of its own: a session started from Bridge AI, a stand-in Claude Code started with a short opening prompt on its command line and a long one sent once it's up, its screen read and typed into, a start herdr refuses leaving no tab behind, a space with a herdr worktree open not closed from under it, an out-of-date herdr integration named with the command that updates it, and closing. Skipped on Windows |
| `saves` | Saving a file whole or not at all (settings, accounts, devices and the rest): it keeps its permissions, a save that fails or is stopped dead leaves the last one readable, and a rename another program holds up is tried again, then written in place |

A change to a file a test covers (listed in `run.mjs`) runs that test. A change to `test/lib`,
`test/stand-ins`, `run.mjs` or `package.json` runs them all.

## Not covered here

These need a Mac and the real thing, so they're checked by hand before a release: recording the
call's sound (`native/calltap`), speech to text on the Mac and whisper.cpp, reading the screen's
pictures (Vision), the desktop app's own windows (the floating card's window, the menu bar), the
herdr runtime with real agents and a real terminal attached, and real agents signing in.
