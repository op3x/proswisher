// LOCAL SAMPLE DATA. Used only when /api/leagues, /api/scores, /api/schedule or /api/sim aren't reachable.
// Every screen that renders this shows a "Sample data" label. Plain-text team names only; no players.
import type { League, Team, ScoreGame, SimResult, PlayEvent, FootballPayload, SimRequest } from "../sports/types";

export const MOCK_LEAGUES: League[] = [
  { id: "nfl", name: "NFL", sport: "football", periods: { count: 4, label: "Quarter", short: "Q" }, enabled: true },
  { id: "ncaaf", name: "NCAAF", sport: "football", periods: { count: 4, label: "Quarter", short: "Q" }, enabled: true },
  { id: "nba", name: "NBA", sport: "basketball", periods: { count: 4, label: "Quarter", short: "Q" }, enabled: false },
  { id: "ncaab", name: "NCAAB", sport: "basketball", periods: { count: 2, label: "Half", short: "H" }, enabled: false },
];

const NFL = "ARI Arizona Cardinals|ATL Atlanta Falcons|BAL Baltimore Ravens|BUF Buffalo Bills|CAR Carolina Panthers|CHI Chicago Bears|CIN Cincinnati Bengals|CLE Cleveland Browns|DAL Dallas Cowboys|DEN Denver Broncos|DET Detroit Lions|GB Green Bay Packers|HOU Houston Texans|IND Indianapolis Colts|JAX Jacksonville Jaguars|KC Kansas City Chiefs|LV Las Vegas Raiders|LAC Los Angeles Chargers|LA Los Angeles Rams|MIA Miami Dolphins|MIN Minnesota Vikings|NE New England Patriots|NO New Orleans Saints|NYG New York Giants|NYJ New York Jets|PHI Philadelphia Eagles|PIT Pittsburgh Steelers|SF San Francisco 49ers|SEA Seattle Seahawks|TB Tampa Bay Buccaneers|TEN Tennessee Titans|WAS Washington Commanders";
const NCAAF = "Alabama Alabama Crimson Tide|Georgia Georgia Bulldogs|Ohio State Ohio State Buckeyes|Michigan Michigan Wolverines|Texas Texas Longhorns|Oregon Oregon Ducks|Notre Dame Notre Dame Fighting Irish|Penn State Penn State Nittany Lions|LSU LSU Tigers|Clemson Clemson Tigers|USC USC Trojans|Florida State Florida State Seminoles|Tennessee Tennessee Volunteers|Oklahoma Oklahoma Sooners|Miami Miami Hurricanes|Ole Miss Ole Miss Rebels";
const parse = (s: string, split: (x: string) => Team): Team[] => s.split("|").map(split);
export const MOCK_TEAMS: Record<string, Team[]> = {
  nfl: parse(NFL, (x) => { const i = x.indexOf(" "); return { id: x.slice(0, i), name: x.slice(i + 1) }; }),
  ncaaf: parse(NCAAF, (x) => { const w = x.split(" "); const n = w.length; // id = school, name = school + mascot
    for (let k = 1; k < n; k++) { const id = w.slice(0, k).join(" "), rest = w.slice(k).join(" "); if (rest.startsWith(id)) return { id, name: rest }; }
    return { id: x, name: x }; }),
};
const T = (lg: string, id: string) => MOCK_TEAMS[lg].find((t) => t.id === id)!;

/** Built relative to "now" so the sample ticker always has live + upcoming rows. */
export function mockScores(now = Date.now()): ScoreGame[] {
  const h = 3600e3, iso = (ms: number) => new Date(Math.round(ms / 9e5) * 9e5).toISOString(); // quarter-hour kickoffs
  now = Math.floor(now / h) * h;
  const row = (league: string, id: string, a: string, hm: string, start: number, status: ScoreGame["status"], as: number | null, hs: number | null, period: number | null = null, clock: string | null = null): ScoreGame =>
    ({ id, league, start: iso(start), status, away: T(league, a), home: T(league, hm), awayScore: as, homeScore: hs, period, clock });
  return [
    row("nfl", "s1", "GB", "CHI", now - 1.5 * h, "live", 17, 20, 3, "8:41"),
    row("nfl", "s2", "BUF", "KC", now - 2.2 * h, "live", 24, 21, 4, "2:07"),
    row("ncaaf", "s3", "Michigan", "Ohio State", now - 3.5 * h, "final", 13, 27),
    row("ncaaf", "s4", "Texas", "Oklahoma", now - 0.8 * h, "live", 7, 10, 2, "0:42"),
    row("nfl", "s5", "SF", "SEA", now + 20 * h, "scheduled", null, null),
    row("nfl", "s6", "PHI", "DAL", now + 23 * h, "scheduled", null, null),
    row("nfl", "s7", "DET", "MIN", now + 26 * h, "scheduled", null, null),
    row("ncaaf", "s8", "Georgia", "Alabama", now + 44 * h, "scheduled", null, null),
    row("ncaaf", "s9", "Oregon", "USC", now + 47 * h, "scheduled", null, null),
    row("nfl", "s10", "PIT", "BAL", now + 50 * h, "scheduled", null, null),
  ];
}

// ---- sample simulation: a crude seeded drive generator, ONLY so the UI can be shown without the API ----
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (s: string) => [...s].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 7);

export function mockSim(req: SimRequest, home: Team, away: Team): SimResult {
  const r = rng(hash(req.league + req.home + req.away));
  const ev: PlayEvent<FootballPayload>[] = [];
  const score = { home: 0, away: 0 }, q = { home: [0, 0, 0, 0], away: [0, 0, 0, 0] };
  let period = 1, sec = 900, poss: "home" | "away" = r() < 0.5 ? "home" : "away", yl = 75;
  const name = (s: "home" | "away") => (s === "home" ? home.name : away.name);
  const clk = () => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const push = (type: string, text: string, p: Partial<FootballPayload> = {}) =>
    ev.push({ t: ev.length, period, clock: clk(), score: { ...score }, type, text, payload: { possession: poss, down: null, distance: null, yardline: yl, ...p } });
  const add = (pts: number) => { score[poss] += pts; q[poss][period - 1] += pts; };
  const flip = (y: number) => { poss = poss === "home" ? "away" : "home"; yl = y; };
  push("kickoff", `Kickoff, ${name(poss)} starts at its own 25`);
  while (period <= 4) {
    let down = 1, togo = 10, over = false;
    while (!over && period <= 4) {
      const pass = r() < 0.55, inc = pass && r() < 0.35;
      let y = inc ? 0 : Math.round((pass ? 7 : 4) + (r() - 0.35) * (pass ? 18 : 9));
      y = Math.max(-6, Math.min(y, yl));
      const los = yl, d = down, tg = togo;
      yl -= y; sec = Math.max(0, sec - (inc ? 6 : 30 + Math.floor(r() * 12)));
      const fd = y >= togo;
      push("play", `${["", "1st", "2nd", "3rd", "4th"][d]} & ${tg}: ${pass ? (inc ? "Pass incomplete" : `QB pass to WR for ${y}`) : `RB run for ${y}`}${inc ? "" : " yards"}${fd && yl > 0 ? ", FIRST DOWN" : ""}`,
        { down: d, distance: tg, yardline: los, playType: pass ? "pass" : "run", yards: y });
      if (yl <= 0) { add(6); yl = 0; push("touchdown", `TOUCHDOWN ${name(poss)}`); add(1); push("extra_point", "Extra point is good"); flip(75); push("kickoff", `Kickoff, ${name(poss)} starts at its own 25`); over = true; }
      else if (fd) { down = 1; togo = Math.min(10, yl); }
      else if ((togo -= y, ++down) > 3) {
        if (yl <= 35) { const ok = r() < 0.8; if (ok) add(3); push("field_goal", `${yl + 17}-yard field goal ${ok ? "is GOOD" : "is NO GOOD"}`); flip(ok ? 75 : 100 - yl); if (ok) push("kickoff", `Kickoff, ${name(poss)} starts at its own 25`); }
        else { const land = Math.max(10, yl - 42); push("punt", `Punt; ${name(poss === "home" ? "away" : "home")} ball at its own ${land}`); flip(100 - land); }
        over = true;
      }
      if (r() < 0.025 && !over) { push("int", `Pass INTERCEPTED; ${name(poss === "home" ? "away" : "home")} ball`); flip(100 - yl); over = true; }
      if (sec <= 0) { push(period === 2 ? "end_half" : period === 4 ? "end" : "end_quarter", period === 2 ? "Halftime" : period === 4 ? "Final" : `End of quarter ${period}`); period++; sec = 900; if (period === 3) { flip(75); } over = true; }
    }
  }
  const m = score.home - score.away, tot = score.home + score.away;
  const pH = Math.max(0.05, Math.min(0.95, 0.5 + m / 30));
  const d = (c: number, w: number) => ({ mean: c, median: c, p05: c - 1.6 * w, p25: c - 0.7 * w, p75: c + 0.7 * w, p95: c + 1.6 * w });
  const cross = (req.homeSeason ?? 0) !== (req.awaySeason ?? 0) || (req.homeLeague ?? req.league) !== (req.awayLeague ?? req.league);
  return {
    league: req.league, sport: "football", n: req.n, sample: true,
    teams: { home, away }, winProbability: { home: pH, away: 1 - pH, tie: 0 },
    margin: d(m, 13), total: d(tot, 13), medianScore: { ...score }, periodScores: q, entertainmentOnly: cross, ...(cross ? { label: "For entertainment only: a hypothetical matchup that cannot be played, not a prediction of a real game." } : {}),
    representative: { final: { ...score }, periods: q, overtime: false, events: ev },
  };
}
