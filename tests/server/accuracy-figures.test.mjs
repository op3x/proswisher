// Larry 10/31 10:44 PM round 4: (a) any accuracy number (Brier, MAE, winner %, ATS %, O/U %) shown on the site or returned
// by an API is labeled "backtest" with its seasons and game count (src/config/backtest.json), never called a win rate or
// a record; (b) closing lines and odds values are never displayed or returned by public APIs; (c) /track-record is a 404.
// Plus the round-4 Terms §9 text and the removal of public track-record claims from the copy.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../server/index.mjs";
import { createCounter } from "../../server/counter.mjs";
import { MARKET_KEY_RE, scrubMarket } from "../../server/public-safety.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const BT = JSON.parse(read("src/config/backtest.json"));
const LABELS = [BT.nfl.label, BT.ncaaf.label];
const quiet = () => {};
const serve = async (app) => { const srv = app.listen(0); await new Promise((r) => srv.once("listening", r)); return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }; };

// An accuracy term near a number that reads as a score: a percentage, a 0.xxx probability score, or an "x.xx points" error.
const TERM = /\b(brier|log ?loss|mae|mean absolute error|rmse|winner ?%|winners?\b|straight[- ]up|ats|against the spread|o\/u|over\/under|accura\w*|hit rate|win rate|winning percentage|correct\w*|record)\b/i;
const NUM = /(\d+(\.\d+)?\s?%|\b0\.\d{2,}\b|\b\d+\.\d+\s?points?\b|\b\d+\s?[-–]\s?\d+(\s?[-–]\s?\d+)?\b)/;
const BANNED = /\b(win rate|winning percentage|records?)\b/i;
function accuracyProblems(text, where) {
  const out = [];
  for (const sentence of String(text).split(/(?<=[.!?])\s+|\n+/)) {
    const t = sentence.replace(/\{[A-Za-z]+\}/g, "");
    if (!(TERM.test(t) && NUM.test(t))) continue;
    if (/\b(range|middle \d+%|\d+% (range|interval)|standard error|sims?\b)/i.test(t) && !/brier|mae|ats|winner|accura|o\/u/i.test(t)) continue; // sim ranges, not accuracy
    if (!/\bbacktest\b/i.test(t) || !LABELS.some((l) => t.includes(l))) out.push(`${where}: unlabeled accuracy figure: ${t.trim().slice(0, 160)}`);
    if (BANNED.test(t)) out.push(`${where}: accuracy figure called a win rate/record: ${t.trim().slice(0, 160)}`);
  }
  return out;
}

test("backtest labels carry the real seasons and game counts from the backtest outputs", () => {
  assert.equal(BT.nfl.games, 963); assert.equal(BT.ncaaf.games, 2442);
  assert.equal(BT.nfl.label, "2023–26 backtest (2026 through week 8), 963 games");
  assert.equal(BT.ncaaf.label, "2024–26 backtest (2026 through week 9), 2,442 games");
  const doc = read("docs/football-model.md");
  assert.ok(doc.includes("test seasons 2023–2026 (through week 8 of 2026), 963 games"));
  assert.ok(read("docs/sim-methodology.md").includes("2,442 FBS-vs-FBS games"));
  // the checker itself: an unlabeled or "record" figure fails, a labeled one passes
  assert.equal(accuracyProblems("Our model picks winners 62.6% of the time.", "x").length, 1);
  assert.equal(accuracyProblems(`Straight-up winner 62.6% (${BT.nfl.label}).`, "x").length, 0);
  assert.equal(accuracyProblems(`ATS record 48.9% (${BT.nfl.label}).`, "x").length, 1);
  assert.equal(accuracyProblems(`Brier 0.227 (${BT.nfl.label}), our win rate.`, "x").length, 1);
});

test("site copy: no unlabeled accuracy figure, no win-rate/record wording, no public track-record claims", () => {
  // Legacy NBA pages (404 unless LEGACY_NBA_PAGES=1) are not part of the football site.
  const LEGACY = new Set(["src/pages/TrackRecord.tsx", "src/pages/GameDetail.tsx", "src/lib/data.ts", "src/components/GameCard.tsx", "src/components/LockedTeaser.tsx"]);
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(tsx?|md|json)$/.test(e.name) && !LEGACY.has(p)) files.push(p); } };
  walk("src"); files.push("index.html");
  const problems = [];
  for (const f of files) {
    let t = read(f);
    if (f === "src/config/site.ts") t = t.replace(/\n  trackRecord: \{[\s\S]*?\n  \},\n/, "\n"); // legacy page copy, hidden
    if (f === "src/config/backtest.json") continue;
    problems.push(...accuracyProblems(t, f));
  }
  assert.deepEqual(problems, []);
  const site = read("src/config/site.ts").replace(/\n  trackRecord: \{[\s\S]*?\n  \},\n/, "\n");
  const visible = site + read("src/config/commerce.json") + read("src/pages/HowItWorks.tsx") + read("src/pages/Faq.tsx") + read("src/pages/Home.tsx");
  assert.ok(!/public track record|in the track record|and the track record|timestamped and graded/i.test(visible), "no live track record is published yet");
});

test("Terms §9 is Larry's 10:44 PM text; the winner/pushes grading text is gone", () => {
  const t = read("src/content/terms-v2.md");
  assert.ok(t.includes("### 9. Accuracy figures and track record\nTrack record. We don't publish a live football track record yet. Any accuracy figures we show come from testing our model on past seasons (a backtest), which isn't the same as live results, and past performance doesn't guarantee future results. When we launch a public track record, we'll timestamp each prediction before game start and grade it when the game is final, and we'll update these Terms.\n"));
  assert.ok(!/Pushes|pushes|Winner:|graded once|Grades are never|add it to our public Track record/.test(t));
  assert.ok(t.includes("and you'll see a confirmation on screen.\n"));
  assert.ok(read("src/pages/Account.tsx").includes("Your subscription is canceled."), "/account?canceled=1 confirmation");
});

test("scrubMarket drops line/odds keys and keeps our own projections", () => {
  const out = scrubMarket({ spread: { team: "KC", line: -3.5 }, total: 47.2, attribution: "x", overtime: true, marketSpread: { line: -3 }, marketSource: "odds",
    atsLean: "home", spread_line: -3, total_line: 45, home_moneyline: -150, closingTotal: 44, odds: [1], nested: [{ bookCount: 4, ok: 1 }] });
  assert.deepEqual(out, { spread: { team: "KC", line: -3.5 }, total: 47.2, attribution: "x", overtime: true, nested: [{ ok: 1 }] });
});

function footballFixture() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "acc-")), nfl = path.join(d, "football", "nfl");
  fs.mkdirSync(nfl, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "tests/fixtures/football/nfl-params.json"), path.join(nfl, "params.json"));
  const model = { a: 22.6, b: 64.8, hfa: 2.0, n: 1000 };
  const teams = [["KC", "Kansas City Chiefs", 0.08, -0.03], ["LV", "Las Vegas Raiders", -0.05, 0.04]].map(([team, name, off, def], i) => ({ team, name, off, def, rank: i + 1, net: 0, games: 7 }));
  fs.writeFileSync(path.join(nfl, "ratings.json"), JSON.stringify({ league: "nfl", season: 2026, asOfWeek: 9, model, teams }));
  fs.writeFileSync(path.join(nfl, "history.json"), JSON.stringify({ model, seasons: {} }));
  const kickoff = new Date(Date.now() + 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
  // nflverse schedules carry closing lines; even if one leaked into the store it must not come out of an API.
  fs.writeFileSync(path.join(nfl, "schedule.json"), JSON.stringify({ league: "nfl", season: 2026, games: [
    { id: "2026_09_LV_KC", season: 2026, week: 9, kickoff, home: "KC", away: "LV", homeName: "Kansas City Chiefs", awayName: "Las Vegas Raiders", neutral: false, playoff: false, status: "scheduled",
      spread_line: 3.5, total_line: 47.5, home_moneyline: -170, away_moneyline: 150, spreadLine: 3.5, totalLine: 47.5, odds: { book: "x" } },
  ] }));
  // legacy NBA public files with a recorded market spread and ATS grade
  fs.writeFileSync(path.join(d, "predictions.json"), JSON.stringify({ marketSource: "fixture-odds", entries: { g1: { homeMargin: 4, marketSpread: { line: -3, source: "x" }, atsLean: "home", result: { ats: "W" } } } }));
  return d;
}

function walkKeys(v, pre = "", out = []) {
  if (Array.isArray(v)) v.slice(0, 50).forEach((x) => walkKeys(x, pre, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (MARKET_KEY_RE.test(k)) out.push(pre + k); walkKeys(x, `${pre}${k}.`, out); }
  return out;
}

test("public APIs: no line/odds keys and no unlabeled accuracy figures; /track-record, legacy pages and /data 404", async () => {
  const d = footballFixture();
  for (const legacy of [false, true]) {
    const env = { APP_ENV: "preview", PUBLIC_DATA_DIR: d, FOOTBALL_SIM_MAX_N: "300", ...(legacy ? { LEGACY_NBA_PAGES: "1" } : {}) };
    const s = await serve(await createApp({ env, geoLookup: null, counter: createCounter({ enabled: false }), log: quiet }));
    try {
      const H = { "sec-fetch-site": "same-origin" };
      if (!legacy) {
        for (const p of ["/track-record", "/track-record/", "/game/2026_09_LV_KC", "/data/predictions.json", "/data/games.json", "/data/stats.json", "/data/prior.json"]) assert.equal((await fetch(s.url + p)).status, 404, p);
      } else {
        const r = await fetch(s.url + "/data/predictions.json"); assert.equal(r.status, 200);
        const body = await r.json(); assert.deepEqual(walkKeys(body), []); assert.equal(body.entries.g1.homeMargin, 4);
      }
      const paths = ["/api/config", "/api/leagues", "/api/football/status", "/api/football/teams?league=nfl", "/api/football/games?league=nfl", "/api/schedule?league=nfl",
        "/api/football/games/2026_09_LV_KC/sim?n=200", "/api/football/games/2026_09_LV_KC/plays", "/api/football/sim?home=KC&away=LV&n=200", "/api/sim?league=nfl&home=KC&away=LV&n=200",
        "/api/scores", "/api/football/ticker", "/api/predictions", "/api/me"];
      for (const p of paths) {
        const r = await fetch(s.url + p, { headers: H });
        const text = await r.text(); let body; try { body = JSON.parse(text); } catch { continue; }
        assert.deepEqual(walkKeys(body), [], `${p} returns line/odds keys`);
        const strings = []; (function g(v) { if (typeof v === "string") strings.push(v); else if (v && typeof v === "object") Object.values(v).forEach(g); })(body);
        assert.deepEqual(strings.flatMap((x) => accuracyProblems(x, p)), []);
        assert.ok(!/spread_line|total_line|moneyline|closing line/i.test(text), p);
      }
    } finally { s.close(); }
  }
  fs.rmSync(d, { recursive: true });
});
