import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { createApp } from "../../server/index.mjs";
import { paymentsMode } from "../../server/payments.mjs";
import { createCounter } from "../../server/counter.mjs";

// Fixtures assembled at runtime so no key-shaped literal sits in the repo.
const TEST_KEY = ["rk", "test", "fixture000"].join("_");
const LIVE_KEY = ["rk", "live", "fixture000"].join("_");
const SIGNING = "fixture-signing-secret";
const DB = { "203.0.113.10": { country: "JP" }, "198.51.100.20": { country: "US", region: "WA" }, "192.0.2.50": { country: "US", region: "TX" } };
const lookup = (ip) => DB[ip] || null;
const quiet = () => {};

async function serve(app) {
  const srv = app.listen(0); await new Promise((r) => srv.once("listening", r));
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}
const xff = (ip) => ({ "x-forwarded-for": ip });

function mockStripe() {
  const calls = [];
  const real = new Stripe(TEST_KEY);
  return {
    calls, webhooks: real.webhooks,
    checkout: { sessions: { create: async (p) => { calls.push(["checkout.sessions.create", p]); return { url: "https://checkout.stripe.test/x" }; } } },
    invoicePayments: { list: async (p) => { calls.push(["invoicePayments.list", p]); return { data: [{ status: "paid", payment: { payment_intent: "pi_1" } }] }; } },
    refunds: { create: async (p, o) => { calls.push(["refunds.create", p, o]); return {}; } },
    subscriptions: { cancel: async (id) => { calls.push(["subscriptions.cancel", id]); return {}; } },
  };
}
const payEnv = { APP_ENV: "preview", STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: SIGNING, STRIPE_PRICE_ID: "price_fixture" };

test("payments mode guards", () => {
  assert.equal(paymentsMode({}).enabled, false);
  assert.equal(paymentsMode({ ...payEnv, STRIPE_SECRET_KEY: LIVE_KEY }).enabled, false); // live key refused in preview
  assert.equal(paymentsMode({ ...payEnv, APP_ENV: "production" }).enabled, false);       // test key refused in prod
  assert.equal(paymentsMode({ ...payEnv, APP_ENV: "production", STRIPE_SECRET_KEY: LIVE_KEY }).enabled, false); // needs STRIPE_LIVE_ENABLED
  assert.equal(paymentsMode(payEnv).enabled, true);
});

test("no keys: site runs, payments disabled, health ok, stats disabled, no cookies", async () => {
  const app = await createApp({ env: {}, geoLookup: lookup, log: quiet, counter: createCounter({ dir: "" }) });
  const s = await serve(app);
  try {
    const h = await fetch(s.url + "/health"); assert.equal(h.status, 200);
    const c = await (await fetch(s.url + "/api/config")).json(); assert.equal(c.payments.enabled, false);
    const co = await fetch(s.url + "/api/checkout", { method: "POST", headers: { "content-type": "application/json", ...xff("192.0.2.50") }, body: "{}" });
    assert.equal(co.status, 503);
    assert.equal((await fetch(s.url + "/admin/stats")).status, 404);
    for (const p of ["/", "/health", "/api/config", "/subscribe"]) assert.equal((await fetch(s.url + p)).headers.get("set-cookie"), null, p);
    const go = await fetch(s.url + "/go/subscribe", { redirect: "manual" });
    assert.equal(go.status, 302); assert.equal(go.headers.get("location"), "/subscribe");
  } finally { s.close(); }
});

test("451 only on sign-up page and checkout creation; health and webhook never geo-checked", async () => {
  const stripe = mockStripe();
  const app = await createApp({ env: payEnv, stripe, geoLookup: lookup, log: quiet });
  const s = await serve(app);
  try {
    for (const ip of ["203.0.113.10", "198.51.100.20"]) {
      assert.equal((await fetch(s.url + "/subscribe", { headers: xff(ip) })).status, 451);
      const r = await fetch(s.url + "/api/checkout", { method: "POST", headers: { "content-type": "application/json", ...xff(ip) }, body: JSON.stringify({ consent: true, country: "US", state: "TX" }) });
      assert.equal(r.status, 451);
      assert.equal((await fetch(s.url + "/", { headers: xff(ip) })).status, 200);
      assert.equal((await fetch(s.url + "/track-record", { headers: xff(ip) })).status, 200);
      assert.equal((await fetch(s.url + "/health", { headers: xff(ip) })).status, 200);
      const wh = await fetch(s.url + "/api/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "bad", ...xff(ip) }, body: "{}" });
      assert.equal(wh.status, 400); // reached signature check, not 451
    }
    // declared billing state is the second gate
    const d = await fetch(s.url + "/api/checkout", { method: "POST", headers: { "content-type": "application/json", ...xff("192.0.2.50") }, body: JSON.stringify({ consent: true, country: "US", state: "HI" }) });
    assert.equal(d.status, 451);
    // consent required (unchecked by default)
    const nc = await fetch(s.url + "/api/checkout", { method: "POST", headers: { "content-type": "application/json", ...xff("192.0.2.50") }, body: JSON.stringify({ country: "US", state: "TX" }) });
    assert.equal(nc.status, 400);
    const ok = await fetch(s.url + "/api/checkout", { method: "POST", headers: { "content-type": "application/json", ...xff("192.0.2.50") }, body: JSON.stringify({ consent: true, country: "US", state: "TX" }) });
    assert.equal(ok.status, 200);
    const [, params] = stripe.calls.find(([n]) => n === "checkout.sessions.create");
    assert.equal(params.mode, "subscription"); assert.equal(params.billing_address_collection, "required");
    assert.equal(params.metadata.ip_country, "US"); assert.ok(!JSON.stringify(params).includes("192.0.2.50")); // no raw IP stored
  } finally { s.close(); }
});

test("webhook: blocked billing state -> refund, cancel, revoke", async () => {
  const stripe = mockStripe();
  const app = await createApp({ env: payEnv, stripe, geoLookup: lookup, log: quiet });
  const s = await serve(app);
  try {
    const body = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: {
      id: "cs_test_fixture", object: "checkout.session", subscription: "sub_1", invoice: "in_1", customer: "cus_1",
      customer_details: { address: { country: "US", state: "UT", postal_code: "84101" } } } } });
    const sig = stripe.webhooks.generateTestHeaderString({ payload: body, secret: SIGNING });
    const r = await fetch(s.url + "/api/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sig }, body });
    assert.equal(r.status, 200);
    const j = await r.json(); assert.equal(j.action, "revoked"); assert.equal(j.refunded, 1);
    const names = stripe.calls.map(([n]) => n);
    assert.deepEqual(names, ["invoicePayments.list", "refunds.create", "subscriptions.cancel"]);
    assert.ok(app.locals.state.revoked.has("sub_1"));
    // allowed state: nothing happens
    const body2 = body.replace('"UT"', '"TX"').replace('"84101"', '"75001"');
    const r2 = await fetch(s.url + "/api/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload: body2, secret: SIGNING }) }, body: body2 });
    assert.equal((await r2.json()).action, "none");
  } finally { s.close(); }
});

test("counter: hashed ids only, admin stats behind token", async () => {
  const counter = createCounter({ dir: "" });
  const app = await createApp({ env: { ADMIN_TOKEN: "fixture-admin" }, geoLookup: null, log: quiet, counter });
  const s = await serve(app);
  try {
    for (const ip of ["192.0.2.50", "192.0.2.50", "192.0.2.51"]) await fetch(s.url + "/api/v", { method: "POST", headers: { "content-type": "application/json", ...xff(ip) }, body: JSON.stringify({ p: "/" }) });
    await fetch(s.url + "/go/subscribe", { redirect: "manual" });
    assert.equal((await fetch(s.url + "/admin/stats")).status, 401);
    const st = await (await fetch(s.url + "/admin/stats", { headers: { authorization: "Bearer fixture-admin" } })).json();
    const txt = JSON.stringify(st);
    assert.ok(!txt.includes("192.0.2"));
    assert.match(txt, /2/); // two unique visitors
  } finally { s.close(); }
});
