import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { prepare, simulateGame, mulberry32, RULES } from "../../server/sim/engine.mjs";
import { buildCurve, runMonteCarlo, drawSeed } from "../../server/sim/montecarlo.mjs";

const P = JSON.parse(fs.readFileSync(new URL("../fixtures/football/nfl-params.json", import.meta.url)));
const PC = JSON.parse(fs.readFileSync(new URL("../fixtures/football/ncaaf-params.json", import.meta.url)));
const NFL = prepare(P, "nfl"), CFB = prepare(PC, "ncaaf");
const sim = (S, seed, o = {}) => simulateGame(S, { rng: mulberry32(seed), tilt: { H: 0, A: 0 }, ...o });

test("rules differ by league", () => {
  assert.equal(RULES.nfl.twoMinuteWarning, true);
  assert.ok(RULES.ncaaf.firstDownStopsLate);
  assert.ok(RULES.nfl.fgMaxDist > RULES.ncaaf.fgMaxDist);
});

test("a game is deterministic for a seed and its play log matches the score", () => {
  const a = sim(NFL, 42, { record: true, names: { H: "KC", A: "LV" } }), b = sim(NFL, 42, { record: true, names: { H: "KC", A: "LV" } });
  assert.deepEqual(a, b);
  const last = a.plays[a.plays.length - 1];
  assert.deepEqual(last.score, { home: a.H, away: a.A });
  assert.ok(a.plays.length > 80 && a.plays.length < 400, `plays ${a.plays.length}`);
  for (const p of a.plays) { assert.ok(p.q >= 1); assert.ok(typeof p.text === "string" && p.text.length > 0); }
  assert.ok(a.plays.some((p) => p.type === "kickoff"));
});

test("quarter scores add up to the final (plus overtime) and scores are legal", () => {
  for (let i = 0; i < 400; i++) {
    const g = sim(NFL, 1000 + i);
    const qh = g.q.H.reduce((x, y) => x + y, 0), qa = g.q.A.reduce((x, y) => x + y, 0);
    assert.ok(g.H >= 0 && g.A >= 0 && g.H !== 1 && g.A !== 1);
    if (!g.ot) { assert.equal(qh, g.H); assert.equal(qa, g.A); }
  }
});

test("NFL regular season can tie, playoffs and NCAAF never tie", () => {
  for (let i = 0; i < 1500; i++) {
    const p = sim(NFL, 5000 + i, { playoff: true }); assert.notEqual(p.H, p.A, `playoff tie seed ${5000 + i}`);
    const c = sim(CFB, 9000 + i); assert.notEqual(c.H, c.A, `ncaaf tie seed ${9000 + i}`);
  }
});

test("average scoring is realistic at neutral tilt", () => {
  let s = 0, n = 2000; for (let i = 0; i < n; i++) { const g = sim(NFL, 20000 + i); s += g.H + g.A; }
  const ppg = s / n / 2; assert.ok(ppg > 19 && ppg < 25.5, `NFL ppg ${ppg}`);
  s = 0; for (let i = 0; i < n; i++) { const g = sim(CFB, 40000 + i); s += g.H + g.A; }
  const c = s / n / 2; assert.ok(c > 21 && c < 31, `NCAAF ppg ${c}`);
});

test("Monte Carlo calibrates to target points and returns the full summary", () => {
  const curve = buildCurve(NFL, 500);
  const r = runMonteCarlo(NFL, { target: { H: 27.5, A: 20 }, n: 1500, seed: 7, curve, names: { H: "KC", A: "LV" } });
  assert.ok(Math.abs(r.calibration.simMeanPoints.home - 27.5) < 1.2, JSON.stringify(r.calibration));
  assert.ok(Math.abs(r.calibration.simMeanPoints.away - 20) < 1.2, JSON.stringify(r.calibration));
  assert.ok(r.winProbability.home > 0.6 && r.winProbability.home < 0.85);
  assert.ok(Math.abs(r.winProbability.home + r.winProbability.away + r.winProbability.tie - 1) < 0.002);
  assert.ok(r.margin.p05 < r.margin.median && r.margin.median < r.margin.p95);
  assert.equal(r.medianByPeriod.home.length, 4); assert.equal(r.byPeriod.away.length, 4);
  assert.ok(r.representative.events.length > 50);
  // generic play-log envelope
  for (const e of r.representative.events) {
    for (const k of ["seq", "t", "period", "clock", "score", "type", "text", "payload"]) assert.ok(k in e, k);
  }
  const ts = r.representative.events.map((e) => e.t); assert.ok(ts.every((t, i) => i === 0 || t >= ts[i - 1] - 1), "t non-decreasing");
  assert.equal(r.representative.final.home - r.representative.final.away > 0, r.margin.median > 0);
  const again = runMonteCarlo(NFL, { target: { H: 27.5, A: 20 }, n: 1500, seed: 7, curve, names: { H: "KC", A: "LV" } });
  assert.deepEqual(again.representative, r.representative);
});


test("SportModule registry: football registers nfl + ncaaf; a module missing a piece is rejected", async () => {
  const { allLeagues, registerSport, sportForLeague } = await import("../../server/sports/index.mjs");
  assert.deepEqual(allLeagues().map((l) => l.id).sort(), ["ncaaf", "nfl"]);
  assert.equal(sportForLeague("NFL").id, "football");
  assert.throws(() => registerSport({ id: "basketball", leagues: { nba: { rules: { periods: 4 } } } }), /missing/);
});

test("rigor step 2: nearby seeds give independent draws; env shock widens totals and keeps the calibrated means", () => {
  // the old scheme used seed + i, so seed 7 and seed 8 shared all but one draw
  const a = new Set(Array.from({ length: 500 }, (_, i) => drawSeed(7, 0, i))), b = Array.from({ length: 500 }, (_, i) => drawSeed(8, 0, i));
  assert.ok(b.filter((x) => a.has(x)).length <= 1);
  assert.notEqual(drawSeed(7, 0, 3), drawSeed(7, 1, 3));
  const curve = buildCurve(NFL, 500);
  const base = runMonteCarlo(NFL, { target: { H: 26, A: 20 }, n: 3000, seed: 11, curve, pilot: 800 });
  const wide = runMonteCarlo(NFL, { target: { H: 26, A: 20 }, n: 3000, seed: 11, curve, pilot: 800, envSd: 0.8 });
  assert.ok(wide.total.sd > base.total.sd + 1, `${wide.total.sd} vs ${base.total.sd}`);
  for (const r of [base, wide]) {
    assert.ok(Math.abs(r.calibration.simMeanPoints.home - 26) < 0.9, JSON.stringify(r.calibration));
    assert.ok(Math.abs(r.calibration.simMeanPoints.away - 20) < 0.9, JSON.stringify(r.calibration));
  }
  assert.equal(wide.calibration.envSd, 0.8);
});
