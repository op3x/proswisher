// Mode guard. Runs before every build and before the server starts.
// Refuses to proceed if a LIVE Stripe key is present outside production, if live payments are
// requested outside production, or if any secret-looking value is exposed to the browser bundle.
// Never prints secret values, only variable NAMES.
const env = process.env;
const APP_ENV = (env.APP_ENV || "preview").toLowerCase();
const LIVE_ENABLED = String(env.STRIPE_LIVE_ENABLED || "false").toLowerCase() === "true";
const problems = [];

if (!["preview", "production"].includes(APP_ENV)) problems.push(`APP_ENV must be "preview" or "production" (got an unexpected value)`);

const LIVE = /^(sk|rk|pk)_live_/;
const SECRETISH = /^(sk|rk)_(live|test)_|^whsec_/;
for (const [name, value] of Object.entries(env)) {
  if (typeof value !== "string" || !value) continue;
  if (LIVE.test(value) && APP_ENV !== "production") problems.push(`${name} holds a LIVE Stripe key while APP_ENV=${APP_ENV}`);
  if (name.startsWith("VITE_") && SECRETISH.test(value)) problems.push(`${name} would ship a secret to the browser (VITE_* vars are public)`);
}
if (LIVE_ENABLED && APP_ENV !== "production") problems.push(`STRIPE_LIVE_ENABLED=true is only allowed when APP_ENV=production`);

if (problems.length) {
  console.error("[guard] REFUSING to build/start:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log(`[guard] ok: APP_ENV=${APP_ENV} STRIPE_LIVE_ENABLED=${LIVE_ENABLED} (payments are not wired in this build)`);
