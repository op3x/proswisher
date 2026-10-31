// Football JSON API. Read-only, no secrets. Custom sims are capped (N, concurrency) and cached.
import { appName } from "../brand.mjs";
import { LEAGUES, ATTRIBUTION, disclaimer } from "./store.mjs";

export function registerFootballRoutes(app, { store, ticker, pipeline, env = process.env }) {
  const maxN = Number(env.FOOTBALL_SIM_MAX_N || 5000), maxConc = Number(env.FOOTBALL_SIM_CONCURRENCY || 2);
  const cache = new Map(), CACHE_MAX = 200;
  let inflight = 0;
  // Every football JSON response carries the disclaimer (betting + not affiliated with the NFL/NCAA/teams).
  app.use("/api/football", (_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (b) => json(b && typeof b === "object" && !Array.isArray(b) ? { ...b, disclaimer: disclaimer(appName(env)) } : b);
    next();
  });
  const lg = (v) => (LEAGUES.includes(String(v || "").toLowerCase()) ? String(v).toLowerCase() : null);
  const noStore = (res) => res.set("Cache-Control", "no-store");
  const withPlays = (req, r) => (req.query.plays === "0" && r?.representative ? { ...r, representative: { ...r.representative, plays: undefined } } : r);

  app.get("/api/football/status", (_req, res) => {
    noStore(res).json({ app: appName(env), data: store.status(), refresh: pipeline?.status() || null, ticker: ticker?.snapshot().sources || null,
      leagues: Object.fromEntries(LEAGUES.map((l) => [l, { ready: store.ready(l), season: store.data[l]?.ratings?.season ?? null, asOfWeek: store.data[l]?.ratings?.asOfWeek ?? null }])) });
  });

  app.get("/api/football/teams", (req, res) => {
    const l = lg(req.query.league || "nfl"); if (!l) return res.status(400).json({ error: "league must be nfl or ncaaf" });
    const r = store.data[l]?.ratings; if (!r) return res.status(503).json({ error: `${l} ratings not available yet`, hint: l === "ncaaf" ? "needs CFBD_API_KEY" : "daily refresh has not run yet" });
    res.set("Cache-Control", "public, max-age=300").json({ league: l, season: r.season, asOfWeek: r.asOfWeek, generatedAt: r.generatedAt, method: r.method, model: r.model,
      teams: r.teams, historySeasons: Object.keys(store.data[l]?.history?.seasons || {}), attribution: ATTRIBUTION[l] });
  });

  app.get("/api/football/games", (req, res) => {
    const l = lg(req.query.league || "nfl"); if (!l) return res.status(400).json({ error: "league must be nfl or ncaaf" });
    let g = store.games(l);
    if (req.query.week) g = g.filter((x) => x.week === Number(req.query.week));
    if (req.query.status) g = g.filter((x) => x.status === req.query.status);
    if (req.query.upcoming === "1") g = g.filter((x) => x.status !== "final");
    res.set("Cache-Control", "public, max-age=120").json({ league: l, season: store.data[l]?.schedule?.season ?? null, games: g, attribution: ATTRIBUTION[l] });
  });

  app.get("/api/football/games/:id/sim", (req, res) => {
    const r = store.gameSim(req.params.id);
    if (!r) return res.status(404).json({ error: "game not found" });
    if (r.error) return res.status(503).json(r);
    res.set("Cache-Control", "public, max-age=300").json(withPlays(req, r));
  });

  // The representative simulated game's play-by-play log (for the future animated view).
  app.get("/api/football/games/:id/plays", (req, res) => {
    const r = store.gameSim(req.params.id);
    if (!r) return res.status(404).json({ error: "game not found" });
    if (r.error) return res.status(503).json(r);
    res.set("Cache-Control", "public, max-age=300").json({ game: r.game, teams: r.teams, label: "One simulated game chosen as closest to the median margin and total; not a forecast of the actual plays.",
      fields: r.playLogFields, ...r.representative });
  });

  app.get("/api/football/sim", (req, res) => {
    const q = req.query;
    const league = lg(q.league || "nfl");
    const hl = lg(q.homeLeague || league), al = lg(q.awayLeague || league);
    if (!hl || !al) return res.status(400).json({ error: "league must be nfl or ncaaf" });
    if (!q.home || !q.away) return res.status(400).json({ error: "home and away are required (team abbreviation for NFL, school name for NCAAF)" });
    const season = (v) => (v == null || v === "" ? undefined : /^\d{4}$/.test(String(v)) ? Number(v) : NaN);
    const hs = season(q.homeSeason), as = season(q.awaySeason);
    if (Number.isNaN(hs) || Number.isNaN(as)) return res.status(400).json({ error: "homeSeason/awaySeason must be a 4-digit year" });
    const n = Math.max(100, Math.min(maxN, Number(q.n) || 2000));
    const seed = Number.isFinite(Number(q.seed)) ? Number(q.seed) >>> 0 : 20261031;
    const neutral = q.neutral === "1" || q.neutral === "true";
    const key = JSON.stringify([hl, q.home, hs, al, q.away, as, neutral, n, seed]);
    if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return res.set("Cache-Control", "public, max-age=300").json(withPlays(req, v)); }
    const m = store.matchup({ league: hl, team: String(q.home), season: hs }, { league: al, team: String(q.away), season: as }, { neutral });
    if (m.error) return res.status(404).json(m);
    if (inflight >= maxConc) return res.status(503).set("Retry-After", "2").json({ error: "simulator busy, try again in a moment" });
    inflight++;
    try {
      const r = store.simulate(m, { n, seed });
      if (r.error) return res.status(503).json(r);
      cache.set(key, r); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      res.set("Cache-Control", "public, max-age=300").json(withPlays(req, r));
    } finally { inflight--; }
  });

  app.get("/api/football/ticker", (_req, res) => {
    if (!ticker) return res.status(503).json({ error: "ticker not running" });
    res.set("Cache-Control", "public, max-age=15").json(ticker.snapshot());
  });
}
