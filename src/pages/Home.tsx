import { useData, GamesFile, Game, dayLabel } from "../lib/data";
import GameCard from "../components/GameCard";
import Subscribe from "../components/Subscribe";
import { site } from "../config/site";
import { Link } from "react-router-dom";

export default function Home() {
  const { data, error } = useData<GamesFile>("games");
  const now = Date.now();
  const games = data ? Object.values(data.games).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const live = games.filter((g) => g.state === "in");
  const upcoming = games.filter((g) => g.state === "pre" && new Date(g.date).getTime() > now && g.prediction);
  const recent = games.filter((g) => g.final).slice(-8).reverse();
  const byDay = new Map<string, Game[]>();
  for (const g of upcoming) {
    const k = new Date(g.date).toDateString();
    byDay.set(k, [...(byDay.get(k) || []), g]);
  }
  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-gradient-to-br from-panel to-ink border border-line p-6 sm:p-8">
        <p className="text-accent text-xs font-semibold uppercase tracking-widest">{site.tagline}</p>
        <h1 className="mt-2 text-2xl sm:text-4xl font-extrabold tracking-tight">{site.heroTitle}</h1>
        <p className="mt-3 text-slate-400 max-w-2xl">{site.heroBody}</p>
        <div className="mt-4 flex gap-3 text-sm">
          <Link to="/how-it-works" className="rounded-lg bg-accent text-ink font-semibold px-3 py-2">How the model works</Link>
          <Link to="/track-record" className="rounded-lg border border-line px-3 py-2 text-slate-200">Public track record</Link>
        </div>
        {data && <p className="mt-4 text-xs text-slate-500">Season {data.seasonLabel} · data updated {new Date(data.updatedAt).toLocaleString()}</p>}
      </section>
      <Subscribe />
      {error && <p className="text-loss">Couldn't load games ({error}).</p>}
      {!data && !error && <p className="text-slate-400">Loading games…</p>}
      {live.length > 0 && (
        <section><h2 className="text-lg font-bold mb-3">In progress</h2>
          <div className="grid gap-3 sm:grid-cols-2">{live.map((g) => <GameCard key={g.id} g={g} />)}</div></section>
      )}
      {data && upcoming.length === 0 && <p className="text-slate-400">{site.empty.noUpcoming}</p>}
      {[...byDay.entries()].map(([k, gs]) => (
        <section key={k}>
          <h2 className="text-lg font-bold mb-3">{dayLabel(gs[0].date)}</h2>
          <div className="grid gap-3 sm:grid-cols-2">{gs.map((g) => <GameCard key={g.id} g={g} />)}</div>
        </section>
      ))}
      {recent.length > 0 && (
        <section><h2 className="text-lg font-bold mb-3">Recent finals</h2>
          <div className="grid gap-3 sm:grid-cols-2">{recent.map((g) => <GameCard key={g.id} g={g} />)}</div></section>
      )}
    </div>
  );
}
