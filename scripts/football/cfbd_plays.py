"""Map CFBD play-by-play (/plays) to the compact row layout of extract.py, so params.fit_nfl can fit NCAAF play-level
parameters from real college plays (step 5). Raw CFBD rows stay in the private cache; only fitted frequencies ship.

CFBD conventions handled here (checked against the 2023 feed):
  * `offense` is the kicking team on kickoffs and the punting team on punts; return touchdowns score for `defense`.
  * penalties: negative yardsGained = offensive foul, positive = defensive foul.
  * the try after a touchdown is inside the touchdown play text: "(X KICK)" good, "PAT MISSED/BLOCKED",
    "TWO-POINT CONVERSION" good, "... CONVERSION FAILED".
  * no scramble flag exists, so scrambles stay inside runs (college statistics count them as rushes as well).
"""
import re
from .extract import COLS, IDX as I

PASS = {"Pass Reception", "Pass Incompletion", "Sack", "Interception", "Pass Interception Return",
        "Interception Return Touchdown", "Passing Touchdown", "Pass Interception"}
RUN = {"Rush", "Rushing Touchdown"}
PUNT = {"Punt", "Blocked Punt", "Punt Return Touchdown", "Blocked Punt Touchdown"}
FG = {"Field Goal Good", "Field Goal Missed", "Blocked Field Goal", "Blocked Field Goal Touchdown", "Missed Field Goal Return",
      "Missed Field Goal Return Touchdown"}
KICK = {"Kickoff", "Kickoff Return (Offense)", "Kickoff Return Touchdown", "Kickoff Return (Defense)"}
FUM = {"Fumble Recovery (Opponent)", "Fumble Recovery (Own)", "Fumble Return Touchdown"}
DEF_TD = {"Interception Return Touchdown", "Fumble Return Touchdown", "Punt Return Touchdown", "Blocked Punt Touchdown",
          "Blocked Field Goal Touchdown", "Missed Field Goal Return Touchdown"}
_FGD = re.compile(r"(\d+)\s*(?:yd|yard)s?\s*(?:FG|field goal)", re.I)


def _secs(p):
    c = p.get("clock") or {}
    return max(0, min(900, int(c.get("minutes") or 0) * 60 + int(c.get("seconds") or 0)))


def _try(text):
    """('xp', made) | ('2pt', made) | None from the touchdown play text."""
    u = (text or "").upper()
    if "TWO-POINT" in u or "2PT" in u or "TWO POINT" in u:
        return ("2pt", "FAILED" not in u and "NO GOOD" not in u)
    if "PAT MISSED" in u or "PAT BLOCKED" in u or "KICK MISSED" in u or "KICK BLOCKED" in u or "PAT FAILED" in u:
        return ("xp", False)
    if "KICK)" in u or "PAT GOOD" in u or "KICK GOOD" in u:
        return ("xp", True)
    return None


def to_rows(plays):
    """CFBD plays (any order, many games) -> compact rows sorted by game and play id. Non-plays are dropped."""
    out = []
    for p in sorted(plays, key=lambda p: (p.get("gameId") or 0, int(p.get("id") or 0))):
        pt0, text = p.get("playType") or "", p.get("playText") or ""
        q = p.get("period") or 0
        if not (1 <= q <= 4):          # overtime starts at the 25 without a clock; regulation only
            continue
        low = text.lower()
        if pt0 in PASS: pt = "pass"
        elif pt0 in RUN: pt = "run"
        elif pt0 in FUM: pt = "pass" if (" pass " in f" {low} " or "sacked" in low) else "run"
        elif pt0 in PUNT: pt = "punt"
        elif pt0 in FG: pt = "field_goal"
        elif pt0 in KICK: pt = "kickoff"
        elif pt0 == "Penalty": pt = "no_play"
        elif pt0 == "Safety": pt = "punt" if "punt" in low else "run"
        else: continue
        r = [None] * len(COLS)
        s = _secs(p)
        off, de = p.get("offense"), p.get("defense")
        y = int(p.get("yardsGained") or 0)
        sack = pt0 == "Sack" or (pt0 in FUM and "sacked" in low)
        intc = pt0 in ("Interception", "Pass Interception Return", "Interception Return Touchdown", "Pass Interception")
        td = "Touchdown" in pt0 or (p.get("scoring") and pt in ("pass", "run") and (" td" in f" {low}" or "touchdown" in low))
        r[I["game_id"]] = p.get("gameId"); r[I["season"]] = p.get("season") or 0; r[I["week"]] = p.get("week")
        r[I["home_team"]], r[I["away_team"]] = p.get("home"), p.get("away")
        r[I["posteam"]], r[I["defteam"]] = (de, off) if pt == "kickoff" else (off, de)   # nflverse: receiving team on kickoffs
        r[I["qtr"]] = q; r[I["down"]] = p.get("down") or None; r[I["ydstogo"]] = p.get("distance")
        r[I["yardline_100"]] = p.get("yardsToGoal"); r[I["play_type"]] = pt; r[I["yards_gained"]] = y; r[I["epa"]] = p.get("ppa")
        r[I["game_seconds_remaining"]] = (4 - q) * 900 + s
        r[I["half_seconds_remaining"]] = s + (900 if q in (1, 3) else 0)
        r[I["pass"]] = int(pt == "pass"); r[I["rush"]] = int(pt == "run")
        r[I["sack"]] = int(sack); r[I["interception"]] = int(intc)
        r[I["fumble_lost"]] = int(pt0 in ("Fumble Recovery (Opponent)", "Fumble Return Touchdown"))
        r[I["complete_pass"]] = int(pt0 in ("Pass Reception", "Passing Touchdown") or (pt0 in FUM and pt == "pass" and not sack and "incomplete" not in low))
        r[I["qb_scramble"]] = 0
        r[I["touchdown"]] = int(bool(td))
        r[I["td_team"]] = (de if pt0 in DEF_TD else off if pt0 != "Kickoff Return Touchdown" else de) if td else None
        if pt == "field_goal":
            m = _FGD.search(text)
            r[I["kick_distance"]] = int(m.group(1)) if m else (p.get("yardsToGoal") or 0) + 17
            r[I["field_goal_result"]] = "made" if pt0 == "Field Goal Good" else "missed"
        if pt == "no_play":
            r[I["penalty"]] = 1; r[I["penalty_yards"]] = abs(y)
            r[I["penalty_team"]] = off if y < 0 else de
            r[I["first_down_penalty"]] = int(y > 0 and ("1st down" in low or "first down" in low or y >= (p.get("distance") or 99)))
        else:
            r[I["penalty"]] = 0
        r[I["qb_kneel"]] = int(pt == "run" and "kneel" in low)
        r[I["qb_spike"]] = int(pt == "pass" and "spike" in low)
        r[I["score_differential"]] = (p.get("offenseScore") or 0) - (p.get("defenseScore") or 0)
        r[I["posteam_score"]], r[I["defteam_score"]] = p.get("offenseScore"), p.get("defenseScore")
        r[I["drive"]] = p.get("driveNumber"); r[I["punt_blocked"]] = int(pt0.startswith("Blocked Punt"))
        r[I["safety"]] = int(pt0 == "Safety"); r[I["two_point_attempt"]] = 0; r[I["special_teams_play"]] = int(pt in ("punt", "field_goal", "kickoff"))
        out.append(r)
        if td:
            t = _try(text)
            if t:
                x = list(r); x[I["play_type"]] = "extra_point" if t[0] == "xp" else "pass"
                x[I["touchdown"]] = 0; x[I["down"]] = None; x[I["sack"]] = x[I["interception"]] = x[I["fumble_lost"]] = 0
                scorer = r[I["td_team"]]
                x[I["posteam"]], x[I["defteam"]] = scorer, (r[I["defteam"]] if scorer == r[I["posteam"]] else r[I["posteam"]])
                if t[0] == "xp": x[I["extra_point_result"]] = "good" if t[1] else "failed"
                else: x[I["two_point_attempt"]] = 1; x[I["two_point_conv_result"]] = "success" if t[1] else "failure"; x[I["play_type"]] = "two_point"
                out.append(x)
    return out


def fit_ncaaf(rows, kick_rows=None, label="CFBD play-by-play"):
    from .params import fit_nfl
    p = fit_nfl(rows, kick_rows)
    p["league"] = "ncaaf"
    p["source"] = f"{label}, fitted from real college plays (regulation only)"
    return p


NCAAF_TEMPO = 0.95   # fitted: NFL clock run-off x 0.95 (engine with end-of-half timeouts) reproduces CFBD's 152 regulation snaps per game (2023)


def ncaaf_params_from_fit(fit, nfl, tempo=NCAAF_TEMPO):
    """Final NCAAF sim params: play-level frequencies from CFBD plays; clock run-off from the NFL fit scaled by `tempo`.

    CFBD's per-play clock is stale on ~60% of snaps (same clock as the previous play), so its run-off histograms are
    unusable; the snap count per game is reliable, so one tempo factor is fitted to it instead.
    """
    p = {**fit, "league": "ncaaf", "clock": nfl["clock"], "rules": {**(fit.get("rules") or {}), "tempo": tempo}}
    p["source"] = fit.get("source", "CFBD play-by-play") + "; clock run-off = NFL (nflverse) x fitted NCAAF tempo"
    return p
