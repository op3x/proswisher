import { site } from "../config/site";
import { useSubscriber } from "./runtime";

// Free tier (Perry 9:38): ONE featured game per day shows its full prediction openly on its public game page,
// no account needed. Other games show matchup + tip time + CTA only (no partial numbers).
// Featured game = the day's earliest tip-off (CT calendar day), ties broken by game id. Same rule in server/index.mjs.
// CAVEAT: static data, so all predictions are in the public JSON (/data/*.json, and the repo). Gating is
// presentation-only until a server-side data API gates predictions; see README.
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
export function useCanSee() {
  const sub = useSubscriber();
  return (id: string, featured: Set<string>) => !gatingActive() || sub || featured.has(id);
}
