import { useEffect, useState } from "react";

// Runtime state from our own server (no cookies). Payments are enabled only when the server has a valid
// TEST key + webhook secret + price (preview) — otherwise everything renders in "payments off" mode.
type Cfg = { payments: { enabled: boolean } };
let cfgP: Promise<Cfg> | null = null;
const getCfg = () => (cfgP ||= fetch("/api/config").then((r) => (r.ok ? r.json() : { payments: { enabled: false } })).catch(() => ({ payments: { enabled: false } })));
export function usePaymentsEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => { getCfg().then((c) => setOn(!!c.payments?.enabled)); }, []);
  return on;
}

// Membership: the Checkout Session id from the success redirect, kept in localStorage (not a cookie).
export const SESSION_KEY = "ps_checkout_session";
let subP: Promise<boolean> | null = null;
const getSub = () => (subP ||= (async () => {
  const sid = localStorage.getItem(SESSION_KEY);
  if (!sid) return false;
  try { const r = await fetch(`/api/me?session_id=${encodeURIComponent(sid)}`); return r.ok ? !!(await r.json()).subscriber : false; } catch { return false; }
})());
export function useSubscriber(): boolean {
  const [s, setS] = useState(false);
  useEffect(() => { getSub().then(setS); }, []);
  return s;
}

// Cookieless first-party page counter (server hashes IP+UA with a daily salt; nothing raw stored).
// UTM params (utm_source/medium/campaign/content) are sent only with the landing view that carries them;
// the server ties them to the hashed visitor id for same-visit CTA attribution. Nothing stored client-side.
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content"];
export function countView(path: string, search = "") {
  const q = new URLSearchParams(search), utm: Record<string, string> = {};
  for (const k of UTM) { const v = q.get(k); if (v) utm[k] = v.slice(0, 64); }
  const body = Object.keys(utm).length ? { p: path, utm } : { p: path };
  try { fetch("/api/v", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }); } catch { /* ignore */ }
}
