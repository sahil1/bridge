# Bridge AI's hosted relay

For whoever runs it. Everyone else can ignore this file: Bridge AI works without it, and each
person can still put a relay on their own Cloudflare account, or use Tailscale.

The hosted relay is the same Worker as everyone's own relay ([worker.js](worker.js)), run once by
the project for many computers, so someone with no Cloudflare account can reach their computer from
their phone with one click. It goes on **boldbridge.app**, a domain of its own (`<domain>` below).
With `HOSTED` unset the Worker is a personal relay exactly as before (no limits, no plans, no
stats); with `HOSTED=1` it works like this:

- `https://<domain>/` is a small page saying what the relay is. `POST https://<domain>/_relay/register`
  gives a computer, once, `{ id, url, token }`: an id of 12 lowercase letters and digits, its own
  address `https://<id>.<domain>`, and a token only that computer has. It takes `MAX_COMPUTERS`
  (100) at once; past that it answers that it's full for now, and the app offers the other ways
  (What happens at a limit).
- Each computer gets its own Durable Object (`idFromName(id)`), which keeps only a SHA-256 hash of
  the token, and its plan (`free` to start with, see Plans). The computer connects to `/_relay/host`
  at its address with `Authorization: Bearer <token>`; a wrong or missing token gets 403.
- Phones work exactly as with a relay of your own: they open the computer's address, pair, and
  everything past the handshake is end-to-end encrypted between phone and computer (in a browser,
  by the page the relay serves; the iPhone app has its own). One address per
  computer keeps each pairing, service worker and saved copy apart, as before.
- Any other name under the domain gets a plain 404: names that aren't an id (ids end in two
  checksum characters, so a made-up name is turned away without waking anything), reserved names
  (www, api, relay, admin and a few more), names two levels down, and ids that aren't registered
  (or were removed).
- Addresses are one level below the domain because Cloudflare's free Universal SSL certificate
  covers `<domain>` and `*.<domain>`, not deeper. That's also why it needs a domain of its own: under
  boldbridge.ai, `<id>.relay.boldbridge.ai` is two levels down, which only a paid Advanced
  Certificate covers, and every name under the relay's domain belongs to the relay. So nothing else
  goes on boldbridge.app: the website stays on boldbridge.ai.

## Switching it on in the app

It's hidden until it's switched on. The one switch is [server/hosted.js](../server/hosted.js):

```js
export const HOSTED_URL = 'https://boldbridge.app'
```

While that's empty, the option doesn't show in Settings, first-run setup or `bridge-ai help`, and
nothing changes for anyone. The `relay-hosted` test fails if it's set while PRIVACY.md and TERMS.md
lack the hosted relay's sections (below), and if PRIVACY.md describes a hosted relay while it's
empty, so the switch and the policy go out together. To try it on one computer before shipping,
put this in that computer's `~/.bridge-ai/config.json` instead:

```json
"relay": { "hostedUrl": "https://boldbridge.app" }
```

Then Settings › Devices starts with a choice of three ways (Bridge AI's relay, your own
Cloudflare, Tailscale), first-run setup offers "Use Bridge AI on your phone" through it (ticked
unless you untick it; the next Continue shows the pairing code, or why it couldn't), and
`bridge-ai relay setup --hosted` works from a terminal. Moving between the ways works too; phones
pair again after a move to another relay, and the app says so. The tests never reach it:
`BRIDGE_HOSTED_URL` stands in for `HOSTED_URL`, and the test kits set it empty (a test that wants a
hosted relay runs `test/stand-ins/hosted-relay.mjs` and points `relay.hostedUrl` at it).

## Going live

About 30 minutes, most of it waiting for the domain and the certificate. Every step is for the
project's owner, on the project's Cloudflare account; nothing here is done by the app or by CI.
Keep the relay on a domain of its own (not a name under boldbridge.ai): every name under it
belongs to the relay.

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
- [ ] **Workers Paid** (owner; Workers & Pages › Plans, $5 a month). Workers Free stops the relay
  for everyone once a day's allowance is gone (Cost), so it's for trying it only.
  [wrangler.hosted.toml](wrangler.hosted.toml) already says `WORKERS_PAID = "1"`.
- [ ] **The numbers** (owner): `MAX_COMPUTERS` (100) and `RELAY_DAILY_REQUESTS` (500000) in
  wrangler.hosted.toml are what bound the bill (Cost); change them there before deploying if you
  want others. The domain is in it already (both routes and `HOSTED_DOMAIN`).
- [ ] **Deploy** (owner, from the repo, on the computer releases are made on):

  ```sh
  npx wrangler@4.149.0 login                       # the project's Cloudflare account
  node relay/build.js relay/dist/worker.js
  npx wrangler@4.149.0 deploy -c relay/wrangler.hosted.toml
  openssl rand -base64 32    # the STATS_TOKEN: keep it in a password manager
  npx wrangler@4.149.0 secret put STATS_TOKEN -c relay/wrangler.hosted.toml    # paste it
  ```

  The STATS_TOKEN reads `/_relay/stats`. `PLAN_TOKEN` waits until there's a paid plan (Plans).
- [ ] **A rate limiting rule** (owner; boldbridge.app › Security › WAF › Rate limiting rules; the
  Free plan has one): URI Path wildcard `/*`, counted by IP, 200 requests in 10 seconds, Block for
  10 seconds. It stops one address flooding the relay before the Worker runs, where nothing is
  billed (Cost, What the limits can't stop). Bridge AI's own use is far below it.
- [ ] **A billing alert** (owner; Manage Account › Notifications › Add › Usage-based billing, for
  Workers and Durable Objects), so a surprise shows early.
- [ ] **Check it**: `https://boldbridge.app/` shows the page, `https://boldbridge.app/_relay/health`
  answers `{"ok":true,...}`, `https://abc.boldbridge.app/` is a 404, and
  `curl -s -H "Authorization: Bearer <STATS_TOKEN>" https://boldbridge.app/_relay/stats` answers
  today's counts with `"computers":{"registered":0,"max":100}`.
- [ ] **Try it** on one computer with the config.json override above: Settings › Devices › Bridge
  AI's relay › Use Bridge AI's relay, then Pair a device. Settings says "Free plan: up to 200,000
  messages or 512 MB a day"; `/_relay/stats` says one computer registered.
- [ ] **Ship it**: keep (or cherry-pick) the commit that switches it on ("Switch on Bridge AI's
  hosted relay at boldbridge.app"): it sets `HOSTED_URL` in server/hosted.js and puts the policy text
  below into PRIVACY.md and TERMS.md (the drafts at the end of this file). Then run `npm test --
  relay-hosted relay-hosted-ui privacy-hosts`, and release. Without that commit nothing in the app
  changes.

## Settings

All in `[vars]` of wrangler.hosted.toml (or Settings › Variables in the dashboard). Each limit is
per computer unless it says otherwise, and is the free plan's (Plans).

| Variable | Default | What it does, and why that default |
| --- | --- | --- |
| `HOSTED` | | `1` turns on everything here. Unset, the Worker is a personal relay. |
| `HOSTED_DOMAIN` | | The domain, without `https://`: `boldbridge.app`. |
| `HOSTED_OFF` | `0` | The kill switch (below). |
| `MAX_PHONES` | `16` | Connections to one computer at once: the same as a personal relay. Strangers who haven't paired make room for paired phones. |
| `MAX_MESSAGE_KB` | `256` | One message. Bridge AI's largest is 192 KB (a piece of a big file) plus a little; notes for an offline computer are 64 KB at most. |
| `MESSAGES_PER_SECOND` | `200` | Incoming messages a second, on average, with `MESSAGE_BURST` at once. A phone watching an agent's terminal, the busiest normal use, sends and gets about 4 a second; opening the app for the first time is about 150 in a few seconds. This only stops floods. |
| `MESSAGE_BURST` | `2000` | How many may come at once before `MESSAGES_PER_SECOND` applies. |
| `DAILY_MESSAGES` | `200000` | Incoming messages a day (UTC). This is what Cloudflare bills. About 12 hours of a phone watching a terminal, or far more of anything else. |
| `DAILY_MB` | `512` | Data a day (UTC). Bytes aren't billed; this stops the relay being used as a general tunnel. A busy hour is about 5 MB. |
| `IDLE_DAYS` | `90` | A computer whose Bridge AI hasn't connected for this long is deleted, with everything kept for it. |
| `REGISTER_PER_IP` | `10` | New computers a day from one network (an IPv4 address, or an IPv6 /64), for every plan. Enough for a household or an office, small enough to stop someone scripting it. |
| `REGISTER_PER_DAY` | `1000` | New computers a day in all: a ceiling on what a determined abuser can create. Raise it as people use it. |
| `MAX_COMPUTERS` | `100` | Computers registered at once, in all. Past it, registering answers that the relay is full for now, and the app offers your own Cloudflare and Tailscale instead. A place is given back when a computer stops using the relay, or is removed after `IDLE_DAYS`. `0` takes no new computers. With `RELAY_DAILY_REQUESTS`, what keeps the bill near $5 a month (Cost). |
| `RELAY_DAILY_REQUESTS` | `500000` | The whole relay's Cloudflare requests a day, as `/_relay/stats` counts them. Reached, the relay stops for every computer until 00:00 UTC, saying so; at the defaults, the most it can add to Workers Paid's $5 is about $2.55 a month (Cost). Everyday use of 100 computers comes to well under half of it. |
| `PLANS` | `{}` | Plans other than free, each with the limits it raises (Plans). None yet. |
| `WORKERS_PAID` | `1` | The account is on Workers Paid (it must be before going live), so `/_relay/stats` measures use against its allowance. `0` while trying it on Workers Free. |

Two secrets, set with `npx wrangler@4.149.0 secret put <name> -c relay/wrangler.hosted.toml` and
never written in the file. Without one, its address isn't there at all (404); with a wrong one, 403.

| Secret | What it opens |
| --- | --- |
| `STATS_TOKEN` | `GET https://<domain>/_relay/stats` (Watching it) |
| `PLAN_TOKEN` | `POST https://<domain>/_relay/plan`, which puts a computer on a plan (Plans) |

### Why these limits

They follow what Cloudflare bills (Cost): incoming WebSocket messages, as requests at 20 to 1, are
nearly all of it, so the daily allowance is counted in messages; Durable Object duration is billed
only while a Hub runs code, which the rate and size limits bound; data isn't billed, so `DAILY_MB`
only keeps the relay from becoming a tunnel; connections are cheap, so `MAX_PHONES` protects a
computer's paired phones from strangers rather than the bill. At the defaults, the most one computer
can cost is about $0.08 a month (its allowance used up every day), and a typical one (an hour or two
of phone use a day) well under a cent. They're generous on purpose: the free plan is what makes the
phone stick, and nobody should meet a limit in normal use.

Per-computer limits alone don't bound the bill: 100 computers each using up its allowance every
day would come to about $9.80 a month, and 250 to about $29.50. So the relay has two of its own,
`MAX_COMPUTERS` and `RELAY_DAILY_REQUESTS`, and with them the most it can cost is about $7.55 a
month (Cost).

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
- **Today's allowance used up**: both ends are told, "The hosted relay's daily limit for this
  computer is used up (200,000 messages or 512 MB a day on the free plan). It resets at 00:00 UTC.
  For no limits, put the relay on your own Cloudflare account." The phone shows it (in place of
  Bridge AI, or on a bar if it's open) and waits until the reset; Settings on the computer shows it,
  in its own time zone, with a link to set up its own Cloudflare. The computer stays connected,
  quietly, so phones are back the moment the day resets (00:00 UTC).
- **The whole relay's day** (`RELAY_DAILY_REQUESTS`): the same for every computer on the relay,
  in these words: "Bridge AI's relay has carried all it can for today, for every computer on it. It
  starts again at 00:00 UTC. For no limits, put the relay on your own Cloudflare account, or use
  Tailscale." The registry works it out from the tallies (below) and says so in answer to each, so
  each computer hears it with its next tally (its next connection, or within 1,000 messages).
  Registering still works (it costs next to nothing); a new computer hears it when it connects.
- **A computer that sends on after its day**: once today's allowance (its own or the relay's) is
  used up, its messages go nowhere, but Cloudflare bills each one that arrives. Bridge AI sends next
  to none then (its phones were let go), so past 1,000 its connection is closed with "Bridge AI's
  relay let this computer go until 00:00 UTC…", and turned away with the same words until then.
  Bridge AI waits until then before trying again.
- **Registration**: past either day's limit, `register` answers 429 with a message the app shows;
  with `MAX_COMPUTERS` registered, 503 with `why: "full"`: "Bridge AI's relay is full for now: it
  has as many computers as it can take. Put a relay on your own Cloudflare account instead (it's
  free), or use Tailscale." The app says so in its own words wherever the relay is offered:
  Settings › Devices marks it "Full for now" among the ways and offers your own Cloudflare and
  Tailscale (each a click) and Try again, and picks your own Cloudflare for the next hour; first-run
  setup says it's full and that Settings › Devices has the other ways, and carries on;
  `bridge-ai relay setup --hosted` prints it with `bridge-ai relay setup` and `bridge-ai start
  phone`, and fails. A computer already on the relay isn't affected.

The daily counts are kept in each computer's Durable Object, saved every 100 messages or 256 KB
and whenever a connection ends. A Durable Object put to sleep in between forgets at most that much,
so the counts can come out a little low, never high.

**How the computers are counted.** The registry (one Durable Object, which takes one request at a
time, so two registrations can't both take the last place) keeps an entry for each registered
computer, `c:<id>`, with when it registered and the last day it was in use. A registration is
counted in before its Hub is made, and given back if that fails. When a Hub is removed (Stop using
the relay, or `IDLE_DAYS` unused) it tells the registry, and its place is free at once. If that
message is lost, the registry's daily alarm finds it within a few days: it asks each computer it
counts that hasn't been in use for two days (200 a day at most, those asked longest ago first)
whether its Hub is still there, and lets go of those that aren't. A computer in use that the
registry somehow lost is counted again with its first tally of a day. Workers KV would be cheaper to
read but is eventually consistent, so a cap kept there could be passed; a Durable Object costs one
request per registration.

## Plans

Every computer is on a plan, kept by its Hub (`meta.plan`, `free` when it registers). Its limits
are looked up by plan: the free plan's are the settings above, and any other plan is an entry in
`PLANS` with only what it raises, the free plan's applying to the rest:

```toml
PLANS = '{"plus":{"dayMessages":2000000,"dayMB":10240,"phones":32,"idleDays":365}}'
```

A plan can raise `dayMessages`, `dayMB`, `phones`, `messageKB`, `rate`, `burst` and `idleDays`.
Registration limits are the relay's own. A plan taken out of `PLANS` falls back to the free plan's
limits for the computers on it (their plan stays written down, so putting it back restores them).
So a paid plan later is one entry here and a way to set it, not a change to the relay.

**What a paid plan would raise**, and why only these:

- **The daily allowance** (`dayMessages`, `dayMB`): the free plan's is about 12 hours a day of a
  phone watching a terminal. The people who'd pay are those who watch agents all day, or copy big
  files between computers through the relay. Ten times the free plan costs the project at most
  about $0.80 a month for a computer that uses all of it every day, and counts ten times as much
  towards `RELAY_DAILY_REQUESTS`.
- **Phones and tabs at once** (`phones`): a team watching one computer's agents.
- **How long an unused address is kept** (`idleDays`): a year rather than 90 days.
- Not the size and rate limits, which protect the relay rather than ration it, and never what's
  kept or seen: a paid plan's traffic is end-to-end encrypted and counted exactly as a free one's.
- Later, if it's wanted: a name of your own (`yourname.<domain>`), which needs the registry to map
  names to ids.

**How a computer is put on a plan** (the hook):

```sh
curl -s -X POST https://<domain>/_relay/plan -H "Authorization: Bearer <PLAN_TOKEN>" \
  -H 'content-type: application/json' -d '{"id":"<computer id>","plan":"plus"}'
```

It answers `{ id, plan, limits, today }`. The new limits apply at once; the computer hears its plan
(Settings › Devices says "Plus plan: up to …"), and a day's limit the old plan had reached is lifted
if the new one's isn't. `{"id":"…"}` alone says which plan a computer is on, its limits and today's
use; `"plan":"free"` moves it back. A plan that isn't free or in `PLANS` is refused (400, naming the
plans there are). Each change is counted (`plan` below).

The same hook can hold back a computer that's misusing it, which TERMS.md allows: a plan with no
allowance, `"held":{"dayMessages":0,"dayMB":0}`, set the same way, and its phones are told the
daily limit is used up.

**What billing would add** (not built):

1. A way to pay that's tied to the computer. Its id is public (it's in its address), so a checkout
   can't trust an id it's given: Bridge AI would ask its Hub, with its token, for a short-lived
   code, and open the checkout (Stripe Checkout or Paddle, on boldbridge.ai) with it.
2. A small Worker for the payment provider's webhook, holding `PLAN_TOKEN`: the plan on payment,
   `free` when it's cancelled or a renewal fails.
3. Upgrade and Manage beside the plan line in Settings › Devices, and the dialog for a big copy
   between computers (`src/components/Transfers.jsx`), which assumes the free plan's 512 MB, reading
   the plan the relay sends instead.
4. TERMS.md: the price, renewals and refunds. PRIVACY.md: the payment provider, and what it keeps
   (name, email, card). The relay itself still keeps only the id and the plan.

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

Per computer, in its Durable Object: its id, the token's hash, the Bridge AI version it registered
with, its plan, when it registered and connected last, its paired phones as ids made from each
phone's key (as a personal relay keeps them), today's counts, which of its paired phones were
counted this week (by those ids), and messages a phone sent while the computer was offline, sealed
so the relay can't read them, for 7 days at most. Forget on the computer (Stop using the relay)
deletes all of it at once; otherwise it goes after `IDLE_DAYS`.

The registry, a Durable Object of its own, keeps:

- for registration limits, today's count per network, under a hash of the network's address and
  the date, deleted the next day and never leaving that object;
- for `MAX_COMPUTERS`, each registered computer's id with when it registered, the last day it was
  in use and the last day the registry asked after it, gone when the computer is (How the computers
  are counted);
- for `/_relay/stats`, each day's totals: computers set up and refused, computers in use,
  connections, messages, bytes, limits reached, when the relay reached `RELAY_DAILY_REQUESTS`, and
  that day's ten busiest computers by id with their plan and use. Kept 35 days. Each computer's
  Hub adds its share with each connection, each limit reached, every 1,000 messages or 4 MB, and
  when a connection ends (about one request in 50 on top of what it relays); a Hub put to sleep in
  between forgets at most that much, so these too can come out a little low, never high.

**Counts for the project**, with a Workers Analytics Engine binding (`STATS`; leave it out of the
config and nothing is counted). Each is one data point with the computer's id as its index, and
nothing else: no IP addresses, no content, no user agents, no phone identifiers, no names.

| `blob1` | Written when | Also |
| --- | --- | --- |
| `register` | a computer registers | `blob2`: its Bridge AI version |
| `computer` | a computer connects | `blob2`: its Bridge AI version |
| `phone` | one of a computer's paired phones connects for the first time this week (weeks start Monday, UTC) | `blob2`: the week, as its Monday's date |
| `usage` | every 100 messages or 256 KB, and when a connection ends | `double1`: bytes, `double2`: messages, both incoming |
| `limit` | a limit turns something away | `blob2`: `size`, `rate`, `phones`, `day`, `all` (the whole relay's day) or `shut` (let go for sending on past its day) |
| `plan` | a computer is put on a plan | `blob2`: the plan |
| `removed` | a computer's data is deleted | `blob2`: `forget` or `idle` |
| `refused` | a registration is refused (index empty) | `blob2`: `ip`, `all` or `full` |

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

**One computer at the most it can use** (its 200,000 messages every day): 10,000 requests for the
messages, 200 for its tallies to the registry, 288 for keepalives and about 300 for connections,
so about 10,800 Durable Object requests a day, 324,000 a month; about 75 GB-s of duration a day;
about 2,100 rows written and 1,000 Workers requests a day. About $0.08 a month at Paid rates, before
what's included.

**The whole relay at its worst**: every computer using up its allowance every day of a 30-day
month. Without the relay's own ceiling, that's the computers times the above; with
`RELAY_DAILY_REQUESTS` at 500,000, it's that ceiling:

| `MAX_COMPUTERS` | Without the ceiling: requests, duration | Bill a month | With the ceiling | Bill a month |
| --- | --- | --- | --- | --- |
| 50 | 16.2 million, 112,500 GB-s | $5 + $2.40 = **$7.40** | 15.4 million, about 110,000 GB-s | $5 + $2.25 = **$7.25** |
| 100 | 32.4 million, 225,000 GB-s | $5 + $4.80 = **$9.80** | 15.9 million, about 110,000 GB-s | $5 + $2.25 = **$7.25** |
| 250 | 81 million, 562,500 GB-s | $5 + $12.00 + $12.50 = **$29.50** | 17.2 million, about 110,000 GB-s | $5 + $2.55 = **$7.55** |

In every row, Workers requests (7.5 million at most), CPU, rows written (16 million at most) and
storage stay within what's included. Analytics Engine's data points would pass its 10 million at
250 computers without the ceiling (15 million: $1.25 a month, once it's billed).

**How the ceiling bounds it.** `RELAY_DAILY_REQUESTS` counts what `/_relay/stats` counts: one
request for every 20 messages, one for every 1,000 (the tallies), and three for each connection or
registration. 500,000 a day is at most 15 million a month, and at most 9.8 million messages a day.
On top of it come the keepalives, which nothing but Cloudflare sees (288 a day for each connected
computer: up to 0.86 million a month at 100 computers, 2.2 million at 250), and what each computer
sends before it hears the relay's day is over (under 1,000 messages each). Those 9.8 million
messages a day are about 110,000 GB-s a month at 3 ms each (still inside the included 400,000 at
10 ms each), and about 4 million rows written. So at the defaults the bill stays under about $7.55
a month whatever `MAX_COMPUTERS` is, and each 100,000 a day of `RELAY_DAILY_REQUESTS` adds at most
3 million requests a month, $0.45. `MAX_COMPUTERS` keeps the keepalives and storage small and says
how many people it's for.

**Everyday use** is far below that: an hour or two of phone use a day is about 2,000 requests for
a computer, keepalives included, so 100 computers come to about 200,000 a day (40% of the ceiling)
and 6 million a month: about $0.75 on top of the $5.

**What the limits can't stop.** A request is billed once it reaches the Worker, before the relay can
turn it away, so someone sending floods of requests (to made-up names, or connecting to one
computer's address over and over) costs $0.30 a million past the included 10 million, and $0.15 a
million more for each that wakes a Hub. The rate limiting rule in Going live blocks those at
Cloudflare before the Worker, where nothing is billed (only requests that reach a Worker are). A
computer's own connection can't run on past its day (it's let go after 1,000 messages that go
nowhere). The billing alert says if anything gets through, and the kill switch stops it all.

Storage is tiny (a few kilobytes per computer, plus up to 512 KB of waiting messages per phone for
a week, plus a few kilobytes a day for the registry's counts) and within the included 5 GB.

**When it's time for Workers Paid**: before telling anyone (Going live). On Workers Free,
`/_relay/stats`' `note` says when a day passes 50,000 requests, half of Free's 100,000 (keepalives
aren't in it: about 175 connected computers' come to another 50,000). On Workers Paid
(`WORKERS_PAID = "1"`), it says when the month passes the included million and roughly what the
rest costs; `requests.ceiling` is `RELAY_DAILY_REQUESTS`, and a day's `ceilingAt` says when the
relay reached it. If that happens often, look at `top` for computers near their allowance every
day, and decide between raising it (at most $0.45 a month for each 100,000 a day) and the free
plan's numbers.

## Updating it

Same as going live: build and deploy. Any computer's or phone's connection drops and comes back
within seconds. Computers on the hosted relay never try to update it themselves (they do for a
relay on your own account). Keep `[[migrations]]` as it is: the class and its tag don't change.

## Watching it

**`/_relay/stats`**, with the STATS_TOKEN:

```sh
curl -s -H "Authorization: Bearer <STATS_TOKEN>" "https://boldbridge.app/_relay/stats?days=7"
```

It answers the last 7 days (up to 35 with `?days=`), today (UTC) first. Each day has `registered`
and `refused` (computers set up, and turned away by the registration limits), `computers` (those
that connected or relayed anything), `connections` (`computers`, `phones`), `messages` and `bytes`
(incoming, relayed), `limits` (how many times each was reached; `full` counts registrations turned
away by `MAX_COMPUTERS`, `all` the computers stopped by `RELAY_DAILY_REQUESTS`, `shut` those let go
for sending on past their day), `ceilingAt` (when the relay reached `RELAY_DAILY_REQUESTS`, or
null), `requests` (an estimate of what that comes to in Cloudflare requests, without keepalives),
and `top`: the day's ten busiest computers by id, with their plan, `messages`, `bytes` and
`ofAllowance` (1 is all of it). With them, `computers` (`registered` now, of `max`), `requests` for
today and this month with the `ceiling`, and a `note` on Workers Free or Paid. Nothing in it is an
IP address, a token or anything that passed through.

**Full, or near it**: `computers.registered` close to `max` with `limits.full` above 0 means people
are being turned away. Raise `MAX_COMPUTERS` knowing the Cost table above (the ceiling keeps the
bill where it is, so more computers mean each gets less on a busy day), or leave it.

**A runaway computer** is one at the top of `top` with `ofAllowance` at 1 day after day, or far above
the next. The limits already stop it costing more than its allowance; the last query above shows its
week. If it's misuse, hold it back with a plan (Plans) and, if need be, block its network with a WAF
rule.

**Cloudflare's dashboard** has the exact figures:

- Workers & Pages › bridge-relay › Metrics: requests, errors, CPU time.
- Storage & Databases › Durable Objects › bridge-relay's Hub: requests, duration and storage. These
  are what's billed; `/_relay/stats` is the estimate to read beside them.
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
# a wrangler.toml beside it like wrangler.hosted.toml, with main = "worker.js", no routes, and
# HOSTED_DOMAIN = "localhost"
npx wrangler@4.149.0 dev --local --port 8795
```

Then point a test Bridge AI at it with `"relay": { "hostedUrl": "http://localhost:8795" }` in its
config.json (plain http is allowed only for localhost and 127.0.0.1). Never point a computer you
use at a test relay. `npm test -- relay-hosted` runs the Worker in Node with every limit, plans and
the stats, with nothing reaching Cloudflare, and `npm test -- relay-hosted-ui` shows the app's side
of a full relay (Settings › Devices, first-run setup, `bridge-ai relay setup --hosted`) against it.

## Policy text to add when it goes live

Paste these in the same change that sets `HOSTED_URL`, with `<domain>` filled in. Until then
PRIVACY.md and TERMS.md stay as they are, and stay true for everyone who runs their own relay. The
`relay-hosted` test keeps these in step: each "Replace" must still be word for word in its file,
and pasted in, they must say what the relay sees, keeps, counts and limits.

### PRIVACY.md: the opening paragraph

Replace

> Bridge AI is an open-source app (https://github.com/sahil1/bridge) made of three parts: the app on
> your computer, a relay on your own Cloudflare account, and the phone apps for iPhone and Android.
> The app on your computer sends the project anonymous usage stats and crash reports (below), which
> you can turn off in Settings › About & Updates; nothing else goes to the project or its author. The
> relay and the phone apps send the project nothing. There is no account and no ads.

with

> Bridge AI is an open-source app (https://github.com/sahil1/bridge) made of three parts: the app on
> your computer, a relay (on your own Cloudflare account, or Bridge AI's relay, run by the project),
> and the phone apps for iPhone and Android. The app on your computer sends the project anonymous
> usage stats and crash reports (below), which you can turn off in Settings › About & Updates. If you
> choose Bridge AI's relay, your phone and computer talk through it, end-to-end encrypted, and it
> keeps only what it needs to work (below). Nothing else goes to the project or its author. A relay of
> your own and the phone apps send the project nothing. There is no account and no ads.

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
> Devices. It's the same relay ([relay/worker.js](relay/worker.js)), run by the project on its own
> Cloudflare account at `<domain>`, so the project's Cloudflare account carries your traffic instead
> of yours. Cloudflare processes it for the project.
>
> **What it can read: nothing past the handshake.** Everything between your phone and your computer
> is end-to-end encrypted, so the relay passes on bytes it can't read. That holds as long as the page
> doing the encrypting is the one Bridge AI wrote: the iPhone app has it built in, but in a phone's
> browser the page comes from the relay, so whoever runs the relay could change it. On a relay that
> isn't yours, use the iPhone app. What it sees, as any server does: the IP addresses of your phone
> and computer, when they connect, and how much they send.
>
> **What it keeps for your computer**: a random id (its address there), a hash of the token your
> computer uses to connect (never the token), the Bridge AI version it was set up with, its plan,
> when it registered and last connected, today's message and data counts (for the limits), and, as
> any relay does, your paired phones as ids made from their keys (and which of them connected this
> week), and messages from your phone waiting for your computer, sealed so it can't read them, for 7
> days at most. To limit sign-ups, it also keeps how many computers were set up from each network
> today, under a hash of the network's address and the date, deleted the next day. And because it
> takes a limited number of computers at once, it keeps a list of the computers on it, by their
> random ids, with when each was set up and last used.
>
> **What it counts, for the project**: when a computer registers and connects (with its Bridge AI
> version), how many paired phones connect each week, how much data passes, when a limit is reached,
> and each day's totals with the day's busiest computers' use, kept 35 days. Each is by your
> computer's random id only: no IP addresses, no content, no names. The full list is in
> [relay/HOSTED.md](relay/HOSTED.md).
>
> **Its limits**: it's free, with a daily allowance for each computer (200,000 messages or 512 MB,
> starting again at 00:00 UTC; Settings › Devices shows it) and limits that stop floods (how big one
> message can be, how many come at once, how many phones and tabs are connected at once). It takes a
> limited number of computers, and when it's full, Bridge AI says so and offers the other ways (a
> relay of your own, or Tailscale). It also has a daily limit for all the computers on it together;
> if that's reached, it stops for everyone until 00:00 UTC. When a limit is reached, your phone and
> Settings › Devices say which, and when it ends. The limits may change, and paid plans with higher
> ones may come; anything a paid plan would keep or send elsewhere (to take payment) will be said
> here first.
>
> **Stop using it** (Settings › Devices › Stop using the relay) and your computer's data there is
> deleted at once (should that message not arrive, its id leaves the list of computers within a few
> days). A computer that hasn't connected for 90 days is deleted the same way. Everything else in
> this policy, including what Cloudflare sees, applies to it as to a relay of your own, except that
> it's the project's Cloudflare account.

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
> account of your own. It's free, with fair-use limits for each computer (a daily allowance of
> messages and data, and limits that stop floods). It takes a limited number of computers, so it may
> be full when you ask, and it has a daily limit for all of them together, past which it stops for
> everyone until the next day. The project may change those limits or offer paid plans with higher
> ones; it will say so here and in the app before charging for anything. It's provided as is, like
> the rest of Bridge AI: it may be slow, be full, go down, change, or stop, with or without notice.
> If you need it to be dependable, set up a relay on your own Cloudflare account instead.
>
> Use it only for Bridge AI, as Bridge AI uses it. Don't use it to pass on anything else, to get
> around its limits, to disturb other people's use of it, or for anything unlawful. The project may
> remove a computer from it, hold it back, or block a network, if it's misused.
