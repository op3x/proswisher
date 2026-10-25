// Geoblock (Ingus spec; Larry ruling on Sal #1/#2, 10:24). Split by surface:
//  - Public pages: ALWAYS open, whatever the IP or the DB state. GeoIP is never consulted for them.
//  - Paid sign-up (/subscribe) and checkout: FAIL CLOSED.
//    1) GeoIP (MaxMind GeoLite2 City, local .mmdb, never committed). DB missing or older than GEO_MAX_AGE_DAYS (45)
//       -> checkout disabled ("temporarily unavailable"). IP unknown/unresolvable (not in DB, no country, or a US IP
//       without a state) -> refused with the VPN/proxy message. Blocked country/state -> refused.
//    2) Declared billing country/state (required picker, no default) must not be blocked AND must match the IP's
//       country/state; mismatch -> refused. Only then is a Checkout Session created (billing_address_collection=required).
//    3) Webhook: Stripe's collected billing address is checked; paid access is granted only once it passes
//       (subscription metadata billing_check=passed). Blocked -> immediate refund + cancel, logged.
//  - GEO_PREVIEW_BYPASS=true skips the IP checks (1, and the IP half of 2) in preview ONLY. With APP_ENV=production
//    it is ignored and the server refuses to start (assertGeoEnv + scripts/guard.mjs).
// Logs only country/region codes, never IPs.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const geoConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "src/config/geo.json"), "utf8"));
export const GEOIP_DIR = process.env.GEOIP_DIR || path.join(ROOT, "geoip");
export const GEOIP_PATH = path.join(GEOIP_DIR, "GeoLite2-City.mmdb");

// Railway's edge appends the connecting client's address to X-Forwarded-For. Anything to its left was
// supplied by the client and is untrusted. We trust exactly TRUSTED_PROXY_HOPS entries from the right (default 1):
// the client is the entry those proxies appended. If the header has fewer entries than trusted hops (the app was
// reached without the proxy), or the entry isn't an IP, the socket address is used instead. 0 = trust no header.
const unmap = (ip) => String(ip || "").replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1");
export function clientIp(req, hops = process.env.TRUSTED_PROXY_HOPS) {
  const n = hops === undefined || hops === "" ? 1 : Number(hops);
  const sock = unmap(req.socket && req.socket.remoteAddress);
  if (!Number.isInteger(n) || n < 1) return sock;
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (xff.length < n) return sock;
  const ip = unmap(xff[xff.length - n]);
  return net.isIP(ip) ? ip : sock;
}

export const GEO_MAX_AGE_DAYS = 45; // GeoLite2 is rebuilt twice a week and we refresh weekly; 45 days = clearly broken refresh
export const MSG_UNCONFIRMED = "We couldn't confirm your location. Please turn off any VPN or proxy and try again.";
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || "").trim());

// Preview-only bypass of the IP checks. Never effective in production.
export function assertGeoEnv(env = process.env) {
  if (truthy(env.GEO_PREVIEW_BYPASS) && String(env.APP_ENV || "").toLowerCase() === "production")
    throw new Error("GEO_PREVIEW_BYPASS is set with APP_ENV=production; refusing to start (preview-only flag)");
}
export function previewBypass(env = process.env) {
  return truthy(env.GEO_PREVIEW_BYPASS) && String(env.APP_ENV || "preview").toLowerCase() !== "production";
}

// DB health for checkout: { ok, reason: null|"missing"|"stale", ageDays }. lookup.builtAt = DB build time (ms).
export function geoStatus(lookup, now = Date.now(), maxAgeDays = GEO_MAX_AGE_DAYS) {
  if (!lookup) return { ok: false, reason: "missing", ageDays: null };
  if (lookup.builtAt == null) return { ok: true, reason: null, ageDays: null };
  const ageDays = Math.floor((now - lookup.builtAt) / 864e5);
  return ageDays > maxAgeDays ? { ok: false, reason: "stale", ageDays } : { ok: true, reason: null, ageDays };
}

// Fail-closed decision for paid sign-up/checkout from the IP alone.
// -> { ok:true, country, region } | { ok:false, status, error, message? }
export function signupIpDecision(lookup, ip, { bypass = false, now = Date.now() } = {}) {
  if (bypass) return { ok: true, bypass: true, country: null, region: null };
  const st = geoStatus(lookup, now);
  if (!st.ok) return { ok: false, status: 503, error: "checkout_unavailable", reason: st.reason };
  const g = ip ? lookup(ip) : null;
  const country = String(g?.country || "").toUpperCase(), region = String(g?.region || "").toUpperCase();
  if (!country || (country === "US" && !region)) return { ok: false, status: 451, error: "location_unconfirmed", message: MSG_UNCONFIRMED };
  if (isBlocked(country, region)) return { ok: false, status: 451, error: "geoblocked", country, region };
  return { ok: true, country, region };
}

// Declared billing country/state vs the IP's country/state. "ZZ" (Other) matches any country not offered by name.
export const PICKER_COUNTRIES = ["US", "CA", "GB", "AU", "JP"];
export function declaredMatchesIp(country, state, ip) {
  if (ip.bypass) return true;
  if (country === "ZZ") return !PICKER_COUNTRIES.includes(ip.country);
  if (country !== ip.country) return false;
  return country !== "US" || state === ip.region;
}

export function isBlocked(country, region, cfg = geoConfig) {
  if (!cfg.enabled) return false;
  const c = String(country || "").toUpperCase(), r = String(region || "").toUpperCase();
  if (cfg.countries.includes(c)) return true;
  return c === "US" && cfg.usStates.includes(r);
}

// lookup(ip) -> { country, region } | null. Built from a maxmind Reader, or null when no DB.
export function readerLookup(reader) {
  const fn = (ip) => {
    let rec = null;
    try { rec = reader.get(ip); } catch { return null; }
    if (!rec) return null;
    return { country: rec.country?.iso_code || rec.registered_country?.iso_code || null, region: rec.subdivisions?.[0]?.iso_code || null };
  };
  // node-maxmind exposes buildEpoch as a Date (raw .mmdb metadata is seconds); unknown build time counts as stale.
  const be = reader.metadata?.buildEpoch;
  const ms = be instanceof Date ? be.getTime() : Number(be) < 1e11 ? Number(be) * 1000 : Number(be);
  fn.builtAt = Number.isFinite(ms) ? ms : 0;
  return fn;
}

export function geoipDecision(lookup, ip) {
  if (!lookup) return { blocked: false, checked: false };      // legacy helper only; sign-up/checkout use signupIpDecision (fail closed)
  const g = ip ? lookup(ip) : null;
  if (!g) return { blocked: false, checked: true, found: false }; // not in DB -> allow
  return { blocked: isBlocked(g.country, g.region), checked: true, found: true, country: g.country, region: g.region };
}

// US ZIP3 -> state, only for blocked states (USPS ranges); used when only a ZIP is known.
const ZIP3 = [[980, 994, "WA"], [967, 968, "HI"], [840, 847, "UT"]];
export function stateFromZip(zip) {
  const m = String(zip || "").trim().match(/^(\d{3})\d{2}(-\d{4})?$/);
  if (!m) return null;
  const z = Number(m[1]);
  for (const [lo, hi, st] of ZIP3) if (z >= lo && z <= hi) return st;
  return "OTHER";
}
// Billing gate on a Stripe address ({country, state, postal_code}). Unknown country -> blocked (fail closed).
export function billingBlocked(addr, cfg = geoConfig) {
  if (!cfg.enabled) return false;
  const c = String(addr?.country || "").toUpperCase();
  if (!c) return true;
  if (c !== "US") return isBlocked(c, null, cfg);
  const st = String(addr?.state || "").toUpperCase() || stateFromZip(addr?.postal_code);
  return !st || isBlocked("US", st, cfg);
}

let warned = false;
export async function openGeoip() {
  if (!fs.existsSync(GEOIP_PATH)) {
    if (!warned) console.warn(`[geo] WARNING: GeoLite2 DB not found${process.env.MAXMIND_LICENSE_KEY ? "" : " and MAXMIND_LICENSE_KEY unset"}; checkout DISABLED (fail closed). Public pages stay open.`);
    warned = true;
    return null;
  }
  const maxmind = (await import("maxmind")).default;
  const reader = await maxmind.open(GEOIP_PATH);
  const lookup = readerLookup(reader);
  const st = geoStatus(lookup);
  console.log(`[geo] GeoLite2 City DB loaded (age ${st.ageDays ?? "?"} days)${st.ok ? "" : `; STALE (> ${GEO_MAX_AGE_DAYS} days): checkout DISABLED`}`);
  return lookup;
}
