import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { purgeConsent } from "../../server/consent-purge.mjs";

test("R4: consent IP kept for subscription life + 4 years, then purged from consent.jsonl and Stripe metadata", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psw-consent-"));
  const yr = (y) => Math.floor(Date.UTC(y, 0, 1) / 1000);
  const recs = [
    { consent_at: "2026-11-01T00:00:00Z", consent_ip: "198.51.100.1", checkout_session: "cs_test_active" },
    { consent_at: "2026-11-01T00:00:00Z", consent_ip: "198.51.100.2", checkout_session: "cs_test_endedold" },
    { consent_at: "2026-11-01T00:00:00Z", consent_ip: "198.51.100.3", checkout_session: "cs_test_endedrecent" },
    { consent_at: "2026-11-01T00:00:00Z", consent_ip: "198.51.100.4", checkout_session: "cs_test_abandoned" },
  ];
  fs.writeFileSync(path.join(dir, "consent.jsonl"), recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const subs = { cs_test_active: { id: "sub_a", status: "active", ended_at: null }, cs_test_endedold: { id: "sub_b", ended_at: yr(2027) }, cs_test_endedrecent: { id: "sub_c", ended_at: yr(2029) } };
  const calls = [];
  const stripe = {
    checkout: { sessions: { retrieve: async (id) => ({ id, subscription: subs[id] || null }) } },
    subscriptions: { update: async (id, p) => { calls.push([id, p]); return {}; } },
  };
  const r = await purgeConsent({ dir, stripe, now: () => new Date("2031-06-01T00:00:00Z"), log: () => {} });
  assert.deepEqual(r, { checked: 4, purged: 2 });
  const out = fs.readFileSync(path.join(dir, "consent.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(out.map((o) => o.consent_ip), ["198.51.100.1", null, "198.51.100.3", null]);
  assert.ok(out[1].consent_ip_purged_at);
  assert.deepEqual(calls, [["sub_b", { metadata: { consent_ip: "" } }]]);
  fs.rmSync(dir, { recursive: true });
});
