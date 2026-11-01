// The "what's modeled" disclaimer. /api/leagues `injuriesModeled` on the NFL row switches to Larry's injuries text;
// false or missing keeps the base text, so nothing says injuries aren't modeled while they are (or vice versa).
import { useLeagues } from "../sports/hooks";
import { site } from "../config/site";

export function useInjuriesModeled(): boolean {
  const leagues = useLeagues();
  return leagues?.source === "live" && leagues.data.find((l) => l.id === "nfl")?.injuriesModeled === true;
}

export default function ModelDisclaimer({ className = "text-xs text-slate-400" }: { className?: string }) {
  const on = useInjuriesModeled();
  return <p className={className} data-testid="model-disclaimer">{on ? site.modelDisclaimer.injuries : site.modelDisclaimer.base}</p>;
}
