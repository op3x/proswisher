// Cookieless first-party counting (Kiko). No third-party trackers, no cookies, no raw IPs/UAs stored.
// id = sha256(dailySalt + IP + UA). The salt is random, held in memory only, and replaced at the start of
// each CT day, so ids can't be linked across days. Only per-day COUNTS are flushed to disk (STATS_DIR, if set).
// "Unique featured-pick viewers per week" = sum of daily uniques for the ISO week (a person seen on 3 days counts 3x),
// because a daily salt makes cross-day identity impossible by design.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ctDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
export function isoWeek(day) {
  const d = new Date(day + "T12:00:00Z"); const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const y = d.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4));
  const wk = 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}

export function createCounter({ dir = process.env.STATS_DIR || "", now = () => new Date() } = {}) {
  const file = dir ? path.join(dir, "counts.json") : "";
  let history = {}; // day -> { visitors, featuredViewers, ctaClicks }
  if (file && fs.existsSync(file)) { try { history = JSON.parse(fs.readFileSync(file, "utf8")); } catch { history = {}; } }
  let day = ctDay(now()), salt = crypto.randomBytes(32), visitors = new Set(), featured = new Set(), clicks = 0;
  const roll = () => {
    const d = ctDay(now());
    if (d === day) return;
    snapshot();
    day = d; salt = crypto.randomBytes(32); visitors = new Set(); featured = new Set(); clicks = 0; // old salt discarded
  };
  const id = (ip, ua) => crypto.createHash("sha256").update(salt).update(String(ip)).update("\0").update(String(ua || "")).digest("hex").slice(0, 32);
  const snapshot = () => { history[day] = { visitors: visitors.size, featuredViewers: featured.size, ctaClicks: clicks }; };
  return {
    visit(ip, ua, { featuredView = false } = {}) { roll(); const h = id(ip, ua); visitors.add(h); if (featuredView) featured.add(h); },
    click() { roll(); clicks++; },
    flush() {
      roll(); snapshot();
      if (!file) return false;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(history)); fs.renameSync(file + ".tmp", file);
      return true;
    },
    report() {
      roll(); snapshot();
      const days = Object.keys(history).sort();
      const weeks = {};
      for (const d of days) { const w = isoWeek(d); weeks[w] = (weeks[w] || 0) + history[d].featuredViewers; }
      return {
        storage: file ? "json-file" : "memory-only (resets on restart/redeploy)",
        today: day,
        uniqueVisitorsPerDay: Object.fromEntries(days.map((d) => [d, history[d].visitors])),
        uniqueFeaturedPickViewersPerWeek: weeks,
        featuredWeekNote: "sum of daily-salted uniques; repeat visitors on different days count once per day",
        ctaClicksPerDay: Object.fromEntries(days.map((d) => [d, history[d].ctaClicks])),
      };
    },
  };
}
