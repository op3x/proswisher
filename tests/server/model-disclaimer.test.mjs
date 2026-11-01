// Larry 10/31: the "what's modeled" disclaimer switches on /api/leagues injuriesModeled (NFL). Exact texts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const site = readFileSync("src/config/site.ts", "utf8");
test("model disclaimer texts are exact, and the UI reads the NFL injuriesModeled flag", () => {
  assert.ok(site.includes(`"NFL injury adjustments use public injury reports, which may be late or incomplete. College injuries, weather, coaching changes and market prices aren't modeled yet. A simulation is an estimate, not a guarantee. Not betting advice. 21+. Gambling problem? Call 1-800-GAMBLER."`));
  assert.ok(site.includes(`"Injuries, weather, coaching changes and market prices aren't modeled yet. A simulation is an estimate, not a guarantee. " + commerce.disclaimers.short`));
  assert.ok(site.includes(`"Custom matchups don't include injury adjustments."`));
  const md = readFileSync("src/components/ModelDisclaimer.tsx", "utf8");
  assert.match(md, /l\.id === "nfl"\)\?\.injuriesModeled === true/);
  for (const f of ["src/pages/Simulate.tsx", "src/pages/HowItWorks.tsx"]) {
    const s = readFileSync(f, "utf8");
    assert.ok(!/Injuries, weather, coaching/.test(s), `${f} must use ModelDisclaimer, not a hard-coded "injuries aren't modeled" line`);
    assert.match(s, /<ModelDisclaimer/);
  }
});
