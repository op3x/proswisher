import { useEffect, useState } from "react";
import { site } from "../config/site";
import { SESSION_KEY, usePaymentsEnabled } from "../lib/runtime";

// Post-checkout landing + cancel-anytime. Stores the Checkout Session id in localStorage (no cookies);
// "Manage or cancel" opens the Stripe customer portal for that customer.
export default function Account() {
  const selling = usePaymentsEnabled();
  const [status, setStatus] = useState<string | null>(null), [err, setErr] = useState("");
  useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get("session_id");
    if (sid && /^cs_(test|live)_\w+$/.test(sid)) { localStorage.setItem(SESSION_KEY, sid); window.history.replaceState(null, "", "/account"); }
    const s = localStorage.getItem(SESSION_KEY);
    if (!s) return setStatus("none");
    fetch("/api/me", { headers: { "X-PS-Session": s } }).then((r) => r.json()).then((j) => setStatus(j.subscriber ? "active" : j.status || "inactive")).catch(() => setStatus("unknown"));
  }, []);
  const portal = async () => {
    setErr("");
    const r = await fetch("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: localStorage.getItem(SESSION_KEY) }) });
    const j = await r.json().catch(() => ({}));
    if (j.url) window.location.href = j.url; else if (j.loginUrl) window.location.href = j.loginUrl; else setErr("We couldn't open subscription settings. Please try again.");
  };
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl sm:text-3xl font-extrabold">Account settings</h1>
      {!selling ? <p className="text-sm text-slate-300">{site.pricing.unavailable}</p> : (
        <>
          <p className="text-sm text-slate-300">Membership: {status === "active" ? "active" : status === "none" ? "no membership found on this device" : status ?? "checking…"}</p>
          {status !== "none" && <button onClick={portal} className="rounded-lg border border-line px-4 py-2 text-sm">Manage or cancel subscription</button>}
          <p className="text-xs text-slate-400">{site.pricing.cancel}</p>
          {err && <p className="text-loss text-sm">{err}</p>}
        </>
      )}
    </div>
  );
}
