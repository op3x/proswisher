// Football home: hero -> run a sim, live + upcoming games (any enabled league) with one-tap Simulate.
import { Link } from "react-router-dom";
import { useMemo } from "react";
import Subscribe from "../components/Subscribe";
import { site } from "../config/site";
import { usePaymentsEnabled } from "../lib/runtime";
import { useLeagues, usePoll } from "../sports/hooks";
import { getSchedule } from "../sports/api";
import { ctDateTime, statusText } from "../sports/format";
import type { ScoreGame } from "../sports/types";
import { ctDayKey, dayLabel } from "../lib/time";

function GameRow({ g, leagueName }: { g: ScoreGame; leagueName: string }) {
  const live = g.status === "live";
  return (
    <li className="rounded-xl bg-panel border border-line p-3 flex items-center gap-3">
      <span className="shrink-0 rounded bg-ink border border-line px-1.5 py-0.5 text-[10px] font-bold text-slate-300">{leagueName}</span>
      <div className="flex-1 min-w-0 text-sm">
        <div className="truncate"><span className="text-slate-100">{g.away.name}</span>{live && <b className="ml-2 tabular-nums">{g.awayScore}</b>}</div>
        <div className="truncate"><span className="text-slate-400">at</span> <span className="text-slate-100">{g.home.name}</span>{live && <b className="ml-2 tabular-nums">{g.homeScore}</b>}</div>
        <div className={`text-xs ${live ? "text-win" : "text-slate-400"}`}>{live ? statusText(g) : ctDateTime(g.start)}</div>
      </div>
      <Link to={`/simulate?league=${g.league}&home=${encodeURIComponent(g.home.id)}&away=${encodeURIComponent(g.away.id)}`}
        className="shrink-0 inline-flex items-center min-h-11 rounded-lg bg-accent text-ink font-semibold px-3 text-sm">Simulate</Link>
    </li>
  );
}

export default function Home() {
  const selling = usePaymentsEnabled();
  const leagues = useLeagues();
  const ids = useMemo(() => (leagues?.data || []).filter((l) => l.enabled).map((l) => l.id), [leagues]);
  const sched = usePoll(() => (ids.length ? getSchedule(ids) : Promise.resolve(null)), 120_000, [ids.join()]);
  const games = (sched?.data || []).filter((g) => g.status === "live" || g.status === "scheduled");
  // Group by the Central Time calendar day (a 9:30 PM CT kickoff is still "today").
  const byDay = new Map<string, ScoreGame[]>();
  for (const g of games.slice(0, 24)) { const k = g.status === "live" ? "live" : ctDayKey(g.start); byDay.set(k, [...(byDay.get(k) || []), g]); }
  const name = (id: string) => leagues?.data.find((l) => l.id === id)?.name || id.toUpperCase();
  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-gradient-to-br from-panel to-ink border border-line p-6 sm:p-8">
        <p className="text-accent text-xs font-semibold uppercase tracking-widest">{site.tagline}</p>
        <h1 className="mt-2 text-3xl sm:text-5xl font-extrabold tracking-tight">{site.heroTitle}</h1>
        <p className="mt-3 text-slate-400 max-w-2xl">{site.heroBody}</p>
        <p className="mt-3 text-sm font-semibold text-slate-200">{site.proofLine}</p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link to="/simulate" className="inline-flex items-center min-h-11 rounded-lg bg-accent text-ink font-semibold px-4">{site.heroCta}</Link>
          <Link to="/simulate?mode=fictional" className="inline-flex items-center min-h-11 rounded-lg border border-line px-4 text-slate-200">Dream matchup</Link>
          {selling && <a href="/go/subscribe" className="inline-flex items-center min-h-11 rounded-lg border border-accent/60 text-accent px-4">{site.heroCtaPaid}</a>}
          <Link to="/how-it-works" className="inline-flex items-center min-h-11 rounded-lg border border-line px-4 text-slate-200">{site.heroCtaSecondary}</Link>
        </div>
        {selling && <p className="mt-2 text-xs text-slate-400">{site.heroPriceNote}</p>}
        <p className="mt-3 text-xs text-slate-400">{site.pickDisclaimer}</p>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        {site.howItWorksSteps.map((st, i) => (
          <div key={st.title} className="rounded-xl bg-panel border border-line p-4">
            <div className="text-accent text-xs font-bold">STEP {i + 1}</div>
            <div className="font-semibold mt-1">{st.title}</div>
            <p className="text-sm text-slate-400 mt-1">{st.body}</p>
          </div>
        ))}
      </section>
      <section id="slate">
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-lg font-bold">Live and upcoming</h2>
          {sched?.source === "sample" && <span className="rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 text-[11px] font-semibold">Sample data</span>}
          <span className="ml-auto text-xs text-slate-400">Times in Central Time</span>
        </div>
        {!sched && <p className="text-slate-400">Loading games…</p>}
        {sched && games.length === 0 && <p className="text-slate-400">{site.empty.noUpcoming}</p>}
        <div className="space-y-5">
          {[...byDay.entries()].map(([k, gs]) => (
            <div key={k}>
              <h3 className="text-sm font-semibold text-slate-300 mb-2">{k === "live" ? "In progress" : dayLabel(gs[0].start)}</h3>
              <ul className="grid gap-3 sm:grid-cols-2">{gs.map((g) => <GameRow key={`${g.league}-${g.id}`} g={g} leagueName={name(g.league)} />)}</ul>
            </div>
          ))}
        </div>
      </section>
      <Subscribe />
    </div>
  );
}
