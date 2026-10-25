// Standard Stripe Billing, TEST mode only in preview. No products/prices are created by this code:
// STRIPE_PRICE_ID must point to a price Ryan creates. Never logs key values, only variable NAMES.
// Disabled (site still runs) when any of STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_ID is missing.
import Stripe from "stripe";
import { billingBlocked } from "./geo.mjs";

export function paymentsMode(env = process.env) {
  const appEnv = (env.APP_ENV || "preview").toLowerCase();
  const liveEnabled = String(env.STRIPE_LIVE_ENABLED || "false").toLowerCase() === "true";
  const key = env.STRIPE_SECRET_KEY || "", wh = env.STRIPE_WEBHOOK_SECRET || "", price = env.STRIPE_PRICE_ID || "";
  const missing = [["STRIPE_SECRET_KEY", key], ["STRIPE_WEBHOOK_SECRET", wh], ["STRIPE_PRICE_ID", price]].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) return { enabled: false, reason: `not configured (missing ${missing.join(", ")})` };
  const isTest = /^(sk|rk)_test_/.test(key), isLive = /^(sk|rk)_live_/.test(key);
  if (appEnv === "preview" && !isTest) return { enabled: false, reason: "APP_ENV=preview requires a sk_test_/rk_test_ key" };
  if (appEnv === "production") {
    if (!isLive) return { enabled: false, reason: "APP_ENV=production requires a live key" };
    if (!liveEnabled) return { enabled: false, reason: "STRIPE_LIVE_ENABLED is not true" };
  }
  if (!isTest && !isLive) return { enabled: false, reason: "STRIPE_SECRET_KEY has an unexpected format" };
  return { enabled: true, livemode: isLive, key, webhookSecret: wh, priceId: price };
}

// Verifies the configured price matches the site config (Stripe call: prices.retrieve -> Prices: Read).
export async function verifyPrice(stripe, mode, expect) {
  const p = await stripe.prices.retrieve(mode.priceId);
  const problems = [];
  if (!p.active) problems.push("price inactive");
  if (p.livemode !== mode.livemode) problems.push("price livemode mismatch");
  if (p.type !== "recurring" || p.recurring?.interval !== "month" || p.recurring?.interval_count !== 1) problems.push("price is not monthly recurring");
  if (p.currency !== expect.currency || p.unit_amount !== expect.unitAmount) problems.push(`price amount/currency differs from config (${expect.unitAmount} ${expect.currency})`);
  return problems;
}

export function makeStripe(mode) { return new Stripe(mode.key, { maxNetworkRetries: 1, appInfo: { name: "proswisher" } }); }

// checkout.session.completed: second billing gate on the address Stripe collected (billing_address_collection=required).
// Blocked -> refund the first payment, cancel the subscription, mark access revoked.
// Stripe calls: invoicePayments.list (Invoices: Read), refunds.create (Refunds: Write), subscriptions.cancel (Subscriptions: Write).
export async function handleCheckoutCompleted(stripe, session, revoked, log = console.log) {
  const addr = session.customer_details?.address;
  if (!billingBlocked(addr)) return { action: "none" };
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  const invId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id;
  log(`[pay] billing geoblock hit (country=${addr?.country || "?"} state=${addr?.state || "?"}); refunding + canceling`);
  let refunded = 0;
  if (invId) {
    const pays = await stripe.invoicePayments.list({ invoice: invId, limit: 10 });
    for (const ip of pays.data) {
      const pi = ip.payment?.payment_intent;
      const piId = typeof pi === "string" ? pi : pi?.id;
      if (piId && ip.status === "paid") {
        await stripe.refunds.create({ payment_intent: piId, reason: "requested_by_customer", metadata: { proswisher: "geoblock_billing" } },
          { idempotencyKey: `geoblock-refund-${piId}` });
        refunded++;
      }
    }
  }
  if (subId) await stripe.subscriptions.cancel(subId, {}, { idempotencyKey: `geoblock-cancel-${subId}` });
  if (subId) revoked.add(subId);
  if (session.id) revoked.add(session.id);
  return { action: "revoked", refunded, subscription: subId || null };
}
