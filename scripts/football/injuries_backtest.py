"""Offline research: fit the availability adjustment on 2019-2022 and write adjusted games.json shards for the
2023-2026 walk-forward (re-simmed with backtest.mjs against the production Q2-fix rows). Private paths only; prints
aggregate numbers only (no player names or ids).
usage: python3 -m football.injuries_backtest NFLCACHE PROD_SHARD_ROOT OUT_ROOT
"""
import csv, json, os, sys
from . import elo as E, injuries as I

TRAIN, TEST = range(2019, 2023), range(2023, 2027)


def main(cache, prod_root, out_root):
    sched = list(csv.DictReader(open(os.path.join(cache, "games.csv"))))
    games = []
    for g in sched:
        if int(g["season"]) < 2010 or g["game_type"] == "": continue
        fin = g["home_score"] not in ("", "NA")
        games.append({"id": g["game_id"], "season": int(g["season"]), "week": int(g["week"]),
                      "kickoff": g["gameday"] + "T" + (g["gametime"] or "13:00"), "home": I._t(g["home_team"]),
                      "away": I._t(g["away_team"]), "neutral": g["location"] == "Neutral",
                      "homeScore": int(g["home_score"]) if fin else None, "awayScore": int(g["away_score"]) if fin else None})
    pre, _ = E.run_elo(games)
    usage = I.pbp_usage([os.path.join(cache, f"play_by_play_{y}.csv.gz") for y in range(2018, 2027)])
    role = I.roles_before(usage)
    rep = I.load_reports([os.path.join(cache, f"injuries_{y}.csv.gz") for y in range(2019, 2027)])
    rates, n = I.miss_rates(rep, usage, role, set(TRAIN))
    print("P(miss|status) on 2019-2022:", {k: round(v, 3) for k, v in rates.items()}, "n", n)

    def feats(g):
        hq, hk = I.team_loss(rep, role, rates, g["season"], g["week"], g["home"])
        aq, ak = I.team_loss(rep, role, rates, g["season"], g["week"], g["away"])
        return hq - aq, hk - ak
    rows = {}
    for g in games:
        if g["season"] in TRAIN and g["homeScore"] is not None:
            dq, dk = feats(g)
            rows.setdefault(g["season"], []).append((g["homeScore"] - g["awayScore"] - pre[g["id"]]["spread"], dq, dk, g))
    tr = [r for s in TRAIN for r in rows[s]]

    def mae(rs, b): return sum(abs(r[0] + b[0] * r[1] + b[1] * r[2]) for r in rs) / len(rs)
    # inner validation (still train-only): fit 2019-2021, score 2022
    b_in = I.fit_coefs([r for s in (2019, 2020, 2021) for r in rows[s]])
    print("inner fit 2019-21 b=", [round(x, 2) for x in b_in], "2022 Elo-margin MAE base", round(mae(rows[2022], (0, 0)), 3),
          "adj", round(mae(rows[2022], b_in), 3))
    b = I.fit_coefs(tr)
    print("fit 2019-2022 b_qb=%.2f b_skill=%.2f pts per unit loss; train MAE %.3f -> %.3f" % (b[0], b[1], mae(tr, (0, 0)), mae(tr, b)))
    json.dump({"rates": rates, "b_qb": b[0], "b_skill": b[1], "lookback": I.LOOKBACK, "fitSeasons": list(TRAIN)},
              open(os.path.join(out_root, "inj_fit.json"), "w"), indent=1)
    nz = tot = 0
    for s in TEST:
        src = os.path.join(prod_root, f"q2_{s}"); dst = os.path.join(out_root, f"inj_{s}")
        os.makedirs(dst, exist_ok=True)
        d = json.load(open(os.path.join(src, "games.json")))
        for g in d["games"]:
            dq, dk = feats(g)
            adj = -(b[0] * dq + b[1] * dk)          # home margin adjustment
            g["expected"] = {"home": g["expected"]["home"] + adj / 2, "away": g["expected"]["away"] - adj / 2}
            tot += 1; nz += abs(adj) > 0.05
        json.dump(d, open(os.path.join(dst, "games.json"), "w"))
        os.system(f"cp {os.path.join(src, 'params.json')} {dst}/")
    print("test games", tot, "with a non-zero adjustment", nz)


if __name__ == "__main__":
    main(*sys.argv[1:4])
