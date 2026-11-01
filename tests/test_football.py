"""Football data layer tests (no network, no keys): extraction, ratings (no look-ahead), points model, source
refusal/budget semantics, US Eastern time conversion, and the daily refresh with fake providers."""
import csv, gzip, io, json, os, sys, tempfile, unittest, urllib.error
from datetime import datetime, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
from football import extract as X, ratings as R, sources as SRC, refresh as RF, params as PR
from football.timeutil import eastern_to_utc, iso

TEAMS = ["KC", "LV", "BUF", "MIA"]


def synth_pbp(path, season=2025, weeks=4):
    """Tiny nflverse-shaped pbp: KC's offense is clearly the best (+0.3 EPA/play)."""
    with gzip.open(path, "wt", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(X.COLS + ["extra_col"])
        for wk in range(1, weeks + 1):
            pairs = [("KC", "LV"), ("BUF", "MIA")] if wk % 2 else [("KC", "BUF"), ("LV", "MIA")]
            for h, a in pairs:
                gid = f"{season}_{wk:02d}_{a}_{h}"
                for off, de in ((h, a), (a, h)):
                    for i in range(60):
                        row = {c: "NA" for c in X.COLS}
                        row.update(game_id=gid, season=season, week=wk, season_type="REG", home_team=h, away_team=a, posteam=off, defteam=de,
                                   qtr=1 + i // 15, down=1, ydstogo=10, yardline_100=60, play_type="pass" if i % 2 else "run",
                                   epa=0.3 if off == "KC" else -0.05, wp=0.5, two_point_attempt=0, yards_gained=5)
                        w.writerow([row[c] for c in X.COLS] + ["x"])
                    w.writerow([gid if c == "game_id" else ("" if c == "play_type" else "NA") for c in X.COLS] + ["x"])  # END QUARTER row


class Extract(unittest.TestCase):
    def test_extract_and_compact_roundtrip(self):
        d = tempfile.mkdtemp(); p = os.path.join(d, "play_by_play_2025.csv.gz"); synth_pbp(p)
        rows = list(X.extract_pbp(p))
        self.assertEqual(len(rows), 4 * 2 * 2 * 60)              # empty play_type rows skipped
        self.assertEqual(rows[0][X.IDX["season"]], 2025); self.assertIsInstance(rows[0][X.IDX["epa"]], float)
        c = os.path.join(d, "c.json.gz"); X.save_compact(rows, c)
        self.assertEqual(X.load_compact(c), rows)

    def test_missing_columns_fail_loudly(self):
        d = tempfile.mkdtemp(); p = os.path.join(d, "bad.csv.gz")
        with gzip.open(p, "wt") as f: f.write("game_id,season\n1,2025\n")
        with self.assertRaises(ValueError): list(X.extract_pbp(p))


class Ratings(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp(); p = os.path.join(d, "pbp.csv.gz"); synth_pbp(p, weeks=6)
        self.obs = R.nfl_observations(list(X.extract_pbp(p)), X.IDX)

    def test_best_offense_ranks_first_and_shrinks(self):
        r = R.fit(self.obs, 2025, 7, {"lambda": 50})
        self.assertEqual(max(r["off"], key=r["off"].get), "KC")
        self.assertLess(r["off"]["KC"], 0.35 - r["m"])            # ridge shrinkage toward the mean

    def test_no_look_ahead(self):
        early = R.fit(self.obs, 2025, 3)
        only = [o for o in self.obs if o[1] < 3]
        self.assertEqual(early, R.fit(only, 2025, 3))
        self.assertTrue(all(v == 0 for v in R.fit(self.obs, 2025, 1)["off"].values()))

    def test_relocations_are_canonical(self):
        self.assertEqual(R.canon("OAK"), "LV"); self.assertEqual(R.canon("SD"), "LAC"); self.assertEqual(R.canon("KC"), "KC")

    def test_points_model_recovers_coefficients(self):
        s = [(x / 100, site, 22 + 60 * x / 100 + site) for x in range(-10, 11) for site in (-1, 0, 1)]
        m = R.fit_points_model(s)
        self.assertAlmostEqual(m["a"], 22, 2); self.assertAlmostEqual(m["b"], 60, 1); self.assertAlmostEqual(m["hfa"], 2, 2)


class Sources(unittest.TestCase):
    def _http(self, code):
        return urllib.error.HTTPError("https://x", code, "x", {}, None)

    def test_refusal_raises_source_blocked(self):
        for code in (401, 403):
            with mock.patch("urllib.request.urlopen", side_effect=self._http(code)):
                with self.assertRaises(SRC.SourceBlocked): SRC._open("https://x", {}, "t")

    def test_persistent_429_blocks_after_one_backoff(self):
        with mock.patch("urllib.request.urlopen", side_effect=self._http(429)), mock.patch("time.sleep") as sl:
            with self.assertRaises(SRC.SourceBlocked): SRC._open("https://x", {}, "t")
            sl.assert_called_once_with(65)

    def test_cfbd_needs_key_and_respects_budget(self):
        with mock.patch.dict(os.environ, {"CFBD_API_KEY": ""}):
            with self.assertRaises(SRC.NotConfigured): SRC.CfbdProvider()
        b = os.path.join(tempfile.mkdtemp(), "budget.json")
        p = SRC.CfbdProvider(key="k", budget_file=b, monthly_budget=2)
        def resp(*a, **k):
            r = mock.MagicMock(); r.__enter__.return_value = io.BytesIO(b"[]"); return r
        with mock.patch("urllib.request.urlopen", side_effect=resp) as u:
            p.games(2025); p.ppa_games(2025)
            with self.assertRaises(SRC.SourceBlocked): p.lines(2025)
            self.assertEqual(u.call_count, 2)
            self.assertIn("classification=fbs", u.call_args_list[0][0][0].full_url)
            self.assertEqual(u.call_args_list[0][0][0].get_header("Authorization"), "Bearer k")


class BannedSources(unittest.TestCase):
    """Larry memo 24 N2 (+ memo 20): only the CC BY 4.0 pbp and schedules releases; banned sources fail before any I/O."""
    BANNED = ["ftn_charting", "pbp_participation", "participation", "nextgen_stats", "pfr_advstats", "snap_counts",
              "draft_picks", "combine", "espn_data", "contracts", "teams", "teams_colors_logos"]

    def test_banned_tags_are_listed_and_refused(self):
        for t in self.BANNED:
            self.assertIn(t, SRC.BANNED_NFLVERSE_TAGS)
            with mock.patch("urllib.request.urlopen") as u, self.assertRaises(ValueError):
                SRC._open(f"https://github.com/nflverse/nflverse-data/releases/download/{t}/{t}.csv", {}, t)
            u.assert_not_called()

    def test_banned_hosts_are_refused(self):
        for url in ["https://site.api.espn.com/apis/x", "https://api.sportradar.us/nfl", "https://www.pro-football-reference.com/x",
                    "https://www.sports-reference.com/cfb", "https://overthecap.com/x", "https://nextgenstats.nfl.com/x"]:
            with mock.patch("urllib.request.urlopen") as u, self.assertRaises(ValueError):
                SRC._open(url, {}, "x")
            u.assert_not_called()

    def test_allowed_releases_pass(self):
        for t in SRC.ALLOWED_NFLVERSE_TAGS:
            SRC.check_url(f"https://github.com/nflverse/nflverse-data/releases/download/{t}/x.csv")
        self.assertEqual(set(SRC.ALLOWED_NFLVERSE_TAGS), {"pbp", "schedules", "injuries"})   # I4: only `injuries` was added
        self.assertFalse(set(SRC.ALLOWED_NFLVERSE_TAGS) & set(SRC.BANNED_NFLVERSE_TAGS))

    def test_no_code_references_banned_releases(self):
        root = os.path.join(os.path.dirname(__file__), "..")
        hits = []
        for d in ("scripts", "server", "src"):
            for dp, _, fs in os.walk(os.path.join(root, d)):
                for f in fs:
                    if not f.endswith((".py", ".mjs", ".js", ".ts", ".tsx")) or "__pycache__" in dp:
                        continue
                    txt = open(os.path.join(dp, f), encoding="utf-8").read()
                    for t in self.BANNED:
                        if f"releases/download/{t}/" in txt:
                            hits.append((f, t))
        self.assertEqual(hits, [])

    def test_attribution_strings(self):
        self.assertEqual(SRC.NFL_ATTRIBUTION, "NFL data: nflverse (github.com/nflverse/nflverse-data), licensed under CC BY 4.0 "
                         "(https://creativecommons.org/licenses/by/4.0/). Modified by Op3x LLC (aggregated, modeled and simulated). "
                         "Not affiliated with or endorsed by the NFL or nflverse.")
        self.assertEqual(SRC.NCAAF_ATTRIBUTION, "Data provided by CollegeFootballData.com.")


class Elo(unittest.TestCase):
    def test_elo_learns_strength_and_is_walk_forward(self):
        from football import elo as E
        gs = []
        for i in range(40):  # A beats B by 14 every week, alternating home
            h, a = ("A", "B") if i % 2 else ("B", "A")
            gs.append({"id": str(i), "season": 2020 + i // 20, "kickoff": f"2020-{1 + i // 4:02d}-{1 + (i % 4) * 7:02d}T{i:02d}", "home": h, "away": a,
                       "neutral": False, "homeScore": 24 if h == "A" else 10, "awayScore": 10 if h == "A" else 24})
        gs.append({"id": "next", "season": 2021, "kickoff": "2099", "home": "A", "away": "B", "neutral": True, "homeScore": None, "awayScore": None})
        pre, now = E.run_elo(gs)
        self.assertAlmostEqual(pre["0"]["spread"], E.NFL_ELO["hfa"] / E.NFL_ELO["per_pt"], places=6)  # first game: equal teams, home edge only
        self.assertGreater(now["A"], now["B"]); self.assertGreater(pre["next"]["spread"], 3); self.assertGreater(pre["next"]["p"], 0.6)
        self.assertEqual(now, E.run_elo(gs[:-1])[1], "an unplayed game never changes ratings")
        self.assertEqual(E.split_points(45, 5), (25.0, 20.0))


class UnitRatings(unittest.TestCase):
    def test_ridge_unit_ratings_recover_a_strong_pass_offense(self):
        from football import unit_ratings as U
        obs = []
        teams = ["A", "B", "C", "D"]
        for w in range(1, 9):
            for i, o in enumerate(teams):
                d = teams[(i + w) % 4] if teams[(i + w) % 4] != o else teams[(i + w + 1) % 4]
                obs.append((2024, w, f"{w}{o}", o, d, 1 if i % 2 else -1, {"pass": (35, 35 * (0.3 if o == "A" else 0.0)), "run": (25, 0.0)}))
        ur = U.UnitRatings(obs, dict(U.DEFAULTS))
        r = ur.at(2024, 9)
        self.assertEqual(max(r["pass"]["off"], key=r["pass"]["off"].get), "A")
        self.assertLess(r["pass"]["off"]["A"], 0.3, "ridge shrinks toward the mean")


class Time(unittest.TestCase):
    def test_eastern_to_utc_dst(self):
        self.assertEqual(iso(eastern_to_utc("2026-10-25", "13:00")), "2026-10-25T17:00:00Z")   # EDT
        self.assertEqual(iso(eastern_to_utc("2026-11-01", "13:00")), "2026-11-01T18:00:00Z")   # EST (fall-back day)
        self.assertEqual(iso(eastern_to_utc("2026-12-25", "20:15")), "2026-12-26T01:15:00Z")


class FakeNfl(SRC.NflDataProvider):
    def __init__(self, d, blocked=False): self.d, self.blocked = d, blocked
    def pbp_file(self, season, dest):
        if self.blocked: raise SRC.SourceBlocked("nflverse pbp: HTTP 403 (refused)")
        p = os.path.join(self.d, f"play_by_play_{season}.csv.gz")
        if not os.path.exists(p): raise RuntimeError("nflverse: HTTP 404")
        return p, True
    def schedule_rows(self, dest):
        if self.blocked: raise SRC.SourceBlocked("nflverse schedules: HTTP 403 (refused)")
        rows = []
        for wk in range(1, 8):
            pairs = [("KC", "LV"), ("BUF", "MIA")] if wk % 2 else [("KC", "BUF"), ("LV", "MIA")]
            for h, a in pairs:
                done = wk <= 6
                rows.append({"game_id": f"2025_{wk:02d}_{a}_{h}", "season": "2025", "week": str(wk), "game_type": "REG", "gameday": f"2025-10-{wk + 1:02d}",
                             "gametime": "13:00", "home_team": h, "away_team": a, "location": "Home", "home_score": "27" if done else "NA",
                             "away_score": "20" if done else "NA", "overtime": "0"})
        return rows


class Refresh(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(); synth_pbp(os.path.join(self.d, "play_by_play_2025.csv.gz"), weeks=6)
        self.pub, self.priv = os.path.join(self.d, "pub"), os.path.join(self.d, "priv")
        os.makedirs(os.path.join(self.pub, "nfl"))
        with open(os.path.join(HERE, "fixtures", "football", "nfl-params.json")) as f: p = json.load(f)
        p["fittedAt"] = "2999-01-01T00:00:00Z"
        with open(os.path.join(self.pub, "nfl", "params.json"), "w") as f: json.dump(p, f)
        self.now = datetime(2025, 10, 9, 12, tzinfo=timezone.utc)

    def test_nfl_refresh_writes_derived_public_files(self):
        b = RF.Blocks(os.path.join(self.priv, "blocked.json"))
        res = RF.refresh_nfl(self.pub, self.priv, b, self.now, prov=FakeNfl(self.d))
        self.assertTrue(res["ok"]); self.assertEqual(res["asOfWeek"], 7)
        r = json.load(open(os.path.join(self.pub, "nfl", "ratings.json")))
        self.assertEqual(r["teams"][0]["team"], "KC"); self.assertEqual(r["teams"][0]["name"], "Kansas City Chiefs")
        self.assertEqual(r["marginModel"]["type"], "elo"); self.assertIn("elo", r["teams"][0])
        s = json.load(open(os.path.join(self.pub, "nfl", "schedule.json")))
        up = [g for g in s["games"] if g["status"] == "scheduled"]
        self.assertEqual(len(up), 2); self.assertIn("expected", up[0]); self.assertTrue(up[0]["kickoff"].endswith("T17:00:00Z"))
        self.assertFalse(os.path.exists(os.path.join(self.pub, "nfl", "play_by_play_2025.csv.gz")))
        for f in os.listdir(os.path.join(self.pub, "nfl")):  # nothing raw in the public dir
            self.assertTrue(f.endswith(".json"))
        # memo 24: attribution with licence link; odds columns stay backtest-only (N3); no raw play rows (N1)
        self.assertEqual(s["source"], SRC.NFL_ATTRIBUTION)
        blob = "".join(open(os.path.join(self.pub, "nfl", f)).read() for f in os.listdir(os.path.join(self.pub, "nfl")))
        for k in ("spread_line", "total_line", "moneyline", "spreadLine", "totalLine", "_odds", "play_id", "desc\"", "passer", "referee", "_coach", "_qb_name", "logo"):
            self.assertNotIn(k, blob, k)

    def test_blocked_source_is_stopped_and_remembered(self):
        b = RF.Blocks(os.path.join(self.priv, "blocked.json"))
        res = RF.refresh_nfl(self.pub, self.priv, b, self.now, prov=FakeNfl(self.d, blocked=True))
        self.assertTrue(res["newlyBlocked"]); self.assertIn("nflverse", b.d)
        calls = []
        class Spy(FakeNfl):
            def schedule_rows(s, dest): calls.append(1); return super().schedule_rows(dest)
        res2 = RF.refresh_nfl(self.pub, self.priv, RF.Blocks(os.path.join(self.priv, "blocked.json")), self.now, prov=Spy(self.d))
        self.assertTrue(res2["blocked"]); self.assertEqual(calls, [])
        with mock.patch.dict(os.environ, {"FOOTBALL_CLEAR_BLOCKS": "nflverse"}):
            self.assertNotIn("nflverse", RF.Blocks(os.path.join(self.priv, "blocked.json")).d)

    def test_ncaaf_skips_cleanly_without_key(self):
        with mock.patch.dict(os.environ, {"CFBD_API_KEY": ""}):
            res = RF.refresh_ncaaf(self.pub, self.priv, RF.Blocks(os.path.join(self.priv, "b.json")), self.now)
        self.assertEqual(res, {"ok": False, "skipped": "no-key"})
        self.assertFalse(os.path.exists(os.path.join(self.pub, "ncaaf", "ratings.json")))

    def test_ncaaf_with_fake_cfbd_keeps_raw_private(self):
        def game(i, wk, h, a, hp, ap, done=True):
            return {"id": i, "season": 2025, "week": wk, "seasonType": "regular", "startDate": f"2025-10-{wk:02d}T20:00:00.000Z", "completed": done,
                    "neutralSite": False, "homeTeam": h, "awayTeam": a, "homeClassification": "fbs", "awayClassification": "fcs" if a == "Tiny" else "fbs",
                    "homePoints": hp if done else None, "awayPoints": ap if done else None}
        games = [game(1, 1, "Georgia", "Tiny", 49, 3), game(2, 2, "Texas", "Georgia", 20, 27), game(3, 3, "Georgia", "Texas", 31, 17), game(4, 9, "Texas", "Georgia", 0, 0, False)]
        def ppa(gid, wk, t, o, ov, dv): return {"gameId": gid, "season": 2025, "week": wk, "seasonType": "regular", "team": t, "opponent": o, "offense": {"overall": ov}, "defense": {"overall": dv}}
        pp = [ppa(1, 1, "Georgia", "Tiny", 0.6, -0.3), ppa(1, 1, "Tiny", "Georgia", -0.3, 0.6), ppa(2, 2, "Texas", "Georgia", 0.0, 0.2), ppa(2, 2, "Georgia", "Texas", 0.2, 0.0),
              ppa(3, 3, "Georgia", "Texas", 0.3, -0.1), ppa(3, 3, "Texas", "Georgia", -0.1, 0.3)]
        class FakeCfbd:
            calls = 0
            def games(s, y, t): s.calls += 1; return games if y == 2025 else []
            def ppa_games(s, y, t): s.calls += 1; return pp if y == 2025 else []
            def teams(s, y): s.calls += 1; return [{"school": "Georgia", "mascot": "Bulldogs"}, {"school": "Texas", "mascot": "Longhorns"}]
        f = FakeCfbd()
        res = RF.refresh_ncaaf(self.pub, self.priv, RF.Blocks(os.path.join(self.priv, "b.json")), datetime(2025, 10, 15, tzinfo=timezone.utc), prov=f)
        self.assertTrue(res["ok"]); self.assertEqual(f.calls, 6)          # + one cached Elo burn-in season; no plays() on this fake
        r = json.load(open(os.path.join(self.pub, "ncaaf", "ratings.json")))
        self.assertEqual(r["teams"][0]["team"], "Georgia")
        self.assertEqual(r["teams"][0]["name"], "Georgia Bulldogs")             # school + mascot, plain text
        self.assertIn("FCS", [t["team"] for t in r["teams"]])                # FCS opponents pooled
        self.assertTrue(os.path.exists(os.path.join(self.priv, "raw", "cfbd", "games_2025.json.gz")))
        pub_text = "".join(open(os.path.join(self.pub, "ncaaf", f)).read() for f in os.listdir(os.path.join(self.pub, "ncaaf")))
        self.assertNotIn('"offense"', pub_text)                                 # no raw CFBD payloads in public files
        sched = json.load(open(os.path.join(self.pub, "ncaaf", "schedule.json")))
        self.assertTrue(all(g["id"] != "1" for g in sched["games"]))           # only the rolling window is published


class Params(unittest.TestCase):
    def test_ncaaf_params_document_their_assumptions(self):
        with open(os.path.join(HERE, "fixtures", "football", "nfl-params.json")) as f: nfl = json.load(f)
        c = PR.ncaaf_params(nfl)
        self.assertEqual(c["league"], "ncaaf"); self.assertIn("pending", c["source"])
        self.assertLess(c["fieldGoal"]["a"], nfl["fieldGoal"]["a"]); self.assertEqual(nfl["league"], "nfl")




class CfbdPlays(unittest.TestCase):
    def test_cfbd_plays_map_to_compact_rows(self):
        from football import cfbd_plays as CP
        base = dict(gameId=1, season=2023, week=1, home="Ohio State", away="Indiana", period=1, clock={"minutes": 10, "seconds": 0},
                    offenseScore=0, defenseScore=0, down=1, distance=10, yardsToGoal=75, ppa=0.1)
        plays = [
            {**base, "id": 1, "offense": "Indiana", "defense": "Ohio State", "playType": "Kickoff", "playText": "kickoff for 65 yds , touchback", "yardsGained": 0},
            {**base, "id": 2, "offense": "Ohio State", "defense": "Indiana", "playType": "Rush", "playText": "X run for 6 yds", "yardsGained": 6},
            {**base, "id": 3, "offense": "Ohio State", "defense": "Indiana", "playType": "Passing Touchdown", "playText": "X pass complete to Y for 69 yds for a TD (Z KICK)", "yardsGained": 69, "scoring": True},
            {**base, "id": 4, "offense": "Indiana", "defense": "Ohio State", "playType": "Penalty", "playText": "Indiana Penalty, False Start (-5 Yards)", "yardsGained": -5},
            {**base, "id": 5, "offense": "Indiana", "defense": "Ohio State", "playType": "Sack", "playText": "Q sacked by W for a loss of 8", "yardsGained": -8},
            {**base, "id": 6, "offense": "Indiana", "defense": "Ohio State", "playType": "Field Goal Good", "playText": "K 47 yd FG GOOD", "yardsGained": 0},
            {**base, "id": 7, "period": 5, "offense": "Indiana", "defense": "Ohio State", "playType": "Rush", "playText": "OT run", "yardsGained": 3},
        ]
        rows = CP.to_rows(plays); I = X.IDX
        self.assertEqual([r[I["play_type"]] for r in rows], ["kickoff", "run", "pass", "extra_point", "no_play", "pass", "field_goal"])
        self.assertEqual(rows[0][I["posteam"]], "Ohio State")                      # receiving team on kickoffs
        self.assertEqual(rows[2][I["touchdown"]], 1); self.assertEqual(rows[3][I["extra_point_result"]], "good")
        self.assertEqual(rows[4][I["penalty_team"]], "Indiana")                    # negative yards = offensive foul
        self.assertEqual(rows[5][I["sack"]], 1); self.assertEqual(rows[6][I["kick_distance"]], 47)
        self.assertEqual(rows[1][I["half_seconds_remaining"]], 1500)
        self.assertEqual(CP._try("PASS FAILED (TWO-POINT CONVERSION FAILED)"), ("2pt", False))
        self.assertEqual(CP._try("Y run for a TD (PAT MISSED)"), ("xp", False))
        with open(os.path.join(HERE, "fixtures", "football", "nfl-params.json")) as f: nfl = json.load(f)
        p = CP.ncaaf_params_from_fit({"league": "ncaaf", "source": "t"}, nfl)
        self.assertEqual(p["clock"], nfl["clock"]); self.assertEqual(p["rules"]["tempo"], CP.NCAAF_TEMPO)

    def test_ncaaf_play_fit_is_cached_private_and_feeds_public_params(self):
        d = tempfile.mkdtemp(); priv, pub, raw = os.path.join(d, "priv"), os.path.join(d, "pub"), os.path.join(d, "priv", "raw")
        os.makedirs(raw); os.makedirs(os.path.join(pub, "ncaaf"))
        class Few:
            calls = 0
            def plays(s, y, wk, st): s.calls += 1; return []
        f = Few()
        self.assertIsNone(RF.ncaaf_play_fit(f, raw, priv, 2025)); self.assertEqual(f.calls, 16)     # 15 weeks + postseason, too few plays
        self.assertIsNone(RF.ncaaf_play_fit(f, raw, priv, 2025)); self.assertEqual(f.calls, 16)     # raw weeks cached, no refetch
        self.assertFalse(RF.ncaaf_fitted_params(pub, priv, {"clock": {}}, datetime(2025, 10, 1, tzinfo=timezone.utc)))
        with open(os.path.join(priv, "ncaaf_play_fit_2025.json"), "w") as fh: json.dump({"league": "ncaaf", "source": "x"}, fh)
        with open(os.path.join(HERE, "fixtures", "football", "nfl-params.json")) as fh: nfl = json.load(fh)
        self.assertTrue(RF.ncaaf_fitted_params(pub, priv, nfl, datetime(2025, 10, 1, tzinfo=timezone.utc)))
        out = json.load(open(os.path.join(pub, "ncaaf", "params.json")))
        self.assertEqual(out["rules"]["tempo"], 0.95); self.assertIn("fittedAt", out)

class LinAlg(unittest.TestCase):
    def test_ridge_and_logistic_recover_known_coefficients(self):
        import random
        from football import linalg as LA
        rnd = random.Random(7)
        X = [[1.0, rnd.gauss(0, 1)] for _ in range(4000)]
        beta, _ = LA.ridge_sparse([([0, 1], x, 2 + 3 * x[1] + rnd.gauss(0, 1), 1.0) for x in X], 2, [0.0, 0.0])
        self.assertAlmostEqual(beta[0], 2, delta=0.1); self.assertAlmostEqual(beta[1], 3, delta=0.1)
        y = [1 if rnd.random() < LA._sig(0.3 + 1.2 * x[1]) else 0 for x in X]
        f = LA.logistic_fit(X, y, l2=0.0)
        self.assertAlmostEqual(f["coef"][1], 1.2, delta=0.15); self.assertGreater(f["se"][1], 0)
        # a prior mean pulls the estimate toward it when the penalty is large
        b2, _ = LA.ridge_sparse([([0, 1], x, 3 * x[1], 1.0) for x in X[:20]], 2, [0.0, 1e6], prior=[0.0, 1.0])
        self.assertAlmostEqual(b2[1], 1.0, delta=0.01)

class InjuriesPrototype(unittest.TestCase):
    """Oct 31 injuries research (I1-I4): flag off by default, no look-ahead roles, model-only output."""

    def test_flag_off_by_default_and_fetch_refused(self):
        from football import injuries as INJ
        self.assertFalse(INJ.enabled({}))
        with mock.patch.dict(os.environ, {"FOOTBALL_INJURIES_ENABLED": ""}), mock.patch("urllib.request.urlopen") as u:
            with self.assertRaises(RuntimeError):
                SRC.Nflverse().injuries_file(2026, "/tmp/never")
            u.assert_not_called()

    def test_refresh_and_server_do_not_use_injuries(self):
        root = os.path.join(os.path.dirname(__file__), "..")
        for f in ("scripts/football/refresh.py", "server/football/routes.mjs", "server/football/scheduler.mjs",
                  "server/football/store.mjs", "server/football/ticker.mjs"):
            p = os.path.join(root, f)
            self.assertNotIn("injur", open(p, encoding="utf-8").read().lower(), f)

    def test_roles_use_only_earlier_games(self):
        from football import injuries as INJ
        usage = {(2024, 1, "KC"): {"q1": (1.0, 0.0), "r1": (0.0, 0.5)}, (2024, 2, "KC"): {"q2": (1.0, 0.0), "r1": (0.0, 1.0)}}
        role = INJ.roles_before(usage)
        self.assertEqual(role("q1", 2024, 1), (0.0, 0.0))          # nothing before week 1
        self.assertEqual(role("q1", 2024, 2), (1.0, 0.0))
        self.assertEqual(role("r1", 2024, 2), (0.0, 0.5))          # week-2 usage not visible in week 2
        self.assertEqual(role("q2", 2024, 2), (0.0, 0.0))
        rates = {"Out": 1.0, "Doubtful": 0.9, "Questionable": 0.4}
        rep = {(2024, 2, "KC"): [("q1", "Out"), ("r1", "Questionable")]}
        self.assertEqual(INJ.team_loss(rep, role, rates, 2024, 2, "KC"), (1.0, 0.2))
        self.assertEqual(INJ.team_loss(rep, role, rates, 2024, 2, "BUF"), (0.0, 0.0))

    def test_fit_recovers_coefficients(self):
        from football import injuries as INJ
        rows = [(-(3 * q + 6 * k), q, k) for q, k in ((1, 0), (0, 1), (0.5, 0.2), (-1, 0.3), (0.2, -0.7))]
        bq, bk = INJ.fit_coefs(rows)
        self.assertAlmostEqual(bq, 3, places=6); self.assertAlmostEqual(bk, 6, places=6)


if __name__ == "__main__":
    unittest.main()


class QuarterEval(unittest.TestCase):
    def test_quarter_points_from_cumulative_pbp_scores_excluding_ot(self):
        import gzip, tempfile
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts", "football"))
        import quarter_eval as QE
        d = tempfile.mkdtemp(); p = os.path.join(d, "pbp.csv.gz")
        rows = [("g1", 1, 7, 0), ("g1", 1, 7, 3), ("g1", 2, 14, 3), ("g1", 3, 14, 3), ("g1", 4, 17, 10), ("g1", 5, 23, 10), ("g2", 1, 0, 0)]
        with gzip.open(p, "wt") as f:
            f.write("game_id,qtr,total_home_score,total_away_score\n")
            for g, q, h, a in rows:
                f.write(f"{g},{q},{h},{a}\n")
        act = QE.actual_quarters([p], {"g1", "g2"})
        self.assertEqual(act, {"g1": {"home": [7, 7, 0, 3], "away": [3, 0, 0, 7]}})   # OT (qtr 5) excluded; g2 incomplete dropped
        res = QE.evaluate([{"id": "g1", "simQ": {"home": [8, 7, 0, 3], "away": [3, 0, 0, 7]}}], act)
        self.assertEqual(res["Q1"]["biasTotal"], 1.0); self.assertEqual(res["Q2"]["maeTotal"], 0.0)
