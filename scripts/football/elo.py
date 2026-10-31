"""NFL Elo margin model (stdlib only). Rigor step 1 (docs/sim-methodology.md).

Walk-forward CV (train 2010-2022, test 2023-2026 wk 8) showed that, for the game MARGIN, this Elo beats the opponent-
adjusted EPA ratings, the new ridge pass/run unit ratings and least-squares blends of them out of sample. So production
uses Elo for the expected margin and keeps the EPA points model for the expected TOTAL (Elo carries no total info).
Hyperparameters chosen on 2010-2022 margin MAE only: K=16, HFA=36 Elo points, keep 1/2 of rating each offseason
(regress half-way to the mean), 22 Elo points per point of spread. 538-style margin-of-victory multiplier.
"""
import math

NFL_ELO = {"k": 16, "hfa": 36, "keep": 0.5, "mean": 1505, "per_pt": 22}


def run_elo(games, cfg=None):
    """games: dicts with season, kickoff (sortable), id, home, away, neutral, homeScore, awayScore (None if unplayed),
    in any order. Returns ({game id: {"p", "spread", "eloHome", "eloAway"}} pre-game for every game, final {team: elo})."""
    c = {**NFL_ELO, **(cfg or {})}
    elo, season, pre = {}, None, {}
    for g in sorted(games, key=lambda g: (g["kickoff"] or "", g["id"])):
        if g["season"] != season:
            season = g["season"]
            for t in elo:
                elo[t] = elo[t] * c["keep"] + c["mean"] * (1 - c["keep"])
        h, a = g["home"], g["away"]
        eh, ea = elo.get(h, c["mean"]), elo.get(a, c["mean"])
        d = eh + (0 if g["neutral"] else c["hfa"]) - ea
        p = 1 / (1 + 10 ** (-d / 400))
        pre[g["id"]] = {"p": p, "spread": d / c["per_pt"], "eloHome": eh, "eloAway": ea}
        if g["homeScore"] is None or g["awayScore"] is None:
            continue
        mv = g["homeScore"] - g["awayScore"]
        y = 1.0 if mv > 0 else 0.0 if mv < 0 else 0.5
        mult = math.log(abs(mv) + 1) * 2.2 / ((d if mv > 0 else -d) * 0.001 + 2.2) if mv else 1.0
        shift = c["k"] * mult * (y - p)
        elo[h], elo[a] = eh + shift, ea - shift
    return pre, elo


def split_points(total, margin):
    """Expected (home, away) from an expected total and an expected home margin."""
    return (total + margin) / 2, (total - margin) / 2
