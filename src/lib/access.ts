import { site } from "../config/site";

// Free tier (Kiko's decision): ONE featured game per day shows its full prediction openly on its public
// game page, no account needed. Other games show the matchup with the prediction behind the CTA.
// Featured game = the day's earliest tip-off (CT calendar day), ties broken by game id. Deterministic.
// CAVEAT: this is a static site, so all predictions are in the public JSON (/data/*.json, and the repo).
// Client-side gating is cosmetic until a server/API gates the data; see README.
export const gatingActive = () => site.pricing.freeTier.gatingEnabled;
const isSubscriber = () => false; // stub until accounts + payments exist

const ctDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export function featuredIds(items: Array<{ id: string; date: string }>): Set<string> {
  const best = new Map<string, { id: string; date: string }>();
  for (const it of items) {
    const d = ctDay(it.date), cur = best.get(d);
    if (!cur || it.date < cur.date || (it.date === cur.date && it.id < cur.id)) best.set(d, it);
  }
  return new Set([...best.values()].map((x) => x.id));
}
export const canSeePrediction = (id: string, featured: Set<string>) => !gatingActive() || isSubscriber() || featured.has(id);
