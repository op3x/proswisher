// NFL player availability (injuries), Larry's must-haves:
//  (a) player ids/names never in logs or error text  (b) no API response field carries a player id, name or status
//  (c) nothing player-level stored. Plus: /api/leagues exposes injuriesModeled for NFL only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createApp } from "../../server/index.mjs";
import { createCounter } from "../../server/counter.mjs";
import { createFootballPipeline } from "../../server/football/scheduler.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const FIX = path.join(ROOT, "tests/fixtures/football");
const quiet = () => {};
// planted in the synthetic pbp and injury report by tests/test_football.py (synth_pbp / synth_injuries)
const PLANTED = ["00-0099999", "Zzyzx", "Testplayer", "00-0088888", "Qwerty", "Receiverman", "00-0077777", "Plughk", "Hamstring-Zq", "Did Not Participate"];
const STATUS_VALUES = new Set(["Out", "Doubtful", "Questionable", "Probable", "IR", "PUP", "Limited Participation in Practice", "Full Participation in Practice"]);
const BAD_KEY = /player|gsis|full_?name|first_?name|last_?name|position|report|practice|body_?part|injur(?!iesModeled$)|^status_/i;
const PLAYER_ID = /\b\d{2}-\d{7}\b/;

async function serve(app) { const srv = app.listen(0); await new Promise((r) => srv.once("listening", r)); return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }; }

/** Walk every key and value of a response; fail on anything player-level. Returns the number of fields checked. */
function assertNoPlayerFields(body, where) {
  let n = 0;
  const walk = (v, at) => {
    n++;
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
    if (v && typeof v === "object") return Object.entries(v).forEach(([k, x]) => { assert.ok(!BAD_KEY.test(k), `${where}: player-level key ${at}.${k}`); walk(x, `${at}.${k}`); });
    if (typeof v === "string") {
      assert.ok(!PLAYER_ID.test(v), `${where}: player id in ${at}`);
      assert.ok(!STATUS_VALUES.has(v.trim()), `${where}: injury status value in ${at}`);
      for (const p of PLANTED) assert.ok(!v.includes(p), `${where}: planted player string ${p} in ${at}`);
    }
  };
  walk(body, "$");
  return n;
}

async function allResponses(url, gameIds) {
  const paths = ["/api/leagues", "/api/football/status", "/api/football/teams?league=nfl", "/api/football/games?league=nfl", "/api/schedule?league=nfl",
    "/api/scores", "/api/football/ticker", "/api/football/sim?home=KC&away=LV&n=200", "/api/sim?league=nfl&home=KC&away=BUF&n=200",
    ...gameIds.flatMap((id) => [`/api/football/games/${id}/sim`, `/api/football/games/${id}/plays`])];
  const out = {};
  for (const p of paths) { const r = await fetch(url + p); out[p] = { status: r.status, body: await r.json() }; }
  return out;
}

function fixtureDir({ modeled, adj }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fbinj-")), nfl = path.join(d, "football", "nfl");
  fs.mkdirSync(nfl, { recursive: true });
  fs.copyFileSync(path.join(FIX, "nfl-params.json"), path.join(nfl, "params.json"));
  const model = { a: 22.6, b: 64.8, hfa: 2.0, n: 1000 };
  const teams = [["KC", "Kansas City Chiefs"], ["LV", "Las Vegas Raiders"], ["BUF", "Buffalo Bills"], ["WAS", "Washington Commanders"]]
    .map(([team, name], i) => ({ team, name, off: 0.02 * (2 - i), def: 0, rank: i + 1, net: 0, games: 7 }));
  fs.writeFileSync(path.join(nfl, "ratings.json"), JSON.stringify({ league: "nfl", season: 2026, asOfWeek: 9, model, teams }));
  fs.writeFileSync(path.join(nfl, "history.json"), JSON.stringify({ model, seasons: {} }));
  const iso = new Date(Date.now() + 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
  const g = { id: "2026_09_LV_KC", season: 2026, week: 9, kickoff: iso, home: "KC", away: "LV", homeName: "Kansas City Chiefs", awayName: "Las Vegas Raiders",
    neutral: false, playoff: false, status: "scheduled", homeScore: null, awayScore: null, ...(adj ? { availabilityAdj: adj } : {}) };
  fs.writeFileSync(path.join(nfl, "schedule.json"), JSON.stringify({ league: "nfl", season: 2026, injuriesModeled: modeled, games: [g] }));
  return d;
}

test("/api/leagues: injuriesModeled on the NFL entry only; game sims apply the team adjustment only when modeled", async () => {
  const exp = {};
  for (const [modeled, adj] of [[true, { home: -6.0, away: 0 }], [false, { home: -6.0, away: 0 }], [false, null]]) {
    const app = await createApp({ env: { APP_ENV: "preview", PUBLIC_DATA_DIR: fixtureDir({ modeled, adj }) }, geoLookup: null, counter: createCounter({ enabled: false }), log: quiet });
    const s = await serve(app);
    try {
      const lg = await (await fetch(s.url + "/api/leagues")).json();
      const nfl = lg.leagues.find((l) => l.id === "nfl"), ncaaf = lg.leagues.find((l) => l.id === "ncaaf");
      assert.equal(nfl.injuriesModeled, modeled); assert.ok(!("injuriesModeled" in ncaaf), "college is not cleared: no flag at all");
      const gs = await (await fetch(s.url + "/api/football/games/2026_09_LV_KC/sim")).json();
      exp[`${modeled}-${!!adj}`] = gs.expectedPoints;
    } finally { s.close(); }
  }
  const on = exp["true-true"], off = exp["false-false"];
  assert.ok(Math.abs((on.home - on.away) - (off.home - off.away) + 6) < 0.15, `margin moves by the adjustment: ${JSON.stringify(exp)}`);
  assert.deepEqual(exp["false-true"], off, "a stale availabilityAdj is ignored when injuriesModeled is false");
});

test("(b) API scan fails on player-level fields: the checker itself catches ids, names, statuses and keys", () => {
  assert.throws(() => assertNoPlayerFields({ games: [{ note: "00-0012345" }] }, "t"));
  assert.throws(() => assertNoPlayerFields({ games: [{ home: { status: "Questionable" } }] }, "t"));
  assert.throws(() => assertNoPlayerFields({ x: [{ gsis_id: 1 }] }, "t"));
  assert.throws(() => assertNoPlayerFields({ x: { injuryReport: [] } }, "t"));
  assert.throws(() => assertNoPlayerFields({ x: "Zzyzx Testplayer" }, "t"));
  assert.ok(assertNoPlayerFields({ injuriesModeled: true, games: [{ status: "scheduled", availabilityAdj: { home: -2.7, away: 0 } }] }, "t") > 3);
});

test("(a)(b)(c) end to end: real refresh.py with the flag on, planted player data in, nothing player-level out", { timeout: 120000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fbinj-e2e-")), src = path.join(d, "src"), pub = path.join(d, "pub"), priv = path.join(d, "priv");
  fs.mkdirSync(src); fs.mkdirSync(path.join(pub, "football", "nfl"), { recursive: true });
  const params = JSON.parse(fs.readFileSync(path.join(FIX, "nfl-params.json"), "utf8")); params.fittedAt = "2999-01-01T00:00:00Z";
  fs.writeFileSync(path.join(pub, "football", "nfl", "params.json"), JSON.stringify(params));
  const gen = spawnSync("python3", ["-c", `
import csv, os, sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "tests"))})
import test_football as T
d = ${JSON.stringify(src)}
T.synth_pbp(os.path.join(d, "play_by_play_2025.csv.gz"), weeks=6); T.synth_injuries(os.path.join(d, "injuries_2025.csv.gz"))
rows = T.FakeNfl(d).schedule_rows(d)
with open(os.path.join(d, "games.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
`], { encoding: "utf8" });
  assert.equal(gen.status, 0, gen.stderr);
  const run = (flag) => spawnSync("python3", [path.join(ROOT, "scripts/football/refresh.py"), "--league", "nfl"], { encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: os.tmpdir(), NFL_DATA_PROVIDER: "local", NFL_LOCAL_DIR: src, PUBLIC_DATA_DIR: pub, PREDICTIONS_PRIVATE_DIR: priv, FOOTBALL_INJURIES_ENABLED: flag } });
  const r = run("true");
  assert.equal(r.status, 0, r.stderr);
  const logs = r.stdout + r.stderr;
  assert.match(logs, /NFL injuries: on, 1 team-weeks adjusted/);
  for (const p of PLANTED) assert.ok(!logs.includes(p), `(a) ${p} in refresh logs`);
  // (c) every stored file, public and private, gz included
  const files = [pub, priv].flatMap((root) => fs.readdirSync(root, { recursive: true }).map((f) => path.join(root, f)).filter((f) => fs.statSync(f).isFile()));
  assert.ok(files.length > 5);
  const zlib = await import("node:zlib");
  for (const f of files) {
    const raw = fs.readFileSync(f), text = (f.endsWith(".gz") ? zlib.gunzipSync(raw) : raw).toString("utf8");
    for (const p of PLANTED) assert.ok(!text.includes(p), `(c) ${p} stored in ${path.relative(d, f)}`);
    assert.ok(!PLAYER_ID.test(text), `(c) player id stored in ${path.relative(d, f)}`);
  }
  const sched = JSON.parse(fs.readFileSync(path.join(pub, "football", "nfl", "schedule.json"), "utf8"));
  assert.equal(sched.injuriesModeled, true);
  const ids = sched.games.filter((g) => g.status === "scheduled").map((g) => g.id);
  assert.ok(sched.games.some((g) => g.availabilityAdj && g.home === "KC" ? g.availabilityAdj.home < -2 : g.availabilityAdj?.away < -2));
  // (b) every API response, every field
  const app = await createApp({ env: { APP_ENV: "preview", PUBLIC_DATA_DIR: pub }, geoLookup: null, counter: createCounter({ enabled: false }), log: quiet });
  const s = await serve(app);
  try {
    const res = await allResponses(s.url, ids);
    for (const [p, { status, body }] of Object.entries(res)) { assert.ok(status < 500, `${p} ${status}`); assertNoPlayerFields(body, p); }
    assert.equal(res["/api/leagues"].body.leagues.find((l) => l.id === "nfl").injuriesModeled, true);
    assert.equal(res["/api/football/status"].status, 200);
  } finally { s.close(); }
  // flag off again: adjustment removed on the next refresh
  assert.equal(run("").status, 0);
  const off = JSON.parse(fs.readFileSync(path.join(pub, "football", "nfl", "schedule.json"), "utf8"));
  assert.equal(off.injuriesModeled, false); assert.ok(!off.games.some((g) => g.availabilityAdj));
});

test("startup refresh also runs when FOOTBALL_INJURIES_ENABLED no longer matches the published data", async () => {
  const pub = fs.mkdtempSync(path.join(os.tmpdir(), "fbinjs-")); fs.mkdirSync(path.join(pub, "football"));
  const now = new Date("2026-10-31T22:00:00Z");
  const write = (inj) => fs.writeFileSync(path.join(pub, "football", "status.json"), JSON.stringify({ generatedAt: "2026-10-31T20:00:00Z", nfl: { ok: true, ...(inj ? { availability: inj } : {}) }, ncaaf: { ok: true } }));
  const runs = (env) => { let n = 0; const seen = []; const fake = (c, a, o) => { n++; seen.push(o.env); const ee = { on: (ev, cb) => { if (ev === "exit") setImmediate(() => cb(0)); return ee; } }; return ee; };
    const p = createFootballPipeline({ env, dirs: { publicDir: pub, privateDir: pub }, spawn: fake, log: quiet, now: () => now });
    return p.start().then(() => { p.stop(); return { n, seen }; }); };
  write(null); assert.equal((await runs({})).n, 0);
  const on = await runs({ FOOTBALL_INJURIES_ENABLED: "true" }); assert.equal(on.n, 1); assert.equal(on.seen[0].FOOTBALL_INJURIES_ENABLED, "true");
  write("on"); assert.equal((await runs({ FOOTBALL_INJURIES_ENABLED: "true" })).n, 0); assert.equal((await runs({})).n, 1);
  write("failed"); assert.equal((await runs({ FOOTBALL_INJURIES_ENABLED: "true" })).n, 0, "a failed day does not loop");
});
