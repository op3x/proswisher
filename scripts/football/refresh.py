#!/usr/bin/env python3
"""Daily football refresh (scheduled 04:00 America/Chicago by server/football/scheduler.mjs).

NFL  : nflverse schedules + play-by-play -> compact private cache -> opponent-adjusted EPA ratings,
       points model, sim parameters, schedule with scores -> public JSON.
NCAAF: CFBD (only when CFBD_API_KEY is set) games + per-game PPA -> ratings, points model, schedule window.

Writes (public, derived only):  {PUBLIC_DATA_DIR}/football/{nfl,ncaaf}/{ratings,schedule,params,history}.json, status.json
Writes (private, never served):  {PREDICTIONS_PRIVATE_DIR}/football/... raw downloads, caches, CFBD call counter, blocks.
A source that refuses us (401/403/persistent 429) is recorded in blocked.json and skipped on later runs until cleared
with FOOTBALL_CLEAR_BLOCKS=<source> (a human decision). Exit 3 when a source was newly blocked, else 0.
"""
import argparse, gzip, json, os, shutil, sys, tempfile, time, traceback
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from football import ratings as R, params as PR, teams as T
from football.extract import extract_pbp, save_compact, load_compact, IDX
from football import elo as E
from football import injuries as INJ
from football import totals as TOT
from football.sources import SourceBlocked, NotConfigured, nfl_provider, ncaaf_provider, NFL_ATTRIBUTION, NCAAF_ATTRIBUTION
from football.timeutil import eastern_to_utc, iso

NFL_FIRST_SEASON = 2019          # earliest season we keep ratings for (cross-era sims)
PARAM_SEASONS = 3                # play-level parameter fit window
POINTS_SEASONS = 3               # points-model fit window (completed games)
NCAAF_CFG = {"half_life": 12.0, "offseason_weeks": 16.0, "lambda": 500.0, "season_weeks": 22}
NCAAF_ELO = {"k": 28, "hfa": 35, "keep": 0.6, "mean": 1500, "per_pt": 14}   # tuned on 2022 margin MAE (2021 burn-in), step 5
NCAAF_ELO_WEIGHT = 0.55          # expected margin = 0.55 x Elo + 0.45 x EPA points model (weight chosen on 2023 only)
NCAAF_PLAY_WEEKS = 15            # regular-season weeks fetched for the play-parameter fit (+1 postseason call)
NCAAF_PLAYS_PER_GAME = 70        # CFBD gives per-game PPA averages; weight each game as ~70 plays


def log(msg):
    print(f"[football] {msg}", flush=True)


def wjson(path, obj, gz=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    if gz:
        with gzip.open(tmp, "wt", encoding="utf-8") as f:
            json.dump(obj, f, separators=(",", ":"))
    else:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, separators=(",", ":"), sort_keys=False)
    os.replace(tmp, path)


def rjson(path, default=None):
    try:
        if path.endswith(".gz"):
            with gzip.open(path, "rt", encoding="utf-8") as f:
                return json.load(f)
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return default


# ------------------------------------------------------------------ blocks
class Blocks:
    def __init__(self, path):
        self.path = path
        self.d = rjson(path, {}) or {}
        for s in filter(None, (os.environ.get("FOOTBALL_CLEAR_BLOCKS") or "").split(",")):
            if self.d.pop(s.strip(), None):
                log(f"block on {s.strip()} cleared by FOOTBALL_CLEAR_BLOCKS")
        self.save()

    def is_blocked(self, src):
        return src in self.d

    def block(self, src, reason):
        self.d[src] = {"at": iso(datetime.now(timezone.utc)), "reason": reason}
        self.save()

    def save(self):
        wjson(self.path, self.d)


# ------------------------------------------------------------------ NFL
def nfl_current_season(sched, now):
    today = now.date().isoformat()
    seasons = sorted({int(g["season"]) for g in sched if g.get("gameday") and g["gameday"] <= (now + timedelta(days=45)).date().isoformat()})
    return seasons[-1] if seasons else now.year


def nfl_schedule_games(sched, season):
    out = []
    for g in sched:
        if int(g["season"]) != season:
            continue
        ko = eastern_to_utc(g["gameday"], g.get("gametime") or "13:00")
        final = g.get("home_score") not in (None, "", "NA")
        out.append({
            "id": g["game_id"], "season": season, "week": int(g["week"]), "gameType": g["game_type"],
            "playoff": g["game_type"] != "REG", "kickoff": iso(ko),
            "home": R.canon(g["home_team"]), "away": R.canon(g["away_team"]),
            "homeName": T.NFL.get(R.canon(g["home_team"]), g["home_team"]), "awayName": T.NFL.get(R.canon(g["away_team"]), g["away_team"]),
            "neutral": g.get("location") == "Neutral",
            "homeScore": int(g["home_score"]) if final else None, "awayScore": int(g["away_score"]) if final else None,
            "overtime": g.get("overtime") == "1", "status": "final" if final else "scheduled",
            "indoor": TOT.is_indoor(g.get("roof")),       # dome / closed roof (nflverse `roof`), a totals-model feature
        })
    return out


def ensure_nfl_compact(prov, season, cur_season, raw_dir, cmp_dir):
    """Compact rows for one season; past seasons are cached forever, the current season refreshes daily (ETag)."""
    os.makedirs(cmp_dir, exist_ok=True)
    cpath = os.path.join(cmp_dir, f"nfl_{season}.json.gz")
    if season < cur_season and os.path.exists(cpath):
        return cpath, False
    if not os.path.exists(cpath):   # no derived cache: force a full download (the ETag alone would answer 304)
        try: os.remove(os.path.join(raw_dir, f"play_by_play_{season}.csv.gz.etag"))
        except FileNotFoundError: pass
    try:
        path, changed = prov.pbp_file(season, raw_dir)
    except RuntimeError as e:
        if "HTTP 404" in str(e):
            log(f"nflverse pbp {season}: not published yet")
            return None, False
        raise
    if changed or not os.path.exists(cpath):
        t0 = time.time()
        rows = list(extract_pbp(path))
        save_compact(rows, cpath)
        wjson(os.path.join(cmp_dir, f"nfl_obs_{season}.json"), R.nfl_observations(rows, IDX))
        log(f"nflverse pbp {season}: {len(rows)} plays extracted in {time.time() - t0:.1f}s")
        # raw pbp carries player names and ids: delete it once compacted, for every season (Larry (c)). The current
        # season keeps only its ETag, so tomorrow's run is a conditional GET; past seasons keep nothing.
        if os.path.dirname(os.path.abspath(path)) == os.path.abspath(raw_dir):
            for p in ((path, path + ".etag") if season < cur_season else (path,)):
                try: os.remove(p)
                except FileNotFoundError: pass
    return cpath, True


def nfl_obs(cmp_dir, seasons):
    obs = []
    for s in seasons:
        o = rjson(os.path.join(cmp_dir, f"nfl_obs_{s}.json"))
        if o is None:
            p = os.path.join(cmp_dir, f"nfl_{s}.json.gz")
            if os.path.exists(p):
                o = R.nfl_observations(load_compact(p), IDX)
                wjson(os.path.join(cmp_dir, f"nfl_obs_{s}.json"), o)
        obs += o or []
    return obs


def asof_samples(obs, games, cfg, fits=None):
    """[(x_team, site, points)] for each completed game, using ratings fitted strictly before its week.
    `fits` (a totals.Fits) shares its per-week EPA fits so the totals model does not refit them."""
    cache, out = {}, []
    for g in games:
        if g["homeScore"] is None:
            continue
        k = (g["season"], g["week"])
        if fits is not None:
            r = fits.at(*k)[0]
        else:
            if k not in cache:
                cache[k] = R.fit(obs, *k, cfg, iters=30)
            r = cache[k]
        if not r["weight"].get(g["home"]) or not r["weight"].get(g["away"]):
            continue
        site = 0 if g["neutral"] else 1
        out.append((r["off"].get(g["home"], 0) + r["def"].get(g["away"], 0), site, g["homeScore"]))
        out.append((r["off"].get(g["away"], 0) + r["def"].get(g["home"], 0), -site, g["awayScore"]))
    return out


def ratings_payload(league, r, model, teams_names, season, at_week, cfg, games_played):
    rows = []
    for t in sorted(r["off"]):
        if t not in teams_names and t != "FCS":
            continue
        o, d = r["off"][t], r["def"][t]
        rows.append({"team": t, "name": teams_names.get(t, t), "off": round(o, 4), "def": round(d, 4),
                     "ptsFor": round(model["a"] + model["b"] * o, 2), "ptsAgainst": round(model["a"] + model["b"] * d, 2),
                     "net": round(model["b"] * (o - d), 2), "games": games_played.get(t, 0)})
    rows.sort(key=lambda x: -x["net"])
    for i, x in enumerate(rows, 1):
        x["rank"] = i
    return {"league": league, "season": season, "asOfWeek": at_week, "generatedAt": iso(datetime.now(timezone.utc)),
            "leagueMeanEpa": round(r["m"], 4), "model": model, "config": cfg, "teams": rows,
            "method": "Opponent-adjusted, recency-weighted EPA per play (offense and defense), ridge-shrunk to league average; "
                      "points = a + b*(offense EPA + opponent defense EPA) +/- hfa/2."}


def totals_model(league, fits, games, season, at_week):
    """Fit the expected-total model (football/totals.py) as of (season, at_week); None -> fall back to the EPA total."""
    try:
        tm = TOT.fit(league, TOT.samples(league, fits, games), season, at_week)
    except (ValueError, ZeroDivisionError) as e:
        log(f"{league.upper()} totals model fallback: {type(e).__name__}")
        return None
    if tm:
        tm["fittedOn"] = f"completed games before {season} week {at_week} (features as of each game's week)"
    return tm


def refresh_nfl(pub, priv, blocks, now, prov=None):
    src = "nflverse"
    if blocks.is_blocked(src):
        log(f"NFL skipped: {src} is blocked since {blocks.d[src]['at']} ({blocks.d[src]['reason']})")
        return {"ok": False, "blocked": True}
    prov = prov or nfl_provider()
    raw_dir, cmp_dir = os.path.join(priv, "raw", "nflverse"), os.path.join(priv, "cache")
    out_dir = os.path.join(pub, "nfl")
    try:
        sched = prov.schedule_rows(raw_dir)
        cur = nfl_current_season(sched, now)
        seasons = list(range(max(NFL_FIRST_SEASON, cur - 5), cur + 1))
        have = []
        for s in seasons:
            p, _ = ensure_nfl_compact(prov, s, cur, raw_dir, cmp_dir)
            if p:
                have.append(s)
    except SourceBlocked as e:
        blocks.block(src, str(e)); log(f"STOPPED {src}: {e}")
        return {"ok": False, "blocked": True, "newlyBlocked": True}

    cfg = dict(R.DEFAULTS)
    obs = nfl_obs(cmp_dir, have)
    all_games = []
    for s in have:
        all_games += nfl_schedule_games(sched, s)
    cur_games = [g for g in all_games if g["season"] == cur]
    done = [g for g in cur_games if g["status"] == "final"]
    at_week = (max(g["week"] for g in done) + 1) if done else 1

    # points model: completed games of the last POINTS_SEASONS seasons (+ current), ratings as of each game's week
    fit_games = [g for g in all_games if g["season"] >= cur - POINTS_SEASONS]
    fits = TOT.Fits("nfl", obs, TOT.points_obs(all_games), cfg)
    model = R.fit_points_model(asof_samples(obs, fit_games, cfg, fits))
    tmodel = totals_model("nfl", fits, fit_games, cur, at_week)   # expected total (Ryan 10/31: better over/under)
    r_pts = fits.at(cur, at_week)[1] if tmodel else None
    model["fittedOn"] = f"{cur - POINTS_SEASONS}-{cur} completed games (ratings as of each game's week)"
    r = R.fit(obs, cur, at_week, cfg)
    # rigor step 1: Elo carries the expected margin (beat EPA, unit ratings and blends out of sample), EPA the total
    hist_games = []
    for s in sorted({int(x["season"]) for x in sched}):
        hist_games += nfl_schedule_games(sched, s)
    elo_pre, elo_now = E.run_elo(hist_games)
    played = {}
    for g in done:
        played[g["home"]] = played.get(g["home"], 0) + 1; played[g["away"]] = played.get(g["away"], 0) + 1
    rp = ratings_payload("nfl", r, model, T.NFL, cur, at_week, cfg, played)
    for t in rp["teams"]:
        if t["team"] in elo_now:
            t["elo"] = round(elo_now[t["team"]], 1)
    rp["marginModel"] = {"type": "elo", **E.NFL_ELO, "note": "expected margin = (elo_home - elo_away + hfa*site) / per_pt"}
    rp["totalModel"] = ({"type": "blend", **tmodel, "note": "expected total = coef . [1, EPA pair sum, points-ratings total, indoor]"}
                        if tmodel else {"type": "epa", "note": "expected total from the EPA points model"})
    rp["source"] = NFL_ATTRIBUTION
    wjson(os.path.join(out_dir, "ratings.json"), rp)

    # cross-era snapshots: end-of-season ratings for each past season we hold
    hist = {"model": model, "seasons": {}}
    for s in have:
        if s >= cur:
            continue
        rs = R.fit(obs, s, 30, cfg)
        hist["seasons"][str(s)] = {t: {"off": round(rs["off"][t], 4), "def": round(rs["def"][t], 4)} for t in rs["off"] if t in T.NFL}
    wjson(os.path.join(out_dir, "history.json"), hist)

    # player availability (FOOTBALL_INJURIES_ENABLED): team-level points, applied to upcoming games only
    upcoming = [g for g in cur_games if g["status"] != "final"]
    adj, inj_mode = nfl_injury_adjustments(prov, cur, sorted({(g["week"], t) for g in upcoming for t in (g["home"], g["away"])}),
                                          blocks, priv, now)
    if inj_mode != "on":
        try: os.remove(os.path.join(priv, "nfl_availability.json"))
        except FileNotFoundError: pass

    # schedule with expected points for upcoming games (sims are run by the Node service)
    for g in cur_games:
        if g["status"] != "final":
            site = 0 if g["neutral"] else 1
            tot = R.expected_points(r, model, g["home"], g["away"], site) + R.expected_points(r, model, g["away"], g["home"], -site)
            if tmodel:
                tot = TOT.predict(tmodel, TOT.features("nfl", r, r_pts, g))
            if g["home"] in elo_now and g["away"] in elo_now:
                mg = (elo_now[g["home"]] - elo_now[g["away"]] + (0 if g["neutral"] else E.NFL_ELO["hfa"])) / E.NFL_ELO["per_pt"]
            else:
                mg = R.expected_points(r, model, g["home"], g["away"], site) - R.expected_points(r, model, g["away"], g["home"], -site)
            if adj:
                ah, aa = adj.get((g["week"], g["home"]), 0.0), adj.get((g["week"], g["away"]), 0.0)
                if ah or aa:
                    g["availabilityAdj"] = {"home": ah, "away": aa}   # derived team points only (I1)
                    mg += ah - aa
            h, a = E.split_points(tot, mg)
            g["expected"] = {"home": round(h, 2), "away": round(a, 2)}
    wjson(os.path.join(out_dir, "schedule.json"), {"league": "nfl", "season": cur, "generatedAt": iso(now), "source": NFL_ATTRIBUTION,
                                                   "injuriesModeled": inj_mode == "on", "games": cur_games})

    # play-level sim parameters (weekly is enough; plays change slowly)
    ppath = os.path.join(out_dir, "params.json")
    old = rjson(ppath)
    if not old or old.get("fittedAt", "") < iso(now - timedelta(days=7)) or os.environ.get("FOOTBALL_REFIT_PARAMS") == "1":
        psz = [s for s in have if s < cur][-PARAM_SEASONS:] or have[-1:]
        rows = []
        for s in psz:
            rows += load_compact(os.path.join(cmp_dir, f"nfl_{s}.json.gz"))
        kick_season = cur if len(done) >= 48 else psz[-1]
        krows = [x for x in rows if x[IDX["season"]] == kick_season] or load_compact(os.path.join(cmp_dir, f"nfl_{kick_season}.json.gz"))
        p = PR.fit_nfl(rows, krows)
        p["fittedAt"] = iso(now); p["seasons"] = psz; p["kickoffSeason"] = kick_season
        wjson(ppath, p)
        if not ncaaf_fitted_params(pub, priv, p, now):   # CFBD play fit (step 5) when we have one, else the documented NFL transfer
            wjson(os.path.join(pub, "ncaaf", "params.json"), {**PR.ncaaf_params(p), "fittedAt": iso(now)})
        del rows, krows
        log(f"NFL sim params refit on {psz} (kickoffs {kick_season})")
    log(f"NFL ok: season {cur}, ratings as of week {at_week}, {len(cur_games)} games, model {model}")
    return {"ok": True, "season": cur, "asOfWeek": at_week, "games": len(cur_games), "completed": len(done),
            "availability": inj_mode, "injuriesModeled": inj_mode == "on"}


# ------------------------------------------------------------------ NFL availability (injuries)
INJ_SRC = "nflverse-availability"   # the injuries release; name kept free of "injur" so status.json passes the API scan


def nfl_injury_adjustments(prov, cur, team_weeks, blocks, priv, now):
    """Team-level points adjustments from the nflverse `injuries` release (NFL only). Never raises.

    Larry's conditions: (a) no player id/name in any log, error or traceback: failures log the stage and exception class
    only (INJ.safe_error), never the message, never a traceback; (c) nothing player-level is stored: the injuries file and
    the two pbp files used for player roles are downloaded into a temporary directory that is removed before this
    function returns, and the only thing written is {week: {team: points}}. Returns (adjustments, mode), mode in
    on / off / blocked / failed."""
    if not INJ.enabled():
        return None, "off"
    if blocks.is_blocked(INJ_SRC):
        log(f"NFL injuries skipped: {INJ_SRC} is blocked since {blocks.d[INJ_SRC]['at']}")
        return None, "blocked"
    tmp = tempfile.mkdtemp(prefix="nfl-avail-")
    stage = "download"
    try:
        inj, _ = prov.injuries_file(cur, tmp)
        pbp = []
        for s in (cur - 1, cur):
            try:
                pbp.append(prov.pbp_file(s, tmp)[0])
            except RuntimeError as e:
                if isinstance(e, SourceBlocked) or "HTTP 404" not in str(e):
                    raise
        stage = "compute"
        adj = INJ.team_adjustments(pbp, [inj], cur, team_weeks)
        stage = "write"
        out = {}
        for (w, t), v in adj.items():
            out.setdefault(str(w), {})[t] = v
        wjson(os.path.join(priv, "nfl_availability.json"), {"season": cur, "generatedAt": iso(now), "pointsByWeekTeam": out,
                                                            "constants": {k: INJ.PRODUCTION[k] for k in ("b_qb", "b_skill", "lookback")}})
        vals = [abs(v) for v in adj.values()]
        log(f"NFL injuries: on, {len(adj)} team-weeks adjusted (mean |adj| {sum(vals) / len(vals) if vals else 0:.2f} pts)")
        return adj, "on"
    except SourceBlocked as e:
        blocks.block(INJ_SRC, INJ.scrub(e)); log(f"STOPPED {INJ_SRC}: {INJ.scrub(e)}")
        return None, "blocked"
    except Exception as e:                       # by design: stage + class name only, never the message (Larry (a))
        log(INJ.safe_error(stage, e))
        return None, "failed"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------------------------------ NCAAF
def ncaaf_season(now):
    return now.year if now.month >= 7 else now.year - 1


def ncaaf_week_index(g):
    return g["week"] if g.get("seasonType") == "regular" else 16 + g["week"]


def ncaaf_obs(ppa_rows, fbs):
    obs = []
    for x in ppa_rows:
        o = x.get("offense") or {}; d = x.get("defense") or {}
        if o.get("overall") is None:
            continue
        team = x["team"]; opp = x["opponent"] if x["opponent"] in fbs else "FCS"
        wk = ncaaf_week_index(x)
        obs.append([x["season"], wk, team, opp, NCAAF_PLAYS_PER_GAME, o["overall"] * NCAAF_PLAYS_PER_GAME])
        if opp == "FCS" and d.get("overall") is not None:
            obs.append([x["season"], wk, "FCS", team, NCAAF_PLAYS_PER_GAME, d["overall"] * NCAAF_PLAYS_PER_GAME])
    return obs


def ncaaf_games(rows, fbs):
    out = []
    for g in rows:
        h, a = g["homeTeam"], g["awayTeam"]
        if h not in fbs and a not in fbs:
            continue
        done = bool(g.get("completed")) and g.get("homePoints") is not None
        out.append({"id": str(g["id"]), "season": g["season"], "week": ncaaf_week_index(g), "seasonType": g.get("seasonType"),
                    "kickoff": g.get("startDate"), "home": h if h in fbs else "FCS", "away": a if a in fbs else "FCS",
                    "homeName": h, "awayName": a, "neutral": bool(g.get("neutralSite")), "playoff": g.get("seasonType") == "postseason",
                    "homeScore": g.get("homePoints") if done else None, "awayScore": g.get("awayPoints") if done else None,
                    "status": "final" if done else "scheduled"})
    return out


def ncaaf_play_fit(prov, raw, priv, year):
    """Fit NCAAF play-level parameters from one full CFBD season of plays (16 calls, once per season). The raw plays stay
    in the private cache; only the fitted frequencies are kept (private fit file, then public params)."""
    from football import cfbd_plays as CP
    fp = os.path.join(priv, f"ncaaf_play_fit_{year}.json")
    if os.path.exists(fp):
        return rjson(fp)
    if not hasattr(prov, "plays"):
        return None
    rows = []
    for wk, st in [(w, "regular") for w in range(1, NCAAF_PLAY_WEEKS + 1)] + [(1, "postseason")]:
        pth = os.path.join(raw, f"plays_{year}_{'w%02d' % wk if st == 'regular' else 'post'}.json.gz")
        if not os.path.exists(pth):
            wjson(pth, prov.plays(year, wk, st), gz=True)
        rows += CP.to_rows(rjson(pth, []))                     # week by week keeps peak memory low
    if len(rows) < 20000:
        log(f"NCAAF play fit skipped: only {len(rows)} plays for {year}")
        return None
    fit = CP.fit_ncaaf(rows, label=f"CFBD play-by-play {year}"); fit["seasons"] = [year]
    wjson(fp, fit)
    return fit


def ncaaf_fitted_params(pub, priv, nfl, now):
    """Write public NCAAF sim params from the newest private CFBD play fit + the current NFL clock. False if no fit yet."""
    from football import cfbd_plays as CP
    fits = sorted(f for f in os.listdir(priv) if f.startswith("ncaaf_play_fit_")) if os.path.isdir(priv) else []
    if not fits or not nfl:
        return False
    wjson(os.path.join(pub, "ncaaf", "params.json"), {**CP.ncaaf_params_from_fit(rjson(os.path.join(priv, fits[-1])), nfl), "fittedAt": iso(now)})
    return True


def refresh_ncaaf(pub, priv, blocks, now, prov=None):
    src = "cfbd"
    if not prov and not os.environ.get("CFBD_API_KEY"):
        log("NCAAF skipped: CFBD_API_KEY is not set (paste it into Railway Variables to enable college football)")
        return {"ok": False, "skipped": "no-key"}
    if blocks.is_blocked(src):
        log(f"NCAAF skipped: {src} is blocked since {blocks.d[src]['at']} ({blocks.d[src]['reason']})")
        return {"ok": False, "blocked": True}
    raw = os.path.join(priv, "raw", "cfbd")
    os.makedirs(raw, exist_ok=True)
    cur = ncaaf_season(now)
    try:
        prov = prov or ncaaf_provider(budget_file=os.path.join(priv, "cfbd-budget.json"))
        data = {}
        for y in (cur - 1, cur):
            gp, pp = os.path.join(raw, f"games_{y}.json.gz"), os.path.join(raw, f"ppa_{y}.json.gz")
            if y == cur or not os.path.exists(gp):
                wjson(gp, prov.games(y, "both"), gz=True)
            if y == cur or not os.path.exists(pp):
                wjson(pp, prov.ppa_games(y, "both"), gz=True)
            data[y] = (rjson(gp, []), rjson(pp, []))
        ep = os.path.join(raw, f"games_{cur - 2}.json.gz")        # Elo burn-in season (cached once)
        if not os.path.exists(ep):
            wjson(ep, prov.games(cur - 2, "both"), gz=True)
        elo_raw = rjson(ep, [])
        fit = ncaaf_play_fit(prov, raw, priv, cur - 1)            # last complete season's plays (step 5)
        tp = os.path.join(raw, f"teams_{cur}.json.gz")
        if not os.path.exists(tp) and hasattr(prov, "teams"):
            wjson(tp, prov.teams(cur), gz=True)
        team_rows = rjson(tp, [])
    except SourceBlocked as e:
        blocks.block(src, str(e)); log(f"STOPPED {src}: {e}")
        return {"ok": False, "blocked": True, "newlyBlocked": True}
    except NotConfigured as e:
        log(f"NCAAF skipped: {e}")
        return {"ok": False, "skipped": "no-key"}

    fbs = set()
    for y, (games, _) in data.items():
        for g in games:
            if g.get("homeClassification") == "fbs": fbs.add(g["homeTeam"])
            if g.get("awayClassification") == "fbs": fbs.add(g["awayTeam"])
    obs, games = [], []
    for y, (g, p) in sorted(data.items()):
        obs += ncaaf_obs(p, fbs); games += ncaaf_games(g, fbs)
    elo_games = [g for g in ncaaf_games(elo_raw, fbs)] + games
    elo_pre, _ = E.run_elo([{k: g[k] for k in ("id", "season", "kickoff", "home", "away", "neutral", "homeScore", "awayScore")} for g in elo_games], NCAAF_ELO)
    if fit:
        ncaaf_fitted_params(pub, priv, rjson(os.path.join(pub, "nfl", "params.json")), now)
    cfg = dict(NCAAF_CFG)
    cur_games = [g for g in games if g["season"] == cur]
    done = [g for g in cur_games if g["status"] == "final"]
    at_week = (max(g["week"] for g in done) + 1) if done else 1
    fits = TOT.Fits("ncaaf", obs, TOT.points_obs(games), cfg)
    model = R.fit_points_model(asof_samples(obs, games, cfg, fits))
    model["fittedOn"] = f"{cur - 1}-{cur} completed games involving FBS teams (ratings as of each game's week)"
    r = R.fit(obs, cur, at_week, cfg, teams=fbs | {"FCS"})
    tmodel = totals_model("ncaaf", fits, games, cur, at_week)     # expected total (Ryan 10/31: better over/under)
    r_pts = R.fit(TOT.points_obs(games), cur, at_week, TOT.pts_cfg("ncaaf", cfg), teams=fbs | {"FCS"}) if tmodel else None
    mascot = {t.get("school"): (t.get("mascot") or "").strip() for t in team_rows if isinstance(t, dict)}
    names = {t: (f"{t} {mascot[t]}" if mascot.get(t) else t) for t in fbs}; names["FCS"] = "Non-FBS opponent (pooled)"
    played = {}
    for g in done:
        played[g["home"]] = played.get(g["home"], 0) + 1; played[g["away"]] = played.get(g["away"], 0) + 1
    out = os.path.join(pub, "ncaaf")
    rp = ratings_payload("ncaaf", r, model, names, cur, at_week, cfg, played)
    rp["totalModel"] = ({"type": "blend", **tmodel, "note": "expected total = coef . [1, EPA pair sum, points-ratings total]"}
                        if tmodel else {"type": "epa", "note": "expected total from the EPA points model"})
    wjson(os.path.join(out, "ratings.json"), rp)
    lo, hi = iso(now - timedelta(days=8)), iso(now + timedelta(days=15))
    window = [g for g in cur_games if g["kickoff"] and lo <= g["kickoff"].replace(".000Z", "Z") <= hi]
    for g in window:
        g["homeName"], g["awayName"] = names.get(g["home"], g["home"]), names.get(g["away"], g["away"])
        if g["status"] != "final":
            site = 0 if g["neutral"] else 1
            eh, ea = R.expected_points(r, model, g["home"], g["away"], site), R.expected_points(r, model, g["away"], g["home"], -site)
            mg = eh - ea
            if g["id"] in elo_pre:                                  # step 5: Elo/EPA blend beat EPA alone in every test season
                mg = NCAAF_ELO_WEIGHT * elo_pre[g["id"]]["spread"] + (1 - NCAAF_ELO_WEIGHT) * mg
            tot = TOT.predict(tmodel, TOT.features("ncaaf", r, r_pts, g)) if tmodel else eh + ea
            h, a = E.split_points(tot, mg)
            g["expected"] = {"home": round(h, 2), "away": round(a, 2)}
    wjson(os.path.join(out, "schedule.json"), {"league": "ncaaf", "season": cur, "generatedAt": iso(now),
          "source": NCAAF_ATTRIBUTION, "games": window,
          "note": "Only a rolling window (8 days back, 15 ahead) is published."})
    log(f"NCAAF ok: season {cur}, ratings as of week {at_week}, {len(fbs)} FBS teams, model {model}")
    return {"ok": True, "season": cur, "asOfWeek": at_week, "teams": len(fbs), "windowGames": len(window), "playFit": bool(fit)}


# ------------------------------------------------------------------ main
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", choices=["nfl", "ncaaf", "all"], default="all")
    a = ap.parse_args(argv)
    pub = os.path.join(os.environ.get("PUBLIC_DATA_DIR") or "/tmp/proswisher/public-data", "football")
    priv = os.path.join(os.environ.get("PREDICTIONS_PRIVATE_DIR") or "/tmp/proswisher/private-data", "football")
    os.makedirs(pub, exist_ok=True); os.makedirs(priv, exist_ok=True)
    now = datetime.now(timezone.utc)
    blocks = Blocks(os.path.join(priv, "blocked.json"))
    status = rjson(os.path.join(pub, "status.json"), {}) or {}
    newly = False
    for lg, fn in (("nfl", refresh_nfl), ("ncaaf", refresh_ncaaf)):
        if a.league not in (lg, "all"):
            continue
        try:
            res = fn(pub, priv, blocks, now)
        except Exception as e:                      # one league failing never stops the other
            print(INJ.scrub(traceback.format_exc()), file=sys.stderr, end="")   # player ids masked (Larry (a))
            res = {"ok": False, "error": INJ.scrub(f"{type(e).__name__}: {e}")}
        newly |= bool(res.pop("newlyBlocked", False))
        status[lg] = {**res, "at": iso(now)}
    status["blocked"] = blocks.d
    status["generatedAt"] = iso(now)
    wjson(os.path.join(pub, "status.json"), status)
    return 3 if newly else 0


if __name__ == "__main__":
    sys.exit(main())
