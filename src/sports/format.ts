import type { League, ScoreGame } from "./types";
export const TZ = "America/Chicago";
export const ctTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" }) + " CT";
export const ctDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
/** "Q3 8:41", "OT 2:00", "H2 5:10": generic over period counts and labels. */
export function periodLabel(lg: League | undefined, period: number | null | undefined, clock?: string | null) {
  if (!period) return clock || "";
  const count = lg?.periods.count ?? 4, short = lg?.periods.short ?? "Q";
  const p = period > count ? (period - count > 1 ? `${period - count}OT` : "OT") : `${short}${period}`;
  return clock ? `${p} ${clock}` : p;
}
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const signed = (x: number) => (x > 0 ? `+${x}` : `${x}`);
export const statusText = (g: ScoreGame, lg?: League) =>
  g.status === "live" ? periodLabel(lg, g.period, g.clock) || "Live" : g.status === "final" ? g.detail || "Final" : g.status === "postponed" ? "Postponed" : ctTime(g.start);
