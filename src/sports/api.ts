// Typed client. Order per call: the agreed endpoint (/api/leagues, /api/scores, /api/schedule, POST /api/sim),
// then the football worker's current endpoints (/api/football/*), then the local SAMPLE fixture (labeled in the UI).
import type { League, Team, ScoreGame, ScoresResponse, SimRequest, SimResult, PlayEvent, FootballPayload, Source, GameStatus } from "./types";
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
const fromFootballRow = (lg: string) => (g: any): ScoreGame => ({
  id: String(g.id), league: g.league || lg, start: g.kickoff || g.start, status: normStatus(g.status),
  home: { id: String(g.home), name: g.homeName || String(g.home) }, away: { id: String(g.away), name: g.awayName || String(g.away) },
  homeScore: g.homeScore ?? null, awayScore: g.awayScore ?? null, period: g.period ?? null, clock: g.clock ?? null, detail: g.detail ?? null,
});

export async function getLeagues(): Promise<Sourced<League[]>> {
  try {
    const j = await getJson<League[] | { leagues: League[] }>("/api/leagues");
    return { data: Array.isArray(j) ? j : j.leagues, source: "live" };
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
      async () => (await getJson<ScoresResponse>("/api/scores")).games,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (await getJson<{ games: any[] }>("/api/football/ticker")).games.map(fromFootballRow("nfl")),
    );
    return { data: games, source: "live" };
  } catch { return { data: mockScores(), source: "sample" }; }
}

export async function getSchedule(leagues: string[]): Promise<Sourced<ScoreGame[]>> {
  try {
    const games = await firstOk<ScoreGame[]>(
      async () => (await getJson<ScoresResponse>("/api/schedule")).games,
      async () => (await Promise.all(leagues.map(async (lg) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await getJson<{ games: any[] }>(`/api/football/games?league=${lg}&upcoming=1`)).games.map(fromFootballRow(lg))))).flat(),
    );
    return { data: games.filter((g) => g.status !== "final").sort((a, b) => a.start.localeCompare(b.start)), source: "live" };
  } catch { return { data: mockScores().filter((g) => g.status === "scheduled"), source: "sample" }; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromFootballSim(r: any, req: SimRequest): SimResult {
  const homeId = String(r.teams?.home?.id ?? req.home);
  const rep = r.representative || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: PlayEvent<FootballPayload>[] = (rep.plays || rep.events || []).map((p: any, i: number) => p.payload ? { ...p, t: p.t ?? i } : ({
    t: i, period: p.q ?? p.period, clock: p.clock, score: p.score, type: p.type, text: p.text,
    payload: { possession: p.poss == null ? null : String(p.poss) === homeId || p.poss === rep.names?.home ? "home" : "away",
               down: p.down ?? null, distance: p.togo ?? null, yardline: p.yl ?? null, playType: p.playType ?? null, yards: p.yards ?? null },
  }));
  return {
    league: r.league || req.league, sport: "football", n: r.n, sample: false,
    teams: { home: { id: homeId, name: r.teams?.home?.name || req.home, season: r.teams?.home?.season }, away: { id: String(r.teams?.away?.id ?? req.away), name: r.teams?.away?.name || req.away, season: r.teams?.away?.season } },
    winProbability: r.winProbability, margin: r.margin, total: r.total, medianScore: r.medianScore,
    periodScores: r.periodScores || r.medianByQuarter, entertainmentOnly: !!(r.entertainmentOnly || r.label), label: r.label,
    representative: { final: rep.final, periods: rep.periods || rep.quarters, overtime: !!rep.overtime, events },
  };
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
