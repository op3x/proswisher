"""End-to-end test of the prediction log with a fake scoreboard (no network).
Run 1: game is scheduled -> prediction logged with a pre-tip-off timestamp.
Run 2: same game is final -> graded; the logged pick is unchanged; nothing is removed.
Also: a game that has already started is never newly logged."""
import importlib.util, json, os, sys, tempfile, unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ud", os.path.join(HERE, "..", "scripts", "update_data.py"))
ud = importlib.util.module_from_spec(spec); spec.loader.exec_module(ud)

ABBRS = sorted(ud.TEAMS)
def ev(gid, when, home, away, state, hs=None, as_=None, stype=2):
    comp = lambda ab, ha, sc: {"homeAway": ha, "team": {"abbreviation": ab, "displayName": ab + " Team", "shortDisplayName": ab}, "score": "" if sc is None else str(sc)}
    return {"id": gid, "date": when.strftime("%Y-%m-%dT%H:%MZ"), "season": {"year": 2027, "type": stype},
            "status": {"type": {"state": state, "completed": state == "post", "shortDetail": state}},
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
            return {"leagues": [{"season": {"year": 2027, "displayName": "2026-27"}, "calendar": [f"{yday[:4]}-{yday[4:6]}-{yday[6:]}T07:00Z", f"{today[:4]}-{today[4:6]}-{today[6:]}T07:00Z"]}], "events": evs}
        with tempfile.TemporaryDirectory() as root:
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
            self.assertEqual(e2["result"]["winner"], "LAL")
            self.assertEqual(set(log["entries"]) - set(log2["entries"]), set())

if __name__ == "__main__":
    unittest.main()
