import { site } from "../config/site";

// Feature-flagged placeholder. Rendered only when VITE_SUBSCRIBE_ENABLED === "true".
// No checkout, payment link, or Stripe code exists in this build (__PAYMENTS_WIRED__ is false).
export default function Subscribe() {
  if (import.meta.env.VITE_SUBSCRIBE_ENABLED !== "true") return null;
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 flex items-center justify-between gap-4">
      <div><div className="font-semibold">{site.subscribe.title}</div><div className="text-sm text-slate-400">{site.subscribe.body}</div></div>
      <button disabled aria-disabled className="shrink-0 rounded-lg bg-line px-3 py-2 text-sm text-slate-400 cursor-not-allowed">
        {site.subscribe.cta}{__PAYMENTS_WIRED__ ? "" : ""}
      </button>
    </div>
  );
}
