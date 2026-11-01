"""Expected game total (over/under points) model. Ryan 10/31: "do better at the over/under total points".

The EPA points model alone (total = 2a + b * [off_h + def_a + off_a + def_h]) misses two things the walk-forward backtest
found: the scoring level the ratings see from points actually scored (recent, opponent-adjusted points for and
against), and indoor games (dome or closed roof) scoring more in the NFL. The total is a small least-squares blend:

    total = c0 + c1 * x_epa + c2 * x_pts (+ c3 * indoor, NFL)

x_epa  = off_h + def_a + off_a + def_h from the EPA-per-play ratings (as today);
x_pts  = expected combined points from game-level points ratings: R.fit on [season, week, team, opp, 1, points]
         (opponent-adjusted, recency-weighted, ridge-shrunk; lambda 8, half-life 8 NFL / 12 NCAAF weeks);
indoor = 1 for a dome or closed retractable roof (nflverse schedule `roof`); no roof data for college.

Coefficients are refit before every week on completed games only: the previous 3 NFL seasons (1 NCAAF season) plus the
current season's earlier weeks, NFL samples recency-weighted (half-life 22 weeks). Every feature uses ratings fitted
strictly before the game's week, so nothing leaks from the game or later games. Margin is unchanged (Elo / blend +
availability); this only sets the total that split_points() divides.
"""
from football import ratings as R

CFG = {
    "nfl": {"pts": {"lambda": 8, "half_life": 8}, "indoor": True, "train_seasons": 3, "sample_half_life": 22, "season_len": 22,
            "need_weight": False},
    "ncaaf": {"pts": {"lambda": 8, "half_life": 12}, "indoor": False, "train_seasons": 1, "sample_half_life": None, "season_len": 30,
              "need_weight": True},
}
INDOOR_ROOFS = ("dome", "closed")


def is_indoor(roof):
    return 1 if (roof or "").strip().lower() in INDOOR_ROOFS else 0


def points_obs(games):
    """Game-level points observations for R.fit: one row per team-game (offense = scoring team)."""
    out = []
    for g in games:
        if g.get("homeScore") is None or g.get("awayScore") is None:
            continue
        out.append([g["season"], g["week"], g["home"], g["away"], 1, g["homeScore"]])
        out.append([g["season"], g["week"], g["away"], g["home"], 1, g["awayScore"]])
    return out


def pair(r, h, a):
    return r["off"].get(h, 0.0) + r["def"].get(a, 0.0) + r["off"].get(a, 0.0) + r["def"].get(h, 0.0)


def features(league, epa_r, pts_r, g):
    c = CFG[league]
    x = [1.0, pair(epa_r, g["home"], g["away"]), 2 * pts_r["m"] + pair(pts_r, g["home"], g["away"])]
    if c["indoor"]:
        x.append(float(g.get("indoor") or 0))
    return x


def pts_cfg(league, base_cfg):
    return {**base_cfg, **CFG[league]["pts"]}


class Fits:
    """As-of rating fits cached per (season, week): EPA (existing config) and points ratings."""
    def __init__(self, league, epa_obs, pts_obs_rows, epa_cfg, iters=30):
        self.league, self.epa_obs, self.pts_obs, self.epa_cfg, self.iters = league, epa_obs, pts_obs_rows, epa_cfg, iters
        self.pcfg = pts_cfg(league, epa_cfg); self.c = {}

    def at(self, season, week, teams=None):
        k = (season, week)
        if k not in self.c:
            self.c[k] = (R.fit(self.epa_obs, season, week, self.epa_cfg, teams=teams, iters=self.iters),
                         R.fit(self.pts_obs, season, week, self.pcfg, teams=teams, iters=self.iters))
        return self.c[k]


def samples(league, fits, games):
    """[(features, total, season, week)] for completed games, features from ratings strictly before the game's week."""
    out = []
    for g in games:
        if g.get("homeScore") is None or g.get("awayScore") is None:
            continue
        er, pr = fits.at(g["season"], g["week"])
        if CFG[league]["need_weight"] and (not er["weight"].get(g["home"]) or not er["weight"].get(g["away"])):
            continue
        out.append((features(league, er, pr, g), g["homeScore"] + g["awayScore"], g["season"], g["week"]))
    return out


def _solve(A, b):
    n = len(b); M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        if abs(M[p][c]) < 1e-12:
            raise ValueError("singular totals fit")
        M[c], M[p] = M[p], M[c]
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                M[r] = [x - f * y for x, y in zip(M[r], M[c])]
    return [M[i][n] / M[i][i] for i in range(n)]


def fit(league, smp, season, week):
    """Weighted least squares on training samples available before (season, week). None if too few samples."""
    c = CFG[league]
    use = [s for s in smp if (season - c["train_seasons"] <= s[2] < season) or (s[2] == season and s[3] < week)]
    if len(use) < 50:
        return None
    k = len(use[0][0]); A = [[0.0] * k for _ in range(k)]; b = [0.0] * k
    for x, y, s, w in use:
        wt = 0.5 ** (((season - s) * c["season_len"] + (week - w)) / c["sample_half_life"]) if c["sample_half_life"] else 1.0
        for i in range(k):
            b[i] += wt * x[i] * y
            for j in range(k):
                A[i][j] += wt * x[i] * x[j]
    beta = _solve(A, b)
    return {"coef": [round(v, 5) for v in beta], "n": len(use), "features": ["const", "x_epa", "x_pts"] + (["indoor"] if c["indoor"] else [])}


def predict(model, x):
    return sum(c * v for c, v in zip(model["coef"], x))
