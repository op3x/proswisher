import { useEffect, useState } from "react";
import { site } from "../config/site";
import { SESSION_KEY, usePaymentsEnabled } from "../lib/runtime";
import OtherDeviceCancel from "../components/OtherDeviceCancel";

// Post-checkout landing + cancel-anytime (Terms §5(c)). Stores the Checkout Session id in localStorage (no cookies).
// Larry 10:31 PM: "Cancel subscription" deep-links into the Stripe portal's cancel screen for this buyer's subscription
// (server: flow_data subscription_cancel), so it's Cancel -> Confirm; "Manage subscription" is the plain portal.
// No buyer recognized on this device -> "Paid on another device? Cancel here" (portal login link; hidden if unset).
export default function Account() {
  const selling = usePaymentsEnabled();
  const [status, setStatus] = useState<string | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState("");
  const canceled = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("canceled") === "1";
  useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get("session_id");
    if (sid && /^cs_(test|live)_\w+$/.test(sid)) { localStorage.setItem(SESSION_KEY, sid); window.history.replaceState(null, "", "/account"); }
    const s = localStorage.getItem(SESSION_KEY);
    if (!s) return setStatus("none");
    fetch("/api/me", { headers: { "X-PS-Session": s } }).then((r) => r.json()).then((j) => setStatus(j.subscriber ? "active" : j.status || "inactive")).catch(() => setStatus("unknown"));
  }, []);
  const portal = async (flow: "cancel" | "manage") => {
    setErr(""); setBusy(flow);
    try {
      const r = await fetch("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: localStorage.getItem(SESSION_KEY), flow }) });
      const j = await r.json().catch(() => ({}));
      if (j.url) { window.location.href = j.url; return; }
      if (j.loginUrl) { window.location.href = j.loginUrl; return; }
      setErr("We couldn't open subscription settings. Please try again.");
    } catch { setErr("We couldn't open subscription settings. Please try again."); }
    setBusy("");
  };
  const recognized = status !== null && status !== "none";
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl sm:text-3xl font-extrabold">Account settings</h1>
      {canceled && <p className="text-sm text-slate-200" role="status">Your subscription is canceled. You won't be charged again, and your access runs through the end of the period you've paid for.</p>}
      {!selling ? <p className="text-sm text-slate-300">{site.pricing.unavailable}</p> : (
        <>
          <p className="text-sm text-slate-300">Membership: {status === "active" ? "active" : status === "none" ? "no membership found on this device" : status ?? "checking…"}</p>
          {recognized && (
            <div className="flex flex-wrap gap-3">
              <button onClick={() => portal("cancel")} disabled={!!busy} data-testid="cancel-subscription" className="rounded-lg border border-line px-4 py-2 text-sm min-h-11">Cancel subscription</button>
              <button onClick={() => portal("manage")} disabled={!!busy} data-testid="manage-subscription" className="rounded-lg border border-line px-4 py-2 text-sm min-h-11 text-slate-300">Manage subscription</button>
            </div>
          )}
          <p className="text-xs text-slate-400">{site.pricing.cancel}</p>
          {err && <p className="text-loss text-sm">{err}</p>}
        </>
      )}
      {/* Shown whenever no buyer is recognized here (also with payments off) and the login link is configured. */}
      {(!selling || status === "none") && <p className="text-sm text-slate-300"><OtherDeviceCancel /></p>}
    </div>
  );
}
