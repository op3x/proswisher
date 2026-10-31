# Football simulation (Phase 1): data, ratings, sim engine, backtest

The product name comes from `APP_NAME` (single default in `server/brand.mjs`; working name pending trademark clearance).
No logos or league/team marks are used: teams appear as plain-text names only (trademark risk flagged for Larry).

## Data (hard data only; refreshed daily at 04:00 America/Chicago)

| League | Source | Licence / terms | Needs |
|---|---|---|---|
| NFL | nflverse play-by-play + schedules (GitHub releases) | CC-BY 4.0. Attribution shown in the API: **"Data: nflverse (CC-BY 4.0)"** | nothing |
| NCAAF | CollegeFootballData.com (CFBD) `/games`, `/ppa/games` | free tier, 1,000 calls/month; raw data is **not redistributed**, only derived ratings/sims are served | `CFBD_API_KEY` |
| Live NFL ticker | balldontlie `/nfl/v1/games` (free, 5 req/min) | existing key | `BALLDONTLIE_API_KEY` (falls back to nflverse finals) |
| Live NCAAF ticker | CFBD `/games` for the current week, hourly | counts against the same 800-call self-cap | `CFBD_API_KEY` |

Not used: Sportradar, Sports Reference, ESPN, and nflverse FTN/participation files (CC-BY-SA).

Refusals: an HTTP 401/403 (or a persistent 429) stops that source, records it in `blocked.json` in the private dir, and
the refresh exits with code 3. We never retry around a refusal; a human clears it with `FOOTBALL_CLEAR_BLOCKS=<source>`
after resolving it. One league failing never stops the other.

### Daily refresh (`scripts/football/refresh.py`, scheduled by `server/football/scheduler.mjs`)
* Runs at 04:00 America/Chicago (DST-aware), and on boot if `status.json` is older than 20 h. Child process gets an
  allowlisted environment only (no Stripe/admin secrets).
* NFL: downloads the schedule and the current season's play-by-play (past seasons are cached compactly in the private dir),
  rebuilds ratings, the points model, the published schedule with expected points, and refits sim parameters weekly.
* NCAAF: only with `CFBD_API_KEY`; ~4 calls/day (games + PPA for last and current season), well under the cap.
* Public outputs (`$PUBLIC_DATA_DIR/football/{nfl,ncaaf}/`): `ratings.json`, `schedule.json`, `params.json`,
  `history.json` (NFL), `status.json`. Raw data lives only in `$PREDICTIONS_PRIVATE_DIR/football/`.

### Live-score poll (ticker)
Only polls while a game is inside its window (kickoff −15 min to +5 h, not final). NFL: balldontlie every 120 s
(`FOOTBALL_TICKER_NFL_SEC`) — at most 1 call per poll, under the 5/min limit, but **shared with the legacy NBA pipeline**
(set `LEGACY_NBA_PIPELINE=false`). Without the key: nflverse `games.csv` with ETag every 10 min (final scores only).
NCAAF: CFBD every 60 min (`FOOTBALL_TICKER_NCAAF_MIN`). 401/403 or two 429s in a row stop that source until the next deploy.

## Ratings (`scripts/football/ratings.py`)
Offense and defense EPA per play (nflverse EPA for NFL, CFBD PPA for NCAAF), opponent-adjusted by a ridge-regularised
least-squares fit (team offense + opponent defense), recency-weighted (half-life 16 weeks NFL / 12 NCAAF, prior seasons
discounted by an offseason gap). Garbage time (win prob <5% or >95%) and 2-point tries are excluded.
Expected points = a + b·(off + opp def) ± hfa/2, with a, b, hfa fitted on as-of ratings from the 3 prior seasons.

## Simulation engine (`server/sim/engine.mjs`, `server/sim/montecarlo.mjs`)
Snap-by-snap: play call by down/distance/situation, run/dropback (sack, scramble, interception, completion) yardage
histograms, penalties, 4th-down go/punt/FG decisions, FG make probability by distance, punts, kickoffs, turnovers and
return TDs, clock by play type, two-minute drill/hurry-up. All play-level distributions are fitted from nflverse.
League rules are separate: NFL (two-minute warning, 10-minute regular-season OT that can tie, playoff OT to a result),
NCAAF (clock stops on first downs late in halves, overtime possessions from the 25, 2-point try required after a TD from OT2,
alternating 2-point attempts from OT3, no ties). Team strength is applied as a per-team tilt calibrated so each team's mean points match the
ratings' expected points (Monte Carlo calibration converges within ~1 point).

Monte Carlo output: win/tie probability, margin and total distributions (mean, median, percentiles, histogram),
median score by quarter, and a representative game (the sim closest to the median outcome) with its full play log.
Fictional matchups: any two teams, optionally from past seasons (`homeSeason`/`awaySeason`) or across levels
(NFL vs college, using an assumed `FOOTBALL_LEVEL_GAP_POINTS` = 30); these are labelled **"for entertainment only"**.

**NCAAF caveat:** NCAAF play-level distributions are the NFL fit with NCAAF rule changes and a few documented
assumptions (shorter FG range, PAT 97%, touchbacks at the 25). Team scoring is still calibrated to CFBD-based ratings.
A CFBD play-level fit is Phase 2. NCAAF has not been backtested (no key available yet).

## API (read-only, no secrets)
* `GET /api/football/status` · `GET /api/football/teams?league=nfl|ncaaf`
* `GET /api/football/games?league&week&status&upcoming`
* `GET /api/football/games/:id/sim` (`?plays=0` omits the log) · `GET /api/football/games/:id/plays` (play log)
* `GET /api/football/sim?home&away[&league&homeLeague&awayLeague&homeSeason&awaySeason&neutral&n&seed]` (N capped, concurrency-limited, cached)
* `GET /api/football/ticker`

## NFL backtest (walk-forward, honest numbers)
Method: test seasons 2023–2026 (through week 8 of 2026), 963 games. For each game, ratings use only plays from
before that game's week; the points model is fitted on the 3 prior seasons; sim parameters are fitted on 2020–2022;
hyperparameters were chosen on 2020–2022 only. 1,000 sims per game. Closing lines come from the nflverse schedule.
Reproduce: `NFL_LOCAL_DIR=<dir with play_by_play_YYYY.csv.gz> npm run backtest`.

| | Our model | Closing line | Published references |
|---|---|---|---|
| Margin MAE | **10.29** | 9.74 | nfelo 9.79, FPI 10.07, line 9.69 |
| Total MAE | **10.65** | 10.16 | line ≈10.6 |
| Straight-up winner | 62.6% | | |
| Brier (win prob) | 0.227 | | |
| ATS vs closing line | **48.9%** (456/932) | | break-even 52.4% |
| Over/under vs closing total | 49.2% (465/946) | | |

| Season | Margin MAE | Total MAE | Winner | ATS | O/U | Line margin/total MAE |
|---|---|---|---|---|---|---|
| 2023 | 10.39 | 11.45 | 60.6% | 50.4% | 45.5% | 9.98 / 10.17 |
| 2024 | 10.39 | 9.81 | 65.5% | 48.2% | 50.9% | 9.70 / 9.77 |
| 2025 | 10.29 | 10.54 | 62.3% | 47.9% | 52.3% | 9.67 / 10.42 |
| 2026 (to wk 8) | 9.75 | 11.05 | 61.3% | 50.0% | 45.8% | 9.36 / 10.49 |

**Conclusion:** the model is a reasonable simulator but does **not** beat the closing line (about 0.55 points worse on
margin, 0.5 on totals, ATS below break-even). Nothing here supports marketing it as a betting edge.
