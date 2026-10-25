// Larry 10:24 rulings (Sal #1/#2) + Sal QA #3, #9 and the XFF hardening.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { createApp } from "../../server/index.mjs";
import { clientIp, readerLookup, geoStatus, signupIpDecision, assertGeoEnv, previewBypass, MSG_UNCONFIRMED, GEO_MAX_AGE_DAYS } from "../../server/geo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEST_KEY = ["rk", "test", "fixture000"].join("_");
const payEnv = { APP_ENV: "preview", STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: "fixture-signing-secret", STRIPE_PRICE_ID: "price_fixture" };
const DB = { "192.0.2.50": { country: "US", region: "TX" }, "192.0.2.60": { country: "US", region: null }, "198.51.100.20": { country: "US", region: "WA" },
  "203.0.113.10": { country: "JP" }, "203.0.113.20": { country: "DE" }, "2001:db8::1": { country: "CA", region: "ON" } };
const fresh = () => { const f = (ip) => DB[ip] || null; f.builtAt = Date.now() - 3 * 864e5; return f; };
const stale = () => { const f = (ip) => DB[ip] || null; f.builtAt = Date.now() - (GEO_MAX_AGE_DAYS + 1) * 864e5; return f; };
const quiet = () => {};
const serve = async (app) => { const srv = app.listen(0); await new Promise((r) => srv.once("listening", r)); return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }; };
const mock = () => { const calls = []; return { calls, webhooks: new Stripe(TEST_KEY).webhooks,
  checkout: { sessions: { create: async (p) => { calls.push(p); return { id: "cs_test_x", url: "https://checkout.stripe.test/x" }; } } } }; };
const post = (url, ip, body) => fetch(url + "/api/checkout", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip },
  body: JSON.stringify({ consent: true, age21: true, ...body }) });
const PUBLIC = ["/", "/track-record", "/how-it-works", "/terms", "/privacy", "/faq", "/responsible-gaming", "/contact", "/health"];

test("XFF hardening: trusted hops from the right; too few entries or junk -> socket address; ::ffff: unmapped", () => {
  const req = (h, sock = "10.1.2.3") => ({ headers: h === null ? {} : { "x-forwarded-for": h }, socket: { remoteAddress: sock } });
  assert.equal(clientIp(req("192.0.2.50, 10.0.0.1, 203.0.113.10"), 1), "203.0.113.10");
  assert.equal(clientIp(req("192.0.2.50, 10.0.0.1, 203.0.113.10"), 2), "10.0.0.1");
  assert.equal(clientIp(req("203.0.113.10"), 2), "10.1.2.3");      // fewer entries than trusted hops: not via the proxy chain
  assert.equal(clientIp(req(null, "::ffff:192.0.2.50"), 1), "192.0.2.50"); // reached without the proxy header
  assert.equal(clientIp(req("not-an-ip"), 1), "10.1.2.3");
  assert.equal(clientIp(req("203.0.113.10"), 0), "10.1.2.3");      // 0 = trust no header
  assert.equal(clientIp(req("2001:db8::1"), "1"), "2001:db8::1");
});

test("DB health: missing and >45-day-old DBs disable checkout", () => {
  assert.deepEqual(geoStatus(null).reason, "missing");
  assert.equal(geoStatus(fresh()).ok, true);
  assert.equal(geoStatus(stale()).reason, "stale");
  assert.equal(signupIpDecision(null, "192.0.2.50").status, 503);
  assert.equal(signupIpDecision(stale(), "192.0.2.50").status, 503);
  for (const ip of ["192.0.2.99", "192.0.2.60", ""]) {   // not in DB, US without state, no IP
    const d = signupIpDecision(fresh(), ip); assert.equal(d.status, 451); assert.equal(d.message, MSG_UNCONFIRMED);
  }
  assert.equal(signupIpDecision(fresh(), "198.51.100.20").error, "geoblocked");
  assert.equal(signupIpDecision(fresh(), "192.0.2.50").ok, true);
  // real reader shape: node-maxmind gives buildEpoch as a Date; missing build time counts as stale
  const rd = (be) => readerLookup({ metadata: { buildEpoch: be }, get: () => null });
  assert.equal(geoStatus(rd(new Date(Date.now() - 2 * 864e5))).ok, true);
  assert.equal(geoStatus(rd(new Date(Date.now() - 60 * 864e5))).reason, "stale");
  assert.equal(geoStatus(rd(Math.floor(Date.now() / 1000) - 864e2)).ok, true);
  assert.equal(geoStatus(rd(undefined)).reason, "stale");
});

test("public pages always open; sign-up and checkout fail closed when the DB is missing or stale", async () => {
  for (const geoLookup of [null, stale()]) {
    const stripe = mock();
    const s = await serve(await createApp({ env: payEnv, stripe, geoLookup, log: quiet }));
    try {
      for (const p of PUBLIC) assert.equal((await fetch(s.url + p, { headers: { "x-forwarded-for": "203.0.113.10" } })).status, 200, p);
      const cfg = await (await fetch(s.url + "/api/config")).json();
      assert.equal(cfg.checkout.available, false); assert.equal(cfg.payments.enabled, true);
      assert.equal((await fetch(s.url + "/subscribe", { headers: { "x-forwarded-for": "192.0.2.50" } })).status, 200); // page renders "temporarily unavailable"
      const r = await post(s.url, "192.0.2.50", { country: "US", state: "TX" });
      assert.equal(r.status, 503); assert.equal((await r.json()).error, "checkout_unavailable");
      assert.equal(stripe.calls.length, 0);
    } finally { s.close(); }
  }
});

test("unknown/unresolvable IP gets exactly the VPN text and no Checkout Session", async () => {
  const stripe = mock();
  const s = await serve(await createApp({ env: payEnv, stripe, geoLookup: fresh(), log: quiet }));
  try {
    for (const ip of ["192.0.2.99", "192.0.2.60"]) {
      const r = await post(s.url, ip, { country: "US", state: "TX" });
      assert.equal(r.status, 451);
      assert.deepEqual(await r.json(), { error: "location_unconfirmed", message: "We couldn't confirm your location. Please turn off any VPN or proxy and try again." });
      const page = await fetch(s.url + "/subscribe", { headers: { "x-forwarded-for": ip } });
      assert.equal(page.status, 451); assert.ok((await page.text()).includes("Please turn off any VPN or proxy and try again."));
    }
    assert.equal(stripe.calls.length, 0);
  } finally { s.close(); }
});

test("pre-charge: picker required, blocklist, declared vs IP mismatch refused; match -> Session with billing_address_collection=required", async () => {
  const stripe = mock();
  const s = await serve(await createApp({ env: payEnv, stripe, geoLookup: fresh(), log: quiet }));
  try {
    assert.equal((await post(s.url, "192.0.2.50", {})).status, 400);                              // no default: must choose
    assert.equal((await post(s.url, "192.0.2.50", { country: "US" })).status, 400);               // US needs a state
    for (const [ip, body] of [["192.0.2.50", { country: "US", state: "WA" }], ["192.0.2.50", { country: "JP" }], ["2001:db8::1", { country: "US", state: "HI" }]]) {
      const r = await post(s.url, ip, body); assert.equal(r.status, 451);
      assert.match((await r.json()).message, /can't accept subscriptions with a billing address/);
    }
    for (const [ip, body] of [["192.0.2.50", { country: "US", state: "CA" }], ["192.0.2.50", { country: "CA" }], ["2001:db8::1", { country: "US", state: "TX" }], ["2001:db8::1", { country: "ZZ" }]]) {
      const r = await post(s.url, ip, body); assert.equal(r.status, 451, JSON.stringify(body));
      const j = await r.json(); assert.equal(j.error, "location_mismatch"); assert.equal(j.message, MSG_UNCONFIRMED);
    }
    assert.equal(stripe.calls.length, 0);
    assert.equal((await post(s.url, "192.0.2.50", { country: "US", state: "TX" })).status, 200);
    assert.equal((await post(s.url, "2001:db8::1", { country: "CA" })).status, 200);
    assert.equal((await post(s.url, "203.0.113.20", { country: "ZZ" })).status, 200);               // "Other" matches DE
    assert.equal(stripe.calls.length, 3);
    for (const p of stripe.calls) { assert.equal(p.billing_address_collection, "required"); assert.equal(p.subscription_data.metadata.billing_check, "pending"); }
  } finally { s.close(); }
});

test("GEO_PREVIEW_BYPASS: works in preview only; production refuses to start (app and guard)", async () => {
  assert.equal(previewBypass({ APP_ENV: "preview", GEO_PREVIEW_BYPASS: "true" }), true);
  assert.equal(previewBypass({ APP_ENV: "production", GEO_PREVIEW_BYPASS: "true" }), false);
  assert.throws(() => assertGeoEnv({ APP_ENV: "production", GEO_PREVIEW_BYPASS: "true" }), /refusing to start/);
  assert.doesNotThrow(() => assertGeoEnv({ APP_ENV: "production" }));
  await assert.rejects(createApp({ env: { APP_ENV: "production", GEO_PREVIEW_BYPASS: "1" }, geoLookup: null, log: quiet }), /refusing to start/);
  const g = spawnSync(process.execPath, [path.join(ROOT, "scripts/guard.mjs")], { env: { PATH: process.env.PATH, APP_ENV: "production", GEO_PREVIEW_BYPASS: "true" }, encoding: "utf8" });
  assert.equal(g.status, 1); assert.match(g.stderr, /GEO_PREVIEW_BYPASS/);
  const ok = spawnSync(process.execPath, [path.join(ROOT, "scripts/guard.mjs")], { env: { PATH: process.env.PATH, APP_ENV: "preview", GEO_PREVIEW_BYPASS: "true" }, encoding: "utf8" });
  assert.equal(ok.status, 0);
  // preview + bypass + no DB: checkout possible, but the declared blocklist still applies
  const stripe = mock(); const logs = [];
  const s = await serve(await createApp({ env: { ...payEnv, GEO_PREVIEW_BYPASS: "true" }, stripe, geoLookup: null, log: (m) => logs.push(m) }));
  try {
    assert.ok(logs.some((m) => /GEO_PREVIEW_BYPASS on/.test(m)));
    assert.equal((await (await fetch(s.url + "/api/config")).json()).checkout.available, true);
    assert.equal((await post(s.url, "192.0.2.99", { country: "US", state: "TX" })).status, 200);
    assert.equal((await post(s.url, "192.0.2.99", { country: "US", state: "UT" })).status, 451);
    assert.equal(stripe.calls[0].subscription_data.metadata.geo_bypass, "preview");
  } finally { s.close(); }
});

test("no paid access until the webhook billing check passed", async () => {
  const stripe = mock();
  let meta = { billing_check: "pending" };
  stripe.checkout.sessions.retrieve = async (id) => ({ id, status: "complete", subscription: { id: "sub_9", status: "active", metadata: meta } });
  const s = await serve(await createApp({ env: payEnv, stripe, geoLookup: fresh(), log: quiet }));
  try {
    const me = async () => (await fetch(s.url + "/api/me", { headers: { "X-PS-Session": "cs_test_abc" } })).json();
    let j = await me(); assert.equal(j.subscriber, false); assert.equal(j.billingCheck, "pending");
    assert.equal((await fetch(s.url + "/api/predictions", { headers: { "X-PS-Session": "cs_test_abc" } })).status, 403);
    meta = {}; assert.equal((await me()).subscriber, false); // no marker at all -> no access
    meta = { billing_check: "passed" }; j = await me(); assert.equal(j.subscriber, true);
  } finally { s.close(); }
});

test("/api/config has no internal notes; 404s for unknown routes, /refunds and placeholder games; robots + sitemap", async () => {
  const s = await serve(await createApp({ env: { APP_ENV: "preview" }, geoLookup: fresh(), log: quiet }));
  try {
    const cfg = await (await fetch(s.url + "/api/config")).json();
    assert.ok(!JSON.stringify(cfg).includes("_note"));
    for (const p of ["/nope", "/refunds", "/game/placeholder", "/games/2026-01-01/foo-vs-bar", "/track-record/x"]) assert.equal((await fetch(s.url + p)).status, 404, p);
    for (const p of ["/", "/track-record/", "/contact", "/account", "/subscribe"]) assert.equal((await fetch(s.url + p, { headers: { "x-forwarded-for": "192.0.2.50" } })).status, 200, p);
    const rb = await fetch(s.url + "/robots.txt"); assert.equal(rb.status, 200); assert.match(rb.headers.get("content-type"), /text\/plain/);
    assert.match(await rb.text(), /Disallow: \//); // preview is not indexable
    const sm = await fetch(s.url + "/sitemap.xml"); assert.equal(sm.status, 200);
    const x = await sm.text(); assert.match(x, /<urlset/); assert.match(x, /\/track-record<\/loc>/); assert.ok(!x.includes("/account"));
  } finally { s.close(); }
  const p = await serve(await createApp({ env: { APP_ENV: "production", PUBLIC_BASE_URL: "https://proswisher.com" }, geoLookup: fresh(), log: quiet }));
  try {
    const t = await (await fetch(p.url + "/robots.txt")).text();
    assert.match(t, /Sitemap: https:\/\/proswisher.com\/sitemap.xml/); assert.match(t, /Disallow: \/api\//);
  } finally { p.close(); }
});

test("451 block page carries the full footer disclaimer and never the support address", async () => {
  const commerce = (await import("../../src/config/commerce.json", { with: { type: "json" } })).default;
  const s = await serve(await createApp({ env: payEnv, stripe: mock(), geoLookup: fresh(), log: quiet }));
  try {
    const r = await fetch(s.url + "/subscribe", { headers: { "x-forwarded-for": "198.51.100.20" } });
    assert.equal(r.status, 451);
    const h = await r.text();
    assert.ok(h.includes(commerce.disclaimers.footer)); assert.ok(!h.includes("support@"));
    assert.equal((h.match(/<h1/g) || []).length, 1);
  } finally { s.close(); }
});
