// Larry 10/31 10:04 PM (Ryan approved): the model caveats (injuries, weather, coaching, estimate-not-guarantee) are
// in the Terms only, in a section with Larry's exact text. No page renders them; the responsible-betting line stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const read = (f) => readFileSync(f, "utf8");
const INJURIES = "NFL injury adjustments use public injury reports, which may be late or incomplete. College injuries, weather, coaching changes and market prices aren't modeled yet. A simulation is an estimate, not a guarantee.";

test("Terms carry the 'What the simulations model' section with Larry's exact injury text", () => {
  const terms = read("src/content/terms-v2.md");
  assert.match(terms, /^### 21\. What the simulations model\n/m);
  assert.ok(terms.includes(`### 21. What the simulations model\n${INJURIES}\n`), "Larry's exact text, verbatim");
  assert.ok(terms.includes("Custom matchups don't include injury adjustments."));
  assert.match(terms, /^### 22\. Contact$/m);
  assert.ok(read("src/config/site.ts").includes(`injuries: "${INJURIES}"`), "site.ts copy matches the Terms");
});

test("no page renders the model caveats; Simulate and How it works keep the responsible-betting line", () => {
  assert.ok(!existsSync("src/components/ModelDisclaimer.tsx"));
  for (const f of ["src/pages/Simulate.tsx", "src/pages/HowItWorks.tsx", "src/pages/Faq.tsx", "src/pages/Home.tsx", "src/components/Layout.tsx"]) {
    if (!existsSync(f)) continue;
    const s = read(f);
    assert.ok(!/ModelDisclaimer|modelDisclaimer|customNote|Injuries, weather, coaching|injury reports/.test(s), `${f} must not render the model caveats`);
  }
  for (const f of ["src/pages/Simulate.tsx", "src/pages/HowItWorks.tsx"]) assert.match(read(f), /site\.pickDisclaimer/, f);
});
