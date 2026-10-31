# Privacy

Bridge AI is an open-source app (https://github.com/sahil1/bridge) made of three parts: the app on
your computer, a relay on your own Cloudflare account, and the phone apps for iPhone and Android.
None of them sends anything to the project or its author. There is no server run by the project,
no account, no analytics, no ads and no crash reporting.

Last updated: October 2026.

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
meetings), and a check on GitHub for a newer version, which you can turn off in
Settings › About & Updates. Its fonts and icons are part of the app, so nothing is fetched to draw
it.

How much of your plan is left is off until you turn it on (the Usage card, or Settings › General).
Then Bridge AI asks each agent's own provider, with the sign-in that agent uses on your computer,
through quota-axi. If you add an API key for a model provider (Settings › Model Providers),
Bridge AI uses it to check the key and, when you or the chief of staff ask, to put a question to
that model. Both go straight from your computer to that provider.

Dictation and voice notes are turned into text on your computer, and the recording isn't kept. The
dictation key from other apps (Settings › Voice) is heard for that one key only: on a Mac it's
registered with macOS, which tells Bridge AI when it's pressed and let go; on Windows and Linux a
keyboard hook runs only while the key is held, and until Ctrl, Alt, Shift and the Windows key are
let go too (a few seconds at most), to hear them let go, and ignores every other key.
Nothing is pasted into other apps unless you pick "Where I'm typing" there. Then, after you let go
of the key, the text is put on the clipboard for a moment (marked so clipboard managers skip it on a
Mac), ⌘V or Ctrl+V is pressed in the app you were in, and what you had copied is put back; on
Wayland it's typed in by wtype instead. On a Mac pressing ⌘V needs Accessibility, which you're asked
for when you pick it, and Bridge AI uses it for that paste only.

If you run Bridge AI on a server or in Docker, all of this applies to that machine instead of your
computer.

When you add a key for a cloud agent (Cursor, GitHub Copilot, Jules or Claude), Bridge AI on your
computer talks to that provider with your key: to list your repos, start the agents you ask for,
check on them and send your follow-ups. The key stays on your computer, in `~/.bridge-ai`, readable
only by you, and isn't given to the agents Bridge AI starts there. Your code and what the agent does
with it are under that provider's terms. If you give Claude a GitHub token, it goes to Anthropic
with each task so the agent can reach your repo. "Use my GitHub CLI sign-in" reads the GitHub CLI's
token once, when you click it.

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
or app (the Android app adds `BridgeAIApp` and its version). That's under your Cloudflare account
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
- **Camera**: only to scan the pairing QR code. The pictures stay on the phone.
- **Microphone**: only when you dictate a message. The recording goes end-to-end encrypted to
  your computer, which turns it into text there.
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
