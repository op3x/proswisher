"""End-to-end test of the prediction log with a fake scoreboard (no network).
Run 1: game is scheduled -> prediction logged with a pre-tip-off timestamp.
Run 2: same game is final -> graded; the logged pick is unchanged; nothing is removed.
Also: a game that has already started is never newly logged; the market spread is stored at post time;
Winner + ATS (vs MARKET spread) grades; push and postponed are recorded but not counted; grades are immutable."""
import importlib.util, json, os, sys, tempfile, unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ud", os.path.join(HERE, "..", "scripts", "update_data.py"))
ud = importlib.util.module_from_spec(spec); spec.loader.exec_module(ud)

ABBRS = sorted(ud.TEAMS)
def ev(gid, when, home, away, state, hs=None, as_=None, stype=2):
    comp = lambda ab, ha, sc: {"homeAway": ha, "team": {"abbreviation": ab, "displayName": ab + " Team", "shortDisplayName": ab}, "score": "" if sc is None else str(sc)}
    return {"id": gid, "date": when.strftime("%Y-%m-%dT%H:%MZ"), "season": {"year": 2027, "type": stype},
            "status": {"type": {"state": "post" if state == "postponed" else state, "completed": state == "post", "shortDetail": state,
                                "name": "STATUS_POSTPONED" if state == "postponed" else "STATUS_" + state.upper()}},
            "competitions": [{"neutralSite": False, "competitors": [comp(home, "home", hs), comp(away, "away", as_)]}]}

class T(unittest.TestCase):
    def test_log_then_grade(self):
        now = datetime.now(timezone.utc)
        today = now.strftime("%Y%m%d"); yday = (now - timedelta(days=1)).strftime("%Y%m%d")
        tip = now + timedelta(hours=6)
        state = {"final": False}
        def fake_fetch(day):
            if day.endswith("0115"):  # prior season: every team plays once
                evs = [ev(f"p{i}", now, ABBRS[i], ABBRS[i + 1], "post", 110 + i, 100) for i in range(0, 30, 2)]
                return {"leagues": [{"season": {"year": 2026}, "calendar": ["2026-01-15T07:00Z"]}], "events": evs}
            if day == "20260115":
                return fake_fetch("x0115")
            evs = []
            if day == yday:
                evs.append(ev("g0", now - timedelta(days=1), "BOS", "NY", "post", 101, 99))
            if day == today:
                evs.append(ev("g1", tip, "LAL", "GS", "post" if state["final"] else "pre", *( (120, 100) if state["final"] else (None, None))))
                evs.append(ev("g2", now - timedelta(minutes=30), "MIA", "ORL", "in", 50, 48))  # already started
                evs.append(ev("g3", tip, "DEN", "PHX", "postponed" if state["final"] else "pre"))
                evs.append(ev("g4", tip, "CHI", "DET", "post" if state["final"] else "pre", *((100, 97) if state["final"] else (None, None))))
            return {"leagues": [{"season": {"year": 2027, "displayName": "2026-27"}, "calendar": [f"{yday[:4]}-{yday[4:6]}-{yday[6:]}T07:00Z", f"{today[:4]}-{today[4:6]}-{today[6:]}T07:00Z"]}], "events": evs}
        with tempfile.TemporaryDirectory() as root:
            # market: LAL -10 (home favored by 10); CHI -3. g3 has a line too.
            mk = lambda line: {"homeLine": line, "source": "fixture", "books": ["x"], "recordedAt": datetime.now(timezone.utc).isoformat()}
            d = tip.strftime("%Y-%m-%d")
            ud.fetch_market_spreads = lambda now_: {} if state["final"] else {
                ("LAL Team", "GS Team", d): mk(-10.0), ("CHI Team", "DET Team", d): mk(-3.0), ("DEN Team", "PHX Team", d): mk(-1.0)}
            ud.ROOT = root; ud.DATA = os.path.join(root, "public", "data"); ud.fetch = fake_fetch; ud.time.sleep = lambda s: None
            ud.main()
            log = json.load(open(os.path.join(ud.DATA, "predictions.json")))
            self.assertIn("g1", log["entries"]); self.assertNotIn("g2", log["entries"]); self.assertNotIn("g0", log["entries"])
            e1 = dict(log["entries"]["g1"]); self.assertIsNone(e1["result"])
            self.assertLess(datetime.fromisoformat(e1["loggedAt"]), tip)
            state["final"] = True
            ud.main()
            log2 = json.load(open(os.path.join(ud.DATA, "predictions.json")))
            e2 = log2["entries"]["g1"]
            for k in ("pick", "pickProb", "spread", "total", "loggedAt", "homeMargin"):
                self.assertEqual(e1[k], e2[k], k)
            r = e2["result"]
            self.assertEqual(r["winner"], "LAL"); self.assertIn(r["winnerGrade"], ("W", "L"))
            self.assertEqual(e2["marketSpread"]["homeLine"], -10.0)
            self.assertIsNotNone(e2["atsLean"])
            # LAL won by 20 vs market -10: home covered by 10
            self.assertEqual(r["atsGrade"], "W" if e2["atsLean"] == "home" else "L")
            self.assertNotIn("favCovered", r)  # never graded vs our own line
            # CHI won by 3 vs -3 market: push
            self.assertEqual(log2["entries"]["g4"]["result"]["atsGrade"], "P")
            self.assertEqual(log2["entries"]["g3"]["result"]["status"], "postponed")
            self.assertIsNone(log2["entries"]["g3"]["result"]["winnerGrade"])
            # immutability: a third run changes no grades
            ud.main()
            log3 = json.load(open(os.path.join(ud.DATA, "predictions.json")))
            for k in log2["entries"]:
                self.assertEqual(log2["entries"][k]["result"], log3["entries"][k]["result"])


if __name__ == "__main__":
    unittest.main()
