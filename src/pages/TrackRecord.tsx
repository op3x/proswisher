import { useData, LogFile, pct, fmtLine } from "../lib/data";
import { site } from "../config/site";


export default function TrackRecord() {
  const { data, error } = useData<LogFile>("predictions");
  const entries = data ? Object.values(data.entries).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const graded = entries.filter((e) => e.result);
  const wins = graded.filter((e) => e.result!.pickCorrect).length;
  const REPO_LOG = `https://github.com/${site.repo}/blob/${site.logBranch}/public/data/predictions.json`;
  const REPO_HISTORY = `https://github.com/${site.repo}/commits/${site.logBranch}/public/data/predictions.json`;
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const gradedDates = graded.map((e) => e.date).sort();
  const range = graded.length ? `${fmtDay(gradedDates[0])} – ${fmtDay(gradedDates[gradedDates.length - 1])}` : "";
  const mae = graded.length ? graded.reduce((s, e) => s + Math.abs(e.result!.marginError), 0) / graded.length : 0;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl sm:text-3xl font-extrabold">{site.trackRecord.title}</h1>
      <p className="text-slate-400 max-w-3xl">{site.trackRecord.intro}</p>
      <p className="text-xs text-slate-500 max-w-3xl">{site.trackRecord.method}</p>
      {error && <p className="text-slate-400">{site.empty.noLog}</p>}
      {data && (
        <>
          {graded.length > 0 && (
            <div className="rounded-2xl bg-panel border border-line p-4 sm:p-5">
              <div className="text-xs text-slate-500">{site.trackRecord.summaryLabel.replace("{startDate}–{endDate}", range)} (straight-up)</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-3xl font-extrabold tabular-nums">{wins}-{graded.length - wins}</span>
                <span className="text-sm text-amber-300">{site.trackRecord.summaryDisclaimer}</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {graded.length} graded of {entries.length} logged · avg. margin miss {mae.toFixed(1)} pts ·{" "}
                <a className="text-accent" href="#full-log">{site.trackRecord.fullLogLink}</a>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Stat k="Logged predictions" v={String(entries.length)} />
            <Stat k="Graded (final)" v={String(graded.length)} />
          </div>
          {graded.length === 0 && <p className="rounded-xl border border-line bg-panel p-4 text-sm text-slate-300">{site.trackRecord.noRecord}</p>}
          <p className="text-xs text-slate-500">
            Log started {new Date(data.startedAt).toLocaleString()} · model {data.modelVersion} · last updated {new Date(data.updatedAt).toLocaleString()} ·{" "}
            <a className="text-accent" href={REPO_LOG} target="_blank" rel="noreferrer">full log (JSON)</a> ·{" "}
            <a className="text-accent" href={REPO_HISTORY} target="_blank" rel="noreferrer">commit history (proves pre-tip-off timestamps)</a>
          </p>
          <div id="full-log" className="overflow-x-auto rounded-xl border border-line scroll-mt-20">
            <table className="w-full text-sm text-left">
              <thead className="bg-panel text-xs text-slate-500">
                <tr><th className="p-2">Game</th><th className="p-2">Posted (CT)</th><th className="p-2">Lean</th><th className="p-2">Projected spread</th><th className="p-2">Projected total</th><th className="p-2">Final · Result</th></tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.gameId} className="border-t border-line">
                    <td className="p-2 whitespace-nowrap">{e.away} @ {e.home}<div className="text-[11px] text-slate-500">Tip-off {ct(e.date)} CT</div></td>
                    <td className="p-2 text-xs text-slate-400 whitespace-nowrap">{ct(e.loggedAt)}</td>
                    <td className="p-2 whitespace-nowrap">{e.pick} {pct(e.pickProb)}</td>
                    <td className="p-2 whitespace-nowrap">{e.spread.team} {fmtLine(e.spread.line)}</td>
                    <td className="p-2">{e.total}</td>
                    <td className="p-2 whitespace-nowrap">
                      {e.result ? (
                        <span className={e.result.pickCorrect ? "text-win" : "text-loss"}>
                          {e.result.pickCorrect ? "✓" : "✗"} {e.away} {e.result.awayScore}–{e.result.homeScore} {e.home}
                        </span>
                      ) : <span className="text-slate-500">pending</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">{site.pickDisclaimer}</p>
        </>
      )}
    </div>
  );
}
const ct = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function Stat({ k, v }: { k: string; v: string }) {
  return <div className="rounded-xl bg-panel border border-line p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-xl font-bold">{v}</div></div>;
}
