import { site } from "../config/site";
import { paymentsEnabled } from "./geoblock";
import type { Game } from "./data";

// Free tier STUB: 1 game per day free, the rest for subscribers. Gating is enforced only once payments
// exist (paymentsEnabled() is always false in this build, so every game is visible).
// A real implementation must gate server-side; a static site can't truly hide data in public JSON.
export const gatingActive = () => paymentsEnabled();
const isSubscriber = () => false; // stub until accounts exist

export function freeGameIds(games: Game[]): Set<string> {
  const perDay = new Map<string, Game[]>();
  for (const g of games) perDay.set(g.day, [...(perDay.get(g.day) || []), g]);
  const free = new Set<string>();
  for (const gs of perDay.values())
    gs.sort((a, b) => a.date.localeCompare(b.date)).slice(0, site.pricing.freeTier.gamesPerDay).forEach((g) => free.add(g.id));
  return free;
}
export const canSee = (g: Game, free: Set<string>) => !gatingActive() || isSubscriber() || free.has(g.id);
