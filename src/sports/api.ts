// Typed client. Order per call: the agreed endpoint (/api/leagues, /api/scores, /api/schedule, POST /api/sim),
// then the football worker's current endpoints (/api/football/*), then the local SAMPLE fixture (labeled in the UI).
import type { League, Team, ScoreGame, SimRequest, SimResult, PlayEvent, FootballPayload, Source, GameStatus } from "./types";
import { MOCK_LEAGUES, MOCK_TEAMS, mockScores, mockSim } from "../mock/fixtures";

export interface Sourced<T> { data: T; source: Source }

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.headers || {}) } });
  if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
async function firstOk<T>(...tries: Array<() => Promise<T>>): Promise<T> {
  let err: unknown;
  for (const t of tries) { try { return await t(); } catch (e) { err = e; } }
  throw err;
}

const normStatus = (s: unknown): GameStatus => {
  const v = String(s || "").toLowerCase();
  if (/final|post$|complete/.test(v)) return "final";
  if (/postpon|cancel/.test(v)) return "postponed";
  if (v === "in" || /live|progress|half/.test(v)) return "live";
  return "scheduled";
};

// /api/football/ticker and /api/football/games rows -> ScoreGame
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromFootballRow = (lg: string) => (g: any): ScoreGame => (g.home && typeof g.home === "object" ? { ...g, league: g.league || lg, status: normStatus(g.status) } : {
  id: String(g.id), league: g.league || lg, start: g.kickoff || g.start, status: normStatus(g.status),
  home: { id: String(g.home), name: g.homeName || String(g.home) }, away: { id: String(g.away), name: g.awayName || String(g.away) },
  homeScore: g.homeScore ?? null, awayScore: g.awayScore ?? null, period: g.period ?? g.quarter ?? null, clock: g.clock ?? null, detail: g.detail ?? null,
});
// Outside production, an empty live feed shows the labeled sample so the preview still demonstrates the UI.
const demoFallback = __APP_ENV__ !== "production";

// Larry memo 24: data-source credits come from /api/leagues `attribution`. This copy of the memo wording is only
// used when the API can't be reached (sample mode), so the footer never drops the credit.
export const REQUIRED_ATTRIBUTION: Record<string, string> = {
  nfl: "NFL data: nflverse (github.com/nflverse/nflverse-data), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified by Op3x LLC (aggregated, modeled and simulated). Not affiliated with or endorsed by the NFL or nflverse.",
  ncaaf: "Data provided by CollegeFootballData.com.",
};
export function attributionFor(id: string, api?: string): string | undefined {
  const req = REQUIRED_ATTRIBUTION[id];
  return api || req;
}

// /api/leagues rows: either League-shaped or the engine's SportModule rows {id, sport, name, rules:{periods}, ready}.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromLeagueRow = (l: any): League => {
  const mock = MOCK_LEAGUES.find((m) => m.id === l.id);
  const count = l.periods?.count ?? l.rules?.periods ?? mock?.periods.count ?? 4;
  return { id: String(l.id), sport: l.sport, name: mock?.name || String(l.name || l.id).toUpperCase(),
    periods: l.periods?.label ? l.periods : { count, label: count === 2 ? "Half" : "Quarter", short: count === 2 ? "H" : "Q" },
    enabled: l.enabled ?? true, attribution: attributionFor(String(l.id), l.attribution), injuriesModeled: l.injuriesModeled === true };
};
export async function getLeagues(): Promise<Sourced<League[]>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = await getJson<any>("/api/leagues");
    const live: League[] = (Array.isArray(j) ? j : j.leagues).map(fromLeagueRow);
    if (!live.length) throw new Error("no leagues");
    // Sports the server doesn't serve yet stay visible as "coming soon".
    return { data: [...live, ...MOCK_LEAGUES.filter((m) => !m.enabled && !live.some((l) => l.id === m.id))], source: "live" };
  } catch { return { data: MOCK_LEAGUES, source: "sample" }; }
}

export async function getTeams(league: string): Promise<Sourced<Team[]>> {
  try {
    const teams = await firstOk<Team[]>(
      async () => { const j = await getJson<{ teams: Team[] } | Team[]>(`/api/teams?league=${encodeURIComponent(league)}`); return Array.isArray(j) ? j : j.teams; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (await getJson<{ teams: any[] }>(`/api/football/teams?league=${encodeURIComponent(league)}`)).teams.map((t) => ({ id: String(t.team ?? t.id), name: String(t.name) })),
    );
    if (!teams.length) throw new Error("no teams");
    return { data: [...teams].sort((a, b) => a.name.localeCompare(b.name)), source: "live" };
  } catch { return { data: [...(MOCK_TEAMS[league] || [])].sort((a, b) => a.name.localeCompare(b.name)), source: "sample" }; }
}

export async function getScores(): Promise<Sourced<ScoreGame[]>> {
  try {
    const games = await firstOk<ScoreGame[]>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (await getJson<{ games: any[] }>("/api/scores")).games.map(fromFootballRow("nfl")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (await getJson<{ games: any[] }>("/api/football/ticker")).games.map(fromFootballRow("nfl")),
    );
    if (!games.length && demoFallback) throw new Error("empty");
    return { data: games, source: "live" };
  } catch { return { data: mockScores(), source: "sample" }; }
}

export async function getSchedule(leagues: string[]): Promise<Sourced<ScoreGame[]>> {
  try {
    // Per league, so one league still warming up (startup refresh) doesn't push the others to sample data.
    const one = (lg: string) => firstOk<ScoreGame[]>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (await getJson<{ games: any[] }>(`/api/schedule?league=${lg}&upcoming=1`)).games.map(fromFootballRow(lg)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (await getJson<{ games: any[] }>(`/api/football/games?league=${lg}&upcoming=1`)).games.map(fromFootballRow(lg)),
    );
    const settled = await Promise.allSettled(leagues.map(one));
    const ok = settled.filter((r): r is PromiseFulfilledResult<ScoreGame[]> => r.status === "fulfilled");
    if (!ok.length) throw new Error("no schedule");
    const games = ok.flatMap((r) => r.value);
    const up = games.filter((g) => g.status !== "final" && g.start).sort((a, b) => a.start.localeCompare(b.start));
    if (!up.length && demoFallback) throw new Error("empty");
    return { data: up, source: "live" };
  } catch { return { data: mockScores().filter((g) => g.status === "scheduled"), source: "sample" }; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromFootballSim(r: any, req: SimRequest): SimResult {
  const homeId = String(r.teams?.home?.id ?? req.home);
  const rep = r.representative || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const homeName = r.teams?.home?.name ?? rep.names?.home;
  // Engine envelope: {seq, t (elapsed game seconds), period, clock, score, type, text, payload:{poss, down, togo, yl, playType, yards}}
  // (older shape: flat {q, poss, ...}). UI envelope: t = event index, payload in UI field names.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: PlayEvent<FootballPayload>[] = (rep.events || rep.plays || []).map((e: any, i: number) => {
    const p = e.payload || e, poss = p.poss ?? p.possession;
    return { t: i, period: e.period ?? e.q, clock: e.clock, score: e.score, type: e.type, text: e.text,
      payload: { possession: poss == null ? null : poss === "home" || String(poss) === homeId || poss === homeName ? "home" : "away",
                 down: p.down ?? null, distance: p.togo ?? p.distance ?? null, yardline: p.yl ?? p.yardline ?? null, playType: p.playType ?? null, yards: p.yards ?? null } };
  });
  return {
    league: r.league || req.league, sport: "football", n: r.n, sample: false,
    teams: { home: { id: homeId, name: r.teams?.home?.name || req.home, season: r.teams?.home?.season }, away: { id: String(r.teams?.away?.id ?? req.away), name: r.teams?.away?.name || req.away, season: r.teams?.away?.season } },
    winProbability: r.winProbability, margin: r.margin, total: r.total, medianScore: r.medianScore,
    // periodLine: whole-point quarters that add up to the median final (9d5ef46). medianByPeriod only as fallback.
    periodScores: r.periodLine?.home ? r.periodLine : (r.periodScores || r.medianByPeriod || r.medianByQuarter), periodKind: r.periodLine?.home ? "line" : "median",
    entertainmentOnly: !!(r.entertainmentOnly || r.label), label: r.label,
    // /api/sim routes a picked matchup that's on the schedule to that game's own sim (no tag, NFL injury-adjusted when on).
    scheduled: !!r.scheduledGameId, ...(r.scheduledGameId && (r.league || req.league) === "nfl" ? { injuryAdjusted: true } : {}),
    representative: { final: rep.final, periods: rep.periods || rep.quarters, overtime: !!rep.overtime, events },
  };
}

/** Scheduled game (server game id): the precomputed game sim, which carries NFL injury adjustments when they're on.
 *  Falls back to the custom matchup sim (no injury adjustment). */
export async function runGameSim(gameId: string, req: SimRequest, names: { home: Team; away: Team }): Promise<SimResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = await getJson<any>(`/api/football/games/${encodeURIComponent(gameId)}/sim`);
    const r = fromFootballSim(j, req);
    // Scheduled NFL game: the server applies availability whenever a report exists (no report yet = no adjustment needed).
    r.injuryAdjusted = req.league === "nfl";
    return r;
  } catch { return runSim(req, names); }
}

export async function runSim(req: SimRequest, names: { home: Team; away: Team }): Promise<SimResult> {
  try {
    return await firstOk<SimResult>(
      async () => fromFootballSim(await getJson("/api/sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) }), req),
      async () => {
        const q = new URLSearchParams({ league: req.league, home: req.home, away: req.away, n: String(req.n) });
        if (req.homeLeague) q.set("homeLeague", req.homeLeague);
        if (req.awayLeague) q.set("awayLeague", req.awayLeague);
        if (req.homeSeason) q.set("homeSeason", String(req.homeSeason));
        if (req.awaySeason) q.set("awaySeason", String(req.awaySeason));
        if (req.neutral) q.set("neutral", "1");
        return fromFootballSim(await getJson(`/api/football/sim?${q}`), req);
      },
    );
  } catch { return mockSim(req, names.home, names.away); }
}
