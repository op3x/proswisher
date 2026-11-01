// Quarter-by-quarter scoreboard for the simulated game: one row per team (city + name), Q1-Q4, OT only when it
// happens, Final, plus a combined total-points row. Fills in live from the play log as playback advances.
import type { League, PlayEvent, Team } from "../sports/types";
import { liveLineScore } from "../sports/linescore";

export default function LineScore({ league, teams, events, played, done }: {
  league?: League; teams: { home: Team; away: Team }; events: PlayEvent[]; played: number; done: boolean;
}) {
  const nP = league?.periods.count ?? 4, short = league?.periods.short ?? "Q";
  const ls = liveLineScore(events, played, nP);
  const cols = [...Array.from({ length: nP }, (_, k) => `${short}${k + 1}`), ...(ls.hasOT ? ["OT"] : [])];
  const cell = (r: typeof ls.home, k: number) => (k < nP ? r.periods[k] : r.ot);
  const cur = (k: number) => !done && k === Math.min(ls.current, nP);
  const td = "px-1.5 sm:px-2 py-1 text-center tabular-nums";
  const row = (label: string, color: string, r: typeof ls.home, strong = false) => (
    <tr className={strong ? "border-t border-line text-slate-300" : ""}>
      <th scope="row" className={`text-left font-semibold py-1 pr-2 max-w-[9.5rem] sm:max-w-none truncate ${color}`}>{label}</th>
      {cols.map((c, k) => <td key={c} className={`${td} ${cur(k) ? "bg-accent/10 text-white" : ""}`}>{cell(r, k) ?? <span className="text-slate-600">–</span>}</td>)}
      <td className={`${td} font-extrabold text-white`}>{r.final}</td>
    </tr>
  );
  return (
    <div className="rounded-lg bg-black/40 border border-line px-2 sm:px-3 py-2" data-testid="line-score">
      <table className="w-full text-xs sm:text-sm">
        <caption className="sr-only">Points by {(league?.periods.label || "quarter").toLowerCase()} in this simulated game</caption>
        <thead><tr className="text-[11px] text-slate-400">
          <th scope="col" className="text-left font-normal pr-2">{done ? "Final" : "Live"}</th>
          {cols.map((c, k) => <th key={c} scope="col" className={`font-normal ${td} ${cur(k) ? "text-accent" : ""}`}>{c}</th>)}
          <th scope="col" className={`font-semibold ${td}`}>{done ? "Final" : "Total"}</th>
        </tr></thead>
        <tbody>
          {row(teams.away.name, "text-amber-300", ls.away)}
          {row(teams.home.name, "text-accent", ls.home)}
          {row("Total points", "text-slate-300", ls.total, true)}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-slate-400" data-testid="game-total">{done ? `Final game total: ${ls.total.final} points` : `Game total so far: ${ls.total.final} points`}{ls.hasOT ? " (incl. overtime)" : ""}</p>
    </div>
  );
}
