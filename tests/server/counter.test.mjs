import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCounter, utmCombo, truncateIp, applyRetention, msToNextCtMidnight, UTM_ALLOW } from "../../server/counter.mjs";

const U = { utm_source: "x", utm_medium: "organic_social", utm_campaign: "psw_launch_2026", utm_content: "x_free_d2_v1" };
const KEY = "x|organic_social|psw_launch_2026|x_free_d2_v1";
const LAYE = ["x_bio_v1", "x_launch_v1", "x_free_d2_v1", "x_free_d3_v1", "x_free_d4_v1", "x_free_d5_v1", "x_free_d7_v1",
  "x_members_d6_v1", "x_recap_d2_v1", "x_recap_d3_v1", "x_recap_d4_v1", "x_recap_d5_v1", "x_recap_d6_v1", "x_recap_d7_v1"];
const noTimer = () => null;
const mk = (o = {}) => createCounter({ dir: "", setTimer: noTimer, ...o });

test("R6: allowlist covers every Laye psw_launch_2026 tag; anything else is 'other'", () => {
  for (const t of LAYE) assert.equal(utmCombo({ ...U, utm_content: t }), `x|organic_social|psw_launch_2026|${t}`);
  assert.equal(UTM_ALLOW.size, LAYE.length);
  assert.equal(utmCombo(U), KEY);
  assert.equal(utmCombo({}), null);
  assert.equal(utmCombo({ ...U, utm_content: "jane_doe" }), "other");      // per-person tag never stored
  assert.equal(utmCombo({ utm_source: "x", utm_content: "<script>" }), "other");
});

test("R1: IPv4 truncated to /24, IPv6 to /48 before hashing", () => {
  assert.equal(truncateIp("198.51.100.77"), "198.51.100.0/24");
  assert.equal(truncateIp("::ffff:198.51.100.77"), "198.51.100.0/24");
  assert.equal(truncateIp("2001:db8:abcd:12:1::5"), "2001:db8:abcd::/48");
  assert.equal(truncateIp("2001:db8::1"), "2001:db8:0::/48");
  assert.equal(truncateIp("garbage"), "invalid");
  const c = mk(); // same /24 + same UA -> one id; different /24 -> another
  c.visit("198.51.100.1", "ua"); c.visit("198.51.100.200", "ua"); c.visit("198.51.101.1", "ua");
  c.visit("2001:db8:abcd:1::1", "ua"); c.visit("2001:db8:abcd:ffff::9", "ua");
  assert.equal(c.report().uniqueVisitorsPerDay[c.report().today], 3);
});

test("UTM unique visitors + same-visit CTA attribution; cells under 5 shown as '<5'", () => {
  let t = new Date("2026-10-27T18:00:00Z");
  const c = mk({ now: () => t });
  for (let i = 1; i <= 6; i++) c.visit(`198.51.${i}.1`, "ua", { utm: U });
  c.visit("198.51.1.1", "ua", { utm: U });                 // repeat -> still 6
  c.visit("203.0.113.3", "ua3");                           // untagged
  c.click("198.51.1.1", "ua"); c.click("203.0.113.3", "ua3");
  t = new Date(t.getTime() + 31 * 60000);
  c.click("198.51.2.1", "ua");                             // >30 min later: not attributed
  const r = c.report(), d = r.today;
  assert.equal(r.utmUniqueVisitorsPerDay[d][KEY], 6);
  assert.equal(r.utmAttributedCtaClicksPerDay[d][KEY], "<5");
  assert.equal(r.ctaClicksPerDay[d], 3);
  c.stop();
});

test("R2: salt rotates on a CT-midnight timer (unref'd), and is never persisted or reported", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psw-cnt-"));
  let t = new Date("2026-10-27T18:00:00Z"); const timers = [];
  const setTimer = (fn, ms) => { const h = { fn, ms, unref() { this.unrefd = true; } }; timers.push(h); return h; };
  const c = createCounter({ dir, now: () => t, setTimer });
  assert.equal(timers.length, 1); assert.ok(timers[0].unrefd);
  assert.equal(timers[0].ms, msToNextCtMidnight(t) + 1000);
  assert.ok(Math.abs(timers[0].ms - (11 * 3600 + 1) * 1000) < 61000);       // 13:00 CDT -> ~11h to midnight
  c.visit("198.51.100.1", "ua", { utm: U });
  t = new Date("2026-10-28T05:00:30Z"); timers[0].fn();                     // midnight fires, no traffic needed
  assert.equal(timers.length, 2);
  c.visit("198.51.100.1", "ua");                                             // same person: new id on the new day
  c.flush();
  const files = fs.readdirSync(dir); assert.deepEqual(files, ["counts.json"]);
  const raw = fs.readFileSync(path.join(dir, "counts.json"), "utf8");
  const days = JSON.parse(raw).days;
  assert.equal(days["2026-10-27"].visitors, 1); assert.equal(days["2026-10-28"].visitors, 1);
  // nothing salt-like (hex/base64 >= 32 chars) persisted, reported, or in the environment
  const big = /[A-Fa-f0-9]{32,}|[A-Za-z0-9+/]{40,}={0,2}/;
  assert.ok(!big.test(raw)); assert.ok(!big.test(JSON.stringify(c.report())));
  assert.ok(!Object.keys(process.env).some((k) => /SALT/i.test(k)));
  fs.rmSync(dir, { recursive: true });
});

test("R3: only aggregate counts are stored (no ids, IPs, UAs, timestamps of visits)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psw-cnt-"));
  const c = createCounter({ dir, setTimer: noTimer });
  c.visit("198.51.100.23", "Mozilla/5.0 Secret-UA", { featuredView: true, utm: U });
  c.visit("2001:db8:abcd:12::99", "Other-UA");
  c.click("198.51.100.23", "Mozilla/5.0 Secret-UA");
  c.flush();
  const stored = JSON.parse(fs.readFileSync(path.join(dir, "counts.json"), "utf8"));
  const walk = (v, p = "") => {
    if (typeof v === "number") return;
    assert.equal(typeof v, "object", `non-count leaf at ${p}`);
    for (const [k, x] of Object.entries(v)) {
      if (k === "version") continue;
      assert.match(k, /^(\d{4}-\d{2}(-\d{2})?|visitors|featuredViewers|ctaClicks|utmVisitors|utmCtaClicks|days|utmMonthly|other|[\w.-]+(\|[\w.-]+){3}|[\w.-]+(\|[\w.-]+){2})$/, `key ${k}`);
      walk(x, p + "/" + k);
    }
  };
  walk(stored);
  const txt = JSON.stringify(stored);
  for (const bad of ["198.51", "2001:db8", "Secret-UA", "Other-UA", "Mozilla"]) assert.ok(!txt.includes(bad), bad);
  assert.ok(!/[a-f0-9]{16,}/.test(txt));
  fs.rmSync(dir, { recursive: true });
});

test("R4: UTM rows > 30 days roll up monthly by campaign (content dropped); > 25 months deleted", () => {
  const hist = { version: 2, utmMonthly: { "2024-08": { "x|organic_social|old": { visitors: 9, ctaClicks: 1 } } }, days: {
    "2024-08-15": { visitors: 5, featuredViewers: 1, ctaClicks: 0 },
    "2024-10-01": { visitors: 7, featuredViewers: 2, ctaClicks: 1 },
    "2026-09-10": { visitors: 9, featuredViewers: 3, ctaClicks: 2, utmVisitors: { [KEY]: 6, other: 2 }, utmCtaClicks: { [KEY]: 2 } },
    "2026-09-11": { visitors: 9, featuredViewers: 3, ctaClicks: 2, utmVisitors: { "x|organic_social|psw_launch_2026|x_bio_v1": 3 } },
    "2026-10-20": { visitors: 9, featuredViewers: 3, ctaClicks: 2, utmVisitors: { [KEY]: 4 } } } };
  const h = applyRetention(hist, "2026-10-27");
  assert.ok(!h.days["2024-08-15"]); assert.ok(!h.utmMonthly["2024-08"]);       // > 25 months
  assert.ok(h.days["2024-10-01"]);                                             // within 25 months
  assert.equal(h.days["2026-09-10"].utmVisitors, undefined);                   // per-link detail gone
  assert.equal(h.days["2026-09-10"].visitors, 9);                              // daily totals kept
  assert.deepEqual(h.utmMonthly["2026-09"], { "x|organic_social|psw_launch_2026": { visitors: 9, ctaClicks: 2 }, other: { visitors: 2, ctaClicks: 0 } });
  assert.deepEqual(h.days["2026-10-20"].utmVisitors, { [KEY]: 4 });            // < 30 days kept
});

test("disabled counter counts and stores nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psw-cnt-"));
  const c = createCounter({ dir, enabled: false });
  c.visit("198.51.100.1", "ua"); c.click("198.51.100.1", "ua");
  assert.equal(c.flush(), false); assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(c.report().enabled, false);
  fs.rmSync(dir, { recursive: true });
});
