// Matchup page: league -> two teams (a real upcoming game or a fictional one) -> run -> results + animated game.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLeagues, SAMPLE_RETRY_MS } from "../sports/hooks";
import { getSchedule, getTeams, runGameSim, runSim, Sourced } from "../sports/api";
import { ctDateTime, pct, signed } from "../sports/format";
import type { League, ScoreGame, SimResult, Team } from "../sports/types";
import GamePlayer from "../components/GamePlayer";
import { preloadRenderer } from "../renderers/registry";
import { site } from "../config/site";

const THIS_SEASON = 2026;
// Ryan via Larry 10/31 10:07 PM: picked-matchup tags. Same league + season but not scheduled -> unscheduled;
// cross-era or college-vs-pro -> cross; a pick that's on the schedule is a normal prediction with NO tag.
const TAGS = site.matchupTags;
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

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Same footprint as the game player (scoreboard, quarter line, field), so swapping it for the game doesn't shift the page. */
function SimSkeleton({ n }: { n: number }) {
  return (
    <div className="rounded-xl bg-panel border border-line p-4 space-y-3 sim-skeleton" role="status" aria-live="polite" data-testid="sim-skeleton">
      <div className="flex items-center gap-3">
        <span className="inline-block h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" aria-hidden="true" />
        <span className="text-sm text-slate-300">Simulating {n.toLocaleString()} games snap by snap… this takes a few seconds.</span>
      </div>
      <div className="h-14 rounded-lg bg-black/40 border border-line animate-pulse" aria-hidden="true" />
      <div className="h-24 rounded-lg bg-black/30 border border-line animate-pulse" aria-hidden="true" />
      <div className="aspect-[120/53] rounded-lg bg-[#14532d]/60 border border-line animate-pulse" aria-hidden="true" />
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
  const [revealed, setRevealed] = useState(false); // outcome stays hidden until the simulated game finishes
  // Ryan 10/31: no jump on Run simulation. The output area keeps its height while the next batch runs (reserve), the old
  // game fades back instead of unmounting, and the new one cross-fades in. Nothing scrolls unless the area is off screen.
  const outRef = useRef<HTMLDivElement>(null);
  const [reserve, setReserve] = useState(0), [runId, setRunId] = useState(0);
  useLayoutEffect(() => { if (!busy && result && reserve) { const id = setTimeout(() => setReserve(0), 500); return () => clearTimeout(id); } }, [busy, result, reserve]);
  useEffect(() => { setRevealed(false); }, [result]);

  useEffect(() => { for (const l of enabled) preloadRenderer(l.sport); }, [enabled]);
  // Sample fallbacks (server still refreshing data at startup) are retried until the live feed answers.
  const [retryTick, setRetryTick] = useState(0);
  const anySample = schedule?.source === "sample" || Object.values(teams).some((t) => t.source === "sample");
  useEffect(() => { if (!anySample) return; const id = setTimeout(() => setRetryTick((x) => x + 1), SAMPLE_RETRY_MS); return () => clearTimeout(id); }, [anySample, retryTick]);
  useEffect(() => { for (const lg of new Set([league, homeLeague, awayLeague])) if (!teams[lg] || teams[lg].source === "sample") getTeams(lg).then((t) => setTeams((m) => ({ ...m, [lg]: t }))); }, [league, homeLeague, awayLeague, retryTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (enabled.length && (!schedule || schedule.source === "sample")) getSchedule(enabled.map((l) => l.id)).then(setSchedule); }, [enabled, retryTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!fictional) { setHomeLeague(league); setAwayLeague(league); } }, [league, fictional]);

  const lgObj = (id: string) => leagues?.data.find((l) => l.id === id);
  const upcoming = (schedule?.data || []).filter((g) => g.league === league && g.status === "scheduled").slice(0, 8);
  const hl = fictional ? homeLeague : league, al = fictional ? awayLeague : league;
  const hs = fictional ? homeSeason : THIS_SEASON, as = fictional ? awaySeason : THIS_SEASON;
  const crossEra = hs !== as, crossLevel = hl !== al, entertainment = crossEra || crossLevel;
  // A pick (fictional mode or not) that is an upcoming game on the schedule, home/away as picked: normal prediction.
  const schedMatch = !entertainment && hs === THIS_SEASON && home && away
    ? (schedule?.data || []).find((g) => g.league === hl && g.status === "scheduled" && g.home.id === home && g.away.id === away) : undefined;
  const pickTag = entertainment ? TAGS.cross : home && away && !schedMatch ? TAGS.unscheduled : null;
  const teamOf = (lg: string, id: string) => teams[lg]?.data.find((t) => t.id === id);

  async function run() {
    setErr("");
    if (!home || !away) return setErr("Pick both teams first.");
    if (home === away && hl === al && hs === as) return setErr("Pick two different teams (or different seasons).");
    const h = teamOf(hl, home), a = teamOf(al, away); if (!h || !a) return setErr("Team not found.");
    setReserve(outRef.current?.offsetHeight || 0);
    setBusy(true);
    // Bring the output area into view only when it's off screen, gently (instantly with reduced motion).
    requestAnimationFrame(() => { const el = outRef.current; if (!el) return; const top = el.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.75 || top < 0) el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }); });
    setParams({ league, home, away, ...(fictional ? { mode: "fictional" } : {}) }, { replace: true });
    try {
      const req = { league: hl, home, away, n, ...(fictional ? { homeLeague: hl, awayLeague: al, homeSeason: hs, awaySeason: as, neutral: crossLevel } : {}) };
      const names = { home: fictional && hs !== THIS_SEASON ? { ...h, name: `${hs} ${h.name}` } : h, away: fictional && as !== THIS_SEASON ? { ...a, name: `${as} ${a.name}` } : a };
      // A scheduled game uses the game's own sim (NFL injury-adjusted when on) and gets no tag; anything else is a picked matchup.
      const sched = schedMatch && schedule?.source === "live" ? schedMatch : undefined;
      const r = sched ? await runGameSim(sched.id, req, names) : await runSim(req, names);
      // The server's label wins (it also routes a scheduled pick to the game sim, with no label); the sample fallback uses ours.
      r.label = sched || r.scheduled ? undefined : r.sample ? pickTag ?? undefined : r.label || pickTag || undefined;
      r.entertainmentOnly = !!r.label;
      setResult(r); setRunId((x) => x + 1);
    } catch { setErr("The simulator didn't respond. Try again in a moment."); setReserve(0); }
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
            <input type="checkbox" checked={fictional} onChange={(e) => setFictional(e.target.checked)} className="h-5 w-5 accent-cyan-400" /> Pick Your Matchup (any season or league)
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
        {pickTag && <p className="rounded-md bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-200 text-sm px-3 py-2" data-testid="pick-tag"><b>{pickTag}</b>{crossLevel ? " Played on a neutral field." : ""}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-400 flex items-center gap-2">Simulations
            <select className="min-h-11 rounded-md bg-ink border border-line px-2 text-sm text-slate-100" value={n} onChange={(e) => setN(Number(e.target.value))}>
              {[1000, 5000, 10000].map((x) => <option key={x} value={x}>{x.toLocaleString()}</option>)}
            </select>
          </label>
          <button type="button" onClick={run} disabled={busy} aria-busy={busy} className="min-h-11 rounded-lg bg-accent text-ink font-bold px-5 disabled:opacity-60">{busy ? "Simulating…" : "Run simulation"}</button>
          {err && <span className="text-sm text-loss" role="alert">{err}</span>}
        </div>
      </section>

      <div ref={outRef} className="sim-anchor relative" style={reserve ? { minHeight: reserve } : undefined} data-testid="sim-output">
      {busy && !r && <SimSkeleton n={n} />}
      {busy && r && (
        <div className="sticky top-20 z-10 h-0" aria-hidden="false">
          <div className="mx-auto w-fit rounded-full bg-panel/95 border border-line shadow-lg px-4 py-2 flex items-center gap-2 text-sm text-slate-200" role="status" aria-live="polite">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" aria-hidden="true" />
            Simulating {n.toLocaleString()} games…
          </div>
        </div>
      )}
      {r && fav && (
        <section key={runId} className={`space-y-4 ${busy ? "sim-fade-out" : "sim-fade-in"}`} aria-busy={busy}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold">{r.teams.away.name} at {r.teams.home.name}</h2>
            {r.sample && <SamplePill />}
            {r.label && <span className="rounded bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-500/30 px-2 py-0.5 text-[11px] font-semibold" data-testid="result-tag">{r.label}</span>}
          </div>

          {/* Ryan 10/31: the simulated game plays first (12x by default) and no outcome is shown until it ends. */}
          <div className="rounded-xl bg-panel border border-line p-4 space-y-2">
            <h3 className="font-bold">Watch one simulated game</h3>
            <p className="text-xs text-slate-400">One game from the batch, picked as closest to the median margin and total. It's a simulation, not a forecast of the actual plays. Players appear only by position.{revealed && <> Final: {r.teams.away.name} {r.representative.final.away}, {r.teams.home.name} {r.representative.final.home}{r.representative.overtime ? " (OT)" : ""}.</>}</p>
            <GamePlayer league={lr} sport={r.sport} teams={r.teams} events={r.representative.events} autoPlay hideFuture onComplete={() => setRevealed(true)} />
          </div>

          <div className="rounded-xl bg-panel border border-line p-4 space-y-4" data-testid="sim-results">
            {!(revealed || !r.representative.events.length) ? (
              <div className="flex items-center gap-3 py-4" role="status" aria-live="polite">
                <span className="inline-block h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" aria-hidden="true" />
                <div>
                  <p className="font-semibold">Simulation running…</p>
                  <p className="text-xs text-slate-400">Win chances, scores and the quarter line for all {r.n.toLocaleString()} games appear when the game above reaches the final whistle. Slow it down or step through plays any time.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4" aria-live="polite">
                <div>
                  <div className="flex justify-between text-sm"><span className="text-amber-300 font-semibold">{r.teams.away.name} {pct(r.winProbability.away)}</span><span className="text-accent font-semibold">{pct(r.winProbability.home)} {r.teams.home.name}</span></div>
                  <div className="mt-1 h-3 rounded-full overflow-hidden flex bg-line" role="img" aria-label={`Win probability: ${r.teams.away.name} ${pct(r.winProbability.away)}, ${r.teams.home.name} ${pct(r.winProbability.home)}`}>
                    <div className="bg-amber-400" style={{ width: pct(r.winProbability.away) }} /><div className="bg-slate-500" style={{ width: pct(r.winProbability.tie) }} /><div className="bg-accent flex-1" />
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{fav.t.name} won {pct(fav.p)} of {r.n.toLocaleString()} simulated games.{r.winProbability.tie >= 0.005 ? ` Ties: ${pct(r.winProbability.tie)}.` : ""}</p>
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
                    <caption className="text-left text-xs text-slate-400 pb-1">{r.periodKind === "line" ? "Projected points" : "Median points"} by {(lr?.periods.label || "Quarter").toLowerCase()}</caption>
                    <thead><tr className="text-slate-400 text-xs"><th className="text-left font-normal p-1">Team</th>{r.periodScores.home.map((_, i) => <th key={i} className="p-1 font-normal">{lr?.periods.short || "Q"}{i + 1}</th>)}{r.periodKind === "line" && <th className="p-1 font-normal">Final</th>}</tr></thead>
                    <tbody>
                      <tr><td className="p-1 text-amber-300">{r.teams.away.name}</td>{r.periodScores.away.map((x, i) => <td key={i} className="p-1 text-center">{x}</td>)}{r.periodKind === "line" && <td className="p-1 text-center font-semibold">{sum(r.periodScores.away)}</td>}</tr>
                      <tr><td className="p-1 text-accent">{r.teams.home.name}</td>{r.periodScores.home.map((x, i) => <td key={i} className="p-1 text-center">{x}</td>)}{r.periodKind === "line" && <td className="p-1 text-center font-semibold">{sum(r.periodScores.home)}</td>}</tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {/* Always rendered, outside the hidden part: quarter note, matchup tag, responsible-betting line. Model caveats are
                in the Terms (§21) and data credits on /credits (Larry 10:04 PM, Ryan approved). */}
            <p className="text-[11px] text-slate-400">Quarter scores show a typical scoring shape, not a precise forecast. {r.periodKind === "line" ? "They add up to the median final score; regular time only." : "Each quarter's median is taken on its own, so they needn't add up to the median final."}</p>
            {r.label && <p className="text-xs text-fuchsia-200">{r.label}</p>}
            <p className="text-xs text-slate-400">{site.pickDisclaimer}</p>
          </div>
        </section>
      )}
      </div>
    </div>
  );
}
