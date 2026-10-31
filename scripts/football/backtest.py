#!/usr/bin/env python3
"""NFL walk-forward backtest, step 1 (Python): as-of expected points for every completed game in the test seasons.

For each test game in week w of season S:
  * team ratings use only plays from games before (S, w)            (no look-ahead)
  * the points model (a, b, hfa) is fitted on seasons S-3..S-1 only, each game with its own as-of ratings
  * sim play parameters are fitted on --param-seasons (default 2020-2022, i.e. before every test season)
Step 2 (Node, scripts/football/backtest.mjs) simulates each game and scores margin/total MAE, winner %, ATS, O/U.

--tune re-runs the hyper-parameter grid on TRAIN seasons only (default 2020-2022) using the ratings-mean margin MAE.

usage: python3 scripts/football/backtest.py --pbp-dir DIR [--test 2023-2026] [--out /tmp/proswisher-backtest] [--tune]
DIR must hold nflverse play_by_play_{season}.csv.gz files and games.csv (downloaded by the daily refresh or by hand).
"""
import argparse, csv, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from football import ratings as R, params as PR
from football.extract import extract_pbp, IDX
from football.refresh import nfl_schedule_games, asof_samples


def span(s):
    a, _, b = s.partition("-")
    return list(range(int(a), int(b or a) + 1))


def load_obs(pbp_dir, seasons, keep_rows_for=()):
    obs, rows = [], {}
    for s in seasons:
        p = os.path.join(pbp_dir, f"play_by_play_{s}.csv.gz")
        if not os.path.exists(p):
            print(f"[backtest] missing {p}; skipped", file=sys.stderr); continue
        r = list(extract_pbp(p))
        obs += R.nfl_observations(r, IDX)
        if s in keep_rows_for:
            rows[s] = r
    return obs, rows


def margin_mae(obs, games, model, cfg):
    errs, cache = [], {}
    for g in games:
        k = (g["season"], g["week"])
        if k not in cache:
            cache[k] = R.fit(obs, *k, cfg, iters=30)
        r = cache[k]; site = 0 if g["neutral"] else 1
        h = R.expected_points(r, model, g["home"], g["away"], site); a = R.expected_points(r, model, g["away"], g["home"], -site)
        errs.append(abs((h - a) - (g["homeScore"] - g["awayScore"])))
    return sum(errs) / len(errs)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbp-dir", required=True)
    ap.add_argument("--test", default="2023-2026")
    ap.add_argument("--param-seasons", default="2020-2022")
    ap.add_argument("--out", default="/tmp/proswisher-backtest")
    ap.add_argument("--tune", action="store_true")
    ap.add_argument("--train", default="2020-2022")
    a = ap.parse_args(argv)
    test, psz = span(a.test), span(a.param_seasons)
    first = min(test + psz + (span(a.train) if a.tune else [])) - 3
    with open(os.path.join(a.pbp_dir, "games.csv"), newline="", encoding="utf-8") as f:
        sched = list(csv.DictReader(f))
    lines = {g["game_id"]: g for g in sched}
    t0 = time.time()
    seasons = list(range(max(1999, first), max(test) + 1))
    obs, rows = load_obs(a.pbp_dir, seasons, keep_rows_for=set(psz))
    print(f"[backtest] observations for {seasons[0]}-{seasons[-1]} in {time.time() - t0:.0f}s", file=sys.stderr)
    games = []
    for s in seasons:
        games += [g for g in nfl_schedule_games(sched, s) if g["status"] == "final"]
    cfg = dict(R.DEFAULTS)

    if a.tune:
        train = span(a.train); best = None
        tg = [g for g in games if g["season"] in train]
        for hl in (6, 10, 16):
            for lam in (200, 400, 800):
                for off in (8, 16):
                    c = {**R.DEFAULTS, "half_life": hl, "lambda": lam, "offseason_weeks": off}
                    model = R.fit_points_model(asof_samples(obs, [g for g in games if min(train) - 3 <= g["season"] < min(train)], c))
                    m = margin_mae(obs, tg, model, c)
                    print(f"[tune] hl={hl} lambda={lam} offseason={off}: train margin MAE {m:.3f}", file=sys.stderr)
                    if not best or m < best[0]: best = (m, c)
        cfg = best[1]
        print(f"[tune] chosen on train only: {cfg}", file=sys.stderr)

    out_games, models = [], {}
    for s in test:
        model = R.fit_points_model(asof_samples(obs, [g for g in games if s - 3 <= g["season"] < s], cfg))
        models[s] = model
        cache = {}
        for g in (x for x in games if x["season"] == s):
            k = (s, g["week"])
            if k not in cache: cache[k] = R.fit(obs, *k, cfg, iters=40)
            r = cache[k]; site = 0 if g["neutral"] else 1
            ln = lines.get(g["id"], {})
            num = lambda v: float(v) if v not in (None, "", "NA") else None
            out_games.append({**g, "expected": {"home": R.expected_points(r, model, g["home"], g["away"], site), "away": R.expected_points(r, model, g["away"], g["home"], -site)},
                              "spreadLine": num(ln.get("spread_line")), "totalLine": num(ln.get("total_line"))})
    prow = [x for s in psz for x in rows.get(s, [])]
    params = PR.fit_nfl(prow, rows.get(psz[-1], []))
    params["seasons"] = psz
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "games.json"), "w") as f:
        json.dump({"config": cfg, "models": models, "test": test, "games": out_games}, f)
    with open(os.path.join(a.out, "params.json"), "w") as f:
        json.dump(params, f)
    print(f"[backtest] {len(out_games)} test games written to {a.out} in {time.time() - t0:.0f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
