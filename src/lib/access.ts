import { site } from "../config/site";
import { useSubscriber, SESSION_KEY } from "./runtime";
import { useEffect, useState } from "react";
import { useData, GamesFile, loadMemberPredictions } from "./data";

// Free tier (Perry 9:38): ONE featured game per day shows its full prediction openly on its public game page,
// no account needed. Other games show matchup + tip time + CTA only (no partial numbers).
// Featured game = the day's earliest tip-off (CT calendar day), ties broken by game id. Same rule in server/index.mjs.
// Larry P6: non-featured pre-tip predictions are NOT in the public JSON or the repo. The pipeline keeps them in a
// private dir and members fetch them from the gated /api/predictions (see useGames below).
export const gatingActive = () => site.pricing.freeTier.gatingEnabled;

const ctDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export function featuredIds(items: Array<{ id: string; date: string }>): Set<string> {
  const best = new Map<string, { id: string; date: string }>();
  for (const it of items) {
    const d = ctDay(it.date), cur = best.get(d);
    if (!cur || it.date < cur.date || (it.date === cur.date && it.id < cur.id)) best.set(d, it);
  }
  return new Set([...best.values()].map((x) => x.id));
}
// Public games.json merged with member predictions when the visitor is an active subscriber.
export function useGames() {
  const pub = useData<GamesFile>("games");
  const sub = useSubscriber();
  const [extra, setExtra] = useState<Record<string, NonNullable<GamesFile["games"][string]["prediction"]>>>({});
  useEffect(() => { if (sub) loadMemberPredictions(localStorage.getItem(SESSION_KEY)).then(setExtra); }, [sub]);
  if (!pub.data || !Object.keys(extra).length) return pub;
  const games = Object.fromEntries(Object.entries(pub.data.games).map(([id, g]) => [id, extra[id] && !g.prediction ? { ...g, prediction: extra[id] } : g]));
  return { data: { ...pub.data, games }, error: pub.error };
}
export function useCanSee() {
  const sub = useSubscriber();
  return (id: string, featured: Set<string>) => !gatingActive() || sub || featured.has(id);
}
