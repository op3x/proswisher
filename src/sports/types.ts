// Sport-agnostic contracts for the UI. Football ships first; NBA/NCAAB slot in later by adding a league to
// GET /api/leagues and a renderer to src/renderers/registry.ts. Nothing here is football-specific except the
// optional FootballPayload, which lives inside the generic event envelope.

export type Sport = "football" | "basketball"; // basketball: reserved, no renderer yet

export interface League {
  id: string;            // "nfl" | "ncaaf" (later "nba" | "ncaab")
  name: string;          // "NFL"
  sport: Sport;
  periods: { count: number; label: string; short: string }; // football: 4 quarters "Q"; basketball: 4 quarters / 2 halves
  enabled: boolean;      // false = "coming soon" in the picker
  attribution?: string;  // data-source credit from /api/leagues (Larry memo 24)
}

export interface Team { id: string; name: string } // name = plain-text "City Name" (e.g. "Chicago Bears"), never logos

export type GameStatus = "scheduled" | "live" | "final" | "postponed";

/** One ticker / schedule row. Generic over leagues and periods. */
export interface ScoreGame {
  id: string;
  league: string;
  start: string;            // ISO 8601; rendered in Central Time
  status: GameStatus;
  home: Team;
  away: Team;
  homeScore: number | null;
  awayScore: number | null;
  period?: number | null;   // live only
  clock?: string | null;    // live only, "8:41"
  detail?: string | null;   // e.g. "Final/OT", "Delayed"
}

export interface ScoresResponse { games: ScoreGame[]; source?: string; updatedAt?: string }

export interface SimRequest { league: string; home: string; away: string; n: number; homeLeague?: string; awayLeague?: string; homeSeason?: number; awaySeason?: number; neutral?: boolean }

export interface Dist { mean: number; median: number; p05: number; p25: number; p75: number; p95: number }

/** Generic play-log event envelope. Sport fields live in payload. */
export interface PlayEvent<P = unknown> {
  t: number;                // sequence index (0..n-1)
  period: number;           // 1-based; > league.periods.count = overtime
  clock: string;            // game clock after the event, "mm:ss"
  score: { home: number; away: number }; // after the event
  type: string;             // football: play | kickoff | punt | field_goal | touchdown | extra_point | two_point | int | fumble | safety | penalty | downs | end_quarter | end_half | overtime | kneel | end
  text: string;             // plain-language description (team names / position labels only)
  payload: P;
}

/** Football payload. yardline = yards from the offense to the opponent's goal line (100 = own goal line). */
export interface FootballPayload {
  possession: "home" | "away" | null;
  down: number | null;
  distance: number | null;
  yardline: number | null;
  playType?: "run" | "pass" | null;
  yards?: number | null;
}

export interface SimResult {
  league: string;
  sport: Sport;
  n: number;
  teams: { home: Team & { season?: number }; away: Team & { season?: number } };
  winProbability: { home: number; away: number; tie: number };
  margin: Dist;             // home minus away
  total: Dist;
  medianScore: { home: number; away: number };
  periodScores: { home: number[]; away: number[] }; // median points per period
  entertainmentOnly: boolean;
  label?: string;
  representative: { final: { home: number; away: number }; periods: { home: number[]; away: number[] }; overtime: boolean; events: PlayEvent[] };
  sample: boolean;          // true = local mock fixture, not a real simulation
}

export type Source = "live" | "sample";
