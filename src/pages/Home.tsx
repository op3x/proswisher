import { useData, GamesFile, Game, dayLabel } from "../lib/data";
import GameCard from "../components/GameCard";
import Subscribe from "../components/Subscribe";
import { site } from "../config/site";
import { Link } from "react-router-dom";
import { featuredIds, canSeePrediction } from "../lib/access";

export default function Home() {
  const { data, error } = useData<GamesFile>("games");
  const now = Date.now();
  const games = data ? Object.values(data.games).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const live = games.filter((g) => g.state === "in");
  const upcoming = games.filter((g) => g.state === "pre" && new Date(g.date).getTime() > now && g.prediction);
  const recent = games.filter((g) => g.final).slice(-8).reverse();
  const featured = featuredIds(games);
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
        <p className="mt-3 text-sm font-semibold text-slate-200">{site.proofLine}</p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <a href="#slate" className="rounded-lg bg-accent text-ink font-semibold px-3 py-2">{site.heroCta}</a>
          <Link to="/how-it-works" className="rounded-lg border border-line px-3 py-2 text-slate-200">{site.heroCtaSecondary}</Link>
          <Link to="/track-record" className="rounded-lg border border-line px-3 py-2 text-slate-200">See the track record</Link>
        </div>
        {import.meta.env.VITE_SUBSCRIBE_ENABLED === "true" && <p className="mt-2 text-xs text-slate-400">{site.heroPriceNote}</p>}
        <p className="mt-3 text-xs text-slate-500">{site.pickDisclaimer}</p>
        {data && <p className="mt-4 text-xs text-slate-500">Season {data.seasonLabel} · data updated {new Date(data.updatedAt).toLocaleString()}</p>}
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
      <section className="rounded-xl bg-panel border border-line p-4">
        <h2 className="font-bold">{site.whatYouGet.title}</h2>
        <div className="mt-2 grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <div className="font-semibold text-slate-200">{site.whatYouGet.freeTitle}</div>
            <ul className="mt-1 space-y-1 text-slate-400">{site.whatYouGet.free.map(([b, t]) => <li key={b}><b className="text-slate-200">{b}</b> {t}</li>)}</ul>
          </div>
          {import.meta.env.VITE_SUBSCRIBE_ENABLED === "true" && (
            <div>
              <div className="font-semibold text-slate-200">{site.whatYouGet.paidTitle}</div>
              <ul className="mt-1 space-y-1 text-slate-400">{site.whatYouGet.paid.map(([b, t]) => <li key={b}><b className="text-slate-200">{b}</b> {t}</li>)}</ul>
            </div>
          )}
        </div>
      </section>
      <Subscribe />
      <div id="slate" />
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
          <div className="grid gap-3 sm:grid-cols-2">{gs.map((g) => <GameCard key={g.id} g={g} featured={featured.has(g.id)} locked={!canSeePrediction(g.id, featured)} />)}</div>
        </section>
      ))}
      {recent.length > 0 && (
        <section><h2 className="text-lg font-bold mb-3">Recent finals</h2>
          <div className="grid gap-3 sm:grid-cols-2">{recent.map((g) => <GameCard key={g.id} g={g} />)}</div></section>
      )}
    </div>
  );
}
