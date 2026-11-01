// ─────────────────────────────────────────────────────────────────────────────
// ALL user-facing copy lives here. Switch FRAMING to re-position the product
// (e.g. "betting" → "fan") without touching components.
// Copy source: /workspace/marketing/proswisher/landing-page-copy.md (Laye, 9:37 AM CT update, incl. Larry round 2) with Larry's
// final rulings: canonical footer (flat 21+), `disclaimers.short`, checkout consent, track-record rules, geoblocks.
// The memo 17 longer footer is retired.
// Rules from memo 17: no prizes/contests/pick'em, no profit or "make money" claims, no "lock"/"guaranteed",
// no sportsbook/affiliate links, text team names only, strictly sport-agnostic text branding (football first).
// ─────────────────────────────────────────────────────────────────────────────

import commerce from "./commerce.json";
import geo from "./geo.json";

export type Framing = "betting" | "fan";
export const FRAMING: Framing = "betting";

export const LEGAL_DRAFT = true; // shows a DRAFT badge on legal text until counsel signs off

const framings = {
  betting: {
    tagline: "NFL and college football simulations", // pivot Oct 31 (football); NBA/NCAAB slot in later via the league registry
    heroTitle: "Play the game before it's played.",
    heroBody:
      "Pick any two teams, a real upcoming game or a dream matchup, and our simulator plays it snap by snap thousands of times. You get the win probability, projected margin, total and score by quarter, then watch one simulated game drive by drive.",
    spreadLabel: "Projected spread", // predictionCard.projectedSpread
    totalLabel: "Projected total",
  },
  fan: {
    tagline: "Football game simulations",
    heroTitle: "Who wins tonight? Here's what the numbers say.",
    heroBody:
      "Simulated winners and scores for NFL and college football games, from a transparent play-by-play model built on real data.",
    spreadLabel: "Proj. margin",
    totalLabel: "Proj. points",
  },
} as const;

export const site = {
  name: __APP_NAME__, // APP_NAME env at build time, default "Simculus" (vite.config.ts)
  company: "Op3x LLC",
  // Larry memo 23 §6: the ONLY relationship wording. Phrase form: "Op3x LLC, which operates Simculus".
  operatedBy: "Simculus is operated by Op3x LLC.",
  year: 2026,
  // ── Placeholders: clearly marked, must be filled before launch ──
  supportEmail: __CONTACT_EMAIL__, // CONTACT_EMAIL env (build time), default support@simculus.com. Contact is email only.
  supportEmailActive: commerce.supportEmailActive === true, // Larry P11: support@ is HIDDEN everywhere until it works (commerce.json)
  // refund text: see legal.refunds (Larry's exact wording, 9:36)
  cancelUrl: "[CANCEL_URL TBD]",
  proofLine: "Real play-by-play data. Thousands of simulated games per matchup.",
  // Where the full, append-only pick log lives. Switch logBranch to "main" when the PR merges.
  repo: "op3x/proswisher",
  logBranch: "rebuild/lean-v1",
  meta: {
    title: `${__APP_NAME__}: NFL & College Football Game Simulations`,
    // Laye's description mentions "$9/month"; the price-free variant is used while nothing is for sale (payments off).
    description: "Simulate any NFL or college football matchup: win probability, margin, total and score by quarter, plus a play-by-play drive chart. Entertainment only. 21+.",
    descriptionWhenSelling: "Simulate any NFL or college football matchup. One featured game free every day; more sims with Pro. Entertainment only. 21+.",
    // Larry 9:36 (approved): "NBA" as plain text in game-page SEO titles, exactly this format. Never "Official", no logos.
    gamePageTitle: commerce.gamePageTitle,
    gamePageDescription: commerce.gamePageDescription,
    ogTitle: `${__APP_NAME__}: Play the game before it's played.`,
  },
  heroCta: "Run a simulation",
  heroCtaSecondary: "How it works",
  heroCtaPaid: "Get every game: $9/month", // shown only when payments are enabled
  heroPriceNote: "One game free every day, no sign-up. Every game for $9/month, renews monthly, cancel online any time.", // shown only when payments are enabled
  ageGate: {
    // Neutral click-through: no default choice, remembered for the browser session only (sessionStorage, no cookie).
    title: "You must be 21 or older to enter.",
    body: "Simculus publishes sports predictions for entertainment and information only. We're not a sportsbook and we don't accept wagers. If you choose to bet elsewhere, you must be 21+ and located where sports betting is legal.",
    confirm: "I'm 21 or older",
    deny: "I'm under 21",
    deniedMessage: "Sorry, Simculus is only for adults 21 and older.",
    help: "Gambling problem? Call 1-800-GAMBLER.",
    locationNote: "Simculus subscriptions aren't available in Washington, Hawaii, Utah or Japan.",
  },
  // Paid sign-up and checkout ONLY (Laye 9:42). Shared with the server (451 page): edit src/config/commerce.json.
  geoBlockCopy: commerce.geoBlockCopy,
  // Laye's howItWorks[0] listed rebounding/turnovers/free throws. That doesn't match the shipped model,
  // so step 1 is reworded to the actual inputs (FTC substantiation). Flagged for Laye/Larry.
  howItWorksSteps: [
    { title: "We rate every team", body: "Each morning at 4 AM CT we refresh NFL and college play-by-play data and rate every offense and defense by down, distance and field position." },
    { title: "We play it snap by snap", body: "Pick a league and any two teams. The simulator plays the game one snap at a time, thousands of times, and reports win probability, margin, total and score by quarter with ranges." },
    { title: "You watch one game unfold", body: "One representative simulated game plays out on a field drive chart, yard by yard. It's a simulation, not a forecast of the actual plays. You make your own call; we never take bets or tell you how much to wager." },
  ],
  whatYouGet: {
    title: "What you get",
    freeTitle: "Free, every day. No sign-up",
    free: [
      ["Today's featured game, in full:", "projected score, projected spread and our model's lean, right on the game page."],
      ["The public track record:", "every prediction we've posted, timestamped and graded."],
    ],
    paidTitle: "Members, $9/month",
    paid: [
      ["Every game on the slate,", "posted before kickoff."],
      ["Projected score and projected spread", "for both sides."],
      ["Our model's lean:", "which side the numbers favor, and by how much."],
      ["The why:", "the rating gap and home-court edge behind each prediction."], // Larry P7
      ["No locks. No guarantees.", "Just the model's read, plainly stated."],
      ["Cancel any time, online.", "No calls, no emails, no hoops."],
    ],
  },
  pricing: {
    price: commerce.price, // per month (Larry/Kiko). Single source: src/config/commerce.json
    priceCents: commerce.unitAmount,
    title: "One game free every day. Every game for $9/month.",
    freeName: "Free",
    freePrice: "$0",
    freeIncludes: ["Today's featured game, in full", "Public track record", "No account needed"],
    freeCta: "See today's free game",
    planName: "Simculus Monthly",
    interval: "per month, plus applicable tax",
    renewal: "Renews automatically every month until you cancel.",
    cancel: "Cancel online any time in Account settings. Your access runs through the end of the period you've paid for.",
    includes: ["Every game's projected score, projected spread and model lean", "The stats behind each prediction", "Cancel online any time"],
    cta: "Subscribe for $9/month",
    freeTier: { gamesPerDay: 1, label: "One game free every day", gatingEnabled: true, featuredBadge: "Today's free game" },
    unavailable: "Subscriptions aren't open yet. Nothing is for sale today.",
  },
  // [question, answer, onlyWhenSelling?]. Entries flagged true are hidden while payments are off
  // (they describe checkout/cancel flows that don't exist yet).
  faq: [
    // Simculus football FAQ (rewritten from NBA-era copy, 10/31). Memo 24 rules: never the word "official", no
    // betting-edge or win-rate claims, cross-era/cross-level = "For entertainment only", no real player names.
    ["What is Simculus?", "Simculus simulates football games. Pick an NFL or college matchup and we play it out snap by snap thousands of times, then show how often each team won, the typical score and margin, and one representative game you can watch on a drive chart."],
    ["Do you take bets?", "No. Simculus is not a sportsbook. Op3x LLC doesn't accept wagers, hold your money or pay out winnings."],
    ["How does a simulation work?", "Each simulated game is built play by play from team-level tendencies estimated from past seasons: how often a team runs or passes, how many yards plays tend to gain, and how drives end. We repeat the game thousands of times and summarize the results as ranges, not a single answer."],
    ["What do the numbers on the results page mean?", "Win chance is the share of simulated games each team won. The score, margin and total show the middle of the simulated results with a range around them. Quarter scores show a typical scoring shape, not a precise forecast."],
    ["Is the game I watch what will actually happen?", "No. The game on the drive chart is one simulated game picked because it lands close to the typical margin and total. It's an illustration of how a game like this can unfold, not a prediction of the actual plays."],
    ["Why don't simulated plays name any players?", "Simulated plays use position labels only. We don't use real player names, likenesses, team logos or helmets."],
    ["Which leagues do you cover?", "NFL and college football (FBS). Other sports are shown as coming soon and aren't available yet."],
    ["Where does the data come from?", "NFL data comes from nflverse and college data from CollegeFootballData.com. The full credits are listed under Data sources at the bottom of every page. Data is refreshed daily."],
    ["What does the scores bar show?", "Schedule & final scores: teams, score, quarter, clock and status. College games show final scores only."],
    ["Are you affiliated with the league or any team?", "No. Simculus is independent. Not affiliated with, endorsed or sponsored by the NFL, NCAA or any team. Team names are used only to identify games."],
    ["What is a fictional or cross-era matchup?", "You can pit teams that will never meet, such as teams from different seasons or a college team against an NFL team. Those results are labeled For entertainment only, because they can't be checked against a real game."],
    ["Who can use Simculus?", "Adults 21 and older. Subscriptions won't be available in Washington, Hawaii, Utah or Japan, though anyone 21+ can browse the public pages."],
    ["How much does it cost?", "The price and what it includes are shown on the Subscribe page before you pay, plus applicable tax. Membership renews monthly until you cancel. If the price or other terms ever change, we'll email you first, and changes apply from your first renewal at least 14 days after that email.", true],
    ["How do I cancel?", "Go to Account settings → Cancel subscription and confirm. It takes about a minute, with no call or email required. Your access continues through the end of your current billing period, and we email you a confirmation.", true],
    // HOLD (Larry 9:38): refund copy ships only once support@simculus.com works (site.supportEmailActive).
    ["Do you offer refunds?", "{refunds}", true],
    ["Do you run contests or giveaways?", "No. Simculus doesn't run contests, sweepstakes or prizes of any kind."],
    ["Should I bet based on a simulation?", "Simulations are for entertainment and information only and aren't betting advice. If you bet, set a budget, bet only what you can afford to lose, and never chase losses. If gambling stops being fun, call 1-800-GAMBLER."],
    ["Can I subscribe today?", "Not yet. Subscriptions aren't open, so nothing is for sale today. Simulations on the site are free to run for now.", false, true],
  ] as ReadonlyArray<readonly [string, string, boolean?, boolean?]>,
  // Checkout / cancel copy (Laye). Rendered on /subscribe; the form is inactive while payments are disabled.
  checkout: {
    title: "Confirm your subscription",
    summary: "Simculus Monthly: {price}/month plus applicable tax",
    // Laye's text has "at [CANCEL_URL]"; dropped until a cancel URL exists (cancel is via the Stripe customer portal).
    renewalDisclosure: commerce.renewalDisclosure,
    whatItIs: "Simculus sells sports predictions for entertainment and information only. Op3x LLC is not a sportsbook, doesn't accept wagers and doesn't hold your money or pay out winnings.",
    // Larry's EXACT text (9:36). Rendered next to an UNCHECKED checkbox (the box is UI, not copy). Swap here only.
    consentCheckbox:
      "I'm 21 or older. I understand Simculus sells sports predictions for entertainment and information only, not betting advice, and that Op3x LLC is not a sportsbook, accepts no wagers and guarantees no results. I agree that my {price}/month subscription renews automatically each month until I cancel. You can cancel anytime online in Account settings. I agree to the Terms and Privacy Policy.",
    cta: "Subscribe for {price}/month",
    consentDefaultChecked: false,
    consentRequiredError: "Please check the box to confirm before continuing.",
    // Rules: price/renewal/cancel above payment fields; don't name the provider; store consent timestamp + IP;
    // billing ZIP/country geoblock runs before any charge (geoBlockCopy.checkoutBilling).
  },
  // Laye 9:42 (Perry 9:38): featured game open in full; others show matchup, tip time and CTA ONLY (no partial numbers).
  gamePage: {
    featured: { badge: "Today's free game", note: "This one's on us, in full. No account needed.", cta: "Get every game: $9/month" },
    membersOnly: {
      matchup: "{Away} vs. {Home} · Kickoff {time} CT",
      body: "Our projected score, projected spread and model's lean for this game are for members. Today's free game is {FeaturedAway} vs. {FeaturedHome}.",
      cta: "Get every game: $9/month",
      ctaSecondary: "See today's free game",
      priceNote: "$9/month plus applicable tax, renews monthly, cancel online any time.",
    },
    paymentsOff: "Memberships aren't open yet.", // under the CTA while payments are disabled (no keys)
  },
  predictionCard: {
    projectedScore: "Projected score", lean: "Our model's lean", why: "Why the model leans this way",
    postedAt: "Posted {timestamp} CT, before kickoff · Logged in our public track record",
    freeBadge: "Today's free game",
    freeNote: "Free today, no sign-up needed.",
    lockedTeaser: "Members see every game on the slate. $9/month, cancel online any time.",
    lockedCta: "Get every game: $9/month",
    lockedUnavailable: "Memberships aren't open yet.", // shown under the disabled CTA while payments are off
    lockedLogNote: "This prediction was posted before kickoff and appears in the track record once the game starts.",
  },
  ...framings[FRAMING],
  nav: [
    { to: "/", label: "Games" },
    { to: "/simulate", label: "Simulate" },
    { to: "/how-it-works", label: "How it works" },
  ],
  // Footer, every page. Larry's canonical text (landing-page-copy.md `disclaimers.footer`), flat 21+,
  // plus Larry's ruling: "Op3x LLC does not hold your money or pay out winnings." after the wagers sentence.
  // Includes the NFL/NCAA non-affiliation line and "Op3x LLC is not a sportsbook". Do not edit without counsel.
  footerDisclaimer: commerce.disclaimers.footer, // single source: src/config/commerce.json (server block page uses it too)
  // Next to every prediction and on checkout (`disclaimers.short`).
  pickDisclaimer: commerce.disclaimers.short,
  pastResults: "Past results do not guarantee future results.",
  // Larry's order (disclaimer-footer.md §5): Track record · Terms · Privacy · Refunds* · Cancel subscription ·
  // Responsible gaming · Contact. *Refunds stays unshipped until support@ works (P11). FAQ kept at the end.
  footerLinks: [
    { to: "/terms", label: "Terms" },
    { to: "/privacy", label: "Privacy" },
    { to: "/account", label: "Cancel subscription" },
    { to: "/responsible-gaming", label: "Responsible gaming" },
    { to: "/contact", label: "Contact" },
    { to: "/faq", label: "FAQ" },
  ],
  dataCredit: "Football data refreshed daily at 4 AM CT. Simulated plays use position labels only.",
  // Ingus 10:00: required GeoLite2 attribution (MaxMind EULA). Footer, every page.
  geoCredit: "This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com",
  empty: {
    noUpcoming: "No upcoming games in the next 7 days. Check back soon.",
    noLog: "The public log started recently. Picks appear here once their games are final.",
  },
  trackRecord: {
    // The ONLY place a W-L summary may appear (Larry). Always the full log since launch.
    title: "Track record",
    intro:
      "Every Simculus prediction is timestamped before kickoff, added to this public log, and graded once the game is final. Nothing is edited or removed.",
    summaryLabel: "All predictions since launch, {startDate}–{endDate}: {W}–{L}{P}", // {P} renders "–P" only if pushes
    columns: ["Game", "Posted (CT)", "Projected score", "Projected spread", "Lean", "Market spread (source, time)", "Final", "Winner", "Against the spread"],
    gradeNames: { winner: "Winner", ats: "Against the spread" },
    summaryDisclaimer: "Past results do not guarantee future results.",
    fullLogLink: "See the full log, every prediction since launch",
    method:
      "Each prediction is graded two ways once the game is final. Winner: did the team our model favored win? Against the spread: did our lean cover the market point spread we record, with its source and time, when we post the prediction? Pushes and postponed games are shown and not counted as wins or losses. Grades are never changed after the fact.",
    // Shown while no market-spread source is configured (ODDS_API_KEY unset): ATS isn't graded.
    atsUnavailable: "Against-the-spread grades start once a licensed market-spread source is connected. Until then only the Winner grade is recorded.",
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
export const geoblock = { enabled: geo.enabled, usStates: geo.usStates, countries: geo.countries };

export const legal = {
  draftNotice:
    "DRAFT: legal text pending counsel and owner approval. Terms, privacy and refund pages are placeholders to be adapted from Larry's standard Op3x terms.",
  // Larry's exact refund text (9:36). Used by the FAQ and (later) the confirmation email. Swap here only.
  refunds:
    "Refunds. You can cancel anytime online in Account settings. Cancellation stops future charges, and you keep paid access until the end of your current billing period. Because predictions are delivered as soon as they're posted, we don't refund partial months or unused time, except where the law requires. If you were charged in error or charged after you canceled, email support@simculus.com within 60 days and we'll refund that charge. If you dispute a charge with your card issuer, we may suspend paid access while it's reviewed.",
  responsible: [
    "Simculus publishes statistical projections for entertainment and informational purposes only. Nothing on this site is betting, financial, or investment advice, and no projection is a guarantee of any outcome.",
    // Keep in sync with Terms §12. (Larry P12)
    "Simculus does not accept wagers, does not operate a sportsbook, and does not link to or receive payment from any sportsbook.",
    "You must be 21 or older to use this site. Sports wagering is not legal everywhere; it is your responsibility to know and follow the laws where you are.",
    "If gambling stops being fun, stop. Set limits on time and money before you start, never chase losses, and never wager money you need for essentials.",
    "If you or someone you know has a gambling problem, call 1-800-GAMBLER (1-800-426-2537), or visit ncpgambling.org for chat and text options.", // Larry P9
  ],
  terms: [
    "Simculus is operated by Op3x LLC. These terms govern your use of Simculus. By using the site you agree to them.",
    "Content is provided \"as is\" for entertainment and informational purposes only, without warranties of any kind. Projections can be and often are wrong.",
    "You are solely responsible for any decision you make, including any wager. Op3x LLC is not liable for losses arising from use of the site.",
    "You must be 21+ to use the site. Do not use the site where doing so would violate local law.",
    "Simculus is independent and is not affiliated with, endorsed by, or sponsored by any professional league, team, or player. Team names are used only to identify games.",
    // Larry P2: no "change at any time". Full Terms v1 (src/content/terms-v1.md) renders once support@ works.
    "We may update these Terms. Changes apply from your first renewal at least 14 days after we email you about them.",
  ],
  // Larry P4: privacy text now comes from src/content/privacy-a.md (always) and privacy-b.md (only when payments are on).
  // Counting disclosure lives in privacy-a.md / privacy-b.md (Larry memo 21 §5.1/§5.2, versions privacy-a2/b2).


};
