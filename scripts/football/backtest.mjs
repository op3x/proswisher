// NFL backtest step 2: simulate every test game (Monte Carlo over the snap engine) and score it honestly.
// usage: node scripts/football/backtest.mjs [dir=/tmp/proswisher-backtest] [n=1000]
// Metrics (pushes excluded from ATS and O/U; a game counts only if the line exists):
//   margin MAE (sim median and sim mean vs actual), total MAE, straight-up winner %, ATS % vs the nflverse closing
//   spread_line, O/U % vs total_line, and the closing line's own MAE as the benchmark to beat.
import fs from "node:fs";
import path from "node:path";
import { prepare } from "../../server/sim/engine.mjs";
import { buildCurve, runMonteCarlo } from "../../server/sim/montecarlo.mjs";

export function score(rows) {
  const m = { n: rows.length };
  const mae = (f) => rows.reduce((s, r) => s + Math.abs(f(r)), 0) / rows.length;
  m.marginMaeMedian = mae((r) => r.simMarginMedian - r.margin);
  m.marginMaeMean = mae((r) => r.simMarginMean - r.margin);
  m.marginMaeRatings = mae((r) => r.expMargin - r.margin);
  m.totalMaeMedian = mae((r) => r.simTotalMedian - r.total);
  m.totalMaeMean = mae((r) => r.simTotalMean - r.total);
  const dec = rows.filter((r) => r.margin !== 0 && r.simMarginMean !== 0);
  m.winnerPct = dec.filter((r) => Math.sign(r.simMarginMean) === Math.sign(r.margin)).length / dec.length;
  m.brier = rows.reduce((s, r) => s + (r.wpHome - (r.margin > 0 ? 1 : r.margin < 0 ? 0 : 0.5)) ** 2, 0) / rows.length;
  const sp = rows.filter((r) => r.spreadLine != null);
  const ats = sp.filter((r) => r.margin !== r.spreadLine && r.simMarginMean !== r.spreadLine);
  m.ats = { games: ats.length, wins: ats.filter((r) => Math.sign(r.simMarginMean - r.spreadLine) === Math.sign(r.margin - r.spreadLine)).length };
  m.ats.pct = ats.length ? m.ats.wins / m.ats.games : null;
  m.lineMarginMae = sp.length ? sp.reduce((s, r) => s + Math.abs(r.spreadLine - r.margin), 0) / sp.length : null;
  const tl = rows.filter((r) => r.totalLine != null);
  const ou = tl.filter((r) => r.total !== r.totalLine && r.simTotalMean !== r.totalLine);
  m.ou = { games: ou.length, wins: ou.filter((r) => Math.sign(r.simTotalMean - r.totalLine) === Math.sign(r.total - r.totalLine)).length };
  m.ou.pct = ou.length ? m.ou.wins / m.ou.games : null;
  m.lineTotalMae = tl.length ? tl.reduce((s, r) => s + Math.abs(r.totalLine - r.total), 0) / tl.length : null;
  return m;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || "/tmp/proswisher-backtest", n = Number(process.argv[3] || 1000);
  const { games, config, models } = JSON.parse(fs.readFileSync(path.join(dir, "games.json"), "utf8"));
  const S = prepare(JSON.parse(fs.readFileSync(path.join(dir, "params.json"), "utf8")), "nfl");
  const curve = buildCurve(S);
  const rows = []; const t0 = Date.now();
  for (const g of games) {
    const r = runMonteCarlo(S, { target: { H: Math.max(3, g.expected.home), A: Math.max(3, g.expected.away) }, n, seed: 1000 + rows.length, curve, playoff: g.playoff, pilot: 300 });
    rows.push({ season: g.season, id: g.id, margin: g.homeScore - g.awayScore, total: g.homeScore + g.awayScore, expMargin: g.expected.home - g.expected.away,
      simMarginMedian: r.margin.median, simMarginMean: r.margin.mean, simTotalMedian: r.total.median, simTotalMean: r.total.mean, wpHome: r.winProbability.home + r.winProbability.tie / 2,
      spreadLine: g.spreadLine, totalLine: g.totalLine });
  }
  const out = { method: "walk-forward; ratings as of each game's week; points model fitted on the 3 prior seasons; sim params fitted on seasons before the test window", config, models, n,
    overall: score(rows), bySeason: Object.fromEntries([...new Set(rows.map((r) => r.season))].map((s) => [s, score(rows.filter((r) => r.season === s))])), seconds: Math.round((Date.now() - t0) / 1000) };
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(out, null, 2));
  const f = (x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x);
  console.log(JSON.stringify(out.overall, (k, v) => f(v), 2));
  for (const [s, m] of Object.entries(out.bySeason)) console.log(s, `n=${m.n} marginMAE=${f(m.marginMaeMean)} totalMAE=${f(m.totalMaeMean)} win=${f(m.winnerPct)} ATS=${f(m.ats.pct)} (${m.ats.games}) OU=${f(m.ou.pct)} line=${f(m.lineMarginMae)}/${f(m.lineTotalMae)}`);
}
