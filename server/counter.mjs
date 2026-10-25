// Cookieless first-party counting (Kiko; hardened per Larry memo 21 R1-R6). OFF unless COUNTING_ENABLED=true.
// id = sha256(dailySalt || truncatedIP || 0x00 || UA), 128 bits. IPv4 is cut to /24 and IPv6 to /48 BEFORE hashing (R1).
// The salt is 256 random bits held ONLY in this closure: never logged, serialized, written to env, or returned
// by report()/flush() (R2). It is replaced by a timer at each CT midnight (and lazily on the first request of a
// new day, and on every restart); all ids, sessions and UTM sets are dropped with it.
// Only per-day COUNTS are persisted (STATS_DIR, if set) (R3). Retention (R4): ids <= the CT day; per-combo UTM
// rows older than 30 days are rolled up into monthly per-campaign totals (utm_content dropped); daily totals and
// monthly rollups older than 25 months are deleted on every flush.
// UTM (R6): only allowlisted combos (commerce.json utmAllowlist) are kept; anything else is "other". /admin/stats
// shows UTM cells under 5 as "<5". Weekly featured viewers = sum of daily uniques (cross-day identity is impossible).
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commerce = JSON.parse(fs.readFileSync(path.join(ROOT, "src/config/commerce.json"), "utf8"));
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"];
export const UTM_ALLOW = new Set(commerce.utmAllowlist?.combos || []);
const UTM_VAL = /^[A-Za-z0-9_.-]{1,64}$/;
export const VISIT_GAP_MS = 30 * 60 * 1000;
export const UTM_DETAIL_DAYS = 30, KEEP_MONTHS = 25, SMALL_CELL = 5;

export function utmCombo(q = {}, allow = UTM_ALLOW) {
  const v = UTM_KEYS.map((k) => (typeof q[k] === "string" && UTM_VAL.test(q[k]) ? q[k] : ""));
  if (!v.some(Boolean)) return null;
  const combo = v.map((x) => x || "-").join("|");
  return allow.has(combo) ? combo : "other";
}

// R1: zero the host part before hashing. IPv4 -> /24, IPv6 -> /48, IPv4-mapped IPv6 -> its IPv4 /24.
export function truncateIp(ip) {
  let s = String(ip || "").trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) s = mapped[1];
  if (net.isIPv4(s)) return s.split(".").slice(0, 3).join(".") + ".0/24";
  if (net.isIPv6(s)) {
    const [head, tail = ""] = s.split("::");
    const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
    const full = s.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
    return full.slice(0, 3).map((x) => parseInt(x || "0", 16).toString(16)).join(":") + "::/48";
  }
  return "invalid";
}

const ctDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
// ms until the next America/Chicago midnight (DST-safe: step forward to the first minute whose CT date changes)
export function msToNextCtMidnight(d = new Date()) {
  const today = ctDay(d);
  let t = d.getTime() + 60000 - (d.getTime() % 60000);
  for (let step = 3600000; step >= 60000; step /= 60) { while (ctDay(new Date(t + step)) === today) t += step; }
  while (ctDay(new Date(t)) === today) t += 60000;
  return Math.max(1000, t - d.getTime());
}
export function isoWeek(day) {
  const d = new Date(day + "T12:00:00Z"); const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const y = d.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4));
  const wk = 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}
const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (month, n) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const campaignOf = (combo) => combo === "other" ? "other" : combo.split("|").slice(0, 3).join("|");
const cell = (n) => (n < SMALL_CELL ? "<5" : n);

// R4: prune/roll up a persisted history in place. Pure (exported for tests).
export function applyRetention(hist, today) {
  const days = hist.days || {}, monthly = hist.utmMonthly || {};
  const detailCut = addDays(today, -UTM_DETAIL_DAYS), keepFrom = addMonths(today.slice(0, 7), -KEEP_MONTHS);
  for (const [d, row] of Object.entries(days)) {
    if (d < detailCut && (row.utmVisitors || row.utmCtaClicks)) {
      const m = (monthly[d.slice(0, 7)] ||= {});
      for (const [combo, n] of Object.entries(row.utmVisitors || {})) { const k = campaignOf(combo); (m[k] ||= { visitors: 0, ctaClicks: 0 }).visitors += n; }
      for (const [combo, n] of Object.entries(row.utmCtaClicks || {})) { const k = campaignOf(combo); (m[k] ||= { visitors: 0, ctaClicks: 0 }).ctaClicks += n; }
      delete row.utmVisitors; delete row.utmCtaClicks;
    }
    if (d.slice(0, 7) < keepFrom) delete days[d];
  }
  for (const m of Object.keys(monthly)) if (m < keepFrom) delete monthly[m];
  return { version: 2, days, utmMonthly: monthly };
}

export function createCounter({ dir = process.env.STATS_DIR || "", now = () => new Date(), setTimer = setTimeout, enabled = true } = {}) {
  const file = dir ? path.join(dir, "counts.json") : "";
  let hist = { version: 2, days: {}, utmMonthly: {} };
  if (file && fs.existsSync(file)) {
    try { const raw = JSON.parse(fs.readFileSync(file, "utf8")); hist = raw.version === 2 ? raw : { version: 2, days: raw, utmMonthly: {} }; } catch { /* start fresh */ }
  }
  let day = ctDay(now()), salt = crypto.randomBytes(32), visitors = new Set(), featured = new Set(), clicks = 0;
  let sessions = new Map(), utmVisitors = new Map(), utmClicks = {}; // sessions: hashId -> {combo, last}
  const rotate = () => {
    snapshot();
    day = ctDay(now()); salt = crypto.randomBytes(32); // old salt is unreachable from here on
    visitors = new Set(); featured = new Set(); clicks = 0; sessions = new Map(); utmVisitors = new Map(); utmClicks = {};
  };
  const roll = () => { if (ctDay(now()) !== day) rotate(); };
  // R2: rotate on a CT-midnight timer even with no traffic. unref() so it never keeps the process alive.
  let timer = null;
  const arm = () => {
    timer = setTimer(() => { roll(); arm(); }, msToNextCtMidnight(now()) + 1000);
    timer?.unref?.();
  };
  if (enabled) arm();
  const id = (ip, ua) => crypto.createHash("sha256").update(salt).update(truncateIp(ip)).update("\0").update(String(ua || "")).digest("hex").slice(0, 32);
  const snapshot = () => {
    if (!visitors.size && !clicks && !hist.days[day]) return;
    hist.days[day] = { visitors: visitors.size, featuredViewers: featured.size, ctaClicks: clicks,
      utmVisitors: Object.fromEntries([...utmVisitors].map(([c, set]) => [c, set.size])), utmCtaClicks: { ...utmClicks } };
  };
  const api = {
    enabled,
    visit(ip, ua, { featuredView = false, utm = null } = {}) {
      if (!enabled) return;
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
      if (!enabled) return;
      roll(); clicks++;
      if (ip === undefined) return;
      const h = id(ip, ua), cur = sessions.get(h), t = now().getTime();
      if (cur && t - cur.last <= VISIT_GAP_MS) { utmClicks[cur.combo] = (utmClicks[cur.combo] || 0) + 1; cur.last = t; }
    },
    flush() {
      if (!enabled) return false;
      roll(); snapshot(); hist = applyRetention(hist, day);
      if (!file) return false;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(hist)); fs.renameSync(file + ".tmp", file);
      return true;
    },
    report() {
      if (!enabled) return { enabled: false, note: "Counting is off (COUNTING_ENABLED is not 'true'). Nothing is counted or stored." };
      roll(); snapshot(); hist = applyRetention(hist, day);
      const D = hist.days, days = Object.keys(D).sort();
      const weeks = {};
      for (const d of days) { const w = isoWeek(d); weeks[w] = (weeks[w] || 0) + D[d].featuredViewers; }
      const cells = (o = {}) => Object.fromEntries(Object.entries(o).map(([k, n]) => [k, cell(n)]));
      return {
        enabled: true,
        storage: file ? "json-file" : "memory-only (resets on restart/redeploy)",
        today: day,
        uniqueVisitorsPerDay: Object.fromEntries(days.map((d) => [d, D[d].visitors])),
        uniqueFeaturedPickViewersPerWeek: weeks,
        featuredWeekNote: "sum of daily-salted uniques; repeat visitors on different days count once per day",
        ctaClicksPerDay: Object.fromEntries(days.map((d) => [d, D[d].ctaClicks])),
        utmKey: "utm_source|utm_medium|utm_campaign|utm_content ('-' = absent; non-allowlisted = 'other')",
        utmUniqueVisitorsPerDay: Object.fromEntries(days.filter((d) => D[d].utmVisitors).map((d) => [d, cells(D[d].utmVisitors)])),
        utmAttributedCtaClicksPerDay: Object.fromEntries(days.filter((d) => D[d].utmCtaClicks).map((d) => [d, cells(D[d].utmCtaClicks)])),
        utmMonthlyByCampaign: Object.fromEntries(Object.entries(hist.utmMonthly).map(([m, o]) => [m, Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { visitors: cell(v.visitors), ctaClicks: cell(v.ctaClicks) }]))])),
        utmNote: "UTM cells under 5 show as '<5'. Per-link rows older than 30 days are rolled up into monthly campaign totals; everything older than 25 months is deleted.",
      };
    },
    stop() { if (timer) clearTimeout(timer); },
  };
  return api;
}
