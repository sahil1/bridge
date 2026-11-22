# Contributing to Bridge AI

Thanks for helping. Bug reports, agent definitions and fixes for Linux and Windows are especially welcome.

## Run it from source

```bash
npm install
npm start -- dev      # open http://127.0.0.1:7421
npm run desktop:dev   # or work in the desktop app, also with hot reload
```

Edits under `src/` show up in place in about a second, without losing what's on screen. Edits under `server/` restart the API by itself (a few seconds); with the built-in runtime that restarts the agents too, and Claude Code and Codex resume their sessions. `npm run stop` stops both. The port is `port + 1` from your config.

Point it at a throwaway data folder while you work, so your own spaces, playbook and settings stay out of it:

```bash
BRIDGE_HOME=/tmp/bridge-dev BRIDGE_RUNTIME=builtin npm start -- dev
```

## Layout

| Path | What it is |
|---|---|
| `server/index.js` | The HTTP API and live fleet feed |
| `server/runtime/` | Where agents run: `builtin.js` (Bridge AI's own terminals) and `herdr.js`. Both export the same functions; `index.js` picks one |
| `server/agents.js` | Every agent CLI Bridge AI knows |
| `server/transcripts.js` | Turns Claude Code and Codex transcripts into chat messages |
| `server/paths.js` | The data folder and config loading |
| `chief/` | Template for the chief of staff (copied into the data folder on start) |
| `src/` | The React UI |
| `desktop/` | The Electron app |

## Add an agent

Add an entry to `AGENTS` in `server/agents.js`:

```js
{ kind: 'mycli', label: 'My CLI', bin: ['mycli'], start: ({ prompt }) => (prompt ? [prompt] : []), promptArg: true, busy: /esc to interrupt/i, caps: {} },
```

- `bin`: the program names to look for on PATH.
- `start`: arguments for a new session. Set `promptArg: true` if it accepts the first message on the command line; otherwise Bridge AI types it in once the agent settles.
- `resume` (optional): arguments to reopen a session by id after a restart.
- `busy`: text on its screen while it's working (most show "esc to interrupt"). If it shows nothing like that, set `busyFromOutput: true` instead.
- `herdr` (optional): herdr's name for it, when herdr can start it natively.

Start it from the **+** button, give it a task, and check the sidebar shows working, then finished, and that a question or permission prompt shows as waiting on you.

To give it a chat view, teach `server/transcripts.js` where its transcripts live and how to parse them, then set `caps.chat: true`.

## Add a runtime

A runtime exports the functions `server/runtime/builtin.js` does (`fleet`, `read`, `input`, `prompt`, `launch`, rename, close, move and so on) and returns the same shapes. tmux and zellij would be good additions. Register it in `server/runtime/index.js`.

## Translations

Write the app in English and wrap what people see in `t()` from `src/i18n/index.js`; that's all a change needs. Each language is a pack in `src/i18n/` (`es.json`, `ja.json`…) that maps the English to its own words. A string a pack doesn't have yet shows in English, so packs never hold up a change and catch up whenever you update them.

- **Wrapping:** a whole sentence is one string, with values as placeholders: `t('{n} agents need you', { n })`, never pieces glued together. A link or a button inside a sentence is a placeholder too, filled by `tn()`: `tn('{install} to get started.', { install: <button>…</button> })`. Singular and plural are two strings picked in code. A label kept in a list at the top of a file is marked `tx('…')` and shown with `t(label)`. Text sent to an agent or saved to a file stays English.
- **Updating a pack:** `node scripts/i18n.js todo es es-todo.json` writes what Spanish is missing, with the file each string shows in. Translate it (add `"to"` to each, or make a `{ "English": "Spanish" }` file), then `node scripts/i18n.js add es es-todo.json` puts it in, refusing anything with the wrong `{placeholders}`.
- **A new language:** the same two commands with its code (`ko`, `it`, `zh-TW`). The pack's file is all it takes: Settings › Appearance lists it, named in its own words, and Match this computer picks it.
- **Keeping them tidy:** `node scripts/i18n.js check` shows how far each pack has got and fails on a broken placeholder. `node scripts/i18n.js prune` takes out strings the app no longer uses.
- **When:** the packs are brought up to date before each feature release (3.13.0), with its full run. Changes, nightlies and patch releases go in English, and a new string shows in English in every language until then.

## Running your own

The servers Bridge AI talks to are optional and in this repo, so a fork or a company can run its
own on its own Cloudflare account:

- **Usage stats and crash reports**: deploy [counts/](counts/README.md#running-your-own), then set
  `"stats": { "url": "https://counts.<your domain>" }` in `config.example.json` (your build's
  default), in `~/.bridge-ai/config.json` (one computer), or as `BRIDGE_STATS_URL`. `"url": ""` sends
  nothing. People still see what would be sent and turn it off in one click.
- **The relay**: anyone can put one on their own Cloudflare account from Settings › Devices (Account &
  Devices once there are accounts). One
  for many computers is [relay/HOSTED.md](relay/HOSTED.md), switched on by `HOSTED_URL` in
  `server/hosted.js`, for accounts of your own.
- **Accounts** (for Early Access and the hosted relay): [account/](account/README.md), switched on by
  `ACCOUNTS_URL` and `ACCOUNTS_PUBLIC_KEY` in `server/account.js`. Empty, nothing about accounts shows
  (Settings › Devices has no Account tab, and keeps that name).
- **The privacy policy**: `npm test -- privacy-hosts` fails when the code contacts a host PRIVACY.md
  doesn't cover, so a new one goes in PRIVACY.md (by name, or under a category it states) in the
  same change.

## Releases, betas and rollouts

For the project's owner, or a fork's: what `npm run release` puts out, and who is offered it.

- **The cadence.** Changes go to main through the day. The owner's own are merged once the tests
  for what they change pass on the computer they're made on (`npm test -- --browser both`, Chromium
  and WebKit). The pull request's run on GitHub goes on in the background, and what it finds is
  fixed in the next change. A pull request from anyone else is merged once its run on GitHub
  passes. A merge to main runs no tests of its own. Every test runs on main each night, and your
  own computers get each night's main (Nightly, below), tested for what changed since the night
  before. A release runs every test again while it's built, and is published only once they pass.
  Windows, and Linux's tests in no browser, run in the full run each night, where a failure is
  said but doesn't stop anything. A fix that can't wait is a patch release at any time.
- **Shipping from your computer, a step at a time** (`npm run ship`, `scripts/ship.js`; git and the
  GitHub CLI signed in). `npm run ship` says where things stand: this branch, main's version, the
  newest nightly, beta and release, the runs going, and this computer's version and channel.
  `npm run ship -- nightly` puts this branch onto main (a pull request, merged at once) and starts a
  nightly from main now; it's tested for what changed since the last nightly, and computers on
  Nightly are offered it within half an hour and install it while you're away, with no wait.
  `npm run ship -- beta` makes main the next beta (main's own when it names one not out yet, else
  the next; `--patch` for a patch's), with its notes from the commits since the last beta or release
  unless its CHANGELOG section is written, and releases it to Early Access, tested since the last
  nightly. `npm run ship -- stable` releases the version main names (a beta's version, or main's
  own) to everyone, once its CHANGELOG section is written, after every test. `npm run ship --
  promote 3.20.0 50` widens it (0 pauses). `npm run ship -- join` puts this computer on Nightly
  (`--install` first installs the newest nightly where the version here is too old for them). Each
  takes `--dry-run`, and `--wait` to follow its run to the end.

- **A release for everyone.** Set the version in `package.json` and `desktop/package.json` (3.13.0),
  write its `## 3.13.0` section in CHANGELOG.md, merge to main, then `npm run release`. Everyone on
  Stable is offered it at once. `npm run release -- --dry-run` says who it goes to.
- **A few computers at a time.** Put `<!-- rollout: 10 -->` on a line of its own in that CHANGELOG
  section (GitHub doesn't show it). The release starts at 10%: each computer has a bucket from 0 to
  99, picked at random once and kept in its settings, and those under 10 are offered it. Early
  Access, and anyone who clicks Check now, get it anyway. Watch that version's crashes and day
  reports (channel `stable`, bucket under 10), then `npm run rollout -- 3.13.0 50`, then `100`
  (everyone; the line goes). `npm run rollout -- 3.13.0` says where it's at. A computer sees a
  change at its next check, within 6 hours.
- **Pausing.** `npm run rollout -- 3.13.0 0`: nobody else is offered it, Early Access included, not
  even by Check now, and it isn't installed by itself. Computers that have it keep it; put it right
  with a 3.13.1, or raise the percentage again to carry on.
- **Without a terminal.** Two workflows do the same on GitHub, from main only, with GitHub's own
  token. Actions › Release start › Run workflow (`release-start.yml`) runs `scripts/release.js`'s
  checks and pushes the tag, then starts the Release workflow and the Docker image at it (a tag
  pushed with GitHub's token starts nothing by itself; started at the tag, each does what the tag's
  push would). Actions › Rollout › Run workflow (`rollout.yml`), with the version and the
  percentage, runs `scripts/rollout.js`. Each refuses what the script refuses, and the run says why.
  The project's admin view (boldbridge.ai/admin, in the private repo) has Release, Promote (10, 50,
  100), Pause and Nightly now buttons that only start these and `nightly.yml`: its token is a
  fine-grained one for this repo only, with Actions: Read and write, Contents: Read and Metadata:
  Read, so it can't write to the repo itself. Release from there sends the version it showed, and
  release-start.yml refuses it if main has moved on to another.
- **A beta, for Early Access.** Set the version to a pre-release, `3.13.0-beta.1` in both
  package.json files, give it a `## 3.13.0-beta.1` section in CHANGELOG.md (a few lines is enough),
  and `npm run release`. GitHub marks it a pre-release, so it's never the latest release: not the
  website's download, not the installers' default, not Docker's `latest` or `3.13` (only
  `ghcr.io/sahil1/bridge:3.13.0-beta.1`), and the phone apps' store builds are made by hand as
  always. Only computers on Early Access are offered it, and they install it by themselves while
  you're away as they would any release. The next ones are `-beta.2`, `-rc.1`.
- **Promoting a beta.** Set the version to `3.13.0`, with its full CHANGELOG section (and a rollout
  line if you like), and release it as above. A release is newer than its betas, so testers on
  3.13.0-beta.2 are offered 3.13.0 too.
- **Who gets betas and nightlies.** Anyone who picks them, with no code: Settings › About & Updates ›
  Update Channel has Stable (the default), Early Access (betas, before everyone else) and Nightly
  (below). It's picked on the computer itself, or there with `bridge-ai channel early` (`stable`,
  `nightly`); a phone or another computer's window shows it read-only, and the server refuses a
  change from them. It's for the desktop app (and Linux's package); a copy run from a clone or in
  Docker says why not. A link to `http://127.0.0.1:7420/?early` opens About & Updates at the
  picker. The usage stats and crash reports say the channel (PRIVACY.md).
- **Testers with a Bold Bridge account.** Once accounts are live (account/README.md), a tester can
  still ask for Early Access in Settings › Account & Devices (or the website's form). You say yes in
  the admin view, and their computers go on Early Access by themselves with a code from the
  account, renewed while they have it; their usage stats and crash reports carry the account's id,
  never an email. Saying no, or suspending the account, takes them back to Stable within 6 hours,
  unless Early Access was picked on the computer itself. Early Access picked with no code names no
  one. Codes made by hand are gone: no build had the key to take one.
- **Leaving.** Bridge AI never goes back to an older version: a computer that leaves Early Access or
  Nightly stays on the beta or nightly it has until a regular release is newer.
- **Nightly builds.** `.github/workflows/nightly.yml` builds main each night it has changed (about
  3 AM in California; Actions › Nightly › Run workflow builds one now) through the release
  workflow: the tests for what changed since the last nightly on all three systems, then the app
  signed and notarized as a release is, at a version like `3.20.1-nightly.20261116.57`
  (`scripts/nightly.js`: what main is heading for, the day and the run), set in that build only, so
  main gets no commit. It's a GitHub pre-release, never the latest, with what changed since the last
  nightly as its notes, made from the titles of the pull requests merged since then (a pull request
  putting several together, on a `nightly-next-…` branch or titled `Next nightly …`, lists the merged
  ones in its body, a line each starting `- #252 Bots that change files: …` or `- #246: …`, and those lines are used
  instead of its title; any other body is never read for them), or from the commits when there are none or GitHub
  can't be reached: a line for each part of Bridge AI, named by the words before a title's or
  subject's first colon (`Bots: a run at its time limit asks…`) or the name in capitals it starts
  with (`Remote Screen starts every time…`), and nothing from pull requests or commits that only
  touch the tests, CI or the docs, or say so (`Tests:`, `CI:`, `Docs:`). The update card in the top
  bar shows the first four. `node scripts/nightly.js notes <version> notes.md --at <tag>` shows the
  notes for a nightly that's out. No Android app, no Docker image, and only the newest 7 are kept. A computer
  takes it once Nightly is picked in About & Updates, or on the computer with `bridge-ai nightly on`
  (`npm run ship -- join` does that for you), or without the command, `curl -X POST -H
  "Authorization: Bearer $(cat ~/.bridge-ai/api-token)" -H 'content-type: application/json' -d '{}'
  http://127.0.0.1:7420/api/updates/nightly`. It's refused through the relay. That computer then
  takes the newest of everything, nightlies, betas and releases, at once and by itself while you're
  away; Stable and Early Access are never offered a nightly. `bridge-ai nightly off` goes back to
  the channel under it, and Stable or Early Access in About & Updates to that one; either keeps the
  version you have until a regular release passes it. Its usage stats and crash reports say
  Nightly.

## Before you open a pull request

- `npm run build` passes, and `npm test` (the tests for what you changed; `test/README.md` says what each covers). CI runs the tests for what the pull request changes on macOS and Linux; every test runs each night and before a release.
- No personal data: names, email addresses, company names, home folder paths or tokens. Settings belong in `~/.bridge-ai`, not in the repo.
- `npm run check:private` passes. It looks for keys, tokens, home folder paths, email addresses, session transcripts and Bridge AI data files, plus your own name, places and hostnames from your `~/.bridge-ai` settings and the names in your Memory. `npm install` turns on git hooks that run it before every commit (the staged files) and every push (each commit being pushed, so something added and then deleted is still caught). Releases, app builds and CI run it too. `--no-verify` skips a hook; the push check still catches what that commit let through.
- Commit messages say what changed, in your words. The hooks refuse a message with a link to an AI coding session or a line crediting an AI (`Claude-Session:`, `Co-Authored-By: Claude`, "Generated with Claude Code"): public history can't be taken back.
- Keep comments short and about why. Match the style of the file you're in.
- The server never makes a blocking call (`readdirSync`, `statSync`, `execFileSync` in a folder...) on your folders. macOS holds the first read of Desktop or Documents until you answer its permission prompt, and a blocking call would freeze the whole server meanwhile. To check, run the server with `SIM_PROTECTED=<a folder> node --import ./scripts/tcc-sim.mjs server/index.js`, open an agent in that folder, and fire the requests you changed with `node scripts/freeze-check.mjs http://127.0.0.1:7420 "GET /api/..."`. It must print OK.
