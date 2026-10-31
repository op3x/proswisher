import { useEffect, useState } from "react";
import type { League } from "./types";
import { getLeagues, Sourced } from "./api";

/** While a live feed is still warming up (server startup refresh), sample results are retried this often. */
export const SAMPLE_RETRY_MS = 10000;
const isSample = (x: unknown) => !!x && typeof x === "object" && (x as { source?: string }).source === "sample";

let cache: Promise<Sourced<League[]>> | null = null;
export function useLeagues() {
  const [v, setV] = useState<Sourced<League[]> | null>(null);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => (cache ||= getLeagues()).then((x) => {
      if (!alive) return; setV(x);
      if (x.source === "sample") { cache = null; timer = setTimeout(run, SAMPLE_RETRY_MS); }
    });
    run();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return v;
}

/** Polls `load` every `ms` while the tab is visible; a sample (fallback) result is retried after SAMPLE_RETRY_MS. */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      const next = (x?: T) => { if (alive) timer = setTimeout(run, isSample(x) ? Math.min(ms, SAMPLE_RETRY_MS) : ms); };
      if (document.visibilityState === "hidden") return next();
      load().then((x) => { if (alive) setV(x); next(x); }).catch(() => next());
    };
    run();
    return () => { alive = false; clearTimeout(timer); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}
