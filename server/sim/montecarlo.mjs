// Monte Carlo over the snap-by-snap engine, calibrated so the simulated mean points match target points.
import { simulateGame, mulberry32 } from "./engine.mjs";

const GRID = [-8, -6, -4, -3, -2, -1, 0, 1, 2, 3, 4, 6, 8, 10];

/** Points-per-game as a function of the offense tilt (opponent tilt 0). Deterministic for a given S + seed. */
export function buildCurve(S, n = 1200, seed = 99) {
  const pts = GRID.map((t, gi) => {
    let s = 0;
    for (let i = 0; i < n; i++) { const g = simulateGame(S, { rng: mulberry32(seed * 7919 + gi * 100003 + i), tilt: { H: t, A: 0 } }); s += g.H; }
    return s / n;
  });
  return { t: GRID, pts };
}

function invert(curve, target) {
  const { t, pts } = curve;
  if (target <= pts[0]) return t[0] + (target - pts[0]) / ((pts[1] - pts[0]) / (t[1] - t[0]));
  for (let i = 1; i < t.length; i++) if (target <= pts[i]) return t[i - 1] + ((target - pts[i - 1]) * (t[i] - t[i - 1])) / (pts[i] - pts[i - 1]);
  const k = t.length - 1; return t[k] + (target - pts[k]) / ((pts[k] - pts[k - 1]) / (t[k] - t[k - 1]));
}
function slopeAt(curve, tv) {
  const { t, pts } = curve; let i = t.findIndex((x) => x >= tv); if (i <= 0) i = 1; if (i < 0) i = t.length - 1;
  return Math.max(0.5, (pts[i] - pts[i - 1]) / (t[i] - t[i - 1]));
}

const q = (sorted, p) => { const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };
const med = (a) => q([...a].sort((x, y) => x - y), 0.5);
const r1 = (x) => Math.round(x * 10) / 10;

function dist(values) {
  const s = [...values].sort((a, b) => a - b), n = s.length;
  const counts = {}; for (const v of s) counts[v] = (counts[v] || 0) + 1;
  return { mean: r1(s.reduce((a, b) => a + b, 0) / n), median: q(s, 0.5), p05: q(s, 0.05), p25: q(s, 0.25), p75: q(s, 0.75), p95: q(s, 0.95),
           histogram: Object.entries(counts).map(([v, c]) => [Number(v), c]).sort((a, b) => a[0] - b[0]) };
}

/**
 * opts: { target: {H, A} expected points, n, seed, names: {H, A}, playoff, curve, pilot }
 * Returns the summary plus `representative` (the sim closest to the median margin and total) with its play log.
 */
export function runMonteCarlo(S, opts) {
  const n = Math.max(1, Math.min(opts.n || 1000, 20000));
  const seed = (opts.seed ?? 12345) >>> 0;
  const curve = opts.curve; const target = opts.target;
  const tilt = { H: invert(curve, target.H), A: invert(curve, target.A) };
  const pilot = opts.pilot ?? 600;
  for (let pass = 0; pass < 2 && pilot > 0; pass++) {
    let sH = 0, sA = 0;
    for (let i = 0; i < pilot; i++) { const g = simulateGame(S, { rng: mulberry32(seed + 7777777 * (pass + 1) + i), tilt, playoff: opts.playoff }); sH += g.H; sA += g.A; }
    tilt.H += (target.H - sH / pilot) / slopeAt(curve, tilt.H);
    tilt.A += (target.A - sA / pilot) / slopeAt(curve, tilt.A);
  }
  const H = new Int16Array(n), A = new Int16Array(n), QH = [[], [], [], []], QA = [[], [], [], []];
  let hw = 0, aw = 0, ties = 0, ots = 0;
  for (let i = 0; i < n; i++) {
    const g = simulateGame(S, { rng: mulberry32(seed + i), tilt, playoff: opts.playoff });
    H[i] = g.H; A[i] = g.A; if (g.H > g.A) hw++; else if (g.A > g.H) aw++; else ties++; ots += g.ot ? 1 : 0;
    for (let k = 0; k < 4; k++) { QH[k].push(g.q.H[k]); QA[k].push(g.q.A[k]); }
  }
  const margins = Array.from(H, (h, i) => h - A[i]), totals = Array.from(H, (h, i) => h + A[i]);
  const m = dist(margins), t = dist(totals);
  const mSd = Math.sqrt(margins.reduce((a, x) => a + (x - m.mean) ** 2, 0) / n) || 1;
  const tSd = Math.sqrt(totals.reduce((a, x) => a + (x - t.mean) ** 2, 0) / n) || 1;
  // representative game: closest to (median margin, median total), same winner as the median margin when possible
  let best = 0, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = ((margins[i] - m.median) / mSd) ** 2 + ((totals[i] - t.median) / tSd) ** 2 + (Math.sign(margins[i]) !== Math.sign(m.median) && m.median !== 0 ? 10 : 0);
    if (d < bestD) { bestD = d; best = i; }
  }
  const rep = simulateGame(S, { rng: mulberry32(seed + best), tilt, playoff: opts.playoff, record: true, names: opts.names });
  const names = opts.names || { H: "HOME", A: "AWAY" };
  return {
    n, seed, league: S.league,
    winProbability: { home: Math.round((hw / n) * 1000) / 1000, away: Math.round((aw / n) * 1000) / 1000, tie: Math.round((ties / n) * 1000) / 1000 },
    overtimeRate: Math.round((ots / n) * 1000) / 1000,
    margin: { ...m, definition: "home points minus away points" },
    total: t,
    medianScore: { home: med(H), away: med(A) },
    medianByQuarter: { home: QH.map(med), away: QA.map(med), note: "median points in each quarter, taken quarter by quarter (overtime excluded), so the four medians need not add up to the median final" },
    calibration: { targetPoints: { home: r1(target.H), away: r1(target.A) }, simMeanPoints: { home: r1(H.reduce((a, b) => a + b, 0) / n), away: r1(A.reduce((a, b) => a + b, 0) / n) },
                   tilt: { home: Math.round(tilt.H * 1000) / 1000, away: Math.round(tilt.A * 1000) / 1000 } },
    playLogFields: "q, clock (after the play), poss, down, togo, yl (yards from the offense to the opponent's goal line); for type 'play' these are the snap situation, for other events the state after the event; score is after the event",
    representative: { index: best, seed: seed + best, names: { home: names.H, away: names.A }, final: { home: rep.H, away: rep.A }, quarters: { home: rep.q.H, away: rep.q.A }, overtime: rep.ot, plays: rep.plays },
  };
}
