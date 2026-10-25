# ProSwisher

Transparent pro basketball game predictions with a public, append-only track record.
Web-only (no app-store packaging). Vite + React + TypeScript + Tailwind, served as static files.

## How it works
- `scripts/update_data.py` (stdlib Python, run by `.github/workflows/update-stats.yml`) pulls the current
  season's schedule and final scores, builds team ratings (point differential blended with last season),
  projects every game in the next 7 days, **appends new predictions to `public/data/predictions.json` before
  tip-off** (never edited afterwards) and grades them once games are final. It fails loudly instead of writing fallback data.
- The site reads `public/data/*.json`. No backend, database, cookies, analytics or AI keys.
- All copy is in `src/config/site.ts` (`FRAMING` switches the positioning). Disclaimers are verbatim from legal memo 17.

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
