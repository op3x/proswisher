// Larry round 4 (b): closing lines and odds values must never be displayed or returned by public APIs.
// Closing lines are used only by the offline backtest (scripts/football/backtest*). This is a backstop: every JSON
// body under /api and every legacy /data file passes through scrubMarket, which drops any line/odds/market key.
export const MARKET_KEY_RE = /^(market\w*|odds\w*|closing\w*|spread_?line|total_?line|\w*money_?line\w*|vig\w*|juice|ats\w*|over_?under\w*|ou_?(line|result|grade)\w*|line_?(margin|total)\w*|bookmakers?|books?|book_?count|sportsbooks?)$/i;

export function scrubMarket(v) {
  if (Array.isArray(v)) return v.map(scrubMarket);
  if (v && typeof v === "object" && v.constructor === Object) {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!MARKET_KEY_RE.test(k)) out[k] = scrubMarket(x);
    return out;
  }
  return v;
}

/** Express middleware: wraps res.json so public API bodies never carry line/odds keys. */
export function scrubApiJson(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(scrubMarket(body));
  next();
}
