// Larry 10/31 10:31 PM round 3: (1) /account "Cancel subscription" deep-links into the Stripe portal cancel flow;
// "Paid on another device?" portal login link (hidden when unset); (2) release checks + terms_effective in consent.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { createApp } from "../../server/index.mjs";
import { releaseProblems, portalLoginUrl } from "../../server/release.mjs";
import { ON_LAUNCH } from "../../server/legal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const TEST_KEY = ["rk", "test", "fixture000"].join("_");
const LIVE_KEY = ["rk", "live", "fixture000"].join("_");
const LOGIN = "https://billing.stripe.com/p/login/" + ["test", "fixture00"].join("_");
const quiet = () => {};
const serve = async (app) => { const srv = app.listen(0); await new Promise((r) => srv.once("listening", r)); return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }; };
const payEnv = { APP_ENV: "preview", STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: "fixture-signing-secret", STRIPE_PRICE_ID: "price_fixture", PUBLIC_BASE_URL: "https://preview.example" };

function portalStripe(sessions) {
  const calls = [];
  return { calls, webhooks: new Stripe(TEST_KEY).webhooks,
    checkout: { sessions: { retrieve: async (id) => { if (!sessions[id]) { const e = new Error("No such checkout.session"); e.type = "StripeInvalidRequestError"; e.statusCode = 404; throw e; } return sessions[id]; } } },
    billingPortal: { sessions: { create: async (p) => { calls.push(p); return { url: "https://billing.stripe.test/session/x" }; } } } };
}
const post = (s, body) => fetch(s.url + "/api/portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("cancel button: portal session with flow_data subscription_cancel for the recognized buyer's subscription", async () => {
  const stripe = portalStripe({
    cs_test_active: { id: "cs_test_active", status: "complete", customer: "cus_fixture", subscription: { id: "sub_fixture", status: "active", cancel_at_period_end: false, metadata: { billing_check: "passed" } } },
    cs_test_ending: { id: "cs_test_ending", status: "complete", customer: { id: "cus_two" }, subscription: { id: "sub_two", status: "active", cancel_at_period_end: true, metadata: {} } },
  });
  const s = await serve(await createApp({ env: payEnv, stripe, geoLookup: () => null, log: quiet }));
  try {
    const r = await post(s, { session_id: "cs_test_active", flow: "cancel" });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { url: "https://billing.stripe.test/session/x", flow: "cancel" });
    assert.deepEqual(stripe.calls[0], { customer: "cus_fixture", return_url: "https://preview.example/account",
      flow_data: { type: "subscription_cancel", subscription_cancel: { subscription: "sub_fixture" },
        after_completion: { type: "redirect", redirect: { return_url: "https://preview.example/account?canceled=1" } } } });
    // "Manage subscription" = the plain portal, no flow_data
    const m = await post(s, { session_id: "cs_test_active", flow: "manage" });
    assert.equal((await m.json()).flow, "manage");
    assert.deepEqual(stripe.calls[1], { customer: "cus_fixture", return_url: "https://preview.example/account" });
    // already set to end: Stripe would refuse the cancel flow, so it opens the plain portal
    const e = await post(s, { session_id: "cs_test_ending", flow: "cancel" });
    assert.equal((await e.json()).flow, "manage"); assert.equal(stripe.calls[2].flow_data, undefined); assert.equal(stripe.calls[2].customer, "cus_two");
    // unknown buyer: no portal session; login link is null while STRIPE_PORTAL_LOGIN_URL is unset (link hidden)
    const u = await post(s, { session_id: "cs_test_nobody", flow: "cancel" });
    assert.equal(u.status, 404); assert.deepEqual(await u.json(), { error: "not_found", loginUrl: null });
    assert.equal(stripe.calls.length, 3);
    const cfg = await (await fetch(s.url + "/api/config")).json();
    assert.equal(cfg.portalLoginUrl, null);
  } finally { s.close(); }
});

test("'Paid on another device?' login link: exposed only when it's a billing.stripe.com/p/login link", async () => {
  assert.equal(portalLoginUrl({}), null);
  assert.equal(portalLoginUrl({ STRIPE_PORTAL_LOGIN_URL: "https://evil.example/p/login/x" }), null);
  assert.equal(portalLoginUrl({ STRIPE_PORTAL_LOGIN_URL: "https://billing.stripe.com/p/session/x" }), null);
  assert.equal(portalLoginUrl({ STRIPE_PORTAL_LOGIN_URL: ` ${LOGIN} ` }), LOGIN);
  const stripe = portalStripe({});
  const s = await serve(await createApp({ env: { ...payEnv, STRIPE_PORTAL_LOGIN_URL: LOGIN }, stripe, geoLookup: () => null, log: quiet }));
  try {
    assert.equal((await (await fetch(s.url + "/api/config")).json()).portalLoginUrl, LOGIN);
    const u = await post(s, { session_id: "cs_test_nobody", flow: "cancel" });
    assert.equal(u.status, 404); assert.equal((await u.json()).loginUrl, LOGIN);
    assert.equal((await fetch(s.url + "/cancel")).status, 200, "/cancel is served");
  } finally { s.close(); }
  // payments off: config still carries the link (Account shows it when no buyer is recognized)
  const off = await serve(await createApp({ env: { STRIPE_PORTAL_LOGIN_URL: LOGIN }, geoLookup: () => null, log: quiet }));
  try { assert.equal((await (await fetch(off.url + "/api/config")).json()).portalLoginUrl, LOGIN); } finally { off.close(); }
  // UI wiring: Account (unrecognized), /cancel and the footer all render the same component; it hides itself when unset
  const comp = read("src/components/OtherDeviceCancel.tsx");
  assert.match(comp, /if \(!url\) return null/);
  assert.match(read("src/config/site.ts"), /otherDeviceCancel: "Paid on another device\? Cancel here"/);
  for (const f of ["src/pages/Account.tsx", "src/pages/Cancel.tsx", "src/components/Layout.tsx"]) assert.match(read(f), /<OtherDeviceCancel/, f);
  assert.match(read("src/pages/Account.tsx"), /status === "none"\) && <p[^>]*><OtherDeviceCancel/);
  assert.match(read("src/pages/Account.tsx"), /portal\("cancel"\)[^\n]*>Cancel subscription</);
  assert.match(read("src/pages/Account.tsx"), /portal\("manage"\)[^\n]*>Manage subscription</);
  assert.match(read("src/main.tsx"), /path="cancel"/);
});

test("Terms §5(c) is Larry's 10:31 PM text + 10:44 PM sentence, word for word", () => {
  const t = read("src/content/terms-v2.md");
  assert.ok(t.includes(`**(c) Cancel online any time.** Go to Account settings (https://simculus.com/account) and choose Cancel subscription, then confirm. If you're on a different device, use the "Paid on another device?" link there and we'll email you a code to sign in and cancel. No call is required. You can also email support@simculus.com from your account email with the word "cancel" and we'll cancel it within one business day. Cancelling stops future charges; you keep access through the end of the period you've already paid for, and you'll see a confirmation on screen.\n`));
  assert.ok(!/one click/.test(t));
  assert.ok(!/did our lean|Against the spread/.test(t), "§9: legacy lean sentence dropped (no public legacy record)");
  const email = read("docs/email/subscription-confirmation-DRAFT.md");
  assert.ok(email.includes(`Go to Account settings (https://simculus.com/account) and choose Cancel subscription, then confirm. If you're on a different device, use the "Paid on another device?" link there and we'll email you a code to sign in and cancel. No call is required.`));
  assert.ok(email.includes("for information only.") && !/entertainment/i.test(email));
  assert.ok(email.includes("Simculus is operated by Op3x LLC. Questions? support@simculus.com"));
  assert.ok(email.includes("Refunds. You can cancel anytime online"));
});

test("release checks: production refuses empty/invalid effective date and payments-on without the login link", async () => {
  assert.deepEqual(releaseProblems({ APP_ENV: "preview" }), []);
  assert.deepEqual(releaseProblems({}), []);
  const p0 = releaseProblems({ APP_ENV: "production" });
  assert.equal(p0.length, 2); assert.match(p0[0], /LEGAL_EFFECTIVE_TERMS is empty/); assert.match(p0[1], /LEGAL_EFFECTIVE_PRIVACY_A is empty/);
  assert.match(releaseProblems({ APP_ENV: "production", LEGAL_EFFECTIVE_TERMS: "Nov 1" })[0], /not a YYYY-MM-DD/);
  // Larry 10:55 PM: privacy-a3 gets the same release check
  assert.deepEqual(releaseProblems({ APP_ENV: "production", LEGAL_EFFECTIVE_TERMS: "2026-11-01" }).map((x) => x.split(" ")[0]), ["LEGAL_EFFECTIVE_PRIVACY_A"]);
  assert.match(releaseProblems({ APP_ENV: "production", LEGAL_EFFECTIVE_TERMS: "2026-11-01", LEGAL_EFFECTIVE_PRIVACY_A: "Nov 1" })[0], /LEGAL_EFFECTIVE_PRIVACY_A is not a YYYY-MM-DD/);
  assert.deepEqual(releaseProblems({ APP_ENV: "production", LEGAL_EFFECTIVE_TERMS: "2026-11-01", LEGAL_EFFECTIVE_PRIVACY_A: "2026-11-01" }), []); // payments off: link not required
  const live = { APP_ENV: "production", LEGAL_EFFECTIVE_TERMS: "2026-11-01", LEGAL_EFFECTIVE_PRIVACY_A: "2026-11-01", STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: "x", STRIPE_PRICE_ID: "price_x", STRIPE_LIVE_ENABLED: "true" };
  assert.match(releaseProblems(live).join(), /STRIPE_PORTAL_LOGIN_URL/);
  assert.deepEqual(releaseProblems({ ...live, STRIPE_PORTAL_LOGIN_URL: LOGIN }), []);
  // startup refuses
  await assert.rejects(createApp({ env: { APP_ENV: "production" }, geoLookup: () => null, log: quiet }), /REFUSING production/);
  // build/start guard refuses (prebuild + prestart run scripts/guard.mjs); values never printed
  const g = spawnSync(process.execPath, [path.join(ROOT, "scripts/guard.mjs")], { env: { PATH: process.env.PATH, APP_ENV: "production", LEGAL_EFFECTIVE_TERMS: "" }, encoding: "utf8" });
  assert.equal(g.status, 1); assert.match(g.stdout + g.stderr, /LEGAL_EFFECTIVE_TERMS/);
  const gp = spawnSync(process.execPath, [path.join(ROOT, "scripts/guard.mjs")], { env: { PATH: process.env.PATH, APP_ENV: "production", LEGAL_EFFECTIVE_TERMS: "2026-11-01" }, encoding: "utf8" });
  assert.equal(gp.status, 1); assert.match(gp.stdout + gp.stderr, /LEGAL_EFFECTIVE_PRIVACY_A/);
  const ok = spawnSync(process.execPath, [path.join(ROOT, "scripts/guard.mjs")], { env: { PATH: process.env.PATH, APP_ENV: "production", LEGAL_EFFECTIVE_TERMS: "2026-11-01", LEGAL_EFFECTIVE_PRIVACY_A: "2026-11-01" }, encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const pv = spawnSync(process.execPath, [path.join(ROOT, "scripts/guard.mjs")], { env: { PATH: process.env.PATH, APP_ENV: "preview" }, encoding: "utf8" });
  assert.equal(pv.status, 0, pv.stdout + pv.stderr);
});

test("consent record stores the Terms and Privacy versions + effective dates (jsonl + both Stripe metadata)", async () => {
  for (const [env, want] of [[{ ...payEnv }, ON_LAUNCH],
    [{ ...payEnv, APP_ENV: "production", STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_LIVE_ENABLED: "true", LEGAL_EFFECTIVE_TERMS: "2026-11-01", LEGAL_EFFECTIVE_PRIVACY_A: "2026-11-01", STRIPE_PORTAL_LOGIN_URL: LOGIN }, "November 1, 2026"]]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psw-eff-")); const calls = [];
    const stripe = { webhooks: new Stripe(TEST_KEY).webhooks, checkout: { sessions: { create: async (p) => { calls.push(p); return { id: "cs_test_eff", url: "https://checkout.stripe.test/x" }; } } } };
    const s = await serve(await createApp({ env: { ...env, CONSENT_DIR: dir }, stripe, geoLookup: (ip) => (ip === "192.0.2.77" ? { country: "US", region: "TX" } : null), log: quiet }));
    try {
      const r = await fetch(s.url + "/api/checkout", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.77" }, body: JSON.stringify({ consent: true, age21: true, country: "US", state: "TX" }) });
      assert.equal(r.status, 200, env.APP_ENV);
      const rec = JSON.parse(fs.readFileSync(path.join(dir, "consent.jsonl"), "utf8").trim());
      for (const m of [rec, calls[0].metadata, calls[0].subscription_data.metadata]) { assert.equal(m.terms_version, "terms-v2"); assert.equal(m.terms_effective, want); assert.equal(m.privacy_version, "privacy-a3"); assert.equal(m.privacy_effective, want); }
    } finally { s.close(); fs.rmSync(dir, { recursive: true }); }
  }
});
