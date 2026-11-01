# DRAFT: subscription confirmation email (not wired, nothing sends it)

Status: draft for Larry's review (requested 10/31 10:23 PM; round 3 edits 10:31 PM). No code reads this file and there is no email sender in
the app. Stripe's own receipt email is a separate thing, controlled in the Stripe Dashboard, and isn't configured here.
Payments are off, so nothing would trigger this today.

California (Bus. & Prof. Code §17602) and ROSCA both expect the acknowledgment to repeat the price, the automatic
renewal terms and how to cancel. Lines 1 and 2 of the body are the two checkout lines, word for word
(src/config/commerce.json `checkoutLines`). The refund paragraph is Larry's text from site.ts `legal.refunds`.
Placeholders: {FIRST_CHARGE_DATE}, {NEXT_RENEWAL_DATE}, {AMOUNT_CHARGED} (price plus tax, from the Stripe invoice),
{TERMS_VERSION} (the consent record's terms_version, e.g. terms-v2), {TERMS_EFFECTIVE} (the consent record's
terms_effective, e.g. "November 1, 2026").

---

**Subject:** Your Simculus membership is active: $9/month, renews monthly

**Body:**

Thanks for joining Simculus. Your membership is active.

$9/month plus applicable tax, billed today and every month after.
Renews automatically until you cancel. Cancel anytime in Account settings; you keep access through the end of the month you've paid for.

- Charged today ({FIRST_CHARGE_DATE}): {AMOUNT_CHARGED}
- Next renewal: {NEXT_RENEWAL_DATE}, then the same day each month until you cancel.

**How to cancel:** Cancel online any time. Go to Account settings (https://simculus.com/account) and choose Cancel subscription, then confirm. If you're on a different device, use the "Paid on another device?" link there and we'll email you a code to sign in and cancel. No call is required. You can also email support@simculus.com from your account email with the word "cancel" and we'll cancel it within one business day. Your access continues through the end of the month you've already paid for.

Refunds. You can cancel anytime online in Account settings. Cancellation stops future charges, and you keep paid access until the end of your current billing period. Because predictions are delivered as soon as they're posted, we don't refund partial months or unused time, except where the law requires. If you were charged in error or charged after you canceled, email support@simculus.com within 60 days and we'll refund that charge. If you dispute a charge with your card issuer, we may suspend paid access while it's reviewed.

You agreed to the Simculus Terms ({TERMS_VERSION}) (effective {TERMS_EFFECTIVE}) at checkout: https://simculus.com/terms

Simulations and predictions are for information only. They're not betting advice, and no outcome is guaranteed. 21+. If you or someone you know has a gambling problem, call 1-800-GAMBLER.

Simculus is operated by Op3x LLC. Questions? support@simculus.com

---

Open items before this can send:
1. Choose a sender (none exists in the repo) and the trigger (the Stripe webhook after billing_check=passed).
2. Refund paragraph: kept (support@simculus.com works; commerce.supportEmailActive is true).
3. The cancel steps above are Terms §5(c) word for word (Larry 10:31 PM): /account "Cancel subscription" opens the
   Stripe portal straight on its cancel screen (flow_data subscription_cancel), then Confirm. The "Paid on another
   device?" link needs Ryan to turn on the portal login link in Stripe and set STRIPE_PORTAL_LOGIN_URL.
4. Sender + trigger requirements (not wired; signing up for a provider needs Ryan's OK):
   - Provider: Resend, Postmark or Amazon SES (any transactional sender), with simculus.com verified (SPF + DKIM
     DNS records, ideally DMARC) so mail from support@simculus.com isn't spam-foldered.
   - Trigger: our existing Stripe webhook, on `checkout.session.completed` (has the session's consent metadata and
     customer email) after billing_check=passed; or `invoice.paid` with billing_reason=subscription_create for the
     charged amount incl. tax. Dedupe on the event id so Stripe retries don't double-send.
   - Env: e.g. RESEND_API_KEY (or POSTMARK_SERVER_TOKEN / AWS SES creds), EMAIL_FROM ("Simculus <support@simculus.com>"),
     EMAIL_REPLY_TO (support@simculus.com), EMAIL_ENABLED (default off; preview sends only to test addresses).
