#!/usr/bin/env python3
"""NCAAF walk-forward backtest, step 1 (Python): as-of expected points for every completed test game (rigor step 5).

No look-ahead anywhere:
  * EPA ratings (production method, CFBD per-game PPA) use only games before (season, week);
  * the points model (a, b, home edge) is fitted on as-of samples from games before the test week (seasons S-1..S,
    like the daily refresh);
  * the NCAAF Elo hyper-parameters (K, home edge, offseason carry, points per Elo) are tuned on 2022-2023 results only
    (--tune), then frozen for the test seasons; Elo itself only sees results before each game;
  * the margin source (EPA vs Elo) and the game shock (envSd) are chosen on the 2023 validation season, never on test.
Closing lines (CFBD /lines, consensus or first book) are read for scoring only and never enter a prediction.

usage: python3 scripts/football/backtest_ncaaf.py --raw DIR [--test 2024-2026] [--out DIR] [--tune] [--margin elo|epa]
DIR holds the private CFBD cache (games_Y, ppa_Y, lines_Y .json.gz), written by the refresh or a one-off fetch.
"""
import argparse, gzip, itertools, json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from football import ratings as R, elo as E
from football.refresh import ncaaf_obs, ncaaf_games, asof_samples, NCAAF_CFG, ncaaf_week_index

NCAAF_ELO = {"k": 28, "hfa": 35, "keep": 0.6, "mean": 1500, "per_pt": 14}   # --tune output on 2022 (2021 burn-in); same as refresh.NCAAF_ELO


def load(raw, name):
    p = os.path.join(raw, name)
    if not os.path.exists(p):
        return []
    with gzip.open(p, "rt") as f:
        return json.load(f)


def fbs_set(game_rows):
    s = set()
    for g in game_rows:
        if g.get("homeClassification") == "fbs": s.add(g["homeTeam"])
        if g.get("awayClassification") == "fbs": s.add(g["awayTeam"])
    return s


def closing(lines_rows):
    """{game id: (home spread line as expected home margin, total line)} from CFBD /lines."""
    out = {}
    for g in lines_rows:
        ls = [l for l in (g.get("lines") or []) if l.get("spread") is not None]
        if not ls: continue
        pick = next((l for l in ls if (l.get("provider") or "").lower() == "consensus"), ls[0])
        tot = pick.get("overUnder") if pick.get("overUnder") is not None else next((l["overUnder"] for l in ls if l.get("overUnder") is not None), None)
        out[str(g["id"])] = (-float(pick["spread"]), float(tot) if tot is not None else None)
    return out


def elo_games(games):
    return [{"id": g["id"], "season": g["season"], "kickoff": g["kickoff"], "home": g["home"], "away": g["away"],
             "neutral": g["neutral"], "homeScore": g["homeScore"], "awayScore": g["awayScore"]} for g in games]


def tune_elo(games, seasons):
    best = None
    for k, hfa, keep, per in itertools.product((20, 28, 36, 44, 52), (35, 45, 55, 65), (0.6, 0.7, 0.8, 0.9), (14, 16, 18, 20, 22)):
        cfg = {"k": k, "hfa": hfa, "keep": keep, "mean": 1500, "per_pt": per}
        pre, _ = E.run_elo(games, cfg)
        errs = [abs(pre[g["id"]]["spread"] - (g["homeScore"] - g["awayScore"])) for g in games
                if g["season"] in seasons and g["homeScore"] is not None]
        m = sum(errs) / len(errs)
        if best is None or m < best[0]:
            best = (m, cfg)
    return best


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True); ap.add_argument("--test", default="2024-2026")
    ap.add_argument("--out", default="/tmp/proswisher-backtest-ncaaf"); ap.add_argument("--tune", action="store_true")
    ap.add_argument("--margin", default="blend", choices=["elo", "epa", "blend"]); ap.add_argument("--first", type=int, default=2021)
    a = ap.parse_args(argv)
    lo, _, hi = a.test.partition("-"); test = list(range(int(lo), int(hi or lo) + 1))
    years = list(range(a.first, test[-1] + 1))
    graw = {y: load(a.raw, f"games_{y}.json.gz") for y in years}
    praw = {y: load(a.raw, f"ppa_{y}.json.gz") for y in years}
    fbs = set().union(*(fbs_set(graw[y]) for y in years))
    games = [g for y in years for g in ncaaf_games(graw[y], fbs)]
    obs = [o for y in years for o in ncaaf_obs(praw[y], fbs)]
    eg = elo_games(games)
    cfg_elo = dict(NCAAF_ELO)
    if a.tune:
        m, cfg_elo = tune_elo(eg, {test[0] - 2})
        print(f"[ncaaf-bt] Elo tuned on {test[0]-2} ({a.first}+ burn-in): {cfg_elo} margin MAE {m:.3f}")
    pre, _ = E.run_elo(eg, cfg_elo)
    lines = {}
    for y in [test[0] - 1] + test:
        lines.update(closing(load(a.raw, f"lines_{y}.json.gz")))
    # as-of samples over every season (ratings strictly before each game's week), then per-week model fits
    want = [g for g in games if g["season"] >= test[0] - 1 and g["homeScore"] is not None]
    rcache, out, models = {}, [], {}
    samples_by = {}
    for g in [g for g in games if g["season"] >= test[0] - 2 and g["homeScore"] is not None]:
        k = (g["season"], g["week"])
        if k not in rcache: rcache[k] = R.fit(obs, *k, NCAAF_CFG, iters=30)
        r = rcache[k]
        if not r["weight"].get(g["home"]) or not r["weight"].get(g["away"]): continue
        site = 0 if g["neutral"] else 1
        samples_by.setdefault(k, []).append((r["off"].get(g["home"], 0) + r["def"].get(g["away"], 0), site, g["homeScore"]))
        samples_by[k].append((r["off"].get(g["away"], 0) + r["def"].get(g["home"], 0), -site, g["awayScore"]))
    for g in want:
        k = (g["season"], g["week"])
        if k not in models:
            smp = [s for kk, v in samples_by.items() if (kk[0] == k[0] and kk[1] < k[1]) or kk[0] == k[0] - 1 for s in v]
            models[k] = R.fit_points_model(smp)
        mdl, r = models[k], rcache[k]
        site = 0 if g["neutral"] else 1
        eh = R.expected_points(r, mdl, g["home"], g["away"], site); ea = R.expected_points(r, mdl, g["away"], g["home"], -site)
        tot, epa_m = eh + ea, eh - ea
        elo_m = pre[g["id"]]["spread"]
        sl, tl = lines.get(g["id"], (None, None))
        out.append({"id": g["id"], "season": g["season"], "week": g["week"], "home": g["home"], "away": g["away"], "neutral": g["neutral"],
                    "playoff": False, "homeScore": g["homeScore"], "awayScore": g["awayScore"],
                    "expTotal": tot, "epaMargin": round(epa_m, 3), "eloMargin": round(elo_m, 3),
                    "eloP": pre[g["id"]]["p"], "hfaPoints": mdl["hfa"], "spreadLine": sl, "totalLine": tl})
    val = [x for x in out if x["season"] == test[0] - 1]
    w = {"elo": 1.0, "epa": 0.0}.get(a.margin)
    if w is None:   # blend weight on the validation season only
        w = min((i / 20 for i in range(21)), key=lambda w: sum(abs(w * x["eloMargin"] + (1 - w) * x["epaMargin"] - x["homeScore"] + x["awayScore"]) for x in val))
    print(f"[ncaaf-bt] margin = {w:.2f} x Elo + {1 - w:.2f} x EPA (weight chosen on {test[0] - 1})")
    for x in out:
        h, aw = E.split_points(x.pop("expTotal"), w * x["eloMargin"] + (1 - w) * x["epaMargin"])
        x["expected"] = {"home": round(h, 3), "away": round(aw, 3)}; x["blendMargin"] = round(h - aw, 3)
    os.makedirs(a.out, exist_ok=True)
    json.dump({"games": out, "config": {"ratings": NCAAF_CFG, "elo": cfg_elo, "margin": a.margin, "eloWeight": w, "test": test},
               "models": {f"{k[0]}-{k[1]}": v for k, v in models.items()}}, open(os.path.join(a.out, "games.json"), "w"))
    def mae(f, rows): rows = [x for x in rows if f(x) is not None]; return round(sum(abs(f(x)) for x in rows) / len(rows), 3), len(rows)
    for s in sorted({x["season"] for x in out}):
        rows = [x for x in out if x["season"] == s]; lr = [x for x in rows if x["spreadLine"] is not None]
        print(s, "n", len(rows), "EPA margin MAE", mae(lambda x: x["epaMargin"] - (x["homeScore"] - x["awayScore"]), rows),
              "Elo", mae(lambda x: x["eloMargin"] - (x["homeScore"] - x["awayScore"]), rows),
              "| lined games EPA", mae(lambda x: x["epaMargin"] - (x["homeScore"] - x["awayScore"]), lr),
              "Elo", mae(lambda x: x["eloMargin"] - (x["homeScore"] - x["awayScore"]), lr),
              "blend", mae(lambda x: x["blendMargin"] - (x["homeScore"] - x["awayScore"]), lr),
              "line", mae(lambda x: x["spreadLine"] - (x["homeScore"] - x["awayScore"]), lr),
              "total EPA", mae(lambda x: x["expected"]["home"] + x["expected"]["away"] - x["homeScore"] - x["awayScore"], rows),
              "line total", mae(lambda x: None if x["totalLine"] is None else x["totalLine"] - x["homeScore"] - x["awayScore"], lr),
              "home edge pts (mean fitted)", round(sum(x["hfaPoints"] for x in rows) / len(rows), 2))


if __name__ == "__main__":
    main()
