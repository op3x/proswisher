// Running scores ticker: live first, then upcoming, then recent finals. Generic over leagues and periods.
import { getScores } from "../sports/api";
import { useLeagues, usePoll } from "../sports/hooks";
import { statusText } from "../sports/format";
import type { ScoreGame, League } from "../sports/types";

function Item({ g, lg }: { g: ScoreGame; lg?: League }) {
  const showScore = g.status !== "scheduled" && g.homeScore != null;
  const live = g.status === "live";
  const lead = (a: number | null, b: number | null) => (showScore && a != null && b != null && a > b ? "text-white font-semibold" : "text-slate-300");
  return (
    <li className="flex items-center gap-2 px-4 border-r border-line whitespace-nowrap text-xs">
      <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] font-bold text-slate-400">{lg?.name || g.league.toUpperCase()}</span>
      <span className={lead(g.awayScore, g.homeScore)}>{g.away.name}{showScore && <b className="ml-1 tabular-nums">{g.awayScore}</b>}</span>
      <span className="text-slate-500">at</span>
      <span className={lead(g.homeScore, g.awayScore)}>{g.home.name}{showScore && <b className="ml-1 tabular-nums">{g.homeScore}</b>}</span>
      <span className={live ? "text-red-400 font-semibold" : "text-slate-400"}>{live && <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 mr-1 align-middle animate-pulse" />}{statusText(g, lg)}</span>
    </li>
  );
}

export default function Ticker() {
  const leagues = useLeagues();
  const s = usePoll(getScores, 30000);
  const byId = new Map((leagues?.data || []).map((l) => [l.id, l]));
  const order = { live: 0, scheduled: 1, postponed: 2, final: 3 } as const;
  const games = [...(s?.data || [])].sort((a, b) => order[a.status] - order[b.status] || a.start.localeCompare(b.start)).slice(0, 30);
  return (
    <div className="bg-black/60 border-b border-line" aria-label="Scores">
      <div className="flex items-stretch">
        <span className="shrink-0 flex items-center gap-1 px-3 text-[10px] font-bold uppercase tracking-wider bg-accent text-ink">
          Scores{s?.source === "sample" && <span className="ml-1 rounded bg-ink/80 text-amber-300 px-1 normal-case tracking-normal">Sample data</span>}
        </span>
        <div className="ticker-viewport overflow-hidden flex-1 h-9 flex items-center" tabIndex={0}>
          {games.length === 0 ? <span className="px-4 text-xs text-slate-400">{s ? "No live or upcoming games right now." : "Loading scores…"}</span> : (
            <ul className="ticker-track flex items-center" style={{ animationDuration: `${Math.max(30, games.length * 6)}s` }}>
              {[...games, ...games].map((g, i) => <Item key={g.id + "-" + i} g={g} lg={byId.get(g.league)} />)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
