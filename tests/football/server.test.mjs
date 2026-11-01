import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { nextRunAt, createFootballPipeline, FOOTBALL_CHILD_ENV } from "../../server/football/scheduler.mjs";
import { createTicker, parseCsv, inWindow, pickLive } from "../../server/football/ticker.mjs";
import { tickerGuard } from "../../server/football/routes.mjs";
import { NFL_ATTRIBUTION, NCAAF_ATTRIBUTION } from "../../server/football/attribution.mjs";
import { createFootballStore } from "../../server/football/store.mjs";
import { createApp } from "../../server/index.mjs";
import { createCounter } from "../../server/counter.mjs";
import { appName, DEFAULT_APP_NAME } from "../../server/brand.mjs";

const quiet = () => {};
const FIX = new URL("../fixtures/football/", import.meta.url).pathname;

function fixtureDir(now = Date.now()) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fb-")), nfl = path.join(d, "football", "nfl");
  fs.mkdirSync(nfl, { recursive: true });
  fs.copyFileSync(path.join(FIX, "nfl-params.json"), path.join(nfl, "params.json"));
  const model = { a: 22.6, b: 64.8, hfa: 2.0, n: 1000 };
  const teams = [["KC", "Kansas City Chiefs", 0.08, -0.03], ["LV", "Las Vegas Raiders", -0.05, 0.04], ["BUF", "Buffalo Bills", 0.06, -0.02], ["WAS", "Washington Commanders", 0, 0]]
    .map(([team, name, off, def], i) => ({ team, name, off, def, rank: i + 1, net: 0, games: 7 }));
  fs.writeFileSync(path.join(nfl, "ratings.json"), JSON.stringify({ league: "nfl", season: 2026, asOfWeek: 9, model, teams }));
  fs.writeFileSync(path.join(nfl, "history.json"), JSON.stringify({ model, seasons: { 2022: { KC: { off: 0.12, def: -0.02 }, LV: { off: -0.01, def: 0.05 } } } }));
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
  fs.writeFileSync(path.join(nfl, "schedule.json"), JSON.stringify({ league: "nfl", season: 2026, games: [
    { id: "2026_09_LV_KC", season: 2026, week: 9, kickoff: iso(now + 3600e3), home: "KC", away: "LV", homeName: "Kansas City Chiefs", awayName: "Las Vegas Raiders", neutral: false, playoff: false, status: "scheduled", homeScore: null, awayScore: null },
    { id: "2026_09_WAS_BUF", season: 2026, week: 9, kickoff: iso(now - 3600e3), home: "BUF", away: "WAS", homeName: "Buffalo Bills", awayName: "Washington Commanders", neutral: false, playoff: false, status: "scheduled", homeScore: null, awayScore: null },
  ] }));
  return d;
}

test("next refresh is 04:00 America/Chicago, across both DST changes", () => {
  assert.equal(nextRunAt(new Date("2026-10-31T21:00:00Z")).toISOString(), "2026-11-01T10:00:00.000Z"); // CST after fall-back
  assert.equal(nextRunAt(new Date("2026-10-31T08:59:00Z")).toISOString(), "2026-10-31T09:00:00.000Z"); // CDT
  assert.equal(nextRunAt(new Date("2026-03-08T07:00:00Z")).toISOString(), "2026-03-08T09:00:00.000Z"); // spring-forward day
  assert.equal(nextRunAt(new Date("2026-03-08T09:00:00Z")).toISOString(), "2026-03-09T09:00:00.000Z"); // strictly after
});

function fakeSpawn(code, seen) {
  return (cmd, args, opts) => { seen.push({ cmd, args, env: opts.env }); const c = new EventEmitter(); setImmediate(() => c.emit("exit", code)); return c; };
}

test("refresh child gets an allowlisted env only; exit 3 means a source was stopped but data still reloads", async () => {
  const seen = [], logs = []; let reloaded = 0;
  const env = { PATH: "/bin", CFBD_API_KEY: "k", STRIPE_SECRET_KEY: "secret", ADMIN_TOKEN: "t", APP_NAME: "X" };
  const p = createFootballPipeline({ env, dirs: { publicDir: "/tmp/a", privateDir: "/tmp/b" }, spawn: fakeSpawn(3, seen), log: (m) => logs.push(m), onDone: () => reloaded++ });
  const r = await p.run();
  assert.equal(r.result, "source-blocked"); assert.equal(reloaded, 1);
  assert.equal(seen[0].env.STRIPE_SECRET_KEY, undefined); assert.equal(seen[0].env.ADMIN_TOKEN, undefined);
  assert.equal(seen[0].env.CFBD_API_KEY, "k"); assert.equal(seen[0].env.PUBLIC_DATA_DIR, "/tmp/a");
  assert.ok(!logs.join("\n").includes("k\n") && !logs.join("\n").includes("secret"));
  assert.ok(seen[0].args[0].endsWith("scripts/football/refresh.py"));
  assert.ok(!FOOTBALL_CHILD_ENV.some((k) => /STRIPE|ADMIN|SESSION/.test(k)));
  const bad = createFootballPipeline({ env, dirs: { publicDir: "/tmp/a", privateDir: "/tmp/b" }, spawn: fakeSpawn(1, []), log: quiet });
  assert.equal((await bad.run()).result, "error");
});

test("csv parser handles quoted commas; live window logic", () => {
  const rows = parseCsv('game_id,stadium,home_score\n2026_01_A_B,"Field, The",21\n');
  assert.deepEqual(rows, [{ game_id: "2026_01_A_B", stadium: "Field, The", home_score: "21" }]);
  const now = Date.parse("2026-11-01T19:00:00Z");
  assert.ok(inWindow({ kickoff: "2026-11-01T18:00:00Z", status: "scheduled" }, now));
  assert.ok(!inWindow({ kickoff: "2026-11-01T18:00:00Z", status: "final" }, now));
  assert.ok(!inWindow({ kickoff: "2026-11-02T18:00:00Z", status: "scheduled" }, now));
});

test("ticker: balldontlie scores mapped (WSH->WAS); 403 stops the source for good", async () => {
  const d = fixtureDir(); const store = createFootballStore({ publicDir: d, log: quiet }); store.load();
  const calls = [];
  let status = 200;
  const fetchImpl = async (url, o) => { calls.push({ url, auth: o.headers.Authorization }); return { status, ok: status === 200, headers: new Map(),
    json: async () => ({ data: [{ home_team: { abbreviation: "BUF" }, visitor_team: { abbreviation: "WSH" }, date: new Date().toISOString(), status: "3rd Quarter", status_state: "in_progress", home_team_score: 17, visitor_team_score: 10,
      period: 3, time: "7:12", summary: "AP-STYLE HEADLINE TEXT", venue: "SOME STADIUM NAME", plays: [{ text: "PLAY TEXT" }] }] }) }; };
  let t = Date.now(); const logs = [];
  const tk = createTicker({ store, env: { BALLDONTLIE_API_KEY: "bdl", FOOTBALL_TICKER_LIVE_CLEARED: "true" }, fetchImpl, log: (m) => logs.push(m), now: () => t });
  await tk.tick();
  assert.equal(calls.length, 1); assert.match(calls[0].url, /api\.balldontlie\.io\/nfl\/v1\/games\?dates\[\]=/);
  const g = tk.snapshot().games.find((x) => x.id === "2026_09_WAS_BUF");
  assert.deepEqual([g.homeScore, g.awayScore, g.status, g.quarter, g.clock], [17, 10, "live", 3, "7:12"]);
  const blob = JSON.stringify(tk.snapshot());
  assert.ok(!/HEADLINE|STADIUM|PLAY TEXT|summary|venue|detail/.test(blob), "memo 24 B1: no summary, venue or play text");
  await tk.tick(); assert.equal(calls.length, 1, "respects the poll interval");
  status = 403; t += 121e3; await tk.tick();
  assert.ok(tk.snapshot().sources.balldontlie.blocked);
  t += 3600e3; await tk.tick(); assert.equal(calls.length, 2, "never retried after a refusal");
  assert.ok(logs.some((l) => l.includes("STOPPED balldontlie")));
  assert.ok(!logs.join(" ").includes("bdl"));
});

test("ticker: live NFL source stays off until the paid plan is approved (memo 24 B4), even with a key", async () => {
  const d = fixtureDir(); const store = createFootballStore({ publicDir: d, log: quiet }); store.load();
  const urls = []; const fetchImpl = async (url) => { urls.push(url); return { status: 304, ok: false, headers: new Map() }; };
  const tk = createTicker({ store, env: { BALLDONTLIE_API_KEY: "bdl" }, fetchImpl, log: quiet });
  await tk.tick();
  assert.ok(urls.every((u) => !u.includes("balldontlie")), urls.join());
  assert.ok(urls.every((u) => !/espn/i.test(u)));
  assert.match(tk.snapshot().notes.join(" "), /off until the paid live plan is approved/);
});

test("ticker: no live NCAAF without a key and no network at all when no game is in its window", async () => {
  const d = fixtureDir(Date.now() + 30 * 864e5); const store = createFootballStore({ publicDir: d, log: quiet }); store.load();
  let n = 0; const tk = createTicker({ store, env: {}, fetchImpl: async () => { n++; return { status: 200, ok: true }; }, log: quiet });
  await tk.tick(); assert.equal(n, 0);
});

async function serve(app) { const srv = app.listen(0); await new Promise((r) => srv.once("listening", r)); return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }; }

test("football API: teams, games, game sim with play log, custom and cross-era sims, validation", async () => {
  const d = fixtureDir();
  const app = await createApp({ env: { APP_ENV: "preview", PUBLIC_DATA_DIR: d, FOOTBALL_SIM_MAX_N: "800" }, geoLookup: null, counter: createCounter({ enabled: false }), log: quiet });
  const s = await serve(app);
  try {
    const j = async (p) => { const r = await fetch(s.url + p); return { status: r.status, body: await r.json() }; };
    const teams = await j("/api/football/teams?league=nfl");
    assert.equal(teams.status, 200); assert.equal(teams.body.teams.length, 4); assert.equal(teams.body.attribution, NFL_ATTRIBUTION);
    assert.equal((await j("/api/football/teams?league=ncaaf")).status, 503);
    assert.equal((await j("/api/football/teams?league=nba")).status, 400);
    assert.equal((await j("/api/football/games?league=nfl")).body.games.length, 2);
    const gs = await j("/api/football/games/2026_09_LV_KC/sim");
    assert.equal(gs.status, 200); assert.ok(gs.body.winProbability.home > 0.5); assert.ok(gs.body.representative.events.length > 50);
    assert.equal(gs.body.label, undefined);
    const plays = await j("/api/football/games/2026_09_LV_KC/plays");
    assert.equal(plays.status, 200); assert.ok(Array.isArray(plays.body.events)); assert.ok(plays.body.fields);
    assert.equal((await j("/api/football/games/nope/sim")).status, 404);
    const c = await j("/api/football/sim?home=KC&away=LV&homeSeason=2022&neutral=1&n=100000&plays=0");
    assert.equal(c.status, 200); assert.equal(c.body.n, 800, "N capped"); assert.equal(c.body.label, "Pick Your Matchup · Can't be played for real."); assert.equal(c.body.matchupKind, "cross");
    // Ryan via Larry 10:07 PM: the three picked-matchup cases
    const same = await j("/api/football/sim?home=LV&away=KC&n=100&plays=0"); // same season + league, not on the schedule
    assert.equal(same.status, 200); assert.equal(same.body.label, "Pick Your Matchup · Non-Scheduled Game"); assert.equal(same.body.matchupKind, "unscheduled");
    const sched = await j("/api/football/sim?home=KC&away=LV&n=100&plays=0"); // on the schedule: the game's own sim, no tag
    assert.equal(sched.status, 200); assert.equal(sched.body.label, undefined); assert.equal(sched.body.matchupKind, undefined);
    assert.equal(sched.body.scheduledGameId, "2026_09_LV_KC"); assert.equal(sched.body.game.id, "2026_09_LV_KC");
    assert.deepEqual(sched.body.winProbability, gs.body.winProbability, "same numbers as the scheduled game sim");
    const sched2 = await j("/api/football/sim?home=KC&away=LV&homeSeason=2026&awaySeason=2026&n=100&plays=0");
    assert.equal(sched2.body.label, undefined, "explicit current season is still the scheduled game");
    assert.equal(c.body.representative.events, undefined); assert.equal(c.body.teams.home.name, "2022 Kansas City Chiefs");
    assert.equal((await j("/api/football/sim?home=KC&away=XYZ")).status, 404);
    assert.equal((await j("/api/football/sim?home=KC")).status, 400);
    assert.equal((await j("/api/football/sim?home=KC&away=LV&homeSeason=22")).status, 400);
    const st = await j("/api/football/status"); assert.equal(st.body.leagues.nfl.ready, true); assert.equal(st.body.leagues.ncaaf.ready, false);
    assert.match(teams.body.disclaimer, /not affiliated with or endorsed by the NFL, the NCAA/); assert.match(gs.body.disclaimer, /1-800-GAMBLER/);
    const blob = JSON.stringify([teams.body, gs.body, plays.body, c.body]);
    assert.ok(!/passer|rusher|receiver|player_name|_player_|logo|helmet|espn/i.test(blob), "no player names, logos or ESPN fields");
    assert.ok(teams.body.teams.every((t) => /^[A-Z][a-z.]+( [A-Z][a-z.]+)* [A-Z0-9][A-Za-z0-9]+$/.test(t.name)), "City + Name");
    // short aliases for the front end
    const ps = await fetch(s.url + "/api/sim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ league: "nfl", home: "LV", away: "KC", n: 500, plays: 0 }) });
    const pb = await ps.json(); assert.equal(ps.status, 200, JSON.stringify(pb));
    assert.equal(pb.n, 500); assert.ok(pb.margin.interval95 && pb.total.interval80 && pb.winProbabilitySE && pb.byPeriod.home.length === 4);
    assert.ok(pb.margin.interval95[0] <= pb.margin.interval80[0] && pb.margin.interval80[1] <= pb.margin.interval95[1]);
    assert.match(pb.disclaimer, /not affiliated/);
    const sch = await j("/api/schedule?league=nfl"); assert.equal(sch.status, 200); assert.ok(Array.isArray(sch.body.games));
    const lg = await j("/api/leagues"); assert.equal(lg.status, 200); assert.deepEqual(lg.body.leagues.map((l) => l.id).sort(), ["ncaaf", "nfl"]);
    assert.equal(lg.body.leagues.find((l) => l.id === "nfl").ready, true);
    const sc = await j("/api/scores"); assert.equal(sc.status, 200); assert.ok(Array.isArray(sc.body.games));
    const tk = await j("/api/football/ticker"); assert.equal(tk.status, 200); assert.ok(tk.body.games.length >= 1);
  } finally { s.close(); }
});

test("product name comes from APP_NAME with a single default (final: Simculus Sports)", async () => {
  assert.equal(DEFAULT_APP_NAME, "Simculus Sports");
  assert.equal(appName({}), "Simculus Sports"); assert.equal(appName({ APP_NAME: "  " }), "Simculus Sports"); assert.equal(appName({ APP_NAME: "Other" }), "Other");
  const app = await createApp({ env: { APP_ENV: "preview", APP_NAME: "Renamed", PUBLIC_DATA_DIR: fixtureDir() }, geoLookup: null, counter: createCounter({ enabled: false }), log: quiet });
  const s = await serve(app);
  try {
    assert.equal((await (await fetch(s.url + "/api/config")).json()).appName, "Renamed");
    assert.equal((await (await fetch(s.url + "/api/football/status")).json()).app, "Renamed");
  } finally { s.close(); }
  const hits = fs.readdirSync(new URL("../../server/", import.meta.url).pathname, { recursive: true }).filter((f) => f.endsWith(".mjs"))
    .filter((f) => fs.readFileSync(new URL("../../server/" + f, import.meta.url), "utf8").includes("Simculus"));
  assert.deepEqual(hits, ["brand.mjs"]);
});

test("startup refresh runs when data is stale, or when NCAAF is missing but a CFBD key is present", async () => {
  const { createFootballPipeline } = await import("../../server/football/scheduler.mjs");
  const fsm = await import("node:fs"), os = await import("node:os"), pth = await import("node:path");
  const pub = fsm.mkdtempSync(pth.join(os.tmpdir(), "fbsched-"));
  fsm.mkdirSync(pth.join(pub, "football"), { recursive: true });
  const now = new Date("2026-10-31T22:00:00Z");
  const write = (s) => fsm.writeFileSync(pth.join(pub, "football", "status.json"), JSON.stringify(s));
  const runs = (env) => { let n = 0; const fake = () => { n++; const ee = { on: (ev, cb) => { if (ev === "exit") setImmediate(() => cb(0)); return ee; } }; return ee; };
    const p = createFootballPipeline({ env, dirs: { publicDir: pub, privateDir: pub }, spawn: fake, log: () => {}, now: () => now });
    return p.start().then(() => { p.stop(); return n; }); };
  write({ generatedAt: "2026-10-31T20:00:00Z", nfl: { ok: true }, ncaaf: { ok: true } });
  assert.equal(await runs({}), 0);
  write({ generatedAt: "2026-10-31T20:00:00Z", nfl: { ok: true }, ncaaf: { ok: false } });
  assert.equal(await runs({}), 0);
  assert.equal(await runs({ CFBD_API_KEY: "test-placeholder" }), 1);
  write({ generatedAt: "2026-10-29T20:00:00Z", nfl: { ok: true }, ncaaf: { ok: true } });
  assert.equal(await runs({}), 1);
});

test("memo 24: exact attribution strings; nothing calls the data official", () => {
  assert.equal(NFL_ATTRIBUTION, "NFL data: nflverse (github.com/nflverse/nflverse-data), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified by Op3x LLC (aggregated, modeled and simulated). Not affiliated with or endorsed by the NFL or nflverse.");
  assert.equal(NCAAF_ATTRIBUTION, "Data provided by CollegeFootballData.com.");
  for (const f of ["server/football/ticker.mjs", "server/football/routes.mjs", "server/football/store.mjs", "server/sports/football/index.mjs", "server/football/attribution.mjs"]) {
    const src = fs.readFileSync(path.join(import.meta.dirname, "../..", f), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    assert.ok(!/official/i.test(src.replace(/never "official"|never say "official"/gi, "")), `${f} must never call the data official`);
  }
});

test("memo 24 B1: pickLive keeps only score, quarter, clock and status", () => {
  assert.deepEqual(pickLive({ homeScore: "21", awayScore: 7, quarter: 2, clock: "0:45", status: "live", summary: "x", venue: "y" }),
    { homeScore: 21, awayScore: 7, quarter: 2, clock: "0:45", status: "live" });
  assert.deepEqual(pickLive({ quarter: "Halftime", clock: "End of 2nd", status: "weird" }), { homeScore: null, awayScore: null, quarter: null, clock: null, status: null });
});

test("memo 24: NCAAF shows finals only and never touches balldontlie", async () => {
  const t = Date.now();
  const games = [{ id: "401", season: 2026, week: 10, kickoff: new Date(t - 3600e3).toISOString(), status: "scheduled", home: "A", away: "B" },
                 { id: "402", season: 2026, week: 10, kickoff: new Date(t - 3600e3).toISOString(), status: "scheduled", home: "C", away: "D" }];
  const store = { games: (lg) => (lg === "ncaaf" ? games : []) };
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { status: 200, ok: true, headers: new Map(), json: async () => [
    { id: 401, completed: false, homePoints: 14, awayPoints: 3 }, { id: 402, completed: true, homePoints: 28, awayPoints: 24 }] }; };
  const priv = fs.mkdtempSync(path.join(os.tmpdir(), "tk-"));
  const tk = createTicker({ store, env: { CFBD_API_KEY: "k", BALLDONTLIE_API_KEY: "bdl", FOOTBALL_TICKER_LIVE_CLEARED: "true" }, privateDir: priv, fetchImpl, log: () => {}, now: () => t });
  await tk.tick();
  assert.ok(urls.length === 1 && urls.every((u) => u.includes("collegefootballdata") && !u.includes("balldontlie")), urls.join());
  assert.equal(tk.live.has("401"), false, "in-progress college scores are not shown");
  assert.deepEqual({ ...tk.live.get("402"), at: undefined }, { homeScore: 28, awayScore: 24, quarter: null, clock: null, status: "final", source: "cfbd", at: undefined });
});

test("memo 24 B2: ticker endpoint is same-origin, no CORS, no params, rate-limited", async () => {
  const d = fixtureDir();
  const app = await createApp({ env: { APP_ENV: "preview", PUBLIC_DATA_DIR: d, FOOTBALL_TICKER_RATE_PER_MIN: "5" }, geoLookup: null, counter: createCounter({ enabled: false }), log: quiet });
  const s = await serve(app);
  try {
    for (const p of ["/api/football/ticker", "/api/scores"]) {
      const ok = await fetch(s.url + p, { headers: { "Sec-Fetch-Site": "same-origin" } });
      assert.ok([200, 503].includes(ok.status)); assert.equal(ok.headers.get("access-control-allow-origin"), null);
      assert.equal((await fetch(s.url + p, { headers: { Origin: "https://evil.example" } })).status, 403);
      assert.equal((await fetch(s.url + p, { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
      assert.equal((await fetch(s.url + p + "?season=2020&all=1")).status, 400, "no bulk or historical params");
    }
    const same = new URL(s.url).host;
    assert.notEqual((await fetch(s.url + "/api/scores", { headers: { Origin: `http://${same}` } })).status, 403);
    let last = 200; for (let i = 0; i < 6; i++) last = (await fetch(s.url + "/api/scores")).status;
    assert.equal(last, 429, "rate-limited");
    const docs = fs.readFileSync(path.join(import.meta.dirname, "../../docs/football-model.md"), "utf8");
    assert.ok(!docs.includes("/api/football/ticker"), "ticker endpoint stays undocumented");
  } finally { s.close(); }
});

test("rigor step 1: same-season margin comes from Elo, total from EPA ratings; cross-era keeps EPA", () => {
  const d = fixtureDir(); const f = path.join(d, "football", "nfl", "ratings.json");
  const r = JSON.parse(fs.readFileSync(f, "utf8"));
  const base = createFootballStore({ publicDir: d, log: quiet }); base.load();
  const m0 = base.matchup({ league: "nfl", team: "KC" }, { league: "nfl", team: "LV" });
  r.marginModel = { type: "elo", k: 16, hfa: 36, keep: 0.5, mean: 1505, per_pt: 22 };
  r.teams.find((t) => t.team === "KC").elo = 1505 + 110; r.teams.find((t) => t.team === "LV").elo = 1505;
  fs.writeFileSync(f, JSON.stringify(r));
  const s = createFootballStore({ publicDir: d, log: quiet }); s.load();
  const m = s.matchup({ league: "nfl", team: "KC" }, { league: "nfl", team: "LV" });
  assert.ok(Math.abs(m.target.H - m.target.A - (110 + 36) / 22) < 1e-9, "Elo margin");
  assert.ok(Math.abs(m.target.H + m.target.A - (m0.target.H + m0.target.A)) < 1e-9, "EPA total unchanged");
  const x = s.matchup({ league: "nfl", team: "KC", season: 2022 }, { league: "nfl", team: "LV" });
  assert.ok(x.target.H > 0 && !Number.isNaN(x.target.A));
});
