// Ryan 10/31: quarter-by-quarter scoreboard for the simulated game (Q1-Q4, OT only when it happens, Final, combined
// total per quarter). Engine keeps OT points out of Q4; the API returns a lineScore; the UI builds the same line live.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { prepare, simulateGame, mulberry32 } from "../../server/sim/engine.mjs";
import { runMonteCarlo, lineScore, buildCurve } from "../../server/sim/montecarlo.mjs";
import { football } from "../../server/sports/football/index.mjs";
import { liveLineScore } from "../../src/sports/linescore.ts";

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

function findOt(S, base) { for (let i = 0; i < 4000; i++) { const g = sim(S, base + i, { record: true, names: { H: "HOME", A: "AWAY" } }); if (g.ot) return g; } }

test("live line score from the play log matches the engine at the final whistle, in both leagues, with and without OT", () => {
  for (const S of [NFL, CFB]) {
    for (const g of [sim(S, 77, { record: true }), findOt(S, 40000)]) {
      const r = football.simulate(S, { rng: mulberry32(0), tilt: { H: 0, A: 0 } }); assert.ok(r); // module shape smoke
      const ev = g.plays.map((p) => ({ period: p.q, score: p.score }));
      const live = liveLineScore(ev, ev.length, 4), want = lineScore({ ...g, periods: g.q });
      assert.deepEqual(live.home.periods, want.periods.map((p) => p.home));
      assert.deepEqual(live.away.periods, want.periods.map((p) => p.away));
      assert.deepEqual(live.total.periods, want.periods.map((p) => p.total));
      assert.equal(live.hasOT, !!g.ot);
      assert.equal(live.total.ot, want.overtime ? want.overtime.total : null);
      assert.equal(live.total.final, g.H + g.A); assert.equal(live.home.final, g.H); assert.equal(live.away.final, g.A);
    }
  }
});

test("live line score never shows the future: unplayed quarters are blank and OT appears only once reached", () => {
  const g = findOt(NFL, 50000), ev = g.plays.map((p) => ({ period: p.q, score: p.score }));
  const firstQ3 = ev.findIndex((e) => e.period === 3), firstOt = ev.findIndex((e) => e.period >= 5);
  const mid = liveLineScore(ev, firstQ3, 4);
  assert.equal(mid.current, 1); assert.deepEqual(mid.home.periods.slice(2), [null, null]); assert.equal(mid.hasOT, false); assert.equal(mid.total.ot, null);
  assert.equal(mid.total.final, ev[firstQ3 - 1].score.home + ev[firstQ3 - 1].score.away);
  assert.equal(liveLineScore(ev, firstOt, 4).hasOT, false);
  assert.equal(liveLineScore(ev, firstOt + 1, 4).hasOT, true);
  const zero = liveLineScore(ev, 0, 4);
  assert.equal(zero.current, -1); assert.deepEqual(zero.total.periods, [null, null, null, null]); assert.equal(zero.total.final, 0);
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

test("UI: scoreboard is wired into the game player, OT column only when it happens, team names only (no logos/players)", () => {
  const gp = fs.readFileSync("src/components/GamePlayer.tsx", "utf8"), ls = fs.readFileSync("src/components/LineScore.tsx", "utf8");
  assert.match(gp, /<LineScore league=\{league\} teams=\{teams\} events=\{events\} played=\{index \+ \(progress >= 1 \? 1 : 0\)\} done=\{atEnd\} \/>/);
  assert.match(gp, /export const DEFAULT_SPEED = 12;/);
  assert.match(ls, /ls\.hasOT \? \["OT"\] : \[\]/);
  assert.match(ls, /"Total points"/); assert.match(ls, /Final game total:/);
  assert.ok(!/<img|logo|player/i.test(ls.replace(/^\/\/.*$/gm, "")), "no logos or player names in the line score");
  assert.match(ls, /teams\.away\.name/); assert.match(ls, /teams\.home\.name/);
});

test("UI: Run simulation doesn't jump to the top and transitions smoothly (reserved height, fade, reduced motion)", () => {
  const sim = fs.readFileSync("src/pages/Simulate.tsx", "utf8"), lay = fs.readFileSync("src/components/Layout.tsx", "utf8"), css = fs.readFileSync("src/index.css", "utf8");
  assert.match(lay, /navType === "REPLACE" && prevPath\.current === pathname/);
  assert.match(lay, /if \(!samePageReplace\) window\.scrollTo\(0, 0\)/);
  assert.match(sim, /mode: "fictional" \} : \{\}\) \}, \{ replace: true \}\)/);
  const run = sim.slice(sim.indexOf("async function run()"), sim.indexOf("const r = result"));
  assert.ok(!/setResult\(null\)/.test(run), "run() must not unmount the previous result (layout collapse)");
  assert.match(run, /setReserve\(outRef\.current\?\.offsetHeight/);
  assert.match(sim, /<button type="button" onClick=\{run\}/);
  assert.match(sim, /style=\{reserve \? \{ minHeight: reserve \} : undefined\}/);
  assert.match(sim, /sim-fade-out" : "sim-fade-in"/);
  assert.ok(!/href="#"/.test(sim) && !/<form/.test(sim));
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.sim-fade-in \{ animation: none; \}/);
  assert.match(sim, /prefers-reduced-motion: reduce/);
});
