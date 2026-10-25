// Cookieless first-party counting (Kiko). No third-party trackers, no cookies, no raw IPs/UAs stored.
// id = sha256(dailySalt + IP + UA). The salt is random, held in memory only, and replaced at the start of
// each CT day, so ids can't be linked across days. Only per-day COUNTS are flushed to disk (STATS_DIR, if set).
// "Unique featured-pick viewers per week" = sum of daily uniques for the ISO week (a person seen on 3 days counts 3x),
// because a daily salt makes cross-day identity impossible by design.
// UTM attribution (Laye week-1 calendar): on a landing that carries utm_* params we record the combo
// source|medium|campaign|content against the HASHED id only (in memory, dies with the daily salt). A CTA click
// (/go/subscribe) by the same hashed id within the same visit (<= 30 min since its last page view, same CT day)
// is attributed to that combo. Flushed data holds only per-day counts per combo, never ids.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"];
const UTM_VAL = /^[A-Za-z0-9_.-]{1,64}$/;
export const VISIT_GAP_MS = 30 * 60 * 1000;
export function utmCombo(q = {}) {
  const v = UTM_KEYS.map((k) => (typeof q[k] === "string" && UTM_VAL.test(q[k]) ? q[k] : ""));
  return v.some(Boolean) ? v.map((x) => x || "-").join("|") : null;
}
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
  let sessions = new Map(), utmVisitors = new Map(), utmClicks = {}; // sessions: hashId -> {combo, last}
  const roll = () => {
    const d = ctDay(now());
    if (d === day) return;
    snapshot();
    day = d; salt = crypto.randomBytes(32); visitors = new Set(); featured = new Set(); clicks = 0; sessions = new Map(); utmVisitors = new Map(); utmClicks = {}; // old salt discarded
  };
  const id = (ip, ua) => crypto.createHash("sha256").update(salt).update(String(ip)).update("\0").update(String(ua || "")).digest("hex").slice(0, 32);
  const snapshot = () => {
    history[day] = { visitors: visitors.size, featuredViewers: featured.size, ctaClicks: clicks,
      utmVisitors: Object.fromEntries([...utmVisitors].map(([c, set]) => [c, set.size])), utmCtaClicks: { ...utmClicks } };
  };
  return {
    visit(ip, ua, { featuredView = false, utm = null } = {}) {
      roll(); const h = id(ip, ua), t = now().getTime(); visitors.add(h); if (featuredView) featured.add(h);
      const combo = utmCombo(utm || {}), cur = sessions.get(h);
      if (combo) {
        if (!utmVisitors.has(combo)) utmVisitors.set(combo, new Set());
        utmVisitors.get(combo).add(h);
        sessions.set(h, { combo, last: t });
      } else if (cur) {
        if (t - cur.last > VISIT_GAP_MS) sessions.delete(h); else cur.last = t; // new untagged visit ends attribution
      }
    },
    click(ip, ua) {
      roll(); clicks++;
      if (ip === undefined) return;
      const h = id(ip, ua), cur = sessions.get(h), t = now().getTime();
      if (cur && t - cur.last <= VISIT_GAP_MS) { utmClicks[cur.combo] = (utmClicks[cur.combo] || 0) + 1; cur.last = t; }
    },
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
        utmKey: "utm_source|utm_medium|utm_campaign|utm_content ('-' = absent)",
        utmUniqueVisitorsPerDay: Object.fromEntries(days.map((d) => [d, history[d].utmVisitors || {}])),
        utmAttributedCtaClicksPerDay: Object.fromEntries(days.map((d) => [d, history[d].utmCtaClicks || {}])),
        utmNote: "visitor = unique daily-salted hash per combo; click attributed when the same hash clicks /go/subscribe within 30 min of its last page view after a tagged landing",
      };
    },
  };
}
