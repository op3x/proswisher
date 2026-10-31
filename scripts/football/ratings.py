"""Opponent-adjusted, recency-weighted team ratings: offense and defense EPA per play.

Model (weighted ridge regression, solved by coordinate descent / Gauss-Seidel):
    epa_per_play(off=A, def=B, game g) = m + o_A + d_B + noise,    weight = plays_g * 0.5 ** (age_weeks_g / HALF_LIFE)
    with an L2 penalty LAMBDA * (o^2 + d^2) (in play units), i.e. ratings shrink to league average with little data.
    o_A > 0: offense better than average. d_B > 0: defense ALLOWS more than average (worse).
Age counts regular-season weeks; the off-season adds OFFSEASON_WEEKS so last season fades but still informs week 1.

Points mapping (fitted out of sample on earlier seasons, see backtest.py):
    expected points of A vs B = a + b * (o_A + d_B) + hfa/2 * (+1 home, -1 away, 0 neutral)
"""
from collections import defaultdict

# tuned by scripts/football/backtest.py --tune on 2020-2022 only (held-out 2023+): see docs/football-model.md
DEFAULTS = {"half_life": 16.0, "offseason_weeks": 8.0, "lambda": 800.0, "season_weeks": 22}
RELOCATED = {"OAK": "LV", "SD": "LAC", "STL": "LA"}


def canon(team):
    return RELOCATED.get(team, team)


def nfl_observations(rows, I):
    """Aggregate compact pbp rows into per (game, offense) observations: [season, week, off, def, plays, sum_epa]."""
    agg = {}
    for r in rows:
        if r[I["play_type"]] not in ("pass", "run") or r[I["epa"]] is None or r[I["two_point_attempt"]] == 1:
            continue
        wp = r[I["wp"]]
        if wp is not None and (wp < 0.05 or wp > 0.95):     # drop garbage time
            continue
        k = (r[I["game_id"]], r[I["posteam"]])
        a = agg.get(k)
        if a is None:
            a = agg[k] = [r[I["season"]], r[I["week"]], canon(r[I["posteam"]]), canon(r[I["defteam"]]), 0, 0.0]
        a[4] += 1; a[5] += r[I["epa"]]
    return list(agg.values())


def age_weeks(season, week, at_season, at_week, cfg=DEFAULTS):
    return (at_season - season) * (cfg["season_weeks"] + cfg["offseason_weeks"]) + (at_week - week)


def fit(obs, at_season, at_week, cfg=None, teams=None, iters=60):
    """Ratings using only observations strictly before (at_season, at_week). Returns dict."""
    cfg = {**DEFAULTS, **(cfg or {})}
    use = []
    for s, w, o, d, n, e in obs:
        if (s, w) >= (at_season, at_week) or n <= 0:
            continue
        age = age_weeks(s, w, at_season, at_week, cfg)
        if age > 3 * (cfg["season_weeks"] + cfg["offseason_weeks"]):
            continue
        use.append((o, d, n * 0.5 ** (age / cfg["half_life"]), e / n))
    teams = set(teams or []) | {u[0] for u in use} | {u[1] for u in use}
    off = {t: 0.0 for t in teams}; de = {t: 0.0 for t in teams}
    if not use:
        return {"m": 0.0, "off": off, "def": de, "weight": {t: 0.0 for t in teams}}
    lam = cfg["lambda"]
    by_off = defaultdict(list); by_def = defaultdict(list)
    for u in use:
        by_off[u[0]].append(u); by_def[u[1]].append(u)
    sw = sum(u[2] for u in use)
    m = sum(u[2] * u[3] for u in use) / sw
    for _ in range(iters):
        m = sum(u[2] * (u[3] - off[u[0]] - de[u[1]]) for u in use) / sw
        for t in teams:
            us = by_off.get(t, ())
            off[t] = sum(u[2] * (u[3] - m - de[u[1]]) for u in us) / (sum(u[2] for u in us) + lam)
        for t in teams:
            us = by_def.get(t, ())
            de[t] = sum(u[2] * (u[3] - m - off[u[0]]) for u in us) / (sum(u[2] for u in us) + lam)
    weight = {t: sum(u[2] for u in by_off.get(t, ())) for t in teams}
    return {"m": m, "off": off, "def": de, "weight": weight}


def expected_points(r, model, team, opp, site):
    """site: +1 team at home, -1 away, 0 neutral."""
    x = r["off"].get(team, 0.0) + r["def"].get(opp, 0.0)
    return model["a"] + model["b"] * x + model["hfa"] / 2 * site


def fit_points_model(samples):
    """Least squares for pts = a + b*x + h*site over samples [(x, site, pts)]. Returns {a, b, hfa}."""
    import itertools
    n = len(samples)
    if n < 30:
        return {"a": 22.0, "b": 100.0, "hfa": 1.8, "n": n, "note": "default (too few games to fit)"}
    # normal equations (3x3)
    X = [(1.0, x, s) for x, s, _ in samples]; y = [p for _, _, p in samples]
    A = [[sum(r[i] * r[j] for r in X) for j in range(3)] for i in range(3)]
    B = [sum(r[i] * yy for r, yy in zip(X, y)) for i in range(3)]
    sol = _solve3(A, B)
    return {"a": round(sol[0], 4), "b": round(sol[1], 4), "hfa": round(2 * sol[2], 4), "n": n}


def _solve3(A, B):
    M = [row[:] + [b] for row, b in zip(A, B)]
    for c in range(3):
        p = max(range(c, 3), key=lambda r: abs(M[r][c])); M[c], M[p] = M[p], M[c]
        for r in range(3):
            if r != c and M[c][c]:
                f = M[r][c] / M[c][c]
                M[r] = [a - f * b for a, b in zip(M[r], M[c])]
    return [M[i][3] / M[i][i] for i in range(3)]
