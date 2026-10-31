// Data-source credits (Larry memo 24). Text comes from /api/leagues attribution fields, with the memo's exact
// wording as the fallback. `only` narrows to the leagues in a sim result.
import { useLeagues } from "../sports/hooks";
import { REQUIRED_ATTRIBUTION, attributionFor } from "../sports/api";

export default function DataSources({ only, className = "" }: { only?: string[]; className?: string }) {
  const leagues = useLeagues();
  const ids = only?.length ? [...new Set(only)] : Object.keys(REQUIRED_ATTRIBUTION);
  const rows = ids
    .map((id) => leagues?.data.find((l) => l.id === id)?.attribution || attributionFor(id))
    .filter((t): t is string => !!t);
  if (!rows.length) return null;
  return (
    <div className={"text-xs text-slate-400 " + className} data-testid="data-sources">
      <span className="font-semibold text-slate-300">Data sources: </span>
      {rows.map((t, i) => <span key={i}>{t}{i < rows.length - 1 ? " " : ""}</span>)}
    </div>
  );
}
