import { useState } from "react";
import { Link } from "react-router-dom";
import { site, geoblock } from "../config/site";
import { usePaymentsEnabled } from "../lib/runtime";

const US_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const COUNTRIES: Array<[string, string]> = [["US", "United States"], ["CA", "Canada"], ["GB", "United Kingdom"], ["AU", "Australia"], ["JP", "Japan"], ["OTHER", "Other"]];

// Paid sign-up = Stripe Checkout (no separate account system). The server answers 451 here and on
// POST /api/checkout for blocked locations. Consent box is UNCHECKED by default (Larry) and required.
export default function SubscribePage() {
  const selling = usePaymentsEnabled();
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
      setErr(r.status === 451 ? site.geoBlockCopy.checkoutBilling : site.gamePage.paymentsOff);
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
        <p className="rounded-xl border border-line bg-panel p-4 text-sm text-slate-300">{site.pricing.unavailable}</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1"><span className="text-slate-400">Billing country</span>
              <select className="w-full rounded-lg bg-ink border border-line p-2" value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">Choose…</option>{COUNTRIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
            {country === "US" && <label className="space-y-1"><span className="text-slate-400">State</span>
              <select className="w-full rounded-lg bg-ink border border-line p-2" value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">Choose…</option>{US_STATES.map((s) => <option key={s}>{s}</option>)}
              </select></label>}
          </div>
          <label className="flex gap-2 items-start">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="text-slate-300">{c.consentCheckbox.replace("{price}", price)}</span>
          </label>
          <p className="text-xs text-slate-400">Read the <Link className="text-accent underline" to="/terms" target="_blank">Terms</Link> and <Link className="text-accent underline" to="/privacy" target="_blank">Privacy Policy</Link>.</p>
          {err && <p className="text-loss">{err}</p>}
          <button onClick={submit} disabled={busy || !consent} className="rounded-lg bg-accent text-ink font-semibold px-4 py-2 disabled:opacity-50">{c.cta.replace("{price}", price)}</button>
        </div>
      )}
      {/* memo 20 condition 5: full disclaimer on the checkout page too */}
      <p className="text-xs text-slate-500">{site.footerDisclaimer}</p>
    </div>
  );
}
