import { useData, LogFile, LogEntry, pct, fmtLine } from "../lib/data";
import { site } from "../config/site";
import { featuredIds, gatingActive } from "../lib/access";

// The ONLY page with a W-L summary (Larry). Always the full log since launch.
// Free-tier decision (9:38): every pick is listed once posted; for NON-featured games the row appears
// after tip-off while gating is active (the featured game's row appears at post time). See README.
export default function TrackRecord() {
  const { data, error } = useData<LogFile>("predictions");
  const T = site.trackRecord;
  const now = Date.now();
  const all = data ? Object.values(data.entries).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const featured = featuredIds(all.map((e) => ({ id: e.gameId, date: e.date })));
  const visible = (e: LogEntry) => !gatingActive() || featured.has(e.gameId) || new Date(e.date).getTime() <= now;
  const entries = all.filter(visible);
  const hiddenPending = all.length - entries.length;
  const finals = all.filter((e) => e.result?.status === "final");
  const postponed = all.filter((e) => e.result?.status === "postponed").length;
  const count = (k: "winnerGrade" | "atsGrade") => {
    const g = finals.map((e) => e.result![k]).filter(Boolean);
    return { W: g.filter((x) => x === "W").length, L: g.filter((x) => x === "L").length, P: g.filter((x) => x === "P").length, n: g.length };
  };
  const win = count("winnerGrade"), ats = count("atsGrade");
  const REPO_LOG = "/data/predictions.json"; // served by our server; member picks appear at tip-off (P6)
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
  const lastFinal = finals.map((e) => e.date).sort().pop();
  const label = (c: { W: number; L: number; P: number }) =>
    T.summaryLabel.replace("{startDate}", data?.startedAt ? day(data.startedAt) : "launch").replace("{endDate}", lastFinal ? day(lastFinal) : "")
      .replace("{W}", String(c.W)).replace("{L}", String(c.L)).replace("{P}", c.P ? `–${c.P}` : "");
  const grade = (g: string | null | undefined) =>
    g === "W" ? <span className="text-win font-semibold">W</span> : g === "L" ? <span className="text-loss font-semibold">L</span>
      : g === "P" ? <span className="text-slate-300">Push</span> : <span className="text-slate-400">–</span>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl sm:text-3xl font-extrabold">{T.title}</h1>
      <p className="text-slate-400 max-w-3xl">{T.intro}</p>
      <p className="text-xs text-slate-400 max-w-3xl">{T.method}</p>
      {error && <p className="text-slate-400">{site.empty.noLog}</p>}
      {data && (
        <>
          {win.n > 0 && (
            <div className="rounded-2xl bg-panel border border-line p-4 sm:p-5 space-y-2">
              <div><span className="text-xs text-slate-400">{T.gradeNames.winner}</span><div className="font-bold tabular-nums">{label(win)}</div></div>
              <div><span className="text-xs text-slate-400">{T.gradeNames.ats}</span>
                <div className="font-bold tabular-nums">{ats.n > 0 ? label(ats) : <span className="text-sm font-normal text-slate-400">{T.atsUnavailable}</span>}</div></div>
              <div className="text-sm text-amber-300">{T.summaryDisclaimer}</div>
              <div className="text-xs text-slate-400">
                {finals.length} final of {all.length} logged{postponed ? ` · ${postponed} postponed (not counted)` : ""} ·{" "}
                <a className="text-accent underline underline-offset-4" href="#log">{T.fullLogLink}</a>
              </div>
            </div>
          )}
          {win.n === 0 && <p className="rounded-xl border border-line bg-panel p-4 text-sm text-slate-300">{site.trackRecord.noRecord}</p>}
          {!data.marketSource && <p className="text-xs text-slate-400">{T.atsUnavailable}</p>}
          <p className="text-xs text-slate-400">
            {data.startedAt ? <>Log started {day(data.startedAt)} · </> : <>Log starts at launch · </>}model {data.modelVersion}{data.updatedAt ? <> · last updated {ct(data.updatedAt)} CT</> : null} ·{" "}
            <a className="text-accent underline underline-offset-4" href={REPO_LOG} target="_blank" rel="noreferrer">full log (JSON, with sealed-pick hashes)</a>
            {hiddenPending > 0 && <> · {hiddenPending} more posted predictions appear here at tip-off</>}
          </p>
          <div id="log" tabIndex={0} role="region" aria-label="Prediction log (scrolls sideways)" className="overflow-x-auto rounded-xl border border-line scroll-mt-20 focus:outline focus:outline-2 focus:outline-accent">
            <table className="w-full text-sm text-left">
              <thead className="bg-panel text-xs text-slate-200">
                <tr>{T.columns.map((c) => <th key={c} className="p-2 whitespace-nowrap">{c}</th>)}</tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const r = e.result, m = e.marketSpread;
                  const fav = e.spread.team, favMargin = fav === e.home ? e.homeMargin : -e.homeMargin;
                  const leanTeam = e.atsLean === "home" ? e.home : e.atsLean === "away" ? e.away : null;
                  return (
                    <tr key={e.gameId} className="border-t border-line align-top">
                      <td className="p-2 whitespace-nowrap">{e.away} @ {e.home}<div className="text-[11px] text-slate-400">Tip-off {ct(e.date)} CT</div></td>
                      <td className="p-2 text-xs text-slate-400 whitespace-nowrap">{ct(e.loggedAt)}</td>
                      <td className="p-2 whitespace-nowrap tabular-nums">{projScore(e)}</td>
                      <td className="p-2 whitespace-nowrap">{fav} {fmtLine(e.spread.line)}<div className="text-[11px] text-slate-400">{fav} by {Math.abs(favMargin).toFixed(1)}</div></td>
                      <td className="p-2 whitespace-nowrap">{e.pick} {pct(e.pickProb)}{leanTeam && <div className="text-[11px] text-slate-400">ATS: {leanTeam}</div>}</td>
                      <td className="p-2 whitespace-nowrap">{m ? <>{e.home} {fmtLine(m.homeLine)}<div className="text-[11px] text-slate-400">{m.source} · {ct(m.recordedAt)} CT</div></> : <span className="text-slate-400">not recorded</span>}</td>
                      <td className="p-2 whitespace-nowrap">{r?.status === "final" ? `${e.away} ${r.awayScore}–${r.homeScore} ${e.home}` : r?.status === "postponed" ? <span className="text-slate-400">Postponed</span> : <span className="text-slate-400">pending</span>}</td>
                      <td className="p-2 text-center">{grade(r?.winnerGrade)}</td>
                      <td className="p-2 text-center">{grade(r?.atsGrade)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">{site.pickDisclaimer}</p>
        </>
      )}
    </div>
  );
}
const ct = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
// projected score as posted (older entries: derived from the locked total + margin)
const projScore = (e: LogEntry) => {
  const p = e.projScore ?? { away: Math.round((e.total - e.homeMargin) / 2), home: Math.round((e.total + e.homeMargin) / 2) };
  return `${e.away} ${p.away}–${p.home} ${e.home}`;
};
