# Bridge AI's usage counts and crash report server

For whoever runs it. Everyone else can ignore this file: Bridge AI sends nothing here unless you turn
on **Share anonymous usage counts** or **Send crash reports by themselves** (Settings › About &
Updates; each off unless you do), or click **Send to Bold Bridge** on a crash's report.

[worker.js](worker.js) is a Cloudflare Worker at `https://counts.boldbridge.ai`, run once by the
project. Each Bridge AI with sharing on sends it one report per week, once the week is over
([server/counts.js](../server/counts.js)): `POST /v1/week`, JSON, as
[shared/telemetry-schema.json](../shared/telemetry-schema.json) describes it.

## What it does with a report

- **Checks it against the public list.** A name that isn't on it, or a value that isn't one of its
  ranges, is dropped. Something unknown about the install (an operating system, a version that
  isn't `x.y.z`) is kept as `other`, or `unknown` when the report doesn't say. A report that isn't
  JSON, has no nonce, or isn't for one of the last ten weeks is turned away (400), and so is one over
  16 KB (413).
- **Counts it once.** Its nonce (random, new for each report) is kept for ten weeks; the same nonce
  again is answered `{ ok: true, duplicate: true }` so Bridge AI stops sending it, and nothing is
  added. Bridge AI tries a week for up to eight weeks, so ten covers every retry.
- **Keeps only weekly totals**, in D1:
  - `reports`: one row per week and combination of answers (version, OS, chip, how it's installed,
    layout, runtime, phone paired, how long installed, days used, time in use and time running,
    each a range), with `n`, how many reports said exactly that.
  - `counts`: one row per week, counter, range, OS and how long installed, with `n`.
  - `seen`: the nonces of the last ten weeks, with the day each arrived.

  A report as it came is never stored. The IP address isn't read, and the Worker's logs are off
  (`[observability]` in [wrangler.toml](wrangler.toml)), so nothing about who sent a report is kept.

The tables are made the first time a report arrives. Once a day (the cron in wrangler.toml), nonces
older than ten weeks go.

Anyone can post a report, so the totals are as good as what's sent: a determined person could add
made-up weeks. That's the cost of having no IDs. A Cloudflare rate limiting rule on the zone
(below) keeps one network from adding many.

## Crash reports

The same Worker answers at `https://crashes.boldbridge.ai` (`POST /v1/report`, JSON, as
`crashReports` in [shared/telemetry-schema.json](../shared/telemetry-schema.json) describes it):

- **Checked**: a kind of crash it knows (`ui`, `server`, `window`, `gpu`), a title and details, at
  most 32 KB; the version and system as for counts (`other` when unknown).
- **Stripped again**: the computer already took out names, folders, emails and keys; the server runs
  the same code ([shared/crashreport.js](../shared/crashreport.js)) over the title, what the person
  wrote and the details, without the names only the computer knows.
- **Grouped**: a fingerprint of the kind, the error's first line and the first frames of the stack,
  with line numbers and other numbers taken out, so the same crash in another version or another
  place in a file is one group.
- **Kept 90 days** in `crash_reports` (id, day, version, system, kind, fingerprint, title, what,
  details), then deleted by the daily cron. No IP, no ID for the sender.
- **At most `CRASHES_PER_DAY` a day** (1,000): past that, 429, and Bridge AI lets the report go.
- **`CRASHES_OFF`** answers every report `{ stop: true, why }`, as `COUNTS_OFF` does for the counts:
  Bridge AI turns crash reports off and shows why.

The admin view (the project's planning repo, `admin/`) lists them by group.

## The kill switch

Set `COUNTS_OFF = "1"` (or a sentence of your own, shown in Bridge AI's Settings) in wrangler.toml
or the dashboard's Settings › Variables, and deploy. Every report is then answered `{ stop: true,
why }`: Bridge AI turns sharing off, forgets what it hadn't sent, and shows the reason. Nothing kept
is deleted. People turn sharing on again themselves once it's back on.

## Going live

From the repo, signed in to the project's Cloudflare account (`npx wrangler@4.149.0 login`), with
boldbridge.ai already a zone on that account:

1. **The database**: `npx wrangler@4.149.0 d1 create bridge-counts`, then put the `database_id` it
   prints into [wrangler.toml](wrangler.toml).
2. **Deploy**: `npx wrangler@4.149.0 deploy -c counts/wrangler.toml`. The custom domains make the
   DNS records and certificates for `counts.boldbridge.ai` and `crashes.boldbridge.ai` themselves.
3. **Check it**: `https://counts.boldbridge.ai/` shows what it is, and
   `curl -s -X POST https://counts.boldbridge.ai/v1/week -H 'content-type: application/json' -d '{}'`
   answers `{"ok":false,"error":"No schema number"}`.
4. **Optional, against floods**: Security › WAF › Rate limiting rules, one rule for hostnames
   `counts.boldbridge.ai` and `crashes.boldbridge.ai`: 20 requests per 10 seconds from one IP, then block for 10 seconds
   (Cloudflare applies it; the Worker never sees the IP).
5. **Ship it**: the `endpoint` in shared/telemetry-schema.json is already this address, so the next
   release offers sharing. Releases made before it don't.

**When the public list changes** (a new counter in shared/telemetry-schema.json), deploy again, or
the server drops the new name until it is.

## Reading the totals

```sh
npx wrangler@4.149.0 d1 execute bridge-counts --remote --command \
  "SELECT week, SUM(n) AS reports FROM reports GROUP BY week ORDER BY week DESC LIMIT 12"
npx wrangler@4.149.0 d1 execute bridge-counts --remote --command \
  "SELECT name, bucket, SUM(n) AS reports FROM counts WHERE week = '2026-W45' GROUP BY name, bucket ORDER BY name"
```

The project's weekly report (in its private planning repo) reads the same tables.

## Cost

D1's free allowance is 100,000 rows written a day; a report writes one row per counter it has plus
two, so about 3,000 reports a day before any cost. The Worker answers each in one request.
