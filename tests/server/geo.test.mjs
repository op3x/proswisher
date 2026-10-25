// Ingus 9:45: sample IPs for JP, WA, HI, UT plus an allowed state; rightmost XFF. (Checkout fail-closed: geo-gate.test.mjs)
import test from "node:test";
import assert from "node:assert/strict";
import { clientIp, geoipDecision, isBlocked, billingBlocked, stateFromZip } from "../../server/geo.mjs";

// Fake GeoLite2 lookup keyed by documentation/sample IPs (RFC 5737 / 3849 ranges).
const DB = {
  "203.0.113.10": { country: "JP", region: "13" },   // Tokyo
  "198.51.100.20": { country: "US", region: "WA" },  // Washington
  "198.51.100.30": { country: "US", region: "HI" },  // Hawaii
  "198.51.100.40": { country: "US", region: "UT" },  // Utah
  "192.0.2.50": { country: "US", region: "TX" },     // Texas (allowed)
  "2001:db8::1": { country: "CA", region: "ON" },    // Canada (allowed)
};
const lookup = (ip) => DB[ip] || null;

test("blocks JP, US-WA, US-HI, US-UT by IP", () => {
  for (const ip of ["203.0.113.10", "198.51.100.20", "198.51.100.30", "198.51.100.40"]) {
    assert.equal(geoipDecision(lookup, ip).blocked, true, ip);
  }
});
test("allows an allowed state and another country", () => {
  assert.equal(geoipDecision(lookup, "192.0.2.50").blocked, false);
  assert.equal(geoipDecision(lookup, "2001:db8::1").blocked, false);
});
test("IP not found in DB is allowed", () => {
  const d = geoipDecision(lookup, "192.0.2.99");
  assert.equal(d.blocked, false); assert.equal(d.found, false);
});
test("geoipDecision helper: missing DB is reported as unchecked (checkout gate is signupIpDecision, fail closed)", () => {
  const d = geoipDecision(null, "203.0.113.10");
  assert.equal(d.blocked, false); assert.equal(d.checked, false);
});
test("uses the rightmost X-Forwarded-For hop (appended by Railway's edge)", () => {
  const req = { headers: { "x-forwarded-for": "192.0.2.50, 10.0.0.1, 203.0.113.10" }, socket: {} };
  assert.equal(clientIp(req, 1), "203.0.113.10");
  // spoofed left-most value is ignored
  assert.equal(geoipDecision(lookup, clientIp({ headers: { "x-forwarded-for": "192.0.2.50, 198.51.100.20" } }, 1)).blocked, true);
});
test("billing address gate", () => {
  assert.equal(billingBlocked({ country: "US", state: "WA" }), true);
  assert.equal(billingBlocked({ country: "US", state: "TX" }), false);
  assert.equal(billingBlocked({ country: "JP" }), true);
  assert.equal(billingBlocked({ country: "US", postal_code: "84101" }), true); // UT by ZIP
  assert.equal(billingBlocked(null), true); // unknown -> fail closed
  assert.equal(stateFromZip("96813"), "HI");
  assert.equal(isBlocked("US", "CA"), false);
});
