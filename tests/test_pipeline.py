"""End-to-end test of the prediction log with fake providers (no network, no keys).
Run 1: games scheduled -> predictions logged pre-tip-off; only the featured one is public, others sealed (P6).
Run 2: games final -> graded; logged picks unchanged; nothing removed; sealed entries revealed with their nonce.
Also: already-started games are never newly logged; market spread stored at post time (derived fields only);
Winner + ATS (vs MARKET spread); push/postponed recorded but not counted; grades immutable;
no schedule key -> nothing fetched or written; a source that refuses us stops the run."""
import importlib.util, json, os, sys, tempfile, unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
spec = importlib.util.spec_from_file_location("ud", os.path.join(HERE, "..", "scripts", "update_data.py"))
ud = importlib.util.module_from_spec(spec); spec.loader.exec_module(ud)
P = ud.P
ABBRS = sorted(P.TEAMS)


def gm(gid, when, home, away, state, hs=None, as_=None):
    side = lambda ab, sc: {"abbr": ab, "name": P.TEAMS[ab][0], "short": P.TEAMS[ab][1], "score": sc}
    return {"id": gid, "date": when.strftime("%Y-%m-%dT%H:%MZ"), "seasonYear": 2027, "seasonType": 2,
            "state": "post" if state == "postponed" else state, "final": state == "post", "status": state,
            "statusName": "STATUS_POSTPONED" if state == "postponed" else "STATUS_" + state.upper(), "neutral": False,
            "home": side(home, hs), "away": side(away, as_)}


class FakeSched(P.ScheduleProvider):
    name = "fake"
    def __init__(self, now, state): self.now, self.state = now, state
    def season_of(self, now): return {"year": 2027, "label": "2026-27"}
    def season_games(self, y):
        return [gm(f"p{i}", self.now - timedelta(days=300), ABBRS[i], ABBRS[i + 1], "post", 110 + i, 100) for i in range(0, 30, 2)]
    def games_between(self, s, e):
        now, fin, tip = self.now, self.state["final"], self.now + timedelta(hours=6)
        return [gm("g0", now - timedelta(days=1), "BOS", "NYK", "post", 101, 99),
                gm("g1", tip, "LAL", "GSW", "post" if fin else "pre", *((120, 100) if fin else (None, None))),
                gm("g2", now - timedelta(minutes=30), "MIA", "ORL", "in", 50, 48),
                gm("g3", tip, "DEN", "PHX", "postponed" if fin else "pre"),
                gm("g4", tip, "CHI", "DET", "post" if fin else "pre", *((100, 97) if fin else (None, None)))]


class FakeOdds(P.OddsProvider):
    name = "fake-odds"
    def __init__(self, tip, state): self.tip, self.state = tip, state
    def spreads(self, now):
        if self.state["final"]:
            return {}
        d = self.tip.strftime("%Y-%m-%d")
        mk = lambda line: {"homeLine": line, "source": "fixture, median of 3 books", "bookCount": 3, "recordedAt": now.isoformat()}
        return {("LAL", "GSW", d): mk(-10.0), ("CHI", "DET", d): mk(-3.0), ("DEN", "PHX", d): mk(-1.0)}


class T(unittest.TestCase):
    def test_log_then_grade(self):
        now = datetime.now(timezone.utc); tip = now + timedelta(hours=6)
        state = {"final": False}
        with tempfile.TemporaryDirectory() as root:
            ud.ROOT = root; ud.DATA = os.path.join(root, "public", "data"); ud.PRIVATE = os.path.join(root, "private")
            ud.get_schedule = lambda: FakeSched(now, state); ud.get_odds = lambda: FakeOdds(tip, state)
            ud.main()
            pub = json.load(open(os.path.join(ud.DATA, "predictions.json")))
            pubg = json.load(open(os.path.join(ud.DATA, "games.json")))["games"]
            feat = ud.featured_ids(list(pubg.values()))
            self.assertNotIn("g4", feat)  # same tip as g1, larger id -> never featured
            for gid in ("g1", "g3", "g4"):
                if gid in feat:
                    self.assertIn(gid, pub["entries"]); self.assertIn("prediction", pubg[gid])
                else:
                    self.assertIn(gid, pub["sealed"]); self.assertNotIn(gid, pub["entries"])
                    self.assertNotIn("pick", pub["sealed"][gid]); self.assertNotIn("prediction", pubg[gid])
            # memo 20: no per-book data anywhere public
            raw = open(os.path.join(ud.DATA, "predictions.json")).read() + open(os.path.join(ud.DATA, "games.json")).read()
            self.assertNotIn('"books"', raw); self.assertNotIn("bookmakers", raw)
            log = json.load(open(os.path.join(ud.PRIVATE, "predictions-full.json")))
            self.assertEqual(log["entries"]["g4"]["commitment"], ud.commitment(log["entries"]["g4"]))
            self.assertIn("g1", log["entries"]); self.assertNotIn("g2", log["entries"]); self.assertNotIn("g0", log["entries"])
            e1 = dict(log["entries"]["g1"]); self.assertIsNone(e1["result"])
            self.assertLess(datetime.fromisoformat(e1["loggedAt"]), tip)
            state["final"] = True
            ud.main()
            log2 = json.load(open(os.path.join(ud.PRIVATE, "predictions-full.json")))
            pub2 = json.load(open(os.path.join(ud.DATA, "predictions.json")))
            self.assertIn("g4", pub2["entries"]); self.assertEqual(pub2["entries"]["g4"]["nonce"], log2["entries"]["g4"]["nonce"])
            e2 = log2["entries"]["g1"]
            for k in ("pick", "pickProb", "spread", "total", "loggedAt", "homeMargin"):
                self.assertEqual(e1[k], e2[k], k)
            r = e2["result"]
            self.assertEqual(r["winner"], "LAL"); self.assertIn(r["winnerGrade"], ("W", "L"))
            self.assertEqual(e2["marketSpread"]["homeLine"], -10.0); self.assertEqual(e2["marketSpread"]["bookCount"], 3)
            self.assertIsNotNone(e2["atsLean"])
            self.assertEqual(r["atsGrade"], "W" if e2["atsLean"] == "home" else "L")  # LAL +20 vs -10
            self.assertEqual(log2["entries"]["g4"]["result"]["atsGrade"], "P")         # CHI +3 vs -3
            self.assertEqual(log2["entries"]["g3"]["result"]["status"], "postponed")
            self.assertIsNone(log2["entries"]["g3"]["result"]["winnerGrade"])
            ud.main()  # immutability
            log3 = json.load(open(os.path.join(ud.PRIVATE, "predictions-full.json")))
            for k in log2["entries"]:
                self.assertEqual(log2["entries"][k]["result"], log3["entries"][k]["result"])

    def test_no_key_writes_nothing(self):
        with tempfile.TemporaryDirectory() as root:
            ud.DATA = os.path.join(root, "d"); ud.PRIVATE = os.path.join(root, "p")
            ud.get_schedule = lambda: P.BallDontLieFree(key="")
            ud.main()
            self.assertFalse(os.path.exists(ud.DATA)); self.assertFalse(os.path.exists(ud.PRIVATE))
            self.assertEqual(type(P.odds_provider()).__name__, "OddsProvider") if not os.environ.get("ODDS_API_KEY") else None

    def test_blocked_source_stops(self):
        import urllib.error, urllib.request
        orig = urllib.request.urlopen
        def refuse(*a, **k): raise urllib.error.HTTPError("u", 403, "Forbidden", {}, None)
        urllib.request.urlopen = refuse
        try:
            with self.assertRaises(P.SourceBlocked):
                P.BallDontLieFree(key="placeholder", sleep=lambda s: None).games_between("2026-10-25", "2026-10-26")
        finally:
            urllib.request.urlopen = orig

    def test_bdl_normalize(self):
        g = P.BallDontLieFree.normalize({"id": 7, "date": "2026-10-27", "datetime": "2026-10-27T23:30:00.000Z", "season": 2026,
            "status": "7:30 pm ET", "status_state": "scheduled", "postseason": False, "postponed": False,
            "home_team_score": 0, "visitor_team_score": 0, "ist_stage": None,
            "home_team": {"abbreviation": "BOS"}, "visitor_team": {"abbreviation": "LAL"}})
        self.assertEqual((g["id"], g["date"], g["seasonYear"], g["state"], g["home"]["score"], g["away"]["short"]),
                         ("bdl-7", "2026-10-27T23:30Z", 2027, "pre", None, "Lakers"))


if __name__ == "__main__":
    unittest.main()


class DryRun(unittest.TestCase):
    """Dry-run mode: synthetic fixtures, no keys, explicit non-repo dirs; game pages get real-shaped data."""
    def _run(self, env, argv=("update_data.py", "--dry-run")):
        old = {k: os.environ.get(k) for k in env}
        os.environ.update({k: v for k, v in env.items() if v is not None})
        for k, v in env.items():
            if v is None: os.environ.pop(k, None)
        try:
            ud.DATA = os.environ.get("PUBLIC_DATA_DIR") or os.path.join(ud.ROOT, "public", "data")
            ud.PRIVATE = os.environ.get("PREDICTIONS_PRIVATE_DIR") or os.path.join(ud.ROOT, "private-data")
            ud.get_schedule = P.schedule_provider; ud.get_odds = P.odds_provider
            return ud.main(list(argv))
        finally:
            for k, v in old.items():
                if v is None: os.environ.pop(k, None)
                else: os.environ[k] = v

    def test_dry_run_writes_fixture_data(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as out:
            ud.ROOT = root
            pub, priv = os.path.join(out, "pub"), os.path.join(out, "priv")
            self._run({"PUBLIC_DATA_DIR": pub, "PREDICTIONS_PRIVATE_DIR": priv, "BALLDONTLIE_API_KEY": None, "ODDS_API_KEY": None, "APP_ENV": "preview"})
            games = json.load(open(os.path.join(pub, "games.json")))
            self.assertEqual(games["provider"], "fixture"); self.assertTrue(games["dryRun"])
            self.assertGreaterEqual(len(games["games"]), 20)
            with_pred = [g for g in games["games"].values() if "prediction" in g]
            full = json.load(open(os.path.join(priv, "games-full.json")))["games"]
            self.assertGreater(sum("prediction" in g for g in full.values()), len(with_pred))  # members get more than public
            self.assertTrue(all(e["loggedBy"] == "dry-run" for e in json.load(open(os.path.join(priv, "predictions-full.json")))["entries"].values()))
            self.assertFalse(os.path.exists(os.path.join(root, "stats.json")))  # nothing written into the repo root

    def test_dry_run_refusals(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as out:
            ud.ROOT = root
            pub, priv = os.path.join(out, "pub"), os.path.join(out, "priv")
            for env, msg in [({"APP_ENV": "production", "PUBLIC_DATA_DIR": pub, "PREDICTIONS_PRIVATE_DIR": priv}, "production"),
                             ({"APP_ENV": "preview", "PUBLIC_DATA_DIR": None, "PREDICTIONS_PRIVATE_DIR": None}, "explicit"),
                             ({"APP_ENV": "preview", "PUBLIC_DATA_DIR": os.path.join(root, "public", "data"), "PREDICTIONS_PRIVATE_DIR": priv}, "outside the repo")]:
                with self.assertRaisesRegex(RuntimeError, msg):
                    self._run(env)
            os.makedirs(priv)
            json.dump({"modelVersion": "pd-v1", "entries": {"bdl-1": {}}}, open(os.path.join(priv, "predictions-full.json"), "w"))
            with self.assertRaisesRegex(RuntimeError, "real prediction log"):
                self._run({"APP_ENV": "preview", "PUBLIC_DATA_DIR": pub, "PREDICTIONS_PRIVATE_DIR": priv})
