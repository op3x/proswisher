// Sport-agnostic playback: scoreboard, period clock, play/pause/speed, scrubber and play log.
// The field/court drawing comes from the renderer registered for the league's sport.
import { Suspense, useEffect, useRef, useState } from "react";
import type { League, PlayEvent, Team, Sport } from "../sports/types";
import { rendererFor } from "../renderers/registry";
import { periodLabel } from "../sports/format";

const SPEEDS = [0.5, 1, 2, 4, 8, 12];
export const DEFAULT_SPEED = 12; // Ryan 10/31 9:37 PM: default 12x, slower options (0.5x to 8x) kept
const BASE_MS = 1100; // one event at 1x

// autoPlay: start as soon as a result arrives. onComplete fires once the last event has fully played (or the user
// steps/scrubs onto it); the page uses it to keep the outcome hidden until then. hideFuture keeps the play log from
// listing plays (and scores) that haven't happened yet.
export default function GamePlayer({ league, sport, teams, events, autoPlay = false, onComplete, hideFuture = false }: {
  league?: League; sport: Sport; teams: { home: Team; away: Team }; events: PlayEvent[];
  autoPlay?: boolean; onComplete?: () => void; hideFuture?: boolean;
}) {
  const [index, setIndex] = useState(0), [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(autoPlay), [speed, setSpeed] = useState(DEFAULT_SPEED);
  const raf = useRef(0), last = useRef(0), lastIdx = useRef(0);
  lastIdx.current = index;
  const Renderer = rendererFor(sport);
  useEffect(() => { setIndex(0); setProgress(0); setPlaying(autoPlay); }, [events]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const step = (now: number) => {
      const dt = now - last.current; last.current = now;
      setProgress((p) => {
        const np = p + (dt * speed) / BASE_MS;
        if (np < 1) return np;
        if (lastIdx.current + 1 >= events.length) { setPlaying(false); return 1; } // hold the final play complete
        setIndex((i) => Math.min(events.length - 1, i + 1));
        return 0;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, events.length]);
  const doneRef = useRef(false);
  useEffect(() => { doneRef.current = false; }, [events]);
  const reachedEnd = events.length > 0 && index >= events.length - 1 && progress >= 1;
  useEffect(() => { if (reachedEnd && !doneRef.current) { doneRef.current = true; onComplete?.(); } }, [reachedEnd]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = events[index];
  if (!cur) return <p className="text-sm text-slate-400">No play log returned for this simulation.</p>;
  const atEnd = index >= events.length - 1 && progress >= 1;
  const done = doneRef.current || atEnd;
  const shown = progress >= 1 ? cur.score : events[index - 1]?.score ?? { home: 0, away: 0 };
  const btn = "inline-flex items-center justify-center min-h-11 min-w-11 rounded-md border border-line px-3 text-sm";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg bg-black/60 border border-line px-3 py-2 text-sm">
        <div className="truncate"><span className="text-amber-300 font-semibold">{teams.away.name}</span></div>
        <div className="text-center tabular-nums">
          <div className="text-2xl font-extrabold">{shown.away} <span className="text-slate-500">–</span> {shown.home}</div>
          <div className="text-xs text-slate-300">{periodLabel(league, cur.period, cur.clock)}</div>
        </div>
        <div className="truncate text-right"><span className="text-accent font-semibold">{teams.home.name}</span></div>
      </div>
      <div className="rounded-lg border border-line overflow-hidden bg-[#14532d]">
        {Renderer ? <Suspense fallback={<div className="aspect-[120/53] grid place-items-center text-xs text-slate-300">Loading field…</div>}>
          <Renderer league={league} teams={teams} events={events} index={index} progress={index === 0 && !playing && progress === 0 ? 0 : progress} />
        </Suspense> : <div className="p-6 text-sm text-slate-300">A visual for this sport is coming soon. The play log is below.</div>}
      </div>
      <p className="text-sm text-slate-200 min-h-10" aria-live="polite">{cur.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={`${btn} bg-accent text-ink font-semibold border-accent`} onClick={() => { if (atEnd || index >= events.length - 1) { setIndex(0); setProgress(0); } setPlaying((p) => !p); }} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <button className={btn} onClick={() => { setPlaying(false); setIndex((i) => Math.max(0, i - 1)); setProgress(1); }} aria-label="Previous play">◀</button>
        <button className={btn} onClick={() => { setPlaying(false); setIndex((i) => Math.min(events.length - 1, i + 1)); setProgress(1); }} aria-label="Next play">▶|</button>
        <div className="flex rounded-md border border-line overflow-hidden" role="group" aria-label="Speed">
          {SPEEDS.map((s) => <button key={s} className={`min-h-11 px-3 text-sm ${s === speed ? "bg-panel text-white font-semibold" : "text-slate-400"}`} onClick={() => setSpeed(s)} aria-pressed={s === speed}>{s}×</button>)}
        </div>
        <input type="range" min={0} max={events.length - 1} value={index} onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); setProgress(1); }}
          className="flex-1 min-w-32 accent-cyan-400" aria-label="Scrub through the game" />
        <span className="text-xs text-slate-400 tabular-nums">{index + 1}/{events.length}</span>
      </div>
      <details className="rounded-lg bg-panel border border-line">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold min-h-11 flex items-center">Play log ({hideFuture && !done ? `${index + (progress >= 1 ? 1 : 0)} of ${events.length}` : events.length} events)</summary>
        <ol className="max-h-72 overflow-y-auto text-xs divide-y divide-line">
          {(hideFuture && !done ? events.slice(0, index + (progress >= 1 ? 1 : 0)) : events).map((e) => (
            <li key={e.t} className={`px-3 py-1.5 flex gap-2 ${e.t === index ? "bg-accent/10" : ""}`}>
              <button className="text-left flex gap-2 w-full" onClick={() => { setPlaying(false); setIndex(e.t); setProgress(1); }}>
                <span className="w-16 shrink-0 text-slate-400 tabular-nums">{periodLabel(league, e.period, e.clock)}</span>
                <span className="flex-1 text-slate-200">{e.text}</span>
                <span className="shrink-0 tabular-nums text-slate-400">{e.score.away}–{e.score.home}</span>
              </button>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
