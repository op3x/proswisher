import { Link } from "react-router-dom";
import { site } from "../config/site";
import { Game, gamePath } from "../lib/data";
import { usePaymentsEnabled } from "../lib/runtime";

const ctTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });

// Members-only game (Laye 9:42): matchup, tip time and CTA ONLY. No partial prediction, no blurred numbers.
// The CTA goes through /go/subscribe (server counts the click, then redirects). Disabled while payments are off.
export default function LockedTeaser({ g, featured, compact = false }: { g: Game; featured?: Game; compact?: boolean }) {
  const m = site.gamePage.membersOnly;
  const selling = usePaymentsEnabled();
  const body = featured
    ? m.body.replace("{FeaturedAway}", featured.away.short).replace("{FeaturedHome}", featured.home.short)
    : m.body.split(" Today's free game")[0];
  return (
    <div className={`rounded-lg border border-dashed border-line ${compact ? "p-3" : "p-4"} space-y-2 text-sm`}>
      {!compact && <p className="font-semibold text-slate-200">{m.matchup.replace("{Away}", g.away.short).replace("{Home}", g.home.short).replace("{time}", ctTime(g.date))}</p>}
      <p className="text-slate-300">{body}</p>
      <div className="flex flex-wrap items-center gap-2">
        {selling
          ? <a href="/go/subscribe" className="inline-block rounded-lg bg-accent text-ink font-semibold px-3 py-1.5 text-xs">{m.cta}</a>
          : <span role="button" aria-disabled="true" className="inline-block rounded-lg bg-line px-3 py-1.5 text-xs text-slate-400 cursor-not-allowed">{m.cta}</span>}
        {featured && !compact && <Link to={gamePath(featured)} className="text-xs text-accent">{m.ctaSecondary}</Link>}
      </div>
      <p className="text-[11px] text-slate-500">{selling ? m.priceNote : site.gamePage.paymentsOff} {site.predictionCard.lockedLogNote}</p>
    </div>
  );
}
