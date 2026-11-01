// Quarter-by-quarter box score of the representative simulated game, built from its play log so it can fill in live
// as playback advances. Plain TypeScript (no TS-only runtime syntax) so the Node tests can import it directly.

export interface LineRow { periods: (number | null)[]; ot: number | null; final: number }
export interface LineScore {
  away: LineRow; home: LineRow; total: LineRow; // total = both teams combined
  hasOT: boolean;     // overtime has been reached in the played part
  current: number;    // 0-based column being played (nPeriods = overtime), -1 before kickoff
}

type Ev = { period: number; score: { home: number; away: number } };

/** Line score after the first `played` events. Periods not reached yet are null; OT is null until it is reached. */
export function liveLineScore(events: Ev[], played: number, nPeriods = 4): LineScore {
  const n = Math.max(0, Math.min(played, events.length));
  const H: number[] = Array(nPeriods + 1).fill(0), A: number[] = Array(nPeriods + 1).fill(0);
  let prev = { home: 0, away: 0 }, current = -1;
  for (let i = 0; i < n; i++) {
    const e = events[i], k = Math.min(Math.max(1, e.period || 1), nPeriods + 1) - 1;
    H[k] += e.score.home - prev.home; A[k] += e.score.away - prev.away;
    prev = e.score; current = Math.max(current, k);
  }
  const hasOT = current >= nPeriods;
  const row = (xs: number[], fin: number): LineRow => ({
    periods: xs.slice(0, nPeriods).map((x, k) => (k <= current ? x : null)), ot: hasOT ? xs[nPeriods] : null, final: fin });
  const T = H.map((h, k) => h + A[k]);
  return { home: row(H, prev.home), away: row(A, prev.away), total: row(T, prev.home + prev.away), hasOT, current };
}
