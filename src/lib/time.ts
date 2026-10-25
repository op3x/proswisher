// Dependency-free date formatters (tested in tests/server/time.test.mjs).
// The slate, grading day and tip-off times are all Central Time (Sal #14), so day headings
// and day grouping must use the same zone or a late game lands under the wrong day.
export const TZ = "America/Chicago";
// Sal #14: tip-off times are always Central Time, labeled.
export const tipTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
// Sal follow-up: day headings in CT so they match the CT tip-off times.
export const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
// YYYY-MM-DD of the CT calendar day; used to group the slate by day.
export const ctDayKey = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
