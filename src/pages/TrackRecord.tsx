import { useData, LogFile, pct, fmtLine } from "../lib/data";
import { site } from "../config/site";

const REPO_LOG = "https://github.com/op3x/proswisher/commits/main/public/data/predictions.json";

export default function TrackRecord() {
  const { data, error } = useData<LogFile>("predictions");
  const entries = data ? Object.values(data.entries).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const graded = entries.filter((e) => e.result);
  const wins = graded.filter((e) => e.result!.pickCorrect).length;
  const mae = graded.length ? graded.reduce((s, e) => s + Math.abs(e.result!.marginError), 0) / graded.length : 0;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl sm:text-3xl font-extrabold">{site.trackRecord.title}</h1>
      <p className="text-slate-400 max-w-3xl">{site.trackRecord.intro}</p>
      <p className="text-xs text-slate-500 max-w-3xl">{site.trackRecord.method}</p>
      {error && <p className="text-slate-400">{site.empty.noLog}</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat k="Logged predictions" v={String(entries.length)} />
            <Stat k="Graded (final)" v={String(graded.length)} />
            {graded.length > 0 ? (
              <>
                <Stat k={`Straight-up record (${graded.length} games)`} v={`${wins}-${graded.length - wins}`} />
                <Stat k="Avg. margin miss" v={`${mae.toFixed(1)} pts`} />
              </>
            ) : null}
          </div>
          {graded.length === 0 && <p className="rounded-xl border border-line bg-panel p-4 text-sm text-slate-300">{site.trackRecord.noRecord}</p>}
          <p className="text-xs text-slate-500">
            Log started {new Date(data.startedAt).toLocaleString()} · model {data.modelVersion} · last updated {new Date(data.updatedAt).toLocaleString()} ·{" "}
            <a className="text-accent" href={REPO_LOG} target="_blank" rel="noreferrer">commit history of the log</a>
          </p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm text-left">
              <thead className="bg-panel text-xs text-slate-500">
                <tr><th className="p-2">Game</th><th className="p-2">Logged (before tip)</th><th className="p-2">Pick</th><th className="p-2">Line</th><th className="p-2">Total</th><th className="p-2">Result</th></tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.gameId} className="border-t border-line">
                    <td className="p-2 whitespace-nowrap">{e.away} @ {e.home}<div className="text-[11px] text-slate-500">{new Date(e.date).toLocaleString()}</div></td>
                    <td className="p-2 text-xs text-slate-400 whitespace-nowrap">{new Date(e.loggedAt).toLocaleString()}</td>
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
function Stat({ k, v }: { k: string; v: string }) {
  return <div className="rounded-xl bg-panel border border-line p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-xl font-bold">{v}</div></div>;
}
