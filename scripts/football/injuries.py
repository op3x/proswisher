"""NFL player-availability adjustment (RESEARCH PROTOTYPE, behind FOOTBALL_INJURIES_ENABLED, default off).

Source: nflverse-data `injuries` release (CC BY 4.0, cleared by Larry for NFL with conditions I1-I4):
  I1 model-only: nothing from these rows (names, positions, body parts, practice or game status) is ever written to public
     JSON or an API response; only the derived team-level points adjustment feeds the expected margin.
  I2 the player-ID join (gsis_id <-> pbp passer/rusher/receiver ids) happens here, server-side, and never leaves this module.
  I3 same nflverse attribution (sources.NFL_ATTRIBUTION).  I4 only the `injuries` tag was added to the allow-list.

Method (no look-ahead; see docs/sim-methodology.md section 5g):
  usage   For each team game, from pbp: each player's share of the team's QB dropbacks (passer, or scrambler) and of its
          skill touches (designed rushes + targets). A player's role before week w = mean share over his last
          `LOOKBACK` games played before week w (this season or last), so injuries in week w use only earlier games.
  status  The final game-status line of the week-w report (Out / Doubtful / Questionable), published before kickoff.
          P(miss | status) is estimated on the training seasons only (a player "misses" when he has no usage that week).
  loss    team loss = sum over listed players of P(miss|status) * share, separately for QB and skill (max 1 each).
  points  margin adjustment = -(b_qb * qb_loss + b_sk * skill_loss) for each side; b fitted by least squares on the
          residual of the production (Elo) margin on the training seasons only.
"""
import csv, gzip, os
from collections import defaultdict

STATUSES = ("Out", "Doubtful", "Questionable")
LOOKBACK = 4
TEAM_FIX = {"OAK": "LV", "SD": "LAC", "STL": "LA", "LAR": "LA"}


def _t(x): return TEAM_FIX.get(x, x)


def _open(path): return gzip.open(path, "rt", newline="") if path.endswith(".gz") else open(path, newline="")


def pbp_usage(paths):
    """{(season, week, team): {pid: (qb_share, skill_share)}} from nflverse pbp files. Player ids stay in memory only."""
    cnt = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    cols = ("season", "season_type", "week", "posteam", "qb_dropback", "pass_attempt", "rush_attempt",
            "passer_player_id", "rusher_player_id", "receiver_player_id")
    for p in paths:
        with _open(p) as f:
            rd = csv.reader(f); hdr = next(rd); ix = [hdr.index(c) for c in cols]
            for row in rd:
                se, st, wk, pos, db, pa, ra, pas, rus, rec = (row[i] for i in ix)
                if st not in ("REG", "POST") or not pos or pos == "NA":
                    continue
                k = (int(float(se)), int(float(wk)), _t(pos))
                if db == "1":
                    pid = pas if pas not in ("", "NA") else rus
                    if pid not in ("", "NA"): cnt[k][pid][0] += 1
                    if pa == "1" and rec not in ("", "NA"): cnt[k][rec][1] += 1
                elif ra == "1" and rus not in ("", "NA"):
                    cnt[k][rus][1] += 1
    out = {}
    for k, d in cnt.items():
        q = sum(v[0] for v in d.values()) or 1; s = sum(v[1] for v in d.values()) or 1
        out[k] = {pid: (v[0] / q, v[1] / s) for pid, v in d.items()}
    return out


def roles_before(usage):
    """{(season, week, team): {pid: (qb, skill)}} = role of every player BEFORE that week (last LOOKBACK games he played,
    this season or the previous one; a player's games for any team count, the role is credited to the team that lists him)."""
    hist = defaultdict(list)     # pid -> [(season, week, qb, sk)]
    for (s, w, t), d in usage.items():
        for pid, (q, k) in d.items():
            hist[pid].append((s, w, q, k))
    for v in hist.values(): v.sort()

    def role(pid, s, w):
        h = [x for x in hist.get(pid, ()) if (x[0], x[1]) < (s, w) and x[0] >= s - 1][-LOOKBACK:]
        if not h: return (0.0, 0.0)
        return (sum(x[2] for x in h) / len(h), sum(x[3] for x in h) / len(h))
    return role


def load_reports(paths):
    """{(season, week, team): [(pid, status)]}, final game status only (rows without a game status are ignored)."""
    out = defaultdict(list)
    for p in paths:
        with _open(p) as f:
            for r in csv.DictReader(f):
                if r["report_status"] in STATUSES and r["gsis_id"]:
                    out[(int(r["season"]), int(r["week"]), _t(r["team"]))].append((r["gsis_id"], r["report_status"]))
    return out


def miss_rates(reports, usage, role, seasons):
    """P(player has no usage that week | status), estimated only on `seasons`, only over players with a role."""
    n, m = defaultdict(int), defaultdict(int)
    for (s, w, t), lst in reports.items():
        if s not in seasons or (s, w, t) not in usage: continue
        for pid, st in lst:
            q, k = role(pid, s, w)
            if q + k < 0.05: continue
            n[st] += 1; m[st] += pid not in usage[(s, w, t)]
    return {st: (m[st] / n[st] if n[st] else 1.0) for st in STATUSES}, dict(n)


def team_loss(reports, role, rates, s, w, t):
    q = k = 0.0
    for pid, st in reports.get((s, w, t), ()):
        a, b = role(pid, s, w); p = rates[st]
        q += p * a; k += p * b
    return min(q, 1.0), min(k, 1.0)


def fit_coefs(rows):
    """rows: (resid, dq, dk) with dq = home qb loss - away qb loss. OLS without intercept -> (b_qb, b_sk)."""
    sqq = sum(r[1] * r[1] for r in rows); skk = sum(r[2] * r[2] for r in rows); sqk = sum(r[1] * r[2] for r in rows)
    sqy = sum(r[1] * r[0] for r in rows); sky = sum(r[2] * r[0] for r in rows)
    det = sqq * skk - sqk * sqk
    return (-(skk * sqy - sqk * sky) / det, -(sqq * sky - sqk * sqy) / det)   # sign: losses cost points


def enabled(env=os.environ):
    return str(env.get("FOOTBALL_INJURIES_ENABLED", "")).lower() in ("1", "true", "yes")
