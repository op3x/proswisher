"""Rolling-origin CV and walk-forward evaluation for the unit-ratings points model (research; production uses the chosen config).

usage: python3 scripts/football/rigor.py <obs.pkl from unit_observations> <nflverse games.csv> <out dir> [--train 2019-2022] [--test 2023-2026]

Steps (no look-ahead anywhere):
 1. For each hyper-parameter config, ratings as of each game's week (UnitRatings) -> features [pass edge, run edge].
 2. Points model per test season S, fitted by least squares on seasons S-3..S-1 (as-of features):
        pts = a + bp * pass_edge + br * run_edge + hfa/2 * site
 3. Elo (538-style, bt_report.elo_predictions) and a blend: margin = w * ratings_margin + (1 - w) * elo_spread, w by least squares on S-3..S-1.
 4. Config chosen by mean margin MAE over the TRAIN seasons only; then scored once on the TEST seasons.
Writes expected points for every test game (games.json, same format as backtest.py) so backtest.mjs can simulate them.
"""
import argparse, csv, itertools, json, math, os, pickle, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from football.unit_ratings import UnitRatings, features
from football.ratings import canon
from football.bt_report import elo_predictions

try:
    import numpy as np

    def np_solver(rows, p, pen, prior):
        A = np.zeros((p, p)); b = np.zeros(p)
        for idx, val, y, w in rows:
            ix = np.array(idx); v = np.array(val) * math.sqrt(w)
            A[np.ix_(ix, ix)] += np.outer(v, v); b[ix] += v * math.sqrt(w) * y
        pen = np.array(pen); A += np.diag(pen); b += pen * np.array(prior)
        A[np.diag_indices(p)] = np.where(np.diag(A) == 0, 1e-9, np.diag(A))
        return list(np.linalg.solve(A, b))
except ImportError:
    np_solver = None


def span(s):
    a, _, b = s.partition("-"); return list(range(int(a), int(b or a) + 1))


def lstsq(X, y):
    k = len(X[0]); A = [[sum(r[i] * r[j] for r in X) for j in range(k)] for i in range(k)]; b = [sum(r[i] * v for r, v in zip(X, y)) for i in range(k)]
    from football.linalg import cholesky_solve
    for i in range(k): A[i][i] += 1e-9
    return cholesky_solve(A, b)


def load_games(path, seasons):
    out = []
    for r in csv.DictReader(open(path)):
        if int(r["season"]) not in seasons or r["home_score"] in ("", "NA"):
            continue
        num = lambda v: float(v) if v not in ("", "NA") else None
        out.append({"id": r["game_id"], "season": int(r["season"]), "week": int(r["week"]), "gameType": r["game_type"], "playoff": r["game_type"] != "REG",
                    "kickoff": r["gameday"], "home": canon(r["home_team"]), "away": canon(r["away_team"]), "neutral": r["location"] == "Neutral",
                    "homeScore": int(r["home_score"]), "awayScore": int(r["away_score"]), "spreadLine": num(r["spread_line"]), "totalLine": num(r["total_line"])})
    return out


OLD = {}


def old_ratings(old_obs, season, week):
    """The v1 production ratings (single EPA/play unit, ratings.py) as of (season, week), cached."""
    from football import ratings as R
    k = (season, week)
    if k not in OLD:
        OLD[k] = R.fit(old_obs, season, week, R.DEFAULTS, iters=30)
    return OLD[k]


def evaluate(UR, games, elo, seasons, keep=False, use=("unit",), old_obs=None):
    feats = {}
    for g in games:
        site = 0 if g["neutral"] else 1
        fh, fa = [], []
        if "unit" in use:
            r = UR.at(g["season"], g["week"]); fh += features(r, g["home"], g["away"]); fa += features(r, g["away"], g["home"])
        if "old" in use:
            o = old_ratings(old_obs, g["season"], g["week"])
            fh.append(o["off"].get(g["home"], 0.0) + o["def"].get(g["away"], 0.0)); fa.append(o["off"].get(g["away"], 0.0) + o["def"].get(g["home"], 0.0))
        feats[g["id"]] = (fh, fa, site)
    res, out = {}, []
    for S in seasons:
        tr = [g for g in games if S - 3 <= g["season"] < S]
        X, y = [], []
        for g in tr:
            fh, fa, site = feats[g["id"]]
            X += [[1.0, *fh, site / 2], [1.0, *fa, -site / 2]]; y += [g["homeScore"], g["awayScore"]]
        coef = lstsq(X, y); a, h = coef[0], coef[-1]
        pts = lambda f, s, c=coef: c[0] + sum(ci * fi for ci, fi in zip(c[1:-1], f)) + c[-1] * s / 2
        rm = lambda g: pts(feats[g["id"]][0], feats[g["id"]][2]) - pts(feats[g["id"]][1], -feats[g["id"]][2])
        # blend weight on the same training window (Elo spread is itself walk-forward)
        Xb = [[rm(g), elo[g["id"]]["spread"]] for g in tr if g["id"] in elo]; yb = [g["homeScore"] - g["awayScore"] for g in tr if g["id"] in elo]
        wr, we = lstsq(Xb, yb)
        for g in (x for x in games if x["season"] == S):
            fh, fa, site = feats[g["id"]]
            eh, ea = pts(fh, site), pts(fa, -site)
            row = {"g": g, "rat": eh - ea, "elo": elo.get(g["id"], {}).get("spread"), "blend": wr * (eh - ea) + we * elo.get(g["id"], {}).get("spread", 0.0), "eh": eh, "ea": ea,
                   "model": {"coef": coef, "features": list(use), "hfa": h, "wRatings": wr, "wElo": we}}
            out.append(row)
    return out


def score(rows, key):
    m = [r["g"]["homeScore"] - r["g"]["awayScore"] for r in rows]; p = [r[key] for r in rows]
    n = len(rows); phi = lambda z: 0.5 * (1 + math.erf(z / math.sqrt(2)))
    ys = [1 if x > 0 else 0 if x < 0 else 0.5 for x in m]; wp = [min(1 - 1e-4, max(1e-4, phi(v / 13.5))) for v in p]
    return {"n": n, "mae": sum(abs(a - b) for a, b in zip(p, m)) / n, "rmse": math.sqrt(sum((a - b) ** 2 for a, b in zip(p, m)) / n),
            "brier": sum((w - y) ** 2 for w, y in zip(wp, ys)) / n, "logLoss": -sum(y * math.log(w) + (1 - y) * math.log(1 - w) for w, y in zip(wp, ys)) / n}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("obs"); ap.add_argument("games"); ap.add_argument("out")
    ap.add_argument("--train", default="2019-2022"); ap.add_argument("--test", default="2023-2026"); ap.add_argument("--quick", action="store_true")
    ap.add_argument("--use", default="unit", help="comma list of rating features: unit, old")
    ap.add_argument("--old-obs", default=None, help="pickle of ratings.nfl_observations for the v1 ratings")
    a = ap.parse_args()
    obs = pickle.load(open(a.obs, "rb")); train, test = span(a.train), span(a.test)
    use = tuple(a.use.split(",")); old_obs = pickle.load(open(a.old_obs, "rb")) if a.old_obs else None
    ev = lambda UR, gs, ss: evaluate(UR, gs, elo, ss, use=use, old_obs=old_obs)
    games = load_games(a.games, set(range(min(train) - 3, max(test) + 1)))
    elo = elo_predictions(a.games, {g["id"] for g in games})
    grid = [(8.0, 300.0, 0.6)] if use == ("old",) else list(itertools.product((4.0, 8.0, 16.0, 1e6), (100.0, 300.0, 1000.0), (0.4, 0.6, 0.8))) if not a.quick else [(8.0, 300.0, 0.6)]
    cv = []
    for hl, lam, rho in grid:
        UR = UnitRatings(obs, {"half_life": hl, "lam": lam, "rho": rho}, solver=np_solver)
        rows = ev(UR, [g for g in games if g["season"] <= max(train)], train)
        s = {k: score(rows, k) for k in ("rat", "elo", "blend")}
        cv.append({"half_life": hl, "lam": lam, "rho": rho, **{k: round(v["mae"], 4) for k, v in s.items()}, "blendBrier": round(s["blend"]["brier"], 4)})
        print(json.dumps(cv[-1]), flush=True)
    best = min(cv, key=lambda c: c["blend"])
    bestR = min(cv, key=lambda c: c["rat"])
    print("chosen on train (blend MAE):", best, "| best ratings-only:", bestR, flush=True)
    UR = UnitRatings(obs, {"half_life": best["half_life"], "lam": best["lam"], "rho": best["rho"]}, solver=np_solver)
    rows = ev(UR, games, test)
    have_line = [r for r in rows if r["g"]["spreadLine"] is not None and r["elo"] is not None]
    for r in have_line: r["line"] = r["g"]["spreadLine"]
    res = {"cv": cv, "chosen": best, "test": {k: score(have_line, k) for k in ("rat", "elo", "blend", "line")},
           "bySeason": {S: {k: score([r for r in have_line if r["g"]["season"] == S], k) for k in ("rat", "elo", "blend", "line")} for S in test},
           "models": {S: next(r["model"] for r in rows if r["g"]["season"] == S) for S in test}}
    os.makedirs(a.out, exist_ok=True)
    json.dump(res, open(os.path.join(a.out, "rigor.json"), "w"), indent=1)
    print(json.dumps(res["test"], indent=1)); print(json.dumps(res["models"]))
    # expected points for the sim backtest: blend margin, ratings total
    gout = []
    for r in rows:
        tot = r["eh"] + r["ea"]; mg = r["blend"]
        gout.append({**r["g"], "status": "final", "expected": {"home": (tot + mg) / 2, "away": (tot - mg) / 2}, "ratingsMargin": r["rat"], "eloSpread": r["elo"]})
    json.dump({"config": best, "models": res["models"], "test": test, "games": gout}, open(os.path.join(a.out, "games.json"), "w"))


if __name__ == "__main__":
    main()
