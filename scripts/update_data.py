#!/usr/bin/env python3
"""ProSwisher data pipeline (stdlib only).

1. Pulls the current season's schedule + final scores (public scoreboard JSON, no key).
2. Builds transparent team ratings (point differential, regressed toward last season).
3. Projects every upcoming game (margin, spread, total, win probability).
4. Appends NEW predictions to an append-only log *before* tip-off, and grades
   logged predictions once the game is final. Logged picks are never edited.

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
                        "homeMargin": pr["homeMargin"], "result": None,
                        "loggedBy": "github-actions" if os.environ.get("GITHUB_ACTIONS") == "true" else "manual-run",
                    }
        else:
            g.pop("prediction", None)
    # grade
    for e in entries.values():
        g = games.get(e["gameId"])
        if e["result"] is None and g and g["final"]:
            hs, as_ = g["home"]["score"], g["away"]["score"]
            winner = g["home"]["abbr"] if hs > as_ else g["away"]["abbr"]
            actual_margin = hs - as_
            fav = e["spread"]["team"]; line = e["spread"]["line"]
            fav_margin = actual_margin if fav == e["home"] else -actual_margin
            ats = "push" if fav_margin + line == 0 else ("fav" if fav_margin + line > 0 else "dog")
            tot = hs + as_
            e["result"] = {
                "homeScore": hs, "awayScore": as_, "winner": winner,
                "pickCorrect": winner == e["pick"],
                "favCovered": ats,          # did the model's favorite cover the model's own line
                "totalSide": "push" if tot == e["total"] else ("over" if tot > e["total"] else "under"),
                "marginError": round(actual_margin - e["homeMargin"], 1),
            }
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
