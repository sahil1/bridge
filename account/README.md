# Bold Bridge accounts

For whoever runs it. Everyone else can ignore this file: Bridge AI works without an account, and
setup never asks for one.

[worker.js](worker.js) is a Cloudflare Worker at `https://accounts.boldbridge.ai`, run once by the
project: the account a person signs into with their email, one per email, for the two things Bold
Bridge runs for them, **Early Access** and **Bridge AI's relay**. [API.md](API.md) is the contract it
keeps with the relay, Bridge AI (server/account.js, Settings › Account) and the admin view.

## What it does

- **Sign-in is an email and a 6-digit code**, sent from `accounts@boldbridge.ai` by Cloudflare's <!-- private-ok: the service's own sending address -->
  Email Service. A code lasts 10 minutes and allows 5 tries, each wrong one counted in the same
  statement that checks it (so guesses sent all at once are held to 5 too), and the right one is used
  up once; an email gets at most 5 codes an hour, a network (IPv4 /24, IPv6 /48) at most 20, and the
  website's form 5 requests an hour per network. After 20 wrong codes in a day, an email gets no codes
  for a day (where it's signed in already, nothing changes). `THROWAWAY` in worker.js is a short list
  of throwaway domains, refused, saying why. An email's first sign-in makes its account, and each
  device signed in after that is said in an email to it. A suspended account's email is answered as
  any other's (whoever asked can't tell), and the email says it's suspended, with no code.
- **At most 5 devices**, computers and phones. A sixth sign-in is refused with the list, and the same
  code can then remove one to make room.
- **Tokens**, signed with Ed25519 (`SIGNING_KEY`): a device token (180 days), a relay token for a
  computer whose account may use the relay (7 days), and an Early Access code for a tester's
  computer (30 days, in `server/earlyaccess.js`'s format, for the account's id). `GET /v1/me` renews
  each past half its life. The relay and Bridge AI check them offline with the public half.
- **Linked computers follow**: a computer signed in can hand another of the person's computers a
  one-time grant (5 minutes) over the link between them, and that one signs in with it.
- **Requests**: Early Access and the relay are asked for (in Bridge AI, or the form on boldbridge.ai,
  which confirms the email with a code first), and an admin says yes or no in the admin view. The
  emails in `ADMINS` get a short note for each request.
- **What's kept**, in D1: each account's email, flags (`tester`, `relay`, `status`) and when it was
  made; its devices (name, computer or phone, platform, when added and last seen, a hash of the
  token); its requests; its history (what was done, by whom, with a note); the relay's last report of
  its use and its use by day (90 days). Codes are kept as hashes until used or ended; codes sent in
  the last hour, under a hash of the email and of the network, for an hour; wrong codes, under a hash
  of the email, for a day. Never anything from the person's computer. The Worker's logs are off
  (`[observability]` in [wrangler.toml](wrangler.toml)), so it keeps no log of requests; Cloudflare
  keeps its own for the zone, as for any site (its analytics, and the rate limiting rule's security
  events: each request it blocked, with its IP address and path, for a while).
- **Deleting an account** (`DELETE /v1/account`) deletes all of that at once. The relay forgets its own
  counts within a day.

The tables are made the first time they're needed. Once a day (the cron), codes, grants, the hour's
counts and the day's wrong codes that ran out go, and the relay's use by day after 90 days.

## How the admin view and the relay bind to it

Only the public routes (`/v1/...`) are on `accounts.boldbridge.ai`; `/admin/...` and `/internal/...`
answer 404 there. They're on the Worker's named entrypoints, which a service binding can name and
nothing on the internet can reach: `Internal` (the admin view's: `/admin` and `/internal`) and
`Relay` (the relay's: `/internal` only, so a relay Worker that was taken over still can't reach the
admin routes). Any address works through them (the host isn't looked at).

- **The admin view** (boldbridge.ai/admin, in the private repo), in its own wrangler config:

  ```toml
  [[services]]
  binding = "ACCOUNTS"
  service = "bridge-accounts"
  entrypoint = "Internal"
  ```

  and calls `env.ACCOUNTS.fetch('https://accounts.boldbridge.ai/admin/…', { headers: { 'X-Admin-Email': <the signed-in admin> } })`.
  Whoever can deploy a Worker on the project's Cloudflare account can bind to it, so that's who
  the admin routes are open to; the admin view decides which signed-in people are admins.
- **The relay** ([relay/wrangler.hosted.toml](../relay/wrangler.hosted.toml)) binds to `Relay`
  instead (`entrypoint = "Relay"`), for `GET /internal/status?a=&d=` and `POST /internal/usage`.

## Settings

All in `[vars]` of [wrangler.toml](wrangler.toml).

| Variable | Default | What it does |
| --- | --- | --- |
| `FROM` | `accounts@boldbridge.ai` <!-- private-ok: the service's own sending address --> | The address codes and notices come from. Its domain is onboarded on Email Service. |
| `ADMINS` | | Emails (comma separated) that get a short note for each request. Empty: requests are only in the admin view. |
| `SITE` | `https://boldbridge.ai` | The website, whose form may ask for Early Access or the relay (`/v1/request-public`, the only route open to another origin). |
| `RELAY_MAX_ACCOUNTS` | `500` | The relay's `MAX_ACCOUNTS`, the same number: approving the relay for one account more is refused as full. `GET /admin/stats` says it as `relayMax`. |
| `OLD_KEYS` | | The public halves of keys the service signed with before, comma separated: the device tokens they signed still work until they end, and `GET /v1/me` replaces each with one the new key signs. Empty but while the key is being changed (Changing the signing key). |

One secret, set with `npx wrangler@4.149.0 secret put SIGNING_KEY -c account/wrangler.toml` and never
in the file: `SIGNING_KEY`, the Ed25519 private key every token is signed with, as PKCS #8 PEM.

## Going live

In this order, on the project's Cloudflare account, from the repo on the computer releases are made
on, with boldbridge.ai already a zone there, and the account and the domains set up as below first
(The account and the domains): wrangler deploys with the scoped API token
(`CLOUDFLARE_API_TOKEN=<it> npx wrangler@4.149.0 …`), not `wrangler login`. The relay
([relay/HOSTED.md](../relay/HOSTED.md)) goes live after this, since it binds to it.

1. **Workers Paid** (Workers & Pages › Plans, $5 a month): Email Service sends to anyone only on
   Workers Paid. The relay needs it anyway.
2. **The sending domain**: Compute › Email Service › Email Sending › Onboard Domain › boldbridge.ai ›
   Done. Cloudflare adds what sending needs: MX records on the `cf-bounce` subdomain for bounces, a
   TXT record for SPF, one for DKIM, and DMARC on `_dmarc.boldbridge.ai`; it usually takes 5 to 15
   minutes. If boldbridge.ai has an SPF or DMARC record already (another mail service), merge them
   rather than keep two.
3. **The key**: `node account/key.js`. It makes the key pair once, keeps the private key in
   `~/.config/bridge-ai/accounts-key.pem` (put a copy in a password manager; never in the repo), and
   prints the public key and the commands for the next steps.
4. **The database**: `npx wrangler@4.149.0 d1 create bridge-accounts`, then put the `database_id` it
   prints into [wrangler.toml](wrangler.toml).
5. **The settings**: your email in `ADMINS` (or leave it empty), and `RELAY_MAX_ACCOUNTS` the same as
   the relay's `MAX_ACCOUNTS`.
6. **Deploy**, then the secret:

   ```sh
   npx wrangler@4.149.0 deploy -c account/wrangler.toml
   npx wrangler@4.149.0 secret put SIGNING_KEY -c account/wrangler.toml < ~/.config/bridge-ai/accounts-key.pem
   ```

   The custom domain makes the DNS record and certificate for `accounts.boldbridge.ai` itself.
7. **The rate limiting rule** (required, before anyone is told the address): boldbridge.ai ›
   Security › WAF › Rate limiting rules › Create rule. When incoming requests match: Hostname equals
   `accounts.boldbridge.ai`. With the same characteristics: IP. When rate exceeds 30 requests per
   10 seconds, Block for 10 seconds (the Free plan's one rule does it). The Worker's own limits (5
   tries a code, 20 wrong codes a day for an email, codes an hour for an email and a network) are
   counted in D1, after the Worker has run; this turns a burst from one address away before it does,
   where nothing is billed, and keeps a burst of guesses from reaching D1 at all. Bridge AI's own use
   is far below it.
8. **Check it**: `https://accounts.boldbridge.ai/` sends a browser to the privacy policy;
   `curl -s -X POST https://accounts.boldbridge.ai/v1/code -H 'content-type: application/json' -d '{"email":"x"}'`
   answers `{"error":"That doesn't look like an email address…","code":"invalid"}`;
   `https://accounts.boldbridge.ai/admin/stats` is a 404. Then ask for a code to your own email, and
   it arrives. 40 requests in a few seconds from one computer (`for i in $(seq 40); do curl -s -o
   /dev/null -w '%{http_code} ' https://accounts.boldbridge.ai/; done`) end in 429s: the rule is on.
9. **The public key in the relay**: `ACCOUNTS_PUBLIC_KEY` in relay/wrangler.hosted.toml (`node
   account/key.js --public` prints it again), and go live with the relay (HOSTED.md).
10. **The admin view**: its binding, as above, and deploy it.
11. **To point one computer at another accounts service** (a test one, say), put this in that
    computer's `~/.bridge-ai/config.json`: `"account": { "url": "https://accounts.boldbridge.ai", "publicKey": "<the public key>" }`.
    Settings › Account appears; sign in, ask for Early Access, approve it in the admin view, and
    About & Updates says Early Access is on with your account.
12. **Ship it**: in server/account.js, set `ACCOUNTS_URL = 'https://accounts.boldbridge.ai'` and
    `ACCOUNTS_PUBLIC_KEY` to the public key, with the account's sections in PRIVACY.md and
    TERMS.md, in the same commit. Then `npm test -- account-service relay-hosted privacy-hosts`, and
    release. Without that commit, nothing about accounts shows in the app.
13. **Turnstile, once there's a site key** (owner, then a change here): Cloudflare › Turnstile › Add
    widget, for the hostname `boldbridge.ai`, Managed. Its site key goes in the website's form; its
    secret key becomes a Worker secret here (`TURNSTILE_SECRET`); and worker.js then checks the
    form's token (`cf-turnstile-response`) with Turnstile's siteverify before `/v1/request-public`
    sends a code, refusing one that doesn't pass. Bridge AI's own sign-in (Settings › Account, which
    calls `/v1/code`) is served by each computer itself, not boldbridge.ai, so it needs a widget
    of its own thought through first; until then it rests on the limits and the rate rule (step 7).

### The account and the domains

Before the steps above, and kept up after, since whoever has the Cloudflare account or a domain can
sign anyone in, or serve every phone a changed relay page:

- **The Cloudflare account**: every member signs in with a hardware security key (Manage Account ›
  Members, two-factor required for all, each member's own key added under My Profile ›
  Authentication). Deploys use an API token made for them (My Profile › API Tokens › Create, from
  the Edit Cloudflare Workers template with D1 Edit added, for this account and the boldbridge.ai
  and boldbridge.app zones only), kept in a password manager and given to wrangler as
  `CLOUDFLARE_API_TOKEN`, rather than `wrangler login`, which can do anything on the account. And
  alerts from the Audit Log for Worker deploys, secrets and routes changing (Manage Account ›
  Notifications, or a Logpush job of the Audit Log to somewhere watched), so a change nobody meant
  to make is seen the same day.
- **DNSSEC and the registrar lock** on boldbridge.ai (and boldbridge.app, HOSTED.md): DNS ›
  Settings › DNSSEC › Enable (with Cloudflare Registrar the DS record goes to the registry by
  itself; elsewhere, add it at the registrar), and the registrar lock on, so neither domain can be
  moved away or answered by anyone else.
- **CAA records** on boldbridge.ai: one `CAA @ 0 issue "<authority>"` for each certificate authority
  Cloudflare's Universal SSL uses (its docs list them: at the time of writing `letsencrypt.org`,
  `pki.goog` and `ssl.com`), and `CAA @ 0 iodef "mailto:<your email>"`. Then check SSL/TLS › Edge
  Certificates still shows each certificate Active.
- **HSTS** on boldbridge.ai, subdomains included: SSL/TLS › Edge Certificates › HTTP Strict
  Transport Security › Enable, Max Age 12 months, Apply HSTS policy to subdomains on (every name
  under boldbridge.ai serves HTTPS: the website, accounts, the admin view). boldbridge.app is
  HTTPS-only already (`.app` is preloaded).
- **Branch protection on the private repo's `main`**, since a push to it deploys the admin view:
  GitHub › the repo › Settings › Branches › a rule for `main` (a pull request needed, no force
  pushes, no deleting it).

## Cost

On Workers Paid, which the relay needs anyway. Each sign-in is about five Worker requests and a few
dozen D1 rows, so even 10,000 sign-ins a month are far inside Workers Paid's 10 million requests and
D1's included rows (25 billion read, 50 million written). Each Bridge AI signed in asks `GET /v1/me`
about 4 times a day: 500 accounts with 5 devices each come to 300,000 requests a month. The relay
reports each account's use every 5 minutes while it's used: at most 4.3 million a month for 500
accounts, through the service binding, which isn't billed as requests. Email Service includes 3,000
emails a month, then $0.35 a thousand: codes are at most 5 an hour per email, so a flood of
sign-ins costs little, and the WAF rule above stops one network sending it.

## Changing the signing key

Each token says which key signed it (`kid`, API.md, Tokens), and everything that checks one takes a
list, so the key can be changed without anyone signing in again: if it may have been seen, or now
and then.

1. **A new key**, kept beside the old: `node account/key.js --key ~/.config/bridge-ai/accounts-key-2.pem`
   (and a copy in a password manager), and its public half: `node account/key.js --key
   ~/.config/bridge-ai/accounts-key-2.pem --public`.
2. **Everything that checks tokens takes both**, the old key first: the relay's
   `ACCOUNTS_PUBLIC_KEY = "<old>,<new>"` (deploy it, HOSTED.md), and in Bridge AI,
   `ACCOUNTS_PUBLIC_KEY = '<old>,<new>'` in server/account.js, in a release. Wait until most
   computers have that release (the Early Access codes the new key signs are checked there).
3. **The service signs with the new one**: `OLD_KEYS = "<old>"` in wrangler.toml and deploy, then
   `npx wrangler@4.149.0 secret put SIGNING_KEY -c account/wrangler.toml < ~/.config/bridge-ai/accounts-key-2.pem`.
   From then on each device's next `GET /v1/me` (within 6 hours, or when Settings › Account opens)
   gives it a device token, relay token and Early Access code the new key signed.
4. **The old one goes** once what it signed has ended: relay tokens after 7 days, Early Access codes
   after 30, device tokens after 180 (a device not seen for that long signs in again). Take it out of
   `OLD_KEYS`, the relay's `ACCOUNTS_PUBLIC_KEY` and server/account.js's, and delete its file. If it
   was taken out because it may have been seen, don't wait: take it out of all three at once, and
   devices that haven't asked since sign in again.

## Running your own

A fork can run its own on its own Cloudflare account: change `name`, the route and `FROM` in
wrangler.toml, onboard its own sending domain, make its own key, and point its build at it
(`ACCOUNTS_URL`, `ACCOUNTS_PUBLIC_KEY` in server/account.js), with its relay's `ACCOUNTS_PUBLIC_KEY`
and binding to match. `PRIVACY` in worker.js is where a browser opening the address goes.

## The policy's account sections

PRIVACY.md and TERMS.md each have a "Your Bold Bridge account" section: what an account keeps and
sends, and how to delete it. The `account-service` test fails if `ACCOUNTS_URL` is set without them.
