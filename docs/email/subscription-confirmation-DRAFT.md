# DRAFT: subscription confirmation email (not wired, nothing sends it)

Status: draft for Larry's review (requested 10/31 10:23 PM). No code reads this file and there is no email sender in
the app. Stripe's own receipt email is a separate thing, controlled in the Stripe Dashboard, and isn't configured here.
Payments are off, so nothing would trigger this today.

California (Bus. & Prof. Code §17602) and ROSCA both expect the acknowledgment to repeat the price, the automatic
renewal terms and how to cancel. Lines 1 and 2 of the body are the two checkout lines, word for word
(src/config/commerce.json `checkoutLines`). The refund paragraph is Larry's text from site.ts `legal.refunds`.
Placeholders: {FIRST_CHARGE_DATE}, {NEXT_RENEWAL_DATE}, {AMOUNT_CHARGED} (price plus tax, from the Stripe invoice),
{TERMS_VERSION} (the consent record's terms_version, e.g. terms-v2).

---

**Subject:** Your Simculus membership is active: $9/month, renews monthly

**Body:**

Thanks for joining Simculus. Your membership is active.

$9/month plus applicable tax, billed today and every month after.
Renews automatically until you cancel. Cancel anytime in Account settings; you keep access through the end of the month you've paid for.

- Charged today ({FIRST_CHARGE_DATE}): {AMOUNT_CHARGED}
- Next renewal: {NEXT_RENEWAL_DATE}, then the same day each month until you cancel.

**How to cancel:** go to https://simculus.com/account, choose "Manage or cancel subscription", then choose Cancel and confirm. It's done online, with no call or email needed. Your access continues through the end of the month you've already paid for.

Refunds. You can cancel anytime online in Account settings. Cancellation stops future charges, and you keep paid access until the end of your current billing period. Because predictions are delivered as soon as they're posted, we don't refund partial months or unused time, except where the law requires. If you were charged in error or charged after you canceled, email support@simculus.com within 60 days and we'll refund that charge. If you dispute a charge with your card issuer, we may suspend paid access while it's reviewed.

You agreed to the Simculus Terms ({TERMS_VERSION}) at checkout: https://simculus.com/terms

Simulations and predictions are for information and entertainment only. They're not betting advice, and no outcome is guaranteed. 21+. If you or someone you know has a gambling problem, call 1-800-GAMBLER.

---

Open items before this can send:
1. Choose a sender (none exists in the repo) and the trigger (the Stripe webhook after billing_check=passed).
2. Use the refund paragraph only after support@simculus.com works (commerce.supportEmailActive, Larry P11).
3. The cancel steps above describe the current flow: /account, then the Stripe customer portal, then Cancel, then confirm.
