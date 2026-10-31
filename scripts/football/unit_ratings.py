"""Pass/run unit ratings: opponent-adjusted ridge regression with time decay and a regressed preseason prior.

For each unit u in {pass, run} and each (game, offense) observation:
    epa_per_play_u = m_u + o_u[off] + d_u[def] + h_u * site + noise,   weight = plays_u * 0.5 ** (age_weeks / half_life)
Only the current season's games before the as-of week enter the likelihood. The Gaussian prior is
    o_u[t] ~ N(rho * o_u_final[t, season - 1], sigma^2 / lam),   same for d_u
so lam (in plays) is how many plays the prior is worth and rho regresses last season's final rating to the mean.
This is a discrete Kalman-style update across seasons (the posterior at the end of a season, shrunk by rho, is the next prior).
Solved exactly as a weighted ridge with a prior mean (linalg.ridge_sparse, stdlib only).
Hyper-parameters (half_life, lam, rho) are chosen by rolling-origin CV on training seasons only (scripts/football/rigor.py).
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from football.extract import IDX as I
from football.ratings import canon
from football import linalg

UNITS = ("pass", "run")
DEFAULTS = {"half_life": 8.0, "lam": 300.0, "rho": 0.6, "lam_hfa": 2000.0}


def unit_observations(rows):
    """[(season, week, game_id, off, def, site, {pass: (n, sum_epa), run: (n, sum_epa)})]; garbage time (wp<5% or >95%) dropped.
    site = +1 offense at home, -1 away (neutral sites are treated as home/away as listed: few games)."""
    agg = {}
    for r in rows:
        pt = r[I["play_type"]]
        if pt not in ("pass", "run") or r[I["epa"]] is None or r[I["two_point_attempt"]] == 1 or r[I["qb_kneel"]] == 1 or r[I["qb_spike"]] == 1:
            continue
        wp = r[I["wp"]]
        if wp is not None and (wp < 0.05 or wp > 0.95):
            continue
        k = (r[I["game_id"]], r[I["posteam"]])
        a = agg.get(k)
        if a is None:
            site = 1 if r[I["posteam"]] == r[I["home_team"]] else -1
            a = agg[k] = [r[I["season"]], r[I["week"]], r[I["game_id"]], canon(r[I["posteam"]]), canon(r[I["defteam"]]), site, [0, 0.0], [0, 0.0]]
        u = a[6] if (r[I["pass"]] == 1 or pt == "pass") else a[7]
        u[0] += 1; u[1] += r[I["epa"]]
    return [(s, w, g, o, d, site, {"pass": tuple(p), "run": tuple(rn)}) for s, w, g, o, d, site, p, rn in agg.values()]


def fit_unit(obs, unit, season, week, teams, prior, cfg, solver=None):
    """One unit's ratings using only `season` games with week < `week`. prior: {"off": {t: x}, "def": {t: x}}.
    Returns {"m", "hfa", "off", "def"}."""
    idx = {t: i for i, t in enumerate(teams)}
    T = len(teams); p = 2 + 2 * T          # m, hfa, off[T], def[T]
    rows = []
    for s, w, g, o, d, site, u in obs:
        if s != season or w >= week:
            continue
        n, e = u[unit]
        if n <= 0 or o not in idx or d not in idx:
            continue
        wt = n * 0.5 ** ((week - w) / cfg["half_life"])
        rows.append(([0, 1, 2 + idx[o], 2 + T + idx[d]], [1.0, float(site), 1.0, 1.0], e / n, wt))
    pen = [0.0, cfg["lam_hfa"]] + [cfg["lam"]] * (2 * T)
    pm = [prior.get("m", 0.0), 0.0] + [prior["off"].get(t, 0.0) for t in teams] + [prior["def"].get(t, 0.0) for t in teams]
    if not rows:
        return {"m": pm[0], "hfa": 0.0, "off": dict(prior["off"]), "def": dict(prior["def"]), "n": 0}
    beta = (solver or (lambda r, p_, pe, pr: linalg.ridge_sparse(r, p_, pe, pr)[0]))(rows, p, pen, pm)
    return {"m": beta[0], "hfa": beta[1], "off": {t: beta[2 + i] for t, i in idx.items()}, "def": {t: beta[2 + T + i] for t, i in idx.items()}, "n": len(rows)}


class UnitRatings:
    """Walk-forward ratings for every (season, week). Season finals feed the next season's prior."""

    def __init__(self, obs, cfg=None, solver=None):
        self.obs, self.cfg, self.solver = obs, {**DEFAULTS, **(cfg or {})}, solver
        self.cache, self.finals = {}, {}
        self.teams = sorted({o[3] for o in obs} | {o[4] for o in obs})
        self.seasons = sorted({o[0] for o in obs})

    def prior(self, season, unit):
        prev = self.final(season - 1, unit) if season - 1 in self.seasons else None
        rho = self.cfg["rho"]
        if not prev:
            return {"m": 0.0, "off": {}, "def": {}}
        mo = sum(prev["off"].values()) / len(prev["off"]); md = sum(prev["def"].values()) / len(prev["def"])
        return {"m": prev["m"], "off": {t: rho * (x - mo) for t, x in prev["off"].items()}, "def": {t: rho * (x - md) for t, x in prev["def"].items()}}

    def final(self, season, unit):
        k = (season, unit)
        if k not in self.finals:
            last = max(o[1] for o in self.obs if o[0] == season) + 1    # decay measured from the end of that season
            self.finals[k] = fit_unit(self.obs, unit, season, last, self.teams, self.prior(season, unit), self.cfg, self.solver)
        return self.finals[k]

    def at(self, season, week):
        k = (season, week)
        if k not in self.cache:
            self.cache[k] = {u: fit_unit(self.obs, u, season, week, self.teams, self.prior(season, u), self.cfg, self.solver) for u in UNITS}
        return self.cache[k]


def features(r, team, opp):
    """Matchup features for team's offense vs opp's defense: [pass EPA/play edge, run EPA/play edge]."""
    return [r["pass"]["off"].get(team, 0.0) + r["pass"]["def"].get(opp, 0.0), r["run"]["off"].get(team, 0.0) + r["run"]["def"].get(opp, 0.0)]
