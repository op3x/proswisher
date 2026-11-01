# Simculus football sim: methodology and honest validation (v1 + rigor steps 1, 2, 4, 5, Q2 fix, NCAAF; 2026-10-31)

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

## 5b. Rigor step 2: home bias and total intervals (2026-10-31)
**Home bias: root cause found and fixed (server/sim/montecarlo.mjs).** The step-1 sim's mean margin ran +0.33 points above its own input
(sim 2.01 vs expected 1.68; home +0.20, away -0.13 points). Cause: draw i used seed + i, so requests with nearby seeds (every consecutive
backtest game) shared almost the same pilot games, and one pilot's sampling error became a systematic bias. Fix: independent per-draw seeds
(murmur3 fmix32 of seed, stream, i), and calibration on a fixed pilot set of 1,500 games (common random numbers) with up to 4 Newton/secant
passes, which also iterates out the cross-effect of one side's tilt on the other side's points. Check: 30 seeds x 3 targets, mean error
within +/-0.1 point per side; backtest bias +0.33 -> -0.02.

**Total intervals.** Added a game-environment random effect: each simulated game draws one shared shock u ~ N(0, envSd) on both offenses' tilt
(pace, weather, game script). The calibration passes include it, so means still match. envSd was chosen on the 2023 season only:

| envSd (2023 only) | total 80% | total 95% | margin 80% | margin 95% | Brier |
|---|---|---|---|---|---|
| 0 (bias fix only) | 71.6% | 90.5% | 77.2% | 94.0% | 0.2317 |
| 0.4 | 73.0% | 90.9% | 76.1% | 93.3% | 0.2307 |
| 0.6 | 75.1% | 92.6% | 77.2% | 93.0% | 0.2302 |
| **0.8 (chosen)** | 79.6% | 94.4% | 77.2% | 92.6% | 0.2306 |
| 0.8 + per-team shock 0.3 | 80.4% | 95.8% | 78.2% | 93.7% | 0.2308 |
| 0.8 + per-team shock 0.5 | 80.7% | 96.1% | 80.0% | 95.1% | 0.2320 |

The per-team shock helped margin coverage but worsened Brier and log loss, so it was dropped (teamSd 0). NCAAF gets no shock until step 5.

**Step-2 result, all 963 test games** (same harness and games as section 5 and 5a; the step-2 sim row is the production configuration)

| model | Brier | log loss | margin MAE | margin RMSE | winner % |
|---|---|---|---|---|---|
| v1 sim | 0.2273 | 0.647 | 10.29 | 13.28 | 62.6% |
| step-1 sim (tuned Elo margin + EPA total) | 0.2236 | 0.638 | 10.19 | 13.14 | 64.4% |
| **step-2 sim (+ bias fix, envSd 0.8)** | **0.2230** | **0.6376** | 10.17 | 13.14 | 63.1% |
| tuned Elo expected margin (no sim) | 0.2234 | 0.6386 | **10.16** | 13.15 | 63.6% |
| Elo baseline (538 defaults) | 0.2231 | 0.6380 | 10.18 | 13.14 | 63.6% |
| closing line | 0.2128 | 0.6151 | 9.74 | 12.64 | 67.5% |

- Coverage (nominal 80/95): margin 78.6% / 94.6% (step 1: 79.2 / 94.8); **total 81.9% / 95.1%** (step 1: 75.3 / 91.9). Fixed.
- Mean predicted home WP 0.550 vs realised 0.543 (step 1: 0.561; v1: 0.574). Mean sim margin = input margin to within 0.02 points.
- Remaining miscalibration: the 0.4-0.5 WP bin (n=221) predicts 0.450, realised 0.385; the 0.6-0.9 bins are slightly under-confident.
  A walk-forward Platt recalibration is the obvious next fix but needs out-of-sample sim rows to fit on; not done.
- By season Brier (sim / Elo / line): 2023 0.231/0.233/0.217; 2024 0.213/0.211/0.204; 2025 0.222/0.222/0.211; 2026 0.232/0.232/0.229.
- Total MAE 10.64 vs closing total 10.16; still no betting edge.
- Honest read: the sim now matches or slightly beats both Elo baselines on Brier and log loss, and is about level on margin MAE, with
  correctly sized intervals. It is still about 0.01 Brier / 0.43 points MAE behind the closing line.
- Cost: calibration now runs up to 6,000 pilot games per request (about +0.6 s at n=10,000).

## 5c. Rigor step 4: per-quarter error vs actual quarter scores
scripts/football/quarter_eval.py (actual quarter points from nflverse pbp cumulative scores; OT excluded). Step-2 sim, 963 games:

| quarter | sim mean total | actual mean total | bias | MAE | MAE of a constant (test mean, optimistic) |
|---|---|---|---|---|---|
| Q1 | 9.89 | 8.83 | +1.06 | 4.60 | 4.40 |
| Q2 | 12.61 | 13.93 | -1.33 | 5.38 | 5.40 |
| Q3 | 9.89 | 9.30 | +0.60 | 4.74 | 4.76 |
| Q4 | 12.80 | 12.98 | -0.18 | 6.03 | 5.97 |

Finding: game totals are right, but the engine moves about 1.1 points of scoring from Q2 (end-of-half two-minute drives) into Q1/Q3, and per-quarter
predictions are no better than a constant per-quarter mean. Quarter-level outputs should be read as a shape, not a forecast. Fix candidates:
end-of-half pace/aggressiveness from pbp, or a fitted per-quarter scoring-rate term; not done yet.

## 5d. Q2 scoring shape: end-of-half clock and two-minute logic (2026-10-31)
Diagnosis (nflverse pbp 2018-2022 regular season, training years only): real teams score 4.87 points per game in the last 2:00 of Q2,
2.16 in 2:00-5:00 and 7.33 earlier in Q2. The step-2 engine scored 2.91 in the last 2:00 of Q2 (and 1.6 vs 2.5 in the last 2:00 of Q4),
because only a trailing or tied team hurried before half-time and nobody used timeouts.
Fix (server/sim/engine.mjs; both leagues):
- In Q2, both teams use the two-minute offense inside the last `halfHurrySec` seconds, whatever the score.
- Each team has 3 timeouts per half. Inside the last 2:00 of each half, after an in-bounds play (run, completion, sack) the side that wants
  the clock stopped uses one: a hurrying offense, or in Q4 a trailing defense. The play then costs 5 s instead of its full run-off.
- `halfHurrySec` = 90 was chosen by matching the 2018-2022 Q2 last-2:00 scoring (sim 4.99 vs real 4.87 at 90 s; 120 s gave 5.8 because
  the timeouts already add points). Test games were not used.

Per-quarter result, same 963 test games and harness as 5c:

| quarter | actual mean total | step-2 sim (bias) | Q2-fix sim (bias) | MAE step 2 -> fix | MAE of a constant |
|---|---|---|---|---|---|
| Q1 | 8.83 | 9.89 (+1.06) | 9.36 (+0.53) | 4.60 -> 4.49 | 4.40 |
| Q2 | 13.93 | 12.61 (-1.33) | 14.00 (+0.07) | 5.38 -> 5.35 | 5.40 |
| Q3 | 9.30 | 9.89 (+0.60) | 9.37 (+0.08) | 4.74 -> 4.69 | 4.76 |
| Q4 | 12.98 | 12.80 (-0.18) | 12.49 (-0.49) | 6.03 -> 6.03 | 5.97 |

Game level (all 963): Brier 0.2230 -> 0.2237, log loss 0.6376 -> 0.6393, margin MAE 10.17 -> 10.17, total MAE 10.64 -> 10.66;
coverage margin 78.6/94.6 -> 78.9/95.0, total 81.9/95.1 -> 82.9/95.8. The Brier change is +0.0007 with a paired SE of 0.0008, so it is
noise-level (by season 2023 0.2306->0.2325, 2024 0.2125->0.2150, 2025 0.2224->0.2211, 2026 0.2322->0.2302). Adopted for the quarter shape;
game-level accuracy is unchanged within error. Remaining: Q4 last 2:00 is still short (2.0 vs 2.5) and Q1 is still +0.5.

**Quarter display.** Taking the median of each quarter on its own snaps to 7 (or 3/0), because quarter scores are lumpy, and those medians need not
add up to the median final. The Monte Carlo output now has `periodLine`: each team's mean scoring shape by quarter, scaled to its median
final and rounded by largest remainder, so the quarters add up exactly to the final (example: 21-24 game -> 4/7/4/6 and 5/7/5/7, where the
per-quarter medians were 3/7/3/7 and 6/7/6/7). `medianByPeriod` is kept for compatibility, with a note to show `periodLine` instead.

## 5e. Win-probability recalibration: tested, not adopted (2026-10-31)
Fitted on out-of-sample sim rows only (walk-forward: each test game is recalibrated with a map fitted on games before it; or an Elo-trained
map fitted on 2010-2022 Elo margins). Step-2 rows, Brier / log loss:

| method | all 963 games | 2024 onward |
|---|---|---|
| raw sim WP (production) | **0.2230 / 0.6376** | 0.2198 / 0.6309 |
| Platt on Elo-trained margin map (fit 2010-2022, a=0.0076, b=0.1554) | 0.2231 / 0.6381 | **0.2193 / 0.6299** |
| walk-forward Platt on logit(WP) | 0.2234 / 0.6386 | 0.2204 / 0.6324 |
| walk-forward Platt on sim margin | 0.2235 / - | 0.2205 / - |
| walk-forward isotonic | 0.2256 / 0.6446 | 0.2235 / 0.6408 |

No method improves consistently out of sample (the one 2024+ gain is 0.0005 and it loses on all games), so the raw sim WP stays.

## 5f. Rigor step 5: NCAAF fit and walk-forward backtest (2026-10-31)
Data: CFBD (FBS games, lines and plays), raw data private and out of git. Test = 2024, 2025 and 2026 through week 9 (2,442 FBS-vs-FBS games;
2,427 with a closing spread). Every choice below was made on earlier seasons only:
- **Ratings:** the NCAAF EPA ratings as of each game's week (half-life 12 weeks, lambda 500), points model refitted each week on the
  3 prior seasons; its home edge is fitted inside that model each week (3.0-3.5 points in 2023, rising to about 5 by 2026).
- **Elo:** tuned on 2022 margin MAE (2021 burn-in): K 28, home edge 35 Elo points (= 2.5 points), offseason keep 0.6, 14 Elo points per point.
- **Expected margin:** 0.55 x Elo + 0.45 x EPA, weight chosen on 2023. Expected total from the EPA points model.
- **Play parameters:** fitted on the 154k CFBD 2023 FBS plays (sack 0.061, interception 0.026, completion 0.626, mean run 5.63 yards,
  FG make logistic a 4.605, b -0.0908 per yard, XP 0.979; NFL clock model). Tempo 0.95 matches the 2023 152.1 snaps per game with the Q2/timeout engine.
- **Game shock:** envSd chosen on 2023 only (n=600 sims per game):

| envSd (2023) | Brier | log loss | total 80% | total 95% | margin 80% | margin 95% |
|---|---|---|---|---|---|---|
| 0 | 0.1655 | 0.4991 | 71.5% | 90.2% | 72.6% | 90.5% |
| **0.8 (chosen)** | 0.1655 | **0.4973** | 77.4% | 93.6% | 71.5% | 90.9% |
| 1.6 | 0.1658 | 0.4975 | 87.7% | 97.1% | 71.5% | 90.8% |

**Test result, 2024-2026** (n=1,000 sims per game; "Phi" rows turn a margin into a win probability with the residual SD fitted on 2023: blend 17.04, EPA 17.37;
the closing line uses SD 15.18, also fitted on 2023)

| model | Brier | log loss | margin MAE | margin RMSE | winner % |
|---|---|---|---|---|---|
| **Simculus NCAAF sim (blend margin, envSd 0.8)** | **0.1687** | **0.5064** | **13.41** | **16.97** | 74.1% |
| blend margin only (Phi) | 0.1699 | 0.5066 | 13.42 | 16.98 | 73.8% |
| EPA ratings only (Phi) | 0.1745 | 0.5192 | 13.63 | 17.32 | 73.0% |
| tuned Elo (its own WP) | 0.1731 | 0.5142 | 13.67 | 17.23 | 73.8% |
| closing line (2,427 games) | 0.1552 | 0.4623 | 11.86 | 15.05 | 76.4% |

- On the 2,427 games with a line the sim scores Brier 0.1697, log loss 0.5094, margin MAE 13.40: **about 0.015 Brier and 1.5 points of margin MAE behind the line.**
- Total MAE 12.97 (13.01 vs the line's 12.43 on line games). Mean sim total 53.50 vs actual 53.37; mean WP 0.650 vs realised 0.652.
- Coverage (nominal 80/95): **total 78.1% / 93.2%** (good); **margin 73.3% / 89.6% (too narrow)**. College margins have more spread than the
  shared game shock adds; see the per-team shock check below.
- Home margin: sim mean +8.67 vs realised +9.63 (expected +8.72). The sim reproduces its input; the input is about 1 point short of the realised home
  margin in these seasons, consistent with the rising home edge.
- By season, Brier (sim / blend / Elo / line): 2024 0.1757/0.1766/0.1798/0.1648; 2025 0.1639/0.1659/0.1684/0.1563; 2026 0.1652/0.1660/0.1700/0.1387.
  Margin MAE (sim / line): 2024 13.52/11.97, 2025 13.12/11.88, 2026 13.68/11.65.

**Honest read:** with its own fit, the NCAAF sim beats Elo-only and EPA-only out of sample and is level with or slightly better than the blended margin
it is built on: better Brier in every test season, but log loss is worse than the blend in 2024 and 2026 (a few overconfident misses), level overall. It is clearly behind the closing line, by more than the NFL gap. No betting edge is claimed.
Production (scripts/football/refresh.py): the NCAAF refresh now runs Elo with a burn-in season, uses the 0.55/0.45 blend for the expected margin,
and fits play parameters from the previous season's CFBD plays (16 calls, once per season, cached privately); store.mjs NCAAF envSd 0.8.

**Per-team shock check (rejected).** Adding a per-team shock of 0.4 on top of envSd 0.8 widened margin coverage on 2023 only slightly
(71.5/90.9 -> 74.2/91.2) and made Brier and log loss worse (0.1655 -> 0.1672, 0.4973 -> 0.5033), so teamSd stays 0 (same result as the NFL in 5b).
For the record, on the test seasons it gave Brier 0.1687, log loss 0.5072, margin coverage 75.2/90.8: no better. Too-narrow NCAAF margin intervals
remain an open item (candidates: heavier-tailed team-strength uncertainty early in the season, or a mismatch blowout term).

## 5g. NFL injury/availability adjustment: research prototype, behind FOOTBALL_INJURIES_ENABLED (off) (2026-10-31)

Source: nflverse-data `injuries` release (CC BY 4.0), cleared by Larry for NFL with I1-I4 (model only; player-ID join
server-side; same attribution; only the `injuries` tag added to the allow-list). Terms: research/data-sources-terms.md s.5.
NCAAF: no permitted source (CFBD has no injury endpoint; conference availability reports listed for Larry's review, s.6).

Method (scripts/football/injuries.py; no look-ahead, no player names anywhere in output):
- Usage from pbp (IDs in memory only): each player's share of team QB dropbacks (passer or scrambler) and of skill touches
  (designed rushes + targets) per game. Role before week w = mean share over his last 4 games played before week w (this
  season or last). Defense/OL are not covered: pbp gives no usage for them, and snap_counts (PFR) and participation are banned.
- Status = final game status on the week-w report (Out / Doubtful / Questionable). P(miss | status), estimated on
  2019-2022 only (miss = no usage that week): Out 1.000, Doubtful 0.987, Questionable 0.354 (n 937 / 157 / 1,332).
- Team loss = sum of P(miss) x share, separately for QB and skill (capped at 1). Home margin adjustment =
  -(b_qb x (home QB loss - away QB loss) + b_skill x (home skill loss - away skill loss)), split +-1/2 into expected points.
- b fitted by least squares on the residual of the production Elo margin, 2019-2022 only: b_qb = 2.72, b_skill = 6.29 pts
  per unit of loss (a fully missing starting QB ~ -2.7 pts on top of what Elo already absorbed; IR players have left the
  report and are already in Elo). Train margin MAE 10.155 -> 10.086. Leave-one-season-out on 2019-2022 (model choice,
  train only): both terms 10.110 vs base 10.156, QB-only 10.123, "new absences only" 10.156, so both terms kept.

Test: 2023 wk1 - 2026 wk8 walk-forward (963 games), re-simmed with n=1000, envSd 0.8, same params and seeds as the Q2-fix
production rows (paired). Expected margins moved by 0.98 pts on average.

| model | n | Brier | log loss | margin MAE | margin RMSE | winner % |
|---|---|---|---|---|---|---|
| production sim (Elo margin + EPA total, Q2 fix, envSd 0.8) | 963 | 0.2237 | 0.6393 | 10.17 | 13.17 | 64.5% |
| injury-adjusted sim (flag on) | 963 | 0.2213 | 0.6347 | 10.10 | 13.03 | 65.9% |
| closing line (n=963) | 963 | 0.2128 | 0.6151 | 9.74 | 12.64 | 67.5% |

Per season, paired difference (adjusted - production), se in brackets:

| season | Brier | margin MAE |
|---|---|---|
| 2023 | -0.0006 (se 0.0025) | -0.001 (se 0.082) |
| 2024 | -0.0064 (se 0.0025) | -0.243 (se 0.095) |
| 2025 | -0.0006 (se 0.0026) | -0.027 (se 0.096) |
| 2026 | -0.0008 (se 0.0045) | +0.121 (se 0.147) |

Result: out of sample it improves Brier (-0.0024, about 1.7 se), log loss (-0.0046), margin MAE (-0.07, about 1.3 se),
RMSE and winner %, so it passes the keep rule (better Brier AND MAE). The gain is concentrated in 2024; 2023 and 2025 are
flat-to-better and 2026 (108 games) has a slightly worse MAE. It closes about a quarter of the Brier gap to the closing line.
Status: KEPT as code behind FOOTBALL_INJURIES_ENABLED, default OFF. It is not wired into refresh.py, the API or the site;
Nflverse.injuries_file() refuses while the flag is off, and a test checks refresh/server code never mentions injuries.
Turning it on would need: wiring into the refresh (weekly report + pbp IDs, server-side only), Larry's I1-I4 re-check, and
the same-day disclaimer change (site copy says injuries aren't modeled).

## 6. Pending from the rigor brief
1. (Done 5a; not adopted, Elo won.) Ridge regression per pass and run unit (EPA ~ off + def + HFA + situation) with exponential decay / Kalman recency and a Bayesian prior
   regressed to preseason, weight chosen by rolling CV. scripts/football/linalg.py has the pure-Python solvers (weighted ridge with prior mean, logistic Newton with SEs,
   multinomial logit) and is unit-tested. It is not wired in yet.
2. Fitted logistic/multinomial play sub-models (play call, completion, sack, INT, fumble, FG by distance, 4th-down choice) evaluated by out-of-sample log loss against the
   current bucket tables. The bucket tables stay unless they are beaten.
3. Optional market calibration (keep raw + calibrated outputs). Statistical WP recalibration tested in 5e, not adopted.
4. (Done 5c + 5d: Q2 under-scoring fixed with end-of-half hurry and timeouts.) Per-quarter error vs actual quarter scores.
5. (Done 5b: home bias root-caused and fixed; total intervals fixed.) Sensitivity analysis (half-life, lambda covered in 5a; n sims, HFA pending).
6. (Done 5f.) NCAAF: its own engine parameters, a CFBD walk-forward backtest, and an HFA check. Open: NCAAF margin intervals too narrow (73/90).
7. Generic backtest harness keyed by SportModule (today backtest.mjs is football-specific; the MC runner, API and scheduler hook are generic).

## Reproduce
cd scripts && python3 -m football.injuries_backtest <nflverse cache: games.csv, pbp 2018-2026, injuries 2019-2026> <dir with q2_<season> shards> <out>; then BT_SEASONS=<s> BT_ENV_SD=0.8 node scripts/football/backtest.mjs <out>/inj_<s> 1000   # 5g injuries (flag-off research)
python3 scripts/football/backtest_ncaaf.py --raw <cfbd raw dir> --test 2024-2026 --out <dir>; BT_LEAGUE=ncaaf BT_SEASONS=2024 BT_ENV_SD=0.8 BT_LINE_SD=15.18 node scripts/football/backtest.mjs <dir> 1000   # step 5 NCAAF
BT_SEASONS=2023 BT_ENV_SD=0.8 node scripts/football/backtest.mjs <dir> 1000   # step 2 (shard by season, merge rows.json)
python3 scripts/football/quarter_eval.py <dir>/rows.json <out.json> play_by_play_202{3,4,5,6}.csv.gz   # step 4
cd scripts && python3 -m football.rigor <obs.pkl> <games.csv> <outdir> [--use unit|old] [--old-obs old_obs.pkl]   # step 1 CV + test table
node scripts/football/backtest.mjs <dir> 1000   # needs games.json/params.json from scripts/football/backtest.py
python3 scripts/football/bt_report.py <dir> <nflverse games.csv> <outdir>
