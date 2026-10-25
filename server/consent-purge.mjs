// Larry memo 21 R4(d): consent records keep the raw IP for the subscription's life + 4 years, then the IP is purged
// from CONSENT_DIR/consent.jsonl and from the Subscription's metadata (consent_ip set to "").
// Stripe API calls: checkout.sessions.retrieve (expand subscription) and subscriptions.update (metadata only).
// Limitation: a completed Checkout Session's metadata cannot be edited through the API, so consent_ip stays on the
// Session object at Stripe; see README "Retention" (manual/Stripe-support step).
// Runs daily inside the server when CONSENT_DIR is set and payments are enabled; also `npm run purge:consent`.
import fs from "node:fs";
import path from "node:path";

export const CONSENT_KEEP_YEARS = 4;
const plusYears = (ms, y) => { const d = new Date(ms); d.setUTCFullYear(d.getUTCFullYear() + y); return d.getTime(); };

export async function purgeConsent({ dir, stripe, now = () => new Date(), log = console.log }) {
  const file = dir ? path.join(dir, "consent.jsonl") : "";
  if (!file || !fs.existsSync(file) || !stripe) return { checked: 0, purged: 0 };
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  let purged = 0, checked = 0, changed = false;
  const out = [];
  for (const line of lines) {
    let r; try { r = JSON.parse(line); } catch { out.push(line); continue; }
    if (!r.consent_ip) { out.push(JSON.stringify(r)); continue; }
    checked++;
    let endMs = null, subId = null;
    try {
      const s = r.checkout_session ? await stripe.checkout.sessions.retrieve(r.checkout_session, { expand: ["subscription"] }) : null;
      const sub = s && typeof s.subscription === "object" ? s.subscription : null;
      if (sub) { subId = sub.id; endMs = sub.ended_at ? sub.ended_at * 1000 : null; } // active -> keep
      else endMs = Date.parse(r.consent_at);                                              // never subscribed
    } catch (e) {
      if (e?.code === "resource_missing") endMs = Date.parse(r.consent_at);
      else { log(`[consent] purge check skipped (${e?.type || e?.name})`); out.push(JSON.stringify(r)); continue; }
    }
    if (endMs !== null && now().getTime() > plusYears(endMs, CONSENT_KEEP_YEARS)) {
      if (subId) await stripe.subscriptions.update(subId, { metadata: { consent_ip: "" } });
      r.consent_ip = null; r.consent_ip_purged_at = now().toISOString(); purged++; changed = true;
    }
    out.push(JSON.stringify(r));
  }
  if (changed) { fs.writeFileSync(file + ".tmp", out.join("\n") + "\n"); fs.renameSync(file + ".tmp", file); }
  log(`[consent] purge: ${checked} consent records checked, ${purged} addresses cleared`);
  return { checked, purged };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { paymentsMode, makeStripe } = await import("./payments.mjs");
  const mode = paymentsMode(process.env);
  if (!mode.enabled) { console.log("[consent] payments disabled; nothing to purge"); process.exit(0); }
  await purgeConsent({ dir: process.env.CONSENT_DIR, stripe: makeStripe(mode) });
}
