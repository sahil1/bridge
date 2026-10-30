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

- **Wrapping:** a whole sentence is one string, with values as placeholders: `t('{n} agents need you', { n })`, never pieces glued together. Singular and plural are two strings picked in code. A label kept in a list at the top of a file is marked `tx('…')` and shown with `t(label)`. Text sent to an agent or saved to a file stays English.
- **Updating a pack:** `node scripts/i18n.js todo es es-todo.json` writes what Spanish is missing, with the file each string shows in. Translate it (add `"to"` to each, or make a `{ "English": "Spanish" }` file), then `node scripts/i18n.js add es es-todo.json` puts it in, refusing anything with the wrong `{placeholders}`.
- **A new language:** the same two commands with its code (`ko`, `it`, `zh-TW`). The pack's file is all it takes: Settings › Appearance lists it, named in its own words, and Match this computer picks it.
- **Keeping them tidy:** `node scripts/i18n.js check` shows how far each pack has got and fails on a broken placeholder. `node scripts/i18n.js prune` takes out strings the app no longer uses.

## Before you open a pull request

- `npm run build` passes, and `npm test` (the tests for what you changed; `test/README.md` says what each covers). CI runs every test on macOS, Windows and Linux.
- No personal data: names, email addresses, company names, home folder paths or tokens. Settings belong in `~/.bridge-ai`, not in the repo.
- `npm run check:private` passes. It looks for keys, tokens, home folder paths, email addresses, session transcripts and Bridge AI data files, plus your own name, places and hostnames from your `~/.bridge-ai` settings and the names in your meeting memory. `npm install` turns on git hooks that run it before every commit (the staged files) and every push (each commit being pushed, so something added and then deleted is still caught). Releases, app builds and CI run it too. `--no-verify` skips a hook; the push check still catches what that commit let through.
- Commit messages say what changed, in your words. The hooks refuse a message with a link to an AI coding session or a line crediting an AI (`Claude-Session:`, `Co-Authored-By: Claude`, "Generated with Claude Code"): public history can't be taken back.
- Keep comments short and about why. Match the style of the file you're in.
- The server never makes a blocking call (`readdirSync`, `statSync`, `execFileSync` in a folder...) on your folders. macOS holds the first read of Desktop or Documents until you answer its permission prompt, and a blocking call would freeze the whole server meanwhile. To check, run the server with `SIM_PROTECTED=<a folder> node --import ./scripts/tcc-sim.mjs server/index.js`, open an agent in that folder, and fire the requests you changed with `node scripts/freeze-check.mjs http://127.0.0.1:7420 "GET /api/..."`. It must print OK.
