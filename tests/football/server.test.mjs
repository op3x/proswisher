import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { nextRunAt, createFootballPipeline, FOOTBALL_CHILD_ENV } from "../../server/football/scheduler.mjs";
import { createTicker, parseCsv, inWindow } from "../../server/football/ticker.mjs";
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
    json: async () => ({ data: [{ home_team: { abbreviation: "BUF" }, visitor_team: { abbreviation: "WSH" }, date: new Date().toISOString(), status: "3rd Quarter", status_state: "in_progress", home_team_score: 17, visitor_team_score: 10 }] }) }; };
  let t = Date.now(); const logs = [];
  const tk = createTicker({ store, env: { BALLDONTLIE_API_KEY: "bdl" }, fetchImpl, log: (m) => logs.push(m), now: () => t });
  await tk.tick();
  assert.equal(calls.length, 1); assert.match(calls[0].url, /api\.balldontlie\.io\/nfl\/v1\/games\?dates\[\]=/);
  const g = tk.snapshot().games.find((x) => x.id === "2026_09_WAS_BUF");
  assert.deepEqual([g.homeScore, g.awayScore, g.status], [17, 10, "live"]);
  await tk.tick(); assert.equal(calls.length, 1, "respects the poll interval");
  status = 403; t += 121e3; await tk.tick();
  assert.ok(tk.snapshot().sources.balldontlie.blocked);
  t += 3600e3; await tk.tick(); assert.equal(calls.length, 2, "never retried after a refusal");
  assert.ok(logs.some((l) => l.includes("STOPPED balldontlie")));
  assert.ok(!logs.join(" ").includes("bdl"));
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
    assert.equal(teams.status, 200); assert.equal(teams.body.teams.length, 4); assert.equal(teams.body.attribution, "Data: nflverse (CC-BY 4.0)");
    assert.equal((await j("/api/football/teams?league=ncaaf")).status, 503);
    assert.equal((await j("/api/football/teams?league=nba")).status, 400);
    assert.equal((await j("/api/football/games?league=nfl")).body.games.length, 2);
    const gs = await j("/api/football/games/2026_09_LV_KC/sim");
    assert.equal(gs.status, 200); assert.ok(gs.body.winProbability.home > 0.5); assert.ok(gs.body.representative.plays.length > 50);
    assert.equal(gs.body.label, undefined);
    const plays = await j("/api/football/games/2026_09_LV_KC/plays");
    assert.equal(plays.status, 200); assert.ok(Array.isArray(plays.body.plays)); assert.ok(plays.body.fields);
    assert.equal((await j("/api/football/games/nope/sim")).status, 404);
    const c = await j("/api/football/sim?home=KC&away=LV&homeSeason=2022&neutral=1&n=100000&plays=0");
    assert.equal(c.status, 200); assert.equal(c.body.n, 800, "N capped"); assert.match(c.body.label, /entertainment only/);
    assert.equal(c.body.representative.plays, undefined); assert.equal(c.body.teams.home.name, "2022 Kansas City Chiefs");
    assert.equal((await j("/api/football/sim?home=KC&away=XYZ")).status, 404);
    assert.equal((await j("/api/football/sim?home=KC")).status, 400);
    assert.equal((await j("/api/football/sim?home=KC&away=LV&homeSeason=22")).status, 400);
    const st = await j("/api/football/status"); assert.equal(st.body.leagues.nfl.ready, true); assert.equal(st.body.leagues.ncaaf.ready, false);
    const tk = await j("/api/football/ticker"); assert.equal(tk.status, 200); assert.ok(tk.body.games.length >= 1);
  } finally { s.close(); }
});

test("product name comes from APP_NAME with a single default (working name, no logo)", async () => {
  assert.equal(DEFAULT_APP_NAME, "Simculus");
  assert.equal(appName({}), "Simculus"); assert.equal(appName({ APP_NAME: "  " }), "Simculus"); assert.equal(appName({ APP_NAME: "Other" }), "Other");
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
