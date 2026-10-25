// Geoblock (Ingus spec). Two gates, applied ONLY to paid sign-up (/subscribe) and checkout-session creation:
//  1) GeoIP: MaxMind GeoLite2 City (.mmdb, never committed). Missing key/DB -> gate skipped (fail open) + warning.
//     IP not found in DB -> allowed. Block if country JP, or US + region WA/HI/UT.
//  2) Declared billing country/state before the session, then Stripe's collected billing address in the webhook.
// Logs only country/region codes, never IPs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const geoConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "src/config/geo.json"), "utf8"));
export const GEOIP_DIR = process.env.GEOIP_DIR || path.join(ROOT, "geoip");
export const GEOIP_PATH = path.join(GEOIP_DIR, "GeoLite2-City.mmdb");

// Railway's edge appends the connecting client's address to X-Forwarded-For. Anything to its left was
// supplied by the client and is untrusted, so use the rightmost hop (TRUSTED_PROXY_HOPS from the right, default 1).
export function clientIp(req, hops = Number(process.env.TRUSTED_PROXY_HOPS || 1)) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (xff.length) return xff[Math.max(0, xff.length - hops)];
  return (req.socket && req.socket.remoteAddress) || "";
}

export function isBlocked(country, region, cfg = geoConfig) {
  if (!cfg.enabled) return false;
  const c = String(country || "").toUpperCase(), r = String(region || "").toUpperCase();
  if (cfg.countries.includes(c)) return true;
  return c === "US" && cfg.usStates.includes(r);
}

// lookup(ip) -> { country, region } | null. Built from a maxmind Reader, or null when no DB.
export function readerLookup(reader) {
  return (ip) => {
    let rec = null;
    try { rec = reader.get(ip); } catch { return null; }
    if (!rec) return null;
    return { country: rec.country?.iso_code || rec.registered_country?.iso_code || null, region: rec.subdivisions?.[0]?.iso_code || null };
  };
}

export function geoipDecision(lookup, ip) {
  if (!lookup) return { blocked: false, checked: false };      // fail open (no key/DB): warned at startup
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
    if (!warned) console.warn(`[geo] WARNING: GeoLite2 DB not found${process.env.MAXMIND_LICENSE_KEY ? "" : " and MAXMIND_LICENSE_KEY unset"}; GeoIP gate SKIPPED (fail open). Billing-address gates still apply.`);
    warned = true;
    return null;
  }
  const maxmind = (await import("maxmind")).default;
  const reader = await maxmind.open(GEOIP_PATH);
  console.log("[geo] GeoLite2 City DB loaded");
  return readerLookup(reader);
}
