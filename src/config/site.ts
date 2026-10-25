// ─────────────────────────────────────────────────────────────────────────────
// ALL user-facing copy lives here. Switch FRAMING to re-position the product
// (e.g. "betting" → "fan") without touching components.
// Copy source: /workspace/marketing/proswisher/landing-page-copy.md (Laye, 9:28 AM CT update) with Larry's
// final rulings: canonical footer (flat 21+), `disclaimers.short`, checkout consent, track-record rules, geoblocks.
// The memo 17 longer footer is retired.
// Rules from memo 17: no prizes/contests/pick'em, no profit or "make money" claims, no "lock"/"guaranteed",
// no sportsbook/affiliate links, text team names only, strictly basketball branding.
// ─────────────────────────────────────────────────────────────────────────────

export type Framing = "betting" | "fan";
export const FRAMING: Framing = "betting";

export const LEGAL_DRAFT = true; // shows a DRAFT badge on legal text until counsel signs off

const framings = {
  betting: {
    tagline: "Pro basketball predictions", // hero.eyebrow (Laye)
    heroTitle: "Nothing but numbers.", // hero.title (Laye)
    heroBody:
      "A projected score, projected spread and our model's lean for every game on the slate, built on team performance data, posted before tip-off and graded in public afterward.", // hero.subhead (Laye)
    spreadLabel: "Projected spread", // predictionCard.projectedSpread
    totalLabel: "Projected total",
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
  // ── Placeholders: clearly marked, must be filled before launch ──
  supportEmail: "support@proswisher.com",
  supportEmailActive: false, // no MX on proswisher.com yet; UI shows "(not yet active)"
  mailingAddress: "[MAILING ADDRESS TBD]",
  refundPolicy: "[REFUND POLICY TBD]", // Larry/Kiko to decide
  cancelUrl: "[CANCEL_URL TBD]",
  proofLine: "Logged before tip-off. Graded in public.",
  // Where the full, append-only pick log lives. Switch logBranch to "main" when the PR merges.
  repo: "op3x/proswisher",
  logBranch: "rebuild/lean-v1",
  meta: {
    title: "ProSwisher: Pro Basketball Game Predictions",
    // Laye's description mentions "$9/month"; the price-free variant is used while nothing is for sale (payments off).
    description: "Projected scores, projected spreads and our model's lean for pro basketball games. Entertainment only. 21+.",
    descriptionWhenSelling: "Projected scores, projected spreads and our model's lean for pro basketball games. One game free every day; every game for $9/month. Entertainment only. 21+.",
    // "NBA" in game-page SEO titles only, to identify the game: Kiko OK, PENDING Larry. Not used in this build.
    gamePageTitle: "{Away} vs {Home} Prediction: NBA, {date} | ProSwisher",
    ogTitle: "ProSwisher: Nothing but numbers.",
  },
  heroCta: "Get today's free prediction",
  heroCtaSecondary: "How it works",
  heroCtaPaid: "Unlock every game: $9/month", // shown only when the subscribe flag is on
  heroPriceNote: "One game free every day. Every game for $9/month, renews monthly, cancel online any time.", // flag-gated
  ageGate: {
    // Neutral click-through: no default choice, remembered for the browser session only (sessionStorage, no cookie).
    title: "You must be 21 or older to enter.",
    body: "ProSwisher publishes sports predictions for entertainment and information only. We're not a sportsbook and we don't accept wagers. If you choose to bet elsewhere, you must be 21+ and located where sports betting is legal.",
    confirm: "I'm 21 or older",
    deny: "I'm under 21",
    deniedMessage: "Sorry, ProSwisher is only for adults 21 and older.",
    help: "Gambling problem? Call 1-800-GAMBLER.",
    locationNote: "ProSwisher isn't available in Washington, Hawaii, Utah or Japan.",
  },
  geoBlockCopy: {
    title: "ProSwisher isn't available in your location",
    body: "Sorry, ProSwisher isn't offered in Washington, Hawaii, Utah or Japan, so we can't show predictions or take subscriptions there.",
    checkoutBilling: "Sorry, we can't accept subscriptions with a billing address in Washington, Hawaii, Utah or Japan. You haven't been charged.",
    help: "Questions? Email support@proswisher.com. Gambling problem? Call 1-800-GAMBLER.",
  },
  // Laye's howItWorks[0] listed rebounding/turnovers/free throws. That doesn't match the shipped model,
  // so step 1 is reworded to the actual inputs (FTC substantiation). Flagged for Laye/Larry.
  howItWorksSteps: [
    { title: "We crunch the matchups", body: "Our model rates every team on its scoring margin this season, blended with last season's, then adds home-court advantage. The full formula is public." },
    { title: "You get one clear read", body: "Every prediction shows a projected score, a projected spread and our model's lean. One game is free every day; members get the full slate." },
    { title: "We post it, then grade it, in public", body: "Every prediction is timestamped before tip-off and added to our public log, and it's graded once the game is final. Nothing gets edited or removed. You make your own call; we never take bets or tell you how much to wager." },
  ],
  whatYouGet: {
    title: "What you get",
    freeTitle: "Free, every day",
    free: [
      ["One game's full prediction:", "projected score, projected spread and our model's lean."],
      ["The public track record:", "every prediction we've posted, timestamped and graded."],
    ],
    paidTitle: "Members, $9/month",
    paid: [
      ["Every game on the slate,", "posted before tip-off."],
      ["Projected score and projected spread", "for both sides."],
      ["Our model's lean:", "which side the numbers favor, and by how much."],
      ["The why:", "the key stat gaps behind every prediction."],
      ["No locks, no tout talk.", "Just the model's read, plainly stated."],
      ["Cancel any time, online.", "No calls, no emails, no hoops."],
    ],
  },
  pricing: {
    price: "$9", // per month (Larry/Kiko). Single source; templates use {price}.
    priceCents: 900,
    title: "Start free. Upgrade for the full slate.",
    freeName: "Free",
    freePrice: "$0",
    freeIncludes: ["One game's prediction every day", "Public track record"],
    freeCta: "Get today's free prediction",
    planName: "ProSwisher Monthly",
    interval: "per month, plus applicable tax",
    renewal: "Renews automatically every month until you cancel.",
    cancel: "Cancel online any time in Account settings. Your access runs through the end of the period you've paid for.",
    includes: ["Every game's projected score, projected spread and model lean", "The stats behind each prediction", "Cancel online any time"],
    cta: "Subscribe for $9/month",
    freeTier: { gamesPerDay: 1, label: "One game free every day" },
    unavailable: "Subscriptions aren't open yet. Nothing is for sale today.",
  },
  // [question, answer, onlyWhenSelling?]. Entries flagged true are hidden while payments are off
  // (they describe checkout/cancel flows that don't exist yet).
  faq: [
    ["Do you take bets?", "No. ProSwisher is not a sportsbook. Op3x LLC doesn't accept wagers, hold your money or pay out winnings. We sell predictions only."],
    ["What exactly is a ProSwisher prediction?", "For each game, our model gives a projected final score, a projected spread and its lean, meaning the side the numbers favor. It's information to consider, not advice to bet."],
    ["What's free, and what do members get?", "Everyone gets one game's full prediction free every day, plus the public track record. Members ($9/month) get every game on the slate.", true],
    ["How have your predictions done?", "See our Track record page. Every prediction we've posted since launch is timestamped before tip-off and graded afterward, with nothing removed. No prediction is guaranteed, and past results do not guarantee future results."],
    // Laye asked Perry to confirm source wording: this is the accurate version for the shipped model.
    ["Where does the data come from?", "We build predictions from publicly available game results: schedules and final scores from a public scoreboard feed, turned into team scoring-margin ratings."],
    ["Are you affiliated with the league or any team?", "No. ProSwisher is independent and isn't affiliated with or endorsed by the NBA, its teams or players. Team names are used only to identify games."],
    ["Who can use ProSwisher?", "Adults 21 and older. ProSwisher isn't available in Washington, Hawaii, Utah or Japan."],
    ["How much does it cost?", "The daily free prediction costs nothing. Membership is $9 a month plus applicable tax and renews monthly until you cancel. If the price ever changes, we'll email you at least 7 days before it applies to you.", true],
    ["How do I cancel?", "Go to Account settings → Cancel subscription and confirm. It takes about a minute, with no call or email required. Your access continues through the end of your current billing period, and we email you a confirmation.", true],
    ["Do you offer refunds?", "[REFUND_POLICY: to be adapted from Larry's standard Op3x terms]", true],
    ["Do you run contests or giveaways?", "No. ProSwisher doesn't run contests, sweepstakes or prizes of any kind."],
    ["Should I bet based on your predictions?", "That's your decision. Our predictions are for entertainment and information only and aren't betting advice. If you bet, set a budget, bet only what you can afford to lose, and never chase losses. If gambling stops being fun, call 1-800-GAMBLER."],
    ["Do you send a daily email?", "Not yet. For now, find each day's predictions on the site."],
    ["Can I subscribe today?", "Not yet. Subscriptions aren't open, so nothing is for sale today. Every prediction on the site is free to view for now.", false, true],
  ] as ReadonlyArray<readonly [string, string, boolean?, boolean?]>,
  // Checkout / cancel copy (Laye) kept for later. NOT rendered: payments are disabled.
  checkout: {
    title: "Confirm your subscription",
    summary: "ProSwisher Monthly: {price}/month plus applicable tax",
    renewalDisclosure: "You'll be charged {price} today and {price} every month after that until you cancel. Cancel online any time at [CANCEL_URL] or in Account settings. Cancellation takes effect at the end of your current billing period.",
    whatItIs: "ProSwisher sells sports predictions for entertainment and information only. Op3x LLC is not a sportsbook, doesn't accept wagers and doesn't hold your money or pay out winnings.",
    // VERBATIM from Laye's 9:28 checkout.consentLabel (Larry ruling: cancel sentence before "and I agree to the Terms";
    // Laye joined with a comma, Larry to confirm). Unchecked by default; CTA disabled until checked.
    consentCheckbox:
      "I'm 21 or older. I understand ProSwisher sells sports predictions for entertainment and information only, not betting advice. Op3x LLC is not a sportsbook, accepts no wagers and guarantees no results. My {price}/month subscription renews automatically until I cancel. You can cancel anytime online in Account settings, and I agree to the [Terms] and [Privacy Policy] and authorize Op3x LLC to charge my payment method {price} each month until I cancel. Refunds: [REFUND_POLICY].",
    cta: "Subscribe for {price}/month",
    consentDefaultChecked: false,
    consentRequiredError: "Please check the box to confirm before continuing.",
    // Rules: price/renewal/cancel above payment fields; don't name the provider; store consent timestamp + IP;
    // billing ZIP/country geoblock runs before any charge (geoBlockCopy.checkoutBilling).
  },
  predictionCard: {
    projectedScore: "Projected score", lean: "Our model's lean", why: "Why the model leans this way",
    postedAt: "Posted {timestamp} CT, before tip-off · Logged in our public track record",
    freeBadge: "Today's free game",
    lockedTeaser: "Members see every game on the slate. $9/month, cancel online any time.",
  },
  ...framings[FRAMING],
  nav: [
    { to: "/", label: "Predictions" },
    { to: "/track-record", label: "Track record" },
    { to: "/how-it-works", label: "How it works" },
  ],
  // Footer, every page. Larry's canonical text (landing-page-copy.md `disclaimers.footer`), flat 21+,
  // plus Larry's ruling: "Op3x LLC does not hold your money or pay out winnings." after the wagers sentence.
  // Includes the NBA non-affiliation line and "Op3x LLC is not a sportsbook". Do not edit without counsel.
  footerDisclaimer:
    "ProSwisher provides sports predictions for entertainment and informational purposes only. It is not betting, financial or legal advice, and no outcome is guaranteed. Past results do not guarantee future results. Op3x LLC is not a sportsbook and does not accept wagers. Op3x LLC does not hold your money or pay out winnings. You must be 21+ and located where sports betting is legal to place bets; check your local laws. If you or someone you know has a gambling problem, call 1-800-GAMBLER. ProSwisher is not affiliated with or endorsed by the NBA, its teams or players.",
  // Next to every prediction and on checkout (`disclaimers.short`).
  pickDisclaimer: "Entertainment only. Not betting advice. 21+. 1-800-GAMBLER.",
  pastResults: "Past results do not guarantee future results.",
  footerLinks: [
    { to: "/responsible-gaming", label: "Responsible gaming" },
    { to: "/terms", label: "Terms" },
    { to: "/privacy", label: "Privacy" },
    { to: "/faq", label: "FAQ" },
  ],
  dataCredit: "Schedules and final scores come from a public scoreboard feed.",
  empty: {
    noUpcoming: "No upcoming games in the next 7 days. Check back soon.",
    noLog: "The public log started recently. Picks appear here once their games are final.",
  },
  trackRecord: {
    // The ONLY place a W-L summary may appear (Larry). Always the full log since launch.
    title: "Track record",
    intro:
      "Every ProSwisher prediction is timestamped before tip-off, added to this public log, and graded once the game is final. Nothing is edited or removed.",
    summaryLabel: "All predictions since launch, {startDate}–{endDate}:",
    summaryDisclaimer: "Past results do not guarantee future results.",
    fullLogLink: "See the full log, every prediction since launch",
    method:
      "How we grade (Larry to approve): straight-up pick = the team the model gives the higher win probability. Spread and total results are graded against the model's own projected line, not a sportsbook line, and no closing-line, unit, stake or -110 vig accounting is applied yet. These are not betting returns.",
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
  provider: "stripe-billing-standard" as const, // standard Billing + Stripe Tax, dedicated restricted key; NOT Managed Payments
};

// Checkout geoblock (memo 17 §3 + Larry's ruling). ON by default. Checked by IP geolocation AND billing ZIP/country.
export const geoblock = {
  enabled: true,
  usStates: ["WA", "HI", "UT"],
  countries: ["JP"],
};

export const legal = {
  draftNotice:
    "DRAFT: legal text pending counsel and owner approval. Terms, privacy and refund pages are placeholders to be adapted from Larry's standard Op3x terms.",
  responsible: [
    "ProSwisher publishes statistical projections for entertainment and informational purposes only. Nothing on this site is betting, financial, or investment advice, and no projection is a guarantee of any outcome.",
    "ProSwisher does not accept wagers, does not operate a sportsbook, and does not link to or receive payment from any sportsbook.",
    "You must be 21 or older to use this site. Sports wagering is not legal everywhere; it is your responsibility to know and follow the laws where you are.",
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
    "Questions: support@proswisher.com (not yet active). Mailing address: [MAILING ADDRESS TBD].",
  ],
};
