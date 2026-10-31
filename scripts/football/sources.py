"""Football data sources behind small provider interfaces (same rules as scripts/providers.py, Larry memo 20).

- NFL: nflverse release files (play-by-play, schedules incl. scores). Data licence CC-BY 4.0: attribution required,
  shown on the site. We never fetch FTN charting or participation files (CC-BY-SA).
- NCAAF: CollegeFootballData (CFBD) API, key in CFBD_API_KEY. CFBD terms: derived outputs may be sold, raw data may
  NOT be redistributed, so raw CFBD responses only ever go to the PRIVATE cache dir, never to public JSON or the repo.
  Free tier = 1,000 calls/month; a local monthly call counter (CFBD_MONTHLY_BUDGET, default 800) keeps us under it.
- No Sportradar, no Sports Reference, no ESPN.
- A 401/403, or a 429 that persists after one polite back-off, raises SourceBlocked: the caller stops THAT source,
  logs it and never routes around it (no other hosts, mirrors, header tricks or scraping).
"""
import csv, io, json, os, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

UA = {"User-Agent": "proswisher-data/3.0 (+https://proswisher.com)"}


class SourceBlocked(RuntimeError):
    """The source refused access. Stop this source and report; do not retry another way."""


class NotConfigured(RuntimeError):
    pass


def _open(url, headers, what, retries=2, timeout=60):
    last = None
    for i in range(retries + 1):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **headers}), timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SourceBlocked(f"{what}: HTTP {e.code} (refused). Stopped this source; not retrying another way.") from None
            if e.code == 429:
                if i == 0:
                    time.sleep(65); continue
                raise SourceBlocked(f"{what}: HTTP 429 persists (rate-limited). Stopped this source.") from None
            if e.code == 304:
                raise
            last = f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError) as e:
            last = type(e).__name__
        time.sleep(3 * (i + 1))
    raise RuntimeError(f"{what}: fetch failed ({last})")


# ---------------------------------------------------------------- NFL (nflverse)
class NflDataProvider:
    name = "base"
    def pbp_file(self, season: int, dest_dir: str) -> str: raise NotImplementedError
    def schedule_rows(self, dest_dir: str) -> list: raise NotImplementedError


class Nflverse(NflDataProvider):
    """nflverse-data GitHub release assets. Conditional GET (ETag) so an unchanged file is not re-downloaded."""
    name = "nflverse"
    BASE = "https://github.com/nflverse/nflverse-data/releases/download"

    def _download(self, url, dest, what):
        meta_path = dest + ".etag"
        headers = {}
        if os.path.exists(dest) and os.path.exists(meta_path):
            with open(meta_path) as f:
                headers["If-None-Match"] = f.read().strip()
        try:
            r = _open(url, headers, what, timeout=180)
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return dest, False
            raise
        with r:
            tmp = dest + ".part"
            with open(tmp, "wb") as f:
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
            os.replace(tmp, dest)
            et = r.headers.get("ETag")
        if et:
            with open(meta_path, "w") as f:
                f.write(et)
        return dest, True

    def pbp_file(self, season, dest_dir):
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, f"play_by_play_{season}.csv.gz")
        return self._download(f"{self.BASE}/pbp/play_by_play_{season}.csv.gz", dest, f"nflverse pbp {season}")

    def schedule_rows(self, dest_dir):
        os.makedirs(dest_dir, exist_ok=True)
        dest, _ = self._download(f"{self.BASE}/schedules/games.csv", os.path.join(dest_dir, "games.csv"), "nflverse schedules")
        with open(dest, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))


class LocalNflDir(NflDataProvider):
    """Dev/test only: reads already-downloaded nflverse files from NFL_LOCAL_DIR (no network)."""
    name = "local"

    def __init__(self, root=None):
        self.root = root or os.environ.get("NFL_LOCAL_DIR", "")

    def pbp_file(self, season, dest_dir):
        p = os.path.join(self.root, f"play_by_play_{season}.csv.gz")
        if not os.path.exists(p):
            raise RuntimeError(f"local pbp {season}: HTTP 404 (not in {self.root})")
        return p, True

    def schedule_rows(self, dest_dir):
        with open(os.path.join(self.root, "games.csv"), newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))


# ---------------------------------------------------------------- NCAAF (CFBD)
class CfbdProvider:
    """CollegeFootballData REST v2. Every response is raw CFBD data: keep it in the private dir only."""
    name = "cfbd"
    BASE = "https://api.collegefootballdata.com"

    def __init__(self, key=None, budget_file=None, monthly_budget=None):
        self.key = key if key is not None else os.environ.get("CFBD_API_KEY", "")
        if not self.key:
            raise NotConfigured("CFBD_API_KEY is not set")
        self.budget_file = budget_file
        self.monthly_budget = int(monthly_budget if monthly_budget is not None else os.environ.get("CFBD_MONTHLY_BUDGET") or 800)

    def _count(self):
        if not self.budget_file:
            return
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        try:
            with open(self.budget_file) as f:
                d = json.load(f)
        except (FileNotFoundError, ValueError):
            d = {}
        if d.get("month") != month:
            d = {"month": month, "calls": 0}
        if d["calls"] >= self.monthly_budget:
            raise SourceBlocked(f"CFBD: local monthly budget of {self.monthly_budget} calls reached for {month}. Stopped until next month.")
        d["calls"] += 1
        with open(self.budget_file, "w") as f:
            json.dump(d, f)

    def get(self, path, **params):
        self._count()
        q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        with _open(f"{self.BASE}{path}?{q}", {"Authorization": f"Bearer {self.key}", "Accept": "application/json"}, f"CFBD {path}") as r:
            return json.load(r)

    def games(self, year, season_type="regular"):
        return self.get("/games", year=year, seasonType=season_type, classification="fbs")

    def ppa_games(self, year, season_type="regular"):
        return self.get("/ppa/games", year=year, seasonType=season_type, excludeGarbageTime="true")

    def lines(self, year, season_type="regular"):
        return self.get("/lines", year=year, seasonType=season_type)


# ---------------------------------------------------------------- selectors
def nfl_provider():
    name = os.environ.get("NFL_DATA_PROVIDER", "nflverse")
    if name == "nflverse":
        return Nflverse()
    if name == "local":
        return LocalNflDir()
    raise NotConfigured(f"unknown NFL_DATA_PROVIDER {name!r}")


def ncaaf_provider(budget_file=None):
    name = os.environ.get("NCAAF_DATA_PROVIDER", "cfbd")
    if name == "cfbd":
        return CfbdProvider(budget_file=budget_file)
    raise NotConfigured(f"unknown NCAAF_DATA_PROVIDER {name!r}")
