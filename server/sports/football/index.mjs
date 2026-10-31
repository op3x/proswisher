// Football SportModule (NFL + NCAAF): wraps the snap-by-snap engine in the generic sport contract.
import { RULES, prepare as prepareEngine, simulateGame } from "../../sim/engine.mjs";
import { envelope } from "../sport-module.mjs";

const clockSec = (c) => { const [m, s] = String(c || "0:00").split(":").map(Number); return m * 60 + (s || 0); };

/** Convert the engine's football play record into the generic envelope. */
export function toEvent(p, seq, rules) {
  const per = rules.quarterSec;
  const t = p.q <= 4 ? (p.q - 1) * per + (per - clockSec(p.clock)) : 4 * per + Math.max(0, (rules.otSec || per) - clockSec(p.clock));
  return envelope({ seq, t, period: p.q, clock: p.clock, score: p.score, type: p.type, text: p.text,
    payload: { poss: p.poss, down: p.down, togo: p.togo, yl: p.yl, ...(p.playType ? { playType: p.playType, yards: p.yards } : {}) } });
}

const leagueRules = (r) => ({ periods: 4, periodSec: r.quarterSec, overtime: r.ot, twoMinuteWarning: r.twoMinuteWarning,
  scoringEvents: { touchdown: 6, field_goal: 3, safety: 2, extra_point: 1, two_point: 2 } });

export const football = {
  id: "football",
  leagues: {
    nfl: { name: "NFL", rules: leagueRules(RULES.nfl), attribution: "Data: nflverse (CC-BY 4.0)" },
    ncaaf: { name: "NCAA Football (FBS)", rules: leagueRules(RULES.ncaaf), attribution: "Data: CollegeFootballData.com" },
  },
  providers: {
    nfl: { name: "nflverse-data", url: "https://github.com/nflverse/nflverse-data", terms: "CC-BY 4.0" },
    ncaaf: { name: "CollegeFootballData.com", url: "https://api.collegefootballdata.com", terms: "commercial use permitted; no raw redistribution" },
  },
  ratingsFitter: { command: ["python3", "scripts/football/refresh.py"], schedule: "daily 04:00 America/Chicago" },
  prepare: (params, league) => prepareEngine(params, league),
  simulate: (S, opts) => {
    const g = simulateGame(S, opts);
    return { H: g.H, A: g.A, periods: g.q, ot: g.ot, events: g.plays ? g.plays.map((p, i) => toEvent(p, i, S.rules)) : undefined };
  },
  playLogSchema: {
    envelope: "seq, t (elapsed game seconds), period (5+ = overtime), clock (m:ss left in period), score {home, away}, type, text, payload",
    types: ["kickoff", "play", "penalty", "kneel", "punt", "field_goal", "touchdown", "extra_point", "two_point", "safety", "int", "fumble", "downs", "end_quarter", "end_half", "overtime", "end"],
    payload: { poss: "offense team display name", down: "1-4 at the snap", togo: "yards to go", yl: "yards from the offense to the opponent goal line", playType: "pass | run (type 'play' only)", yards: "yards gained (type 'play' only)" },
  },
};
