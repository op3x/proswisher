import { test } from "node:test";
import assert from "node:assert/strict";
import { createCounter, utmCombo } from "../../server/counter.mjs";

const U = { utm_source: "x", utm_medium: "organic_social", utm_campaign: "psw_launch_2026", utm_content: "x_free_d2_v1" };
const KEY = "x|organic_social|psw_launch_2026|x_free_d2_v1";

test("utm combo validation", () => {
  assert.equal(utmCombo(U), KEY);
  assert.equal(utmCombo({}), null);
  assert.equal(utmCombo({ utm_source: "x", utm_content: "<script>" }), "x|-|-|-");
});

test("utm unique visitors per day and same-visit CTA attribution (hashed id only)", () => {
  let t = new Date("2026-10-27T18:00:00Z");
  const c = createCounter({ dir: "", now: () => t });
  c.visit("198.51.100.1", "ua1", { utm: U });
  c.visit("198.51.100.1", "ua1", { utm: U });          // same person, same day -> 1
  c.visit("198.51.100.2", "ua2", { utm: U });
  c.visit("198.51.100.3", "ua3");                       // untagged
  c.click("198.51.100.1", "ua1");                       // attributed
  c.click("198.51.100.3", "ua3");                       // untagged visitor -> total only
  t = new Date(t.getTime() + 31 * 60000);
  c.click("198.51.100.2", "ua2");                       // >30 min later: new visit, not attributed
  const r = c.report();
  const d = r.today;
  assert.equal(r.utmUniqueVisitorsPerDay[d][KEY], 2);
  assert.equal(r.utmAttributedCtaClicksPerDay[d][KEY], 1);
  assert.equal(r.ctaClicksPerDay[d], 3);
  assert.ok(!JSON.stringify(r).includes("198.51.100"));
});
