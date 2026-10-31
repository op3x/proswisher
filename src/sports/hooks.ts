import { useEffect, useState } from "react";
import type { League } from "./types";
import { getLeagues, Sourced } from "./api";

let cache: Promise<Sourced<League[]>> | null = null;
export function useLeagues() {
  const [v, setV] = useState<Sourced<League[]> | null>(null);
  useEffect(() => { (cache ||= getLeagues()).then(setV); }, []);
  return v;
}

/** Polls `load` every `ms` while the tab is visible. */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => { if (document.visibilityState !== "hidden") load().then((x) => alive && setV(x)).catch(() => {}); };
    run(); const id = setInterval(run, ms);
    return () => { alive = false; clearInterval(id); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}
