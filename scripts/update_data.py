#!/usr/bin/env python3
"""ProSwisher data pipeline (stdlib only).

1. Pulls the current season's schedule + final scores (public scoreboard JSON, no key).
2. Builds transparent team ratings (point differential, regressed toward last season).
3. Projects every upcoming game (margin, spread, total, win probability).
4. Appends NEW predictions to an append-only log *before* tip-off, with the MARKET point spread
   (line, source, time recorded) when a licensed odds source is configured (ODDS_API_KEY).
5. Grades each pick once the game is final, two ways: Winner (did our favored team win) and ATS
   (did our lean cover the recorded MARKET spread). Never graded against our own projected spread.
   Pushes and postponed games are recorded and shown but not counted. Grades are immutable.

Fails loudly (non-zero exit) on fetch errors instead of silently writing stale data.
"""
import json, math, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={d}"
MODEL_VERSION = "pd-v1"
# The 30 franchises (feed abbreviations). Anything else (all-star/exhibition sides) is ignored.
TEAMS = {"ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GS","HOU","IND","LAC","LAL","MEM","MIA",
         "MIL","MIN","NO","NY","OKC","ORL","PHI","PHX","POR","SA","SAC","TOR","UTAH","WSH"}

# ---- model constants (documented on the How-it-works page; keep in sync with src/config/site.ts) ----
HOME_COURT = 2.5      # points added to the home side (0 on neutral courts)
PRIOR_GAMES = 10      # weight of last season's rating, in games
PRIOR_REGRESS = 0.5   # last season's margin is shrunk 50% toward league average
SIGMA = 12.0          # std-dev of NBA game margins vs projection (points)
LEAGUE_PPG = 114.0    # fallback league scoring average

# ---- market spread source (Larry round 2). No sportsbook scraping. ----
# The Odds API (https://the-odds-api.com) licensed aggregator; key is a GitHub Actions secret read ONLY here.
# Unset -> marketSpread stays null and only the Winner grade is recorded.
ODDS_URL = ("https://api.the-odds-api.com/v4/sports/basketball_nba/odds"
            "?regions=us&markets=spreads&oddsFormat=american&dateFormat=iso&apiKey={key}")
# Odds API full team names that differ from the scoreboard feed's displayName
ODDS_NAME_ALIASES = {"Los Angeles Clippers": "LA Clippers"}


def fetch(day: str, retries: int = 3) -> dict:
    url = SCOREBOARD.format(d=day)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "proswisher-data/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"fetch failed for {day}: {last}")


def parse_events(payload: dict) -> list:
    out = []
    for e in payload.get("events", []):
        stype = e.get("season", {}).get("type")
        if stype not in (2, 3, 5):  # regular season, postseason, play-in; skip preseason/all-star
            continue
        c = e["competitions"][0]
        teams = {t["homeAway"]: t for t in c["competitors"]}
        if "home" not in teams or "away" not in teams:
            continue
        if {teams["home"]["team"].get("abbreviation"), teams["away"]["team"].get("abbreviation")} - TEAMS:
            continue
        st = e["status"]["type"]

        def side(t):
            score = t.get("score")
            return {
                "abbr": t["team"].get("abbreviation"),
                "name": t["team"].get("displayName"),
                "short": t["team"].get("shortDisplayName"),
                "score": int(score) if (score not in (None, "") and st.get("state") != "pre") else None,
            }

        out.append({
            "id": e["id"],
            "date": e["date"],
            "seasonYear": e.get("season", {}).get("year"),
            "seasonType": stype,
            "state": st.get("state"),           # pre | in | post
            "final": bool(st.get("completed")),
            "status": st.get("shortDetail") or st.get("description"),
            "statusName": st.get("name"),       # e.g. STATUS_FINAL, STATUS_POSTPONED, STATUS_CANCELED
            "neutral": bool(c.get("neutralSite")),
            "home": side(teams["home"]),
            "away": side(teams["away"]),
        })
    return out


def season_info(today: datetime) -> dict:
    p = fetch(today.strftime("%Y%m%d"))
    lg = p["leagues"][0]
    s = lg["season"]
    cal = [d[:10].replace("-", "") for d in lg.get("calendar", []) if isinstance(d, str)]
    return {"year": s["year"], "label": s.get("displayName"), "calendar": cal, "today": parse_events(p)}


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


def prior_season(prior_year: int) -> dict:
    """Last season's per-team ppg / opp ppg / margin. Cached in public/data/prior.json."""
    path = os.path.join(DATA, "prior.json")
    cached = load(path, None)
    if cached and cached.get("seasonYear") == prior_year:
        return cached
    # find that season's calendar by querying a mid-season date (January of season year)
    info = fetch(f"{prior_year}0115")
    cal = [d[:10].replace("-", "") for d in info["leagues"][0].get("calendar", []) if isinstance(d, str)]
    games = []
    for d in cal:
        games += [g for g in parse_events(fetch(d)) if g["seasonType"] == 2]
        time.sleep(0.2)
    tbl = team_table(games)
    if len(tbl) != 30:
        raise RuntimeError(f"prior season table incomplete ({len(tbl)} teams)")
    teams = {k: {"name": v["name"], "gp": v["gp"], "w": v["w"], "l": v["l"],
                 "ppg": round(v["pf"] / v["gp"], 2), "oppg": round(v["pa"] / v["gp"], 2),
                 "margin": round((v["pf"] - v["pa"]) / v["gp"], 2)} for k, v in tbl.items()}
    out = {"seasonYear": prior_year, "label": f"{prior_year-1}-{str(prior_year)[2:]}", "games": len(games), "teams": teams}
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


def fetch_market_spreads(now: datetime) -> dict:
    """Returns {(homeName, awayName, YYYY-MM-DD commence UTC): {...}} or {} if no source configured.
    Line = median home point spread across the US books returned (negative = home favored)."""
    key = os.environ.get("ODDS_API_KEY", "").strip()
    if not key:
        return {}
    req = urllib.request.Request(ODDS_URL.format(key=key), headers={"User-Agent": "proswisher-data/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            events = json.loads(r.read().decode())
    except Exception as ex:  # never print the URL (it carries the key)
        raise RuntimeError(f"market spread fetch failed: {type(ex).__name__}") from None
    out = {}
    for ev in events:
        home, away = ev.get("home_team"), ev.get("away_team")
        pts, books = [], []
        for b in ev.get("bookmakers", []):
            for m in b.get("markets", []):
                if m.get("key") != "spreads":
                    continue
                for o in m.get("outcomes", []):
                    if o.get("name") == home and isinstance(o.get("point"), (int, float)):
                        pts.append(float(o["point"])); books.append(b.get("key"))
        if not pts:
            continue
        pts.sort(); n = len(pts)
        med = pts[n // 2] if n % 2 else (pts[n // 2 - 1] + pts[n // 2]) / 2
        h = ODDS_NAME_ALIASES.get(home, home); a = ODDS_NAME_ALIASES.get(away, away)
        out[(h, a, ev["commence_time"][:10])] = {
            "homeLine": round(med * 2) / 2,
            "source": f"The Odds API, median of {n} US books",
            "books": sorted(set(books)),
            "recordedAt": now.isoformat(timespec="seconds"),
        }
    return out


def ats_lean(home_margin: float, home_line: float):
    """Our lean vs the market: home if the model expects home to beat the market number, else away."""
    market_margin = -home_line
    if home_margin > market_margin:
        return "home"
    if home_margin < market_margin:
        return "away"
    return None


def main():
    now = datetime.now(timezone.utc)
    os.makedirs(DATA, exist_ok=True)
    info = season_info(now)
    year = info["year"]

    gpath = os.path.join(DATA, "games.json")
    store = load(gpath, {"seasonYear": year, "games": {}})
    if store.get("seasonYear") != year:
        store = {"seasonYear": year, "games": {}}
    games = store["games"]

    horizon = (now + timedelta(days=7)).strftime("%Y%m%d")
    start_reg = None
    fetched = 0
    for d in info["calendar"]:
        if d > horizon:
            break
        day_games = [g for g in games.values() if g.get("day") == d]
        if day_games and all(g["final"] for g in day_games):
            continue  # cached & complete
        for g in parse_events(fetch(d)):
            g["day"] = d
            games[g["id"]] = g
        fetched += 1
        time.sleep(0.2)
    print(f"fetched {fetched} scoreboard days; {len(games)} games cached for {info['label']}")

    glist = sorted(games.values(), key=lambda g: g["date"])
    if not glist:
        raise RuntimeError("no regular-season games found; refusing to write empty data")
    prior = prior_season(year - 1)
    cur = team_table(glist)
    R = ratings(cur, prior)

    # predictions log: append-only, locked at first log
    ppath = os.path.join(DATA, "predictions.json")
    log = load(ppath, {"modelVersion": MODEL_VERSION, "startedAt": now.isoformat(timespec="seconds"), "entries": {}})
    entries = log["entries"]
    LOCKED = ("gameId", "date", "home", "away", "loggedAt", "modelVersion", "pick", "pickProb", "spread", "total", "homeMargin")
    SET_ONCE = ("marketSpread", "atsLean", "result", "projScore")  # may go null -> value once, never change afterwards
    before = {k: {f: v.get(f) for f in LOCKED + SET_ONCE} for k, v in entries.items()}
    market = fetch_market_spreads(now)
    log["marketSource"] = "the-odds-api" if os.environ.get("ODDS_API_KEY", "").strip() else None
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
                        "loggedBy": "github-actions" if os.environ.get("GITHUB_ACTIONS") == "true" else "manual-run",
                    }
                e = entries[g["id"]]
                e.setdefault("projScore", pr["projScore"])  # posted with the pick (pre-tip-off only)
                # record the market spread once, only before tip-off
                if e.get("marketSpread") is None and market:
                    m = market.get((g["home"]["name"], g["away"]["name"], g["date"][:10]))
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
    store["seasonLabel"] = info["label"]
    dump(gpath, store)
    dump(ppath, log)
    stats = {"updated": now.strftime("%Y-%m-%d %H:%M UTC"), "season": info["label"], "seasonYear": year,
             "modelVersion": MODEL_VERSION,
             "model": {"homeCourt": HOME_COURT, "priorGames": PRIOR_GAMES, "priorRegress": PRIOR_REGRESS, "sigma": SIGMA},
             "priorSeason": prior["label"], **R}
    dump(os.path.join(DATA, "stats.json"), stats)
    dump(os.path.join(ROOT, "stats.json"), stats)  # legacy path kept for anything still reading it
    graded = [e for e in entries.values() if e["result"]]
    print(f"teams={len(R['teams'])} upcoming={len(upcoming)} logged={len(entries)} graded={len(graded)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:  # fail loudly so the Action goes red instead of committing stale data
        print(f"ERROR: {ex}", file=sys.stderr)
        sys.exit(1)
