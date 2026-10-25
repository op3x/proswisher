# ProSwisher

Transparent pro basketball game predictions with a public, append-only track record.
Web-only (no app-store packaging). Vite + React + TypeScript + Tailwind, served as static files.

## How it works
- Data sources sit behind a small interface in `scripts/providers.py` (Kiko, Larry memo 20): `ScheduleProvider`
  (`balldontlie-free`: balldontlie Free tier games endpoint, `BALLDONTLIE_API_KEY`) and `OddsProvider`
  (`odds-api-free`: The Odds API free tier, `ODDS_API_KEY`; only derived fields leave the provider: median home line,
  number of books, time recorded). Free tiers only; swap vendors/tiers there without touching callers. No ESPN or other
  unlicensed feeds. A 401/403 (or repeated 429) raises `SourceBlocked`: the run stops with exit 3 and is reported, never routed around.
- `scripts/update_data.py` builds team ratings (point differential blended with last season), projects every game in the
  next 7 days, **appends new predictions to the private full log before tip-off** (never edited afterwards) and grades them
  once games are final. Without `BALLDONTLIE_API_KEY` it fetches and writes nothing.
- Larry P6: the full log (`PREDICTIONS_PRIVATE_DIR/predictions-full.json`) is never public or committed. The public
  `predictions.json` holds the featured game, every game that has tipped off, and a `sealed` hash commitment
  (sha256 of nonce + pick fields) for every other logged pick, revealed with its nonce at tip-off. Members get
  upcoming picks from the gated `GET /api/predictions`. The pipeline therefore runs on the server
  (see *First data run* below), not in GitHub Actions; `ops/update-stats.yml` now only runs tests.
- `public/data/*.json` in the repo are empty skeletons (reset 2026-10-25; earlier preview data came from an unlicensed feed).
- All copy is in `src/config/site.ts`, `src/config/commerce.json` and `src/content/*.md` (Larry's legal drafts).

## Run
```
npm ci && npm run data && npm run dev      # local
npm run build && PORT=3000 npm start       # production-style static serve (honors PORT)
```

## Environment (names only)
See `.env.example` for every variable and its purpose. No values are committed anywhere.

## Pick log guarantees

- The full log is append-only: a game is logged only while its state is `pre` and tip-off is in the future;
  locked fields (pick, probability, spread, total, timestamps, nonce, commitment) are never rewritten and no entry is ever removed. The script refuses to write if that would change.
- Entries are graded automatically once the game is final. Sealed commitments published before tip-off prove the pick wasn't changed.
- `python3 -m unittest discover -s tests` runs offline checks with fake providers (log before tip, seal/reveal, derived-only odds, grade after final, immutability, no-key = no writes, blocked source stops).
- The W-L summary appears only on the Track record page, always covering the full log since launch, with the date range, a link to the full log and "Past results do not guarantee future results".

## Pricing / free tier (stub)

$9/month, free tier of 1 game per day. Gating (`src/lib/access.ts`) is inert while payments are off, so every game is visible.
Geoblock (`src/lib/geoblock.ts`): WA, HI, UT, Japan, by IP and billing ZIP/country, ON by default (`geoblock.enabled` in `src/config/site.ts`); it must run server-side once checkout exists.

## Grading (Larry, round 2)
- At post time (before tip-off) each log entry stores our pick, projected score/spread/total, and — when
  `ODDS_API_KEY` is set — the **market** point spread (median home line across US
  books from The Odds API, a licensed aggregator; no sportsbook scraping) with its source and the time recorded,
  plus our ATS lean vs that line.
- When final: **Winner** (did our favored team win) and **ATS** (did our lean cover the market spread). Never
  graded against our own projected spread. Pushes and postponed games are shown, not counted.
- `result`, `marketSpread`, `atsLean`, `projScore` are set once and immutable; the pipeline aborts if any change.
- Without `ODDS_API_KEY`, only the Winner grade is recorded and the track record says so.

## Free tier (9:38 decision)
- One **featured** game per day (earliest tip-off, CT day; ties by game id) shows its full prediction publicly.
  Other games show the matchup plus a disabled "Get every game: $9/month" CTA stub (`pricing.freeTier.gatingEnabled`).
- Track record: the featured game's row appears when posted; other rows appear at tip-off (pre-tip timestamps
  still prove they were posted before the game). Every pick ends up listed; nothing is removed.
- Caveat: this is a static site, so `/data/*.json` and the repo expose every prediction. Gating is cosmetic
  until a server/API serves gated predictions (needs accounts + payments, out of scope here).

## Server (server/index.mjs)
A small Express server serves the static build plus a few endpoints. It runs with **no keys at all**; payments then report disabled.

| Route | Purpose | Geo-checked |
|---|---|---|
| `GET /health` | Railway healthcheck | never |
| `POST /api/stripe/webhook` | Stripe `checkout.session.completed` (signature verified with `STRIPE_WEBHOOK_SECRET`) | never |
| `GET /api/config` | `{payments:{enabled}}` for the UI | no |
| `GET /subscribe` | paid sign-up page (451 block page if GeoIP-blocked) | **yes** |
| `POST /api/checkout` | creates a Checkout Session (`mode=subscription`, `billing_address_collection=required`) | **yes** (+ declared billing country/state) |
| `GET /api/me`, `POST /api/portal` | membership status / Stripe customer portal (cancel any time) | no |
| `POST /api/v`, `GET /go/subscribe` | cookieless counting / CTA click counter + 302 to `/subscribe` | no |
| `GET /admin/stats` | counts; `Authorization: Bearer $ADMIN_TOKEN`; 404 when unset | no |

## Payments (Stripe Billing, TEST mode in preview)
- Enabled only when `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_ID` are all set. `APP_ENV=preview` accepts only `sk_test_`/`rk_test_`; a live key anywhere stops the build/server (`scripts/guard.mjs`). Production needs a live key **and** `STRIPE_LIVE_ENABLED=true`.
- The code never creates products or prices. At startup it checks the configured price is active, monthly, and matches `src/config/commerce.json` (900 usd); otherwise payments stay off.
- Membership = a completed Checkout Session whose subscription is active **and** whose subscription metadata says `billing_check=passed` (set only by the webhook, below). The session id is kept in the browser's localStorage (no cookies). Revocations are in memory plus the canceled Stripe subscription (no database).

## Geoblock (server/geo.mjs, src/config/geo.json)
Blocked: JP; US-WA, US-HI, US-UT. Larry's ruling (Oct 25, 10:24 CT) splits it by surface:
- **Public pages are always open**, whatever the IP or the GeoIP database state. GeoIP is never consulted for them.
- **Paid sign-up (`/subscribe`) and checkout fail closed:**
  - GeoIP = MaxMind GeoLite2 City, downloaded at start and weekly with `MAXMIND_LICENSE_KEY` (never committed; `geoip/` is gitignored).
  - **DB missing, or older than 45 days** (`GEO_MAX_AGE_DAYS`, from the DB's build date; MaxMind rebuilds twice a week and we refresh weekly, so 45 days means the refresh has been broken for over a month) => checkout disabled. `/api/config` reports `checkout.available=false`, `/subscribe` shows "temporarily unavailable", `POST /api/checkout` answers 503. Public pages keep working.
  - **IP unknown or unresolvable** (not in the DB, no country, or a US IP with no state) => HTTP 451 with exactly "We couldn't confirm your location. Please turn off any VPN or proxy and try again." No Checkout Session.
  - Blocked IP country/state => 451 with Laye's copy (`geoBlockCopy`).
- **Pre-charge check** (`POST /api/checkout`): a required country/state picker with no default. The server refuses a blocked choice (`checkoutBilling` text) and a choice that doesn't match the IP's country/state (VPN text). Only then is a Checkout Session created, with `billing_address_collection: "required"`.
- **Webhook** (`checkout.session.completed`): checks Stripe's collected billing address. Passed => sets subscription metadata `billing_check=passed`, the only path to paid access. Blocked => refunds the first payment, cancels the subscription immediately, revokes access and logs it.
- Client IP: we trust exactly `TRUSTED_PROXY_HOPS` X-Forwarded-For entries from the right (default 1 = Railway's edge). With fewer entries than that (app reached without the proxy), a non-IP entry, or `TRUSTED_PROXY_HOPS=0`, the socket address is used. Logs record country/region only.
- Refusal JSON is `{ error, message }` and never includes the support address while P11 holds.
- **`GEO_PREVIEW_BYPASS=true`** (preview only) skips the IP checks so test checkouts work from anywhere. The declared-location blocklist and the webhook billing check still apply. With `APP_ENV=production` it is never honored: `scripts/guard.mjs` and `createApp` refuse to start.

### Pre-charge location check: post-launch TODO
Today a buyer whose collected billing address is blocked is charged and then refunded automatically. **TODO (post-launch):** switch to Checkout `mode: "setup"`, check the collected billing address server-side, and only then create the subscription server-side, so a blocked buyer is never charged. No Stripe Radar purchase is planned for this. See the TODO in `server/payments.mjs`.

## Counting (server/counter.mjs): OFF by default
First-party and cookieless, with no third-party analytics, trackers or pixels. It counts **only if `COUNTING_ENABLED=true`**; otherwise `/api/v` and `/go/subscribe` count nothing and `/api/config` tells the client `counting: false`, so no beacon is sent. Hardened per Larry memo 21 (R1–R9):
- **R1:** identity is `sha256(dailySalt ‖ truncatedIP ‖ 0x00 ‖ UA)`, keeping 128 bits. The IP is cut to /24 for IPv4 and /48 for IPv6 *before* hashing.
- **R2:** the salt is 256 random bits held only in memory. It is replaced by an unref'd timer at each America/Chicago midnight, and on restart. It is never logged, saved or reported.
- **R3:** only per-day counts are persisted: unique visitors, featured-game viewers, CTA clicks, and UTM visitors and clicks per allowlisted combo. Featured viewers per week is the sum of the daily uniques.
- **R4, retention:** ids, sessions and UTM sets last at most one CT day. Per-link UTM rows older than 30 days are rolled up into monthly per-campaign totals, with `utm_content` dropped. Daily totals and rollups older than 25 months are deleted on every flush.
- **R6, UTM:** only the combos in `src/config/commerce.json` `utmAllowlist` are kept. That list holds Laye's psw_launch_2026 tags; anything else counts as `other`. `/admin/stats` (Bearer `ADMIN_TOKEN`) shows UTM cells under 5 as `<5`. Rule: never put a person's name, handle or email in a UTM, and never give one person a unique tag.
- **R7 and R8:** these visitors are never counted:
  - visitors that the local GeoLite2 DB places in the EEA, UK or CH (no DB means they are counted);
  - requests that send `Sec-GPC: 1` or `DNT: 1`. The client also skips the beacon on `navigator.globalPrivacyControl` or `doNotTrack`.
- **R5:** no log line carries an IP, XFF, remoteAddress or UA; `tests/server/privacy-guard.test.mjs` fails the build if one does. Railway's own edge logs still record IP and path for up to 90 days, and the privacy text says so.
- Storage is in memory, flushed to `$STATS_DIR/counts.json` every 5 minutes if `STATS_DIR` is set. That needs a Railway volume, and none has been created.

## Membership reference and consent retention
- **R9:** the client sends the Checkout Session id in the `X-PS-Session` header, never in a URL. That applies to `GET /api/me` and `GET /api/predictions`, and `POST /api/portal` takes it in the body. The only time it appears in a URL is Stripe's success redirect (`/account?session_id=…`), which the page removes from the address bar right away.
- **R4(d):** consent records keep the raw IP for the subscription's life plus 4 years. `server/consent-purge.mjs` runs daily inside the server (when `CONSENT_DIR` is set and payments are on), or on demand with `npm run purge:consent`. After the retention period it sets `consent_ip` to null in `consent.jsonl` and to `""` on the Subscription's metadata (`subscriptions.update`).
- **Larry ruling 3:** the IP is written only to the Subscription's metadata and `consent.jsonl`, never to the Checkout Session's metadata. A completed Session's metadata can't be edited, so it could never be purged there.
- **Manual cleanup step (purge runbook):** Sessions created by builds before this rule may still carry `consent_ip`. Run `railway run npm run consent:sessions-with-ip` (read-only; it uses `checkout.sessions.list` and needs *Checkout Sessions: Read* on the restricted key). It prints only Session ids and dates, never the IP. If it lists any, ask Stripe support to redact that metadata, and record the request next to `consent.jsonl`. Run it once now, and again after any rollback to an older build.
- **Consent text version:** every consent record (`consent.jsonl`, Session and Subscription metadata) carries `text_version` = `terms-v1,privacy-a2,privacy-b1`. That value is read from the `Version:` lines of the same `src/content` files the pages render, and a test enforces it.

## Legal effective dates (Larry's date rule)
- The pages show `Effective: {date}` only in production. The date comes from release-time Railway variables, in `YYYY-MM-DD` form: `LEGAL_EFFECTIVE_TERMS`, `LEGAL_EFFECTIVE_PRIVACY_A`, `LEGAL_EFFECTIVE_PRIVACY_B` and `LEGAL_EFFECTIVE_REFUND`. It is rendered as "October 26, 2026" (US Central calendar day).
- Set each variable on the day that version first goes live in production. If a variable is unset, or the app runs in preview, the page says **"Effective on launch"**. Nothing is hard-coded.
- Privacy §B and the refund page stay unpublished: §B renders only when payments are on, and there is no refund page yet. They get their own dates on the day checkout opens.
- Version strings: terms-v1, privacy-a2, privacy-b1. Superseded texts are kept in `legal/archive/`.

## First data run (runbook)
The image ships python3 (`railpack.json` adds Python 3.12 to the Node build). On every start the server logs `[pipeline] python3 available: Python 3.12.x`, then runs `scripts/update_data.py`, and repeats every `PIPELINE_INTERVAL_MIN` minutes (default 60).
- **No keys:** it logs `[pipeline] skipped: BALLDONTLIE_API_KEY is not set …` once and does nothing more. The server keeps running.
- **No volume:** it logs `[pipeline] PUBLIC_DATA_DIR … using ephemeral /tmp/proswisher/… (data is lost on every redeploy/restart; attach a volume)` and still serves pages from /tmp.
- **Source refusal (401/403/persistent 429):** it logs `STOPPED` and won't retry until the next deploy (memo 20).

**1. Volume (Ryan; costs money):** in Railway → proswisher → preview → `web`, choose Attach volume and set the **mount path to `/data`**. Railway then sets `RAILWAY_VOLUME_MOUNT_PATH=/data` itself. A service with a volume has a few seconds of downtime on each redeploy.

**2. Variables** (Railway → `web` → Variables). Values are typed by Ryan only; none go in the repo.

| Variable | Value |
|---|---|
| `BALLDONTLIE_API_KEY` | your balldontlie Free key (required) |
| `ODDS_API_KEY` | your The Odds API free key (optional; without it, Winner grading only, no ATS) |
| `PUBLIC_DATA_DIR` | `/data/public` |
| `PREDICTIONS_PRIVATE_DIR` | `/data/private` |
| `PIPELINE_INTERVAL_MIN` | `60` (or leave unset; `0` = on start only) |
| `CONSENT_DIR` *(optional, for later)* | `/data/consent` |
| `STATS_DIR` *(optional, only if counting is on)* | `/data/stats` |

Do **not** set `PIPELINE_DRY_RUN` on Railway. Saving the variables redeploys the service, and the redeploy runs the pipeline.

**3. Trigger a run:**
- **Redeploy or restart** the service. Each start runs the pipeline once.
- Or, with `ADMIN_TOKEN` set: `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://<host>/admin/pipeline/run`. Check status with `GET /admin/pipeline`.
- Or, from a shell in the service (`railway ssh`): `npm run data`.

**4. Check:**
- The deploy log should show `balldontlie-free: N games fetched …` then `[pipeline] run #1 finished OK`. The first run pulls the season plus last season at 5 requests/min, so it takes a few minutes.
- `/data/games.json` should list games, and `/games/<yyyy-mm-dd>/<away>-vs-<home>` should render with its title.

**Dry run (synthetic fixtures, no keys, never production):** `npm run data:dry-run` writes made-up games and lines to `/tmp/proswisher-dryrun/{public,private}`. Locally, `PIPELINE_DRY_RUN=true npm start` serves the site from that output. The pipeline refuses a dry run when `APP_ENV=production`, when either output dir is inside the repo, or when the private dir already holds a real log. `tests/server/pipeline.test.mjs` runs the dry run end to end and checks that game pages, `/data` and the member gate render from it.

## Tests
`npm test` runs `tests/server/*.test.mjs` and the Python pipeline tests. The node:test suite covers:
- geo samples for JP, WA, HI, UT and TX; fail-closed checkout (missing/stale DB, unknown IP, declared/IP mismatch); preview bypass refused in production; hardened XFF; 451 scope; public pages always open;
- webhook grants access only after the billing check passes; real 404s, robots.txt and sitemap.xml;
- webhook refund, cancel and revoke; payments guards; no cookies;
- counter off by default; daily and UTM totals with '<5' suppression and same-visit CTA attribution;
- IP truncation; salt rotation with nothing persisted; aggregates only; 30-day and 25-month retention;
- the UTM allowlist; GPC/DNT and EEA/UK/CH skips;
- the X-PS-Session header; the consent-IP purge; the no-raw-IP logging guard;
- no IP in Checkout Session metadata, plus the Session audit; `text_version` matching the page versions; effective dates;
- the pipeline runner (/tmp fallback, no keys, no python3, refusal stop, minimal child env) and the dry run rendering game pages.
