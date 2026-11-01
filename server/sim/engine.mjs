// Snap-by-snap football game simulator (NFL and NCAAF rules). Pure, seeded, no I/O.
//
// Play-level texture (play calls, gains, sacks, turnovers, penalties, clock run-off, kicking) comes from real
// nflverse play-by-play frequencies fitted in scripts/football/params.py. Team strength enters through one
// "tilt" per offense (t, in yards per play): it shifts gains and scales turnover/sack/completion odds.
// calibrate.mjs solves the two tilts so the simulated mean points match the ratings' expected points.

export const RULES = {
  nfl: { league: "nfl", quarterSec: 900, otSec: 600, otSecPlayoff: 900, twoMinuteWarning: true, firstDownStopsLate: false,
         tempo: 1.0, halfHurrySec: 90, timeouts: 3, ot: "nfl", safetyFreeKickStart: 60, fgMaxDist: 66, fgSnapAdd: 17, twoPointFrom: 2 },
  ncaaf: { league: "ncaaf", quarterSec: 900, otSec: 0, otSecPlayoff: 0, twoMinuteWarning: false, firstDownStopsLate: true,
           tempo: 0.88, halfHurrySec: 90, timeouts: 3, ot: "ncaaf", safetyFreeKickStart: 60, fgMaxDist: 62, fgSnapAdd: 17, twoPointFrom: 3 },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function prepHist(h) {
  const v = Int16Array.from(h.v), cum = new Float64Array(h.n.length);
  let s = 0; for (let i = 0; i < h.n.length; i++) { s += h.n[i]; cum[i] = s; }
  return { v, cum, total: s };
}
function sample(ph, rng) {
  const x = rng() * ph.total, c = ph.cum; let lo = 0, hi = c.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] > x) hi = m; else lo = m + 1; }
  return ph.v[lo];
}

const DISTB = (t) => (t <= 1 ? "1" : t <= 3 ? "2-3" : t <= 6 ? "4-6" : t <= 10 ? "7-10" : "11+");
const DIST4 = (t) => (t <= 1 ? "1" : t <= 3 ? "2-3" : t <= 6 ? "4-6" : "7+");

/** Turn the params JSON into fast lookup structures (do once per params object). */
export function prepare(params, league = params.league || "nfl") {
  if (!RULES[league]) throw new Error(`unknown league ${league}`);
  const rules = { ...RULES[league], ...(params.rules || {}) };   // fitted per-league overrides (e.g. NCAAF tempo)
  const clock = {}; for (const [k, h] of Object.entries(params.clock)) clock[k] = prepHist(h);
  const punt = {}; for (const [k, h] of Object.entries(params.punt.landing)) punt[k] = prepHist(h);
  const call = {}; for (const [k, [p, t]] of Object.entries(params.playCall)) call[k] = { p, t };
  return {
    params, rules, league, call, fourth: params.fourthDown, clock, punt,
    runY: prepHist(params.run.yards), compY: prepHist(params.dropback.completeYards), sackY: prepHist(params.dropback.sackYards),
    scrY: prepHist(params.dropback.scrambleYards), offPenY: prepHist(params.penalty.offenseYards), defPenY: prepHist(params.penalty.defenseYards),
    kickStart: prepHist(params.kickoff.start), intRel: prepHist(params.turnover.intRel), fumRel: prepHist(params.turnover.fumRel),
  };
}

const ordinal = ["", "1st", "2nd", "3rd", "4th"];
function spot(yl, off, def) { return yl === 50 ? "50" : yl > 50 ? `${off} ${100 - yl}` : `${def} ${yl}`; }
function clockStr(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

/**
 * Simulate one game.
 * opts: { tilt: {H, A}, names: {H, A}, playoff: bool, record: bool, rng }
 * returns { H, A, q: {H: [..], A: [..]}, ot: bool, plays?: [...] }
 */
export function simulateGame(S, opts) {
  const { rules, params: P } = S;
  const rng = opts.rng;
  const tilt = opts.tilt || { H: 0, A: 0 };
  const names = opts.names || { H: "HOME", A: "AWAY" };
  const rec = opts.record ? [] : null;
  const score = { H: 0, A: 0 };
  const qs = { H: [0, 0, 0, 0], A: [0, 0, 0, 0] };
  const otPts = { H: 0, A: 0 }; // overtime points are kept out of Q4 (the quarter line is regulation only)
  const other = (s) => (s === "H" ? "A" : "H");
  let qtr = 1, clock = rules.quarterSec, poss = "H", yl = 75, down = 1, togo = 10;
  const tos = { H: rules.timeouts || 0, A: rules.timeouts || 0 };
  let ended = false, inOT = false, otPossessions = 0, otPeriod = 0, driveOver = false;
  const firstReceiver = rng() < 0.5 ? "H" : "A";

  const qIndex = () => Math.min(qtr, 4) - 1;
  const add = (side, pts) => { score[side] += pts; if (qtr > 4) otPts[side] += pts; else qs[side][qIndex()] += pts; };
  const hsr = () => (qtr === 1 || qtr === 3 ? clock + rules.quarterSec : clock);
  const log = (type, text, extra = {}) => {
    if (!rec) return;
    rec.push({ q: qtr, clock: clockStr(clock), poss: names[poss], down, togo, yl, type, text, score: { home: score.H, away: score.A }, ...extra });
  };
  const sit = () => {
    const sd = score[poss] - score[other(poss)];
    if (qtr === 4 && clock <= 600 && sd > 0) return "late_lead";
    if ((qtr === 4 && clock <= 600 && sd < 0) || (qtr === 2 && clock <= S.rules.halfHurrySec) || (qtr === 4 && clock <= 120 && sd <= 0) || (inOT && sd <= 0)) return "hurry";
    return "norm";
  };
  const shiftYards = (y, t) => { const s = t * 1.0; const f = Math.floor(s); return y + f + (rng() < s - f ? 1 : 0); };

  function runClock(cat, firstDown) {
    if (clock <= 0) return;
    const key = (sit() === "hurry" ? "hurry:" : "norm:") + cat;
    const h = S.clock[key] || S.clock["norm:" + cat];
    let el = h ? sample(h, rng) : 6;
    el = Math.round(el * rules.tempo);
    // timeouts (3 per team per half) inside the last two minutes of each half: the side that wants the clock stopped
    // (a hurrying offense, or a trailing defense) stops it after an in-bounds play. Each saves the run-off beyond ~5 s.
    if (rules.timeouts && (qtr === 2 || qtr === 4) && !inOT && clock <= 120 && (cat === "run" || cat === "complete" || cat === "sack") && el > 5) {
      const d = other(poss), sd = score[poss] - score[d];
      const who = sit() === "hurry" && tos[poss] > 0 ? poss : tos[d] > 0 && qtr === 4 && sd > 0 ? d : null;
      if (who) { tos[who]--; el = 5; }
    }
    if (rules.firstDownStopsLate && firstDown && (qtr === 2 || qtr === 4) && clock <= 120) el = Math.min(el, 8);
    if (rules.twoMinuteWarning && (qtr === 2 || qtr === 4) && !inOT && clock > 120 && clock - el < 120) { clock = 120; return; }
    clock -= el;
  }

  function newPossession(side, startYl) { poss = side; yl = Math.max(1, Math.min(99, Math.round(startYl))); down = 1; togo = Math.min(10, yl); if (inOT) otPossessions++; }

  function kickoff(kicking) {
    const recv = other(kicking);
    if (rng() < P.kickoff.returnTd) { log("kickoff", `${names[recv]} returns the kickoff for a touchdown`); poss = recv; touchdown(); return; }
    const s = sample(S.kickStart, rng); clock = Math.max(0, clock - (rules.league === "nfl" ? 5 : 5));
    newPossession(recv, s); log("kickoff", `Kickoff, ${names[recv]} starts at ${spot(yl, names[recv], names[kicking])}`);
  }

  function checkOtEnd() {
    if (!inOT) return false;
    if (rules.ot === "nfl" && otPossessions >= 2 && score.H !== score.A) { ended = true; return true; }
    return false;
  }

  function pat() {
    const sd = score[poss] - score[other(poss)];
    let go2 = rng() < P.extraPoint.twoPointRate;
    if (qtr === 4 && clock <= 600) go2 = [-2, -5, -10, 1, 5, -9, -13].includes(sd);
    if (inOT && rules.ot === "ncaaf" && otPeriod >= 2) go2 = true;            // NCAAF: two-point try required from the 2nd OT
    if (inOT && rules.ot === "nfl" && sd < 0) go2 = sd === -1 ? rng() < 0.5 : true;
    if (go2) {
      const ok = rng() < Math.min(0.9, Math.max(0.1, P.extraPoint.twoPointSuccess + 0.02 * tilt[poss]));
      if (ok) add(poss, 2);
      log("two_point", `Two-point try ${ok ? "is GOOD" : "fails"}`);
    } else {
      const ok = rng() < P.extraPoint.make; if (ok) add(poss, 1);
      log("extra_point", `Extra point ${ok ? "is good" : "is NO GOOD"}`);
    }
  }

  function touchdown() {
    add(poss, 6); log("touchdown", `TOUCHDOWN ${names[poss]}`);
    if (inOT && rules.ot === "nfl" && otPossessions >= 2 && score[poss] > score[other(poss)]) { ended = true; return; }
    pat();
    if (checkOtEnd()) return;
    if (inOT && rules.ot === "ncaaf") return;
    kickoff(poss);
  }

  function safety() {
    const def = other(poss); add(def, 2); log("safety", `SAFETY, 2 points ${names[def]}`);
    if (inOT && rules.ot === "nfl") { ended = true; return; }
    newPossession(def, rules.safetyFreeKickStart);
  }

  function turnover(kind, losYl) {
    const def = other(poss);
    const pTd = kind === "int" ? P.turnover.intTd : P.turnover.fumTd;
    if (rng() < pTd) { poss = def; log(kind, `${kind === "int" ? "INTERCEPTED" : "FUMBLE lost"}, returned for a touchdown`); touchdown(); return; }
    const rel = sample(kind === "int" ? S.intRel : S.fumRel, rng);
    const was = names[poss];
    newPossession(def, 100 - losYl + rel);
    log(kind, `${kind === "int" ? "Pass INTERCEPTED" : "FUMBLE lost"} by ${was}; ${names[poss]} ball at ${spot(yl, names[poss], names[other(poss)])}`);
    if (inOT && rules.ot === "nfl") checkOtEnd();
  }

  function fieldGoal() {
    const dist = yl + rules.fgSnapAdd;
    const p = 1 / (1 + Math.exp(-(P.fieldGoal.a + P.fieldGoal.b * dist)));
    const ok = rng() < p; runClock("field_goal");
    if (ok) {
      add(poss, 3); log("field_goal", `${dist}-yard field goal is GOOD`);
      if (checkOtEnd()) return;
      if (inOT && rules.ot === "ncaaf") return;
      kickoff(poss);
    } else {
      log("field_goal", `${dist}-yard field goal is NO GOOD`);
      if (inOT && rules.ot === "ncaaf") { driveOver = true; return; }
      newPossession(other(poss), Math.min(80, 100 - (yl + 7)));
      checkOtEnd();
    }
  }

  function punt() {
    const bin = String(Math.min(9, Math.max(2, Math.floor(yl / 10))));
    const recv = other(poss), kicker = names[poss];
    runClock("punt");
    if (rng() < P.punt.returnTd) { poss = recv; log("punt", `Punt returned for a TOUCHDOWN`); touchdown(); return; }
    const land = sample(S.punt[bin] || S.punt["5"], rng);
    newPossession(recv, land); log("punt", `${kicker} punts; ${names[recv]} ball at ${spot(yl, names[recv], kicker)}`);
    checkOtEnd();
  }

  function fourthDownChoice() {
    const sd = score[poss] - score[other(poss)];
    const fgDist = yl + rules.fgSnapAdd;
    const inRange = fgDist <= rules.fgMaxDist - 4;
    // end-of-game logic
    if (qtr >= 4 && clock <= 30) {
      if (sd < 0 && sd >= -3 && inRange) return "fg";
      if (sd < 0) return "go";
    }
    if (inOT && rules.ot === "ncaaf") return sd >= -3 && sd < 0 && inRange ? "fg" : sd < -3 ? "go" : inRange && rng() < 0.85 ? "fg" : "go";
    const s = sit(), b = Math.min(9, Math.floor(yl / 10)), d = DIST4(togo);
    const c = S.fourth[`${b}|${d}|${s}`] && sumc(S.fourth[`${b}|${d}|${s}`]) >= 20 ? S.fourth[`${b}|${d}|${s}`] : S.fourth[`${b}|${d}|norm`] || { punt: 1 };
    const tot = sumc(c); let x = rng() * tot;
    for (const k of ["go", "fg", "punt"]) { x -= c[k] || 0; if (x < 0) return k === "fg" && fgDist > rules.fgMaxDist ? "punt" : k; }
    return "punt";
  }
  function sumc(c) { return (c.go || 0) + (c.fg || 0) + (c.punt || 0); }

  function snap() {
    const off = poss, def = other(poss), t = tilt[off] - 0;
    const dn = down, tg = togo, los = yl;
    // kneel to end the game
    if (qtr === 4 && !inOT && score[off] > score[def] && clock <= (5 - down) * 40 - 2 && down <= 4) {
      yl = Math.min(99, yl + 1); log("kneel", `${names[off]} kneels`); clock -= 40; down++; togo++;
      if (down > 4) newPossession(def, 100 - yl);
      return;
    }
    // end-of-half / end-of-regulation field goal try
    if (!inOT && (qtr === 2 || qtr === 4) && clock <= 6 && yl + rules.fgSnapAdd <= rules.fgMaxDist - 2) {
      const sd = score[off] - score[def];
      if (qtr === 2 || (sd >= -3 && sd <= 0)) { fieldGoal(); return; }
    }
    if (down === 4) {
      const ch = fourthDownChoice();
      if (ch === "fg") { fieldGoal(); return; }
      if (ch === "punt") { punt(); return; }
    }
    // penalties (pre-snap / no play)
    const pen = rng();
    if (pen < P.penalty.offense) {
      const y = sample(S.offPenY, rng); const yy = Math.min(y, Math.floor((100 - yl) / 2) || 1);
      yl = Math.min(99, yl + yy); togo += yy; runClock("penalty"); log("penalty", `Penalty on ${names[off]}, ${yy} yards`); return;
    }
    if (pen < P.penalty.offense + P.penalty.defense) {
      const y = sample(S.defPenY, rng); const yy = Math.max(1, Math.min(y, Math.floor(yl / 2)));
      yl -= yy; const fd = yy >= togo || rng() < P.penalty.defenseFirstDown;
      if (fd) { down = 1; togo = Math.min(10, yl); } else togo -= yy;
      runClock("penalty", fd); log("penalty", `Penalty on ${names[def]}, ${yy} yards${fd ? ", automatic first down" : ""}`); return;
    }
    // play call
    const s = sit(), k = `${Math.min(3, down)}|${DISTB(togo)}|${s}`;
    const pc = S.call[k] && S.call[k].t >= 30 ? S.call[k] : S.call[`${Math.min(3, down)}|${DISTB(togo)}|norm`] || { p: 1, t: 2 };
    const isPass = down === 4 ? rng() < 0.65 : rng() < pc.p / pc.t;
    let gain = 0, cat, text;
    const D = P.dropback, sc = Math.exp(-0.12 * t);
    if (isPass) {
      const u = rng();
      if (u < D.sack * Math.exp(-0.08 * t)) {
        gain = sample(S.sackY, rng); cat = "sack";
        if (rng() < D.sackFumbleLost) { runClock("sack"); turnover("fumble", los); return; }
        text = `${names[off]} QB sacked for ${-gain}`;
      } else if (u < D.sack * Math.exp(-0.08 * t) + D.scramble) {
        gain = shiftYards(sample(S.scrY, rng), t); cat = "run"; text = `QB scramble for ${gain}`;
      } else if (rng() < D.int * sc) {
        runClock("int"); turnover("int", los); return;
      } else if (rng() < Math.min(0.85, Math.max(0.35, D.complete + 0.012 * t))) {
        gain = shiftYards(sample(S.compY, rng), t); cat = "complete";
        if (rng() < D.completeFumbleLost * sc) { runClock("complete"); turnover("fumble", los); return; }
        text = `Pass complete for ${gain}`;
      } else { gain = 0; cat = "incomplete"; text = "Pass incomplete"; }
    } else {
      gain = shiftYards(sample(S.runY, rng), t); cat = "run";
      if (rng() < P.run.fumbleLost * sc) { runClock("run"); turnover("fumble", los); return; }
      text = `Run for ${gain}`;
    }
    if (yl - gain <= 0) { gain = yl; yl = 0; runClock(cat); log("play", `${ordinal[dn]} & ${tg} at ${spot(los, names[off], names[def])}: ${text.replace(/-?\d+$/, String(gain))} yards`, { poss: names[off], down: dn, togo: tg, yl: los, playType: isPass ? "pass" : "run", yards: gain }); touchdown(); return; }
    if (yl - gain >= 100) { runClock(cat); safety(); return; }
    yl -= gain; togo -= gain;
    const fd = togo <= 0;
    if (fd) { down = 1; togo = Math.min(10, yl); } else down++;
    runClock(cat, fd);
    log("play", `${ordinal[dn]} & ${tg} at ${spot(los, names[off], names[def])}: ${text}${cat === "incomplete" ? "" : " yards"}${fd ? ", FIRST DOWN" : ""}`, { poss: names[off], down: dn, togo: tg, yl: los, playType: isPass ? "pass" : "run", yards: gain });
    if (down > 4) { log("downs", `Turnover on downs`); newPossession(def, 100 - yl); checkOtEnd(); }
  }

  // ---------------------------------------------------------------- regulation
  kickoff(other(firstReceiver));
  while (!ended) {
    if (clock > 0) { snap(); continue; }
    if (inOT) {
      if (rules.ot === "nfl") {
        if (score.H !== score.A) break;
        if (!opts.playoff) { log("end", "End of overtime, TIE"); break; }
        clock = rules.otSecPlayoff; continue;                         // playoff: keep playing new periods
      }
    }
    if (qtr === 1 || qtr === 3) { log("end_quarter", `End of quarter ${qtr}`); qtr++; clock = rules.quarterSec; continue; }
    if (qtr === 2) { log("end_half", "Halftime"); qtr = 3; clock = rules.quarterSec; tos.H = tos.A = rules.timeouts || 0; kickoff(firstReceiver); continue; }
    if (qtr === 4) {
      if (score.H !== score.A) break;
      // overtime
      if (rules.ot === "nfl") {
        inOT = true; qtr = 5; clock = opts.playoff ? rules.otSecPlayoff : rules.otSec; otPossessions = 0;
        log("overtime", "Overtime"); const kick = rng() < 0.5 ? "H" : "A"; kickoff(kick); continue;
      }
      ncaafOvertime(); break;
    }
  }

  function ncaafOvertime() {
    inOT = true; qtr = 5;
    for (let period = 1; period < 30; period++) {
      otPeriod = period;
      const first = rng() < 0.5 ? "H" : "A";
      for (const side of [first, other(first)]) {
        if (period >= 3) {
          poss = side; yl = 3; down = 1; togo = 3;
          const ok = rng() < Math.min(0.9, Math.max(0.1, P.extraPoint.twoPointSuccess + 0.02 * tilt[side]));
          if (ok) add(side, 2); log("two_point", `OT${period}: ${names[side]} two-point try ${ok ? "is GOOD" : "fails"}`);
          continue;
        }
        newPossession(side, 25); clock = 1e9; log("overtime", `OT${period}: ${names[side]} ball at the ${spot(25, names[side], names[other(side)])}`);
        driveOver = false; let guard = 0;
        while (poss === side && !driveOver && guard++ < 80) {
          const s0 = score.H + score.A; snap(); if (score.H + score.A !== s0) break;
        }
      }
      if (score.H !== score.A) break;
    }
    clock = 0;
  }

  return { H: score.H, A: score.A, q: qs, otPoints: otPts, ot: inOT, plays: rec };
}
