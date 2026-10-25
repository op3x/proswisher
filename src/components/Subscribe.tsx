import { site } from "../config/site";

// Feature-flagged pricing placeholder. Rendered only when VITE_SUBSCRIBE_ENABLED === "true" (default false).
// No checkout, payment link or Stripe code exists in this build; the paid button is permanently disabled.
export default function Subscribe() {
  if (import.meta.env.VITE_SUBSCRIBE_ENABLED !== "true") return null;
  const p = site.pricing;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">{p.title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-panel border border-line p-4 space-y-2">
          <div className="font-semibold">{p.freeName} · {p.freePrice}</div>
          <ul className="text-sm text-slate-400 list-disc list-inside">{p.freeIncludes.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-2">
          <div className="font-semibold">{p.planName} · {p.price} <span className="text-sm font-normal">{p.interval}</span></div>
          <p className="text-sm text-slate-300">{p.renewal} {p.cancel}</p>
          <ul className="text-sm text-slate-400 list-disc list-inside">{p.includes.map((i) => <li key={i}>{i}</li>)}</ul>
          <button disabled aria-disabled className="rounded-lg bg-line px-3 py-2 text-sm text-slate-400 cursor-not-allowed">{p.unavailable}</button>
        </div>
      </div>
      <p className="text-xs text-slate-500">{site.pickDisclaimer}</p>
    </section>
  );
}
