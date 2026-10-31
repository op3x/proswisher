"""Rigor step 4: per-quarter error of the sim vs actual quarter scores (research only; stdlib).

Actual quarter points come from nflverse pbp (CC BY 4.0): the cumulative total_home_score/total_away_score at the last play of each
quarter, differenced. Overtime is excluded, matching the sim's byPeriod (regulation quarters only).
Usage: python3 quarter_eval.py <rows.json> <out.json> <pbp_YYYY.csv.gz> [...]
"""
import csv, gzip, json, math, statistics as st, sys


def actual_quarters(pbp_paths, want):
    last = {}
    for p in pbp_paths:
        with gzip.open(p, "rt", newline="") as f:
            for r in csv.DictReader(f):
                g = r["game_id"]
                if g not in want or r["qtr"] in ("", "NA"):
                    continue
                q = int(float(r["qtr"]))
                if q > 4 or r["total_home_score"] in ("", "NA"):
                    continue
                last[(g, q)] = (int(float(r["total_home_score"])), int(float(r["total_away_score"])))
    out = {}
    for g in want:
        if not all((g, q) in last for q in range(1, 5)):
            continue
        cum = [(0, 0)] + [last[(g, q)] for q in range(1, 5)]
        out[g] = {"home": [cum[q][0] - cum[q - 1][0] for q in range(1, 5)], "away": [cum[q][1] - cum[q - 1][1] for q in range(1, 5)]}
    return out


def evaluate(rows, actual):
    res = {}
    for q in range(4):
        e_h, e_a, e_m, e_t, base_t = [], [], [], [], []
        for r in rows:
            a = actual.get(r["id"])
            if not a:
                continue
            sh, sa = r["simQ"]["home"][q], r["simQ"]["away"][q]
            ah, aa = a["home"][q], a["away"][q]
            e_h.append(sh - ah); e_a.append(sa - aa); e_m.append((sh - sa) - (ah - aa)); e_t.append((sh + sa) - (ah + aa))
        res[f"Q{q + 1}"] = {
            "n": len(e_h),
            "simMeanTotal": round(st.mean(r["simQ"]["home"][q] + r["simQ"]["away"][q] for r in rows if r["id"] in actual), 3),
            "actualMeanTotal": round(st.mean(actual[r["id"]]["home"][q] + actual[r["id"]]["away"][q] for r in rows if r["id"] in actual), 3),
            "biasTotal": round(st.mean(e_t), 3), "maeTotal": round(st.mean(abs(x) for x in e_t), 3),
            "rmseTotal": round(math.sqrt(st.mean(x * x for x in e_t)), 3),
            "biasMargin": round(st.mean(e_m), 3), "maeMargin": round(st.mean(abs(x) for x in e_m), 3),
            "biasHome": round(st.mean(e_h), 3), "biasAway": round(st.mean(e_a), 3),
        }
    # naive baseline: every game gets the league-average quarter total from the training-free test mean (an optimistic baseline)
    for q in range(4):
        k = f"Q{q + 1}"; mu = res[k]["actualMeanTotal"]
        res[k]["maeTotalConstMean"] = round(st.mean(abs(mu - (actual[r["id"]]["home"][q] + actual[r["id"]]["away"][q])) for r in rows if r["id"] in actual), 3)
    return res


if __name__ == "__main__":
    rows = json.load(open(sys.argv[1]))
    act = actual_quarters(sys.argv[3:], {r["id"] for r in rows})
    res = evaluate(rows, act)
    json.dump({"games": len(act), "quarters": res}, open(sys.argv[2], "w"), indent=1)
    for k, v in res.items():
        print(k, v)
