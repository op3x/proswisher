# ProSwisher

Transparent pro basketball game predictions with a public, append-only track record.
Web-only (no app-store packaging). Vite + React + TypeScript + Tailwind, served as static files.

## How it works
- `scripts/update_data.py` (stdlib Python, run by the workflow staged at `ops/update-stats.yml`; it must be copied to `.github/workflows/` by someone with `workflow` scope, and scheduled runs only happen from `main`) pulls the current
  season's schedule and final scores, builds team ratings (point differential blended with last season),
  projects every game in the next 7 days, **appends new predictions to `public/data/predictions.json` before
  tip-off** (never edited afterwards) and grades them once games are final. It fails loudly instead of writing fallback data.
- The site reads `public/data/*.json`. No backend, database, cookies, analytics or AI keys.
- All copy is in `src/config/site.ts` (`FRAMING` switches the positioning). Copy follows Laye's landing-page-copy.md (9:28 AM CT) with Larry's final rulings (canonical footer, flat 21+, checkout consent, track-record rules, geoblock WA/HI/UT/JP).

## Run
```
npm ci && npm run data && npm run dev      # local
npm run build && PORT=3000 npm start       # production-style static serve (honors PORT)
```

## Environment (names only; see `.env.example`)
| Var | Purpose | Default |
|---|---|---|
| `APP_ENV` | `preview` or `production`; guard refuses build/start on live Stripe keys outside production | `preview` |
| `STRIPE_LIVE_ENABLED` | must be `false`; only honored when `APP_ENV=production` | `false` |
| `VITE_SUBSCRIBE_ENABLED` | shows an inert "subscription not available yet" placeholder | `false` |
| `PORT` | set by Railway | n/a |

Payments are **not wired**: no Stripe SDK, no checkout, no payment links, no Stripe API calls.
The future plan is standard Stripe Billing + Stripe Tax with a dedicated restricted key (not Managed Payments), with
server-side checkout geoblocked for WA, HI, UT and Japan (`src/lib/geoblock.ts` stub).
`scripts/guard.mjs` runs before every build/start and refuses if a live key appears while `APP_ENV=preview`,
if `STRIPE_LIVE_ENABLED=true` outside production, or if any `VITE_*` var holds a secret.

## Pick log guarantees

- `public/data/predictions.json` is append-only: a game is logged only while its state is `pre` and tip-off is in the future;
  locked fields (pick, probability, spread, total, timestamps) are never rewritten and no entry is ever removed. The script refuses to write if that would change.
- Entries are graded automatically once the game is final. The commit history of that file is the public proof of pre-tip-off timestamps.
- `python3 tests/test_pipeline.py` runs an offline end-to-end check (log before tip → grade after final → nothing changed or removed); the workflow runs it before every data update.
- The W-L summary appears only on the Track record page, always covering the full log since launch, with the date range, a link to the full log and "Past results do not guarantee future results".

## Pricing / free tier (stub)

$9/month, free tier of 1 game per day. Gating (`src/lib/access.ts`) is inert while payments are off, so every game is visible.
Geoblock (`src/lib/geoblock.ts`): WA, HI, UT, Japan, by IP and billing ZIP/country, ON by default (`geoblock.enabled` in `src/config/site.ts`); it must run server-side once checkout exists.

## Grading (Larry, round 2)
- At post time (before tip-off) each log entry stores our pick, projected score/spread/total, and — when
  `ODDS_API_KEY` is set as a GitHub Actions secret — the **market** point spread (median home line across US
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
