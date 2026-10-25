// Larry's date rule: the "Effective" date of a legal text is the day that version first goes live in PRODUCTION
// (US Central), set at release time via env (never hard-coded). Preview always shows "Effective on launch".
// Version strings come from the "Version:" line of each src/content file, the same text the page renders, so the
// consent record's text_version can never drift from what the buyer saw.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LEGAL_DOCS = { terms: "terms-v1.md", privacyA: "privacy-a.md", privacyB: "privacy-b.md" };
export const LEGAL_ENV = { terms: "LEGAL_EFFECTIVE_TERMS", privacyA: "LEGAL_EFFECTIVE_PRIVACY_A", privacyB: "LEGAL_EFFECTIVE_PRIVACY_B", refund: "LEGAL_EFFECTIVE_REFUND" };
export const ON_LAUNCH = "Effective on launch";

export function docVersion(text) { const m = /Version:\s*([a-z0-9-]+)/i.exec(text); return m ? m[1] : null; }
export function legalVersions(dir = path.join(ROOT, "src/content")) {
  return Object.fromEntries(Object.entries(LEGAL_DOCS).map(([k, f]) => [k, docVersion(fs.readFileSync(path.join(dir, f), "utf8"))]));
}
// "2026-10-26" -> "October 26, 2026" (a calendar date; formatted in UTC so it never shifts a day)
export function formatEffective(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return null;
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
}
export function legalEffective(env = process.env) {
  const prod = env.APP_ENV === "production";
  return Object.fromEntries(Object.entries(LEGAL_ENV).map(([k, v]) => [k, (prod && formatEffective(env[v])) || ON_LAUNCH]));
}
