// Ryan 10/31 9:47 PM: the ONLY street address on the site is the configured Op3x mailbox (site.businessAddress),
// with or without "#<digits>", plus the California DCA address inside Larry's exact complaint notice.
// Anything else fails: other street addresses, "#XXX" placeholders, "Unit"/"Suite" forms, P.O. boxes.
// Ryan 9:52 PM: the box number is optional and never blocks a launch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOTS = ["src", "server", "legal", "docs", "index.html", "README.md", ".env.example", "public/site.webmanifest"];
const files = (p) => statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => files(join(p, f))) : [p];
const siteSrc = readFileSync("src/config/site.ts", "utf8");
const STREET = (siteSrc.match(/const ADDRESS_STREET = "([^"]*)"/) || [])[1];
const CITY = (siteSrc.match(/const ADDRESS_CITY = "([^"]*)"/) || [])[1];
const BOX = (siteSrc.match(/const BUSINESS_ADDRESS_BOX: string = "([^"]*)"/) || [])[1];
const CA_NOTICE = "California users: The Complaint Assistance Unit of the Division of Consumer Services of the California Department of Consumer Affairs may be contacted in writing at 1625 North Market Blvd., Suite N 112, Sacramento, CA 95834, or by telephone at (916) 445-1254 or (800) 952-5210.";

// Allowed: the rendered address with or without "#digits", the two config source lines, the exact CA notice.
const ALLOWED = [/5970 E State St(?: #\d+)?, Rockford, IL 61108/g, /const ADDRESS_STREET = "5970 E State St";/g, /const ADDRESS_CITY = "Rockford, IL 61108";/g];
const strip = (l) => ALLOWED.reduce((x, re) => x.replace(re, ""), l.split(CA_NOTICE).join(""));

const BAD = [
  /mailing address|MAILING[_ ]ADDRESS|LEGAL[_ ]ADDRESS|physical address|\[address\]|mailingAddress/i, // placeholders
  /#X{2,}\b/,                                                                                      // "#XXX" box placeholder
  /P\.?\s?O\.?\s?Box/i,
  /\b(Unit|Suite|Ste\.?|Apt\.?)\s*#?\s*[A-Z]?\s?\d/,                                                // Unit/Suite forms
  /\b\d{2,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][a-z]+\.?\s+){1,3}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Hwy|Pkwy|Pl)\b\.?/, // street lines
  /\b[A-Z]{2}\s\d{5}(?:-\d{4})?\b/,                                                                // "IL 61108"-style state+ZIP
];
const RULE_TALK = /no physical address|physical address comes later|no (street|mailing|physical)/i;
const bad = (s) => BAD.some((re) => re.test(strip(s)));

test("address config: fixed street/city, box digits-only or empty, CA notice exact", () => {
  assert.equal(STREET, "5970 E State St");
  assert.equal(CITY, "Rockford, IL 61108");
  assert.ok(BOX !== undefined, "BUSINESS_ADDRESS_BOX must exist");
  assert.match(BOX, /^(\d+)?$/, "box number is digits only, or empty");
  assert.match(siteSrc, /businessAddressBox: BUSINESS_ADDRESS_BOX/);
  assert.ok(siteSrc.includes(CA_NOTICE), "caComplaintNotice must be Larry's exact text");
});

test("no other address (or placeholder, #XXX, Unit/Suite) in site source, legal text or docs", () => {
  const hits = [];
  for (const r of ROOTS) for (const f of files(r)) {
    if (!/\.(tsx?|mjs|js|json|md|html|example|webmanifest)$/.test(f)) continue;
    readFileSync(f, "utf8").split("\n").forEach((l, i) => {
      if (bad(l) && !RULE_TALK.test(strip(l))) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("the patterns allow exactly the configured address and still catch everything else", () => {
  for (const s of ["123 Main St", "5970 E State St Unit 12", "5970 E State St, Suite 200", "5970 E State St #XXX, Rockford, IL 61108",
    "#XXX", "5970 E State St #, Rockford, IL 61108", "P.O. Box 9", "[OP3X MAILING ADDRESS]", "Springfield, IL 62701",
    "Suite N 112", "100 W State St, Rockford, IL 61108", "1625 North Market Blvd., Suite N 112, Sacramento, CA 95834"]) assert.ok(bad(s), s);
  for (const s of ["5970 E State St, Rockford, IL 61108", "5970 E State St #123, Rockford, IL 61108", CA_NOTICE,
    "Op3x LLC · 5970 E State St, Rockford, IL 61108 · support@simculus.com"]) assert.ok(!bad(s), s);
});

test("TODO(box-number) is tracked but never blocks a launch: preview and production guards both pass", () => {
  assert.match(siteSrc, /TODO\(box-number\)/);
  // (production also needs the Terms effective date since the 10:31 PM release check; that's not what this test is about)
  const run = (APP_ENV) => spawnSync(process.execPath, ["scripts/guard.mjs"], { env: { PATH: process.env.PATH, APP_ENV, LEGAL_EFFECTIVE_TERMS: "2026-11-01" }, encoding: "utf8" });
  assert.equal(run("preview").status, 0);
  assert.equal(run("production").status, 0);
});
