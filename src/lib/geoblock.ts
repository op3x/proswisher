import { payments } from "../config/site";

// Geoblock STUB for a future checkout (memo 17 §3). Nothing calls a payment API in this build.
// When checkout is built it must run SERVER-SIDE, using both the request's IP geolocation and the
// billing ZIP/state, and refuse the session if either check fails. Client-side checks are advisory only.
export type GeoInput = { country?: string | null; usState?: string | null; billingState?: string | null };
export type GeoDecision = { allowed: boolean; reason?: string };

export function checkoutGeoDecision({ country, usState, billingState }: GeoInput): GeoDecision {
  const c = (country || "").toUpperCase();
  if (!c) return { allowed: false, reason: "Location unknown" }; // fail closed
  if ((payments.blockedCountries as readonly string[]).includes(c)) return { allowed: false, reason: `Not available in ${c}` };
  if (c === "US") {
    for (const st of [usState, billingState]) {
      const s = (st || "").toUpperCase();
      if (!s) return { allowed: false, reason: "State unknown" }; // fail closed
      if (payments.blockedUsStates.includes(s)) return { allowed: false, reason: `Not available in ${s}` };
    }
  }
  return { allowed: true };
}

// Payments are only possible when ALL are true. In this build __PAYMENTS_WIRED__ is false, so this is always false.
export function paymentsEnabled(): boolean {
  return __PAYMENTS_WIRED__ && __APP_ENV__ === "production" && import.meta.env.VITE_SUBSCRIBE_ENABLED === "true";
}
