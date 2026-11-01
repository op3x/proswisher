// Ryan 10/31: quarter-by-quarter scoreboard for the simulated game (Q1-Q4, OT only when it happens, Final, combined
// total per quarter). Backend port: engine keeps OT points out of Q4; the API returns a lineScore (UI lives on pivot/simculus-ui).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { prepare, simulateGame, mulberry32 } from "../../server/sim/engine.mjs";
import { runMonteCarlo, lineScore, buildCurve } from "../../server/sim/montecarlo.mjs";

const P = JSON.parse(fs.readFileSync(new URL("../fixtures/football/nfl-params.json", import.meta.url)));
const PC = JSON.parse(fs.readFileSync(new URL("../fixtures/football/ncaaf-params.json", import.meta.url)));
const NFL = prepare(P, "nfl"), CFB = prepare(PC, "ncaaf");
const sim = (S, seed, o = {}) => simulateGame(S, { rng: mulberry32(seed), tilt: { H: 0, A: 0 }, ...o });
const add = (xs) => xs.reduce((a, b) => a + b, 0);

test("engine: regulation quarters + overtime points add up exactly to the final; OT points never land in Q4", () => {
  let ots = 0;
  for (const [S, base] of [[NFL, 20000], [CFB, 30000]]) for (let i = 0; i < 1500; i++) {
    const g = sim(S, base + i);
    assert.equal(add(g.q.H) + g.otPoints.H, g.H); assert.equal(add(g.q.A) + g.otPoints.A, g.A);
    if (!g.ot) assert.deepEqual(g.otPoints, { H: 0, A: 0 }); else ots++;
  }
  assert.ok(ots > 10, `expected some overtime games, got ${ots}`);
});

test("lineScore(): per-period home/away/total, overtime null without OT, final totals", () => {
  const ls = lineScore({ H: 27, A: 24, periods: { H: [7, 10, 3, 7], A: [3, 7, 7, 7] }, ot: false, otPoints: { H: 0, A: 0 } });
  assert.deepEqual(ls.periods.map((p) => p.total), [10, 17, 10, 14]);
  assert.equal(ls.overtime, null); assert.deepEqual(ls.final, { home: 27, away: 24, total: 51 });
  const o = lineScore({ H: 30, A: 24, periods: { H: [7, 10, 0, 7], A: [3, 7, 7, 7] }, ot: true, otPoints: { H: 6, A: 0 } });
  assert.deepEqual(o.overtime, { home: 6, away: 0, total: 6 }); assert.equal(o.final.total, 54);
});

test("Monte Carlo representative game carries the line score and it adds up", () => {
  const r = runMonteCarlo(NFL, { target: { H: 24, A: 21 }, n: 300, seed: 7, pilot: 200, passes: 1, curve: buildCurve(NFL, 200), names: { H: "Home", A: "Away" } });
  const rep = r.representative, ls = rep.lineScore;
  assert.equal(add(ls.periods.map((p) => p.home)) + (ls.overtime?.home ?? 0), rep.final.home);
  assert.equal(add(ls.periods.map((p) => p.total)) + (ls.overtime?.total ?? 0), ls.final.total);
  assert.equal(ls.final.total, rep.final.home + rep.final.away);
  assert.deepEqual(rep.overtimePoints, rep.overtime ? rep.overtimePoints : { home: 0, away: 0 });
  // no line/odds/bookmaker fields sneak in
  assert.ok(!/line"?:\s*-?\d|odds|bookmaker|spreadLine|totalLine/i.test(JSON.stringify(ls)));
});
