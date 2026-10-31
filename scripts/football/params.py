"""Fit the play-level sim parameters from nflverse play-by-play (compact rows, see extract.py).

Everything here is an empirical frequency or histogram from real plays. Output: sim-params-nfl.json, consumed by the
JS engine (server/sim/engine.mjs). NCAAF parameters are derived from the NFL fit plus documented NCAAF rule
differences until CFBD play-level data is fitted (Phase 2), see ncaaf_params().
"""
import math
from collections import Counter, defaultdict
from .extract import IDX as I

SCRIM = ("pass", "run")
YMIN, YMAX = -20, 99


def distb(togo):
    if togo is None: return "7-10"
    if togo <= 1: return "1"
    if togo <= 3: return "2-3"
    if togo <= 6: return "4-6"
    if togo <= 10: return "7-10"
    return "11+"


def dist4(togo):
    if togo is None or togo <= 1: return "1"
    if togo <= 3: return "2-3"
    if togo <= 6: return "4-6"
    return "7+"


def situation(r):
    qtr, gsr, hsr, sd = r[I["qtr"]], r[I["game_seconds_remaining"]] or 0, r[I["half_seconds_remaining"]] or 0, r[I["score_differential"]] or 0
    if qtr == 4 and gsr <= 600 and sd > 0: return "late_lead"
    if (qtr == 4 and gsr <= 600 and sd < 0) or (qtr in (2, 4) and hsr <= 120 and sd <= 0): return "hurry"
    return "norm"


def hist(values, lo=YMIN, hi=YMAX):
    c = Counter(max(lo, min(hi, int(v))) for v in values if v is not None)
    keys = sorted(c)
    return {"v": keys, "n": [c[k] for k in keys]}


def rate(num, den, prior_p=0.0, prior_n=0):
    return (num + prior_p * prior_n) / (den + prior_n) if (den + prior_n) else prior_p


def logistic_fit(xs, ys, iters=50):
    """Two-parameter logistic regression by Newton's method (FG make prob vs distance)."""
    a, b = 3.0, -0.05
    for _ in range(iters):
        g0 = g1 = h00 = h01 = h11 = 0.0
        for x, y in zip(xs, ys):
            p = 1 / (1 + math.exp(-(a + b * x)))
            g0 += y - p; g1 += (y - p) * x
            w = p * (1 - p); h00 += w; h01 += w * x; h11 += w * x * x
        det = h00 * h11 - h01 * h01
        if abs(det) < 1e-9: break
        da = (h11 * g0 - h01 * g1) / det; db = (h00 * g1 - h01 * g0) / det
        a += da; b += db
        if abs(da) + abs(db) < 1e-8: break
    return round(a, 5), round(b, 6)


def _games(rows):
    g = defaultdict(list)
    for r in rows:
        g[r[I["game_id"]]].append(r)
    return g


def _next_scrimmage(plays, i, team):
    """yardline_100 of the next pass/run snap by `team` after index i (same game), or None."""
    for j in range(i + 1, min(i + 8, len(plays))):
        r = plays[j]
        if r[I["play_type"]] in SCRIM + ("no_play",) and r[I["posteam"]] == team and r[I["down"]] == 1:
            return r[I["yardline_100"]]
        if r[I["play_type"]] in SCRIM and r[I["posteam"]] != team:
            return None
    return None


def fit_nfl(rows, kick_rows=None):
    """rows: compact plays (recent seasons). kick_rows: latest season only (kickoff rules changed in 2024 and 2025)."""
    kick_rows = kick_rows if kick_rows is not None else rows
    call = defaultdict(lambda: [0, 0])         # (down, distb, sit) -> [pass, total]
    fourth = defaultdict(Counter)              # (ylbin, dist4, sit) -> go/fg/punt
    run_y, sack_y, scr_y, comp_y = [], [], [], []
    n_run = run_fum = n_db = n_sack = n_scr = n_att = n_int = n_comp = comp_fum = sack_fum = 0
    n_snap = n_off_pen = n_def_pen = def_pen_fd = 0
    off_pen_y, def_pen_y = [], []
    clock = defaultdict(list)
    fg_x, fg_y = [], []
    xp_made = xp_att = tp_att = tp_made = td_n = 0
    punt_land = defaultdict(list); punt_ret_td = punts = 0
    int_rel, fum_rel = [], []; int_td = fum_td = 0
    kick_start = []; kick_ret_td = kicks = 0

    for gid, plays in _games(rows).items():
        for i, r in enumerate(plays):
            pt, down, togo, yl = r[I["play_type"]], r[I["down"]], r[I["ydstogo"]], r[I["yardline_100"]]
            sit = situation(r)
            # clock: seconds until the next snap in the same quarter
            nxt = plays[i + 1] if i + 1 < len(plays) else None
            cat = None
            if pt == "run" and not r[I["qb_kneel"]]: cat = "run"   # scrambles share the run clock profile
            elif pt == "pass":
                cat = "sack" if r[I["sack"]] else "scramble" if r[I["qb_scramble"]] else "int" if r[I["interception"]] else "complete" if r[I["complete_pass"]] else "incomplete"
            elif pt in ("punt", "field_goal"): cat = pt
            elif pt == "no_play" and r[I["penalty"]]: cat = "penalty"
            if cat and nxt is not None and nxt[I["qtr"]] == r[I["qtr"]] and r[I["game_seconds_remaining"]] is not None and nxt[I["game_seconds_remaining"]] is not None:
                el = r[I["game_seconds_remaining"]] - nxt[I["game_seconds_remaining"]]
                if 0 <= el <= 60 and not r[I["touchdown"]]:
                    clock[("hurry" if sit == "hurry" else "norm") + ":" + cat].append(el)

            if pt in SCRIM and down in (1, 2, 3) and not r[I["qb_kneel"]] and not r[I["qb_spike"]]:
                c = call[(down, distb(togo), sit)]; c[0] += r[I["pass"]] == 1; c[1] += 1
            if down == 4 and pt in ("pass", "run", "punt", "field_goal") and yl is not None and not r[I["qb_kneel"]]:
                act = "punt" if pt == "punt" else "fg" if pt == "field_goal" else "go"
                fourth[(min(9, yl // 10), dist4(togo), sit)][act] += 1

            if pt in SCRIM or (pt == "no_play" and r[I["penalty"]]):
                n_snap += 1
                if pt == "no_play" and r[I["penalty"]]:
                    if r[I["penalty_team"]] == r[I["posteam"]]:
                        n_off_pen += 1; off_pen_y.append(r[I["penalty_yards"]] or 5)
                    else:
                        n_def_pen += 1; def_pen_y.append(r[I["penalty_yards"]] or 5); def_pen_fd += r[I["first_down_penalty"]] == 1
            far = yl is not None and yl >= 30   # gain distributions from plays not truncated by the goal line
            if pt == "run" and not r[I["qb_kneel"]] and not r[I["qb_scramble"]]:
                n_run += 1; run_fum += r[I["fumble_lost"]] == 1
                if far and not r[I["fumble_lost"]]: run_y.append(r[I["yards_gained"]])
            elif pt == "run" and r[I["qb_scramble"]]:   # nflverse codes scrambles as play_type "run": they are dropbacks
                n_db += 1; n_scr += 1
                if far: scr_y.append(r[I["yards_gained"]])
            elif pt == "pass" and not r[I["qb_spike"]]:
                n_db += 1
                if r[I["sack"]]:
                    n_sack += 1; sack_fum += r[I["fumble_lost"]] == 1; sack_y.append(r[I["yards_gained"]])
                elif r[I["qb_scramble"]]:
                    n_scr += 1
                    if far: scr_y.append(r[I["yards_gained"]])
                else:
                    n_att += 1
                    if r[I["interception"]]: n_int += 1
                    elif r[I["complete_pass"]]:
                        n_comp += 1; comp_fum += r[I["fumble_lost"]] == 1
                        if far and not r[I["fumble_lost"]]: comp_y.append(r[I["yards_gained"]])
            # turnovers: where does the new offense start, relative to the flipped line of scrimmage?
            if pt in SCRIM and (r[I["interception"]] or r[I["fumble_lost"]]) and yl is not None:
                new = r[I["defteam"]]
                if r[I["touchdown"]] and r[I["td_team"]] == new:
                    if r[I["interception"]]: int_td += 1
                    else: fum_td += 1
                else:
                    ny = _next_scrimmage(plays, i, new)
                    if ny is not None:
                        (int_rel if r[I["interception"]] else fum_rel).append(ny - (100 - yl))
            if pt == "field_goal" and r[I["kick_distance"]]:
                fg_x.append(r[I["kick_distance"]]); fg_y.append(1 if r[I["field_goal_result"]] == "made" else 0)
            if pt == "extra_point" and r[I["season"]] >= 2015:
                xp_att += 1; xp_made += r[I["extra_point_result"]] == "good"
            if r[I["two_point_attempt"]] == 1:
                tp_att += 1; tp_made += r[I["two_point_conv_result"]] == "success"
            if r[I["touchdown"]] and pt in SCRIM and r[I["td_team"]] == r[I["posteam"]]:
                td_n += 1
            if pt == "punt" and yl is not None and not r[I["punt_blocked"]]:
                punts += 1; recv = r[I["defteam"]]
                if r[I["touchdown"]] and r[I["td_team"]] == recv: punt_ret_td += 1
                else:
                    ny = _next_scrimmage(plays, i, recv)
                    if ny is not None: punt_land[min(9, yl // 10)].append(ny)

    for gid, plays in _games(kick_rows).items():
        for i, r in enumerate(plays):
            if r[I["play_type"]] == "kickoff":
                kicks += 1; recv = r[I["posteam"]]   # nflverse: on kickoffs posteam is the RECEIVING team
                if r[I["touchdown"]] and r[I["td_team"]] == recv: kick_ret_td += 1; continue
                ny = _next_scrimmage(plays, i, recv)
                if ny is not None: kick_start.append(ny)

    calltab = {}
    for (d, db, s), (p, t) in call.items():
        calltab[f"{d}|{db}|{s}"] = [p, t]
    fourtab = {f"{b}|{d}|{s}": dict(c) for (b, d, s), c in fourth.items()}
    fa, fb = logistic_fit(fg_x, fg_y)
    return {
        "league": "nfl",
        "source": "nflverse play-by-play (CC-BY 4.0)",
        "playCall": calltab,
        "fourthDown": fourtab,
        "run": {"fumbleLost": rate(run_fum, n_run), "yards": hist(run_y)},
        "dropback": {"sack": rate(n_sack, n_db), "scramble": rate(n_scr, n_db), "sackFumbleLost": rate(sack_fum, n_sack),
                     "int": rate(n_int, n_att), "complete": rate(n_comp, n_att - n_int), "completeFumbleLost": rate(comp_fum, n_comp),
                     "sackYards": hist(sack_y), "scrambleYards": hist(scr_y), "completeYards": hist(comp_y)},
        "penalty": {"offense": rate(n_off_pen, n_snap), "defense": rate(n_def_pen, n_snap), "defenseFirstDown": rate(def_pen_fd, n_def_pen),
                    "offenseYards": hist(off_pen_y, 0, 30), "defenseYards": hist(def_pen_y, 0, 50)},
        "clock": {k: hist(v, 0, 60) for k, v in clock.items()},
        "fieldGoal": {"a": fa, "b": fb, "attempts": len(fg_x)},
        "extraPoint": {"make": rate(xp_made, xp_att), "twoPointRate": rate(tp_att, td_n), "twoPointSuccess": rate(tp_made, tp_att)},
        "punt": {"landing": {str(k): hist(v, 1, 99) for k, v in punt_land.items()}, "returnTd": rate(punt_ret_td, punts)},
        "kickoff": {"start": hist(kick_start, 1, 99), "returnTd": rate(kick_ret_td, kicks)},
        "turnover": {"intRel": hist(int_rel, -60, 60), "fumRel": hist(fum_rel, -60, 60), "intTd": rate(int_td, n_int), "fumTd": rate(fum_td, run_fum + comp_fum + sack_fum)},
        "counts": {"plays": len(rows), "runs": n_run, "dropbacks": n_db, "fgAttempts": len(fg_x), "punts": punts, "kickoffs": kicks},
    }


def ncaaf_params(nfl):
    """NCAAF parameter set = the NFL play distributions + NCAAF rule differences (documented assumptions).

    Team-level scoring is still calibrated to NCAAF ratings (CFBD), so these only shape the play-level texture.
    Phase 2 replaces this with a fit from CFBD play-by-play.
    """
    p = dict(nfl)
    p = {**nfl, "league": "ncaaf", "source": "NFL play distributions (nflverse) with NCAAF rules; NCAAF play-level fit pending (CFBD, Phase 2)"}
    p["fieldGoal"] = {**nfl["fieldGoal"], "a": round(nfl["fieldGoal"]["a"] - 0.45, 5)}   # assumption: college kickers make fewer long kicks
    p["extraPoint"] = {**nfl["extraPoint"], "make": 0.97}                                    # assumption: 20-yard PAT
    p["kickoff"] = {"start": {"v": [75], "n": [1]}, "returnTd": nfl["kickoff"]["returnTd"]}   # assumption: touchback at the 25
    return p
