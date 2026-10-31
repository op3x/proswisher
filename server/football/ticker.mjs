// Light live-score ticker. Polls ONLY while a game is in its window (kickoff-15 min .. kickoff+5 h, not final).
//  NFL : balldontlie NFL /games (free tier: real-time scores for in-progress games, 5 req/min shared with the legacy
//        NBA pipeline) every FOOTBALL_TICKER_NFL_SEC (default 120 s) when BALLDONTLIE_API_KEY is set; otherwise the
//        nflverse schedules file (finals only) via conditional GET every 10 min.
//  NCAAF: no free live source exists (CFBD /scoreboard is a paid tier; balldontlie NCAAF is paid). With CFBD_API_KEY we
//        poll CFBD /games for the current week every FOOTBALL_TICKER_NCAAF_MIN (default 60) min, counted against the
//        same monthly CFBD budget as the daily refresh. Scores there are final/near-final, not live.
// A 401/403, or a 429 twice in a row, STOPS that source until the next deploy. Never routed around.
import fs from "node:fs";
import path from "node:path";

export const BDL_ALIASES = { WSH: "WAS", LAR: "LA", JAC: "JAX", OAK: "LV", SD: "LAC", STL: "LA" };
const WINDOW_BEFORE = 15 * 60e3, WINDOW_AFTER = 5 * 3600e3;

export function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...rest] = rows;
  return rest.filter((r) => r.length === h.length).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

export function inWindow(g, now) {
  if (g.status === "final" || !g.kickoff) return false;
  const k = Date.parse(g.kickoff);
  return now >= k - WINDOW_BEFORE && now <= k + WINDOW_AFTER;
}

export function createTicker({ store, env = process.env, privateDir = "", fetchImpl = globalThis.fetch, log = console.log, now = () => Date.now() } = {}) {
  const live = new Map(); // game id -> override {homeScore, awayScore, status, detail, source, at}
  const src = {
    balldontlie: { blocked: null, last: 0, strikes: 0, every: Number(env.FOOTBALL_TICKER_NFL_SEC || 120) * 1000 },
    nflverse: { blocked: null, last: 0, strikes: 0, every: 10 * 60e3, etag: null },
    cfbd: { blocked: null, last: 0, strikes: 0, every: Number(env.FOOTBALL_TICKER_NCAAF_MIN || 60) * 60e3 },
  };
  let timer = null;

  async function get(name, url, headers = {}) {
    const s = src[name];
    const r = await fetchImpl(url, { headers: { "User-Agent": "proswisher-ticker/1.0", ...headers } });
    if (r.status === 401 || r.status === 403) { s.blocked = `HTTP ${r.status}`; log(`[ticker] STOPPED ${name}: HTTP ${r.status} (refused). Not retrying another way until the next deploy.`); return null; }
    if (r.status === 429) {
      s.strikes += 1;
      if (s.strikes >= 2) { s.blocked = "HTTP 429 twice"; log(`[ticker] STOPPED ${name}: rate-limited twice in a row. Not retrying until the next deploy.`); }
      else { s.last = now() + s.every; log(`[ticker] ${name} rate-limited (429); backing off`); }
      return null;
    }
    s.strikes = 0;
    return r;
  }

  const due = (name) => !src[name].blocked && now() - src[name].last >= src[name].every;

  function cfbdBudgetOk() {
    const f = privateDir && path.join(privateDir, "football", "cfbd-budget.json");
    if (!f) return false;
    const month = new Date(now()).toISOString().slice(0, 7), budget = Number(env.CFBD_MONTHLY_BUDGET || 800);
    let d = {}; try { d = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    if (d.month !== month) d = { month, calls: 0 };
    if (d.calls >= budget) return false;
    d.calls += 1; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d));
    return true;
  }

  async function pollNfl(active) {
    if (env.BALLDONTLIE_API_KEY) {
      if (!due("balldontlie")) return;
      src.balldontlie.last = now();
      const dates = [...new Set(active.map((g) => new Date(Date.parse(g.kickoff) - 5 * 3600e3).toISOString().slice(0, 10)))];
      const qs = dates.map((d) => `dates[]=${d}`).join("&") + "&per_page=100";
      const r = await get("balldontlie", `https://api.balldontlie.io/nfl/v1/games?${qs}`, { Authorization: env.BALLDONTLIE_API_KEY });
      if (!r || !r.ok) return;
      const body = await r.json();
      for (const x of body.data || []) {
        const h = BDL_ALIASES[x.home_team?.abbreviation] || x.home_team?.abbreviation, a = BDL_ALIASES[x.visitor_team?.abbreviation] || x.visitor_team?.abbreviation;
        const g = active.find((y) => y.home === h && y.away === a) || store.games("nfl").find((y) => y.home === h && y.away === a && Math.abs(Date.parse(y.kickoff) - Date.parse(x.date)) < 36 * 3600e3);
        if (!g) continue;
        const st = x.status_state === "final" ? "final" : x.status_state === "in_progress" ? "live" : x.status_state || "scheduled";
        live.set(g.id, { homeScore: x.home_team_score ?? null, awayScore: x.visitor_team_score ?? null, status: st, detail: x.status || null, source: "balldontlie", at: new Date(now()).toISOString() });
      }
      return;
    }
    if (!due("nflverse")) return;
    src.nflverse.last = now();
    const r = await get("nflverse", "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv", src.nflverse.etag ? { "If-None-Match": src.nflverse.etag } : {});
    if (!r || r.status === 304 || !r.ok) return;
    src.nflverse.etag = r.headers.get("etag");
    const rows = parseCsv(await r.text());
    for (const g of active) {
      const x = rows.find((y) => y.game_id === g.id);
      if (x && x.home_score !== "" && x.home_score !== "NA") live.set(g.id, { homeScore: Number(x.home_score), awayScore: Number(x.away_score), status: "final", detail: "Final", source: "nflverse", at: new Date(now()).toISOString() });
    }
  }

  async function pollNcaaf(active) {
    if (!env.CFBD_API_KEY || !due("cfbd")) return;
    src.cfbd.last = now();
    const wk = active[0];
    if (!cfbdBudgetOk()) { log("[ticker] CFBD monthly budget reached; NCAAF ticker paused until next month"); return; }
    const st = wk.seasonType || (wk.playoff ? "postseason" : "regular"), week = st === "postseason" ? wk.week - 16 : wk.week;
    const r = await get("cfbd", `https://api.collegefootballdata.com/games?year=${wk.season}&week=${week}&seasonType=${st}&classification=fbs`, { Authorization: `Bearer ${env.CFBD_API_KEY}`, Accept: "application/json" });
    if (!r || !r.ok) return;
    for (const x of await r.json()) {
      const g = active.find((y) => y.id === String(x.id));
      if (g && x.homePoints != null) live.set(g.id, { homeScore: x.homePoints, awayScore: x.awayPoints, status: x.completed ? "final" : "live", detail: x.completed ? "Final" : "In progress (delayed)", source: "cfbd", at: new Date(now()).toISOString() });
    }
  }

  async function tick() {
    const t = now();
    for (const [lg, fn] of [["nfl", pollNfl], ["ncaaf", pollNcaaf]]) {
      const active = store.games(lg).filter((g) => inWindow(g, t) && live.get(g.id)?.status !== "final");
      if (!active.length) continue;
      try { await fn(active); } catch (e) { log(`[ticker] ${lg} poll failed (${e.name}); will retry next interval`); }
    }
  }

  function snapshot() {
    const t = now(), out = [];
    for (const lg of ["nfl", "ncaaf"]) {
      for (const g of store.games(lg)) {
        const k = Date.parse(g.kickoff || 0);
        if (!(k > t - 36 * 3600e3 && k < t + 36 * 3600e3)) continue;
        const o = live.get(g.id) || {};
        out.push({ league: lg, id: g.id, kickoff: g.kickoff, home: g.home, away: g.away, homeName: g.homeName, awayName: g.awayName,
          homeScore: o.homeScore ?? g.homeScore ?? null, awayScore: o.awayScore ?? g.awayScore ?? null,
          status: o.status || g.status, detail: o.detail || null, source: o.source || "daily refresh", updatedAt: o.at || null });
      }
    }
    out.sort((a, b) => (a.kickoff < b.kickoff ? -1 : 1));
    return { games: out, sources: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, { blocked: v.blocked, lastPoll: v.last ? new Date(Math.min(v.last, now())).toISOString() : null }])),
             notes: ["NFL live scores need BALLDONTLIE_API_KEY; without it NFL shows finals from nflverse only.", "NCAAF: no free live source; scores update at most hourly from CFBD when CFBD_API_KEY is set."] };
  }

  function start() {
    if (/^(0|false|no|off)$/i.test(String(env.FOOTBALL_TICKER_ENABLED ?? "true"))) { log("[ticker] disabled (FOOTBALL_TICKER_ENABLED=false)"); return; }
    timer = setInterval(tick, 30e3); timer.unref?.();
    log(`[ticker] on: NFL via ${env.BALLDONTLIE_API_KEY ? "balldontlie (live)" : "nflverse (finals only; set BALLDONTLIE_API_KEY for live)"}; NCAAF ${env.CFBD_API_KEY ? "via CFBD (hourly, not live)" : "off (no CFBD_API_KEY)"}`);
  }
  return { tick, snapshot, start, stop: () => clearInterval(timer), sources: src, live };
}
