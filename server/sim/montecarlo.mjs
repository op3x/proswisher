// Sport-agnostic Monte Carlo runner: works with any SportModule's simulate() (server/sports/sport-module.mjs),
// calibrated so the simulated mean points match target points, with Monte Carlo SEs and 80%/95% intervals.
import { mulberry32 } from "./engine.mjs";
import { football } from "../sports/football/index.mjs";

// S.sim is attached by the sport's prepare(); engine-prepared football state falls back to the football module.
const simOf = (S) => S.sim || football.simulate;
const nPeriods = (S) => S.periods || 4;

const GRID = [-8, -6, -4, -3, -2, -1, 0, 1, 2, 3, 4, 6, 8, 10];

/** Points-per-game as a function of the offense tilt (opponent tilt 0). Deterministic for a given S + seed. */
export function buildCurve(S, n = 1200, seed = 99) {
  const pts = GRID.map((t, gi) => {
    let s = 0;
    for (let i = 0; i < n; i++) { const g = simOf(S)(S, { rng: mulberry32(seed * 7919 + gi * 100003 + i), tilt: { H: t, A: 0 } }); s += g.H; }
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

/**
 * Independent per-draw seed (murmur3 fmix32 of seed, stream, i). Before rigor step 2 draw i used seed + i, so requests with nearby
 * seeds (e.g. consecutive backtest games) shared almost all of their random streams, including the pilot used for calibration,
 * which turned one pilot's sampling error into a systematic home/away bias across a whole backtest.
 */
export function drawSeed(seed, stream, i) {
  let h = (Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(stream + 1, 0x85ebca77) ^ Math.imul(i + 1, 0xc2b2ae3d)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

const q = (sorted, p) => { const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };
const med = (a) => q([...a].sort((x, y) => x - y), 0.5);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const bin = (k, n) => { const p = k / n; return { p: r3(p), se: r3(Math.sqrt((p * (1 - p)) / n)) }; };
/** Box-score line of one simulated game: points per regulation period, overtime (null when none) and final, per team,
 * plus the combined total per period. Periods + overtime add up exactly to the final. */
export function lineScore(g) {
  const ot = g.ot ? { home: g.otPoints?.H ?? 0, away: g.otPoints?.A ?? 0, total: (g.otPoints?.H ?? 0) + (g.otPoints?.A ?? 0) } : null;
  return { periods: g.periods.H.map((h, k) => ({ home: h, away: g.periods.A[k], total: h + g.periods.A[k] })), overtime: ot,
    final: { home: g.H, away: g.A, total: g.H + g.A } };
}

/** Integer per-period line that sums exactly to `total`: period means scaled to the total, largest remainder rounding. */
export function periodLine(means, total) {
  const T = Math.max(0, Math.round(total)), sum = means.reduce((a, b) => a + b, 0);
  if (!means.length) return [];
  const raw = means.map((x) => (sum > 0 ? (x / sum) * T : T / means.length)), out = raw.map(Math.floor);
  let left = T - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let j = 0; left > 0; j = (j + 1) % order.length, left--) out[order[j][1]]++;
  return out;
}
function qStats(a) { const d = dist(a); return { mean: d.mean, se: d.se, median: d.median, interval80: d.interval80, interval95: d.interval95 }; }

function dist(values) {
  const s = [...values].sort((a, b) => a - b), n = s.length;
  const counts = {}; for (const v of s) counts[v] = (counts[v] || 0) + 1;
  const mean = s.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(s.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  return { mean: r1(mean), sd: r2(sd), se: r3(sd / Math.sqrt(n)), median: q(s, 0.5), p05: q(s, 0.05), p25: q(s, 0.25), p75: q(s, 0.75), p95: q(s, 0.95),
           interval80: [q(s, 0.1), q(s, 0.9)], interval95: [q(s, 0.025), q(s, 0.975)],
           histogram: Object.entries(counts).map(([v, c]) => [Number(v), c]).sort((a, b) => a[0] - b[0]) };
}

/**
 * opts: { target: {H, A} expected points, n, seed, names: {H, A}, playoff, curve, pilot }
 * Returns the summary plus `representative` (the sim closest to the median margin and total) with its play log.
 */
export function runMonteCarlo(S, opts) {
  const n = Math.max(1, Math.min(opts.n || 10000, 50000));
  const seed = (opts.seed ?? 12345) >>> 0;
  const curve = opts.curve; const target = opts.target;
  const tilt = { H: invert(curve, target.H), A: invert(curve, target.A) };
  // Calibration: Newton/secant passes on a FIXED pilot set (common random numbers), so passes compare like with like and the
  // cross-effect (one side's tilt moves the other side's points) is iterated out. Residual error ~ sd/sqrt(pilot) per side.
  const pilot = opts.pilot ?? 1500, passes = opts.passes ?? 4;
  // Game-environment random effect (rigor step 2): each simulated game draws one shared shock u ~ N(0, envSd) added to BOTH offenses'
  // tilts (pace, weather, officiating, game script the ratings cannot see). It widens the total distribution, which was too narrow
  // in the backtest; the calibration passes below include it, so mean points still match the targets.
  // teamSd: optional independent per-side shock (form/injury uncertainty), which widens the margin as well.
  const envSd = opts.envSd ?? S.envSd ?? 0, teamSd = opts.teamSd ?? S.teamSd ?? 0;
  const tiltAt = (tl, stream, i) => {
    if (!envSd && !teamSd) return tl;
    const r = mulberry32(drawSeed(seed, stream, i)), z = () => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
    const u = envSd * z(), h = teamSd * z(), a = teamSd * z();
    return { H: tl.H + u + h, A: tl.A + u + a };
  };
  const pilotMean = (tl) => { let sH = 0, sA = 0; for (let i = 0; i < pilot; i++) { const g = simOf(S)(S, { rng: mulberry32(drawSeed(seed, 1, i)), tilt: tiltAt(tl, 3, i), playoff: opts.playoff }); sH += g.H; sA += g.A; } return { H: sH / pilot, A: sA / pilot }; };
  let prev = null;
  for (let pass = 0; pass < passes && pilot > 0; pass++) {
    const m = pilotMean(tilt), eH = target.H - m.H, eA = target.A - m.A;
    if (Math.abs(eH) < 0.03 && Math.abs(eA) < 0.03) break;
    const sl = (k, e) => { const c = slopeAt(curve, tilt[k]); if (!prev || Math.abs(tilt[k] - prev.t[k]) < 1e-3) return c;
      const sec = (m[k] - prev.m[k]) / (tilt[k] - prev.t[k]); return sec > 0.25 * c && sec < 4 * c ? sec : c; };
    const dH = eH / sl("H", eH), dA = eA / sl("A", eA);
    prev = { t: { ...tilt }, m };
    tilt.H += dH; tilt.A += dA;
  }
  const P = nPeriods(S), H = new Int16Array(n), A = new Int16Array(n), QH = Array.from({ length: P }, () => []), QA = Array.from({ length: P }, () => []);
  let hw = 0, aw = 0, ties = 0, ots = 0;
  for (let i = 0; i < n; i++) {
    const g = simOf(S)(S, { rng: mulberry32(drawSeed(seed, 0, i)), tilt: tiltAt(tilt, 2, i), playoff: opts.playoff });
    H[i] = g.H; A[i] = g.A; if (g.H > g.A) hw++; else if (g.A > g.H) aw++; else ties++; ots += g.ot ? 1 : 0;
    for (let k = 0; k < P; k++) { QH[k].push(g.periods.H[k]); QA[k].push(g.periods.A[k]); }
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
  const rep = simOf(S)(S, { rng: mulberry32(drawSeed(seed, 0, best)), tilt: tiltAt(tilt, 2, best), playoff: opts.playoff, record: true, names: opts.names });
  const names = opts.names || { H: "HOME", A: "AWAY" };
  return {
    n, seed, league: S.league,
    winProbability: { home: Math.round((hw / n) * 1000) / 1000, away: Math.round((aw / n) * 1000) / 1000, tie: Math.round((ties / n) * 1000) / 1000 },
    winProbabilitySE: { home: bin(hw, n).se, away: bin(aw, n).se, tie: bin(ties, n).se, note: "Monte Carlo standard error sqrt(p(1-p)/n); model uncertainty is larger (see backtest)" },
    overtimeRate: Math.round((ots / n) * 1000) / 1000,
    margin: { ...m, definition: "home points minus away points" },
    total: t,
    medianScore: { home: med(H), away: med(A) },
    periodName: S.periodName || "quarter",
    byPeriod: { home: QH.map(qStats), away: QA.map(qStats), note: "points scored in each period (quarter): mean with Monte Carlo SE, median, 80% and 95% simulation intervals (overtime excluded)" },
    medianByPeriod: { home: QH.map(med), away: QA.map(med), note: "median points in each period, taken period by period (overtime excluded). Quarter scores are lumpy (0, 3, 7...), so these often all equal 7 or 0 and need not add up to the median final: show periodLine instead" },
    periodLine: (() => { const mh = QH.map((q) => q.reduce((a, b) => a + b, 0) / n), ma = QA.map((q) => q.reduce((a, b) => a + b, 0) / n);
      return { home: periodLine(mh, med(H)), away: periodLine(ma, med(A)), note: "projected points per period: each team's mean period scoring shape, scaled so the periods add up exactly to its median final score (whole points, largest-remainder rounding). Use this for a quarter-by-quarter line." }; })(),
    calibration: { targetPoints: { home: r1(target.H), away: r1(target.A) }, simMeanPoints: { home: r1(H.reduce((a, b) => a + b, 0) / n), away: r1(A.reduce((a, b) => a + b, 0) / n) },
                   tilt: { home: Math.round(tilt.H * 1000) / 1000, away: Math.round(tilt.A * 1000) / 1000 }, envSd, teamSd },
    playLogFields: "generic envelope: seq, t (elapsed game seconds), period, clock, score (after the event), type, text, payload (sport-specific; football: poss, down, togo, yl = yards to the opponent goal line, at the snap for type 'play', after the event otherwise)",
    representative: { index: best, seed: drawSeed(seed, 0, best), names: { home: names.H, away: names.A }, final: { home: rep.H, away: rep.A }, periods: { home: rep.periods.H, away: rep.periods.A }, overtimePoints: { home: rep.otPoints?.H ?? 0, away: rep.otPoints?.A ?? 0 }, overtime: rep.ot,
      lineScore: lineScore(rep), events: rep.events },
  };
}
