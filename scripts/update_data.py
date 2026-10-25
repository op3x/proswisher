#!/usr/bin/env python3
"""ProSwisher data pipeline (stdlib only).

1. Pulls the current season's schedule + final scores from a licensed ScheduleProvider (scripts/providers.py;
   default balldontlie Free tier, key in BALLDONTLIE_API_KEY). Larry memo 20: licensed sources only.
2. Builds transparent team ratings (point differential, regressed toward last season).
3. Projects every upcoming game (margin, spread, total, win probability).
4. Appends NEW predictions to an append-only log *before* tip-off, with the MARKET point spread
   (line, source, time recorded) when a licensed odds source is configured (ODDS_API_KEY).
5. Grades each pick once the game is final, two ways: Winner (did our favored team win) and ATS
   (did our lean cover the recorded MARKET spread). Never graded against our own projected spread.
   Pushes and postponed games are recorded and shown but not counted. Grades are immutable.

Fails loudly (non-zero exit) on fetch errors instead of silently writing stale data.
"""
import hashlib, json, math, os, secrets, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import providers as P
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("PUBLIC_DATA_DIR") or os.path.join(ROOT, "public", "data")
# Larry P6: member (non-featured) predictions must never reach public /data/*.json or the public repo before
# tip-off. The FULL log lives in a private dir (server-side, e.g. a Railway volume; gitignored locally).
# Public outputs only carry the featured game's prediction pre-tip, plus a hash commitment for every other
# logged pick; the full entry (with its nonce, so the commitment can be verified) is published at tip-off.
PRIVATE = os.environ.get("PREDICTIONS_PRIVATE_DIR") or os.path.join(ROOT, "private-data")
CT = ZoneInfo("America/Chicago")
MODEL_VERSION = "pd-v1"
# The 30 franchises (our abbreviations; see providers.TEAMS). Anything else is ignored.
TEAMS = set(P.TEAMS)

# ---- model constants (documented on the How-it-works page; keep in sync with src/config/site.ts) ----
HOME_COURT = 2.5      # points added to the home side (0 on neutral courts)
PRIOR_GAMES = 10      # weight of last season's rating, in games
PRIOR_REGRESS = 0.5   # last season's margin is shrunk 50% toward league average
SIGMA = 12.0          # std-dev of NBA game margins vs projection (points)
LEAGUE_PPG = 114.0    # fallback league scoring average

# ---- sources (Larry memo 20, Kiko 9:58): swap vendors/tiers in scripts/providers.py, not here ----
get_schedule = P.schedule_provider   # tests monkeypatch these two
get_odds = P.odds_provider


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def dump(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, indent=1, sort_keys=False)
        f.write("\n")


def team_table(games: list) -> dict:
    t = {}
    for g in games:
        if not g["final"] or g["seasonType"] != 2:
            continue
        h, a = g["home"], g["away"]
        for me, op, home in ((h, a, True), (a, h, False)):
            r = t.setdefault(me["abbr"], {"name": me["name"], "short": me["short"], "gp": 0, "w": 0, "l": 0, "pf": 0, "pa": 0})
            r["gp"] += 1
            r["pf"] += me["score"]
            r["pa"] += op["score"]
            if me["score"] > op["score"]:
                r["w"] += 1
            else:
                r["l"] += 1
    return t


def prior_season(prior_year: int, sched) -> dict:
    """Last season's per-team ppg / opp ppg / margin. Cached in public/data/prior.json (aggregates only)."""
    path = os.path.join(DATA, "prior.json")
    cached = load(path, None)
    if cached and cached.get("seasonYear") == prior_year and cached.get("provider") == sched.name:
        return cached
    games = [g for g in sched.season_games(prior_year) if g["seasonType"] == 2]
    tbl = team_table(games)
    if len(tbl) != 30:
        raise RuntimeError(f"prior season table incomplete ({len(tbl)} teams)")
    teams = {k: {"name": v["name"], "gp": v["gp"], "w": v["w"], "l": v["l"],
                 "ppg": round(v["pf"] / v["gp"], 2), "oppg": round(v["pa"] / v["gp"], 2),
                 "margin": round((v["pf"] - v["pa"]) / v["gp"], 2)} for k, v in tbl.items()}
    out = {"seasonYear": prior_year, "label": f"{prior_year-1}-{str(prior_year)[2:]}", "provider": sched.name, "games": len(games), "teams": teams}
    dump(path, out)
    return out


def ratings(cur: dict, prior: dict) -> dict:
    lg_ppg = LEAGUE_PPG
    tot_pts = sum(v["pf"] for v in cur.values())
    tot_gp = sum(v["gp"] for v in cur.values())
    if tot_gp >= 30:
        lg_ppg = tot_pts / tot_gp
    out = {}
    abbrs = set(cur) | set(prior["teams"])
    for ab in sorted(abbrs):
        c = cur.get(ab, {"gp": 0, "w": 0, "l": 0, "pf": 0, "pa": 0})
        p = prior["teams"].get(ab)
        p_margin = (p["margin"] * PRIOR_REGRESS) if p else 0.0
        p_off = (lg_ppg + (p["ppg"] - prior_lg(prior)) * PRIOR_REGRESS) if p else lg_ppg
        p_def = (lg_ppg + (p["oppg"] - prior_lg(prior)) * PRIOR_REGRESS) if p else lg_ppg
        n, k = c["gp"], PRIOR_GAMES
        margin = ((c["pf"] - c["pa"]) + k * p_margin) / (n + k)
        off = (c["pf"] + k * p_off) / (n + k)
        dfn = (c["pa"] + k * p_def) / (n + k)
        name = cur.get(ab, {}).get("name") or (p or {}).get("name") or ab
        out[ab] = {
            "name": name, "gp": n, "w": c["w"], "l": c["l"],
            "ppg": round(c["pf"] / n, 1) if n else None,
            "oppg": round(c["pa"] / n, 1) if n else None,
            "margin": round((c["pf"] - c["pa"]) / n, 2) if n else None,
            "priorMargin": p["margin"] if p else None,
            "rating": round(margin, 2), "offRating": round(off, 2), "defRating": round(dfn, 2),
        }
    return {"leaguePpg": round(lg_ppg, 2), "teams": out}


_prior_lg_cache = {}
def prior_lg(prior):
    key = prior["seasonYear"]
    if key not in _prior_lg_cache:
        ts = prior["teams"].values()
        _prior_lg_cache[key] = sum(t["ppg"] for t in ts) / len(ts)
    return _prior_lg_cache[key]


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def project(g: dict, R: dict) -> dict | None:
    h, a = R["teams"].get(g["home"]["abbr"]), R["teams"].get(g["away"]["abbr"])
    if not h or not a:
        return None
    hca = 0.0 if g["neutral"] else HOME_COURT
    margin = h["rating"] - a["rating"] + hca           # + = home favored
    lg = R["leaguePpg"]
    home_pts = h["offRating"] + a["defRating"] - lg + hca / 2
    away_pts = a["offRating"] + h["defRating"] - lg - hca / 2
    total = home_pts + away_pts
    p_home = norm_cdf(margin / SIGMA)
    winner = "home" if margin >= 0 else "away"
    return {
        "homeMargin": round(margin, 1),
        "spread": {"team": g[winner]["abbr"], "line": -round(abs(margin) * 2) / 2},  # nearest 0.5
        "total": round(total * 2) / 2,
        "projScore": {"home": round((total + margin) / 2), "away": round((total - margin) / 2)},
        "pHome": round(p_home, 3),
        "pick": g[winner]["abbr"],
        "pickProb": round(max(p_home, 1 - p_home), 3),
        "inputs": {"homeRating": h["rating"], "awayRating": a["rating"], "homeCourt": hca,
                   "homeOff": h["offRating"], "homeDef": h["defRating"],
                   "awayOff": a["offRating"], "awayDef": a["defRating"], "leaguePpg": lg},
    }


def ats_lean(home_margin: float, home_line: float):
    """Our lean vs the market: home if the model expects home to beat the market number, else away."""
    market_margin = -home_line
    if home_margin > market_margin:
        return "home"
    if home_margin < market_margin:
        return "away"
    return None


COMMIT_FIELDS = ("gameId", "date", "home", "away", "loggedAt", "modelVersion", "pick", "pickProb", "spread", "total", "homeMargin")


def commitment(e: dict) -> str:
    body = json.dumps({k: e.get(k) for k in COMMIT_FIELDS}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256((e["nonce"] + "|" + body).encode()).hexdigest()


def featured_ids(games: list) -> set:
    """Earliest tip-off per CT calendar day, ties by id (same rule as src/lib/access.ts and server/index.mjs)."""
    best = {}
    for g in games:
        d = datetime.fromisoformat(g["date"].replace("Z", "+00:00")).astimezone(CT).date()
        c = best.get(d)
        if c is None or g["date"] < c["date"] or (g["date"] == c["date"] and g["id"] < c["id"]):
            best[d] = g
    return {g["id"] for g in best.values()}


def dry_run_requested(argv=None) -> bool:
    return "--dry-run" in (sys.argv if argv is None else argv) or os.environ.get("PIPELINE_DRY_RUN", "").lower() in ("1", "true", "yes")


def main(argv=None):
    global get_schedule, get_odds
    now = datetime.now(timezone.utc)
    dry = dry_run_requested(argv)
    if dry:
        # Synthetic fixtures only. Never in production, never into the repo's public/data (it's committed).
        if os.environ.get("APP_ENV") == "production":
            raise RuntimeError("dry run refused: APP_ENV=production")
        if not (os.environ.get("PUBLIC_DATA_DIR") and os.environ.get("PREDICTIONS_PRIVATE_DIR")):
            raise RuntimeError("dry run needs explicit PUBLIC_DATA_DIR and PREDICTIONS_PRIVATE_DIR (outside the repo)")
        if os.path.realpath(DATA).startswith(os.path.realpath(ROOT) + os.sep) or os.path.realpath(PRIVATE).startswith(os.path.realpath(ROOT) + os.sep):
            raise RuntimeError("dry run refused: output dirs must be outside the repo")
        get_schedule, get_odds = (lambda: P.FixtureSchedule(now)), (lambda: P.FixtureOdds())
        print("DRY RUN: synthetic fixture data (not real games, scores or lines)")
    if os.environ.get("GITHUB_ACTIONS") == "true" and not os.environ.get("PREDICTIONS_PRIVATE_DIR"):
        # P6: the full log (member picks + nonces) must persist privately; a CI runner can't hold it and the
        # public repo must never receive it. Run on the server with a volume instead (PIPELINE_INTERVAL_MIN).
        raise RuntimeError("refusing to run in CI without a persistent PREDICTIONS_PRIVATE_DIR (Larry P6)")
    try:
        sched = get_schedule()
    except P.NotConfigured as e:
        print(f"No licensed schedule source configured ({e}). Nothing fetched or written.")
        return
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(PRIVATE, exist_ok=True)
    info = sched.season_of(now)
    year = info["year"]

    gpath = os.path.join(PRIVATE, "games-full.json")
    store = load(gpath, None) or load(os.path.join(DATA, "games.json"), {"seasonYear": year, "games": {}})
    if dry and store.get("games") and store.get("provider") not in (None, sched.name):
        raise RuntimeError("dry run refused: PREDICTIONS_PRIVATE_DIR already holds real game data")
    if store.get("seasonYear") != year or store.get("provider") != sched.name:
        store = {"seasonYear": year, "provider": sched.name, "games": {}}  # never mix sources (ids differ)
    games = store["games"]

    # refetch from the earliest unfinished cached game (or season start) through +7 days
    open_days = [g["date"][:10] for g in games.values() if not g["final"]]
    season_start = f"{year - 1}-09-15"
    start = min(open_days) if open_days else (max((g["date"][:10] for g in games.values()), default=season_start))
    end = (now + timedelta(days=7)).strftime("%Y-%m-%d")
    fetched = sched.games_between(start, end)
    for g in fetched:
        games[g["id"]] = g
    print(f"{sched.name}: {len(fetched)} games fetched ({start}..{end}); {len(games)} cached for {info['label']}")

    glist = sorted(games.values(), key=lambda g: g["date"])
    if not glist:
        raise RuntimeError("no regular-season games found; refusing to write empty data")
    prior = prior_season(year - 1, sched)
    cur = team_table(glist)
    R = ratings(cur, prior)

    # predictions log: append-only, locked at first log
    ppath = os.path.join(PRIVATE, "predictions-full.json")
    log = load(ppath, None) or load(os.path.join(DATA, "predictions.json"), {"modelVersion": MODEL_VERSION, "startedAt": now.isoformat(timespec="seconds"), "entries": {}})
    if dry and log.get("entries") and not log.get("dryRun"):  # never mix synthetic picks into a real (append-only) log
        raise RuntimeError("dry run refused: PREDICTIONS_PRIVATE_DIR already holds a real prediction log")
    if not dry and log.get("dryRun"):  # a real run never inherits a dry-run log
        log = {"modelVersion": MODEL_VERSION, "startedAt": now.isoformat(timespec="seconds"), "entries": {}}
    entries = log["entries"]
    LOCKED = COMMIT_FIELDS + ("nonce", "commitment")
    SET_ONCE = ("marketSpread", "atsLean", "result", "projScore")  # may go null -> value once, never change afterwards
    before = {k: {f: v.get(f) for f in LOCKED + SET_ONCE} for k, v in entries.items()}
    odds = get_odds()
    market = odds.spreads(now)  # derived fields only (median line, book count, time)
    log["marketSource"] = odds.name if odds.name != "none" else None
    upcoming = []
    for g in glist:
        g_dt = datetime.fromisoformat(g["date"].replace("Z", "+00:00"))
        if g["state"] == "pre" and g_dt > now:
            pr = project(g, R)
            if pr:
                g["prediction"] = pr
                upcoming.append(g["id"])
                if g["id"] not in entries:
                    entries[g["id"]] = {
                        "gameId": g["id"], "date": g["date"], "home": g["home"]["abbr"], "away": g["away"]["abbr"],
                        "loggedAt": now.isoformat(timespec="seconds"), "modelVersion": MODEL_VERSION,
                        "pick": pr["pick"], "pickProb": pr["pickProb"], "spread": pr["spread"], "total": pr["total"],
                        "homeMargin": pr["homeMargin"], "marketSpread": None, "atsLean": None, "result": None,
                        "loggedBy": "dry-run" if dry else ("github-actions" if os.environ.get("GITHUB_ACTIONS") == "true" else os.environ.get("PIPELINE_RUNNER", "manual-run")),
                        "nonce": secrets.token_hex(16),
                    }
                    entries[g["id"]]["commitment"] = commitment(entries[g["id"]])
                e = entries[g["id"]]
                e.setdefault("projScore", pr["projScore"])  # posted with the pick (pre-tip-off only)
                # record the market spread once, only before tip-off
                if e.get("marketSpread") is None and market:
                    m = market.get((g["home"]["abbr"], g["away"]["abbr"], g["date"][:10]))
                    if m:
                        e["marketSpread"] = m
                        e["atsLean"] = ats_lean(e["homeMargin"], m["homeLine"])
                g["prediction"]["market"] = e.get("marketSpread")
        else:
            g.pop("prediction", None)
    # grade (once; immutable). Winner + ATS vs the recorded MARKET spread. Never vs our own line.
    for e in entries.values():
        e.setdefault("marketSpread", None); e.setdefault("atsLean", None)
        g = games.get(e["gameId"])
        if e["result"] is not None or not g:
            continue
        if g.get("statusName") in ("STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_SUSPENDED") and not g["final"]:
            e["result"] = {"status": "postponed", "gradedAt": now.isoformat(timespec="seconds"),
                           "winnerGrade": None, "atsGrade": None}
            continue
        if g["final"] and g["home"]["score"] is not None and g["away"]["score"] is not None:
            hs, as_ = g["home"]["score"], g["away"]["score"]
            winner = g["home"]["abbr"] if hs > as_ else g["away"]["abbr"]
            ats = None
            if e["marketSpread"] and e["atsLean"]:
                home_cover = (hs - as_) + e["marketSpread"]["homeLine"]  # >0 home covered
                lean_cover = home_cover if e["atsLean"] == "home" else -home_cover
                ats = "P" if lean_cover == 0 else ("W" if lean_cover > 0 else "L")
            e["result"] = {
                "status": "final", "gradedAt": now.isoformat(timespec="seconds"),
                "homeScore": hs, "awayScore": as_, "winner": winner,
                "winnerGrade": "W" if winner == e["pick"] else "L",
                "atsGrade": ats,  # W/L/P vs market spread; null = no market line recorded (not counted)
                "marginError": round((hs - as_) - e["homeMargin"], 1),
            }
    # append-only guard: nothing removed, locked fields never edited
    for k, snap in before.items():
        if k not in entries or any(entries[k].get(f) != snap[f] for f in LOCKED) or any(
                snap[f] is not None and entries[k].get(f) != snap[f] for f in SET_ONCE):
            raise RuntimeError(f"append-only violation on log entry {k}; refusing to write")
    log["updatedAt"] = now.isoformat(timespec="seconds")

    store["games"] = games
    store["updatedAt"] = now.isoformat(timespec="seconds")
    store["seasonLabel"] = info["label"]; store["provider"] = sched.name
    if dry:
        store["dryRun"] = True; log["dryRun"] = True
    dump(gpath, store)   # private (full)
    dump(ppath, log)     # private (full)
    # ---- public projections (safe to serve statically and to commit) ----
    feat = featured_ids(glist)
    tipped = lambda iso: datetime.fromisoformat(iso.replace("Z", "+00:00")) <= now
    pub_games = {}
    for gid, g in games.items():
        pg = dict(g)
        if "prediction" in pg and gid not in feat:
            pg.pop("prediction")  # member-only until tip-off (served by the gated API)
        pub_games[gid] = pg
    dump(os.path.join(DATA, "games.json"), {**store, "games": pub_games})
    pub_entries, sealed = {}, {}
    for k, e in entries.items():
        if e["result"] is not None or tipped(e["date"]) or k in feat:
            pub_entries[k] = e
        else:
            sealed[k] = {"gameId": k, "date": e["date"], "loggedAt": e["loggedAt"], "commitment": e.get("commitment")}
    dump(os.path.join(DATA, "predictions.json"), {**log, "entries": pub_entries, "sealed": sealed,
        "commitmentNote": "sha256(nonce + '|' + canonical JSON of the posted fields); the nonce is published with the entry at tip-off."})
    stats = {"updated": now.strftime("%Y-%m-%d %H:%M UTC"), "season": info["label"], "seasonYear": year,
             "modelVersion": MODEL_VERSION,
             "model": {"homeCourt": HOME_COURT, "priorGames": PRIOR_GAMES, "priorRegress": PRIOR_REGRESS, "sigma": SIGMA},
             "priorSeason": prior["label"], **R}
    dump(os.path.join(DATA, "stats.json"), stats)
    if not os.environ.get("PUBLIC_DATA_DIR"):
        dump(os.path.join(ROOT, "stats.json"), stats)  # legacy path, only for repo-local runs
    graded = [e for e in entries.values() if e["result"]]
    print(f"teams={len(R['teams'])} upcoming={len(upcoming)} logged={len(entries)} graded={len(graded)}")


if __name__ == "__main__":
    try:
        main()
    except P.SourceBlocked as ex:  # memo 20: a source refused us -> stop and report, never route around it
        print(f"BLOCKED: {ex}", file=sys.stderr)
        sys.exit(3)
    except Exception as ex:  # fail loudly so the Action goes red instead of committing stale data
        print(f"ERROR: {ex}", file=sys.stderr)
        sys.exit(1)
