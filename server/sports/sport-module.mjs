// Sport-agnostic contract. Every sport (football now; basketball later) is one SportModule registered here.
// The Monte Carlo runner (server/sim/montecarlo.mjs), interval/stat reporting, the API (/api/leagues, /api/sim,
// /api/schedule, /api/scores) and the 04:00 refresh scheduler only talk to this interface, keyed by league id.
//
// @typedef {Object} SportModule
// @property {string} id                         e.g. "football"
// @property {Object<string, LeagueConfig>} leagues   keyed by league id ("nfl", "ncaaf"; later "nba", "ncaab")
// @property {Object<string, {name: string, url: string, terms: string}>} providers  data sources (see research/data-sources-terms.md)
// @property {{command: string[], schedule: string}} ratingsFitter  child process the scheduler runs (stdlib Python),
//           it writes <publicDir>/<league>/{ratings,schedule,params}.json
// @property {(params: object, league: string) => PreparedSport} prepare   build fast lookup state from fitted params
// @property {(S: PreparedSport, opts: {rng, tilt, names, playoff, record}) => GameResult} simulate   one game, seeded
// @property {Object} playLogSchema               sport-specific payload fields of a play-log event
//
// @typedef {Object} LeagueConfig
// @property {string} name
// @property {{periods: number, periodSec: number, overtime: string, scoringEvents: Object<string, number>}} rules
//
// @typedef {Object} GameResult   { H, A, periods: {H: number[], A: number[]}, ot: boolean, events?: Event[] }
// @typedef {Object} Event        generic play-log envelope (what the UI dispatches on):
//   { seq, t (elapsed game seconds), period, clock ("m:ss" remaining), score: {home, away}, type, text, payload }
//   `payload` is sport-specific (football: poss, down, togo, yl, playType, yards).

const sports = new Map();      // id -> module
const byLeague = new Map();    // league -> module

export function registerSport(mod) {
  for (const k of ["id", "leagues", "providers", "ratingsFitter", "prepare", "simulate", "playLogSchema"]) {
    if (mod[k] == null) throw new Error(`SportModule ${mod.id || "?"} is missing ${k}`);
  }
  for (const [l, cfg] of Object.entries(mod.leagues)) {
    if (!cfg.rules || !Number.isInteger(cfg.rules.periods)) throw new Error(`league ${l}: rules.periods required`);
    byLeague.set(l, mod);
  }
  sports.set(mod.id, mod);
  return mod;
}

export const sportForLeague = (league) => byLeague.get(String(league || "").toLowerCase()) || null;
export const allLeagues = () => [...byLeague.entries()].map(([id, m]) => ({ id, sport: m.id, ...m.leagues[id] }));
export const allSports = () => [...sports.values()];

/** Generic envelope for one play-log event. */
export function envelope({ seq, t, period, clock, score, type, text, payload }) {
  return { seq, t, period, clock, score, type, text, payload: payload || {} };
}
