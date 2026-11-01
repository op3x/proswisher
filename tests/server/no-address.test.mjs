// Ryan 10/31 9:47 PM: the ONLY street address on the site is the configured Op3x mailbox (site.businessAddress),
// plus the California DCA address inside Larry's exact complaint notice. Anything else fails: other street
// addresses, placeholders, "Unit"/"Suite" forms, P.O. boxes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOTS = ["src", "server", "legal", "docs", "index.html", "README.md", ".env.example", "public/site.webmanifest"];
const files = (p) => statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => files(join(p, f))) : [p];
const siteSrc = readFileSync("src/config/site.ts", "utf8");
const ADDR = (siteSrc.match(/businessAddress:\s*"([^"]*)"/) || [])[1];
const CA_NOTICE = "California users: The Complaint Assistance Unit of the Division of Consumer Services of the California Department of Consumer Affairs may be contacted in writing at 1625 North Market Blvd., Suite N 112, Sacramento, CA 95834, or by telephone at (916) 445-1254 or (800) 952-5210.";

const BAD = [
  /mailing address|MAILING[_ ]ADDRESS|LEGAL[_ ]ADDRESS|physical address|\[address\]|mailingAddress/i, // placeholders
  /P\.?\s?O\.?\s?Box/i,
  /\b(Unit|Suite|Ste\.?|Apt\.?)\s*#?\s*[A-Z]?\s?\d/,                                                // Unit/Suite forms
  /\b\d{2,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][a-z]+\.?\s+){1,3}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Hwy|Pkwy|Pl)\b\.?/, // street lines
  /\b[A-Z]{2}\s\d{5}(?:-\d{4})?\b/,                                                                // "IL 61108"-style state+ZIP
];
// Comment-only lines that talk about the rule itself
const RULE_TALK = /no physical address|physical address comes later|no (street|mailing|physical)/i;

test("configured business address has the approved format (#<box>, never Unit/Suite)", () => {
  assert.ok(ADDR, "site.businessAddress must exist");
  assert.match(ADDR, /^5970 E State St #(XXX|\d+), Rockford, IL 61108$/);
  assert.ok(siteSrc.includes(CA_NOTICE), "caComplaintNotice must be Larry's exact text");
});

test("no other address (or placeholder, Unit/Suite) in site source, legal text or docs", () => {
  const hits = [];
  for (const r of ROOTS) for (const f of files(r)) {
    if (!/\.(tsx?|mjs|js|json|md|html|example|webmanifest)$/.test(f)) continue;
    readFileSync(f, "utf8").split("\n").forEach((l, i) => {
      const rest = l.split(ADDR).join("").split(CA_NOTICE).join("");
      if (BAD.some((re) => re.test(rest)) && !RULE_TALK.test(rest)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("the patterns still catch what they must", () => {
  const bad = ["123 Main St", "5970 E State St Unit 12", "5970 E State St, Suite 200", "P.O. Box 9", "[OP3X MAILING ADDRESS]", "Springfield, IL 62701", "Suite N 112"];
  for (const s of bad) assert.ok(BAD.some((re) => re.test(s)), s);
  for (const s of [ADDR, CA_NOTICE]) assert.ok(!BAD.some((re) => re.test(s.split(ADDR).join("").split(CA_NOTICE).join(""))), s);
});

test("TODO(box-number) is tracked: production guard fails on #XXX, preview passes", () => {
  assert.match(siteSrc, /TODO\(box-number\)/);
  const run = (APP_ENV) => spawnSync(process.execPath, ["scripts/guard.mjs"], { env: { PATH: process.env.PATH, APP_ENV }, encoding: "utf8" });
  assert.equal(run("preview").status, 0);
  const prod = run("production");
  if (/#XXX/.test(ADDR)) { assert.notEqual(prod.status, 0); assert.match(prod.stderr, /box number/); }
  else assert.equal(prod.status, 0);
});
