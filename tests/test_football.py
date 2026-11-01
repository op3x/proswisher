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


PCOLS = ["qb_dropback", "pass_attempt", "rush_attempt", "passer_player_id", "passer_player_name", "rusher_player_id",
         "rusher_player_name", "receiver_player_id", "receiver_player_name"]
# planted player-level strings: none of these may ever reach a public file, the private dir, a log or an API response
PLANTED = {"qb": "00-0099999", "qb_name": "Zzyzx Testplayer", "wr": "00-0088888", "wr_name": "Qwerty Receiverman",
           "rb": "00-0077777", "rb_name": "Plughk Runningback", "body": "Hamstring-Zq"}


def synth_pbp(path, season=2025, weeks=4):
    """Tiny nflverse-shaped pbp: KC's offense is clearly the best (+0.3 EPA/play). Player columns carry planted ids/names."""
    with gzip.open(path, "wt", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(X.COLS + PCOLS + ["extra_col"])
        for wk in range(1, weeks + 1):
            pairs = [("KC", "LV"), ("BUF", "MIA")] if wk % 2 else [("KC", "BUF"), ("LV", "MIA")]
            for h, a in pairs:
                gid = f"{season}_{wk:02d}_{a}_{h}"
                for off, de in ((h, a), (a, h)):
                    kc = off == "KC"
                    qb, wr, rb = ((PLANTED["qb"], PLANTED["qb_name"]), (PLANTED["wr"], PLANTED["wr_name"]), (PLANTED["rb"], PLANTED["rb_name"])) if kc \
                        else ((f"00-001{off}", "Other Qb"), (f"00-002{off}", "Other Wr"), (f"00-003{off}", "Other Rb"))
                    for i in range(60):
                        row = {c: "NA" for c in X.COLS}
                        row.update(game_id=gid, season=season, week=wk, season_type="REG", home_team=h, away_team=a, posteam=off, defteam=de,
                                   qtr=1 + i // 15, down=1, ydstogo=10, yardline_100=60, play_type="pass" if i % 2 else "run",
                                   epa=0.3 if kc else -0.05, wp=0.5, two_point_attempt=0, yards_gained=5)
                        pc = ["1", "1", "0", qb[0], qb[1], "NA", "NA", wr[0], wr[1]] if i % 2 else ["0", "0", "1", "NA", "NA", rb[0], rb[1], "NA", "NA"]
                        w.writerow([row[c] for c in X.COLS] + pc + ["x"])
                    w.writerow([gid if c == "game_id" else ("" if c == "play_type" else "NA") for c in X.COLS] + ["NA"] * len(PCOLS) + ["x"])  # END QUARTER row


def synth_injuries(path, season=2025, week=7):
    """nflverse-shaped injury report: KC's QB is Out in `week` (all the columns Larry's I1 keeps out of the API)."""
    hdr = ["season", "season_type", "game_type", "team", "week", "gsis_id", "position", "full_name", "first_name", "last_name",
           "report_primary_injury", "report_secondary_injury", "report_status", "practice_primary_injury", "practice_secondary_injury", "practice_status"]
    with gzip.open(path, "wt", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(hdr)
        w.writerow([season, "REG", "REG", "KC", week, PLANTED["qb"], "QB", PLANTED["qb_name"], "Zzyzx", "Testplayer", PLANTED["body"], "", "Out",
                    PLANTED["body"], "", "Did Not Participate In Practice"])


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
    def injuries_file(self, season, dest):
        if not os.environ.get("FOOTBALL_INJURIES_ENABLED"): raise RuntimeError("injuries are off")
        p = os.path.join(self.d, f"injuries_{season}.csv.gz")
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

    def test_college_and_ticker_do_not_use_injuries(self):
        # Larry: NFL only. College availability is not cleared; the ticker never touches it.
        import inspect
        for fn in (RF.refresh_ncaaf, RF.ncaaf_play_fit, RF.ncaaf_fitted_params):
            src = inspect.getsource(fn).lower()
            self.assertNotIn("injur", src); self.assertNotIn("inj.", src); self.assertNotIn("availability", src)
        root = os.path.join(os.path.dirname(__file__), "..")
        self.assertNotIn("injur", open(os.path.join(root, "server/football/ticker.mjs"), encoding="utf-8").read().lower())

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


class InjuriesWired(unittest.TestCase):
    """Larry's must-haves for NFL injuries: (a) no player id/name in logs or error text, (c) nothing player-level stored."""
    def setUp(self):
        self.d = tempfile.mkdtemp(); synth_pbp(os.path.join(self.d, "play_by_play_2025.csv.gz"), weeks=6)
        synth_injuries(os.path.join(self.d, "injuries_2025.csv.gz"))
        self.pub, self.priv = os.path.join(self.d, "pub"), os.path.join(self.d, "priv")
        os.makedirs(os.path.join(self.pub, "nfl"))
        with open(os.path.join(HERE, "fixtures", "football", "nfl-params.json")) as f: p = json.load(f)
        p["fittedAt"] = "2999-01-01T00:00:00Z"
        with open(os.path.join(self.pub, "nfl", "params.json"), "w") as f: json.dump(p, f)
        self.now = datetime(2025, 10, 9, 12, tzinfo=timezone.utc)

    def run_refresh(self, flag, prov=None):
        import contextlib
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, {"FOOTBALL_INJURIES_ENABLED": flag}), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            res = RF.refresh_nfl(self.pub, self.priv, RF.Blocks(os.path.join(self.priv, "blocked.json")), self.now, prov=prov or FakeNfl(self.d))
        return res, out.getvalue() + err.getvalue(), json.load(open(os.path.join(self.pub, "nfl", "schedule.json")))

    def assert_no_player_strings(self, text, where):
        for k, v in PLANTED.items():
            self.assertNotIn(v, text, f"{k} leaked into {where}")
        for k in ("Zzyzx", "Testplayer", "gsis", "full_name", "report_status", "practice_status", "Did Not Participate", '"Out"', "Questionable", "Doubtful"):
            self.assertNotIn(k, text, f"{k} leaked into {where}")

    def stored_text(self):
        blob = []
        for root in (self.pub, self.priv):
            for dp, _, fs in os.walk(root):
                for f in fs:
                    p = os.path.join(dp, f)
                    raw = open(p, "rb").read()
                    if p.endswith(".gz"): raw = gzip.decompress(raw)
                    blob.append(raw.decode("utf-8", "replace"))
        return "\n".join(blob)

    def test_flag_on_adjusts_kc_and_stores_nothing_player_level(self):
        tmps = []
        real = tempfile.mkdtemp
        def spy(*a, **k):
            p = real(*a, **k); tmps.append(p); return p
        _, _, off = self.run_refresh("")
        with mock.patch.object(RF.tempfile, "mkdtemp", side_effect=spy):
            res, logs, on = self.run_refresh("true")
        self.assertEqual(res["availability"], "on"); self.assertTrue(res["injuriesModeled"]); self.assertTrue(on["injuriesModeled"]); self.assertFalse(off["injuriesModeled"])
        g_off = {g["id"]: g for g in off["games"] if g["status"] == "scheduled"}
        kc = [g for g in on["games"] if g["status"] == "scheduled" and "KC" in (g["home"], g["away"])][0]
        side = "home" if kc["home"] == "KC" else "away"
        self.assertLess(kc["availabilityAdj"][side], -2.0)                          # starting QB out costs points
        mg = lambda g: (g["expected"]["home"] - g["expected"]["away"]) * (1 if side == "home" else -1)
        self.assertLess(mg(kc), mg(g_off[kc["id"]]) - 2.0)
        other = [g for g in on["games"] if g["status"] == "scheduled" and "KC" not in (g["home"], g["away"])][0]
        self.assertNotIn("availabilityAdj", other); self.assertEqual(other["expected"], g_off[other["id"]]["expected"])
        # (c) temporary download dir removed; nothing player-level in public or private files; (a) nor in the logs
        self.assertTrue(tmps); self.assertFalse(any(os.path.exists(p) for p in tmps))
        self.assert_no_player_strings(self.stored_text(), "stored files")
        self.assert_no_player_strings(logs, "logs")
        av = json.load(open(os.path.join(self.priv, "nfl_availability.json")))
        self.assertEqual(set(av["pointsByWeekTeam"]["7"]), {"KC"})
        # flag off again: adjustment and private file go away
        _, _, off2 = self.run_refresh("")
        self.assertFalse(off2["injuriesModeled"]); self.assertFalse(any("availabilityAdj" in g for g in off2["games"]))
        self.assertFalse(os.path.exists(os.path.join(self.priv, "nfl_availability.json")))

    def test_errors_never_carry_player_text(self):
        from football import injuries as INJ
        boom = KeyError(f"{PLANTED['qb']} {PLANTED['qb_name']} Questionable")
        with mock.patch.object(INJ, "pbp_usage", side_effect=boom):
            res, logs, sched = self.run_refresh("true")
        self.assertTrue(res["ok"]); self.assertEqual(res["availability"], "failed"); self.assertFalse(sched["injuriesModeled"])
        self.assertIn("KeyError", logs); self.assert_no_player_strings(logs, "error log")
        self.assert_no_player_strings(json.dumps(res), "status")
        self.assertNotIn("Traceback", logs)

    def test_league_failure_text_is_scrubbed(self):
        # anything else that fails in the NFL refresh: traceback and status.json error mask player ids
        with mock.patch.object(RF, "refresh_nfl", side_effect=ValueError(f"bad row {PLANTED['qb']}")), \
             mock.patch.object(RF, "refresh_ncaaf", return_value={"ok": False}), \
             mock.patch.dict(os.environ, {"PUBLIC_DATA_DIR": self.pub, "PREDICTIONS_PRIVATE_DIR": self.priv}):
            import contextlib
            err = io.StringIO()
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                RF.main(["--league", "nfl"])
        st = open(os.path.join(self.pub, "football", "status.json")).read()
        self.assertNotIn(PLANTED["qb"], err.getvalue()); self.assertNotIn(PLANTED["qb"], st); self.assertIn("[id]", st)

    def test_blocked_injuries_source_is_stopped_without_touching_pbp(self):
        class Refusing(FakeNfl):
            def injuries_file(s, season, dest): raise SRC.SourceBlocked("nflverse injuries 2025: HTTP 403 (refused)")
        res, logs, sched = self.run_refresh("true", Refusing(self.d))
        self.assertTrue(res["ok"]); self.assertEqual(res["availability"], "blocked")
        b = RF.Blocks(os.path.join(self.priv, "blocked.json"))
        self.assertIn(RF.INJ_SRC, b.d); self.assertNotIn("nflverse", b.d)
        calls = []
        class Spy(FakeNfl):
            def injuries_file(s, season, dest): calls.append(1); return super().injuries_file(season, dest)
        res2, _, _ = self.run_refresh("true", Spy(self.d))
        self.assertEqual(res2["availability"], "blocked"); self.assertEqual(calls, [])

    def test_flag_off_never_fetches(self):
        calls = []
        class Spy(FakeNfl):
            def injuries_file(s, season, dest): calls.append(1); return super().injuries_file(season, dest)
        res, _, sched = self.run_refresh("", Spy(self.d))
        self.assertEqual(res["availability"], "off"); self.assertEqual(calls, []); self.assertFalse(sched["injuriesModeled"])

    def test_raw_pbp_with_player_columns_is_not_kept_after_compaction(self):
        import shutil
        class Downloading(FakeNfl):
            def pbp_file(s, season, dest):
                p, _ = super().pbp_file(season, dest); os.makedirs(dest, exist_ok=True)
                q = os.path.join(dest, os.path.basename(p)); shutil.copy(p, q)
                open(q + ".etag", "w").write('"e1"'); return q, True
        res, _, _ = self.run_refresh("", Downloading(self.d))
        self.assertTrue(res["ok"])
        raw = os.path.join(self.priv, "raw", "nflverse")
        self.assertFalse(os.path.exists(os.path.join(raw, "play_by_play_2025.csv.gz")))       # current season too
        self.assertTrue(os.path.exists(os.path.join(raw, "play_by_play_2025.csv.gz.etag")))   # ETag kept for a conditional GET
        self.assert_no_player_strings(self.stored_text(), "stored files")

    def test_nflverse_pbp_conditional_get_with_etag_only(self):
        d = tempfile.mkdtemp(); open(os.path.join(d, "play_by_play_2025.csv.gz.etag"), "w").write('"e1"')
        seen = {}
        def fake_open(url, headers, what, **k):
            seen.update(headers); raise urllib.error.HTTPError(url, 304, "nm", {}, None)
        with mock.patch.object(SRC, "_open", side_effect=fake_open):
            p, changed = SRC.Nflverse().pbp_file(2025, d)
        self.assertEqual(seen.get("If-None-Match"), '"e1"'); self.assertFalse(changed)


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


class TotalsModel(unittest.TestCase):
    """Ryan 10/31: better over/under totals. football/totals.py: walk-forward least squares, no look-ahead."""
    def smp(self, n=120, season=2025, coef=(10.0, 30.0, 0.6, 2.5)):
        out = []
        for i in range(n):
            x = [1.0, (i % 7 - 3) / 10, 40 + (i % 11), float(i % 3 == 0)]
            out.append((x, sum(c * v for c, v in zip(coef, x)), season - 1 - i % 3, 1 + i % 18))
        return out

    def test_fit_recovers_coefficients_and_needs_samples(self):
        from football import totals as TOT
        m = TOT.fit("nfl", self.smp(), 2025, 1)
        for got, want in zip(m["coef"], (10.0, 30.0, 0.6, 2.5)):
            self.assertAlmostEqual(got, want, places=3)
        self.assertEqual(m["features"], ["const", "x_epa", "x_pts", "indoor"])
        self.assertIsNone(TOT.fit("nfl", self.smp(n=30), 2025, 1))

    def test_fit_ignores_current_and_future_weeks_and_old_seasons(self):
        from football import totals as TOT
        base = TOT.fit("nfl", self.smp(), 2025, 6)
        junk = [([1.0, 0.1, 45.0, 0.0], 500.0, 2025, w) for w in (6, 7, 12)] + [([1.0, 0.1, 45.0, 0.0], 500.0, 2026, 1),
                                                                                 ([1.0, 0.1, 45.0, 0.0], 500.0, 2021, 3)]
        self.assertEqual(TOT.fit("nfl", self.smp() + junk, 2025, 6)["coef"], base["coef"])
        prior = [([1.0, 0.1, 45.0, 0.0], 500.0, 2025, 5)]                 # an earlier week of the same season is used
        self.assertNotEqual(TOT.fit("nfl", self.smp() + prior, 2025, 6)["coef"], base["coef"])

    def test_features_are_as_of_and_indoor(self):
        from football import totals as TOT
        self.assertEqual([TOT.is_indoor(x) for x in ("dome", "closed", "open", "outdoors", None)], [1, 1, 0, 0, 0])
        games = []
        for wk in range(1, 7):
            for h, a in (("KC", "LV"), ("BUF", "MIA")) if wk % 2 else (("KC", "BUF"), ("LV", "MIA")):
                games.append({"season": 2025, "week": wk, "home": h, "away": a, "homeScore": 24, "awayScore": 20, "indoor": 0})
        epa = [[g["season"], g["week"], g["home"], g["away"], 60, 3.0] for g in games]
        f1 = TOT.samples("nfl", TOT.Fits("nfl", epa, TOT.points_obs(games), dict(R.DEFAULTS)), games)
        games[-1]["homeScore"] = 70                                       # the game's own (and later) scores never leak in
        f2 = TOT.samples("nfl", TOT.Fits("nfl", epa, TOT.points_obs(games), dict(R.DEFAULTS)), games)
        self.assertEqual(f1[-1][0], f2[-1][0]); self.assertEqual(f2[-1][1], 90)
        self.assertEqual(len(f1[0][0]), 4)
        self.assertEqual(f1[0][0][2], 0.0)                               # week 1: no prior games, points term is 2m = 0

    def test_refresh_uses_totals_model_and_keeps_margin(self):
        from football import totals as TOT
        d = tempfile.mkdtemp(); synth_pbp(os.path.join(d, "play_by_play_2025.csv.gz"), weeks=6)
        def run(sub, patch):
            pub, priv = os.path.join(d, sub, "pub"), os.path.join(d, sub, "priv"); os.makedirs(os.path.join(pub, "nfl"))
            with open(os.path.join(HERE, "fixtures", "football", "nfl-params.json")) as f: p = json.load(f)
            p["fittedAt"] = "2999-01-01T00:00:00Z"
            with open(os.path.join(pub, "nfl", "params.json"), "w") as f: json.dump(p, f)
            now = datetime(2025, 10, 9, 12, tzinfo=timezone.utc)
            if patch:
                with mock.patch.object(TOT, "fit", return_value={"coef": [44.0, 0.0, 0.0, 3.0], "n": 99, "features": ["const", "x_epa", "x_pts", "indoor"]}):
                    RF.refresh_nfl(pub, priv, RF.Blocks(os.path.join(priv, "b.json")), now, prov=FakeNfl(d))
            else:
                RF.refresh_nfl(pub, priv, RF.Blocks(os.path.join(priv, "b.json")), now, prov=FakeNfl(d))
            s = json.load(open(os.path.join(pub, "nfl", "schedule.json")))
            return {g["id"]: g["expected"] for g in s["games"] if "expected" in g}, json.load(open(os.path.join(pub, "nfl", "ratings.json")))
        old, r0 = run("a", False); new, r1 = run("b", True)
        self.assertEqual(r0["totalModel"]["type"], "epa")               # too few games in the fixture: EPA total fallback
        self.assertEqual(r1["totalModel"]["type"], "blend")
        for k in old:
            self.assertAlmostEqual(new[k]["home"] + new[k]["away"], 44.0, places=1)       # fixture schedule has no roof: outdoor
            self.assertAlmostEqual(new[k]["home"] - new[k]["away"], old[k]["home"] - old[k]["away"], places=1)   # margin unchanged
