# Simculus football sim: methodology and honest validation (v1 + rigor step 1, 2026-10-31)

Status: v1 slice. Everything below is what the code does today. Pending items are listed at the end.
Numbers come from /workspace/proswisher/scratch/bt3 (rows.json, results.json) and research/backtest-nfl/report.json + calibration.png.

## 1. Data (see research/data-sources-terms.md)
- NFL: nflverse `pbp` + `schedules` releases only (CC BY 4.0; Larry memo 24). Excluded and test-enforced: FTN charting, participation, Next Gen Stats,
  PFR/ESPN/OverTheCap-sourced releases, the teams file (logo URLs), and all Sportradar/Sports-Reference data. Attribution: "NFL data: nflverse
  (github.com/nflverse/nflverse-data), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified by Op3x LLC (aggregated,
  modeled and simulated). Not affiliated with or endorsed by the NFL or nflverse."
  Closing lines from nflverse schedules are used **only in the backtest**, never in public output.
- NCAAF: CollegeFootballData.com (derived outputs only; no raw-data endpoint or bulk download; key server-side; raw data kept in the private dir, out of git).
  Attribution: "Data provided by CollegeFootballData.com."
  5 API calls per daily refresh; monthly budget is tracked in private cfbd-budget.json.
- Refresh: scripts/football/refresh.py daily at 04:00 America/Chicago (server/football/scheduler.mjs). It also runs at startup when data is
  older than 20 h, or when NCAAF is missing and a CFBD key is present.

## 2. Ratings (current production)
- NFL: offense and defense EPA/play per team, opponent-adjusted by ridge-penalised alternating fit (lambda=800 plays) and recency-weighted by
  exponential decay (half-life 16 weeks; 8-week offseason gap, so last season keeps weight ~0.7 at week 1). Implicit shrinkage to league mean.
- Points model: points = a + b*(off + opp_def) + hfa/2*site, fitted by least squares on the 3 prior seasons using ratings as of each game's week (no look-ahead).
  Fitted values in the backtest: b 58-66, hfa 1.3-2.3 points.
- NCAAF: same structure on CFBD per-game PPA; 2025-2026 FBS games; currently a=26.6, b=71.5, hfa=5.0 (n=2844). The HFA looks high vs the ~2.5-3.5 consensus and is unvalidated.

## 3. Snap-by-snap engine (server/sim/engine.mjs)
- Play-level empirical distributions fitted from nflverse pbp 2020-2022 by situation bucket (down, distance, field zone, score/clock state):
  play call, yards (empirical by bucket), completion/sack/INT/fumble rates, penalties, FG make by distance, punt net, 4th-down go/kick/punt rates, clock runoff
  incl. hurry-up and kneel-downs. NFL and NCAAF rules (OT formats, two-minute warning, clock stops on first downs in NCAAF, FG max distance).
- Matchup strength enters as a per-team tilt solved so that the engine's mean points match the ratings' expected points ("calibrated" mode, curve built by pilot sims).
- NCAAF currently reuses the NFL play-level tables with NCAAF rules (borrowed parameters; pending its own fit).

## 4. Monte Carlo output (server/sim/montecarlo.mjs, generic over SportModule)
- n=10,000 by default (cap 50k, API max 20k). mulberry32 fixed seeds -> identical output per (matchup, n, seed).
- Win/tie probability + MC standard error sqrt(p(1-p)/n).
- Margin, total and per-period points: mean, sd, SE of mean, median, p05/p95, 80% [p10,p90] and 95% [p2.5,p97.5] intervals, histogram.
- A representative game whose final matches the median margin, with the full play log in the generic event envelope.
- ~1 s per 10k NFL sims on the box.

## 5. Validation (NFL, walk-forward, no look-ahead)
963 games, 2023 wk1 through 2026 wk8. Ratings as of each game's week; points model fitted on the 3 prior seasons; engine parameters from 2020-2022; n=1000 sims/game.

| model | Brier | log loss | margin MAE | margin RMSE | winner % |
|---|---|---|---|---|---|
| Simculus sim | 0.2273 | 0.647 | 10.29 | 13.28 | 62.6% |
| ratings only (no sim) | 0.2279 | 0.648 | 10.29 | 13.30 | 63.5% |
| Elo baseline (538-style) | **0.2231** | **0.638** | **10.18** | **13.14** | 63.6% |
| closing line | 0.2128 | 0.615 | 9.74 | 12.64 | 67.5% |

- Total: MAE 10.65, RMSE 13.51 vs closing total MAE 10.16.
- ATS vs closing spread 48.9% (456/932); O/U 49.2% (465/946). Break-even is 52.4%: **no betting edge**.
- Interval coverage (nominal 80/95): margin 78.3% / 94.3%; total 75.8% / 91.5%. Margin is close; total intervals are a little too narrow.
- Calibration (research/backtest-nfl/calibration.png; copy at docs/img/nfl-calibration.png): the sim overstates the home side in the 0.3-0.6 range by about 3-7 points.
  Mean predicted home WP 0.574 vs realised 0.543 (mean sim margin +2.4 vs realised +2.1, line +1.6).
- By season, Brier (sim / Elo / line): 2023 0.229/0.233/0.217; 2024 0.222/0.211/0.204; 2025 0.225/0.222/0.211; 2026 0.241/0.232/0.229.

**Honest read:** v1 is a credible simulator but it does **not** beat a simple Elo baseline out of sample, and it is well short of the closing line.
Per the brief's rule (use the simpler model when it is not beaten), the next step is to either blend Elo into the ratings prior or replace the EPA
ratings layer with the ridge + Kalman design below, and re-run this exact harness. Win probabilities shown publicly should carry this caveat.


## 5a. Rigor step 1: ridge pass/run unit ratings, Elo, blends (2026-10-31)
Same harness, same 963 test games (2023 wk1 to 2026 wk8). Everything was chosen on 2019-2022 (ratings) or 2010-2022 (Elo) only.

**What was built** (research: scripts/football/unit_ratings.py, scripts/football/rigor.py)
- Ridge, opponent-adjusted **pass and run** unit ratings: per game-unit EPA/play ~ m + off[team] + def[opp] + hfa*site, weights n_plays * 0.5^(age/half_life),
  ridge penalty lambda toward a **preseason prior** = rho * last season's final rating (centred). Garbage time (WP <5% or >95%), 2-pt tries, kneels and spikes dropped.
- Points model per season S on S-3..S-1: pts = a + b_pass*(pass_off+opp_pass_def) + b_run*(run_off+opp_run_def) + hfa/2*site.
- Blend: margin = w_r*ratings_margin + w_e*elo_spread, weights by least squares on S-3..S-1 (walk-forward).
- CV grid on 2019-2022: half_life {4, 8, 16, none} x lambda {100, 300, 1000} x rho {0.4, 0.6, 0.8}. Chosen: no in-season decay, lambda 100, rho 0.8
  (decay hurt; the prior helped, larger rho better). A bug where season finals were fitted at "week 99" (all weight decayed away) was found and fixed before this run.
- Elo hyperparameters tuned on 2010-2022 margin MAE: K {12..28} x HFA {24..60} x offseason keep {0.5..0.85} x points-per-spread {22..31}.
  Chosen K=16, HFA=36 Elo points, keep 1/2, 22 Elo points per point.

**Test-set results** (out of sample; "sim" rows are 1,000 snap-by-snap sims per game)

| model | Brier | log loss | margin MAE | margin RMSE |
|---|---|---|---|---|
| v1 sim (EPA ratings margin + total) | 0.2273 | 0.647 | 10.29 | 13.28 |
| unit ratings only (pass/run ridge) | 0.2299 | 0.652 | 10.37 | 13.34 |
| v1 EPA ratings only | 0.2279 | 0.648 | 10.29 | 13.30 |
| blend unit ratings + Elo | 0.2241 | 0.640 | 10.22 | 13.15 |
| blend v1 ratings + Elo | 0.2240 | 0.640 | 10.21 | 13.16 |
| Elo baseline (538 defaults, as in v1 table) | 0.2231 | 0.638 | 10.18 | 13.14 |
| tuned Elo (expected margin, no sim) | 0.2234 | 0.639 | **10.16** | 13.15 |
| **step-1 sim (tuned Elo margin + EPA total)** | 0.2236 | 0.638 | 10.19 | 13.14 |
| closing line | **0.2128** | **0.615** | **9.74** | **12.64** |

- Sim winner % 64.4% (v1 62.6%); line 67.5%. Coverage (nominal 80/95): margin 79.2% / 94.8%; total 75.3% / 91.9% (total still too narrow, step 2).
- Per season sim margin MAE (line): 2023 10.50 (9.98), 2024 10.10 (9.70), 2025 10.19 (9.67), 2026 9.61 (9.36). ATS 47.8-51.0%: still **no betting edge**.

**Decision (honest):** neither the new pass/run unit ratings nor any blend beat Elo out of sample, on the training window or the test window,
so per "blend with Elo where that helps out of sample" production uses **tuned Elo for the expected margin** and keeps the EPA points model for the
**expected total** (Elo has no total information). The unit-ratings code stays as a research tool, not in production.
This takes the sim from 10.29 to 10.19 margin MAE and Brier 0.2273 to 0.2236, i.e. level with Elo, still clearly behind the closing line.
Production: scripts/football/elo.py (stdlib), ratings.json `marginModel` + per-team `elo`; store.mjs uses it for same-season matchups; cross-era sims keep the EPA margin.

## 6. Pending from the rigor brief
1. (Done 5a; not adopted, Elo won.) Ridge regression per pass and run unit (EPA ~ off + def + HFA + situation) with exponential decay / Kalman recency and a Bayesian prior
   regressed to preseason, weight chosen by rolling CV. scripts/football/linalg.py has the pure-Python solvers (weighted ridge with prior mean, logistic Newton with SEs,
   multinomial logit) and is unit-tested. It is not wired in yet.
2. Fitted logistic/multinomial play sub-models (play call, completion, sack, INT, fumble, FG by distance, 4th-down choice) evaluated by out-of-sample log loss against the
   current bucket tables. The bucket tables stay unless they are beaten.
3. Optional market calibration (keep raw + calibrated outputs).
4. Per-quarter error vs actual quarter scores (sim per-period means are already in rows.json; actual quarter scores still need extracting from pbp).
5. Sensitivity analysis (half-life, lambda, n sims, HFA), and fixing the home overstatement and the narrow total intervals.
6. NCAAF: its own engine parameters, a CFBD walk-forward backtest, and an HFA check.
7. Generic backtest harness keyed by SportModule (today backtest.mjs is football-specific; the MC runner, API and scheduler hook are generic).

## Reproduce
cd scripts && python3 -m football.rigor <obs.pkl> <games.csv> <outdir> [--use unit|old] [--old-obs old_obs.pkl]   # step 1 CV + test table
node scripts/football/backtest.mjs <dir> 1000   # needs games.json/params.json from scripts/football/backtest.py
python3 scripts/football/bt_report.py <dir> <nflverse games.csv> <outdir>
