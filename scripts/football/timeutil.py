"""US Eastern / Central time helpers without zoneinfo (the Railway image may not ship tzdata)."""
from datetime import datetime, timedelta, timezone


def _nth_sunday(year, month, n):
    d = datetime(year, month, 1)
    d += timedelta(days=(6 - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def us_dst(local_naive):
    """True if a US local wall-clock time is in DST (2nd Sunday of March 02:00 -> 1st Sunday of November 02:00)."""
    y = local_naive.year
    start = _nth_sunday(y, 3, 2).replace(hour=2)
    end = _nth_sunday(y, 11, 1).replace(hour=2)
    return start <= local_naive < end


def eastern_to_utc(date_str, time_str):
    """'2026-11-01', '13:00' (US Eastern wall clock, as nflverse publishes) -> aware UTC datetime."""
    t = (time_str or "13:00").strip()[:5]
    local = datetime.strptime(f"{date_str} {t}", "%Y-%m-%d %H:%M")
    off = 4 if us_dst(local) else 5
    return (local + timedelta(hours=off)).replace(tzinfo=timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
