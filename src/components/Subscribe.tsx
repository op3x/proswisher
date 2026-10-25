import { site } from "../config/site";
import { usePaymentsEnabled } from "../lib/runtime";

// Pricing section. Rendered only when the server reports payments enabled (test key + webhook secret + price set).
export default function Subscribe() {
  const selling = usePaymentsEnabled();
  if (!selling) return null;
  const p = site.pricing;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">{p.title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-panel border border-line p-4 space-y-2">
          <div className="font-semibold">{p.freeName} · {p.freePrice}</div>
          <ul className="text-sm text-slate-400 list-disc list-inside">{p.freeIncludes.map((i) => <li key={i}>{i}</li>)}</ul>
          <a href="/#slate" className="inline-block text-sm text-accent">{p.freeCta}</a>
        </div>
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-2">
          <div className="font-semibold">{p.planName} · {p.price} <span className="text-sm font-normal">{p.interval}</span></div>
          <p className="text-sm text-slate-300">{p.renewal} {p.cancel}</p>
          <ul className="text-sm text-slate-400 list-disc list-inside">{p.includes.map((i) => <li key={i}>{i}</li>)}</ul>
          <a href="/go/subscribe" className="inline-block rounded-lg bg-accent text-ink font-semibold px-3 py-2 text-sm">{site.gamePage.membersOnly.cta}</a>
        </div>
      </div>
      <p className="text-xs text-slate-500">{site.pickDisclaimer}</p>
    </section>
  );
}
