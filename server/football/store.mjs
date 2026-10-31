// Loads the published football data (ratings, schedule, params, history) and runs Monte Carlo sims for real
// upcoming games and for fictional / cross-era / cross-level matchups. All numbers come from the daily refresh.
import fs from "node:fs";
import path from "node:path";
import { sportForLeague } from "../sports/index.mjs";
import { buildCurve, runMonteCarlo } from "../sim/montecarlo.mjs";

export const LEAGUES = ["nfl", "ncaaf"];
import { ATTRIBUTION, NFL_ATTRIBUTION, NCAAF_ATTRIBUTION } from "./attribution.mjs";
export { ATTRIBUTION, NFL_ATTRIBUTION, NCAAF_ATTRIBUTION };
// Larry's binding rules (Oct 31): betting disclaimers + non-affiliation line; teams as plain-text "City Name" only; no
// player names/likenesses, logos, helmets or mascot art anywhere (UI, play logs, API).
export const disclaimer = (name) => `${name} provides sports simulations and predictions for entertainment and informational purposes only. ` +
  "It is not betting, financial or legal advice, and no outcome is guaranteed. Op3x LLC is not a sportsbook and does not accept wagers. " +
  "You must be 21+ and located where sports betting is legal to place bets; check your local laws. If you or someone you know has a gambling problem, call 1-800-GAMBLER. " +
  `${name} is not affiliated with or endorsed by the NFL, the NCAA, any conference or any team.`;
export const ENTERTAINMENT = "For entertainment only: a hypothetical matchup that cannot be played, not a prediction of a real game.";
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

// Rigor step 2 (docs/sim-methodology.md 5b): game-environment shock, chosen on the 2023 test season only (envSd 0.6/0.8 compared;
// 0.8 brought total 80/95% coverage to 79.6/94.4 there and 81.9/95.1 across 2023-2026). A per-team shock (teamSd) was tried and dropped:
// it helped margin coverage but worsened Brier and log loss. NCAAF is not fitted yet (step 5), so it gets no shock.
export const SIM_UNCERTAINTY = { nfl: { envSd: 0.8, teamSd: 0 }, ncaaf: { envSd: 0, teamSd: 0 } };

export function createFootballStore({ publicDir, env = process.env, log = console.log } = {}) {
  const levelGap = Number(env.FOOTBALL_LEVEL_GAP_POINTS || 30);
  const L = {}; // league -> { ratings, schedule, history, params, S, curve }
  const sims = new Map(); // game sims cache: id -> result

  function load() {
    for (const lg of LEAGUES) {
      const dir = path.join(publicDir || "", "football", lg);
      const params = readJson(path.join(dir, "params.json"));
      const prev = L[lg] || {};
      const x = { ratings: readJson(path.join(dir, "ratings.json")), schedule: readJson(path.join(dir, "schedule.json")), history: readJson(path.join(dir, "history.json")), params };
      if (params) {
        const sameParams = prev.params && prev.params.fittedAt === params.fittedAt;
        x.S = sameParams ? prev.S : (() => { const sp = sportForLeague(lg); const S = sp.prepare(params, lg); S.sim = sp.simulate; S.periods = sp.leagues[lg].rules.periods; S.periodName = "quarter"; return S; })();
        x.curve = sameParams ? prev.curve : null; // built lazily (about 1.3 s)
      }
      L[lg] = x;
    }
    sims.clear();
    log(`[football] data loaded: ${LEAGUES.map((lg) => `${lg}=${L[lg].ratings ? `${L[lg].ratings.teams.length} teams, ${(L[lg].schedule?.games || []).length} games` : "none"}`).join("; ")}`);
  }

  const status = () => readJson(path.join(publicDir || "", "football", "status.json"));
  const curveFor = (lg) => { const x = L[lg]; if (!x?.S) return null; if (!x.curve) x.curve = buildCurve(x.S); return x.curve; };
  const ready = (lg) => !!(L[lg]?.S && L[lg]?.ratings);

  /** Team ratings {off, def, name} for league/team/season (season omitted = current). */
  function teamRating(lg, team, season) {
    const x = L[lg]; if (!x?.ratings) return null;
    const cur = x.ratings.season;
    if (season == null || Number(season) === cur) {
      const t = x.ratings.teams.find((r) => r.team === team || r.name.toLowerCase() === String(team).toLowerCase());
      return t ? { team: t.team, name: t.name, off: t.off, def: t.def, elo: t.elo ?? null, season: cur, model: x.ratings.model, marginModel: x.ratings.marginModel || null } : null;
    }
    const h = x.history?.seasons?.[String(season)];
    const key = h && (h[team] ? team : Object.keys(h).find((k) => k.toLowerCase() === String(team).toLowerCase()));
    if (!key) return null;
    const cname = x.ratings.teams.find((r) => r.team === key)?.name || key;
    return { team: key, name: `${season} ${cname}`, off: h[key].off, def: h[key].def, season: Number(season), model: x.history.model || x.ratings.model };
  }

  const pts = (model, off, oppDef, site) => model.a + model.b * (off + oppDef) + (model.hfa * site) / 2;

  /** Expected points + rules for a matchup. side = {league, team, season}. */
  function matchup(home, away, { neutral = false } = {}) {
    const h = teamRating(home.league, home.team, home.season), a = teamRating(away.league, away.team, away.season);
    if (!h || !a) return { error: `unknown team: ${!h ? `${home.league}:${home.team}${home.season ? ` (${home.season})` : ""}` : `${away.league}:${away.team}${away.season ? ` (${away.season})` : ""}`}` };
    const site = neutral ? 0 : 1;
    let H, A, rules = home.league, notes = [];
    if (home.league === away.league) {
      const model = h.season === a.season ? h.model : L[home.league].ratings.model;
      H = pts(model, h.off, a.def, site); A = pts(model, a.off, h.def, -site);
      // Rigor step 1: same-season matchups take the margin from Elo (better out of sample), the total from EPA ratings.
      const mm = h.marginModel;
      if (h.season === a.season && mm?.type === "elo" && h.elo != null && a.elo != null) {
        const tot = H + A, mg = (h.elo - a.elo + mm.hfa * site) / mm.per_pt;
        H = (tot + mg) / 2; A = (tot - mg) / 2;
      }
      if (h.season !== a.season) notes.push("Cross-era: each team's ratings are relative to its own season's league average.");
    } else {
      rules = "nfl"; // mixed level: NFL rules
      const hm = h.model, am = a.model;
      H = pts(hm, h.off, 0, site) - pts(am, 0, a.def, 0) + pts(am, 0, 0, 0) ; A = pts(am, a.off, 0, -site) - pts(hm, 0, h.def, 0) + pts(hm, 0, 0, 0);
      const pro = home.league === "nfl" ? "H" : "A";
      if (pro === "H") { H += levelGap / 2; A -= levelGap / 2; } else { A += levelGap / 2; H -= levelGap / 2; }
      notes.push(`Cross-level: assumes an average NFL team is ${levelGap} points better than an average FBS team (an assumption, not data). NFL rules.`);
    }
    const floor = (v) => Math.max(3, v);
    const entertainment = h.season !== a.season || home.league !== away.league;
    return { home: h, away: a, target: { H: floor(H), A: floor(A) }, rules, neutral, notes, entertainment };
  }

  function simulate(m, { n = 2000, seed = 20261031, playoff = false } = {}) {
    const lg = m.rules; if (!ready(lg)) return { error: `${lg} simulation parameters are not loaded yet` };
    const res = runMonteCarlo(L[lg].S, { target: m.target, n, seed, playoff, curve: curveFor(lg), ...SIM_UNCERTAINTY[lg], names: { H: m.home.name || m.home.team, A: m.away.name || m.away.team } });
    return { ...res, teams: { home: { id: m.home.team, name: m.home.name, season: m.home.season }, away: { id: m.away.team, name: m.away.name, season: m.away.season } },
             neutral: m.neutral, rules: m.rules, expectedPoints: { home: Math.round(m.target.H * 10) / 10, away: Math.round(m.target.A * 10) / 10 },
             notes: m.notes, ...(m.entertainment ? { label: ENTERTAINMENT } : {}), attribution: ATTRIBUTION[m.rules] };
  }

  const games = (lg) => (L[lg]?.schedule?.games || []);
  const findGame = (id) => { for (const lg of LEAGUES) { const g = games(lg).find((x) => x.id === String(id)); if (g) return { lg, g }; } return null; };

  function gameSim(id, n = Number(env.FOOTBALL_GAME_SIMS || 10000)) {
    if (sims.has(id)) return sims.get(id);
    const f = findGame(id); if (!f) return null;
    const { lg, g } = f;
    if (!ready(lg)) return { error: `${lg} data not loaded` };
    const m = matchup({ league: lg, team: g.home }, { league: lg, team: g.away }, { neutral: g.neutral });
    if (m.error) return m;
    const seed = [...String(id)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
    const r = { game: g, ...simulate(m, { n, seed, playoff: !!g.playoff }) };
    sims.set(id, r);
    return r;
  }

  /** Precompute sims for upcoming games (next `days`), one game per tick so requests keep flowing. */
  function precompute(days = 8, done = () => {}) {
    const now = Date.now(), lim = now + days * 864e5;
    const todo = LEAGUES.flatMap((lg) => games(lg).filter((g) => g.status !== "final" && g.kickoff && Date.parse(g.kickoff) > now - 6 * 3600e3 && Date.parse(g.kickoff) < lim).map((g) => g.id));
    let i = 0;
    const step = () => {
      if (i >= todo.length) { log(`[football] precomputed ${todo.length} game sims`); return done(todo.length); }
      try { gameSim(todo[i]); } catch (e) { log(`[football] sim ${todo[i]} failed: ${e.message}`); }
      i++; setImmediate(step);
    };
    setImmediate(step);
  }

  return { load, status, ready, teamRating, matchup, simulate, games, findGame, gameSim, precompute, data: L };
}
