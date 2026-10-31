"""Backtest report (research only; not run in production).

usage: python3 scripts/football/bt_report.py <backtest dir> <nflverse games.csv> [out dir]

Reads rows.json written by backtest.mjs and adds, on exactly the same games:
  * an Elo baseline (FiveThirtyEight-style NFL Elo fitted walk-forward from 1999 on nflverse schedules:
    K=20, home field 48 Elo pts, margin-of-victory multiplier, 1/3 regression to 1505 each offseason;
    a game's prediction uses only games completed before it)
  * calibration table (10 bins) for the sim win probability, and a calibration PNG if matplotlib is present
  * coverage of the sim 80% / 95% margin and total intervals
  * per-season breakdown
Writes report.json (+ calibration.png) to the out dir.
"""
import csv, json, math, os, sys


def phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


ELO_DEFAULTS = {"k": 20, "hfa": 48, "keep": 2 / 3, "mean": 1505, "per_pt": 25}


def elo_predictions(games_csv, want_ids, cfg=None):
    """538-style NFL Elo. cfg overrides ELO_DEFAULTS (k, hfa in Elo points, keep = share of rating kept each offseason)."""
    c = {**ELO_DEFAULTS, **(cfg or {})}
    rows = [r for r in csv.DictReader(open(games_csv)) if r["home_score"] not in ("", "NA")]
    rows.sort(key=lambda r: (r["gameday"], r["game_id"]))
    elo, season, out = {}, None, {}
    for r in rows:
        if r["season"] != season:
            season = r["season"]
            for t in elo:
                elo[t] = elo[t] * c["keep"] + c["mean"] * (1 - c["keep"])
        h, a = r["home_team"], r["away_team"]
        eh, ea = elo.get(h, c["mean"]), elo.get(a, c["mean"])
        hfa = 0 if r["location"] == "Neutral" else c["hfa"]
        d = eh + hfa - ea
        p = 1 / (1 + 10 ** (-d / 400))
        if r["game_id"] in want_ids:
            out[r["game_id"]] = {"p": p, "spread": d / c["per_pt"]}
        mv = int(r["home_score"]) - int(r["away_score"])
        y = 1 if mv > 0 else 0 if mv < 0 else 0.5
        mult = math.log(abs(mv) + 1) * 2.2 / ((d if mv > 0 else -d) * 0.001 + 2.2) if mv != 0 else 1
        shift = c["k"] * mult * (y - p)
        elo[h], elo[a] = eh + shift, ea - shift
    return out


def metrics(rows, pk, mk):
    y = [1 if r["margin"] > 0 else 0 if r["margin"] < 0 else 0.5 for r in rows]
    p = [min(1 - 1e-4, max(1e-4, pk(r))) for r in rows]
    n = len(rows)
    m = {"n": n,
         "brier": sum((pi - yi) ** 2 for pi, yi in zip(p, y)) / n,
         "logLoss": -sum(yi * math.log(pi) + (1 - yi) * math.log(1 - pi) for pi, yi in zip(p, y)) / n,
         "marginMae": sum(abs(mk(r) - r["margin"]) for r in rows) / n,
         "marginRmse": math.sqrt(sum((mk(r) - r["margin"]) ** 2 for r in rows) / n)}
    dec = [(r, mk(r)) for r in rows if r["margin"] != 0 and mk(r) != 0]
    m["winnerPct"] = sum(1 for r, x in dec if (x > 0) == (r["margin"] > 0)) / len(dec)
    return m


def main():
    d, gcsv = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else d
    rows = json.load(open(os.path.join(d, "rows.json")))
    elo = elo_predictions(gcsv, {r["id"] for r in rows})
    rows = [r for r in rows if r["id"] in elo and r.get("spreadLine") is not None]
    rep = {"games": len(rows), "note": "same games for every model: those with an Elo history and a closing spread"}
    rep["sim"] = metrics(rows, lambda r: r["wpHome"], lambda r: r["simMarginMean"])
    rep["ratingsOnly"] = metrics(rows, lambda r: phi(r["expMargin"] / 13.5), lambda r: r["expMargin"])
    rep["elo"] = metrics(rows, lambda r: elo[r["id"]]["p"], lambda r: elo[r["id"]]["spread"])
    rep["closingLine"] = metrics(rows, lambda r: phi(r["spreadLine"] / 13.5), lambda r: r["spreadLine"])
    # interval coverage (nominal 80 / 95)
    cov = lambda k, v: sum(1 for r in rows if r[k][0] <= v(r) <= r[k][1]) / len(rows)
    rep["coverage"] = {"margin80": cov("margin80", lambda r: r["margin"]), "margin95": cov("margin95", lambda r: r["margin"]),
                       "total80": cov("total80", lambda r: r["total"]), "total95": cov("total95", lambda r: r["total"])}
    # calibration
    bins = [[] for _ in range(10)]
    for r in rows:
        bins[min(9, int(r["wpHome"] * 10))].append(r)
    rep["calibration"] = [{"bin": f"{i/10:.1f}-{(i+1)/10:.1f}", "n": len(b),
                           "meanPred": (sum(r["wpHome"] for r in b) / len(b)) if b else None,
                           "homeWinRate": (sum(1 if r["margin"] > 0 else 0.5 if r["margin"] == 0 else 0 for r in b) / len(b)) if b else None}
                          for i, b in enumerate(bins)]
    rep["bySeason"] = {s: {"sim": metrics([r for r in rows if r["season"] == s], lambda r: r["wpHome"], lambda r: r["simMarginMean"]),
                           "elo": metrics([r for r in rows if r["season"] == s], lambda r: elo[r["id"]]["p"], lambda r: elo[r["id"]]["spread"]),
                           "closingLine": metrics([r for r in rows if r["season"] == s], lambda r: phi(r["spreadLine"] / 13.5), lambda r: r["spreadLine"])}
                       for s in sorted({r["season"] for r in rows})}
    os.makedirs(out, exist_ok=True)
    json.dump(rep, open(os.path.join(out, "report.json"), "w"), indent=2)
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        c = [b for b in rep["calibration"] if b["n"]]
        fig, ax = plt.subplots(figsize=(5, 5))
        ax.plot([0, 1], [0, 1], "--", color="grey", label="perfect")
        ax.scatter([b["meanPred"] for b in c], [b["homeWinRate"] for b in c], s=[max(10, b["n"]) for b in c], label="sim (size = games)")
        ax.set_xlabel("predicted home win probability"); ax.set_ylabel("observed home win rate")
        ax.set_title(f"NFL sim calibration, {rep['games']} games (walk-forward)")
        ax.legend(); fig.tight_layout(); fig.savefig(os.path.join(out, "calibration.png"), dpi=120)
        rep["png"] = os.path.join(out, "calibration.png")
    except ImportError:
        rep["png"] = None
    print(json.dumps({k: rep[k] for k in ("games", "sim", "ratingsOnly", "elo", "closingLine", "coverage")}, indent=1))


if __name__ == "__main__":
    main()
