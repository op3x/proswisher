// Sal follow-up: day headings and grouping use America/Chicago, matching the CT tip-off times.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = fs.readFileSync(path.join(ROOT, "src/lib/time.ts"), "utf8");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ps-time-")), "time.mjs");
fs.writeFileSync(out, transformSync(src, { loader: "ts", format: "esm" }).code);
const { dayLabel, tipTime, ctDayKey } = await import(pathToFileURL(out).href);

// Run under a far-off TZ so a missing timeZone option would show up.
process.env.TZ = "Asia/Tokyo";

test("dayLabel uses America/Chicago: a 9:30 PM CT tip is still that CT day", () => {
  const iso = "2026-10-28T02:30:00Z"; // Tue Oct 27, 9:30 PM CT (CDT); Wed in UTC and Tokyo
  assert.equal(dayLabel(iso), "Tuesday, October 27");
  assert.match(tipTime(iso), /^Tue, Oct 27, 9:30 PM CT$/);
  assert.equal(ctDayKey(iso), "2026-10-27");
});

test("dayLabel matches tipTime's day across the DST change (CST)", () => {
  const iso = "2026-11-03T05:30:00Z"; // Mon Nov 2, 11:30 PM CST
  assert.equal(dayLabel(iso), "Monday, November 2");
  assert.ok(tipTime(iso).startsWith("Mon, Nov 2,"));
  assert.equal(ctDayKey(iso), "2026-11-02");
});

test("data.ts re-exports the CT formatters and Home groups by the CT day key", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "src/lib/data.ts"), "utf8"), /export \{ tipTime, dayLabel, ctDayKey \} from "\.\/time"/);
  const home = fs.readFileSync(path.join(ROOT, "src/pages/Home.tsx"), "utf8");
  assert.match(home, /ctDayKey\(g\.date\)/);
  assert.doesNotMatch(home, /toDateString\(\)/);
});
