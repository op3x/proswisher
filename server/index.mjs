// ProSwisher server: serves the static build, /health, cookieless counting, and (only when fully configured)
// Stripe Billing test-mode checkout. Runs with NO keys at all: payments then report disabled.
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clientIp, geoipDecision, openGeoip, isBlocked, geoConfig, GEOIP_PATH } from "./geo.mjs";
import { paymentsMode, makeStripe, verifyPrice, handleCheckoutCompleted } from "./payments.mjs";
import { createCounter } from "./counter.mjs";
import { fetchGeoip } from "../scripts/fetch-geoip.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function createApp({ env = process.env, stripe: stripeOverride, geoLookup, counter = createCounter(), dist = path.join(ROOT, "dist"), log = console.log } = {}) {
  const app = express();
  app.disable("x-powered-by");
  const commerce = JSON.parse(fs.readFileSync(path.join(ROOT, "src/config/commerce.json"), "utf8"));
  const state = { geo: geoLookup === undefined ? await openGeoip() : geoLookup, revoked: new Set() };
  let mode = paymentsMode(env);
  const stripe = mode.enabled ? (stripeOverride || makeStripe(mode)) : null;
  if (mode.enabled && !stripeOverride) {
    try {
      const problems = await verifyPrice(stripe, mode, commerce);
      if (problems.length) mode = { enabled: false, reason: "STRIPE_PRICE_ID check failed: " + problems.join("; ") };
    } catch (e) { mode = { enabled: false, reason: `STRIPE_PRICE_ID check failed (${e.type || e.name})` }; }
  }
  log(`[pay] payments ${mode.enabled ? "ENABLED (" + (mode.livemode ? "live" : "test") + " mode)" : "disabled: " + mode.reason}`);
  const base = env.PUBLIC_BASE_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:" + (env.PORT || 3000));

  // featured game per CT day = earliest tip-off, ties by id (same rule as src/lib/access.ts)
  let featured = new Set(), games = {}, gamesAt = 0;
  const loadGames = () => {
    if (Date.now() - gamesAt < 120000) return;
    gamesAt = Date.now();
    try {
      games = JSON.parse(fs.readFileSync(path.join(dist, "data/games.json"), "utf8")).games || {};
      const best = new Map();
      for (const g of Object.values(games)) {
        const d = new Date(g.date).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }), c = best.get(d);
        if (!c || g.date < c.date || (g.date === c.date && g.id < c.id)) best.set(d, g);
      }
      featured = new Set([...best.values()].map((g) => g.id));
    } catch { /* no data yet */ }
  };

  const geoGate = (req) => {
    const d = geoipDecision(state.geo, clientIp(req));
    if (d.blocked) log(`[geo] 451 on ${req.path} (country=${d.country} region=${d.region || "-"})`);
    return d;
  };
  const blockPage = () => {
    const c = commerce.geoBlockCopy;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${c.title} | ProSwisher</title>
<style>body{margin:0;background:#0b0f17;color:#e2e8f0;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}main{max-width:32rem;padding:2rem}a{color:#22d3ee}small{color:#94a3b8}</style></head>
<body><main><h1>${c.title}</h1><p>${c.body}</p><p><a href="/">Browse predictions</a> · <a href="/track-record">Track record</a></p><small>${c.help}</small></main></body></html>`;
  };

  // ---- never geo-checked ----
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    if (!mode.enabled) return res.status(404).end();
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], mode.webhookSecret); }
    catch { return res.status(400).send("bad signature"); }
    try {
      if (event.type === "checkout.session.completed") {
        const r = await handleCheckoutCompleted(stripe, event.data.object, state.revoked, log);
        return res.json({ received: true, ...r });
      }
      return res.json({ received: true });
    } catch (e) { log(`[pay] webhook handler error (${e.type || e.name})`); return res.status(500).end(); }
  });

  app.use(express.json({ limit: "16kb" }));

  // ---- counting (no cookies; nothing raw stored) ----
  app.post("/api/v", (req, res) => {
    loadGames();
    const p = String(req.body?.p || "");
    const m = p.match(/^\/game\/([\w-]+)$/);
    counter.visit(clientIp(req), req.headers["user-agent"], { featuredView: !!(m && featured.has(m[1])) });
    res.status(204).end();
  });
  app.get("/go/subscribe", (_req, res) => { counter.click(); res.redirect(302, "/subscribe"); });
  app.get("/admin/stats", (req, res) => {
    const tok = env.ADMIN_TOKEN || "";
    if (!tok) return res.status(404).end(); // disabled when unset
    const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const a = crypto.createHash("sha256").update(got).digest(), b = crypto.createHash("sha256").update(tok).digest();
    if (!got || !crypto.timingSafeEqual(a, b)) return res.status(401).end();
    res.set("Cache-Control", "no-store").json(counter.report());
  });

  // ---- payments ----
  app.get("/api/config", (_req, res) => res.json({ payments: { enabled: mode.enabled, reason: mode.enabled ? null : "disabled" }, geoblock: geoConfig }));
  app.post("/api/checkout", async (req, res) => {
    if (geoGate(req).blocked) return res.status(451).json({ error: "geoblocked", ...commerce.geoBlockCopy });
    if (!mode.enabled) return res.status(503).json({ error: "payments_disabled" });
    const b = req.body || {};
    if (b.consent !== true) return res.status(400).json({ error: "consent_required" });
    const country = String(b.country || "").toUpperCase(), st = String(b.state || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country) || (country === "US" && !/^[A-Z]{2}$/.test(st))) return res.status(400).json({ error: "billing_location_required" });
    if (isBlocked(country, country === "US" ? st : null)) {
      log(`[geo] 451 declared billing (country=${country} state=${st || "-"})`);
      return res.status(451).json({ error: "geoblocked", ...commerce.geoBlockCopy });
    }
    const g = geoipDecision(state.geo, clientIp(req));
    const meta = {
      consent_at: new Date().toISOString(), consent_version: commerce.consentVersion,
      declared_country: country, declared_state: st, ip_country: g.country || "", ip_region: g.region || "",
    };
    try {
      const s = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: mode.priceId, quantity: 1 }],
        billing_address_collection: "required",
        success_url: `${base}/account?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/subscribe`,
        custom_text: { submit: { message: commerce.renewalDisclosure.slice(0, 1200) } },
        automatic_tax: { enabled: env.STRIPE_AUTOMATIC_TAX === "true" },
        metadata: meta, subscription_data: { metadata: meta },
      });
      res.json({ url: s.url });
    } catch (e) { log(`[pay] checkout create failed (${e.type || e.name})`); res.status(502).json({ error: "checkout_failed" }); }
  });
  const sessionSub = async (sid) => {
    if (!/^cs_(test|live)_[\w]+$/.test(sid)) return null;
    const s = await stripe.checkout.sessions.retrieve(sid, { expand: ["subscription"] });
    return s;
  };
  app.get("/api/me", async (req, res) => {
    if (!mode.enabled) return res.json({ subscriber: false, payments: false });
    try {
      const s = await sessionSub(String(req.query.session_id || ""));
      const sub = s?.subscription;
      const ok = !!(s && s.status === "complete" && sub && ["active", "trialing"].includes(sub.status) && !state.revoked.has(sub.id) && !state.revoked.has(s.id));
      res.set("Cache-Control", "no-store").json({ subscriber: ok, status: sub?.status || null, cancelAt: sub?.cancel_at || null });
    } catch { res.json({ subscriber: false }); }
  });
  app.post("/api/portal", async (req, res) => {
    if (!mode.enabled) return res.status(503).json({ error: "payments_disabled" });
    try {
      const s = await sessionSub(String(req.body?.session_id || ""));
      if (!s?.customer) return res.status(404).json({ error: "not_found", loginUrl: env.STRIPE_PORTAL_LOGIN_URL || null });
      const customer = typeof s.customer === "string" ? s.customer : s.customer.id;
      const p = await stripe.billingPortal.sessions.create({ customer, return_url: `${base}/account` });
      res.json({ url: p.url });
    } catch (e) { log(`[pay] portal failed (${e.type || e.name})`); res.status(502).json({ error: "portal_failed" }); }
  });

  // ---- pages ----
  const indexHtml = () => { try { return fs.readFileSync(path.join(dist, "index.html"), "utf8"); } catch { return "<!doctype html><title>ProSwisher</title>"; } };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const sendPage = (res, html, status = 200) => res.status(status).set("Cache-Control", "no-cache").type("html").send(html);
  // paid sign-up page: the ONLY page that is geo-gated
  app.get("/subscribe", (req, res) => (geoGate(req).blocked ? sendPage(res, blockPage(), 451) : sendPage(res, indexHtml())));
  // per-game SEO title server-side (Larry format), so crawlers see it without JS
  app.get("/game/:id", (req, res) => {
    loadGames();
    const g = games[req.params.id];
    let html = indexHtml();
    if (g) {
      const date = new Date(g.date).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
      const t = commerce.gamePageTitle.replace("{Away}", g.away.short).replace("{Home}", g.home.short).replace("{date}", date);
      const d = commerce.gamePageDescription.replace("{Away}", g.away.short).replace("{Home}", g.home.short);
      html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(t)}</title>`).replace(/(<meta name="description" content=")[^"]*/, `$1${esc(d)}`);
    }
    sendPage(res, html);
  });
  app.use(express.static(dist, { index: false, maxAge: "5m", setHeaders: (r, p) => { if (p.includes("/assets/")) r.setHeader("Cache-Control", "public, max-age=31536000, immutable"); } }));
  app.get(/.*/, (_req, res) => sendPage(res, indexHtml()));
  Object.assign(app.locals, { counter, state, mode: () => mode });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!fs.existsSync(GEOIP_PATH)) await fetchGeoip();
  const counter = createCounter();
  const app = await createApp({ counter });
  setInterval(() => { try { counter.flush(); } catch (e) { console.warn("[stats] flush failed", e.message); } }, 5 * 60 * 1000).unref();
  setInterval(async () => { if (await fetchGeoip()) { app.locals.state.geo = await openGeoip(); } }, 7 * 864e5).unref();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, "0.0.0.0", () => console.log(`[server] listening on :${port}`));
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { try { counter.flush(); } catch {} process.exit(0); });
}
