import { useState } from "react";
import { Link } from "react-router-dom";
import { site, geoblock } from "../config/site";
import { usePaymentsEnabled, useCheckoutAvailable } from "../lib/runtime";

const US_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const COUNTRIES: Array<[string, string]> = [["US", "United States"], ["CA", "Canada"], ["GB", "United Kingdom"], ["AU", "Australia"], ["JP", "Japan"], ["OTHER", "Other"]];

// Paid sign-up = Stripe Checkout (no separate account system). Larry 10:24: the server fails closed here and on
// POST /api/checkout (blocked, unknown or mismatched location; GeoIP DB missing/stale -> "temporarily unavailable").
// The billing country/state picker is REQUIRED with no default; the server re-checks it against the blocklist and the
// IP's country/state. Consent box is UNCHECKED by default (Larry) and required.
export default function SubscribePage() {
  const payments = usePaymentsEnabled();
  const geoOk = useCheckoutAvailable();
  const selling = payments && geoOk === true;
  const c = site.checkout, price = site.pricing.price;
  const [consent, setConsent] = useState<boolean>(site.checkout.consentDefaultChecked); // false
  const [country, setCountry] = useState(""), [state, setState] = useState("");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const blocked = country === "JP" || (country === "US" && geoblock.usStates.includes(state));
  const submit = async () => {
    setErr("");
    if (!consent) return setErr(c.consentRequiredError);
    if (!country || (country === "US" && !state)) return setErr("Please choose your billing country and state.");
    if (blocked) return setErr(site.geoBlockCopy.checkoutBilling);
    setBusy(true);
    try {
      const r = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, age21: true, country: country === "OTHER" ? "ZZ" : country, state }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) { window.location.href = j.url; return; }
      // Server refusal text (geoblock-notice.md / Larry 10:24); never contains the support address while P11 holds.
      setErr(typeof j.message === "string" && j.message ? j.message : r.status === 451 ? site.geoBlockCopy.checkoutBilling : site.gamePage.paymentsOff);
    } finally { setBusy(false); }
  };
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl sm:text-3xl font-extrabold">{c.title}</h1>
      {/* price, renewal and cancel terms come BEFORE any payment fields */}
      <div className="rounded-xl bg-panel border border-line p-4 space-y-2 text-sm">
        <p className="font-semibold">{c.summary.replace("{price}", price)}</p>
        <p className="text-slate-300">{c.renewalDisclosure}</p>
        <p className="text-slate-400">{c.whatItIs}</p>
      </div>
      {!selling ? (
        <p className="rounded-xl border border-line bg-panel p-4 text-sm text-slate-300">{payments && geoOk === false ? site.geoBlockCopy.unavailable : site.pricing.unavailable}</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1"><span className="text-slate-300">Billing country (required)</span>
              <select required aria-required="true" className="w-full min-h-11 rounded-lg bg-ink border border-line p-2" value={country} onChange={(e) => { setCountry(e.target.value); setState(""); }}>
                <option value="">Choose…</option>{COUNTRIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
            {country === "US" && <label className="space-y-1"><span className="text-slate-300">State (required)</span>
              <select required aria-required="true" className="w-full min-h-11 rounded-lg bg-ink border border-line p-2" value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">Choose…</option>{US_STATES.map((s) => <option key={s}>{s}</option>)}
              </select></label>}
          </div>
          <label className="flex gap-2 items-start">
            <input type="checkbox" className="mt-1 h-6 w-6 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="text-slate-300">{c.consentCheckbox.replace("{price}", price)}</span>
          </label>
          <p className="text-xs text-slate-400">Read the <Link className="text-accent underline" to="/terms" target="_blank">Terms</Link> and <Link className="text-accent underline" to="/privacy" target="_blank">Privacy Policy</Link>.</p>
          {err && <p role="alert" className="text-loss">{err}</p>}
          <button onClick={submit} disabled={busy || !consent} className="min-h-11 rounded-lg bg-accent text-ink font-semibold px-4 py-2 disabled:opacity-50">{c.cta.replace("{price}", price)}</button>
        </div>
      )}
      {/* Sal #5 / Larry §5: short disclaimer on checkout; the full one is in the footer (shown once per page). */}
      <p className="text-xs text-slate-300">{site.pickDisclaimer}</p>
    </div>
  );
}
