// Matchup page: league -> two teams (a real upcoming game or a fictional one) -> run -> results + animated game.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLeagues } from "../sports/hooks";
import { getSchedule, getTeams, runSim, Sourced } from "../sports/api";
import { ctDateTime, pct, signed } from "../sports/format";
import type { League, ScoreGame, SimResult, Team } from "../sports/types";
import GamePlayer from "../components/GamePlayer";
import { site } from "../config/site";

const THIS_SEASON = 2026;
const ENTERTAINMENT = "For entertainment only";
const sel = "w-full min-h-11 rounded-md bg-ink border border-line px-3 text-sm";

function SamplePill() { return <span className="rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 text-[11px] font-semibold">Sample data, not a real simulation</span>; }

function TeamPick({ label, league, leagues, teams, value, season, onLeague, onTeam, onSeason, fictional }: {
  label: string; league: string; leagues: League[]; teams: Team[]; value: string; season: number; fictional: boolean;
  onLeague: (v: string) => void; onTeam: (v: string) => void; onSeason: (v: number) => void;
}) {
  return (
    <fieldset className="rounded-lg border border-line p-3 space-y-2">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</legend>
      {fictional && (
        <select className={sel} value={league} onChange={(e) => onLeague(e.target.value)} aria-label={`${label} league`}>
          {leagues.filter((l) => l.enabled).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )}
      <select className={sel} value={value} onChange={(e) => onTeam(e.target.value)} aria-label={`${label} team`}>
        <option value="">Choose a team</option>
        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {fictional && (
        <label className="flex items-center gap-2 text-xs text-slate-400">Season
          <input type="number" min={1999} max={THIS_SEASON} value={season} onChange={(e) => onSeason(Number(e.target.value))} className="w-24 min-h-11 rounded-md bg-ink border border-line px-2 text-sm text-slate-100" />
        </label>
      )}
    </fieldset>
  );
}

function Interval({ label, d, fmt = (x: number) => String(Math.round(x)) }: { label: string; d: SimResult["margin"]; fmt?: (x: number) => string }) {
  return (
    <div className="rounded-lg bg-ink border border-line p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-2xl font-extrabold tabular-nums">{fmt(d.median)}</div>
      <div className="text-xs text-slate-400">Middle 50%: {fmt(d.p25)} to {fmt(d.p75)} · 90%: {fmt(d.p05)} to {fmt(d.p95)}</div>
    </div>
  );
}

export default function Simulate() {
  const [params, setParams] = useSearchParams();
  const leagues = useLeagues();
  const enabled = useMemo(() => (leagues?.data || []).filter((l) => l.enabled), [leagues]);
  const [league, setLeague] = useState(params.get("league") || "nfl");
  const [fictional, setFictional] = useState(params.get("mode") === "fictional");
  const [homeLeague, setHomeLeague] = useState(league), [awayLeague, setAwayLeague] = useState(league);
  const [home, setHome] = useState(params.get("home") || ""), [away, setAway] = useState(params.get("away") || "");
  const [homeSeason, setHomeSeason] = useState(THIS_SEASON), [awaySeason, setAwaySeason] = useState(THIS_SEASON);
  const [n, setN] = useState(5000);
  const [teams, setTeams] = useState<Record<string, Sourced<Team[]>>>({});
  const [schedule, setSchedule] = useState<Sourced<ScoreGame[]> | null>(null);
  const [result, setResult] = useState<SimResult | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");

  useEffect(() => { for (const lg of new Set([league, homeLeague, awayLeague])) if (!teams[lg]) getTeams(lg).then((t) => setTeams((m) => ({ ...m, [lg]: t }))); }, [league, homeLeague, awayLeague]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (enabled.length) getSchedule(enabled.map((l) => l.id)).then(setSchedule); }, [enabled]);
  useEffect(() => { if (!fictional) { setHomeLeague(league); setAwayLeague(league); } }, [league, fictional]);

  const lgObj = (id: string) => leagues?.data.find((l) => l.id === id);
  const upcoming = (schedule?.data || []).filter((g) => g.league === league && g.status === "scheduled").slice(0, 8);
  const hl = fictional ? homeLeague : league, al = fictional ? awayLeague : league;
  const hs = fictional ? homeSeason : THIS_SEASON, as = fictional ? awaySeason : THIS_SEASON;
  const crossEra = hs !== as, crossLevel = hl !== al, entertainment = crossEra || crossLevel;
  const teamOf = (lg: string, id: string) => teams[lg]?.data.find((t) => t.id === id);

  async function run() {
    setErr("");
    if (!home || !away) return setErr("Pick both teams first.");
    if (home === away && hl === al && hs === as) return setErr("Pick two different teams (or different seasons).");
    const h = teamOf(hl, home), a = teamOf(al, away); if (!h || !a) return setErr("Team not found.");
    setBusy(true); setResult(null);
    setParams({ league, home, away, ...(fictional ? { mode: "fictional" } : {}) }, { replace: true });
    try {
      const r = await runSim({ league: hl, home, away, n, ...(fictional ? { homeLeague: hl, awayLeague: al, homeSeason: hs, awaySeason: as, neutral: crossLevel } : {}) },
        { home: fictional && hs !== THIS_SEASON ? { ...h, name: `${hs} ${h.name}` } : h, away: fictional && as !== THIS_SEASON ? { ...a, name: `${as} ${a.name}` } : a });
      if (entertainment) r.entertainmentOnly = true;
      setResult(r);
    } catch { setErr("The simulator didn't respond. Try again in a moment."); }
    finally { setBusy(false); }
  }

  const r = result, lr = r ? lgObj(r.league) : undefined;
  const fav = r && (r.winProbability.home >= r.winProbability.away ? { t: r.teams.home, p: r.winProbability.home } : { t: r.teams.away, p: r.winProbability.away });
  const sample = teams[league]?.source === "sample" || schedule?.source === "sample";
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Simulate a matchup</h1>
        <p className="mt-1 text-slate-400 text-sm">Pick a league and two teams. We play the game snap by snap, thousands of times, then show you one representative game.</p>
        {sample && <p className="mt-2"><SamplePill /></p>}
      </header>

      <section className="rounded-xl bg-panel border border-line p-4 space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="League">
          {(leagues?.data || []).map((l) => (
            <button key={l.id} disabled={!l.enabled} onClick={() => { setLeague(l.id); setHome(""); setAway(""); setResult(null); }}
              className={`min-h-11 px-4 rounded-md border text-sm font-semibold ${league === l.id ? "bg-accent text-ink border-accent" : "border-line text-slate-200"} disabled:opacity-40`}
              aria-pressed={league === l.id}>{l.name}{!l.enabled && <span className="ml-1 text-[10px] font-normal">soon</span>}</button>
          ))}
          <label className="ml-auto inline-flex items-center gap-2 text-sm min-h-11">
            <input type="checkbox" checked={fictional} onChange={(e) => setFictional(e.target.checked)} className="h-5 w-5 accent-cyan-400" /> Fictional matchup (any season or league)
          </label>
        </div>

        {!fictional && upcoming.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Upcoming {lgObj(league)?.name} games</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {upcoming.map((g) => (
                <button key={g.id} onClick={() => { setHome(g.home.id); setAway(g.away.id); }}
                  className={`shrink-0 text-left rounded-lg border px-3 py-2 text-xs min-h-11 ${home === g.home.id && away === g.away.id ? "border-accent bg-accent/10" : "border-line bg-ink"}`}>
                  <div className="font-semibold text-slate-100">{g.away.name} at {g.home.name}</div>
                  <div className="text-slate-400">{ctDateTime(g.start)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <TeamPick label="Away" fictional={fictional} league={al} leagues={leagues?.data || []} teams={teams[al]?.data || []} value={away} season={awaySeason}
            onLeague={(v) => { setAwayLeague(v); setAway(""); }} onTeam={setAway} onSeason={setAwaySeason} />
          <TeamPick label="Home" fictional={fictional} league={hl} leagues={leagues?.data || []} teams={teams[hl]?.data || []} value={home} season={homeSeason}
            onLeague={(v) => { setHomeLeague(v); setHome(""); }} onTeam={setHome} onSeason={setHomeSeason} />
        </div>
        {entertainment && <p className="rounded-md bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-200 text-sm px-3 py-2"><b>{ENTERTAINMENT}.</b> {crossLevel ? "College vs. pro" : "Cross-era"} matchups can't be checked against a real game.{crossLevel ? " Played on a neutral field." : ""}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-400 flex items-center gap-2">Simulations
            <select className="min-h-11 rounded-md bg-ink border border-line px-2 text-sm text-slate-100" value={n} onChange={(e) => setN(Number(e.target.value))}>
              {[1000, 5000, 10000].map((x) => <option key={x} value={x}>{x.toLocaleString()}</option>)}
            </select>
          </label>
          <button onClick={run} disabled={busy} className="min-h-11 rounded-lg bg-accent text-ink font-bold px-5 disabled:opacity-60">{busy ? "Simulating…" : "Run simulation"}</button>
          {err && <span className="text-sm text-loss" role="alert">{err}</span>}
        </div>
      </section>

      {r && fav && (
        <section className="space-y-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold">{r.teams.away.name} at {r.teams.home.name}</h2>
            {r.sample && <SamplePill />}
            {r.entertainmentOnly && <span className="rounded bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-500/30 px-2 py-0.5 text-[11px] font-semibold">{ENTERTAINMENT}</span>}
          </div>
          <div className="rounded-xl bg-panel border border-line p-4 space-y-4">
            <div>
              <div className="flex justify-between text-sm"><span className="text-amber-300 font-semibold">{r.teams.away.name} {pct(r.winProbability.away)}</span><span className="text-accent font-semibold">{pct(r.winProbability.home)} {r.teams.home.name}</span></div>
              <div className="mt-1 h-3 rounded-full overflow-hidden flex bg-line" role="img" aria-label={`Win probability: ${r.teams.away.name} ${pct(r.winProbability.away)}, ${r.teams.home.name} ${pct(r.winProbability.home)}`}>
                <div className="bg-amber-400" style={{ width: pct(r.winProbability.away) }} /><div className="bg-slate-500" style={{ width: pct(r.winProbability.tie) }} /><div className="bg-accent flex-1" />
              </div>
              <p className="mt-2 text-sm text-slate-300">{fav.t.name} won {pct(fav.p)} of {r.n.toLocaleString()} simulated games.{r.winProbability.tie > 0.001 ? ` Ties: ${pct(r.winProbability.tie)}.` : ""}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-ink border border-line p-3">
                <div className="text-xs text-slate-400">Median score</div>
                <div className="text-2xl font-extrabold tabular-nums">{r.medianScore.away}–{r.medianScore.home}</div>
                <div className="text-xs text-slate-400">Away–home</div>
              </div>
              <Interval label={`Margin (${r.teams.home.name})`} d={r.margin} fmt={(x) => signed(Math.round(x))} />
              <Interval label="Total points" d={r.total} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <caption className="text-left text-xs text-slate-400 pb-1">Median points by {(lr?.periods.label || "Quarter").toLowerCase()}</caption>
                <thead><tr className="text-slate-400 text-xs"><th className="text-left font-normal p-1">Team</th>{r.periodScores.home.map((_, i) => <th key={i} className="p-1 font-normal">{lr?.periods.short || "Q"}{i + 1}</th>)}</tr></thead>
                <tbody>
                  <tr><td className="p-1 text-amber-300">{r.teams.away.name}</td>{r.periodScores.away.map((x, i) => <td key={i} className="p-1 text-center">{x}</td>)}</tr>
                  <tr><td className="p-1 text-accent">{r.teams.home.name}</td>{r.periodScores.home.map((x, i) => <td key={i} className="p-1 text-center">{x}</td>)}</tr>
                </tbody>
              </table>
              <p className="text-[11px] text-slate-400 mt-1">Each quarter's median is taken on its own, so they needn't add up to the median final.</p>
            </div>
            {r.label && <p className="text-xs text-fuchsia-200">{r.label}</p>}
            <p className="text-xs text-slate-400">{site.pickDisclaimer}</p>
          </div>

          <div className="rounded-xl bg-panel border border-line p-4 space-y-2">
            <h3 className="font-bold">Watch one simulated game</h3>
            <p className="text-xs text-slate-400">One game from the batch, picked as closest to the median margin and total. It's a simulation, not a forecast of the actual plays. Players appear only by position. Final: {r.teams.away.name} {r.representative.final.away}, {r.teams.home.name} {r.representative.final.home}{r.representative.overtime ? " (OT)" : ""}.</p>
            <GamePlayer league={lr} sport={r.sport} teams={r.teams} events={r.representative.events} />
          </div>
        </section>
      )}
    </div>
  );
}
