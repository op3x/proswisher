import { geoblock as defaults } from "../config/site";

// Geoblock STUB (memo 17 §3, Larry's rulings): WA, HI, UT and Japan. ON by default, configurable.
// Scope (Larry round 2): ONLY account creation (free and paid) and checkout. Public pages, game pages
// and the track record are viewable everywhere; nothing in this app blocks a page by location.
// Two independent signals must BOTH pass: IP geolocation (country + region) and billing country + ZIP.
// When checkout is built this MUST run server-side before a checkout session is created; client-side is advisory.
// Nothing calls a payment API in this build.

export type GeoConfig = { enabled: boolean; usStates: string[]; countries: string[] };
export type GeoInput = {
  ipCountry?: string | null; ipRegion?: string | null;          // from IP geolocation
  billingCountry?: string | null; billingZip?: string | null;   // from the billing address
};
export type GeoDecision = { allowed: boolean; reason?: string };

// US ZIP3 prefixes → state, only for the blocked states (USPS ranges).
const ZIP3: Array<[number, number, string]> = [
  [980, 994, "WA"],
  [967, 968, "HI"],
  [840, 847, "UT"],
];
export function stateFromZip(zip?: string | null): string | null {
  const m = (zip || "").trim().match(/^(\d{3})\d{2}(-\d{4})?$/);
  if (!m) return null;
  const z = Number(m[1]);
  for (const [lo, hi, st] of ZIP3) if (z >= lo && z <= hi) return st;
  return "OTHER";
}

export function checkoutGeoDecision(input: GeoInput, cfg: GeoConfig = defaults): GeoDecision {
  if (!cfg.enabled) return { allowed: true };
  const ipC = (input.ipCountry || "").toUpperCase();
  const billC = (input.billingCountry || "").toUpperCase();
  if (!ipC || !billC) return { allowed: false, reason: "Location unknown" }; // fail closed
  for (const c of [ipC, billC]) if (cfg.countries.includes(c)) return { allowed: false, reason: `Not available in ${c}` };
  if (ipC === "US") {
    const r = (input.ipRegion || "").toUpperCase();
    if (!r) return { allowed: false, reason: "Region unknown" };
    if (cfg.usStates.includes(r)) return { allowed: false, reason: `Not available in ${r}` };
  }
  if (billC === "US") {
    const st = stateFromZip(input.billingZip);
    if (!st) return { allowed: false, reason: "Billing ZIP required" };
    if (cfg.usStates.includes(st)) return { allowed: false, reason: `Not available in ${st}` };
  }
  return { allowed: true };
}

// Client copy of the rules, advisory only. Enforcement is server-side (server/geo.mjs): HTTP 451 on /subscribe
// and POST /api/checkout, and the billing-address check in the checkout.session.completed webhook.
