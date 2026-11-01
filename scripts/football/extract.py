"""Reduce an nflverse play-by-play CSV (csv.gz) to the compact rows the ratings and sim-parameter fits need.

Only CC-BY nflverse play-by-play columns are read. FTN charting / participation files (CC-BY-SA) are never
downloaded or read. The compact rows are a private cache; they are never committed or served.
"""
import csv, gzip, io, json, os

# compact row layout (index -> name). Keep in sync with COLS below.
COLS = [
    "game_id", "season", "week", "season_type", "home_team", "away_team", "posteam", "defteam",
    "qtr", "down", "ydstogo", "yardline_100", "game_seconds_remaining", "play_type", "yards_gained", "epa",
    "pass", "rush", "sack", "interception", "fumble_lost", "complete_pass", "qb_scramble", "touchdown", "td_team",
    "field_goal_result", "kick_distance", "extra_point_result", "two_point_attempt", "two_point_conv_result",
    "penalty", "penalty_team", "penalty_yards", "qb_kneel", "qb_spike", "score_differential", "wp",
    "posteam_score", "defteam_score", "drive", "home_score", "away_score", "punt_blocked", "safety",
    "first_down_penalty", "half_seconds_remaining", "game_date", "special_teams_play",
]
IDX = {c: i for i, c in enumerate(COLS)}
INT_COLS = {"season", "week", "qtr", "down", "ydstogo", "yardline_100", "game_seconds_remaining", "yards_gained",
            "pass", "rush", "sack", "interception", "fumble_lost", "complete_pass", "qb_scramble", "touchdown",
            "kick_distance", "two_point_attempt", "penalty", "penalty_yards", "qb_kneel", "qb_spike",
            "score_differential", "posteam_score", "defteam_score", "drive", "home_score", "away_score",
            "punt_blocked", "safety", "first_down_penalty", "half_seconds_remaining", "special_teams_play"}
FLOAT_COLS = {"epa", "wp"}


def _conv(name, v):
    if v in ("", "NA"):
        return None
    if name in INT_COLS:
        try:
            return int(float(v))
        except ValueError:
            return None
    if name in FLOAT_COLS:
        try:
            return round(float(v), 4)
        except ValueError:
            return None
    return v


def extract_pbp(path_or_file):
    """Yield compact rows (lists in COLS order) for every real play (no 'END QUARTER'/timeout-only rows)."""
    fh = gzip.open(path_or_file, "rt", newline="", encoding="utf-8") if isinstance(path_or_file, str) and path_or_file.endswith(".gz") \
        else (open(path_or_file, newline="", encoding="utf-8") if isinstance(path_or_file, str) else io.TextIOWrapper(path_or_file, encoding="utf-8"))
    with fh:
        rd = csv.reader(fh)
        header = next(rd)
        pos = {h: i for i, h in enumerate(header)}
        missing = [c for c in COLS if c not in pos]
        if missing:
            raise ValueError(f"nflverse pbp is missing columns: {missing}")
        sel = [(c, pos[c]) for c in COLS]
        for r in rd:
            pt = r[pos["play_type"]]
            if pt in ("", "NA") or not r[pos["posteam"]] or r[pos["posteam"]] == "NA":
                continue
            yield [_conv(c, r[i]) for c, i in sel]


def save_compact(rows, path):
    tmp = path + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump({"cols": COLS, "rows": rows}, f, separators=(",", ":"))
    os.replace(tmp, path)


def load_compact(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        d = json.load(f)
    if d.get("cols") != COLS:
        raise ValueError("compact cache layout changed; re-extract")
    return d["rows"]
