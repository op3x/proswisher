import { site } from "../config/site";

// Members-only placeholder. Payments are off, so the CTA is a permanently disabled stub (no checkout exists).
export default function LockedTeaser({ compact = false }: { compact?: boolean }) {
  const c = site.predictionCard;
  return (
    <div className={`rounded-lg border border-dashed border-line ${compact ? "p-3" : "p-4"} space-y-2 text-sm`}>
      <p className="text-slate-300">{c.lockedTeaser}</p>
      <span role="button" aria-disabled="true" className="inline-block rounded-lg bg-line px-3 py-1.5 text-xs text-slate-400 cursor-not-allowed">{c.lockedCta}</span>
      <p className="text-[11px] text-slate-500">{c.lockedUnavailable} {c.lockedLogNote}</p>
    </div>
  );
}
