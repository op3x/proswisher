"""Data-source interfaces (Kiko 9:58; Larry memo 20).

Callers (update_data.py) only use ScheduleProvider / OddsProvider. To change vendor or tier, add another
implementation and point SCHEDULE_PROVIDER / ODDS_PROVIDER at it; nothing else changes.

Rules (memo 20):
- Keys come from env vars only (BALLDONTLIE_API_KEY, ODDS_API_KEY). Never logged, never in URLs we print.
- Free tiers only here. balldontlie Free = Games endpoint, 5 requests/min. The Odds API Starter = 500 credits/mo.
- If a source refuses us (401/403, or keeps rate-limiting after one polite back-off), STOP and report.
  Never work around a block (no IP rotation, header spoofing, alternate hosts or scraping).
- Odds: only DERIVED values leave this module (median home spread, number of books, timestamp).
  No per-book prices or book names are returned, so none can reach public /data JSON or the repo.
"""
import json, os, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

UA = {"User-Agent": "proswisher-data/2.0 (+https://proswisher.com)"}


class SourceBlocked(RuntimeError):
    """The source refused access. Stop this path and report; do not retry another way."""


class NotConfigured(RuntimeError):
    pass


# Canonical team table (our abbreviations). Full names cover both common spellings of the Clippers.
TEAMS = {
    "ATL": ("Atlanta Hawks", "Hawks"), "BOS": ("Boston Celtics", "Celtics"), "BKN": ("Brooklyn Nets", "Nets"),
    "CHA": ("Charlotte Hornets", "Hornets"), "CHI": ("Chicago Bulls", "Bulls"), "CLE": ("Cleveland Cavaliers", "Cavaliers"),
    "DAL": ("Dallas Mavericks", "Mavericks"), "DEN": ("Denver Nuggets", "Nuggets"), "DET": ("Detroit Pistons", "Pistons"),
    "GSW": ("Golden State Warriors", "Warriors"), "HOU": ("Houston Rockets", "Rockets"), "IND": ("Indiana Pacers", "Pacers"),
    "LAC": ("LA Clippers", "Clippers"), "LAL": ("Los Angeles Lakers", "Lakers"), "MEM": ("Memphis Grizzlies", "Grizzlies"),
    "MIA": ("Miami Heat", "Heat"), "MIL": ("Milwaukee Bucks", "Bucks"), "MIN": ("Minnesota Timberwolves", "Timberwolves"),
    "NOP": ("New Orleans Pelicans", "Pelicans"), "NYK": ("New York Knicks", "Knicks"), "OKC": ("Oklahoma City Thunder", "Thunder"),
    "ORL": ("Orlando Magic", "Magic"), "PHI": ("Philadelphia 76ers", "76ers"), "PHX": ("Phoenix Suns", "Suns"),
    "POR": ("Portland Trail Blazers", "Trail Blazers"), "SAC": ("Sacramento Kings", "Kings"), "SAS": ("San Antonio Spurs", "Spurs"),
    "TOR": ("Toronto Raptors", "Raptors"), "UTA": ("Utah Jazz", "Jazz"), "WAS": ("Washington Wizards", "Wizards"),
}
NAME_TO_ABBR = {v[0]: k for k, v in TEAMS.items()} | {"Los Angeles Clippers": "LAC"}


def _get(url: str, headers: dict, what: str, retries: int = 2) -> dict:
    last = None
    for i in range(retries + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **headers}), timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SourceBlocked(f"{what}: HTTP {e.code} (refused). Stopped; not retrying another way.") from None
            if e.code == 429:
                if i == 0:
                    time.sleep(65); continue  # one polite back-off, then stop
                raise SourceBlocked(f"{what}: HTTP 429 persists (rate-limited). Stopped.") from None
            last = f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = type(e).__name__
        time.sleep(3 * (i + 1))
    raise RuntimeError(f"{what}: fetch failed ({last})")


# ---------------- schedule / scores ----------------
class ScheduleProvider:
    """Normalized game dict: id, date (UTC 'YYYY-MM-DDTHH:MMZ'), seasonYear (season END year), seasonType (2 reg, 3 post),
    state pre|in|post, final, status, statusName (STATUS_FINAL/STATUS_POSTPONED/...), neutral, home/away {abbr,name,short,score}."""
    name = "base"
    def season_of(self, now: datetime) -> dict:
        start = now.year if now.month >= 9 else now.year - 1
        return {"year": start + 1, "label": f"{start}-{str(start + 1)[2:]}"}
    def games_between(self, start: str, end: str) -> list: raise NotImplementedError
    def season_games(self, season_end_year: int) -> list: raise NotImplementedError


class BallDontLieFree(ScheduleProvider):
    """balldontlie Free tier: GET /v1/games only (5 req/min). Terms §6 allow commercial display (memo 20)."""
    name = "balldontlie-free"
    BASE = "https://api.balldontlie.io/v1/games"
    MIN_INTERVAL = 13.0  # seconds between calls -> under 5/min

    def __init__(self, key: str | None = None, sleep=time.sleep):
        self.key = (key if key is not None else os.environ.get("BALLDONTLIE_API_KEY", "")).strip()
        if not self.key:
            raise NotConfigured("BALLDONTLIE_API_KEY is not set")
        self._sleep, self._last = sleep, 0.0

    def _pages(self, params: dict) -> list:
        out, cursor = [], None
        while True:
            q = dict(params, per_page=100, **({"cursor": cursor} if cursor else {}))
            wait = self.MIN_INTERVAL - (time.monotonic() - self._last)
            if self._last and wait > 0:
                self._sleep(wait)
            self._last = time.monotonic()
            body = _get(f"{self.BASE}?{urllib.parse.urlencode(q, doseq=True)}", {"Authorization": self.key}, "balldontlie games")
            out += body.get("data", [])
            cursor = (body.get("meta") or {}).get("next_cursor")
            if not cursor:
                return out

    @staticmethod
    def normalize(g: dict) -> dict | None:
        h, a = g.get("home_team") or {}, g.get("visitor_team") or {}
        if h.get("abbreviation") not in TEAMS or a.get("abbreviation") not in TEAMS:
            return None
        st = (g.get("status_state") or "").lower()
        if g.get("postponed"):
            st = "postponed"
        dt = g.get("datetime")
        if not dt and st != "final":
            return None  # tip time not set yet; picked up on a later run
        when = (dt or (g["date"] + "T00:00:00Z"))[:16] + "Z"
        state = {"scheduled": "pre", "in_progress": "in", "delayed": "in", "final": "post"}.get(st, "post" if st in ("postponed", "canceled", "suspended", "abandoned") else "pre")
        final = st == "final"
        side = lambda t, sc: {"abbr": t["abbreviation"], "name": TEAMS[t["abbreviation"]][0], "short": TEAMS[t["abbreviation"]][1],
                              "score": int(sc) if (sc is not None and state != "pre") else None}
        return {
            "id": f"bdl-{g['id']}", "date": when, "seasonYear": int(g["season"]) + 1,
            "seasonType": 3 if g.get("postseason") else 2, "state": state, "final": final,
            "status": g.get("status") or st, "statusName": "STATUS_" + (st or "unknown").upper(),
            "neutral": g.get("ist_stage") == "Championship",
            "home": side(h, g.get("home_team_score")), "away": side(a, g.get("visitor_team_score")),
        }

    def games_between(self, start: str, end: str) -> list:
        return [x for x in map(self.normalize, self._pages({"start_date": start, "end_date": end})) if x]

    def season_games(self, season_end_year: int) -> list:
        return [x for x in map(self.normalize, self._pages({"seasons[]": [season_end_year - 1]})) if x]


# ---------------- market spreads ----------------
class OddsProvider:
    name = "none"
    def spreads(self, now: datetime) -> dict:
        """{(homeAbbr, awayAbbr, 'YYYY-MM-DD' UTC): {homeLine, source, bookCount, recordedAt}} - derived fields ONLY."""
        return {}


class OddsApiFree(OddsProvider):
    """The Odds API Starter (free, 500 credits/mo). One call = regions(us) x markets(spreads) = 1 credit."""
    name = "the-odds-api-free"
    URL = "https://api.the-odds-api.com/v4/sports/basketball_nba/odds"

    def __init__(self, key: str | None = None):
        self.key = (key if key is not None else os.environ.get("ODDS_API_KEY", "")).strip()
        if not self.key:
            raise NotConfigured("ODDS_API_KEY is not set")

    def spreads(self, now: datetime) -> dict:
        q = urllib.parse.urlencode({"regions": "us", "markets": "spreads", "oddsFormat": "american", "dateFormat": "iso", "apiKey": self.key})
        events = _get(f"{self.URL}?{q}", {}, "the-odds-api")  # errors never include the URL (it carries the key)
        out = {}
        for ev in events:
            home, away = NAME_TO_ABBR.get(ev.get("home_team")), NAME_TO_ABBR.get(ev.get("away_team"))
            if not home or not away:
                continue
            pts = sorted(float(o["point"]) for b in ev.get("bookmakers", []) for m in b.get("markets", []) if m.get("key") == "spreads"
                         for o in m.get("outcomes", []) if o.get("name") == ev.get("home_team") and isinstance(o.get("point"), (int, float)))
            if not pts:
                continue
            n = len(pts); med = pts[n // 2] if n % 2 else (pts[n // 2 - 1] + pts[n // 2]) / 2
            out[(home, away, ev["commence_time"][:10])] = {
                "homeLine": round(med * 2) / 2, "source": f"The Odds API, median of {n} US books",
                "bookCount": n, "recordedAt": now.isoformat(timespec="seconds"),
            }
        return out


# ---------------- dry run (synthetic fixtures; no network, no keys) ----------------
# Deterministic, made-up games relative to "now" so every page has something to render. Scores and lines are
# synthetic (NOT real results or odds). Dry runs are refused in production and must write to explicit
# non-repo dirs (see update_data.py), so this data can't reach the public repo or the live site.
def _fx(seed: str, lo: int, hi: int) -> int:
    import hashlib
    return lo + int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16) % (hi - lo + 1)


def _fx_game(gid: str, when: datetime, home: str, away: str, final: bool) -> dict:
    side = lambda ab, sc: {"abbr": ab, "name": TEAMS[ab][0], "short": TEAMS[ab][1], "score": sc}
    hs, as_ = (_fx(gid + "h", 96, 128), _fx(gid + "a", 94, 126)) if final else (None, None)
    if final and hs == as_:
        hs += 1
    return {"id": gid, "date": when.strftime("%Y-%m-%dT%H:%MZ"), "seasonYear": 0, "seasonType": 2,
            "state": "post" if final else "pre", "final": final, "status": "Final" if final else "Scheduled",
            "statusName": "STATUS_FINAL" if final else "STATUS_SCHEDULED", "neutral": False,
            "home": side(home, hs), "away": side(away, as_)}


class FixtureSchedule(ScheduleProvider):
    name = "fixture"
    ABBRS = sorted(TEAMS)

    def __init__(self, now: datetime | None = None):
        self.now = now or datetime.now(timezone.utc)

    def _with_year(self, g: dict, year: int) -> dict:
        g["seasonYear"] = year
        return g

    def season_games(self, season_end_year: int) -> list:
        base = datetime(season_end_year - 1, 11, 1, 0, 0, tzinfo=timezone.utc)
        out, a = [], self.ABBRS
        for r in range(6):  # 6 rounds x 15 games: every team plays 6 times
            for i in range(15):
                h, v = a[(i + r) % 30], a[(29 - i + r) % 30]
                out.append(self._with_year(_fx_game(f"fxp-{r}-{i}", base + timedelta(days=r * 3), h, v, True), season_end_year))
        return out

    def games_between(self, start: str, end: str) -> list:
        year = self.season_of(self.now)["year"]
        out, a = [], self.ABBRS
        day0 = self.now.replace(hour=0, minute=0, second=0, microsecond=0)
        for d in range(-3, 4):  # 3 days of finals, today, 3 days ahead; 4 games a day
            for i in range(4):
                tip = day0 + timedelta(days=d, hours=23, minutes=30 * i)  # 23:00Z+ = evening US Central
                k = (d * 4 + i) % 15
                h, v = a[(2 * k + d) % 30], a[(2 * k + 1 + d) % 30]
                if h == v:
                    continue
                out.append(self._with_year(_fx_game(f"fx-{tip:%Y%m%d}-{i}", tip, h, v, tip < self.now - timedelta(hours=3)), year))
        return [g for g in out if start <= g["date"][:10] <= end]


class FixtureOdds(OddsProvider):
    name = "fixture-odds"

    def spreads(self, now: datetime) -> dict:
        out = {}
        for g in FixtureSchedule(now).games_between("0000", "9999"):
            if not g["final"]:
                out[(g["home"]["abbr"], g["away"]["abbr"], g["date"][:10])] = {
                    "homeLine": _fx(g["id"] + "l", -16, 16) / 2, "source": "fixture (synthetic, not a real line)",
                    "bookCount": 0, "recordedAt": now.isoformat(timespec="seconds")}
        return out


SCHEDULE_PROVIDERS = {"balldontlie-free": BallDontLieFree}
ODDS_PROVIDERS = {"the-odds-api-free": OddsApiFree}


def schedule_provider() -> ScheduleProvider:
    return SCHEDULE_PROVIDERS[os.environ.get("SCHEDULE_PROVIDER", "balldontlie-free")]()


def odds_provider() -> OddsProvider:
    """No key -> null provider (Winner grading only). P13 closed by memo 20: derived fields only."""
    try:
        return ODDS_PROVIDERS[os.environ.get("ODDS_PROVIDER", "the-odds-api-free")]()
    except NotConfigured:
        return OddsProvider()
