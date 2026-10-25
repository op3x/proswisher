// ─────────────────────────────────────────────────────────────────────────────
// ALL user-facing copy lives here. Switch FRAMING to re-position the product
// (e.g. "betting" → "fan") without touching components.
// Disclaimer text is VERBATIM from legal memo 17 (§2a footer, §2b page-level, §2c checkout).
// Rules from memo 17: no prizes/contests/pick'em, no profit or "make money" claims, no "lock"/"guaranteed",
// no sportsbook/affiliate links, text team names only, strictly basketball branding.
// ─────────────────────────────────────────────────────────────────────────────

export type Framing = "betting" | "fan";
export const FRAMING: Framing = "betting";

export const LEGAL_DRAFT = true; // shows a DRAFT badge on legal text until counsel signs off

const framings = {
  betting: {
    tagline: "Data-driven pro basketball predictions",
    heroTitle: "Today's picks, with the math shown.",
    heroBody:
      "Win probabilities, projected spreads and totals for every pro basketball game, from a simple model you can check yourself. Every pick is logged before tip-off and graded in public.",
    spreadLabel: "Proj. spread",
    totalLabel: "Proj. total",
  },
  fan: {
    tagline: "Pro basketball game projections",
    heroTitle: "Who wins tonight? Here's what the numbers say.",
    heroBody:
      "Projected winners and scores for every pro basketball game, from a simple, transparent model. Every projection is logged before tip-off and graded in public.",
    spreadLabel: "Proj. margin",
    totalLabel: "Proj. points",
  },
} as const;

export const site = {
  name: "ProSwisher",
  company: "Op3x LLC",
  year: 2026,
  contactEmail: "", // TODO: set a support address before launch
  ...framings[FRAMING],
  nav: [
    { to: "/", label: "Games" },
    { to: "/track-record", label: "Track record" },
    { to: "/how-it-works", label: "How it works" },
  ],
  // Memo 17 §2(a): footer, every page. VERBATIM; do not edit without counsel.
  footerDisclaimer:
    "ProSwisher is operated by Op3x LLC. All predictions, picks, odds analysis and statistics are for entertainment and information only. They are not betting, financial or legal advice. No result is guaranteed. Past performance does not predict future results. Op3x LLC is not a sportsbook, does not accept wagers and does not pay out winnings. If you choose to bet, you must be 21 or older (or the legal age where you are) and located where sports betting is legal. Check your local laws. Bet only what you can afford to lose. Gambling problem? Call 1-800-GAMBLER. ProSwisher is not affiliated with, endorsed by or sponsored by the NBA or any NBA team. Team names are used only to identify games.",
  // Memo 17 §2(b): next to each pick or prediction. VERBATIM.
  pickDisclaimer:
    "Prediction for entertainment and information only, not betting advice. No guarantee. Past results don't predict future results. 21+. 1-800-GAMBLER.",
  // Memo 17 §2(c): checkout, above the Pay button with a required checkbox. Not rendered (payments off).
  checkoutConsent:
    "I'm 21 or older. I understand ProSwisher sells sports predictions for entertainment and information only, not betting advice. Op3x LLC is not a sportsbook, accepts no wagers and guarantees no results. My $5/month subscription renews automatically until I cancel. [Cancel anytime in Account.] Refunds: [policy].",
  footerLinks: [
    { to: "/responsible-gaming", label: "Responsible gaming" },
    { to: "/terms", label: "Terms" },
    { to: "/privacy", label: "Privacy" },
  ],
  dataCredit: "Schedules and final scores come from a public scoreboard feed.",
  subscribe: {
    // Shown only if VITE_SUBSCRIBE_ENABLED=true. No checkout is wired; the button is inert.
    title: "Subscription (not available yet)",
    body: "A paid tier is planned. Nothing is for sale yet.",
    cta: "Coming soon",
  },
  empty: {
    noUpcoming: "No upcoming games in the next 7 days. Check back soon.",
    noLog: "The public log started recently. Picks appear here once their games are final.",
  },
  trackRecord: {
    title: "Public track record",
    intro:
      "Every prediction is committed to an append-only log in the public repository before tip-off, with a timestamp, and is never edited afterwards. Every logged pick is shown below, graded or not. Figures are computed from that log alone: no back-tests, no cherry-picking, no excluded games.",
    method:
      "Method: straight-up pick = the team the model gives the higher win probability. Spread and total results are graded against the model's own projected line, not a sportsbook line, and no closing-line, unit, stake or -110 vig accounting is applied yet. These are not betting returns.",
    noRecord: "No graded results yet, so no record is shown. A record appears only after logged games are final.",
  },
} as const;

export const model = {
  // Keep in sync with scripts/update_data.py
  homeCourt: 2.5,
  priorGames: 10,
  priorRegress: 0.5,
  sigma: 12,
};

// Future payments plan (memo 17 §3): standard Stripe Billing + Stripe Tax with a dedicated restricted key.
// NOT Managed Payments / Link. Checkout must be geoblocked (IP + billing ZIP) in these places.
export const payments = {
  provider: "stripe-billing-standard" as const,
  blockedUsStates: ["WA", "HI", "UT"],
  blockedCountries: ["JP"],
  priceLabel: "$5/month", // display only; no checkout wired
};

export const legal = {
  draftNotice:
    "DRAFT: legal text from counsel memo 17, pending owner approval. Terms and privacy pages are placeholders.",
  responsible: [
    "ProSwisher publishes statistical projections for entertainment and informational purposes only. Nothing on this site is betting, financial, or investment advice, and no projection is a guarantee of any outcome.",
    "ProSwisher does not accept wagers, does not operate a sportsbook, and does not link to or receive payment from any sportsbook.",
    "You must be 21 or older (or the legal age in your jurisdiction) to use this site. Sports wagering is not legal everywhere; it is your responsibility to know and follow the laws where you are.",
    "If gambling stops being fun, stop. Set limits on time and money before you start, never chase losses, and never wager money you need for essentials.",
    "If you or someone you know has a gambling problem, call or text 1-800-GAMBLER (1-800-426-2537), or visit the National Council on Problem Gambling at ncpgambling.org.",
  ],
  terms: [
    "These terms govern your use of ProSwisher, operated by Op3x LLC. By using the site you agree to them.",
    "Content is provided \"as is\" for entertainment and informational purposes only, without warranties of any kind. Projections can be and often are wrong.",
    "You are solely responsible for any decision you make, including any wager. Op3x LLC is not liable for losses arising from use of the site.",
    "You must be 21+ to use the site. Do not use the site where doing so would violate local law.",
    "ProSwisher is independent and is not affiliated with, endorsed by, or sponsored by any professional league, team, or player. Team names are used only to identify games.",
    "We may change or discontinue the site or these terms at any time.",
  ],
  privacy: [
    "ProSwisher has no accounts, no sign-ups, no cookies set by us, and no analytics or advertising trackers.",
    "Our hosting provider may keep standard server logs (such as IP address, user agent and request time) for security and operations.",
    "We do not sell or share personal information. If paid features launch, payment would be processed by a third-party payment processor and this policy will be updated first.",
    "Questions: contact Op3x LLC.",
  ],
};
