import { useParams, Link } from "react-router-dom";
import { useData, GamesFile, StatsFile, LogFile, pct, fmtLine, signed, tipTime } from "../lib/data";
import { site } from "../config/site";

export default function GameDetail() {
  const { id = "" } = useParams();
  const games = useData<GamesFile>("games");
  const stats = useData<StatsFile>("stats");
  const log = useData<LogFile>("predictions");
  if (games.error) return <p className="text-loss">Couldn't load game.</p>;
  if (!games.data) return <p className="text-slate-400">Loading…</p>;
  const g = games.data.games[id];
  if (!g) return <p>Game not found. <Link className="text-accent" to="/">Back to games</Link></p>;
  const p = g.prediction;
  const logged = log.data?.entries[id];
  const T = stats.data?.teams;
  const teamRow = (ab: string) => {
    const t = T?.[ab];
    if (!t) return null;
    return (
      <tr key={ab} className="border-t border-line">
        <td className="py-2 font-semibold">{t.name}</td>
        <td className="tabular-nums">{t.w}-{t.l}</td>
        <td className="tabular-nums">{t.margin === null ? "–" : signed(t.margin)}</td>
        <td className="tabular-nums">{t.priorMargin === null ? "–" : signed(t.priorMargin)}</td>
        <td className="tabular-nums font-semibold text-accent">{signed(t.rating)}</td>
      </tr>
    );
  };
  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-slate-400 hover:text-white">← All games</Link>
      <div className="rounded-2xl bg-panel border border-line p-5 sm:p-7">
        <p className="text-xs text-slate-400">{tipTime(g.date)} · {g.neutral ? "Neutral site" : `at ${g.home.name}`} · {g.status}</p>
        <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold">{g.away.name} <span className="text-slate-500">at</span> {g.home.name}</h1>
        {(g.final || g.state === "in") && (
          <p className="mt-3 text-xl tabular-nums">{g.away.abbr} {g.away.score} – {g.home.score} {g.home.abbr}</p>
        )}
        {p && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ["Predicted winner", `${p.pick}`],
              ["Win probability", pct(p.pickProb)],
              [site.spreadLabel, `${p.spread.team} ${fmtLine(p.spread.line)}`],
              [site.totalLabel, `${p.total}`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-ink border border-line p-3">
                <div className="text-xs text-slate-500">{k}</div><div className="text-lg font-bold">{v}</div>
              </div>
            ))}
          </div>
        )}
        {p && (
          <>
            <p className="mt-4 text-sm text-slate-400">Projected score: {g.away.abbr} {p.projScore.away} – {p.projScore.home} {g.home.abbr}</p>
            <p className="mt-3 text-xs text-slate-500">{site.pickDisclaimer}</p>
          </>
        )}
        {logged && (
          <p className="mt-3 text-xs text-slate-500">
            {site.predictionCard.postedAt.replace("{timestamp}", new Date(logged.loggedAt).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}: pick {logged.pick} ({pct(logged.pickProb)}), {logged.spread.team} {fmtLine(logged.spread.line)}, total {logged.total}.
            
          </p>
        )}
      </div>
      {p && (
        <section className="rounded-2xl bg-panel border border-line p-5">
          <h2 className="font-bold mb-2">The math</h2>
          <ol className="text-sm text-slate-300 space-y-1 list-decimal list-inside">
            <li>Home rating {signed(p.inputs.homeRating)} − away rating {signed(p.inputs.awayRating)} + home court {p.inputs.homeCourt} = <b>{signed(p.homeMargin)}</b> pts for {g.home.abbr}</li>
            <li>Win probability = Φ({p.homeMargin} ÷ 12) = <b>{pct(p.pHome)}</b> {g.home.abbr}</li>
            <li>Total = ({p.inputs.homeOff.toFixed(1)} + {p.inputs.awayDef.toFixed(1)} − {p.inputs.leaguePpg.toFixed(1)}) + ({p.inputs.awayOff.toFixed(1)} + {p.inputs.homeDef.toFixed(1)} − {p.inputs.leaguePpg.toFixed(1)}) ≈ <b>{p.total}</b></li>
          </ol>
          <Link to="/how-it-works" className="mt-3 inline-block text-sm text-accent">Full explanation →</Link>
        </section>
      )}
      {T && (
        <section className="rounded-2xl bg-panel border border-line p-5 overflow-x-auto">
          <h2 className="font-bold mb-2">Team inputs</h2>
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500"><tr><th className="py-1">Team</th><th>Team record</th><th>Margin</th><th>Last season</th><th>Rating</th></tr></thead>
            <tbody>{[g.away.abbr, g.home.abbr].map(teamRow)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
