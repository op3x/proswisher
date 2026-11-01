// Release checks (Larry 10/31 10:31 PM). Called from scripts/guard.mjs (prebuild + prestart) and by createApp, so a
// PRODUCTION build or start fails, rather than shipping:
//  - Terms that still say "Effective on launch" (LEGAL_EFFECTIVE_TERMS empty or not YYYY-MM-DD);
//  - a Privacy Policy that still says "Effective on launch" (LEGAL_EFFECTIVE_PRIVACY_A empty or not YYYY-MM-DD);
//  - payments ON with Privacy §B still "Effective on launch" (LEGAL_EFFECTIVE_PRIVACY_B empty or not YYYY-MM-DD);
//  - payments ON without the Stripe customer-portal login link (STRIPE_PORTAL_LOGIN_URL), which the
//    "Paid on another device? Cancel here" link on /account, /cancel and the footer depends on.
// Preview is never blocked (it always shows "Effective on launch"; the cancel link just stays hidden).
// Only variable NAMES are reported, never values.
import { legalEffective, ON_LAUNCH } from "./legal.mjs";
import { paymentsMode } from "./payments.mjs";

// The Stripe portal "login link" (Stripe Dashboard > Settings > Billing > Customer portal > Login link).
export const PORTAL_LOGIN_RE = /^https:\/\/billing\.stripe\.com\/p\/login\/[A-Za-z0-9_]+$/;
export function portalLoginUrl(env = process.env) {
  const v = String(env.STRIPE_PORTAL_LOGIN_URL || "").trim();
  return PORTAL_LOGIN_RE.test(v) ? v : null;
}

export function releaseProblems(env = process.env) {
  const prod = String(env.APP_ENV || "preview").toLowerCase() === "production";
  if (!prod) return [];
  const problems = [];
  if (!String(env.LEGAL_EFFECTIVE_TERMS || "").trim()) problems.push("LEGAL_EFFECTIVE_TERMS is empty (production Terms would show \"Effective on launch\")");
  else if (legalEffective(env).terms === ON_LAUNCH) problems.push("LEGAL_EFFECTIVE_TERMS is not a YYYY-MM-DD date (production Terms would show \"Effective on launch\")");
  // Larry 10/31 10:55 PM: the Privacy Policy (privacy-a3) gets its effective date the same way (LEGAL_EFFECTIVE_PRIVACY_A).
  if (!String(env.LEGAL_EFFECTIVE_PRIVACY_A || "").trim()) problems.push("LEGAL_EFFECTIVE_PRIVACY_A is empty (production Privacy Policy would show \"Effective on launch\")");
  else if (legalEffective(env).privacyA === ON_LAUNCH) problems.push("LEGAL_EFFECTIVE_PRIVACY_A is not a YYYY-MM-DD date (production Privacy Policy would show \"Effective on launch\")");
  // Larry 10/31 11:02 PM: Privacy §B (privacy-b1) renders only when payments are on, so its date is required only then.
  if (paymentsMode(env).enabled) {
    if (!String(env.LEGAL_EFFECTIVE_PRIVACY_B || "").trim()) problems.push("payments are on but LEGAL_EFFECTIVE_PRIVACY_B is empty (production Privacy Policy §B would show \"Effective on launch\")");
    else if (legalEffective(env).privacyB === ON_LAUNCH) problems.push("payments are on but LEGAL_EFFECTIVE_PRIVACY_B is not a YYYY-MM-DD date (production Privacy Policy §B would show \"Effective on launch\")");
  }
  if (paymentsMode(env).enabled && !portalLoginUrl(env))
    problems.push("payments are on but STRIPE_PORTAL_LOGIN_URL is not set to a https://billing.stripe.com/p/login/... link (the \"Paid on another device?\" cancel link would be hidden)");
  return problems;
}

export function assertRelease(env = process.env) {
  const p = releaseProblems(env);
  if (p.length) throw new Error("[release] REFUSING production build/start:\n - " + p.join("\n - "));
}
