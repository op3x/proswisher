// Larry 10:13 rulings: (3) no IP in Checkout Session metadata, only Subscription metadata + consent.jsonl; consent record's
// text_version equals the on-page version strings; effective-date rule; the two copy rulings match the build.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { createApp } from "../../server/index.mjs";
import { sessionsWithIp } from "../../server/consent-purge.mjs";
import { legalEffective, legalVersions, formatEffective, docVersion, ON_LAUNCH } from "../../server/legal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEST_KEY = ["rk", "test", "fixture000"].join("_");
const read = (f) => fs.readFileSync(path.join(ROOT, "src/content", f), "utf8");
const serve = async (app) => { const srv = app.listen(0); await new Promise((r) => srv.once("listening", r)); return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }; };

test("ruling 3: IP goes to Subscription metadata + consent.jsonl, never to Checkout Session metadata; text_version = page versions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psw-consent-"));
  const calls = [];
  const stripe = { webhooks: new Stripe(TEST_KEY).webhooks,
    checkout: { sessions: { create: async (p) => { calls.push(p); return { id: "cs_test_new", url: "https://checkout.stripe.test/x" }; } } } };
  const env = { APP_ENV: "preview", STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: "fixture-signing-secret", STRIPE_PRICE_ID: "price_fixture", CONSENT_DIR: dir };
  const geo = (ip) => (ip === "192.0.2.77" ? { country: "US", region: "TX" } : null); // fail-closed checkout needs a resolvable IP
  const app = await createApp({ env, stripe, geoLookup: geo, log: () => {} });
  const s = await serve(app);
  try {
    const r = await fetch(s.url + "/api/checkout", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.77" },
      body: JSON.stringify({ consent: true, age21: true, country: "US", state: "TX" }) });
    assert.equal(r.status, 200);
    const p = calls[0];
    assert.equal(p.metadata.consent_ip, undefined);
    assert.ok(!JSON.stringify(p.metadata).includes("192.0.2.77"));
    assert.equal(p.subscription_data.metadata.consent_ip, "192.0.2.77");
    const rec = JSON.parse(fs.readFileSync(path.join(dir, "consent.jsonl"), "utf8").trim());
    assert.equal(rec.consent_ip, "192.0.2.77"); assert.equal(rec.checkout_session, "cs_test_new");
    // text_version must equal the version strings printed on the pages (same src/content files)
    const onPage = [read("terms-v1.md"), read("privacy-a.md"), read("privacy-b.md")].map(docVersion);
    assert.deepEqual(onPage, ["terms-v1", "privacy-a2", "privacy-b1"]);
    for (const m of [rec, p.metadata, p.subscription_data.metadata]) assert.equal(m.text_version, onPage.join(","));
    const cfg = await (await fetch(s.url + "/api/config")).json();
    assert.deepEqual(cfg.legal.versions, { terms: "terms-v1", privacyA: "privacy-a2", privacyB: "privacy-b1" });
  } finally { s.close(); fs.rmSync(dir, { recursive: true }); }
});

test("ruling 3 runbook: audit lists Session ids still carrying an IP, never the IP", async () => {
  const sessions = [
    { id: "cs_test_old", created: 1761400000, metadata: { consent_ip: "198.51.100.5" } },
    { id: "cs_test_new", created: 1761500000, metadata: { text_version: "terms-v1" } },
    { id: "cs_test_purged", created: 1761500000, metadata: { consent_ip: "" } },
  ];
  const stripe = { checkout: { sessions: { list: () => (async function* () { yield* sessions; })() } } };
  const out = await sessionsWithIp(stripe);
  assert.deepEqual(out.map((x) => x.id), ["cs_test_old"]);
  assert.ok(!JSON.stringify(out).includes("198.51"));
});

test("effective dates: release-time env in production only; preview says 'Effective on launch'; never hard-coded", () => {
  const vars = { LEGAL_EFFECTIVE_TERMS: "2026-10-26", LEGAL_EFFECTIVE_PRIVACY_A: "2026-10-26" };
  assert.deepEqual(legalEffective({ APP_ENV: "preview", ...vars }), { terms: ON_LAUNCH, privacyA: ON_LAUNCH, privacyB: ON_LAUNCH, refund: ON_LAUNCH });
  const prod = legalEffective({ APP_ENV: "production", ...vars });
  assert.equal(prod.terms, "October 26, 2026"); assert.equal(prod.privacyA, "October 26, 2026");
  assert.equal(prod.privacyB, ON_LAUNCH); assert.equal(prod.refund, ON_LAUNCH);   // §B/refund dated when checkout opens
  assert.equal(formatEffective("2026-3-1"), null);
  for (const f of ["terms-v1.md", "privacy-a.md", "privacy-b.md"]) {
    const t = read(f);
    assert.match(t, /Effective: \{EFFECTIVE\}/, f);
    assert.ok(!/\[DATE\]|20\d\d-\d\d-\d\d|(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d\d/.test(t.split("\n")[1]), f);
  }
  assert.deepEqual(legalVersions(), { terms: "terms-v1", privacyA: "privacy-a2", privacyB: "privacy-b1" });
});

test("Larry copy rulings 1 and 2 match the build", () => {
  const a = read("privacy-a.md"), b = read("privacy-b.md");
  assert.ok(a.includes("Our Track record links to our public prediction log on this site."));
  assert.ok(!/GitHub/.test(a));
  assert.ok(b.includes("To provide the membership:** process your payment through Stripe and recognize your membership in your browser using your Stripe checkout reference."));
  assert.ok(!/Sign-in|sign-in|password/.test(a + b));
});
