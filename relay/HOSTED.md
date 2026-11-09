# Bridge AI's hosted relay

For whoever runs it. Everyone else can ignore this file: Bridge AI works without it, and each
person can still put a relay on their own Cloudflare account, or use Tailscale.

The hosted relay is the same Worker as everyone's own relay ([worker.js](worker.js)), run once by
the project for many computers, so someone with no Cloudflare account can reach their computer from
their phone with one click. It's for Bold Bridge accounts that may use it ([account/API.md](../account/API.md)):
an account asks for it, an admin approves it, and its computers get relay tokens. It goes on
**boldbridge.app**, a domain of its own (`<domain>` below). With `HOSTED` unset the Worker is a
personal relay exactly as before (no limits, no accounts, no stats); with `HOSTED=1` it works like
this:

- `https://<domain>/` is a small page saying what the relay is. `POST https://<domain>/_relay/register`,
  with `Authorization: Bearer <relay token>`, gives a computer `{ id, url, token }`: an id of 12
  lowercase letters and digits, its own address `https://<id>.<domain>`, and a token only that
  computer has. The relay token says which account and device it is; the relay checks its signature
  and end with the accounts service's public key (`ACCOUNTS_PUBLIC_KEY`), offline, and asks the
  accounts service whether the account may use it. One address per device: the same device
  registering again gets the same address back, with a new token. It takes `MAX_ACCOUNTS` (500)
  accounts at once; past that, an account's first computer is told it's full for now, and the app
  offers the other ways (What happens at a limit).
- Each computer gets its own Durable Object, a Hub (`idFromName(id)`), which keeps only a SHA-256 hash
  of the token, and which account and device it's for. The computer connects to `/_relay/host` at
  its address with `Authorization: Bearer <token>` and a relay token in `X-Relay-Token` (Bridge AI
  sends a fresh one each time); a wrong or missing computer token gets 403, a missing, ended or
  another account's relay token a message saying so.
- Each account gets a Durable Object of its own, an Account (`idFromName(a)`), which keeps its use
  across its computers in an 8-hour window and a week, like Claude's, and what the accounts service
  last said of it.
- Phones work exactly as with a relay of your own: they open the computer's address, pair, and
  everything past the handshake is end-to-end encrypted between phone and computer (in a browser,
  by the page the relay serves; the iPhone app has its own). One address per
  computer keeps each pairing, service worker and saved copy apart, as before.
- Any other name under the domain gets a plain 404: names that aren't an id, reserved names (www,
  api, relay, admin and a few more), names two levels down, and ids that aren't registered (or were
  removed). Ids end in two checksum characters keyed with a secret only the relay has (`ID_SECRET`),
  so a made-up name is turned away by the Worker without waking a Hub, but for one in 1,024 that
  passes by chance; each request still reaches the Worker, and is billed as one (the rate limiting
  rule in Going live stops a flood of them first). An id the relay made and then removed wakes its
  Hub once, which says it's gone, and the Worker remembers that for 30 seconds.
- Addresses are one level below the domain because Cloudflare's free Universal SSL certificate
  covers `<domain>` and `*.<domain>`, not deeper. That's also why it needs a domain of its own: under
  boldbridge.ai, `<id>.relay.boldbridge.ai` is two levels down, which only a paid Advanced
  Certificate covers, and every name under the relay's domain belongs to the relay. So nothing else
  goes on boldbridge.app: the website stays on boldbridge.ai.

## Switching it on in the app

It's hidden until it's switched on, and it needs Bold Bridge accounts switched on too
([account/README.md](../account/README.md)). The one switch is [server/hosted.js](../server/hosted.js):

```js
export const HOSTED_URL = 'https://boldbridge.app'
```

While that's empty, or `ACCOUNTS_URL` in server/account.js is, the option doesn't show in Settings,
first-run setup or `bridge-ai help`, and nothing changes for anyone. The `relay-hosted` test fails if
it's set while `ACCOUNTS_URL` isn't, or while PRIVACY.md and TERMS.md lack the hosted relay's
sections (below), and if PRIVACY.md describes a hosted relay while it's empty, so the switch and the
policy go out together. To try it on one computer before shipping, put this in that computer's
`~/.bridge-ai/config.json` instead (with the accounts service's too):

```json
"relay": { "hostedUrl": "https://boldbridge.app" }
```

Then Settings › Devices starts with a choice of three ways (Bridge AI's relay, your own
Cloudflare, Tailscale). Bridge AI's relay says what's missing, with the button that fixes it: sign in
to your Bold Bridge account (Settings › Account), ask for the relay, or wait for the request; once
it's approved, Use Bridge AI's relay. First-run setup asks for nothing: it says that Settings ›
Devices sets the phone up. `bridge-ai relay setup --hosted` works from a terminal once the account
has the relay, and says to sign in first otherwise. Moving between the ways works too; phones pair
again after a move to another relay, and the app says so. The tests never reach it:
`BRIDGE_HOSTED_URL` and `BRIDGE_ACCOUNTS_URL` stand in for the two switches, and the test kits set
them empty (a test that wants them runs `test/stand-ins/hosted-relay.mjs` and
`test/stand-ins/accounts.mjs`, and points `relay.hostedUrl` and `account.url` at them).

## Going live

About 30 minutes, most of it waiting for the domain and the certificate, after the accounts
service is live ([account/README.md](../account/README.md), Going live). Every step is for the
project's owner, on the project's Cloudflare account; nothing here is done by the app or by CI.
Keep the relay on a domain of its own (not a name under boldbridge.ai): every name under it
belongs to the relay.

- [ ] **The accounts service** (owner): live first, with its key made (`node account/key.js`). The
  relay binds to it (`ACCOUNTS`, the Worker `bridge-accounts`, its entrypoint `Relay`) and
  can't be deployed before it.
- [ ] **The domain on Cloudflare** (owner). Bought with Cloudflare Registrar, boldbridge.app is a
  zone already. Bought elsewhere: Cloudflare dashboard › Add a domain › `boldbridge.app` › the Free
  plan, then at the registrar change its nameservers to the two Cloudflare gives, and wait until
  the zone says Active (minutes to hours). `.app` names are HTTPS-only in browsers (HSTS preloaded),
  which the relay is anyway.
- [ ] **DNS** (owner; boldbridge.app › DNS › Records): two proxied records (orange cloud),
  `AAAA @ 100::` and `AAAA * 100::`. They point nowhere: the Worker answers first. Nothing else on
  the zone (no MX, no website).
- [ ] **SSL** (owner; SSL/TLS › Edge Certificates: Always Use HTTPS on). Universal SSL (on by
  default) covers `boldbridge.app` and `*.boldbridge.app`; carry on while it goes Active (often 5 to
  15 minutes). Edge Certificates lists both names once it is. (Nothing goes to an origin, so the
  SSL/TLS mode doesn't matter.)
- [ ] **Workers Paid** (owner; Workers & Pages › Plans, $5 a month): the accounts service needs it
  already. [wrangler.hosted.toml](wrangler.hosted.toml) says `WORKERS_PAID = "1"`.
- [ ] **The settings** (owner): `ACCOUNTS_PUBLIC_KEY` in wrangler.hosted.toml, the public key
  (`node account/key.js --public`). `MAX_ACCOUNTS` (500) and `RELAY_DAILY_REQUESTS` (5000000) are
  what bound the bill (Cost); change them there before deploying if you want others, and keep the
  accounts service's `RELAY_MAX_ACCOUNTS` the same as `MAX_ACCOUNTS`. The domain is in it already
  (both routes and `HOSTED_DOMAIN`).
- [ ] **Deploy** (owner, from the repo, on the computer releases are made on):

  ```sh
  npx wrangler@4.149.0 login                       # the project's Cloudflare account
  node relay/build.js relay/dist/worker.js
  npx wrangler@4.149.0 deploy -c relay/wrangler.hosted.toml
  openssl rand -base64 32 | npx wrangler@4.149.0 secret put ID_SECRET -c relay/wrangler.hosted.toml
  openssl rand -base64 32    # the STATS_TOKEN: keep it in a password manager
  npx wrangler@4.149.0 secret put STATS_TOKEN -c relay/wrangler.hosted.toml    # paste it
  ```

  Until `ID_SECRET` is set, the relay answers every request with a 500 saying so. It keys the
  checksum at the end of every computer's id, so it's set once and kept: a new one makes every
  address on the relay a 404, and each computer has to be set up again (and its phones paired
  again). Nobody needs to know it, so it isn't kept anywhere else. The STATS_TOKEN reads
  `/_relay/stats`.
- [ ] **A rate limiting rule** (owner; boldbridge.app › Security › WAF › Rate limiting rules; the
  Free plan has one): URI Path wildcard `/*`, counted by IP, 200 requests in 10 seconds, Block for
  10 seconds. It stops one address flooding the relay before the Worker runs, where nothing is
  billed (Cost, What the limits can't stop). Bridge AI's own use is far below it.
- [ ] **A billing alert** (owner; Manage Account › Notifications › Add › Usage-based billing, for
  Workers and Durable Objects), so a surprise shows early.
- [ ] **Check it**: `https://boldbridge.app/` shows the page, `https://boldbridge.app/_relay/health`
  answers `{"ok":true,...}`, `https://abc.boldbridge.app/` is a 404, a `POST
  https://boldbridge.app/_relay/register` with no token answers 401 saying it needs an account, and
  `curl -s -H "Authorization: Bearer <STATS_TOKEN>" https://boldbridge.app/_relay/stats` answers
  today's counts with `"accounts":{"on":0,"max":500}`.
- [ ] **Try it** on one computer with the config.json overrides above (the relay's and the accounts
  service's): sign in in Settings › Account, ask for the relay, approve it in the admin view, then
  Settings › Devices › Bridge AI's relay › Use Bridge AI's relay, and Pair a device. Settings shows
  the account's use in the 8-hour window and the week; `/_relay/stats` says one account on it.
- [ ] **Ship it**: keep (or cherry-pick) the commit that switches it on ("Switch on Bridge AI's
  hosted relay at boldbridge.app"): it sets `HOSTED_URL` in server/hosted.js and puts the policy text
  below into PRIVACY.md and TERMS.md (the drafts at the end of this file), with accounts switched on
  already or in the same release. Then run `npm test -- relay-hosted relay-hosted-ui privacy-hosts`,
  and release. Without that commit nothing in the app changes.

## Settings

All in `[vars]` of wrangler.hosted.toml (or Settings › Variables in the dashboard). Each limit is
per computer unless it says it's per account or for the whole relay.

| Variable | Default | What it does, and why that default |
| --- | --- | --- |
| `HOSTED` | | `1` turns on everything here. Unset, the Worker is a personal relay. |
| `HOSTED_DOMAIN` | | The domain, without `https://`: `boldbridge.app`. |
| `ACCOUNTS_PUBLIC_KEY` | | The accounts service's public key, which every relay token is checked with; while its key is being changed, the old and the new, comma separated, the old first (a token says which key signed it: account/README.md, Changing the signing key). Empty, no computer can register or connect. |
| `HOSTED_OFF` | `0` | The kill switch (below). |
| `MAX_PHONES` | `16` | Connections to one computer at once: the same as a personal relay. Strangers who haven't paired make room for paired phones. |
| `MAX_MESSAGE_KB` | `256` | One message. Bridge AI's largest is 192 KB (a piece of a big file) plus a little; notes for an offline computer are 64 KB at most. |
| `MESSAGES_PER_SECOND` | `200` | Incoming messages a second, on average, with `MESSAGE_BURST` at once. A phone watching an agent's terminal, the busiest normal use, sends and gets about 4 a second; opening the app for the first time is about 150 in a few seconds. This only stops floods. |
| `MESSAGE_BURST` | `2000` | How many may come at once before `MESSAGES_PER_SECOND` applies. |
| `IDLE_DAYS` | `90` | A computer whose Bridge AI hasn't connected for this long is deleted, with everything kept for it; an account with no computer on it and no use for this long, too. |
| `ACCOUNT_WINDOW_HOURS` | `8` | Per account: the window's length. It starts at the account's first message after the last window ended, as Claude's do, so an account that's quiet has none running. |
| `ACCOUNT_WINDOW_MESSAGES` | `150000` | Per account, across its computers: incoming messages in a window, which is what Cloudflare bills. More than a phone watching a terminal for all 8 hours (about 16,000 an hour). |
| `ACCOUNT_WEEK_MESSAGES` | `1000000` | Per account: incoming messages in a week, the weeks running on from the account's first use. About 60 hours of watching a terminal, or 400 of chat. |
| `MAX_ACCOUNTS` | `500` | Accounts with a computer on the relay, in all. Past it, an account's first computer is told the relay is full for now, and the app offers your own Cloudflare and Tailscale instead; the admin view can't approve one more (the accounts service's `RELAY_MAX_ACCOUNTS`, the same number). An account's place is given back when its last computer stops using the relay, or is removed after `IDLE_DAYS`. `0` takes no new accounts. With the account limits, what keeps the bill under $50 a month (Cost). |
| `RELAY_DAILY_REQUESTS` | `5000000` | The whole relay's Cloudflare requests a day, as `/_relay/stats` counts them: the backstop. Reached, the relay stops for every computer until 00:00 UTC, saying so. 500 accounts at their limits come to about 4.2 million a day, so it's met only past those, and at the defaults it holds the bill under about $44 a month whatever `MAX_ACCOUNTS` is (Cost). |
| `WORKERS_PAID` | `1` | The account is on Workers Paid (it must be before going live), so `/_relay/stats` measures use against its allowance. `0` while trying it on Workers Free. |

Two secrets, each set with `npx wrangler@4.149.0 secret put <name> -c relay/wrangler.hosted.toml` and
never written in the file.

| Secret | What it's for |
| --- | --- |
| `ID_SECRET` | The key of the checksum at the end of every computer's id, so only the relay can make an id that passes and a made-up address wakes no Hub. Without it the hosted relay answers nothing but a 500 saying so. Set once and kept (Going live). |
| `STATS_TOKEN` | Opens `GET https://<domain>/_relay/stats` (Watching it). Without it, that address isn't there at all (404); with a wrong one, 403. |

**Ids from before the checksum was keyed.** Until then an id's checksum was a plain hash anyone
could work out. Those ids (made only while trying the relay out; it wasn't live) don't pass any more:
their addresses answer 404, the computer says Bridge AI's relay doesn't know it any more, and
setting it up again in Settings › Devices gives it a new address, after which its phones pair again.
Its old Hub is deleted after `IDLE_DAYS`, as any computer's that stops connecting.

And one binding to another Worker: `ACCOUNTS`, the accounts service's `Relay` entrypoint, which
answers `/internal` and nothing else (never the admin view's `/admin`), for `GET
/internal/status?a=&d=` (whether an account may use the relay, and whether that device is still on
it) and `POST /internal/usage` (its use, for Settings › Account and the admin view).

### Why these limits

They follow what Cloudflare bills (Cost): incoming WebSocket messages, as requests at 20 to 1, are
nearly all of it, so the allowance is counted in messages, per account, across its computers;
Durable Object duration is billed only while a Hub runs code, which the rate and size limits bound;
data isn't billed, so there's no limit on it (a computer can't be used as a general tunnel anyway:
each message must come from a phone paired with it); connections are cheap, so `MAX_PHONES`
protects a computer's paired phones from strangers rather than the bill. An account at its limits
every week costs about $0.06 a month past what's included; a typical one (an hour or two of phone
use a day) under a cent. They're generous on purpose: nobody should meet one in normal use.

Per-account limits alone don't bound the bill; with `MAX_ACCOUNTS` they do, and
`RELAY_DAILY_REQUESTS` bounds it if `MAX_ACCOUNTS` is raised (Cost).

### What happens at a limit

Each is said in place, on the phone and on the computer, with when it ends. Nothing is cut off
without a word.

- **Too big, or too many at once**: that phone's connection is closed with a message (the phone
  shows "Too much at once for Bridge AI's relay. Connecting again in a moment.") and it reconnects
  5 or 10 seconds later. A computer's message for a phone counts against that phone. The computer
  is told too, and Settings › Devices shows it while it lasts.
- **Too many connected**: with `MAX_PHONES` paired phones and tabs connected (strangers make room
  first), one more is told so ("Bridge AI's relay takes 16 connections to one computer at once…")
  and tries again a minute later; the computer is told a phone was turned away, and why.
- **The account's window or week used up**: every computer of the account, and its phones, hear
  `{ t: "limit", why: "window" | "week", until }`, with words: "This computer's Bold Bridge account
  has used its allowance on Bridge AI's relay for now (150,000 messages in 8 hours). It resets at
  14:32 UTC. For no limits, put the relay on your own Cloudflare account." Phones are let go and
  turned away with the same words until then; the phone shows it (in place of Bridge AI, or on a bar
  if it's open) and waits. Settings › Devices on the computer says it in its own time zone, with a
  link to set up its own Cloudflare, and shows the use as the usage chip shows a plan's. The
  computers stay connected, quietly, so phones are back the moment it resets. Each computer's Hub
  tells the Account what it carried every 1,000 messages (more often as the allowance runs low, and
  every 3 minutes while anything passes), and the Account tells all the account's Hubs at once when
  it's reached, so an account can go a little over, never by much.
- **The account itself**: suspended, no longer allowed the relay, or deleted (`why: "suspended" |
  "relay" | "deleted"`), its computers and phones are told so and let go, and the computers wait 10
  minutes before asking again. Bridge AI says the same in Settings › Devices and Settings › Account.
  A computer connecting without a relay token, or with one that ended or is another account's, is
  told `why: "token"`; Bridge AI gets a new one from the account and connects again.
- **A device removed from the account** (removed in Settings › Account or the admin view, or signed
  out there): its computer is turned away with `why: "token"` the next time it, or the Account, asks
  the accounts service about it (`/internal/status?a=&d=`, at most a minute old), and its phones
  with it, not when its relay token ends; registering with its relay token is refused (401, `token:
  "removed"`). A computer connects only with a relay token of the device its address was made for;
  one signed in again (a new device) keeps its address if the device before is off the account and
  the new one has no address of its own, and is turned away otherwise.
- **The whole relay's day** (`RELAY_DAILY_REQUESTS`): the same for every computer on the relay,
  in these words: "Bridge AI's relay has carried all it can for today, for every computer on it. It
  starts again at 00:00 UTC. For no limits, put the relay on your own Cloudflare account, or use
  Tailscale." The registry works it out from the tallies (below) and says so in answer to each, so
  each computer hears it with its next tally (its next connection, or within 1,000 messages).
  Registering still works (it costs next to nothing); a new computer hears it when it connects.
- **A computer that sends on while its phones are stopped**: its messages go nowhere, but
  Cloudflare bills each one that arrives. Bridge AI sends next to none then (its phones were let
  go), so past 1,000 its connection is closed with "Bridge AI's relay let this computer go until
  14:32 UTC…", and turned away with the same words until then. Bridge AI waits until then before
  trying again.
- **Registration**: without an account's relay token, 401 with `why: "token"`; an account that's
  suspended, isn't allowed the relay or was deleted, 403 with that `why`; with `MAX_ACCOUNTS`
  accounts on the relay, an account's first computer gets 503 with `why: "full"`: "Bridge AI's relay
  is full for now: it has as many accounts as it can take. Put a relay on your own Cloudflare
  account instead (it's free), or use Tailscale." The app says so in its own words wherever the
  relay is offered: Settings › Devices marks it "Full for now" among the ways and offers your own
  Cloudflare and Tailscale (each a click) and Try again, and picks your own Cloudflare for the next
  hour; `bridge-ai relay setup --hosted` prints it with `bridge-ai relay setup` and `bridge-ai start
  phone`, and fails. An account already on the relay isn't affected.

The counts are kept by the Account, saved with each tally, and by each Hub (its day's, for the
stats), saved every 100 messages or 256 KB and whenever a connection ends. A Durable Object put to
sleep in between forgets at most that much, so the counts can come out a little low, never high.

**How the accounts are counted.** The registry (one Durable Object, which takes one request at a
time, so two registrations can't both take the last place) keeps an entry for each registered
computer, `c:<id>`, with its account, when it registered and the last day it was in use; an account
is on the relay while it has one. A registration is counted in before its Hub is made, and given
back if that fails. When a Hub is removed (Stop using the relay, `IDLE_DAYS` unused, or its account
deleted) it tells the registry and its Account, and the place is free at once. If that message is
lost, the registry's daily alarm finds it within a few days: it asks each computer it counts that
hasn't been in use for two days (200 a day at most, those asked longest ago first) whether its Hub
is still there, and lets go of those that aren't. Workers KV would be cheaper to read but is
eventually consistent, so a cap kept there could be passed.

**How the account is asked.** The Account asks the accounts service about the account
(`/internal/status`) when a computer registers or connects, when a phone connects, and with a
tally while anything passes, at most once a minute; a suspension is heard within a minute of the
account's next use. It reports the account's use (`/internal/usage`) every 5 minutes while the
account uses the relay, and once a day otherwise; an account the service no longer has is
forgotten then, with its computers' Hubs. If the service can't be reached, what it said last stands
for a while, then the relay carries on (the account's tokens say it was allowed).

## Plans

There are no plans: every account has the same limits, the settings above. A paid plan later would
be the account's, kept by the accounts service and said in its answer to `/internal/status` (the
limits it raises), with the Account using them in place of the settings; the relay keeps no money
matters of its own. Holding back an account that misuses the relay is the admin view's: suspend it,
and the relay hears within a minute.

## The kill switch

Set `HOSTED_OFF = "1"` (or a sentence of your own, shown instead of the default) and deploy, or set
it under Settings › Variables in the dashboard. Then:

- `register` answers 503 with the message;
- every connection, computer or phone, gets the message and is closed. Phones show "Bridge AI's
  relay is switched off for now. To keep using your phone, put a relay on your own Cloudflare
  account, or use Tailscale"; Settings on each computer shows the same;
- computers wait 30 minutes (and a bit, so they don't all come at once) before trying again.

A deploy closes every connection anyway, so it takes effect at once. Nothing is deleted. To turn it
back on, set `HOSTED_OFF = "0"` and deploy; computers are back within about half an hour, or at once
when Bridge AI restarts.

## What it keeps, and what it counts

Per computer, in its Hub: its id, the token's hash, its account's and device's ids, the Bridge AI
version it registered with, when it registered and connected last, its paired phones as ids made
from each phone's key (as a personal relay keeps them), today's counts, which of its paired phones
were counted this week (by those ids), and messages a phone sent while the computer was offline,
sealed so the relay can't read them, for 7 days at most. Forget on the computer (Stop using the
relay) deletes all of it at once; otherwise it goes after `IDLE_DAYS`, or when its account is
deleted.

Per account, in its Account: when it was first used, its messages in the current window and week,
each of the last three days' total, its computers' addresses by device, and what the accounts
service last said of it. Gone within a day of the account being deleted, or after `IDLE_DAYS` with
no computer on it and no use. The accounts service keeps what the Account reports (account/README.md).

The registry, a Durable Object of its own, keeps:

- for `MAX_ACCOUNTS`, each registered computer's id with its account's id, when it registered, the
  last day it was in use and the last day the registry asked after it, gone when the computer is
  (How the accounts are counted);
- for `/_relay/stats`, each day's totals: computers set up and refused, computers in use,
  connections, messages, bytes, limits reached, when the relay reached `RELAY_DAILY_REQUESTS`, and
  that day's ten busiest computers by id with their use. Kept 35 days. Each computer's Hub adds its
  share with each connection, each limit reached, every 1,000 messages or 4 MB, and when a
  connection ends; a Hub put to sleep in between forgets at most that much, so these too can come
  out a little low, never high.

**Counts for the project**, with a Workers Analytics Engine binding (`STATS`; leave it out of the
config and nothing is counted). Each is one data point with the computer's id as its index, and
nothing else: no IP addresses, no content, no user agents, no phone identifiers, no names, no
account ids.

| `blob1` | Written when | Also |
| --- | --- | --- |
| `register` | a computer registers | `blob2`: its Bridge AI version; `blob3`: `again` when it's the same device registering again |
| `computer` | a computer connects | `blob2`: its Bridge AI version |
| `phone` | one of a computer's paired phones connects for the first time this week (weeks start Monday, UTC) | `blob2`: the week, as its Monday's date |
| `usage` | every 100 messages or 256 KB, and when a connection ends | `double1`: bytes, `double2`: messages, both incoming |
| `limit` | a limit turns something away | `blob2`: `size`, `rate`, `phones`, `window`, `week`, `all` (the whole relay's day), `shut` (let go for sending on while stopped), `suspended`, `relay`, `deleted` or `token` |
| `removed` | a computer's data is deleted | `blob2`: `forget`, `idle` or `account` |
| `refused` | a registration is refused (index empty) | `blob2`: `token`, `full`, `suspended`, `relay` or `deleted` |

The version comes from the computer (`X-Bridge-Version` when it connects, `version` when it
registers) and is kept only if it looks like `2.4.0`. Analytics Engine keeps data for three months.
Some useful queries, with the SQL API (`POST
https://api.cloudflare.com/client/v4/accounts/<account id>/analytics_engine/sql`, a token with
Account Analytics Read):

```sql
-- computers that connected in the last 7 days, by version
SELECT blob2 AS version, count(DISTINCT index1) AS computers FROM bridge_relay
WHERE blob1 = 'computer' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY version
-- phones in use, by week (each phone once per computer per week)
SELECT blob2 AS week, sum(_sample_interval) AS phones FROM bridge_relay
WHERE blob1 = 'phone' GROUP BY week ORDER BY week
-- registrations a day
SELECT toStartOfDay(timestamp) AS day, sum(_sample_interval) AS computers FROM bridge_relay
WHERE blob1 = 'register' GROUP BY day ORDER BY day
-- data relayed in the last day
SELECT sum(_sample_interval * double1) AS bytes, sum(_sample_interval * double2) AS messages
FROM bridge_relay WHERE blob1 = 'usage' AND timestamp > NOW() - INTERVAL '1' DAY
-- limits hit this week
SELECT blob2 AS why, sum(_sample_interval) AS times FROM bridge_relay
WHERE blob1 = 'limit' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY why
-- one computer's last week, by day (a runaway in /_relay/stats' top)
SELECT toStartOfDay(timestamp) AS day, sum(_sample_interval * double2) AS messages FROM bridge_relay
WHERE blob1 = 'usage' AND index1 = '<id>' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY day
```

Each account's use is in the admin view (from the accounts service), by day.

Cloudflare also sees what any site it serves sees (IP addresses, times, sizes), under its own
policy. Workers Logs stay off (`[observability] enabled = false` in wrangler.hosted.toml), so request
details aren't stored in the account; `wrangler tail` shows them live, IP addresses included.

## Cost

From Cloudflare's pricing pages as they were on 7 November 2026:
[Workers](https://developers.cloudflare.com/workers/platform/pricing/) (last updated 2 October
2026), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) (18
October 2026) and [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)
(23 April 2026). Workers Paid is $5 a month for the account, and includes:

| What's billed | Included each month | Then |
| --- | --- | --- |
| Workers requests: each of the page's files, each new connection (not the messages over it) | 10 million | $0.30 a million |
| Workers CPU time | 30 million ms | $0.02 a million ms |
| Durable Object requests: requests, connections, alarms, and incoming WebSocket messages at 20 to 1 (outgoing messages and protocol pings are free) | 1 million | $0.15 a million |
| Durable Object duration: 128 MB while an object runs code. One that can hibernate, as a Hub can, costs nothing while idle, and auto-responses (which answer the keepalives) add none | 400,000 GB-s | $12.50 a million GB-s |
| SQLite storage: rows read, rows written, data | 25 billion, 50 million, 5 GB-month | $0.001 and $1.00 a million rows, $0.20 a GB-month |
| Analytics Engine data points | 10 million | $0.25 a million (not billed yet) |

Billable use is rounded up to the next million before the rate applies, so the first request or
GB-s past what's included costs a whole million's worth: $0.15 for requests, $12.50 for duration.
Calls through a service binding (the relay asking the accounts service) aren't billed as requests.
Workers Free has 100,000 requests a day (Workers and Durable Objects each) and 13,000 GB-s a day,
and stops for everyone when they're gone.

Measured here, with the relay running locally:

- A phone watching an agent's terminal (the busiest view; it refreshes about once a second): 4.4
  incoming messages a second, so about 16,000 an hour and 5 MB.
- The same phone on the agent's chat: 0.7 a second, about 2,500 an hour.
- Opening the app: about 45 messages, or about 150 (1.4 MB) the very first time.
- Each connected computer's keepalive: one message every 15 seconds, around the clock, phone or
  not: 5,760 a day. They're answered without waking the Hub, so no duration; Cloudflare's page
  doesn't say whether they count as incoming messages, so they're counted here as if they do: 288
  requests a day.

**Per active hour of a phone** (terminal view, the expensive case): 16,000 messages is 800
requests, $0.00012 past what's included. Duration, at a generous 3 ms per message, is 48 seconds of
one object, 6 GB-s or $0.00008. **About $0.0002 an hour, roughly 5,000 phone-hours per dollar**,
and about a fifth of that on the chat view.

**One account at the most it can use**: the week binds before the window does (150,000 every 8
hours would be 3.15 million a week), so 1,000,000 messages a week, about 4.29 million in a 30-day
month. In Durable Object requests a month: 214,300 for the messages, 8,600 for the tallies (one to
the registry and one to the Account every 1,000), 8,600 for the Account's reports (an alarm every 5
minutes), 43,200 for keepalives if all five of its devices are computers connected around the
clock, and about 9,000 for connections: about 284,000. Duration: 4.29 million messages at 3 ms is
about 1,650 GB-s. Rows written: about 51,000 (each Hub's day every 100 messages, the Account and the
registry with each tally). About $0.06 a month at Paid rates, before what's included.

**The whole relay at its worst**: every one of `MAX_ACCOUNTS` accounts using its week, every week,
with five computers connected all month:

| `MAX_ACCOUNTS` | Durable Object requests | Duration | Bill a month |
| --- | --- | --- | --- |
| 100 | 28.4 million | 165,000 GB-s (within the 400,000) | $5 + $4.20 = **$9.20** |
| 250 | 71 million | 412,500 GB-s | $5 + $10.50 + $12.50 = **$28.00** |
| 500 | 142 million | 825,000 GB-s | $5 + $21.15 + $12.50 = **$38.65** |

In every row, Workers requests (under 5 million), CPU, rows written (26 million at 500) and storage
stay within what's included. Analytics Engine's data points would pass its 10 million at 500
accounts (21 million: $2.75 a month, once it's billed), still under $50.

**How the backstop bounds it.** `RELAY_DAILY_REQUESTS` counts what `/_relay/stats` counts: one
request for every 20 messages, two for every 1,000 (the tallies), and three for each connection or
registration. 500 accounts at their limits come to about 4.2 million a day of it, under the 5
million, so it's never met by them. Should `MAX_ACCOUNTS` be raised, 5 million a day is at most 150
million a month, and at most 96 million messages a day; with the keepalives of 2,500 computers (21.6
million a month) and the Accounts' alarms (4.3 million), that's 176 million requests and about 1.1
million GB-s: $5 + $26.25 + $12.50, about **$43.75** a month, whatever `MAX_ACCOUNTS` is. Each
1,000,000 a day more of it adds at most 30 million requests a month, $4.50, and more duration.

**Everyday use** is far below that: an hour or two of phone use a day is about 2,000 requests for
a computer, keepalives included, so 500 accounts with a computer each come to about 1 million a day
and 30 million a month: about $4.35 on top of the $5.

**What the limits can't stop.** A request is billed once it reaches the Worker, before the relay can
turn it away, so someone sending floods of requests (to made-up names, which wake no Hub, or
connecting to one computer's address over and over) costs $0.30 a million past the included 10
million, and $0.15 a million more for each that wakes a Hub. The rate limiting rule in Going live blocks those at
Cloudflare before the Worker, where nothing is billed (only requests that reach a Worker are). A
computer's own connection can't run on past its account's limits (it's let go after 1,000 messages
that go nowhere). Registering needs an account an admin approved. The billing alert says if anything
gets through, and the kill switch stops it all.

Storage is tiny (a few kilobytes per computer and per account, plus up to 512 KB of waiting
messages per phone for a week, plus a few kilobytes a day for the registry's counts) and within
the included 5 GB.

**When it's time for Workers Paid**: before going live (Going live; the accounts service needs it
too). On Workers Free, `/_relay/stats`' `note` says when a day passes 50,000 requests, half of
Free's 100,000. On Workers Paid (`WORKERS_PAID = "1"`), it says when the month passes the included
million and roughly what the rest costs; `requests.ceiling` is `RELAY_DAILY_REQUESTS`, and a day's
`ceilingAt` says when the relay reached it. If that happens, look at `top` for computers far above
the rest, and at their accounts in the admin view.

## Updating it

Same as going live: build and deploy. Any computer's or phone's connection drops and comes back
within seconds. Computers on the hosted relay never try to update it themselves (they do for a
relay on your own account). Keep `[[migrations]]` as they are: `v1` made the Hub class and `v2` the
Account class; a class added later is a `v3`.

## Watching it

**`/_relay/stats`**, with the STATS_TOKEN:

```sh
curl -s -H "Authorization: Bearer <STATS_TOKEN>" "https://boldbridge.app/_relay/stats?days=7"
```

It answers the last 7 days (up to 35 with `?days=`), today (UTC) first. Each day has `registered`
and `refused` (computers set up, and turned away at registering), `computers` (those that connected
or relayed anything), `connections` (`computers`, `phones`), `messages` and `bytes` (incoming,
relayed), `limits` (how many times each was reached: `window` and `week` the accounts' limits,
`full` registrations turned away by `MAX_ACCOUNTS`, `all` the computers stopped by
`RELAY_DAILY_REQUESTS`, `shut` those let go for sending on while stopped, `account` those stopped
for their account, and `rate`, `size`, `phones`), `ceilingAt` (when the relay reached
`RELAY_DAILY_REQUESTS`, or null), `requests` (an estimate of what that comes to in Cloudflare
requests, without keepalives), and `top`: the day's ten busiest computers by id, with their
`messages` and `bytes`. With them, `accounts` (`on` the relay now, of `max`), `computers`
(registered now), `requests` for today and this month with the `ceiling`, and a `note` on Workers
Free or Paid. Nothing in it is an IP address, a token, an account or anything that passed through.

**Full, or near it**: `accounts.on` close to `max` with `limits.full` above 0 means people are being
turned away. Raise `MAX_ACCOUNTS` (and the accounts service's `RELAY_MAX_ACCOUNTS`) knowing the Cost
table above, or leave it.

**A heavy account** is in the admin view, sorted by the week's use. The limits already stop it
costing more than its allowance. If it's misuse, suspend it there and, if need be, block its
network with a WAF rule.

**Cloudflare's dashboard** has the exact figures:

- Workers & Pages › bridge-relay › Metrics: requests, errors, CPU time.
- Storage & Databases › Durable Objects › bridge-relay's Hub and Account: requests, duration and
  storage. These are what's billed; `/_relay/stats` is the estimate to read beside them.
- Manage Account › Billing › Billable usage: what this month will cost.
- The Analytics Engine queries above: computers, phones, versions, data, limits hit.
- `npx wrangler@4.149.0 tail -c relay/wrangler.hosted.toml` for live errors (it shows IP addresses;
  don't keep its output).

## Trying it locally

`wrangler dev` passes the Host header through, and Chrome sends `*.localhost` to 127.0.0.1 (so
does Bridge AI, though macOS and Windows don't look such names up themselves), so
`<id>.localhost` stands in for a computer's address:

```sh
node relay/build.js /tmp/relay/worker.js
# a wrangler.toml beside it like wrangler.hosted.toml, with main = "worker.js", no routes,
# HOSTED_DOMAIN = "localhost", and the accounts service running under wrangler dev too (its
# Worker named bridge-accounts, so the binding finds it)
npx wrangler@4.149.0 dev --local --port 8795
```

Then point a test Bridge AI at both with `"relay": { "hostedUrl": "http://localhost:8795" }` and
`"account": { "url": "http://localhost:<its port>", "publicKey": "…" }` in its config.json (plain
http is allowed only for localhost and 127.0.0.1). Never point a computer you use at a test relay.
`npm test -- relay-hosted` runs the Worker in Node with every limit, the accounts' windows and weeks
and the stats, with nothing reaching Cloudflare, and `npm test -- relay-hosted-ui` shows the app's
side (Settings › Devices with an account and without, a relay that's full, an account's limit
reached and reset, first-run setup, `bridge-ai relay setup --hosted`) against the stand-ins.

## Policy text to add when it goes live

Paste these in the same change that sets `HOSTED_URL`, with `<domain>` filled in, once the accounts
service's (account/README.md) are in or with them. Until then PRIVACY.md and TERMS.md stay as they
are, and stay true for everyone who runs their own relay. The `relay-hosted` test keeps these in
step: each "Replace" must still be word for word in its file, and pasted in, they must say what the
relay sees, keeps, counts and limits.

### PRIVACY.md: the opening paragraph

Replace

> Bridge AI is an open-source app (https://github.com/sahil1/bridge) made of three parts: the app on
> your computer, a relay on your own Cloudflare account, and the phone apps for iPhone and Android.
> The app on your computer sends the project anonymous usage stats and crash reports (below), which
> you can turn off in Settings › About & Updates; nothing else goes to the project or its author. The
> relay and the phone apps send the project nothing.

with

> Bridge AI is an open-source app (https://github.com/sahil1/bridge) made of three parts: the app on
> your computer, a relay (on your own Cloudflare account, or Bridge AI's relay, run by the project),
> and the phone apps for iPhone and Android. The app on your computer sends the project anonymous
> usage stats and crash reports (below), which you can turn off in Settings › About & Updates. If you
> choose Bridge AI's relay, your phone and computer talk through it, end-to-end encrypted, and it
> keeps only what it needs to work (below). Nothing else goes to the project or its author. A relay of
> your own and the phone apps send the project nothing.

### PRIVACY.md: in "Usage stats"

Replace

> The phone apps and the relay send nothing of the kind.

with

> The phone apps and a relay of your own send nothing of the kind; Bridge AI's relay counts its own
> use (below).

### PRIVACY.md: a new section after "Your relay"

> ## Bridge AI's relay (optional)
>
> If you'd rather not set up a relay of your own, you can choose Bridge AI's relay in Settings ›
> Devices. It comes with a Bold Bridge account (above), by request. It's the same relay
> ([relay/worker.js](relay/worker.js)), run by the project on its own Cloudflare account at
> `<domain>`, so the project's Cloudflare account carries your traffic instead of yours. Cloudflare
> processes it for the project.
>
> **What it can read: nothing past the handshake.** Everything between your phone and your computer
> is end-to-end encrypted, so the relay passes on bytes it can't read. That holds as long as the page
> doing the encrypting is the one Bridge AI wrote: the iPhone app has it built in, but in a phone's
> browser the page comes from the relay, so whoever runs the relay could change it. On a relay that
> isn't yours, use the iPhone app. What it sees, as any server does: the IP addresses of your phone
> and computer, when they connect, and how much they send.
>
> **What it keeps for your computer**: a random id (its address there), a hash of the token your
> computer uses to connect (never the token), your account's and this device's ids, the Bridge AI
> version it was set up with, when it registered and last connected, today's message and data counts,
> and, as any relay does, your paired phones as ids made from their keys (and which of them connected
> this week), and messages from your phone waiting for your computer, sealed so it can't read them,
> for 7 days at most. **For your account**: its messages in each 8-hour window and each week, across
> your computers (for its limits), which it reports to your Bold Bridge account every few minutes
> while you use it. And because it takes a limited number of accounts at once, it keeps a list of the
> computers on it, by their random ids and their accounts' ids, with when each was set up and last
> used.
>
> **What it counts, for the project**: when a computer registers and connects (with its Bridge AI
> version), how many paired phones connect each week, how much data passes, when a limit is reached,
> and each day's totals with the day's busiest computers' use, kept 35 days. Each is by your
> computer's random id only: no IP addresses, no content, no names. The full list is in
> [relay/HOSTED.md](relay/HOSTED.md).
>
> **Its limits**: it's free, with an allowance for each account, across its computers: so many
> messages in each 8-hour window and each week, like Claude's (Settings › Account and Settings ›
> Devices show them), and limits that stop floods (how big one message can be, how many come at
> once, how many phones and tabs are connected at once). It takes a limited number of accounts, and
> when it's full, Bridge AI says so and offers the other ways (a relay of your own, or Tailscale). It
> also has a daily limit for all the computers on it together; if that's reached, it stops for
> everyone until 00:00 UTC. When a limit is reached, your phone and Settings › Devices say which, and
> when it ends. The limits may change, and paid plans with higher ones may come; anything a paid plan
> would keep or send elsewhere (to take payment) will be said here first.
>
> **Stop using it** (Settings › Devices › Stop using the relay) and your computer's data there is
> deleted at once (should that message not arrive, its id leaves the list of computers within a few
> days). A computer that hasn't connected for 90 days is deleted the same way, and deleting your Bold
> Bridge account deletes your account's counts and its computers there within a day. Everything else
> in this policy, including what Cloudflare sees, applies to it as to a relay of your own, except
> that it's the project's Cloudflare account.

### TERMS.md: the opening paragraph

Replace

> the relay you can set
> up on your own Cloudflare account,

with

> the relay you can set up on your own Cloudflare account (or use the project's),

### TERMS.md: in "Privacy"

Replace

> The app on your computer sends it anonymous usage
> stats and crash reports unless you turn them off (Settings › About & Updates).

with

> The app on your computer sends it anonymous usage
> stats and crash reports unless you turn them off (Settings › About & Updates), and if you use its
> relay, the relay keeps what it needs to work and counts its use.

### TERMS.md: a new section after "Your accounts with other services"

> ## Bridge AI's relay
>
> The project offers an optional relay, so your phone can reach your computer without a Cloudflare
> account of your own. It comes with a Bold Bridge account, by request, and the project may say no.
> It's free, with fair-use limits for each account (an allowance of messages every 8 hours and each
> week, and limits that stop floods). It takes a limited number of accounts, so it may be full when
> you ask, and it has a daily limit for all of them together, past which it stops for everyone until
> the next day. The project may change those limits or offer paid plans with higher ones; it will say
> so here and in the app before charging for anything. It's provided as is, like the rest of Bridge
> AI: it may be slow, be full, go down, change, or stop, with or without notice. If you need it to be
> dependable, set up a relay on your own Cloudflare account instead.
>
> Use it only for Bridge AI, as Bridge AI uses it. Don't use it to pass on anything else, to get
> around its limits, to disturb other people's use of it, or for anything unlawful. The project may
> remove a computer from it, suspend the account, or block a network, if it's misused.
