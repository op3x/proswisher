// Larry 10/31 10:04 PM, approved by Ryan: one-line footer + Terms and Conditions · Privacy · Credits; Credits page;
// the two exact checkout lines; Terms-only clauses. Ryan via Larry 10:07 PM: picked-matchup tags (UI = API = tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MATCHUP_TAGS } from "../../server/football/store.mjs";
const read = (f) => readFileSync(f, "utf8");
const commerce = JSON.parse(read("src/config/commerce.json"));
const site = read("src/config/site.ts");
const layout = read("src/components/Layout.tsx");
const FOOTER = "Simulated estimates, not guarantees or betting advice. 21+. Gambling problem? Call 1-800-GAMBLER.";
const LINES = ["$9/month plus applicable tax, billed today and every month after.",
  "Renews automatically until you cancel. Cancel anytime in Account settings; you keep access through the end of the month you've paid for."];
const UI_PAGES = ["src/components", "src/pages"].flatMap((d) => readdirSync(d).map((f) => join(d, f))).filter((f) => !/Legal\.tsx$/.test(f));

test("footer: exactly Larry's one line, then Terms and Conditions · Privacy · Credits", () => {
  assert.equal(commerce.disclaimers.footer, FOOTER);
  assert.match(layout, /\{site\.footerDisclaimer\}/);
  assert.match(site, /footerDisclaimer: commerce\.disclaimers\.footer/);
  const links = site.slice(site.indexOf("footerLinks: ["), site.indexOf("],", site.indexOf("footerLinks: [")));
  assert.deepEqual([...links.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]), ["Terms and Conditions", "Privacy", "Credits"]);
  // removed from the footer: long disclaimer, not-affiliated, attribution, address, CA notice
  for (const re of [/DataSources/, /dataCredit/, /geoCredit/, /businessAddress/, /caComplaintNotice/, /notAffiliated/, /legal\.draftNotice/])
    assert.ok(!re.test(layout), `footer must not render ${re}`);
  assert.match(layout, /"\/terms": "Terms and Conditions"/);
});

test("/credits: full nflverse attribution (incl. not-affiliated) + CollegeFootballData.com", () => {
  const api = read("src/sports/api.ts"), credits = read("src/pages/Credits.tsx");
  assert.match(api, /nfl: "NFL data: nflverse .*Not affiliated with or endorsed by the NFL or nflverse\."/);
  assert.match(api, /ncaaf: "Data provided by CollegeFootballData\.com\."/);
  assert.match(credits, /REQUIRED_ATTRIBUTION\.nfl/);
  assert.match(credits, /REQUIRED_ATTRIBUTION\.ncaaf/);
  assert.match(read("src/main.tsx"), /path="credits" element=\{<Credits \/>\}/);
  assert.match(read("server/index.mjs"), /SPA_ROUTES = new Set\(.*"\/credits"\]\);/);
});

test("checkout shows only the two exact lines above the unchecked consent box", () => {
  assert.deepEqual(commerce.checkoutLines, LINES);
  assert.equal(commerce.renewalDisclosure, LINES.join(" "));
  const sub = read("src/pages/Subscribe.tsx");
  assert.match(sub, /c\.lines\.map/);
  assert.ok(!/c\.summary|c\.renewalDisclosure|whatItIs/.test(sub));
  assert.ok(sub.indexOf("c.lines.map") < sub.indexOf('type="checkbox"'), "lines come before the consent box");
  assert.match(sub, /useState\(false\)/); // consent unchecked by default
  assert.match(sub, /site\.pickDisclaimer/);
});

test("Terms-only clauses: no page renders not-a-sportsbook, address, CA notice, not-affiliated or model caveats", () => {
  for (const f of UI_PAGES) {
    if (/Credits\.tsx$/.test(f)) continue; // Credits carries the attribution + not-affiliated (Larry)
    const s = read(f);
    for (const re of [/businessAddress/, /caComplaintNotice/, /notAffiliated/, /REQUIRED_ATTRIBUTION/, /not a sportsbook/i, /accept wagers/i])
      assert.ok(!re.test(s), `${f} must not render ${re}`);
  }
  const terms = read("src/content/terms-v2.md");
  assert.match(terms, /^\*\*Terms and Conditions\*\*$/m);
  assert.match(terms, /^### 20\. California users$/m);
  assert.ok(terms.includes("{ADDRESS}"));
  assert.ok(terms.includes("not a sportsbook"));
  assert.ok(!/\bNBA\b/.test(terms), "Terms name the NFL/NCAA, not the NBA");
});

test("responsible-betting clauses stay visible", () => {
  assert.ok(commerce.disclaimers.short.includes("1-800-GAMBLER"));
  assert.match(site, /\["Should I bet based on a simulation\?"/);
  assert.match(site, /ageGate: \{/);
  assert.ok(FOOTER.includes("21+") && FOOTER.includes("betting advice"));
});

test("picked-matchup tags: same strings in the UI and the API", () => {
  assert.deepEqual(MATCHUP_TAGS, { unscheduled: "Pick Your Matchup · Non-Scheduled Game", cross: "Pick Your Matchup · Can't be played for real." });
  assert.ok(site.includes(`unscheduled: "${MATCHUP_TAGS.unscheduled}"`));
  assert.ok(site.includes(`cross: "${MATCHUP_TAGS.cross}"`));
  const sim = read("src/pages/Simulate.tsx");
  assert.match(sim, /site\.matchupTags/);
  assert.ok(!/Hypothetical|Not a real game/.test(sim + site + read("src/pages/HowItWorks.tsx") + read("server/football/store.mjs").replace(/HYPOTHETICAL_LABEL/g, "")));
});

test("Terms v2 (Larry 10:23 PM): football §1 sentence, game start, real cancel URL that the app serves", () => {
  const terms = read("src/content/terms-v2.md");
  assert.match(terms.split("\n")[1], /Version: terms-v2$/);
  assert.ok(terms.includes("Simculus publishes statistical simulations and predictions for NFL and college football games, and other sports as we add them, such as projected scores, win probabilities and spreads."));
  assert.ok(!/basketball|\[CANCEL_URL|\[CANCEL/i.test(terms));
  assert.equal((terms.match(/before game start/g) || []).length, 2, "§4 and §9");
  assert.ok(terms.includes("(https://simculus.com/account)"), "§5(c) cancel link");
  assert.match(site, /cancelUrl: "https:\/\/simculus\.com\/account"/);
  const server = read("server/index.mjs");
  assert.match(server, /SPA_ROUTES[^\n]*"\/account"/, "/account is a route the app really serves");
  assert.match(read("src/main.tsx"), /path="account"/);
  assert.match(server, /SPA_ROUTES[^\n]*"\/cancel"/, "/cancel (footer target) is served");
});
